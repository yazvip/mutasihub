/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  async redirects() {
    return [
      {
        // v35b: tab "Inquiry Rekening" member dihapus (duplikat Playground).
        // Bookmark/tautan lama tetap mendarat di Playground, bukan 404.
        source: '/member/inquiry',
        destination: '/member/playground',
        permanent: false,
      },
    ];
  },
};

module.exports = nextConfig;
