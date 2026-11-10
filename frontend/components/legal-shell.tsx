import type { ReactNode } from 'react';

// Shell halaman legal (Syarat & Ketentuan, Kebijakan Privasi).
// Server component — tanpa hook, supaya `export const metadata` di halaman
// bisa dipakai (SEO). Bahasa visual = landing v23: Tailwind di-scope
// `.landing-tw` (preflight MATI), brand-600 emerald, font Plus Jakarta Sans.

export type TocItem = { id: string; title: string };

const NAV = [
  { href: '/', label: 'Beranda' },
  { href: '/#fitur', label: 'Fitur' },
  { href: '/#harga', label: 'Harga' },
  { href: '/docs', label: 'Dokumentasi' },
];

function BrandMark() {
  return (
    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-extrabold text-base shadow-glow">
      M
    </div>
  );
}

export function LegalHeader() {
  return (
    <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-18 flex items-center justify-between">
        <a href="/" className="flex items-center gap-2.5 group">
          <BrandMark />
          <span className="text-lg font-bold text-slate-900 tracking-tight">MutasiHub</span>
          <span className="hidden sm:inline-flex ml-1 px-2 py-0.5 rounded-md bg-slate-100 text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500">
            Legal
          </span>
        </a>

        <nav className="hidden lg:flex items-center gap-8 text-sm font-semibold text-slate-600">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="hover:text-brand-600 transition-colors">
              {n.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <a
            href="/login"
            className="hidden sm:inline-flex px-4 py-2 text-sm font-semibold text-slate-700 hover:text-brand-700 transition-colors"
          >
            Masuk
          </a>
          <a
            href="/register"
            className="inline-flex items-center px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold shadow-sm transition-all active:scale-95"
          >
            Mulai Trial
          </a>
        </div>
      </div>
    </header>
  );
}

export function LegalFooter() {
  return (
    <footer className="bg-white border-t border-slate-200 pt-16 pb-12 text-slate-600 text-sm mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 pb-12 border-b border-slate-100">
          <div className="space-y-4 md:col-span-2">
            <div className="flex items-center gap-2.5">
              <BrandMark />
              <span className="text-lg font-bold text-slate-900">MutasiHub</span>
            </div>
            <p className="text-slate-500 text-xs max-w-sm leading-relaxed">
              Platform agregasi mutasi rekening realtime untuk top-up, deposit, dan rekonsiliasi bisnis
              modern. Kredensial terenkripsi AES-256 dan hanya dipakai membaca mutasi (read-only).
            </p>
          </div>

          <div>
            <h3 className="text-xs font-mono uppercase tracking-wider font-bold text-slate-900 mb-4">
              Produk
            </h3>
            <ul className="space-y-2 text-xs">
              <li><a href="/#fitur" className="hover:text-brand-600">Fitur Utama</a></li>
              <li><a href="/#cara-kerja" className="hover:text-brand-600">Cara Kerja</a></li>
              <li><a href="/#harga" className="hover:text-brand-600">Daftar Harga</a></li>
              <li><a href="/docs" className="hover:text-brand-600">Dokumentasi API</a></li>
              <li><a href="/#faq" className="hover:text-brand-600">FAQ</a></li>
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-mono uppercase tracking-wider font-bold text-slate-900 mb-4">
              Legal
            </h3>
            <ul className="space-y-2 text-xs">
              <li><a href="/terms" className="hover:text-brand-600">Syarat &amp; Ketentuan</a></li>
              <li><a href="/privacy" className="hover:text-brand-600">Kebijakan Privasi</a></li>
              <li><a href="/#keamanan" className="hover:text-brand-600">Kebijakan Keamanan</a></li>
              <li><a href="/login" className="hover:text-brand-600">Login Dashboard</a></li>
              <li><a href="/register" className="hover:text-brand-600">Registrasi Member</a></li>
            </ul>
          </div>
        </div>

        <div className="pt-8 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 gap-4">
          <p>© {new Date().getFullYear()} MutasiHub. Hak cipta dilindungi.</p>
          <p className="text-[11px]">Bukan afiliasi atau bagian resmi dari Bank BCA atau DANA Indonesia.</p>
        </div>
      </div>
    </footer>
  );
}

export function LegalShell({
  eyebrow,
  title,
  description,
  updated,
  toc,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  updated: string;
  toc: TocItem[];
  children: ReactNode;
}) {
  return (
    <div className="landing-tw bg-[#fafbfc] text-slate-800 font-sans antialiased selection:bg-brand-500 selection:text-white min-h-screen flex flex-col">
      <LegalHeader />

      {/* HERO */}
      <section className="relative overflow-hidden bg-slate-950 text-white">
        <div
          aria-hidden
          className="absolute -top-32 -right-24 w-[520px] h-[520px] rounded-full bg-brand-500/20 blur-3xl"
        />
        <div
          aria-hidden
          className="absolute -bottom-40 -left-20 w-[420px] h-[420px] rounded-full bg-emerald-400/10 blur-3xl"
        />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-14 pb-16 sm:pt-20 sm:pb-20">
          <nav aria-label="Breadcrumb" className="text-[11px] font-mono uppercase tracking-widest text-slate-400 mb-6">
            <a href="/" className="hover:text-brand-300">Beranda</a>
            <span className="mx-2 text-slate-600">/</span>
            <a href="/terms" className="hover:text-brand-300">Legal</a>
            <span className="mx-2 text-slate-600">/</span>
            <span className="text-slate-300">{eyebrow}</span>
          </nav>

          <div className="max-w-3xl">
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-[11px] font-semibold tracking-wide text-brand-300 mb-5">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-400" />
              {eyebrow}
            </span>

            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight leading-[1.1]">
              {title}
            </h1>
            <p className="mt-5 text-slate-300 text-sm sm:text-base leading-relaxed max-w-2xl">
              {description}
            </p>

            <dl className="mt-8 flex flex-wrap gap-x-10 gap-y-4 text-xs">
              <div>
                <dt className="font-mono uppercase tracking-wider text-slate-500 text-[10px]">Terakhir diperbarui</dt>
                <dd className="mt-1 font-semibold text-slate-200">{updated}</dd>
              </div>
              <div>
                <dt className="font-mono uppercase tracking-wider text-slate-500 text-[10px]">Berlaku untuk</dt>
                <dd className="mt-1 font-semibold text-slate-200">mutasi.rajacek.com</dd>
              </div>
              <div>
                <dt className="font-mono uppercase tracking-wider text-slate-500 text-[10px]">Yurisdiksi</dt>
                <dd className="mt-1 font-semibold text-slate-200">Indonesia</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      {/* BODY */}
      <section className="py-12 sm:py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-[264px_minmax(0,1fr)] gap-10 lg:gap-14">
            {/* TOC */}
            <aside className="lg:sticky lg:top-24 lg:self-start">
              <details className="lg:hidden group rounded-2xl border border-slate-200 bg-white p-4">
                <summary className="cursor-pointer list-none flex items-center justify-between text-sm font-bold text-slate-900">
                  Daftar Isi
                  <span className="text-slate-400 group-open:rotate-180 transition-transform">▾</span>
                </summary>
                <ol className="mt-4 space-y-2 text-xs">
                  {toc.map((t, i) => (
                    <li key={t.id}>
                      <a href={`#${t.id}`} className="text-slate-600 hover:text-brand-700">
                        <span className="font-mono text-slate-400 mr-1.5">{String(i + 1).padStart(2, '0')}</span>
                        {t.title}
                      </a>
                    </li>
                  ))}
                </ol>
              </details>

              <nav aria-label="Daftar isi" className="hidden lg:block">
                <p className="text-[10px] font-mono uppercase tracking-widest font-bold text-slate-400 mb-4">
                  Daftar Isi
                </p>
                <ol className="space-y-1 border-l border-slate-200">
                  {toc.map((t, i) => (
                    <li key={t.id}>
                      <a
                        href={`#${t.id}`}
                        className="block pl-4 -ml-px border-l-2 border-transparent py-1.5 text-xs leading-snug text-slate-500 hover:text-brand-700 hover:border-brand-500 transition-colors"
                      >
                        <span className="font-mono text-[10px] text-slate-400 mr-1.5">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        {t.title}
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            </aside>

            {/* CONTENT */}
            <div className="min-w-0 space-y-6">{children}</div>
          </div>
        </div>
      </section>

      <LegalFooter />
    </div>
  );
}

export function LegalSection({
  id,
  number,
  title,
  children,
}: {
  id: string;
  number: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <article
      id={id}
      className="scroll-mt-24 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-premium"
    >
      <div className="flex items-start gap-4 mb-5">
        <span className="shrink-0 w-9 h-9 rounded-xl bg-brand-50 border border-brand-100 text-brand-700 font-mono font-bold text-xs flex items-center justify-center">
          {String(number).padStart(2, '0')}
        </span>
        <h2 className="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight leading-snug pt-1.5">
          {title}
        </h2>
      </div>
      <div className="space-y-4 text-sm leading-relaxed text-slate-600 [&_strong]:text-slate-900 [&_strong]:font-semibold">
        {children}
      </div>
    </article>
  );
}

export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-2.5 pl-1">
      {items.map((it, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-2 w-1.5 h-1.5 rounded-full bg-brand-500 shrink-0" />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

export function Callout({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warn' | 'ok';
  title: string;
  children: ReactNode;
}) {
  const map = {
    info: { wrap: 'border-slate-200 bg-slate-50', badge: 'bg-slate-900 text-white', label: 'Info' },
    warn: { wrap: 'border-amber-200 bg-amber-50', badge: 'bg-amber-500 text-white', label: 'Penting' },
    ok: { wrap: 'border-brand-200 bg-brand-50', badge: 'bg-brand-600 text-white', label: 'Catatan' },
  } as const;
  const t = map[tone];
  return (
    <div className={`rounded-xl border ${t.wrap} p-4 sm:p-5`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold uppercase tracking-wider ${t.badge}`}>
          {t.label}
        </span>
        <span className="text-sm font-bold text-slate-900">{title}</span>
      </div>
      <div className="text-xs sm:text-sm leading-relaxed text-slate-600">{children}</div>
    </div>
  );
}

export function ContactCard() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-900 to-slate-800 p-6 sm:p-8 text-white">
      <h2 className="text-lg sm:text-xl font-extrabold tracking-tight">Ada pertanyaan tentang dokumen ini?</h2>
      <p className="mt-2 text-sm text-slate-300 leading-relaxed max-w-xl">
        Tim kami siap membantu. Kirim pertanyaan seputar syarat layanan, privasi, atau keamanan data
        dan kami akan merespons dalam 1–2 hari kerja.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <a
          href="/docs"
          className="inline-flex items-center px-5 py-2.5 rounded-xl bg-white text-slate-900 text-sm font-bold hover:bg-slate-100 transition"
        >
          Baca Dokumentasi
        </a>
        <a
          href="/register"
          className="inline-flex items-center px-5 py-2.5 rounded-xl border border-white/25 text-white text-sm font-semibold hover:bg-white/10 transition"
        >
          Mulai Trial Gratis
        </a>
      </div>
    </div>
  );
}
