'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiGet, friendlyError } from '../../../lib/api';
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  StatusBadge,
  PageHeading,
  TableSkeleton,
} from '../../../components/ui';

// Kontrak backend (admin_handlers.go handleAdminListMembers) — DIVERIFIKASI
// di kode v23 (P2-13/P2-11):
// - GET /api/v1/admin/members?page=N&q=&plan=&status= ->
//   {members: [{id, email (ter-mask server), name, email_verified (bool),
//   plan (string — nama paket aktif yang masih berlaku, "" bila tidak ada),
//   accounts (int), plan_expires_at (WIB RFC3339|null — expires_at
//   langganan status='active' terbaru), subscription_status
//   ("active"|"expired"|"none")}], page, total_count}
// - Ukuran halaman TETAP 20 (tidak ada parameter page_size); total_count
//   dihitung dengan filter yang sama seperti query list.
// - Filter server-side (opsional, AND): q = nama ATAU email (LIKE,
//   wildcard di-escape), plan = slug paket langganan aktif yang masih
//   berlaku, status = members.status (active|disabled).
// - Opsi paket untuk filter diambil dari GET /api/v1/admin/plans
//   ({plans: [{slug, name, ...}]}).
const PAGE_SIZE = 20;

type Member = {
  id: string;
  email?: string;
  name?: string;
  email_verified?: boolean;
  plan?: string | null;
  accounts?: number;
  plan_expires_at?: string | null;
  subscription_status?: 'active' | 'expired' | 'none';
};

type PlanOption = { slug: string; name: string };

/** Status diturunkan dari email_verified + plan (backend tak kirim status member di list). */
function memberStatus(m: Member): string {
  if (m.plan) return 'active';
  if (m.email_verified) return 'Terverifikasi';
  return 'Belum verifikasi';
}

/** Nomor halaman yang ditampilkan di kontrol pagination (jendela ±2). */
function pageWindow(current: number, last: number | null): number[] {
  const pages = new Set<number>([1, current - 2, current - 1, current, current + 1, current + 2]);
  if (last !== null) pages.add(last);
  return [...pages].filter((p) => p >= 1 && (last === null || p <= last)).sort((a, b) => a - b);
}

export default function AdminMembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [planOptions, setPlanOptions] = useState<PlanOption[]>([]);

  // Opsi paket untuk filter (sekali saat mount; gagal = dropdown kosong).
  useEffect(() => {
    apiGet<any>('/api/v1/admin/plans')
      .then((d) => {
        const list = Array.isArray(d) ? d : d?.plans ?? [];
        setPlanOptions(
          (Array.isArray(list) ? list : [])
            .filter((p: any) => p?.slug)
            .map((p: any) => ({ slug: String(p.slug), name: String(p.name ?? p.slug) })),
        );
      })
      .catch(() => setPlanOptions([]));
  }, []);

  // Debounce pencarian nama/email supaya tidak request per ketikan.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 400);
    return () => clearTimeout(t);
  }, [query]);

  // Filter + pagination server-side: tiap perubahan filter reset ke halaman 1.
  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page) });
    if (debouncedQuery) params.set('q', debouncedQuery);
    if (planFilter) params.set('plan', planFilter);
    if (statusFilter) params.set('status', statusFilter);
    apiGet<any>(`/api/v1/admin/members?${params.toString()}`)
      .then((d) => {
        const list = Array.isArray(d) ? d : d?.members ?? d?.data ?? [];
        const arr: Member[] = Array.isArray(list) ? list : [];
        setMembers(arr);
        setTotalCount(typeof d?.total_count === 'number' ? d.total_count : null);
      })
      .catch((err) => setError(friendlyError(err)))
      .finally(() => setLoading(false));
  }, [page, debouncedQuery, planFilter, statusFilter]);

  const lastPage = totalCount !== null ? Math.max(1, Math.ceil(totalCount / PAGE_SIZE)) : null;
  const hasNext = lastPage !== null ? page < lastPage : members.length >= PAGE_SIZE;
  const totalLabel =
    totalCount !== null
      ? `Menampilkan ${members.length} dari ${totalCount} member`
      : `Menampilkan ${members.length} member di halaman ini`;
  const filtersActive = query !== '' || planFilter !== '' || statusFilter !== '';

  function resetToFirstPage() {
    if (page !== 1) setPage(1);
  }

  function clearFilters() {
    setQuery('');
    setPlanFilter('');
    setStatusFilter('');
    resetToFirstPage();
  }

  return (
    <>
      <PageHeading eyebrow="Akun pelanggan" title="Member" description="Nomor rekening member hanya tampil ter-mask. Admin tidak melihat kredensial member." />
      <ErrorBanner message={error} onClose={() => setError(null)} />

      <Card
        title="Daftar Member"
        subtitle={`${totalLabel} · Halaman ${page} · ${PAGE_SIZE} per halaman`}
        actions={
          <Button variant="outline" onClick={clearFilters}>
            Reset filter
          </Button>
        }
      >
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <Field label="Cari nama / email">
            <input
              type="search"
              value={query}
              onChange={(e) => { setQuery(e.target.value); resetToFirstPage(); }}
              placeholder="Cari nama / email…"
            />
          </Field>
          <Field label="Paket">
            <select
              value={planFilter}
              onChange={(e) => { setPlanFilter(e.target.value); resetToFirstPage(); }}
            >
              <option value="">Semua paket</option>
              {planOptions.map((p) => (
                <option key={p.slug} value={p.slug}>{p.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); resetToFirstPage(); }}
            >
              <option value="">Semua status</option>
              <option value="active">Aktif</option>
              <option value="disabled">Dinonaktifkan</option>
            </select>
          </Field>
        </div>

        {loading ? (
          <TableSkeleton rows={5} />
        ) : members.length === 0 ? (
          <EmptyState
            title={filtersActive ? 'Tidak ada yang cocok' : 'Belum ada member'}
            description={
              filtersActive
                ? 'Tidak ada member yang cocok dengan filter. Coba kata kunci atau filter lain.'
                : 'Member yang mendaftar akan muncul di sini.'
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
                <col style={{ width: '30%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '14%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Nama</th>
                  <th>Email</th>
                  <th>Paket</th>
                  <th className="num">Rekening</th>
                  <th>Status</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td data-label="Nama"><strong>{m.name ?? '-'}</strong></td>
                    <td data-label="Email">{m.email ?? '-'}</td>
                    <td data-label="Paket">{m.plan ?? '-'}</td>
                    <td data-label="Rekening" className="num">{m.accounts ?? 0}</td>
                    <td data-label="Status">
                      {m.subscription_status === 'expired' ? (
                        <StatusBadge status="expired" />
                      ) : (
                        <StatusBadge status={memberStatus(m)} />
                      )}
                    </td>
                    <td data-label="Aksi">
                      <Link href={`/admin/members/${m.id}`} className="btn btn-outline" style={{ padding: '6px 12px', minHeight: 0 }}>
                        Detail
                      </Link>
                    </td>
                  </tr>
                ))}
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
              ? `Total ${totalCount} member`
              : !hasNext && members.length < PAGE_SIZE
                ? 'Ini halaman terakhir'
                : 'Ada kemungkinan halaman berikutnya'}
          </span>
        </div>
      </Card>
    </>
  );
}
