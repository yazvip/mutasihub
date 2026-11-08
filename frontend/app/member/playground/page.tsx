'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { apiGet, apiPost, friendlyError, isApiError } from '../../../lib/api';
import { formatAmount, formatDateWIB } from '../../../lib/format';
import { bankLabel, loadBanks, type Bank } from '../../../lib/banks';
import {
  Button,
  Card,
  ErrorBanner,
  Field,
  Loading,
  PageHeading,
} from '../../../components/ui';

// Playground member — model "Coba Cek Live" Rajacek: tab Live (jalur asli,
// inquiry ikut gate paket) dan tab Demo (data palsu, tanpa sentuh provider).
// Live Inquiry: POST /api/v1/inquiry/bank-account.
// Live Mutasi: GET /api/v1/mutasi -> {data: [{provider, date, type,
//   amount_cents, description, sender}]}.

type Mutasi = {
  provider?: string;
  type?: string;
  sender?: string;
  amount_cents?: number;
  description?: string;
  date?: string;
};

type InquiryResult = {
  account_name: string;
  account_number: string;
  bank_code: string;
  bank_name: string;
};

const DEMO_INQUIRY: (InquiryResult & { label: string })[] = [
  { label: 'BCA · 1234567890', account_name: 'BUDI SANTOSO', account_number: '1234567890', bank_code: '014', bank_name: 'Bank Central Asia (BCA)' },
  { label: 'Mandiri · 9876543210', account_name: 'SITI RAHMA', account_number: '9876543210', bank_code: '008', bank_name: 'Bank Mandiri' },
  { label: 'BRI · 1122334455', account_name: 'PT MAJU BERSAMA', account_number: '1122334455', bank_code: '002', bank_name: 'Bank Rakyat Indonesia (BRI)' },
];

const DEMO_MUTASI: Mutasi[] = [
  { provider: 'DANA', sender: 'Budi Santoso', amount_cents: 15000000, type: 'CR', date: new Date().toISOString(), description: 'Top-up saldo' },
  { provider: 'BCA', sender: 'PT Maju Bersama', amount_cents: 250000000, type: 'CR', date: new Date(Date.now() - 42 * 60000).toISOString(), description: 'Pembayaran invoice #INV-1042' },
  { provider: 'DANA', sender: 'Siti Rahma', amount_cents: 7500000, type: 'CR', date: new Date(Date.now() - 96 * 60000).toISOString(), description: 'Deposit member' },
  { provider: 'BCA', sender: 'CV Digital Nusantara', amount_cents: 48000000, type: 'CR', date: new Date(Date.now() - 3 * 3600000).toISOString(), description: 'Deposit paket Pro' },
];

function RawJson({ data }: { data: unknown }) {
  if (data === null || data === undefined) return null;
  return (
    <Card title="Respons mentah">
      <pre className="raw-json">{JSON.stringify(data, null, 2)}</pre>
    </Card>
  );
}

function MutasiTable({ rows }: { rows: Mutasi[] }) {
  if (rows.length === 0) {
    return <p className="muted">Belum ada mutasi.</p>;
  }
  return (
    <div className="table-wrap">
      <table style={{ minWidth: 0 }}>
        <thead>
          <tr><th>Pengirim</th><th>Waktu</th><th className="num">Nominal</th></tr>
        </thead>
        <tbody>
          {rows.map((m, i) => (
            <tr key={i}>
              <td>
                <strong>{m.sender ?? '-'}</strong>
                <br />
                <span className="muted">{m.provider ?? '-'} · {m.description ?? ''}</span>
              </td>
              <td>{m.date ? formatDateWIB(m.date) : '-'}</td>
              <td className="num pos">{formatAmount((m.amount_cents ?? 0) / 100)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MemberPlaygroundPage() {
  const [mode, setMode] = useState<'live' | 'demo'>('live');
  const [tool, setTool] = useState<'inquiry' | 'mutasi'>('inquiry');
  const [banks, setBanks] = useState<Bank[]>([]);
  const [bankCode, setBankCode] = useState('014');
  const [accountNumber, setAccountNumber] = useState('');
  const [demoChoice, setDemoChoice] = useState(0);
  const [result, setResult] = useState<any>(null);
  const [mutasi, setMutasi] = useState<Mutasi[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadBanks().then((list) => {
      setBanks(list);
      setLoaded(true);
    });
  }, []);

  function reset() {
    setResult(null);
    setMutasi([]);
    setError(null);
    setDisabled(false);
  }

  async function runLiveInquiry(e: FormEvent) {
    e.preventDefault();
    reset();
    setBusy(true);
    try {
      const d = await apiPost<InquiryResult>('/api/v1/inquiry/bank-account', {
        bank_code: bankCode,
        account_number: accountNumber.trim(),
      });
      setResult(d);
    } catch (err) {
      if (isApiError(err) && err.code === 'inquiry_disabled') {
        setDisabled(true);
      } else {
        setError(friendlyError(err));
      }
    } finally {
      setBusy(false);
    }
  }

  async function runLiveMutasi() {
    reset();
    setBusy(true);
    try {
      const d = await apiGet<any>('/api/v1/mutasi');
      const list = Array.isArray(d) ? d : d?.data ?? d?.mutasi ?? [];
      setMutasi(Array.isArray(list) ? list.slice(0, 10) : []);
      setResult(d);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  function runDemoInquiry(e: FormEvent) {
    e.preventDefault();
    reset();
    setResult(DEMO_INQUIRY[demoChoice]);
  }

  function runDemoMutasi() {
    reset();
    setMutasi(DEMO_MUTASI);
    setResult({ demo: true, count: DEMO_MUTASI.length, data: DEMO_MUTASI });
  }

  return (
    <>
      <PageHeading eyebrow="Uji integrasi" title="Playground" description="Coba inquiry rekening dan cek mutasi — lewat jalur asli, atau dengan data demo." />

      <div className="tabs" role="tablist">
        <button type="button" className={`tab${mode === 'live' ? ' active' : ''}`} onClick={() => { setMode('live'); reset(); }}>
          Live
        </button>
        <button type="button" className={`tab${mode === 'demo' ? ' active' : ''}`} onClick={() => { setMode('demo'); reset(); }}>
          Demo
        </button>
      </div>
      {mode === 'demo' && (
        <p className="demo-note">
          Mode demo — semua data di bawah ini palsu dan tidak menyentuh provider sama sekali.
        </p>
      )}

      <div className="tabs" role="tablist">
        <button type="button" className={`tab${tool === 'inquiry' ? ' active' : ''}`} onClick={() => { setTool('inquiry'); reset(); }}>
          Inquiry Rekening
        </button>
        <button type="button" className={`tab${tool === 'mutasi' ? ' active' : ''}`} onClick={() => { setTool('mutasi'); reset(); }}>
          Cek Mutasi
        </button>
      </div>

      <ErrorBanner message={error} onClose={() => setError(null)} />
      {disabled && (
        <div className="banner banner-info" role="status">
          Fitur Inquiry Rekening tidak aktif di paket kamu.{' '}
          <Link href="/member/subscription">Lihat paket &amp; upgrade</Link> untuk mengaktifkannya.
        </div>
      )}

      {tool === 'inquiry' && mode === 'live' && (
        <Card title="Inquiry Rekening — Live">
          <form onSubmit={runLiveInquiry}>
            <div className="form-grid">
              <Field label="Bank">
                <select value={bankCode} onChange={(e) => setBankCode(e.target.value)} disabled={!loaded}>
                  {banks.map((b) => (
                    <option key={b.code} value={b.code}>{bankLabel(b)}</option>
                  ))}
                </select>
              </Field>
              <Field label="Nomor rekening" hint="5–20 digit angka. Mengikuti gate paket kamu.">
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
              <Button type="submit" disabled={busy || !loaded}>{busy ? 'Memeriksa…' : 'Cek Nama Pemilik'}</Button>
            </div>
          </form>
          {result && (
            <div style={{ marginTop: 16 }}>
              <dl>
                <dt>Nama pemilik</dt>
                <dd><strong>{result.account_name}</strong></dd>
                <dt>Bank</dt>
                <dd>{result.bank_name} ({result.bank_code})</dd>
                <dt>Nomor rekening</dt>
                <dd className="mono">{result.account_number}</dd>
              </dl>
            </div>
          )}
        </Card>
      )}

      {tool === 'inquiry' && mode === 'demo' && (
        <Card title="Inquiry Rekening — Demo">
          <form onSubmit={runDemoInquiry}>
            <Field label="Rekening contoh">
              <select value={demoChoice} onChange={(e) => setDemoChoice(Number(e.target.value))}>
                {DEMO_INQUIRY.map((d, i) => (
                  <option key={i} value={i}>{d.label} — {d.account_name}</option>
                ))}
              </select>
            </Field>
            <div className="row-actions">
              <Button type="submit">Tampilkan Hasil Demo</Button>
            </div>
          </form>
          {result && (
            <div style={{ marginTop: 16 }}>
              <dl>
                <dt>Nama pemilik</dt>
                <dd><strong>{result.account_name}</strong></dd>
                <dt>Bank</dt>
                <dd>{result.bank_name} ({result.bank_code})</dd>
                <dt>Nomor rekening</dt>
                <dd className="mono">{result.account_number}</dd>
              </dl>
            </div>
          )}
        </Card>
      )}

      {tool === 'mutasi' && mode === 'live' && (
        <Card title="Cek Mutasi — Live">
          <p className="muted">Mengambil 10 mutasi terbaru dari rekening kamu yang terhubung.</p>
          <div className="row-actions">
            <Button onClick={runLiveMutasi} disabled={busy}>{busy ? 'Memuat…' : 'Muat Mutasi'}</Button>
          </div>
          <div style={{ marginTop: 16 }}>
            <MutasiTable rows={mutasi} />
          </div>
        </Card>
      )}

      {tool === 'mutasi' && mode === 'demo' && (
        <Card title="Cek Mutasi — Demo">
          <p className="muted">Contoh mutasi masuk — data palsu untuk melihat tampilan.</p>
          <div className="row-actions">
            <Button onClick={runDemoMutasi}>Tampilkan Mutasi Demo</Button>
          </div>
          <div style={{ marginTop: 16 }}>
            <MutasiTable rows={mutasi} />
          </div>
        </Card>
      )}

      {!loaded && mode === 'live' && tool === 'inquiry' && <Loading />}
      <RawJson data={result} />
    </>
  );
}
