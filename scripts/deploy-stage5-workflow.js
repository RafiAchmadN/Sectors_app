#!/usr/bin/env node
/**
 * Menambahkan "Daily Market Brief" — perbandingan watchlist hari ini vs hari bursa sebelumnya
 * — ke workflow yang sudah dibuat deploy-stage1/2/3/4-workflow.js. TIDAK memakai LLM sama
 * sekali (keputusan tim 27 Sep 2026, lihat riwayat percakapan — sempat dipertimbangkan pakai
 * chatbot LLM tapi dibatalkan lagi, cukup perbandingan statistik murni dari data yang sudah
 * tersimpan di Google Sheets).
 *
 * Data hari sebelumnya diambil dari Google Sheets (log hasil run sebelumnya), BUKAN fetch
 * ulang/hitung ulang dari Sectors API — selain lebih murah, ini juga menjamin angka yang
 * dibandingkan konsisten dengan yang sudah pernah dikirim ke pengguna kemarin.
 *
 * Merombak sedikit graf Tahap 4: "Score Candidates" sekarang mengalir ke "Read Watchlist
 * History" -> "Compare With Yesterday" dulu, baru fan-out ke "Format Telegram Message" (versi
 * baru, menyertakan ringkasan perbandingan) dan "Prepare Sheet Rows" (logika tidak berubah).
 *
 * Syarat: sudah pernah jalankan deploy-stage1/2/3/4-workflow.js.
 * Jalankan: node scripts/deploy-stage5-workflow.js
 */
import { pathToFileURL } from 'node:url';
import { listWorkflows, getWorkflow, updateWorkflow } from './n8n-client.js';

const GOOGLE_CRED = { id: '3hTHgpu4eqmw5DlU', name: 'Google Service Account - Sectors Watchlist' };
const GOOGLE_SHEETS_ID = '1kjNB6fLkxeP0uvRxJ5SxqiKKXZ75QIUpdtcwSSx-X5o';

const NAME = 'Sectors Daily Watchlist - Stage 1+2+3+4+5 (Full Pipeline + Daily Brief)';
const OLD_NAMES = [
  'Sectors Daily Watchlist - Stage 1+2+3+4 (Full Pipeline)',
  'Sectors Daily Watchlist - Stage 1+2+3 Fetch, Enrichment & Scoring',
  'Sectors Daily Watchlist - Stage 1+2 Fetch & Enrichment',
  'Sectors Daily Watchlist - Stage 1 Fetch Kandidat',
];

export const CODE_COMPARE_YESTERDAY = `
// "Daily Market Brief" (27 Sep 2026, keputusan tim): bandingkan watchlist hari ini dengan hari
// BURSA sebelumnya (bukan strict kalender kemarin -- otomatis lompat akhir pekan/libur karena
// yang dipakai adalah tanggal run TERAKHIR yang benar-benar tercatat di Sheet, apapun itu).
// Murni agregasi statistik dari data yang SUDAH tersimpan, TIDAK ada LLM/AI sama sekali --
// keputusan eksplisit tim untuk tetap sejalan CLAUDE.md §3 (push otomatis satu arah, bukan
// chatbot interaktif).
const today = $('Score Candidates').first().json;
const todayDateStr = today.generatedAt.slice(0, 10); // YYYY-MM-DD

// Input langsung node ini = "Read Watchlist History" (seluruh baris yang pernah di-log).
// Kelompokkan per tanggal, buang baris hari ini sendiri (jaga-jaga kalau kebetulan sudah
// ke-log lebih dulu oleh eksekusi lain).
const byDate = {};
for (const item of items) {
  const row = item.json;
  const dateStr = String(row.tanggal || '').slice(0, 10);
  if (!dateStr || dateStr === todayDateStr) continue;
  if (!byDate[dateStr]) byDate[dateStr] = [];
  byDate[dateStr].push(row);
}

const previousDates = Object.keys(byDate).sort();
const lastDate = previousDates[previousDates.length - 1];
const previousRows = lastDate ? byDate[lastDate] : [];

let comparisonText;
let comparisonData = { hasPrevious: false };

if (!lastDate) {
  comparisonText = 'Belum ada data hari bursa sebelumnya untuk dibandingkan (kemungkinan ini run pertama).';
} else {
  const prevBySymbol = Object.fromEntries(previousRows.map((r) => [r.symbol, r]));
  const todaySymbols = new Set(today.watchlist.map((c) => c.symbol));

  const naik = [];
  const turun = [];
  const baru = [];
  const keluar = [];

  for (const c of today.watchlist) {
    const prev = prevBySymbol[c.symbol];
    if (!prev) {
      baru.push(c.symbol);
    } else {
      const delta = c.finalScore - prev.skor_akhir;
      if (delta > 0.5) naik.push(c.symbol + ' (+' + delta.toFixed(1) + ')');
      else if (delta < -0.5) turun.push(c.symbol + ' (' + delta.toFixed(1) + ')');
    }
  }
  for (const r of previousRows) {
    if (!todaySymbols.has(r.symbol)) keluar.push(r.symbol);
  }

  const avgToday = today.watchlist.length ? today.watchlist.reduce((a, c) => a + c.finalScore, 0) / today.watchlist.length : 0;
  const avgPrev = previousRows.length ? previousRows.reduce((a, r) => a + r.skor_akhir, 0) / previousRows.length : 0;
  const avgDelta = avgToday - avgPrev;
  const arahUmum = avgDelta > 1 ? 'menguat' : avgDelta < -1 ? 'melemah' : 'relatif stabil';

  const lines = [];
  lines.push('Dibanding hari bursa sebelumnya (' + lastDate + '), rata-rata skor watchlist ' + arahUmum + ' (' + avgPrev.toFixed(1) + ' -> ' + avgToday.toFixed(1) + ').');
  if (baru.length) lines.push('Baru masuk watchlist: ' + baru.join(', ') + '.');
  if (keluar.length) lines.push('Keluar dari watchlist: ' + keluar.join(', ') + '.');
  if (naik.length) lines.push('Skor naik: ' + naik.join(', ') + '.');
  if (turun.length) lines.push('Skor turun: ' + turun.join(', ') + '.');
  comparisonText = lines.join(' ');
  comparisonData = { hasPrevious: true, lastDate, avgToday, avgPrev, avgDelta, baru, keluar, naik, turun };
}

return [{ json: { ...today, comparisonText, comparisonData } }];
`.trim();

export const CODE_FORMAT_TELEGRAM_V2 = `
// SCORING_LOGIC.md §7 / CLAUDE.md §7: pesan Telegram harian mode simple + "Daily Market Brief"
// (perbandingan vs hari bursa sebelumnya, 27 Sep 2026) + link ke Google Sheet untuk mode detail
// + disclaimer wajib di SETIAP keluaran. Teks polos (tanpa parse_mode) SENGAJA dipilih --
// MarkdownV2 Telegram butuh escaping karakter khusus yang gampang salah dan bikin pesan gagal
// terkirim; teks polos lebih andal untuk workflow otonom.
const result = $json;
const tanggal = new Date(result.generatedAt).toLocaleDateString('id-ID', {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Jakarta',
});

const lines = [];
lines.push('📊 Sectors Daily Watchlist — ' + tanggal);
lines.push('');
lines.push('📈 Ringkasan: ' + result.comparisonText);
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

const newNodes = [
  {
    id: 'read-watchlist-history',
    name: 'Read Watchlist History',
    type: 'n8n-nodes-base.googleSheets',
    typeVersion: 3,
    position: [1560, 440],
    onError: 'continueRegularOutput', // kalau baca histori gagal, tetap lanjut (anggap tidak ada data pembanding) daripada gagal total
    parameters: {
      authentication: 'serviceAccount',
      resource: 'sheet',
      operation: 'read',
      documentId: { __rl: true, mode: 'id', value: GOOGLE_SHEETS_ID },
      sheetName: { __rl: true, mode: 'name', value: 'Sheet1' },
      options: {},
    },
    credentials: { googleApi: GOOGLE_CRED },
  },
  {
    id: 'compare-yesterday',
    name: 'Compare With Yesterday',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1560, 620],
    parameters: { mode: 'runOnceForAllItems', jsCode: CODE_COMPARE_YESTERDAY },
  },
  {
    // Timpa definisi lama "Format Telegram Message" (dari deploy-stage4) dengan versi yang
    // menyertakan comparisonText.
    id: 'format-telegram',
    name: 'Format Telegram Message',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1820, 260],
    parameters: { mode: 'runOnceForAllItems', jsCode: CODE_FORMAT_TELEGRAM_V2 },
  },
  {
    id: 'sticky-status-5',
    name: 'Sticky Note 5',
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position: [1520, 800],
    parameters: {
      width: 520,
      height: 180,
      content:
        '## Status Tahap 5 — Daily Market Brief\n\n' +
        '**Selesai:** perbandingan watchlist hari ini vs hari bursa sebelumnya (skor naik/turun, ' +
        'saham baru/keluar), murni statistik dari Google Sheets. TIDAK pakai LLM/chatbot -- ' +
        'keputusan tim 27 Sep 2026, tetap sejalan CLAUDE.md §3 (push satu arah).',
    },
  },
];

const newConnections = {
  'Score Candidates': {
    main: [[{ node: 'Read Watchlist History', type: 'main', index: 0 }]],
  },
  'Read Watchlist History': {
    main: [[{ node: 'Compare With Yesterday', type: 'main', index: 0 }]],
  },
  'Compare With Yesterday': {
    main: [
      [
        { node: 'Format Telegram Message', type: 'main', index: 0 },
        { node: 'Prepare Sheet Rows', type: 'main', index: 0 },
      ],
    ],
  },
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { data } = await listWorkflows();
  const existing = data.find((w) => OLD_NAMES.includes(w.name) || w.name === NAME);
  if (!existing) {
    console.error('Workflow Tahap 1-4 tidak ditemukan. Jalankan dulu deploy-stage1/2/3/4-workflow.js.');
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
