'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { formatDateWIB } from '../lib/format';
import { bankLabel, type Bank } from '../lib/banks';

// ---------- v35: Inquiry premium (dipakai Playground member + admin) ----------
// Layout mengikuti referensi user (screenshot 26418_1_dmq2.jpg): header
// badge + chip endpoint, kartu kuota + progress bar, kartu form, kartu
// hasil (toggle Card/JSON Raw, kotak hijau nama pemilik + Salin, detail
// bank + nomor rekening, footer waktu query + latency), kartu promo Docs.
// Komponen ini murni presentasional: data + pemanggilan API tetap di
// halaman pemakai (member: /api/v1/inquiry/*; admin: /api/v1/admin/*).
// Semua gaya di .inquiry-premium (globals.css) — kelas unik, tidak bocor
// ke halaman lain di kedua panel.

export type InquiryResultData = {
  account_name: string;
  account_number: string;
  bank_code: string;
  bank_name: string;
};

export type InquiryQuota =
  | { kind: 'member'; used: number; limit: number | null }
  | {
      kind: 'admin';
      status: string;
      expiresAt?: string | null;
      maxDana?: number | null;
      maxBca?: number | null;
      isDemo?: boolean;
    }
  | { kind: 'off'; message: string }
  | { kind: 'loading' };

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CopyButton({ text, label = 'Salin' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  async function onClick() {
    const ok = await copyText(text);
    if (!ok) return;
    setCopied(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button type="button" className="inq-copy-btn" onClick={onClick}>
      <CopyIcon />
      {copied ? 'Disalin' : label}
    </button>
  );
}

function CopyIconButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  async function onClick() {
    const ok = await copyText(text);
    if (!ok) return;
    setCopied(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button
      type="button"
      className={`inq-copy-icon${copied ? ' copied' : ''}`}
      onClick={onClick}
      aria-label={copied ? 'Disalin' : label}
      title={copied ? 'Disalin' : label}
    >
      <CopyIcon />
    </button>
  );
}

function SearchIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 7H4a2 2 0 0 1 0-4h14a2 2 0 0 1 2 2v2z" />
      <path d="M2 5v14a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2" />
      <circle cx="17" cy="14" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" opacity="0.15" />
      <path d="m8.5 12.2 2.4 2.4 4.6-5" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <path d="M3 6h.01" />
      <path d="M3 12h.01" />
      <path d="M3 18h.01" />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m16 18 6-6-6-6" />
      <path d="m8 6-6 6 6 6" />
    </svg>
  );
}

function formatPct(pct: number): string {
  const p = Math.max(0, Math.min(100, pct));
  return (Number.isInteger(p) ? String(p) : p.toFixed(1).replace('.', ',')) + '%';
}

function QuotaCard({ quota }: { quota: InquiryQuota }) {
  if (quota.kind === 'loading') {
    return (
      <div className="inq-card inq-quota">
        <span className="inq-quota-icon"><BoltIcon /></span>
        <div className="inq-quota-body">
          <div className="inq-quota-title">Memuat kuota…</div>
          <div className="inq-bar"><span className="inq-bar-fill" style={{ width: '0%' }} /></div>
        </div>
      </div>
    );
  }
  if (quota.kind === 'off') {
    return (
      <div className="inq-card inq-quota">
        <span className="inq-quota-icon"><BoltIcon /></span>
        <div className="inq-quota-body">
          <div className="inq-quota-title">{quota.message}</div>
        </div>
      </div>
    );
  }
  if (quota.kind === 'member') {
    const { used, limit } = quota;
    const pct = limit === null ? 100 : ((limit - used) / limit) * 100;
    return (
      <div className="inq-card inq-quota">
        <span className="inq-quota-icon"><BoltIcon /></span>
        <div className="inq-quota-body">
          <div className="inq-quota-title">
            Kuota Inquiry Hari Ini:{' '}
            {limit === null ? (
              <b>Tanpa batas</b>
            ) : (
              <>
                <b>{used.toLocaleString('id-ID')}</b>
                {' / '}
                <span className="inq-quota-limit">{limit.toLocaleString('id-ID')} hit</span>
              </>
            )}
          </div>
          <div className="inq-quota-sub">Reset otomatis pada pukul 00:00 WIB</div>
          <div className="inq-quota-progress">
            <span>Tersedia</span>
            <span className="inq-quota-pct">{formatPct(pct)}</span>
          </div>
          <div className="inq-bar"><span className="inq-bar-fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>
        </div>
      </div>
    );
  }
  const pct = 100;
  return (
    <div className="inq-card inq-quota">
      <span className="inq-quota-icon"><BoltIcon /></span>
      <div className="inq-quota-body">
        <div className="inq-quota-title">
          Kuota Connecta: <b>{quota.status}</b>
          {quota.isDemo ? <span className="inq-chip">Demo</span> : null}
        </div>
        <div className="inq-quota-sub">
          {quota.expiresAt ? `Berlaku hingga ${formatDateWIB(quota.expiresAt, false)}` : 'Masa berlaku tidak tercatat'}
          {quota.maxDana !== null && quota.maxDana !== undefined ? ` · Batas akun: ${quota.maxDana} DANA` : ''}
          {quota.maxBca !== null && quota.maxBca !== undefined ? ` · ${quota.maxBca} BCA` : ''}
        </div>
        <div className="inq-quota-sub">Tanpa batas harian (jalur admin)</div>
        <div className="inq-quota-progress">
          <span>Tersedia</span>
          <span className="inq-quota-pct">{formatPct(pct)}</span>
        </div>
        <div className="inq-bar"><span className="inq-bar-fill" style={{ width: '100%' }} /></div>
      </div>
    </div>
  );
}

// Form standar inquiry: select bank + nomor rekening + tombol Paste +
// tombol submit premium. Dipakai Live member dan Live/Demo admin.
export function InquiryBankForm(props: {
  banks: Bank[];
  bankCode: string;
  onBankCodeChange: (v: string) => void;
  accountNumber: string;
  onAccountNumberChange: (v: string) => void;
  onSubmit: (e: FormEvent) => void;
  busy: boolean;
  loaded: boolean;
  submitLabel?: string;
  accountHint?: string;
}) {
  const {
    banks, bankCode, onBankCodeChange, accountNumber, onAccountNumberChange,
    onSubmit, busy, loaded, submitLabel = 'Cek Nama Pemilik Sekarang', accountHint,
  } = props;
  const [pasteError, setPasteError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handlePaste() {
    setPasteError(null);
    try {
      const text = await navigator.clipboard.readText();
      const digits = text.replace(/[^0-9]/g, '');
      if (!digits) {
        setPasteError('Clipboard tidak berisi angka.');
        return;
      }
      onAccountNumberChange(digits.slice(0, 20));
      inputRef.current?.focus();
    } catch {
      setPasteError('Izin clipboard ditolak — tempel manual dengan Ctrl+V.');
      inputRef.current?.focus();
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="inq-field">
        <div className="inq-label-row">
          <label htmlFor="inq-bank">Pilih Bank Tujuan <span className="inq-required">*</span></label>
          <span className="inq-label-hint">Kode Bank</span>
        </div>
        <select
          id="inq-bank"
          value={bankCode}
          onChange={(e) => onBankCodeChange(e.target.value)}
          disabled={!loaded}
        >
          {banks.map((b) => (
            <option key={b.code} value={b.code}>{bankLabel(b)} — {b.code}</option>
          ))}
        </select>
      </div>
      <div className="inq-field">
        <div className="inq-label-row">
          <label htmlFor="inq-account">Nomor Rekening / Virtual Account <span className="inq-required">*</span></label>
          <span className="inq-label-hint">5 – 20 Digit</span>
        </div>
        <div className="inq-input-wrap">
          <input
            ref={inputRef}
            id="inq-account"
            required
            inputMode="numeric"
            className="mono"
            value={accountNumber}
            onChange={(e) => onAccountNumberChange(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="mis. 1234567890"
          />
          <button type="button" className="inq-paste" onClick={handlePaste}>
            Paste
          </button>
        </div>
        <p className="inq-hint">Hanya angka tanpa spasi atau tanda hubung (-).</p>
        {accountHint ? <p className="inq-hint">{accountHint}</p> : null}
        {pasteError ? <p className="inq-hint inq-hint-warn">{pasteError}</p> : null}
      </div>
      <button type="submit" className="inq-submit" disabled={busy || !loaded}>
        <SearchIcon />
        {busy ? 'Memeriksa…' : submitLabel}
      </button>
    </form>
  );
}

function formatLatency(ms: number | null): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1) return '<1ms';
  return `${Math.round(ms)}ms`;
}

export function InquiryPremiumShell(props: {
  endpoint: string;
  quota: InquiryQuota;
  bankCount: number;
  form: ReactNode;
  result: InquiryResultData | null;
  rawResult: unknown;
  latencyMs: number | null;
  queryAt: Date | null;
}) {
  const { endpoint, quota, bankCount, form, result, rawResult, latencyMs, queryAt } = props;
  const [view, setView] = useState<'card' | 'json'>('card');
  const resultKey = result ? `${result.bank_code}:${result.account_number}` : '';
  useEffect(() => {
    setView('card');
  }, [resultKey]);

  return (
    <div className="inquiry-premium">
      <div className="inq-head">
        <div className="inq-head-top">
          <span className="inq-badge"><span className="inq-dot" />CEK NAMA PEMILIK</span>
          <span className="inq-endpoint">Endpoint: <code>{endpoint}</code></span>
        </div>
        <h2 className="inq-title">Inquiry Rekening Bank</h2>
        <p className="inq-desc">
          Verifikasi nama resmi pemilik rekening bank secara instan sebelum melakukan proses transfer atau refund.
          Data langsung dari database bank penerbit.
        </p>
      </div>

      <QuotaCard quota={quota} />

      <div className="inq-card">
        <div className="inq-form-head">
          <span className="inq-form-icon"><WalletIcon /></span>
          <h3>Form Cek Rekening</h3>
          <span className="inq-form-count">{bankCount} Bank &amp; E-Wallet</span>
        </div>
        {form}
      </div>

      {result ? (
        <div className="inq-card">
          <div className="inq-result-head">
            <h3>Hasil Inquiry</h3>
            <span className="inq-ok-badge">HTTP 200 OK</span>
          </div>
          <div className="inq-toggle" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'card'}
              className={view === 'card' ? 'active' : ''}
              onClick={() => setView('card')}
            >
              <ListIcon /> Tampilan Card (HTML)
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'json'}
              className={view === 'json' ? 'active' : ''}
              onClick={() => setView('json')}
            >
              <CodeIcon /> JSON Raw
            </button>
          </div>
          {view === 'card' ? (
            <>
              <div className="inq-result-name">
                <div className="inq-result-name-top">
                  <span className="inq-check"><CheckIcon /></span>
                  <span className="inq-result-label">NAMA RESMI PEMILIK REKENING</span>
                  <CopyButton text={result.account_name} />
                </div>
                <div className="inq-result-owner">{result.account_name}</div>
                <p className="inq-result-sub">Terverifikasi cocok dengan data core bank penerbit.</p>
              </div>
              <div className="inq-detail">
                <span className="inq-detail-label">BANK PENERBIT</span>
                <span className="inq-detail-value">{result.bank_name}</span>
                <span className="inq-chip">Kode Bank: {result.bank_code}</span>
              </div>
              <div className="inq-detail inq-detail-row">
                <div className="inq-detail-main">
                  <span className="inq-detail-label">NOMOR REKENING</span>
                  <span className="inq-detail-value mono">{result.account_number}</span>
                  <span className="inq-status-active">STATUS: AKTIF</span>
                </div>
                <CopyIconButton text={result.account_number} label="Salin nomor rekening" />
              </div>
              <div className="inq-result-foot">
                <span>Query Waktu: {queryAt ? formatDateWIB(queryAt.toISOString(), true) : '-'}</span>
                <span className="inq-latency"><span className="inq-latency-dot" />Latency: {formatLatency(latencyMs)}</span>
              </div>
            </>
          ) : (
            <pre className="raw-json">{JSON.stringify(rawResult, null, 2)}</pre>
          )}
        </div>
      ) : null}

      <div className="inq-card inq-promo">
        <span className="inq-promo-icon">API</span>
        <p>Ingin integrasi otomatis ke webhook atau aplikasi Anda?</p>
        <Link href="/docs" className="inq-promo-link">Docs API →</Link>
      </div>
    </div>
  );
}
