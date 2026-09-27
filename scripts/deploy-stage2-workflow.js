#!/usr/bin/env node
/**
 * Menambahkan node Tahap 2 (enrichment per kandidat) ke workflow yang sudah dibuat
 * scripts/deploy-stage1-workflow.js — TIDAK membuat workflow baru, meng-update yang ada
 * (dicari by name, fallback ke nama lama kalau sudah pernah di-rename skrip ini sebelumnya).
 *
 * Pola loop: SplitInBatches ("Loop Over Items", batchSize=1) memproses SATU kandidat per
 * iterasi. Di dalam satu iterasi, 3 panggilan HTTP (daily/broker-summary/foreign-flow) jalan
 * untuk kandidat itu SAJA, supaya masalah "Daily Transaction Data mengembalikan array lalu
 * dipecah n8n jadi banyak item" (lihat Sticky Note Tahap 1 & docs/API_FINDINGS.md) tidak
 * bercampur antar kandidat — di dalam satu iterasi loop, hanya ada 1 kandidat yang "in-flight".
 *
 * News SENGAJA di luar loop (satu panggilan untuk SEMUA kandidat sekaligus, symbols dipisah
 * koma) — jangan pernah dipindah ke dalam loop, lihat config/sectors-endpoints.js.
 *
 * Referensi silang antar node pakai $('Nama Node') alih-alih Merge node, konsisten dengan
 * gaya yang sudah dipakai di CODE_NORMALIZE (deploy-stage1-workflow.js).
 *
 * PENTING soal tanggal (ditemukan lewat test-execute nyata, 27 Sep 2026): seluruh parameter
 * start/end di bawah pakai $now.setZone('utc'), BUKAN 'Asia/Jakarta'. API Sectors memvalidasi
 * "end date cannot be in the future" memakai referensi tanggal UTC, sedangkan di jam
 * 00:00-07:00 WIB tanggal kalender WIB sudah maju sehari lebih dulu dari UTC -- pakai WIB di
 * jam segitu bikin request ditolak 400. Sama seperti bug yang ditemukan & diperbaiki di
 * deploy-stage1-workflow.js (node "Fetch Most Traded Stocks"), dan konsisten dengan
 * lastTradingDay()/shiftDate() di config/sectors-endpoints.js yang memang sudah UTC dari awal.
 *
 * Syarat: sudah pernah jalankan node scripts/deploy-stage1-workflow.js sekali.
 * Jalankan: node scripts/deploy-stage2-workflow.js
 */
import { listWorkflows, getWorkflow, updateWorkflow } from './n8n-client.js';

const SECTORS_CRED = { id: 'TRiYGsteCGY1VLbn', name: 'Sectors API - Header Auth' };
const OLD_NAME = 'Sectors Daily Watchlist - Stage 1 Fetch Kandidat';
const NEW_NAME = 'Sectors Daily Watchlist - Stage 1+2 Fetch & Enrichment';

const CODE_COMBINE_ENRICHMENT = `
// Menggabungkan hasil 3 panggilan enrichment (daily/broker-summary/foreign-flow) untuk SATU
// kandidat (iterasi loop saat ini) menjadi satu object CandidateRawData persis seperti kontrak
// scoreCandidate() di src/scoring/index.js — supaya nanti tinggal disalin sebagai input scoring
// Code node tanpa perlu mapping ulang field.
//
// Node ini hanya punya SATU koneksi masuk nyata (dari "Fetch Foreign Flow"); dua sumber data
// lain diambil via $('Nama Node') karena keduanya jalan sebagai cabang paralel tanpa koneksi
// keluar langsung ke sini (pola yang sama dipakai CODE_NORMALIZE di Tahap 1).
//
// PENTING (ditemukan lewat test-execute nyata, 27 Sep 2026): pakai .first(), BUKAN .item, untuk
// node yang tidak ada jalur koneksi langsung ke sini ("Aggregate Daily History", "Fetch Broker
// Summary") -- n8n perlu jalur koneksi nyata untuk menelusuri pairedItem saat memakai .item,
// dan gagal dengan error "No path back to referenced node" kalau jalurnya tidak ada. .first()
// tidak butuh itu, aman dipakai di sini karena tiap node tsb pasti menghasilkan TEPAT 1 item
// per iterasi loop (batchSize=1).

const candidate = $('Loop Over Candidates').first().json;
const dailyHistory = ($('Aggregate Daily History').first().json.dailyHistory || [])
  .sort((a, b) => String(a.date).localeCompare(String(b.date))); // pastikan lama -> baru (SCORING_LOGIC.md §2.1)
const brokerResp = $('Fetch Broker Summary').first().json;
const foreignResp = $json; // input langsung node ini = output "Fetch Foreign Flow"

return [{
  json: {
    symbol: candidate.symbol,
    companyName: candidate.companyName,
    dailyHistory,
    brokerSummaryByDate: brokerResp.data || [],
    foreignFlowHistory: foreignResp.data || [],
  },
}];
`.trim();

const CODE_COLLECT_SYMBOLS = `
// News di-batch: SATU panggilan untuk SELURUH kandidat (parameter symbols dipisah koma),
// bukan satu panggilan per kandidat -- lihat config/sectors-endpoints.js & docs/API_FINDINGS.md
// §1.2. Node Code ini menggabungkan seluruh simbol jadi satu string SEBELUM node HTTP Request
// di bawah, supaya node itu hanya menerima 1 item dan jalan tepat SEKALI.
//
// PENTING (ditemukan lewat test-execute nyata, 27 Sep 2026): dipasang setelah output "done"
// Loop Over Candidates, memakai koneksi nyata (bukan referensi $()) -- cabang paralel yang
// disambung lewat $() saja TIDAK terjamin urutan eksekusinya di n8n. "items" di sini = 20
// kandidat hasil akumulasi loop, mengalir lewat koneksi asli dari output "done", BUKAN dari
// $('Combine Candidate Enrichment').all() -- percobaan pertama pakai .all() ternyata HANYA
// mengembalikan hasil run TERAKHIR dari node di dalam loop (bukan akumulasi semua iterasi),
// beda dari ekspektasi. Output "done" milik SplitInBatches TERBUKTI benar mengakumulasi
// seluruh iterasi -- itu sebabnya harus diambil lewat koneksi nyata, bukan $().
const symbols = items.map((item) => item.json.symbol).join(',');
return [{ json: { symbols } }];
`.trim();

const CODE_ATTACH_NEWS = `
// SCORING_LOGIC.md §5 / kontrak CandidateRawData (src/scoring/index.js): newsArticles per
// kandidat harus SUDAH difilter hanya artikel yang symbols-nya memuat kandidat itu.
// docs/API_FINDINGS.md §1.4: field `+"`symbols`"+` pada artikel bisa kosong ([]) walau artikel
// jelas membahas satu perusahaan -- filter di sini tetap paling aman dibanding tanpa filter sama
// sekali, tapi kalau tim menemukan banyak berita relevan "hilang" karena symbols kosong, ini
// tempat pertama yang perlu direvisi (misal fallback cari nama perusahaan di title/body).
//
// BUG NYATA (ditemukan lewat test-execute nyata, 27 Sep 2026): symbols di artikel /v2/news/
// datang dengan sufiks ".JK" (mis. "BBCA.JK"), sedangkan candidate.symbol SUDAH di-stripSuffix
// sejak Normalize & Dedupe Candidates (mis. "BBCA"). Perbandingan exact-match tanpa strip
// sufiks di sisi artikel membuat newsArticles SELALU 0 untuk SEMUA kandidat walau artikel
// relevan ada -- bukan kasus "symbols kosong" dari docs/API_FINDINGS.md §1.4, melainkan bug
// murni di filter ini. stripSuffix() diduplikasi di sini (bukan diimpor) karena alasan yang
// sama seperti di CODE_NORMALIZE: Code node n8n tidak bisa import file lokal.
//
// Input node ini = hasil node Merge (mode combine/combineAll): tiap kandidat "dikawinkan"
// dengan SATU respons News yang sama (Cartesian 20 kandidat x 1 respons News = 20 item, semua
// field tergabung jadi satu object per item). Field results/pagination ikut nempel dari sisi
// News -- dibuang di sini supaya output akhir bersih, cuma berisi field CandidateRawData.
function stripSuffix(symbol) {
  return String(symbol || '').split('.')[0].toUpperCase();
}

return items.map((item) => {
  const { results, pagination, ...candidate } = item.json;
  const articles = results || [];
  const relatedNews = articles.filter(
    (a) => Array.isArray(a.symbols) && a.symbols.map(stripSuffix).includes(candidate.symbol),
  );
  return { json: { ...candidate, newsArticles: relatedNews } };
});
`.trim();

const newNodes = [
  {
    id: 'loop-candidates',
    name: 'Loop Over Candidates',
    type: 'n8n-nodes-base.splitInBatches',
    typeVersion: 3,
    position: [500, 40],
    parameters: { batchSize: 1, options: {} },
  },
  {
    id: 'fetch-daily-s2',
    name: 'Fetch Daily Transaction Data',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [820, -220],
    parameters: {
      method: 'GET',
      url: "={{ 'https://api.sectors.app/v2/daily/' + $json.symbol + '/' }}",
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          { name: 'start', value: "={{ $now.setZone('utc').minus({ days: 40 }).toFormat('yyyy-LL-dd') }}" },
          { name: 'end', value: "={{ $now.setZone('utc').toFormat('yyyy-LL-dd') }}" },
        ],
      },
      options: {},
    },
    credentials: { httpHeaderAuth: SECTORS_CRED },
  },
  {
    id: 'aggregate-daily',
    name: 'Aggregate Daily History',
    type: 'n8n-nodes-base.aggregate',
    typeVersion: 1,
    position: [1080, -220],
    parameters: { aggregate: 'aggregateAllItemData', destinationFieldName: 'dailyHistory' },
  },
  {
    id: 'fetch-broker-summary-s2',
    name: 'Fetch Broker Summary',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [820, 20],
    parameters: {
      method: 'GET',
      url: "={{ 'https://api.sectors.app/v2/broker-summary/' + $json.symbol + '/' }}",
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          // -30 hari kalender diminta, TAPI endpoint ini terbukti mengabaikan `start` di luar
          // ~11 hari bursa terakhir (docs/API_FINDINGS.md §1.3d) -- lookback efektif diatur
          // di config.normalisasi.brokerFlow.lookbackDays = 10, BUKAN di parameter request ini.
          { name: 'start', value: "={{ $now.setZone('utc').minus({ days: 30 }).toFormat('yyyy-LL-dd') }}" },
          { name: 'end', value: "={{ $now.setZone('utc').toFormat('yyyy-LL-dd') }}" },
        ],
      },
      options: {},
    },
    credentials: { httpHeaderAuth: SECTORS_CRED },
  },
  {
    id: 'fetch-foreign-flow-s2',
    name: 'Fetch Foreign Flow',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [820, 260],
    parameters: {
      method: 'GET',
      url: "={{ 'https://api.sectors.app/v2/foreign-flow/' + $json.symbol + '/' }}",
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          { name: 'start', value: "={{ $now.setZone('utc').minus({ days: 30 }).toFormat('yyyy-LL-dd') }}" },
          { name: 'end', value: "={{ $now.setZone('utc').toFormat('yyyy-LL-dd') }}" },
        ],
      },
      options: {},
    },
    credentials: { httpHeaderAuth: SECTORS_CRED },
  },
  {
    id: 'combine-enrichment',
    name: 'Combine Candidate Enrichment',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1080, 260],
    parameters: { mode: 'runOnceForAllItems', jsCode: CODE_COMBINE_ENRICHMENT },
  },
  {
    id: 'collect-symbols-news',
    name: 'Collect Symbols For News',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [500, 480],
    parameters: { mode: 'runOnceForAllItems', jsCode: CODE_COLLECT_SYMBOLS },
  },
  {
    id: 'fetch-news-s2',
    name: 'Fetch News Articles',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [820, 480],
    parameters: {
      method: 'GET',
      url: 'https://api.sectors.app/v2/news/',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          { name: 'start', value: "={{ $now.setZone('utc').minus({ days: 7 }).toFormat('yyyy-LL-dd') }}" },
          { name: 'end', value: "={{ $now.setZone('utc').toFormat('yyyy-LL-dd') }}" },
          { name: 'limit', value: '30' },
          { name: 'symbols', value: '={{ $json.symbols }}' },
        ],
      },
      options: {},
    },
    credentials: { httpHeaderAuth: SECTORS_CRED },
  },
  {
    id: 'merge-news-candidates',
    name: 'Merge News With Candidates',
    type: 'n8n-nodes-base.merge',
    typeVersion: 3,
    position: [1080, 480],
    // mode: combine + combineBy: combineAll = Cartesian product (dikonfirmasi dari source code
    // n8n terinstall lokal, dist/nodes/Merge/v3/actions/mode/combineAll.js, setelah tebakan
    // pertama "combinationMode: multiplex" TERBUKTI SALAH nama parameter -- error nyata dari
    // test-execute: "You need to define at least one pair of fields in Fields to Match",
    // tanda parameter tidak dikenali dan jatuh ke mode default combineByFields).
    // N kandidat x 1 respons News = N item gabungan, masing-masing berisi field kandidat +
    // field respons News (results/pagination) sekaligus -- cara resmi n8n untuk "tempelkan
    // satu nilai bersama ke banyak item", dipilih setelah percobaan $() cross-reference gagal
    // (lihat komentar CODE_COLLECT_SYMBOLS).
    parameters: { mode: 'combine', combineBy: 'combineAll' },
  },
  {
    id: 'attach-news',
    name: 'Attach Related News',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1300, 480],
    parameters: { mode: 'runOnceForAllItems', jsCode: CODE_ATTACH_NEWS },
  },
  {
    id: 'sticky-status-2',
    name: 'Sticky Note 2',
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position: [460, 660],
    parameters: {
      width: 760,
      height: 260,
      content:
        '## Status Tahap 2 (27 Sep 2026 — TERUJI end-to-end)\n\n' +
        '**Selesai & teruji lewat eksekusi nyata (webhook sementara, sudah dihapus):** ' +
        'enrichment 20 kandidat penuh (daily/broker-summary/foreign-flow lewat loop, news ' +
        'di-batch 1x untuk semua kandidat via node Merge combineAll), digabung jadi bentuk ' +
        'CandidateRawData persis kontrak scoreCandidate() di src/scoring/index.js.\n\n' +
        '**Bug nyata yang ditemukan & diperbaiki selama testing:** (1) timezone salah pakai ' +
        'Asia/Jakarta bukan UTC untuk parameter tanggal API, (2) most-traded tidak menangani ' +
        'hari libur bursa (kandidat symbol kosong), (3) $(\'Node\').all() TIDAK mengakumulasi ' +
        'seluruh iterasi loop -- harus lewat koneksi nyata (output "done" SplitInBatches), ' +
        '(4) filter newsArticles gagal karena field symbols artikel pakai sufiks .JK. Detail ' +
        'lengkap ada di komentar masing-masing Code node.\n\n' +
        '**Belum dibangun:** scoring engine (salin logic src/scoring/ jadi Code node), ' +
        'anti-noise filter, output ranking (mode simple/detail), delivery Telegram, ' +
        'logging Google Sheets.',
    },
  },
];

// PENTING (ditemukan lewat test-execute nyata, 27 Sep 2026): rantai linear di bawah
// menggantikan desain awal (loop + cabang News paralel dari Normalize & Dedupe Candidates).
// n8n TIDAK menjamin urutan eksekusi antar cabang paralel yang cuma dihubungkan lewat
// referensi $() tanpa koneksi nyata -- terbukti cabang News tidak pernah jalan sama sekali
// karena cabang loop "menguasai" antrean eksekusi sampai tuntas. Solusinya: News SEKARANG
// digantung sebagai kelanjutan NYATA dari output "done" loop (bukan sibling-nya), sehingga
// urutan Loop selesai -> Collect Symbols -> Fetch News -> Attach News dijamin oleh graph
// koneksi n8n sungguhan, bukan asumsi timing.
const newConnections = {
  'Normalize & Dedupe Candidates': {
    main: [[{ node: 'Loop Over Candidates', type: 'main', index: 0 }]],
  },
  'Loop Over Candidates': {
    main: [
      [
        // output 0 = "done" (setelah semua kandidat) -- fan-out ke DUA konsumen:
        // "Collect Symbols For News" (bikin query string) dan "Merge News With Candidates"
        // input 0 (dipakai lagi nanti setelah News selesai difetch, lihat Merge node di bawah).
        { node: 'Collect Symbols For News', type: 'main', index: 0 },
        { node: 'Merge News With Candidates', type: 'main', index: 0 },
      ],
      [
        // output 1 = "loop" (body iterasi, jalan sekali per kandidat)
        { node: 'Fetch Daily Transaction Data', type: 'main', index: 0 },
        { node: 'Fetch Broker Summary', type: 'main', index: 0 },
        { node: 'Fetch Foreign Flow', type: 'main', index: 0 },
      ],
    ],
  },
  'Fetch Daily Transaction Data': {
    main: [[{ node: 'Aggregate Daily History', type: 'main', index: 0 }]],
  },
  'Fetch Foreign Flow': {
    main: [[{ node: 'Combine Candidate Enrichment', type: 'main', index: 0 }]],
  },
  'Combine Candidate Enrichment': {
    main: [[{ node: 'Loop Over Candidates', type: 'main', index: 0 }]], // menutup loop
  },
  'Collect Symbols For News': {
    main: [[{ node: 'Fetch News Articles', type: 'main', index: 0 }]],
  },
  'Fetch News Articles': {
    // masuk ke INPUT KEDUA (index 1) node Merge -- Merge menunggu KEDUA input siap sebelum
    // jalan, jadi ini sekaligus menjamin urutan (News pasti sudah selesai) TANPA perlu asumsi
    // timing seperti percobaan sebelumnya.
    main: [[{ node: 'Merge News With Candidates', type: 'main', index: 1 }]],
  },
  'Merge News With Candidates': {
    main: [[{ node: 'Attach Related News', type: 'main', index: 0 }]],
  },
};

const { data } = await listWorkflows();
const existing = data.find((w) => w.name === OLD_NAME || w.name === NEW_NAME);
if (!existing) {
  console.error(`Workflow "${OLD_NAME}" tidak ditemukan. Jalankan dulu: node scripts/deploy-stage1-workflow.js`);
  process.exit(1);
}

const full = await getWorkflow(existing.id);

// BUG (ditemukan 27 Sep 2026, saat redeploy setelah fix timezone): versi lama di sini pakai
// `.concat(nodesToAdd)` yang HANYA berisi node yang namanya benar-benar baru. Pada re-run
// kedua, seluruh nama node Tahap 2 sudah ada dari deploy pertama -> nodesToAdd kosong ->
// seluruh node Tahap 2 lenyap (kefilter sebagai "versi lama") TANPA diganti versi baru,
// padahal connections{} masih mereferensikan nama-nama itu -> n8n menolak PUT dengan error
// "Connection source/target does not reference an existing node". Fix: concat ke `newNodes`
// (definisi TERBARU lengkap), bukan `nodesToAdd` (subset yang benar-benar baru saja).
const nodesUpdated = full.nodes
  .filter((n) => !newNodes.some((nn) => nn.name === n.name)) // buang versi lama kalau re-run script ini
  .concat(newNodes);

const mergedConnections = { ...full.connections, ...newConnections };

const payload = {
  name: NEW_NAME,
  nodes: nodesUpdated,
  connections: mergedConnections,
  settings: full.settings,
};

const updated = await updateWorkflow(existing.id, payload);
console.log(`Workflow diupdate: "${updated.name}" (id=${updated.id})`);
console.log(`Total node sekarang: ${updated.nodes.length}`);
console.log(`Buka di: http://localhost:5678/workflow/${updated.id}`);
