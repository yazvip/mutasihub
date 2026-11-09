'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { DashboardShell } from '../../components/ui';
import {
  IconCard,
  IconGear,
  IconGrid,
  IconBook,
  IconKey,
  IconSearch,
  IconWallet,
  IconZap,
} from '../../components/icons';
import { apiGet } from '../../lib/api';
import { formatDateWIB } from '../../lib/format';

const NAV = [
  {
    group: 'Utama',
    items: [
      { href: '/member/dashboard', label: 'Dashboard', icon: <IconGrid /> },
      { href: '/member/accounts', label: 'Rekening', icon: <IconWallet /> },
      { href: '/member/inquiry', label: 'Inquiry Rekening', icon: <IconSearch /> },
      { href: '/member/playground', label: 'Playground', icon: <IconZap /> },
    ],
  },
  {
    group: 'Pengaturan',
    items: [
      { href: '/member/api', label: 'API Key', icon: <IconKey /> },
      { href: '/member/security', label: 'Keamanan & 2FA', icon: <IconGear /> },
      { href: '/docs', label: 'Dokumentasi API', icon: <IconBook /> },
      { href: '/member/subscription', label: 'Langganan', icon: <IconCard /> },
    ],
  },
];

export default function MemberLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [profile, setProfile] = useState<{ name: string; sub: string } | undefined>(
    undefined
  );
  const [planInfo, setPlanInfo] = useState<{
    plan: string;
    expires: string;
    accounts: number;
    total: number;
    expired: boolean;
  } | null>(null);

  useEffect(() => {
    apiGet<any>('/api/v1/auth/me')
      .then((d) => {
        // v20: login Google maupun email dengan flag wajib ganti sandi
        // diarahkan ke halaman ganti sandi (kecuali sudah di sana).
        if (d?.must_change_password && pathname !== '/member/change-password') {
          router.push('/member/change-password');
          return;
        }
        const name = d?.name || d?.email || 'Member';
        const sub = d?.email || '';
        setProfile({ name, sub });
      })
      .catch(() => setProfile(undefined));
    // Kartu mini sidebar: paket + rekening aktif (layout bertahan antar halaman,
    // jadi fetch ini hanya sekali per sesi).
    apiGet<any>('/api/v1/member/dashboard')
      .then((d) =>
        setPlanInfo({
          plan: d?.plan ?? '',
          expires: d?.plan_expires_at ?? '',
          accounts: Number(d?.active_accounts) || 0,
          // v31 (P2-5): total awal = aktif; diperbarui oleh fetch /accounts di bawah.
          total: Number(d?.active_accounts) || 0,
          // v21 (P1-7): paket kedaluwarsa -> plan null + plan_expired true.
          expired:
            d?.plan_expired === true ||
            (d?.plan == null && d?.plan_expires_at != null),
        })
      )
      .catch(() => setPlanInfo(null));
    // v31 (P2-5): total rekening terhubung (active + pending) untuk label drawer.
    apiGet<any>('/api/v1/accounts')
      .then((d) => {
        const arr = Array.isArray(d?.accounts) ? d.accounts : [];
        const total = arr.filter(
          (a: any) => a?.status === 'active' || a?.status === 'pending'
        ).length;
        setPlanInfo((prev) => (prev ? { ...prev, total } : prev));
      })
      .catch(() => {});
  }, []);

  return (
    <div className="member-shell">
      <DashboardShell
        nav={NAV}
        contextLabel={<span className="live-indicator"><span className="dot" />Gateway Realtime</span>}
        brandSub="Portal Member"
        profile={profile}
        logoutHref="/login"
        sideMini={
          planInfo ? (
            <>
              <strong>Paket {planInfo.expired ? 'Kedaluwarsa' : planInfo.plan || 'Trial'}</strong>
              <span>{planInfo.accounts} dari {planInfo.total} rekening aktif</span>
              {planInfo.expires && !planInfo.expired ? (
                <span>Berakhir {formatDateWIB(planInfo.expires, false)}</span>
              ) : null}
            </>
          ) : undefined
        }
      >
        {children}
      </DashboardShell>
    </div>
  );
}
