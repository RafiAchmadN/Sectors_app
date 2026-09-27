# SCORING_LOGIC.md

Dokumen ini adalah referensi kerja untuk seluruh rumus, threshold, dan bobot yang digunakan pada komponen scoring di workflow. Dokumen ini bersifat dinamis dan wajib diperbarui setiap kali tim mengubah angka berdasarkan hasil perhitungan atau analisa market baru. Dokumen ini dirujuk oleh `CLAUDE.md` bagian 5 (Letak Scoring Logic pada Workflow), bukan sebaliknya, sehingga angka yang berlaku selalu mengacu ke versi terbaru dokumen ini.

Setiap perubahan angka wajib dicatat pada bagian Riwayat Perubahan Angka di akhir dokumen ini, beserta alasan perubahannya, agar dapat dipertanggungjawabkan saat ditanya juri maupun untuk keperluan dokumentasi teknis di repo.

---

## Status: TERISI (27 Sep 2026)

Seluruh angka di bawah sudah diisi final dan disalin ke `config/scoring.config.json` — `src/scoring/config.js` sudah lolos validasi (tidak ada `null` tersisa). Alasan tiap angka dicatat di bagian masing-masing dan direkap ulang di "Riwayat Perubahan Angka" di akhir dokumen. Tim tetap boleh merevisi angka ini kalau ada temuan analisa baru — cukup catat perubahannya di riwayat, jangan diam-diam.

---

## 1. Normalisasi Data

Metode: min-max scaling ke rentang 0 sampai 100, dihitung dari histori saham itu sendiri (bukan dibanding saham lain).

```
Skor Ternormalisasi = (Nilai - Nilai Minimum) / (Nilai Maksimum - Nilai Minimum) x 100
```

- Volume: metode = min-max scaling, periode historis pembanding = **20 hari bursa terakhir**
- Broker flow: metode = min-max scaling, periode historis pembanding = **10 hari bursa terakhir** (LEBIH PENDEK dari volume/foreign flow — **DIKOREKSI 27 Sep 2026**: `npm run verify:api` membuktikan endpoint `/broker-summary/{symbol}/` punya plafon internal ~11 hari bursa yang mengabaikan parameter `start`, terlepas rentang tanggal berapa pun yang diminta workflow. Lihat docs/API_FINDINGS.md §1.3d. 10 dipilih di bawah batas yang teramati supaya lookback ini benar-benar terpenuhi, bukan diam-diam terpotong.)
- News sentiment: metode = skala langsung dari hasil klasifikasi (lihat bagian 5), tidak perlu min-max
- Foreign inflow: metode = min-max scaling, periode historis pembanding = **20 hari bursa terakhir**

Alasan memilih 20 hari bursa untuk volume dan foreign inflow: cukup panjang untuk meredam noise harian tapi cukup pendek untuk merefleksikan rezim pasar terkini (kira-kira 1 bulan kalender), dan merupakan window standar yang umum dipakai untuk SMA teknikal sehingga mudah dijelaskan ke juri tanpa perlu justifikasi statistik rumit. Broker flow terpaksa memakai window lebih pendek (10 hari) murni karena batasan data API, bukan pilihan analitis — dicatat eksplisit di sini supaya tidak disalahpahami sebagai keputusan sengaja meredam sinyal broker flow (yang justru diberi bobot tertinggi di §4).

---

## 2. Rumus Technical/Market Signal

### 2.1 Volume Anomaly (Simple Moving Average Volume)

```
SMA Volume (n) = (Volume_1 + Volume_2 + ... + Volume_n) / n
Volume Ratio = Volume Hari Ini / SMA Volume (n)
```

- n = jumlah hari pembanding. **n = 20 hari bursa**
- Dianggap signifikan jika Volume Ratio > Y. **Y = 1.5** — dipilih di ujung bawah rentang contoh (1.5-2.0) supaya lebih sensitif menangkap anomali sejak dini; risiko false-positive dari ambang lebih rendah ini sudah diredam oleh anti-noise filter market cap (§3) dan bobot broker/foreign flow yang ikut menentukan skor akhir, bukan volume anomaly sendirian.

### 2.2 Price Change dari Open

```
Persentase Perubahan = ((Harga Close - Harga Open) / Harga Open) x 100
```

### 2.3 Simple Moving Average Harga (opsional, jika diperlukan sebagai konteks tren)

```
SMA Harga (n) = (Close_1 + Close_2 + ... + Close_n) / n
```
n = (belum diisi). Catatan: RSI tidak dipakai pada versi ini, cukup SMA dan price change sebagai representasi technical signal.

---

## 3. Threshold Signifikansi

- Volume anomaly: lihat 2.1, threshold Y = **1.5** (lihat §2.1 untuk alasan)
- Broker flow signifikan: dianggap signifikan jika konsentrasi akumulasi/distribusi oleh broker tertentu melebihi Z persen dari total volume transaksi. **Z = 20%**, dihitung terhadap total aktivitas (buy+sell seluruh broker) hari itu, memakai **basis nilai rupiah (`value_idr`: bval/sval/nval)** bukan lot. Alasan basis rupiah: mencerminkan aliran modal riil dan sebanding lintas saham berbeda harga (docs/API_FINDINGS.md §3), sesuai konvensi "top broker net buy/sell" yang lazim dipakai analis retail Indonesia. Z=20% dipilih sebagai ambang yang cukup tinggi untuk menandakan dominasi satu broker yang tidak wajar (bukan sekadar broker besar yang memang aktif di banyak saham), tapi masih realistis tercapai pada saham-saham dengan aktivitas broker terkonsentrasi.
- Minimum likuiditas/market cap sebagai anti-noise filter: saham dengan market cap di bawah nilai tertentu dikecualikan dari watchlist. **Nilai = 5.000 miliar IDR (Rp5 triliun)**, disamakan dengan `min_mcap_billion` default di endpoint `top-changes` (`config/sectors-endpoints.js`) supaya kandidat dari jalur `most-traded` — yang TIDAK punya filter ini di sisi API (docs/API_FINDINGS.md §1.5) — diperlakukan setara dan tidak lolos ke watchlist hanya karena kebetulan datang dari jalur pencarian kandidat yang berbeda.

---

## 4. Weighted Scoring

```
Skor Akhir = (W1 x Skor_Volume) + (W2 x Skor_BrokerFlow) + (W3 x Skor_News) + (W4 x Skor_ForeignFlow)
```

W1 + W2 + W3 + W4 harus berjumlah 100 persen. Seluruh Skor_X di atas adalah hasil normalisasi 0-100 dari bagian 1.

- Bobot volume (W1) = **30 persen**
- Bobot broker flow (W2) = **35 persen**
- Bobot news (W3) = **15 persen**
- Bobot foreign flow (W4) = **20 persen**

Alasan urutan (broker flow > volume > foreign flow > news):
1. **Broker flow (35%, tertinggi)** — ini nilai tambah/diferensiator utama produk sesuai CLAUDE.md §1 ("pemanfaatan data aktivitas broker sebagai sinyal diferensiasi"), jadi bobotnya sengaja dibuat paling besar agar benar-benar tercermin di skor akhir, bukan cuma jargon di deskripsi produk.
2. **Volume (30%)** — sinyal teknikal paling objektif dan deterministik, langsung dari data transaksi mentah tanpa interpretasi tambahan.
3. **Foreign flow (20%)** — sinyal makro/institusional yang berguna sebagai konteks tambahan, tapi sifatnya agregat harian yang bisa lebih lambat merefleksikan pergerakan jangka pendek dibanding volume/broker flow.
4. **News (15%, terendah)** — Base Sentiment Score diturunkan dari heuristik `tags[]` yang kasar (lihat §5 dan docs/API_FINDINGS.md §1.4), bukan analisis mendalam, jadi paling rentan noise/salah klasifikasi di antara keempat faktor.

**Catatan skala Skor_News (DIPERBAIKI 27 Sep 2026):** sempat ditemukan bahwa Skor_News tidak melalui normalisasi min-max 0-100 seperti tiga faktor lain (skalanya -1..1 apa adanya dari §5), yang membuat bobot 15% di atas tidak proporsional (kontribusi riilnya ke Skor Akhir maksimal cuma ±0.15 poin, jauh di bawah puluhan poin dari 3 faktor lain). Sudah diperbaiki dengan menambah `normalizeNewsScore()` (`src/scoring/newsSentiment.js`) yang memetakan linear -1..1 ke 0-100 (netral/tanpa berita = 50, titik tengah, konsisten dengan konvensi `normalize.js`) SEBELUM masuk ke `weightedFinalScore()` maupun `dominantFactor()`. Dipanggil di `index.js`. Sekarang bobot 15% untuk news benar-benar sebanding pengaruhnya dengan W1/W2/W4.

---

## 5. Time Decay untuk Berita (Daily, Hourly, Weekly)

Pendekatan yang dipakai: bucket manual berdasarkan rentang waktu publikasi berita, bukan formula eksponensial, supaya mudah diimplementasikan sebagai kondisi if-else di n8n dan mudah dijelaskan ke juri.

```
Skor_News = Base Sentiment Score x Bobot Waktu
```

- Base Sentiment Score: hasil klasifikasi sentimen berita, skala -1 (negatif) sampai 1 (positif), 0 untuk netral.

| Rentang Waktu Publikasi | Kategori | Bobot Waktu |
|---|---|---|
| 0 - 24 jam | Harian (daily) | **1.0 (final)** |
| 24 - 72 jam | Beberapa hari terakhir | **0.5 (final)** |
| 72 jam - 7 hari | Mingguan (weekly) | **0.2 (final)** |
| Lebih dari 7 hari | Diabaikan | 0 |

Alasan: peluruhan kasar per bucket (dibagi kira-kira dua tiap naik satu tingkat) — mudah diimplementasikan sebagai if-else dan mudah dijelaskan ke juri ("berita hari ini dihitung penuh, beberapa hari terakhir separuh, seminggu ke belakang seperlima, lebih dari itu diabaikan") tanpa perlu justifikasi kurva eksponensial yang lebih rumit.

Setelah dihitung per berita, jika satu saham punya lebih dari satu berita relevan dalam window waktu, Skor_News final memakai **rata-rata (average)** — bukan skor tertinggi. Alasan: rata-rata mencegah satu artikel outlier (sangat positif atau sangat negatif) mendominasi skor sebuah saham yang kebetulan punya banyak berita relevan, sehingga hasilnya lebih stabil dan representatif terhadap keseluruhan pemberitaan, bukan cuma judul paling ekstrem. Diimplementasikan di `aggregateNewsScore()` (`src/scoring/newsSentiment.js`), dipilih lewat `config.newsSentiment.multiArticleAggregation = "average"`.

---

## 6. Tie-breaker

Aturan jika dua saham atau lebih memiliki skor akhir yang sama: **saham dengan konsentrasi broker flow (broker share) lebih tinggi menang** (`higher_broker_concentration`, diimplementasikan di `sortRanking()`/`src/scoring/tieBreaker.js`).

Alasan: konsisten dengan §4 di mana broker flow diberi bobot tertinggi sebagai diferensiator utama produk — saat skor akhir seri, sinyal yang paling mencerminkan nilai tambah produk yang dipakai untuk memutus seri, bukan aturan netral seperti alfabetis simbol.

Catatan tambahan: kandidat bisa muncul dari dua jalur penjaringan (top movers dan most-traded, lihat docs/API_FINDINGS.md §3). Kalau satu simbol muncul di kedua jalur pada hari yang sama, workflow n8n wajib men-dedup berdasarkan symbol SEBELUM scoring (bukan di tie-breaker ini) — tie-breaker hanya berlaku untuk simbol BERBEDA yang skor akhirnya kebetulan sama persis.

---

## 7. Format Reasoning Text Otomatis

Template kalimat mode simple (bahasa sederhana untuk retail), contoh kerangka yang perlu diisi variabelnya:

"[Nama saham] naik [persentase] didukung oleh [alasan utama berdasarkan skor tertinggi]."

Template kalimat mode detail (rincian data untuk pembaca yang ingin mendalami), perlu memuat: nilai skor tiap faktor, angka volume, angka broker flow, judul berita terkait, dan angka foreign inflow.

**Format final: kerangka di atas sudah final**, diimplementasikan persis di `buildSimpleReasoning()` dan `buildDetailReasoning()` (`src/scoring/reasoningText.js`), termasuk `disclaimerText()` untuk disclaimer wajib (CLAUDE.md §2 & §7). Tidak ada perubahan format dari kerangka kalimat yang sudah ditulis di atas — kalau tim mau mengubah kalimatnya, edit dua fungsi itu langsung (logika pemilihan faktor dominan di `dominantFactor()` tetap dipakai).

---

## Riwayat Perubahan Angka

Catat setiap perubahan pada tabel berikut. Jangan menghapus riwayat lama, cukup tambahkan baris baru.

| Tanggal | Bagian yang Diubah | Angka Lama | Angka Baru | Alasan Perubahan | Diubah Oleh |
|---|---|---|---|---|---|
| 2026-09-27 | §1 lookback normalisasi (volume/brokerFlow/foreignInflow) | null | 20 hari bursa (semua) | Window standar SMA teknikal, cukup meredam noise harian tapi tetap merefleksikan rezim pasar terkini; mudah dijelaskan ke juri | Tim (dibantu Claude Code) |
| 2026-09-27 | §2.1 SMA window (n) & threshold volume (Y) | null / null | n=20 hari, Y=1.5x | n selaras dengan §1; Y dipilih di ujung bawah rentang contoh (1.5-2.0) untuk lebih sensitif menangkap anomali, risiko false-positive diredam anti-noise filter §3 dan bobot multi-faktor §4 | Tim (dibantu Claude Code) |
| 2026-09-27 | §3 threshold broker flow (Z) & basis konsentrasi | null / null | Z=20%, basis=value_idr | Z=20% menandakan dominasi broker tidak wajar; basis rupiah mencerminkan aliran modal riil dan sebanding lintas saham berbeda harga (docs/API_FINDINGS.md §3) | Tim (dibantu Claude Code) |
| 2026-09-27 | §3 minimum market cap anti-noise filter | null | 5.000 miliar IDR | Disamakan dengan `min_mcap_billion` default di endpoint top-changes supaya kandidat dari jalur most-traded (tidak punya filter ini di API) diperlakukan setara | Tim (dibantu Claude Code) |
| 2026-09-27 | §4 bobot weighted scoring (W1-W4) | null semua | volume=30, brokerFlow=35, news=15, foreignFlow=20 | Broker flow tertinggi karena diferensiator utama produk (CLAUDE.md §1); volume kedua karena sinyal paling objektif; news terendah karena sentimen dari heuristik tags kasar. Lihat peringatan skala Skor_News yang tidak ternormalisasi di §4 | Tim (dibantu Claude Code) |
| 2026-09-27 | §5 bobot time decay berita | 1.0/0.5/0.2 (belum final) | 1.0/0.5/0.2 (final, tidak berubah nilainya) | Angka contoh awal tim dikonfirmasi sebagai final — peluruhan kasar per bucket sudah cukup jelas dan mudah dijelaskan | Tim (dibantu Claude Code) |
| 2026-09-27 | §5 agregasi multi-berita | null | average | Mencegah satu artikel outlier mendominasi skor saham yang punya banyak berita relevan dalam window waktu | Tim (dibantu Claude Code) |
| 2026-09-27 | §6 aturan tie-breaker | null | higher_broker_concentration | Konsisten dengan bobot broker flow tertinggi di §4 sebagai diferensiator utama produk | Tim (dibantu Claude Code) |
| 2026-09-27 | §7 format reasoning text | (belum diisi) | Final = kerangka kalimat yang sudah ditulis, sudah diimplementasikan di reasoningText.js | Tidak ada kebutuhan mengubah format; implementasi kode sudah mengikuti kerangka §7 persis | Tim (dibantu Claude Code) |
| 2026-09-27 | Output topN | null | 7 | Titik tengah rentang 5-10 (CLAUDE.md §7), cukup untuk digest Telegram harian tanpa terasa sepi atau membanjiri pembaca retail | Tim (dibantu Claude Code) |
| 2026-09-27 | `config/sectors-endpoints.js` — rentang default `broker-summary` | -5 hari kalender | -30 hari kalender | Perlu histori cukup untuk lookback normalisasi broker flow 20 hari bursa (§1); biaya credit endpoint ini flat 1 credit berapa pun rentang tanggal, jadi tidak menambah biaya | Tim (dibantu Claude Code) |
| 2026-09-27 | §4 skala Skor_News sebelum masuk weighted scoring | Skor_News dipakai apa adanya di skala -1..1 (tidak dinormalisasi) | Dinormalisasi 0-100 lewat `normalizeNewsScore()` baru (`newsSentiment.js`), dipanggil di `index.js` sebelum `scores.news` dipakai | Ditemukan saat mengisi bobot §4: skala -1..1 membuat bobot W3=15% tidak proporsional (kontribusi riil maksimal cuma ±0.15 poin vs puluhan poin faktor lain). Diperbaiki di hari yang sama supaya bobot benar-benar berarti | Tim (dibantu Claude Code) |
| 2026-09-27 | §1 lookback normalisasi broker flow | 20 hari bursa | **10 hari bursa** | `npm run verify:api` (real run, 9 credit) membuktikan `/broker-summary/{symbol}/` mengabaikan parameter `start` di luar ~11 hari bursa terakhir (request 30 hari kalender cuma menghasilkan 11 hari data, sedangkan `/foreign-flow/` dengan rentang identik menghasilkan 23 hari) — lihat docs/API_FINDINGS.md §1.3d. 20 hari tidak achievable dari API ini, diturunkan ke 10 (di bawah batas teramati) | Tim (dibantu Claude Code) |
