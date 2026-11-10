import type { Metadata } from 'next';
import {
  Callout,
  ContactCard,
  LegalList,
  LegalSection,
  LegalShell,
  type TocItem,
} from '../../components/legal-shell';

const UPDATED = '10 November 2026';

export const metadata: Metadata = {
  title: 'Kebijakan Privasi — MutasiHub',
  description:
    'Kebijakan Privasi MutasiHub: data apa yang kami kumpulkan, dasar pemrosesan, enkripsi AES-256 kredensial rekening, masa penyimpanan, pembagian data, dan hak Anda sebagai subjek data.',
  keywords: [
    'kebijakan privasi mutasihub',
    'privacy policy mutasi hub',
    'perlindungan data mutasi rekening',
    'enkripsi AES-256 kredensial',
    'UU PDP',
  ],
  alternates: {
    canonical: '/privacy',
  },
  openGraph: {
    title: 'Kebijakan Privasi — MutasiHub',
    description:
      'Bagaimana MutasiHub mengumpulkan, memproses, dan melindungi data Anda — termasuk kredensial rekening terenkripsi AES-256.',
    url: 'https://mutasi.rajacek.com/privacy',
    siteName: 'MutasiHub',
    locale: 'id_ID',
    type: 'article',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Kebijakan Privasi MutasiHub' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Kebijakan Privasi — MutasiHub',
    description: 'Bagaimana MutasiHub mengumpulkan, memproses, dan melindungi data Anda.',
    images: ['/og-image.png'],
  },
  robots: { index: true, follow: true },
};

const TOC: TocItem[] = [
  { id: 'ringkasan', title: 'Ringkasan' },
  { id: 'data', title: 'Data yang Kami Kumpulkan' },
  { id: 'dasar', title: 'Dasar & Tujuan Pemrosesan' },
  { id: 'kredensial', title: 'Kredensial Rekening' },
  { id: 'berbagi', title: 'Pembagian Data' },
  { id: 'penyimpanan', title: 'Masa Penyimpanan' },
  { id: 'keamanan', title: 'Langkah Keamanan' },
  { id: 'hak', title: 'Hak Anda' },
  { id: 'cookie', title: 'Cookie & Teknologi Serupa' },
  { id: 'anak', title: 'Privasi Anak' },
  { id: 'internasional', title: 'Transfer Internasional' },
  { id: 'perubahan', title: 'Perubahan Kebijakan' },
  { id: 'kontak', title: 'Kontak' },
];

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  name: 'Kebijakan Privasi — MutasiHub',
  description:
    'Kebijakan Privasi MutasiHub: data yang dikumpulkan, dasar pemrosesan, keamanan, dan hak subjek data.',
  url: 'https://mutasi.rajacek.com/privacy',
  inLanguage: 'id-ID',
  datePublished: '2026-11-10',
  dateModified: '2026-11-10',
  isPartOf: {
    '@type': 'WebSite',
    name: 'MutasiHub',
    url: 'https://mutasi.rajacek.com',
  },
  publisher: {
    '@type': 'Organization',
    name: 'MutasiHub',
    url: 'https://mutasi.rajacek.com',
  },
  breadcrumb: {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Beranda', item: 'https://mutasi.rajacek.com/' },
      { '@type': 'ListItem', position: 2, name: 'Kebijakan Privasi', item: 'https://mutasi.rajacek.com/privacy' },
    ],
  },
};

export default function PrivacyPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <LegalShell
        eyebrow="Kebijakan Privasi"
        title="Kebijakan Privasi"
        description="Kami menjelaskan secara terbuka data apa yang dikumpulkan, mengapa diproses, bagaimana dilindungi, dan hak apa yang Anda miliki atas data tersebut."
        updated={UPDATED}
        toc={TOC}
      >
        <Callout tone="ok" title="Komitmen kami">
          MutasiHub hanya meminta data yang benar-benar diperlukan untuk menjalankan Layanan.
          <strong> Kredensial rekening disimpan terenkripsi AES-256</strong> dan dipakai semata-mata
          untuk membaca mutasi (read-only) — bukan untuk memindahkan dana.
        </Callout>

        <LegalSection id="ringkasan" number={1} title="Ringkasan">
          <LegalList
            items={[
              'Kami mengumpulkan data akun, data rekening terhubung, dan data mutasi yang diperlukan untuk menyediakan Layanan.',
              'Kami tidak menjual data pribadi Anda kepada pihak ketiga mana pun.',
              'Kredensial rekening disimpan terenkripsi dan tidak ditampilkan kembali secara utuh.',
              'Anda dapat meminta akses, koreksi, atau penghapusan data sesuai ketentuan yang berlaku.',
            ]}
          />
        </LegalSection>

        <LegalSection id="data" number={2} title="Data yang Kami Kumpulkan">
          <p>
            <strong>a. Data yang Anda berikan langsung</strong>
          </p>
          <LegalList
            items={[
              'Data akun: nama, alamat email, nomor telepon, nama badan usaha (opsional).',
              'Data autentikasi: kata sandi (disimpan sebagai hash), kode pemulihan dua faktor.',
              'Data rekening terhubung: nomor HP DANA atau nomor rekening BCA, User ID, dan PIN KlikBCA bila Anda menghubungkan rekening BCA.',
              'Data komunikasi: isi pesan yang Anda kirim ke dukungan.',
            ]}
          />
          <p>
            <strong>b. Data yang terbentuk dari penggunaan Layanan</strong>
          </p>
          <LegalList
            items={[
              'Data mutasi: waktu transaksi, nominal, jenis (kredit/debit), nama pengirim, dan keterangan transaksi dari rekening terhubung.',
              'Data teknis: alamat IP, jenis perangkat, browser, waktu akses, dan log aktivitas.',
              'Data langganan: Paket aktif, riwayat pembayaran, dan tanggal berakhirnya masa aktif.',
              'Data penggunaan fitur: jumlah inquiry, jumlah callback, dan statistik pemakaian lain untuk keperluan kuota dan penagihan.',
            ]}
          />
        </LegalSection>

        <LegalSection id="dasar" number={3} title="Dasar & Tujuan Pemrosesan">
          <p>Kami memproses data Anda untuk tujuan berikut:</p>
          <LegalList
            items={[
              <>
                <strong>Menjalankan Layanan</strong> — menampilkan mutasi, mengirim callback, dan
                menyediakan API sesuai Paket aktif.
              </>,
              <>
                <strong>Keamanan</strong> — mendeteksi akses tidak sah, mencegah penyalahgunaan, dan
                menjaga integritas akun.
              </>,
              <>
                <strong>Dukungan</strong> — menjawab pertanyaan dan menyelesaikan kendala teknis.
              </>,
              <>
                <strong>Penagihan</strong> — mengelola langganan, invoice, dan kewajiban akuntansi.
              </>,
              <>
                <strong>Kepatuhan hukum</strong> — memenuhi kewajiban yang diwajibkan peraturan
                perundang-undangan yang berlaku.
              </>,
              <>
                <strong>Peningkatan layanan</strong> — menganalisis pola penggunaan secara agregat
                untuk memperbaiki kualitas produk.
              </>,
            ]}
          />
          <p>
            Dasar pemrosesan mengacu pada pelaksanaan perjanjian layanan, persetujuan Anda, kepentingan
            yang sah untuk menjaga keamanan Layanan, serta kewajiban hukum yang berlaku.
          </p>
        </LegalSection>

        <LegalSection id="kredensial" number={4} title="Kredensial Rekening">
          <p>
            Ini bagian paling sensitif, dan kami memperlakukannya secara khusus:
          </p>
          <LegalList
            items={[
              <>
                Kredensial rekening dienkripsi dengan <strong>AES-256</strong> sebelum disimpan; kunci
                enkripsi dikelola terpisah dari basis data.
              </>,
              <>
                Kredensial <strong>tidak pernah ditampilkan kembali</strong> secara utuh di antarmuka,
                termasuk kepada Anda setelah disimpan.
              </>,
              <>
                Penggunaan kredensial <strong>terbatas pada pembacaan mutasi</strong>. Layanan tidak
                memiliki kemampuan melakukan transfer, pembayaran, atau perubahan data rekening.
              </>,
              'Akses internal dibatasi pada personel operasional yang membutuhkan, dengan pencatatan aktivitas.',
              'Saat Anda memutus rekening terhubung, kredensial terkait dihapus dari penyimpanan aktif.',
            ]}
          />
          <Callout tone="warn" title="Jangan bagikan OTP">
            Kami tidak pernah meminta kode OTP, PIN, atau kata sandi melalui telepon, chat, atau email.
            Abaikan permintaan semacam itu meskipun mengaku sebagai staf MutasiHub.
          </Callout>
        </LegalSection>

        <LegalSection id="berbagi" number={5} title="Pembagian Data">
          <p>
            Kami <strong>tidak menjual</strong> data pribadi Anda. Data dapat dibagikan secara terbatas
            kepada:
          </p>
          <LegalList
            items={[
              <>
                <strong>Penyedia infrastruktur</strong> — penyedia cloud, basis data, dan jaringan yang
                memproses data atas nama kami berdasarkan perjanjian kerahasiaan.
              </>,
              <>
                <strong>Penyedia layanan rekening</strong> — pihak yang diperlukan untuk membaca mutasi
                rekening yang Anda hubungkan.
              </>,
              <>
                <strong>Penyedia pembayaran</strong> — untuk memproses transaksi langganan.
              </>,
              <>
                <strong>Otoritas berwenang</strong> — apabila diwajibkan oleh hukum atau perintah yang
                sah, dengan cakupan seperlunya.
              </>,
            ]}
          />
          <p>
            Pihak ketiga tersebut hanya menerima data yang relevan dan terikat kewajiban menjaga
            kerahasiaan.
          </p>
        </LegalSection>

        <LegalSection id="penyimpanan" number={6} title="Masa Penyimpanan">
          <LegalList
            items={[
              'Data akun disimpan selama akun aktif dan dihapus atau dianonimkan setelah akun dihapus, kecuali diwajibkan lain oleh hukum.',
              'Kredensial rekening disimpan selama rekening terhubung aktif; dihapus saat rekening diputus.',
              'Data mutasi disimpan sesuai kebutuhan operasional dan kebijakan retensi internal, umumnya tidak lebih dari 12 bulan sejak dicatat, kecuali diatur lain.',
              'Catatan transaksi langganan dapat disimpan lebih lama untuk memenuhi kewajiban akuntansi dan perpajakan.',
              'Log teknis disimpan dalam jangka waktu terbatas untuk keperluan keamanan dan pemecahan masalah.',
            ]}
          />
        </LegalSection>

        <LegalSection id="keamanan" number={7} title="Langkah Keamanan">
          <LegalList
            items={[
              'Enkripsi AES-256 untuk kredensial rekening dan TLS/HTTPS untuk seluruh lalu lintas data.',
              'Kata sandi disimpan sebagai hash satu arah, bukan teks biasa.',
              'Dukungan autentikasi dua faktor (TOTP) dan kode pemulihan.',
              'Pembatasan akses internal berdasarkan kebutuhan operasional, dengan pencatatan aktivitas.',
              'Pemantauan berkelanjutan dan pembaruan keamanan pada infrastruktur.',
            ]}
          />
          <p>
            Meskipun demikian, tidak ada sistem yang sepenuhnya bebas risiko. Kami akan memberitahukan
            Anda apabila terjadi insiden yang berdampak material pada data pribadi Anda, sesuai ketentuan
            yang berlaku.
          </p>
        </LegalSection>

        <LegalSection id="hak" number={8} title="Hak Anda">
          <p>Sebagai subjek data, Anda berhak untuk:</p>
          <LegalList
            items={[
              'Memperoleh informasi mengenai data pribadi yang kami proses.',
              'Meminta akses dan salinan data pribadi Anda.',
              'Meminta perbaikan atas data yang tidak akurat atau tidak lengkap.',
              'Meminta penghapusan data, sepanjang tidak bertentangan dengan kewajiban hukum kami.',
              'Menarik persetujuan atas pemrosesan yang berdasarkan persetujuan.',
              'Mengajukan keberatan atas pemrosesan tertentu.',
            ]}
          />
          <p>
            Permintaan dapat diajukan melalui kanal dukungan pada dashboard member. Kami akan memverifikasi
            identitas Anda sebelum memproses permintaan dan merespons dalam waktu yang wajar sesuai
            ketentuan yang berlaku.
          </p>
        </LegalSection>

        <LegalSection id="cookie" number={9} title="Cookie & Teknologi Serupa">
          <p>
            Kami menggunakan cookie dan penyimpanan lokal yang diperlukan untuk menjaga sesi login,
            mengingat preferensi tampilan, dan menjaga keamanan akun.
          </p>
          <p>
            Kami tidak menggunakan cookie iklan pihak ketiga untuk pelacakan lintas situs. Anda dapat
            mengatur cookie melalui pengaturan browser, namun menonaktifkan cookie esensial dapat membuat
            Anda tidak dapat masuk ke dashboard.
          </p>
        </LegalSection>

        <LegalSection id="anak" number={10} title="Privasi Anak">
          <p>
            Layanan ditujukan untuk pengguna berusia 18 tahun ke atas atau badan usaha yang sah. Kami
            tidak dengan sengaja mengumpulkan data dari anak di bawah umur. Apabila Anda mengetahui adanya
            data semacam itu, silakan hubungi kami agar dapat kami hapus.
          </p>
        </LegalSection>

        <LegalSection id="internasional" number={11} title="Transfer Internasional">
          <p>
            Data dapat diproses pada server yang berlokasi di luar Indonesia oleh penyedia infrastruktur
            kami. Dalam hal demikian, kami memastikan adanya perlindungan yang memadai sesuai ketentuan
            perlindungan data yang berlaku.
          </p>
        </LegalSection>

        <LegalSection id="perubahan" number={12} title="Perubahan Kebijakan">
          <p>
            Kebijakan ini dapat diperbarui sewaktu-waktu. Perubahan material akan diberitahukan melalui
            dashboard atau email terdaftar. Tanggal &ldquo;Terakhir diperbarui&rdquo; pada bagian atas
            halaman menunjukkan versi yang berlaku.
          </p>
        </LegalSection>

        <LegalSection id="kontak" number={13} title="Kontak">
          <p>
            Pertanyaan mengenai Kebijakan Privasi atau permintaan terkait data pribadi dapat disampaikan
            melalui kanal dukungan pada dashboard member atau halaman dokumentasi.
          </p>
        </LegalSection>

        <ContactCard />
      </LegalShell>
    </>
  );
}
