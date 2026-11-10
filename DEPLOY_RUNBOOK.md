# DEPLOY RUNBOOK — MutasiHub (mutasi.rajacek.com)

> Dokumen operasional VPS. Dibuat 10/11/2026 setelah audit menyeluruh.
> **Aturan utama: server ini dipakai 3 aplikasi. Sentuh HANYA `mutasi-hub`.**

---

## 1. Ringkasan Server

| Item | Nilai |
|---|---|
| IP publik | `43.157.205.163` |
| Akses | `ssh vps` (user `ubuntu`, key ed25519, port 22) |
| Hostname | `VM-27-81-ubuntu` |
| OS | Ubuntu 24.04.4 LTS (kernel 6.8.0-138) |
| Resource | 2 vCPU / 1.9 GB RAM / 40 GB disk (48% terpakai, ~20 GB free) |
| Timezone | **CST (UTC+8)** — bukan WIB |
| Firewall (ufw) | aktif: hanya 22, 80, 443 |
| fail2ban | aktif, jail `sshd` (maxretry 5, findtime 10m, bantime 1h) |
| DNS | Cloudflare (proxied) |

---

## 2. Peta Port — WAJIB DIINGAT

| Port | Proses | Aplikasi | Bind |
|---|---|---|---|
| **8093** | `mutasi-hub` | **MutasiHub API (Go)** | `0.0.0.0` |
| **13001** | `next-server` | **MutasiHub Web (Next.js)** | `127.0.0.1` |
| 8080 | `rajacek-api` | rajacek.com — **JANGAN SENTUH** | `127.0.0.1` |
| 8092 | docker-proxy | rajatoko (tg-marketplace) — **JANGAN SENTUH** | `127.0.0.1` |
| 5433 | docker-proxy | postgres tg-marketplace | `127.0.0.1` |
| 3306 | `mysqld` | MySQL (DB `mutasi_hub` + `rajacek`) | `127.0.0.1` |
| 6379 | `redis-server` | cache/session | `127.0.0.1` |
| 80 / 443 | `nginx` | reverse proxy semua domain | `0.0.0.0` |
| 22 | `sshd` | SSH | `0.0.0.0` |

**Port kosong yang aman dipakai:** 8094–8099, 13002–13099.

---

## 3. Peta Domain → Nginx

Config: `/etc/nginx/sites-enabled/`

### `mutasi.rajacek.com` (MILIK KITA)
```
/healthz   → 127.0.0.1:8093
/api/      → 127.0.0.1:8093
/webhooks/ → 127.0.0.1:8093
/          → 127.0.0.1:13001
```
SSL: `/etc/letsencrypt/live/mutasi.rajacek.com/` (auto-renew Certbot)

### `rajacek.com` + `www` — **JANGAN UBAH**
```
/ → 127.0.0.1:8080  (rajacek-api)
```

### `www.rajatoko.web.id` — **JANGAN UBAH**
```
/ → 127.0.0.1:8092  (docker tg-marketplace-api)
```

---

## 4. Direktori Penting

| Path | Isi | Ukuran |
|---|---|---|
| **`/opt/mutasi-hub/`** | **PRODUCTION (artefak saja, tanpa .git)** | 40 MB |
| `/opt/mutasi-hub/backend/mutasi-hub` | binary Go | ~12 MB |
| `/opt/mutasi-hub/backend/migrations/` | 15 file migrasi SQL | — |
| `/opt/mutasi-hub/frontend/` | Next.js standalone (`server.js`, `.next/`, `public/`, `node_modules/`) | — |
| **`/opt/mutasi-hub-src/`** | **git clone (source of truth lokal)** | 516 MB |
| `/opt/backups/` | arsip rollback `tar.gz` | 17 MB |
| `/etc/mutasi-hub/mutasi.env` | secrets (root, `0600`) | 708 B |
| `/var/log/mutasi-hub/api.log` | log backend | — |
| `/var/log/mutasi-hub/web.log` | log frontend | — |
| `/opt/rajacek/`, `/opt/tg-marketplace/` | **JANGAN SENTUH** | — |

---

## 5. Systemd Service

### `mutasi-hub-api.service`
```
WorkingDirectory=/opt/mutasi-hub/backend
EnvironmentFile=/etc/mutasi-hub/mutasi.env
ExecStart=/opt/mutasi-hub/backend/mutasi-hub
User=ubuntu   Restart=on-failure   RestartSec=5
Log: /var/log/mutasi-hub/api.log
```

### `mutasi-hub-web.service`
```
WorkingDirectory=/opt/mutasi-hub/frontend
ExecStart=/usr/local/bin/node server.js
Environment: PORT=13001  HOSTNAME=127.0.0.1
User=ubuntu   Restart=on-failure   RestartSec=5
Log: /var/log/mutasi-hub/web.log
```

---

## 6. Database

- Engine: **MySQL** (localhost:3306), schema **`mutasi_hub`** (16 tabel)
- Migrasi terakhir: `0015_linked_accounts_authorized_at.sql`
- Lokasi file migrasi di server: `/opt/mutasi-hub/backend/migrations/`
- Schema lain di server: `rajacek` (**JANGAN SENTUH**)

Cek versi migrasi:
```bash
sudo mysql -N -e "select version from mutasi_hub.schema_migrations order by version desc limit 5;"
```

---

## 7. Runtime

| Tool | Versi | Path |
|---|---|---|
| Node | v22.21.0 | `/usr/local/bin/node` (juga `/opt/node22`) |
| npm | 10.9.4 | — |
| Go | 1.27.2 | `/opt/go1.27.2/bin/go` |

---

## 8. PROSEDUR DEPLOY

### 8.0 Alur resmi vs alur di server

Alur **resmi** (lihat `FLOW.md` §7): build di workspace lokal
(`~/workspace/mutasi-platform/`), transfer **chunked 128 KB** via wrapper SSH
(scp langsung putus ~510 KB), verifikasi hash per-chunk, backup ke
`/root/backup-mutasi-v<versi>/`, lalu deploy + hard gate `db:true`.

Alur di bawah ini adalah **jalur server** (build langsung di VPS) — dipakai
bila source sudah tersinkron di `/opt/mutasi-hub-src` dan tidak ada akses ke
workspace lokal. Hasil akhirnya sama.

### 8.1 Selalu mulai dari sini
```bash
ssh vps
cd /opt/mutasi-hub-src
git fetch origin && git status          # pastikan bersih
git log -1 --format="%h %s"
```

### 8.2 Deploy FRONTEND (zero downtime, ~15 detik restart)

```bash
# 1. Backup artefak lama
sudo mkdir -p /opt/backups
sudo tar -czf /opt/backups/frontend-$(date +%Y%m%d-%H%M).tar.gz -C /opt/mutasi-hub frontend

# 2. Build dari source (env NEXT_PUBLIC_* WAJIB ada saat build — nilainya
#    di-inline ke bundle, bukan dibaca runtime!)
cd /opt/mutasi-hub-src/frontend
npm ci            # hanya jika package.json berubah
NEXT_PUBLIC_API_URL=https://mutasi.rajacek.com \
NEXT_PUBLIC_SITE_NAME=MutasiHub \
npm run build

# 3. Sinkronkan artefak ke production
rsync -a --delete /opt/mutasi-hub-src/frontend/.next/standalone/ /opt/mutasi-hub/frontend/
rsync -a /opt/mutasi-hub-src/frontend/.next/static/ /opt/mutasi-hub/frontend/.next/static/
rsync -a /opt/mutasi-hub-src/frontend/public/ /opt/mutasi-hub/frontend/public/

# 4. Restart
sudo systemctl restart mutasi-hub-web
sudo systemctl is-active mutasi-hub-web
```

### 8.3 Deploy BACKEND (~5 detik downtime)

```bash
# 1. Backup binary lama
sudo cp /opt/mutasi-hub/backend/mutasi-hub /opt/backups/mutasi-hub-bin-$(date +%Y%m%d-%H%M)

# 2. Build — POLOS, tanpa -trimpath / -ldflags / CGO_ENABLED=0
#    (perintah ber-flag menghasilkan binary berbeda; terbukti saat audit v34)
cd /opt/mutasi-hub-src/backend
export GOTOOLCHAIN=local
/opt/go1.27.2/bin/go vet ./... && /opt/go1.27.2/bin/go test ./...
GOOS=linux GOARCH=amd64 /opt/go1.27.2/bin/go build -o /tmp/mutasi-hub-new ./cmd/server
echo "exit=$?"   # WAJIB 0 — jangan lanjut bila gagal

# 3. Catat hash untuk verifikasi
sha256sum /tmp/mutasi-hub-new

# 4. Pasang + migrasi
sudo install -m 0755 /tmp/mutasi-hub-new /opt/mutasi-hub/backend/mutasi-hub
rsync -a /opt/mutasi-hub-src/backend/migrations/ /opt/mutasi-hub/backend/migrations/

# 5. Restart
sudo systemctl restart mutasi-hub-api
sudo systemctl is-active mutasi-hub-api
```

### 8.4 HARD GATE — wajib untuk deploy backend

`/healthz` harus mengembalikan **`db:true`**, bukan hanya HTTP 200.
HTTP 200 dengan `db:false` = backend jalan tanpa database (DSN rusak) —
pernah terjadi di v21. Bila tidak `db:true` dalam ~60 detik: **rollback**.

```bash
for i in $(seq 1 20); do
  r=$(curl -s https://mutasi.rajacek.com/healthz)
  echo "$r" | grep -q "\"db\":true" && { echo "OK db:true"; break; }
  echo "tunggu... ($i) $r"; sleep 3
done
```

### 8.5 Verifikasi WAJIB setelah deploy
```bash
curl -s -o /dev/null -w "backend  : %{http_code}\n" http://127.0.0.1:8093/healthz
curl -s -o /dev/null -w "frontend : %{http_code}\n" http://127.0.0.1:13001/
curl -s -o /dev/null -w "public   : %{http_code}\n" https://mutasi.rajacek.com/
sudo journalctl -u mutasi-hub-api -u mutasi-hub-web -n 20 --no-pager
sudo tail -20 /var/log/mutasi-hub/api.log
```
Semua harus `200` dan log tanpa `panic`/`error`.

### 8.6 ROLLBACK

**Frontend:**
```bash
sudo rm -rf /opt/mutasi-hub/frontend
sudo tar -xzf /opt/backups/frontend-<TANGGAL>.tar.gz -C /opt/mutasi-hub
sudo systemctl restart mutasi-hub-web
```

**Backend:**
```bash
sudo cp /opt/backups/mutasi-hub-bin-<TANGGAL> /opt/mutasi-hub/backend/mutasi-hub
sudo systemctl restart mutasi-hub-api
```

---

## 9. ATURAN PANTANG DILANGGAR

1. **JANGAN** `nginx -s reload` tanpa `nginx -t` dulu.
2. **JANGAN** mengubah `sites-enabled/rajacek.com` atau `rajatoko`.
3. **JANGAN** restart `rajacek-api`, `rajacek-worker`, atau container `tg-marketplace-*`.
4. **JANGAN** menyentuh database `rajacek` atau postgres di :5433.
5. **JANGAN** mengubah `/etc/mutasi-hub/mutasi.env` tanpa backup — berisi JWT_SECRET & ENCRYPTION_KEY; salah edit = semua sesi & kredensial rekening rusak.
6. **JANGAN** hapus `/opt/backups/`.
7. **JANGAN** `rsync --delete` ke `/opt/mutasi-hub/` root — hanya ke subfolder `frontend/`.
8. **JANGAN** mengubah `PasswordAuthentication` sshd tanpa akses konsol cadangan.
9. **JANGAN** `git reset --hard` di `/opt/mutasi-hub-src` bila ada perubahan belum di-commit (cek `git status` dulu).
10. Deploy saat trafik rendah; jam server = UTC+8.

---

## 10. Env Vars (`/etc/mutasi-hub/mutasi.env`)

Kunci yang ada (nilai **tidak** didokumentasikan di sini):
`PORT`, `FRONTEND_URL`, `COOKIE_DOMAIN`, `MYSQL_DSN`, `JWT_SECRET`,
`ENCRYPTION_KEY`, `CONNECTA_WEBHOOK_SECRET`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URL`, `ADMIN_GOOGLE_EMAILS`,
`GOBIZ_API_KEY`, `GOBIZ_WEBHOOK_SECRET`, `CONNECTA_BASE_URL`, `CONNECTA_API_KEY`

Backup sebelum edit:
```bash
sudo cp /etc/mutasi-hub/mutasi.env /opt/backups/mutasi.env.$(date +%Y%m%d-%H%M)
```

---

## 11. Troubleshooting Cepat

| Gejala | Cek |
|---|---|
| 502 di mutasi.rajacek.com | `systemctl status mutasi-hub-api mutasi-hub-web` |
| Halaman putih | `sudo tail -50 /var/log/mutasi-hub/web.log` |
| API error 500 | `sudo tail -50 /var/log/mutasi-hub/api.log` |
| DB error | `sudo systemctl status mysql` |
| Sertifikat expired | `sudo certbot renew --dry-run` |
| Build gagal TS | cek `frontend/components/ui.tsx` prop types |
| Disk penuh | `df -h /` lalu bersihkan `/opt/mutasi-hub-src/frontend/.next/cache` |

---

## 12. Riwayat Deploy Terakhir

| Tanggal | Versi | Catatan |
|---|---|---|
| 08/11 23:13 | v31b | baseline, backup penuh |
| 09/11 11:53 | backend v34 | build dari working tree (`vcs.modified=true`) |
| 09/11 22:16 | frontend v32 | redesign dashboard (KPI, drawer, bank cards) |
| 10/11 01:49 | frontend v36 | inquiry playground, premium rekening |
| 10/11 08:24 | docs | FLOW.md v36 |

---

*Dokumen ini wajib diperbarui setiap kali ada perubahan infrastruktur.*
