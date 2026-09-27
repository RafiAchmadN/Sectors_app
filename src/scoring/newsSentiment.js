/**
 * SCORING_LOGIC.md §5 — Time Decay untuk Berita
 *
 * Skor_News = Base Sentiment Score x Bobot Waktu
 * Base Sentiment Score: skala -1 (negatif) sampai 1 (positif), 0 untuk netral.
 * Bobot Waktu: bucket manual berdasarkan rentang jam sejak publikasi (bukan formula
 * eksponensial), supaya gampang jadi if-else di n8n dan gampang dijelaskan ke juri.
 *
 * Sumber data: response /v2/news/, field `tags[]` (berisi label seperti "Bullish"/"Bearish")
 * dan `dimension{}` (skor numerik per dimensi) — lihat docs/API_FINDINGS.md §1.4.
 * Base Sentiment Score TIDAK memerlukan LLM; diturunkan langsung dari field-field itu.
 */

/**
 * Heuristik default untuk menurunkan Base Sentiment Score dari `tags[]` artikel berita.
 * Ini DEFAULT YANG MASUK AKAL, bukan keputusan final tim — SCORING_LOGIC.md §5 tidak
 * mewajibkan metode tertentu untuk derivasi ini, jadi tim boleh mengganti fungsi ini
 * (mis. dengan pembobotan dari `dimension{}`) tanpa mengubah bucket time decay di bawah.
 *
 * @param {string[]} tags - field `tags` dari satu artikel /v2/news/
 * @returns {number} -1, 0, atau 1
 */
export function deriveBaseSentimentFromTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return 0;
  const hasBullish = tags.includes('Bullish');
  const hasBearish = tags.includes('Bearish');
  if (hasBullish && !hasBearish) return 1;
  if (hasBearish && !hasBullish) return -1;
  return 0; // tidak ada tag arah, atau keduanya muncul (campur) -> netral
}

/**
 * Cari bobot waktu untuk satu artikel berdasarkan jarak jam dari sekarang ke waktu publikasi.
 *
 * @param {number} hoursAgo - selisih jam antara sekarang dan `timestamp` artikel
 * @param {{maxHours: number, weight: number}[]} buckets - config.newsSentiment.timeDecayBuckets,
 *   HARUS sudah terurut naik berdasarkan maxHours
 * @param {number} beyondBucketsWeight - bobot untuk artikel di luar seluruh bucket (biasanya 0)
 * @returns {number}
 */
export function timeDecayWeight(hoursAgo, buckets, beyondBucketsWeight) {
  if (hoursAgo < 0) throw new Error('timeDecayWeight: hoursAgo tidak boleh negatif (artikel dari masa depan?)');
  const bucket = buckets.find((b) => hoursAgo <= b.maxHours);
  return bucket ? bucket.weight : beyondBucketsWeight;
}

/**
 * Field `timestamp` dari /v2/news/ tidak membawa offset timezone (format
 * YYYY-MM-DDTHH:mm:ss, tanpa Z). Diperlakukan sebagai UTC secara konsisten di sini —
 * SATU tempat ini yang menegakkan konvensi itu, supaya `publishedAtIso` dan `now`
 * (kalau diberikan sebagai string) tidak pernah diinterpretasi beda timezone.
 */
function toUtcDate(value) {
  if (value instanceof Date) return value;
  return new Date(value.endsWith('Z') ? value : `${value}Z`);
}

/**
 * @param {string} publishedAtIso - field `timestamp` artikel, format YYYY-MM-DDTHH:mm:ss
 * @param {Date|string} [now] - waktu acuan, default waktu sekarang
 * @returns {number} jam sejak publikasi
 */
export function hoursSincePublished(publishedAtIso, now = new Date()) {
  const published = toUtcDate(publishedAtIso);
  const ref = toUtcDate(now);
  return (ref.getTime() - published.getTime()) / (1000 * 60 * 60);
}

/**
 * Skor satu artikel: Base Sentiment Score x Bobot Waktu.
 * @param {number} baseSentimentScore - -1..1
 * @param {number} hoursAgo
 * @param {{maxHours:number, weight:number}[]} buckets
 * @param {number} beyondBucketsWeight
 */
export function scoreOneArticle(baseSentimentScore, hoursAgo, buckets, beyondBucketsWeight) {
  return baseSentimentScore * timeDecayWeight(hoursAgo, buckets, beyondBucketsWeight);
}

/**
 * SCORING_LOGIC.md §5 penutup: "jika satu saham punya lebih dari satu berita relevan
 * dalam window waktu, Skor_News final memakai rata-rata atau skor tertinggi."
 * Keputusan tim tersimpan di config.newsSentiment.multiArticleAggregation.
 *
 * @param {number[]} articleScores - hasil scoreOneArticle() untuk tiap artikel relevan
 * @param {'average'|'max'} aggregation
 * @returns {number} 0 jika tidak ada artikel relevan
 */
export function aggregateNewsScore(articleScores, aggregation) {
  if (!articleScores.length) return 0;
  if (aggregation === 'average') return articleScores.reduce((a, b) => a + b, 0) / articleScores.length;
  if (aggregation === 'max') {
    // "Skor tertinggi" berarti sinyal terkuat, bukan nilai numerik terbesar — mis. antara
    // -0.9 (sangat negatif) dan 0.1 (sedikit positif), -0.9 adalah sinyal yang lebih kuat.
    return articleScores.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a));
  }
  throw new Error(`aggregateNewsScore: aggregation tidak dikenal "${aggregation}", pakai "average" atau "max"`);
}

/**
 * SCORING_LOGIC.md §4 (diisi 27 Sep 2026) — Skor_News hasil aggregateNewsScore() berskala
 * -1..1, sedangkan volume/brokerFlow/foreignFlow dinormalisasi min-max ke 0-100 (§1). Kalau
 * skala -1..1 ini langsung dipakai di weightedFinalScore(), bobot W3 (news) di config
 * jadi TIDAK proporsional terhadap 3 bobot lain (kontribusi maksimalnya cuma sekitar
 * 1/100 dari kontribusi maksimal faktor lain pada bobot yang sama — lihat riwayat
 * perubahan angka di SCORING_LOGIC.md tanggal 27 Sep 2026 untuk detail masalahnya).
 *
 * Fungsi ini memetakan linear -1..1 -> 0-100 (raw -1 -> 0, 0/netral -> 50, +1 -> 100),
 * SEBELUM masuk ke weightedFinalScore() maupun dominantFactor() — supaya bobot W3 di
 * config.weightedScoring.weights.news berarti secara proporsional sama seperti W1/W2/W4,
 * dan konsisten dengan konvensi normalize.js (nilai netral/tanpa variasi = 50, titik tengah).
 *
 * @param {number} rawNewsScore - hasil aggregateNewsScore(), skala -1..1
 * @returns {number} skor 0-100
 */
export function normalizeNewsScore(rawNewsScore) {
  const score = ((rawNewsScore + 1) / 2) * 100;
  return Math.max(0, Math.min(100, score));
}
