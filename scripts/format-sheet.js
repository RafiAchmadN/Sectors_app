#!/usr/bin/env node
/**
 * Setup SEKALI SAJA (bukan bagian pipeline harian n8n): warnai header per kategori kolom di
 * sheet data, freeze baris header, dan tambah tab "Keterangan" berisi interpretasi tiap label.
 *
 * Kenapa skrip terpisah, bukan node n8n: node Google Sheets bawaan n8n (resource "sheet")
 * cuma punya operasi append/read/update/clear/delete data -- TIDAK ada operasi styling/warna.
 * Itu cuma bisa lewat Google Sheets API `spreadsheets.batchUpdate` mentah. Karena formatting
 * cuma perlu di-set SEKALI (bukan tiap run harian), lebih masuk akal jadi skrip manual
 * daripada dipaksakan ke workflow otomatis.
 *
 * TIDAK memakai package googleapis/google-auth-library (proyek ini sengaja 0 dependency
 * eksternal) -- JWT service account ditandatangani manual pakai node:crypto (RS256), pola
 * yang sama seperti yang n8n lakukan secara internal untuk credential googleApi.
 *
 * TIDAK memakai/mengurangi kuota Sectors API sama sekali -- ini murni panggilan Google
 * Sheets API pakai service account yang sama dengan yang sudah dipakai n8n.
 *
 * Jalankan: node scripts/format-sheet.js
 */
import { readFileSync, existsSync } from 'node:fs';
import { createSign } from 'node:crypto';

function loadDotEnv(file = '.env') {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadDotEnv();

const SHEET_ID = process.env.GOOGLE_SHEETS_ID;
if (!SHEET_ID) {
  console.error('GOOGLE_SHEETS_ID belum diisi di .env');
  process.exit(1);
}
const gsa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccessToken() {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: gsa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const unsigned = base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(claim));
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(gsa.private_key).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const jwt = unsigned + '.' + signature;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error('Gagal ambil access token Google: ' + JSON.stringify(body));
  return body.access_token;
}

async function sheetsApi(token, path, opts = {}, query = {}) {
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`Sheets API ${opts.method || 'GET'} ${url} -> ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

// Urutan kolom PERSIS sesuai CODE_PREPARE_SHEET_ROWS_V2 di deploy-stage6-workflow.js --
// kalau kolomnya berubah di sana, sinkronkan juga di sini.
const COLUMNS = [
  { name: 'tanggal', category: 'identitas', desc: 'Waktu run watchlist dibuat (ISO timestamp, UTC)' },
  { name: 'rank', category: 'identitas', desc: 'Peringkat dalam watchlist hari itu (1 = skor akhir tertinggi)' },
  { name: 'symbol', category: 'identitas', desc: 'Kode saham IDX (sudah dibuang sufiks .JK)' },
  { name: 'nama_perusahaan', category: 'identitas', desc: 'Nama resmi perusahaan' },
  { name: 'skor_akhir', category: 'skor', desc: 'Skor gabungan berbobot 0-100 (SCORING_LOGIC.md §4): 35% broker flow + 30% volume + 20% foreign flow + 15% news' },
  { name: 'skor_volume', category: 'skor', desc: 'Skor volume transaksi ternormalisasi 0-100 terhadap histori 20 hari bursa saham ini sendiri (§1-2.1)' },
  { name: 'skor_broker_flow', category: 'skor', desc: 'Skor konsentrasi aktivitas broker ternormalisasi 0-100 (§3)' },
  { name: 'skor_news', category: 'skor', desc: 'Skor sentimen berita ternormalisasi 0-100, 50 = netral/tidak ada berita (§5)' },
  { name: 'skor_foreign_flow', category: 'skor', desc: 'Skor aliran dana asing ternormalisasi 0-100' },
  { name: 'persen_perubahan_harga', category: 'data_mentah', desc: 'Perubahan harga close vs open hari itu, dalam persen (§2.2)' },
  { name: 'volume_hari_ini', category: 'data_mentah', desc: 'Volume transaksi mentah hari itu (lembar saham)' },
  { name: 'volume_ratio_thd_sma', category: 'data_mentah', desc: 'Volume hari ini dibagi rata-rata (SMA) 20 hari bursa -- di atas 1.5x dianggap signifikan (§2.1)' },
  { name: 'broker_akumulasi_terbesar', category: 'data_mentah', desc: 'Kode broker dengan net beli terbesar hari itu + persentase dari total aktivitas broker' },
  { name: 'net_foreign_inflow_idr', category: 'data_mentah', desc: 'Aliran dana asing bersih hari itu dalam Rupiah (positif = net masuk/inflow)' },
  { name: 'jumlah_berita_relevan', category: 'data_mentah', desc: 'Jumlah artikel berita relevan (dalam 7 hari terakhir) yang dipakai menghitung skor_news' },
  { name: 'anomali_volume', category: 'anomali', desc: 'TRUE jika volume hari ini signifikan di atas kebiasaan saham ini (rasio > 1.5x, §3b)' },
  { name: 'anomali_broker_flow', category: 'anomali', desc: 'TRUE jika aktivitas broker hari ini menyimpang jauh (|Z| >= 1.5) dari pola historis saham ini SENDIRI (§3b) -- bukan threshold sama rata untuk semua saham' },
  { name: 'anomali_broker_flow_zscore', category: 'anomali', desc: 'Nilai Z-score aktivitas broker: berapa standar deviasi hari ini menyimpang dari rata-rata historis saham ini' },
  { name: 'anomali_foreign_flow', category: 'anomali', desc: 'TRUE jika aliran dana asing hari ini menyimpang jauh (|Z| >= 1.5) dari pola historis saham ini sendiri (§3b)' },
  { name: 'anomali_foreign_flow_zscore', category: 'anomali', desc: 'Nilai Z-score aliran dana asing' },
  { name: 'alasan_singkat', category: 'reasoning', desc: 'Kalimat ringkas alasan saham ini masuk watchlist -- sama persis dengan yang dikirim ke Telegram (mode simple, §7)' },
];

const CATEGORY_COLORS = {
  identitas: { background: { red: 0.85, green: 0.85, blue: 0.85 }, text: { red: 0, green: 0, blue: 0 } },
  skor: { background: { red: 0.71, green: 0.84, blue: 0.93 }, text: { red: 0, green: 0, blue: 0 } },
  data_mentah: { background: { red: 0.78, green: 0.94, blue: 0.78 }, text: { red: 0, green: 0, blue: 0 } },
  anomali: { background: { red: 0.96, green: 0.6, blue: 0.4 }, text: { red: 0, green: 0, blue: 0 } },
  reasoning: { background: { red: 1, green: 0.94, blue: 0.6 }, text: { red: 0, green: 0, blue: 0 } },
};
const CATEGORY_LABELS = {
  identitas: 'Identitas',
  skor: 'Skor (0-100)',
  data_mentah: 'Data Mentah',
  anomali: 'Deteksi Anomali',
  reasoning: 'Reasoning',
};

function headerColorRequests(sheetId) {
  const requests = [];
  let start = 0;
  while (start < COLUMNS.length) {
    const category = COLUMNS[start].category;
    let end = start;
    while (end < COLUMNS.length && COLUMNS[end].category === category) end++;
    const color = CATEGORY_COLORS[category];
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: start, endColumnIndex: end },
        cell: {
          userEnteredFormat: {
            backgroundColor: color.background,
            textFormat: { bold: true, foregroundColor: color.text },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat)',
      },
    });
    start = end;
  }
  return requests;
}

async function main() {
  const token = await getAccessToken();

  console.log('Mengambil metadata spreadsheet...');
  const meta = await sheetsApi(token, '', {}, { fields: 'sheets.properties' });
  const sheet1 = meta.sheets.find((s) => s.properties.title === 'Sheet1');
  if (!sheet1) throw new Error('Tab "Sheet1" tidak ditemukan di spreadsheet ini.');
  const sheet1Id = sheet1.properties.sheetId;

  const existingKeterangan = meta.sheets.find((s) => s.properties.title === 'Keterangan');

  console.log('Menyusun & mengirim batchUpdate (warna header + freeze row + tab Keterangan)...');
  const requests = [
    ...headerColorRequests(sheet1Id),
    { updateSheetProperties: { properties: { sheetId: sheet1Id, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
  ];
  if (!existingKeterangan) {
    requests.push({ addSheet: { properties: { title: 'Keterangan', gridProperties: { columnCount: 3, rowCount: COLUMNS.length + 3 } } } });
  }
  const batchResult = await sheetsApi(token, ':batchUpdate', { method: 'POST', body: JSON.stringify({ requests }) });

  const keteranganSheetId = existingKeterangan
    ? existingKeterangan.properties.sheetId
    : batchResult.replies.find((r) => r.addSheet)?.addSheet.properties.sheetId;

  console.log('Mengisi konten tab Keterangan...');
  const rows = [
    ['Kolom', 'Kategori', 'Interpretasi'],
    ...COLUMNS.map((c) => [c.name, CATEGORY_LABELS[c.category], c.desc]),
    [],
    ['Disclaimer', '', 'Seluruh data di sheet ini adalah alat bantu analisis pasar, BUKAN rekomendasi investasi atau nasihat keuangan. Keputusan investasi sepenuhnya tanggung jawab pengguna sendiri.'],
  ];
  await sheetsApi(
    token,
    `/values/Keterangan!A1:C${rows.length}`,
    { method: 'PUT', body: JSON.stringify({ values: rows }) },
    { valueInputOption: 'USER_ENTERED' },
  );

  console.log('Merapikan tampilan tab Keterangan (warna header, lebar kolom, wrap teks)...');
  await sheetsApi(token, ':batchUpdate', {
    method: 'POST',
    body: JSON.stringify({
      requests: [
        {
          repeatCell: {
            range: { sheetId: keteranganSheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 3 },
            cell: { userEnteredFormat: { backgroundColor: { red: 0.2, green: 0.2, blue: 0.2 }, textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } } } },
            fields: 'userEnteredFormat(backgroundColor,textFormat)',
          },
        },
        {
          repeatCell: {
            range: { sheetId: keteranganSheetId, startRowIndex: 1, endRowIndex: rows.length, startColumnIndex: 0, endColumnIndex: 3 },
            cell: { userEnteredFormat: { wrapStrategy: 'WRAP', verticalAlignment: 'TOP' } },
            fields: 'userEnteredFormat(wrapStrategy,verticalAlignment)',
          },
        },
        { updateDimensionProperties: { range: { sheetId: keteranganSheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 220 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId: keteranganSheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 140 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId: keteranganSheetId, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 }, properties: { pixelSize: 500 }, fields: 'pixelSize' } },
        { updateSheetProperties: { properties: { sheetId: keteranganSheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
      ],
    }),
  });

  console.log('\nSelesai. Buka: https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/edit');
}

main().catch((e) => {
  console.error('GAGAL:', e.message);
  process.exit(1);
});
