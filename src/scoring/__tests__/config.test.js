import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadScoringConfig, ScoringConfigIncompleteError } from '../config.js';

test('loadScoringConfig: config/scoring.config.json asli memang masih ada null (belum diisi tim)', () => {
  // Ini BUKAN bug — ini bukti bahwa guard-nya aktif terhadap file config sesungguhnya.
  // Begitu tim mengisi semua angka, test ini akan gagal dan harus diupdate/dihapus —
  // itu sinyal yang diinginkan.
  assert.throws(() => loadScoringConfig(), ScoringConfigIncompleteError);
});

test('loadScoringConfig: melaporkan path lengkap tiap field yang masih null', () => {
  try {
    loadScoringConfig();
    assert.fail('harusnya throw');
  } catch (e) {
    assert.ok(e instanceof ScoringConfigIncompleteError);
    assert.ok(e.missingPaths.includes('volumeAnomaly.smaWindowDays'));
    assert.ok(e.missingPaths.includes('weightedScoring.weights.volume'));
  }
});

test('loadScoringConfig: field berawalan underscore (_ref, _readme) dikecualikan dari cek null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scoring-config-test-'));
  const path = join(dir, 'complete.json');
  writeFileSync(
    path,
    JSON.stringify({
      _readme: 'metadata, boleh berisi apa saja termasuk null tersirat',
      volumeAnomaly: { smaWindowDays: 20, _ref: 'catatan dokumentasi' },
    }),
  );
  assert.doesNotThrow(() => loadScoringConfig({ path }));
});

test('loadScoringConfig: satu field null di tengah struktur nested tetap terdeteksi', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scoring-config-test-'));
  const path = join(dir, 'partial.json');
  writeFileSync(
    path,
    JSON.stringify({
      weightedScoring: { weights: { volume: 40, brokerFlow: null, news: 10, foreignFlow: 20 } },
    }),
  );
  try {
    loadScoringConfig({ path });
    assert.fail('harusnya throw');
  } catch (e) {
    assert.deepEqual(e.missingPaths, ['weightedScoring.weights.brokerFlow']);
  }
});

test('loadScoringConfig: allowIncomplete melewati validasi (khusus kebutuhan test lain)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scoring-config-test-'));
  const path = join(dir, 'incomplete.json');
  writeFileSync(path, JSON.stringify({ foo: null }));
  assert.doesNotThrow(() => loadScoringConfig({ path, allowIncomplete: true }));
});
