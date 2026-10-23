import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AhspImportAssistedClassificationPanel,
  type AssistedClassificationContext,
} from './AhspImportAssistedClassificationPanel';
import { apiFetch } from '../utils/apiClient';
import { emptyAssistedContext } from '../utils/ahspAssistedContext';
import { validatedAssignments, type ClassificationAssignment } from '../utils/ahspClassificationAssignments';

export function AhspClassificationRevisionPanel(props: {
  ahspId: string;
  enabled: boolean;
  /** Share the successful canonical classification read with Informasi AHSP. */
  onAssignmentsChange?: (rows: readonly ClassificationAssignment[]) => void;
  /** A successful verified classification write, not an initial read. */
  onSaved?: () => void;
  onSaveAttempt?: () => boolean;
  onSaveFinished?: () => void;
  onCancelled?: () => void;
}): ReactNode {
  const { ahspId, enabled, onAssignmentsChange, onSaved, onSaveAttempt, onSaveFinished, onCancelled } = props;
  const readGeneration = useRef(0);
  const currentAhsp = useRef(ahspId);
  const mounted = useRef(true);
  const [rows, setRows] = useState<ClassificationAssignment[]>([]);
  const [phase, setPhase] = useState<'IDLE' | 'LOADING' | 'READY' | 'FAILED'>('IDLE');
  const [busy, setBusy] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<AssistedClassificationContext>(emptyAssistedContext);
  const [error, setError] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<{ ahspId: string; assignmentId: string } | null>(null);
  const pendingRemovalRow = pendingRemoval?.ahspId === ahspId && phase === 'READY'
    ? rows.find((row) => row.id === pendingRemoval.assignmentId && row.provenance === 'HUMAN_ADDED' && row.isActive)
    : null;

  const load = useCallback(async (): Promise<ClassificationAssignment[] | null> => {
    if (!ahspId) return null;
    const generation = ++readGeneration.current;
    setPhase('LOADING');
    try {
      const response = await apiFetch(
        `/ahsp/${encodeURIComponent(ahspId)}/classification-assignments`,
      );
      if (!response.ok) throw new Error('load failed');
      const payload = (await response.json()) as ClassificationAssignment[];
      const activeRows = validatedAssignments(payload, ahspId);
      if (!mounted.current || currentAhsp.current !== ahspId || generation !== readGeneration.current) return null;
      setRows(activeRows);
      onAssignmentsChange?.(activeRows);
      setPhase('READY');
      return activeRows;
    } catch {
      if (!mounted.current || currentAhsp.current !== ahspId || generation !== readGeneration.current) return null;
      setRows([]);
      setPhase('FAILED');
      return null;
    }
  }, [ahspId, onAssignmentsChange]);

  useEffect(() => {
    // Keep the identity guard synchronous; start the stateful load after the effect.
    // Cancel a queued read when React cleans up or the AHSP identity changes.
    let active = true;
    currentAhsp.current = ahspId;
    mounted.current = true;
    void Promise.resolve().then(() => {
      if (active) return load();
      return null;
    });
    return () => {
      active = false;
      mounted.current = false;
      readGeneration.current += 1;
    };
  }, [ahspId, load]);

  const deactivate = async (assignmentId: string) => {
    if (!enabled || busy) return;
    if (onSaveAttempt?.() === false) return;
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
      const verified = await load();
      if (!verified || verified.some((row) => row.id === assignmentId && row.isActive)) {
        setError('Penghapusan klasifikasi belum dapat diverifikasi. Muat ulang halaman.');
        return;
      }
      onSaved?.();
    } catch {
      setError('Hasil penghapusan klasifikasi belum dapat dipastikan. Muat ulang sebelum mencoba lagi.');
    } finally {
      setBusy(false);
      setPendingRemoval(null);
      onSaveFinished?.();
    }
  };

  const addSelected = async () => {
    if (!enabled || busy) return;
    const leafNodeIds = [...new Set(draft.paths.map((path) => path.leafNodeId))];
    const pendingPaths = draft.pendingPaths ?? [];
    if (leafNodeIds.length === 0 && pendingPaths.length === 0) {
      setError('Pilih minimal satu Jenis Pekerjaan.');
      return;
    }
    if (onSaveAttempt?.() === false) return;
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch(
        `/ahsp/${encodeURIComponent(ahspId)}/classification-assignments`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            leafNodeIds,
            ...(pendingPaths.length > 0 ? {
              jenisPengadaanRootId: draft.jenisPengadaanRootId,
              pendingPaths,
            } : {}),
          }),
        },
      );
      if (!response.ok) {
        setError('Hasil penyimpanan klasifikasi belum dapat dipastikan. Muat ulang sebelum mencoba lagi.');
        return;
      }
      const verified = await load();
      const verifiedPersisted = verified && leafNodeIds.every((id) =>
        verified.some((row) => row.isActive && row.provenance === 'HUMAN_ADDED' && row.leafNodeId === id &&
          (!draft.jenisPengadaanRootId || row.jenisPengadaanRootId === draft.jenisPengadaanRootId)));
      const verifiedPending = verified && pendingPaths.every((expected) =>
        verified.some((row) => row.isActive && row.provenance === 'HUMAN_ADDED' && row.jenisPengadaanRootId === draft.jenisPengadaanRootId &&
          row.path.some((node) => node.level === 'KATEGORI' && node.name === expected.kategori) &&
          row.path.some((node) => node.level === 'SUBKATEGORI' && node.name === expected.subkategori) &&
          row.path.some((node) => node.level === 'JENIS_PEKERJAAN' && node.name === expected.jenisPekerjaan)
        )
      );
      if (!verified || !verifiedPersisted || !verifiedPending) {
        setError('Pilihan telah dikirim, tetapi belum terbukti tersimpan sesuai pilihan. Muat ulang halaman.');
        return;
      }
      onSaved?.();
      setDraft(emptyAssistedContext());
      setEditorOpen(false);
    } catch {
      setError('Hasil penyimpanan klasifikasi belum dapat dipastikan. Muat ulang sebelum mencoba lagi.');
    } finally {
      setBusy(false);
      onSaveFinished?.();
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
                  onClick={() => { setPendingRemoval({ ahspId, assignmentId: assignment.id }); setError(null); }}
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
      {pendingRemovalRow && enabled ? (
        <section role="group" aria-label="Konfirmasi hapus pilihan klasifikasi" className="ahsp-classification-remove-confirm">
          <strong>Hapus pilihan klasifikasi ini?</strong>
          <p>{pendingRemovalRow.path.map((node) => node.name).join(' › ')}</p>
          <p>Jika dikonfirmasi, pilihan ini langsung dinonaktifkan di server. AHSP dan komponen tidak dihapus.</p>
          <div className="ahsp-action-row">
            <button type="button" className="ahsp-action ahsp-action--outline" disabled={busy}
              onClick={() => setPendingRemoval(null)}>Batal</button>
            <button type="button" className="ahsp-action ahsp-action--danger" disabled={busy}
              onClick={() => void deactivate(pendingRemovalRow.id)}>
              {busy ? 'Menghapus…' : 'Ya, hapus pilihan'}
            </button>
          </div>
        </section>
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
                onCancelled?.();
              }}
            >
              Batal tambah
            </button>
            <button
              type="button"
              className="ahsp-action ahsp-action--primary"
              disabled={busy || (draft.paths.length === 0 && (draft.pendingPaths?.length ?? 0) === 0)}
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
