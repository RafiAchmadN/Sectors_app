import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeZScore, isAnomaly } from '../anomalyDetection.js';

test('computeZScore: nilai persis di rata-rata -> z = 0', () => {
  const { zScore, mean, stdDev } = computeZScore(10, [8, 9, 10, 11, 12]);
  assert.equal(mean, 10);
  assert.ok(stdDev > 0);
  assert.equal(zScore, 0);
});

test('computeZScore: nilai jauh di atas histori -> z positif besar', () => {
  const { zScore } = computeZScore(100, [10, 10, 10, 10, 10, 10, 10, 10, 10, 20]);
  // mean=11, stdDev=3 -> z=(100-11)/3 ~ 29.67
  assert.ok(zScore > 5, `expected zScore > 5, got ${zScore}`);
});

test('computeZScore: nilai jauh di bawah histori -> z negatif besar', () => {
  const { zScore } = computeZScore(-50, [10, 10, 10, 10, 10]);
  assert.ok(zScore < -5, `expected zScore < -5, got ${zScore}`);
});

test('computeZScore: histori flat (stdDev=0) dan value sama -> z = 0, bukan NaN', () => {
  const { zScore, stdDev } = computeZScore(5, [5, 5, 5, 5]);
  assert.equal(stdDev, 0);
  assert.equal(zScore, 0);
});

test('computeZScore: histori flat (stdDev=0) dan value beda -> +Infinity (anomali jelas)', () => {
  const { zScore } = computeZScore(999, [5, 5, 5, 5]);
  assert.equal(zScore, Infinity);
});

test('computeZScore: histori flat dan value di bawah -> -Infinity', () => {
  const { zScore } = computeZScore(-1, [5, 5, 5, 5]);
  assert.equal(zScore, -Infinity);
});

test('computeZScore: histori kosong -> error jelas', () => {
  assert.throws(() => computeZScore(10, []), /tidak boleh kosong/);
});

test('isAnomaly: |z| di bawah threshold -> false', () => {
  assert.equal(isAnomaly(1.2, 1.5), false);
  assert.equal(isAnomaly(-1.2, 1.5), false);
});

test('isAnomaly: |z| tepat di threshold atau di atas -> true', () => {
  assert.equal(isAnomaly(1.5, 1.5), true);
  assert.equal(isAnomaly(-2.0, 1.5), true);
});

test('isAnomaly: +-Infinity selalu true berapapun threshold-nya', () => {
  assert.equal(isAnomaly(Infinity, 1.5), true);
  assert.equal(isAnomaly(-Infinity, 100), true);
});
