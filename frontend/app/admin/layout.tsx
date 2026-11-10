'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { DashboardShell } from '../../components/ui';
import {
  IconBook,
  IconBox,
  IconChart,
  IconGear,
  IconMail,
  IconUsers,
  IconZap,
} from '../../components/icons';
import { apiGet } from '../../lib/api';

const NAV = [
  {
    group: 'Ringkasan',
    items: [{ href: '/admin', label: 'Dashboard', icon: <IconChart /> }],
  },
  {
    group: 'Kelola',
    items: [
      { href: '/admin/plans', label: 'Paket', icon: <IconBox /> },
      { href: '/admin/members', label: 'Member', icon: <IconUsers /> },
      { href: '/admin/announcements', label: 'Pengumuman', icon: <IconMail /> },
    ],
  },
  {
    group: 'Platform',
    items: [
      { href: '/admin/playground', label: 'Playground', icon: <IconZap /> },
      { href: '/admin/audit-logs', label: 'Audit Log', icon: <IconBook /> },
      { href: '/admin/settings', label: 'Pengaturan', icon: <IconGear /> },
    ],
  },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const [quota, setQuota] = useState<any>(null);

  useEffect(() => {
    // Kartu mini sidebar: kuota Connecta (layout bertahan antar halaman,
    // jadi fetch ini hanya sekali per sesi). Respons mentah Connecta bisa
    // terbungkus {data} / {quota} — samakan unwrap dengan halaman admin.
    apiGet<any>('/api/v1/admin/connecta/quota')
      .then((d) => setQuota(d?.data ?? d?.quota ?? d))
      .catch(() => setQuota(null));
  }, []);

  return (
    <DashboardShell
      nav={NAV}
      contextLabel="Panel administrasi"
      brandSub="Panel Admin"
      showPill
      profile={{ name: 'Administrator', sub: 'Panel Admin' }}
      logoutHref="/admin-login"
      sideMini={
        quota ? (
          <>
            <strong>Connecta{quota.is_demo ? ' · Demo' : ''}</strong>
            <span className="side-mini-value">
              DANA {quota.dana_bound_count ?? '—'}/{quota.max_dana_accounts ?? '—'}
              {' · '}BCA {quota.bca_count ?? '—'}/{quota.max_bca_accounts ?? '—'}
            </span>
            <span>
              Status:{' '}
              {quota.subscription_status === 'ACTIVE'
                ? 'Aktif'
                : quota.subscription_status ?? '—'}
            </span>
          </>
        ) : undefined
      }
    >
      {children}
    </DashboardShell>
  );
}
