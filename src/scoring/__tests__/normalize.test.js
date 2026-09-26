import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minMaxNormalize } from '../normalize.js';

test('minMaxNormalize: nilai di tengah histori -> skor di tengah 0-100', () => {
  const score = minMaxNormalize(50, [0, 25, 50, 75, 100]);
  assert.equal(score, 50);
});

test('minMaxNormalize: nilai minimum -> 0', () => {
  assert.equal(minMaxNormalize(10, [10, 20, 30]), 0);
});

test('minMaxNormalize: nilai maksimum -> 100', () => {
  assert.equal(minMaxNormalize(30, [10, 20, 30]), 100);
});

test('minMaxNormalize: seluruh histori nilai sama -> 50 (titik tengah, bukan 0/100)', () => {
  assert.equal(minMaxNormalize(42, [42, 42, 42]), 50);
});

test('minMaxNormalize: histori kosong -> error', () => {
  assert.throws(() => minMaxNormalize(10, []), /tidak boleh kosong/);
});

test('minMaxNormalize: rumus SCORING_LOGIC.md §1 persis', () => {
  // Skor = (Nilai - Min) / (Max - Min) x 100
  const value = 70;
  const history = [10, 20, 70, 90];
  const expected = ((70 - 10) / (90 - 10)) * 100;
  assert.equal(minMaxNormalize(value, history), expected);
});
