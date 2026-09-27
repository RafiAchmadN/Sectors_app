#!/usr/bin/env node
/**
 * Sinkronkan Deteksi Anomali (SCORING_LOGIC.md §3b, 27 Sep 2026) ke workflow n8n yang sudah
 * ada. HANYA meng-update node "Score Candidates" (inline src/scoring/*.js terbaru, termasuk
 * anomalyDetection.js) dan "Prepare Sheet Rows" (tambah kolom anomali untuk audit trail) --
 * TIDAK ada perubahan node lain, TIDAK ada koneksi baru, karena badge anomali otomatis ikut
 * muncul di pesan Telegram lewat `simpleReasoning` yang sudah dipakai node "Format Telegram
 * Message" sejak Tahap 4 (tidak perlu diubah).
 *
 * Dicari lewat WORKFLOW ID langsung (bukan lookup by name seperti skrip sebelumnya) --
 * pelajaran dari beberapa kali workflow berganti nama tiap tahap, bikin daftar OLD_NAMES di
 * skrip lama gampang basi. ID workflow ini TETAP SAMA sejak dibuat pertama kali di
 * deploy-stage1-workflow.js, apapun nama tampilannya sekarang.
 *
 * Syarat: sudah pernah jalankan deploy-stage1 s/d deploy-stage5-workflow.js.
 * Jalankan: node scripts/deploy-stage6-workflow.js
 */
import { pathToFileURL } from 'node:url';
import { getWorkflow, updateWorkflow } from './n8n-client.js';

const WORKFLOW_ID = 'pbtINMh5vkrSR8NP';

export const CODE_SCORE_CANDIDATES_V2 = `
// ============================================================================
// TAHAP 3 — SCORING ENGINE (Code node, jalan "Run Once for All Items")
// Inline PERSIS dari src/scoring/*.js (75 unit test lolos per 27 Sep 2026, termasuk Deteksi
// Anomali §3b). Kalau file sumber berubah, sinkronkan manual ke sini -- Code node n8n tidak
// bisa import file lokal.
// Input: seluruh item dari "Attach Related News" (Tahap 2), bentuknya = CandidateRawData
// persis kontrak scoreCandidate() di src/scoring/index.js.
// ============================================================================

// --- Config (SALINAN PERSIS config/scoring.config.json per 27 Sep 2026) ---
const CONFIG = {
  normalisasi: {
    volume: { lookbackDays: 20 },
    brokerFlow: { lookbackDays: 10 },
    foreignInflow: { lookbackDays: 20 },
  },
  volumeAnomaly: { smaWindowDays: 20, significantRatioThreshold: 1.5 },
  brokerFlow: { significantConcentrationPct: 20, concentrationBasis: 'value_idr' },
  anomalyDetection: { zScoreThreshold: 1.5 },
  antiNoiseFilter: { minMarketCapBillionIdr: 5000 },
  newsSentiment: {
    timeDecayBuckets: [
      { maxHours: 24, label: 'harian', weight: 1.0 },
      { maxHours: 72, label: 'beberapa_hari_terakhir', weight: 0.5 },
      { maxHours: 168, label: 'mingguan', weight: 0.2 },
    ],
    beyondBucketsWeight: 0,
    multiArticleAggregation: 'average',
  },
  weightedScoring: { weights: { volume: 30, brokerFlow: 35, news: 15, foreignFlow: 20 } },
  tieBreaker: { rule: 'higher_broker_concentration' },
  output: { topN: 7 },
};

// --- src/scoring/normalize.js — SCORING_LOGIC.md §1 ---
function minMaxNormalize(value, historyValues) {
  if (!Array.isArray(historyValues) || historyValues.length === 0) {
    throw new Error('minMaxNormalize: historyValues tidak boleh kosong');
  }
  const min = Math.min(...historyValues);
  const max = Math.max(...historyValues);
  if (max === min) return 50;
  const score = ((value - min) / (max - min)) * 100;
  return Math.max(0, Math.min(100, score));
}

// --- src/scoring/volumeAnomaly.js — SCORING_LOGIC.md §2.1 & §3b ---
function smaVolume(priorVolumes, n) {
  if (!Number.isInteger(n) || n <= 0) throw new Error('smaVolume: n harus bilangan bulat positif');
  if (priorVolumes.length < n) {
    throw new Error('smaVolume: histori tidak cukup — butuh ' + n + ' hari, hanya tersedia ' + priorVolumes.length + '.');
  }
  const window = priorVolumes.slice(-n);
  return window.reduce((a, b) => a + b, 0) / n;
}
function volumeRatio(todayVolume, sma) {
  if (sma === 0) return todayVolume === 0 ? 0 : Infinity;
  return todayVolume / sma;
}
function isVolumeSignificant(ratio, thresholdY) {
  return ratio > thresholdY;
}

// --- src/scoring/priceChange.js — SCORING_LOGIC.md §2.2 ---
function priceChangeFromOpen(close, open) {
  if (open === 0) throw new Error('priceChangeFromOpen: harga open tidak boleh 0');
  return ((close - open) / open) * 100;
}

// --- src/scoring/brokerFlow.js — SCORING_LOGIC.md §3 ---
const BASIS_FIELDS = {
  value_idr: { buy: 'bval', sell: 'sval', net: 'nval' },
  lot: { buy: 'blot', sell: 'slot', net: 'nlot' },
};
function brokerConcentration(brokerRows, basis) {
  const fields = BASIS_FIELDS[basis];
  if (!fields) throw new Error('brokerConcentration: basis tidak dikenal "' + basis + '"');
  if (!Array.isArray(brokerRows) || brokerRows.length === 0) {
    return { totalBuy: 0, totalSell: 0, topAccumulator: null, topDistributor: null };
  }
  const totalBuy = brokerRows.reduce((a, r) => a + (r[fields.buy] || 0), 0);
  const totalSell = brokerRows.reduce((a, r) => a + (r[fields.sell] || 0), 0);
  const totalActivity = totalBuy + totalSell;
  if (totalActivity === 0) return { totalBuy: 0, totalSell: 0, topAccumulator: null, topDistributor: null };
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
  if (topAccumulator) delete topAccumulator._net;
  if (topDistributor) delete topDistributor._net;
  return { totalBuy, totalSell, topAccumulator, topDistributor };
}

// --- src/scoring/anomalyDetection.js — SCORING_LOGIC.md §3b (27 Sep 2026) ---
function computeZScore(value, historyValues) {
  if (!Array.isArray(historyValues) || historyValues.length === 0) {
    throw new Error('computeZScore: historyValues tidak boleh kosong');
  }
  const mean = historyValues.reduce((a, b) => a + b, 0) / historyValues.length;
  const variance = historyValues.reduce((a, b) => a + (b - mean) ** 2, 0) / historyValues.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) {
    return { zScore: value === mean ? 0 : value > mean ? Infinity : -Infinity, mean, stdDev };
  }
  return { zScore: (value - mean) / stdDev, mean, stdDev };
}
function isAnomaly(zScore, thresholdZ) {
  if (zScore === Infinity || zScore === -Infinity) return true;
  return Math.abs(zScore) >= thresholdZ;
}

// --- src/scoring/newsSentiment.js — SCORING_LOGIC.md §5 ---
function deriveBaseSentimentFromTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return 0;
  const hasBullish = tags.includes('Bullish');
  const hasBearish = tags.includes('Bearish');
  if (hasBullish && !hasBearish) return 1;
  if (hasBearish && !hasBullish) return -1;
  return 0;
}
function timeDecayWeight(hoursAgo, buckets, beyondBucketsWeight) {
  if (hoursAgo < 0) throw new Error('timeDecayWeight: hoursAgo tidak boleh negatif');
  const bucket = buckets.find((b) => hoursAgo <= b.maxHours);
  return bucket ? bucket.weight : beyondBucketsWeight;
}
function toUtcDate(value) {
  if (value instanceof Date) return value;
  return new Date(String(value).endsWith('Z') ? value : value + 'Z');
}
function hoursSincePublished(publishedAtIso, now) {
  const published = toUtcDate(publishedAtIso);
  const ref = toUtcDate(now || new Date());
  return (ref.getTime() - published.getTime()) / (1000 * 60 * 60);
}
function scoreOneArticle(baseSentimentScore, hoursAgo, buckets, beyondBucketsWeight) {
  return baseSentimentScore * timeDecayWeight(hoursAgo, buckets, beyondBucketsWeight);
}
function aggregateNewsScore(articleScores, aggregation) {
  if (!articleScores.length) return 0;
  if (aggregation === 'average') return articleScores.reduce((a, b) => a + b, 0) / articleScores.length;
  if (aggregation === 'max') {
    return articleScores.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a));
  }
  throw new Error('aggregateNewsScore: aggregation tidak dikenal "' + aggregation + '"');
}
function normalizeNewsScore(rawNewsScore) {
  const score = ((rawNewsScore + 1) / 2) * 100;
  return Math.max(0, Math.min(100, score));
}

// --- src/scoring/antiNoiseFilter.js — SCORING_LOGIC.md §3 ---
function passesMarketCapFilter(marketCapIdr, minMarketCapBillionIdr) {
  const minIdr = minMarketCapBillionIdr * 1_000_000_000;
  return marketCapIdr >= minIdr;
}

// --- src/scoring/weightedScore.js — SCORING_LOGIC.md §4 ---
function weightedFinalScore(scores, weights) {
  const total = weights.volume + weights.brokerFlow + weights.news + weights.foreignFlow;
  if (Math.abs(total - 100) > 0.001) {
    throw new Error('weightedFinalScore: total bobot harus 100, saat ini ' + total);
  }
  return (
    (weights.volume * scores.volume +
      weights.brokerFlow * scores.brokerFlow +
      weights.news * scores.news +
      weights.foreignFlow * scores.foreignFlow) / 100
  );
}

// --- src/scoring/tieBreaker.js — SCORING_LOGIC.md §6 ---
const TIE_BREAKER_RULES = {
  higher_volume_ratio: (a, b) => (b.volumeRatio ?? 0) - (a.volumeRatio ?? 0),
  higher_broker_concentration: (a, b) => (b.brokerConcentrationShare ?? 0) - (a.brokerConcentrationShare ?? 0),
  more_recent_news: (a, b) => (a.latestNewsHoursAgo ?? Infinity) - (b.latestNewsHoursAgo ?? Infinity),
  alphabetical_symbol: (a, b) => String(a.symbol).localeCompare(String(b.symbol)),
};
function sortRanking(candidates, rule) {
  const tieBreak = TIE_BREAKER_RULES[rule];
  if (!tieBreak) throw new Error('sortRanking: tie-breaker rule tidak dikenal "' + rule + '"');
  return [...candidates].sort((a, b) => {
    const scoreDiff = b.finalScore - a.finalScore;
    if (scoreDiff !== 0) return scoreDiff;
    return tieBreak(a, b);
  });
}

// --- src/scoring/reasoningText.js — SCORING_LOGIC.md §7 & §3b ---
const FACTOR_LABELS = {
  volume: 'lonjakan volume transaksi',
  brokerFlow: 'aktivitas akumulasi broker',
  news: 'sentimen berita terkini',
  foreignFlow: 'aliran dana asing masuk',
};
const ANOMALY_LABELS = {
  volume: 'volume transaksi jauh di atas kebiasaan',
  brokerFlow: 'aktivitas broker jauh di luar pola biasa saham ini',
  foreignFlow: 'aliran dana asing jauh di luar pola biasa saham ini',
};
function describeAnomalies(anomalies) {
  if (!anomalies) return '';
  const active = Object.entries(anomalies).filter(([, d]) => d).map(([f]) => ANOMALY_LABELS[f]);
  if (!active.length) return '';
  return ' 🚨 Anomali terdeteksi: ' + active.join(', ') + '.';
}
function dominantFactor(scores, weights) {
  const contributions = {
    volume: weights.volume * scores.volume,
    brokerFlow: weights.brokerFlow * scores.brokerFlow,
    news: weights.news * scores.news,
    foreignFlow: weights.foreignFlow * scores.foreignFlow,
  };
  return Object.entries(contributions).reduce((best, [k, v]) => (v > contributions[best] ? k : best), 'volume');
}
function buildSimpleReasoning({ companyName, priceChangePct, scores, weights, anomalies }) {
  const arah = priceChangePct >= 0 ? 'naik' : 'turun';
  const pct = Math.abs(priceChangePct).toFixed(2);
  const factor = dominantFactor(scores, weights);
  return companyName + ' ' + arah + ' ' + pct + '% didukung oleh ' + FACTOR_LABELS[factor] + '.' + describeAnomalies(anomalies);
}
function buildDetailReasoning({ symbol, companyName, finalScore, scores, todayVolume, volumeRatio, brokerConcentration, relatedNews, netForeignInflowIdr, anomalies = {}, anomalyDetails = {} }) {
  const lines = [
    companyName + ' (' + symbol + ') — Skor Akhir: ' + finalScore.toFixed(2),
    '- Volume: skor ' + scores.volume.toFixed(1) + ' | volume hari ini ' + todayVolume.toLocaleString('id-ID') + ' | rasio thd SMA ' + volumeRatio.toFixed(2) + 'x' + (anomalies.volume ? ' 🚨 ANOMALI' : ''),
    '- Broker flow: skor ' + scores.brokerFlow.toFixed(1) + ' | ' +
      (brokerConcentration.topAccumulator
        ? 'akumulasi terbesar oleh ' + brokerConcentration.topAccumulator.broker_code + ' (' + brokerConcentration.topAccumulator.netShare.toFixed(1) + '%)'
        : 'tidak ada akumulasi dominan') +
      (brokerConcentration.topDistributor
        ? ', distribusi terbesar oleh ' + brokerConcentration.topDistributor.broker_code + ' (' + Math.abs(brokerConcentration.topDistributor.netShare).toFixed(1) + '%)'
        : '') +
      (anomalies.brokerFlow ? ' 🚨 ANOMALI (Z=' + anomalyDetails.brokerFlowZScore?.toFixed(2) + ')' : ''),
    '- Berita: skor ' + scores.news.toFixed(2) + ' | ' +
      (relatedNews.length ? relatedNews.map((n) => '"' + n.title + '" (' + n.source + ')').join('; ') : 'tidak ada berita relevan dalam window waktu'),
    '- Foreign flow: skor ' + scores.foreignFlow.toFixed(1) + ' | net foreign inflow hari ini Rp' + netForeignInflowIdr.toLocaleString('id-ID') +
      (anomalies.foreignFlow ? ' 🚨 ANOMALI (Z=' + anomalyDetails.foreignFlowZScore?.toFixed(2) + ')' : ''),
  ];
  return lines.join('\\n');
}
function disclaimerText() {
  return 'Disclaimer: Informasi ini adalah alat bantu analisis data pasar, BUKAN rekomendasi ' +
    'investasi atau nasihat keuangan. Keputusan investasi sepenuhnya tanggung jawab Anda ' +
    'sendiri. Data bersumber dari Sectors Financial API dan dapat mengandung keterlambatan ' +
    'atau ketidakakuratan.';
}

// --- src/scoring/index.js — orkestrator (scoreCandidate + buildDailyWatchlist) ---
function scoreCandidate(raw, config) {
  const today = raw.dailyHistory[raw.dailyHistory.length - 1];
  const priorDays = raw.dailyHistory.slice(0, -1);

  const priorVolumes = priorDays.map((d) => d.volume);
  const sma = smaVolume(priorVolumes, config.volumeAnomaly.smaWindowDays);
  const vRatio = volumeRatio(today.volume, sma);
  const volumeScore = minMaxNormalize(
    today.volume,
    priorDays.slice(-config.normalisasi.volume.lookbackDays).map((d) => d.volume).concat(today.volume),
  );

  const priceChangePct = priceChangeFromOpen(today.close, today.open);

  const todayBrokerRows = (raw.brokerSummaryByDate.find((d) => d.date === today.date) || {}).summary || [];
  const brokerConc = brokerConcentration(todayBrokerRows, config.brokerFlow.concentrationBasis);
  const netField = config.brokerFlow.concentrationBasis === 'lot' ? 'nlot' : 'nval';
  const brokerHistoryNet = raw.brokerSummaryByDate
    .slice(-config.normalisasi.brokerFlow.lookbackDays)
    .map((d) => (d.summary || []).reduce((a, r) => a + (r[netField] || 0), 0));
  const todayNetTotal = todayBrokerRows.reduce((a, r) => a + (r[netField] || 0), 0);
  const brokerFlowScore = minMaxNormalize(todayNetTotal, brokerHistoryNet.length ? brokerHistoryNet : [todayNetTotal]);

  const now = raw.now || new Date();
  const relevantArticles = raw.newsArticles.filter((a) => {
    const hrs = hoursSincePublished(a.timestamp, now);
    return hrs >= 0 && hrs <= 24 * 7;
  });
  const articleScores = relevantArticles.map((a) =>
    scoreOneArticle(
      deriveBaseSentimentFromTags(a.tags),
      hoursSincePublished(a.timestamp, now),
      config.newsSentiment.timeDecayBuckets,
      config.newsSentiment.beyondBucketsWeight,
    ),
  );
  const newsScore = normalizeNewsScore(aggregateNewsScore(articleScores, config.newsSentiment.multiArticleAggregation));

  const todayForeign = (raw.foreignFlowHistory[raw.foreignFlowHistory.length - 1] || {}).net_foreign_inflow ?? 0;
  const foreignHistory = raw.foreignFlowHistory
    .slice(-config.normalisasi.foreignInflow.lookbackDays)
    .map((d) => d.net_foreign_inflow);
  const foreignFlowScore = minMaxNormalize(todayForeign, foreignHistory.length ? foreignHistory : [todayForeign]);

  // --- Deteksi Anomali (SCORING_LOGIC.md §3b, 27 Sep 2026) ---
  const volumeAnomalyDetected = isVolumeSignificant(vRatio, config.volumeAnomaly.significantRatioThreshold);

  const brokerHistoryPrior = raw.brokerSummaryByDate
    .filter((d) => d.date !== today.date)
    .slice(-config.normalisasi.brokerFlow.lookbackDays)
    .map((d) => (d.summary || []).reduce((a, r) => a + (r[netField] || 0), 0));
  const brokerFlowZ = brokerHistoryPrior.length ? computeZScore(todayNetTotal, brokerHistoryPrior) : { zScore: 0, mean: todayNetTotal, stdDev: 0 };
  const brokerFlowAnomalyDetected = brokerHistoryPrior.length > 0 && isAnomaly(brokerFlowZ.zScore, config.anomalyDetection.zScoreThreshold);

  const foreignHistoryPrior = raw.foreignFlowHistory
    .filter((d) => d.date !== today.date)
    .slice(-config.normalisasi.foreignInflow.lookbackDays)
    .map((d) => d.net_foreign_inflow);
  const foreignFlowZ = foreignHistoryPrior.length ? computeZScore(todayForeign, foreignHistoryPrior) : { zScore: 0, mean: todayForeign, stdDev: 0 };
  const foreignFlowAnomalyDetected = foreignHistoryPrior.length > 0 && isAnomaly(foreignFlowZ.zScore, config.anomalyDetection.zScoreThreshold);

  const anomalies = { volume: volumeAnomalyDetected, brokerFlow: brokerFlowAnomalyDetected, foreignFlow: foreignFlowAnomalyDetected };
  const anomalyDetails = { brokerFlowZScore: brokerFlowZ.zScore, foreignFlowZScore: foreignFlowZ.zScore };

  const scores = { volume: volumeScore, brokerFlow: brokerFlowScore, news: newsScore, foreignFlow: foreignFlowScore };
  const finalScore = weightedFinalScore(scores, config.weightedScoring.weights);

  const passesFilter = passesMarketCapFilter(today.market_cap, config.antiNoiseFilter.minMarketCapBillionIdr);

  const simpleReasoning = buildSimpleReasoning({
    companyName: raw.companyName, priceChangePct, scores, weights: config.weightedScoring.weights, anomalies,
  });
  const detailReasoning = buildDetailReasoning({
    symbol: raw.symbol, companyName: raw.companyName, finalScore, scores,
    todayVolume: today.volume, volumeRatio: vRatio, brokerConcentration: brokerConc,
    relatedNews: relevantArticles, netForeignInflowIdr: todayForeign, anomalies, anomalyDetails,
  });

  return {
    symbol: raw.symbol, companyName: raw.companyName, passesFilter, finalScore, scores,
    priceChangePct, volumeRatio: vRatio, brokerConcentration: brokerConc,
    relatedNews: relevantArticles, netForeignInflowIdr: todayForeign, todayVolume: today.volume,
    anomalies, anomalyDetails, simpleReasoning, detailReasoning,
  };
}

function buildDailyWatchlist(rawCandidates, config) {
  const skipped = [];
  const scored = [];
  for (const raw of rawCandidates) {
    try {
      const result = scoreCandidate(raw, config);
      if (result.passesFilter) scored.push(result);
    } catch (e) {
      skipped.push({ symbol: raw.symbol, reason: e.message });
    }
  }
  const ranked = sortRanking(
    scored.map((c) => ({
      ...c,
      volumeRatio: c.volumeRatio,
      brokerConcentrationShare: c.brokerConcentration.topAccumulator ? c.brokerConcentration.topAccumulator.netShare : 0,
      latestNewsHoursAgo: c.relatedNews.length
        ? Math.min(...c.relatedNews.map((a) => hoursSincePublished(a.timestamp, config.now || new Date())))
        : Infinity,
    })),
    config.tieBreaker.rule,
  );
  return {
    generatedAt: new Date().toISOString(),
    disclaimer: disclaimerText(),
    watchlist: ranked.slice(0, config.output.topN),
    skipped,
  };
}

// ============================================================================
// Driver — dipanggil sekali untuk seluruh kandidat (mode "Run Once for All Items")
// ============================================================================
const rawCandidates = items.map((item) => item.json);
const result = buildDailyWatchlist(rawCandidates, CONFIG);

return [{ json: result }];
`.trim();

export const CODE_PREPARE_SHEET_ROWS_V2 = `
// CLAUDE.md §3: Google Sheets sebagai rekap harian dan audit trail. Satu baris per saham di
// watchlist. Ditambah kolom anomali (SCORING_LOGIC.md §3b, 27 Sep 2026) supaya badge 🚨 yang
// muncul di Telegram bisa ditelusuri angka Z-score-nya di sini.
const result = $json;
if (result.watchlist.length === 0) return [];

return result.watchlist.map((c, i) => ({
  json: {
    tanggal: result.generatedAt,
    rank: i + 1,
    symbol: c.symbol,
    nama_perusahaan: c.companyName,
    skor_akhir: Number(c.finalScore.toFixed(2)),
    skor_volume: Number(c.scores.volume.toFixed(1)),
    skor_broker_flow: Number(c.scores.brokerFlow.toFixed(1)),
    skor_news: Number(c.scores.news.toFixed(1)),
    skor_foreign_flow: Number(c.scores.foreignFlow.toFixed(1)),
    persen_perubahan_harga: Number(c.priceChangePct.toFixed(2)),
    volume_hari_ini: c.todayVolume,
    volume_ratio_thd_sma: Number(c.volumeRatio.toFixed(2)),
    broker_akumulasi_terbesar: c.brokerConcentration.topAccumulator
      ? c.brokerConcentration.topAccumulator.broker_code + ' (' + c.brokerConcentration.topAccumulator.netShare.toFixed(1) + '%)'
      : '-',
    net_foreign_inflow_idr: c.netForeignInflowIdr,
    jumlah_berita_relevan: c.relatedNews.length,
    anomali_volume: c.anomalies?.volume ?? false,
    anomali_broker_flow: c.anomalies?.brokerFlow ?? false,
    anomali_broker_flow_zscore: Number.isFinite(c.anomalyDetails?.brokerFlowZScore) ? Number(c.anomalyDetails.brokerFlowZScore.toFixed(2)) : c.anomalyDetails?.brokerFlowZScore ?? null,
    anomali_foreign_flow: c.anomalies?.foreignFlow ?? false,
    anomali_foreign_flow_zscore: Number.isFinite(c.anomalyDetails?.foreignFlowZScore) ? Number(c.anomalyDetails.foreignFlowZScore.toFixed(2)) : c.anomalyDetails?.foreignFlowZScore ?? null,
    alasan_singkat: c.simpleReasoning,
  },
}));
`.trim();

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const full = await getWorkflow(WORKFLOW_ID);

  const scoreNode = full.nodes.find((n) => n.name === 'Score Candidates');
  if (!scoreNode) throw new Error('Node "Score Candidates" tidak ditemukan -- jalankan deploy-stage3-workflow.js dulu.');
  scoreNode.parameters.jsCode = CODE_SCORE_CANDIDATES_V2;

  const sheetRowsNode = full.nodes.find((n) => n.name === 'Prepare Sheet Rows');
  if (!sheetRowsNode) throw new Error('Node "Prepare Sheet Rows" tidak ditemukan -- jalankan deploy-stage4-workflow.js dulu.');
  sheetRowsNode.parameters.jsCode = CODE_PREPARE_SHEET_ROWS_V2;

  const updated = await updateWorkflow(WORKFLOW_ID, {
    name: full.name,
    nodes: full.nodes,
    connections: full.connections,
    settings: full.settings,
  });
  console.log(`Workflow diupdate: "${updated.name}" (id=${updated.id})`);
  console.log('Node "Score Candidates" dan "Prepare Sheet Rows" berhasil disinkronkan dengan Deteksi Anomali §3b.');
}
