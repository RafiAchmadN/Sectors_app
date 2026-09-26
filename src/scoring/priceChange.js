/**
 * SCORING_LOGIC.md §2.2 — Price Change dari Open
 *
 * Persentase Perubahan = ((Harga Close - Harga Open) / Harga Open) x 100
 */

/**
 * @param {number} close
 * @param {number} open
 * @returns {number} persentase perubahan (mis. 2.5 berarti +2.5%)
 */
export function priceChangeFromOpen(close, open) {
  if (open === 0) throw new Error('priceChangeFromOpen: harga open tidak boleh 0');
  return ((close - open) / open) * 100;
}

/**
 * SCORING_LOGIC.md §2.3 — Simple Moving Average Harga (opsional, konteks tren).
 * RSI sengaja tidak dipakai pada versi ini.
 *
 * @param {number[]} priorCloses - harga close n hari sebelumnya, terurut lama->baru
 * @param {number} n
 */
export function smaPrice(priorCloses, n) {
  if (!Number.isInteger(n) || n <= 0) throw new Error('smaPrice: n harus bilangan bulat positif');
  if (priorCloses.length < n) {
    throw new Error(`smaPrice: histori tidak cukup — butuh ${n} hari, hanya tersedia ${priorCloses.length}.`);
  }
  const window = priorCloses.slice(-n);
  return window.reduce((a, b) => a + b, 0) / n;
}
