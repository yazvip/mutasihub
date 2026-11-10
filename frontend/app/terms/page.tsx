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
const EFFECTIVE = '10 November 2026';

export const metadata: Metadata = {
  title: 'Syarat & Ketentuan — MutasiHub',
  description:
    'Syarat dan Ketentuan penggunaan layanan MutasiHub: agregasi mutasi rekening DANA & BCA realtime, ketentuan langganan, batas penggunaan wajar, keamanan kredensial read-only, dan hak serta kewajiban pengguna.',
  keywords: [
    'syarat dan ketentuan mutasihub',
    'terms of service mutasi hub',
    'ketentuan layanan cek mutasi',
    'mutasi DANA BCA API',
    'legal mutasihub',
  ],
  alternates: {
    canonical: '/terms',
  },
  openGraph: {
    title: 'Syarat & Ketentuan — MutasiHub',
    description:
      'Ketentuan resmi penggunaan layanan MutasiHub: langganan, batas penggunaan, keamanan data, dan tanggung jawab pengguna.',
    url: 'https://mutasi.rajacek.com/terms',
    siteName: 'MutasiHub',
    locale: 'id_ID',
    type: 'article',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Syarat & Ketentuan MutasiHub' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Syarat & Ketentuan — MutasiHub',
    description: 'Ketentuan resmi penggunaan layanan MutasiHub.',
    images: ['/og-image.png'],
  },
  robots: { index: true, follow: true },
};

const TOC: TocItem[] = [
  { id: 'penerimaan', title: 'Penerimaan Ketentuan' },
  { id: 'definisi', title: 'Definisi' },
  { id: 'layanan', title: 'Deskripsi Layanan' },
  { id: 'akun', title: 'Akun Pengguna' },
  { id: 'keamanan', title: 'Keamanan & Kredensial Rekening' },
  { id: 'langganan', title: 'Langganan & Pembayaran' },
  { id: 'trial', title: 'Trial, Pembatalan & Pengembalian Dana' },
  { id: 'fair-use', title: 'Batas Penggunaan Wajar' },
  { id: 'larangan', title: 'Larangan Penggunaan' },
  { id: 'hki', title: 'Hak Kekayaan Intelektual' },
  { id: 'ketersediaan', title: 'Ketersediaan Layanan' },
  { id: 'penafian', title: 'Penafian & Batasan Tanggung Jawab' },
  { id: 'penghentian', title: 'Penangguhan & Penghentian' },
  { id: 'perubahan', title: 'Perubahan Ketentuan' },
  { id: 'hukum', title: 'Hukum yang Berlaku' },
  { id: 'kontak', title: 'Kontak' },
];

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  name: 'Syarat & Ketentuan — MutasiHub',
  description:
    'Syarat dan Ketentuan penggunaan layanan MutasiHub, platform agregasi mutasi rekening realtime.',
  url: 'https://mutasi.rajacek.com/terms',
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
      { '@type': 'ListItem', position: 2, name: 'Syarat & Ketentuan', item: 'https://mutasi.rajacek.com/terms' },
    ],
  },
};

export default function TermsPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <LegalShell
        eyebrow="Syarat & Ketentuan"
        title="Syarat & Ketentuan Layanan"
        description="Dokumen ini mengatur hubungan hukum antara Anda sebagai pengguna dan MutasiHub sebagai penyedia layanan agregasi mutasi rekening. Mohon dibaca sebelum membuat akun atau berlangganan."
        updated={UPDATED}
        toc={TOC}
      >
        <Callout tone="warn" title="Ringkasan singkat">
          MutasiHub <strong>hanya membaca</strong> mutasi rekening Anda — tidak dapat memindahkan dana,
          tidak menyimpan saldo, dan bukan dompet digital. Kredensial rekening disimpan terenkripsi
          AES-256 dan dipakai semata-mata untuk membaca riwayat transaksi.
        </Callout>

        <LegalSection id="penerimaan" number={1} title="Penerimaan Ketentuan">
          <p>
            Dengan mendaftar, mengakses, atau menggunakan layanan MutasiHub yang tersedia pada domain
            <strong> mutasi.rajacek.com</strong> beserta seluruh subdomain dan API-nya (selanjutnya
            disebut &ldquo;Layanan&rdquo;), Anda menyatakan telah membaca, memahami, dan menyetujui
            seluruh isi Syarat &amp; Ketentuan ini.
          </p>
          <p>
            Jika Anda tidak menyetujui sebagian atau seluruh ketentuan ini, Anda tidak diperkenankan
            menggunakan Layanan dan wajib menghentikan penggunaan serta menghapus akun Anda.
          </p>
          <p>
            Ketentuan ini berlaku efektif sejak <strong>{EFFECTIVE}</strong> dan menggantikan seluruh
            ketentuan sebelumnya yang mungkin pernah dipublikasikan.
          </p>
        </LegalSection>

        <LegalSection id="definisi" number={2} title="Definisi">
          <LegalList
            items={[
              <>
                <strong>MutasiHub</strong>, <strong>kami</strong>, atau <strong>Layanan</strong> —
                platform agregasi mutasi rekening beserta situs, dashboard, API, dan infrastruktur
                pendukungnya.
              </>,
              <>
                <strong>Pengguna</strong> atau <strong>Anda</strong> — individu atau badan usaha yang
                memiliki akun terdaftar dan menggunakan Layanan.
              </>,
              <>
                <strong>Rekening Terhubung</strong> — rekening DANA atau BCA milik Pengguna yang
                dihubungkan ke Layanan untuk dibaca mutasinya.
              </>,
              <>
                <strong>Kredensial</strong> — data akses rekening seperti nomor HP, nomor rekening,
                User ID, atau PIN yang diperlukan untuk membaca mutasi.
              </>,
              <>
                <strong>Paket</strong> — tingkatan langganan berbayar atau trial yang menentukan batas
                jumlah Rekening Terhubung, jeda pembaruan data, kuota inquiry, dan fitur lain.
              </>,
              <>
                <strong>Callback</strong> — notifikasi HTTP yang kami kirim ke endpoint milik Pengguna
                ketika terdeteksi mutasi baru.
              </>,
            ]}
          />
        </LegalSection>

        <LegalSection id="layanan" number={3} title="Deskripsi Layanan">
          <p>
            MutasiHub adalah layanan <strong>agregasi dan pemantauan mutasi rekening</strong> yang
            membantu bisnis mendeteksi pembayaran masuk secara otomatis untuk keperluan top-up, deposit,
            dan rekonsiliasi keuangan.
          </p>
          <p>Fitur Layanan meliputi, antara lain:</p>
          <LegalList
            items={[
              'Pembacaan mutasi rekening DANA dan BCA secara berkala sesuai jeda Paket yang aktif.',
              'Penyajian mutasi pada dashboard member yang dapat difilter dan diekspor.',
              'Callback atau webhook ke sistem Pengguna saat terdeteksi transaksi masuk.',
              'Fitur inquiry nama pemilik rekening pada Paket yang menyertakannya.',
              'Dokumentasi API dan playground untuk pengujian integrasi.',
            ]}
          />
          <Callout tone="ok" title="Sifat layanan">
            MutasiHub adalah alat bantu pemantauan. Layanan ini <strong>bukan</strong> penyedia jasa
            keuangan, bukan penyelenggara transfer dana, dan tidak menyimpan, menampung, atau
            meneruskan dana Pengguna dalam bentuk apa pun.
          </Callout>
          <p>
            Kami berhak menambah, mengubah, atau menghentikan fitur tertentu dengan pemberitahuan
            melalui dashboard, email terdaftar, atau halaman ini.
          </p>
        </LegalSection>

        <LegalSection id="akun" number={4} title="Akun Pengguna">
          <LegalList
            items={[
              'Anda wajib memberikan data pendaftaran yang benar, lengkap, dan terkini.',
              'Anda bertanggung jawab menjaga kerahasiaan kata sandi, kode OTP, dan kode pemulihan akun.',
              'Satu akun diperuntukkan bagi satu badan usaha atau satu pengguna perorangan, kecuali disepakati lain secara tertulis.',
              'Anda wajib segera memberitahukan kami apabila mencurigai adanya akses tidak sah atas akun Anda.',
              'Seluruh aktivitas yang terjadi melalui akun Anda dianggap sebagai tindakan Anda, kecuali dapat dibuktikan sebaliknya.',
            ]}
          />
          <p>
            Kami dapat meminta verifikasi tambahan sebelum mengaktifkan fitur tertentu, termasuk
            verifikasi kepemilikan alamat email atau nomor telepon.
          </p>
        </LegalSection>

        <LegalSection id="keamanan" number={5} title="Keamanan & Kredensial Rekening">
          <p>
            Untuk membaca mutasi, Layanan memerlukan Kredensial Rekening yang Anda berikan secara
            sukarela. Ketentuan pengelolaannya adalah sebagai berikut:
          </p>
          <LegalList
            items={[
              <>
                Kredensial disimpan dalam bentuk <strong>terenkripsi AES-256</strong> dan tidak pernah
                ditampilkan kembali secara utuh melalui antarmuka.
              </>,
              <>
                Kredensial dipakai <strong>hanya untuk membaca</strong> daftar dan riwayat mutasi
                (read-only). Layanan tidak memiliki dan tidak menggunakan kemampuan untuk melakukan
                transfer, pembayaran, atau perubahan data rekening.
              </>,
              'Akses internal terhadap kredensial dibatasi, dicatat, dan hanya diberikan kepada personel yang membutuhkannya untuk operasional.',
              'Anda dapat memutus koneksi Rekening Terhubung kapan saja melalui dashboard; penghapusan akan menghapus kredensial tersimpan.',
              'Anda bertanggung jawab memastikan bahwa Anda berhak memberikan Kredensial Rekening yang dihubungkan, dan bahwa penggunaan Layanan tidak melanggar ketentuan bank atau penyedia dompet digital terkait.',
            ]}
          />
          <Callout tone="warn" title="Penting">
            Jangan pernah membagikan kata sandi, PIN, atau kode OTP kepada pihak lain — termasuk kepada
            siapa pun yang mengaku sebagai staf MutasiHub. Kami tidak pernah meminta kode OTP melalui
            chat, telepon, atau email.
          </Callout>
        </LegalSection>

        <LegalSection id="langganan" number={6} title="Langganan & Pembayaran">
          <LegalList
            items={[
              'Layanan berbayar ditawarkan dalam Paket dengan durasi tertentu (umumnya 30 hari) dan batas fitur yang tercantum pada halaman harga.',
              'Harga yang berlaku adalah harga yang tercantum pada halaman harga atau invoice pada saat transaksi, dalam Rupiah.',
              'Langganan tidak diperpanjang otomatis. Anda perlu melakukan pembayaran ulang untuk melanjutkan masa aktif.',
              'Keterlambatan pembayaran dapat menyebabkan pembatasan atau penonaktifan sementara fitur hingga masa aktif diperbarui.',
              'Bukti pembayaran dan invoice disediakan melalui dashboard member.',
            ]}
          />
          <p>
            Perubahan harga tidak berlaku surut terhadap masa aktif yang sudah dibayar. Kami akan
            mengumumkan perubahan harga sebelum masa aktif berikutnya.
          </p>
        </LegalSection>

        <LegalSection id="trial" number={7} title="Trial, Pembatalan & Pengembalian Dana">
          <LegalList
            items={[
              'Akun baru dapat memperoleh masa trial terbatas (saat ini 1 hari) dengan batas fitur tertentu, satu kali per pengguna atau badan usaha.',
              'Penyalahgunaan trial — termasuk pembuatan akun ganda untuk memperpanjang masa trial — dapat menyebabkan penangguhan akun.',
              'Anda dapat berhenti berlangganan kapan saja dengan tidak memperpanjang masa aktif; tidak ada penalti pembatalan.',
              'Permintaan pengembalian dana dapat diajukan dalam 3 hari kalender sejak pembayaran, sepanjang kuota pemakaian wajar belum terlampaui dan tidak ditemukan pelanggaran ketentuan.',
              'Pengembalian dana diproses ke metode pembayaran asal dalam 7–14 hari kerja setelah disetujui, dikurangi biaya pihak ketiga yang tidak dapat ditarik kembali.',
            ]}
          />
        </LegalSection>

        <LegalSection id="fair-use" number={8} title="Batas Penggunaan Wajar">
          <p>
            Untuk menjaga kualitas layanan bagi seluruh pengguna, berlaku batas penggunaan berikut:
          </p>
          <LegalList
            items={[
              'Jumlah Rekening Terhubung dibatasi sesuai Paket. Rekening melebihi batas akan dijeda pembaruannya sampai jumlahnya sesuai atau Paket ditingkatkan.',
              'Jeda pembaruan data mutasi dan interval notifikasi mengikuti ketentuan Paket yang aktif.',
              'Kuota inquiry rekening dibatasi harian sesuai Paket dan direset setiap hari.',
              'Permintaan API di luar kuota wajar dapat dibatasi, ditunda, atau ditolak sementara untuk mencegah penyalahgunaan.',
            ]}
          />
          <p>
            Batas yang tercantum pada halaman harga merupakan bagian yang tidak terpisahkan dari
            ketentuan ini dan dapat berubah dengan pemberitahuan.
          </p>
        </LegalSection>

        <LegalSection id="larangan" number={9} title="Larangan Penggunaan">
          <p>Anda dilarang menggunakan Layanan untuk:</p>
          <LegalList
            items={[
              'Kegiatan yang melanggar hukum, termasuk pencucian uang, penipuan, perjudian ilegal, dan pendanaan terorisme.',
              'Memproses rekening yang bukan milik Anda atau yang tidak Anda dapatkan izinnya secara sah.',
              'Mengakses sistem, mencoba menembus autentikasi, atau melakukan pemindaian kerentanan tanpa izin tertulis.',
              'Melakukan scraping masif, membebani infrastruktur secara berlebihan, atau mengganggu pengguna lain.',
              'Menjual kembali, menyewakan, atau mengalihkan akses Layanan kepada pihak ketiga tanpa persetujuan tertulis.',
              'Merekayasa balik, menyalin, atau membuat produk turunan dari Layanan.',
              'Menyebarkan malware, mengirim spam, atau menggunakan Callback untuk tujuan yang merugikan.',
            ]}
          />
          <p>
            Pelanggaran dapat berakibat penangguhan segera tanpa pengembalian dana, dan bila diperlukan
            dilaporkan kepada pihak berwenang.
          </p>
        </LegalSection>

        <LegalSection id="hki" number={10} title="Hak Kekayaan Intelektual">
          <p>
            Seluruh hak atas perangkat lunak, kode, desain antarmuka, merek, logo, dokumentasi, dan
            konten Layanan adalah milik MutasiHub atau pemberi lisensinya dan dilindungi hukum.
          </p>
          <p>
            Kami memberi Anda lisensi terbatas, tidak eksklusif, tidak dapat dialihkan, dan dapat
            dicabut untuk menggunakan Layanan sesuai ketentuan ini. Lisensi ini tidak memberikan hak
            kepemilikan apa pun atas Layanan.
          </p>
          <p>
            Data mutasi dan data bisnis Anda tetap menjadi milik Anda. Anda memberi kami izin terbatas
            untuk memproses data tersebut semata-mata untuk menyediakan Layanan.
          </p>
        </LegalSection>

        <LegalSection id="ketersediaan" number={11} title="Ketersediaan Layanan">
          <p>
            Kami berupaya menjaga Layanan tersedia secara berkelanjutan, namun tidak menjamin
            ketersediaan tanpa gangguan. Layanan dapat dihentikan sementara untuk pemeliharaan,
            peningkatan, atau karena keadaan di luar kendali kami.
          </p>
          <LegalList
            items={[
              'Gangguan dapat berasal dari pihak ketiga seperti penyedia bank, dompet digital, jaringan pembayaran, atau penyedia infrastruktur cloud.',
              'Jeda pembaruan data merupakan bagian normal dari desain Layanan dan bukan gangguan.',
              'Kami tidak bertanggung jawab atas kerugian yang timbul akibat gangguan yang berasal dari sistem di luar kendali kami.',
            ]}
          />
        </LegalSection>

        <LegalSection id="penafian" number={12} title="Penafian & Batasan Tanggung Jawab">
          <p>
            Layanan disediakan &ldquo;sebagaimana adanya&rdquo;. Kami tidak menjamin bahwa data mutasi
            selalu lengkap, tepat waktu, atau bebas kesalahan, karena sumber data berasal dari sistem
            pihak ketiga.
          </p>
          <Callout tone="warn" title="Batas tanggung jawab">
            Sejauh diizinkan hukum, total tanggung jawab kami atas segala klaim terkait Layanan dibatasi
            sebesar nilai langganan yang Anda bayarkan dalam 3 bulan terakhir. Kami tidak bertanggung
            jawab atas kerugian tidak langsung, kehilangan keuntungan, kehilangan data, atau kerugian
            konsekuensial lainnya.
          </Callout>
          <p>
            Anda bertanggung jawab melakukan rekonsiliasi dan verifikasi akhir atas setiap transaksi
            sebelum mengambil keputusan bisnis, termasuk keputusan mengkreditkan saldo pengguna Anda.
          </p>
        </LegalSection>

        <LegalSection id="penghentian" number={13} title="Penangguhan & Penghentian">
          <LegalList
            items={[
              'Kami dapat menangguhkan akun apabila terdapat indikasi pelanggaran, tunggakan pembayaran, atau aktivitas mencurigakan.',
              'Anda dapat menghapus akun kapan saja melalui dashboard atau dengan menghubungi kami.',
              'Setelah akun dihapus, kredensial tersimpan akan dihapus dan akses ke Layanan dihentikan.',
              'Data tertentu dapat tetap kami simpan untuk jangka waktu tertentu guna memenuhi kewajiban hukum, akuntansi, atau penyelesaian sengketa.',
            ]}
          />
        </LegalSection>

        <LegalSection id="perubahan" number={14} title="Perubahan Ketentuan">
          <p>
            Kami dapat memperbarui Syarat &amp; Ketentuan ini dari waktu ke waktu. Perubahan material
            akan diberitahukan melalui dashboard, email terdaftar, atau pengumuman pada situs.
          </p>
          <p>
            Tanggal &ldquo;Terakhir diperbarui&rdquo; pada bagian atas halaman menunjukkan versi yang
            berlaku. Dengan terus menggunakan Layanan setelah perubahan berlaku, Anda dianggap
            menyetujui ketentuan yang diperbarui.
          </p>
        </LegalSection>

        <LegalSection id="hukum" number={15} title="Hukum yang Berlaku & Penyelesaian Sengketa">
          <p>
            Ketentuan ini diatur dan ditafsirkan berdasarkan hukum Republik Indonesia. Para pihak
            sepakat untuk terlebih dahulu menyelesaikan perselisihan secara musyawarah dalam jangka
            waktu 30 hari kalender sejak pemberitahuan tertulis.
          </p>
          <p>
            Apabila musyawarah tidak mencapai kesepakatan, sengketa akan diselesaikan melalui
            pengadilan yang berwenang di wilayah domisili penyelenggara Layanan.
          </p>
        </LegalSection>

        <LegalSection id="kontak" number={16} title="Kontak">
          <p>
            Pertanyaan, keberatan, atau pemberitahuan terkait Syarat &amp; Ketentuan ini dapat
            disampaikan melalui kanal dukungan yang tercantum pada dashboard member atau halaman
            dokumentasi.
          </p>
          <p>
            Kami berupaya merespons setiap pertanyaan dalam 1–2 hari kerja.
          </p>
        </LegalSection>

        <ContactCard />
      </LegalShell>
    </>
  );
}
