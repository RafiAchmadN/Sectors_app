/**
 * SCORING_LOGIC.md §3 — anti-noise filter sebelum output ranking:
 * "saham dengan market cap di bawah nilai tertentu dikecualikan dari watchlist."
 *
 * CLAUDE.md §5 menegaskan ini dijalankan SEBELUM output ranking, bukan sebagai
 * pengganti filter min_mcap_billion di parameter top-changes (yang hanya berlaku
 * untuk kandidat dari jalur top-changes, bukan dari most-traded — lihat
 * docs/API_FINDINGS.md §1.5). Filter ini jadi jaring terakhir yang berlaku untuk
 * SEMUA kandidat apapun asalnya.
 *
 * PERHATIAN SATUAN: /v2/daily/ mengembalikan market_cap dalam IDR PENUH, sedangkan
 * config.antiNoiseFilter.minMarketCapBillionIdr dalam MILIAR IDR (konsisten dengan
 * parameter min_mcap_billion di API). Konversi dilakukan di dalam fungsi ini supaya
 * caller tidak perlu ingat mengalikan/membagi 1 miliar sendiri.
 */

/**
 * @param {number} marketCapIdr - field `market_cap` dari /v2/daily/, satuan IDR penuh
 * @param {number} minMarketCapBillionIdr - config.antiNoiseFilter.minMarketCapBillionIdr
 * @returns {boolean} true jika LOLOS filter (boleh masuk watchlist)
 */
export function passesMarketCapFilter(marketCapIdr, minMarketCapBillionIdr) {
  const minIdr = minMarketCapBillionIdr * 1_000_000_000;
  return marketCapIdr >= minIdr;
}

/**
 * Saring array kandidat, buang yang tidak lolos filter market cap.
 * @param {Array<{market_cap: number}>} candidates
 * @param {number} minMarketCapBillionIdr
 */
export function filterCandidatesByMarketCap(candidates, minMarketCapBillionIdr) {
  return candidates.filter((c) => passesMarketCapFilter(c.market_cap, minMarketCapBillionIdr));
}
