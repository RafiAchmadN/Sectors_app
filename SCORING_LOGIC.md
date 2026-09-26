# SCORING_LOGIC.md

Dokumen ini adalah referensi kerja untuk seluruh rumus, threshold, dan bobot yang digunakan pada komponen scoring di workflow. Dokumen ini bersifat dinamis dan wajib diperbarui setiap kali tim mengubah angka berdasarkan hasil perhitungan atau analisa market baru. Dokumen ini dirujuk oleh `CLAUDE.md` bagian 5 (Letak Scoring Logic pada Workflow), bukan sebaliknya, sehingga angka yang berlaku selalu mengacu ke versi terbaru dokumen ini.

Setiap perubahan angka wajib dicatat pada bagian Riwayat Perubahan Angka di akhir dokumen ini, beserta alasan perubahannya, agar dapat dipertanggungjawabkan saat ditanya juri maupun untuk keperluan dokumentasi teknis di repo.

---

## Status: BELUM DIISI

Bagian rumus dan angka di bawah ini masih berupa kerangka kosong. Tim, khususnya penanggung jawab expertise TA/makro/market analysis, perlu mengisi angka final berdasarkan pengalaman dan analisa, bukan angka asumsi sembarang, karena angka ini akan dipertanggungjawabkan di hadapan juri.

---

## 1. Normalisasi Data

Metode: min-max scaling ke rentang 0 sampai 100, dihitung dari histori saham itu sendiri (bukan dibanding saham lain).

```
Skor Ternormalisasi = (Nilai - Nilai Minimum) / (Nilai Maksimum - Nilai Minimum) x 100
```

- Volume: metode = min-max scaling, periode historis pembanding = (belum diisi, contoh umum 20 hari terakhir)
- Broker flow: metode = min-max scaling, periode historis pembanding = (belum diisi)
- News sentiment: metode = skala langsung dari hasil klasifikasi (lihat bagian 5), tidak perlu min-max
- Foreign inflow: metode = min-max scaling, periode historis pembanding = (belum diisi)

---

## 2. Rumus Technical/Market Signal

### 2.1 Volume Anomaly (Simple Moving Average Volume)

```
SMA Volume (n) = (Volume_1 + Volume_2 + ... + Volume_n) / n
Volume Ratio = Volume Hari Ini / SMA Volume (n)
```

- n = jumlah hari pembanding. n = (belum diisi, contoh umum 20 hari)
- Dianggap signifikan jika Volume Ratio > Y. Y = (belum diisi, contoh umum 1.5 sampai 2.0)

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

- Volume anomaly: lihat 2.1, threshold Y = (belum diisi)
- Broker flow signifikan: dianggap signifikan jika konsentrasi akumulasi/distribusi oleh broker tertentu melebihi Z persen dari total volume transaksi. Z = (belum diisi)
- Minimum likuiditas/market cap sebagai anti-noise filter: saham dengan market cap di bawah nilai tertentu dikecualikan dari watchlist. Nilai = (belum diisi)

---

## 4. Weighted Scoring

```
Skor Akhir = (W1 x Skor_Volume) + (W2 x Skor_BrokerFlow) + (W3 x Skor_News) + (W4 x Skor_ForeignFlow)
```

W1 + W2 + W3 + W4 harus berjumlah 100 persen. Seluruh Skor_X di atas adalah hasil normalisasi 0-100 dari bagian 1.

- Bobot volume (W1) = (belum diisi) persen
- Bobot broker flow (W2) = (belum diisi) persen
- Bobot news (W3) = (belum diisi) persen
- Bobot foreign flow (W4) = (belum diisi) persen

Catatan: urutan besar-kecil bobot harus mencerminkan keyakinan tim terhadap kekuatan tiap sinyal, dan harus bisa dijelaskan alasannya, bukan angka rata-rata sembarang.

---

## 5. Time Decay untuk Berita (Daily, Hourly, Weekly)

Pendekatan yang dipakai: bucket manual berdasarkan rentang waktu publikasi berita, bukan formula eksponensial, supaya mudah diimplementasikan sebagai kondisi if-else di n8n dan mudah dijelaskan ke juri.

```
Skor_News = Base Sentiment Score x Bobot Waktu
```

- Base Sentiment Score: hasil klasifikasi sentimen berita, skala -1 (negatif) sampai 1 (positif), 0 untuk netral.

| Rentang Waktu Publikasi | Kategori | Bobot Waktu |
|---|---|---|
| 0 - 24 jam | Harian (daily) | 1.0 (belum final) |
| 24 - 72 jam | Beberapa hari terakhir | 0.5 (belum final) |
| 72 jam - 7 hari | Mingguan (weekly) | 0.2 (belum final) |
| Lebih dari 7 hari | Diabaikan | 0 |

Catatan: rentang jam dan bobot pada tabel di atas adalah nilai contoh awal, wajib direvisi oleh tim berdasarkan analisa, dan dicatat perubahannya di bagian Riwayat Perubahan Angka.

Setelah dihitung per berita, jika satu saham punya lebih dari satu berita relevan dalam window waktu, Skor_News final memakai rata-rata atau skor tertinggi (pilih salah satu, catat keputusan tim di sini): (belum diisi)

---

## 6. Tie-breaker

Aturan jika dua saham atau lebih memiliki skor akhir yang sama: (belum diisi)

---

## 7. Format Reasoning Text Otomatis

Template kalimat mode simple (bahasa sederhana untuk retail), contoh kerangka yang perlu diisi variabelnya:

"[Nama saham] naik [persentase] didukung oleh [alasan utama berdasarkan skor tertinggi]."

Template kalimat mode detail (rincian data untuk pembaca yang ingin mendalami), perlu memuat: nilai skor tiap faktor, angka volume, angka broker flow, judul berita terkait, dan angka foreign inflow.

Format final kedua template: (belum diisi)

---

## Riwayat Perubahan Angka

Catat setiap perubahan pada tabel berikut. Jangan menghapus riwayat lama, cukup tambahkan baris baru.

| Tanggal | Bagian yang Diubah | Angka Lama | Angka Baru | Alasan Perubahan | Diubah Oleh |
|---|---|---|---|---|---|
| (belum ada perubahan) | | | | | |
