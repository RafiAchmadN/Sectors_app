#!/usr/bin/env node
/**
 * Verifikasi manual seluruh endpoint Sectors API v2 yang dipakai workflow.
 * Memenuhi CLAUDE.md §8 (Checklist Testing API) — dijalankan SEBELUM build ke n8n.
 *
 * Yang dicek per endpoint:
 *   1. Status HTTP + latensi
 *   2. Struktur response JSON aktual (peta key -> tipe), bukan asumsi dari dokumentasi
 *   3. Field yang kosong / null pada data nyata
 *   4. Header rate limit / kuota yang dikembalikan server
 *   5. Estimasi biaya credit per panggilan
 *
 * Jalankan: SECTORS_API_KEY=xxx npm run verify:api
 * Opsi:     --date=YYYY-MM-DD   --symbol=BBCA   --broker=YP   --dry-run
 *
 * Output:   out/api-samples/<endpoint>.json  (response mentah)
 *           docs/API_VERIFICATION.md         (laporan, aman untuk di-commit)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { BASE_URL, ENDPOINTS, lastTradingDay, stripSuffix } from '../config/sectors-endpoints.js';

// ---------- argumen & env ----------
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

loadDotEnv('.env');
const API_KEY = process.env.SECTORS_API_KEY;
const DRY_RUN = Boolean(args['dry-run']);

if (!API_KEY && !DRY_RUN) {
  console.error(
    '\nSECTORS_API_KEY belum diisi.\n' +
      '  1. Salin .env.example menjadi .env\n' +
      '  2. Isi SECTORS_API_KEY dari https://sectors.app/api (plan Insider)\n' +
      '  3. Jalankan ulang: npm run verify:api\n' +
      '\nUntuk melihat rencana panggilan tanpa memakai credit: npm run verify:api -- --dry-run\n',
  );
  process.exit(1);
}

const DATE = args.date || lastTradingDay();
const OUT_DIR = 'out/api-samples';
mkdirSync(OUT_DIR, { recursive: true });

// ---------- pemanggil HTTP ----------
const results = [];
let creditsUsed = 0;

async function probe(name, { pathParams = {}, queryOverride = {} } = {}) {
  const def = ENDPOINTS[name];
  const ctx = { date: DATE, ...pathParams };
  const baseQuery =
    typeof def.defaultQuery === 'function' ? def.defaultQuery(ctx) : { ...def.defaultQuery };
  const query = { ...baseQuery, ...queryOverride };
  const url = `${BASE_URL}${def.path(ctx)}?${new URLSearchParams(query)}`;
  const cost = def.creditCost(query);

  if (DRY_RUN) {
    console.log(`[dry-run] ${def.label.padEnd(45)} ${cost} credit  ${url}`);
    results.push({ name, label: def.label, url, cost, status: 'DRY_RUN' });
    creditsUsed += cost;
    return null;
  }

  const started = Date.now();
  let res, body, err = null;
  try {
    res = await fetch(url, { headers: { Authorization: API_KEY } });
    const text = await res.text();
    try {
      body = JSON.parse(text);
    } catch {
      body = text.slice(0, 500);
      err = 'Response bukan JSON valid';
    }
  } catch (e) {
    err = e.message;
  }
  const ms = Date.now() - started;

  const ok = res?.ok === true && !err;
  if (res && res.status !== 429) creditsUsed += cost;

  const record = {
    name,
    label: def.label,
    stage: def.stage,
    url,
    cost,
    status: res?.status ?? 'NETWORK_ERROR',
    ms,
    error: err || (ok ? null : summarizeError(body)),
    rateHeaders: res ? pickRateHeaders(res.headers) : {},
    shape: ok ? shapeOf(body) : null,
    emptyFields: ok ? emptyFieldReport(body) : null,
    itemCount: ok ? countItems(body) : null,
  };
  results.push(record);

  if (ok) writeFileSync(`${OUT_DIR}/${name}.json`, JSON.stringify(body, null, 2));

  const mark = ok ? 'OK  ' : 'FAIL';
  console.log(`${mark} ${String(record.status).padEnd(4)} ${String(ms + 'ms').padEnd(7)} ${def.label}${ok ? '' : '  -> ' + record.error}`);
  return ok ? body : null;
}

// ---------- utilitas analisa response ----------
function pickRateHeaders(headers) {
  const out = {};
  for (const [k, v] of headers.entries()) {
    if (/rate|limit|quota|credit|retry/i.test(k)) out[k] = v;
  }
  return out;
}

function summarizeError(body) {
  if (!body) return 'tanpa body';
  if (typeof body === 'string') return body.slice(0, 200);
  return [body.error, body.message].filter(Boolean).join(' — ') || JSON.stringify(body).slice(0, 200);
}

/** Peta struktur response menjadi daftar "path: tipe", array diwakili elemen pertama. */
function shapeOf(value, prefix = '', depth = 0, acc = {}) {
  if (depth > 4) return acc;
  if (Array.isArray(value)) {
    acc[`${prefix}[]`] = `array(${value.length})`;
    if (value.length) shapeOf(value[0], `${prefix}[]`, depth + 1, acc);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object') shapeOf(v, p, depth + 1, acc);
      else acc[p] = v === null ? 'null' : typeof v;
    }
  } else {
    acc[prefix || '(root)'] = value === null ? 'null' : typeof value;
  }
  return acc;
}

/** Cari field yang null / string kosong / array kosong pada data nyata (CLAUDE.md §8 poin 4). */
function emptyFieldReport(body, prefix = '', depth = 0, acc = {}) {
  if (depth > 4 || body == null) return acc;
  if (Array.isArray(body)) {
    body.slice(0, 20).forEach((item) => emptyFieldReport(item, `${prefix}[]`, depth + 1, acc));
  } else if (typeof body === 'object') {
    for (const [k, v] of Object.entries(body)) {
      const p = prefix ? `${prefix}.${k}` : k;
      const isEmpty = v === null || v === '' || (Array.isArray(v) && v.length === 0);
      if (isEmpty) acc[p] = (acc[p] || 0) + 1;
      else if (v && typeof v === 'object') emptyFieldReport(v, p, depth + 1, acc);
    }
  }
  return acc;
}

function countItems(body) {
  if (Array.isArray(body)) return body.length;
  if (body && typeof body === 'object') {
    if (Array.isArray(body.results)) return body.results.length;
    if (Array.isArray(body.data)) return body.data.length;
    const firstArray = Object.values(body).find(Array.isArray);
    if (firstArray) return firstArray.length;
  }
  return null;
}

function loadDotEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// ---------- alur verifikasi ----------
console.log(`\nVerifikasi Sectors API v2 — tanggal acuan ${DATE}${DRY_RUN ? ' (dry-run, tidak memakai credit)' : ''}\n`);

// Tahap 1: kandidat. Simbol hasil tahap ini dipakai untuk menguji endpoint tahap 2.
const topChanges = await probe('topChanges');
const mostTraded = await probe('mostTraded');

const symbol =
  args.symbol ||
  firstSymbol(mostTraded) ||
  firstSymbol(topChanges) ||
  'BBCA'; // fallback saat pasar libur / response kosong
const brokerCode = args.broker || 'YP';

console.log(`\nSimbol uji tahap 2: ${symbol} | broker uji: ${brokerCode}\n`);

// Tahap 2: enrichment.
await probe('daily', { pathParams: { symbol } });
await probe('brokerSummary', { pathParams: { symbol } });
await probe('brokerActivityTop', { pathParams: { brokerCode } });
await probe('foreignFlow', { pathParams: { symbol } });
await probe('news', { queryOverride: { symbols: symbol } }); // di produksi: seluruh kandidat sekaligus

function firstSymbol(body) {
  if (!body || typeof body !== 'object') return null;
  const buckets = Object.values(body);
  for (const b of buckets) {
    if (Array.isArray(b) && b[0]?.symbol) return stripSuffix(b[0].symbol);
    if (b && typeof b === 'object') {
      for (const inner of Object.values(b)) {
        if (Array.isArray(inner) && inner[0]?.symbol) return stripSuffix(inner[0].symbol);
      }
    }
  }
  return null;
}

// ---------- laporan ----------
const failed = results.filter((r) => r.status !== 200 && r.status !== 'DRY_RUN');
writeFileSync('docs/API_VERIFICATION.md', buildReport());
console.log(`\nEstimasi credit terpakai: ${creditsUsed}`);
console.log(`Laporan: docs/API_VERIFICATION.md | Response mentah: ${OUT_DIR}/`);
console.log(failed.length ? `\n${failed.length} endpoint GAGAL — perbaiki sebelum build ke n8n.\n` : '\nSeluruh endpoint lolos verifikasi.\n');
process.exit(failed.length ? 1 : 0);

function buildReport() {
  const lines = [];
  lines.push('# Laporan Verifikasi API (CLAUDE.md §8)');
  lines.push('');
  lines.push('File ini dihasilkan otomatis oleh `npm run verify:api`. Jangan diedit manual.');
  lines.push('');
  lines.push(`- Dijalankan: ${new Date().toISOString()}`);
  lines.push(`- Tanggal acuan data: ${DATE}`);
  lines.push(`- Base URL: \`${BASE_URL}\` (v1 sudah dimatikan 2026-05-11, seluruh /v1/* -> HTTP 410)`);
  lines.push('- Autentikasi: header `Authorization: <API_KEY>`, raw tanpa prefix `Bearer`');
  lines.push(`- Estimasi credit terpakai pada run ini: ${creditsUsed}`);
  lines.push('');
  lines.push('## Ringkasan');
  lines.push('');
  lines.push('| Endpoint | Tahap | Status | Latensi | Jumlah item | Credit |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of results) {
    lines.push(`| ${r.label} | ${r.stage ?? '-'} | ${r.status} | ${r.ms ? r.ms + ' ms' : '-'} | ${r.itemCount ?? '-'} | ${r.cost} |`);
  }
  lines.push('');
  for (const r of results) {
    lines.push(`## ${r.label}`);
    lines.push('');
    lines.push(`\`${r.url.replace(/([?&])/g, '$1')}\``);
    lines.push('');
    if (r.error) {
      lines.push(`**GAGAL (${r.status}):** ${r.error}`);
      lines.push('');
      continue;
    }
    if (Object.keys(r.rateHeaders || {}).length) {
      lines.push('Header kuota/rate limit dari server:');
      lines.push('');
      for (const [k, v] of Object.entries(r.rateHeaders)) lines.push(`- \`${k}: ${v}\``);
      lines.push('');
    } else {
      lines.push('Server tidak mengirim header rate limit pada response ini.');
      lines.push('');
    }
    lines.push('Struktur JSON aktual:');
    lines.push('');
    lines.push('```');
    for (const [k, v] of Object.entries(r.shape || {})) lines.push(`${k}: ${v}`);
    lines.push('```');
    lines.push('');
    const empties = Object.entries(r.emptyFields || {});
    if (empties.length) {
      lines.push('Field kosong/null yang ditemukan pada data nyata (wajib ditangani di workflow):');
      lines.push('');
      for (const [k, n] of empties) lines.push(`- \`${k}\` — kosong pada ${n} kemunculan`);
    } else {
      lines.push('Tidak ada field kosong/null pada sampel ini.');
    }
    lines.push('');
  }
  return lines.join('\n');
}
