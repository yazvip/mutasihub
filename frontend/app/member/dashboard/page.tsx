'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiUrl, friendlyError } from '../../../lib/api';
import {
  formatAmount,
  formatDateInput,
  formatDateWIB,
  formatRupiah,
  providerLabel,
} from '../../../lib/format';
import { IconCard, IconChart, IconWallet, IconZap } from '../../../components/icons';
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  StatusBadge,
  PageHeading,
  StatSkeleton,
  TableSkeleton,
} from '../../../components/ui';

// Kontrak backend:
// - GET /api/v1/member/dashboard -> {total_mutations, total_in_cents,
//   total_out_cents, active_accounts, plan, plan_expires_at, plan_expired}
//   v21 (P1-7): paket kedaluwarsa -> plan: null, plan_expired: true.
// - GET /api/v1/accounts -> {accounts: [{id, provider, label, phone_masked?,
//   account_masked?, status, balance_cents}]}
// - GET /api/v1/mutasi?type=CR|DB&min_amount=&max_amount= (cents)
//   -> {data: [{provider, date, type, amount_cents, description, sender}]}
type Mutasi = {
  provider?: string;
  type?: string;
  sender?: string;
  amount_cents?: number;
  description?: string;
  date?: string;
};

type Account = {
  id: string;
  provider: string;
  label?: string;
  phone_masked?: string;
  account_masked?: string;
  status?: string;
  balance_cents?: number;
  last_synced_at?: string | null;
};

export default function MemberDashboardPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [mutasi, setMutasi] = useState<Mutasi[]>([]);
  const [totalIn, setTotalIn] = useState(0);
  const [totalOut, setTotalOut] = useState(0);
  const [totalMutations, setTotalMutations] = useState(0);
  const [activeAccounts, setActiveAccounts] = useState(0);
  const [planName, setPlanName] = useState('');
  const [planExpired, setPlanExpired] = useState(false);
  const [csvNote, setCsvNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [sender, setSender] = useState('');
  const [type, setType] = useState('');
  // Panel filter TIDAK tampil langsung — dibuka lewat tombol Filter.
  const [showFilters, setShowFilters] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      // Backend bandingkan amount_cents: input rupiah -> cents (x100).
      if (minAmount) params.set('min_amount', String(Math.round(Number(minAmount) * 100)));
      if (maxAmount) params.set('max_amount', String(Math.round(Number(maxAmount) * 100)));
      if (sender) params.set('sender', sender);
      if (type) params.set('type', type);
      const qs = params.toString();
      const [dash, acc, m] = await Promise.all([
        apiGet<any>('/api/v1/member/dashboard').catch(() => null),
        apiGet<any>('/api/v1/accounts').catch(() => null),
        apiGet<any>(`/api/v1/mutasi${qs ? `?${qs}` : ''}`).catch(() => null),
      ]);
      if (dash) {
        setTotalIn(Number(dash.total_in_cents) || 0);
        setTotalOut(Number(dash.total_out_cents) || 0);
        setTotalMutations(Number(dash.total_mutations) || 0);
        setActiveAccounts(Number(dash.active_accounts) || 0);
        setPlanName(dash.plan ?? '');
        // v21 (P1-7): plan null + plan_expired true = paket kedaluwarsa.
        setPlanExpired(
          dash.plan_expired === true ||
            (dash.plan == null && dash.plan_expires_at != null)
        );
      }
      if (acc) {
        const list = Array.isArray(acc) ? acc : acc?.accounts ?? acc?.data ?? [];
        const arr: Account[] = Array.isArray(list) ? list : [];
        setAccounts(arr);
        // v22 (P2-15): "Terakhir Disinkronkan" = max(last_synced_at) dari
        // akun member, BUKAN waktu halaman dibuka. Belum pernah sync sama
        // sekali -> null -> tampil "—" (v31-D: satu karakter, nowrap).
        const synced = arr
          .map((a) => (a.last_synced_at ? new Date(a.last_synced_at).getTime() : NaN))
          .filter((t) => !Number.isNaN(t));
        setLastSync(synced.length > 0 ? new Date(Math.max(...synced)).toISOString() : null);
      }
      if (m) {
        const list = Array.isArray(m) ? m : m.data ?? m.mutasi ?? [];
        setMutasi(Array.isArray(list) ? list : []);
      }
      setError(null);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  }, [from, to, minAmount, maxAmount, sender, type]);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresh ringan tiap 30 detik
  useEffect(() => {
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  // Filter yang sedang aktif — tampil sebagai chip saat panel tertutup.
  const activeFilters: { key: string; label: string; clear: () => void }[] = [
    ...(from
      ? [{ key: 'from', label: `Dari ${formatDateWIB(from, false)}`, clear: () => setFrom('') }]
      : []),
    ...(to
      ? [{ key: 'to', label: `Sampai ${formatDateWIB(to, false)}`, clear: () => setTo('') }]
      : []),
    ...(minAmount
      ? [{ key: 'min', label: `Min ${formatRupiah(Number(minAmount))}`, clear: () => setMinAmount('') }]
      : []),
    ...(maxAmount
      ? [{ key: 'max', label: `Maks ${formatRupiah(Number(maxAmount))}`, clear: () => setMaxAmount('') }]
      : []),
    ...(sender
      ? [{ key: 'sender', label: `Pengirim: ${sender}`, clear: () => setSender('') }]
      : []),
    ...(type
      ? [{ key: 'type', label: `Tipe: ${type === 'CR' ? 'Masuk' : 'Keluar'}`, clear: () => setType('') }]
      : []),
  ];

  function resetFilters() {
    setFrom('');
    setTo('');
    setMinAmount('');
    setMaxAmount('');
    setSender('');
    setType('');
  }

  // v21 (P1-14): export CSV mengabaikan paginasi di server (cap 5000
  // baris). Baca header X-CSV-Truncated / X-Total-Count agar member tahu
  // bila unduhan terpotong. Fetch langsung (bukan window.open) supaya
  // header respons bisa dibaca.
  async function exportCsv() {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (minAmount) params.set('min_amount', String(Math.round(Number(minAmount) * 100)));
    if (maxAmount) params.set('max_amount', String(Math.round(Number(maxAmount) * 100)));
    if (sender) params.set('sender', sender);
    if (type) params.set('type', type);
    params.set('format', 'csv');
    setCsvNote(null);
    try {
      const res = await fetch(apiUrl(`/api/v1/mutasi?${params.toString()}`), {
        credentials: 'include',
      });
      if (!res.ok) {
        let msg = `Gagal mengunduh CSV (HTTP ${res.status}).`;
        try {
          const j = await res.clone().json();
          if (j?.message) msg = j.message;
        } catch {
          // pakai pesan default di atas
        }
        setError(msg);
        return;
      }
      const truncated = res.headers.get('X-CSV-Truncated') === 'true';
      const total = res.headers.get('X-Total-Count');
      if (truncated) {
        const totalNum = total ? Number(total) : null;
        setCsvNote(
          `CSV hanya memuat 5000 baris pertama${
            totalNum ? ` dari ${totalNum.toLocaleString('id-ID')} mutasi` : ''
          } — persempit filter tanggal untuk mengunduh sisanya.`
        );
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'mutasi.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('Tidak dapat terhubung ke server. Periksa koneksi atau coba lagi nanti.');
    }
  }

  const today = formatDateInput(new Date());

  return (
    <>
      <PageHeading eyebrow="Selamat datang kembali" title="Dashboard" />
      <ErrorBanner message={error} onClose={() => setError(null)} />
      {loading ? (
        <>
          <StatSkeleton />
          <Card title="Memuat…">
            <TableSkeleton rows={4} />
          </Card>
        </>
      ) : (
        <>
          {planExpired && (
            <div className="callout-warn" role="alert">
              <strong>Paket Anda kedaluwarsa.</strong> Perpanjang langganan
              untuk melanjutkan sinkronisasi mutasi.{' '}
              <Link href="/member/subscription">Perpanjang paket →</Link>
            </div>
          )}
          <div className="stat-grid">
            <div className="stat">
              <span className="stat-icon"><IconChart /></span>
              <div className="stat-body">
                <p className="stat-label">Total Masuk</p>
                <p className="stat-value">{formatRupiah(totalIn / 100)}</p>
                <p className="stat-sub">Semua rekening · WIB</p>
              </div>
            </div>
            <div className="stat">
              <span className="stat-icon icon-blue"><IconCard /></span>
              <div className="stat-body">
                <p className="stat-label">Total Keluar</p>
                <p className="stat-value">{formatRupiah(totalOut / 100)}</p>
                <p className="stat-sub">{totalMutations} mutasi tercatat</p>
              </div>
            </div>
            <div className="stat">
              <span className="stat-icon"><IconWallet /></span>
              <div className="stat-body">
                <p className="stat-label">Rekening Terhubung</p>
                <p className="stat-value">{accounts.length}</p>
                <p className="stat-sub">
                  {activeAccounts} aktif
                  {planExpired ? (
                    <>
                      {' · Paket '}
                      <Link href="/member/subscription" style={{ color: 'var(--accent-ink)', fontWeight: 600 }}>
                        Kedaluwarsa — Perpanjang
                      </Link>
                    </>
                  ) : planName ? (
                    ` · Paket ${planName}`
                  ) : (
                    ''
                  )}
                </p>
              </div>
            </div>
            <div className="stat">
              <span className="stat-icon icon-amber"><IconZap /></span>
              <div className="stat-body">
                <p className="stat-label">Terakhir Disinkronkan</p>
                {/* v31-D: nilai tanggal boleh membungkus (bukan angka) —
                    whiteSpace normal mengalahkan nowrap .stat-value di HP. */}
                <p className="stat-value" style={{ fontSize: 16, whiteSpace: 'normal' }}>
                  {lastSync
                    ? new Date(lastSync).toLocaleString('id-ID', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'Asia/Jakarta',
                      }) + ' WIB'
                    : '—'}
                </p>
                <p className="stat-sub">Auto-refresh tiap 30 detik</p>
              </div>
            </div>
          </div>

          <Card title="Saldo per Rekening" kicker="Ringkasan">
            {accounts.length === 0 ? (
              <EmptyState
                title="Belum ada rekening"
                description="Hubungkan nomor HP DANA atau rekening BCA Anda untuk mulai memantau mutasi."
                action={<Button href="/member/accounts">Hubungkan Rekening</Button>}
              />
            ) : (
              <div className="grid-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                {accounts.map((a) => (
                  <div key={a.id} className="card" style={{ marginBottom: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <strong>{providerLabel(a.provider)}</strong>
                      {a.status && <StatusBadge status={a.status} />}
                    </div>
                    <p className="muted" style={{ margin: '6px 0' }}>
                      {a.provider === 'DANA' ? (a.phone_masked ?? '-') : (a.account_masked ?? '-')}
                      {a.label ? ` · ${a.label}` : ''}
                    </p>
                    <p className="stat-value" style={{ fontSize: 19 }}>
                      {a.balance_cents !== undefined && a.balance_cents !== null
                        ? formatRupiah(a.balance_cents / 100)
                        : '—'}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card
            title="Mutasi"
            kicker="Aktivitas"
            subtitle="Saring lalu export ke CSV untuk rekonsiliasi."
            actions={
              <>
                <Button variant="outline" onClick={() => setShowFilters((v) => !v)}>
                  Filter{activeFilters.length > 0 ? ` (${activeFilters.length})` : ''}
                </Button>
                <Button variant="outline" onClick={load}>Refresh</Button>
                <Button variant="outline" onClick={exportCsv}>Export CSV</Button>
              </>
            }
          >
            {!showFilters && activeFilters.length > 0 && (
              <div className="chip-row">
                {activeFilters.map((f) => (
                  <span key={f.key} className="chip">
                    {f.label}
                    <button type="button" onClick={f.clear} aria-label={`Hapus filter ${f.label}`}>
                      ×
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  className="chip"
                  style={{ background: 'transparent', border: '1px solid var(--line)', color: 'var(--muted)', cursor: 'pointer' }}
                  onClick={resetFilters}
                >
                  Hapus semua
                </button>
              </div>
            )}

            {showFilters && (
              <div className="toolbar">
              <Field label="Dari tanggal">
                <input type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label="Sampai tanggal">
                <input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} />
              </Field>
              <Field label="Nominal min (Rp)">
                <input type="number" min={0} value={minAmount} onChange={(e) => setMinAmount(e.target.value)} placeholder="0" />
              </Field>
              <Field label="Nominal maks (Rp)">
                <input type="number" min={0} value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} placeholder="—" />
              </Field>
              <Field label="Pengirim">
                <input type="text" value={sender} onChange={(e) => setSender(e.target.value)} placeholder="Nama pengirim" />
              </Field>
              <Field label="Tipe">
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="">Semua</option>
                  <option value="CR">Masuk</option>
                  <option value="DB">Keluar</option>
                </select>
              </Field>
              <Button variant="outline" onClick={resetFilters}>Reset</Button>
              </div>
            )}

            {csvNote && (
              <p className="muted" role="status" style={{ margin: '0 0 12px' }}>
                {csvNote}
              </p>
            )}

            {mutasi.length === 0 ? (
              <EmptyState
                title="Belum ada mutasi"
                description="Belum ada mutasi yang cocok dengan filter ini, atau rekening belum terhubung / belum ada mutasi masuk."
                action={
                  <Button href="/member/accounts" variant="outline">
                    Hubungkan Rekening
                  </Button>
                }
              />
            ) : (
              <div className="table-wrap">
                <table className="mobile-card-table">
                  <thead>
                    <tr>
                      <th>Waktu</th>
                      <th>Rekening</th>
                      <th>Pengirim</th>
                      <th>Keterangan</th>
                      <th className="num">Nominal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mutasi.map((m, i) => {
                      const isOut = m.type === 'DB';
                      const amountRp = (m.amount_cents ?? 0) / 100;
                      return (
                        <tr key={i}>
                          <td data-label="Waktu">{formatDateWIB(m.date)}</td>
                          <td data-label="Rekening">{providerLabel(m.provider)}</td>
                          <td data-label="Pengirim">{m.sender ?? '-'}</td>
                          <td data-label="Keterangan">{m.description ?? '-'}</td>
                          <td data-label="Nominal" className={`num ${isOut ? 'neg' : 'pos'}`}>
                            {formatAmount(isOut ? -amountRp : amountRp)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}
