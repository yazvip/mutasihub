'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { apiPost, apiUrl, friendlyError } from '../../lib/api';
import {
  AuthAlert,
  AuthButton,
  AuthDivider,
  AuthField,
  AuthShell,
  GoogleButton,
  authInputCls,
} from '../../components/auth-shell';

export default function RegisterPage() {
  const router = useRouter();
  const [nama, setNama] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiPost('/api/v1/auth/register', { email, password, name: nama });
      router.push('/member/dashboard');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Daftar Gratis" subtitle="Trial 1 hari gratis — hubungkan rekening Anda dan mulai pantau mutasi.">
      {error && (
        <AuthAlert tone="error" onClose={() => setError(null)}>
          {error}
        </AuthAlert>
      )}

      <form onSubmit={submit}>
        <AuthField label="Nama">
          <input
            type="text"
            required
            value={nama}
            onChange={(e) => setNama(e.target.value)}
            placeholder="Nama Anda"
            autoComplete="name"
            className={authInputCls}
          />
        </AuthField>
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
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimal 8 karakter"
            autoComplete="new-password"
            className={authInputCls}
          />
        </AuthField>
        <AuthButton disabled={busy}>{busy ? 'Memproses…' : 'Buat Akun'}</AuthButton>
      </form>

      <AuthDivider />

      <GoogleButton href={apiUrl('/api/v1/auth/google')} label="Daftar dengan Google" />

      <p className="mt-6 text-center text-sm text-slate-500">
        Sudah punya akun?{' '}
        <Link href="/login" className="font-semibold text-brand-600 hover:text-brand-700">
          Masuk
        </Link>
      </p>
    </AuthShell>
  );
}
