# Audit UI/UX MutasiHub — 2026-11-08

**Situs:** https://mutasi.rajacek.com · **Versi live saat audit:** v30b (frontend BUILD_ID `RJXWdVuUAh6-NL3XvEl-E`, backend `8be1bfc8`)
**Tanggal audit:** 8 November 2026, ~19:40–21:30 WIB · **Sifat:** audit saja — tidak ada satu baris kode pun yang diubah, tidak ada deploy.
**Metode:** Playwright lokal (Chromium `chromium-1254` via forwarder `127.0.0.1:18080`), screenshot + pengukuran otomatis per halaman (overflow horizontal dokumen, elemen yang melewati viewport, font input <16px, target tap <32px) + inspeksi visual tiap screenshot + verifikasi akar via probe DOM untuk temuan P0.
**Cakupan:** 52 screenshot — publik 6 halaman, member 8 halaman, admin 7 halaman; masing-masing HP 390px + desktop 1280px, plus tablet 768px untuk landing, dashboard member, rekening; drawer HP member + admin; modal Tambah Rekening + modal konfirmasi ganti paket (HP + desktop).
**Screenshot:** `~/workspace/mutasi-platform/shots-audit-uiux-2026-11-08/` (versi kecil landing/docs di subfolder `view/`; `measurements-admin.json` berisi pengukuran admin).

## Ringkasan eksekutif

Kesan keseluruhan: **sudah premium di permukaan, rapuh di HP pada detailnya.** Landing, auth baru (v25), dan panel member terlihat seperti produk SaaS fintech yang rapi — tipografi, warna emerald, kartu, dan spacing konsisten di desktop. Tetapi di HP 390px ada dua cacat yang benar-benar merusak (P0), sembilan inkonsistensi/kerusakan sedang (P1), dan selusin detail polish (P2). Pola yang berulang: (1) **grid/table blowout** — elemen yang min-content-nya lebih lebar dari viewport dan terpotong tanpa bisa di-scroll; (2) **tabel yang hanya mengandalkan scroll horizontal** di semua panel; (3) **sisa bahasa desain lama** (Georgia + aksen coklat) di /docs dan /admin-login; (4) **input 14px** di hampir semua form panel.

| Area | Kesan | P0 | P1 | P2 |
|---|---|---|---|---|
| Landing | Premium; kalkulator + FAQ + pricing rapi. Rusak di tablet 768 (CTA nav hilang) dan mock browser HP | 1 | 1 | 3 |
| Auth (/login, /register, /forgot-password) | Shell v25 konsisten dan rapi | 0 | 0 | 0 |
| /admin-login | Masih template lama + serif — tidak ikut v25 | 0 | 1 | 0 |
| /docs | Isi bagus, tabel error sudah pola kartu; tapi heading + logo masih bahasa lama | 0 | 1 | 1 |
| Member (dashboard, rekening, inquiry, playground, langganan, API, keamanan) | Rapi di desktop; di HP: banner pecah kolom, stat pecah angka, header kartu sempit, token pecah | 0 | 5 | 5 |
| Admin (dashboard, member, detail, paket, pengaturan, audit log, playground) | Fungsional; detail member P0; audit log + daftar paket sulit dibaca di HP | 1 | 3 | 4 |
| **Total** | | **2** | **9** | **12** |

**Yang bertahan baik (verifikasi ulang perbaikan lama):** modal Tambah Rekening dan modal ganti paket muat penuh di HP dengan tombol terjangkau (v21d bertahan); badge "Sync dijeda" sudah di dalam kartu rekening (v30b bertahan); `overflowX` dokumen = 0 di SEMUA halaman dan viewport (tidak ada scroll horizontal halaman); drawer member/admin rapi; empty state (callback, 2FA) dirancang dengan baik; tabel error /docs sudah pola kartu berlabel; desktop 1280 tanpa offender di semua halaman.

**Tiga temuan lama — hasil verifikasi ulang:**
1. Kolom aksi tabel Rekening di HP masih perlu scroll horizontal — **MASIH ADA** (tombol Hapus di luar layar; lihat P1-4).
2. Teks "Belum pernah" di stat dashboard membungkus 2 baris di HP — **MASIH ADA** (lihat P1-6; di desktop sudah 1 baris).
3. Header kartu "Mutasi" sempit di HP — **MASIH ADA** (lihat P1-7).

---

## P0 — Rusak / tidak bisa dipakai

### P0-1 — Detail Member admin HP: kartu bawah melebar melewati viewport, terpotong tanpa bisa di-scroll
- **Halaman + viewport:** `/admin/members/[id]`, HP 390px. Desktop 1280 tidak bermasalah.
- **Bukti:** `admin-member-detail-hp390.png` — kartu "Rekening terhubung", "API Key", dan "Paket & status" semuanya terpotong di tepi kanan; tombol **"Edit member" terpotong** (bagian kanannya di luar layar); header kolom "TERAKHIR SINKRO…" terpotong; teks "Hanya prefix yang tampil — secret tidak pernah disimpan u…" terpotong di tengah kata. Pengukuran: satu `DIV` 426px (right=442) di viewport 390; dokumen `overflowX=0` — jadi bagian yang terpotong **tidak bisa dijangkau dengan scroll**.
- **Akar (terverifikasi via probe DOM):** seksi bawah memakai `.grid-2` yang di ≤900px menjadi `grid-template-columns: 1fr` — tetapi `1fr` = `minmax(auto, 1fr)`, dan minimum `auto` = min-content terbesar isi grid. Hasil ukur: track terhitung **426.344px** padahal container grid hanya **358px**. Salah satu isi kartu punya min-content ±426px (kandidat terkuat: tabel di dalam `.table-wrap` — jumlah lebar intrinsik kolom-kolomnya; kedua tabel sudah `minWidth: 0` inline dan lebar rendernya 384px, jadi bukan tabelnya sendiri yang meluber, melainkan min-content yang bocor ke track). Bukti perbaikan: menyetel `min-width: 0` pada anak `.grid-2` di browser langsung mengembalikan track ke **358px** dan kedua anak grid jadi 358px.
- **Perbaikan yang disarankan:** di `frontend/app/globals.css`, tambah `min-width: 0` pada `.grid-2 > *` (dan audit `.grid-3`/`.grid-4` yang sama polanya), atau ubah aturan ≤900px menjadi `grid-template-columns: minmax(0, 1fr)`. Satu aturan CSS; verifikasi ulang dengan screenshot HP 390 halaman detail member. **Usaha: kecil.**

### P0-2 — Landing tablet 768px: tombol "Masuk" / "Daftar Gratis 1 Hari" hilang dari layar
- **Halaman + viewport:** `/` (landing), tablet 768px. HP 390 (hamburger) dan desktop 1280 normal.
- **Bukti:** `pub-landing-t768.png` / `view/pub-landing-t768-top.png` — di 768px yang tampil justru **nav desktop** (link Produk/Fitur/Cara Kerja/Keamanan/Paket & Harga/Kalkulator/FAQ membungkus 2 baris), sedangkan tombol CTA nav terdorong keluar viewport (pengukuran: tombol nav right=919, lebar 165, viewport 768) dan **tidak terlihat sama sekali**; tidak ada hamburger. Akibatnya pengunjung tablet tidak bisa masuk/daftar dari nav.
- **Akar:** nav landing di `frontend/app/page.tsx` memakai breakpoint sendiri (kemungkinan `hidden md:flex`, sehingga nav desktop aktif tepat di 768px) — tidak mengikuti aturan panel (`.main-nav { display: none }` di ≤900px). Di 768px lebar tidak cukup untuk logo + 7 link + 2 tombol.
- **Perbaikan yang disarankan:** naikkan breakpoint nav landing ke `lg` (1024px): tampilkan hamburger + sembunyikan link + CTA desktop di bawah `lg`; atau di 768–1023 tampilkan hanya logo + hamburger + satu tombol "Masuk". Verifikasi di 768px dan 1024px. **Usaha: kecil.**

---

## P1 — Terlihat tidak profesional / inkonsisten

### P1-1 — Banner info Inquiry HP: kalimat terpecah jadi tiga kolom
- **Halaman + viewport:** `/member/inquiry`, HP 390px (akun Trial — gate inquiry nonaktif).
- **Bukti:** `member-inquiry-hp390.png` — banner biru menampilkan tiga kolom terpisah: "Fitur Inquiry Rekening tidak aktif di paket kamu." | "Lihat paket & upgrade" | "untuk mengaktifkannya." Kalimat yang sama dibaca sebagai tiga fragmen.
- **Akar:** `.banner { display: flex; justify-content: space-between; }` (`app/globals.css:194-197`) — teks dan link adalah dua item flex; di HP keduanya membungkus di kolomnya masing-masing. Markup di `app/member/inquiry/page.tsx:144-147` adalah satu paragraf dengan link inline di tengah kalimat, jadi flex-lah yang memecahnya.
- **Perbaikan yang disarankan:** di ≤560px jadikan `.banner { flex-direction: column; align-items: flex-start; }` (link jadi baris sendiri di bawah teks, atau jadikan tombol kecil). Berlaku untuk semua banner (ErrorBanner juga pakai class ini) — cek halaman lain setelah diubah. **Usaha: kecil.**

### P1-2 — /docs dan /admin-login masih memakai bahasa desain lama (Georgia + coklat)
- **Halaman + viewport:** `/docs` dan `/admin-login`, semua viewport.
- **Bukti:** `view/pub-docs-hp390-s0.png` + `view/pub-docs-hp390-s3.png` — semua heading ("API MutasiHub", "01 Pengantar", "02 Mulai Cepat", "Buat API key", "06 Rate Limit", "07 Error") memakai **Georgia**; nama brand "MutasiHub" di header juga Georgia; logo "M" **coklat tua**, bukan emerald seperti landing/member. `pub-admin-login-hp390.png` — judul "Admin" Georgia, kartu polos tanpa logo/back-link, tombol "Masuk Admin" kecil rata kiri (bukan full-width seperti /login).
- **Akar:** aturan global `h1, h2, h3, .serif { font-family: Georgia }` (`app/globals.css:94-95`) + `.brand-name { font-family: Georgia }` (`:129`). Landing dipaksa sans oleh scope `.landing-tw`, panel member oleh `.member-shell` — **/docs dan /admin-login berada di luar kedua scope itu**. Logo coklat berasal dari `accent_color` `#6a1e0b` di Pengaturan (lihat P1-8).
- **Perbaikan yang disarankan:** (a) bungkus `/docs` dalam scope `.landing-tw` atau tambah aturan `.docs h1, h2, h3 { font-family: Plus Jakarta Sans }` + `.brand-name` sans di docs; (b) migrasikan `/admin-login` ke `components/auth-shell.tsx` (shell v25: logo, tombol full-width, link kembali ke beranda); (c) putuskan warna aksen resmi (lihat P1-8). **Usaha: kecil–sedang.**

### P1-3 — Token pecah di tengah kata (mid-token wrap) di tiga tabel HP
- **Halaman + viewport:** HP 390px — (a) `/member/api`, (b) `/admin/plans`, (c) `/admin/audit-logs`.
- **Bukti:** (a) `member-api-hp390.png` — prefix key tampil "mh_au / d…1234" (pecah di tengah), scope "mutasi:read" jadi "mutasi: / read". (b) `admin-plans-hp390.png` — slug "trial" → "tria / l", "starter" → "star / ter", "enterprise" → "ente / rpri / se"; harga "Rp350.000" terpotong di tepi. (c) `admin-audit-logs-hp390.png` — UUID aktor pecah jadi ±8 baris ("a3b1b6 / 8b-5cc / b-47aa / …"), tiap baris setinggi ±200px; kolom Aksi terpotong ("account_dele…", "bank_inquiry…"); kolom Detail/IP di luar layar.
- **Akar:** sel tabel memakai `overflow-wrap` yang memecah token + kolom terlalu sempit; (c) menampilkan UUID mentah 36 karakter yang tidak bermakna bagi manusia.
- **Perbaikan yang disarankan:** (a)(b) `white-space: nowrap` + `text-overflow: ellipsis` pada sel token (prefix key, scope, slug, harga), atau ubah tabel-tabel ini jadi kartu berlabel di HP mengikuti pola tabel error /docs; (c) tampilkan aktor sebagai 8 karakter pertama UUID atau — lebih baik — nama/email member (sudah ada di halaman Member), dan sembunyikan kolom Detail/IP di HP atau pindahkan ke kartu. **Usaha: sedang.**

### P1-4 — Semua tabel panel hanya mengandalkan scroll horizontal di HP (min-width global 640px)
- **Halaman + viewport:** HP 390px — `/member/dashboard` (tabel Mutasi, right=677), `/member/accounts` (right=536), `/member/api` (right=677), `/member/subscription` (riwayat, right=677), `/admin` (Member Terbaru, right=677), `/admin/members` (right=677), `/admin/plans` (right=734 — paling lebar), `/admin/audit-logs` (right=704).
- **Bukti:** semua screenshot `*-hp390.png` + pengukuran (lebar tabel 640–697px vs viewport 390). Dampak paling nyata: tombol **Hapus rekening** di `/member/accounts` berada di luar layar — aksi utama hanya bisa dijangkau setelah menggeser tabel (temuan lama v30b, masih ada). Desktop 1280 tidak bermasalah (0 offender).
- **Perbaikan yang disarankan:** ubah tabel panel menjadi **kartu berlabel di ≤640px** mengikuti pola tabel error di /docs (label + nilai per baris, sudah terbukti rapi di HP) — mulai dari tabel Rekening (aksi Hapus harus terlihat tanpa scroll), lalu Mutasi, Riwayat Langganan, Daftar Member, Daftar Paket, Audit Log. Aturan global `table { min-width: 640px }` (`app/globals.css:226`) tidak diubah; pola kartu diterapkan per tabel seperti v30b. **Usaha: sedang–besar (per tabel, pola sudah ada).**

### P1-5 — Input 14px di hampir semua form panel (risiko iOS auto-zoom)
- **Halaman + viewport:** HP 390px — inquiry + playground (SELECT + INPUT), api (TEXTAREA + datetime-local + checkbox), change-password (3× INPUT password), admin members (search + 2 SELECT), admin plans (8 input teks/angka), admin settings (teks/URL/color), audit-logs (2 search). Desktop: input admin-login 14px.
- **Bukti:** pengukuran `smallInputs` di semua halaman panel (daftar lengkap di bawah). Catatan: ada aturan media query yang menaikkan `input, select, textarea` ke 16px di HP pada halaman tertentu — /login, /register, /admin-login HP sudah 16px — tetapi aturan itu **tidak berlaku di halaman panel member/admin**.
- **Perbaikan yang disarankan:** samakan ke 16px untuk semua form panel (`app/globals.css` — angkat/lebarkan aturan font-size input yang sudah ada), lalu cek tampilan desktop (16px di form desktop tetap wajar untuk panel). **Usaha: kecil.**
- Daftar terukur (HP): inquiry: SELECT+INPUT 14px; playground: SELECT+INPUT 14px; api: TEXTAREA+datetime-local+checkbox 14px; change-password: 3× password 14px; admin members: search+2 select 14px; admin plans: 8 input 14px; admin settings: teks/URL/color/checkbox 14px; audit-logs: 2 search 14px.

### P1-6 — Nilai stat dashboard HP pecah di tengah angka; label membungkus
- **Halaman + viewport:** `/member/dashboard`, HP 390px.
- **Bukti:** `member-dashboard-hp390.png` — "TOTAL MASUK **Rp3.450.0 / 00**" pecah di tengah angka (kartu stat 2 kolom terlalu sempit untuk angka mono 20px); "Belum pernah" di stat "TERAKHIR DISINKRONKAN" masih membungkus 2 baris ("Belum / pernah") — temuan lama v26, masih ada; "Semua rekening · WIB" membungkus 2 baris; label "REKENING TERHUBUNG" dan "TERAKHIR DISINKRONKAN" masing-masing 2 baris.
- **Perbaikan yang disarankan:** di ≤560px turunkan `.stat-value` ke 17–18px + `white-space: nowrap` dengan ellipsis untuk nilai angka, atau buat kartu stat tertentu full-width; ganti "Belum pernah" dengan "—" atau "Belum ada" (nowrap). File: `app/globals.css` (`.member-shell .stat-value` / `.stat-label`) + `app/member/dashboard/page.tsx`. **Usaha: kecil.**

### P1-7 — Header kartu "Mutasi" HP masih sempit (temuan lama v26)
- **Halaman + viewport:** `/member/dashboard`, HP 390px.
- **Bukti:** `member-dashboard-hp390.png` + `member-drawer-hp390.png` (latar) — judul + deskripsi terjepit di kolom kiri sementara 3 tombol (Filter, Refresh, Export CSV) memenuhi lebar kartu dan **"Export CSV" terpotong di tepi kanan**.
- **Perbaikan yang disarankan:** di HP jadikan `.card-head` membungkus (`flex-wrap: wrap` — judul full-width, tombol di baris sendiri) atau kecilkan tombol aksi jadi ikon + menu "⋯". File: `components/ui.tsx` (Card) / `app/globals.css` (`.card-head`) / `app/member/dashboard/page.tsx`. **Usaha: kecil.**

### P1-8 — Pengaturan admin: input warna tampil sebagai blok coklat raksasa; aksen coklat ≠ brand emerald
- **Halaman + viewport:** `/admin/settings`, HP 390px (dan desktop).
- **Bukti:** `admin-settings-hp390.png` — field "Warna aksen" menampilkan `<input type="color">` native selebar field dan setinggi ±60px, berupa blok solid coklat `#6a1e0b` — terlihat seperti bilah rusak, bukan pemilih warna. Warna itu sendiri adalah sumber inkonsistensi P1-2 (logo /docs coklat).
- **Perbaikan yang disarankan:** ganti dengan swatch kecil (mis. 48×48, rounded) + field teks hex di sampingnya; putuskan warna aksen resmi — rekomendasi: **emerald `#047857`** agar konsisten dengan seluruh bahasa desain — lalu samakan pemakaian token di semua halaman (landing, docs, panel). File: `app/admin/settings/page.tsx`, `app/globals.css`. **Usaha: kecil** (plus satu keputusan user: warna aksen).

### P1-9 — Mock browser landing HP: URL bertabrakan dengan label "SYNC REALTIME"
- **Halaman + viewport:** `/` (landing), HP 390px. Di tablet 768 sudah pas.
- **Bukti:** `view/pub-landing-hp390-s0.png` — di bilah mock browser, teks "dashboard.mutasihub.com" tertutup titik hijau dan label "SYNC REALTIME" membungkus 2 baris menimpa URL.
- **Perbaikan yang disarankan:** di ≤560px sembunyikan URL (atau kecilkan + `text-overflow: ellipsis` + `min-width: 0`) dan buat label SYNC `white-space: nowrap`. File: `app/page.tsx` (kartu mock dashboard hero). **Usaha: kecil.**

---

## P2 — Polish

### P2-1 — Baris trust hero landing HP: "No Credit Card" membungkus + checkmark tidak sejajar
`view/pub-landing-hp390-s0.png` — kolom ke-3 ("No Credit / Card") membungkus 2 baris sementara dua kolom lain 1 baris; checkmark-nya tidak sejajar dengan kolom lain. Perbaikan: samakan alignment (`align-items: flex-start`, check sejajar judul) atau jadikan 1 kolom di HP. File: `app/page.tsx`. Kecil.

### P2-2 — Inkonsistensi micro-copy harga
Landing memakai "/bln" (`Rp350.000 /bln`), member memakai "/bulan" (`Rp350.000/bulan`); Trial di landing "Masa aktif 24 Jam", di member "Masa aktif 1 hari". Bukti: `view/pub-landing-hp390-s4.png` vs `member-subscription-hp390.png`. Perbaikan: satu sumber format (helper `planPriceRupiah`/`formatRupiah` + satuan "/bulan" di semua tempat; samakan "24 Jam" vs "1 hari"). Kecil.

### P2-3 — Pesan "Pembayaran QRIS nonaktif" muncul 4× di halaman Langganan
`member-subscription-hp390.png` — sekali di kartu banner "Pembayaran manual — hubungi admin" + sekali di bawah tiap paket berbayar (Starter, Pro, Enterprise). Perbaikan: tampilkan sekali di kartu banner; di bawah paket cukup tombol nonaktif. File: `app/member/subscription/page.tsx`. Kecil.

### P2-4 — Tombol "Paket Aktif" terlihat seperti tombol beli
`member-subscription-hp390.png` — kartu Trial (paket yang sedang aktif) memakai tombol hijau penuh yang sama dengan "Pilih Paket". Perbaikan: ubah jadi badge/disabled abu-abu yang tidak terlihat bisa diklik. File: `app/member/subscription/page.tsx`. Kecil.

### P2-5 — Drawer member: "0 rekening aktif" membingungkan
`member-drawer-hp390.png` — sidebar menulis "Paket Trial / 0 rekening aktif / Berakhir 09 Nov 2026" sementara member punya 3 rekening terhubung (semuanya pending, jadi 0 aktif — benar, tapi tidak dijelaskan). Perbaikan: "0 dari 3 rekening aktif" atau "3 terhubung · 0 aktif". File: `components/ui.tsx` (DashboardShell). Kecil.

### P2-6 — Kartu dengan tombol di kanan membuat deskripsi terjepit di HP
`member-security-hp390.png` ("Aktifkan 2FA" — deskripsi 4 baris di kolom ±55% di samping tombol), `admin-settings-hp390.png` (kartu "Connecta"), `admin-dashboard-hp390.png` (kartu "Koneksi Connecta"). Pola yang sama di tiga tempat: judul+deskripsi di kiri, tombol besar di kanan atas. Perbaikan: di HP jadikan `.card-head` kolom (judul+deskripsi full-width, tombol di bawah). File: `components/ui.tsx` / `app/globals.css`. Kecil.

### P2-7 — Dashboard admin: nilai "—" telanjang + state gagal sebagai konten utama
`admin-dashboard-hp390.png` — "AKUN DANA TERHUBUNG —" / "AKUN BCA TERHUBUNG —" dan sublabel "DANA — · BCA —" terlihat seperti data hilang; kartu "Koneksi Connecta" menampilkan "Data kuota belum tersedia" sebagai konten utama dashboard. Perbaikan: empty state yang dirancang ("Belum ada data kuota — Tes Koneksi") + angka 0 eksplisit ("0 akun"). File: `app/admin/page.tsx`. Kecil.

### P2-8 — Tabel Member admin HP: email ter-mask terpotong di tengah domain
`admin-members-hp390.png` — "au************@example.c…" terpotong; kolom PAKET hanya terlihat sebagian ("P…"). Perbaikan: izinkan email membungkus / kecilkan font kolom, atau jadikan kartu di HP (lihat P1-4). File: `app/admin/members/page.tsx`. Kecil.

### P2-9 — Form "Tambah Paket" admin sangat panjang; tombol "Hapus" terlalu menonjol
`admin-plans-hp390.png` — 14 field bertumpuk (±2,5 layar) sebelum mencapai "Daftar Paket"; tombol "Hapus" merah besar setara "Ubah" (aksi destruktif sama menonjolnya dengan edit). Catatan: tombol "Ubah" membuka form edit **inline** ("Ubah Paket"), bukan modal — `admin-modal-plan-hp390.png` mengonfirmasi ini perilaku yang benar, bukan kegagalan. Perbaikan: bagi form jadi seksi collapsible ("Dasar" + "Lanjutan/Inquiry") + "Hapus" jadi tautan/tombol teks merah kecil dengan konfirmasi. File: `app/admin/plans/page.tsx`. Sedang.

### P2-10 — Pengaturan admin: copy error berulang + tombol Simpan di tengah halaman
`admin-settings-hp390.png` — "Tidak bisa memeriksa pendaftaran webhook: gagal memeriksa pendaftaran webhook ke penyedia, coba lagi nanti — coba lagi nanti." (frasa "coba lagi nanti" 2×); tombol "Simpan Pengaturan" terletak di antara kartu Connecta dan kartu Pendaftaran Webhook. Perbaikan: rapikan copy (satu "coba lagi nanti") + pindahkan Simpan ke akhir form / buat sticky. File: `app/admin/settings/page.tsx`. Kecil.

### P2-11 — Blok kode /docs: baris panjang terpotong tanpa penanda scroll
`view/pub-docs-hp390-s0.png`, `view/pub-docs-hp390-s3.png` — contoh cURL/PHP terpotong di tengah token (`https://mutasi.rajacek.com/ap…`, `mh_CONTOH…`); tombol "Salin" tetap berfungsi. Perbaikan: tambah fade di tepi kanan blok kode / scrollbar yang terlihat, atau pecah URL panjang. File: `app/docs/page.tsx`, `app/globals.css`. Kecil.

### P2-12 — Label CTA "Konsultasi Paket" menyesatkan + harga mono renggang
(a) `app/page.tsx:950` — tombol "Konsultasi Paket" di band CTA hanya mengarah ke `/#harga` (daftar harga, bukan konsultasi). Perbaikan: ganti label jadi "Lihat Paket" atau arahkan ke kontak/WA admin. (b) `view/pub-landing-hp390-s4.png` + `s5` — "Rp350.000" tampil renggang ("Rp350 . 000") karena JetBrains Mono di ukuran besar. Perbaikan: harga besar pakai sans tebal (atau `tnum` pada Plus Jakarta Sans); mono hanya untuk angka kecil/label. Kecil.

---

## Di luar lingkup (ditemukan sepintas, bukan temuan UI/UX)
- Copy landing menjanjikan "Pembayaran resmi otomatis via QRIS Gobiz" (subjudul Harga + FAQ) padahal `gobiz_enabled=0` — sudah diketahui, menunggu keputusan user.
- Dashboard admin "Data kuota belum tersedia" + "Tidak bisa memeriksa pendaftaran webhook" — Connecta masih gangguan saat audit (bukan cacat tampilan).
- Kredensial Gobiz / Google OAuth / SMTP masih kosong — sudah diketahui.
- `/member/mutations` dan `/member/api-keys` = 404 (bukan rute; yang benar `/member/api` — mutasi ada di kartu dashboard). Bukan cacat, hanya penegasan penamaan.

## Perkiraan usaha per kelompok (kasar)
| Kelompok | Isi | Usaha |
|---|---|---|
| A — P0 (2 temuan) | Grid blowout detail member + nav tablet 768 | **Kecil** (2 aturan CSS + breakpoint nav) |
| B — Tabel HP (P1-3 + P1-4) | Token nowrap/ellipsis + ubah tabel panel jadi kartu berlabel di HP | **Sedang–besar** (per tabel; pola sudah ada dari /docs) |
| C — Konsistensi bahasa desain (P1-2 + P1-8) | Serif di /docs + /admin-login ke shell v25 + warna aksen | **Kecil–sedang** (+ 1 keputusan user: warna aksen) |
| D — Form & komponen (P1-1, P1-5, P1-6, P1-7, P1-9) | Banner flex, input 16px, stat dashboard, header kartu Mutasi, mock browser | **Kecil–sedang** (sebagian besar 1 aturan CSS) |
| E — Polish P2 (12 temuan) | Micro-copy, tombol, empty state, form paket, blok kode | **Kecil** (masing-masing <1 jam; sebagian hanya copy) |

**Catatan pengukuran (semua dari log run audit):** `overflowX=0` di semua halaman + viewport; pelanggar lebar terukur di HP: landing 2 div dekoratif (right 495/486 — di dalam wadah overflow-hidden, tidak memengaruhi dokumen), landing tablet 768 tombol nav (right 919), dashboard TABLE 677, accounts TABLE.accounts-table 536, api TABLE 677, subscription TABLE 677, admin dashboard TABLE 677, admin members TABLE 677, admin detail DIV 442, admin plans TABLE 734, admin audit-logs TABLE 704; desktop 1280: 0 pelanggar di semua halaman. Target tap kecil: tombol "Salin" /docs (h=25), link nav landing (h=16–17, teks link), "×" modal desktop (h=26), "← Daftar member" admin (h=18).
