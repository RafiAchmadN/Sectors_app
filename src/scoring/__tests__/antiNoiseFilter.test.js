import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passesMarketCapFilter, filterCandidatesByMarketCap } from '../antiNoiseFilter.js';

test('passesMarketCapFilter: konversi miliar IDR ke IDR penuh dengan benar', () => {
  // 5000 miliar = 5_000_000_000_000 IDR penuh
  assert.equal(passesMarketCapFilter(5_000_000_000_000, 5000), true);
  assert.equal(passesMarketCapFilter(4_999_999_999_999, 5000), false);
});

test('passesMarketCapFilter: tepat di batas -> lolos (>=, bukan >)', () => {
  assert.equal(passesMarketCapFilter(5_000_000_000_000, 5000), true);
});

test('filterCandidatesByMarketCap: membuang kandidat di bawah threshold', () => {
  const candidates = [
    { symbol: 'BIG', market_cap: 10_000_000_000_000 },
    { symbol: 'SMALL', market_cap: 100_000_000_000 },
  ];
  const result = filterCandidatesByMarketCap(candidates, 5000);
  assert.deepEqual(result.map((c) => c.symbol), ['BIG']);
});
