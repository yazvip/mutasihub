'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { apiGet, apiPost, apiPut, friendlyError } from '../../../../lib/api';
import { formatDateWIB, formatRupiah, planPriceRupiah } from '../../../../lib/format';
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  Loading,
  Modal,
  PageHeading,
  StatusBadge,
} from '../../../../components/ui';
import { IconCard, IconChart, IconKey, IconWallet, IconZap } from '../../../../components/icons';

// Kontrak backend (admin_handlers.go):
// GET /api/v1/admin/members/{id} ->
// {member: {id, email (ter-mask), name, email_verified, status, created_at},
//  subscription: {plan_id, plan_name, status, starts_at, expires_at} | null,
//  accounts: [{id, provider, label, masked, status, last_synced_at, created_at}],
//  stats: {total_mutations, mutations_30d, api_keys},
//  api_keys: [{id, key_prefix, is_active, last_used_at, created_at}]}
// PUT /api/v1/admin/members/{id} {name?, email?, plan_id?, status?} -> {ok, id}
// POST /api/v1/admin/members/{id}/reset-password -> {reset: true,
// temp_password} (v21: sandi sementara acak per reset, tampil sekali ke
// admin, jangan disimpan atau di-hardcode di mana pun)
// Email & nomor rekening member TIDAK PERNAH tampil utuh ke admin.
type MemberDetail = {
  member: {
    id: string;
    email: string;
    name: string;
    email_verified: boolean;
    status: string;
    created_at: string;
  };
  subscription: {
    plan_id: number;
    plan_name: string;
    status: string;
    starts_at: string;
    expires_at: string;
  } | null;
  accounts: {
    id: string;
    provider: string;
    label: string;
    masked: string;
    status: string;
    last_synced_at: string | null;
    created_at: string;
  }[];
  stats: { total_mutations: number; mutations_30d: number; api_keys: number };
  api_keys: {
    id: string;
    key_prefix: string;
    is_active: boolean;
    last_used_at: string | null;
    created_at: string;
  }[];
};

type Plan = {
  id: number;
  name: string;
  price_cents: number;
  duration_days: number;
  is_active?: boolean;
};

export default function AdminMemberDetailPage() {
  const params = useParams();
  const id = String(params.id ?? '');
  const [detail, setDetail] = useState<MemberDetail | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPlan, setEditPlan] = useState('');
  const [editStatus, setEditStatus] = useState('active');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetTemp, setResetTemp] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    apiGet<MemberDetail>(`/api/v1/admin/members/${id}`)
      .then((d) => setDetail(d))
      .catch((err) => setError(friendlyError(err)))
      .finally(() => setLoading(false));
  }

  useEffect(load, [id]);

  useEffect(() => {
    apiGet<any>('/api/v1/admin/plans')
      .then((d) => {
        const list = Array.isArray(d) ? d : d?.plans ?? d?.data ?? [];
        setPlans(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        // dropdown paket kosong bila gagal — edit nama/status tetap jalan
      });
  }, []);

  function openEdit() {
    if (!detail) return;
    setEditName(detail.member.name);
    setEditEmail('');
    setEditPlan('');
    setEditStatus(detail.member.status === 'disabled' ? 'disabled' : 'active');
    setEditError(null);
    setEditOpen(true);
  }

  async function submitEdit(e: FormEvent) {
    e.preventDefault();
    if (!detail) return;
    setEditBusy(true);
    setEditError(null);
    const body: { name: string; status: string; email?: string; plan_id?: number } = {
      name: editName.trim(),
      status: editStatus,
    };
    if (editEmail.trim() !== '') body.email = editEmail.trim();
    if (editPlan !== '') body.plan_id = Number(editPlan);
    try {
      await apiPut(`/api/v1/admin/members/${id}`, body);
      setEditOpen(false);
      setNotice('Perubahan tersimpan.');
      load();
    } catch (err) {
      setEditError(friendlyError(err));
    } finally {
      setEditBusy(false);
    }
  }

  // v21 — reset kata sandi member ke sandi sementara acak; nilai dari
  // respons API ditampilkan SEKALI di modal ini, lalu dihapus dari state
  // saat modal ditutup. Member wajib ganti saat login berikutnya.
  function closeReset() {
    setResetOpen(false);
    setResetTemp(null);
    setResetError(null);
  }

  async function submitReset() {
    setResetBusy(true);
    setResetError(null);
    try {
      const d = await apiPost<any>(`/api/v1/admin/members/${id}/reset-password`, {});
      setResetTemp(d?.temp_password ?? null);
      setEditOpen(false);
      setNotice('Kata sandi direset. Member wajib ganti kata sandi saat login berikutnya.');
      load();
    } catch (err) {
      setResetError(friendlyError(err));
    } finally {
      setResetBusy(false);
    }
  }

  if (loading) {
    return (
      <>
        <PageHeading eyebrow="Detail member" title="Memuat…" description="" />
        <Loading label="Memuat detail member…" />
      </>
    );
  }

  if (error || !detail) {
    return (
      <>
        <PageHeading eyebrow="Detail member" title="Member" description="" />
        <ErrorBanner message={error ?? 'Member tidak ditemukan.'} onClose={() => setError(null)} />
        <p>
          <Link href="/admin/members" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 32 }}>← Kembali ke daftar member</Link>
        </p>
      </>
    );
  }

  const m = detail.member;
  const sub = detail.subscription;
  // v22 (P2-11): pengaman — backend detail hanya mengembalikan langganan
  // aktif yang BELUM kedaluwarsa, tapi bila status masih "active" dan
  // expires_at sudah lewat, tampilkan "Kedaluwarsa".
  const subExpired =
    !!sub &&
    (sub.status ?? '').toLowerCase() === 'active' &&
    !!sub.expires_at &&
    !Number.isNaN(new Date(sub.expires_at).getTime()) &&
    new Date(sub.expires_at).getTime() <= Date.now();
  const subStatusLabel = sub ? (subExpired ? 'expired' : sub.status) : null;
  const activePlans = plans.filter((p) => p.is_active !== false);
  const selectedPlan = activePlans.find((p) => p.id === Number(editPlan));

  return (
    <>
      <p style={{ marginBottom: 4 }}>
        <Link href="/admin/members" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 32 }}>← Daftar member</Link>
      </p>
      <PageHeading
        eyebrow="Detail member"
        title={m.name || '(tanpa nama)'}
        description={`${m.email} · Member sejak ${formatDateWIB(m.created_at, false)}`}
      />
      <ErrorBanner message={error} onClose={() => setError(null)} />
      {notice && (
        <p style={{ color: 'var(--accent-ink)', fontWeight: 600, margin: '0 0 12px' }}>{notice}</p>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        <StatusBadge status={m.status} />
        <StatusBadge status={m.email_verified ? 'Terverifikasi' : 'Belum verifikasi'} />
        {sub && <StatusBadge status={sub.plan_name} />}
        {subExpired && <StatusBadge status="expired" />}
      </div>

      <div className="stat-grid">
        <div className="stat">
          <span className="stat-icon"><IconCard /></span>
          <div className="stat-body">
            <p className="stat-label">Paket aktif</p>
            <p className="stat-value" style={{ fontSize: 18 }}>{subExpired ? 'Kedaluwarsa' : sub?.plan_name ?? '—'}</p>
            <p className="stat-sub">
              {sub
                ? subExpired
                  ? `Berakhir ${formatDateWIB(sub.expires_at, false)} — perpanjang dari tombol Edit`
                  : `Berlaku s.d. ${formatDateWIB(sub.expires_at, false)}`
                : 'Tidak ada paket aktif'}
            </p>
          </div>
        </div>
        <div className="stat">
          <span className="stat-icon"><IconWallet /></span>
          <div className="stat-body">
            <p className="stat-label">Rekening</p>
            <p className="stat-value">{detail.accounts.length}</p>
            <p className="stat-sub">
              {detail.accounts.filter((a) => a.status === 'active').length} terhubung
            </p>
          </div>
        </div>
        <div className="stat">
          <span className="stat-icon"><IconChart /></span>
          <div className="stat-body">
            <p className="stat-label">Total mutasi</p>
            <p className="stat-value">{detail.stats.total_mutations}</p>
            <p className="stat-sub">Sepanjang waktu</p>
          </div>
        </div>
        <div className="stat">
          <span className="stat-icon icon-blue"><IconZap /></span>
          <div className="stat-body">
            <p className="stat-label">Mutasi 30 hari</p>
            <p className="stat-value">{detail.stats.mutations_30d}</p>
            <p className="stat-sub">30 hari terakhir</p>
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div>
          <Card title="Rekening terhubung" subtitle="Nomor tampil ter-mask. Admin tidak melihat kredensial member.">
            {detail.accounts.length === 0 ? (
              <EmptyState title="Belum ada rekening" description="Member ini belum menghubungkan DANA atau BCA." />
            ) : (
              <div className="table-wrap">
                <table className="mobile-card-table" style={{ minWidth: 0 }}>
                  <thead>
                    <tr>
                      <th>Provider</th>
                      <th>Nomor</th>
                      <th>Status</th>
                      <th>Terakhir sinkron</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.accounts.map((a) => (
                      <tr key={a.id}>
                        <td data-label="Provider">
                          <strong>{a.provider}</strong>
                          {a.label ? <><br /><span className="muted">{a.label}</span></> : null}
                        </td>
                        <td data-label="Nomor">{a.masked || '—'}</td>
                        <td data-label="Status"><StatusBadge status={a.status} /></td>
                        <td data-label="Terakhir sinkron">{formatDateWIB(a.last_synced_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="API Key" subtitle="Hanya prefix yang tampil — secret tidak pernah disimpan utuh.">
            {detail.api_keys.length === 0 ? (
              <EmptyState title="Belum ada API key" description="Member ini belum membuat API key." />
            ) : (
              <div className="table-wrap">
                <table style={{ minWidth: 0 }}>
                  <thead>
                    <tr>
                      <th>Prefix</th>
                      <th>Status</th>
                      <th>Terakhir dipakai</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.api_keys.map((k) => (
                      <tr key={k.id}>
                        <td><code>{k.key_prefix}…</code></td>
                        <td><StatusBadge status={k.is_active ? 'active' : 'inactive'} /></td>
                        <td>{formatDateWIB(k.last_used_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div>
          <Card title="Paket & status" subtitle="Diubah admin dari halaman ini.">
            <dl style={{ margin: 0, display: 'grid', gap: 10, fontSize: 14 }}>
              <div>
                <dt className="muted">Paket aktif</dt>
                <dd style={{ margin: 0, fontWeight: 700 }}>
                  {sub?.plan_name ?? '—'}{' '}
                  {subStatusLabel && <StatusBadge status={subStatusLabel} />}
                </dd>
              </div>
              <div>
                <dt className="muted">Masa berlaku paket</dt>
                <dd style={{ margin: 0 }}>
                  {sub ? `${formatDateWIB(sub.starts_at, false)} — ${formatDateWIB(sub.expires_at, false)}` : '—'}
                </dd>
              </div>
              <div>
                <dt className="muted">Status akun</dt>
                <dd style={{ margin: 0 }}><StatusBadge status={m.status} /></dd>
              </div>
              <div>
                <dt className="muted">Email terverifikasi</dt>
                <dd style={{ margin: 0 }}>{m.email_verified ? 'Ya' : 'Belum'}</dd>
              </div>
              <div>
                <dt className="muted">Member sejak</dt>
                <dd style={{ margin: 0 }}>{formatDateWIB(m.created_at, false)}</dd>
              </div>
            </dl>
            <div className="detail-edit-action" style={{ marginTop: 16 }}>
              <Button onClick={openEdit}>Edit member</Button>
            </div>
            {m.status === 'disabled' && (
              <p className="muted" style={{ marginTop: 12 }}>
                Akun dinonaktifkan: member tidak bisa login (email/Google), sesi dan
                API key-nya ikut mati. Aktifkan kembali dari tombol Edit.
              </p>
            )}
          </Card>
        </div>
      </div>

      {editOpen && (
        <Modal
          title="Edit member"
          subtitle="Ubah nama, paket langganan, atau status akun member ini. Perubahan langsung berlaku."
          onClose={() => setEditOpen(false)}
        >
          <form onSubmit={submitEdit}>
            <ErrorBanner message={editError} onClose={() => setEditError(null)} />
            <Field label="Email saat ini">
              <p className="muted" style={{ margin: 0 }}>{detail.member.email}</p>
            </Field>
            <Field
              label="Email baru"
              hint="Kosongkan bila tidak diganti. Login Google berikutnya memakai email baru; data member tetap di akun yang sama."
            >
              <input
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                placeholder="nama@email-baru.com"
                maxLength={255}
                autoComplete="off"
              />
            </Field>
            <Field label="Nama">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                required
                maxLength={255}
                autoComplete="off"
              />
            </Field>
            <div className="form-grid">
              <Field
                label="Paket langganan"
                hint={
                  selectedPlan
                    ? `${selectedPlan.name} — ${formatRupiah(planPriceRupiah(selectedPlan))} / ${selectedPlan.duration_days} hari. Paket aktif saat ini ditutup dan diganti yang baru.`
                    : 'Biarkan apa adanya untuk tidak mengubah paket.'
                }
              >
                <select value={editPlan} onChange={(e) => setEditPlan(e.target.value)}>
                  <option value="">— Jangan ubah paket —</option>
                  {activePlans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {formatRupiah(planPriceRupiah(p))} / {p.duration_days} hari
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Status akun">
                <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                  <option value="active">Aktif</option>
                  <option value="disabled">Dinonaktifkan</option>
                </select>
              </Field>
            </div>
            {editStatus === 'disabled' && (
              <div className="callout-warn" role="alert">
                <strong>Akun akan dinonaktifkan.</strong> Member tidak bisa login
                (email/Google), sesi yang sedang berjalan ikut mati, dan API key-nya
                berhenti berfungsi.
              </div>
            )}
            <div style={{ borderTop: '1px solid var(--line)', marginTop: 16, paddingTop: 16 }}>
              <p className="muted" style={{ margin: '0 0 8px' }}>
                <strong>Reset kata sandi.</strong> Kata sandi member direset ke
                sandi sementara acak dan member wajib menggantinya saat login
                berikutnya.
              </p>
              <Button variant="danger" onClick={() => { setResetError(null); setResetTemp(null); setResetOpen(true); }} disabled={editBusy}>
                Reset kata sandi
              </Button>
            </div>
            <div className="modal-foot">
              <Button variant="ghost" onClick={() => setEditOpen(false)} disabled={editBusy}>
                Batal
              </Button>
              <Button type="submit" disabled={editBusy}>
                {editBusy ? 'Menyimpan…' : 'Simpan perubahan'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {resetOpen && (
        <Modal
          title={resetTemp ? 'Kata sandi direset' : 'Reset kata sandi member?'}
          subtitle={resetTemp ? undefined : 'Kata sandi member ini akan direset ke sandi sementara acak.'}
          onClose={closeReset}
        >
          <ErrorBanner message={resetError} onClose={() => setResetError(null)} />
          {resetTemp ? (
            <>
              <div className="callout-warn" role="alert">
                <strong>Sandi sementara member:</strong>{' '}
                <code style={{ fontSize: 16 }}>{resetTemp}</code>
                <br />
                Sampaikan sandi ini ke member; sandi ini hanya tampil sekali di
                sini. Member wajib mengganti kata sandi baru saat login berikutnya
                dan tidak bisa memakai fitur member sebelum itu.
              </div>
              <div className="modal-foot">
                <Button onClick={closeReset}>Tutup</Button>
              </div>
            </>
          ) : (
            <>
              <div className="callout-warn" role="alert">
                Member akan mendapat sandi sementara acak yang hanya tampil sekali
                setelah reset. Member wajib mengganti kata sandi baru saat login
                berikutnya dan tidak bisa memakai fitur member sebelum itu.
              </div>
              <div className="modal-foot">
                <Button variant="ghost" onClick={closeReset} disabled={resetBusy}>
                  Batal
                </Button>
                <Button variant="danger" onClick={submitReset} disabled={resetBusy}>
                  {resetBusy ? 'Mereset…' : 'Ya, reset kata sandi'}
                </Button>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
