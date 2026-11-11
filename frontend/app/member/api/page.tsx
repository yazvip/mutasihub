'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { apiDelete, apiGet, apiPost, apiPut, friendlyError } from '../../../lib/api';
import { formatDateWIB, maskApiKey } from '../../../lib/format';
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  InfoBanner,
  StatusBadge,
  PageHeading,
  TableSkeleton,
} from '../../../components/ui';

// Kontrak backend (member_handlers.go): list {api_keys: [{id, key_prefix,
// scope (string), ip_whitelist (string), is_active (bool), last_used_at?,
// created_at, expires_at (WIB RFC3339 atau null)}]}; create
// {scope: string, ip_whitelist: string, expires_at?: RFC3339 masa depan}
// -> {api_key, key_prefix, expires_at}. Tidak ada field `name` — backend
// menolak field tak dikenal. Batas: 5 key aktif (belum kedaluwarsa) —
// key ke-6 ditolak 409 api_key_limit.
// GET /api/v1/member/profile -> {callback_url, callback_secret} (P2-8):
// secret HMAC milik member untuk memverifikasi X-MutasiHub-Signature;
// kosong sampai callback pertama terkirim.
type ApiKey = {
  id: string;
  key_prefix: string;
  scope: string;
  ip_whitelist: string;
  is_active: boolean;
  last_used_at?: string;
  created_at?: string;
  expires_at?: string | null;
};

function isKeyExpired(k: ApiKey): boolean {
  if (!k.expires_at) return false;
  const t = new Date(k.expires_at).getTime();
  return !Number.isNaN(t) && t <= Date.now();
}

const SCOPES = ['mutasi:read', 'accounts:read', 'webhook:receive'];

export default function MemberApiPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);

  const [scopes, setScopes] = useState<string[]>(['mutasi:read']);
  const [ipWhitelist, setIpWhitelist] = useState('');
  const [expiresInput, setExpiresInput] = useState('');
  const [busy, setBusy] = useState(false);

  // P2-8: callback secret milik member (GET /api/v1/member/profile).
  const [callbackUrl, setCallbackUrl] = useState<string | null>(null);
  const [callbackSecret, setCallbackSecret] = useState<string | null>(null);
  const [callbackEnabled, setCallbackEnabled] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);

  // v42a: kelola URL callback + tes + riwayat pengiriman.
  type Delivery = {
    event: string;
    target_url: string;
    status_code: number;
    response_body: string;
    created_at: string;
  };
  const [urlInput, setUrlInput] = useState('');
  const [urlLoaded, setUrlLoaded] = useState(false);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [deliveriesLoaded, setDeliveriesLoaded] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [deleteArm, setDeleteArm] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<{ status_code: number; at: string } | null>(null);
  const [regenArm, setRegenArm] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);

  // v42b: preferensi + tes notifikasi mutasi email.
  const [notifEnabled, setNotifEnabled] = useState(true);
  const [notifInterval, setNotifInterval] = useState(0);
  const [notifLastSent, setNotifLastSent] = useState('');
  const [notifLoaded, setNotifLoaded] = useState(false);
  const [notifBusy, setNotifBusy] = useState(false);
  const [notifTestBusy, setNotifTestBusy] = useState(false);
  const [notifTestSent, setNotifTestSent] = useState(false);

  // P2-22: batas backend = 5 key AKTIF yang belum kedaluwarsa.
  const activeCount = keys.filter((k) => k.is_active && !isKeyExpired(k)).length;
  const atKeyLimit = activeCount >= 5;

  async function load() {
    try {
      const d = await apiGet<any>('/api/v1/api-keys');
      const list = Array.isArray(d) ? d : d?.api_keys ?? d?.keys ?? d?.data ?? [];
      setKeys(Array.isArray(list) ? list : []);
      setError(null);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  }

  async function loadDeliveries() {
    try {
      const d = await apiGet<any>('/api/v1/member/callback/deliveries');
      const list = Array.isArray(d) ? d : d?.deliveries ?? [];
      setDeliveries(Array.isArray(list) ? list : []);
    } catch {
      // Riwayat gagal dimuat — kartu tetap menampilkan form callback.
    } finally {
      setDeliveriesLoaded(true);
    }
  }

  async function loadNotifications() {
    try {
      const d = await apiGet<any>('/api/v1/member/notifications');
      setNotifEnabled(d?.notif_enabled !== false);
      setNotifInterval(typeof d?.interval_minutes === 'number' ? d.interval_minutes : 0);
      setNotifLastSent(d?.last_notified_at ?? '');
    } catch {
      // Preferensi gagal dimuat — kartu menampilkan pesan gagal.
    } finally {
      setNotifLoaded(true);
    }
  }

  useEffect(() => {
    load();
    apiGet<any>('/api/v1/member/profile')
      .then((d) => {
        setCallbackUrl(d?.callback_url ?? null);
        setUrlInput(d?.callback_url ?? '');
        setUrlLoaded(true);
        setCallbackSecret(d?.callback_secret ?? null);
        setCallbackEnabled(!!d?.callback_enabled);
      })
      .catch(() => {
        // Profil gagal dimuat — kartu callback menampilkan pesan gagal.
      })
      .finally(() => setProfileLoaded(true));
    loadDeliveries();
    loadNotifications();
  }, []);

  async function saveCallbackUrl() {
    const url = urlInput.trim();
    if (!url) {
      setError('Isi URL callback dulu (https://…).');
      return;
    }
    setError(null);
    setNotice(null);
    setSaveBusy(true);
    try {
      const d = await apiPut<any>('/api/v1/member/callback', { callback_url: url });
      setCallbackUrl(d?.callback_url ?? url);
      setNotice('URL callback disimpan.');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSaveBusy(false);
    }
  }

  async function deleteCallbackUrl() {
    if (!deleteArm) {
      setDeleteArm(true);
      setTimeout(() => setDeleteArm(false), 5000);
      return;
    }
    setDeleteArm(false);
    setError(null);
    setNotice(null);
    setSaveBusy(true);
    try {
      await apiPut<any>('/api/v1/member/callback', { callback_url: '' });
      setCallbackUrl(null);
      setUrlInput('');
      setNotice('URL callback dihapus. Callback tidak akan dikirim lagi.');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSaveBusy(false);
    }
  }

  async function sendCallbackTest() {
    setError(null);
    setNotice(null);
    setTestBusy(true);
    try {
      const d = await apiPost<any>('/api/v1/member/callback/test', {});
      const code = typeof d?.status_code === 'number' ? d.status_code : 0;
      setTestResult({ status_code: code, at: new Date().toISOString() });
      setNotice(`Tes callback terkirim — endpoint menjawab HTTP ${code}.`);
      await loadDeliveries();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setTestBusy(false);
    }
  }

  async function toggleNotifications() {
    const next = !notifEnabled;
    setError(null);
    setNotice(null);
    setNotifBusy(true);
    try {
      const d = await apiPut<any>('/api/v1/member/notifications', { notif_enabled: next });
      setNotifEnabled(!!d?.notif_enabled);
      setNotice(next ? 'Notifikasi mutasi diaktifkan.' : 'Notifikasi mutasi dimatikan. Digest tidak akan dikirim lagi.');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setNotifBusy(false);
    }
  }

  async function sendNotificationTest() {
    setError(null);
    setNotice(null);
    setNotifTestBusy(true);
    try {
      await apiPost<any>('/api/v1/member/notifications/test', {});
      setNotifTestSent(true);
      setNotice('Notifikasi tes dikirim ke email Anda.');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setNotifTestBusy(false);
    }
  }

  async function regenerateSecret() {
    if (!regenArm) {
      setRegenArm(true);
      setTimeout(() => setRegenArm(false), 5000);
      return;
    }
    setRegenArm(false);
    setError(null);
    setNotice(null);
    setRegenBusy(true);
    try {
      const d = await apiPost<any>('/api/v1/member/callback/secret/regenerate', {});
      setCallbackSecret(d?.callback_secret ?? null);
      setNotice('Secret callback baru dibuat. Perbarui secret di server Anda — secret lama sudah tidak berlaku.');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setRegenBusy(false);
    }
  }

  function toggleScope(s: string) {
    setScopes((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  }

  async function createKey(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setNewKey(null);
    setBusy(true);
    try {
      const ips = ipWhitelist
        .split(/[\n,]+/)
        .map((x) => x.trim())
        .filter(Boolean);
      const body: Record<string, string> = {
        scope: scopes.join(','),
        ip_whitelist: ips.join(','),
      };
      // P2-22: tanggal kedaluwarsa opsional; kosong = tanpa kedaluwarsa.
      // datetime-local (waktu lokal) -> RFC3339 untuk backend.
      if (expiresInput) {
        const t = new Date(expiresInput);
        if (Number.isNaN(t.getTime())) {
          setError('Tanggal kedaluwarsa tidak valid.');
          setBusy(false);
          return;
        }
        body.expires_at = t.toISOString();
      }
      const d = await apiPost<any>('/api/v1/api-keys', body);
      const secret = d?.api_key ?? d?.key;
      if (secret) {
        setNewKey(secret);
        setNotice(
          'API key baru dibuat. Salin dan simpan sekarang — kunci lengkap hanya ditampilkan sekali.'
        );
      } else {
        setNotice('API key baru dibuat.');
      }
      setIpWhitelist('');
      setExpiresInput('');
      setScopes(['mutasi:read']);
      await load();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteKey(id: string) {
    if (!confirm('Hapus API key ini? Integrasi yang memakainya akan berhenti.')) return;
    try {
      await apiDelete(`/api/v1/api-keys/${id}`);
      setNotice('API key dihapus.');
      await load();
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  return (
    <>
      <PageHeading eyebrow="Akses terkontrol" title="API Key" description="Gunakan API key untuk mengambil mutasi dari sistem Anda sendiri. Batasi dengan IP whitelist dan scope seminimal mungkin." />
      <p style={{ margin: '-8px 0 16px' }}>
        <Link href="/docs">Lihat Dokumentasi API →</Link>
      </p>
      <ErrorBanner message={error} onClose={() => setError(null)} />
      <InfoBanner message={notice} />

      {newKey && (
        <Card title="Kunci baru Anda">
          <p className="mono">{newKey}</p>
          <p className="muted">
            Simpan di tempat aman. Kunci ini tidak akan ditampilkan lagi.
          </p>
        </Card>
      )}

      <Card title="Buat API Key">
        {atKeyLimit && (
          <p className="callout-warn" role="alert" style={{ marginTop: 0 }}>
            <strong>Sudah ada {activeCount} API key aktif (batas 5).</strong>{' '}
            Nonaktifkan atau hapus key lama dulu sebelum membuat key baru.
          </p>
        )}
        <form onSubmit={createKey}>
          <div className="form-grid">
            <Field label="IP Whitelist" hint="IP server Anda, dipisah koma. Kosongkan = semua IP (tidak disarankan).">
              <textarea
                rows={2}
                value={ipWhitelist}
                onChange={(e) => setIpWhitelist(e.target.value)}
                placeholder="103.147.8.1, 192.168.1.5"
              />
            </Field>
            <Field label="Kedaluwarsa (opsional)" hint="Kosongkan = key berlaku tanpa batas waktu. Key kedaluwarsa ditolak saat dipakai (401 api_key_expired).">
              <input
                type="datetime-local"
                value={expiresInput}
                onChange={(e) => setExpiresInput(e.target.value)}
              />
            </Field>
            <div className="field full">
              <span className="field-label">Scope</span>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {SCOPES.map((s) => (
                  <label key={s} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                    <input
                      type="checkbox"
                      style={{ width: 'auto' }}
                      checked={scopes.includes(s)}
                      onChange={() => toggleScope(s)}
                    />
                    <span className="mono">{s}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <Button type="submit" disabled={busy || atKeyLimit}>
            {busy ? 'Memproses…' : atKeyLimit ? 'Batas 5 key aktif tercapai' : 'Buat Key'}
          </Button>
        </form>
      </Card>

      <Card title="Callback (Instant Callback)" subtitle="Terima mutation.new di server Anda begitu ada mutasi baru.">
        {!profileLoaded || !urlLoaded ? (
          <TableSkeleton rows={2} />
        ) : !callbackEnabled ? (
          <>
            <p className="callout-warn" role="alert" style={{ marginTop: 0 }}>
              <strong>Instant Callback tersedia di paket Enterprise.</strong>{' '}
              Upgrade paket untuk mengisi URL callback dan menerima mutation.new secara instan.
            </p>
            <p style={{ margin: '0 0 12px' }}>
              <Link href="/member/subscription">Lihat paket →</Link>
            </p>
            {callbackSecret && (
              <>
                <p className="muted" style={{ marginTop: 0 }}>
                  Secret HMAC Anda (tetap tersimpan dari paket sebelumnya):
                </p>
                <p className="mono" style={{ wordBreak: 'break-all', margin: '0 0 8px' }}>
                  {callbackSecret}
                </p>
              </>
            )}
          </>
        ) : (
          <>
            <Field label="URL callback" hint="Wajib https. Setiap ada mutasi baru, server mengirim POST JSON mutation.new ke URL ini (maks 3 percobaan).">
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://server-anda.example.com/mutasi-hook"
              />
            </Field>
            <div className="row-actions" style={{ marginTop: 12 }}>
              <Button onClick={saveCallbackUrl} disabled={saveBusy || !urlInput.trim()}>
                {saveBusy ? 'Menyimpan…' : 'Simpan URL'}
              </Button>
              {callbackUrl && (
                <Button variant="danger" onClick={deleteCallbackUrl} disabled={saveBusy}>
                  {deleteArm ? 'Yakin hapus URL?' : 'Hapus URL'}
                </Button>
              )}
              <Button variant="outline" onClick={sendCallbackTest} disabled={testBusy || !callbackUrl}>
                {testBusy ? 'Mengirim tes…' : 'Kirim tes callback'}
              </Button>
            </div>
            {testResult && (
              <p className="muted" style={{ margin: '12px 0 0' }}>
                Tes terakhir: endpoint menjawab HTTP {testResult.status_code} ·{' '}
                {formatDateWIB(testResult.at)}
              </p>
            )}
            <hr style={{ margin: '16px 0' }} />
            {callbackSecret ? (
              <>
                <p className="muted" style={{ marginTop: 0 }}>
                  Setiap callback <code className="mono">mutation.new</code> yang
                  dikirim ke{' '}
                  <span className="mono">{callbackUrl || 'URL callback Anda'}</span>{' '}
                  disertai header <code className="mono">X-MutasiHub-Signature</code>{' '}
                  (HMAC atas body memakai secret di bawah). Verifikasi signature
                  ini di server Anda sebelum memproses callback.
                </p>
                <p className="mono" style={{ wordBreak: 'break-all', margin: '0 0 8px' }}>
                  {callbackSecret}
                </p>
                <div className="row-actions">
                  <Button
                    variant="outline"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(callbackSecret);
                      } catch {
                        const ta = document.createElement('textarea');
                        ta.value = callbackSecret;
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand('copy');
                        document.body.removeChild(ta);
                      }
                      setCopiedSecret(true);
                      setTimeout(() => setCopiedSecret(false), 2000);
                    }}
                  >
                    {copiedSecret ? 'Disalin ✓' : 'Salin secret'}
                  </Button>
                  <Button variant="outline" onClick={regenerateSecret} disabled={regenBusy}>
                    {regenBusy ? 'Membuat…' : regenArm ? 'Yakin regenerasi? Secret lama langsung mati' : 'Regenerasi secret'}
                  </Button>
                </div>
              </>
            ) : (
              <EmptyState
                title="Secret callback belum dibuat"
                description="Secret dibuat otomatis saat callback pertama terkirim ke URL callback Anda. Belum ada callback yang terkirim."
              />
            )}
            <hr style={{ margin: '16px 0' }} />
            <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Riwayat pengiriman</h3>
            {!deliveriesLoaded ? (
              <TableSkeleton rows={2} />
            ) : deliveries.length === 0 ? (
              <EmptyState
                title="Belum ada callback terkirim"
                description="Kirim tes callback di atas, atau tunggu mutasi baru masuk."
              />
            ) : (
              <div className="table-wrap">
                <table className="mobile-card-table">
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Target</th>
                      <th>Status</th>
                      <th>Waktu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliveries.map((d, i) => (
                      <tr key={`${d.created_at}-${i}`}>
                        <td data-label="Event" className="mono">{d.event}</td>
                        <td data-label="Target" className="mono" style={{ wordBreak: 'break-all' }}>{d.target_url}</td>
                        <td data-label="Status">
                          <StatusBadge status={d.status_code >= 200 && d.status_code < 300 ? 'active' : 'failed'} />
                          <span className="mono"> {d.status_code}</span>
                        </td>
                        <td data-label="Waktu">{formatDateWIB(d.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Card>

      <Card title="Notifikasi Mutasi" subtitle="Ringkasan mutasi baru dikirim ke email Anda tiap interval paket.">
        {!notifLoaded ? (
          <TableSkeleton rows={2} />
        ) : (
          <>
            <p style={{ marginTop: 0 }}>
              Status: <strong>{notifEnabled ? 'Aktif' : 'Nonaktif'}</strong>
              {notifInterval > 0 && (
                <> · Dikirim paling sering tiap {notifInterval} menit (paket Anda), hanya bila ada mutasi baru.</>
              )}
            </p>
            <p className="muted">
              Terakhir dikirim: {notifLastSent ? formatDateWIB(notifLastSent) : 'Belum pernah dikirim'}
            </p>
            <div className="row-actions">
              <Button onClick={toggleNotifications} disabled={notifBusy}>
                {notifBusy ? 'Menyimpan…' : notifEnabled ? 'Matikan notifikasi' : 'Aktifkan notifikasi'}
              </Button>
              <Button variant="outline" onClick={sendNotificationTest} disabled={notifTestBusy}>
                {notifTestBusy ? 'Mengirim tes…' : 'Kirim notifikasi tes'}
              </Button>
            </div>
            {notifTestSent && (
              <p className="muted" style={{ margin: '12px 0 0' }}>
                Notifikasi tes dikirim — cek inbox email Anda.
              </p>
            )}
          </>
        )}
      </Card>

      <Card title="Daftar API Key" subtitle={`${activeCount} key aktif dari batas 5`}>
        {loading ? (
          <TableSkeleton rows={4} />
        ) : keys.length === 0 ? (
          <EmptyState
            title="Belum ada API key"
            description="Buat key pertama Anda di atas."
          />
        ) : (
          <div className="table-wrap">
            <table className="mobile-card-table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Scope</th>
                  <th>IP Whitelist</th>
                  <th>Status</th>
                  <th>Kedaluwarsa</th>
                  <th>Terakhir Dipakai</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => {
                  const expired = isKeyExpired(k);
                  return (
                  <tr key={k.id}>
                    <td data-label="Key" className="mono"><span className="tok">{maskApiKey(k.key_prefix)}</span></td>
                    <td data-label="Scope" className="mono"><span className="tok">{k.scope || '-'}</span></td>
                    <td data-label="IP Whitelist" className="mono">
                      {(k.ip_whitelist ? k.ip_whitelist.split(',') : []).join(', ') || 'Semua IP'}
                    </td>
                    <td data-label="Status">
                      <StatusBadge
                        status={expired ? 'expired' : k.is_active ? 'active' : 'inactive'}
                      />
                    </td>
                    <td data-label="Kedaluwarsa">
                      {k.expires_at ? formatDateWIB(k.expires_at) : 'Tanpa batas'}
                    </td>
                    <td data-label="Terakhir Dipakai">{k.last_used_at ? formatDateWIB(k.last_used_at) : 'Belum pernah'}</td>
                    <td data-label="Aksi">
                      <Button variant="danger" onClick={() => deleteKey(k.id)}>
                        Hapus
                      </Button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
