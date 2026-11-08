'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { apiGet, apiPost, friendlyError, isApiError } from '../../../lib/api';
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  InfoBanner,
  PageHeading,
  StatusBadge,
  TableSkeleton,
} from '../../../components/ui';

// Kontrak backend (auth_handlers.go, P2-17):
// - GET /api/v1/auth/me -> {totp_enabled}
// - POST /api/v1/auth/2fa/enable {} -> {secret, otpauth_url, message}
//   Bila 2FA sudah aktif: wajib {current_password, totp_code}, bila tidak
//   dikirim -> 400 totp_already_enabled.
// - POST /api/v1/auth/2fa/verify {code} -> {message, recovery_codes[8],
//   recovery_note}
// - POST /api/v1/auth/2fa/disable {code} -> {message}; 400 totp_not_setup
//   bila 2FA tidak aktif; 401 invalid_totp bila kode salah.
// Recovery code & secret TOTP TIDAK PERNAH disimpan persisten — hanya di
// state komponen ini dan dihapus dari layar begitu member menutupnya.
export default function MemberSecurityPage() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Alur aktifkan: secret baru -> verifikasi kode -> recovery code sekali.
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauthUrl, setOtpauthUrl] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [recoveryNote, setRecoveryNote] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Alur ganti secret (2FA sudah aktif): verifikasi ulang.
  const [reverifyOpen, setReverifyOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [currentTotp, setCurrentTotp] = useState('');
  const [enableBusy, setEnableBusy] = useState(false);

  // Alur nonaktifkan.
  const [disableCode, setDisableCode] = useState('');
  const [disableBusy, setDisableBusy] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);

  async function loadStatus() {
    try {
      const d = await apiGet<any>('/api/v1/auth/me');
      setEnabled(d?.totp_enabled === true);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

  function clearSetupState() {
    setSecret(null);
    setOtpauthUrl(null);
    setVerifyCode('');
    setRecoveryCodes(null);
    setRecoveryNote(null);
    setReverifyOpen(false);
    setCurrentPassword('');
    setCurrentTotp('');
  }

  async function copyText(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  // Minta secret baru. Bila 2FA sudah aktif dan belum verifikasi ulang,
  // backend balas totp_already_enabled -> buka form verifikasi ulang.
  async function startEnable(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    setNotice(null);
    setEnableBusy(true);
    try {
      const body: Record<string, string> = {};
      if (reverifyOpen) {
        body.current_password = currentPassword;
        body.totp_code = currentTotp;
      }
      const d = await apiPost<any>('/api/v1/auth/2fa/enable', body);
      setSecret(d?.secret ?? null);
      setOtpauthUrl(d?.otpauth_url ?? null);
      setReverifyOpen(false);
      setCurrentPassword('');
      setCurrentTotp('');
    } catch (err) {
      if (isApiError(err) && err.code === 'totp_already_enabled') {
        setReverifyOpen(true);
        setError(
          '2FA sudah aktif. Untuk mengganti secret, masukkan kata sandi saat ini dan kode TOTP saat ini.'
        );
      } else {
        setError(friendlyError(err));
      }
    } finally {
      setEnableBusy(false);
    }
  }

  async function submitVerify(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setVerifyBusy(true);
    try {
      const d = await apiPost<any>('/api/v1/auth/2fa/verify', {
        code: verifyCode.trim(),
      });
      const codes = Array.isArray(d?.recovery_codes) ? d.recovery_codes : [];
      setRecoveryCodes(codes);
      setRecoveryNote(d?.recovery_note ?? null);
      setSecret(null);
      setOtpauthUrl(null);
      setEnabled(true);
      setNotice(d?.message ?? '2FA berhasil diaktifkan.');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setVerifyBusy(false);
    }
  }

  async function submitDisable(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setDisableBusy(true);
    try {
      const d = await apiPost<any>('/api/v1/auth/2fa/disable', {
        code: disableCode.trim(),
      });
      setEnabled(false);
      setDisableCode('');
      setDisableOpen(false);
      setNotice(d?.message ?? '2FA berhasil dinonaktifkan.');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setDisableBusy(false);
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="Pengaturan"
        title="Keamanan & 2FA"
        description="Autentikasi dua faktor (TOTP) melindungi akun Anda bila kata sandi bocor. Kode dibuat di aplikasi authenticator (mis. Google Authenticator)."
      />
      <ErrorBanner message={error} onClose={() => setError(null)} />
      <InfoBanner message={notice} />

      {loading ? (
        <TableSkeleton rows={4} />
      ) : (
        <>
          <Card title="Status 2FA">
            <p style={{ margin: '0 0 4px', display: 'flex', gap: 8, alignItems: 'center' }}>
              <StatusBadge status={enabled ? 'active' : 'inactive'} />
              <span>{enabled ? '2FA aktif di akun Anda.' : '2FA belum aktif.'}</span>
            </p>
            <p className="muted" style={{ margin: '8px 0 0' }}>
              {enabled
                ? 'Setiap login meminta kode 6 digit dari aplikasi authenticator Anda. Bila kehilangan akses ke authenticator, pakai salah satu recovery code (masing-masing hanya sekali).'
                : 'Aktifkan 2FA supaya login membutuhkan kode 6 digit dari aplikasi authenticator, selain kata sandi.'}
            </p>
          </Card>

          {/* Recovery code: tampil SEKALI setelah aktivasi berhasil. */}
          {recoveryCodes && (
            <Card title="Recovery code — simpan sekarang">
              <div className="callout-warn" role="alert">
                <strong>Simpan 8 kode ini di tempat aman.</strong>{' '}
                {recoveryNote ??
                  'Masing-masing hanya bisa dipakai sekali dan tidak akan ditampilkan lagi.'}{' '}
                Bila authenticator hilang, satu kode ini menggantikan kode TOTP
                saat login. Setelah Anda menutup kartu ini, kode tidak bisa
                dilihat lagi.
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                  gap: 8,
                  margin: '12px 0',
                }}
              >
                {recoveryCodes.map((c) => (
                  <code
                    key={c}
                    style={{
                      display: 'block',
                      padding: '10px 12px',
                      border: '1px solid var(--line)',
                      borderRadius: 8,
                      fontSize: 15,
                      textAlign: 'center',
                      letterSpacing: 1,
                    }}
                  >
                    {c}
                  </code>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button
                  variant="outline"
                  onClick={() => copyText(recoveryCodes.join('\n'), 'recovery')}
                >
                  {copied === 'recovery' ? 'Disalin ✓' : 'Salin semua kode'}
                </Button>
                <Button
                  onClick={() => {
                    setRecoveryCodes(null);
                    setRecoveryNote(null);
                    setNotice('Recovery code sudah ditutup — kode tidak lagi tampil di layar ini.');
                  }}
                >
                  Saya sudah menyimpan kodenya
                </Button>
              </div>
            </Card>
          )}

          {/* Langkah 1-2 aktivasi: secret + verifikasi kode. */}
          {enabled === false && !recoveryCodes && (
            <Card
              title="Aktifkan 2FA"
              subtitle="Scan secret ke aplikasi authenticator, lalu verifikasi dengan kode 6 digit pertama."
              actions={
                !secret ? (
                  <Button onClick={() => startEnable()} disabled={enableBusy}>
                    {enableBusy ? 'Memproses…' : 'Mulai Aktifkan 2FA'}
                  </Button>
                ) : undefined
              }
            >
              {secret ? (
                <form onSubmit={submitVerify}>
                  <Field label="Secret TOTP" hint="Salin secret ini ke aplikasi authenticator, atau buka tautan otpauth di bawah. Secret ini hanya tampil sekali di sini.">
                    <p className="mono" style={{ wordBreak: 'break-all', margin: 0 }}>{secret}</p>
                  </Field>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                    <Button variant="outline" onClick={() => copyText(secret, 'secret')}>
                      {copied === 'secret' ? 'Disalin ✓' : 'Salin secret'}
                    </Button>
                    {otpauthUrl && (
                      <Button variant="outline" onClick={() => copyText(otpauthUrl, 'otpauth')}>
                        {copied === 'otpauth' ? 'Disalin ✓' : 'Salin tautan otpauth'}
                      </Button>
                    )}
                  </div>
                  <Field label="Kode verifikasi (6 digit)" hint="Kode dari aplikasi authenticator setelah secret ditambahkan.">
                    <input
                      type="text"
                      required
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      value={verifyCode}
                      onChange={(e) => setVerifyCode(e.target.value.replace(/[^0-9]/g, ''))}
                      placeholder="123456"
                      autoComplete="one-time-code"
                    />
                  </Field>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Button type="submit" disabled={verifyBusy}>
                      {verifyBusy ? 'Memverifikasi…' : 'Verifikasi & Aktifkan'}
                    </Button>
                    <Button variant="ghost" onClick={clearSetupState}>
                      Batal
                    </Button>
                  </div>
                </form>
              ) : (
                <EmptyState
                  title="Belum memulai aktivasi"
                  description="Tekan tombol di atas untuk membuat secret TOTP baru."
                />
              )}
            </Card>
          )}

          {/* 2FA aktif: ganti secret (verifikasi ulang) + nonaktifkan. */}
          {enabled && !recoveryCodes && (
            <>
              <Card
                title="Ganti secret 2FA"
                subtitle="Buat secret baru (mis. authenticator lama hilang). Secret lama langsung tidak berlaku setelah verifikasi kode baru berhasil."
              >
                {reverifyOpen || secret ? (
                  <form
                    onSubmit={secret ? submitVerify : startEnable}
                  >
                    {secret ? (
                      <>
                        <Field label="Secret TOTP baru" hint="Salin secret ini ke aplikasi authenticator. Secret ini hanya tampil sekali di sini.">
                          <p className="mono" style={{ wordBreak: 'break-all', margin: 0 }}>{secret}</p>
                        </Field>
                        <div style={{ marginBottom: 12 }}>
                          <Button variant="outline" onClick={() => copyText(secret, 'secret2')}>
                            {copied === 'secret2' ? 'Disalin ✓' : 'Salin secret baru'}
                          </Button>
                        </div>
                        <Field label="Kode verifikasi (6 digit)" hint="Kode dari aplikasi authenticator dengan secret baru.">
                          <input
                            type="text"
                            required
                            inputMode="numeric"
                            pattern="[0-9]{6}"
                            maxLength={6}
                            value={verifyCode}
                            onChange={(e) => setVerifyCode(e.target.value.replace(/[^0-9]/g, ''))}
                            placeholder="123456"
                            autoComplete="one-time-code"
                          />
                        </Field>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <Button type="submit" disabled={verifyBusy}>
                            {verifyBusy ? 'Memverifikasi…' : 'Verifikasi & Aktifkan secret baru'}
                          </Button>
                          <Button variant="ghost" onClick={clearSetupState}>
                            Batal
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <Field label="Kata sandi saat ini">
                          <input
                            type="password"
                            required
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            placeholder="••••••••"
                            autoComplete="current-password"
                          />
                        </Field>
                        <Field label="Kode TOTP saat ini" hint="Kode 6 digit dari authenticator dengan secret lama.">
                          <input
                            type="text"
                            required
                            inputMode="numeric"
                            pattern="[0-9]{6}"
                            maxLength={6}
                            value={currentTotp}
                            onChange={(e) => setCurrentTotp(e.target.value.replace(/[^0-9]/g, ''))}
                            placeholder="123456"
                            autoComplete="one-time-code"
                          />
                        </Field>
                        <Button type="submit" disabled={enableBusy}>
                          {enableBusy ? 'Memproses…' : 'Verifikasi & Buat secret baru'}
                        </Button>
                      </>
                    )}
                  </form>
                ) : (
                  <Button variant="outline" onClick={() => setReverifyOpen(true)}>
                    Ganti secret 2FA
                  </Button>
                )}
              </Card>

              <Card
                title="Nonaktifkan 2FA"
                subtitle="Akun kembali hanya dilindungi kata sandi. Perlu kode TOTP saat ini sebagai bukti Anda pemilik akun."
              >
                {disableOpen ? (
                  <form onSubmit={submitDisable}>
                    <Field label="Kode TOTP saat ini" hint="Kode 6 digit dari aplikasi authenticator Anda.">
                      <input
                        type="text"
                        required
                        inputMode="numeric"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        value={disableCode}
                        onChange={(e) => setDisableCode(e.target.value.replace(/[^0-9]/g, ''))}
                        placeholder="123456"
                        autoComplete="one-time-code"
                      />
                    </Field>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <Button type="submit" variant="danger" disabled={disableBusy}>
                        {disableBusy ? 'Memproses…' : 'Ya, nonaktifkan 2FA'}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setDisableOpen(false);
                          setDisableCode('');
                        }}
                      >
                        Batal
                      </Button>
                    </div>
                  </form>
                ) : (
                  <Button variant="danger" onClick={() => setDisableOpen(true)}>
                    Nonaktifkan 2FA
                  </Button>
                )}
              </Card>
            </>
          )}
        </>
      )}
    </>
  );
}
