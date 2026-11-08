'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { apiPost, friendlyError } from '../../lib/api';
import { Button, ErrorBanner, InfoBanner, Loading } from '../../components/ui';

// Halaman verifikasi email: POST {token} ke /api/v1/auth/verify-email.
// CATATAN: backend saat ini BELUM menyediakan endpoint verify-email
// (tidak ada route/handler-nya; token verifikasi hanya dibuat saat register
// dan tercatat di log server karena SMTP belum dikonfigurasi). Halaman ini
// baru berfungsi setelah backend menambahkan endpoint tersebut; sampai saat
// itu verifikasi menampilkan pesan gagal dari server.
function VerifyEmailContent() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<'loading' | 'ok' | 'fail'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setState('fail');
      setError('Token verifikasi tidak ditemukan di tautan.');
      return;
    }
    let cancelled = false;
    apiPost('/api/v1/auth/verify-email', { token })
      .then(() => {
        if (!cancelled) setState('ok');
      })
      .catch((err) => {
        if (!cancelled) {
          setState('fail');
          setError(friendlyError(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>Verifikasi Email</h1>
        {state === 'loading' && <Loading label="Memverifikasi email…" />}
        {state === 'ok' && (
          <>
            <InfoBanner message="Email Anda berhasil diverifikasi. Silakan masuk." />
            <p className="auth-switch">
              <Button href="/login">Masuk sekarang</Button>
            </p>
          </>
        )}
        {state === 'fail' && (
          <>
            <ErrorBanner message={error ?? 'Verifikasi email gagal.'} />
            <p className="muted" style={{ fontSize: 13 }}>
              Token mungkin sudah kedaluwarsa atau tautan tidak valid. Bila Anda
              menempel token secara manual, pastikan token disalin lengkap.
            </p>
            <p className="auth-switch">
              <Link href="/login">Kembali masuk</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailContent />
    </Suspense>
  );
}
