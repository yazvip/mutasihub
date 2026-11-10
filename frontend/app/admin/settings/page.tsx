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
  // v37: SMTP (password tidak pernah dikembalikan backend; hanya flag
  // smtp_password_configured).
  smtp_enabled: boolean;
  smtp_host: string;
  smtp_port: string;
  smtp_username: string;
  smtp_password: string;
  smtp_tls_mode: string;
  smtp_from_name: string;
  smtp_from_email: string;
  smtp_password_configured: boolean;
  // v38: provider pengiriman + API key Mailketing (key tidak pernah
  // dikembalikan backend; hanya flag mailketing_api_key_configured).
  mail_provider: string;
  mailketing_api_key: string;
  mailketing_api_key_configured: boolean;
};

const DEFAULTS: SettingsForm = {
  site_name: 'MutasiHub',
  tagline: 'Cek Mutasi DANA & BCA Realtime untuk Bisnis Modern',
  logo_url: '',
  accent_color: '#14532d',
  gobiz_enabled: true,
  connecta_base_url: '',
  smtp_enabled: false,
  smtp_host: '',
  smtp_port: '587',
  smtp_username: '',
  smtp_password: '',
  smtp_tls_mode: 'starttls',
  smtp_from_name: 'MutasiHub',
  smtp_from_email: '',
  smtp_password_configured: false,
  mail_provider: 'smtp',
  mailketing_api_key: '',
  mailketing_api_key_configured: false,
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
  // v37: kirim email tes ke alamat email admin yang login (v38: lewat
  // provider pengiriman yang aktif).
  const [testingEmail, setTestingEmail] = useState(false);

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
            // v37: SMTP — port disimpan string di backend; password
            // tidak pernah dikembalikan (hanya flag configured).
            smtp_enabled:
              s.smtp_enabled === '1' || s.smtp_enabled === true
                ? true
                : s.smtp_enabled === '0' || s.smtp_enabled === false
                  ? false
                  : f.smtp_enabled,
            smtp_host: s.smtp_host ?? f.smtp_host,
            smtp_port: s.smtp_port ? String(s.smtp_port) : f.smtp_port,
            smtp_username: s.smtp_username ?? f.smtp_username,
            smtp_password: '',
            smtp_tls_mode: s.smtp_tls_mode ?? f.smtp_tls_mode,
            smtp_from_name: s.smtp_from_name ?? f.smtp_from_name,
            smtp_from_email: s.smtp_from_email ?? f.smtp_from_email,
            smtp_password_configured:
              s.smtp_password_configured === '1' ||
              s.smtp_password_configured === true,
            // v38: provider pengiriman + API key Mailketing.
            mail_provider: s.mail_provider ?? f.mail_provider,
            mailketing_api_key: '',
            mailketing_api_key_configured:
              s.mailketing_api_key_configured === '1' ||
              s.mailketing_api_key_configured === true,
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
      const payload: Record<string, string> = {
        site_name: form.site_name,
        tagline: form.tagline,
        logo_url: form.logo_url,
        accent_color: form.accent_color,
        gobiz_enabled: form.gobiz_enabled ? '1' : '0',
        // v37: SMTP — password hanya dikirim bila diisi (kosong =
        // pertahankan password lama di server).
        smtp_enabled: form.smtp_enabled ? '1' : '0',
        smtp_host: form.smtp_host,
        smtp_port: form.smtp_port,
        smtp_username: form.smtp_username,
        smtp_tls_mode: form.smtp_tls_mode,
        smtp_from_name: form.smtp_from_name,
        smtp_from_email: form.smtp_from_email,
      };
      if (form.smtp_password) payload.smtp_password = form.smtp_password;
      // v38: provider + API key Mailketing — key hanya dikirim bila
      // diisi (kosong = pertahankan key lama di server).
      payload.mail_provider = form.mail_provider;
      if (form.mailketing_api_key) payload.mailketing_api_key = form.mailketing_api_key;
      await apiPut('/api/v1/admin/settings', payload);
      setNotice('Pengaturan disimpan. Brand di seluruh halaman ikut berubah.');
      // Password baru kini tersimpan — kosongkan fieldnya.
      set('smtp_password', '');
      if (form.smtp_password) set('smtp_password_configured', true);
      set('mailketing_api_key', '');
      if (form.mailketing_api_key) set('mailketing_api_key_configured', true);
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

  // v37: kirim email tes ke alamat email admin yang login.
  async function testEmail() {
    setTestingEmail(true);
    setNotice(null);
    setError(null);
    try {
      const d = await apiPost<any>('/api/v1/admin/email/test', {});
      setNotice(`Email tes terkirim ke ${d?.to ?? 'email admin'}. Periksa kotak masuk (dan folder spam).`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setTestingEmail(false);
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

          {/* v37: SMTP — pengiriman email ke member (verifikasi, reset
              password, tagihan, pengingat, pengumuman). Password
              tersimpan terenkripsi di server dan tidak pernah tampil.
              v38: tambah provider Mailketing API (REST) sebagai
              alternatif SMTP; API key tersimpan terenkripsi sama
              seperti password SMTP. */}
          <Card
            title="Email"
            subtitle="Provider pengiriman email untuk verifikasi, reset password, tagihan, pengingat paket, dan pengumuman ke member."
            actions={
              <Button variant="outline" type="button" onClick={testEmail} disabled={testingEmail}>
                {testingEmail ? 'Mengirim…' : 'Kirim Email Tes'}
              </Button>
            }
          >
            <div className="form-grid">
              <Field label="Provider pengiriman">
                <select value={form.mail_provider} onChange={(e) => set('mail_provider', e.target.value)}>
                  <option value="mailketing_api">Mailketing API (disarankan)</option>
                  <option value="smtp">SMTP</option>
                </select>
              </Field>
              <Field label="Nama pengirim">
                <input value={form.smtp_from_name} onChange={(e) => set('smtp_from_name', e.target.value)} placeholder="MutasiHub" />
              </Field>
              <Field label="Alamat pengirim" hint="Alamat yang tampil sebagai pengirim di email member. Domainnya harus sudah terverifikasi di penyedia.">
                <input type="email" value={form.smtp_from_email} onChange={(e) => set('smtp_from_email', e.target.value)} placeholder="noreply@mutasi.rajacek.com" />
              </Field>
            </div>
            {form.mail_provider === 'mailketing_api' ? (
              <div className="form-grid" style={{ marginTop: 12 }}>
                <Field
                  label="API key Mailketing"
                  hint={
                    form.mailketing_api_key_configured
                      ? 'API key sudah tersimpan — isi hanya untuk mengganti, kosongkan untuk mempertahankan.'
                      : 'Token dari dashboard Mailketing → Integrasi → Email Application API. Disimpan terenkripsi di server.'
                  }
                >
                  <input
                    type="password"
                    value={form.mailketing_api_key}
                    onChange={(e) => set('mailketing_api_key', e.target.value)}
                    placeholder={form.mailketing_api_key_configured ? '••••••••' : ''}
                    autoComplete="new-password"
                  />
                </Field>
              </div>
            ) : (
              <>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, marginTop: 12 }}>
                  <input
                    type="checkbox"
                    style={{ width: 'auto' }}
                    checked={form.smtp_enabled}
                    onChange={(e) => set('smtp_enabled', e.target.checked)}
                  />
                  Aktifkan pengiriman email (SMTP)
                </label>
                <div className="form-grid" style={{ marginTop: 12 }}>
                  <Field label="Host SMTP" hint="Mis. smtp.gmail.com">
                    <input value={form.smtp_host} onChange={(e) => set('smtp_host', e.target.value)} placeholder="smtp.gmail.com" autoComplete="off" />
                  </Field>
                  <Field label="Port" hint="587 untuk STARTTLS, 465 untuk TLS.">
                    <input
                      type="number"
                      min={1}
                      max={65535}
                      value={form.smtp_port}
                      onChange={(e) => set('smtp_port', e.target.value)}
                      placeholder="587"
                    />
                  </Field>
                  <Field label="Mode TLS">
                    <select value={form.smtp_tls_mode} onChange={(e) => set('smtp_tls_mode', e.target.value)}>
                      <option value="starttls">STARTTLS (port 587)</option>
                      <option value="tls">TLS implisit (port 465)</option>
                      <option value="none">Tanpa TLS (relay lokal saja)</option>
                    </select>
                  </Field>
                  <Field label="Username SMTP">
                    <input value={form.smtp_username} onChange={(e) => set('smtp_username', e.target.value)} placeholder="akun@email.com" autoComplete="off" />
                  </Field>
                  <Field
                    label="Password SMTP"
                    hint={
                      form.smtp_password_configured
                        ? 'Password sudah tersimpan — isi hanya untuk mengganti, kosongkan untuk mempertahankan.'
                        : 'Password disimpan terenkripsi di server.'
                    }
                  >
                    <input
                      type="password"
                      value={form.smtp_password}
                      onChange={(e) => set('smtp_password', e.target.value)}
                      placeholder={form.smtp_password_configured ? '••••••••' : ''}
                      autoComplete="new-password"
                    />
                  </Field>
                </div>
              </>
            )}
            <p className="muted" style={{ marginTop: 8 }}>
              {form.mail_provider === 'mailketing_api'
                ? 'Satu email terkirim memakai 1 kredit Mailketing. Selama API key belum diisi, email verifikasi, reset password, tagihan, dan pengingat tidak terkirim — tombol "Kirim Email Tes" akan memberitahu bila pengaturan belum lengkap.'
                : 'Selama SMTP belum dikonfigurasi, email verifikasi, reset password, tagihan, dan pengingat tidak terkirim — tombol "Kirim Email Tes" akan memberitahu bila pengaturan belum lengkap.'}
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
