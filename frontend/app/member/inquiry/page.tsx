'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { apiGet, apiPost, friendlyError, isApiError } from '../../../lib/api';
import { bankLabel, loadBanks, type Bank } from '../../../lib/banks';
import { inquiryUsageText, type InquiryUsage } from '../../../lib/format';
import {
  Button,
  Card,
  ErrorBanner,
  Field,
  Loading,
  PageHeading,
} from '../../../components/ui';

// Kontrak backend (inquiry_handlers.go, v24):
// GET /api/v1/banks -> {banks: [{code, name}]}
// GET /api/v1/inquiry/usage (sesi member) ->
//   {limit_today, used_today, remaining_today, resets_at}
//   (limit_today null = tanpa batas; resets_at = 00:00 WIB berikutnya;
//   bila paket inquiry mati, ada inquiry_enabled: false)
// POST /api/v1/inquiry/bank-account {bank_code, account_number}
//   -> {account_name, account_number, bank_code, bank_name,
//       limit_today, remaining_today}
//   403 inquiry_disabled bila paket aktif member tidak mengizinkan inquiry.
//   429 inquiry_limit_reached bila batas harian habis
//   (body error membawa limit_today + remaining_today: 0).
type InquiryResult = {
  account_name: string;
  account_number: string;
  bank_code: string;
  bank_name: string;
  limit_today?: number | null;
  remaining_today?: number | null;
};

export default function MemberInquiryPage() {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [banksLoading, setBanksLoading] = useState(true);
  const [bankCode, setBankCode] = useState('014');
  const [accountNumber, setAccountNumber] = useState('');
  const [result, setResult] = useState<InquiryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<InquiryUsage | null>(null);

  async function loadUsage() {
    try {
      const u = await apiGet<InquiryUsage>('/api/v1/inquiry/usage');
      if (u && u.inquiry_enabled === false) {
        setDisabled(true);
        setUsage(null);
        return;
      }
      setUsage(u);
    } catch (err) {
      // Backend lama (endpoint belum ada) atau gagal jaringan: sembunyikan
      // baris sisa hit, jangan tampilkan error — POST inquiry tetap yang
      // menentukan (403 inquiry_disabled ditangani di sana).
      if (isApiError(err) && err.code === 'inquiry_disabled') {
        setDisabled(true);
      }
    }
  }

  useEffect(() => {
    loadBanks()
      .then((list) => setBanks(list))
      .finally(() => setBanksLoading(false));
    loadUsage();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // Hasil lama tidak boleh tampil sebagai hasil baru (termasuk saat
    // request berikutnya gagal karena limit habis).
    setResult(null);
    setDisabled(false);
    setBusy(true);
    try {
      const d = await apiPost<InquiryResult>('/api/v1/inquiry/bank-account', {
        bank_code: bankCode,
        account_number: accountNumber.trim(),
      });
      setResult(d);
      // Perbarui sisa hit dari respons sukses; bila backend tidak mengirim
      // angka limit, muat ulang usage agar angkanya tetap benar.
      if (
        typeof d.remaining_today === 'number' ||
        d.limit_today !== undefined
      ) {
        setUsage((prev) => {
          const limit = d.limit_today ?? prev?.limit_today ?? null;
          const remaining = d.remaining_today ?? prev?.remaining_today ?? null;
          return {
            limit_today: limit,
            remaining_today: remaining,
            used_today:
              typeof limit === 'number' && typeof remaining === 'number'
                ? Math.max(0, limit - remaining)
                : prev?.used_today ?? null,
            resets_at: prev?.resets_at ?? null,
          };
        });
      } else {
        await loadUsage();
      }
    } catch (err) {
      if (isApiError(err) && err.code === 'inquiry_disabled') {
        setDisabled(true);
        setError(null);
      } else if (isApiError(err) && err.code === 'inquiry_limit_reached') {
        setError('Batas inquiry hari ini habis. Reset 00:00 WIB.');
        // Sisa hit di body error (remaining_today: 0) ikut ditampilkan.
        if (
          typeof err.remaining_today === 'number' ||
          typeof err.limit_today === 'number'
        ) {
          setUsage((prev) => ({
            limit_today: err.limit_today ?? prev?.limit_today ?? null,
            remaining_today: err.remaining_today ?? 0,
            used_today: prev?.used_today ?? null,
            resets_at: prev?.resets_at ?? null,
          }));
        } else {
          await loadUsage();
        }
      } else {
        setError(friendlyError(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeading eyebrow="Cek nama pemilik" title="Inquiry Rekening" description="Cek nama pemilik rekening bank sebelum transfer — nama yang tampil berasal dari bank penerbit." />
      <ErrorBanner message={error} onClose={() => setError(null)} />
      {disabled && (
        <div className="banner banner-info" role="status">
          Fitur Inquiry Rekening tidak aktif di paket kamu.{' '}
          <Link href="/member/subscription">Lihat paket &amp; upgrade</Link> untuk mengaktifkannya.
        </div>
      )}
      {!disabled && usage && (
        <div className="banner banner-info" role="status">
          {usage.limit_today === null || usage.limit_today === undefined
            ? 'Inquiry Rekening: Tanpa batas'
            : `Inquiry Rekening: ${inquiryUsageText(usage)}`}
        </div>
      )}

      <Card title="Cek Rekening">
        <form onSubmit={submit}>
          <div className="form-grid">
            <Field label="Bank">
              <select
                value={bankCode}
                onChange={(e) => setBankCode(e.target.value)}
                disabled={banksLoading}
              >
                {banks.map((b) => (
                  <option key={b.code} value={b.code}>
                    {bankLabel(b)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Nomor rekening" hint="5–20 digit angka.">
              <input
                required
                inputMode="numeric"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="mis. 1234567890"
              />
            </Field>
          </div>
          <div className="row-actions">
            <Button type="submit" disabled={busy || banksLoading}>
              {busy ? 'Memeriksa…' : 'Cek Nama Pemilik'}
            </Button>
          </div>
        </form>
      </Card>

      {result && (
        <Card title="Hasil Inquiry">
          <dl>
            <dt>Nama pemilik</dt>
            <dd><strong>{result.account_name}</strong></dd>
            <dt>Bank</dt>
            <dd>{result.bank_name} ({result.bank_code})</dd>
            <dt>Nomor rekening</dt>
            <dd className="mono">{result.account_number}</dd>
          </dl>
        </Card>
      )}
      {banksLoading && <Loading />}
    </>
  );
}
