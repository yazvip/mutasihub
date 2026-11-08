'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPost, friendlyError } from '../../lib/api';
import { formatDateWIB } from '../../lib/format';
import { IconCard, IconUsers, IconWallet, IconZap } from '../../components/icons';
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  InfoBanner,
  StatusBadge,
  PageHeading,
  StatSkeleton,
  TableSkeleton,
} from '../../components/ui';

// Kontrak backend:
// - GET /api/v1/admin/connecta/quota -> raw JSON Connecta (passthrough):
//   {partner_id, is_demo, subscription_status, subscription_expires_at,
//   dana_bound_count, max_dana_accounts, bca_count, max_bca_accounts, ...}
// - GET /api/v1/admin/members -> {members: [{id, email, name,
//   email_verified, plan, accounts}], page}
// - POST /api/v1/admin/connecta/test -> {docs_ok, quota_ok, docs, quota,
//   docs_error, quota_error}
type Member = {
  id: string;
  email?: string;
  name?: string;
  email_verified?: boolean;
  plan?: string | null;
  accounts?: number;
};

function memberStatus(m: Member): string {
  if (m.plan) return 'active';
  if (m.email_verified) return 'Terverifikasi';
  return 'Belum verifikasi';
}

export default function AdminDashboardPage() {
  const [quota, setQuota] = useState<any>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ docs_ok: boolean; quota_ok: boolean } | null>(null);

  async function load() {
    try {
      const [q, m] = await Promise.all([
        apiGet<any>('/api/v1/admin/connecta/quota').catch(() => null),
        apiGet<any>('/api/v1/admin/members').catch(() => null),
      ]);
      if (q) setQuota(q?.data ?? q?.quota ?? q);
      if (m) {
        const list = Array.isArray(m) ? m : m?.members ?? m?.data ?? [];
        setMembers(Array.isArray(list) ? list : []);
      }
      setError(null);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function testConnecta() {
    setTesting(true);
    setNotice(null);
    try {
      const d = await apiPost<any>('/api/v1/admin/connecta/test', {});
      const docsOk = d?.docs_ok === true;
      const quotaOk = d?.quota_ok === true;
      setTestResult({ docs_ok: docsOk, quota_ok: quotaOk });
      const errs = [d?.docs_error, d?.quota_error].filter(Boolean).join(' ');
      setNotice(
        `Tes koneksi Connecta: docs ${docsOk ? 'OK' : 'GAGAL'} · quota ${quotaOk ? 'OK' : 'GAGAL'}${errs ? ` — ${errs}` : ''}.`
      );
      await load();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setTesting(false);
    }
  }

  const totalAccounts = members.reduce(
    (sum, m) => sum + (Number(m.accounts ?? 0) || 0),
    0
  );
  const activeMembers = members.filter((m) => !!m.plan).length;

  return (
    <>
      <PageHeading eyebrow="Pusat kendali" title="Dashboard" />
      <ErrorBanner message={error} onClose={() => setError(null)} />
      <InfoBanner message={notice} />

      {loading ? (
        <>
          <StatSkeleton />
          <Card title="Memuat…">
            <TableSkeleton rows={4} />
          </Card>
        </>
      ) : (
        <>
          <div className="stat-grid">
            <div className="stat">
              <span className="stat-icon"><IconUsers /></span>
              <div className="stat-body">
                <p className="stat-label">Total Member</p>
                <p className="stat-value">{members.length}</p>
                <p className="stat-sub">{activeMembers} punya paket aktif</p>
              </div>
            </div>
            <div className="stat">
              <span className="stat-icon"><IconWallet /></span>
              <div className="stat-body">
                <p className="stat-label">Total Rekening</p>
                <p className="stat-value">{totalAccounts}</p>
                <p className="stat-sub">DANA {quota?.dana_bound_count ?? 0} · BCA {quota?.bca_count ?? 0}</p>
              </div>
            </div>
            <div className="stat">
              <span className="stat-icon icon-blue"><IconZap /></span>
              <div className="stat-body">
                <p className="stat-label">Akun DANA Terhubung</p>
                <p className="stat-value" style={{ fontSize: 18 }}>
                  {/* v31-C (P2-7): angka 0 eksplisit, bukan "—" telanjang. */}
                  {quota?.dana_bound_count ?? 0}
                  {quota?.max_dana_accounts !== undefined && quota?.max_dana_accounts !== null
                    ? ` / ${quota.max_dana_accounts}`
                    : ''}
                </p>
                <p className="stat-sub">Kuota akun DANA Connecta</p>
              </div>
            </div>
            <div className="stat">
              <span className="stat-icon icon-amber"><IconCard /></span>
              <div className="stat-body">
                <p className="stat-label">Akun BCA Terhubung</p>
                <p className="stat-value" style={{ fontSize: 18 }}>
                  {/* v31-C (P2-7): angka 0 eksplisit, bukan "—" telanjang. */}
                  {quota?.bca_count ?? 0}
                  {quota?.max_bca_accounts !== undefined && quota?.max_bca_accounts !== null
                    ? ` / ${quota.max_bca_accounts}`
                    : ''}
                </p>
                <p className="stat-sub">Kuota akun BCA Connecta</p>
              </div>
            </div>
          </div>

          <Card
            title="Koneksi Connecta"
            kicker="Provider"
            subtitle="Provider mutasi DANA & BCA. Kredensial Connecta dipegang admin di server."
            actions={
              <Button variant="outline" onClick={testConnecta} disabled={testing}>
                {testing ? 'Menguji…' : 'Tes Koneksi'}
              </Button>
            }
          >
            {testResult && (
              <p style={{ marginTop: 0 }}>
                <strong>Hasil tes terakhir:</strong>{' '}
                docs <StatusBadge status={testResult.docs_ok ? 'active' : 'failed'} />{' '}
                quota <StatusBadge status={testResult.quota_ok ? 'active' : 'failed'} />
              </p>
            )}
            {quota ? (
              <div className="table-wrap">
                <table style={{ minWidth: 0 }}>
                  <tbody>
                    <tr>
                      <td><strong>Partner ID</strong></td>
                      <td className="mono">{quota.partner_id ?? '—'}</td>
                    </tr>
                    <tr>
                      <td><strong>Mode demo</strong></td>
                      <td>{quota.is_demo === undefined || quota.is_demo === null ? '—' : quota.is_demo ? 'Ya' : 'Tidak'}</td>
                    </tr>
                    <tr>
                      <td><strong>Status langganan</strong></td>
                      <td>{quota.subscription_status ? <StatusBadge status={quota.subscription_status} /> : '—'}</td>
                    </tr>
                    <tr>
                      <td><strong>Langganan berakhir</strong></td>
                      <td>{quota.subscription_expires_at ? formatDateWIB(quota.subscription_expires_at, false) : '—'}</td>
                    </tr>
                    <tr>
                      <td><strong>DANA terhubung</strong></td>
                      <td>{quota.dana_bound_count ?? '—'}{quota.max_dana_accounts !== undefined && quota.max_dana_accounts !== null ? ` / ${quota.max_dana_accounts}` : ''}</td>
                    </tr>
                    <tr>
                      <td><strong>BCA terhubung</strong></td>
                      <td>{quota.bca_count ?? '—'}{quota.max_bca_accounts !== undefined && quota.max_bca_accounts !== null ? ` / ${quota.max_bca_accounts}` : ''}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title="Belum ada data kuota"
                description="Data kuota Connecta belum berhasil dimuat. Tekan Tes Koneksi untuk mencoba lagi."
                action={
                  <Button variant="outline" onClick={testConnecta} disabled={testing}>
                    {testing ? 'Menguji…' : 'Tes Koneksi'}
                  </Button>
                }
              />
            )}
          </Card>

          <Card title="Member Terbaru" kicker="Akun pelanggan" actions={<Button href="/admin/members" variant="outline">Lihat Semua</Button>}>
            {members.length === 0 ? (
              <EmptyState title="Belum ada member" />
            ) : (
              <div className="table-wrap">
                <table className="mobile-card-table">
                  <thead>
                    <tr>
                      <th>Nama</th>
                      <th>Email</th>
                      <th>Paket</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.slice(0, 5).map((m, i) => (
                      <tr key={m.id ?? i}>
                        <td data-label="Nama">{m.name ?? '-'}</td>
                        <td data-label="Email">{m.email ?? '-'}</td>
                        <td data-label="Paket">{m.plan ?? '-'}</td>
                        <td data-label="Status"><StatusBadge status={memberStatus(m)} /></td>
                      </tr>
                    ))}
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
