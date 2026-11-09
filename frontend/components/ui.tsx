'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { apiGet, apiPost, friendlyError } from '../lib/api';
import { useSettings } from '../lib/settings';

/* ---------- Primitif UI ---------- */

export function Button({
  children,
  variant = 'primary',
  disabled,
  type = 'button',
  onClick,
  href,
  className = '',
}: {
  children: ReactNode;
  variant?: 'primary' | 'outline' | 'danger' | 'ghost';
  disabled?: boolean;
  type?: 'button' | 'submit';
  onClick?: () => void;
  href?: string;
  className?: string;
}) {
  const cls = `btn btn-${variant} ${className}`;
  if (href) {
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button type={type} className={cls} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

export function Card({
  children,
  title,
  kicker,
  subtitle,
  actions,
  className = '',
}: {
  children: ReactNode;
  title?: string;
  kicker?: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || kicker || subtitle || actions) && (
        <div className="card-head">
          <div>
            {kicker && <div className="card-kicker">{kicker}</div>}
            {title && <h3 className="card-title">{title}</h3>}
            {subtitle && <p className="card-sub">{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function ErrorBanner({
  message,
  onClose,
}: {
  message: string | null;
  onClose?: () => void;
}) {
  if (!message) return null;
  return (
    <div className="banner banner-error" role="alert">
      <span>{message}</span>
      {onClose && (
        <button type="button" className="banner-close" onClick={onClose} aria-label="Tutup">
          ×
        </button>
      )}
    </div>
  );
}

export function InfoBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="banner banner-info" role="status">{message}</div>;
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 12h-6l-2 3h-4l-2-3H2" />
          <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
        </svg>
      </div>
      <p className="empty-title">{title}</p>
      {description && <p className="empty-desc">{description}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function Loading({ label = 'Memuat…' }: { label?: string }) {
  return <div className="loading">{label}</div>;
}

/* ---------- Skeleton loader ---------- */

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function StatSkeleton() {
  return (
    <div className="stat-grid" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="skeleton-stat" />
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div style={{ display: 'grid', gap: 10 }} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="skeleton-line" />
      ))}
    </div>
  );
}

/* ---------- Modal ---------- */

// Dialog modal: form sekunder (mis. tambah rekening) tidak tampil langsung
// di halaman — hanya muncul saat member menekan tombol. ESC / klik backdrop
// menutup, scroll halaman dikunci selama modal terbuka.
export function Modal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={subtitle ? 'modal modal-with-sub' : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Tutup">
            ×
          </button>
        </div>
        {subtitle && <p className="modal-sub">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: 'badge-green',
    aktif: 'badge-green',
    connected: 'badge-green',
    terhubung: 'badge-green',
    success: 'badge-green',
    pending: 'badge-amber',
    waiting: 'badge-amber',
    expired: 'badge-red',
    disconnected: 'badge-red',
    failed: 'badge-red',
    inactive: 'badge-gray',
    nonaktif: 'badge-gray',
    disabled: 'badge-red',
    trial: 'badge-blue',
  };
  // Tampilkan label Indonesia, bukan nilai mentah ("active" -> "Aktif").
  const labels: Record<string, string> = {
    active: 'Aktif',
    connected: 'Terhubung',
    terhubung: 'Terhubung',
    success: 'Berhasil',
    pending: 'Menunggu',
    waiting: 'Menunggu',
    expired: 'Kedaluwarsa',
    disconnected: 'Terputus',
    failed: 'Gagal',
    inactive: 'Nonaktif',
    nonaktif: 'Nonaktif',
    disabled: 'Dinonaktifkan',
    trial: 'Trial',
  };
  const key = (status || '').toLowerCase();
  const cls = map[key] || 'badge-gray';
  const label = labels[key] ?? status;
  return <span className={`badge ${cls}`}>{label}</span>;
}

/* ---------- Header / Footer ---------- */

export function SiteHeader() {
  const { site_name, logo_url, accent_color } = useSettings();
  const [me, setMe] = useState<any>(null);
  const router = useRouter();

  useEffect(() => {
    apiGet('/api/v1/auth/me')
      .then((d: any) => setMe(d?.member ?? d?.user ?? d))
      .catch(() => setMe(null));
  }, []);

  async function logout() {
    try {
      await apiPost('/api/v1/auth/logout', {});
    } catch {
      // lanjut ke login walau logout gagal
    }
    router.push('/login');
  }

  return (
    <header className="site-header" style={{ borderTopColor: accent_color }}>
      <div className="container header-inner">
        <Link href="/" className="brand">
          {logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo_url} alt={site_name} className="brand-logo" />
          ) : (
            <span className="brand-mark" style={{ background: accent_color }}>
              {site_name.slice(0, 1)}
            </span>
          )}
          <span className="brand-name">{site_name}</span>
        </Link>
        <nav className="main-nav">
          <Link href="/#fitur">Fitur</Link>
          <Link href="/#cara-kerja">Cara Kerja</Link>
          <Link href="/#harga">Harga</Link>
          <Link href="/#faq">FAQ</Link>
        </nav>
        <div className="header-actions">
          {me ? (
            <>
              <Link href="/member/dashboard" className="btn btn-ghost">
                Dashboard
              </Link>
              <button type="button" className="btn btn-outline" onClick={logout}>
                Keluar
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="btn btn-ghost">
                Masuk
              </Link>
              <Link href="/register" className="btn btn-primary">
                Daftar Gratis
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  const { site_name, tagline } = useSettings();
  return (
    <footer className="site-footer">
      <div className="container footer-inner">
        <div>
          <p className="footer-brand">{site_name}</p>
          <p className="footer-tag">{tagline}</p>
        </div>
        <div className="footer-links">
          <Link href="/#fitur">Fitur</Link>
          <Link href="/#harga">Harga</Link>
          <Link href="/#faq">FAQ</Link>
          <Link href="/docs">Dokumentasi API</Link>
          <Link href="/login">Masuk</Link>
        </div>
      </div>
      <div className="container footer-bottom">
        <p>
          © {new Date().getFullYear()} {site_name}. Mutasi DANA &amp; BCA — read-only,
          kredensial terenkripsi AES-256. Bukan layanan resmi DANA atau BCA.
        </p>
      </div>
    </footer>
  );
}

/* ---------- Chrome: header/footer marketing hanya di luar panel ---------- */

export function SiteChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isPanel =
    pathname === '/admin-login' ||
    pathname === '/admin' ||
    pathname === '/member' ||
    pathname.startsWith('/member/') ||
    pathname.startsWith('/admin/');
  // Landing (/) punya header + footer sendiri (desain v23) — jangan
  // render SiteHeader/SiteFooter di atasnya. Sama untuk /login dan
  // /register (v25): AuthShell punya logo + footer mini sendiri.
  const isLanding = pathname === '/' || pathname === '/login' || pathname === '/register';
  return (
    <>
      {!isPanel && !isLanding && <SiteHeader />}
      <main>{children}</main>
      {!isPanel && !isLanding && <SiteFooter />}
    </>
  );
}

/* ---------- PageHeading ala template Rajacek ---------- */

export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading heading-row">
      <div>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="heading-actions">{actions}</div> : null}
    </div>
  );
}

export type NavItem = { href: string; label: string; icon?: ReactNode };
export type NavGroup = { group: string; items: NavItem[] };
export type ShellProfile = { name: string; sub: string };

export function DashboardShell({
  nav,
  title,
  contextLabel,
  brandSub,
  showPill,
  profile,
  logoutHref,
  sideMini,
  children,
}: {
  nav: NavGroup[];
  title?: string;
  contextLabel: ReactNode;
  brandSub: string;
  showPill?: boolean;
  profile?: ShellProfile;
  logoutHref: string;
  sideMini?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { site_name, accent_color, logo_url } = useSettings();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    document.body.classList.toggle('menu-open', menuOpen);
    return () => document.body.classList.remove('menu-open');
  }, [menuOpen]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Breadcrumb + item aktif: exact-match dulu, lalu prefix TERPANJANG.
  // (Dulu: find() pertama yang prefix-nya cocok — '/admin/plans' kena '/admin'
  // sehingga breadcrumb selalu "Dashboard".)
  const allItems = nav.flatMap((g) => g.items);
  const exact = allItems.find((item) => pathname === item.href);
  const prefix = allItems
    .filter((item) => pathname.startsWith(item.href + '/'))
    .sort((a, b) => b.href.length - a.href.length)[0];
  const current = exact ?? prefix;
  const currentLabel = current?.label ?? title ?? '';

  async function logout() {
    try {
      await apiPost('/api/v1/auth/logout', {});
    } catch {
      // lanjut
    }
    router.push(logoutHref);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Navigasi utama">
        <div className="brand-wrap">
          <Link href="/" className="brand">
            {logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo_url} alt={site_name} className="brand-mark-img" />
            ) : (
              <span className="brand-mark" style={{ background: accent_color }}>
                {site_name.slice(0, 1)}
              </span>
            )}
            <span className="brand-name">
              {site_name}
              <small>{brandSub}</small>
            </span>
          </Link>
          {showPill && (
            <span className="workspace-pill">
              <span className="status-dot" />
              Production
            </span>
          )}
        </div>
        <nav className="nav-groups">
          {nav.map((g, gi) => (
            <div
              key={g.group}
              className={`nav-group${gi === nav.length - 1 ? ' nav-group-bottom' : ''}`}
            >
              <p className="nav-label">{g.group}</p>
              {g.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={current?.href === item.href ? 'nav-link is-active' : 'nav-link'}
                >
                  {item.icon}
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
          {sideMini ? <div className="side-mini">{sideMini}</div> : null}
        </nav>
        <div className="sidebar-footer">
          <div className="security-note">
            <span className="shield-mini">✓</span>
            <span>
              <strong>Data dilindungi</strong>
              <small>Kredensial terenkripsi AES-256</small>
            </span>
          </div>
          {profile && (
            <div className="profile-card">
              <div className="avatar">{profile.name.slice(0, 1).toUpperCase()}</div>
              <div className="profile-name">
                <strong>{profile.name}</strong>
                <small>{profile.sub}</small>
              </div>
            </div>
          )}
          <button type="button" className="logout-btn" onClick={logout}>
            Keluar
          </button>
        </div>
      </aside>
      <div
        className="sidebar-backdrop"
        aria-hidden="true"
        onClick={() => setMenuOpen(false)}
      />

      <main className="main-content">
        <header className="topbar">
          <button
            className="menu-button"
            type="button"
            aria-label="Buka navigasi"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span />
            <span />
            <span />
          </button>
          <div className="topbar-text">
            <div className="breadcrumb">
              <span>{site_name}</span>
              <span className="breadcrumb-separator">/</span>
              <strong>{currentLabel}</strong>
            </div>
          </div>
          <div className="topbar-actions">
            <span className="workspace-context">{contextLabel}</span>
          </div>
        </header>
        <div className="content-wrap">{children}</div>
      </main>
    </div>
  );
}
