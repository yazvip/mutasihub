'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { apiPost, apiUrl, friendlyError, isApiError } from '../../lib/api';
import {
  AuthAlert,
  AuthButton,
  AuthDivider,
  AuthField,
  AuthShell,
  GoogleButton,
  authInputCls,
} from '../../components/auth-shell';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const notRegistered = params.get('error') === 'not_registered';
  const accountDisabled = params.get('error') === 'account_disabled';
  // v21 (P1-3): login Google yang akunnya ber-2FA diarahkan ke sini dengan
  // ?totp_required=1 — verifikasi kode TOTP dulu sebelum sesi dibuat.
  const totpRequired = params.get('totp_required') === '1';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [showTotp, setShowTotp] = useState(false);
  const [pendingCode, setPendingCode] = useState('');
  const [pendingBusy, setPendingBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // Kontrak backend (auth_handlers.go loginReq): {email, password,
      // totp_code}. Bila akun mengaktifkan 2FA dan kode belum/salah dikirim,
      // backend balas 401 dengan error code `invalid_totp`.
      const payload: Record<string, string> = { email, password };
      if (showTotp && totpCode) payload.totp_code = totpCode;
      const d = await apiPost<any>('/api/v1/auth/login', payload);
      // v20: sandi direset admin -> wajib ganti sandi baru sebelum masuk.
      if (d?.must_change_password) {
        router.push('/member/change-password');
      } else {
        router.push('/member/dashboard');
      }
    } catch (err) {
      if (isApiError(err) && err.code === 'invalid_totp') {
        setShowTotp(true);
        setError(
          showTotp
            ? 'Kode 2FA salah atau kedaluwarsa. Periksa aplikasi authenticator Anda lalu coba lagi.'
            : 'Akun ini memakai 2FA. Masukkan kode 6 digit dari aplikasi authenticator Anda.'
        );
      } else {
        setError(friendlyError(err));
      }
    } finally {
      setBusy(false);
    }
  }

  // v21 (P1-3): verifikasi TOTP pending pasca-login Google. Sukses lalu
  // arahkan sesuai flag wajib-ganti sandi dari respons backend.
  // v22 (P2-17): kolom TOTP juga menerima recovery code 10 karakter
  // alfanumerik sebagai pengganti kode 6 digit (backend mengonsumsinya
  // sekali pakai). Validasi di sini longgar — backend yang memutuskan.
  async function submitPendingTotp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^[A-Za-z0-9]{6,10}$/.test(pendingCode.trim())) {
      setError('Masukkan kode 6 digit dari aplikasi authenticator Anda, atau salah satu recovery code 10 karakter.');
      return;
    }
    setPendingBusy(true);
    try {
      const d = await apiPost<any>('/api/v1/auth/totp/verify-pending', { code: pendingCode });
      if (d?.must_change_password) {
        router.push('/member/change-password');
      } else {
        router.push('/member/dashboard');
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setPendingBusy(false);
    }
  }

  return (
    <AuthShell title="Masuk" subtitle="Masuk ke akun MutasiHub Anda.">
      {accountDisabled && (
        <AuthAlert tone="error">
          <strong>Akun ini dinonaktifkan oleh admin.</strong>
          <br />
          Hubungi dukungan untuk mengaktifkan kembali akun Anda.
        </AuthAlert>
      )}

      {notRegistered && (
        <AuthAlert tone="error">
          <strong>Akun Google ini belum terdaftar.</strong>
          <br />
          Silakan daftar dulu dengan email ini, atau masuk dengan email &amp;
          kata sandi Anda.
          <div className="mt-3">
            <Link
              href="/register"
              className="inline-flex items-center justify-center px-3.5 py-2 rounded-lg bg-white border border-rose-300 text-rose-800 text-sm font-semibold hover:bg-rose-100 transition-colors"
            >
              Daftar sekarang
            </Link>
          </div>
        </AuthAlert>
      )}

      {error && (
        <AuthAlert tone="error" onClose={() => setError(null)}>
          {error}
        </AuthAlert>
      )}

      {totpRequired && (
        <AuthAlert tone="info">
          <strong>Verifikasi 2FA diperlukan.</strong>
          <br />
          Login Google berhasil. Masukkan kode 6 digit dari aplikasi
          authenticator Anda untuk melanjutkan.
        </AuthAlert>
      )}

      {totpRequired ? (
        <form onSubmit={submitPendingTotp}>
          <AuthField
            label="Kode 2FA (TOTP)"
            hint="Kode 6 digit dari aplikasi authenticator Anda — atau salah satu recovery code 10 karakter bila authenticator tidak bisa diakses."
          >
            <input
              type="text"
              required
              inputMode="text"
              pattern="[A-Za-z0-9]{6,10}"
              maxLength={10}
              value={pendingCode}
              onChange={(e) => setPendingCode(e.target.value.replace(/[^A-Za-z0-9]/g, ''))}
              placeholder="123456"
              autoComplete="one-time-code"
              className={authInputCls}
            />
          </AuthField>
          <AuthButton disabled={pendingBusy}>{pendingBusy ? 'Memverifikasi…' : 'Verifikasi & Masuk'}</AuthButton>
        </form>
      ) : (
        <>
          <form onSubmit={submit}>
            <AuthField label="Email">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nama@email.com"
                autoComplete="email"
                className={authInputCls}
              />
            </AuthField>
            <AuthField label="Kata Sandi">
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                className={authInputCls}
              />
            </AuthField>
            {showTotp && (
              <AuthField
                label="Kode 2FA (TOTP)"
                hint="Kode 6 digit dari aplikasi authenticator Anda — atau salah satu recovery code 10 karakter bila authenticator tidak bisa diakses."
              >
                <input
                  type="text"
                  required
                  inputMode="text"
                  pattern="[A-Za-z0-9]{6,10}"
                  maxLength={10}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/[^A-Za-z0-9]/g, ''))}
                  placeholder="123456"
                  autoComplete="one-time-code"
                  className={authInputCls}
                />
              </AuthField>
            )}
            <AuthButton disabled={busy}>{busy ? 'Memproses…' : 'Masuk'}</AuthButton>
          </form>

          <AuthDivider />

          <GoogleButton href={apiUrl('/api/v1/auth/google')} label="Masuk dengan Google" />
        </>
      )}

      <p className="mt-6 text-center text-sm text-slate-500">
        Belum punya akun?{' '}
        <Link href="/register" className="font-semibold text-brand-600 hover:text-brand-700">
          Daftar gratis
        </Link>
        {' · '}
        <Link href="/forgot-password" className="font-semibold text-brand-600 hover:text-brand-700">
          Lupa kata sandi?
        </Link>
      </p>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
