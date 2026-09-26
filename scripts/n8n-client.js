#!/usr/bin/env node
/**
 * Klien tipis untuk REST API n8n (bukan public API v1 Sectors — jangan tertukar).
 * Dipakai untuk mendorong/memperbarui workflow secara programatik ke instance n8n lokal
 * (docker-compose di /home/rafiachn/n8n), supaya iterasi tidak bergantung pada import manual.
 *
 * Auth: header `X-N8N-API-KEY: <key>`, dibuat lewat n8n UI -> Settings -> n8n API.
 * Referensi: https://docs.n8n.io/api/
 */
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

function loadDotEnv(file = '.env') {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadDotEnv();

const BASE_URL = (process.env.N8N_BASE_URL || 'http://localhost:5678').replace(/\/$/, '');
const API_KEY = process.env.N8N_API_KEY;

function assertKey() {
  if (!API_KEY) {
    throw new Error(
      'N8N_API_KEY belum diisi di .env. Buat lewat n8n UI -> Settings -> n8n API -> Create an API key.',
    );
  }
}

async function n8nFetch(path, opts = {}) {
  assertKey();
  const res = await fetch(`${BASE_URL}/api/v1${path}`, {
    ...opts,
    headers: { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const msg = body?.message || (typeof body === 'string' ? body : JSON.stringify(body));
    throw new Error(`n8n API ${opts.method || 'GET'} ${path} -> HTTP ${res.status}: ${msg}`);
  }
  return body;
}

export const listWorkflows = () => n8nFetch('/workflows');
export const getWorkflow = (id) => n8nFetch(`/workflows/${id}`);
export const createWorkflow = (workflow) => n8nFetch('/workflows', { method: 'POST', body: JSON.stringify(workflow) });
export const updateWorkflow = (id, workflow) => n8nFetch(`/workflows/${id}`, { method: 'PUT', body: JSON.stringify(workflow) });
export const activateWorkflow = (id) => n8nFetch(`/workflows/${id}/activate`, { method: 'POST' });
export const deactivateWorkflow = (id) => n8nFetch(`/workflows/${id}/deactivate`, { method: 'POST' });

/**
 * Upsert berdasarkan nama: update jika workflow dengan nama sama sudah ada, buat baru jika belum.
 * Menghindari duplikat workflow tiap kali script deploy dijalankan ulang saat iterasi.
 */
export async function upsertWorkflowByName(workflow) {
  const { data } = await listWorkflows();
  const existing = data.find((w) => w.name === workflow.name);
  if (existing) {
    console.log(`Update workflow existing: "${workflow.name}" (id=${existing.id})`);
    return updateWorkflow(existing.id, workflow);
  }
  console.log(`Buat workflow baru: "${workflow.name}"`);
  return createWorkflow(workflow);
}

// Jalankan langsung: node scripts/n8n-client.js  -> tes koneksi + list workflow
// Dibandingkan lewat pathToFileURL (bukan string `file://${argv[1]}`) karena path proyek ini
// mengandung spasi, yang di-percent-encode oleh import.meta.url tapi tidak oleh argv mentah.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assertKey();
    const { data } = await listWorkflows();
    console.log(`Koneksi n8n OK -> ${BASE_URL}`);
    console.log(`Workflow tersimpan: ${data.length}`);
    for (const w of data) console.log(`  - [${w.active ? 'aktif' : 'nonaktif'}] ${w.name} (id=${w.id})`);
  } catch (e) {
    console.error(`Koneksi n8n GAGAL: ${e.message}`);
    process.exit(1);
  }
}
