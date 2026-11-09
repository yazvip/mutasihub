// v32 Fintech Polish
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

  // Selected mutation for Drawer
  const [selectedMutasi, setSelectedMutasi] = useState<Mutasi | null>(null);
  const [copied, setCopied] = useState(false);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [sender, setSender] = useState('');
  const [type, setType] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
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
        setPlanExpired(
          dash.plan_expired === true ||
            (dash.plan == null && dash.plan_expires_at != null)
        );
      }
      if (acc) {
        const list = Array.isArray(acc) ? acc : acc?.accounts ?? acc?.data ?? [];
        const arr: Account[] = Array.isArray(list) ? list : [];
        setAccounts(arr);
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

  useEffect(() => {
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

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

  function handleCopy(text: string) {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

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
        } catch {}
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
  const hasAccounts = accounts.length > 0;
  const hasMutations = totalMutations > 0;

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
          {/* Onboarding Checklist */}
          {(!hasAccounts || !hasMutations) && (
            <div className="onboarding-banner">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#fff' }}>
                    Langkah Memulai Integrasi
                  </h3>
                  <p style={{ margin: '4px 0 0', fontSize: 13, opacity: 0.9 }}>
                    Selesaikan langkah berikut agar transaksi dan mutasi rekening Anda otomatis terpantau.
                  </p>
                </div>
              </div>
              <div className="onboarding-grid">
                <div className="onboarding-step done">
                  <span className="check-icon">✓</span>
                  <span>1. Buat Akun Member</span>
                </div>
                <div className={`onboarding-step ${hasAccounts ? 'done' : ''}`}>
                  <span className="check-icon">{hasAccounts ? '✓' : '2'}</span>
                  <Link href="/member/accounts" style={{ color: 'inherit', textDecoration: 'underline' }}>
                    {hasAccounts ? 'Rekening Terhubung' : 'Hubungkan Rekening'}
                  </Link>
                </div>
                <div className={`onboarding-step ${hasMutations ? 'done' : ''}`}>
                  <span className="check-icon">{hasMutations ? '✓' : '3'}</span>
                  <span>{hasMutations ? 'Mutasi Pertama Terekam' : 'Tunggu Mutasi Masuk'}</span>
                </div>
                <div className="onboarding-step">
                  <span className="check-icon">4</span>
                  <Link href="/member/api" style={{ color: 'inherit', textDecoration: 'underline' }}>
                    Ambil API Key
                  </Link>
                </div>
              </div>
            </div>
          )}

          {planExpired && (
            <div className="callout-warn" role="alert">
              <strong>Paket Anda kedaluwarsa.</strong> Perpanjang langganan
              untuk melanjutkan sinkronisasi mutasi.{' '}
              <Link href="/member/subscription">Perpanjang paket →</Link>
            </div>
          )}

          {/* Stat Grid Modern */}
          <div className="stat-grid">
            <div className="stat">
              <span className="stat-icon"><IconChart /></span>
              <div className="stat-body">
                <p className="stat-label">Total Masuk</p>
                <p className="stat-value" style={{ color: '#047857' }}>{formatRupiah(totalIn / 100)}</p>
                <p className="stat-sub">Semua rekening · Kredit</p>
              </div>
            </div>
            <div className="stat">
              <span className="stat-icon icon-blue"><IconCard /></span>
              <div className="stat-body">
                <p className="stat-label">Total Keluar</p>
                <p className="stat-value" style={{ color: '#334155' }}>{formatRupiah(totalOut / 100)}</p>
                <p className="stat-sub">{totalMutations} total mutasi tercatat</p>
              </div>
            </div>
            <div className="stat">
              <span className="stat-icon"><IconWallet /></span>
              <div className="stat-body">
                <p className="stat-label">Rekening Terhubung</p>
                <p className="stat-value">{accounts.length}</p>
                <p className="stat-sub">
                  {activeAccounts} akun aktif
                  {planExpired ? (
                    <>
                      {' · Paket '}
                      <Link href="/member/subscription" style={{ color: 'var(--accent-ink)', fontWeight: 600 }}>
                        Kedaluwarsa
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
                <p className="stat-sub">Auto-sync realtime background</p>
              </div>
            </div>
          </div>

          {/* Bank Cards */}
          <Card 
            title="Saldo Rekening Terhubung" 
            kicker="Portofolio Kas"
            actions={<Button href="/member/accounts" variant="outline">Kelola Rekening</Button>}
          >
            {accounts.length === 0 ? (
              <EmptyState
                title="Belum ada rekening"
                description="Hubungkan nomor HP DANA atau rekening BCA Anda untuk mulai memantau mutasi."
                action={<Button href="/member/accounts">Hubungkan Rekening</Button>}
              />
            ) : (
              <div className="grid-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
                {accounts.map((a) => {
                  const isDana = a.provider === 'DANA';
                  const isBca = a.provider === 'BCA';
                  const cardClass = isDana ? 'bank-card dana-card' : isBca ? 'bank-card bca-card' : 'bank-card';
                  const badgeClass = isDana ? 'bank-badge-dana' : 'bank-badge-bca';
                  const accountNo = isDana ? (a.phone_masked ?? '-') : (a.account_masked ?? '-');

                  return (
                    <div key={a.id} className={cardClass}>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                          <span className={badgeClass}>{a.provider}</span>
                          {a.status && <StatusBadge status={a.status} />}
                        </div>
                        <div style={{ marginBottom: 16 }}>
                          <p style={{ margin: 0, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Nomor Akun {a.label ? `· ${a.label}` : ''}
                          </p>
                          <p style={{ margin: '2px 0 0', fontSize: 15, fontWeight: 700, letterSpacing: '0.02em', color: '#1e293b' }}>
                            {accountNo}
                          </p>
                        </div>
                      </div>
                      <div>
                        <p style={{ margin: 0, fontSize: 11, color: '#94a3b8', textTransform: 'uppercase' }}>Saldo Tersedia</p>
                        <p className="stat-value" style={{ fontSize: 20, margin: '2px 0 0', color: '#0f172a' }}>
                          {a.balance_cents !== undefined && a.balance_cents !== null
                            ? formatRupiah(a.balance_cents / 100)
                            : '—'}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Tabel Mutasi dengan Filter Toolbar & Slide-over Drawer */}
          <Card
            title="Riwayat Mutasi Realtime"
            kicker="Buku Kas"
            subtitle="Klik pada baris transaksi untuk melihat detail lengkap atau rincian payload."
            actions={
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="outline" onClick={() => setShowFilters((v) => !v)}>
                  {showFilters ? 'Tutup Filter' : `Filter${activeFilters.length > 0 ? ` (${activeFilters.length})` : ''}`}
                </Button>
                <Button variant="outline" onClick={load}>Refresh</Button>
                <Button variant="outline" onClick={exportCsv}>Export CSV</Button>
              </div>
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
              <div className="toolbar" style={{ background: '#f8fafc', padding: 16, borderRadius: 12, marginBottom: 16, border: '1px solid #e2e8f0' }}>
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
                    <option value="CR">Masuk (Kredit)</option>
                    <option value="DB">Keluar (Debit)</option>
                  </select>
                </Field>
                <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 2 }}>
                  <Button variant="outline" onClick={resetFilters}>Reset</Button>
                </div>
              </div>
            )}

            {csvNote && (
              <p className="muted" role="status" style={{ margin: '0 0 12px' }}>
                {csvNote}
              </p>
            )}

            {mutasi.length === 0 ? (
              <EmptyState
                title="Belum ada transaksi"
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
                        <tr 
                          key={i} 
                          onClick={() => setSelectedMutasi(m)}
                          title="Klik untuk rincian transaksi"
                        >
                          <td data-label="Waktu" style={{ whiteSpace: 'nowrap', color: '#64748b' }}>
                            {formatDateWIB(m.date)}
                          </td>
                          <td data-label="Rekening">
                            <span style={{ fontWeight: 600 }}>{providerLabel(m.provider)}</span>
                          </td>
                          <td data-label="Pengirim" style={{ fontWeight: 500 }}>
                            {m.sender ?? '-'}
                          </td>
                          <td data-label="Keterangan" style={{ color: '#475569' }}>
                            {m.description ?? '-'}
                          </td>
                          <td data-label="Nominal" className="num">
                            <span className={isOut ? 'amount-pill-neg' : 'amount-pill-pos'}>
                              {formatAmount(isOut ? -amountRp : amountRp)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Slide-over Transaction Detail Drawer */}
          {selectedMutasi && (
            <>
              <div 
                className="drawer-backdrop" 
                onClick={() => setSelectedMutasi(null)} 
                aria-hidden="true" 
              />
              <div className="drawer-panel" role="dialog" aria-modal="true" aria-label="Detail Transaksi">
                <div className="drawer-head">
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Rincian Transaksi</h3>
                  <button 
                    type="button" 
                    onClick={() => setSelectedMutasi(null)}
                    style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#64748b', lineHeight: 1 }}
                    aria-label="Tutup"
                  >
                    ×
                  </button>
                </div>
                <div className="drawer-body">
                  <div style={{ textAlign: 'center', padding: '16px 0 24px', borderBottom: '1px solid #f1f5f9' }}>
                    <span className={selectedMutasi.type === 'DB' ? 'amount-pill-neg' : 'amount-pill-pos'} style={{ fontSize: 20, padding: '6px 14px' }}>
                      {formatAmount(selectedMutasi.type === 'DB' ? -((selectedMutasi.amount_cents ?? 0) / 100) : ((selectedMutasi.amount_cents ?? 0) / 100))}
                    </span>
                    <p style={{ margin: '8px 0 0', fontSize: 12, color: '#64748b' }}>
                      {selectedMutasi.type === 'CR' ? 'Dana Masuk (Kredit)' : 'Dana Keluar (Debit)'}
                    </p>
                  </div>

                  <div className="drawer-row">
                    <span className="label">Bank / Akun</span>
                    <span className="val">{providerLabel(selectedMutasi.provider)}</span>
                  </div>
                  <div className="drawer-row">
                    <span className="label">Waktu Transaksi</span>
                    <span className="val">{formatDateWIB(selectedMutasi.date)}</span>
                  </div>
                  <div className="drawer-row">
                    <span className="label">Pihak Pengirim</span>
                    <span className="val">{selectedMutasi.sender ?? '—'}</span>
                  </div>
                  <div className="drawer-row">
                    <span className="label">Berita / Keterangan</span>
                    <span className="val">{selectedMutasi.description ?? '—'}</span>
                  </div>

                  <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <Button 
                      variant="outline" 
                      onClick={() => handleCopy(
                        `${selectedMutasi.provider} | ${formatAmount((selectedMutasi.amount_cents ?? 0) / 100)} | ${selectedMutasi.sender ?? ''} | ${selectedMutasi.description ?? ''}`
                      )}
                    >
                      {copied ? 'Tersalin ke Clipboard ✓' : 'Salin Info Transaksi'}
                    </Button>
                    <Button variant="ghost" onClick={() => setSelectedMutasi(null)}>
                      Tutup
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
