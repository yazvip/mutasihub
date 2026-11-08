# Audit UI/UX Premium MutasiHub — 7 Nov 2026 (draf, menunggu hasil visual browser)

## A. Audit kode (globals.css + komponen, 7 Nov 2026)

### Kontras (WCAG, dihitung dari nilai hex)
- muted #64748b di #f8fafc = 4.55:1 — lolos AA ✓
- muted #78716c di #faf8f3 = 4.52:1 — lolos AA ✓ (tipis)
- ink #0f172a di #f8fafc = 17.06:1 ✓
- accent-ink #047857 di #ecfdf5 = 5.21:1 ✓
- nav-link #475569 di putih = 7.58:1 ✓
- eyebrow #047857 di putih = 5.48:1 ✓
- amber-ink #b45309 di #fffbeb = 4.84:1 ✓
- red-ink #be123c di #fff1f2 = 5.72:1 ✓
- **P1 — putih di accent #059669 (btn-primary + tab aktif di panel) = 3.77:1 — GAGAL AA (butuh 4.5:1).** Template Rajacek pakai brand-700 #047857 untuk tombol primer. Perbaikan: panel-scope `.btn-primary` dan `.tab.active` pakai `var(--accent-ink)` (#047857, ~4.9:1) + hover #065f46. Landing aman (putih di #14532d = 9.11:1).

### Mobile / sentuh
- **P1 — input font-size 14px (panel) / 15px (landing): iOS auto-zoom saat focus** karena < 16px. Perbaikan: input/select/textarea 16px di lebar HP (atau global 16px).
- **P1 — target sentuh < 44px:** .btn ~38px, .nav-link ~38px, .tab ~38px, .menu-button 38px, .btn-sm lebih kecil lagi. Perbaikan: naikkan padding vertikal di ≤1023px (min-height 44px) untuk .btn, .nav-link, .tab, .menu-button.
- Tabel `min-width: 640px` + scroll horizontal — pola benar, tapi di HP tetap perlu cek visual (menunggu screenshot).

### Konsistensi token (panel slate vs sisa paper)
- **P1 — `.tab` inactive hardcoded `#f0ede6` (beige) — tidak di-override di panel-scope**, jadi pil tab beige di atas slate #f8fafc. Perbaikan: `.app-shell .tab { background: #f1f5f9; }`.
- `.badge-gray` hardcoded `#f0ede6` — sama, override di panel-scope ke #f1f5f9.
- `.google-btn:hover #f7f4ee` — hanya di halaman auth (bukan panel), biarkan.
- `.card` shadow sangat tipis (0 1px 2px) — datar; premium: tambah hover lift halus di kartu interaktif (P2).

### State & aksesibilitas
- **P1 — tidak ada skeleton loader:** `.loading` hanya teks "Memuat…" di tengah. Semua halaman panel menampilkan ini saat fetch. Perbaikan: komponen Skeleton (kartu stat + baris tabel) dipakai di dashboard/accounts/admin.
- **P1 — tidak ada `:focus-visible` pada button/link/nav** (hanya input punya outline). Perbaikan: ring fokus 2px accent-ink offset 2px untuk .btn, .nav-link, a, .tab, .menu-button.
- **P2 — empty state polos:** `.empty` hanya teks tengah tanpa ikon/aksi. Perbaikan: ikon + CTA kontekstual (mis. "Hubungkan Rekening" di dashboard kosong).
- Tidak ada `prefers-reduced-motion` — P2 minor.

### Tipografi & ritme
- Skala sudah rapi: hero 44→32px, section h2 30px, PageHeading 22px/800, card h3 14px (panel), label 11px uppercase. Tidak ada masalah besar.
- **P2 — ikon produk landing masih huruf serif ("D", "B", "?")** — "?" untuk Inquiry terasa generik. Perbaikan: SVG ikon sungguhan (dompet, bank, kaca pembesar).
- `.stat-value` mono 24px, `.stat` min-height 111px — bagus.
- Radius konsisten (12px kontrol, 16px panel). OK.

## B. Audit visual (browser, desktop 1919px, 7 Nov 2026 ~10:51–10:55 WIB) — TERVERIFIKASI
Akun tes audit-ui-7107@example.com dibuat browser, terverifikasi di panel admin, SUDAH DIHAPUS (members kembali 5).
CATATAN: mobile 390px TIDAK terverifikasi — jendela browser terkunci 1919px, semua upaya resize gagal. Temuan mobile di bawah ini prediksi dari kode, bukan observasi.

### P0 (terverifikasi di kode + visual)
1. **Logo sidebar rusak** — "MutasiHubPortal" / "MutasiHubPanel" tanpa spasi, membungkus 2 baris; badge "Production" terpotong jadi "• Pro…". Penyebab: `.brand-name small` tidak punya aturan CSS (inline, bukan block seperti template Rajacek) + brand-wrap 256px terlalu sempit untuk nama + pill. Perbaikan: `.brand-name small { display:block; font-size:10px; uppercase; }` + rapikan brand-wrap/pill.
2. **Tombol submit auth putih** — /login, /register, /admin-login: `<Button variant="primary" className="google-btn">` — class `.google-btn` (background #fff, didefinisikan setelah .btn-primary) menimpa hijau primer. Perbaikan: hapus class google-btn dari tombol submit; Google button diberi ikon G SVG.
3. **Breadcrumb admin salah** — /admin/plans & /admin/members tampil "MutasiHub / Dashboard". Penyebab: `find()` cocokkan prefix — `/admin/plans`.startsWith('/admin/') kena item /admin yang duluan. Perbaikan: exact-match dulu, lalu prefix terpanjang.
4. **Overflow horizontal halaman admin di 1919px** — scrollbar terlihat di /admin, /admin/plans, /admin/members. Penyebab pasti belum dikonfirmasi (dugaan: tabel 12 kolom plans + tabel members lebar di dalam card); saat perbaikan, ukur elemen pelanggar lalu perbaiki (sticky actions + batasi lebar kolom).
5. **Kontras tombol primer panel 3.77:1** (putih di #059669, gagal AA) — lihat A. Perbaikan: `.btn-primary` + `.tab.active` panel pakai accent-ink #047857.

### P1
6. **Sidebar gap ~250–300px** antara grup nav dan grup bawah (margin-top:auto). Perbaikan: isi dengan kartu mini (member: paket + sisa kuota; admin: kuota Connecta) — lebih premium daripada melepas pin.
7. **Form "Tambah Paket" terisi default Starter** (EMPTY = price 350000, 30 hari, 2 rekening, delay 0, notif 5, device 1) — tampak seperti form edit, risiko duplikat tak sengaja. Perbaikan: kosongkan + placeholder + hint.
8. **Tabel plans 12 kolom padat**, aksi Ubah/Hapus hanya terlihat lewat scroll horizontal. Perbaikan: gabung kolom batas (delay/notif/device) + sticky kolom aksi.
9. **Loading hanya teks "Memuat…"** + tombol disabled pucat (opacity .55) kontras lemah. Perbaikan: Skeleton (stat + baris tabel) + gaya disabled terbaca (teks tetap gelap).
10. **Input 14–15px → iOS auto-zoom; target sentuh ~38px < 44px** (btn, nav-link, tab, menu-button). Perbaikan: input 16px di HP + min-height 44px untuk kontrol sentuh di ≤1023px.
11. **`.tab` inactive beige #f0ede6 di panel slate** (+ `.badge-gray` sama) — tidak di-override panel-scope. Perbaikan: #f1f5f9 di `.app-shell`.
12. **Empty state polos** tanpa ikon/CTA (dashboard, rekening, playground). Perbaikan: EmptyState + ikon + CTA kontekstual.
13. **Tidak ada `:focus-visible`** pada button/link/nav (hanya input). Perbaikan: ring 2px accent-ink.

### P2
14. Format inkonsisten: "ACTIVE" vs "active", "Ya (demo)" redundan (kode: `is_demo ? 'Ya (demo)'`), "0 / 5" vs "0/5". Normalisasi label status + spasi.
15. Placeholder inkonsisten ("08xxxxxxxxxx" vs "mis. 1234567890") + PIN placeholder harfiah "••••••" (membingungkan). Normalisasi.
16. Bank "(BCA) (014)" kurung ganda — label `{b.name} ({b.code})` padahal nama sudah mengandung (BCA). Dedupe.
17. "Reset" ghost vs Refresh/Ekspor outline; stat "Terakhir Disinkronkan" membungkus 2 baris (format tanggal panjang, 18px); sub "DANA + BCA terhubung" menyesatkan saat total 1.
18. Landing: grid harga 4 kartu dalam 3 kolom (Enterprise jatuh sendiri); jarak antar-seksi besar; hero tanpa pratinjau produk; FAQ semua tertutup; ikon produk masih huruf ("D","B","?").
19. Register/login: kartu sempit di ruang kosong; Google tanpa ikon; tanpa indikator kekuatan password / lihat password.
20. Admin-login polos tanpa logo/tautan kembali.
21. Members: kolom Nama/Email terlalu lebar vs Paket/Rekening/Status terhimpit; tanpa aksi per baris; ruang kosong ~350px di bawah tabel.

### Yang sudah baik (terverifikasi)
- Hero + kartu produk landing rapi, mudah dibaca; tidak ada teks bertumpuk di desktop.
- Skala tipografi konsisten; kontras teks mayoritas lolos AA (4.5–17:1).
- Struktur shell/topbar/breadcrumb sudah benar (kecuali bug #3).
- Pendaftaran member + login admin berhasil; semua halaman termuat.
