/** @type {import('tailwindcss').Config} */
/**
 * Tailwind HANYA untuk landing page (app/page.tsx) + halaman auth member
 * (/login, /register — components/auth-shell.tsx, bahasa visual yang sama
 * dengan landing v23).
 *
 * - `content` dibatasi ke file landing agar tidak ada utilitas yang
 *   tergenerate untuk panel member/admin.
 * - `preflight: false` WAJIB: reset global Tailwind akan merusak panel
 *   (.app-shell, .modal, dsb.). Sebagai gantinya, blok default variabel
 *   --tw-* + reset mini khusus landing ada di globals.css (scoped
 *   .landing-tw) — tanpanya utilitas translate/scale/gradient/border
 *   tidak jalan karena variabelnya tak terdefinisi.
 * - `important: true`: globals.css berisi aturan unlayered (a, h1-h3, ...)
 *   yang menurut aturan cascade layer selalu menang atas utilitas Tailwind
 *   apa pun spesifikasinya; !important membuat utilitas landing menang.
 *   Panel tidak memakai kelas Tailwind, jadi ini tidak berpengaruh ke panel.
 */
module.exports = {
  important: true,
  corePlugins: { preflight: false },
  content: ['./app/page.tsx', './app/layout.tsx', './app/login/page.tsx', './app/register/page.tsx', './components/auth-shell.tsx'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        brand: {
          50: '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          800: '#065f46',
          900: '#064e3b',
          950: '#022c22',
        },
        surface: {
          subtle: '#f8fafc',
          border: '#e2e8f0',
          dark: '#0b0f19',
          cardDark: '#111827',
        },
      },
      boxShadow: {
        // shadow-xs tidak ada di skala default Tailwind v3 (baru ada di v4).
        xs: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        glow: '0 0 40px -10px rgba(5, 150, 105, 0.25)',
        premium:
          '0 20px 40px -15px rgba(0, 0, 0, 0.05), 0 0 1px 1px rgba(0,0,0,0.03)',
        glass: '0 8px 32px 0 rgba(0, 0, 0, 0.06)',
      },
      // h-18 tidak ada di skala spacing default Tailwind v3 (CDN Play
      // men-generate-nya dinamis; build statis tidak).
      spacing: { 18: '4.5rem' },
    },
  },
  plugins: [],
};
