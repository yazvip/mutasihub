'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { apiGet, apiPost, friendlyError } from '../../../lib/api';
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

// Playground admin — uji jalur Connecta dari panel admin.
// Live: kuota, tes koneksi, daftar bank, inquiry (endpoint admin, tanpa
// gate paket). Demo: respons palsu yang sudah disiapkan, tanpa sentuh
// provider.
// v35: bagian inquiry memakai InquiryPremiumShell (layout referensi user:
// header badge + chip endpoint, kartu kuota, kartu form, kartu hasil
// Card/JSON Raw, promo Docs API). Tool Kuota/Tes/Banks tidak berubah.

const DEMO_QUOTA = {
  success: true,
  data: { is_demo: true, status: 'ACTIVE', expired_at: '2026-12-06', max_dana_accounts: 5, max_bca_accounts: 1 },
};
const DEMO_TEST = { docs_ok: true, quota_ok: true, docs: 'OK', quota: 'OK' };
const DEMO_BANKS = {
  banks: [
    { code: '014', name: 'Bank Central Asia (BCA)' },
    { code: '008', name: 'Bank Mandiri' },
    { code: '002', name: 'Bank Rakyat Indonesia (BRI)' },
  ],
};
const DEMO_INQUIRY = {
  success: true,
  message: 'Inquiry rekening bank berhasil',
  data: { account_name: 'BUDI SANTOSO', account_number: '1234567890', bank_code: '014', bank_name: 'Bank Central Asia (BCA)' },
};

type Tool = 'quota' | 'test' | 'banks' | 'inquiry';

const TOOLS: { id: Tool; label: string }[] = [
  { id: 'quota', label: 'Kuota Connecta' },
  { id: 'test', label: 'Tes Koneksi' },
  { id: 'banks', label: 'Daftar Bank' },
  { id: 'inquiry', label: 'Inquiry Rekening' },
];

// Parser defensif untuk GET /api/v1/admin/connecta/quota (raw envelope
// Connecta /b2b/quota — bentuknya tidak dikontrak seketat endpoint lain).
function parseAdminQuota(d: any): InquiryQuota {
  const o = d?.data ?? d ?? {};
  const status = typeof o?.status === 'string' ? o.status : '—';
  const expiresAt =
    typeof o?.expired_at === 'string'
      ? o.expired_at
      : typeof o?.expires_at === 'string'
        ? o.expires_at
        : null;
  const maxDana = typeof o?.max_dana_accounts === 'number' ? o.max_dana_accounts : null;
  const maxBca = typeof o?.max_bca_accounts === 'number' ? o.max_bca_accounts : null;
  return { kind: 'admin', status, expiresAt, maxDana, maxBca, isDemo: o?.is_demo === true };
}

export default function AdminPlaygroundPage() {
  const [mode, setMode] = useState<'live' | 'demo'>('live');
  const [tool, setTool] = useState<Tool>('quota');
  const [banks, setBanks] = useState<Bank[]>([]);
  const [bankCode, setBankCode] = useState('014');
  const [accountNumber, setAccountNumber] = useState('');
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [quota, setQuota] = useState<InquiryQuota>({ kind: 'loading' });
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [queryAt, setQueryAt] = useState<Date | null>(null);

  useEffect(() => {
    loadBanks('/api/v1/admin/connecta/banks').then((list) => {
      setBanks(list);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (tool !== 'inquiry') return;
    if (mode === 'demo') {
      setQuota(parseAdminQuota(DEMO_QUOTA));
      return;
    }
    setQuota({ kind: 'loading' });
    apiGet<any>('/api/v1/admin/connecta/quota')
      .then((d) => setQuota(parseAdminQuota(d)))
      .catch(() => setQuota({ kind: 'off', message: 'Kuota Connecta tidak dapat dimuat.' }));
  }, [tool, mode]);

  function reset() {
    setResult(null);
    setError(null);
    setLatencyMs(null);
    setQueryAt(null);
  }

  async function runLive() {
    reset();
    setBusy(true);
    try {
      let d: any;
      if (tool === 'quota') d = await apiGet<any>('/api/v1/admin/connecta/quota');
      else if (tool === 'test') d = await apiPost<any>('/api/v1/admin/connecta/test', {});
      else if (tool === 'banks') d = await apiGet<any>('/api/v1/admin/connecta/banks');
      else {
        const t0 = performance.now();
        d = await apiPost<any>('/api/v1/admin/connecta/dana/account-inquiry', {
          bank_code: bankCode,
          account_number: accountNumber.trim(),
        });
        setLatencyMs(performance.now() - t0);
        setQueryAt(new Date());
      }
      setResult(d);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  function runDemo(e?: FormEvent) {
    e?.preventDefault();
    reset();
    const t0 = performance.now();
    if (tool === 'quota') setResult(DEMO_QUOTA);
    else if (tool === 'test') setResult(DEMO_TEST);
    else if (tool === 'banks') setResult(DEMO_BANKS);
    else {
      setResult(DEMO_INQUIRY);
      setLatencyMs(performance.now() - t0);
      setQueryAt(new Date());
    }
  }

  const inquiryResult = result?.data ?? null;

  return (
    <>
      <PageHeading eyebrow="Uji integrasi" title="Playground" description="Uji jalur Connecta dari panel admin — kuota, koneksi, daftar bank, dan inquiry rekening." />

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
          Mode demo — semua respons di bawah ini palsu dan tidak menyentuh provider sama sekali.
        </p>
      )}

      <div className="tabs" role="tablist">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tab${tool === t.id ? ' active' : ''}`}
            onClick={() => { setTool(t.id); reset(); }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <ErrorBanner message={error} onClose={() => setError(null)} />

      {tool === 'inquiry' ? (
        <InquiryPremiumShell
          endpoint="/api/v1/admin/connecta/dana/account-inquiry"
          quota={quota}
          bankCount={banks.length}
          form={(
            <InquiryBankForm
              banks={banks}
              bankCode={bankCode}
              onBankCodeChange={setBankCode}
              accountNumber={accountNumber}
              onAccountNumberChange={setAccountNumber}
              onSubmit={(e) => {
                if (mode === 'live') {
                  e.preventDefault();
                  runLive();
                } else {
                  runDemo(e);
                }
              }}
              busy={busy}
              loaded={loaded}
              accountHint={mode === 'live' ? 'Dikirim ke Connecta apa adanya.' : 'Demo: nomor apa pun menampilkan Budi Santoso.'}
            />
          )}
          result={inquiryResult}
          rawResult={result}
          latencyMs={latencyMs}
          queryAt={queryAt}
        />
      ) : (
        <Card title={`${TOOLS.find((t) => t.id === tool)?.label} — ${mode === 'live' ? 'Live' : 'Demo'}`}>
          <p className="muted">
            {tool === 'quota' && 'Membaca kuota partner Connecta (status demo, masa berlaku, batas akun DANA/BCA).'}
            {tool === 'test' && 'Memanggil docs + quota Connecta untuk memastikan kunci API masih hidup.'}
            {tool === 'banks' && 'Memuat daftar kode bank dari Connecta.'}
          </p>
          <div className="row-actions">
            <Button onClick={() => (mode === 'live' ? runLive() : runDemo())} disabled={busy}>
              {busy ? 'Menjalankan…' : 'Jalankan'}
            </Button>
          </div>
        </Card>
      )}

      {tool !== 'inquiry' && result !== null && result !== undefined && (
        <Card title="Respons mentah">
          <pre className="raw-json">{JSON.stringify(result, null, 2)}</pre>
        </Card>
      )}
    </>
  );
}
