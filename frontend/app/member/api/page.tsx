'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { apiDelete, apiGet, apiPost, friendlyError } from '../../../lib/api';
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
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);

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

  useEffect(() => {
    load();
    apiGet<any>('/api/v1/member/profile')
      .then((d) => {
        setCallbackUrl(d?.callback_url ?? null);
        setCallbackSecret(d?.callback_secret ?? null);
      })
      .catch(() => {
        // Profil gagal dimuat — kartu callback menampilkan pesan gagal.
      })
      .finally(() => setProfileLoaded(true));
  }, []);

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

      <Card title="Callback (Instant Callback)" subtitle="Secret HMAC untuk memverifikasi callback mutation.new dari server Anda.">
        {!profileLoaded ? (
          <TableSkeleton rows={2} />
        ) : callbackSecret ? (
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
          </>
        ) : (
          <EmptyState
            title="Secret callback belum dibuat"
            description="Secret dibuat otomatis saat callback pertama terkirim ke URL callback Anda. Belum ada callback yang terkirim."
          />
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
