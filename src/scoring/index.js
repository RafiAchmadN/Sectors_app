/**
 * Orkestrator scoring engine — merangkai seluruh modul di src/scoring/ menjadi satu
 * fungsi per-kandidat, mengikuti urutan CLAUDE.md §5 (Letak Scoring Logic pada Workflow).
 *
 * Ini adalah lapisan yang nanti disalin ke Code node n8n. Input `raw` mengikuti bentuk
 * response Sectors API v2 APA ADANYA (setelah stripSuffix pada symbol) — pemetaan field
 * dari response ke sini adalah satu-satunya tempat yang perlu berubah kalau
 * npm run verify:api menemukan bentuk response berbeda dari dokumentasi.
 */
import { loadScoringConfig } from './config.js';
import { minMaxNormalize } from './normalize.js';
import { smaVolume, volumeRatio as calcVolumeRatio } from './volumeAnomaly.js';
import { priceChangeFromOpen } from './priceChange.js';
import { brokerConcentration } from './brokerFlow.js';
import {
  deriveBaseSentimentFromTags,
  hoursSincePublished,
  scoreOneArticle,
  aggregateNewsScore,
  normalizeNewsScore,
} from './newsSentiment.js';
import { passesMarketCapFilter } from './antiNoiseFilter.js';
import { weightedFinalScore } from './weightedScore.js';
import { sortRanking } from './tieBreaker.js';
import { buildSimpleReasoning, buildDetailReasoning, disclaimerText } from './reasoningText.js';

/**
 * @typedef {object} CandidateRawData
 * @property {string} symbol - sudah di-stripSuffix, tanpa ".JK"
 * @property {string} companyName
 * @property {{date:string, open:number, close:number, volume:number, market_cap:number}[]} dailyHistory
 *   - hasil /v2/daily/{symbol}/, terurut TANGGAL NAIK (lama -> baru), elemen terakhir = hari ini
 * @property {{date:string, summary:{broker_code:string, bval:number, sval:number, nval:number,
 *   blot:number, slot:number, nlot:number}[]}[]} brokerSummaryByDate - hasil /v2/broker-summary/{symbol}/, `data`
 * @property {{date:string, net_foreign_inflow:number}[]} foreignFlowHistory - hasil /v2/foreign-flow/{symbol}/, `data`
 * @property {{title:string, source:string, timestamp:string, tags:string[], symbols:string[]}[]} newsArticles
 *   - hasil /v2/news/, `results`, SUDAH DIFILTER hanya artikel yang symbols-nya memuat kandidat ini
 * @property {Date|string} [now] - waktu acuan untuk time decay berita, default sekarang
 */

/**
 * @param {CandidateRawData} raw
 * @param {object} [config] - hasil loadScoringConfig(); default memuat dari file kalau tidak diberikan
 * @returns {{symbol:string, companyName:string, passesFilter:boolean, finalScore:number,
 *   scores:object, priceChangePct:number, volumeRatio:number, brokerConcentration:object,
 *   relatedNews:object[], netForeignInflowIdr:number, todayVolume:number,
 *   simpleReasoning:string, detailReasoning:string}}
 */
export function scoreCandidate(raw, config = loadScoringConfig()) {
  const today = raw.dailyHistory[raw.dailyHistory.length - 1];
  const priorDays = raw.dailyHistory.slice(0, -1);

  // --- Volume anomaly (SCORING_LOGIC.md §2.1) ---
  const priorVolumes = priorDays.map((d) => d.volume);
  const sma = smaVolume(priorVolumes, config.volumeAnomaly.smaWindowDays);
  const vRatio = calcVolumeRatio(today.volume, sma);
  const volumeScore = minMaxNormalize(
    today.volume,
    priorDays.slice(-config.normalisasi.volume.lookbackDays).map((d) => d.volume).concat(today.volume),
  );

  // --- Price change (SCORING_LOGIC.md §2.2) ---
  const priceChangePct = priceChangeFromOpen(today.close, today.open);

  // --- Broker flow (SCORING_LOGIC.md §3) ---
  const todayBrokerRows = raw.brokerSummaryByDate.find((d) => d.date === today.date)?.summary || [];
  const brokerConc = brokerConcentration(todayBrokerRows, config.brokerFlow.concentrationBasis);
  const brokerHistoryNet = raw.brokerSummaryByDate
    .slice(-config.normalisasi.brokerFlow.lookbackDays)
    .map((d) => (d.summary || []).reduce((a, r) => a + (r[config.brokerFlow.concentrationBasis === 'lot' ? 'nlot' : 'nval'] || 0), 0));
  const todayNetTotal = (todayBrokerRows || []).reduce(
    (a, r) => a + (r[config.brokerFlow.concentrationBasis === 'lot' ? 'nlot' : 'nval'] || 0),
    0,
  );
  const brokerFlowScore = minMaxNormalize(todayNetTotal, brokerHistoryNet.length ? brokerHistoryNet : [todayNetTotal]);

  // --- News sentiment (SCORING_LOGIC.md §5) ---
  const now = raw.now || new Date();
  const relevantArticles = raw.newsArticles.filter((a) => {
    const hrs = hoursSincePublished(a.timestamp, now);
    return hrs >= 0 && hrs <= 24 * 7; // di luar 7 hari diabaikan (bucket terakhir SCORING_LOGIC.md §5)
  });
  const articleScores = relevantArticles.map((a) =>
    scoreOneArticle(
      deriveBaseSentimentFromTags(a.tags),
      hoursSincePublished(a.timestamp, now),
      config.newsSentiment.timeDecayBuckets,
      config.newsSentiment.beyondBucketsWeight,
    ),
  );
  // Skala -1..1 (SCORING_LOGIC.md §5) dinormalisasi ke 0-100 di sini SEBELUM masuk ke
  // scores{} — supaya sebanding dengan volume/brokerFlow/foreignFlow (§1) dan bobot W3
  // di §4 berarti proporsional, bukan cuma dekoratif. Lihat komentar normalizeNewsScore().
  const newsScore = normalizeNewsScore(aggregateNewsScore(articleScores, config.newsSentiment.multiArticleAggregation));

  // --- Foreign flow (SCORING_LOGIC.md §1 & §4) ---
  const todayForeign = raw.foreignFlowHistory[raw.foreignFlowHistory.length - 1]?.net_foreign_inflow ?? 0;
  const foreignHistory = raw.foreignFlowHistory
    .slice(-config.normalisasi.foreignInflow.lookbackDays)
    .map((d) => d.net_foreign_inflow);
  const foreignFlowScore = minMaxNormalize(todayForeign, foreignHistory.length ? foreignHistory : [todayForeign]);

  // --- Weighted scoring (SCORING_LOGIC.md §4) ---
  const scores = { volume: volumeScore, brokerFlow: brokerFlowScore, news: newsScore, foreignFlow: foreignFlowScore };
  const finalScore = weightedFinalScore(scores, config.weightedScoring.weights);

  // --- Anti-noise filter (SCORING_LOGIC.md §3, sebelum output ranking) ---
  const passesFilter = passesMarketCapFilter(today.market_cap, config.antiNoiseFilter.minMarketCapBillionIdr);

  // --- Reasoning text (SCORING_LOGIC.md §7) ---
  const simpleReasoning = buildSimpleReasoning({
    companyName: raw.companyName,
    priceChangePct,
    scores,
    weights: config.weightedScoring.weights,
  });
  const detailReasoning = buildDetailReasoning({
    symbol: raw.symbol,
    companyName: raw.companyName,
    finalScore,
    scores,
    todayVolume: today.volume,
    volumeRatio: vRatio,
    brokerConcentration: brokerConc,
    relatedNews: relevantArticles,
    netForeignInflowIdr: todayForeign,
  });

  return {
    symbol: raw.symbol,
    companyName: raw.companyName,
    passesFilter,
    finalScore,
    scores,
    priceChangePct,
    volumeRatio: vRatio,
    brokerConcentration: brokerConc,
    relatedNews: relevantArticles,
    netForeignInflowIdr: todayForeign,
    todayVolume: today.volume,
    simpleReasoning,
    detailReasoning,
  };
}

/**
 * Jalankan scoreCandidate() untuk banyak kandidat sekaligus, buang yang tidak lolos
 * anti-noise filter, urutkan pakai tie-breaker, potong ke topN (CLAUDE.md §7),
 * dan tempel disclaimer wajib.
 *
 * PENTING (ditemukan lewat test-execute nyata di n8n, 27 Sep 2026, data real BEI 25 Sep 2026):
 * scoreCandidate() SATU kandidat bisa throw pada data nyata yang cacat (mis. `open: 0` pada
 * saham yang sempat suspensi sebagian hari — ditemukan pada PACK dan YULE) meski field lain
 * (close/high/low/volume/market_cap) valid. SEBELUM perbaikan ini, satu kandidat cacat
 * menggagalkan SELURUH watchlist harian (CLAUDE.md mewajibkan workflow "berjalan otonom" —
 * kegagalan total karena satu saham bermasalah tidak bisa diterima). Sekarang tiap kandidat
 * di-coba secara independen; yang gagal di-skip dan dicatat di `skipped`, kandidat lain tetap
 * diproses normal.
 *
 * @param {CandidateRawData[]} rawCandidates
 * @param {object} [config]
 * @returns {{generatedAt:string, disclaimer:string, watchlist:object[],
 *   skipped:{symbol:string, reason:string}[]}}
 */
export function buildDailyWatchlist(rawCandidates, config = loadScoringConfig()) {
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
      brokerConcentrationShare: c.brokerConcentration.topAccumulator?.netShare ?? 0,
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

export * from './normalize.js';
export * from './volumeAnomaly.js';
export * from './priceChange.js';
export * from './brokerFlow.js';
export * from './newsSentiment.js';
export * from './antiNoiseFilter.js';
export * from './weightedScore.js';
export * from './tieBreaker.js';
export * from './reasoningText.js';
export { loadScoringConfig, ScoringConfigIncompleteError } from './config.js';
