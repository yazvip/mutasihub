import type { MetadataRoute } from 'next';

const BASE = 'https://mutasi.rajacek.com';

// Sitemap hanya memuat halaman publik yang memang boleh diindeks.
// Dashboard member/admin sengaja tidak dimasukkan.
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date('2026-11-10T00:00:00+07:00');

  return [
    {
      url: `${BASE}/`,
      lastModified,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${BASE}/docs`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${BASE}/register`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${BASE}/login`,
      lastModified,
      changeFrequency: 'yearly',
      priority: 0.4,
    },
    {
      url: `${BASE}/terms`,
      lastModified,
      changeFrequency: 'yearly',
      priority: 0.5,
    },
    {
      url: `${BASE}/privacy`,
      lastModified,
      changeFrequency: 'yearly',
      priority: 0.5,
    },
  ];
}
