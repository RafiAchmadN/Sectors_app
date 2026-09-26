/**
 * SCORING_LOGIC.md §4 — Weighted Scoring
 *
 * Skor Akhir = (W1 x Skor_Volume) + (W2 x Skor_BrokerFlow) + (W3 x Skor_News) + (W4 x Skor_ForeignFlow)
 * W1+W2+W3+W4 harus 100. Seluruh Skor_X adalah hasil normalisasi 0-100 dari §1 —
 * KECUALI Skor_News, yang skalanya -1..1 x bobot waktu (jadi kira-kira -1..1, bukan 0-100).
 * Ini konsekuensi rumus §5 apa adanya: Skor_News tidak melalui min-max normalize.
 * Team perlu sadar Skor_News beroperasi di skala berbeda dari 3 komponen lain saat
 * menafsirkan Skor Akhir — bukan bug, tapi konsekuensi rumus yang tertulis di SCORING_LOGIC.md.
 */

/**
 * @param {{volume: number, brokerFlow: number, news: number, foreignFlow: number}} scores
 *   - volume, brokerFlow, foreignFlow: skor ternormalisasi 0-100 (dari normalize.js)
 *   - news: hasil aggregateNewsScore(), skala kira-kira -1..1
 * @param {{volume: number, brokerFlow: number, news: number, foreignFlow: number}} weights
 *   - config.weightedScoring.weights, harus berjumlah 100
 * @returns {number} Skor Akhir
 */
export function weightedFinalScore(scores, weights) {
  const total = weights.volume + weights.brokerFlow + weights.news + weights.foreignFlow;
  if (Math.abs(total - 100) > 0.001) {
    throw new Error(`weightedFinalScore: total bobot harus 100, saat ini ${total} (SCORING_LOGIC.md §4)`);
  }
  return (
    weights.volume * scores.volume +
    weights.brokerFlow * scores.brokerFlow +
    weights.news * scores.news +
    weights.foreignFlow * scores.foreignFlow
  ) / 100; // dibagi 100 karena weights dalam bentuk persen (mis. 30 untuk 30%), bukan pecahan (0.3)
}
