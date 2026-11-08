'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { apiGet, friendlyError } from '../../../lib/api';
import { formatDateWIB } from '../../../lib/format';
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  PageHeading,
  TableSkeleton,
} from '../../../components/ui';

// Kontrak backend (admin_handlers.go handleAdminAuditLogs, P2-12):
// GET /api/v1/admin/audit-logs?actor=&action=&page=&page_size=
// -> {audit_logs: [{id, actor_type, actor_id, action, detail, ip,
//   created_at (WIB RFC3339)}], page, page_size, total_count}
// - actor: cocok actor_type persis ATAU actor_id mengandung nilai.
// - action: mengandung nilai. page_size default 20, di luar 1..100 -> 20.
// Detail old -> new sudah dirender backend sebagai teks, mis.
// "nama: 'Lama' -> 'Baru'; paket: 'Trial' -> 'Pro'" — ditampilkan apa
// adanya (mono, wrap) supaya perubahan terbaca.
const PAGE_SIZE = 20;

type AuditLog = {
  id: number | string;
  actor_type?: string;
  actor_id?: string;
  action?: string;
  detail?: string;
  ip?: string;
  created_at?: string;
};

function pageWindow(current: number, last: number): number[] {
  const pages = new Set<number>([1, current - 2, current - 1, current, current + 1, current + 2, last]);
  return [...pages].filter((p) => p >= 1 && p <= last).sort((a, b) => a - b);
}

export default function AdminAuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [appliedActor, setAppliedActor] = useState('');
  const [appliedAction, setAppliedAction] = useState('');

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(PAGE_SIZE),
    });
    if (appliedActor) params.set('actor', appliedActor);
    if (appliedAction) params.set('action', appliedAction);
    apiGet<any>(`/api/v1/admin/audit-logs?${params.toString()}`)
      .then((d) => {
        const list = Array.isArray(d) ? d : d?.audit_logs ?? d?.data ?? [];
        setLogs(Array.isArray(list) ? list : []);
        setTotalCount(Number(d?.total_count) || 0);
      })
      .catch((err) => setError(friendlyError(err)))
      .finally(() => setLoading(false));
  }, [page, appliedActor, appliedAction]);

  function submitFilter(e: FormEvent) {
    e.preventDefault();
    setAppliedActor(actor.trim());
    setAppliedAction(action.trim());
    setPage(1);
  }

  function resetFilter() {
    setActor('');
    setAction('');
    setAppliedActor('');
    setAppliedAction('');
    setPage(1);
  }

  const lastPage = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const filtersActive = appliedActor !== '' || appliedAction !== '';

  return (
    <>
      <PageHeading
        eyebrow="Jejak aktivitas"
        title="Audit Log"
        description="Semua perubahan penting yang dilakukan admin dan member — ganti paket, edit member, reset kata sandi, login 2FA — beserta siapa, kapan, dan dari IP mana."
      />
      <ErrorBanner message={error} onClose={() => setError(null)} />

      <Card
        title="Riwayat Audit"
        subtitle={`${totalCount} entri · Halaman ${page} dari ${lastPage} · ${PAGE_SIZE} per halaman`}
      >
        <form onSubmit={submitFilter} style={{ marginBottom: 12 }}>
          <div className="toolbar">
            <Field label="Aktor" hint="Tipe aktor (admin/member) atau sebagian ID/email aktor.">
              <input
                type="search"
                value={actor}
                onChange={(e) => setActor(e.target.value)}
                placeholder="admin / member / email…"
              />
            </Field>
            <Field label="Aksi" hint="Sebagian nama aksi, mis. member_update.">
              <input
                type="search"
                value={action}
                onChange={(e) => setAction(e.target.value)}
                placeholder="member_update, plan_update…"
              />
            </Field>
            <Button type="submit" disabled={loading}>
              Terapkan filter
            </Button>
            {filtersActive && (
              <Button type="button" variant="outline" onClick={resetFilter}>
                Hapus filter
              </Button>
            )}
          </div>
        </form>

        {loading ? (
          <TableSkeleton rows={5} />
        ) : logs.length === 0 ? (
          <EmptyState
            title={filtersActive ? 'Tidak ada yang cocok' : 'Belum ada audit log'}
            description={
              filtersActive
                ? 'Tidak ada entri audit yang cocok dengan filter ini. Coba kata kunci lain.'
                : 'Aktivitas admin dan member akan tercatat di sini.'
            }
            action={
              filtersActive ? (
                <Button variant="outline" onClick={resetFilter}>
                  Hapus semua filter
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="mobile-card-table">
              <thead>
                <tr>
                  <th>Waktu (WIB)</th>
                  <th>Aktor</th>
                  <th>Aksi</th>
                  <th>Detail</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={String(l.id)}>
                    <td data-label="Waktu (WIB)" style={{ whiteSpace: 'nowrap' }}>
                      {l.created_at ? formatDateWIB(l.created_at) : '-'}
                    </td>
                    <td data-label="Aktor">
                      <strong>{l.actor_type ?? '-'}</strong>
                      <br />
                      <span className="muted mono" style={{ fontSize: 12 }} title={l.actor_id ?? undefined}>
                        {l.actor_id ? l.actor_id.slice(0, 8) : '-'}
                      </span>
                    </td>
                    <td data-label="Aksi"><code>{l.action ?? '-'}</code></td>
                    <td
                      data-label="Detail"
                      className="mono"
                      style={{ fontSize: 13, wordBreak: 'break-word', minWidth: 220 }}
                    >
                      {l.detail || '-'}
                    </td>
                    <td data-label="IP" className="mono">{l.ip || '-'}</td>
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
            disabled={page >= lastPage || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            Berikutnya →
          </Button>
          <span className="muted" style={{ fontSize: 13, marginLeft: 4 }}>
            Total {totalCount} entri
          </span>
        </div>
      </Card>
    </>
  );
}
