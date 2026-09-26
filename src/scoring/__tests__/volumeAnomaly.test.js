import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smaVolume, volumeRatio, isVolumeSignificant } from '../volumeAnomaly.js';

test('smaVolume: rata-rata n hari terakhir', () => {
  // SCORING_LOGIC.md §2.1: SMA(n) = (V1+...+Vn)/n
  const volumes = [100, 200, 300, 400, 500];
  assert.equal(smaVolume(volumes, 5), 300);
  assert.equal(smaVolume(volumes, 2), (400 + 500) / 2);
});

test('smaVolume: histori kurang dari n -> error jelas', () => {
  assert.throws(() => smaVolume([100, 200], 5), /histori tidak cukup/);
});

test('volumeRatio: volume hari ini dibagi SMA', () => {
  assert.equal(volumeRatio(600, 300), 2);
});

test('volumeRatio: SMA nol dan volume nol -> 0 (bukan NaN)', () => {
  assert.equal(volumeRatio(0, 0), 0);
});

test('volumeRatio: SMA nol, volume positif -> Infinity (anomali ekstrem)', () => {
  assert.equal(volumeRatio(500, 0), Infinity);
});

test('isVolumeSignificant: ratio > Y', () => {
  assert.equal(isVolumeSignificant(2.5, 2.0), true);
  assert.equal(isVolumeSignificant(2.0, 2.0), false); // strictly greater, bukan >=
  assert.equal(isVolumeSignificant(1.5, 2.0), false);
});
