#!/usr/bin/env node
/**
 * Push/update workflow "Sectors Daily Watchlist - Stage 1 Fetch Kandidat" ke n8n
 * lewat REST API (scripts/n8n-client.js). Aman dijalankan berulang — upsert by name,
 * tidak membuat duplikat.
 *
 * Syarat: N8N_BASE_URL + N8N_API_KEY di .env (lihat npm run n8n:test).
 * Jalankan: node scripts/deploy-stage1-workflow.js
 *
 * Kredensial header auth Sectors API dibuat sekali secara manual lewat REST API
 * (lihat catatan di README) dengan id di bawah — GANTI id ini kalau credential
 * dibuat ulang. Isi API key sesungguhnya lewat n8n UI (Credentials -> Sectors API -
 * Header Auth -> Value), BUKAN lewat script ini, supaya key tidak pernah tertulis di repo.
 */
import { upsertWorkflowByName } from './n8n-client.js';

const SECTORS_CRED = { id: 'TRiYGsteCGY1VLbn', name: 'Sectors API - Header Auth' };

const CODE_NORMALIZE = `
// Menggabungkan kandidat dari Top Company Movers + Most Traded Stocks, dedupe by symbol.
// Bentuk response API v2 — lihat docs/API_FINDINGS.md §2 & config/sectors-endpoints.js.
// PENTING: logika stripSuffix/extract di sini WAJIB disinkronkan manual dengan
// config/sectors-endpoints.js di repo, karena Code node n8n tidak bisa import file lokal.

function stripSuffix(symbol) {
  return String(symbol || '').split('.')[0].toUpperCase();
}

function extractFromTopChanges(resp) {
  // PENTING (VERIFIED 26 Sep 2026): field nama perusahaan di endpoint ini adalah \`name\`,
  // BUKAN \`company_name\` seperti di most-traded di bawah — dua endpoint API ini tidak
  // konsisten penamaannya. Lihat docs/API_FINDINGS.md.
  const out = [];
  for (const classification of Object.values(resp || {})) {
    for (const rows of Object.values(classification || {})) {
      for (const row of rows || []) {
        out.push({ symbol: stripSuffix(row.symbol), companyName: row.name, source: 'top_changes' });
      }
    }
  }
  return out;
}

function extractFromMostTraded(resp) {
  const out = [];
  // BUG NYATA (ditemukan lewat test-execute, 27 Sep 2026): pada hari bursa libur (akhir pekan
  // atau libur nasional), /v2/most-traded/ TIDAK mengembalikan bentuk { "YYYY-MM-DD": [...] }
  // seperti biasa, melainkan { message: "No traded stocks found for the given date range." }.
  // Tanpa pengecekan ini, Object.values(resp) menghasilkan ["No traded stocks..."], lalu
  // "for (const row of rows)" meng-iterasi KARAKTER string itu satu-satu, menghasilkan
  // kandidat sampah bersymbol kosong yang bikin enrichment Tahap 2 gagal (404 ke /daily//).
  if (resp && typeof resp.message === 'string') return out;
  for (const rows of Object.values(resp || {})) {
    for (const row of rows || []) {
      if (!row || !row.symbol) continue; // jaga-jaga field kosong pada data nyata (CLAUDE.md §8)
      out.push({ symbol: stripSuffix(row.symbol), companyName: row.company_name, source: 'most_traded' });
    }
  }
  return out;
}

function dedupeCandidates(lists) {
  const bySymbol = new Map();
  for (const c of lists) {
    if (!bySymbol.has(c.symbol)) {
      bySymbol.set(c.symbol, { symbol: c.symbol, companyName: c.companyName, sources: [c.source] });
    } else {
      const existing = bySymbol.get(c.symbol);
      if (!existing.sources.includes(c.source)) existing.sources.push(c.source);
    }
  }
  return [...bySymbol.values()];
}

const topChanges = $('Fetch Top Company Movers').first().json;
const mostTraded = $json;

const candidates = dedupeCandidates([
  ...extractFromTopChanges(topChanges),
  ...extractFromMostTraded(mostTraded),
]);

return candidates.map((c) => ({ json: c }));
`.trim();

const workflow = {
  name: 'Sectors Daily Watchlist - Stage 1 Fetch Kandidat',
  nodes: [
    {
      id: 'trigger',
      name: 'Schedule Trigger',
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2,
      position: [-400, 0],
      parameters: {
        rule: {
          interval: [{ field: 'cronExpression', expression: '0 30 7 * * 1-5' }], // 07:30 WIB, Senin-Jumat
        },
      },
    },
    {
      id: 'fetch-top-changes',
      name: 'Fetch Top Company Movers',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [-100, -120],
      parameters: {
        method: 'GET',
        url: 'https://api.sectors.app/v2/companies/top-changes/',
        authentication: 'genericCredentialType',
        genericAuthType: 'httpHeaderAuth',
        sendQuery: true,
        specifyQuery: 'keypair',
        queryParameters: {
          parameters: [
            { name: 'n_stock', value: '5' }, // diturunkan sementara dari 10 (27 Sep 2026) buat hemat credit testing
            { name: 'classifications', value: 'top_gainers' },
            { name: 'periods', value: '1d' },
            { name: 'min_mcap_billion', value: '5000' },
          ],
        },
        options: {},
      },
      credentials: { httpHeaderAuth: SECTORS_CRED },
    },
    {
      id: 'fetch-most-traded',
      name: 'Fetch Most Traded Stocks',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [-100, 120],
      parameters: {
        method: 'GET',
        url: 'https://api.sectors.app/v2/most-traded/',
        authentication: 'genericCredentialType',
        genericAuthType: 'httpHeaderAuth',
        sendQuery: true,
        specifyQuery: 'keypair',
        queryParameters: {
          // PENTING (ditemukan lewat test-execute nyata, 27 Sep 2026): pakai setZone('utc'),
          // BUKAN 'Asia/Jakarta'. API Sectors menolak `end` dengan pesan "cannot be in the
          // future" memakai referensi tanggal UTC, bukan WIB -- di jam 00:00-07:00 WIB (yaitu
          // 17:00-24:00 UTC hari sebelumnya), tanggal kalender WIB sudah maju sehari lebih dulu
          // dibanding UTC, jadi request dengan tanggal WIB ditolak sebagai "hari yang belum
          // terjadi" dari sudut pandang API. Konsisten dengan lastTradingDay()/shiftDate() di
          // config/sectors-endpoints.js yang MEMANG sudah UTC dari awal.
          //
          // PENTING #2 (ditemukan lewat test-execute nyata, 27 Sep 2026): /most-traded/ butuh
          // TEPAT SATU hari bursa (bukan rentang), dan mengembalikan { message: "No traded
          // stocks..." } kalau tanggalnya akhir pekan -- lihat CODE_NORMALIZE di atas untuk
          // penanganan defensifnya. Ekspresi di bawah meniru lastTradingDay() (mundur sampai
          // bukan Sabtu/Minggu) SUPAYA KASUS INI JARANG TERJADI, tapi TIDAK menangani libur
          // nasional IDX (batasan yang sama seperti lastTradingDay() aslinya di
          // config/sectors-endpoints.js) -- itu sebabnya penanganan defensif di CODE_NORMALIZE
          // tetap wajib ada sebagai jaring pengaman kedua.
          parameters: [
            {
              name: 'start',
              value:
                "={{ (() => { let d = $now.setZone('utc'); while (d.weekday === 6 || d.weekday === 7) d = d.minus({ days: 1 }); return d.toFormat('yyyy-LL-dd'); })() }}",
            },
            {
              name: 'end',
              value:
                "={{ (() => { let d = $now.setZone('utc'); while (d.weekday === 6 || d.weekday === 7) d = d.minus({ days: 1 }); return d.toFormat('yyyy-LL-dd'); })() }}",
            },
            { name: 'n_stock', value: '5' }, // diturunkan sementara dari 10 (27 Sep 2026) buat hemat credit testing
            { name: 'adjusted', value: 'true' },
          ],
        },
        options: {},
      },
      credentials: { httpHeaderAuth: SECTORS_CRED },
    },
    {
      id: 'normalize-candidates',
      name: 'Normalize & Dedupe Candidates',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [200, 120],
      parameters: { mode: 'runOnceForAllItems', jsCode: CODE_NORMALIZE },
    },
    {
      id: 'sticky-status',
      name: 'Sticky Note',
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [-420, 320],
      parameters: {
        width: 700,
        height: 280,
        content:
          '## Status (26 Sep 2026)\n\n' +
          '**Selesai:** Tahap 1 (fetch kandidat + dedupe) — kerangka lengkap, siap uji begitu ' +
          'credential "Sectors API - Header Auth" diisi API key asli (sekarang masih placeholder).\n\n' +
          '**Belum dibangun:** Tahap 2 (enrichment per kandidat: daily, broker-summary, foreign-flow, ' +
          'news), scoring engine, output, delivery (Telegram/Sheets), logging.\n\n' +
          'Temuan penting: `/v2/daily/{symbol}/` mengembalikan ARRAY -> n8n HTTP Request node otomatis ' +
          'MEMECAH jadi banyak item (satu per baris tanggal), bukan satu item per simbol. Tahap 2 wajib ' +
          'pakai node Aggregate/Summarize (group by pairedItem) sebelum lanjut ke scoring, kalau tidak ' +
          'data per-kandidat akan tercampur. Lihat docs/API_FINDINGS.md.\n\n' +
          'Scoring engine sudah jadi & teruji (61 test) di src/scoring/ — tinggal disalin sebagai Code ' +
          'node begitu tahap 2 siap.',
      },
    },
  ],
  connections: {
    'Schedule Trigger': {
      main: [
        [
          { node: 'Fetch Top Company Movers', type: 'main', index: 0 },
          { node: 'Fetch Most Traded Stocks', type: 'main', index: 0 },
        ],
      ],
    },
    'Fetch Most Traded Stocks': {
      main: [[{ node: 'Normalize & Dedupe Candidates', type: 'main', index: 0 }]],
    },
  },
  settings: { timezone: 'Asia/Jakarta', executionOrder: 'v1' },
};

const result = await upsertWorkflowByName(workflow);
console.log(`Workflow ID: ${result.id}`);
console.log(`Buka di: http://localhost:5678/workflow/${result.id}`);
