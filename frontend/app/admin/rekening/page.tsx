'use client';

// v40: Daftar Rekening admin — semua rekening terhubung (DANA/BCA) dengan
// member, saldo, transaksi terakhir, status (termasuk "Beku" bila sync
// dijeda), filter + sortir + pagination, dan modal detail (read-only).
// Hanya nomor tersamar yang tampil; kredensial tidak pernah dikirim backend.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiGet, friendlyError } from '../../../lib/api';
import { formatDateWIB, formatRupiah } from '../../../lib/format';
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  Modal,
  PageHeading,
  StatusBadge,
  TableSkeleton,
} from '../../../components/ui';
import { IconCard, IconUsers, IconWallet } from '../../../components/icons';

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
};

type MutationRow = {
  tx_date: string | null;
  type: string;
  amount_cents: number;
  description: string | null;
  sender: string | null;
};

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

  // Debounce pencarian supaya tidak request per ketikan.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 400);
    return () => clearTimeout(t);
  }, [query]);

  // Filter + sortir + pagination server-side.
  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), sort });
    if (debouncedQuery) params.set('q', debouncedQuery);
    if (providerFilter) params.set('provider', providerFilter);
    if (statusFilter) params.set('status', statusFilter);
    apiGet<any>(`/api/v1/admin/accounts?${params.toString()}`)
      .then((d) => {
        const list = Array.isArray(d) ? d : d?.accounts ?? [];
        setAccounts(Array.isArray(list) ? list : []);
        setTotalCount(typeof d?.total_count === 'number' ? d.total_count : null);
        if (d?.summary) setSummary(d.summary);
      })
      .catch((err) => setError(friendlyError(err)))
      .finally(() => setLoading(false));
  }, [page, debouncedQuery, providerFilter, statusFilter, sort]);

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
        <div className="stat">
          <span className="stat-icon"><IconWallet /></span>
          <div className="stat-body">
            <p className="stat-label">Total Rekening</p>
            <p className="stat-value">{summary ? summary.total_accounts : '—'}</p>
            <p className="stat-sub">DANA {summary?.dana_count ?? '—'} · BCA {summary?.bca_count ?? '—'}</p>
          </div>
        </div>
        <div className="stat">
          <span className="stat-icon"><IconCard /></span>
          <div className="stat-body">
            <p className="stat-label">Total Saldo</p>
            <p className="stat-value" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 20 }}>
              {summary ? formatRupiah(summary.total_balance_cents / 100) : '—'}
            </p>
            <p className="stat-sub">Saldo terakhir dari sync</p>
          </div>
        </div>
        <div className="stat">
          <span className="stat-icon" style={{ background: '#e8f3fe' }}>
            <span style={{ color: '#108ee9', fontWeight: 800, fontSize: 16 }}>D</span>
          </span>
          <div className="stat-body">
            <p className="stat-label">Rekening DANA</p>
            <p className="stat-value">{summary ? summary.dana_count : '—'}</p>
            <p className="stat-sub">Dompet digital DANA</p>
          </div>
        </div>
        <div className="stat">
          <span className="stat-icon" style={{ background: '#e8effc' }}>
            <span style={{ color: '#005baa', fontWeight: 800, fontSize: 16 }}>B</span>
          </span>
          <div className="stat-body">
            <p className="stat-label">Rekening BCA</p>
            <p className="stat-value">{summary ? summary.bca_count : '—'}</p>
            <p className="stat-sub">KlikBCA / BCA</p>
          </div>
        </div>
        <div className="stat">
          <span className="stat-icon"><IconUsers /></span>
          <div className="stat-body">
            <p className="stat-label">Menunggu</p>
            <p className="stat-value">{summary ? summary.pending_count : '—'}</p>
            <p className="stat-sub">Rekening belum diotorisasi</p>
          </div>
        </div>
      </div>

      <Card
        title="Daftar Rekening"
        subtitle={`${totalLabel} · Halaman ${page} · ${PAGE_SIZE} per halaman`}
        actions={
          <Button variant="outline" onClick={clearFilters}>
            Reset filter
          </Button>
        }
      >
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <Field label="Cari nomor / nama / email">
            <input
              type="search"
              value={query}
              onChange={(e) => { setQuery(e.target.value); resetToFirstPage(); }}
              placeholder="Cari nomor, nama, atau email…"
            />
          </Field>
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

        {loading ? (
          <TableSkeleton rows={5} />
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
          <div className="table-wrap">
            <table className="table-fixed mobile-card-table">
              <colgroup>
                <col style={{ width: '20%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '16%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '7%' }} />
                <col style={{ width: '5%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Rekening</th>
                  <th>Jenis</th>
                  <th>Member</th>
                  <th className="num">Saldo</th>
                  <th>Terakhir Transaksi</th>
                  <th>Terakhir Sinkron</th>
                  <th>Status</th>
                  <th>Ditambahkan</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const ch = channelOf(a.provider);
                  return (
                    <tr key={a.id}>
                      <td data-label="Rekening">
                        <span style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
                          <span
                            aria-hidden="true"
                            style={{
                              flex: 'none',
                              width: 36,
                              height: 36,
                              borderRadius: 10,
                              background: ch.color,
                              color: '#fff',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: 800,
                              fontSize: 15,
                            }}
                          >
                            {ch.initial}
                          </span>
                          <span style={{ minWidth: 0 }}>
                            <span className="mono" style={{ display: 'block', fontWeight: 600, fontSize: 14 }}>
                              {a.masked || '—'}
                            </span>
                            <span className="muted" style={{ display: 'block', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {a.label || '—'}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td data-label="Jenis">
                        <span
                          style={{
                            display: 'inline-block',
                            border: `1px solid ${ch.color}`,
                            color: ch.color,
                            borderRadius: 999,
                            padding: '2px 10px',
                            fontSize: 12,
                            fontWeight: 700,
                          }}
                        >
                          {ch.label}
                        </span>
                      </td>
                      <td data-label="Member">
                        <Link href={`/admin/members/${a.member.id}`} style={{ fontWeight: 600, color: 'inherit' }}>
                          {a.member.name || '—'}
                        </Link>
                        <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                          {a.member.email}
                        </span>
                      </td>
                      <td data-label="Saldo" className="num mono" style={{ fontWeight: 700 }}>
                        {formatRupiah(a.balance_cents / 100)}
                      </td>
                      <td data-label="Terakhir Transaksi" style={{ whiteSpace: 'normal' }}>
                        {a.last_tx ? (
                          <>
                            <span style={{ display: 'block', fontSize: 13 }}>
                              {formatDateWIB(a.last_tx.date, true)}
                            </span>
                            <span style={{ display: 'block', fontSize: 13 }}>
                              {txAmount(a.last_tx)}{' '}
                              <span className="muted">· {a.tx_count} mutasi</span>
                            </span>
                          </>
                        ) : (
                          <span className="muted" style={{ fontSize: 13 }}>— · 0 mutasi</span>
                        )}
                      </td>
                      <td data-label="Terakhir Sinkron">
                        {a.last_synced_at ? formatDateWIB(a.last_synced_at, true) : '—'}
                      </td>
                      <td data-label="Status">{statusPill(a.status)}</td>
                      <td data-label="Ditambahkan">
                        {a.created_at ? formatDateWIB(a.created_at, false) : '—'}
                      </td>
                      <td data-label="Detail">
                        <Button variant="outline" onClick={() => openDetail(a)} disabled={false}>
                          Detail
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
