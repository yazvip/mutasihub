'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { apiPost, friendlyError } from '../../lib/api';
import {
  AuthAlert,
  AuthButton,
  AuthField,
  AuthShell,
  authInputCls,
} from '../../components/auth-shell';

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiPost('/api/v1/admin/login', { email, pin });
      router.push('/admin');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  // v31-C (P1-2b): migrasi ke shell auth v25 — logo, tombol full-width,
  // link kembali ke beranda. Logika login tidak berubah.
  return (
    <AuthShell title="Admin" subtitle="Masuk ke panel admin MutasiHub dengan email + PIN.">
      {error && (
        <AuthAlert tone="error" onClose={() => setError(null)}>
          {error}
        </AuthAlert>
      )}

      <form onSubmit={submit}>
        <AuthField label="Email Admin">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@email.com"
            autoComplete="email"
            className={authInputCls}
          />
        </AuthField>
        <AuthField label="PIN">
          <input
            type="password"
            required
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            className={authInputCls}
          />
        </AuthField>
        <AuthButton disabled={busy}>{busy ? 'Memproses…' : 'Masuk Admin'}</AuthButton>
      </form>
    </AuthShell>
  );
}
