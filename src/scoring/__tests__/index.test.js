import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreCandidate, buildDailyWatchlist } from '../index.js';

/**
 * Config sintetis LENGKAP (tanpa null) khusus untuk test pipeline end-to-end.
 * Angka di sini BUKAN rekomendasi — murni supaya rumus bisa diuji tanpa menunggu
 * SCORING_LOGIC.md diisi tim. Jangan disalin ke config/scoring.config.json asli.
 */
const testConfig = {
  normalisasi: {
    volume: { lookbackDays: 5 },
    brokerFlow: { lookbackDays: 5 },
    foreignInflow: { lookbackDays: 5 },
  },
  volumeAnomaly: { smaWindowDays: 5, significantRatioThreshold: 1.5 },
  brokerFlow: { significantConcentrationPct: 20, concentrationBasis: 'value_idr' },
  antiNoiseFilter: { minMarketCapBillionIdr: 5000 },
  newsSentiment: {
    timeDecayBuckets: [
      { maxHours: 24, weight: 1.0 },
      { maxHours: 72, weight: 0.5 },
      { maxHours: 168, weight: 0.2 },
    ],
    beyondBucketsWeight: 0,
    multiArticleAggregation: 'average',
  },
  weightedScoring: { weights: { volume: 40, brokerFlow: 30, news: 10, foreignFlow: 20 } },
  tieBreaker: { rule: 'higher_volume_ratio' },
  output: { topN: 2 },
};

function makeDailyHistory({ days = 6, baseVolume = 1_000_000, todayVolume, baseClose = 1000, todayClose, marketCap = 10_000_000_000_000 }) {
  const history = [];
  for (let i = 0; i < days - 1; i++) {
    history.push({
      date: `2026-09-${String(1 + i).padStart(2, '0')}`,
      open: baseClose,
      close: baseClose,
      volume: baseVolume,
      market_cap: marketCap,
    });
  }
  history.push({
    date: '2026-09-14',
    open: baseClose,
    close: todayClose ?? baseClose,
    volume: todayVolume ?? baseVolume,
    market_cap: marketCap,
  });
  return history;
}

function makeCandidate(overrides = {}) {
  return {
    symbol: 'BBCA',
    companyName: 'PT Bank Central Asia Tbk',
    dailyHistory: makeDailyHistory({ todayVolume: 5_000_000, todayClose: 9500 }),
    brokerSummaryByDate: [
      {
        date: '2026-09-14',
        summary: [
          { broker_code: 'YP', bval: 100_000_000, sval: 10_000_000, nval: 90_000_000, blot: 100, slot: 10, nlot: 90 },
          { broker_code: 'MG', bval: 10_000_000, sval: 100_000_000, nval: -90_000_000, blot: 10, slot: 100, nlot: -90 },
        ],
      },
    ],
    foreignFlowHistory: [
      { date: '2026-09-10', net_foreign_inflow: 10_000_000_000 },
      { date: '2026-09-14', net_foreign_inflow: 50_000_000_000 },
    ],
    newsArticles: [
      { title: 'BBCA catat laba rekor', source: 'kontan.co.id', timestamp: '2026-09-14T06:00:00', tags: ['Bullish'], symbols: ['BBCA'] },
    ],
    now: new Date('2026-09-14T10:00:00Z'),
    ...overrides,
  };
}

test('scoreCandidate: pipeline lengkap menghasilkan seluruh field yang diharapkan', () => {
  const result = scoreCandidate(makeCandidate(), testConfig);
  assert.equal(result.symbol, 'BBCA');
  assert.equal(result.passesFilter, true); // market cap 10T >= 5000 miliar
  assert.ok(typeof result.finalScore === 'number' && !Number.isNaN(result.finalScore));
  assert.ok(result.simpleReasoning.startsWith('PT Bank Central Asia Tbk naik'));
  assert.match(result.detailReasoning, /BBCA/);
});

test('scoreCandidate: broker akumulasi dominan (YP) tercermin di brokerConcentration', () => {
  const result = scoreCandidate(makeCandidate(), testConfig);
  assert.equal(result.brokerConcentration.topAccumulator.broker_code, 'YP');
});

test('scoreCandidate: market cap di bawah threshold -> passesFilter false', () => {
  const candidate = makeCandidate({
    dailyHistory: makeDailyHistory({ todayVolume: 5_000_000, todayClose: 9500, marketCap: 100_000_000_000 }),
  });
  const result = scoreCandidate(candidate, testConfig);
  assert.equal(result.passesFilter, false);
});

test('scoreCandidate: berita di luar 7 hari diabaikan (SCORING_LOGIC.md §5)', () => {
  const candidate = makeCandidate({
    newsArticles: [
      { title: 'Berita lama', source: 'x', timestamp: '2026-08-01T00:00:00', tags: ['Bullish'], symbols: ['BBCA'] },
    ],
  });
  const result = scoreCandidate(candidate, testConfig);
  assert.equal(result.relatedNews.length, 0);
  assert.equal(result.scores.news, 0);
});

test('buildDailyWatchlist: membuang kandidat yang tidak lolos anti-noise filter', () => {
  const good = makeCandidate({ symbol: 'BIG' });
  const bad = makeCandidate({
    symbol: 'SMALL',
    dailyHistory: makeDailyHistory({ todayVolume: 5_000_000, todayClose: 9500, marketCap: 100_000_000_000 }),
  });
  const result = buildDailyWatchlist([good, bad], testConfig);
  assert.deepEqual(
    result.watchlist.map((c) => c.symbol),
    ['BIG'],
  );
});

test('buildDailyWatchlist: memotong ke topN dan menyertakan disclaimer', () => {
  const candidates = ['A', 'B', 'C'].map((symbol) => makeCandidate({ symbol }));
  const result = buildDailyWatchlist(candidates, testConfig);
  assert.equal(result.watchlist.length, 2); // topN = 2
  assert.match(result.disclaimer, /BUKAN rekomendasi/);
  assert.ok(result.generatedAt);
});
