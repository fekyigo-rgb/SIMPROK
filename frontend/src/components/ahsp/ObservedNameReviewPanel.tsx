import { useEffect, useState } from 'react';
import { apiFetch } from '../../utils/apiClient';

type NameReviewEvent = {
  version: number;
  reviewedName: string;
  reason: string;
  evidence: string;
};
type NameReviewState = {
  observationId: string;
  rawName: string;
  currentVersion: number;
  sourceFactsFingerprint: string;
  latest: NameReviewEvent | null;
  history: NameReviewEvent[];
  observationStatus: string;
};

export function ObservedNameReviewPanel({
  observationId,
  onSaved,
  onBusyChange,
}: {
  observationId: string;
  onSaved: () => Promise<unknown>;
  onBusyChange: (busy: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [record, setRecord] = useState<NameReviewState | null>(null);
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setExpanded(false);
    setRecord(null);
    setError(null);
    setMessage(null);
  }, [observationId]);

  const read = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch('/resource-observations/' + encodeURIComponent(observationId) + '/name-reviews');
      if (!response.ok) {
        throw new Error(response.status === 401 || response.status === 403
          ? 'Akun ini belum memiliki izin membaca keputusan koreksi.'
          : 'Riwayat koreksi tidak dapat dibaca (HTTP ' + response.status + ').');
      }
      const result = (await response.json()) as NameReviewState;
      if (result.observationId !== observationId || !Number.isInteger(result.currentVersion) ||
          !/^[a-f0-9]{64}$/.test(result.sourceFactsFingerprint)) {
        throw new Error('Kontrak riwayat koreksi tidak sesuai.');
      }
      setRecord(result);
      setName(result.latest?.reviewedName ?? result.rawName);
      setReason('');
      setEvidence('');
    } catch (e) {
      setRecord(null);
      setError(e instanceof Error ? e.message : 'Riwayat koreksi tidak dapat dimuat.');
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!record || saving || loading || record.observationStatus !== 'OBSERVED') return;
    if (!name.trim() || !reason.trim() || !evidence.trim()) {
      setError('Nama, alasan dan bukti koreksi wajib diisi.');
      return;
    }
    setSaving(true);
    onBusyChange(true);
    setError(null);
    setMessage(null);
    try {
      const response = await apiFetch('/resource-observations/' + encodeURIComponent(observationId) + '/name-reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedVersion: record.currentVersion,
          sourceFactsFingerprint: record.sourceFactsFingerprint,
          reviewedName: name.trim(),
          reason: reason.trim(),
          evidence: evidence.trim(),
        }),
      });
      if (!response.ok) {
        throw new Error(response.status === 409
          ? 'Koreksi tidak disimpan: versi atau fakta sumber telah berubah. Muat ulang riwayat.'
          : response.status === 400
            ? 'Koreksi ditolak: periksa ejaan dan jangan mengubah spesifikasi teknis.'
            : 'Koreksi belum disimpan (HTTP ' + response.status + ').');
      }
      // A successful POST is not enough: read back the durable event after reload.
      const fresh = await apiFetch('/resource-observations/' + encodeURIComponent(observationId) + '/name-reviews');
      if (!fresh.ok) throw new Error('Tersimpan, tetapi pembacaan ulang belum berhasil. Muat ulang riwayat.');
      const persisted = (await fresh.json()) as NameReviewState;
      if (persisted.observationId !== observationId ||
          persisted.currentVersion !== record.currentVersion + 1 ||
          persisted.latest?.reviewedName !== name.trim()) {
        throw new Error('Hasil penyimpanan belum terverifikasi. Muat ulang riwayat.');
      }
      setRecord(persisted);
      setName(persisted.latest.reviewedName);
      setReason('');
      setEvidence('');
      setMessage('Koreksi berhasil disimpan dan diverifikasi setelah pembacaan ulang (versi ' + persisted.currentVersion + '). Identitas belum otomatis ditetapkan.');
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sambungan koreksi belum berhasil.');
    } finally {
      setSaving(false);
      onBusyChange(false);
    }
  };

  return (
    <section aria-label={'Koreksi penulisan observasi ' + observationId} style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: 12, marginTop: 10, marginBottom: 10 }}>
      <button type="button" className="ahsp-action ahsp-action--quiet ahsp-action--compact"
        aria-expanded={expanded} onClick={() => { setExpanded(!expanded); if (!expanded) void read(); }}>
        {expanded ? 'Tutup koreksi nama sumber' : 'Perbaiki ejaan nama sumber (observasi ini saja)'}
      </button>
      {expanded ? (
        <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          {loading ? <p role="status">Memuat riwayat koreksi…</p> : null}
          {record ? (
            <>
              <p className="ahsp-line">Nama asli Excel (tidak berubah): <strong>{record.rawName}</strong></p>
              {record.latest ? <p className="ahsp-line">Koreksi terakhir: <strong>{record.latest.reviewedName}</strong> — versi {record.currentVersion}</p> : null}
              <label>Nama hasil koreksi
                <input aria-label={'Nama hasil koreksi ' + observationId} style={{ display: 'block', width: '100%' }}
                  value={name} disabled={saving || record.observationStatus !== 'OBSERVED'}
                  onChange={(event) => setName(event.target.value)} />
              </label>
              <label>Alasan koreksi
                <input aria-label={'Alasan koreksi ' + observationId} style={{ display: 'block', width: '100%' }}
                  value={reason} disabled={saving || record.observationStatus !== 'OBSERVED'}
                  onChange={(event) => setReason(event.target.value)} />
              </label>
              <label>Bukti koreksi
                <input aria-label={'Bukti koreksi ' + observationId} style={{ display: 'block', width: '100%' }}
                  value={evidence} disabled={saving || record.observationStatus !== 'OBSERVED'}
                  onChange={(event) => setEvidence(event.target.value)} />
              </label>
              <p className="ahsp-line ahsp-line--abu">Hanya perbaikan penulisan. Jangan ubah kode, satuan, kapasitas atau spesifikasi. Pilihan identitas tetap diperiksa SIMPROK.</p>
              <div className="ahsp-action-row">
                <button type="button" className="ahsp-action ahsp-action--outline"
                  disabled={saving || record.observationStatus !== 'OBSERVED' || !name.trim() || !reason.trim() || !evidence.trim()}
                  onClick={() => void save()}>{saving ? 'Menyimpan koreksi…' : 'Simpan koreksi nama'}</button>
                <button type="button" className="ahsp-action ahsp-action--quiet" disabled={saving || loading} onClick={() => void read()}>Muat ulang riwayat</button>
              </div>
            </>
          ) : !loading ? <button type="button" className="ahsp-action ahsp-action--quiet" onClick={() => void read()}>Coba baca lagi</button> : null}
          {error ? <p role="alert" style={{ color: '#9B1C1C' }}>{error}</p> : null}
          {message ? <p role="status" style={{ color: '#24513A' }}>{message}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
