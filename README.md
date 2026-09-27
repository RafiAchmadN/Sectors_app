# Sectors Daily Watchlist Workflow

Workflow otomatis yang menyederhanakan data pasar saham Indonesia menjadi ranking watchlist
harian untuk investor retail, dikirim ke Telegram setiap pagi sebelum pasar dibuka, dengan
salinan rekap tersimpan di Google Sheets sebagai audit trail.
Dibangun untuk **Sectors Hackathon 2026 — track Automation and Workflows**.

> **Disclaimer:** produk ini adalah alat informasi dan analisis data pasar, **bukan rekomendasi
> investasi atau nasihat keuangan**. Tidak ada eksekusi transaksi otomatis dalam bentuk apapun.
> Disclaimer ini juga tercantum otomatis di setiap pesan Telegram yang dikirim workflow.

## Status: pipeline penuh sudah dibangun dan teruji end-to-end

Seluruh 4 tahap alur (fetch kandidat → enrichment → scoring → delivery) sudah dibangun sebagai
workflow n8n dan **terbukti berjalan nyata** lewat beberapa kali eksekusi uji langsung terhadap
Sectors API asli — bukan simulasi. Rincian tahap ada di bagian "Cara Kerja" di bawah.

Yang masih tersisa sebelum submission: aktivasi jadwal otomatis (Schedule Trigger) dan
mengumpulkan bukti log run otonom selama beberapa hari (CLAUDE.md §6).

## Cara kerja

1. **Scheduler** memicu workflow tiap pagi hari kerja (07:30 WIB, Senin-Jumat).
2. **Tahap 1 — Fetch kandidat**: ambil Top Company Movers + Most Traded Stocks dari Sectors API,
   gabung dan dedupe jadi satu daftar kandidat saham harian.
3. **Tahap 2 — Enrichment**: untuk tiap kandidat, ambil Daily Transaction Data, Broker Summary,
   dan Daily Net Foreign Inflow; ambil News Articles satu kali untuk semua kandidat sekaligus
   (hemat credit) lalu disebar ke kandidat yang relevan.
4. **Tahap 3 — Scoring**: hitung skor volume anomaly, broker flow, sentimen berita, dan foreign
   flow per kandidat, gabungkan jadi skor akhir berbobot, susun ranking top-N beserta alasan
   tertulis (mode simple & detail). Kandidat dengan data cacat di-skip tanpa menggagalkan yang
   lain (lihat `SCORING_LOGIC.md`, riwayat 27 Sep 2026).
5. **Tahap 4 — Delivery**: kirim ringkasan ke Telegram (mode simple + link ke Google Sheet untuk
   detail + disclaimer wajib) dan catat satu baris per saham watchlist ke Google Sheets sebagai
   rekap harian. Kedua delivery berjalan independen — kegagalan salah satu tidak menggagalkan
   yang lain.

Rumus, threshold, dan bobot scoring yang dipakai (beserta alasan tiap angka) ada di
`SCORING_LOGIC.md`. Constraint kompetisi dan keputusan arah produk ada di `CLAUDE.md`.

## Struktur repo

| Path | Isi |
|---|---|
| `CLAUDE.md` | Memori referensi utama proyek: tujuan, constraint kompetisi, arah produk yang sudah difiksasi |
| `SCORING_LOGIC.md` | Rumus, threshold, dan bobot scoring — sudah terisi lengkap, riwayat tiap angka dicatat |
| `config/sectors-endpoints.js` | Katalog endpoint Sectors API v2 beserta parameter dan biaya credit |
| `config/scoring.config.json` | Angka scoring final (sinkron dengan `SCORING_LOGIC.md`) |
| `src/scoring/` | Scoring engine JS murni, 63 unit test (`npm test`) |
| `scripts/verify-api.js` | Verifikasi manual seluruh endpoint Sectors API (CLAUDE.md §8) |
| `scripts/n8n-client.js` | Klien tipis REST API n8n, dipakai skrip deploy di bawah |
| `scripts/deploy-stage1-workflow.js` | Deploy node Tahap 1 (fetch kandidat) ke n8n |
| `scripts/deploy-stage2-workflow.js` | Tambah node Tahap 2 (enrichment) — loop per kandidat + batch News |
| `scripts/deploy-stage3-workflow.js` | Tambah node Tahap 3 (scoring engine, inline dari `src/scoring/`) |
| `scripts/deploy-stage4-workflow.js` | Tambah node Tahap 4 (delivery Telegram + logging Sheets) |
| `docs/API_FINDINGS.md` | Temuan API yang mempengaruhi perencanaan, termasuk batasan tak terduga (lihat §1.3d) |
| `docs/API_VERIFICATION.md` | Laporan hasil verifikasi terhadap data nyata (dihasilkan otomatis) |

## Menjalankan verifikasi API

```bash
cp .env.example .env          # lalu isi seluruh kredensial (lihat daftar di bawah)
npm run verify:api            # memakai credit asli, ~9-16 credit tergantung tanggal
npm run verify:api -- --dry-run   # lihat rencana panggilan tanpa memakai credit
```

Opsi: `--date=YYYY-MM-DD`, `--symbol=BBCA`, `--broker=YP`.

Hasil: laporan di `docs/API_VERIFICATION.md`, response mentah di `out/api-samples/`
(tidak di-commit).

**Kuota credit terbatas (1.000 total per tim, sekali habis untuk seluruh kompetisi)** — jangan
jalankan `verify:api` atau trigger eksekusi n8n berulang-ulang tanpa perlu. Kembangkan logika
scoring di atas fixture `out/api-samples/`, bukan API langsung.

## Menjalankan unit test scoring engine

```bash
npm test    # 0 credit, memakai data mock — 63 test
```

## Membangun workflow n8n dari nol

Jalankan berurutan (masing-masing idempotent, aman dijalankan ulang untuk update):

```bash
node scripts/deploy-stage1-workflow.js
node scripts/deploy-stage2-workflow.js
node scripts/deploy-stage3-workflow.js
node scripts/deploy-stage4-workflow.js
```

Butuh kredensial berikut sudah dibuat di n8n (Settings → Credentials, atau lewat REST API —
lihat komentar di tiap skrip untuk ID yang harus disesuaikan):
- **Sectors API - Header Auth** (`httpHeaderAuth`, value = `SECTORS_API_KEY`)
- **Telegram Bot** (`telegramApi`, access token = `TELEGRAM_BOT_TOKEN`)
- **Google Service Account** (`googleApi`, mode Service Account, email + private key dari
  `GOOGLE_SERVICE_ACCOUNT_JSON`) — sheet tujuan harus di-share ke email service account ini
  sebagai Editor, dan **Google Sheets API harus sudah di-enable** di project GCP-nya.

Untuk test manual sebelum menjadwalkan (CLAUDE.md §6): tambahkan node Webhook sementara yang
disambung sama seperti Schedule Trigger, aktifkan workflow, `curl` webhook-nya, cek hasil lewat
`GET /api/v1/executions/{id}?includeData=true`, lalu hapus lagi node Webhook-nya. Jangan
mengaktifkan Schedule Trigger sebelum tervalidasi manual.

## Environment variables (`.env`)

| Variabel | Kegunaan |
|---|---|
| `SECTORS_API_KEY` | Autentikasi Sectors Financial API v2 |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Delivery Telegram |
| `GOOGLE_SHEETS_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON` | Logging Google Sheets |
| `N8N_BASE_URL`, `N8N_API_KEY` | Deploy workflow ke instance n8n lewat REST API |

## Keamanan kredensial

API key **tidak pernah** ditulis di kode. Seluruh kredensial dibaca dari environment variable
(`.env` lokal) atau dibuat langsung di credential store n8n lewat REST API (nilai rahasia
dikirim via API call, tidak pernah masuk file yang di-commit — hanya ID kredensial hasil
pembuatan yang direferensikan di skrip `deploy-stage*.js`, dan ID itu bukan rahasia).
`.env` sudah masuk `.gitignore`, begitu juga pola nama file kredensial Google Cloud
(`gen-lang-client-*.json`).

**Wajib sebelum submit** (aturan kompetisi): hapus seluruh API key dari `.env` dan credential
store n8n setelah repo tidak lagi butuh berjalan.
