/**
 * SCORING_LOGIC.md §2.1 — Volume Anomaly (Simple Moving Average Volume)
 *
 * SMA Volume (n) = (Volume_1 + ... + Volume_n) / n
 * Volume Ratio   = Volume Hari Ini / SMA Volume (n)
 * Dianggap signifikan jika Volume Ratio > Y
 *
 * Input `dailyVolumes` diasumsikan berupa array volume harian TERURUT DARI TERLAMA KE
 * TERBARU (hasil langsung dari /v2/daily/{symbol}/ setelah di-sort naik berdasarkan
 * tanggal), TIDAK termasuk hari ini. Ini konsisten dengan bagaimana defaultQuery di
 * config/sectors-endpoints.js mengambil rentang [today - lookbackDays, today].
 */

/**
 * @param {number[]} priorVolumes - volume n hari sebelumnya (tanpa hari ini), terurut lama->baru
 * @param {number} n - jumlah hari pembanding SMA (SCORING_LOGIC.md §2.1)
 * @returns {number} SMA volume
 */
export function smaVolume(priorVolumes, n) {
  if (!Number.isInteger(n) || n <= 0) throw new Error('smaVolume: n harus bilangan bulat positif');
  if (priorVolumes.length < n) {
    throw new Error(
      `smaVolume: histori tidak cukup — butuh ${n} hari, hanya tersedia ${priorVolumes.length}. ` +
        `Cek rentang start/end pada permintaan /v2/daily/.`,
    );
  }
  const window = priorVolumes.slice(-n); // n hari paling akhir sebelum hari ini
  const sum = window.reduce((a, b) => a + b, 0);
  return sum / n;
}

/**
 * @param {number} todayVolume
 * @param {number} sma
 * @returns {number} Volume Ratio (todayVolume / sma)
 */
export function volumeRatio(todayVolume, sma) {
  if (sma === 0) return todayVolume === 0 ? 0 : Infinity;
  return todayVolume / sma;
}

/**
 * @param {number} ratio - hasil volumeRatio()
 * @param {number} thresholdY - SCORING_LOGIC.md §3, threshold Y
 * @returns {boolean} signifikan jika ratio > Y
 */
export function isVolumeSignificant(ratio, thresholdY) {
  return ratio > thresholdY;
}
