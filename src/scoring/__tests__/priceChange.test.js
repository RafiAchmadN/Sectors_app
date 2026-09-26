import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceChangeFromOpen, smaPrice } from '../priceChange.js';

test('priceChangeFromOpen: naik', () => {
  // SCORING_LOGIC.md §2.2: ((Close-Open)/Open) x 100
  assert.equal(priceChangeFromOpen(110, 100), 10);
});

test('priceChangeFromOpen: turun', () => {
  assert.equal(priceChangeFromOpen(90, 100), -10);
});

test('priceChangeFromOpen: open nol -> error (bukan Infinity diam-diam)', () => {
  assert.throws(() => priceChangeFromOpen(100, 0), /tidak boleh 0/);
});

test('smaPrice: sama seperti smaVolume tapi untuk harga close', () => {
  assert.equal(smaPrice([10, 20, 30], 3), 20);
});
