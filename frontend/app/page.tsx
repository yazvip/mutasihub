'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet } from '../lib/api';
import { formatAmount, formatRupiah, planFeatures, planPriceRupiah } from '../lib/format';
import { useSettings } from '../lib/settings';

// Landing v23 — port file referensi mutasihub_redesign_premium_0_gg6m.html
// ke Next.js + Tailwind (preflight MATI, lihat tailwind.config.js).
// Dinamis: h1 dari settings.tagline, nama situs dari settings.site_name,
// kartu harga dari GET /api/v1/plans (fallback statis bila API gagal).

// Kontrak backend (domain.Plan): harga dikirim sebagai price_cents;
// tampil = price_cents/100. Fallback statis memakai price (rupiah).
type Plan = {
  id?: string | number;
  slug?: string;
  name: string;
  price?: number;
  price_cents?: number;
  duration_days?: number;
  max_accounts?: number;
  max_rekening?: number;
  max_devices?: number;
  api_delay_minutes?: number;
  notif_interval_minutes?: number;
  callback_enabled?: boolean;
  inquiry_enabled?: boolean;
  inquiry_limit?: number | null;
  is_active?: boolean;
  highlight?: boolean;
};

// Fallback statis bila GET /api/v1/plans gagal — isinya disamakan dengan
// seed backend (domain.go): Trial inquiry mati, Starter/Pro/Enterprise
// inquiry aktif; delay/notif per paket. Bullet fitur TIDAK ditulis statis
// di sini — diturunkan planFeatures() dari field di bawah, agar tidak ada
// klaim inventarisasi ('Prioritas dukungan', 'REST API', 'Semua fitur Pro').
const FALLBACK_PLANS: Plan[] = [
  {
    slug: 'trial',
    name: 'Trial',
    price: 0,
    duration_days: 1,
    max_accounts: 2,
    api_delay_minutes: 10,
    notif_interval_minutes: 5,
    callback_enabled: false,
    inquiry_enabled: false,
  },
  {
    slug: 'starter',
    name: 'Starter',
    price: 350000,
    duration_days: 30,
    max_accounts: 2,
    api_delay_minutes: 5,
    notif_interval_minutes: 3,
    callback_enabled: false,
    inquiry_enabled: true,
  },
  {
    slug: 'pro',
    name: 'Pro',
    price: 900000,
    duration_days: 30,
    max_accounts: 5,
    api_delay_minutes: 3,
    notif_interval_minutes: 2,
    callback_enabled: false,
    inquiry_enabled: true,
    highlight: true,
  },
  {
    slug: 'enterprise',
    name: 'Enterprise',
    price: 1800000,
    duration_days: 30,
    max_accounts: 5,
    api_delay_minutes: 0,
    notif_interval_minutes: 1,
    callback_enabled: true,
    inquiry_enabled: true,
  },
];

const PLAN_TAGLINES: Record<string, string> = {
  trial: 'Coba dulu seluruh fitur tanpa biaya',
  starter: 'Untuk toko online yang baru berkembang',
  pro: 'Pilihan pas untuk toko online & PPOB aktif',
  enterprise: 'Volume transaksi besar & webhook instan',
};

// Chip kecil di pojok kartu harga (label presentasi dari file referensi).
const PLAN_CHIPS: Record<string, string> = {
  trial: 'Uji Coba',
  starter: 'UMKM',
  pro: 'Bisnis Aktif',
  enterprise: 'Scale-Up',
};

const FAQ = [
  {
    q: 'Bagaimana cara kerja cek mutasi DANA?',
    a: 'Daftar akun di MutasiHub, lalu hubungkan nomor HP akun DANA milik Anda sendiri melalui otorisasi binding resmi. Setelah tersambung, setiap transaksi masuk akan terbaca secara realtime di dashboard dan dapat diteruskan ke sistem Anda melalui REST API/Webhook.',
  },
  {
    q: 'Apakah kredensial rekening saya aman dari pencurian dana?',
    a: 'Sangat aman. Kredensial rekening (User ID KlikBCA dan Nomor DANA) dienkripsi menggunakan algoritma AES-256 tingkat militer. Platform ini dirancang murni read-only (hanya melihat riwayat mutasi), tanpa token transaksi fisik (KeyBCA/OTP transaksi), sehingga sistem sama sekali tidak memiliki kapabilitas untuk memindahkan atau menarik uang.',
  },
  {
    q: 'Apakah saya bisa menggunakan API untuk website saya?',
    a: 'Tentu saja. Anda bisa membuat API Key di panel dashboard, menetapkan batasan IP whitelist demi keamanan, dan langsung mengintegrasikan endpoint JSON mutasi ke sistem kasir, bot Telegram, maupun platform otomatisasi deposit Anda.',
  },
  {
    q: 'Bagaimana metode pembayarannya?',
    a: 'Setelah masa trial 1 hari habis, Anda dapat melakukan pembayaran paket secara instan via QRIS Gopay/Gobiz yang mendukung semua bank & e-wallet (BCA, Mandiri, BRI, BNI, Dana, OVO, ShopeePay). Akun akan langsung aktif otomatis detik itu juga.',
  },
  {
    q: 'Bank & dompet digital apa saja yang didukung?',
    a: 'Saat ini sistem mendukung penuh DANA dan BCA. Integrasi untuk bank dan e-wallet lain seperti Mandiri Livin, BRImo, dan OVO sedang dalam tahap pengujian berkala dan akan dirilis dalam waktu dekat.',
  },
];

// ---- Simulasi dashboard hero ----
type MockRow = {
  id: number;
  name: string;
  channel: string;
  dot: string;
  amount: number;
  time: string;
};

const INITIAL_ROWS: MockRow[] = [
  { id: 1, name: 'Budi Santoso', channel: 'DANA · Top-up Saldo #4429', dot: 'bg-sky-500', amount: 150000, time: '23:46:18 WIB' },
  { id: 2, name: 'PT Maju Bersama', channel: 'BCA · Pembayaran INV-1042', dot: 'bg-blue-600', amount: 2500000, time: '23:04:12 WIB' },
  { id: 3, name: 'Siti Rahma', channel: 'DANA · Deposit Member', dot: 'bg-sky-500', amount: 75000, time: '22:10:45 WIB' },
  { id: 4, name: 'CV Digital Nusantara', channel: 'BCA · Paket Tahunan Pro', dot: 'bg-blue-600', amount: 480000, time: '20:46:02 WIB' },
];

const SAMPLE_NAMES = ['Rizky Pratama', 'Indah Permata', 'PT Sinar Abadi', 'Ahmad Fauzi', 'Toko Berkah Jaya'];
const SAMPLE_CHANNELS = [
  { name: 'DANA · Top-up Saldo', dot: 'bg-sky-500' },
  { name: 'BCA · Pembayaran QRIS', dot: 'bg-blue-600' },
  { name: 'BCA · Transfer Antar Bank', dot: 'bg-blue-600' },
  { name: 'DANA · Direct Payment', dot: 'bg-sky-500' },
];

const FEATURES = [
  { icon: '⚡', iconBg: 'bg-brand-50 text-brand-700', title: 'Sinkronisasi Realtime', desc: 'Mutasi DANA & BCA tercatat dalam hitungan detik setelah transfer sukses tanpa perlu manual request download mutasi.' },
  { icon: '🗂️', iconBg: 'bg-indigo-50 text-indigo-700', title: 'Manajemen Multi-Rekening', desc: 'Hubungkan beberapa rekening bank BCA dan akun DANA sekaligus dalam satu dashboard manajemen terpusat.' },
  { icon: '🔌', iconBg: 'bg-purple-50 text-purple-700', title: 'REST API & Webhook', desc: 'Dilengkapi API Key, IP Whitelist, dan Webhook callback instan untuk integrasi bot Telegram, kasir POS, atau sistem deposit.' },
  { icon: '🔍', iconBg: 'bg-amber-50 text-amber-700', title: 'Smart Filter & Ekspor CSV', desc: 'Pencarian kilat berdasarkan nominal, nama pengirim, atau tanggal. Ekspor ke format CSV / Excel sekali klik untuk rekonsiliasi akuntansi.' },
  { icon: '🔔', iconBg: 'bg-emerald-50 text-emerald-700', title: 'Notifikasi Fleksibel', desc: 'Pengaturan frekuensi cek mutasi dan notifikasi instan sesuai kebutuhan paket usaha Anda tanpa batasan jam sibuk.' },
  { icon: '🛡️', iconBg: 'bg-rose-50 text-rose-700', title: 'Enkripsi Hardware AES-256', desc: 'Kredensial Anda dienkripsi berlapis. Sistem bersifat 100% read-only tanpa wewenang pemindahan saldo sama sekali.' },
];

const NAV_LINKS = [
  { href: '#produk', label: 'Produk' },
  { href: '#fitur', label: 'Fitur Bisnis' },
  { href: '#cara-kerja', label: 'Cara Kerja' },
  { href: '#keamanan', label: 'Keamanan' },
  { href: '#harga', label: 'Paket & Harga' },
  { href: '#kalkulator', label: 'Kalkulator' },
  { href: '#faq', label: 'FAQ' },
];

function maxAccountsOf(p: Plan): number {
  return p.max_accounts ?? p.max_rekening ?? 0;
}

/** H1 dinamis: frasa "Bisnis Modern" di tagline diberi gradasi (seperti referensi). */
function HeroHeading({ tagline }: { tagline: string }) {
  const marker = 'Bisnis Modern';
  const idx = tagline.indexOf(marker);
  if (idx === -1) return <>{tagline}</>;
  return (
    <>
      {tagline.slice(0, idx)}
      <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-700 via-brand-600 to-emerald-500">
        {marker}
      </span>
    </>
  );
}

/** Nama situs: "MutasiHub" ditampilkan sebagai Mutasi + Hub (Hub berwarna). */
function BrandName({ siteName }: { siteName: string }) {
  if (siteName === 'MutasiHub') {
    return (
      <span className="text-xl font-extrabold tracking-tight text-slate-900">
        Mutasi<span className="text-brand-600">Hub</span>
      </span>
    );
  }
  return <span className="text-xl font-extrabold tracking-tight text-slate-900">{siteName}</span>;
}

/** Bullet fitur paket — lihat planFeatures() di lib/format.ts (satu-satunya
 * sumber; dipakai landing + halaman langganan member). */

/** Kalkulator simulasi harga — rekomendasi dari data paket live. */
function PriceCalculator({ plans }: { plans: Plan[] }) {
  const [accounts, setAccounts] = useState(2);
  const [txPerMonth, setTxPerMonth] = useState(500);

  const paid = plans
    .filter((p) => planPriceRupiah(p) > 0)
    .slice()
    .sort((a, b) => planPriceRupiah(a) - planPriceRupiah(b));
  const recommended =
    paid.find((p) => maxAccountsOf(p) >= accounts) ?? paid[paid.length - 1];
  const exceedsAll =
    paid.length > 0 && !paid.some((p) => maxAccountsOf(p) >= accounts);

  const price = recommended ? planPriceRupiah(recommended) : 0;
  const duration = recommended?.duration_days ?? 30;
  const perDay = price > 0 && duration > 0 ? Math.round(price / duration) : 0;
  const perTx = price > 0 && txPerMonth > 0 ? Math.round(price / txPerMonth) : 0;

  return (
    <section id="kalkulator" className="py-20 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-12">
          <span className="text-xs font-bold uppercase tracking-wider text-brand-600 font-mono">06 // KALKULATOR HARGA</span>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight mt-1">Hitung paket yang paling pas</h2>
          <p className="text-slate-600 mt-3 text-base">Geser slider di bawah — rekomendasi dan biaya dihitung langsung dari data paket yang sedang aktif.</p>
        </div>

        <div className="max-w-5xl mx-auto rounded-3xl border border-slate-200 shadow-premium overflow-hidden grid grid-cols-1 lg:grid-cols-5">
          <div className="lg:col-span-3 p-6 sm:p-8 space-y-8 bg-white">
            <div>
              <div className="flex items-center justify-between mb-3">
                <label htmlFor="calc-accounts" className="text-sm font-bold text-slate-900">Jumlah rekening</label>
                <span className="text-sm font-mono font-bold text-brand-700 bg-brand-50 border border-brand-100 px-2.5 py-1 rounded-lg">
                  {accounts} rekening
                </span>
              </div>
              <input
                id="calc-accounts"
                type="range"
                min={1}
                max={10}
                step={1}
                value={accounts}
                onChange={(e) => setAccounts(Number(e.target.value))}
                className="w-full accent-emerald-600 cursor-pointer"
                aria-label="Jumlah rekening"
              />
              <div className="flex justify-between text-[11px] text-slate-400 font-mono mt-1">
                <span>1</span><span>10</span>
              </div>
              <p className="text-xs text-slate-500 mt-2">Total rekening DANA + BCA yang akan dihubungkan.</p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <label htmlFor="calc-tx" className="text-sm font-bold text-slate-900">Estimasi transaksi / bulan</label>
                <span className="text-sm font-mono font-bold text-brand-700 bg-brand-50 border border-brand-100 px-2.5 py-1 rounded-lg">
                  {txPerMonth.toLocaleString('id-ID')} /bulan
                </span>
              </div>
              <input
                id="calc-tx"
                type="range"
                min={0}
                max={10000}
                step={100}
                value={txPerMonth}
                onChange={(e) => setTxPerMonth(Number(e.target.value))}
                className="w-full accent-emerald-600 cursor-pointer"
                aria-label="Estimasi transaksi per bulan"
              />
              <div className="flex justify-between text-[11px] text-slate-400 font-mono mt-1">
                <span>0</span><span>10.000</span>
              </div>
              <p className="text-xs text-slate-500 mt-2">Perkiraan jumlah mutasi masuk per bulan — dipakai untuk menghitung biaya per transaksi.</p>
            </div>

            <div className="bg-brand-50 border border-brand-100 rounded-xl p-4 text-xs text-slate-600 leading-relaxed">
              <strong className="text-slate-900">Trial gratis 1 hari bukan paket bulanan.</strong>{' '}
              Trial hanya untuk mencoba dulu — setelah 1 hari, pilih salah satu paket berbayar di atas
              untuk pemakaian rutin.{' '}
              <a href="/register" className="font-bold text-brand-700 hover:text-brand-600">Coba Trial Gratis →</a>
            </div>
          </div>

          <div className="lg:col-span-2 bg-slate-900 text-white p-6 sm:p-8 flex flex-col justify-between">
            {recommended ? (
              <>
                <div>
                  <span className="text-xs font-mono font-bold tracking-wider text-emerald-400 uppercase">Rekomendasi untukmu</span>
                  <div className="flex items-center justify-between mt-3 mb-1">
                    <h3 className="text-2xl font-extrabold text-white">{recommended.name}</h3>
                    {PLAN_CHIPS[recommended.slug ?? ''] && (
                      <span className="text-[11px] font-mono font-bold px-2 py-0.5 bg-brand-500/20 text-emerald-300 rounded border border-brand-500/30">
                        {PLAN_CHIPS[recommended.slug ?? '']}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-300 mb-6">
                    Mencakup {maxAccountsOf(recommended)} rekening · Masa aktif {recommended.duration_days ?? 30} hari
                  </p>
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-extrabold text-white tracking-tight tabular-nums">{formatRupiah(price)}</span>
                    <span className="text-xs text-slate-300">/bulan</span>
                  </div>
                  {perDay > 0 && (
                    <p className="text-xs text-emerald-400 font-medium mt-1">≈ {formatRupiah(perDay)} / hari</p>
                  )}
                  {perTx > 0 && (
                    <p className="text-xs text-slate-300 mt-1">
                      ≈ {formatRupiah(perTx)} / transaksi <span className="text-slate-500">(dari {txPerMonth.toLocaleString('id-ID')} transaksi/bulan)</span>
                    </p>
                  )}
                  {exceedsAll && (
                    <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 mt-4 leading-relaxed">
                      Kebutuhanmu melebihi batas semua paket standar — Enterprise adalah paket terbesar yang tersedia.
                    </p>
                  )}
                </div>
                <a href="/register" className="mt-8 block w-full py-3 px-4 text-center rounded-xl bg-brand-500 hover:bg-brand-600 text-slate-950 font-extrabold text-sm transition shadow-lg shadow-brand-500/30">
                  Pilih {recommended.name}
                </a>
              </>
            ) : (
              <p className="text-sm text-slate-300">Paket belum tersedia — coba lagi nanti.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function LandingPage() {
  const { site_name, tagline } = useSettings();
  const [plans, setPlans] = useState<Plan[]>(FALLBACK_PLANS);
  const [plansLoading, setPlansLoading] = useState(true);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const [rows, setRows] = useState<MockRow[]>(INITIAL_ROWS);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const idRef = useRef(5);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addRow = useCallback(() => {
    const name = SAMPLE_NAMES[Math.floor(Math.random() * SAMPLE_NAMES.length)];
    const ch = SAMPLE_CHANNELS[Math.floor(Math.random() * SAMPLE_CHANNELS.length)];
    const amount = (Math.floor(Math.random() * 20) + 1) * 50000;
    const timeStr =
      new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour12: false }) + ' WIB';
    const id = idRef.current++;
    setRows((prev) => [{ id, name, channel: ch.name, dot: ch.dot, amount, time: timeStr }, ...prev].slice(0, 5));
    setHighlightId(id);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightId(null), 1000);
  }, []);

  // Simulasi "hidup": baris baru otomatis tiap ~6 detik.
  useEffect(() => {
    const t = setInterval(addRow, 6000);
    return () => clearInterval(t);
  }, [addRow]);

  useEffect(() => () => {
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
  }, []);

  // ESC menutup drawer mobile.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  useEffect(() => {
    apiGet<any>('/api/v1/plans')
      .then((d) => {
        const list = Array.isArray(d) ? d : d?.plans ?? d?.data;
        if (Array.isArray(list) && list.length > 0) setPlans(list);
      })
      .catch(() => {
        // fallback statis tetap dipakai
      })
      .finally(() => setPlansLoading(false));
  }, []);

  return (
    <div className="landing-tw bg-[#fafbfc] text-slate-800 font-sans antialiased selection:bg-brand-500 selection:text-white min-h-screen flex flex-col">
      {/* TOP ANNOUNCEMENT BANNER */}
      <aside className="bg-slate-900 text-slate-200 text-xs py-2 px-4 text-center font-medium border-b border-slate-800 flex flex-wrap items-center justify-center gap-2">
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-brand-500/20 text-brand-300 border border-brand-500/30 shrink-0 whitespace-nowrap">UPDATE 2026</span>
        <span className="hidden sm:inline">Dukungan penuh API Webhook &amp; Notifikasi Instan untuk transaksi DANA &amp; BCA KlikBCA.</span>
        <span className="sm:hidden">API Webhook &amp; Notifikasi Instan DANA &amp; BCA.</span>
        <a href="#harga" className="underline text-brand-400 hover:text-brand-300 font-semibold ml-1 whitespace-nowrap">Coba Trial Gratis →</a>
      </aside>

      {/* NAVIGATION HEADER */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200/80 transition-all">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-18 py-3.5 flex items-center justify-between">
          <a href="#" className="flex items-center gap-2.5 group">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-brand-700 via-brand-600 to-emerald-400 flex items-center justify-center text-white font-extrabold text-xl shadow-md shadow-brand-700/20 group-hover:scale-105 transition-transform">
              M
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <BrandName siteName={site_name} />
                <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200">PRO</span>
              </div>
              <span className="text-[10px] text-slate-400 font-medium tracking-tight -mt-0.5">Automated Financial Sync</span>
            </div>
          </a>

          <nav className="hidden lg:flex items-center gap-8 text-sm font-semibold text-slate-600">
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href} className="hover:text-brand-600 transition-colors">{l.label}</a>
            ))}
          </nav>

          <div className="hidden lg:flex items-center gap-3">
            <a href="/login" className="px-4 py-2 text-sm font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-all">
              Masuk
            </a>
            <a href="/register" className="inline-flex items-center justify-center px-4 py-2 text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-xl shadow-sm hover:shadow-glow transition-all active:scale-[0.98]">
              Daftar Gratis 1 Hari
            </a>
          </div>

          <button
            type="button"
            aria-label="Toggle Menu"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((v) => !v)}
            className="lg:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100 focus:outline-none"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16m-7 6h7"></path>
            </svg>
          </button>
        </div>

        {drawerOpen && (
          <div className="lg:hidden border-b border-slate-200 bg-white px-4 pt-3 pb-6 space-y-3">
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setDrawerOpen(false)} className="block py-2 text-sm font-medium text-slate-700 hover:text-brand-600">
                {l.label}
              </a>
            ))}
            <div className="pt-4 border-t border-slate-100 flex flex-col gap-2">
              <a href="/login" onClick={() => setDrawerOpen(false)} className="w-full text-center py-2.5 text-sm font-semibold text-slate-700 bg-slate-50 rounded-xl">Masuk</a>
              <a href="/register" onClick={() => setDrawerOpen(false)} className="w-full text-center py-2.5 text-sm font-semibold text-white bg-brand-600 rounded-xl shadow">Daftar Gratis 1 Hari</a>
            </div>
          </div>
        )}
      </header>

      {/* HERO SECTION */}
      <section className="relative pt-12 pb-20 lg:pt-20 lg:pb-32 bg-grid-pattern overflow-hidden">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-gradient-to-tr from-brand-200/40 to-emerald-200/30 blur-3xl pointer-events-none -z-10 rounded-full"></div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
            <div className="lg:col-span-6 xl:col-span-7 space-y-6">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-50 border border-brand-200 text-brand-800 text-xs font-semibold">
                <span className="flex h-2 w-2 rounded-full bg-brand-500 animate-pulse"></span>
                <span>Realtime Mutasi Gateway DANA &amp; BCA</span>
              </div>

              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-900 leading-[1.12]">
                <HeroHeading tagline={tagline} />
              </h1>

              <p className="text-base sm:text-lg text-slate-600 leading-relaxed max-w-xl font-normal">
                Tinggalkan repotnya cek m-Banking berkali-kali. Setiap transaksi masuk DANA dan BCA tercatat otomatis ke dashboard &amp; webhook API Anda secara instan.
              </p>

              <div className="flex flex-wrap items-center gap-4 pt-2">
                <a href="/register" className="inline-flex items-center gap-2 px-6 py-3.5 bg-brand-600 hover:bg-brand-700 active:scale-95 text-white font-bold rounded-xl shadow-lg shadow-brand-600/25 transition-all text-sm sm:text-base">
                  <span>Mulai Trial 1 Hari Gratis</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
                </a>
                <a href="#harga" className="inline-flex items-center gap-2 px-6 py-3.5 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 font-semibold rounded-xl transition-all text-sm sm:text-base hover:border-slate-400">
                  Lihat Pilihan Paket
                </a>
              </div>

              <div className="pt-6 border-t border-slate-200/80 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
                <div className="flex flex-col">
                  <span className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                    <svg className="w-4 h-4 text-brand-600" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
                    Read-Only
                  </span>
                  <span className="text-xs text-slate-500">Aman, tanpa akses transfer</span>
                </div>
                <div className="flex flex-col">
                  <span className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                    <svg className="w-4 h-4 text-brand-600" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
                    AES-256
                  </span>
                  <span className="text-xs text-slate-500">Enkripsi militer tinggi</span>
                </div>
                <div className="flex flex-col">
                  <span className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                    <svg className="w-4 h-4 text-brand-600" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
                    No Credit Card
                  </span>
                  <span className="text-xs text-slate-500">Langsung aktivasi</span>
                </div>
              </div>
            </div>

            <div className="lg:col-span-6 xl:col-span-5">
              <div className="relative">
                <div className="mb-3 inline-flex items-center gap-3 p-2.5 pr-4 rounded-xl bg-white border border-slate-200/90 shadow-sm w-full">
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-sm shrink-0">
                    ✓
                  </div>
                  <div className="text-xs truncate">
                    <p className="text-slate-400 font-medium">Inquiry Rekening · BCA (014)</p>
                    <p className="text-slate-800 font-bold truncate text-base">Budi Santoso · 1234567890</p>
                  </div>
                  <span className="ml-auto text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100 shrink-0">Valid</span>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xl shadow-slate-900/10 overflow-hidden">
                  <div className="bg-slate-900 px-4 py-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-3 h-3 rounded-full bg-rose-500/80 shrink-0"></div>
                      <div className="w-3 h-3 rounded-full bg-amber-500/80 shrink-0"></div>
                      <div className="w-3 h-3 rounded-full bg-emerald-500/80 shrink-0"></div>
                      <span className="ml-2 text-xs font-mono text-slate-400 truncate min-w-0 max-[560px]:hidden">dashboard.mutasihub.com</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="relative flex h-2 w-2 shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                      </span>
                      <span className="text-[11px] font-mono uppercase tracking-wider text-emerald-400 font-bold whitespace-nowrap">Sync Realtime</span>
                    </div>
                  </div>

                  <div className="p-4 bg-slate-50/70 border-b border-slate-200 flex justify-between items-center">
                    <div>
                      <h2 className="text-sm font-bold text-slate-800">Mutasi Masuk Terbaru</h2>
                      <p className="text-xs text-slate-500">Auto-update setiap ada transaksi masuk</p>
                    </div>
                    <button
                      type="button"
                      onClick={addRow}
                      className="text-xs bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 px-2.5 py-1 rounded-md font-medium transition shadow-xs whitespace-nowrap"
                    >
                      + Simulasi Transaksi
                    </button>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full min-w-0 text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-100/70 text-slate-500 uppercase font-mono text-[10px] tracking-wider border-b border-slate-200">
                          <th className="py-2.5 px-4">Channel &amp; Pengirim</th>
                          <th className="py-2.5 px-4">Waktu</th>
                          <th className="py-2.5 px-4 text-right">Nominal</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-sans">
                        {rows.map((r) => (
                          <tr
                            key={r.id}
                            className={`hover:bg-slate-50/80 transition-colors ${highlightId === r.id ? 'bg-emerald-50/50' : ''}`}
                          >
                            <td className="py-3 px-4">
                              <div className="font-bold text-slate-900">{r.name}</div>
                              <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                                <span className={`w-1.5 h-1.5 rounded-full ${r.dot}`}></span>
                                <span>{r.channel}</span>
                              </div>
                            </td>
                            <td className="py-3 px-4 text-slate-500 font-mono text-[11px]">{r.time}</td>
                            <td className="py-3 px-4 text-right">
                              <span className="font-mono font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">{formatAmount(r.amount)}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="px-4 py-2.5 bg-slate-50/80 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500">
                    <span>⚡ Integrasi Webhook Aktif (HTTP 200 OK)</span>
                    <span className="font-mono text-slate-400">AES-256 GCM</span>
                  </div>
                </div>

                <p className="text-center text-xs text-slate-500 mt-3 font-normal">
                  💡 Simulasi tampilan live dashboard. Data asli mengalir langsung saat akun dihubungkan.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PRODUK KAMI SECTION */}
      <section id="produk" className="py-20 bg-white border-y border-slate-200/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mb-14">
            <span className="text-xs font-bold uppercase tracking-wider text-brand-600 font-mono">01 // PRODUK UTAMA</span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight mt-1">Satu platform, tiga solusi cek uang masuk</h2>
            <p className="text-slate-600 mt-3 text-base">Pantau riwayat mutasi, pergerakan saldo, dan keabsahan nama pemilik rekening dari satu dashboard terpadu.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="relative bg-gradient-to-b from-sky-50/40 to-white p-7 rounded-2xl border border-sky-100 hover:border-sky-300 transition-all hover:shadow-xl group">
              <div className="w-12 h-12 rounded-xl bg-sky-500/10 text-sky-600 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"/>
                </svg>
              </div>
              <div className="inline-block px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-sky-100 text-sky-800 uppercase font-mono mb-2">E-Wallet</div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">Mutasi DANA Realtime</h3>
              <p className="text-slate-600 text-sm leading-relaxed mb-4">
                Hubungkan nomor HP akun DANA bisnis Anda lewat mekanisme otorisasi aman. Seluruh transaksi uang masuk terdata tanpa delay.
              </p>
              <ul className="text-xs text-slate-500 space-y-2 pt-2 border-t border-sky-100 font-medium">
                <li className="flex items-center gap-2">✓ Support akun Personal &amp; Bisnis</li>
                <li className="flex items-center gap-2">✓ Push Notifikasi via Webhook</li>
              </ul>
            </div>

            <div className="relative bg-gradient-to-b from-blue-50/40 to-white p-7 rounded-2xl border border-blue-100 hover:border-blue-300 transition-all hover:shadow-xl group">
              <div className="w-12 h-12 rounded-xl bg-blue-600/10 text-blue-600 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8">
                  <rect x="2" y="5" width="20" height="14" rx="2"></rect>
                  <line x1="2" y1="10" x2="22" y2="10"></line>
                </svg>
              </div>
              <div className="inline-block px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-blue-100 text-blue-800 uppercase font-mono mb-2">Perbankan</div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">Mutasi KlikBCA</h3>
              <p className="text-slate-600 text-sm leading-relaxed mb-4">
                Tautkan akun BCA menggunakan User ID &amp; PIN Internet Banking KlikBCA milik Anda. Sangat ideal untuk rekonsiliasi invoice otomatis.
              </p>
              <ul className="text-xs text-slate-500 space-y-2 pt-2 border-t border-blue-100 font-medium">
                <li className="flex items-center gap-2">✓ Read-only (Tidak ada akses transfer)</li>
                <li className="flex items-center gap-2">✓ Deteksi otomatis berita transfer / invoice</li>
              </ul>
            </div>

            <div className="relative bg-gradient-to-b from-amber-50/40 to-white p-7 rounded-2xl border border-amber-100 hover:border-amber-300 transition-all hover:shadow-xl group">
              <div className="w-12 h-12 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8">
                  <circle cx="11" cy="11" r="7"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
              </div>
              <div className="inline-block px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-amber-100 text-amber-800 uppercase font-mono mb-2">Verifikasi</div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">Inquiry Rekening Bank</h3>
              <p className="text-slate-600 text-sm leading-relaxed mb-4">
                Cek kevalidan nama pemilik nomor rekening secara instan sebelum melakukan proses transfer atau refund untuk mencegah salah sasaran.
              </p>
              <ul className="text-xs text-slate-500 space-y-2 pt-2 border-t border-amber-100 font-medium">
                <li className="flex items-center gap-2">✓ Ketersediaan &amp; batas harian mengikuti paket Anda</li>
                <li className="flex items-center gap-2">✓ Nama pemilik langsung dari bank penerbit</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* FITUR UNGGULAN SECTION */}
      <section id="fitur" className="py-20 bg-slate-50/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <span className="text-xs font-bold uppercase tracking-wider text-brand-600 font-mono">02 // ARSITEKTUR &amp; FITUR</span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight mt-1">Dibuat untuk skalabilitas developer &amp; bisnis</h2>
            <p className="text-slate-600 mt-3 text-base">Semua perangkat yang dibutuhkan untuk memantau ratusan pergerakan arus kas bisnis tanpa hambatan.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((f) => (
              <div key={f.title} className="bg-white p-6 rounded-2xl border border-slate-200/90 hover:shadow-md transition">
                <div className={`w-10 h-10 rounded-xl ${f.iconBg} flex items-center justify-center font-bold mb-4`}>{f.icon}</div>
                <h3 className="text-base font-bold text-slate-900 mb-2">{f.title}</h3>
                <p className="text-slate-600 text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CARA KERJA SECTION */}
      <section id="cara-kerja" className="py-20 bg-white border-t border-slate-200/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <span className="text-xs font-bold uppercase tracking-wider text-brand-600 font-mono">03 // PROSES MUDAH</span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight mt-1">Siap pakai dalam 3 menit</h2>
            <p className="text-slate-600 mt-2 text-base">Tanpa setup server rumit atau verifikasi dokumen yang memakan waktu berhari-hari.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
            <div className="hidden md:block absolute top-10 left-[18%] right-[18%] h-0.5 bg-slate-200 z-0"></div>

            <div className="relative bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs z-10 flex flex-col items-center text-center">
              <div className="w-14 h-14 rounded-2xl bg-brand-600 text-white font-mono font-extrabold text-xl flex items-center justify-center shadow-lg shadow-brand-600/30 mb-5">
                01
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">Buat Akun Bisnis</h3>
              <p className="text-slate-600 text-sm leading-relaxed">Daftar secara gratis dalam 30 detik menggunakan email atau akun Google tanpa perlu kartu kredit.</p>
            </div>

            <div className="relative bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs z-10 flex flex-col items-center text-center">
              <div className="w-14 h-14 rounded-2xl bg-slate-900 text-white font-mono font-extrabold text-xl flex items-center justify-center shadow-lg shadow-slate-900/30 mb-5">
                02
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">Hubungkan Rekening</h3>
              <p className="text-slate-600 text-sm leading-relaxed">Masukkan nomor akun DANA atau User ID KlikBCA milik Anda. Status binding akan terverifikasi otomatis.</p>
            </div>

            <div className="relative bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs z-10 flex flex-col items-center text-center">
              <div className="w-14 h-14 rounded-2xl bg-emerald-600 text-white font-mono font-extrabold text-xl flex items-center justify-center shadow-lg shadow-emerald-600/30 mb-5">
                03
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">Terima Mutasi Realtime</h3>
              <p className="text-slate-600 text-sm leading-relaxed">Mutasi langsung terpantau di web dashboard atau diteruskan secara instan ke webhook endpoint aplikasi Anda.</p>
            </div>
          </div>
        </div>
      </section>

      {/* KEAMANAN SECTION */}
      <section id="keamanan" className="py-16 bg-slate-900 text-white relative overflow-hidden">
        <div className="absolute -right-24 -bottom-24 w-96 h-96 bg-brand-500/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border border-slate-800 rounded-3xl p-8 sm:p-12 lg:p-16 shadow-2xl">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
              <div className="lg:col-span-7 space-y-4">
                <span className="text-xs font-mono font-bold tracking-wider text-emerald-400 uppercase bg-emerald-950/60 border border-emerald-800/80 px-3 py-1 rounded-full">
                  Keamanan Terverifikasi
                </span>
                <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
                  Uang Anda tetap aman 100% di tangan Anda.
                </h2>
                <p className="text-slate-300 text-base leading-relaxed">
                  {site_name} didesain dengan konsep fundamental <span className="text-white font-semibold underline decoration-emerald-500">Read-Only Architecture</span>. Tidak terdapat logika pemindahan dana, autorisasi transfer, maupun akses penarikan saldo.
                </p>
              </div>

              <div className="lg:col-span-5 bg-slate-800/60 p-6 rounded-2xl border border-slate-700/60 space-y-4">
                {[
                  { t: 'Enkripsi Kredensial AES-256 GCM', d: 'Data kredensial tersimpan dalam modul enkripsi setara standar perbankan.' },
                  { t: 'Zero Fund Access (Read-Only)', d: 'Hanya membaca log mutasi transaksi masuk tanpa hak manipulasi rekening.' },
                  { t: 'API Key & IP Whitelist Lock', d: 'Hanya IP server Anda yang diizinkan memanggil endpoint API mutasi.' },
                  { t: 'Rekening 100% Milik Anda', d: 'Tidak ada penampungan dana perantara, uang masuk langsung ke rekening Anda.' },
                ].map((item) => (
                  <div key={item.t} className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">✓</div>
                    <div>
                      <p className="text-sm font-bold text-slate-100">{item.t}</p>
                      <p className="text-xs text-slate-400">{item.d}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PRICING TABLE SECTION */}
      <section id="harga" className="py-24 bg-slate-50/70 border-b border-slate-200/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <span className="text-xs font-bold uppercase tracking-wider text-brand-600 font-mono">04 // TRANSPARAN &amp; FLEKSIBEL</span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight mt-1">Pilihan Paket Sesuai Skala Usaha</h2>
            <p className="text-slate-600 mt-2 text-base">Mulai dengan trial gratis 1 hari tanpa komitmen. Pembayaran resmi otomatis via QRIS Gobiz.</p>
          </div>

          {plansLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-stretch" aria-label="Memuat paket">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="bg-white rounded-2xl p-6 border border-slate-200/90 shadow-sm animate-pulse">
                  <div className="h-5 w-24 bg-slate-200 rounded mb-6"></div>
                  <div className="h-8 w-32 bg-slate-200 rounded mb-6"></div>
                  <div className="space-y-3">
                    <div className="h-3 w-full bg-slate-100 rounded"></div>
                    <div className="h-3 w-5/6 bg-slate-100 rounded"></div>
                    <div className="h-3 w-4/6 bg-slate-100 rounded"></div>
                  </div>
                  <div className="h-10 w-full bg-slate-100 rounded-xl mt-8"></div>
                </div>
              ))}
            </div>
          ) : plans.length === 0 ? (
            <p className="text-center text-slate-500 text-sm">Paket belum tersedia — coba lagi nanti.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-stretch">
              {plans.map((p) => {
                const priceRp = planPriceRupiah(p);
                const duration = p.duration_days ?? 30;
                const feats = planFeatures(p);
                const tagline = PLAN_TAGLINES[p.slug ?? ''] ?? '';
                const chip = PLAN_CHIPS[p.slug ?? ''] ?? '';
                const isPopular = p.highlight || p.slug === 'pro';
                const perDay = priceRp > 0 && duration > 0 ? Math.round(priceRp / duration) : 0;
                const isTrial = priceRp === 0;
                const cta = isTrial ? 'Coba Gratis 1 Hari' : p.slug === 'pro' ? 'Daftar Paket Pro' : `Pilih ${p.name}`;

                const cardClass = isPopular
                  ? 'bg-gradient-to-b from-brand-900 via-slate-900 to-slate-900 rounded-2xl p-6 border-2 border-brand-500 shadow-xl shadow-brand-900/20 text-white flex flex-col justify-between relative transform lg:-translate-y-2'
                  : 'bg-white rounded-2xl p-6 border border-slate-200/90 shadow-sm flex flex-col justify-between hover:border-slate-300 transition';

                return (
                  <div key={p.slug ?? p.id ?? p.name} className={cardClass}>
                    {isPopular && (
                      <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-gradient-to-r from-brand-500 to-emerald-400 text-slate-950 font-extrabold text-[10px] tracking-wider uppercase px-3 py-1 rounded-full shadow-md whitespace-nowrap">
                        Paling Populer
                      </div>
                    )}

                    <div>
                      <div className="flex items-center justify-between mb-2 mt-1">
                        <h3 className={`font-extrabold text-lg ${isPopular ? 'text-white' : 'text-slate-900'}`}>{p.name}</h3>
                        {chip && (
                          <span className={`text-[11px] font-mono font-semibold px-2 py-0.5 rounded ${isPopular ? 'bg-brand-500/20 text-emerald-300 border border-brand-500/30' : 'bg-slate-100 text-slate-600'}`}>
                            {chip}
                          </span>
                        )}
                      </div>
                      {tagline && <p className={`text-xs mb-6 ${isPopular ? 'text-slate-300' : 'text-slate-500'}`}>{tagline}</p>}

                      <div className="mb-6">
                        <div className="flex items-baseline gap-1">
                          {isTrial ? (
                            <span className="text-3xl font-extrabold text-slate-900 tracking-tight">Gratis</span>
                          ) : (
                            <>
                              <span className={`text-3xl font-extrabold tracking-tight tabular-nums ${isPopular ? 'text-white' : 'text-slate-900'}`}>{formatRupiah(priceRp)}</span>
                              <span className={`text-xs ${isPopular ? 'text-slate-300' : 'text-slate-500'}`}>/bulan</span>
                            </>
                          )}
                        </div>
                        {isTrial ? (
                          <p className="text-xs text-slate-400 mt-1">Masa aktif 1 hari</p>
                        ) : (
                          perDay > 0 && (
                            <p className={`text-xs font-medium mt-1 ${isPopular ? 'text-emerald-400' : 'text-emerald-600'}`}>≈ {formatRupiah(perDay)} / hari</p>
                          )
                        )}
                      </div>

                      <ul className={`text-xs space-y-3 pb-6 border-b ${isPopular ? 'text-slate-200 border-slate-800' : 'text-slate-600 border-slate-100'}`}>
                        {feats.map((f) => (
                          <li key={f} className="flex items-center gap-2.5">
                            <span className={`font-bold ${isPopular ? 'text-emerald-400' : 'text-emerald-600'}`}>✓</span>
                            <span>{f}</span>
                          </li>
                        ))}
                        {!p.inquiry_enabled && (
                          <li className="flex items-center gap-2.5 text-slate-400 line-through">
                            <span>✕</span> Akses Inquiry Rekening
                          </li>
                        )}
                      </ul>
                    </div>

                    <a
                      href="/register"
                      className={
                        isPopular
                          ? 'mt-8 block w-full py-3 px-4 text-center rounded-xl bg-brand-500 hover:bg-brand-600 text-slate-950 font-extrabold text-xs transition shadow-lg shadow-brand-500/30'
                          : 'mt-8 block w-full py-2.5 px-4 text-center rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold transition'
                      }
                    >
                      {cta}
                    </a>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* KALKULATOR SIMULASI HARGA */}
      <PriceCalculator plans={plans} />

      {/* FAQ SECTION ACCORDION */}
      <section id="faq" className="py-20 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <span className="text-xs font-bold uppercase tracking-wider text-brand-600 font-mono">05 // TANYA JAWAB</span>
            <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight mt-1">Pertanyaan yang Sering Diajukan</h2>
            <p className="text-slate-600 text-sm mt-2">Segala hal yang perlu Anda ketahui mengenai keamanan dan implementasi {site_name}.</p>
          </div>

          <div className="space-y-4">
            {FAQ.map((item, i) => {
              const open = openFaq === i;
              return (
                <div key={item.q} className="border border-slate-200 rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpenFaq(open ? null : i)}
                    aria-expanded={open}
                    className="w-full px-6 py-4 text-left flex justify-between items-center bg-white hover:bg-slate-50 transition font-bold text-slate-800 text-sm sm:text-base"
                  >
                    <span>{item.q}</span>
                    <span className="text-brand-600 text-xl font-mono shrink-0 ml-4">{open ? '−' : '+'}</span>
                  </button>
                  {open && (
                    <div className="px-6 pb-4 pt-1 text-slate-600 text-sm leading-relaxed border-t border-slate-100 bg-slate-50/50">
                      {item.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <p className="text-center text-xs text-slate-400 mt-8">
            * {site_name} adalah penyedia infrastruktur monitoring independen dan bukan merupakan bagian resmi dari PT Bank Central Asia Tbk maupun PT Espay Debit Indonesia Koe (DANA).
          </p>
        </div>
      </section>

      {/* CALL TO ACTION BANNER */}
      <section className="py-16 bg-gradient-to-tr from-brand-900 via-brand-800 to-slate-900 text-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-6">
          <span className="inline-block px-3 py-1 rounded-full bg-emerald-400/20 text-emerald-300 border border-emerald-400/30 text-xs font-mono font-bold uppercase tracking-wider">
            Mulai Hari Ini
          </span>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight">
            Otomatiskan verifikasi pembayaran sekarang juga
          </h2>
          <p className="text-slate-200 max-w-2xl mx-auto text-base sm:text-lg">
            Daftar gratis sekarang dan saksikan mutasi pertama Anda tampil otomatis di layar dalam waktu kurang dari 3 menit.
          </p>
          <div className="pt-4 flex flex-wrap justify-center gap-4">
            <a href="/register" className="px-8 py-4 bg-white text-brand-900 hover:bg-emerald-50 font-extrabold rounded-xl shadow-lg transition-all active:scale-95 text-base">
              Mulai Trial Gratis 1 Hari
            </a>
            <a href="/#harga" className="px-8 py-4 bg-transparent hover:bg-white/10 border border-white/30 text-white font-semibold rounded-xl transition text-base">
              Lihat Paket
            </a>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-white border-t border-slate-200 pt-16 pb-12 text-slate-600 text-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 pb-12 border-b border-slate-100">
            <div className="space-y-4 md:col-span-2">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center text-white font-extrabold text-base">
                  M
                </div>
                <span className="text-lg font-bold text-slate-900">{site_name}</span>
              </div>
              <p className="text-slate-500 text-xs max-w-sm leading-relaxed">
                Platform agregasi mutasi rekening realtime terpercaya untuk top-up, deposit, dan rekonsiliasi bisnis modern. Kredensial terenkripsi aman dan read-only.
              </p>
            </div>

            <div>
              <h3 className="text-xs font-mono uppercase tracking-wider font-bold text-slate-900 mb-4">Navigasi</h3>
              <ul className="space-y-2 text-xs">
                <li><a href="#produk" className="hover:text-brand-600">Produk</a></li>
                <li><a href="#fitur" className="hover:text-brand-600">Fitur Utama</a></li>
                <li><a href="#cara-kerja" className="hover:text-brand-600">Cara Kerja</a></li>
                <li><a href="#harga" className="hover:text-brand-600">Daftar Harga</a></li>
                <li><a href="#kalkulator" className="hover:text-brand-600">Kalkulator Harga</a></li>
                <li><a href="#faq" className="hover:text-brand-600">FAQ</a></li>
              </ul>
            </div>

            <div>
              <h3 className="text-xs font-mono uppercase tracking-wider font-bold text-slate-900 mb-4">Integrasi &amp; Akun</h3>
              <ul className="space-y-2 text-xs">
                <li><a href="/docs" className="hover:text-brand-600">Dokumentasi API</a></li>
                <li><a href="/login" className="hover:text-brand-600">Login Dashboard</a></li>
                <li><a href="/register" className="hover:text-brand-600">Registrasi Member</a></li>
                <li><a href="#keamanan" className="hover:text-brand-600">Kebijakan Keamanan</a></li>
              </ul>
            </div>
          </div>

          <div className="pt-8 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 gap-4">
            <p>© {new Date().getFullYear()} {site_name}. Hak cipta dilindungi. Read-only, AES-256 hardware encrypted.</p>
            <p className="text-[11px]">Bukan afiliasi atau bagian resmi dari Bank BCA atau DANA Indonesia.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
