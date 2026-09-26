import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brokerConcentration, isBrokerFlowSignificant } from '../brokerFlow.js';

// Data sintetis meniru bentuk data[].summary[] dari /v2/broker-summary/{symbol}/
const sampleRows = [
  { broker_code: 'YP', bval: 100_000_000, sval: 10_000_000, nval: 90_000_000, blot: 100, slot: 10, nlot: 90 },
  { broker_code: 'MG', bval: 20_000_000, sval: 80_000_000, nval: -60_000_000, blot: 20, slot: 80, nlot: -60 },
  { broker_code: 'CC', bval: 30_000_000, sval: 30_000_000, nval: 0, blot: 30, slot: 30, nlot: 0 },
];

test('brokerConcentration: basis value_idr, total buy/sell benar', () => {
  const c = brokerConcentration(sampleRows, 'value_idr');
  assert.equal(c.totalBuy, 150_000_000);
  assert.equal(c.totalSell, 120_000_000);
});

test('brokerConcentration: broker net terbesar positif jadi topAccumulator', () => {
  const c = brokerConcentration(sampleRows, 'value_idr');
  assert.equal(c.topAccumulator.broker_code, 'YP');
  // share = net / totalActivity(buy+sell) x 100
  const totalActivity = 150_000_000 + 120_000_000;
  assert.equal(c.topAccumulator.netShare, (90_000_000 / totalActivity) * 100);
});

test('brokerConcentration: broker net terkecil negatif jadi topDistributor', () => {
  const c = brokerConcentration(sampleRows, 'value_idr');
  assert.equal(c.topDistributor.broker_code, 'MG');
  assert.ok(c.topDistributor.netShare < 0);
});

test('brokerConcentration: basis lot menghasilkan angka berbeda dari basis value_idr', () => {
  const rowsHighPrice = [
    { broker_code: 'A', bval: 1_000_000_000, sval: 0, nval: 1_000_000_000, blot: 10, slot: 0, nlot: 10 },
    { broker_code: 'B', bval: 0, sval: 100_000_000, nval: -100_000_000, blot: 0, slot: 50, nlot: -50 },
  ];
  const byValue = brokerConcentration(rowsHighPrice, 'value_idr');
  const byLot = brokerConcentration(rowsHighPrice, 'lot');
  assert.equal(byValue.topAccumulator.broker_code, 'A'); // A dominan secara nilai rupiah
  assert.equal(byLot.topAccumulator.broker_code, 'A'); // A juga dominan secara lot di kasus ini
  // tapi proporsinya (netShare) berbeda karena basis penyebutnya beda
  assert.notEqual(byValue.topAccumulator.netShare, byLot.topAccumulator.netShare);
});

test('brokerConcentration: basis tidak dikenal -> error', () => {
  assert.throws(() => brokerConcentration(sampleRows, 'invalid'), /basis tidak dikenal/);
});

test('brokerConcentration: array kosong -> tidak error, semua netral', () => {
  const c = brokerConcentration([], 'value_idr');
  assert.equal(c.topAccumulator, null);
  assert.equal(c.topDistributor, null);
});

test('isBrokerFlowSignificant: melebihi threshold Z -> signifikan', () => {
  const c = brokerConcentration(sampleRows, 'value_idr');
  const result = isBrokerFlowSignificant(c, 10); // Z=10%
  assert.equal(result.significant, true);
  assert.equal(result.direction, 'accumulation');
});

test('isBrokerFlowSignificant: di bawah threshold Z -> tidak signifikan', () => {
  const c = brokerConcentration(sampleRows, 'value_idr');
  const result = isBrokerFlowSignificant(c, 90); // Z sangat tinggi
  assert.equal(result.significant, false);
});
