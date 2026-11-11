/** Harga paket dalam rupiah: backend kirim price_cents, fallback lama pakai price (rupiah). */
export function planPriceRupiah(p: {
  price_cents?: number | null;
  price?: number | null;
}): number {
  if (p.price_cents !== undefined && p.price_cents !== null)
    return p.price_cents / 100;
  return p.price ?? 0;
}

export function formatRupiah(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return 'Rp0';
  return 'Rp' + Math.round(n).toLocaleString('id-ID');
}

export function formatAmount(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '0';
  const sign = n < 0 ? '-' : '+';
  return sign + 'Rp' + Math.abs(Math.round(n)).toLocaleString('id-ID');
}

export function formatDateWIB(
  iso: string | null | undefined,
  withTime = true,
  withSeconds = false
): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  };
  if (withTime) {
    opts.hour = '2-digit';
    opts.minute = '2-digit';
    if (withSeconds) opts.second = '2-digit';
  }
  // withSeconds: jam pakai ':' (bukan '.' ala id-ID) — contoh
  // "09 Nov 2026, 06:35:12 WIB". Jalur withTime tanpa detik dibiarkan
  // apa adanya agar pemanggil lain tidak berubah.
  if (withTime && withSeconds) {
    const dateStr = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(d);
    const timeStr = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(d);
    return `${dateStr}, ${timeStr} WIB`;
  }
  return new Intl.DateTimeFormat('id-ID', opts).format(d) + (withTime ? ' WIB' : '');
}

export function formatDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Mask nomor HP: 0812xxxxxx34 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '-';
  const s = String(phone).replace(/\s+/g, '');
  if (s.length <= 6) return s;
  return s.slice(0, 4) + 'x'.repeat(Math.max(0, s.length - 6)) + s.slice(-2);
}

/** Mask nomor rekening: tampilkan 4 digit terakhir */
export function maskAccountNo(no: string | null | undefined): string {
  if (!no) return '-';
  const s = String(no).replace(/\s+/g, '');
  if (s.length <= 4) return '****' + s;
  return '**** ' + s.slice(-4);
}

export function maskApiKey(key: string | null | undefined): string {
  if (!key) return '-';
  if (key.length <= 8) return key.slice(0, 4) + '…';
  return key.slice(0, 6) + '…' + key.slice(-4);
}

export function providerLabel(type: string | null | undefined): string {
  if (type === 'dana') return 'DANA';
  if (type === 'bca') return 'BCA';
  return (type || '-').toUpperCase();
}

// ---- Inquiry Rekening: teks fitur paket (satu-satunya sumber, v24) ----
// Kontrak backend (domain.Plan): inquiry_enabled + inquiry_limit
// (number | null; null = tanpa batas, >= 0 = batas hit/hari, 0 = tidak
// ada hit diizinkan). Field belum ada (backend lama) diperlakukan sebagai
// tanpa batas — backend lama memang belum menegakkan batas harian.
export type InquiryPlan = {
  inquiry_enabled?: boolean | null;
  inquiry_limit?: number | null;
};

/** 'Tanpa batas' bila limit null/undefined, '100 hit/hari' bila angka. */
export function inquiryLimitText(p: InquiryPlan): string {
  if (p.inquiry_limit === null || p.inquiry_limit === undefined)
    return 'Tanpa batas';
  return `${p.inquiry_limit} hit/hari`;
}

/** Teks bullet lengkap: 'Inquiry Rekening: Aktif — 100 hit/hari' /
 * 'Inquiry Rekening: Aktif — Tanpa batas' / 'Inquiry Rekening: Nonaktif'. */
export function inquiryFeatureText(p: InquiryPlan): string {
  if (!p.inquiry_enabled) return 'Inquiry Rekening: Nonaktif';
  return `Inquiry Rekening: Aktif — ${inquiryLimitText(p)}`;
}

/** Ringkasan singkat untuk tabel admin: 'Aktif · 100 hit/hari' /
 * 'Aktif · Tanpa batas' / 'Nonaktif'. */
export function inquirySummaryText(p: InquiryPlan): string {
  if (!p.inquiry_enabled) return 'Nonaktif';
  return `Aktif · ${inquiryLimitText(p)}`;
}

export type PlanFeaturesInput = InquiryPlan & {
  max_accounts?: number | null;
  max_rekening?: number | null;
  duration_days?: number | null;
  notif_interval_minutes?: number | null;
  callback_enabled?: boolean | null;
  api_delay_minutes?: number | null;
};

/**
 * Bullet fitur paket — SATU-SATUNYA sumber untuk kartu harga landing dan
 * halaman langganan member. Diturunkan dari field plan API, bukan dari
 * array `features` kiriman backend (backend tidak pernah mengirim field
 * itu) dan bukan dari daftar statis: 'Cek mutasi tiap N menit' memakai
 * jeda sync paket (api_delay_minutes; 0 = ticker 1 menit) — v42a E3,
 * kata 'realtime' tidak lagi dipakai sebagai bullet karena sync adalah
 * polling per interval, bukan instan; 'Filter & Ekspor CSV' adalah janji
 * produk untuk semua paket aktif (tanpa embel-embel 'Uncapped' — ekspor
 * CSV dibatasi 5000 baris, lihat /docs); 'Notifikasi mutasi' hanya muncul
 * dengan interval dari notif_interval_minutes; 'Sinkronisasi tanpa delay'
 * hanya bila api_delay_minutes === 0; 'Prioritas dukungan' tidak ada
 * field-nya sehingga tidak pernah muncul.
 */
export function planFeatures(p: PlanFeaturesInput): string[] {
  const maxAcc = p.max_accounts ?? p.max_rekening ?? 0;
  const duration = p.duration_days ?? 30;
  // Bullet cek mutasi jujur per paket (v42a E3): delay > 0 -> tiap N
  // menit; delay 0 -> ticker 1 menit (bukan "hitungan detik").
  const syncBullet =
    typeof p.api_delay_minutes === 'number'
      ? p.api_delay_minutes > 0
        ? `Cek mutasi tiap ${p.api_delay_minutes} menit`
        : 'Cek mutasi tiap 1 menit'
      : 'Cek mutasi realtime';
  return [
    `${maxAcc || '-'} rekening`,
    `Masa aktif ${duration} hari`,
    syncBullet,
    'Filter & Ekspor CSV',
    ...(typeof p.notif_interval_minutes === 'number'
      ? [`Notifikasi mutasi tiap ${p.notif_interval_minutes} menit`]
      : []),
    ...(p.inquiry_enabled ? [inquiryFeatureText(p)] : []),
    ...(p.callback_enabled ? ['Instant Callback'] : []),
    ...(p.api_delay_minutes === 0 ? ['Sinkronisasi tanpa delay'] : []),
  ];
}

export type InquiryUsage = {
  limit_today?: number | null;
  used_today?: number | null;
  remaining_today?: number | null;
  resets_at?: string | null;
  inquiry_enabled?: boolean | null;
};

/** 'Sisa X dari Y hit hari ini · reset 00:00 WIB' / 'Tanpa batas'. */
export function inquiryUsageText(u: InquiryUsage): string {
  if (u.limit_today === null || u.limit_today === undefined)
    return 'Tanpa batas';
  const remaining =
    u.remaining_today ?? Math.max(0, u.limit_today - (u.used_today ?? 0));
  return `Sisa ${remaining} dari ${u.limit_today} hit hari ini · reset 00:00 WIB`;
}
