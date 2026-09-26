/**
 * Loader config/scoring.config.json dengan validasi tegas: menolak jalan selama
 * masih ada angka bernilai null. Ini sengaja dibuat keras — tujuannya supaya
 * tidak ada angka tebakan yang diam-diam terpakai di produksi (lihat catatan
 * di scoring.config.json._readme).
 *
 * Kunci yang diawali underscore (mis. `_ref`, `_readme`) adalah metadata/dokumentasi,
 * bukan angka scoring, dan dikecualikan dari pengecekan null.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = join(__dirname, '../../config/scoring.config.json');

export class ScoringConfigIncompleteError extends Error {
  constructor(missingPaths) {
    super(
      `SCORING_LOGIC.md belum diisi lengkap. ${missingPaths.length} angka masih kosong (null) ` +
        `di config/scoring.config.json:\n` +
        missingPaths.map((p) => `  - ${p}`).join('\n') +
        `\n\nIsi angkanya di SCORING_LOGIC.md, salin ke config/scoring.config.json, ` +
        `lalu catat perubahannya di bagian "Riwayat Perubahan Angka".`,
    );
    this.name = 'ScoringConfigIncompleteError';
    this.missingPaths = missingPaths;
  }
}

function findNulls(value, path = '') {
  const missing = [];
  if (value === null) {
    missing.push(path || '(root)');
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => missing.push(...findNulls(v, `${path}[${i}]`)));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith('_')) continue; // metadata/dokumentasi, bukan angka scoring
      missing.push(...findNulls(v, path ? `${path}.${k}` : k));
    }
  }
  return missing;
}

/**
 * @param {object} [opts]
 * @param {string} [opts.path] - path alternatif ke file config (dipakai unit test)
 * @param {boolean} [opts.allowIncomplete] - lewati validasi null (HANYA untuk unit test rumus individual)
 */
export function loadScoringConfig(opts = {}) {
  const path = opts.path || DEFAULT_PATH;
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  if (!opts.allowIncomplete) {
    const missing = findNulls(raw);
    if (missing.length) throw new ScoringConfigIncompleteError(missing);
  }
  return raw;
}
