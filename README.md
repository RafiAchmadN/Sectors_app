# Sectors Daily Watchlist Workflow

Workflow otomatis yang menyederhanakan data pasar saham Indonesia menjadi ranking watchlist harian
untuk investor retail, dikirim ke Telegram setiap pagi sebelum pasar dibuka.
Dibangun untuk **Sectors Hackathon 2026 — track Automation and Workflows**.

> **Status: dalam pengerjaan.** README lengkap (deskripsi produk, cara kerja, bukti log run otonom)
> disusun pada tahap 8 rencana eksekusi. Lihat `CLAUDE.md` untuk konteks proyek.

> **Disclaimer:** produk ini adalah alat informasi dan analisis data pasar, **bukan rekomendasi
> investasi atau nasihat keuangan**. Tidak ada eksekusi transaksi otomatis dalam bentuk apapun.

## Struktur repo

| Path | Isi |
|---|---|
| `CLAUDE.md` | Memori referensi utama proyek: tujuan, constraint kompetisi, arah produk yang sudah difiksasi |
| `SCORING_LOGIC.md` | Rumus, threshold, dan bobot scoring — dokumen dinamis, diisi tim |
| `config/sectors-endpoints.js` | Katalog endpoint Sectors API v2 beserta parameter dan biaya credit |
| `scripts/verify-api.js` | Verifikasi manual seluruh endpoint (CLAUDE.md §8) |
| `docs/API_FINDINGS.md` | Temuan dari dokumentasi API yang mempengaruhi perencanaan |
| `docs/API_VERIFICATION.md` | Laporan hasil verifikasi terhadap data nyata (dihasilkan otomatis) |
| `workflows/` | Ekspor JSON workflow n8n |

## Menjalankan verifikasi API

```bash
cp .env.example .env          # lalu isi SECTORS_API_KEY
npm run verify:api            # memakai sekitar 8 credit
npm run verify:api -- --dry-run   # lihat rencana panggilan tanpa memakai credit
```

Opsi: `--date=YYYY-MM-DD`, `--symbol=BBCA`, `--broker=YP`.

Hasil: laporan di `docs/API_VERIFICATION.md`, response mentah di `out/api-samples/`
(tidak di-commit).

## Keamanan kredensial

API key **tidak pernah** ditulis di kode. Seluruh kredensial dibaca dari environment variable
(`.env` lokal, credential store di n8n). `.env` sudah masuk `.gitignore`.
