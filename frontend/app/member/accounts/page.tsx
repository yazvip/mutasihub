'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { apiDelete, apiGet, apiPost, friendlyError } from '../../../lib/api';
import { formatDateWIB, formatRupiah, providerLabel } from '../../../lib/format';
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  InfoBanner,
  Modal,
  StatusBadge,
  PageHeading,
  StatSkeleton,
  TableSkeleton,
} from '../../../components/ui';

// Kontrak backend (member_handlers.go): accountRowOut + createAccountReq.
// List: {accounts: [{id, provider, label, phone_masked?, account_masked?,
//   status, balance_cents, last_synced_at?}]}
// Create DANA: {provider:'DANA', phone} — BCA: {provider:'BCA', account_no,
//   user_id, pin}. Field lain ditolak backend (DisallowUnknownFields).
// v31d: kartu progres premium saat tambah rekening sedang menghubungi
// penyedia (busy). Satu struktur untuk tab DANA dan BCA — spinner +
// hierarki judul/subteks + progress bar indeterminate.
function BusyProgressCard({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="progress-card" role="status" aria-live="polite">
      <div className="progress-row">
        <span className="progress-spinner" aria-hidden="true" />
        <div className="progress-text">
          <div className="progress-title">{title}</div>
          <div className="progress-sub">{sub}</div>
        </div>
      </div>
      <div className="progress-track" aria-hidden="true">
        <div className="progress-bar" />
      </div>
    </div>
  );
}

// v31e: ikon inline SVG (stroke 1.75px, satu gaya garis) untuk tab Tambah
// Rekening + tombol submit. Bukan emoji, bukan gambar eksternal.
function WalletIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
    </svg>
  );
}

function BankIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="3" x2="21" y1="22" y2="22" />
      <line x1="6" x2="6" y1="18" y2="11" />
      <line x1="10" x2="10" y1="18" y2="11" />
      <line x1="14" x2="14" y1="18" y2="11" />
      <line x1="18" x2="18" y1="18" y2="11" />
      <polygon points="12 2 20 7 4 7" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

// v32: ikon untuk state sukses tombol, eye toggle PIN, dan badge keamanan.
function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

// v33: ikon plus (tombol Tambah Rekening) + tempat sampah (tombol Hapus
// halus) untuk daftar Rekening terhubung premium. Satu gaya garis dengan
// ikon lain di file ini.
function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3.5 7 10 7a9.59 9.59 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  );
}

function LockIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

// v32: warna channel modal Tambah Rekening. DANA Sky Blue, BCA Navy Blue.
// Variabel dipakai seluruh elemen bertema di dalam modal (strip, tile ikon,
// tombol, kartu progres, banner) lewat var() + transition, sehingga
// perpindahan tab terasa mulus.
const CHANNELS = {
  dana: { '--ch': '#108ee9', '--ch-soft': '#e8f4fd', '--ch-border': '#b3ddf7', '--ch-dark': '#0b5fa5' },
  bca: { '--ch': '#005baa', '--ch-soft': '#e6eef7', '--ch-border': '#b3c6dd', '--ch-dark': '#003a6e' },
} as const;

// v32: normalisasi nomor DANA untuk prefix visual +62. Input hanya
// menyimpan digit setelah kode negara (mis. "81234567890"); saat submit
// dikirim format lama "0" + digit — persis seperti yang diketik member
// hari ini. BUKTI KONTRAK backend (member_handlers.go): danaPhoneRe
// ^[0-9]{9,15}$ + wajib prefix "08" atau "628"; nomor diteruskan verbatim
// ke DanaBinding (Connecta field "phone") dan disimpan terenkripsi
// verbatim. Jadi "0"+digit adalah format yang benar, bukan "62"+digit.
function stripDanaDigits(v: string): string {
  return v.replace(/\D/g, '').replace(/^(62|0)+/, '');
}

type Account = {
  id: string;
  provider: string;
  label?: string;
  phone_masked?: string;
  account_masked?: string;
  status?: string;
  balance_cents?: number;
  last_synced_at?: string;
  // v34: tanggal tambah (selalu ada) + tanggal otorisasi pertama
  // (hanya bila pernah diotorisasi; NULL untuk rekening aktif lama).
  created_at?: string;
  authorized_at?: string;
  // v30: true bila sync rekening ini dijeda karena jumlah rekening
  // terhubung melebihi maks paket aktif.
  sync_paused?: boolean;
};

// v44: panduan autorisasi akun DANA — 5 langkah + screenshot HP user
// (urut sesuai kiriman). Gambar di public/images/dana-auth/.
const DANA_GUIDE_STEPS: { title: string; text: string; img: string; alt: string }[] = [
  {
    title: 'Masukkan nomor HP',
    text: 'Ketuk tombol Otorisasi DANA. Kamu akan diarahkan ke halaman DANA — masukkan nomor HP sebagai ID DANA, lalu ketuk LANJUTKAN.',
    img: '/images/dana-auth/step-1.jpg',
    alt: 'Halaman DANA: masukkan nomor HP sebagai ID DANA',
  },
  {
    title: 'Verifikasi dengan PIN DANA',
    text: 'Jika muncul verifikasi Passkey, ketuk PAKAI PIN DANA. Tenang — kamu masih berada di halaman DANA, jadi PIN kamu tetap aman dan tidak pernah kami ketahui.',
    img: '/images/dana-auth/step-2.jpg',
    alt: 'Verifikasi Passkey gagal — pilih PAKAI PIN DANA',
  },
  {
    title: 'Tunggu konfirmasi',
    text: 'Layar Menunggu Konfirmasi muncul. Buka aplikasi DANA — biasanya ada notifikasi, atau buka manual lalu cek Inbox — dan setujui permintaan login.',
    img: '/images/dana-auth/step-3.jpg',
    alt: 'Menunggu konfirmasi di aplikasi DANA',
  },
  {
    title: 'Setujui di aplikasi DANA',
    text: 'Di aplikasi DANA, ketuk VERIFIKASI pada permintaan login ke MutasiHub.',
    img: '/images/dana-auth/step-4.jpg',
    alt: 'Permintaan login ke MutasiHub di aplikasi DANA',
  },
  {
    title: 'Lanjutkan & kembali ke browser',
    text: 'Jika muncul peringatan modus penipuan, ketuk LANJUTKAN — ini permintaan yang kamu buat sendiri dari browser. Setelah disetujui, kembali ke browser: kamu akan kembali ke halaman rekening dengan status berhasil. Tenang, kami hanya membaca saldo dan mutasi (read-only) — tidak pernah bisa transfer atau mengubah saldo DANA kamu.',
    img: '/images/dana-auth/step-5.jpg',
    alt: 'Peringatan modus penipuan — ketuk LANJUTKAN',
  },
];

function AccountsContent() {
  const searchParams = useSearchParams();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // v43: pengaman sekali-kirim reversal DANA — auth_code sekali pakai,
  // effect tidak boleh memanggil endpoint dua kali (mis. double-invoke).
  const reversalTried = useRef(false);

  const [danaPhone, setDanaPhone] = useState('');
  const [bcaAccountNo, setBcaAccountNo] = useState('');
  const [bcaUserId, setBcaUserId] = useState('');
  const [bcaPin, setBcaPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [rebindBusy, setRebindBusy] = useState<string | null>(null);
  // v32: eye toggle PIN KlikBCA + state sukses tombol tambah rekening
  // (centang "Berhasil ditambahkan" ~1,2 dtk sebelum modal menutup).
  const [showPin, setShowPin] = useState(false);
  const [submitOk, setSubmitOk] = useState(false);
  // v30: maks resmi paket aktif — hanya dipakai bila N tidak bisa
  // diturunkan dari daftar (semua rekening beku).
  const [officialMax, setOfficialMax] = useState<number | null>(null);

  // v30: N (maks paket aktif) diturunkan dari daftar: backend membekukan
  // persis kelebihannya, jadi jumlah rekening yang TIDAK beku = batas
  // paket. Bila semuanya beku (N = 0, tidak bisa diturunkan), ambil maks
  // resmi dari GET /api/v1/plans + GET /api/v1/subscriptions.
  const pausedAccounts = accounts.filter((a) => a.sync_paused);
  const runningAccounts = accounts.filter((a) => !a.sync_paused);
  const maxAccounts = runningAccounts.length > 0 ? runningAccounts.length : officialMax;

  useEffect(() => {
    if (loading || pausedAccounts.length === 0 || runningAccounts.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const [p, s] = await Promise.all([
          apiGet<any>('/api/v1/plans').catch(() => null),
          apiGet<any>('/api/v1/subscriptions').catch(() => null),
        ]);
        if (cancelled || !p || !s) return;
        const plans = Array.isArray(p) ? p : p?.plans ?? p?.data ?? [];
        const subs = Array.isArray(s) ? s : s?.subscriptions ?? s?.data ?? [];
        const act = (Array.isArray(subs) ? subs : []).find((x: any) =>
          ['active', 'aktif', 'trial'].includes(String(x?.status ?? '').toLowerCase())
        );
        const plan = (Array.isArray(plans) ? plans : []).find((x: any) =>
          (act?.plan_slug && x.slug === act.plan_slug) || x.name === act?.plan_name
        );
        const max = plan?.max_accounts ?? plan?.max_rekening;
        if (typeof max === 'number') setOfficialMax(max);
      } catch {
        // Banner tetap tampil dengan N = '—'; bukan error halaman.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, accounts]);
  // Link otorisasi OAuth DANA dari respons binding — WAJIB dibuka member,
  // kalau tidak rekening stuck pending selamanya.
  const [bindingUrl, setBindingUrl] = useState<string | null>(null);
  // Form tambah rekening TIDAK tampil langsung — hanya lewat modal.
  const [showAdd, setShowAdd] = useState(false);
  const [addTab, setAddTab] = useState<'dana' | 'bca'>('dana');
  // v44: panduan autorisasi DANA (modal berisi 5 langkah + screenshot).
  const [showGuide, setShowGuide] = useState(false);
  // v45: profil DANA (modal berisi nama tersamar, KYC, status).
  const [profile, setProfile] = useState<{ accountId: string; phoneMasked: string; accountName: string; kycLevel: string; status: string; updatedAt: string } | null>(null);
  const [profileBusy, setProfileBusy] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  async function load() {
    try {
      const d = await apiGet<any>('/api/v1/accounts');
      const list = Array.isArray(d) ? d : d?.accounts ?? d?.data ?? [];
      setAccounts(Array.isArray(list) ? list : []);
      setError(null);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // P1-16: kembali dari binding DANA (redirect Connecta ke
  // /member/accounts?dana=callback) — tampilkan status lalu refresh daftar.
  useEffect(() => {
    const dana = searchParams.get('dana');
    if (!dana) return;
    if (['success', 'ok', 'callback', 'done'].includes(dana.toLowerCase())) {
      setNotice(
        'Binding DANA selesai. Status rekening diperbarui di bawah — bila masih "pending", tunggu sebentar lalu refresh halaman.'
      );
    } else if (['failed', 'error', 'cancel', 'cancelled'].includes(dana.toLowerCase())) {
      setError('Binding DANA gagal atau dibatalkan. Silakan coba hubungkan lagi.');
    } else {
      setNotice('Kembali dari proses binding DANA — memeriksa status rekening…');
    }
    load();
    // v43: reversal DANA — teruskan auth_code ke backend SEGERA (TTL 60
    // dtk, sekali pakai). Sebelum v43 halaman hanya membaca param dana
    // sehingga kode kedaluwarsa tanpa pernah dipakai dan rekening stuck
    // pending. Backend memanggil POST /api/v1/reversal-dana Connecta
    // lalu mengaktifkan rekening dari responsnya (tanpa menunggu webhook).
    const authCode = searchParams.get('auth_code');
    if (authCode && !reversalTried.current) {
      reversalTried.current = true;
      setNotice('Memproses otorisasi DANA…');
      apiPost<{ account_id: string; status: string; balance_cents: number; message?: string }>(
        '/api/v1/accounts/dana/reversal',
        { callback_url: window.location.href },
      )
        .then((d) => {
          setNotice(d.message || 'DANA berhasil terhubung dan aktif.');
          window.history.replaceState(null, '', '/member/accounts');
          load();
        })
        .catch((e) => {
          setError(friendlyError(e));
          window.history.replaceState(null, '', '/member/accounts');
          load();
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // v32: danaPhone menyimpan digit SETELAH kode negara (prefix +62 hanya
  // visual di input). Saat submit dikirim "0" + digit — format lama yang
  // diharapkan backend (lihat stripDanaDigits di atas).
  async function addDana(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    setSubmitOk(false);
    try {
      const phone = '0' + danaPhone;
      const d = await apiPost<any>('/api/v1/accounts', { provider: 'DANA', phone });
      setDanaPhone('');
      setBusy(false);
      // State sukses: tombol berubah jadi centang hijau ~1,2 dtk sebelum
      // modal menutup, agar member yakin tambah rekening berhasil.
      setSubmitOk(true);
      await new Promise((r) => setTimeout(r, 1200));
      if (d?.binding_url) {
        setBindingUrl(d.binding_url);
        setNotice(
          'Rekening DANA ditambahkan. Selesaikan otorisasi lewat tombol di bawah — status berubah aktif setelah Anda menyetujui di aplikasi DANA.'
        );
      } else {
        setNotice(
          'Rekening DANA ditambahkan. Status bisa "pending" sampai proses binding selesai lewat webhook.'
        );
      }
      setSubmitOk(false);
      setShowAdd(false);
      await load();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function addBca(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    setSubmitOk(false);
    try {
      await apiPost('/api/v1/accounts', {
        provider: 'BCA',
        account_no: bcaAccountNo,
        user_id: bcaUserId,
        pin: bcaPin,
      });
      setBcaAccountNo('');
      setBcaUserId('');
      setBcaPin('');
      setBusy(false);
      setSubmitOk(true);
      await new Promise((r) => setTimeout(r, 1200));
      setNotice('Rekening BCA ditambahkan. Periksa status rekening di daftar di atas.');
      setSubmitOk(false);
      setShowAdd(false);
      await load();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeAccount(id: string) {
    if (!confirm('Hapus rekening ini? Mutasi yang sudah tercatat tidak ikut terhapus.')) return;
    try {
      await apiDelete(`/api/v1/accounts/${id}`);
      setNotice('Rekening dihapus.');
      await load();
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  // Tombol permanen di baris rekening pending: buat ulang link otorisasi
  // OAuth DANA lalu buka di tab baru. Banner sesaat setelah tambah
  // rekening tidak cukup — member yang me-reload halaman (atau yang
  // rekeningnya dibuat sebelum v6) tidak bisa lagi mendapatkan link.
  async function openBinding(accountId: string) {
    setError(null);
    setRebindBusy(accountId);
    try {
      const d = await apiPost<any>(`/api/v1/accounts/${accountId}/binding-url`, {});
      if (!d?.binding_url) throw new Error('Penyedia tidak mengembalikan link otorisasi.');
      window.open(d.binding_url, '_blank', 'noopener,noreferrer');
      setNotice('Tautan otorisasi DANA dibuka di tab baru. Setujui di aplikasi DANA — status berubah aktif otomatis (maks. ~1 menit).');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setRebindBusy(null);
    }
  }

  // v45: cek profil DANA milik member sendiri (POST /api/v1/accounts/{id}/dana-profile).
  // Backend menyelesaikan nomor yang dipakai Connecta; member tidak mengetik nomor.
  async function loadProfile(accountId: string) {
    setProfileBusy(accountId);
    setProfileError(null);
    setProfile(null);
    try {
      const d = await apiPost<any>(`/api/v1/accounts/${accountId}/dana-profile`, {});
      setProfile({
        accountId,
        phoneMasked: d.phone_masked ?? '',
        accountName: d.account_name ?? '-',
        kycLevel: d.kyc_level ?? '-',
        status: d.status ?? '-',
        updatedAt: d.updated_at ?? '',
      });
    } catch (err) {
      setProfileError(friendlyError(err));
    } finally {
      setProfileBusy(null);
    }
  }

  function closeProfile() {
    setProfile(null);
    setProfileError(null);
  }

  return (
    <>
      <PageHeading eyebrow="Rekening terhubung" title="Rekening" description="Hubungkan rekening milik Anda sendiri. DANA memakai nomor HP Anda; BCA memakai nomor rekening + User ID + PIN KlikBCA Anda. Kredensial terenkripsi AES-256 dan hanya dipakai membaca mutasi (read-only)." />
      <ErrorBanner message={error} onClose={() => setError(null)} />
      <InfoBanner message={notice} />

      {!loading && pausedAccounts.length > 0 && (
        <div className="banner banner-warning" role="status">
          <div>
            <strong>
              {runningAccounts.length}/{accounts.length} rekening — paketmu maks{' '}
              {maxAccounts ?? '—'}.
            </strong>{' '}
            Rekening yang pertama dihubungkan tetap jalan; sisanya dijeda sampai
            jumlahnya ≤ {maxAccounts ?? 'batas paket'} atau kamu upgrade.{' '}
            <Link href="/member/subscription">Lihat paket →</Link>
          </div>
        </div>
      )}

      {bindingUrl && (
        <div className="banner banner-info" role="status">
          <div>
            <strong>Selesaikan binding DANA.</strong>
            <br />
            Buka tautan otorisasi, setujui di aplikasi DANA, lalu kembali ke
            sini — status rekening berubah aktif otomatis (maks. ~1 menit).
            <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <a href={bindingUrl} target="_blank" rel="noreferrer" className="btn google-btn">
                Buka Otorisasi DANA
              </a>
              <Button variant="ghost" onClick={() => setShowGuide(true)}>
                Cara Autorisasi
              </Button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <>
          <StatSkeleton />
          <Card title="Memuat…">
            <TableSkeleton rows={4} />
          </Card>
        </>
      ) : accounts.length === 0 ? (
        <EmptyState
          title="Belum ada rekening terhubung"
          description="Tambahkan rekening DANA atau BCA Anda untuk mulai melihat mutasi."
          action={
            <Button className="btn-accounts-add" onClick={() => { setAddTab('dana'); setShowAdd(true); }}>
              <PlusIcon /> Tambah Rekening
            </Button>
          }
        />
      ) : (
        <Card
          title="Rekening terhubung"
          className="accounts-card"
          actions={
            <>
              <span className="acct-count">{accounts.length} rekening</span>
              <Button className="btn-accounts-add" onClick={() => { setAddTab('dana'); setShowAdd(true); }}>
                <PlusIcon /> Tambah Rekening
              </Button>
            </>
          }
        >
          {/* v33: daftar rekening premium — div, bukan tabel. Desktop tampil
              seperti baris tabel (header kolom + grid sejajar); HP jadi kartu
              ringkas per rekening. Perilaku dipertahankan persis: Otorisasi
              DANA (openBinding, busy 'Memproses… (maks. 15 dtk)'), Hapus
              (removeAccount, confirm dulu), badge status + 'Sync dijeda'. */}
          <div className="account-list-head" aria-hidden="true">
            <span>Rekening</span>
            <span className="num">Saldo</span>
            <span>Status</span>
            <span>Aksi</span>
          </div>
          <ul className="account-list">
            {accounts.map((a) => {
              const ch = a.provider === 'BCA' ? CHANNELS.bca : CHANNELS.dana;
              return (
                <li key={a.id} className="account-row" style={ch as CSSProperties}>
                  <span className="acct-icon" aria-hidden="true">
                    {a.provider === 'BCA' ? <BankIcon /> : <WalletIcon />}
                  </span>
                  <div className="acct-id">
                    <div className="acct-provider">{providerLabel(a.provider)}</div>
                    <div className="acct-number">
                      {a.provider === 'DANA'
                        ? (a.phone_masked ?? '-')
                        : (a.account_masked ?? '-')}
                    </div>
                    {a.label ? <div className="acct-label">{a.label}</div> : null}
                    {/* v34: tanggal tambah selalu tampil; tanggal otorisasi
                        HANYA bila status active DAN authorized_at terisi
                        (rekening aktif lama pra-v34 tetap NULL → tidak tampil). */}
                    {a.created_at ? (
                      <div className="acct-dates">Ditambahkan {formatDateWIB(a.created_at, true, true)}</div>
                    ) : null}
                    {a.status === 'active' && a.authorized_at ? (
                      <div className="acct-dates">Diotorisasi {formatDateWIB(a.authorized_at, true, true)}</div>
                    ) : null}
                  </div>
                  <div className="acct-balance">
                    <span className="acct-meta-label">Saldo</span>
                    <span className="acct-balance-value">
                      {a.balance_cents !== undefined && a.balance_cents !== null
                        ? formatRupiah(a.balance_cents / 100)
                        : '—'}
                    </span>
                  </div>
                  <div className="acct-status">
                    <span className="status-badges">
                      <StatusBadge status={a.status ?? 'pending'} />
                      {a.sync_paused && (
                        <span className="badge badge-amber">Sync dijeda</span>
                      )}
                    </span>
                  </div>
                  <div className="acct-actions">
                    {a.provider === 'DANA' && a.status === 'pending' && (
                      <Button
                        className="btn-authorize"
                        disabled={rebindBusy === a.id}
                        onClick={() => openBinding(a.id)}
                      >
                        {rebindBusy === a.id ? 'Memproses… (maks. 15 dtk)' : 'Otorisasi DANA'}
                      </Button>
                    )}
                    {a.provider === 'DANA' && a.status === 'active' && (
                      <Button
                        variant="ghost"
                        className="btn-profile-subtle"
                        disabled={profileBusy === a.id}
                        onClick={() => loadProfile(a.id)}
                      >
                        {profileBusy === a.id ? 'Memuat…' : 'Cek Profil'}
                      </Button>
                    )}
                    <Button variant="ghost" className="btn-delete-subtle" onClick={() => removeAccount(a.id)}>
                      <TrashIcon /> Hapus
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {showAdd && (
        <Modal
          title="Tambah Rekening"
          onClose={() => setShowAdd(false)}
          topStripColor={CHANNELS[addTab]['--ch']}
        >
          {/* v32: variabel warna channel di container modal; semua elemen
              bertema di bawah memakai var() + transition. */}
          <div className="add-modal" style={CHANNELS[addTab] as CSSProperties}>
          <div className="tabs tabs-add-account" role="tablist">
            <button
              type="button"
              className={addTab === 'dana' ? 'tab active' : 'tab'}
              onClick={() => setAddTab('dana')}
            >
              <span className="tab-icon" aria-hidden="true"><WalletIcon /></span>
              DANA
            </button>
            <button
              type="button"
              className={addTab === 'bca' ? 'tab active' : 'tab'}
              onClick={() => setAddTab('bca')}
            >
              <span className="tab-icon" aria-hidden="true"><BankIcon /></span>
              BCA
            </button>
          </div>
          {addTab === 'dana' ? (
            <>
              <form onSubmit={addDana}>
                <Field label="Nomor HP DANA" hint="Masukkan nomor tanpa 0 di depan — contoh: 81234567890">
                  <div className="input-group">
                    <span className="input-prefix" aria-hidden="true">+62</span>
                    <input
                      className="mono-input"
                      type="tel"
                      required
                      pattern="[0-9]{8,14}"
                      minLength={8}
                      maxLength={14}
                      inputMode="numeric"
                      value={danaPhone}
                      onChange={(e) => setDanaPhone(stripDanaDigits(e.target.value))}
                      placeholder="81234567890"
                      autoComplete="off"
                    />
                  </div>
                </Field>
                <Button type="submit" disabled={busy || submitOk} className={submitOk ? 'btn-add-premium btn-success' : 'btn-add-premium'}>
                  {busy ? (
                    <>
                      <span className="btn-add-spinner" aria-hidden="true" />
                      Memproses…
                    </>
                  ) : submitOk ? (
                    <>
                      <CheckIcon />
                      Berhasil ditambahkan
                    </>
                  ) : (
                    <>
                      <LinkIcon />
                      Hubungkan DANA
                    </>
                  )}
                </Button>
                {busy && (
                  <BusyProgressCard
                    title="Menghubungi DANA…"
                    sub="Bisa sampai 15 detik — jangan tutup halaman ini."
                  />
                )}
              </form>
              <ol className="muted" style={{ margin: '16px 0 0', paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
                <li>Masukkan nomor HP DANA tanpa 0 di depan, lalu ketuk Hubungkan DANA.</li>
                <li>Buka tautan otorisasi yang muncul di aplikasi DANA.</li>
                <li>Setujui akses, rekening berubah jadi aktif di sini.</li>
              </ol>
              <button type="button" className="dana-guide-link" onClick={() => setShowGuide(true)}>
                Cara autorisasi akun DANA →
              </button>
            </>
          ) : (
            <form onSubmit={addBca}>
              {/* v32: banner jaminan privasi — kredensial terenkripsi dan
                  hanya dipakai membaca mutasi (read-only). */}
              <div className="privacy-banner" role="note">
                <span className="privacy-icon" aria-hidden="true"><LockIcon size={16} /></span>
                <p>
                  Kredensial Anda terenkripsi AES-256 dan hanya dipakai untuk
                  membaca mutasi. MutasiHub tidak pernah memindahkan dana atau
                  melakukan transaksi atas nama Anda.
                </p>
              </div>
              <Field label="Nomor Rekening BCA">
                <input
                  className="mono-input"
                  type="text"
                  required
                  inputMode="numeric"
                  value={bcaAccountNo}
                  onChange={(e) => setBcaAccountNo(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="mis. 1234567890"
                  autoComplete="off"
                />
              </Field>
              <Field label="User ID KlikBCA">
                <input
                  type="text"
                  required
                  value={bcaUserId}
                  onChange={(e) => setBcaUserId(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  placeholder="User ID KlikBCA"
                  autoComplete="off"
                  autoCapitalize="characters"
                />
              </Field>
              <Field
                label={
                  <span className="pin-label">
                    PIN KlikBCA
                    <span className="pin-badges">
                      <span className="pin-badge">Read-Only</span>
                      <span className="pin-badge"><LockIcon size={10} />AES-256</span>
                    </span>
                  </span>
                }
                hint="PIN 6 digit, disimpan terenkripsi."
              >
                <div className="input-with-eye">
                  <input
                    className="mono-input"
                    type={showPin ? 'text' : 'password'}
                    required
                    pattern="[0-9]{6}"
                    inputMode="numeric"
                    maxLength={6}
                    value={bcaPin}
                    onChange={(e) => setBcaPin(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="6 digit PIN KlikBCA"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    className="eye-toggle"
                    onClick={() => setShowPin((v) => !v)}
                    aria-label={showPin ? 'Sembunyikan PIN' : 'Tampilkan PIN'}
                  >
                    {showPin ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
              </Field>
              <p className="muted" style={{ margin: '0 0 16px' }}>
                Nomor rekening + User ID + PIN KlikBCA milik Anda sendiri. PIN tidak pernah
                ditampilkan lagi setelah disimpan.
              </p>
              <Button type="submit" disabled={busy || submitOk} className={submitOk ? 'btn-add-premium btn-success' : 'btn-add-premium'}>
                {busy ? (
                  <>
                    <span className="btn-add-spinner" aria-hidden="true" />
                    Memproses…
                  </>
                ) : submitOk ? (
                  <>
                    <CheckIcon />
                    Berhasil ditambahkan
                  </>
                ) : (
                  <>
                    <LinkIcon />
                    Hubungkan BCA
                  </>
                )}
              </Button>
              {busy && (
                <BusyProgressCard
                  title="Menghubungi bank…"
                  sub="Bisa sampai 15 detik — jangan tutup halaman ini."
                />
              )}
            </form>
          )}
          </div>
        </Modal>
      )}

      {showGuide && (
        <Modal
          title="Cara Autorisasi Akun DANA"
          subtitle="Ikuti 5 langkah ini — prosesnya hanya butuh sekitar 1 menit."
          onClose={() => setShowGuide(false)}
          topStripColor="#108ee9"
        >
          <ol className="dana-guide">
            {DANA_GUIDE_STEPS.map((s, i) => (
              <li key={s.img} className="dana-guide-step">
                <div className="dana-guide-head">
                  <span className="dana-guide-num" aria-hidden="true">{i + 1}</span>
                  <h4>{s.title}</h4>
                </div>
                <p>{s.text}</p>
                <img
                  className="dana-guide-img"
                  src={s.img}
                  alt={s.alt}
                  loading="lazy"
                />
              </li>
            ))}
          </ol>
        </Modal>
      )}

      {(profile || profileError) && (
        <Modal
          title="Profil Akun DANA"
          subtitle="Data dari Connecta — nama dan nomor ditampilkan tersamar oleh penyedia."
          onClose={closeProfile}
          topStripColor="#108ee9"
        >
          {profileError ? (
            <p className="muted" style={{ margin: 0 }}>{profileError}</p>
          ) : profile ? (
            <dl className="dana-profile">
              <div>
                <dt>Nama</dt>
                <dd>{profile.accountName}</dd>
              </div>
              <div>
                <dt>Nomor DANA</dt>
                <dd className="mono">{profile.phoneMasked}</dd>
              </div>
              <div>
                <dt>Level KYC</dt>
                <dd>{profile.kycLevel}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd><StatusBadge status={profile.status} /></dd>
              </div>
              {profile.updatedAt ? (
                <div>
                  <dt>Terakhir diperbarui</dt>
                  <dd>{formatDateWIB(profile.updatedAt, true, true)}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </Modal>
      )}
    </>
  );
}

export default function MemberAccountsPage() {
  return (
    <Suspense>
      <AccountsContent />
    </Suspense>
  );
}
