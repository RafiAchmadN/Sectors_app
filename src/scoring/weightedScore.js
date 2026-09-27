/**
 * SCORING_LOGIC.md §4 — Weighted Scoring
 *
 * Skor Akhir = (W1 x Skor_Volume) + (W2 x Skor_BrokerFlow) + (W3 x Skor_News) + (W4 x Skor_ForeignFlow)
 * W1+W2+W3+W4 harus 100. Seluruh Skor_X di sini SUDAH pada skala 0-100 yang sebanding:
 * volume/brokerFlow/foreignFlow lewat min-max normalize (§1), Skor_News lewat
 * normalizeNewsScore() (newsSentiment.js) yang memetakan skala mentah -1..1 dari §5
 * ke 0-100 SEBELUM sampai ke fungsi ini (dipanggil di index.js). DIPERBAIKI 27 Sep 2026 —
 * sebelumnya Skor_News dipakai apa adanya di skala -1..1 sehingga bobot W3 tidak
 * proporsional terhadap W1/W2/W4 (lihat riwayat perubahan angka di SCORING_LOGIC.md §4).
 */

/**
 * @param {{volume: number, brokerFlow: number, news: number, foreignFlow: number}} scores
 *   - seluruhnya skor ternormalisasi 0-100 (volume/brokerFlow/foreignFlow dari normalize.js,
 *     news dari normalizeNewsScore() di newsSentiment.js)
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
