import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortRanking } from '../tieBreaker.js';

test('sortRanking: urut finalScore descending saat tidak ada seri', () => {
  const candidates = [
    { symbol: 'A', finalScore: 50 },
    { symbol: 'B', finalScore: 90 },
    { symbol: 'C', finalScore: 70 },
  ];
  const result = sortRanking(candidates, 'alphabetical_symbol');
  assert.deepEqual(result.map((c) => c.symbol), ['B', 'C', 'A']);
});

test('sortRanking: tie-breaker higher_volume_ratio dipakai hanya saat skor sama persis', () => {
  const candidates = [
    { symbol: 'A', finalScore: 80, volumeRatio: 1.5 },
    { symbol: 'B', finalScore: 80, volumeRatio: 3.0 },
    { symbol: 'C', finalScore: 90, volumeRatio: 1.0 }, // skor lebih tinggi, menang walau ratio rendah
  ];
  const result = sortRanking(candidates, 'higher_volume_ratio');
  assert.deepEqual(result.map((c) => c.symbol), ['C', 'B', 'A']);
});

test('sortRanking: tie-breaker alphabetical_symbol', () => {
  const candidates = [
    { symbol: 'ZULU', finalScore: 50 },
    { symbol: 'ALFA', finalScore: 50 },
  ];
  const result = sortRanking(candidates, 'alphabetical_symbol');
  assert.deepEqual(result.map((c) => c.symbol), ['ALFA', 'ZULU']);
});

test('sortRanking: rule tidak dikenal -> error', () => {
  assert.throws(() => sortRanking([{ symbol: 'A', finalScore: 1 }], 'random'), /tidak dikenal/);
});

test('sortRanking: tidak mengubah array asli (pure)', () => {
  const candidates = [
    { symbol: 'A', finalScore: 50 },
    { symbol: 'B', finalScore: 90 },
  ];
  const original = [...candidates];
  sortRanking(candidates, 'alphabetical_symbol');
  assert.deepEqual(candidates, original);
});
