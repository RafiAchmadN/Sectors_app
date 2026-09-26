/**
 * SCORING_LOGIC.md §6 — Tie-breaker
 * "Aturan jika dua saham atau lebih memiliki skor akhir yang sama: (belum diisi)"
 *
 * Menyediakan beberapa aturan siap pakai; tim memilih salah satu lewat
 * config.tieBreaker.rule. Dipanggil sebagai comparator untuk Array.prototype.sort
 * HANYA pada kelompok kandidat yang skor akhirnya sama persis (lihat sortRanking()).
 *
 * Setiap kandidat yang masuk ke sini diasumsikan sudah membawa field mentah yang relevan
 * (volumeRatio, brokerConcentrationShare, latestNewsHoursAgo, symbol) di luar `finalScore`.
 */

const RULES = {
  higher_volume_ratio: (a, b) => (b.volumeRatio ?? 0) - (a.volumeRatio ?? 0),
  higher_broker_concentration: (a, b) => (b.brokerConcentrationShare ?? 0) - (a.brokerConcentrationShare ?? 0),
  // berita lebih baru = hoursAgo lebih kecil -> menang
  more_recent_news: (a, b) => (a.latestNewsHoursAgo ?? Infinity) - (b.latestNewsHoursAgo ?? Infinity),
  alphabetical_symbol: (a, b) => String(a.symbol).localeCompare(String(b.symbol)),
};

/**
 * Urutkan kandidat berdasarkan finalScore (descending), memakai tie-breaker HANYA
 * di antara kandidat yang finalScore-nya sama persis.
 *
 * @param {Array<{finalScore: number, symbol: string}>} candidates
 * @param {keyof typeof RULES} rule - config.tieBreaker.rule
 */
export function sortRanking(candidates, rule) {
  const tieBreak = RULES[rule];
  if (!tieBreak) {
    throw new Error(`sortRanking: tie-breaker rule tidak dikenal "${rule}". Pilihan: ${Object.keys(RULES).join(', ')}`);
  }
  return [...candidates].sort((a, b) => {
    const scoreDiff = b.finalScore - a.finalScore;
    if (scoreDiff !== 0) return scoreDiff;
    return tieBreak(a, b);
  });
}

export const AVAILABLE_TIE_BREAKER_RULES = Object.keys(RULES);
