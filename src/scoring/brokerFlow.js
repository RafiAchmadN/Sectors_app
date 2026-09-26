/**
 * SCORING_LOGIC.md §3 — Broker flow signifikan
 *
 * "Signifikan jika konsentrasi akumulasi/distribusi oleh broker tertentu melebihi Z persen
 * dari total volume transaksi."
 *
 * Sumber data: response /v2/broker-summary/{symbol}/, field `data[].summary[]` (BUKAN
 * `data[].brokers[]` — lihat catatan di config/sectors-endpoints.js). Tim memilih basis
 * penghitungan lewat config.brokerFlow.concentrationBasis:
 *   - "value_idr" -> pakai bval/sval/nval (nilai rupiah)
 *   - "lot"        -> pakai blot/slot/nlot (jumlah lot)
 * Hasil kedua basis ini BISA BERBEDA untuk saham berharga tinggi (lihat docs/API_FINDINGS.md §3).
 */

const BASIS_FIELDS = {
  value_idr: { buy: 'bval', sell: 'sval', net: 'nval' },
  lot: { buy: 'blot', sell: 'slot', net: 'nlot' },
};

/**
 * Satu baris `summary[]` dari response broker-summary untuk satu tanggal.
 * @typedef {{broker_code: string, bval: number, sval: number, nval: number,
 *   blot: number, slot: number, nlot: number}} BrokerSummaryRow
 */

/**
 * Hitung konsentrasi broker paling akumulatif dan paling distributif pada satu hari.
 *
 * @param {BrokerSummaryRow[]} brokerRows - `data[i].summary` untuk satu tanggal
 * @param {'value_idr'|'lot'} basis
 * @returns {{
 *   totalBuy: number, totalSell: number,
 *   topAccumulator: {broker_code: string, netShare: number} | null,
 *   topDistributor: {broker_code: string, netShare: number} | null,
 * }}
 */
export function brokerConcentration(brokerRows, basis) {
  const fields = BASIS_FIELDS[basis];
  if (!fields) throw new Error(`brokerConcentration: basis tidak dikenal "${basis}", pakai "value_idr" atau "lot"`);
  if (!Array.isArray(brokerRows) || brokerRows.length === 0) {
    return { totalBuy: 0, totalSell: 0, topAccumulator: null, topDistributor: null };
  }

  const totalBuy = brokerRows.reduce((a, r) => a + (r[fields.buy] || 0), 0);
  const totalSell = brokerRows.reduce((a, r) => a + (r[fields.sell] || 0), 0);
  const totalActivity = totalBuy + totalSell;

  if (totalActivity === 0) {
    return { totalBuy: 0, totalSell: 0, topAccumulator: null, topDistributor: null };
  }

  // Konsentrasi dihitung terhadap TOTAL AKTIVITAS (buy+sell seluruh broker hari itu),
  // sesuai bunyi rumus "persen dari total volume transaksi" — bukan hanya terhadap sisi
  // yang sama (mis. broker akumulasi dibagi total buy saja), supaya satu broker yang
  // mendominasi buy DAN sell sekaligus tetap tampak proporsinya yang sebenarnya.
  let topAccumulator = null;
  let topDistributor = null;
  for (const row of brokerRows) {
    const net = row[fields.net] || 0;
    const share = (net / totalActivity) * 100;
    if (net > 0 && (!topAccumulator || net > topAccumulator._net)) {
      topAccumulator = { broker_code: row.broker_code, netShare: share, _net: net };
    }
    if (net < 0 && (!topDistributor || net < topDistributor._net)) {
      topDistributor = { broker_code: row.broker_code, netShare: share, _net: net };
    }
  }
  // buang field internal _net dari hasil publik
  if (topAccumulator) delete topAccumulator._net;
  if (topDistributor) delete topDistributor._net;

  return { totalBuy, totalSell, topAccumulator, topDistributor };
}

/**
 * @param {{topAccumulator: {netShare:number}|null, topDistributor: {netShare:number}|null}} concentration
 * @param {number} thresholdZPct - SCORING_LOGIC.md §3, threshold Z (persen, mis. 20 untuk 20%)
 * @returns {{significant: boolean, direction: 'accumulation'|'distribution'|null}}
 */
export function isBrokerFlowSignificant(concentration, thresholdZPct) {
  const accShare = concentration.topAccumulator?.netShare ?? 0;
  const distShare = Math.abs(concentration.topDistributor?.netShare ?? 0);
  if (accShare >= distShare && accShare > thresholdZPct) {
    return { significant: true, direction: 'accumulation' };
  }
  if (distShare > thresholdZPct) {
    return { significant: true, direction: 'distribution' };
  }
  return { significant: false, direction: null };
}
