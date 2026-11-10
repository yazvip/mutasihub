'use client';

// v37: Pengumuman admin ("berita") — tulis judul + isi, kirim ke semua
// member aktif, lihat daftar + status kirim. Pengumuman hanya bisa
// dikirim sekali (draf -> terkirim); kirim ulang dicegah backend.

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { apiGet, apiPost, friendlyError } from '../../../lib/api';
import {
  Button,
  Card,
  ErrorBanner,
  Field,
  InfoBanner,
  PageHeading,
  TableSkeleton,
} from '../../../components/ui';

type Announcement = {
  id: string;
  title: string;
  body: string;
  status: string;
  sent_count: number;
  failed_count: number;
  created_at: string;
  sent_at: string | null;
};

export default function AdminAnnouncementsPage() {
  const [list, setList] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [creating, setCreating] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await apiGet<any>('/api/v1/admin/announcements');
      setList(d?.announcements ?? []);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!title.trim() || !body.trim()) {
      setError('Judul dan isi pengumuman wajib diisi.');
      return;
    }
    setCreating(true);
    try {
      await apiPost('/api/v1/admin/announcements', { title: title.trim(), body: body.trim() });
      setTitle('');
      setBody('');
      setNotice('Pengumuman disimpan sebagai draf. Tekan "Kirim" untuk mengirimnya ke semua member aktif.');
      await load();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setCreating(false);
    }
  }

  async function send(id: string) {
    setError(null);
    setNotice(null);
    setSendingId(id);
    try {
      const d = await apiPost<any>(`/api/v1/admin/announcements/${id}/send`, {});
      setNotice(d?.message ?? 'Pengumuman dikirim.');
      await load();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSendingId(null);
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="Komunikasi member"
        title="Pengumuman"
        description="Kirim berita dan informasi ke semua member aktif lewat email."
      />
      <ErrorBanner message={error} onClose={() => setError(null)} />
      <InfoBanner message={notice} />

      <Card title="Tulis Pengumuman" subtitle="Disimpan sebagai draf dulu — pengiriman dilakukan manual dari daftar di bawah.">
        <form onSubmit={create}>
          <div className="form-grid">
            <Field label="Judul">
              <input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Mis. Perawatan terjadwal Minggu malam"
                maxLength={255}
              />
            </Field>
          </div>
          <Field label="Isi" hint="Teks polos — baris baru dipertahankan di email. Maks 10000 karakter.">
            <textarea
              required
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Tulis isi pengumuman untuk member…"
              maxLength={10000}
            />
          </Field>
          <Button type="submit" disabled={creating}>
            {creating ? 'Menyimpan…' : 'Simpan Draf'}
          </Button>
        </form>
      </Card>

      <Card title="Daftar Pengumuman" subtitle="Pengumuman yang sudah terkirim tidak bisa dikirim ulang.">
        {loading ? (
          <TableSkeleton rows={3} />
        ) : list.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Belum ada pengumuman.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {list.map((a) => (
              <div
                key={a.id}
                style={{
                  border: '1px solid var(--border, #e2e8f0)',
                  borderRadius: 12,
                  padding: 14,
                  display: 'grid',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 15 }}>{a.title}</strong>
                  <span className={a.status === 'sent' ? 'badge-green' : 'badge-amber'}>
                    {a.status === 'sent' ? 'Terkirim' : 'Draf'}
                  </span>
                </div>
                <p className="muted" style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 14 }}>
                  {a.body}
                </p>
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                  Dibuat: {a.created_at}
                  {a.sent_at ? ` · Dikirim: ${a.sent_at}` : ''}
                  {a.status === 'sent'
                    ? ` · ${a.sent_count} berhasil, ${a.failed_count} gagal`
                    : ''}
                </p>
                {a.status === 'draft' && (
                  <div>
                    <Button
                      variant="outline"
                      onClick={() => send(a.id)}
                      disabled={sendingId === a.id}
                    >
                      {sendingId === a.id ? 'Mengirim…' : 'Kirim ke Semua Member Aktif'}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
