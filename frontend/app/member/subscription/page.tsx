'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPost, friendlyError, isApiError, type ApiError } from '../../../lib/api';
import { formatDateWIB, formatRupiah, inquiryUsageText, planFeatures, planPriceRupiah, providerLabel, type InquiryUsage } from '../../../lib/format';
import { useSettings } from '../../../lib/settings';
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  InfoBanner,
  Modal,
  StatusBadge,
  PageHeading,
  TableSkeleton,
} from '../../../components/ui';

// Kontrak backend (domain.Plan): {id, slug, name, price_cents,
// duration_days, max_accounts, api_delay_minutes, notif_interval_minutes,
// max_devices, callback_enabled, inquiry_enabled, inquiry_limit
// (number | null; null = tanpa batas), is_active}. Harga tampil =
// price_cents/100. Bullet fitur diturunkan planFeatures() di lib/format.ts
// (sama dengan kartu harga landing) — bukan dari array `features` statis.
// Buat langganan: POST {plan_slug} (member_handlers.go).
type Plan = {
  id?: string | number;
  slug: string;
  name: string;
  price?: number;
  price_cents?: number;
  duration_days?: number;
  max_accounts?: number;
  max_rekening?: number;
  api_delay_minutes?: number;
  notif_interval_minutes?: number;
  callback_enabled?: boolean;
  inquiry_enabled?: boolean;
  inquiry_limit?: number | null;
};

type Subscription = {
  id: string | number;
  plan_slug?: string;
  plan_name?: string;
  status?: string;
  starts_at?: string;
  expires_at?: string;
  created_at?: string;
  amount?: number;
  payment_method?: string;
};

// Fallback statis bila GET /api/v1/plans gagal — disamakan dengan seed
// backend (domain.go); bullet fitur diturunkan planFeatures() dari field
// di bawah (bukan daftar statis — 'Prioritas dukungan' / 'REST API' /
// 'Semua fitur Pro' tidak punya field sehingga tidak ditampilkan).
const FALLBACK_PLANS: Plan[] = [
  { slug: 'trial', name: 'Trial', price: 0, duration_days: 1, max_accounts: 2, api_delay_minutes: 10, notif_interval_minutes: 5, inquiry_enabled: false },
  { slug: 'starter', name: 'Starter', price: 350000, duration_days: 30, max_accounts: 2, api_delay_minutes: 5, notif_interval_minutes: 3, inquiry_enabled: true },
  { slug: 'pro', name: 'Pro', price: 900000, duration_days: 30, max_accounts: 5, api_delay_minutes: 3, notif_interval_minutes: 2, inquiry_enabled: true },
  { slug: 'enterprise', name: 'Enterprise', price: 1800000, duration_days: 30, max_accounts: 5, api_delay_minutes: 0, notif_interval_minutes: 1, callback_enabled: true, inquiry_enabled: true },
];

// v22 (P2-11): status efektif langganan. Backend sudah mengembalikan
// "expired" untuk subscription active yang lewat expires_at — tapi sebagai
// pengaman, status "active" yang expires_at-nya sudah lewat tetap
// ditampilkan "Kedaluwarsa" dari sisi frontend.
function effectiveSubStatus(s: Subscription): string {
  const st = (s.status ?? '').toLowerCase();
  if (st === 'active' && s.expires_at) {
    const t = new Date(s.expires_at).getTime();
    if (!Number.isNaN(t) && t <= Date.now()) return 'expired';
  }
  return s.status ?? '-';
}

// v30: detail 409 active_subscription_exists — dibaca dari ApiError
// (old_plan/new_plan/connected_count/would_freeze, lihat lib/api.ts).
// Fallback lokal dipakai bila backend lama tidak mengirim detailnya.
type ReplaceConflict = {
  plan: Plan;
  oldPlan: { name: string; expires_at?: string; remaining_days?: number } | null;
  newPlan: { name: string; max_accounts?: number; price_cents?: number } | null;
  connectedCount?: number;
  wouldFreeze: { id: string; provider: string; masked?: string; created_at?: string }[];
};

// Sisa hari dari expires_at, bila backend tidak mengirim remaining_days.
function remainingDays(expiresAt?: string): number | null {
  if (!expiresAt) return null;
  const t = new Date(expiresAt).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.ceil((t - Date.now()) / 86400000));
}

export default function MemberSubscriptionPage() {
  const { gobiz_enabled } = useSettings();
  const [plans, setPlans] = useState<Plan[]>(FALLBACK_PLANS);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [active, setActive] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | number | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  // v30: modal konfirmasi ganti paket (409 active_subscription_exists).
  const [conflict, setConflict] = useState<ReplaceConflict | null>(null);
  const [conflictUsage, setConflictUsage] = useState<InquiryUsage | null>(null);
  const [conflictUsageLoading, setConflictUsageLoading] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);

  async function load() {
    try {
      const [p, s] = await Promise.all([
        apiGet<any>('/api/v1/plans').catch(() => null),
        apiGet<any>('/api/v1/subscriptions').catch(() => null),
      ]);
      if (p) {
        const list = Array.isArray(p) ? p : p?.plans ?? p?.data ?? [];
        if (Array.isArray(list) && list.length > 0) setPlans(list);
      }
      if (s) {
        const list = Array.isArray(s) ? s : s?.subscriptions ?? s?.data ?? [];
        const arr = Array.isArray(list) ? list : [];
        setSubs(arr);
        setActive(
          arr.find((x: Subscription) =>
            effectiveSubStatus(x) === 'active' ||
            ['aktif', 'trial'].includes((x.status || '').toLowerCase())
          ) ?? null
        );
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

  // v30: ganti paket selagi paket lama aktif WAJIB konfirmasi dulu.
  // POST pertama tanpa confirm_replace; bila backend menjawab 409
  // active_subscription_exists, buka modal dan JANGAN lanjut bayar.
  // Konfirmasi ("Ya, ganti paket & lanjut bayar") mengulang POST yang sama
  // dengan confirm_replace: true, lalu alur bayar/manual di bawah jalan
  // persis seperti biasa (trial & manual ikut jalur yang sama).
  async function subscribe(plan: Plan, confirmReplace = false) {
    setError(null);
    setNotice(null);
    setQrUrl(null);
    if (!plan.slug) {
      setError('Paket ini tidak punya slug — tidak bisa dibuat langganan.');
      return;
    }
    const priceRp = planPriceRupiah(plan);
    setPayingId(plan.slug);
    try {
      const d = await apiPost<any>('/api/v1/subscriptions', {
        plan_slug: plan.slug,
        ...(confirmReplace ? { confirm_replace: true } : {}),
      });
      const subId = d?.subscription?.id ?? d?.id;
      if (priceRp === 0 || !gobiz_enabled) {
        setNotice(
          priceRp === 0
            ? 'Paket Trial diaktifkan.'
            : 'Pembayaran manual — hubungi admin. Langganan Anda tercatat pending dan diaktifkan setelah pembayaran dikonfirmasi admin.'
        );
        await load();
        return;
      }
      if (subId) {
        const pay = await apiPost<any>(`/api/v1/subscriptions/${subId}/pay-gobiz`, {});
        const qr = pay?.qr_url ?? pay?.qrUrl ?? pay?.data?.qr_url;
        if (qr) {
          setQrUrl(qr);
          setNotice('Scan QRIS di bawah untuk menyelesaikan pembayaran.');
        } else {
          setNotice('Pembayaran dibuat. Lanjutkan pembayaran via tautan dari server.');
        }
      }
      await load();
    } catch (err) {
      if (isApiError(err) && err.status === 409 && err.code === 'active_subscription_exists') {
        await openReplaceConfirm(plan, err);
        return;
      }
      // v21 (P1-5): pembayaran QRIS nonaktif di server — tampilkan pesan
      // backend apa adanya, jangan pesan generik.
      if (isApiError(err) && err.code === 'gobiz_disabled') {
        setError(err.message);
      } else {
        setError(friendlyError(err));
      }
    } finally {
      setPayingId(null);
    }
  }

  // Buka modal konfirmasi dari detail 409 di ApiError. Sisa hit inquiry
  // hari ini diambil saat modal dibuka (GET /api/v1/inquiry/usage);
  // bila gagal dimuat, modal tetap tampil tanpa baris itu.
  async function openReplaceConfirm(plan: Plan, err: ApiError) {
    const oldPlan = err.old_plan ?? (active
      ? { name: active.plan_name ?? activePlan?.name ?? 'Paket lama', expires_at: active.expires_at }
      : null);
    const newPlan = err.new_plan ?? {
      name: plan.name,
      max_accounts: plan.max_accounts ?? plan.max_rekening,
      price_cents: plan.price_cents,
    };
    setConflict({
      plan,
      oldPlan,
      newPlan,
      connectedCount: err.connected_count,
      wouldFreeze: err.would_freeze ?? [],
    });
    setConflictUsage(null);
    setConflictUsageLoading(true);
    try {
      const u = await apiGet<InquiryUsage>('/api/v1/inquiry/usage');
      setConflictUsage(u);
    } catch {
      setConflictUsage(null);
    } finally {
      setConflictUsageLoading(false);
    }
  }

  // "Ya, ganti paket & lanjut bayar": tutup modal, ulangi POST dengan
  // confirm_replace: true — alur bayar/manual selanjutnya sama persis.
  async function confirmReplace() {
    if (!conflict || confirmBusy) return;
    const plan = conflict.plan;
    setConflict(null);
    setConfirmBusy(true);
    try {
      await subscribe(plan, true);
    } finally {
      setConfirmBusy(false);
    }
  }

  const activePlan = active
    ? plans.find((p) => (active.plan_slug && p.slug === active.plan_slug) || p.name === active.plan_name)
    : null;

  return (
    <>
      <PageHeading eyebrow="Kuota & harga" title="Langganan" description="Paket aktif Anda dan pilihan upgrade." />
      <ErrorBanner message={error} onClose={() => setError(null)} />
      <InfoBanner message={notice} />

      {loading ? (
        <TableSkeleton rows={4} />
      ) : (
        <>
          <Card title="Paket Aktif">
            {active ? (
              <div>
                <p style={{ margin: '0 0 4px' }}>
                  <strong style={{ fontSize: 17 }}>
                    {active.plan_name ?? activePlan?.name ?? '—'}
                  </strong>{' '}
                  <StatusBadge status={effectiveSubStatus(active)} />
                </p>
                <p className="muted">
                  Berlaku sampai{' '}
                  {active.expires_at ? formatDateWIB(active.expires_at) : '—'}
                  {' · '}
                  {activePlan ? `${activePlan.max_accounts ?? activePlan.max_rekening ?? '-'} rekening` : ''}
                </p>
              </div>
            ) : (
              <EmptyState
                title="Belum ada paket aktif"
                description="Pilih paket di bawah untuk mulai. Trial gratis 1 hari."
              />
            )}
          </Card>

          {qrUrl && gobiz_enabled && (
            <Card title="Bayar dengan QRIS">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrUrl} alt="QRIS" style={{ maxWidth: 260, display: 'block' }} />
              <p className="muted">Scan dengan aplikasi pembayaran apa pun. Status langganan diperbarui otomatis setelah pembayaran terkonfirmasi.</p>
            </Card>
          )}

          {!gobiz_enabled && (
            <Card title="Pembayaran manual — hubungi admin">
              <p className="muted">
                Pembayaran QRIS sedang <strong>nonaktif</strong>. Untuk
                berlangganan, hubungi admin untuk instruksi pembayaran manual
                (transfer bank) — langganan diaktifkan setelah pembayaran
                dikonfirmasi.
              </p>
            </Card>
          )}

          <h2 style={{ fontSize: 19, margin: '8px 0 16px' }}>Pilih Paket</h2>
          <div className="grid-3">
            {plans.map((p) => {
              const priceRp = planPriceRupiah(p);
              return (
              <Card key={p.slug ?? p.id ?? p.name} title={p.name}>
                <p className="price">
                  {priceRp === 0 ? 'Gratis' : formatRupiah(priceRp)}
                  <small>{priceRp === 0 ? '' : ' /bulan'}</small>
                </p>
                <ul className="plan-list">
                  {planFeatures(p).map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                {/* v31-D (P2-4): paket aktif bukan tombol — badge abu-abu
                    yang jelas tidak bisa diklik. */}
                {activePlan?.slug === p.slug ? (
                  <span
                    className="badge badge-gray"
                    aria-disabled="true"
                    style={{ display: 'block', marginTop: 'auto', padding: '10px 16px', fontSize: 13, textAlign: 'center' }}
                  >
                    ✓ Paket Aktif
                  </span>
                ) : (
                  <Button
                    disabled={payingId === p.slug}
                    onClick={() => subscribe(p)}
                  >
                    {payingId === p.slug
                      ? 'Memproses…'
                      : priceRp === 0
                        ? 'Aktifkan Trial'
                        : 'Pilih Paket'}
                  </Button>
                )}
              </Card>
              );
            })}
          </div>

          <Card title="Riwayat Langganan">
            {subs.length === 0 ? (
              <EmptyState title="Belum ada riwayat langganan" />
            ) : (
              <div className="table-wrap">
                <table className="mobile-card-table">
                  <thead>
                    <tr>
                      <th>Paket</th>
                      <th>Status</th>
                      <th>Mulai</th>
                      <th>Berakhir</th>
                      <th className="num">Nominal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subs.map((s) => (
                      <tr key={s.id}>
                        <td data-label="Paket">{s.plan_name ?? '—'}</td>
                        <td data-label="Status"><StatusBadge status={effectiveSubStatus(s)} /></td>
                        <td data-label="Mulai">{s.starts_at ? formatDateWIB(s.starts_at) : '—'}</td>
                        <td data-label="Berakhir">{s.expires_at ? formatDateWIB(s.expires_at) : '—'}</td>
                        <td data-label="Nominal" className="num">{s.amount !== undefined ? formatRupiah(s.amount) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {conflict && (
        <Modal
          title="Ganti paket?"
          subtitle="Paket lama Anda masih aktif — periksa dulu sebelum diganti."
          onClose={() => setConflict(null)}
        >
          <div style={{ display: 'grid', gap: 14, fontSize: 14, lineHeight: 1.6 }}>
            <div>
              <strong>Paket lama: {conflict.oldPlan?.name ?? '—'}</strong>
              <br />
              <span className="muted">
                Sisa{' '}
                {conflict.oldPlan?.remaining_days ??
                  remainingDays(conflict.oldPlan?.expires_at) ??
                  '—'}{' '}
                hari
                {conflict.oldPlan?.expires_at
                  ? ` · berlaku sampai ${formatDateWIB(conflict.oldPlan.expires_at, false)}`
                  : ''}
              </span>
              <br />
              <span className="muted">
                Sisa hit inquiry hari ini:{' '}
                {conflictUsageLoading
                  ? 'Memuat…'
                  : conflictUsage
                    ? conflictUsage.inquiry_enabled === false
                      ? 'Inquiry tidak aktif di paket lama'
                      : inquiryUsageText(conflictUsage)
                    : 'tidak dapat dimuat'}
              </span>
            </div>
            <div>
              <strong>Paket baru: {conflict.newPlan?.name ?? conflict.plan.name}</strong>
              <br />
              <span className="muted">
                {formatRupiah(
                  conflict.newPlan?.price_cents !== undefined && conflict.newPlan?.price_cents !== null
                    ? conflict.newPlan.price_cents / 100
                    : planPriceRupiah(conflict.plan)
                )}
                {' · '}Masa aktif {conflict.plan.duration_days ?? 30} hari
                {' · '}Maks{' '}
                {conflict.newPlan?.max_accounts ??
                  conflict.plan.max_accounts ??
                  conflict.plan.max_rekening ??
                  '—'}{' '}
                rekening
                {conflict.connectedCount !== undefined
                  ? ` · ${conflict.connectedCount} rekening terhubung saat ini`
                  : ''}
              </span>
            </div>
            <p style={{ margin: 0 }}>
              <strong>Paket lama akan nonaktif dan sisa harinya hangus;</strong>{' '}
              riwayat mutasi dan API key tetap tersimpan.
            </p>
            {conflict.wouldFreeze.length > 0 && (
              <div className="callout-warn" style={{ marginBottom: 0 }}>
                <strong>
                  Rekening yang akan dibekukan sync-nya ({conflict.wouldFreeze.length}):
                </strong>
                <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                  {conflict.wouldFreeze.map((a) => (
                    <li key={a.id}>
                      {providerLabel(a.provider)} — {a.masked ?? a.id}
                    </li>
                  ))}
                </ul>
                <p style={{ margin: '8px 0 0' }}>
                  Rekening ini tetap terdaftar tapi tidak di-sync sampai jumlah
                  rekening ≤ batas atau kamu upgrade.
                </p>
              </div>
            )}
          </div>
          <div className="modal-foot">
            <Button variant="outline" onClick={() => setConflict(null)}>
              Batal
            </Button>
            <Button disabled={confirmBusy} onClick={confirmReplace}>
              {confirmBusy ? 'Memproses…' : 'Ya, ganti paket & lanjut bayar'}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
