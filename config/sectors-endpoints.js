/**
 * Katalog endpoint Sectors Financial API v2 yang dipakai workflow.
 * Satu sumber kebenaran: dipakai oleh scripts/verify-api.js dan nanti oleh node HTTP Request di n8n.
 *
 * PENTING: API v1 sudah dimatikan sejak 2026-05-11 dan seluruh /v1/* mengembalikan HTTP 410 Gone.
 * Seluruh URL di bawah wajib v2.
 *
 * Auth: header `Authorization: <API_KEY>` (raw, tanpa prefix "Bearer").
 * Biaya: umumnya 1 credit per response 2xx; 404 tetap menagih 1 credit; 429 gratis.
 *   Pengecualian: /companies/top-changes/ menagih 1 credit per (classification x period),
 *   sehingga default (2 classification x 5 period) = 10 credit per panggilan.
 */

export const BASE_URL = 'https://api.sectors.app/v2';

/** Simbol dari API berformat "BBCA.JK". Workflow memakai kode polos "BBCA". */
export const stripSuffix = (symbol) => String(symbol || '').split('.')[0].toUpperCase();

/**
 * Tahap 1 = penjaringan kandidat (tidak butuh daftar simbol).
 * Tahap 2 = enrichment per simbol kandidat.
 */
export const ENDPOINTS = {
  // ---------- TAHAP 1: kandidat ----------
  topChanges: {
    stage: 1,
    label: 'Top Company Movers',
    path: () => '/companies/top-changes/',
    /**
     * Sengaja dibatasi 1 period + 1 classification agar biaya 1 credit, bukan 10.
     * min_mcap_billion sekaligus berfungsi sebagai anti-noise filter tahap awal
     * (CLAUDE.md §5 "Sebelum Output Ranking") — nilainya diambil dari config scoring.
     */
    defaultQuery: { n_stock: 10, classifications: 'top_gainers', periods: '1d', min_mcap_billion: 5000 },
    creditCost: (q) =>
      String(q.classifications || 'top_gainers,top_losers').split(',').length *
      String(q.periods || '1d,7d,14d,30d,365d').split(',').length,
    // Bentuk (VERIFIED 26 Sep 2026, npm run verify:api): { top_gainers: { "1d": [
    //   {name, symbol, price_change, last_close_price, latest_close_date} ] } }
    // PENTING: field nama perusahaan di endpoint ini adalah `name`, BUKAN `company_name`
    // seperti di most-traded — dua endpoint API ini tidak konsisten penamaannya.
    expectShape: 'object',
    probeSampleFields: ['symbol', 'name', 'price_change', 'last_close_price', 'latest_close_date'],
  },

  mostTraded: {
    stage: 1,
    label: 'Most Traded Stocks',
    path: () => '/most-traded/',
    // adjusted=true meranking pakai volume x harga, bukan volume mentah -> lebih tahan saham gocap.
    defaultQuery: ({ date }) => ({ start: date, end: date, n_stock: 10, adjusted: true }),
    // VERIFIED 26 Sep 2026: header limit-consumption menunjukkan endpoint ini menagih 2 credit,
    // BUKAN 1 seperti asumsi awal dari dokumentasi ("most cost 1"). Lihat docs/API_FINDINGS.md §1.2.
    creditCost: () => 2,
    // Bentuk (VERIFIED): { "YYYY-MM-DD": [ {symbol, company_name, volume, price} ] }
    // Field nama perusahaan di sini adalah `company_name` (beda dari top-changes, lihat di atas).
    expectShape: 'object',
    probeSampleFields: ['symbol', 'company_name', 'volume', 'price'],
  },


  // ---------- TAHAP 2: enrichment per simbol ----------
  daily: {
    stage: 2,
    label: 'Daily Transaction Data',
    path: ({ symbol }) => `/daily/${symbol}/`,
    // Butuh histori untuk SMA volume (SCORING_LOGIC §2.1). Rentang maksimum API = 90 hari.
    defaultQuery: ({ date, lookbackDays = 40 }) => ({ start: shiftDate(date, -lookbackDays), end: date }),
    creditCost: () => 1,
    // Bentuk: [ {symbol, date, close, open, high, low, volume, market_cap} ]
    expectShape: 'array',
    probeSampleFields: ['symbol', 'date', 'close', 'open', 'high', 'low', 'volume', 'market_cap'],
  },

  brokerSummary: {
    stage: 2,
    label: 'Broker Activity Per Symbol',
    path: ({ symbol }) => `/broker-summary/${symbol}/`,
    defaultQuery: ({ date }) => ({ start: shiftDate(date, -5), end: date }),
    creditCost: () => 1,
    // Bentuk: { symbol, start, end, data: [ { date, summary: [ {broker_code, bfreq, blot, bval,
    //   bavg_per_share, sfreq, slot, sval, savg_per_share, nlot, nval, navg_per_share,
    //   f_bfreq, f_blot, f_bval, f_bavg_per_share, d_bavg_per_share,
    //   f_sfreq, f_slot, f_sval, f_savg_per_share, d_savg_per_share} ] } ] }
    // Key array per-broker adalah `summary`, BUKAN `brokers`. Field berawalan f_ = porsi asing
    // (foreign) dari buy/sell tersebut, null jika tidak ada porsi asing pada baris itu.
    expectShape: 'object',
    probeSampleFields: ['broker_code', 'bval', 'sval', 'nval', 'blot', 'slot', 'nlot'],
  },

  brokerActivityTop: {
    stage: 2,
    label: 'Top Accumulations and Distributions Per Broker',
    path: ({ brokerCode }) => `/broker-activity/${brokerCode}/top/`,
    defaultQuery: ({ date }) => ({ start: shiftDate(date, -14), end: date }),
    // VERIFIED 26 Sep 2026: header limit-consumption = 2, BUKAN 1. Lihat docs/API_FINDINGS.md §1.2.
    creditCost: () => 2,
    // Bentuk (VERIFIED): { broker_code, start, end, foreign: boolean,
    //   top_accumulations: [ {rank, symbol, net_idr, buy_idr, sell_idr,
    //     foreign_net_idr, foreign_buy_idr, foreign_sell_idr} ], top_distributions: [...] }
    // Field foreign_* TIDAK ADA di dokumentasi publik yang dibaca sebelumnya — porsi asing
    // dari akumulasi/distribusi broker ini, sinyal tambahan yang bisa diperiksa tim.
    expectShape: 'object',
    probeSampleFields: ['rank', 'symbol', 'net_idr', 'buy_idr', 'sell_idr', 'foreign_net_idr'],
  },

  foreignFlow: {
    stage: 2,
    label: 'Daily Net Foreign Inflow',
    path: ({ symbol }) => `/foreign-flow/${symbol}/`,
    defaultQuery: ({ date, lookbackDays = 30 }) => ({ start: shiftDate(date, -lookbackDays), end: date }),
    creditCost: () => 1, // belum terverifikasi via header (server tidak mengirim limit-consumption di sini)
    // Bentuk (VERIFIED): { symbol, start, end, data: [ {date, net_foreign_inflow,
    //   foreign_buy_idr, foreign_sell_idr, foreign_share} ] }
    // Field foreign_buy_idr/foreign_sell_idr/foreign_share juga tidak ada di dokumentasi publik —
    // foreign_share (0-1) bisa jadi sinyal tambahan selain net_foreign_inflow mentah.
    expectShape: 'object',
    probeSampleFields: ['date', 'net_foreign_inflow', 'foreign_share'],
  },

  news: {
    stage: 2,
    label: 'News Articles',
    path: () => '/news/',
    // limit maksimum 30 per halaman.
    /**
     * PENTING untuk hemat credit: parameter `symbols` menerima daftar dipisah koma
     * (`BBCA,BBRI,GOTO`), sehingga berita SELURUH kandidat diambil dalam SATU panggilan
     * = 1 credit, bukan 1 credit per kandidat. Jangan pernah memanggil endpoint ini
     * di dalam loop per simbol.
     */
    batched: true,
    defaultQuery: ({ date, symbols = [] }) => ({
      start: shiftDate(date, -7),
      end: date,
      limit: 30,
      ...(symbols.length ? { symbols: symbols.join(',') } : {}),
    }),
    creditCost: () => 1,
    // Bentuk: { results: [ {title, body, source, thumbnail, timestamp, sector, sub_sector[], tags[], symbols[], dimension{}} ] }
    expectShape: 'object',
    probeSampleFields: ['title', 'timestamp', 'source', 'tags', 'symbols', 'sub_sector', 'dimension'],
  },
};

/** Geser tanggal YYYY-MM-DD sebanyak n hari kalender. */
export function shiftDate(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Hari bursa terakhir secara kasar: mundur dari tanggal acuan sampai bukan Sabtu/Minggu.
 *  Catatan: belum memperhitungkan hari libur bursa IDX — ditangani di workflow lewat
 *  pengecekan "response kosong -> mundur satu hari". */
export function lastTradingDay(from = new Date()) {
  const d = new Date(from);
  d.setUTCHours(0, 0, 0, 0);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Anggaran credit. Hibah hackathon = 1.000 credit per tim, TOTAL, dan hangus saat event selesai.
 * Angka ini yang membatasi jumlah kandidat per hari, bukan sekadar preferensi produk.
 *
 * Biaya satu siklus harian (VERIFIED 26 Sep 2026 lewat header `limit-consumption`,
 * lihat docs/API_FINDINGS.md §1.2 — sebagian endpoint lebih mahal dari asumsi awal):
 *   tahap 1  : top-changes (1) + most-traded (2)                          = 3
 *   tahap 2  : (daily(?) + broker-summary(?) + foreign-flow(?)) x kandidat = 3n (BELUM terverifikasi
 *              via header untuk 3 endpoint ini — server tidak mengirim limit-consumption di
 *              responsenya. Diasumsikan 1 masing-masing sampai terbukti sebaliknya.)
 *   berita   : SATU panggilan untuk semua kandidat sekaligus               = 1 (belum terverifikasi)
 *   broker   : broker-activity/{code}/top untuk beberapa broker teratas    = 2 x b
 */
export function estimateDailyCredits(nCandidates, nBrokers = 2) {
  return 3 + 3 * nCandidates + 1 + 2 * nBrokers;
}

/**
 * Pengembangan dan debugging workflow TIDAK boleh memakai API langsung berulang kali.
 * Pakai response mentah hasil `npm run verify:api` di out/api-samples/ sebagai fixture.
 * Satu kali verifikasi = 7 credit; iterasi scoring di atas fixture = 0 credit.
 */
export const FIXTURE_DIR = 'out/api-samples';
