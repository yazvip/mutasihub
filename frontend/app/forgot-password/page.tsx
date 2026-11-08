'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { apiPost, friendlyError } from '../../lib/api';
import { Button, ErrorBanner, Field, InfoBanner } from '../../components/ui';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiPost('/api/v1/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>Lupa Kata Sandi</h1>
        <p className="auth-sub">
          Kami kirim tautan reset ke email Anda.
        </p>
        <ErrorBanner message={error} onClose={() => setError(null)} />
        {sent ? (
          <>
            <InfoBanner message="Tautan reset sudah dikirim. Periksa inbox (dan folder spam) email Anda." />
            <p className="auth-switch">
              <Link href="/login">Kembali masuk</Link>
            </p>
          </>
        ) : (
          <form onSubmit={submit}>
            <Field label="Email">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nama@email.com"
                autoComplete="email"
              />
            </Field>
            <Button type="submit" disabled={busy} className="google-btn" variant="primary">
              {busy ? 'Memproses…' : 'Kirim Tautan Reset'}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
