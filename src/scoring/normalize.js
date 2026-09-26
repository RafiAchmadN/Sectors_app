/**
 * SCORING_LOGIC.md §1 — Normalisasi Data
 *
 * Skor Ternormalisasi = (Nilai - Nilai Minimum) / (Nilai Maksimum - Nilai Minimum) x 100
 *
 * Dihitung dari histori saham itu SENDIRI (bukan dibanding saham lain) — jadi `values`
 * selalu berarti "seri histori satu simbol", bukan "nilai hari ini dari semua simbol".
 */

/**
 * @param {number} value - nilai hari ini yang mau dinormalisasi
 * @param {number[]} historyValues - seri histori (termasuk atau tidak termasuk hari ini,
 *   tergantung bagaimana caller mengambil datanya) yang jadi acuan min/max
 * @returns {number} skor 0-100
 */
export function minMaxNormalize(value, historyValues) {
  if (!Array.isArray(historyValues) || historyValues.length === 0) {
    throw new Error('minMaxNormalize: historyValues tidak boleh kosong');
  }
  const min = Math.min(...historyValues);
  const max = Math.max(...historyValues);
  if (max === min) {
    // Seluruh histori bernilai sama (mis. saham suspensi/tidak likuid) — tidak ada
    // variasi untuk dinormalisasi. Dikembalikan sebagai titik tengah, bukan 0 atau 100,
    // supaya tidak salah dibaca sebagai "paling rendah" atau "paling signifikan".
    return 50;
  }
  const score = ((value - min) / (max - min)) * 100;
  return Math.max(0, Math.min(100, score));
}
