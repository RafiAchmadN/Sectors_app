/**
 * SCORING_LOGIC.md §3b — Deteksi Anomali (ditambahkan 27 Sep 2026, keputusan tim)
 *
 * Berbeda dari normalize.js (min-max ke skala 0-100, dipakai untuk WEIGHTED SCORE di §4),
 * modul ini menjawab pertanyaan yang berbeda: "seberapa TIDAK BIASA angka hari ini
 * dibanding pola normal saham ini sendiri?" — dipakai untuk memberi badge/flag anomali di
 * reasoning text (SCORING_LOGIC.md §7), BUKAN bagian dari Skor Akhir. Sengaja dipisah dari
 * skor supaya sinyal yang sama tidak dihitung dua kali (sekali sebagai skor, sekali lagi
 * sebagai badge) — anomaly detection ini murni lapisan narasi tambahan, formula Skor Akhir
 * di weightedScore.js TIDAK berubah.
 *
 * Metode: Z-score terhadap histori saham itu SENDIRI (bukan dibanding saham lain, konsisten
 * dengan prinsip normalize.js §1) — mirip pendekatan anomaly detection teknikal yang sudah
 * pernah dipakai tim untuk crypto screening, diadaptasi ke sinyal broker flow & foreign flow
 * yang tersedia di Sectors API. TIDAK butuh endpoint API baru — seluruh histori yang dipakai
 * di sini (dailyHistory, brokerSummaryByDate, foreignFlowHistory) sudah difetch di Tahap 2.
 */

/**
 * @param {number} value - nilai hari ini
 * @param {number[]} historyValues - histori pembanding (idealnya TIDAK termasuk hari ini)
 * @returns {{zScore: number, mean: number, stdDev: number}}
 */
export function computeZScore(value, historyValues) {
  if (!Array.isArray(historyValues) || historyValues.length === 0) {
    throw new Error('computeZScore: historyValues tidak boleh kosong');
  }
  const mean = historyValues.reduce((a, b) => a + b, 0) / historyValues.length;
  const variance = historyValues.reduce((a, b) => a + (b - mean) ** 2, 0) / historyValues.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) {
    // Histori tidak pernah bervariasi (mis. saham baru listing / jarang ada broker flow) --
    // kalau value hari ini SAMA dengan histori yang flat itu, bukan anomali (z=0). Kalau BEDA,
    // itu justru anomali paling jelas (histori selalu sama, tiba-tiba beda) -> +-Infinity,
    // ditangkap eksplisit oleh isAnomaly() di bawah, bukan NaN yang bisa lolos tanpa terdeteksi.
    return { zScore: value === mean ? 0 : value > mean ? Infinity : -Infinity, mean, stdDev };
  }
  return { zScore: (value - mean) / stdDev, mean, stdDev };
}

/**
 * @param {number} zScore - hasil computeZScore().zScore
 * @param {number} thresholdZ - ambang |Z| (config.anomalyDetection.zScoreThreshold)
 * @returns {boolean}
 */
export function isAnomaly(zScore, thresholdZ) {
  if (zScore === Infinity || zScore === -Infinity) return true;
  return Math.abs(zScore) >= thresholdZ;
}
