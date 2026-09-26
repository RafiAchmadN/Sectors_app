# CLAUDE.md

Dokumen ini adalah memori referensi utama proyek untuk Sectors Hackathon 2026, Track: Automation and Workflows. Dokumen ini digunakan sebagai konteks acuan setiap kali berdiskusi atau melanjutkan pengerjaan proyek ini, agar keputusan yang sudah diambil tidak diulang-ulang atau berubah tanpa dasar.

Dokumen terkait: lihat `SCORING_LOGIC.md` untuk detail rumus dan angka scoring yang bersifat dinamis dan dapat berubah seiring analisa tim berjalan.

---

## 1. Tujuan Proyek

Membangun workflow otomatis (Automation and Workflows) yang menyederhanakan data pasar saham Indonesia menjadi ranking watchlist harian, ditujukan untuk investor retail dan individu dengan literasi finansial rendah hingga menengah, agar mereka dapat memahami kondisi aset yang mereka pertimbangkan tanpa perlu membaca banyak sumber data secara manual.

Nilai tambah utama produk ini adalah pemanfaatan data aktivitas broker (broker flow) dari Sectors API sebagai sinyal diferensiasi, dikombinasikan dengan data harga, volume, berita, dan aliran dana asing, diproses menjadi skor dan alasan tertulis yang mudah dipahami.

---

## 2. Constraint Wajib (Rules Kompetisi)

- Sectors API/MCP harus menjadi core data source. Jika data Sectors dicabut, fungsi utama produk harus hilang.
- Workflow wajib berjalan otonom, terjadwal atau ter-trigger otomatis, tanpa manusia menjalankan proses secara manual tiap siklus.
- Dilarang keras melakukan automated trade execution dalam bentuk apapun. Produk hanya boleh menganalisis, menyaring, memberi skor, dan mengirim alert.
- Dilarang memposisikan produk sebagai rekomendasi investasi atau nasihat keuangan. Produk harus diposisikan sebagai alat informasi dan analisis, disertai disclaimer eksplisit pada setiap keluaran.
- Kode proyek ditulis setelah 19 Agustus 2026, bukan hasil reuse project lama.
- Repo tetap publik minimal 90 hari setelah pengumuman pemenang, dan seluruh API key dihapus sebelum submit.
- Seluruh anggota tim wajib menyelesaikan onboarding Sectors di sectors.app SEBELUM tim menulis kode proyek. Onboarding diverifikasi pada eligibility check, dan tim yang salah satu anggotanya belum onboarding sampai deadline registrasi dapat dinyatakan submission-nya tidak berlaku.
- Kuota API: 1.000 credit per tim, TOTAL untuk seluruh kompetisi, diklaim lewat halaman tim di portal setelah semua anggota onboarding, dan hangus saat event selesai. Roster tim terkunci begitu credit bonus diklaim. Registrasi akun ganda untuk menambah credit adalah dasar diskualifikasi.
- Tim boleh solo atau 2-4 orang, satu orang hanya boleh di satu tim, satu tim hanya boleh satu proyek.
- Peserta wajib WNI atau berdomisili di Indonesia.
- **[DIPERBARUI 26 Sep 2026, diverifikasi langsung dari hackathon.sectors.app/rules]** Registrasi ditutup 7 Oktober 2026, 23:59 WIB (sehari sebelum submission, supaya onboarding dan credit grant sempat diverifikasi). Tanpa registrasi, submission tidak berlaku.
- **[DIPERBARUI 26 Sep 2026]** Deadline submission: 8 Oktober 2026, 23:59 WIB. Judging 9-16 Oktober, pengumuman pemenang 17 Oktober 2026. (Dokumen `Sectors_Hackathon_Rules_Constraints.docx` yang di-generate 12 September masih menyebut 22/30 September/1-8/9 Oktober — itu SUDAH USANG, rujuk tanggal di baris ini.)
- Repo FREEZE setelah submit: dilarang commit, push, atau perubahan apapun pasca submit, kecuali proses khusus pencabutan API key yang bocor.
- Kelengkapan submission bukan hanya repo: video teaser 1 menit (publik di YouTube/medsos), video judging maksimal 3 menit (YouTube/Vimeo publik atau unlisted, Google Drive dengan link sharing aktif, atau Loom -- video yang tidak bisa diakses tidak dinilai), satu kalimat problem statement, pemilihan track dan daftar anggota tim, serta post media sosial di Instagram/LinkedIn/Threads/TikTok yang menandai akun resmi Sectors DAN memakai template thumbnail yang disediakan panitia. Submission dan video boleh berbahasa Indonesia atau Inggris, tidak ada yang diunggulkan.
- Bobot penilaian: real-world usability 40 persen, video demo dan storytelling 30 persen, technical depth 30 persen. Sectors menyatakan eksplisit tidak menilai kecanggihan kode, melainkan apakah produk benar-benar bisa dipakai orang sungguhan.
- Eligibility check bersifat lolos atau gagal, dijalankan sebelum scoring: submission lengkap, produk benar-benar berjalan, data Sectors sebagai core, dan onboarding seluruh anggota terverifikasi.
- Deployment live TIDAK diwajibkan. Repo publik ditambah video judging yang menunjukkan core workflow end-to-end sudah cukup melewati gate 'produk berjalan'. Hosting 24 jam tetap berguna untuk bukti run otonom, tapi bukan syarat kelulusan.
- Pemakaian AI coding tools diizinkan penuh, tanpa batasan dan tanpa kewajiban disclosure.
- Judging sepenuhnya asinkron 9-16 Oktober, tanpa sesi presentasi live. Repo dan video harus bisa berbicara sendiri tanpa penjelasan tambahan dari tim.
- Juri boleh MEMINDAHKAN track, bukan mendiskualifikasi, jika proyek lebih cocok di track lain. Rules menyebut eksplisit bahwa pipeline otonom yang menghasilkan skor bisa masuk Automation and Workflows maupun Market Intelligence, jadi pilihan track proyek ini aman.
- Hadiah per 26 September mencakup langganan Sectors Insider + credit tambahan, bukan hanya cash: juara 1 = Rp15.000.000 + 6 bulan Insider + 20.000 credit; runner-up = Rp9.000.000 + 4 bulan + 15.000 credit; 3 finalis masing-masing Rp2.000.000 + 2 bulan + 10.000 credit. Credit hadiah ini hangus 3 bulan setelah diterbitkan (beda dari 1.000 credit grant awal yang hangus saat event selesai).

Referensi lengkap rules, do's, don'ts, dan bobot penilaian ada di file terpisah (`Sectors_Hackathon_Rules_Constraints.docx`).

---

## 3. Keputusan Arah Produk yang Sudah Difiksasi

Catatan penting: keputusan di bawah ini adalah hasil akhir setelah beberapa kali perubahan arah selama diskusi. Jangan mengubah arah ini lagi tanpa diskusi ulang eksplisit dengan seluruh tim.

- Track: Automation and Workflows (bukan AI Agents and Assistants).
- Target pengguna: investor retail dan orang awam, bukan analyst institusi.
- Sifat interaksi: push otomatis satu arah (bukan AI assistant interaktif atau chatbot tanya-jawab).
- Delivery channel utama: Telegram. Email sebagai kanal sekunder opsional. WhatsApp tidak diprioritaskan karena kompleksitas setup API resmi.
- Data storage/histori: Google Sheets sebagai rekap harian dan audit trail.
- Mode output: mode simple (bahasa sederhana untuk retail) dan mode detail (data lebih rinci).

---

## 4. Alur Workflow (High Level)

1. Scheduler trigger berjalan otomatis setiap pagi sebelum pasar dibuka.
2. Fetch data tahap pertama: Daily Transaction Data, Top Company Movers, Most Traded Stocks untuk mendapatkan kandidat saham harian.
3. Fetch data tahap kedua (enrichment) untuk tiap kandidat: News Articles, Broker Activity Per Symbol, Top Accumulations and Distributions Per Broker, Daily Net Foreign Inflow.
4. Scoring engine menggabungkan seluruh sinyal menjadi satu nilai ranking beserta alasan tertulis (lihat `SCORING_LOGIC.md` untuk detail rumus).
5. Hasil disusun dalam mode simple dan mode detail.
6. Disclaimer ditambahkan pada setiap keluaran.
7. Hasil dikirim melalui delivery layer (Telegram, opsional Email) dan disimpan ke Google Sheet.
8. Setiap proses yang berjalan dicatat sebagai log, menjadi bukti otonomi untuk keperluan video judging.

Diagram alur lengkap tersedia di `Perencanaan_Workflow_Sectors_Hackathon.docx`.

---

## 5. Letak Scoring Logic pada Workflow

Scoring logic bukan satu titik tunggal, tapi tersebar pada beberapa tahap workflow. Berikut posisinya secara eksplisit:

| Tahap Workflow | Komponen Scoring yang Terlibat |
|---|---|
| Setelah Fetch Data Tahap 1 | Perhitungan volume anomaly (normalisasi dan threshold), sebagai penyaring awal kandidat |
| Setelah Fetch Data Tahap 2 | Perhitungan skor broker flow (deteksi akumulasi/distribusi), skor sentimen dan relevansi berita (termasuk time decay), skor foreign inflow |
| Scoring Engine (node gabungan) | Weighted scoring, menggabungkan seluruh skor individual menjadi satu nilai ranking akhir menggunakan bobot per faktor |
| Sebelum Output Ranking | Anti-noise filter (misal minimum threshold likuiditas/market cap) untuk mencegah saham kecil yang gampang dimanipulasi lolos ke watchlist |
| Output Ranking | Penyusunan reasoning text otomatis berdasarkan hasil skor, dalam format mode simple dan mode detail |

Catatan penting: seluruh angka, threshold, dan bobot pada tahap-tahap di atas bersifat DINAMIS. Angka-angka ini akan berubah seiring hasil perhitungan dan analisa market yang dilakukan tim, dan tidak boleh dianggap final hanya karena sudah pernah ditulis sekali. Rujukan angka yang berlaku selalu mengikuti versi terbaru pada `SCORING_LOGIC.md`, bukan dokumen ini.

---

## 6. Plan Execution

1. Fiksasi ide dan perencanaan (selesai).
2. Verifikasi dan testing API secara manual sebelum masuk ke n8n.
3. Penyusunan rumus dan angka scoring awal oleh tim (dicatat di `SCORING_LOGIC.md`).
4. Setup infrastruktur: hosting n8n, koneksi Telegram Bot API, koneksi Google Sheets API.
5. Build workflow di n8n tahap demi tahap: fetch, enrichment, scoring, output, delivery, logging.
6. Testing end-to-end secara manual (trigger manual dulu sebelum diaktifkan terjadwal).
7. Aktivasi scheduled trigger dan biarkan berjalan otonom beberapa hari sebelum deadline untuk mengumpulkan bukti log.
8. Penyusunan README, video teaser, dan video judging.
9. Pembersihan API key dan submit repo.

---

## 7. Output yang Diharapkan

Bentuk keluaran: pesan terjadwal harian yang dikirim ke channel Telegram (dan/atau email), berisi daftar saham teratas hari itu beserta skor dan alasan tertulis singkat (mode simple), dilengkapi link menuju rekap detail di Google Sheet (mode detail), serta disclaimer pada setiap pengiriman.

Cara pemakaian oleh pengguna: pengguna melakukan subscribe satu kali ke channel Telegram atau mendaftarkan email, kemudian secara otomatis menerima ringkasan setiap pagi sebelum pasar dibuka. Tidak ada instalasi aplikasi atau file yang perlu diunduh oleh pengguna. Seluruh sistem berjalan di sisi server/hosting tim, bukan didistribusikan ke perangkat pengguna.

Batasan yang berlaku pada output: tidak ada interaksi tanya-jawab real-time dengan pengguna, tidak ada personalisasi per pengguna pada versi awal, jumlah saham per pengiriman dibatasi (contoh: top 5 sampai 10 saham per hari).

---

## 8. Checklist Testing API (Sebelum Build ke n8n)

- Uji manual tiap endpoint wajib melalui HTTP Request node atau Postman, verifikasi struktur response JSON aktual.
- Cek rate limit dan kuota API harian atau per menit.
- Cek metode autentikasi API key dan penempatannya (header atau query parameter).
- Catat field yang sering kosong atau null pada response nyata, sebagai dasar penanganan error.

---

## 9. Checklist Infrastruktur dan Deployment

- Hosting n8n yang aktif 24 jam selama sisa masa kompetisi (n8n Cloud, VPS, atau platform seperti Railway/Render). Catatan: deployment live bukan syarat kelulusan, jadi jangan habiskan waktu di sini dengan mengorbankan video judging yang bobotnya 30 persen.
- Anggaran credit dipantau sebagai bagian infrastruktur: 1.000 credit total, sekitar 32 credit per hari untuk 8 kandidat (angka diverifikasi 26 Sep 2026 lewat header limit-consumption API sungguhan — beberapa endpoint ternyata lebih mahal dari dokumentasi, lihat docs/API_FINDINGS.md §1.2). Pengembangan dan debugging wajib memakai fixture di out/api-samples/, bukan API langsung.
- SECTORS_API_KEY sudah didapat dan terverifikasi (26 Sep 2026) — seluruh 7 endpoint lolos npm run verify:api dengan key asli. Key tersimpan di .env (tidak di-commit).
- Scheduler trigger menggunakan timezone WIB yang benar.
- Koneksi Telegram Bot API melalui BotFather.
- Koneksi Google Sheets API melalui service account.
- Channel atau grup Telegram tempat pengguna melakukan subscribe.

---

## 10. Checklist Dokumentasi dan Kepatuhan

- README repo mencantumkan deskripsi produk, cara kerja, dan bukti log run otonom.
- Disclaimer final tercantum pada setiap keluaran pesan.
- API key tidak pernah di-hardcode pada kode yang di-commit, gunakan environment variable atau credential store n8n.
- Seluruh commit dilakukan setelah 19 Agustus 2026.

---

## 11. Riwayat Perubahan Arah (untuk konteks, agar tidak diulang)

- Sempat mempertimbangkan target analyst/institusi kecil dengan sinyal broker flow, lalu bergeser ke retail dengan tetap mempertahankan sinyal broker flow setelah dikonfirmasi datanya tersedia di Sectors API.
- Sempat mempertimbangkan pivot ke web app dengan AI assistant interaktif (mendekati track AI Agents and Assistants), namun diputuskan untuk tetap pada track Automation and Workflows dengan skema push otomatis.
- Sempat salah asumsi bahwa data broker tidak tersedia di Sectors API, kemudian terkonfirmasi tersedia lengkap melalui pengecekan langsung oleh tim.
