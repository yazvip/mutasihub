'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { apiPost, friendlyError } from '../../lib/api';
import { Button, ErrorBanner, Field, InfoBanner } from '../../components/ui';

// Kontrak backend (auth_handlers.go handleResetPassword):
// POST /api/v1/auth/reset-password {token, new_password} (min 8 karakter).
// Tanpa SMTP, token reset hanya tercatat di log server — user menempel token
// dari tautan yang diberikan admin (lihat halaman lupa kata sandi).
function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => router.push('/login'), 2000);
    return () => clearTimeout(t);
  }, [done, router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Kata sandi minimal 8 karakter.');
      return;
    }
    if (password !== confirm) {
      setError('Konfirmasi kata sandi tidak cocok.');
      return;
    }
    setBusy(true);
    try {
      await apiPost('/api/v1/auth/reset-password', { token, new_password: password });
      setDone(true);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>Reset Kata Sandi</h1>
        <p className="auth-sub">Buat kata sandi baru untuk akun Anda.</p>

        <ErrorBanner message={error} onClose={() => setError(null)} />

        {!token ? (
          <>
            <InfoBanner message="Token reset tidak ditemukan di tautan. Buka tautan reset dari email Anda, atau minta tautan baru di halaman lupa kata sandi." />
            <p className="auth-switch">
              <Link href="/forgot-password">Minta tautan reset baru</Link>
              {' · '}
              <Link href="/login">Kembali masuk</Link>
            </p>
          </>
        ) : done ? (
          <>
            <InfoBanner message="Kata sandi berhasil diganti. Mengalihkan ke halaman masuk…" />
            <p className="auth-switch">
              <Link href="/login">Masuk sekarang</Link>
            </p>
          </>
        ) : (
          <form onSubmit={submit}>
            <Field label="Kata Sandi Baru" hint="Minimal 8 karakter.">
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimal 8 karakter"
                autoComplete="new-password"
              />
            </Field>
            <Field label="Konfirmasi Kata Sandi Baru">
              <input
                type="password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Ulangi kata sandi baru"
                autoComplete="new-password"
              />
            </Field>
            <Button type="submit" disabled={busy} className="google-btn" variant="primary">
              {busy ? 'Memproses…' : 'Ganti Kata Sandi'}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
