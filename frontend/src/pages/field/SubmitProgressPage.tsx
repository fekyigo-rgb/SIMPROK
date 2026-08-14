/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FactHeader } from '../../components/molecules/FactHeader';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch } from '../../utils/apiClient';

type ErrorKind = 'unauthorized' | 'forbidden' | 'not-found' | 'workspace' | 'server' | 'network' | null;
type HistoryEntry = {
  id: string;
  installedQuantity: string;
  workDate: string;
  recordedAt: string;
  captureMethod: string;
  status: string;
  supersedesEntryId: string | null;
  correctionReason: string | null;
  evidenceReferences: Array<{ url: string; label: string }>;
  revision: number;
};

export function SubmitProgressPage() {
  const { projectId, boqItemId } = useParams();
  const navigate = useNavigate();
  const { token } = useAuth();
  const [quantity, setQuantity] = useState('');
  const [workDate, setWorkDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [captureMethod, setCaptureMethod] = useState('FIELD_OBSERVATION');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [evidenceLabel, setEvidenceLabel] = useState('Foto lapangan');
  const [commandId, setCommandId] = useState(() => crypto.randomUUID());
  const [submitting, setSubmitting] = useState(false);
  const [boqItem, setBoqItem] = useState<any>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [availableActions, setAvailableActions] = useState({ verify: false, correct: false, accept: false });
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorKind, setErrorKind] = useState<ErrorKind>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    if (!projectId || !boqItemId) return;
    const response = await apiFetch(`/projects/${projectId}/progress/items/${boqItemId}/history`);
    if (!response.ok) return;
    const body = await response.json();
    setHistory(body.entries ?? []);
    setAvailableActions(body.availableActions ?? { verify: false, correct: false, accept: false });
  }, [projectId, boqItemId]);

  useEffect(() => {
    if (!token || !projectId || !boqItemId) return;
    apiFetch(`/projects/${projectId}/progress/monitoring`)
      .then(async (res) => {
        if (!res.ok) {
          setErrorStatus(res.status);
          setErrorKind(res.status === 401 ? 'unauthorized' : res.status === 403 ? 'forbidden' : res.status === 404 ? 'not-found' : res.status === 400 ? 'workspace' : 'server');
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (!data) return;
        const item = (data.items ?? []).find((candidate: any) => candidate.id === boqItemId);
        if (!item || item.itemType !== 'WORK_ITEM') setErrorKind('not-found');
        else setBoqItem(item);
      })
      .catch(() => setErrorKind('network'));
    void loadHistory();
  }, [token, projectId, boqItemId, loadHistory]);

  const evidenceReferences = evidenceUrl.trim()
    ? [{ url: evidenceUrl.trim(), label: evidenceLabel.trim() || 'Bukti lapangan' }]
    : undefined;

  const send = async (path: string, payload: unknown) => {
    const response = await apiFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(Array.isArray(body.message) ? body.message.join(', ') : body.message || 'Perintah gagal disimpan');
    }
    return response.json();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!projectId || !boqItemId || !quantity || !workDate) return;
    setSubmitting(true);
    setNotice(null);
    try {
      await send(`/projects/${projectId}/progress/field`, {
        commandId,
        entries: [{ boqItemId, installedQuantity: quantity, workDate, captureMethod, notes: notes || undefined, evidenceReferences }],
      });
      setNotice('Actual tersimpan dan dapat dibaca kembali dari Monitoring.');
      setCommandId(crypto.randomUUID());
      await loadHistory();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Perintah gagal disimpan');
    } finally {
      setSubmitting(false);
    }
  };

  const transition = async (entry: HistoryEntry, action: 'verify' | 'accept') => {
    if (!projectId) return;
    setSubmitting(true);
    try {
      await send(`/projects/${projectId}/progress/entries/${entry.id}/${action}`, {});
      setNotice(action === 'verify' ? 'Actual telah diverifikasi.' : 'Actual telah diterima.');
      await loadHistory();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Perintah gagal');
    } finally {
      setSubmitting(false);
    }
  };

  const correct = async (entry: HistoryEntry) => {
    if (!projectId) return;
    const reason = window.prompt('Alasan koreksi (riwayat lama tetap disimpan):');
    if (!reason?.trim()) return;
    setSubmitting(true);
    try {
      await send(`/projects/${projectId}/progress/entries/${entry.id}/corrections`, {
        commandId: crypto.randomUUID(),
        installedQuantity: quantity,
        workDate,
        captureMethod,
        reason: reason.trim(),
        notes: notes || undefined,
        evidenceReferences,
      });
      setNotice('Koreksi baru tersimpan. Actual lama tetap ada dalam riwayat.');
      await loadHistory();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Koreksi gagal');
    } finally {
      setSubmitting(false);
    }
  };

  const errorMessage = errorKind === 'unauthorized' ? 'Sesi Anda berakhir. Silakan login kembali.'
    : errorKind === 'forbidden' ? 'Anda tidak memiliki akses ke proyek ini.'
      : errorKind === 'not-found' ? 'Pekerjaan tidak ditemukan pada proyek ini.'
        : errorKind === 'workspace' ? 'Konteks workspace belum valid.'
          : errorKind ? 'Data pekerjaan gagal dimuat. Coba lagi.' : '';
  const effective = [...history].reverse().find((entry) => !history.some((candidate) => candidate.supersedesEntryId === entry.id) && entry.status !== 'RETURNED_FOR_CORRECTION');

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', backgroundColor: 'white', padding: 'var(--space-8)', paddingBottom: '100px', borderRadius: 'var(--radius-lg)' }}>
      <button onClick={() => navigate(`/field/project/${projectId}`)} style={{ background: 'none', border: 'none', color: 'var(--simprok-engineering-blue-600)', cursor: 'pointer', padding: 0 }}>&larr; Kembali</button>
      <h2 style={{ color: 'var(--simprok-engineering-blue-900)' }}>Catat Actual Lapangan</h2>
      {errorKind && <div role="alert" style={{ padding: 16, background: '#FEE2E2', color: '#991B1B', borderRadius: 8 }}>Akses ditolak ({errorStatus || 'Network'}): {errorMessage}</div>}
      {boqItem && <div style={{ margin: '20px 0', padding: 16, background: 'var(--simprok-engineering-blue-50)', borderRadius: 8 }}>
        <h3>{boqItem.wbsCode} — {boqItem.name}</h3>
        <FactHeader label="Volume rencana" value={boqItem.quantity} suffix={boqItem.unit} certaintyLevel="C5" showBadge={false} />
        {effective && <p><strong>Actual efektif:</strong> {effective.installedQuantity} {boqItem.unit} · {effective.status}</p>}
      </div>}
      {notice && <p role="status" style={{ padding: 12, background: '#EFF6FF', borderRadius: 8 }}>{notice}</p>}

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 16 }}>
        <label>Tanggal pekerjaan<input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} required style={{ display: 'block', width: '100%', padding: 10 }} /></label>
        <label>Volume Actual ({boqItem?.unit ?? 'satuan'})<input type="number" min="0" step="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} required style={{ display: 'block', width: '100%', padding: 10 }} /></label>
        <label>Sumber pencatatan<select value={captureMethod} onChange={(e) => setCaptureMethod(e.target.value)} style={{ display: 'block', width: '100%', padding: 10 }}><option value="FIELD_OBSERVATION">Pengamatan lapangan</option><option value="FIELD_MEASUREMENT">Pengukuran lapangan</option><option value="DOCUMENT_REFERENCE">Referensi dokumen</option></select></label>
        <label>Catatan<textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} style={{ display: 'block', width: '100%', padding: 10 }} /></label>
        <fieldset style={{ border: '1px solid #DBEAFE', borderRadius: 8 }}><legend>Bukti opsional</legend><label>URL referensi<input type="url" value={evidenceUrl} onChange={(e) => setEvidenceUrl(e.target.value)} placeholder="https://…" style={{ display: 'block', width: '100%', padding: 10 }} /></label>{evidenceUrl && <label>Nama bukti<input value={evidenceLabel} onChange={(e) => setEvidenceLabel(e.target.value)} style={{ display: 'block', width: '100%', padding: 10 }} /></label>}<small>URL disimpan sebagai referensi; SIMPROK tidak mengklaim file telah diverifikasi.</small></fieldset>
        <button type="submit" disabled={submitting || !!errorKind} style={{ padding: 12, background: '#172554', color: 'white', border: 0, borderRadius: 8 }}>{submitting ? 'Menyimpan…' : 'Simpan Actual'}</button>
      </form>

      <section style={{ marginTop: 32 }}>
        <h3>Riwayat Actual</h3>
        {history.length === 0 ? <p>Belum ada Actual yang dicatat.</p> : history.map((entry) => <article key={entry.id} style={{ padding: 14, marginBottom: 10, border: '1px solid #DBEAFE', borderRadius: 8 }}>
          <strong>Revisi {entry.revision}: {entry.installedQuantity} {boqItem?.unit}</strong>
          <div>{entry.status} · {new Date(entry.recordedAt).toLocaleString('id-ID')} · {entry.captureMethod}</div>
          {entry.correctionReason && <p>Alasan koreksi: {entry.correctionReason}</p>}
          {entry.evidenceReferences.map((evidence) => <a key={evidence.url} href={evidence.url} target="_blank" rel="noreferrer">{evidence.label}</a>)}
          {entry.id === effective?.id && <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {availableActions.verify && entry.status === 'SUBMITTED' && <button disabled={submitting} onClick={() => void transition(entry, 'verify')}>Verifikasi</button>}
            {availableActions.accept && entry.status === 'VERIFIED' && <button disabled={submitting} onClick={() => void transition(entry, 'accept')}>Terima</button>}
            {availableActions.correct && <button disabled={submitting || !quantity} onClick={() => void correct(entry)}>Buat koreksi</button>}
          </div>}
        </article>)}
      </section>
    </div>
  );
}
