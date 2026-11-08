'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { apiGet, apiPost, apiPut, friendlyError } from '../../../lib/api';
import { parseGobizEnabled } from '../../../lib/settings';
import {
  Button,
  Card,
  ErrorBanner,
  Field,
  InfoBanner,
  PageHeading,
  StatusBadge,
  TableSkeleton,
} from '../../../components/ui';

type SettingsForm = {
  site_name: string;
  tagline: string;
  logo_url: string;
  accent_color: string;
  gobiz_enabled: boolean;
  connecta_base_url: string;
};

const DEFAULTS: SettingsForm = {
  site_name: 'MutasiHub',
  tagline: 'Cek Mutasi DANA & BCA Realtime untuk Bisnis Modern',
  logo_url: '',
  accent_color: '#14532d',
  gobiz_enabled: true,
  connecta_base_url: '',
};

function maskUrl(url: string): string {
  if (!url) return '— belum diatur —';
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/…`;
  } catch {
    return url.length > 24 ? url.slice(0, 24) + '…' : url;
  }
}

// v31-C (P1-8a): field hex hanya menerima # + maks 6 digit hex, agar nilai
// yang disimpan selalu valid untuk <input type="color"> dan brand.
function normalizeHex(v: string): string {
  const hex = v.replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
  return hex ? `#${hex}` : '';
}
function isFullHex(v: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(v);
}

export default function AdminSettingsPage() {
  const [form, setForm] = useState<SettingsForm>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  // P2-23: status pendaftaran webhook (GET /api/v1/admin/connecta/webhook).
  // Read-only; secret TIDAK PERNAH dikembalikan backend dan tidak tampil.
  const [webhook, setWebhook] = useState<{
    registered_url: string;
    expected_url: string;
    matches: boolean;
    configured: boolean;
  } | null>(null);
  const [webhookLoading, setWebhookLoading] = useState(true);
  const [webhookError, setWebhookError] = useState<string | null>(null);

  async function loadWebhook() {
    setWebhookLoading(true);
    setWebhookError(null);
    try {
      const d = await apiGet<any>('/api/v1/admin/connecta/webhook');
      setWebhook({
        registered_url: d?.registered_url ?? '',
        expected_url: d?.expected_url ?? '',
        matches: d?.matches === true,
        configured: d?.configured === true,
      });
    } catch (err) {
      setWebhookError(friendlyError(err));
    } finally {
      setWebhookLoading(false);
    }
  }

  useEffect(() => {
    loadWebhook();
  }, []);

  useEffect(() => {
    apiGet<any>('/api/v1/admin/settings')
      .then((d) => {
        const s = d?.settings ?? d?.data ?? d;
        if (s && typeof s === 'object') {
          setForm((f) => ({
            site_name: s.site_name ?? s.siteName ?? f.site_name,
            tagline: s.tagline ?? f.tagline,
            logo_url: s.logo_url ?? s.logoUrl ?? f.logo_url,
            accent_color: s.accent_color ?? s.accentColor ?? f.accent_color,
            // Backend kirim map[string]string: gobiz_enabled bisa '1'/'0'.
            gobiz_enabled: parseGobizEnabled(
              s.gobiz_enabled ?? s.gobizEnabled,
              f.gobiz_enabled,
            ),
            connecta_base_url:
              s.connecta_base_url ?? s.connectaBaseUrl ?? f.connecta_base_url,
          }));
        }
      })
      .catch((err) => setError(friendlyError(err)))
      .finally(() => setLoading(false));
  }, []);

  function set<K extends keyof SettingsForm>(k: K, v: SettingsForm[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    // v31-C (P1-8a): jangan simpan warna aksen yang bukan hex valid —
    // nilai rusak akan merusak brand di semua halaman.
    if (!isFullHex(form.accent_color)) {
      setError('Warna aksen harus format hex 6 digit, mis. #047857.');
      return;
    }
    setBusy(true);
    try {
      // Backend: PUT /api/v1/admin/settings, decode map[string]string —
      // gobiz_enabled wajib string "1"/"0". Route POST tidak ada.
      const payload = {
        site_name: form.site_name,
        tagline: form.tagline,
        logo_url: form.logo_url,
        accent_color: form.accent_color,
        gobiz_enabled: form.gobiz_enabled ? '1' : '0',
      };
      await apiPut('/api/v1/admin/settings', payload);
      setNotice('Pengaturan disimpan. Brand di seluruh halaman ikut berubah.');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function testConnecta() {
    setTesting(true);
    setNotice(null);
    try {
      const d = await apiPost<any>('/api/v1/admin/connecta/test', {});
      const docsOk = d?.docs_ok === true;
      const quotaOk = d?.quota_ok === true;
      const errs = [d?.docs_error, d?.quota_error].filter(Boolean).join(' ');
      setNotice(
        `Tes koneksi Connecta: docs ${docsOk ? 'OK' : 'GAGAL'} · quota ${quotaOk ? 'OK' : 'GAGAL'}${errs ? ` — ${errs}` : ''}.`
      );
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setTesting(false);
    }
  }

  return (
    <>
      <PageHeading eyebrow="Operasional platform" title="Pengaturan" description="Kelola nama situs, pembayaran, dan koneksi provider." />
      <ErrorBanner message={error} onClose={() => setError(null)} />
      <InfoBanner message={notice} />

      {loading ? (
        <TableSkeleton rows={4} />
      ) : (
        <form onSubmit={submit}>
          <Card title="Brand" subtitle="Nama, tagline, logo, dan warna aksen dipakai di seluruh halaman.">
            <div className="form-grid">
              <Field label="Nama situs (site_name)">
                <input required value={form.site_name} onChange={(e) => set('site_name', e.target.value)} />
              </Field>
              <Field label="Tagline">
                <input value={form.tagline} onChange={(e) => set('tagline', e.target.value)} />
              </Field>
              <Field label="URL logo" hint="Kosongkan untuk memakai huruf awal nama situs.">
                <input type="url" value={form.logo_url} onChange={(e) => set('logo_url', e.target.value)} placeholder="https://…" />
              </Field>
              {/* v31-C (P1-8a): swatch kecil 48x48 + field teks hex,
                  menggantikan <input type="color"> selebar field. */}
              <Field label="Warna aksen">
                <div className="accent-picker">
                  <input
                    type="color"
                    aria-label="Pilih warna aksen"
                    value={isFullHex(form.accent_color) ? form.accent_color : '#047857'}
                    onChange={(e) => set('accent_color', e.target.value)}
                  />
                  <input
                    type="text"
                    value={form.accent_color}
                    onChange={(e) => set('accent_color', normalizeHex(e.target.value))}
                    placeholder="#047857"
                    maxLength={7}
                    spellCheck={false}
                    autoComplete="off"
                  />
                </div>
              </Field>
            </div>
          </Card>

          <Card title="Pembayaran Langganan" subtitle="QRIS Gobiz untuk pembayaran paket member.">
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={form.gobiz_enabled}
                onChange={(e) => set('gobiz_enabled', e.target.checked)}
              />
              Aktifkan pembayaran Gobiz (QRIS)
            </label>
            <p className="muted" style={{ marginTop: 8 }}>
              Bila dimatikan, tombol bayar di halaman langganan member menampilkan
              instruksi pembayaran manual.
            </p>
          </Card>

          <Card
            title="Connecta"
            subtitle="Provider mutasi DANA & BCA. Base URL ditampilkan ter-mask; API key Connecta hanya di server, tidak pernah tampil di sini."
            actions={
              <Button variant="outline" onClick={testConnecta} disabled={testing}>
                {testing ? 'Menguji…' : 'Tes Koneksi'}
              </Button>
            }
          >
            <p style={{ margin: 0 }}>
              <strong>Base URL:</strong>{' '}
              <span className="mono">{maskUrl(form.connecta_base_url)}</span>
            </p>
            <p className="muted">
              Perubahan base URL / API key Connecta dilakukan lewat konfigurasi
              server, bukan dari panel ini.
            </p>
          </Card>

          {/* v31-C (P2-10): kartu webhook masuk ke dalam <form> agar tombol
              Simpan bisa duduk di akhir form, setelah semua kartu. */}
          <Card
        title="Pendaftaran Webhook"
        subtitle="Apakah URL webhook mutasi sudah terdaftar di penyedia dan cocok dengan URL yang diharapkan."
        actions={
          <Button variant="outline" onClick={loadWebhook} disabled={webhookLoading}>
            {webhookLoading ? 'Memeriksa…' : 'Periksa ulang'}
          </Button>
        }
      >
        {webhookLoading ? (
          <TableSkeleton rows={2} />
        ) : webhookError ? (
          <p style={{ margin: 0 }}>
            <strong>Tidak bisa memeriksa pendaftaran webhook:</strong> {webhookError}
            {/* v31-C (P2-10): "coba lagi nanti" hanya sekali — pesan backend
                sudah mengandung frasa itu, jadi tambahkan hanya bila belum ada. */}
            {/coba lagi nanti/i.test(webhookError) ? '' : ' — coba lagi nanti.'}
          </p>
        ) : webhook ? (
          <dl style={{ margin: 0, display: 'grid', gap: 10, fontSize: 14 }}>
            <div>
              <dt className="muted">URL terdaftar di penyedia</dt>
              <dd className="mono" style={{ margin: 0, wordBreak: 'break-all' }}>
                {webhook.registered_url || '— belum ada yang terdaftar —'}
              </dd>
            </div>
            <div>
              <dt className="muted">URL yang diharapkan</dt>
              <dd className="mono" style={{ margin: 0, wordBreak: 'break-all' }}>
                {webhook.expected_url || '—'}
              </dd>
            </div>
            <div>
              <dt className="muted">Status pencocokan</dt>
              <dd style={{ margin: 0 }}>
                <StatusBadge status={webhook.matches ? 'active' : 'failed'} />{' '}
                {webhook.matches
                  ? 'URL terdaftar cocok.'
                  : 'URL terdaftar tidak cocok atau belum terdaftar — mutasi realtime dari penyedia tidak akan masuk.'}
              </dd>
            </div>
            <div>
              <dt className="muted">Secret webhook terkonfigurasi</dt>
              <dd style={{ margin: 0 }}>
                {webhook.configured
                  ? 'Ya — secret tersimpan di server (nilainya tidak pernah ditampilkan).'
                  : 'Tidak — secret belum diatur di konfigurasi server.'}
              </dd>
            </div>
          </dl>
        ) : null}
      </Card>

          {/* v31-C (P2-10): Simpan di akhir form — setelah semua kartu. */}
          <Button type="submit" disabled={busy}>
            {busy ? 'Menyimpan…' : 'Simpan Pengaturan'}
          </Button>
        </form>
      )}
    </>
  );
}
