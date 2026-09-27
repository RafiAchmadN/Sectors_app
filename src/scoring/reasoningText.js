/**
 * SCORING_LOGIC.md §7 — Format Reasoning Text Otomatis
 *
 * "Format final kedua template: (belum diisi)" — implementasi di bawah mengikuti
 * PERSIS kerangka kalimat yang sudah ditulis tim di §7, mengisi variabelnya secara
 * otomatis dari hasil scoring. Kalau tim menuliskan format final yang berbeda,
 * ganti template di bawah — logika pengisian variabel (faktor dominan, dsb) tetap dipakai.
 *
 * CLAUDE.md §2 & §7: disclaimer WAJIB tercantum pada SETIAP keluaran, dan produk TIDAK
 * BOLEH diposisikan sebagai rekomendasi investasi. disclaimerText() disediakan supaya
 * satu tempat ini yang jadi acuan teks disclaimer, tidak diketik ulang di tiap node n8n.
 */

const FACTOR_LABELS = {
  volume: 'lonjakan volume transaksi',
  brokerFlow: 'aktivitas akumulasi broker',
  news: 'sentimen berita terkini',
  foreignFlow: 'aliran dana asing masuk',
};

/**
 * SCORING_LOGIC.md §3b (27 Sep 2026) — badge anomali di reasoning text. `anomalies` opsional
 * supaya fungsi ini backward-compatible dengan caller lama yang belum mengisi field ini.
 * @param {{volume?:boolean, brokerFlow?:boolean, foreignFlow?:boolean}} [anomalies]
 */
const ANOMALY_LABELS = {
  volume: 'volume transaksi jauh di atas kebiasaan',
  brokerFlow: 'aktivitas broker jauh di luar pola biasa saham ini',
  foreignFlow: 'aliran dana asing jauh di luar pola biasa saham ini',
};
function describeAnomalies(anomalies) {
  if (!anomalies) return '';
  const active = Object.entries(anomalies)
    .filter(([, detected]) => detected)
    .map(([factor]) => ANOMALY_LABELS[factor]);
  if (!active.length) return '';
  return ' 🚨 Anomali terdeteksi: ' + active.join(', ') + '.';
}

/**
 * Faktor dengan kontribusi tertimbang terbesar terhadap Skor Akhir — dipakai sebagai
 * "[alasan utama berdasarkan skor tertinggi]" di template mode simple.
 *
 * @param {{volume:number, brokerFlow:number, news:number, foreignFlow:number}} scores
 * @param {{volume:number, brokerFlow:number, news:number, foreignFlow:number}} weights
 * @returns {'volume'|'brokerFlow'|'news'|'foreignFlow'}
 */
export function dominantFactor(scores, weights) {
  const contributions = {
    volume: weights.volume * scores.volume,
    brokerFlow: weights.brokerFlow * scores.brokerFlow,
    news: weights.news * scores.news,
    foreignFlow: weights.foreignFlow * scores.foreignFlow,
  };
  return Object.entries(contributions).reduce((best, [k, v]) => (v > contributions[best] ? k : best), 'volume');
}

/**
 * Mode simple — SCORING_LOGIC.md §7:
 * "[Nama saham] naik [persentase] didukung oleh [alasan utama berdasarkan skor tertinggi]."
 *
 * @param {object} p
 * @param {string} p.companyName
 * @param {number} p.priceChangePct - dari priceChange.js
 * @param {{volume:number, brokerFlow:number, news:number, foreignFlow:number}} p.scores
 * @param {{volume:number, brokerFlow:number, news:number, foreignFlow:number}} p.weights
 * @param {{volume?:boolean, brokerFlow?:boolean, foreignFlow?:boolean}} [p.anomalies] - SCORING_LOGIC.md §3b
 */
export function buildSimpleReasoning({ companyName, priceChangePct, scores, weights, anomalies }) {
  const arah = priceChangePct >= 0 ? 'naik' : 'turun';
  const pct = Math.abs(priceChangePct).toFixed(2);
  const factor = dominantFactor(scores, weights);
  return `${companyName} ${arah} ${pct}% didukung oleh ${FACTOR_LABELS[factor]}.${describeAnomalies(anomalies)}`;
}

/**
 * Mode detail — SCORING_LOGIC.md §7: "perlu memuat nilai skor tiap faktor, angka volume,
 * angka broker flow, judul berita terkait, dan angka foreign inflow."
 *
 * @param {object} p
 * @param {string} p.symbol
 * @param {string} p.companyName
 * @param {number} p.finalScore
 * @param {{volume:number, brokerFlow:number, news:number, foreignFlow:number}} p.scores
 * @param {number} p.todayVolume
 * @param {number} p.volumeRatio
 * @param {{topAccumulator: {broker_code:string, netShare:number}|null, topDistributor: {broker_code:string, netShare:number}|null}} p.brokerConcentration
 * @param {{title: string, source: string}[]} p.relatedNews - artikel yang dipakai menghitung Skor_News
 * @param {number} p.netForeignInflowIdr
 * @param {{volume?:boolean, brokerFlow?:boolean, foreignFlow?:boolean}} [p.anomalies] - SCORING_LOGIC.md §3b
 * @param {{brokerFlowZScore?:number, foreignFlowZScore?:number}} [p.anomalyDetails]
 * @returns {string}
 */
export function buildDetailReasoning({
  symbol,
  companyName,
  finalScore,
  scores,
  todayVolume,
  volumeRatio,
  brokerConcentration,
  relatedNews,
  netForeignInflowIdr,
  anomalies = {},
  anomalyDetails = {},
}) {
  const lines = [
    `${companyName} (${symbol}) — Skor Akhir: ${finalScore.toFixed(2)}`,
    `- Volume: skor ${scores.volume.toFixed(1)} | volume hari ini ${todayVolume.toLocaleString('id-ID')} | rasio thd SMA ${volumeRatio.toFixed(2)}x` +
      (anomalies.volume ? ' 🚨 ANOMALI' : ''),
    `- Broker flow: skor ${scores.brokerFlow.toFixed(1)} | ` +
      (brokerConcentration.topAccumulator
        ? `akumulasi terbesar oleh ${brokerConcentration.topAccumulator.broker_code} (${brokerConcentration.topAccumulator.netShare.toFixed(1)}%)`
        : 'tidak ada akumulasi dominan') +
      (brokerConcentration.topDistributor
        ? `, distribusi terbesar oleh ${brokerConcentration.topDistributor.broker_code} (${Math.abs(brokerConcentration.topDistributor.netShare).toFixed(1)}%)`
        : '') +
      (anomalies.brokerFlow ? ` 🚨 ANOMALI (Z=${anomalyDetails.brokerFlowZScore?.toFixed(2)})` : ''),
    `- Berita: skor ${scores.news.toFixed(2)} | ` +
      (relatedNews.length
        ? relatedNews.map((n) => `"${n.title}" (${n.source})`).join('; ')
        : 'tidak ada berita relevan dalam window waktu'),
    `- Foreign flow: skor ${scores.foreignFlow.toFixed(1)} | net foreign inflow hari ini Rp${netForeignInflowIdr.toLocaleString('id-ID')}` +
      (anomalies.foreignFlow ? ` 🚨 ANOMALI (Z=${anomalyDetails.foreignFlowZScore?.toFixed(2)})` : ''),
  ];
  return lines.join('\n');
}

/**
 * CLAUDE.md §2 & §7: disclaimer eksplisit wajib di SETIAP keluaran.
 */
export function disclaimerText() {
  return (
    'Disclaimer: Informasi ini adalah alat bantu analisis data pasar, BUKAN rekomendasi ' +
    'investasi atau nasihat keuangan. Keputusan investasi sepenuhnya tanggung jawab Anda ' +
    'sendiri. Data bersumber dari Sectors Financial API dan dapat mengandung keterlambatan ' +
    'atau ketidakakuratan.'
  );
}
