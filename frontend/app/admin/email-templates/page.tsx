'use client';

// v39: Template email yang bisa dicustom admin — daftar 7 template,
// edit subjek + isi HTML dengan placeholder {{...}}, simpan, reset ke
// default, dan pratinjau hasil render (tanpa mengirim email).

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiPost, apiPut, friendlyError } from '../../../lib/api';
import {
  Button,
  Card,
  ErrorBanner,
  Field,
  InfoBanner,
  PageHeading,
  TableSkeleton,
} from '../../../components/ui';

type EmailTemplate = {
  key: string;
  label: string;
  subject: string;
  body_html: string;
  placeholders: string[];
  required_placeholders: string[];
  customized: boolean;
  updated_at: string;
};

type Preview = {
  subject: string;
  text: string;
  html: string;
};

export default function AdminEmailTemplatesPage() {
  const [list, setList] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [resetArmed, setResetArmed] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [showText, setShowText] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const selected = list.find((t) => t.key === selectedKey) ?? null;

  const load = useCallback(async (keepSelection = false) => {
    setLoading(true);
    setError(null);
    try {
      const d = await apiGet<any>('/api/v1/admin/email-templates');
      const templates: EmailTemplate[] = d?.templates ?? [];
      setList(templates);
      if (!keepSelection && templates.length > 0) {
        setSelectedKey(templates[0].key);
        setSubject(templates[0].subject);
        setBody(templates[0].body_html);
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function select(t: EmailTemplate) {
    setSelectedKey(t.key);
    setSubject(t.subject);
    setBody(t.body_html);
    setPreview(null);
    setResetArmed(false);
    setError(null);
    setNotice(null);
  }

  function insertPlaceholder(ph: string) {
    const token = `{{${ph}}}`;
    const el = bodyRef.current;
    if (!el) {
      setBody((b) => b + token);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function save() {
    if (!selected) return;
    setError(null);
    setNotice(null);
    if (!subject.trim() || !body.trim()) {
      setError('Subjek dan isi template wajib diisi.');
      return;
    }
    setSaving(true);
    try {
      await apiPut(`/api/v1/admin/email-templates/${selected.key}`, {
        subject: subject.trim(),
        body_html: body.trim(),
      });
      setNotice(`Template "${selected.label}" disimpan. Email ${selected.label.toLowerCase()} berikutnya memakai isi baru ini.`);
      await load(true);
      // Segarkan isi form dari data tersimpan.
      const d = await apiGet<any>(`/api/v1/admin/email-templates/${selected.key}`);
      if (d?.key) {
        setSubject(d.subject);
        setBody(d.body_html);
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    if (!selected) return;
    if (!resetArmed) {
      setResetArmed(true);
      return;
    }
    setResetArmed(false);
    setError(null);
    setNotice(null);
    setResetting(true);
    try {
      await apiPost(`/api/v1/admin/email-templates/${selected.key}/reset`, {});
      const d = await apiGet<any>(`/api/v1/admin/email-templates/${selected.key}`);
      if (d?.key) {
        setSubject(d.subject);
        setBody(d.body_html);
      }
      setPreview(null);
      setNotice(`Template "${selected.label}" direset ke default.`);
      await load(true);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setResetting(false);
    }
  }

  async function doPreview() {
    if (!selected) return;
    setError(null);
    setNotice(null);
    setPreviewing(true);
    try {
      const d = await apiPost<any>(`/api/v1/admin/email-templates/${selected.key}/preview`, {});
      setPreview({ subject: d?.subject ?? '', text: d?.text ?? '', html: d?.html ?? '' });
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="Komunikasi member"
        title="Template Email"
        description="Ubah subjek dan isi email otomatis yang dikirim ke member — verifikasi, reset password, tagihan, dan pengingat paket."
      />
      <ErrorBanner message={error} onClose={() => setError(null)} />
      <InfoBanner message={notice} />

      <Card title="Daftar Template" subtitle="Klik salah satu untuk mengedit. Email yang sudah terkirim tidak berubah.">
        {loading ? (
          <TableSkeleton rows={3} />
        ) : list.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Belum ada template.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {list.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => select(t)}
                style={{
                  textAlign: 'left',
                  border: `1px solid ${t.key === selectedKey ? '#047857' : 'var(--border, #e2e8f0)'}`,
                  borderRadius: 12,
                  padding: '12px 14px',
                  background: t.key === selectedKey ? '#ecfdf5' : '#fff',
                  cursor: 'pointer',
                  display: 'grid',
                  gap: 2,
                }}
              >
                <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 15 }}>{t.label}</strong>
                  {t.customized && <span className="badge-amber">Diubah dari default</span>}
                </span>
                <span className="muted" style={{ fontSize: 13 }}>
                  {t.subject}
                </span>
                <span className="muted" style={{ fontSize: 12 }}>
                  Terakhir diubah: {t.updated_at || '—'}
                </span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {selected && (
        <Card
          title={`Edit: ${selected.label}`}
          subtitle="Isi HTML dibungkus kerangka brand MutasiHub secara otomatis — cukup tulis isi pesannya."
        >
          <Field label="Subjek">
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subjek email"
              maxLength={255}
            />
          </Field>
          <Field
            label="Isi (HTML)"
            hint="Tulis HTML sederhana — paragraf <p>, tebal <strong>, tautan <a href>. Maks 20000 karakter."
          >
            <textarea
              ref={bodyRef}
              rows={14}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              style={{ fontFamily: 'monospace', fontSize: 13, lineHeight: 1.6 }}
              maxLength={20000}
            />
          </Field>
          <Field label="Placeholder yang berlaku" hint="Klik untuk menyisipkan di posisi kursor. Nilai diganti otomatis saat email dikirim; placeholder yang tidak dikenal dibiarkan apa adanya.">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {selected.placeholders.map((ph) => (
                <button
                  key={ph}
                  type="button"
                  onClick={() => insertPlaceholder(ph)}
                  style={{
                    border: '1px solid var(--border, #e2e8f0)',
                    borderRadius: 999,
                    padding: '4px 12px',
                    background: '#f8fafc',
                    cursor: 'pointer',
                    fontFamily: 'monospace',
                    fontSize: 13,
                  }}
                >
                  {`{{${ph}}}`}
                </button>
              ))}
            </div>
            {selected.required_placeholders.length > 0 && (
              <p className="muted" style={{ margin: '8px 0 0', fontSize: 13 }}>
                Wajib ada: {selected.required_placeholders.map((p) => `{{${p}}}`).join(', ')} — tanpanya
                tautan di email hilang.
              </p>
            )}
          </Field>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button onClick={save} disabled={saving}>
              {saving ? 'Menyimpan…' : 'Simpan Template'}
            </Button>
            <Button variant="outline" onClick={doPreview} disabled={previewing}>
              {previewing ? 'Merender…' : 'Pratinjau'}
            </Button>
            <Button variant="outline" onClick={reset} disabled={resetting}>
              {resetting ? 'Mereset…' : resetArmed ? 'Yakin reset ke default?' : 'Reset ke Default'}
            </Button>
          </div>
        </Card>
      )}

      {preview && (
        <Card title="Pratinjau" subtitle="Hasil render dengan data contoh — tidak ada email yang dikirim.">
          <p style={{ margin: '0 0 12px', fontSize: 14 }}>
            <strong>Subjek:</strong> {preview.subject}
          </p>
          <iframe
            title="Pratinjau email"
            srcDoc={preview.html}
            style={{ width: '100%', minHeight: 420, border: '1px solid var(--border, #e2e8f0)', borderRadius: 12 }}
          />
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              onClick={() => setShowText((v) => !v)}
              style={{ background: 'none', border: 'none', color: '#047857', cursor: 'pointer', padding: 0, fontSize: 14 }}
            >
              {showText ? 'Sembunyikan versi teks' : 'Lihat versi teks'}
            </button>
            {showText && (
              <pre
                style={{
                  whiteSpace: 'pre-wrap',
                  fontSize: 13,
                  background: '#f8fafc',
                  border: '1px solid var(--border, #e2e8f0)',
                  borderRadius: 12,
                  padding: 12,
                  marginTop: 8,
                }}
              >
                {preview.text}
              </pre>
            )}
          </div>
        </Card>
      )}
    </>
  );
}
