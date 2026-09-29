import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  AhspImportAssistedClassificationPanel,
  emptyAssistedContext,
  type AssistedClassificationContext,
} from './AhspImportAssistedClassificationPanel';
import { apiFetch } from '../utils/apiClient';

type ClassificationAssignment = {
  id: string;
  leafNodeId: string;
  provenance: 'SOURCE_DERIVED' | 'HUMAN_ADDED';
  isActive: boolean;
  path: Array<{ id: string; level: string; name: string }>;
  jenisPengadaanRootId: string;
};

export function AhspClassificationRevisionPanel(props: {
  ahspId: string;
  enabled: boolean;
}): ReactNode {
  const { ahspId, enabled } = props;
  const [rows, setRows] = useState<ClassificationAssignment[]>([]);
  const [phase, setPhase] = useState<'IDLE' | 'LOADING' | 'READY' | 'FAILED'>('IDLE');
  const [busy, setBusy] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<AssistedClassificationContext>(emptyAssistedContext);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ahspId) return;
    setPhase('LOADING');
    try {
      const response = await apiFetch(
        `/ahsp/${encodeURIComponent(ahspId)}/classification-assignments`,
      );
      if (!response.ok) throw new Error('load failed');
      const payload = (await response.json()) as ClassificationAssignment[];
      setRows(Array.isArray(payload) ? payload : []);
      setPhase('READY');
    } catch {
      setRows([]);
      setPhase('FAILED');
    }
  }, [ahspId]);

  useEffect(() => {
    void load();
  }, [load]);

  const deactivate = async (assignmentId: string) => {
    if (!enabled || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch(
        `/ahsp/${encodeURIComponent(ahspId)}/classification-assignments/${encodeURIComponent(assignmentId)}/deactivate`,
        { method: 'POST' },
      );
      if (!response.ok) {
        setError('Pilihan klasifikasi belum dapat dihapus. Tidak ada data yang diklaim berubah.');
        return;
      }
      await load();
    } catch {
      setError('Pilihan klasifikasi belum dapat dihubungi.');
    } finally {
      setBusy(false);
    }
  };

  const addSelected = async () => {
    if (!enabled || busy) return;
    const leafNodeIds = [...new Set(draft.paths.map((path) => path.leafNodeId))];
    if (leafNodeIds.length === 0) {
      setError('Pilih minimal satu Jenis Pekerjaan.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch(
        `/ahsp/${encodeURIComponent(ahspId)}/classification-assignments`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leafNodeIds }),
        },
      );
      if (!response.ok) {
        setError('Pilihan klasifikasi belum tersimpan. Klasifikasi yang sudah ada tetap dipertahankan.');
        return;
      }
      await load();
      setDraft(emptyAssistedContext());
      setEditorOpen(false);
    } catch {
      setError('Pilihan klasifikasi belum dapat disimpan.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Klasifikasi AHSP" style={{ marginBottom: 'var(--space-4)' }}>
      <h3 style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--text-base)' }}>
        Klasifikasi
      </h3>
      {phase === 'LOADING' ? (
        <p className="ahsp-line ahsp-line--abu">Memuat klasifikasi…</p>
      ) : null}
      {phase === 'FAILED' ? (
        <p role="alert" className="ahsp-line ahsp-line--error">
          Klasifikasi belum dapat dibaca.{' '}
          <button
            type="button"
            className="ahsp-action ahsp-action--quiet"
            onClick={() => void load()}
          >
            Coba lagi
          </button>
        </p>
      ) : null}
      {phase === 'READY' && rows.length === 0 ? (
        <p className="ahsp-line ahsp-line--abu">Belum ada jalur klasifikasi aktif.</p>
      ) : null}
      {rows.length > 0 ? (
        <ul className="ahsp-choice-list" aria-label="Jalur klasifikasi aktif">
          {rows.map((assignment) => (
            <li key={assignment.id} className="ahsp-line">
              <span>{assignment.path.map((node) => node.name).join(' › ')}</span>
              {assignment.provenance === 'HUMAN_ADDED' && enabled ? (
                <button
                  type="button"
                  className="ahsp-action ahsp-action--quiet ahsp-action--compact"
                  disabled={busy}
                  onClick={() => void deactivate(assignment.id)}
                >
                  Hapus pilihan klasifikasi
                </button>
              ) : (
                <span className="ahsp-line ahsp-line--abu">
                  Dari sumber — dipertahankan
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" className="ahsp-line ahsp-line--error">{error}</p>
      ) : null}
      {enabled && !editorOpen ? (
        <button
          type="button"
          className="ahsp-action ahsp-action--outline"
          onClick={() => setEditorOpen(true)}
        >
          Tambahkan pilihan klasifikasi
        </button>
      ) : null}
      {enabled && editorOpen ? (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <AhspImportAssistedClassificationPanel
            enabled
            embedded
            showMetadata={false}
            value={draft}
            onChange={setDraft}
          />
          <div className="ahsp-action-row" style={{ marginTop: 'var(--space-3)' }}>
            <button
              type="button"
              className="ahsp-action ahsp-action--outline"
              disabled={busy}
              onClick={() => {
                setDraft(emptyAssistedContext());
                setEditorOpen(false);
                setError(null);
              }}
            >
              Batal tambah
            </button>
            <button
              type="button"
              className="ahsp-action ahsp-action--primary"
              disabled={busy || draft.paths.length === 0}
              onClick={() => void addSelected()}
            >
              {busy ? 'Menyimpan…' : 'Tambahkan pilihan terpilih'}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
