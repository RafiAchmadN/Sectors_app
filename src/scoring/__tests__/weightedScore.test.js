import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weightedFinalScore } from '../weightedScore.js';

test('weightedFinalScore: rumus SCORING_LOGIC.md §4 persis', () => {
  const scores = { volume: 80, brokerFlow: 60, news: 0.5, foreignFlow: 40 };
  const weights = { volume: 40, brokerFlow: 30, news: 10, foreignFlow: 20 };
  const expected = (40 * 80 + 30 * 60 + 10 * 0.5 + 20 * 40) / 100;
  assert.equal(weightedFinalScore(scores, weights), expected);
});

test('weightedFinalScore: bobot tidak berjumlah 100 -> error', () => {
  const scores = { volume: 50, brokerFlow: 50, news: 0, foreignFlow: 50 };
  const weights = { volume: 40, brokerFlow: 30, news: 10, foreignFlow: 10 }; // total 90
  assert.throws(() => weightedFinalScore(scores, weights), /total bobot harus 100/);
});

test('weightedFinalScore: toleransi floating point kecil pada total 100', () => {
  const scores = { volume: 50, brokerFlow: 50, news: 0, foreignFlow: 50 };
  const weights = { volume: 33.34, brokerFlow: 33.33, news: 16.66, foreignFlow: 16.67 }; // total 100.00 (rounding)
  assert.doesNotThrow(() => weightedFinalScore(scores, weights));
});
