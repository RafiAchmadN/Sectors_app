# Temuan API Sectors v2 yang Mempengaruhi Perencanaan

Ditulis dari dokumentasi resmi Sectors Financial API (docs.sectors.app, dibaca 14 September 2026),
sebelum pemanggilan API nyata. **Diperbarui 26 September 2026** setelah `npm run verify:api`
benar-benar dijalankan dengan API key asli — beberapa asumsi dari dokumentasi TERNYATA SALAH
saat dibandingkan dengan response sungguhan; perbaikannya ditandai `[VERIFIED 26 Sep]` di bawah.
Laporan mentah run ini ada di `docs/API_VERIFICATION.md` (regenerasi otomatis, jangan diedit manual).

Dokumen ini TIDAK berisi keputusan angka scoring. Angka scoring tetap milik tim dan tempatnya
di `SCORING_LOGIC.md`. Yang dicatat di sini adalah batasan teknis API yang membatasi atau
mempermudah pilihan angka tersebut.

---

## 1. Temuan yang wajib ditindaklanjuti

### 1.1 API v1 sudah mati — seluruh contoh v1 tidak lagi berlaku
Sectors API v1 dihentikan **11 Mei 2026**. Seluruh endpoint `/v1/*` mengembalikan **HTTP 410 Gone**.
Banyak tutorial, template n8n, dan artikel di internet masih memakai `https://api.sectors.app/v1/...`
dan akan gagal total. Seluruh URL di proyek ini wajib memakai `https://api.sectors.app/v2/`.

### 1.2 Kuota 1.000 credit adalah batasan desain, bukan sekadar biaya
Setiap tim menerima **1.000 credit, TOTAL untuk seluruh kompetisi**, hangus saat event selesai,
dan registrasi akun tambahan untuk menambah credit adalah pelanggaran berat. Jadi angka ini
yang menentukan berapa kandidat yang sanggup diproses per hari — bukan preferensi produk.

Credit ditagih per response: **2xx menagih sesuai biaya endpoint, 404 tetap menagih 1 credit,
429 gratis**. Mayoritas endpoint 1 credit, tetapi **Top Company Movers menagih 1 credit per
kombinasi (classification x period)** — default 2 classification x 5 period = **10 credit sekali
panggil**. Parameter ini wajib dibatasi eksplisit; `config/sectors-endpoints.js` sudah mengunci
ke `top_gainers` + `1d` = 1 credit.

**Dua penghematan yang sudah diterapkan di konfigurasi:**

- **Berita di-batch.** Parameter `symbols` menerima daftar dipisah koma, sehingga berita seluruh
  kandidat diambil dalam satu panggilan = 1 credit, bukan 1 credit per kandidat. Endpoint ini
  tidak boleh dipanggil di dalam loop per simbol.
- **`/close/` dibuang.** Endpoint full-universe close tidak dipakai untuk menjaring kandidat
  (kandidat datang dari top-movers dan most-traded), jadi tidak sepadan dengan biayanya.

**[VERIFIED 26 Sep 2026]** Angka biaya di atas berasal dari dokumentasi ("most cost 1") dan
TERNYATA TIDAK SEMUANYA BENAR. `npm run verify:api` dijalankan dengan API key asli dan server
mengirim header `limit-consumption` pada sebagian response — angka sungguhannya:

| Endpoint | Asumsi awal | Aktual (`limit-consumption`) |
|---|---|---|
| Top Company Movers (`top-changes`) | 1 | 1 (cocok) |
| Most Traded Stocks (`most-traded`) | 1 | **2** |
| Top Accum/Distrib Per Broker (`broker-activity/top`) | 1 | **2** |
| Daily Transaction Data, Broker Summary, Foreign Flow, News | 1 masing-masing | **belum terverifikasi** — server tidak mengirim header `limit-consumption` pada response endpoint-endpoint ini, jadi masih diasumsikan 1 sampai terbukti sebaliknya |

Biaya satu siklus harian jadi `3 + 3n + 1 + 2b` (n = kandidat, b = broker yang diperiksa),
naik dari asumsi awal `2 + 3n + 1 + b`:

| Kandidat/hari | Credit/hari (lama) | Credit/hari (aktual) | Scheduler 7 hari | Scheduler 10 hari |
|---|---|---|---|---|
| 10 | 35 | 38 | 266 | 380 |
| 8 | 29 | 32 | 224 | 320 |
| 5 | 20 | 23 | 161 | 230 |

Kesimpulannya tidak berubah drastis (masih muat jauh di bawah 1.000 credit), tapi ini bukti
nyata bahwa **jangan pernah percaya angka biaya dari dokumentasi tanpa verifikasi** — dipakai
`config/sectors-endpoints.js` (`estimateDailyCredits()`) sebagai satu tempat rujukan yang sudah
diperbarui.

**Iterasi pengembangan tetap pos pengeluaran terbesar, bukan scheduler.** Membangun workflow
7 endpoint di n8n mudah menghabiskan 40-80 kali eksekusi uji; pada +-8-9 credit per siklus penuh
(setelah koreksi di atas) itu sudah 320-720 credit. Karena itu aturan kerjanya: **jalankan
`npm run verify:api` sekali, lalu kembangkan scoring di atas response mentah yang tersimpan di
`out/api-samples/` sebagai fixture.** Iterasi di atas fixture berbiaya 0 credit. API langsung
hanya dipakai untuk verifikasi awal dan uji end-to-end menjelang aktivasi scheduler.

### 1.3 Simbol dikembalikan dengan sufiks `.JK`
API mengembalikan `BBCA.JK`, sedangkan path parameter menerima `BBCA`. Normalisasi wajib
dilakukan di antara tahap 1 dan tahap 2, jika tidak seluruh enrichment akan 404
(dan 404 tetap menagih credit). Helper `stripSuffix()` sudah disediakan.

### 1.3b **[VERIFIED 26 Sep 2026]** Field nama perusahaan tidak konsisten antar endpoint tahap 1
`/v2/companies/top-changes/` mengembalikan field nama perusahaan sebagai **`name`**.
`/v2/most-traded/` mengembalikan field nama perusahaan sebagai **`company_name`**.
Ini BUKAN typo di dokumentasi — dua endpoint API sungguhan memang memakai nama field berbeda
untuk konsep yang sama. Kalau kode normalisasi kandidat memakai satu nama field untuk kedua
sumber (godaan alami karena "kelihatannya sama"), field dari salah satu sumber akan selalu
`undefined`. Ini sempat jadi bug nyata di `scripts/deploy-stage1-workflow.js` — sudah diperbaiki
dan diverifikasi ulang terhadap `out/api-samples/topChanges.json` + `mostTraded.json` sebelum
redeploy. Pelajaran: jangan asumsikan konsistensi penamaan antar endpoint yang sekilas mirip,
walau sama-sama v2 dan sama-sama dari provider yang sama.

### 1.3c **[VERIFIED 26 Sep 2026]** Field `foreign_*` tambahan yang tidak ada di dokumentasi publik
Dua endpoint mengembalikan field yang tidak disebutkan di docs.sectors.app sama sekali:
- `/v2/broker-activity/{code}/top/` — tiap baris `top_accumulations`/`top_distributions` punya
  `foreign_net_idr`, `foreign_buy_idr`, `foreign_sell_idr` selain `net_idr`/`buy_idr`/`sell_idr`.
  Juga ada field `foreign: boolean` di level atas response.
- `/v2/foreign-flow/{symbol}/` — tiap baris `data[]` punya `foreign_buy_idr`, `foreign_sell_idr`,
  dan `foreign_share` (pecahan 0-1) selain `net_foreign_inflow`.

Ini sinyal tambahan yang bisa memperkaya scoring foreign flow (SCORING_LOGIC.md §1 & §4) di luar
angka net mentah — misalnya `foreign_share` sebagai ukuran seberapa besar porsi transaksi hari itu
berasal dari asing, terlepas dari arahnya. Belum dipakai di scoring engine saat ini; dicatat di
sini supaya tim tahu datanya tersedia kalau mau dipertimbangkan.

### 1.3d **[VERIFIED 27 Sep 2026]** `/broker-summary/{symbol}/` mengabaikan `start` di luar ~11 hari bursa terakhir
Berbeda dari `/daily/` dan `/foreign-flow/` yang menghormati penuh rentang `start`-`end` yang
diminta, `/broker-summary/{symbol}/` tampaknya punya batas internal tersendiri yang TIDAK
didokumentasikan di docs.sectors.app.

Bukti: permintaan identik `start=2026-08-26&end=2026-09-25` (rentang 30 hari kalender, ~21-23
hari bursa) pada dua endpoint berbeda untuk simbol yang sama (BBCA):
- `/foreign-flow/BBCA/` -> mengembalikan **23 hari** data, dari 2026-08-26 sampai 2026-09-25 (rentang penuh dihormati).
- `/broker-summary/BBCA/` -> mengembalikan cuma **11 hari** data, dari 2026-09-11 sampai 2026-09-25
  (hanya ~11 hari bursa TERAKHIR, parameter `start` yang lebih jauh dari itu diabaikan begitu saja
  tanpa error atau pesan apapun).

**Konsekuensi untuk SCORING_LOGIC.md §1:** lookback normalisasi broker flow SEHARUSNYA tidak
diasumsikan bisa sepanjang volume/foreign flow (20 hari bursa) hanya dengan memperlebar `start`
di request — endpoint ini punya plafon sendiri di kisaran ~11 hari terlepas dari apa yang diminta.
Angka lookback broker flow di `config/scoring.config.json` diturunkan ke **10 hari bursa** (di
bawah batas yang teramati) supaya `normalisasi.brokerFlow.lookbackDays` selalu benar-benar
terpenuhi oleh data yang API sanggup berikan, bukan diam-diam terpotong tanpa peringatan (lihat
riwayat perubahan angka SCORING_LOGIC.md tanggal 27 Sep 2026).

Belum diketahui apakah batas ~11 hari ini konstan atau bervariasi per simbol/kondisi pasar —
kalau tim menemukan angka berbeda di simbol lain, catat di sini dan sesuaikan lookback-nya.

### 1.4 Endpoint berita sudah memuat sinyal sentimen — LLM kemungkinan tidak diperlukan
Response `/v2/news/` mengandung:
- `tags[]` — sudah memuat label arah pasar seperti `Bullish` dan `Bearish`, di samping label
  tema seperti `Violation`, `Risk & Compliance`, `Politics & Regulation`
- `dimension{}` — objek skor numerik per dimensi: `future`, `dividend`, `ownership`, `technical`,
  `valuation`, `financials`, `management`, `sustainability`
- `symbols[]` — simbol IDX yang terkait artikel
- `timestamp` — format `YYYY-MM-DDTHH:mm:ss`, langsung bisa dipakai untuk time decay

Artinya **Base Sentiment Score pada `SCORING_LOGIC.md` §5 dapat diturunkan langsung dari `tags`
dan/atau `dimension`**, tanpa perlu node LLM untuk klasifikasi sentimen. Ini menyederhanakan
workflow, menghilangkan biaya token, dan membuat skor sentimen deterministik serta mudah
dipertanggungjawabkan ke juri — sesuatu yang sulit dilakukan kalau sentimen berasal dari LLM.

Keputusan pemetaan tag ke skala -1..1 tetap milik tim. Daftar tag yang valid bisa diambil
dari endpoint helper `/v2/tags/`.

**Risiko yang menyertai:** pada contoh response resmi, field `symbols` bisa **kosong** (`[]`)
meskipun artikel jelas membahas satu perusahaan. Mengandalkan penyaringan berita per simbol
lewat parameter `symbols=` lebih aman daripada menarik feed umum lalu memetakan sendiri.
`verify-api.js` menghitung frekuensi field kosong ini pada data nyata.

### 1.5 Anti-noise filter sebagian sudah tersedia gratis di API
`/v2/companies/top-changes/` punya parameter `min_mcap_billion` (default 5000, satuan miliar IDR).
Filter market cap pada `SCORING_LOGIC.md` §3 dapat diterapkan **di sisi API** untuk kandidat dari
endpoint ini, sehingga saham mikro tidak pernah ikut terambil dan tidak memboroskan credit
enrichment. Catatan: `most-traded` **tidak** punya filter ini, jadi filter market cap tetap harus
dijalankan di workflow untuk kandidat dari jalur tersebut.

Untuk `most-traded`, parameter `adjusted=true` meranking berdasarkan volume x harga, bukan volume
mentah — ini sendiri sudah meredam saham gocap yang volumenya besar tapi nilainya kecil.

---

## 2. Kontrak endpoint yang dipakai workflow

Autentikasi: header `Authorization: <API_KEY>` — **raw, tanpa prefix `Bearer`**.
Base URL: `https://api.sectors.app/v2`.

### Tahap 1 — penjaringan kandidat

| Endpoint | Path | Parameter penting | Bentuk response |
|---|---|---|---|
| Top Company Movers | `/companies/top-changes/` | `n_stock` (maks 10), `classifications`, `periods`, `min_mcap_billion` | `{ top_gainers: { "1d": [ {symbol, name, price_change, last_close_price, latest_close_date} ] } }` — **field nama = `name`, bukan `company_name`, lihat §1.3b** |
| Most Traded Stocks | `/most-traded/` | `start`, `end`, `n_stock` (maks 10), `adjusted` | `{ "YYYY-MM-DD": [ {symbol, company_name, volume, price} ] }` |
| Daily Full-Universe Close | `/close/` | `date`, `limit` (maks 30), `offset` | daftar close seluruh universe, berhalaman |

### Tahap 2 — enrichment per kandidat

| Endpoint | Path | Parameter penting | Bentuk response |
|---|---|---|---|
| Daily Transaction Data | `/daily/{symbol}/` | `start`, `end` — **maksimum rentang 90 hari** | `[ {symbol, date, close, open, high, low, volume, market_cap} ]` |
| Broker Activity Per Symbol | `/broker-summary/{symbol}/` | `start`, `end` (default end-30d, lihat §3), `broker_code` | per tanggal, per broker: `bfreq, blot, bval, bavg_per_share, sfreq, slot, sval, savg_per_share, nlot, nval, navg_per_share` |
| Top Accum./Distrib. Per Broker | `/broker-activity/{broker_code}/top/` | `start`, `end` (default end-30d), `n_brokers` | `{ foreign: boolean, top_accumulations: [ {rank, symbol, net_idr, buy_idr, sell_idr, foreign_net_idr, foreign_buy_idr, foreign_sell_idr} ], top_distributions: [...] }` — field `foreign_*` tidak ada di docs publik, lihat §1.3c |
| Daily Net Foreign Inflow | `/foreign-flow/{symbol}/` | `start`, `end` (default end-30d) | `{ symbol, start, end, data: [ {date, net_foreign_inflow, foreign_buy_idr, foreign_sell_idr, foreign_share} ] }` — field selain `net_foreign_inflow` tidak ada di docs publik, lihat §1.3c |
| News Articles | `/news/` | `symbols`, `start`, `end`, `limit` (maks 30), `offset`, `tags`, `sector`, `sub_sector`, `keyword` | `{ results: [ {title, body, source, thumbnail, timestamp, sector, sub_sector[], tags[], symbols[], dimension{}} ], pagination: {total_count, showing, limit} }` |

---

## 3. Catatan yang relevan untuk pengisian `SCORING_LOGIC.md`

Hal-hal berikut adalah **batasan data**, bukan usulan angka. Tim tetap yang menentukan angkanya.

- **§1 & §2.1 periode historis volume** — `/daily/{symbol}/` dibatasi 90 hari per panggilan.
  Periode pembanding SMA volume apapun yang dipilih tim harus <= 90 hari, dan karena hari bursa
  lebih sedikit dari hari kalender, permintaan perlu melebihkan rentang kalender
  (mis. 20 hari bursa perlu meminta sekitar 30 hari kalender).
- **§2.2 price change dari open** — `open`, `close`, `high`, `low` tersedia lengkap di `/daily/`,
  jadi rumus ini bisa dihitung tanpa endpoint tambahan.
- **§3 broker flow signifikan (Z persen dari total volume)** — `/broker-summary/{symbol}/` memberi
  `bval`/`sval`/`nval` per broker per hari, sehingga konsentrasi dapat dihitung sebagai
  nilai satu broker dibagi total seluruh broker pada hari itu. Satuan yang tersedia ada dua:
  nilai rupiah (`*val`) dan lot (`*lot`). Tim perlu menetapkan **mana yang dipakai sebagai penyebut**,
  karena hasilnya berbeda untuk saham berharga tinggi.
- **§3 minimum market cap** — `market_cap` tersedia per hari di `/daily/`, dan `min_mcap_billion`
  tersedia sebagai filter di `top-changes`. Satuan berbeda: `/daily/` memberi IDR penuh,
  `top-changes` memakai miliar IDR. Jangan tertukar.
- **§5 time decay berita** — `timestamp` artikel presisi sampai detik, jadi bucket rentang jam
  berapapun yang dipilih tim bisa diimplementasikan.
- **§6 tie-breaker** — kandidat dapat muncul dari dua jalur (top movers dan most traded).
  Tim perlu menetapkan aturan saat satu simbol muncul di kedua jalur, selain aturan tie-breaker skor.

---

## 4. Yang belum bisa diverifikasi tanpa API key

- Angka rate limit dan kuota harian/per menit yang sebenarnya. Dokumentasi hanya menjelaskan
  mekanisme penagihan credit dan kode 429, tanpa menyebut angka limit. `verify-api.js` merekam
  seluruh header response yang mengandung `rate`/`limit`/`quota`/`credit` untuk menjawab ini.
- Frekuensi nyata field kosong/null pada data produksi (CLAUDE.md §8 poin 4).
- Perilaku endpoint pada hari libur bursa IDX — apakah mengembalikan array kosong, data hari
  bursa terakhir, atau error. Ini menentukan penanganan error scheduler di hari libur.
- **Timezone field `timestamp` pada `/v2/news/`.** Contoh response resmi menulis
  `'2026-07-09T18:05:00'` tanpa offset (bukan UTC eksplisit, bukan WIB eksplisit).
  `src/scoring/newsSentiment.js` (`hoursSincePublished`) sengaja MEMPERLAKUKANNYA SEBAGAI UTC
  secara konsisten, supaya time decay §5 tidak salah hitung akibat dua nilai waktu
  diinterpretasi beda zona. Kalau setelah `verify-api.js` jalan ternyata field ini sebenarnya
  WIB (UTC+7), ubah `toUtcDate()` di file itu — satu tempat, tidak menyebar ke modul lain.
