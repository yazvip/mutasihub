'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { apiGet, apiPost, friendlyError } from '../../../lib/api';
import { Button, Card, ErrorBanner, Field, PageHeading } from '../../../components/ui';

// v20 — Ganti kata sandi member.
// Dipakai saat sandi direset admin (must_change_password=1): member diarahkan
// ke sini dari login maupun dari layout member, dan tidak bisa memakai fitur
// lain sampai berhasil ganti. Halaman ini juga melayani ganti sandi mandiri.
export default function ChangePasswordPage() {
  const router = useRouter();
  const [forced, setForced] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiGet<any>('/api/v1/auth/me')
      .then((d) => setForced(d?.must_change_password === true))
      .catch(() => setForced(false));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Kata sandi baru minimal 8 karakter.');
      return;
    }
    if (password !== confirm) {
      setError('Konfirmasi kata sandi tidak cocok.');
      return;
    }
    // v21: ganti mandiri (bukan wajib-ganti) wajib menyertakan sandi saat
    // ini; sandi baru tidak boleh sama dengan sandi saat ini.
    if (!forced && password === currentPassword) {
      setError('Kata sandi baru tidak boleh sama dengan kata sandi saat ini.');
      return;
    }
    setBusy(true);
    try {
      const body: { new_password: string; current_password?: string } = {
        new_password: password,
      };
      if (!forced) body.current_password = currentPassword;
      await apiPost('/api/v1/auth/change-password', body);
      router.push('/member/dashboard');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="Keamanan akun"
        title="Ganti kata sandi"
        description="Buat kata sandi baru untuk akun Anda."
      />
      <Card title="Kata sandi baru">
        {forced && (
          <div className="callout-warn" role="alert">
            <strong>Kata sandi Anda direset oleh admin.</strong> Anda wajib membuat
            kata sandi baru sebelum bisa memakai fitur member lainnya.
          </div>
        )}
        <form onSubmit={submit}>
          <ErrorBanner message={error} onClose={() => setError(null)} />
          {!forced && (
            <Field label="Kata sandi saat ini" hint="Wajib diisi untuk mengganti kata sandi.">
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </Field>
          )}
          <Field label="Kata sandi baru" hint="Minimal 8 karakter.">
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </Field>
          <Field label="Konfirmasi kata sandi baru">
            <input
              type="password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </Field>
          <div className="row-actions">
            <Button type="submit" disabled={busy}>
              {busy ? 'Menyimpan…' : 'Simpan kata sandi baru'}
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
