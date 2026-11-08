import { apiGet } from './api';

export type Bank = { code: string; name: string };

// Daftar cadangan bila GET /api/v1/banks gagal — kode bank umum Indonesia.
export const FALLBACK_BANKS: Bank[] = [
  { code: '014', name: 'BCA' },
  { code: '002', name: 'BRI' },
  { code: '008', name: 'Mandiri' },
  { code: '009', name: 'BNI' },
  { code: '022', name: 'CIMB Niaga' },
  { code: '013', name: 'Permata' },
  { code: '011', name: 'Danamon' },
  { code: '200', name: 'BTN' },
  { code: '451', name: 'BSI' },
  { code: '147', name: 'Muamalat' },
  { code: '019', name: 'Panin' },
  { code: '028', name: 'OCBC' },
];

// Label opsi bank tanpa kurung ganda: bila nama dari Connecta sudah
// mengandung kode dalam kurung ("Bank Central Asia (BCA)"), jangan tambah
// " (014)" lagi.
export function bankLabel(b: Bank): string {
  return /\([A-Za-z0-9]{2,}\)/.test(b.name) ? b.name : `${b.name} (${b.code})`;
}

// Muat daftar bank dari backend (GET /api/v1/banks); fallback ke daftar
// statis bila endpoint gagal. pathBanks memungkinkan pemakaian endpoint
// admin (/api/v1/admin/connecta/banks).
export async function loadBanks(pathBanks = '/api/v1/banks'): Promise<Bank[]> {
  try {
    const d = await apiGet<any>(pathBanks);
    const list = Array.isArray(d) ? d : d?.banks ?? d?.data ?? [];
    const parsed: Bank[] = (Array.isArray(list) ? list : [])
      .map((b: any) => ({
        code: String(b?.code ?? b?.bank_code ?? ''),
        name: String(b?.name ?? b?.bank_name ?? ''),
      }))
      .filter((b: Bank) => b.code && b.name);
    if (parsed.length > 0) return parsed;
  } catch {
    // jatuh ke fallback
  }
  return FALLBACK_BANKS;
}
