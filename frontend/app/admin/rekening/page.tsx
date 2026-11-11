'use client';

// v41: Daftar Rekening admin — redesign premium mengikuti mockup user
// (kartu rekening, bukan tabel): 4 kartu ringkasan (Total Rekening,
// Total Saldo, Status Beku, Menunggu OTP/Sinkron), grid kartu premium
// 2 kolom di desktop / 1 kolom di HP, tiap kartu: tile channel + nomor
// tersamar + ikon salin, pill status, badge provider + label, kotak
// SALDO + TERAKHIR TRANSAKSI, baris MEMBER, baris TERAKHIR SINKRON +
// DITAMBAHKAN, tombol Sinkron (sync manual per rekening) + Detail.
// Modal detail read-only tidak diubah (v40, lolos verifikasi).
// Hanya nomor tersamar yang tampil; kredensial tidak pernah dikirim backend.

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost, friendlyError, isApiError } from '../../../lib/api';
import { formatDateWIB, formatRupiah } from '../../../lib/format';
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  Modal,
  PageHeading,
  Skeleton,
  StatusBadge,
} from '../../../components/ui';
import {
  IconCalendar,
  IconCard,
  IconChevronRight,
  IconClock,
  IconCopy,
  IconRefresh,
  IconShieldCheck,
  IconSnowflake,
  IconWallet,
} from '../../../components/icons';

const PAGE_SIZE = 20;

const CHANNEL: Record<string, { color: string; label: string; initial: string }> = {
  DANA: { color: '#108ee9', label: 'DANA', initial: 'D' },
  BCA: { color: '#005baa', label: 'BCA', initial: 'B' },
};

function channelOf(provider: string) {
  return CHANNEL[(provider || '').toUpperCase()] ?? { color: '#64748b', label: provider || '-', initial: '?' };
}

type LastTx = { date: string | null; amount_cents: number; type: string } | null;

type AccountRow = {
  id: string;
  provider: string;
  label: string;
  masked: string;
  member: { id: string; name: string; email: string };
  balance_cents: number;
  status: string;
  last_synced_at: string | null;
  created_at: string | null;
  authorized_at: string | null;
  last_tx: LastTx;
  tx_count: number;
};

type Summary = {
  total_accounts: number;
  total_balance_cents: number;
  dana_count: number;
  bca_count: number;
  pending_count: number;
  frozen_count: number;
};

type MutationRow = {
  tx_date: string | null;
  type: string;
  amount_cents: number;
  description: string | null;
  sender: string | null;
};

type SyncMsg = { id: string; ok: boolean; text: string };

/** Nomor halaman yang ditampilkan di kontrol pagination (jendela ±2). */
function pageWindow(current: number, last: number | null): number[] {
  const pages = new Set<number>([1, current - 2, current - 1, current, current + 1, current + 2]);
  if (last !== null) pages.add(last);
  return [...pages].filter((p) => p >= 1 && (last === null || p <= last)).sort((a, b) => a - b);
}

function statusPill(status: string) {
  if (status === 'frozen') {
    return (
      <span
        className="badge"
        style={{ background: '#e2e8f0', color: '#475569', border: '1px solid #cbd5e1' }}
      >
        Beku
      </span>
    );
  }
  return <StatusBadge status={status} />;
}

function txAmount(m: { amount_cents: number; type: string }) {
  const abs = formatRupiah(Math.abs(m.amount_cents) / 100);
  if ((m.type || '').toUpperCase() === 'DB') {
    return <span style={{ color: '#dc2626', fontWeight: 600 }}>-{abs}</span>;
  }
  return <span style={{ color: '#047857', fontWeight: 600 }}>+{abs}</span>;
}

const SMALL_LABEL: React.CSSProperties = {
  margin: 0,
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: '#64748b',
};

/** Satu kartu rekening premium (mockup v41). */
function RekeningCard({
  a,
  syncing,
  msg,
  copied,
  onCopy,
  onSync,
  onDetail,
}: {
  a: AccountRow;
  syncing: boolean;
  msg: { ok: boolean; text: string } | null;
  copied: boolean;
  onCopy: () => void;
  onSync: () => void;
  onDetail: () => void;
}) {
  const ch = channelOf(a.provider);
  return (
    <article className="rekening-card">
      {/* Baris atas: tile channel + nomor tersamar + badge | pill status */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', minWidth: 0 }}>
        <span
          aria-hidden="true"
          style={{
            flex: 'none',
            width: 52,
            height: 52,
            borderRadius: 14,
            background: ch.color,
            color: '#fff',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 800,
            fontSize: 20,
          }}
        >
          {ch.initial}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span
              className="mono"
              style={{ fontWeight: 700, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {a.masked || '—'}
            </span>
            <button
              type="button"
              onClick={onCopy}
              title="Salin nomor tersamar"
              aria-label="Salin nomor tersamar"
              style={{
                flex: 'none',
                border: 'none',
                background: 'transparent',
                color: copied ? '#047857' : '#64748b',
                cursor: 'pointer',
                padding: 4,
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              <IconCopy size={15} />
            </button>
            {copied && (
              <span style={{ fontSize: 12, color: '#047857', fontWeight: 600, flex: 'none' }}>Disalin</span>
            )}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, minWidth: 0 }}>
            <span
              style={{
                display: 'inline-block',
                border: `1px solid ${ch.color}`,
                color: ch.color,
                borderRadius: 999,
                padding: '2px 10px',
                fontSize: 12,
                fontWeight: 700,
                flex: 'none',
              }}
            >
              {ch.label}
            </span>
            <span
              className="muted"
              style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {a.label || '—'}
            </span>
          </span>
        </span>
        {statusPill(a.status)}
      </div>

      {/* Kotak saldo + transaksi terakhir */}
      <div
        style={{
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          padding: '14px 16px',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <p style={SMALL_LABEL}>Saldo</p>
          <p className="mono" style={{ margin: '4px 0 0', fontSize: 18, fontWeight: 800 }}>
            {formatRupiah(a.balance_cents / 100)}
          </p>
        </div>
        <div style={{ minWidth: 0, textAlign: 'right' }}>
          <p style={SMALL_LABEL}>Terakhir Transaksi</p>
          {a.last_tx ? (
            <>
              <p style={{ margin: '4px 0 0', fontSize: 13, fontWeight: 600 }}>
                {formatDateWIB(a.last_tx.date, false)}
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 13 }}>
                {txAmount(a.last_tx)} <span className="muted">· {a.tx_count} mutasi</span>
              </p>
            </>
          ) : (
            <p style={{ margin: '4px 0 0', fontSize: 13 }}>
              <span className="muted">↕ — · 0 mutasi</span>
            </p>
          )}
        </div>
      </div>

      {/* Member */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'baseline',
          justifyContent: 'space-between',
          minWidth: 0,
        }}
      >
        <span style={{ ...SMALL_LABEL, flex: 'none' }}>Member</span>
        <span style={{ minWidth: 0, textAlign: 'right' }}>
          <Link href={`/admin/members/${a.member.id}`} style={{ fontWeight: 600, color: 'inherit', fontSize: 14 }}>
            {a.member.name || '—'}
          </Link>
          <span className="mono muted" style={{ display: 'block', fontSize: 12, overflowWrap: 'anywhere' }}>
            {a.member.email}
          </span>
        </span>
      </div>

      {/* Terakhir sinkron + Ditambahkan */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'baseline',
          justifyContent: 'space-between',
          minWidth: 0,
        }}
      >
        <span style={{ minWidth: 0 }}>
          <span style={{ ...SMALL_LABEL, display: 'block' }}>Terakhir Sinkron</span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 4,
              fontSize: 13,
              fontWeight: 600,
              color: a.last_synced_at ? '#047857' : '#94a3b8',
            }}
          >
            <IconRefresh size={13} />
            {a.last_synced_at ? formatDateWIB(a.last_synced_at, false) : '—'}
          </span>
        </span>
        <span style={{ minWidth: 0, textAlign: 'right' }}>
          <span style={{ ...SMALL_LABEL, display: 'block' }}>Ditambahkan</span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 4,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <IconCalendar size={13} />
            {a.created_at ? formatDateWIB(a.created_at, false) : '—'}
          </span>
        </span>
      </div>

      {/* Aksi: Sinkron + Detail */}
      <div
        style={{
          borderTop: '1px solid var(--line, #e2e8f0)',
          paddingTop: 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <Button variant="outline" className="rek-neutral" disabled={syncing} onClick={onSync}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <IconRefresh size={15} />
            {syncing ? 'Menyinkronkan…' : 'Sinkron'}
          </span>
        </Button>
        <Button variant="outline" onClick={onDetail}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            Detail
            <IconChevronRight size={15} />
          </span>
        </Button>
      </div>
      {msg && (
        <p
          style={{ margin: 0, fontSize: 13, color: msg.ok ? '#047857' : '#dc2626' }}
          role={msg.ok ? 'status' : 'alert'}
        >
          {msg.text}
        </p>
      )}
    </article>
  );
}

export default function AdminAccountsPage() {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sort, setSort] = useState('created');
  const [selected, setSelected] = useState<AccountRow | null>(null);
  const [mutations, setMutations] = useState<MutationRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<SyncMsg | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Debounce pencarian supaya tidak request per ketikan.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 400);
    return () => clearTimeout(t);
  }, [query]);

  // Filter + sortir + pagination server-side. `silent` = refresh latar
  // (mis. sesudah sync manual) tanpa menampilkan skeleton penuh.
  const loadAccounts = useCallback(
    (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      const params = new URLSearchParams({ page: String(page), sort });
      if (debouncedQuery) params.set('q', debouncedQuery);
      if (providerFilter) params.set('provider', providerFilter);
      if (statusFilter) params.set('status', statusFilter);
      apiGet<any>(`/api/v1/admin/accounts?${params.toString()}`)
        .then((d) => {
          const list = Array.isArray(d) ? d : d?.accounts ?? [];
          const arr: AccountRow[] = Array.isArray(list) ? list : [];
          setAccounts(arr);
          setTotalCount(typeof d?.total_count === 'number' ? d.total_count : null);
          if (d?.summary) setSummary(d.summary);
          // Bila modal Detail terbuka, segarkan barisnya dari data terbaru.
          setSelected((cur) => (cur ? arr.find((x) => x.id === cur.id) ?? cur : null));
        })
        .catch((err) => setError(friendlyError(err)))
        .finally(() => setLoading(false));
    },
    [page, debouncedQuery, providerFilter, statusFilter, sort],
  );

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const lastPage = totalCount !== null ? Math.max(1, Math.ceil(totalCount / PAGE_SIZE)) : null;
  const hasNext = lastPage !== null ? page < lastPage : accounts.length >= PAGE_SIZE;
  const totalLabel =
    totalCount !== null
      ? `Menampilkan ${accounts.length} dari ${totalCount} rekening`
      : `Menampilkan ${accounts.length} rekening di halaman ini`;
  const filtersActive = query !== '' || providerFilter !== '' || statusFilter !== '' || sort !== 'created';

  function resetToFirstPage() {
    if (page !== 1) setPage(1);
  }

  function clearFilters() {
    setQuery('');
    setProviderFilter('');
    setStatusFilter('');
    setSort('created');
    resetToFirstPage();
  }

  function openDetail(row: AccountRow) {
    setSelected(row);
    setMutations([]);
    setDetailError(null);
    setDetailLoading(true);
    apiGet<any>(`/api/v1/admin/accounts/${row.id}`)
      .then((d) => {
        const muts = Array.isArray(d?.mutations) ? d.mutations : [];
        setMutations(muts);
      })
      .catch((err) => setDetailError(friendlyError(err)))
      .finally(() => setDetailLoading(false));
  }

  function closeDetail() {
    setSelected(null);
    setMutations([]);
    setDetailError(null);
  }

  async function copyMasked(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback bila Clipboard API tidak tersedia (konteks non-HTTPS).
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        /* abaikan — tombol tetap memberi umpan balik visual */
      }
      document.body.removeChild(ta);
    }
    setCopiedId(id);
    window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
  }

  async function syncAccountRow(row: AccountRow) {
    if (syncingId) return;
    setSyncingId(row.id);
    setSyncMsg(null);
    try {
      const d = await apiPost<any>(`/api/v1/admin/accounts/${row.id}/sync`, {});
      const text =
        typeof d?.message === 'string' && d.message ? d.message : 'Sinkronisasi selesai.';
      setSyncMsg({ id: row.id, ok: true, text });
      loadAccounts(true);
    } catch (e) {
      const code =
        isApiError(e) && e.code ? e.code : isApiError(e) ? `HTTP ${e.status}` : 'tak dikenal';
      setSyncMsg({
        id: row.id,
        ok: false,
        text: `Gagal sinkronisasi (${code}): ${friendlyError(e)}`,
      });
    } finally {
      setSyncingId(null);
    }
  }

  const selectedChannel = selected ? channelOf(selected.provider) : null;

  return (
    <>
      <PageHeading
        eyebrow="Rekening terhubung"
        title="Daftar Rekening"
        description="Semua rekening DANA & BCA yang terhubung ke member — saldo, transaksi terakhir, dan status sync. Nomor hanya tampil ter-mask."
      />
      <ErrorBanner message={error} onClose={() => setError(null)} />

      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <div className="stat stat-right">
          <span className="stat-icon icon-slate"><IconWallet /></span>
          <div className="stat-body">
            <p className="stat-label">Total Rekening</p>
            <p className="stat-value">{summary ? summary.total_accounts : '—'}</p>
            <p className="stat-sub">Terdaftar di sistem</p>
          </div>
        </div>
        <div className="stat stat-right">
          <span className="stat-icon"><IconCard /></span>
          <div className="stat-body">
            <p className="stat-label">Total Saldo</p>
            <p
              className="stat-value"
              style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 20, color: '#047857' }}
            >
              {summary ? formatRupiah(summary.total_balance_cents / 100) : '—'}
            </p>
            <p className="stat-sub">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#047857' }}>
                <IconShieldCheck size={12} />
                Real-time
              </span>
            </p>
          </div>
        </div>
        <div className="stat stat-right">
          <span className="stat-icon icon-slate"><IconSnowflake /></span>
          <div className="stat-body">
            <p className="stat-label">Status Beku</p>
            <p className="stat-value">{summary ? summary.frozen_count : '—'}</p>
            <p className="stat-sub">Perlu verifikasi ulang</p>
          </div>
        </div>
        <div className="stat stat-right">
          <span className="stat-icon icon-amber"><IconClock /></span>
          <div className="stat-body">
            <p className="stat-label">Menunggu OTP/Sinkron</p>
            <p className="stat-value" style={{ color: '#b45309' }}>
              {summary ? summary.pending_count : '—'}
            </p>
            <p className="stat-sub" style={{ color: '#b45309' }}>Menunggu koneksi</p>
          </div>
        </div>
      </div>

      <Card>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 10,
            marginBottom: 4,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Daftar Rekening</h3>
          <span
            style={{
              display: 'inline-block',
              background: '#d1fae5',
              color: '#047857',
              border: '1px solid #a7f3d0',
              borderRadius: 999,
              padding: '4px 12px',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {totalCount ?? accounts.length} Rekening
          </span>
        </div>
        <p className="muted" style={{ margin: '0 0 16px', fontSize: 13 }}>
          {totalLabel} · Halaman {page} · {PAGE_SIZE} per halaman
        </p>
        <div style={{ marginBottom: 16 }}>
          <Button variant="outline" onClick={clearFilters}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <IconRefresh size={15} />
              Reset filter
            </span>
          </Button>
        </div>

        <div className="rekening-filters">
          <div className="field-wide">
            <Field label="Cari nomor / nama / email">
              <input
                type="search"
                value={query}
                onChange={(e) => { setQuery(e.target.value); resetToFirstPage(); }}
                placeholder="Cari nomor, nama, atau email…"
              />
            </Field>
          </div>
          <div>
            <Field label="Jenis">
              <select
                value={providerFilter}
                onChange={(e) => { setProviderFilter(e.target.value); resetToFirstPage(); }}
              >
                <option value="">Semua jenis</option>
                <option value="dana">DANA</option>
                <option value="bca">BCA</option>
              </select>
            </Field>
          </div>
          <div>
            <Field label="Status">
              <select
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value); resetToFirstPage(); }}
              >
                <option value="">Semua status</option>
                <option value="active">Aktif</option>
                <option value="pending">Menunggu</option>
                <option value="frozen">Beku</option>
              </select>
            </Field>
          </div>
          <div className="field-wide">
            <Field label="Urutkan">
              <select
                value={sort}
                onChange={(e) => { setSort(e.target.value); resetToFirstPage(); }}
              >
                <option value="created">Terbaru ditambahkan</option>
                <option value="synced">Terakhir sinkron</option>
                <option value="balance">Saldo terbesar</option>
              </select>
            </Field>
          </div>
        </div>

        {loading ? (
          <div className="rekening-grid" aria-label="Memuat rekening">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="rekening-skeleton" />
            ))}
          </div>
        ) : accounts.length === 0 ? (
          <EmptyState
            title={filtersActive ? 'Tidak ada yang cocok' : 'Belum ada rekening'}
            description={
              filtersActive
                ? 'Tidak ada rekening yang cocok dengan filter. Coba kata kunci atau filter lain.'
                : 'Rekening yang dihubungkan member akan muncul di sini.'
            }
            action={
              filtersActive ? (
                <Button variant="outline" onClick={clearFilters}>
                  Hapus semua filter
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="rekening-grid">
            {accounts.map((a) => (
              <RekeningCard
                key={a.id}
                a={a}
                syncing={syncingId === a.id}
                msg={syncMsg && syncMsg.id === a.id ? syncMsg : null}
                copied={copiedId === a.id}
                onCopy={() => copyMasked(a.id, a.masked || '')}
                onSync={() => syncAccountRow(a)}
                onDetail={() => openDetail(a)}
              />
            ))}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            alignItems: 'center',
            marginTop: 16,
          }}
        >
          <Button variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            ← Sebelumnya
          </Button>
          {pageWindow(page, lastPage).map((p, i, arr) => (
            <span key={p} style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
              {i > 0 && arr[i - 1] < p - 1 && <span className="muted">…</span>}
              <Button
                variant={p === page ? 'primary' : 'outline'}
                disabled={loading}
                onClick={() => setPage(p)}
              >
                {p}
              </Button>
            </span>
          ))}
          <Button
            variant="outline"
            disabled={!hasNext || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            Berikutnya →
          </Button>
          <span className="muted" style={{ fontSize: 13, marginLeft: 4 }}>
            {totalCount !== null
              ? `Total ${totalCount} rekening`
              : !hasNext && accounts.length < PAGE_SIZE
                ? 'Ini halaman terakhir'
                : 'Ada kemungkinan halaman berikutnya'}
          </span>
        </div>
      </Card>

      {selected && selectedChannel && (
        <Modal
          title={`Rekening ${selected.masked || '—'}`}
          subtitle={`${selectedChannel.label}${selected.label ? ` · ${selected.label}` : ''}`}
          onClose={closeDetail}
          topStripColor={selectedChannel.color}
        >
          <div style={{ display: 'grid', gap: 16 }}>
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid var(--border, #e2e8f0)',
                borderRadius: 12,
                padding: '14px 16px',
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
              }}
            >
              <div>
                <p className="muted" style={{ margin: 0, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
                  Saldo saat ini
                </p>
                <p className="mono" style={{ margin: '4px 0 0', fontSize: 28, fontWeight: 800, lineHeight: 1.1 }}>
                  {formatRupiah(selected.balance_cents / 100)}
                </p>
              </div>
              {statusPill(selected.status)}
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '12px 20px',
              }}
            >
              <div>
                <p className="muted" style={{ margin: 0, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Member</p>
                <p style={{ margin: '4px 0 0', fontSize: 14 }}>
                  <Link href={`/admin/members/${selected.member.id}`} style={{ fontWeight: 600, color: 'inherit' }}>
                    {selected.member.name || '—'}
                  </Link>
                  <span className="muted" style={{ display: 'block', fontSize: 13 }}>{selected.member.email}</span>
                </p>
              </div>
              <div>
                <p className="muted" style={{ margin: 0, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Jenis</p>
                <p style={{ margin: '4px 0 0', fontSize: 14 }}>{selectedChannel.label}</p>
              </div>
              <div>
                <p className="muted" style={{ margin: 0, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Ditambahkan</p>
                <p style={{ margin: '4px 0 0', fontSize: 14 }}>
                  {selected.created_at ? formatDateWIB(selected.created_at, false) : '—'}
                </p>
              </div>
              <div>
                <p className="muted" style={{ margin: 0, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Diotorisasi</p>
                <p style={{ margin: '4px 0 0', fontSize: 14 }}>
                  {selected.authorized_at ? formatDateWIB(selected.authorized_at, false) : 'Belum diotorisasi'}
                </p>
              </div>
              <div>
                <p className="muted" style={{ margin: 0, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Terakhir sinkron</p>
                <p style={{ margin: '4px 0 0', fontSize: 14 }}>
                  {selected.last_synced_at ? formatDateWIB(selected.last_synced_at, true) : 'Belum pernah'}
                </p>
              </div>
              <div>
                <p className="muted" style={{ margin: 0, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total mutasi</p>
                <p style={{ margin: '4px 0 0', fontSize: 14 }}>{selected.tx_count} transaksi</p>
              </div>
            </div>

            <div>
              <p className="muted" style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Riwayat transaksi terakhir
              </p>
              {detailLoading ? (
                <p className="muted" style={{ margin: 0, fontSize: 14 }}>Memuat riwayat…</p>
              ) : detailError ? (
                <p style={{ margin: 0, fontSize: 14, color: '#dc2626' }}>{detailError}</p>
              ) : mutations.length === 0 ? (
                <p className="muted" style={{ margin: 0, fontSize: 14 }}>Belum ada mutasi tersinkron untuk rekening ini.</p>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {mutations.map((m, i) => (
                    <div
                      key={`${m.tx_date ?? ''}-${i}`}
                      style={{
                        display: 'flex',
                        gap: 12,
                        alignItems: 'baseline',
                        justifyContent: 'space-between',
                        borderBottom: '1px solid var(--border, #e2e8f0)',
                        paddingBottom: 8,
                      }}
                    >
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {m.sender || m.description || '—'}
                        </span>
                        <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                          {m.tx_date ? formatDateWIB(m.tx_date, true) : '—'}
                          {m.description && m.sender ? ` · ${m.description}` : ''}
                        </span>
                      </span>
                      <span className="mono" style={{ flex: 'none', fontSize: 14 }}>{txAmount(m)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
