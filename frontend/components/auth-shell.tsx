// Shell auth bersama untuk /login dan /register — bahasa visual yang sama
// dengan landing baru (v23): Tailwind di-scope .landing-tw (preflight MATI),
// brand emerald, bg-grid-pattern + ambient blur, kartu putih rounded-2xl.
// JANGAN pakai komponen Field/Button/ErrorBanner dari components/ui.tsx di
// sini — CSS panel-nya (.field, .btn-primary hijau bottle-green, dsb.)
// akan bocor ke halaman auth. Semua kontrol di bawah ini murni Tailwind.
import type { ReactNode } from 'react';

export const authInputCls =
  'w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20';

export function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.3h6.5c-.1 1.1-.8 2.7-2.4 3.8l3.7 2.9c2.3-2.1 3.7-5.2 3.7-9z" />
      <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.7-2.9c-1 .7-2.4 1.2-4.2 1.2-3.2 0-5.9-2.1-6.8-5l-3.9 3C3.3 21.3 7.3 24 12 24z" />
      <path fill="#FBBC05" d="M5.2 14.4c-.2-.7-.4-1.5-.4-2.4s.1-1.7.4-2.4l-3.9-3C.5 8.2 0 10 0 12s.5 3.8 1.3 5.4l3.9-3z" />
      <path fill="#EA4335" d="M12 4.7c1.8 0 3 .8 3.7 1.4l3.3-3.2C17.9 1.1 15.2 0 12 0 7.3 0 3.3 2.7 1.3 6.6l3.9 3c.9-2.8 3.6-4.9 6.8-4.9z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-brand-600" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
  );
}

export function AuthField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block mb-4">
      <span className="block text-sm font-semibold text-slate-700 mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-500 mt-1.5 leading-relaxed">{hint}</span>}
    </label>
  );
}

export function AuthButton({ disabled, children }: { disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-brand-600 hover:bg-brand-700 active:scale-[0.98] text-white font-bold rounded-xl shadow-lg shadow-brand-600/25 transition-all text-sm disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

export function GoogleButton({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="w-full inline-flex items-center justify-center gap-2.5 px-4 py-3 bg-white hover:bg-slate-50 border border-slate-300 hover:border-slate-400 text-slate-700 font-semibold rounded-xl transition-all text-sm"
    >
      <GoogleIcon />
      {label}
    </a>
  );
}

export function AuthDivider() {
  return (
    <div className="flex items-center gap-3 text-xs text-slate-400 my-5" role="separator">
      <span className="flex-1 border-t border-slate-200" />
      <span>atau</span>
      <span className="flex-1 border-t border-slate-200" />
    </div>
  );
}

export function AuthAlert({
  tone,
  onClose,
  children,
}: {
  tone: 'error' | 'info';
  onClose?: () => void;
  children: ReactNode;
}) {
  const cls =
    tone === 'error'
      ? 'bg-rose-50 border-rose-200 text-rose-800'
      : 'bg-sky-50 border-sky-200 text-sky-800';
  return (
    <div role="alert" className={`mb-4 rounded-xl border px-4 py-3 text-sm leading-relaxed ${cls}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">{children}</div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="shrink-0 text-lg leading-none opacity-60 hover:opacity-100 transition-opacity"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="landing-tw bg-[#fafbfc] text-slate-800 font-sans antialiased selection:bg-brand-500 selection:text-white min-h-screen flex flex-col bg-grid-pattern relative overflow-hidden">
      {/* Ambient blur ala hero landing. */}
      <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-[600px] h-[350px] bg-gradient-to-tr from-brand-200/40 to-emerald-200/30 blur-3xl pointer-events-none rounded-full" />

      <main className="relative flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-10 sm:py-14">
        <div className="w-full max-w-[440px] mb-5">
          <a
            href="/"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-brand-600 transition-colors"
          >
            ← Kembali ke beranda
          </a>
        </div>

        {/* Logo brand — sama seperti header landing. */}
        <a href="/" className="flex items-center gap-2.5 group mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-brand-700 via-brand-600 to-emerald-400 flex items-center justify-center text-white font-extrabold text-xl shadow-md shadow-brand-700/20 group-hover:scale-105 transition-transform">
            M
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="text-xl font-extrabold tracking-tight text-slate-900">
                Mutasi<span className="text-brand-600">Hub</span>
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200">
                PRO
              </span>
            </div>
            <span className="text-[10px] text-slate-400 font-medium tracking-tight -mt-0.5">
              Automated Financial Sync
            </span>
          </div>
        </a>

        <div className="w-full max-w-[440px] bg-white rounded-2xl border border-slate-200/80 shadow-premium p-6 sm:p-8">
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 text-center">{title}</h1>
          <p className="mt-1.5 text-sm text-slate-500 text-center leading-relaxed">{subtitle}</p>
          <div className="mt-6">{children}</div>
        </div>

        {/* Trust badge — sama seperti hero landing. */}
        <div className="w-full max-w-[440px] mt-6 flex items-center justify-center gap-5 text-xs font-semibold text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <CheckIcon /> Read-Only
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CheckIcon /> AES-256
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CheckIcon /> No Credit Card
          </span>
        </div>
        <p className="w-full max-w-[440px] mt-3 text-center text-[11px] leading-relaxed text-slate-400">
          MutasiHub bukan afiliasi atau bagian resmi dari Bank BCA atau DANA Indonesia.
        </p>
      </main>
    </div>
  );
}
