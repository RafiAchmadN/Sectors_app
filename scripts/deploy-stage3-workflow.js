#!/usr/bin/env node
/**
 * Menambahkan node Tahap 3 (scoring engine) ke workflow yang sudah dibuat
 * scripts/deploy-stage1-workflow.js + scripts/deploy-stage2-workflow.js — TIDAK membuat
 * workflow baru, meng-update yang ada.
 *
 * Node "Score Candidates" meng-inline SELURUH logic src/scoring/*.js (yang sudah lolos
 * 62 unit test) sebagai satu Code node, karena n8n Code node tidak bisa import file lokal.
 * PENTING: kalau src/scoring/*.js berubah, jsCode di bawah WAJIB disinkronkan manual —
 * ini adalah satu-satunya tempat di n8n yang perlu diupdate, tidak menyebar ke node lain.
 *
 * Config di bawah adalah SALINAN PERSIS config/scoring.config.json per 27 Sep 2026 (lihat
 * SCORING_LOGIC.md untuk rumus & alasan tiap angka). Kalau tim merevisi angka scoring,
 * update DUA tempat: config/scoring.config.json (sumber kebenaran) DAN literal CONFIG di
 * bawah (salinannya di n8n) -- lalu jalankan ulang script ini.
 *
 * Syarat: sudah pernah jalankan deploy-stage1-workflow.js dan deploy-stage2-workflow.js.
 * Jalankan: node scripts/deploy-stage3-workflow.js
 */
import { pathToFileURL } from 'node:url';
import { listWorkflows, getWorkflow, updateWorkflow } from './n8n-client.js';

const NAME = 'Sectors Daily Watchlist - Stage 1+2+3 Fetch, Enrichment & Scoring';
const OLD_NAMES = [
  'Sectors Daily Watchlist - Stage 1+2 Fetch & Enrichment',
  'Sectors Daily Watchlist - Stage 1 Fetch Kandidat',
];

export const CODE_SCORE_CANDIDATES = `
// ============================================================================
// TAHAP 3 — SCORING ENGINE (Code node, jalan "Run Once for All Items")
// Inline PERSIS dari src/scoring/*.js (62 unit test lolos per 27 Sep 2026). Kalau file
// sumber berubah, sinkronkan manual ke sini -- Code node n8n tidak bisa import file lokal.
// Input: seluruh item dari "Attach Related News" (Tahap 2), bentuknya = CandidateRawData
// persis kontrak scoreCandidate() di src/scoring/index.js.
// ============================================================================

// --- Config (SALINAN PERSIS config/scoring.config.json per 27 Sep 2026) ---
// Sumber kebenaran TETAP config/scoring.config.json + SCORING_LOGIC.md -- ini cuma salinan
// operasional karena Code node tidak bisa baca file lokal.
const CONFIG = {
  normalisasi: {
    volume: { lookbackDays: 20 },
    brokerFlow: { lookbackDays: 10 },
    foreignInflow: { lookbackDays: 20 },
  },
  volumeAnomaly: { smaWindowDays: 20, significantRatioThreshold: 1.5 },
  brokerFlow: { significantConcentrationPct: 20, concentrationBasis: 'value_idr' },
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
  if (max === min) return 50; // tanpa variasi -> titik tengah, bukan 0/100
  const score = ((value - min) / (max - min)) * 100;
  return Math.max(0, Math.min(100, score));
}

// --- src/scoring/volumeAnomaly.js — SCORING_LOGIC.md §2.1 ---
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

// --- src/scoring/reasoningText.js — SCORING_LOGIC.md §7 ---
const FACTOR_LABELS = {
  volume: 'lonjakan volume transaksi',
  brokerFlow: 'aktivitas akumulasi broker',
  news: 'sentimen berita terkini',
  foreignFlow: 'aliran dana asing masuk',
};
function dominantFactor(scores, weights) {
  const contributions = {
    volume: weights.volume * scores.volume,
    brokerFlow: weights.brokerFlow * scores.brokerFlow,
    news: weights.news * scores.news,
    foreignFlow: weights.foreignFlow * scores.foreignFlow,
  };
  return Object.entries(contributions).reduce((best, [k, v]) => (v > contributions[best] ? k : best), 'volume');
}
function buildSimpleReasoning({ companyName, priceChangePct, scores, weights }) {
  const arah = priceChangePct >= 0 ? 'naik' : 'turun';
  const pct = Math.abs(priceChangePct).toFixed(2);
  const factor = dominantFactor(scores, weights);
  return companyName + ' ' + arah + ' ' + pct + '% didukung oleh ' + FACTOR_LABELS[factor] + '.';
}
function buildDetailReasoning({ symbol, companyName, finalScore, scores, todayVolume, volumeRatio, brokerConcentration, relatedNews, netForeignInflowIdr }) {
  const lines = [
    companyName + ' (' + symbol + ') — Skor Akhir: ' + finalScore.toFixed(2),
    '- Volume: skor ' + scores.volume.toFixed(1) + ' | volume hari ini ' + todayVolume.toLocaleString('id-ID') + ' | rasio thd SMA ' + volumeRatio.toFixed(2) + 'x',
    '- Broker flow: skor ' + scores.brokerFlow.toFixed(1) + ' | ' +
      (brokerConcentration.topAccumulator
        ? 'akumulasi terbesar oleh ' + brokerConcentration.topAccumulator.broker_code + ' (' + brokerConcentration.topAccumulator.netShare.toFixed(1) + '%)'
        : 'tidak ada akumulasi dominan') +
      (brokerConcentration.topDistributor
        ? ', distribusi terbesar oleh ' + brokerConcentration.topDistributor.broker_code + ' (' + Math.abs(brokerConcentration.topDistributor.netShare).toFixed(1) + '%)'
        : ''),
    '- Berita: skor ' + scores.news.toFixed(2) + ' | ' +
      (relatedNews.length ? relatedNews.map((n) => '"' + n.title + '" (' + n.source + ')').join('; ') : 'tidak ada berita relevan dalam window waktu'),
    '- Foreign flow: skor ' + scores.foreignFlow.toFixed(1) + ' | net foreign inflow hari ini Rp' + netForeignInflowIdr.toLocaleString('id-ID'),
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

  const scores = { volume: volumeScore, brokerFlow: brokerFlowScore, news: newsScore, foreignFlow: foreignFlowScore };
  const finalScore = weightedFinalScore(scores, config.weightedScoring.weights);

  const passesFilter = passesMarketCapFilter(today.market_cap, config.antiNoiseFilter.minMarketCapBillionIdr);

  const simpleReasoning = buildSimpleReasoning({
    companyName: raw.companyName, priceChangePct, scores, weights: config.weightedScoring.weights,
  });
  const detailReasoning = buildDetailReasoning({
    symbol: raw.symbol, companyName: raw.companyName, finalScore, scores,
    todayVolume: today.volume, volumeRatio: vRatio, brokerConcentration: brokerConc,
    relatedNews: relevantArticles, netForeignInflowIdr: todayForeign,
  });

  return {
    symbol: raw.symbol, companyName: raw.companyName, passesFilter, finalScore, scores,
    priceChangePct, volumeRatio: vRatio, brokerConcentration: brokerConc,
    relatedNews: relevantArticles, netForeignInflowIdr: todayForeign, todayVolume: today.volume,
    simpleReasoning, detailReasoning,
  };
}

function buildDailyWatchlist(rawCandidates, config) {
  // PENTING (ditemukan lewat test-execute nyata di n8n, 27 Sep 2026, data real BEI 25 Sep
  // 2026): scoreCandidate() SATU kandidat bisa throw pada data cacat (mis. open:0 pada saham
  // yang sempat suspensi sebagian hari -- ditemukan pada PACK dan YULE) meski field lain valid.
  // SEBELUM perbaikan ini, satu kandidat cacat menggagalkan SELURUH watchlist harian --
  // fatal untuk workflow yang wajib berjalan otonom (CLAUDE.md). Tiap kandidat sekarang
  // dicoba independen; yang gagal di-skip & dicatat di 'skipped', bukan menggagalkan semua.
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

const newNodes = [
  {
    id: 'score-candidates',
    name: 'Score Candidates',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1560, 480],
    parameters: { mode: 'runOnceForAllItems', jsCode: CODE_SCORE_CANDIDATES },
  },
  {
    id: 'sticky-status-3',
    name: 'Sticky Note 3',
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position: [1520, 660],
    parameters: {
      width: 480,
      height: 220,
      content:
        '## Status Tahap 3\n\n' +
        '**Selesai:** scoring engine (inline dari src/scoring/*.js) — hasil akhir 1 item ' +
        'berisi { generatedAt, disclaimer, watchlist[] }, tiap watchlist item punya ' +
        'simpleReasoning & detailReasoning siap kirim.\n\n' +
        '**Belum dibangun:** delivery Telegram, logging Google Sheets.\n\n' +
        'PENTING: kalau config/scoring.config.json berubah, jalankan ulang ' +
        'scripts/deploy-stage3-workflow.js supaya CONFIG di Code node ikut tersinkronkan.',
    },
  },
];

const newConnections = {
  'Attach Related News': {
    main: [[{ node: 'Score Candidates', type: 'main', index: 0 }]],
  },
};

// Guard eksekusi (pola sama seperti scripts/n8n-client.js): file ini aman diimpor (mis. untuk
// verifikasi CODE_SCORE_CANDIDATES secara lokal tanpa credit/efek samping) selama dijalankan
// bukan sebagai entry point langsung. Deploy sungguhan hanya terjadi lewat `node
// scripts/deploy-stage3-workflow.js`.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { data } = await listWorkflows();
  const existing = data.find((w) => OLD_NAMES.includes(w.name) || w.name === NAME);
  if (!existing) {
    console.error('Workflow Tahap 1/2 tidak ditemukan. Jalankan dulu deploy-stage1 dan deploy-stage2.');
    process.exit(1);
  }

  const full = await getWorkflow(existing.id);

  const nodesUpdated = full.nodes
    .filter((n) => !newNodes.some((nn) => nn.name === n.name))
    .concat(newNodes);

  const mergedConnections = { ...full.connections, ...newConnections };

  const payload = { name: NAME, nodes: nodesUpdated, connections: mergedConnections, settings: full.settings };
  const updated = await updateWorkflow(existing.id, payload);
  console.log(`Workflow diupdate: "${updated.name}" (id=${updated.id})`);
  console.log(`Total node sekarang: ${updated.nodes.length}`);
  console.log(`Buka di: http://localhost:5678/workflow/${updated.id}`);
}
