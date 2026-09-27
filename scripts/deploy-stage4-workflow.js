#!/usr/bin/env node
/**
 * Menambahkan node Tahap 4 (delivery Telegram + logging Google Sheets) ke workflow yang
 * sudah dibuat deploy-stage1/2/3-workflow.js — TIDAK membuat workflow baru.
 *
 * Dua cabang PARALEL dari "Score Candidates" (independen, tidak saling butuh output satu sama
 * lain, beda dengan kasus News di Tahap 2 yang butuh rantai linear):
 *   - Format Telegram Message -> Send Telegram Message
 *   - Prepare Sheet Rows -> Log Watchlist to Google Sheets
 * Kedua node delivery diberi `onError: 'continueRegularOutput'` supaya kegagalan salah satu
 * (mis. Telegram down) TIDAK menggagalkan cabang lain (Sheets logging) — pelajaran dari
 * Tahap 2 soal n8n yang bisa "menuntaskan" satu cabang sebelum menyentuh cabang lain kalau
 * ada yang gagal duluan.
 *
 * Kredensial dibuat manual sekali lewat REST API (lihat README) dengan id di bawah — GANTI id
 * ini kalau credential dibuat ulang.
 *
 * Syarat: sudah pernah jalankan deploy-stage1/2/3-workflow.js.
 * Jalankan: node scripts/deploy-stage4-workflow.js
 */
import { pathToFileURL } from 'node:url';
import { listWorkflows, getWorkflow, updateWorkflow } from './n8n-client.js';

const TELEGRAM_CRED = { id: 'Gc1pPZaYMawyHmc2', name: 'Telegram Bot - Sectors Watchlist' };
const GOOGLE_CRED = { id: '3hTHgpu4eqmw5DlU', name: 'Google Service Account - Sectors Watchlist' };
// ID spreadsheet & chat Telegram BUKAN rahasia (beda dari private key service account / bot
// token, yang cuma ada di credential store n8n, tidak pernah di sini) -- aman ditulis di kode.
// TELEGRAM_CHAT_ID SENGAJA tidak dibaca lewat $env.* di parameter node: n8n (dijalankan via
// `n8n start` biasa) TIDAK otomatis memuat .env proyek ini ke environment prosesnya sendiri,
// jadi $env.TELEGRAM_CHAT_ID berisiko resolve ke kosong tanpa ada cara mudah memverifikasinya
// dari luar. Nilai literal lebih pasti benar untuk workflow yang wajib jalan otonom.
const GOOGLE_SHEETS_ID = '1kjNB6fLkxeP0uvRxJ5SxqiKKXZ75QIUpdtcwSSx-X5o';
const TELEGRAM_CHAT_ID = '6196492902';

const NAME = 'Sectors Daily Watchlist - Stage 1+2+3+4 (Full Pipeline)';
const OLD_NAMES = [
  'Sectors Daily Watchlist - Stage 1+2+3 Fetch, Enrichment & Scoring',
  'Sectors Daily Watchlist - Stage 1+2 Fetch & Enrichment',
  'Sectors Daily Watchlist - Stage 1 Fetch Kandidat',
];

export const CODE_FORMAT_TELEGRAM = `
// SCORING_LOGIC.md §7 / CLAUDE.md §7: pesan Telegram harian mode simple + link ke Google
// Sheet untuk mode detail + disclaimer wajib di SETIAP keluaran. Teks polos (tanpa parse_mode)
// SENGAJA dipilih -- MarkdownV2 Telegram butuh escaping karakter khusus (. - ( ) dst) yang
// gampang salah dan bikin pesan gagal terkirim; teks polos lebih andal untuk workflow otonom.
const result = $json;
const tanggal = new Date(result.generatedAt).toLocaleDateString('id-ID', {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Jakarta',
});

const lines = [];
lines.push('📊 Sectors Daily Watchlist — ' + tanggal);
lines.push('');

if (result.watchlist.length === 0) {
  lines.push('Tidak ada saham yang lolos kriteria watchlist hari ini.');
} else {
  result.watchlist.forEach((c, i) => {
    lines.push((i + 1) + '. ' + c.symbol + ' (' + c.companyName + ') — Skor ' + c.finalScore.toFixed(1));
    lines.push('   ' + c.simpleReasoning);
  });
}

lines.push('');
lines.push('📄 Detail lengkap (skor tiap faktor, broker flow, berita): https://docs.google.com/spreadsheets/d/${GOOGLE_SHEETS_ID}/edit');
lines.push('');
lines.push(result.disclaimer);

return [{ json: { text: lines.join('\\n') } }];
`.trim();

export const CODE_PREPARE_SHEET_ROWS = `
// CLAUDE.md §3: Google Sheets sebagai rekap harian dan audit trail. Satu baris per saham di
// watchlist, field di-flatten (Sheets cuma terima nilai skalar per sel, bukan object/array
// bersarang) -- newsArticles/detailReasoning diringkas jadi teks, bukan JSON mentah.
const result = $json;
if (result.watchlist.length === 0) return [];

return result.watchlist.map((c, i) => ({
  json: {
    tanggal: result.generatedAt,
    rank: i + 1,
    symbol: c.symbol,
    nama_perusahaan: c.companyName,
    skor_akhir: Number(c.finalScore.toFixed(2)),
    skor_volume: Number(c.scores.volume.toFixed(1)),
    skor_broker_flow: Number(c.scores.brokerFlow.toFixed(1)),
    skor_news: Number(c.scores.news.toFixed(1)),
    skor_foreign_flow: Number(c.scores.foreignFlow.toFixed(1)),
    persen_perubahan_harga: Number(c.priceChangePct.toFixed(2)),
    volume_hari_ini: c.todayVolume,
    volume_ratio_thd_sma: Number(c.volumeRatio.toFixed(2)),
    broker_akumulasi_terbesar: c.brokerConcentration.topAccumulator
      ? c.brokerConcentration.topAccumulator.broker_code + ' (' + c.brokerConcentration.topAccumulator.netShare.toFixed(1) + '%)'
      : '-',
    net_foreign_inflow_idr: c.netForeignInflowIdr,
    jumlah_berita_relevan: c.relatedNews.length,
    alasan_singkat: c.simpleReasoning,
  },
}));
`.trim();

const newNodes = [
  {
    id: 'format-telegram',
    name: 'Format Telegram Message',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1820, 260],
    parameters: { mode: 'runOnceForAllItems', jsCode: CODE_FORMAT_TELEGRAM },
  },
  {
    id: 'send-telegram',
    name: 'Send Telegram Message',
    type: 'n8n-nodes-base.telegram',
    typeVersion: 1.2,
    position: [2080, 260],
    // onError: continueRegularOutput -- kegagalan kirim Telegram (mis. rate limit, chat_id
    // invalid) TIDAK BOLEH menggagalkan logging Google Sheets di cabang sebelah (lihat
    // komentar file ini soal pelajaran Tahap 2).
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'message',
      operation: 'sendMessage',
      chatId: TELEGRAM_CHAT_ID,
      text: '={{ $json.text }}',
      additionalFields: {},
    },
    credentials: { telegramApi: TELEGRAM_CRED },
  },
  {
    id: 'prepare-sheet-rows',
    name: 'Prepare Sheet Rows',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1820, 620],
    parameters: { mode: 'runOnceForAllItems', jsCode: CODE_PREPARE_SHEET_ROWS },
  },
  {
    id: 'log-to-sheets',
    name: 'Log Watchlist to Google Sheets',
    type: 'n8n-nodes-base.googleSheets',
    typeVersion: 3,
    position: [2080, 620],
    onError: 'continueRegularOutput',
    parameters: {
      authentication: 'serviceAccount',
      resource: 'sheet',
      operation: 'append',
      documentId: { __rl: true, mode: 'id', value: GOOGLE_SHEETS_ID },
      sheetName: { __rl: true, mode: 'name', value: 'Sheet1' },
      dataMode: 'autoMapInputData',
      options: {},
    },
    credentials: { googleApi: GOOGLE_CRED },
  },
  {
    id: 'sticky-status-4',
    name: 'Sticky Note 4',
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position: [1780, 800],
    parameters: {
      width: 520,
      height: 200,
      content:
        '## Status Tahap 4\n\n' +
        '**Selesai:** delivery Telegram (mode simple + link Sheet + disclaimer) dan logging ' +
        'Google Sheets (1 baris per saham watchlist), berjalan paralel & independen.\n\n' +
        'chatId Telegram ditulis literal di parameter node (lihat deploy-stage4-workflow.js) -- ' +
        'kalau chat tujuan berubah, edit TELEGRAM_CHAT_ID di script itu lalu redeploy.\n\n' +
        'PIPELINE LENGKAP: Tahap 1-4 semua sudah tersambung dari Schedule Trigger.',
    },
  },
];

const newConnections = {
  'Score Candidates': {
    main: [
      [
        { node: 'Format Telegram Message', type: 'main', index: 0 },
        { node: 'Prepare Sheet Rows', type: 'main', index: 0 },
      ],
    ],
  },
  'Format Telegram Message': {
    main: [[{ node: 'Send Telegram Message', type: 'main', index: 0 }]],
  },
  'Prepare Sheet Rows': {
    main: [[{ node: 'Log Watchlist to Google Sheets', type: 'main', index: 0 }]],
  },
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { data } = await listWorkflows();
  const existing = data.find((w) => OLD_NAMES.includes(w.name) || w.name === NAME);
  if (!existing) {
    console.error('Workflow Tahap 1/2/3 tidak ditemukan. Jalankan dulu deploy-stage1/2/3-workflow.js.');
    process.exit(1);
  }

  const full = await getWorkflow(existing.id);

  const nodesUpdated = full.nodes
    .filter((n) => !newNodes.some((nn) => nn.name === n.name))
    .concat(newNodes);

  const mergedConnections = { ...full.connections, ...newConnections };

  const payload = { name: NAME, nodes: nodesUpdated, connections: mergedConnections, settings: full.settings };
  const updated = await updateWorkflow(existing.id, payload);
  console.log(`Workflow diupdate: "${updated.name}" (id=${updated.id})`);
  console.log(`Total node sekarang: ${updated.nodes.length}`);
  console.log(`Buka di: http://localhost:5678/workflow/${updated.id}`);
}
