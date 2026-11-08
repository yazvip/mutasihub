'use client';

import Link from 'next/link';
import { useState } from 'react';

const SECTIONS = [
  { id: 'pengantar', label: 'Pengantar', num: '01' },
  { id: 'mulai-cepat', label: 'Mulai Cepat', num: '02' },
  { id: 'autentikasi', label: 'Autentikasi', num: '03' },
  { id: 'ambil-mutasi', label: 'Ambil Mutasi', num: '04' },
  { id: 'contoh-kode', label: 'Contoh Kode', num: '05' },
  { id: 'rate-limit', label: 'Rate Limit', num: '06' },
  { id: 'error', label: 'Error', num: '07' },
  { id: 'inquiry', label: 'Inquiry Rekening', num: '08' },
  { id: 'keamanan', label: 'Keamanan', num: '09' },
  { id: 'ganti-paket', label: 'Ganti Paket', num: '10' },
];

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="copy-btn"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement('textarea');
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? 'Disalin ✓' : label ?? 'Salin'}
    </button>
  );
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  return (
    <div className="code-block">
      <div className="code-block-head">
        <span>{lang}</span>
        <CopyButton text={code} />
      </div>
      {/* v31-C (P2-11): wrapper .code-scroll — fade tepi kanan + scrollbar
          terlihat (lihat blok v31-C di globals.css). */}
      <div className="code-scroll">
        <pre>{code}</pre>
      </div>
    </div>
  );
}

function SectionHead({ num, id, title }: { num: string; id: string; title: string }) {
  return (
    <h2 id={id}>
      <span className="docs-num">{num}</span> {title}
    </h2>
  );
}

const CURL_BASIC = `curl "https://mutasi.rajacek.com/api/v1/mutasi?from=2026-11-01&type=CR&page_size=10" \\
  -H "X-API-Key: mh_CONTOH_KEY_ANDA"`;

const CURL_CSV = `curl "https://mutasi.rajacek.com/api/v1/mutasi?from=2026-11-01&format=csv" \\
  -H "X-API-Key: mh_CONTOH_KEY_ANDA" -o mutasi.csv`;

const JS_EXAMPLE = `const res = await fetch(
  'https://mutasi.rajacek.com/api/v1/mutasi?from=2026-11-01&page_size=10',
  { headers: { 'X-API-Key': 'mh_CONTOH_KEY_ANDA' } }
);

if (!res.ok) {
  const err = await res.json();
  throw new Error(err.error + ': ' + err.message);
}

const json = await res.json();
for (const m of json.data) {
  console.log(m.date, m.sender, 'Rp' + (m.amount_cents / 100).toLocaleString('id-ID'));
}`;

const PHP_EXAMPLE = `<?php
$ch = curl_init('https://mutasi.rajacek.com/api/v1/mutasi?from=2026-11-01&page_size=10');
curl_setopt_array($ch, [
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => ['X-API-Key: mh_CONTOH_KEY_ANDA'],
]);
$body = curl_exec($ch);
$data = json_decode($body, true);

foreach ($data['data'] as $m) {
  echo $m['date'] . ' — ' . $m['sender'] . ' — Rp'
    . number_format($m['amount_cents'] / 100, 0, ',', '.') . PHP_EOL;
}`;

const RESPONSE_EXAMPLE = `{
  "data": [
    {
      "provider": "DANA",
      "date": "2026-11-07T10:15:00+07:00",
      "type": "CR",
      "amount_cents": 15000000,
      "description": "Transfer dari Budi",
      "sender": "Budi Santoso"
    }
  ],
  "page": 1,
  "page_size": 20,
  "total": 128
}`;

const USAGE_EXAMPLE = `{
  "limit_today": 100,
  "used_today": 37,
  "remaining_today": 63,
  "resets_at": "2026-11-09T00:00:00+07:00"
}`;

const INQUIRY_LIMIT_EXAMPLE = `{
  "error": "inquiry_limit_reached",
  "message": "Batas inquiry hari ini habis. Reset 00:00 WIB.",
  "limit_today": 100,
  "remaining_today": 0
}`;

const ERROR_EXAMPLE = `{
  "error": "invalid_api_key",
  "message": "API key tidak valid atau nonaktif"
}`;

const PARAMS: { name: string; example: string; desc: string }[] = [
  { name: 'from', example: '2026-11-01', desc: 'Mutasi sejak tanggal ini (YYYY-MM-DD)' },
  { name: 'to', example: '2026-11-07', desc: 'Mutasi sampai tanggal ini (YYYY-MM-DD)' },
  { name: 'min_amount', example: '5000000', desc: 'Nominal minimal, dalam sen (Rp50.000)' },
  { name: 'max_amount', example: '10000000', desc: 'Nominal maksimal, dalam sen (Rp100.000)' },
  { name: 'sender', example: 'Budi', desc: 'Cari nama pengirim (sebagian cocok)' },
  { name: 'type', example: 'CR', desc: 'CR = masuk, DB = keluar' },
  { name: 'provider', example: 'DANA', desc: 'DANA atau BCA' },
  { name: 'page', example: '2', desc: 'Halaman, mulai dari 1 (default 1)' },
  { name: 'page_size', example: '50', desc: 'Jumlah per halaman (default 20). Nilai di luar 1–100 diabaikan dan dipakai 20 — bukan di-clamp ke 1 atau 100.' },
  { name: 'format', example: 'csv', desc: 'Isi csv untuk mengunduh file CSV (maks 5000 baris; bila hasil filter lebih banyak, hanya 5000 baris pertama yang diunduh). Nilai lain (mis. json) ditolak 400 invalid_param.' },
];

const ERRORS: { status: string; code: string; desc: string }[] = [
  { status: '400', code: 'invalid_param', desc: 'Parameter tidak valid — format selain csv/kosong, from/to bukan YYYY-MM-DD, type bukan CR/DB, provider bukan DANA/BCA, atau min_amount lebih besar dari max_amount' },
  { status: '401', code: 'invalid_api_key', desc: 'API key tidak valid atau sudah nonaktif' },
  { status: '401', code: 'api_key_expired', desc: 'API key sudah lewat tanggal kedaluwarsanya — buat key baru' },
  { status: '401', code: 'unauthorized', desc: 'Tidak ada API key dan tidak login' },
  { status: '403', code: 'ip_not_allowed', desc: 'IP server Anda tidak ada di whitelist key ini' },
  { status: '403', code: 'insufficient_scope', desc: 'API key ini tidak punya scope mutasi:read' },
  { status: '403', code: 'subscription_expired', desc: 'Langganan tidak aktif atau sudah kedaluwarsa — perpanjang paket dulu' },
  { status: '429', code: 'rate_limited', desc: 'Terlalu banyak request, coba lagi sebentar lagi' },
  { status: '429', code: 'inquiry_limit_reached', desc: 'Batas inquiry harian paket Anda habis (remaining_today 0) — tunggu reset 00:00 WIB atau upgrade paket' },
  { status: '500', code: 'db_error', desc: 'Gagal membaca mutasi, coba lagi nanti' },
  { status: '503', code: 'db_unavailable', desc: 'Database tidak tersedia, coba lagi nanti' },
];

export default function ApiDocsPage() {
  return (
    <>
      {/* Hero */}
      <section className="docs-hero">
        <div className="container">
          <p className="eyebrow">Dokumentasi API</p>
          <h1>API MutasiHub</h1>
          <p className="lead">
            Ambil riwayat mutasi DANA &amp; BCA Anda dari sistem sendiri — toko online,
            bot, atau dashboard internal — cukup dengan satu API key. Tanpa SDK,
            tanpa OAuth: satu header, satu endpoint.
          </p>
          <div className="docs-quick">
            <div className="docs-quick-card">
              <span className="docs-quick-label">Base URL</span>
              <span className="mono">mutasi.rajacek.com</span>
              <span className="docs-quick-sub">Semua request lewat HTTPS</span>
            </div>
            <div className="docs-quick-card">
              <span className="docs-quick-label">Autentikasi</span>
              <span className="mono">Header X-API-Key</span>
              <span className="docs-quick-sub">Key diawali mh_ · tampil sekali</span>
            </div>
            <div className="docs-quick-card">
              <span className="docs-quick-label">Rate Limit</span>
              <span className="mono">60 / menit</span>
              <span className="docs-quick-sub">Hanya untuk API key · 300 / menit bila delay API paket 0</span>
            </div>
          </div>
        </div>
      </section>

      {/* Navigasi bab — chip horizontal di HP */}
      <nav className="docs-chips" aria-label="Daftar isi">
        <div className="container docs-chips-inner">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`}>
              {s.label}
            </a>
          ))}
        </div>
      </nav>

      <section className="section docs-body">
        <div className="container docs-layout">
          <aside className="docs-nav" aria-label="Daftar isi">
            <p className="docs-nav-title">Di halaman ini</p>
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`}>
                <span className="docs-nav-num">{s.num}</span> {s.label}
              </a>
            ))}
          </aside>

          <div className="docs-content">
            <SectionHead num="01" id="pengantar" title="Pengantar" />
            <p>
              Semua request memakai <strong>HTTPS</strong> ke base URL di bawah.
              Respons selalu JSON, kecuali bila Anda meminta format CSV. Nominal
              memakai satuan <strong>sen</strong>: 1 rupiah = 100 sen (jadi Rp150.000 ={' '}
              <code>15000000</code>).
            </p>
            <CodeBlock lang="Base URL" code="https://mutasi.rajacek.com" />

            <SectionHead num="02" id="mulai-cepat" title="Mulai Cepat" />
            <div className="docs-steps">
              <div className="docs-step">
                <span className="docs-step-num">1</span>
                <h3>Buat API key</h3>
                <p>
                  Masuk ke <Link href="/member/api">halaman API Key</Link> lalu tekan{' '}
                  <strong>Buat Key</strong>. Salin key yang muncul — key hanya
                  ditampilkan <strong>satu kali</strong>.
                </p>
              </div>
              <div className="docs-step">
                <span className="docs-step-num">2</span>
                <h3>Amankan key</h3>
                <p>
                  Isi <strong>IP Whitelist</strong> dengan IP server Anda, supaya key
                  tidak bisa dipakai dari tempat lain.
                </p>
              </div>
              <div className="docs-step">
                <span className="docs-step-num">3</span>
                <h3>Panggil endpoint</h3>
                <p>
                  Kirim header <code>X-API-Key</code> ke endpoint mutasi. Contoh
                  paling singkat:
                </p>
              </div>
            </div>
            <CodeBlock lang="cURL" code={CURL_BASIC} />

            <SectionHead num="03" id="autentikasi" title="Autentikasi" />
            <p>
              Sertakan API key di setiap request lewat header{' '}
              <code>X-API-Key</code>. Key berawalan <code>mh_</code>. Tanpa header
              ini (dan tanpa login di browser), server menjawab <code>401</code>.
            </p>
            <CodeBlock lang="Header" code={'X-API-Key: mh_CONTOH_KEY_ANDA'} />
            <p>
              Key yang sudah dibuat tidak bisa dilihat lagi isinya — yang tampil di
              daftar hanya prefix-nya (mis. <code>mh_a1b2c3d4</code>). Bila key hilang
              atau bocor, hapus dari halaman API Key lalu buat yang baru.
            </p>

            <SectionHead num="04" id="ambil-mutasi" title="Ambil Mutasi" />
            <div className="endpoint-card">
              <span className="method-get">GET</span>
              <code>/api/v1/mutasi</code>
              <CopyButton text="https://mutasi.rajacek.com/api/v1/mutasi" label="Salin URL" />
            </div>
            <p>
              Mengembalikan mutasi rekening Anda yang terhubung, dari yang terbaru.
              Semua parameter di bawah opsional dan dikirim sebagai query string.
            </p>
            <table className="docs-table">
              <thead>
                <tr>
                  <th>Parameter</th>
                  <th>Contoh</th>
                  <th>Keterangan</th>
                </tr>
              </thead>
              <tbody>
                {PARAMS.map((p) => (
                  <tr key={p.name}>
                    <td data-label="Parameter" className="mono">{p.name}</td>
                    <td data-label="Contoh" className="mono">{p.example}</td>
                    <td data-label="Keterangan">{p.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3>Contoh respons</h3>
            <CodeBlock lang="JSON" code={RESPONSE_EXAMPLE} />
            <ul className="docs-list">
              <li><code>date</code> — waktu mutasi (format RFC 3339, zona WIB).</li>
              <li><code>type</code> — <code>CR</code> uang masuk, <code>DB</code> uang keluar.</li>
              <li><code>amount_cents</code> — nominal dalam sen; bagi 100 untuk rupiah.</li>
              <li><code>total</code> — jumlah mutasi yang cocok dengan filter; pakai <code>page</code> untuk mengambil halaman berikutnya.</li>
            </ul>
            <h3>Unduh sebagai CSV</h3>
            <p>
              Tambahkan <code>format=csv</code> untuk mendapatkan file CSV (kolom:
              provider, date, type, amount_cents, description, sender) — cocok untuk
              rekonsiliasi di spreadsheet. Export CSV mengabaikan paginasi, tetapi
              dibatasi <strong>maksimal 5000 baris</strong>: bila hasil filter Anda
              lebih dari 5000 mutasi, hanya 5000 baris pertama yang diunduh dan
              respons menandai <code>X-CSV-Truncated: true</code> beserta totalnya
              di <code>X-Total-Count</code>. Persempit filter tanggal
              (<code>from</code>/<code>to</code>) untuk mengunduh sisanya.
              Nilai <code>format</code> selain <code>csv</code> (atau kosong)
              ditolak dengan <code>400 invalid_param</code> — tidak ada format
              lain yang diam-diam dianggap JSON.
            </p>
            <CodeBlock lang="cURL" code={CURL_CSV} />

            <SectionHead num="05" id="contoh-kode" title="Contoh Kode" />
            <h3>JavaScript (fetch)</h3>
            <CodeBlock lang="JavaScript" code={JS_EXAMPLE} />
            <h3>PHP (cURL)</h3>
            <CodeBlock lang="PHP" code={PHP_EXAMPLE} />

            <SectionHead num="06" id="rate-limit" title="Rate Limit" />
            <div className="docs-rate">
              <div className="docs-rate-card">
                <span className="docs-rate-value">60<span>/mnt</span></span>
                <span className="docs-rate-label">Standar — semua paket aktif</span>
              </div>
              <div className="docs-rate-card">
                <span className="docs-rate-value">300<span>/mnt</span></span>
                <span className="docs-rate-label">Paket aktif dengan delay API 0 menit</span>
              </div>
            </div>
            <p>
              Rate limit <strong>hanya berlaku untuk request yang memakai API
              key</strong> (header <code>X-API-Key</code>). Akses lewat sesi
              login di dashboard <strong>tidak</strong> kena batas ini. Syarat
              300/menit bukan label paketnya: yang menentukan adalah paket
              aktif Anda punya <code>api_delay_minutes = 0</code> — paket apa
              pun dengan delay 0 mendapat 300/menit, paket dengan delay di
              atas 0 tetap 60/menit.
            </p>
            <p>
              Melewati batas, server menjawab <code>429</code> — tunggu sebentar
              lalu ulangi. Untuk sinkronisasi rutin, cukup panggil sekali tiap 1–5
              menit dengan filter <code>from</code> tanggal terakhir yang sudah Anda
              simpan.
            </p>

            <SectionHead num="07" id="error" title="Error" />
            <p>Semua error memakai bentuk yang sama:</p>
            <CodeBlock lang="JSON" code={ERROR_EXAMPLE} />
            <table className="docs-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Kode</th>
                  <th>Artinya</th>
                </tr>
              </thead>
              <tbody>
                {ERRORS.map((e) => (
                  <tr key={e.code}>
                    <td data-label="Status" className="mono">{e.status}</td>
                    <td data-label="Kode" className="mono">{e.code}</td>
                    <td data-label="Artinya">{e.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <SectionHead num="08" id="inquiry" title="Inquiry Rekening — Batas Harian" />
            <p>
              Inquiry Rekening (cek nama pemilik rekening bank) hanya tersedia
              lewat <strong>login di dashboard</strong> — bukan lewat API key —
              dan hanya bila paket aktif Anda mengizinkannya. Batasnya harian
              dan mengikuti paket aktif: admin mengatur batas hit per hari di
              tiap paket (<code>inquiry_limit</code>); paket tanpa batas
              (<code>inquiry_limit</code> null) tidak kena batas ini.
              Hitungan direset setiap <strong>00:00 WIB</strong>.
            </p>
            <h3>Cek sisa hit hari ini</h3>
            <div className="endpoint-card">
              <span className="method-get">GET</span>
              <code>/api/v1/inquiry/usage</code>
              <CopyButton text="https://mutasi.rajacek.com/api/v1/inquiry/usage" label="Salin URL" />
            </div>
            <p>
              Memakai sesi login member (bukan header <code>X-API-Key</code>).
              <code>remaining_today</code> adalah sisa hit yang masih bisa
              dipakai hari ini; <code>limit_today</code> null berarti paket
              Anda tanpa batas harian. <code>resets_at</code> adalah 00:00 WIB
              berikutnya.
            </p>
            <CodeBlock lang="JSON" code={USAGE_EXAMPLE} />
            <h3>Bila batas habis</h3>
            <p>
              Inquiry yang melewati batas dijawab <code>429</code> dengan kode{' '}
              <code>inquiry_limit_reached</code> dan <code>remaining_today: 0</code> —
              inquiry gagal itu <strong>tidak</strong> mengurangi sisa hit dan
              tidak menampilkan hasil lama sebagai hasil baru. Tunggu reset
              00:00 WIB atau upgrade ke paket dengan batas lebih besar.
            </p>
            <CodeBlock lang="JSON" code={INQUIRY_LIMIT_EXAMPLE} />

            <SectionHead num="09" id="keamanan" title="Keamanan" />
            <ul className="docs-checklist">
              <li>
                <strong>Jangan bagikan key.</strong> Key = akses penuh ke riwayat
                mutasi Anda. Simpan di environment variable server, bukan di kode
                yang di-commit ke Git.
              </li>
              <li>
                <strong>Isi IP whitelist</strong> dengan IP server Anda (dipisah koma).
                Key yang dicuri tidak bisa dipakai dari IP lain.
              </li>
              <li>
                <strong>Key bocor? Hapus segera</strong> dari halaman API Key, lalu
                buat key baru dan ganti di sistem Anda.
              </li>
              <li>
                <strong>Scope</strong> dicatat saat key dibuat (<code>mutasi:read</code>
                , <code>accounts:read</code>, <code>webhook:receive</code>). Saat ini
                API key hanya bisa memanggil endpoint mutasi; scope lain disiapkan
                untuk pengembangan berikutnya.
              </li>
            </ul>
            <p>
              Endpoint lain di luar mutasi (rekening, inquiry, langganan) hanya bisa
              diakses lewat login di dashboard, bukan lewat API key.
            </p>

            <SectionHead num="10" id="ganti-paket" title="Ganti paket & rekening melebihi batas" />
            <p>
              Mengganti paket selagi paket lama masih aktif selalu meminta
              konfirmasi dulu di halaman Langganan: paket lama{' '}
              <strong>nonaktif dan sisa harinya hangus</strong> — tidak dipindah
              ke paket baru. Riwayat mutasi dan API key Anda{' '}
              <strong>tidak berubah</strong>.
            </p>
            <ul className="docs-list">
              <li>
                <strong>Rekening melebihi batas dibekukan.</strong> Bila jumlah
                rekening terhubung melebihi maks paket baru, rekening yang{' '}
                <strong>paling dulu dihubungkan tetap jalan</strong>; sisanya
                dijeda (tidak di-sync) sampai jumlah rekening ≤ batas paket
                atau Anda upgrade.
              </li>
              <li>
                <strong>Pulih sendiri.</strong> Sync rekening yang dijeda jalan
                lagi otomatis begitu Anda upgrade ke paket dengan batas lebih
                besar, atau setelah Anda memutuskan rekening lain di halaman
                Rekening.
              </li>
              <li>
                <strong>Konfirmasi wajib.</strong> Penggantian tanpa konfirmasi
                ditolak server dengan <code>409 active_subscription_exists</code> —
                halaman Langganan menampilkan perbandingan paket lama/baru dan
                daftar rekening yang akan dibekukan sebelum Anda menyetujui.
              </li>
            </ul>

            <div className="docs-cta">
              <div>
                <h3>Siap mencoba?</h3>
                <p>Buat API key pertama Anda dan ambil mutasi pertama dalam semenit.</p>
              </div>
              <Link href="/member/api" className="btn btn-primary">
                Buat API Key →
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
