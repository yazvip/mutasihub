'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { apiGet, apiPost, friendlyError, isApiError } from '../../../lib/api';
import { formatAmount, formatDateWIB } from '../../../lib/format';
import { loadBanks, type Bank } from '../../../lib/banks';
import {
  Button,
  Card,
  ErrorBanner,
  PageHeading,
} from '../../../components/ui';
import {
  InquiryBankForm,
  InquiryPremiumShell,
  type InquiryQuota,
} from '../../../components/inquiry-premium';

// Playground member — model "Coba Cek Live" Rajacek: tab Live (jalur asli,
// inquiry ikut gate paket) dan tab Demo (data palsu, tanpa sentuh provider).
// Live Inquiry: POST /api/v1/inquiry/bank-account.
// Live Mutasi: GET /api/v1/mutasi -> {data: [{provider, date, type,
//   amount_cents, description, sender}]}.
// v35: bagian inquiry memakai InquiryPremiumShell (layout referensi user:
// header badge + chip endpoint, kartu kuota, kartu form, kartu hasil
// Card/JSON Raw, promo Docs API). Tool Cek Mutasi tidak berubah.

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
  const [usage, setUsage] = useState<InquiryQuota>({ kind: 'loading' });
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [queryAt, setQueryAt] = useState<Date | null>(null);

  useEffect(() => {
    loadBanks().then((list) => {
      setBanks(list);
      setLoaded(true);
    });
  }, []);

  async function loadUsage() {
    try {
      const u = await apiGet<any>('/api/v1/inquiry/usage');
      setUsage({ kind: 'member', used: u?.used_today ?? 0, limit: u?.limit_today ?? null });
      if (u?.inquiry_enabled === false) setDisabled(true);
    } catch (err) {
      if (isApiError(err) && err.code === 'inquiry_disabled') {
        setDisabled(true);
        setUsage({ kind: 'off', message: 'Fitur Inquiry Rekening tidak aktif di paket kamu.' });
      } else {
        setUsage({ kind: 'off', message: 'Kuota tidak dapat dimuat.' });
      }
    }
  }

  useEffect(() => {
    if (tool !== 'inquiry') return;
    setUsage({ kind: 'loading' });
    loadUsage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  function reset() {
    setResult(null);
    setMutasi([]);
    setError(null);
    setDisabled(false);
    setLatencyMs(null);
    setQueryAt(null);
  }

  async function runLiveInquiry(e: FormEvent) {
    e.preventDefault();
    reset();
    setBusy(true);
    const t0 = performance.now();
    try {
      const d = await apiPost<InquiryResult>('/api/v1/inquiry/bank-account', {
        bank_code: bankCode,
        account_number: accountNumber.trim(),
      });
      setResult(d);
      setLatencyMs(performance.now() - t0);
      setQueryAt(new Date());
      loadUsage();
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
    const t0 = performance.now();
    setResult(DEMO_INQUIRY[demoChoice]);
    setLatencyMs(performance.now() - t0);
    setQueryAt(new Date());
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
        <InquiryPremiumShell
          endpoint="/api/v1/inquiry/bank-account"
          quota={usage}
          bankCount={banks.length}
          form={(
            <InquiryBankForm
              banks={banks}
              bankCode={bankCode}
              onBankCodeChange={setBankCode}
              accountNumber={accountNumber}
              onAccountNumberChange={setAccountNumber}
              onSubmit={runLiveInquiry}
              busy={busy}
              loaded={loaded}
            />
          )}
          result={result}
          rawResult={result}
          latencyMs={latencyMs}
          queryAt={queryAt}
        />
      )}

      {tool === 'inquiry' && mode === 'demo' && (
        <InquiryPremiumShell
          endpoint="/api/v1/inquiry/bank-account"
          quota={usage}
          bankCount={banks.length}
          form={(
            <form onSubmit={runDemoInquiry}>
              <div className="inq-field">
                <div className="inq-label-row">
                  <label htmlFor="inq-demo">Rekening contoh</label>
                </div>
                <select id="inq-demo" value={demoChoice} onChange={(e) => setDemoChoice(Number(e.target.value))}>
                  {DEMO_INQUIRY.map((d, i) => (
                    <option key={i} value={i}>{d.label} — {d.account_name}</option>
                  ))}
                </select>
              </div>
              <button type="submit" className="inq-submit">Tampilkan Hasil Demo</button>
            </form>
          )}
          result={result}
          rawResult={result}
          latencyMs={latencyMs}
          queryAt={queryAt}
        />
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

      {tool === 'mutasi' && <RawJson data={result} />}
    </>
  );
}
