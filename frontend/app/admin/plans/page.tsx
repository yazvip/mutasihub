'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { apiDelete, apiGet, apiPost, apiPut, friendlyError } from '../../../lib/api';
import { formatRupiah, inquirySummaryText, planPriceRupiah } from '../../../lib/format';
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  InfoBanner,
  PageHeading,
  TableSkeleton,
} from '../../../components/ui';

// Kontrak backend (domain.Plan, admin_handlers.go): {id, slug, name,
// price_cents, duration_days, max_accounts, api_delay_minutes,
// notif_interval_minutes, max_devices, callback_enabled, inquiry_enabled,
// inquiry_limit (number | null; null = tanpa batas), is_active}.
// Form menampilkan harga rupiah + menit; payload kirim price_cents (= Rp x100)
// dan field _minutes. PUT backend menerima objek plan penuh incl. is_active
// (handler update memakai pointer field: field yang tidak dikirim tidak
// diubah — karena modal ini selalu mengirim objek penuh, inquiry_limit
// dikirim eksplisit sebagai null bila kosong agar 'tanpa batas' benar-benar
// tersimpan; lihat catatan di submit()).
type Plan = {
  id?: number;
  slug: string;
  name: string;
  price_cents?: number;
  duration_days: number;
  max_accounts: number;
  api_delay_minutes: number;
  notif_interval_minutes: number;
  max_devices: number;
  callback_enabled: boolean;
  inquiry_enabled: boolean;
  inquiry_limit?: number | null;
  is_active?: boolean;
};

// State form: harga dalam rupiah (bukan cents) agar mudah dibaca admin.
// Angka boleh '' (kosong) agar form "Tambah Paket" tidak tampak sudah terisi
// nilai paket lain — nilai contoh tampil sebagai placeholder.
type PlanForm = {
  slug: string;
  name: string;
  price: number | '';
  duration_days: number | '';
  max_accounts: number | '';
  api_delay_minutes: number | '';
  notif_interval_minutes: number | '';
  max_devices: number | '';
  callback_enabled: boolean;
  inquiry_enabled: boolean;
  // Batas hit inquiry/hari: '' = kosong = Tanpa batas (kirim null).
  inquiry_limit: number | '';
  is_active: boolean;
};

const EMPTY: PlanForm = {
  slug: '',
  name: '',
  price: '',
  duration_days: '',
  max_accounts: '',
  api_delay_minutes: '',
  notif_interval_minutes: '',
  max_devices: '',
  callback_enabled: false,
  inquiry_enabled: false,
  inquiry_limit: '',
  is_active: true,
};

export default function AdminPlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<PlanForm>(EMPTY);
  const [editingId, setEditingId] = useState<number | null>(null);
  // v31-C (P2-9): seksi "Lanjutan / Inquiry" tertutup secara default.
  const [advOpen, setAdvOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const d = await apiGet<any>('/api/v1/admin/plans').catch(() => null);
      const list = d
        ? Array.isArray(d)
          ? d
          : d?.plans ?? d?.data ?? []
        : null;
      if (list) {
        setPlans(Array.isArray(list) ? list : []);
      } else {
        // fallback: endpoint publik
        const pub = await apiGet<any>('/api/v1/plans').catch(() => null);
        const pl = pub ? (Array.isArray(pub) ? pub : pub?.plans ?? pub?.data ?? []) : [];
        setPlans(Array.isArray(pl) ? pl : []);
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

  function set<K extends keyof PlanForm>(k: K, v: PlanForm[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function startEdit(p: Plan) {
    setEditingId(p.id ?? null);
    setForm({
      slug: p.slug ?? '',
      name: p.name,
      price: planPriceRupiah(p),
      duration_days: p.duration_days ?? 30,
      max_accounts: p.max_accounts ?? 2,
      api_delay_minutes: p.api_delay_minutes ?? 0,
      notif_interval_minutes: p.notif_interval_minutes ?? 5,
      max_devices: p.max_devices ?? 1,
      callback_enabled: !!p.callback_enabled,
      inquiry_enabled: !!p.inquiry_enabled,
      // 0 adalah nilai sah (tidak ada hit diizinkan) — pakai ?? agar tidak
      // tertelan jadi '' seperti bila memakai ||.
      inquiry_limit: p.inquiry_limit ?? '',
      is_active: p.is_active !== false,
    });
    // v31-C (P2-9): bila paket yang diedit memakai fitur lanjutan, buka
    // seksi "Lanjutan / Inquiry" agar nilainya langsung terlihat.
    setAdvOpen(!!(p.inquiry_enabled || p.callback_enabled || (p.inquiry_limit !== null && p.inquiry_limit !== undefined)));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditingId(null);
    setAdvOpen(false);
    setForm(EMPTY);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    // Validasi batas inquiry sebelum busy: '' = tanpa batas (null);
    // selain itu wajib bilangan bulat >= 0.
    if (
      form.inquiry_limit !== '' &&
      (!Number.isInteger(form.inquiry_limit) || form.inquiry_limit < 0)
    ) {
      setError('Batas inquiry harus bilangan bulat 0 atau lebih, atau dikosongkan untuk tanpa batas.');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        slug: form.slug,
        name: form.name,
        price_cents: Math.round(Number(form.price) * 100),
        duration_days: Number(form.duration_days),
        max_accounts: Number(form.max_accounts),
        api_delay_minutes: Number(form.api_delay_minutes),
        notif_interval_minutes: Number(form.notif_interval_minutes),
        max_devices: Number(form.max_devices),
        callback_enabled: form.callback_enabled,
        inquiry_enabled: form.inquiry_enabled,
        // Selalu dikirim eksplisit (modal ini mengirim objek plan penuh,
        // seperti semua field lain): null = tanpa batas, angka = batas
        // hit/hari. PERHATIAN backend: handler PUT memakai pointer field —
        // JSON null menjadi pointer nil (= 'tidak dikirim') bila field-nya
        // *int, sehingga 'tanpa batas' tidak akan tersimpan; backend harus
        // membedakan null eksplisit (mis. **int / nullable) bila ingin
        // mengosongkan limit yang sudah ada.
        inquiry_limit: form.inquiry_limit === '' ? null : form.inquiry_limit,
        is_active: form.is_active,
      };
      if (editingId !== null && editingId !== undefined) {
        await apiPut(`/api/v1/admin/plans/${editingId}`, payload);
        setNotice('Paket diperbarui.');
      } else {
        await apiPost('/api/v1/admin/plans', payload);
        setNotice('Paket baru dibuat.');
      }
      cancelEdit();
      await load();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function removePlan(id: number) {
    if (!confirm('Hapus paket ini? Member yang memakai paket ini tidak ikut terhapus.')) return;
    try {
      await apiDelete(`/api/v1/admin/plans/${id}`);
      setNotice('Paket dihapus.');
      await load();
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  return (
    <>
      <PageHeading eyebrow="Kuota & harga" title="Kelola Paket" description="Atur harga, masa aktif, kuota, dan layanan yang tersedia pada setiap paket." />
      <ErrorBanner message={error} onClose={() => setError(null)} />
      <InfoBanner message={notice} />

      <Card title={editingId ? 'Ubah Paket' : 'Tambah Paket'}>
        <form onSubmit={submit}>
          {/* v31-C (P2-9): form panjang dibagi dua seksi collapsible —
              "Dasar" selalu terbuka, "Lanjutan / Inquiry" tertutup kecuali
              paket yang diedit memakai fitur lanjutan. */}
          <details className="plan-section" open>
            <summary>
              <span>Dasar</span>
              <span className="plan-section-hint">Nama, harga, masa aktif &amp; rekening</span>
            </summary>
            <div className="form-grid">
            <Field label="Slug" hint="Pengenal unik, mis. starter. Dipakai saat member membuat langganan.">
              <input required value={form.slug} onChange={(e) => set('slug', e.target.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'))} placeholder="mis. starter" />
            </Field>
            <Field label="Nama paket">
              <input required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="mis. Starter" />
            </Field>
            <Field label="Harga (Rp / periode)">
              <input required type="number" min={0} value={form.price} placeholder="350000" onChange={(e) => set('price', e.target.value === '' ? '' : Number(e.target.value))} />
            </Field>
            <Field label="Masa aktif (hari)">
              <input required type="number" min={1} value={form.duration_days} placeholder="30" onChange={(e) => set('duration_days', e.target.value === '' ? '' : Number(e.target.value))} />
            </Field>
            <Field label="Maks. rekening">
              <input required type="number" min={1} value={form.max_accounts} placeholder="2" onChange={(e) => set('max_accounts', e.target.value === '' ? '' : Number(e.target.value))} />
            </Field>
            <div className="field">
              <span className="field-label">Status</span>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, paddingTop: 8 }}>
                <input
                  type="checkbox"
                  style={{ width: 'auto' }}
                  checked={form.is_active}
                  onChange={(e) => set('is_active', e.target.checked)}
                />
                Paket aktif (tampil untuk member)
              </label>
            </div>
            </div>
          </details>
          <details className="plan-section" open={advOpen} onToggle={(e) => setAdvOpen(e.currentTarget.open)}>
            <summary>
              <span>Lanjutan / Inquiry</span>
              <span className="plan-section-hint">Delay API, callback &amp; batas inquiry harian</span>
            </summary>
            <div className="form-grid">
            <Field label="Delay API (menit)" hint="Jeda antar panggilan API Connecta, dalam menit.">
              <input type="number" min={0} value={form.api_delay_minutes} placeholder="0" onChange={(e) => set('api_delay_minutes', e.target.value === '' ? '' : Number(e.target.value))} />
            </Field>
            <Field label="Interval notifikasi (menit)">
              <input type="number" min={0} value={form.notif_interval_minutes} placeholder="5" onChange={(e) => set('notif_interval_minutes', e.target.value === '' ? '' : Number(e.target.value))} />
            </Field>
            <Field label="Maks. device">
              <input type="number" min={1} value={form.max_devices} placeholder="1" onChange={(e) => set('max_devices', e.target.value === '' ? '' : Number(e.target.value))} />
            </Field>
            <div className="field">
              <span className="field-label">Instant Callback</span>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, paddingTop: 8 }}>
                <input
                  type="checkbox"
                  style={{ width: 'auto' }}
                  checked={form.callback_enabled}
                  onChange={(e) => set('callback_enabled', e.target.checked)}
                />
                Aktifkan callback instan untuk paket ini
              </label>
            </div>
            <div className="field">
              <span className="field-label">Inquiry Rekening</span>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, paddingTop: 8 }}>
                <input
                  type="checkbox"
                  style={{ width: 'auto' }}
                  checked={form.inquiry_enabled}
                  onChange={(e) => set('inquiry_enabled', e.target.checked)}
                />
                Member boleh cek nama pemilik rekening bank (SNAP)
              </label>
            </div>
            <Field label="Batas inquiry (hit/hari)" hint="Berlaku bila Inquiry aktif. Kosong = tanpa batas. 0 = tidak ada hit diizinkan.">
              <input
                type="number"
                min={0}
                step={1}
                value={form.inquiry_limit}
                placeholder="Tanpa batas"
                onChange={(e) => set('inquiry_limit', e.target.value === '' ? '' : Number(e.target.value))}
              />
            </Field>
            </div>
          </details>
          <div className="row-actions">
            <Button type="submit" disabled={busy}>
              {busy ? 'Menyimpan…' : editingId ? 'Simpan Perubahan' : 'Buat Paket'}
            </Button>
            {editingId && (
              <Button variant="ghost" onClick={cancelEdit}>Batal</Button>
            )}
          </div>
        </form>
      </Card>

      <Card title="Daftar Paket">
        {loading ? (
          <TableSkeleton rows={4} />
        ) : plans.length === 0 ? (
          <EmptyState title="Belum ada paket" description="Buat paket pertama di atas." />
        ) : (
          <div className="table-wrap">
            <table className="mobile-card-table">
              <thead>
                <tr>
                  <th>Nama</th>
                  <th>Slug</th>
                  <th className="num">Harga</th>
                  <th className="num">Masa Aktif</th>
                  <th className="num">Rekening</th>
                  <th>Callback</th>
                  <th>Inquiry</th>
                  <th>Aktif</th>
                  <th className="sticky-right"></th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id ?? p.slug}>
                    <td data-label="Nama"><strong>{p.name}</strong></td>
                    <td data-label="Slug" className="mono"><span className="tok">{p.slug ?? '-'}</span></td>
                    <td data-label="Harga" className="num"><span className="tok">{formatRupiah(planPriceRupiah(p))}</span></td>
                    <td data-label="Masa Aktif" className="num">{p.duration_days ?? 30} hari</td>
                    <td data-label="Rekening" className="num">{p.max_accounts ?? '-'}</td>
                    <td data-label="Callback">{p.callback_enabled ? 'Ya' : 'Tidak'}</td>
                    <td data-label="Inquiry">{inquirySummaryText(p)}</td>
                    <td data-label="Aktif">{p.is_active === false ? 'Tidak' : 'Ya'}</td>
                    <td data-label="Aksi" className="sticky-right">
                      <div className="row-actions">
                        <Button variant="outline" onClick={() => startEdit(p)}>Ubah</Button>
                        <button type="button" className="link-danger" onClick={() => p.id !== undefined && removePlan(p.id)}>Hapus</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
