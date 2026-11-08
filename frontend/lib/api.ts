const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://mutasi.rajacek.com';

export type ReplacePlanDetail = {
  name: string;
  expires_at?: string;
  remaining_days?: number;
  max_accounts?: number;
  price_cents?: number;
};

export type WouldFreezeAccount = {
  id: string;
  provider: string;
  masked?: string;
  created_at?: string;
};

export type ApiError = {
  status: number;
  message: string;
  code?: string;
  // v24: body error inquiry membawa sisa limit harian.
  limit_today?: number;
  remaining_today?: number;
  // v30: body error 409 active_subscription_exists membawa detail ganti
  // paket (paket lama/baru + rekening yang akan dibekukan sync-nya).
  old_plan?: ReplacePlanDetail;
  new_plan?: ReplacePlanDetail;
  connected_count?: number;
  would_freeze?: WouldFreezeAccount[];
};

// pickReplacePlan / pickWouldFreeze: ambil field 409 dari body error apa
// adanya, tanpa asumsi bentuk lain — field yang bukan tipe yang diharapkan
// diabaikan (seperti pola limit_today/remaining_today di atas).
function pickReplacePlan(v: unknown): ReplacePlanDetail | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o.name !== 'string') return undefined;
  const out: ReplacePlanDetail = { name: o.name };
  if (typeof o.expires_at === 'string') out.expires_at = o.expires_at;
  if (typeof o.remaining_days === 'number') out.remaining_days = o.remaining_days;
  if (typeof o.max_accounts === 'number') out.max_accounts = o.max_accounts;
  if (typeof o.price_cents === 'number') out.price_cents = o.price_cents;
  return out;
}

function pickWouldFreeze(v: unknown): WouldFreezeAccount[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: WouldFreezeAccount[] = [];
  for (const item of v) {
    if (typeof item !== 'object' || item === null) continue;
    const o = item as Record<string, unknown>;
    if (typeof o.id !== 'string' && typeof o.id !== 'number') continue;
    if (typeof o.provider !== 'string') continue;
    const row: WouldFreezeAccount = { id: String(o.id), provider: o.provider };
    if (typeof o.masked === 'string') row.masked = o.masked;
    if (typeof o.created_at === 'string') row.created_at = o.created_at;
    out.push(row);
  }
  return out;
}

async function parseBody(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // Bukan JSON (mis. halaman error HTML Cloudflare/nginx saat origin
    // 502) — JANGAN jadikan teks mentahnya sebagai pesan; pemanggil
    // memakai fallback ramah berdasarkan status. v28: sebelumnya teks
    // HTML Cloudflare tampil mentah di ErrorBanner.
    return null;
  }
}

// looksLikeHTML mendeteksi pesan error yang sebenarnya halaman HTML
// (Cloudflare/nginx) agar tidak pernah dirender sebagai teks pesan.
function looksLikeHTML(s: string): boolean {
  return /^\s*</.test(s) || /<!doctype html/i.test(s) || /<html[\s>]/i.test(s);
}

// statusFallbackMessage: pesan Indonesia ramah bila body error tidak
// membawa message yang layak tampil (mis. body diganti Cloudflare).
function statusFallbackMessage(status: number): string {
  switch (status) {
    case 502:
    case 503:
    case 504:
      return 'Server tidak merespons, coba lagi sebentar.';
    case 500:
      return 'Terjadi kesalahan di server, coba lagi nanti.';
    case 404:
      return 'Data tidak ditemukan.';
    case 429:
      return 'Terlalu banyak permintaan, coba lagi sebentar lagi.';
    default:
      return `Terjadi kesalahan (HTTP ${status}).`;
  }
}

// cleanMessage: ambil pesan string yang layak tampil — tolak HTML,
// kosong, dan potong di 300 karakter.
function cleanMessage(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || looksLikeHTML(s)) return null;
  return s.length > 300 ? s.slice(0, 300) : s;
}

export async function api<T = any>(
  path: string,
  opts: RequestInit = {}
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...opts,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
    });
  } catch {
    const err: ApiError = {
      status: 0,
      message:
        'Tidak dapat terhubung ke server. Periksa koneksi atau coba lagi nanti.',
    };
    throw err;
  }
  const body = await parseBody(res);
  if (!res.ok) {
    const err: ApiError = {
      status: res.status,
      message:
        cleanMessage(body?.message) ??
        statusFallbackMessage(res.status),
      code: body && typeof body.error === 'string' ? body.error : undefined,
      limit_today:
        body && typeof body.limit_today === 'number'
          ? body.limit_today
          : undefined,
      remaining_today:
        body && typeof body.remaining_today === 'number'
          ? body.remaining_today
          : undefined,
      old_plan: pickReplacePlan(body?.old_plan),
      new_plan: pickReplacePlan(body?.new_plan),
      connected_count:
        body && typeof body.connected_count === 'number'
          ? body.connected_count
          : undefined,
      would_freeze: pickWouldFreeze(body?.would_freeze),
    };
    // Sesi habis / tidak sah -> lempar ke halaman login. Jangan redirect
    // untuk request auth itu sendiri (login/register/me/Google/forgot/reset),
    // endpoint publik (settings/plans), atau bila sudah di halaman login —
    // kalau tidak, pemakaian normal (mis. header memanggil /auth/me untuk
    // pengunjung anonim) akan terpental ke /login tanpa sebab.
    if (res.status === 401 && typeof window !== 'undefined') {
      const isAuthRequest =
        path.startsWith('/api/v1/auth/') ||
        path.startsWith('/api/v1/settings') ||
        path.startsWith('/api/v1/plans');
      const pathname = window.location.pathname;
      const onAuthPage =
        pathname === '/login' ||
        pathname === '/admin-login' ||
        pathname === '/register' ||
        pathname === '/forgot-password' ||
        pathname === '/reset-password' ||
        pathname === '/verify-email';
      if (!isAuthRequest && !onAuthPage) {
        window.location.href = pathname.startsWith('/admin')
          ? '/admin-login'
          : '/login';
      }
    }
    // Dipaksa ganti kata sandi (reset admin, v20): endpoint member yang
    // kena 403 must_change_password mengarahkan ke halaman ganti sandi.
    // Jangan redirect bila sudah di halaman itu, atau dari panel admin
    // (endpoint admin tidak pernah mengembalikan kode ini).
    if (
      res.status === 403 &&
      body &&
      body.error === 'must_change_password' &&
      typeof window !== 'undefined'
    ) {
      const pathname = window.location.pathname;
      if (
        pathname !== '/member/change-password' &&
        !pathname.startsWith('/admin')
      ) {
        window.location.href = '/member/change-password';
      }
    }
    throw err;
  }
  return body as T;
}

export const apiGet = <T = any>(path: string) => api<T>(path);
export const apiPost = <T = any>(path: string, data?: unknown) =>
  api<T>(path, { method: 'POST', body: data === undefined ? undefined : JSON.stringify(data) });
export const apiPut = <T = any>(path: string, data?: unknown) =>
  api<T>(path, { method: 'PUT', body: JSON.stringify(data ?? {}) });
export const apiDelete = <T = any>(path: string) =>
  api<T>(path, { method: 'DELETE' });

export function apiUrl(path: string) {
  return `${API_URL}${path}`;
}

export function isApiError(e: unknown): e is ApiError {
  return typeof e === 'object' && e !== null && 'status' in e && 'message' in e;
}

export function friendlyError(e: unknown): string {
  if (isApiError(e)) {
    // Lapisan kedua (v28): bila ada pesan HTML yang lolos, ganti dengan
    // pesan ramah — jangan pernah tampilkan source HTML sebagai pesan.
    const m = e.message || '';
    if (looksLikeHTML(m)) return 'Server tidak merespons, coba lagi sebentar.';
    return m.length > 300 ? m.slice(0, 300) : m;
  }
  if (e instanceof Error) return e.message;
  return 'Terjadi kesalahan yang tidak diketahui.';
}
