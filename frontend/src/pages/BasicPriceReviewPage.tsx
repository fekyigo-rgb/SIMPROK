import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import {
  getBasicPriceImportBatch,
  rejectBasicPriceImportRow,
  resolveBasicPriceImportRow,
  submitBasicPriceImportBatch,
} from '../api/basicPriceImport';
import type { ResourceLookupItem, UnitLookupItem } from '../api/basicPriceImport';
import { CatalogSearchSelect } from '../components/basic-price/CatalogSearchSelect';
import {
  batchStatusLabel,
  canSubmitBatch,
  collisionWarningLabel,
  formatBatchProgress,
  isRowMutable,
  rowSectionLabel,
  rowStatusLabel,
  type BasicPriceImportBatchSummary,
  type BasicPriceImportRowSummary,
} from '../utils/basicPriceImportDisplay';

interface RowDraft {
  resource: ResourceLookupItem | null;
  unit: UnitLookupItem | null;
  resourcePending: boolean;
  unitPending: boolean;
  reason: string;
}

const emptyDraft: RowDraft = { resource: null, unit: null, resourcePending: false, unitPending: false, reason: '' };

/**
 * Row-by-row human resolution room (state machine B). Every row starts
 * NEEDS_REVIEW and only a human resolve/reject action ever moves it —
 * there is no bulk or automatic transition here, matching the "SIMPROK
 * menghitung, manusia memutuskan" law. ResourceCatalog/UnitDefinition IDs
 * are entered as raw UUIDs: no catalog-search endpoint exists yet in this
 * foundation slice (KNOWN_LIMITATIONS — see final evidence report), so
 * candidates are searched explicitly and selected by a human; no first
 * result, unit inference, resolution, or submission is automatic.
 */
export function BasicPriceReviewPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const navigate = useNavigate();
  const [batch, setBatch] = useState<BasicPriceImportBatchSummary | null>(null);
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [statusMessage, setStatusMessage] = useState('Memuat batch...');
  const [isBusy, setIsBusy] = useState(false);

  const loadBatch = async () => {
    if (!batchId) return;
    try {
      const result = await getBasicPriceImportBatch(batchId);
      setBatch(result);
      setStatusMessage(formatBatchProgress(result));
    } catch {
      setStatusMessage('Gagal memuat batch. Muat ulang halaman untuk mencoba lagi.');
    }
  };

  useEffect(() => {
    void loadBatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId]);

  const draftFor = (rowId: string): RowDraft => drafts[rowId] ?? emptyDraft;
  const updateDraft = (rowId: string, patch: Partial<RowDraft>) => {
    setDrafts((current) => ({
      ...current,
      [rowId]: { ...(current[rowId] ?? emptyDraft), ...patch },
    }));
  };

  const handleResolve = async (row: BasicPriceImportRowSummary) => {
    if (!batchId) return;
    const draft = draftFor(row.id);
    if (!draft.resource || !draft.unit || draft.resourcePending || draft.unitPending) {
      setStatusMessage('Pilih satu Resource Katalog dan satu Satuan Kanonik sebelum menyelesaikan baris.');
      return;
    }
    setIsBusy(true);
    try {
      await resolveBasicPriceImportRow(batchId, row.id, row.version, draft.resource.id, draft.unit.id);
      setDrafts((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
      await loadBatch();
      setStatusMessage(`Baris ${row.sourceRowNumber} diperbarui.`);
    } catch {
      setStatusMessage(`Gagal menyelesaikan baris ${row.sourceRowNumber}. Baris mungkin sudah berubah — muat ulang dan coba lagi.`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleReject = async (row: BasicPriceImportRowSummary) => {
    if (!batchId) return;
    const draft = draftFor(row.id);
    if (!draft.reason.trim()) {
      setStatusMessage('Alasan penolakan wajib diisi.');
      return;
    }
    setIsBusy(true);
    try {
      await rejectBasicPriceImportRow(batchId, row.id, row.version, draft.reason.trim());
      await loadBatch();
      setStatusMessage(`Baris ${row.sourceRowNumber} ditolak.`);
    } catch {
      setStatusMessage(`Gagal menolak baris ${row.sourceRowNumber}. Baris mungkin sudah berubah — muat ulang dan coba lagi.`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleSubmitBatch = async () => {
    if (!batchId) return;
    setIsBusy(true);
    setStatusMessage('Mengajukan baris yang siap...');
    try {
      const updated = await submitBasicPriceImportBatch(batchId);
      setBatch(updated);
      setStatusMessage(`Batch ${batchStatusLabel(updated.status)}. ${updated.submittedRows} baris diajukan ke antrean review harga.`);
    } catch {
      setStatusMessage('Gagal mengajukan batch. Pastikan tanggal berlaku, wilayah, dan asal sumber sudah diisi di halaman Impor.');
    } finally {
      setIsBusy(false);
    }
  };

  if (!batch) {
    return (
      <div className="simprok-rab-workspace">
        <header className="simprok-rab-workspace__header">
          <div>
            <div className="simprok-rab-workspace__eyebrow">SIMPROK / Basic Price / Peninjauan</div>
            <h1>Peninjauan Batch Basic Price</h1>
            <p>{statusMessage}</p>
          </div>
        </header>
      </div>
    );
  }

  return (
    <div className="simprok-rab-workspace">
      <div className="simprok-rab-focus-nav" aria-label="Navigasi Peninjauan Basic Price">
        <button onClick={() => navigate('/basic-price/import')} title="Kembali ke Impor" aria-label="Kembali ke Impor">
          <ArrowLeft size={17} /> Kembali ke Impor
        </button>
      </div>

      <header className="simprok-rab-workspace__header">
        <div>
          <div className="simprok-rab-workspace__eyebrow">SIMPROK / Basic Price / Peninjauan</div>
          <h1>Peninjauan Batch Basic Price</h1>
          <p>{batchStatusLabel(batch.status)} — {formatBatchProgress(batch)}</p>
        </div>
        <span className="simprok-rab-workspace__status">{statusMessage}</span>
      </header>

      <section className="simprok-rab-toolbar" aria-label="Aksi Batch">
        <button onClick={() => void handleSubmitBatch()} disabled={!canSubmitBatch(batch) || isBusy} title="Ajukan baris yang siap ke antrean review harga">
          Ajukan Batch ({batch.readyForSubmissionRows} siap)
        </button>
      </section>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '16px' }}>
        {batch.rows.map((row) => {
          const draft = draftFor(row.id);
          const mutable = isRowMutable(row);
          const collisionLabel = collisionWarningLabel(row.collisionType);
          return (
            <section key={row.id} className="simprok-rab-validation-alert" aria-label={`Baris ${row.sourceRowNumber}`}>
              <strong>
                Baris {row.sourceRowNumber} [{rowSectionLabel(row.section)}] — {row.name} — {rowStatusLabel(row.status)}
              </strong>
              <p>
                Kode: {row.code ?? '—'} · Satuan mentah: {row.unit ?? '—'} · Harga: {row.rawPriceDisplayText ?? '—'}
                {row.proposedCanonicalPrice ? ` (Rp ${row.proposedCanonicalPrice})` : ''}
              </p>
              {row.reasonCodes.length > 0 ? <p>Catatan: {row.reasonCodes.join('; ')}</p> : null}
              {collisionLabel ? <p role="alert">⚠ {collisionLabel}</p> : null}

              {mutable ? (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: '8px' }}>
                  <CatalogSearchSelect
                    mode="resource"
                    initialResourceType={row.section}
                    selected={draft.resource}
                    disabled={isBusy}
                    onSelect={(item) => updateDraft(row.id, { resource: item as ResourceLookupItem | null })}
                    onPendingChange={(resourcePending) => updateDraft(row.id, { resourcePending })}
                  />
                  <CatalogSearchSelect
                    mode="unit"
                    selected={draft.unit}
                    disabled={isBusy}
                    onSelect={(item) => updateDraft(row.id, { unit: item as UnitLookupItem | null })}
                    onPendingChange={(unitPending) => updateDraft(row.id, { unitPending })}
                  />
                  <button
                    onClick={() => void handleResolve(row)}
                    disabled={isBusy || draft.resourcePending || draft.unitPending || !draft.resource || !draft.unit}
                  >
                    Selesaikan
                  </button>
                  <label>
                    Alasan tolak
                    <input
                      type="text"
                      placeholder="Alasan penolakan"
                      value={draft.reason}
                      onChange={(event) => updateDraft(row.id, { reason: event.target.value })}
                    />
                  </label>
                  <button onClick={() => void handleReject(row)} disabled={isBusy}>Tolak</button>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
