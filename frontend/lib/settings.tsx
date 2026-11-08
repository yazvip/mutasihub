'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { apiGet } from './api';

export type BrandSettings = {
  site_name: string;
  tagline: string;
  logo_url: string;
  accent_color: string;
  gobiz_enabled: boolean;
};

export const DEFAULT_SETTINGS: BrandSettings = {
  site_name: process.env.NEXT_PUBLIC_SITE_NAME || 'MutasiHub',
  tagline: 'Cek Mutasi DANA & BCA Realtime untuk Bisnis Modern',
  logo_url: '',
  accent_color: '#14532d',
  gobiz_enabled: true,
};

const SettingsContext = createContext<BrandSettings>(DEFAULT_SETTINGS);

export function useSettings() {
  return useContext(SettingsContext);
}

/** Terima boolean maupun string '1'/'0'/'true'/'false' (backend kirim string). */
export function parseGobizEnabled(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === '1' || s === 'true') return true;
    if (s === '0' || s === 'false') return false;
  }
  return fallback;
}

/**
 * Satu sumber brand untuk seluruh frontend.
 * Coba endpoint publik dulu, lalu endpoint admin; gagal = fallback default.
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<BrandSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const path of ['/api/v1/settings', '/api/v1/admin/settings']) {
        try {
          const data = await apiGet<any>(path);
          const s = data?.settings ?? data?.data ?? data;
          if (s && typeof s === 'object') {
            if (!cancelled) {
              setSettings((prev) => ({
                ...prev,
                site_name: s.site_name || s.siteName || prev.site_name,
                tagline: s.tagline || prev.tagline,
                logo_url: s.logo_url || s.logoUrl || prev.logo_url,
                accent_color: s.accent_color || s.accentColor || prev.accent_color,
                gobiz_enabled: parseGobizEnabled(
                  s.gobiz_enabled ?? s.gobizEnabled,
                  prev.gobiz_enabled,
                ),
              }));
            }
            return;
          }
        } catch {
          // coba endpoint berikutnya / fallback default
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SettingsContext.Provider value={settings}>
      {children}
    </SettingsContext.Provider>
  );
}
