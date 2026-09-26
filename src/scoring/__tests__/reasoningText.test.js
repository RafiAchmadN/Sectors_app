import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dominantFactor, buildSimpleReasoning, buildDetailReasoning, disclaimerText } from '../reasoningText.js';

const weights = { volume: 40, brokerFlow: 30, news: 10, foreignFlow: 20 };

test('dominantFactor: memilih kontribusi tertimbang terbesar, bukan skor mentah terbesar', () => {
  // brokerFlow skor mentah lebih besar (90) tapi bobotnya kecil (10);
  // volume skor lebih kecil (70) tapi bobotnya besar (40) -> volume menang secara kontribusi
  const scores = { volume: 70, brokerFlow: 90, news: 0, foreignFlow: 0 };
  const w = { volume: 40, brokerFlow: 10, news: 25, foreignFlow: 25 };
  assert.equal(dominantFactor(scores, w), 'volume'); // 40*70=2800 vs 10*90=900
});

test('buildSimpleReasoning: mengikuti kerangka SCORING_LOGIC.md §7 persis', () => {
  const scores = { volume: 90, brokerFlow: 20, news: 0.1, foreignFlow: 10 };
  const text = buildSimpleReasoning({ companyName: 'PT Bank Central Asia Tbk', priceChangePct: 3.456, scores, weights });
  assert.equal(text, 'PT Bank Central Asia Tbk naik 3.46% didukung oleh lonjakan volume transaksi.');
});

test('buildSimpleReasoning: harga turun -> kata "turun", persentase absolut', () => {
  const scores = { volume: 90, brokerFlow: 20, news: 0.1, foreignFlow: 10 };
  const text = buildSimpleReasoning({ companyName: 'XYZ', priceChangePct: -5, scores, weights });
  assert.match(text, /^XYZ turun 5\.00%/);
});

test('buildDetailReasoning: memuat seluruh elemen wajib SCORING_LOGIC.md §7', () => {
  const text = buildDetailReasoning({
    symbol: 'BBCA',
    companyName: 'PT Bank Central Asia Tbk',
    finalScore: 75.5,
    scores: { volume: 90, brokerFlow: 20, news: 0.1, foreignFlow: 10 },
    todayVolume: 92_219_000,
    volumeRatio: 2.1,
    brokerConcentration: { topAccumulator: { broker_code: 'YP', netShare: 35.2 }, topDistributor: null },
    relatedNews: [{ title: 'BBCA catat laba rekor', source: 'kontan.co.id' }],
    netForeignInflowIdr: 199_859_810_000,
  });
  assert.match(text, /BBCA/);
  assert.match(text, /skor 90\.0/); // skor volume
  assert.match(text, /92\.219\.000|92,219,000/); // angka volume (locale bisa beda titik/koma)
  assert.match(text, /YP/); // broker flow
  assert.match(text, /BBCA catat laba rekor/); // judul berita
  assert.match(text, /kontan\.co\.id/);
  assert.match(text, /foreign inflow/i); // angka foreign inflow disebutkan
});

test('buildDetailReasoning: tidak ada berita relevan -> tetap tidak error', () => {
  const text = buildDetailReasoning({
    symbol: 'XYZ',
    companyName: 'XYZ',
    finalScore: 10,
    scores: { volume: 10, brokerFlow: 10, news: 0, foreignFlow: 10 },
    todayVolume: 1000,
    volumeRatio: 1,
    brokerConcentration: { topAccumulator: null, topDistributor: null },
    relatedNews: [],
    netForeignInflowIdr: 0,
  });
  assert.match(text, /tidak ada berita relevan/);
});

test('disclaimerText: menyatakan eksplisit bukan rekomendasi investasi (CLAUDE.md §2)', () => {
  const text = disclaimerText();
  assert.match(text, /BUKAN rekomendasi/);
  assert.match(text, /nasihat keuangan/);
});
