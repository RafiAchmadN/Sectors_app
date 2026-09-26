import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveBaseSentimentFromTags,
  timeDecayWeight,
  hoursSincePublished,
  scoreOneArticle,
  aggregateNewsScore,
} from '../newsSentiment.js';

test('deriveBaseSentimentFromTags: Bullish -> 1, Bearish -> -1, tanpa tag arah -> 0', () => {
  assert.equal(deriveBaseSentimentFromTags(['Bullish', 'Politics & Regulation']), 1);
  assert.equal(deriveBaseSentimentFromTags(['Bearish', 'Risk & Compliance']), -1);
  assert.equal(deriveBaseSentimentFromTags(['Violation']), 0);
  assert.equal(deriveBaseSentimentFromTags([]), 0);
  assert.equal(deriveBaseSentimentFromTags(['Bullish', 'Bearish']), 0); // campur -> netral
});

const buckets = [
  { maxHours: 24, weight: 1.0 },
  { maxHours: 72, weight: 0.5 },
  { maxHours: 168, weight: 0.2 },
];

test('timeDecayWeight: sesuai tabel bucket SCORING_LOGIC.md §5', () => {
  assert.equal(timeDecayWeight(1, buckets, 0), 1.0); // dalam 24 jam
  assert.equal(timeDecayWeight(24, buckets, 0), 1.0); // tepat di batas -> masuk bucket ini
  assert.equal(timeDecayWeight(48, buckets, 0), 0.5); // 24-72 jam
  assert.equal(timeDecayWeight(100, buckets, 0), 0.2); // 72j-7hari
  assert.equal(timeDecayWeight(200, buckets, 0), 0); // >7 hari -> beyondBucketsWeight
});

test('timeDecayWeight: hoursAgo negatif -> error', () => {
  assert.throws(() => timeDecayWeight(-1, buckets, 0), /tidak boleh negatif/);
});

test('hoursSincePublished: menghitung selisih jam dengan benar', () => {
  const hrs = hoursSincePublished('2026-09-14T00:00:00', '2026-09-15T00:00:00');
  assert.equal(hrs, 24);
});

test('scoreOneArticle: Base Sentiment Score x Bobot Waktu', () => {
  assert.equal(scoreOneArticle(1, 1, buckets, 0), 1.0); // bullish, baru -> skor penuh
  assert.equal(scoreOneArticle(-1, 48, buckets, 0), -0.5); // bearish, 2 hari lalu
});

test('aggregateNewsScore: average', () => {
  assert.equal(aggregateNewsScore([1, 0.5, -0.5], 'average'), (1 + 0.5 - 0.5) / 3);
});

test('aggregateNewsScore: max berdasarkan magnitudo sinyal (bukan nilai numerik terbesar)', () => {
  // -0.9 adalah sinyal lebih kuat dari 0.1 meskipun nilai numeriknya lebih kecil
  assert.equal(aggregateNewsScore([0.1, -0.9, 0.3], 'max'), -0.9);
});

test('aggregateNewsScore: array kosong -> 0', () => {
  assert.equal(aggregateNewsScore([], 'average'), 0);
});

test('aggregateNewsScore: aggregation tidak dikenal -> error', () => {
  assert.throws(() => aggregateNewsScore([1], 'median'), /tidak dikenal/);
});
