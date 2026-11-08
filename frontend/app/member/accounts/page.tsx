'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { apiDelete, apiGet, apiPost, friendlyError } from '../../../lib/api';
import { formatRupiah, providerLabel } from '../../../lib/format';
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
type Account = {
  id: string;
  provider: string;
  label?: string;
  phone_masked?: string;
  account_masked?: string;
  status?: string;
  balance_cents?: number;
  last_synced_at?: string;
  // v30: true bila sync rekening ini dijeda karena jumlah rekening
  // terhubung melebihi maks paket aktif.
  sync_paused?: boolean;
};

function AccountsContent() {
  const searchParams = useSearchParams();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [danaPhone, setDanaPhone] = useState('');
  const [bcaAccountNo, setBcaAccountNo] = useState('');
  const [bcaUserId, setBcaUserId] = useState('');
  const [bcaPin, setBcaPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [rebindBusy, setRebindBusy] = useState<string | null>(null);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function addDana(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const d = await apiPost<any>('/api/v1/accounts', { provider: 'DANA', phone: danaPhone });
      setDanaPhone('');
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
      setNotice('Rekening BCA ditambahkan. Periksa status rekening di daftar di atas.');
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
            <div style={{ marginTop: 10 }}>
              <a href={bindingUrl} target="_blank" rel="noreferrer" className="btn google-btn">
                Buka Otorisasi DANA
              </a>
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
            <Button onClick={() => { setAddTab('dana'); setShowAdd(true); }}>
              Tambah Rekening
            </Button>
          }
        />
      ) : (
        <Card
          title="Rekening terhubung"
          actions={
            <Button onClick={() => { setAddTab('dana'); setShowAdd(true); }}>
              Tambah Rekening
            </Button>
          }
        >
          <div className="table-wrap">
            <table className="accounts-table mobile-card-table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Nomor</th>
                  <th className="num">Saldo</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td data-label="Provider">{providerLabel(a.provider)}</td>
                    <td data-label="Nomor">
                      {a.provider === 'DANA'
                        ? (a.phone_masked ?? '-')
                        : (a.account_masked ?? '-')}
                      {a.label ? <><br /><span className="muted">{a.label}</span></> : null}
                    </td>
                    <td data-label="Saldo" className="num">
                      {a.balance_cents !== undefined && a.balance_cents !== null
                        ? formatRupiah(a.balance_cents / 100)
                        : '—'}
                    </td>
                    <td data-label="Status" className="status-cell">
                      <span className="status-badges">
                        <StatusBadge status={a.status ?? 'pending'} />
                        {a.sync_paused && (
                          <span className="badge badge-amber">Sync dijeda</span>
                        )}
                      </span>
                    </td>
                    <td data-label="Aksi">
                      {a.provider === 'DANA' && a.status === 'pending' && (
                        <>
                          <Button
                            variant="outline"
                            disabled={rebindBusy === a.id}
                            onClick={() => openBinding(a.id)}
                          >
                            {rebindBusy === a.id ? 'Memproses…' : 'Otorisasi DANA'}
                          </Button>{' '}
                        </>
                      )}
                      <Button variant="danger" onClick={() => removeAccount(a.id)}>
                        Hapus
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {showAdd && (
        <Modal title="Tambah Rekening" onClose={() => setShowAdd(false)}>
          <div className="tabs" role="tablist">
            <button
              type="button"
              className={addTab === 'dana' ? 'tab active' : 'tab'}
              onClick={() => setAddTab('dana')}
            >
              DANA
            </button>
            <button
              type="button"
              className={addTab === 'bca' ? 'tab active' : 'tab'}
              onClick={() => setAddTab('bca')}
            >
              BCA
            </button>
          </div>
          {addTab === 'dana' ? (
            <>
              <form onSubmit={addDana}>
                <Field label="Nomor HP DANA" hint="Contoh: 081234567890">
                  <input
                    type="tel"
                    required
                    pattern="[0-9+ ]{9,15}"
                    value={danaPhone}
                    onChange={(e) => setDanaPhone(e.target.value)}
                    placeholder="mis. 081234567890"
                  />
                </Field>
                <Button type="submit" disabled={busy}>
                  {busy ? 'Memproses…' : 'Hubungkan DANA'}
                </Button>
              </form>
              <ol className="muted" style={{ margin: '16px 0 0', paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
                <li>Masukkan nomor HP DANA, lalu ketuk Hubungkan DANA.</li>
                <li>Buka tautan otorisasi yang muncul di aplikasi DANA.</li>
                <li>Setujui akses, rekening berubah jadi aktif di sini.</li>
              </ol>
            </>
          ) : (
            <form onSubmit={addBca}>
              <Field label="Nomor Rekening BCA">
                <input
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
                  onChange={(e) => setBcaUserId(e.target.value)}
                  placeholder="User ID KlikBCA"
                  autoComplete="off"
                />
              </Field>
              <Field label="PIN KlikBCA" hint="PIN 6 digit, disimpan terenkripsi.">
                <input
                  type="password"
                  required
                  pattern="[0-9]{6}"
                  inputMode="numeric"
                  maxLength={6}
                  value={bcaPin}
                  onChange={(e) => setBcaPin(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="6 digit PIN KlikBCA"
                  autoComplete="off"
                />
              </Field>
              <p className="muted" style={{ margin: '0 0 16px' }}>
                Nomor rekening + User ID + PIN KlikBCA milik Anda sendiri. PIN tidak pernah
                ditampilkan lagi setelah disimpan.
              </p>
              <Button type="submit" disabled={busy}>
                {busy ? 'Memproses…' : 'Hubungkan BCA'}
              </Button>
            </form>
          )}
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
