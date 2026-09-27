import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadScoringConfig, ScoringConfigIncompleteError } from '../config.js';

test('loadScoringConfig: config/scoring.config.json asli sudah terisi lengkap (SCORING_LOGIC.md diisi 27 Sep 2026), tidak throw', () => {
  // Sebelum 27 Sep 2026 test ini menguji sebaliknya (memastikan guard aktif selama config
  // masih berisi null) — begitu tim mengisi semua angka, comment di versi lama file ini
  // bilang eksplisit test itu HARUS diupdate, ini update-nya.
  const cfg = loadScoringConfig();
  assert.equal(
    cfg.weightedScoring.weights.volume + cfg.weightedScoring.weights.brokerFlow +
    cfg.weightedScoring.weights.news + cfg.weightedScoring.weights.foreignFlow,
    100,
  );
});

test('loadScoringConfig: melaporkan path lengkap tiap field yang masih null (via config sintetis, bukan file asli)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scoring-config-test-'));
  const path = join(dir, 'still-incomplete.json');
  writeFileSync(
    path,
    JSON.stringify({
      volumeAnomaly: { smaWindowDays: null },
      weightedScoring: { weights: { volume: null } },
    }),
  );
  try {
    loadScoringConfig({ path });
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
