import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import {
  smartSaveBatch,
  getBasicPriceImportBatch,
  updateBasicPriceImportBatch,
  rejectBasicPriceImportRow,
  resolveBasicPriceImportRow,
  confirmBasicPriceImportRowCategory,
  confirmBasicPriceRowSpecifications,
  getBasicPriceIdentityReviews,
  admitResourceForImportRow,
  admitSafeNewBasicPriceResources,
  submitBasicPriceImportBatch,
  enrichBasicPriceKdn,
  ImportRequestError,
} from '../api/basicPriceImport';
import type {
  BasicPriceIdentityReviewRow,
  ResourceLookupItem,
  ResourceType,
  UnitLookupItem,
} from '../api/basicPriceImport';
import { CatalogSearchSelect } from '../components/basic-price/CatalogSearchSelect';
import { BasicPriceSpecificationEditor } from '../components/basic-price/BasicPriceSpecificationEditor';
import type { SpecDecisionKind } from '../utils/basicPriceSpecificationForm';
import { BasicPriceJourneyStepper } from '../components/basic-price/BasicPriceJourneyStepper';
import { ROW_TONE_CLASS, reviewCounters, rowTone } from '../utils/basicPriceJourney';
import {
  batchStatusLabel,
  collisionWarningLabel,
  completionBlockReason,
  formatBatchProgress,
  formatMachineFirstSummary,
  smartSaveOutcomeMessage,
  alreadyStoredNotice,
  smartSaveFailureMessage,
  isRowMutable,
  lifecycleActionFailureMessage,
  machinePickedResource,
  machinePickedUnit,
  oneActionAcceptanceView,
  optionalRowCanEnrichKdnNow,
  OPTIONAL_ENRICHMENT_EMPTY,
  rowIdentityAdmissionOffered,
  rowSafeNewAdmissionEligible,
  rowIdentityRefusalChoices,
  rowIdentityAdmissionBlockReason,
  IDENTITY_ADMISSION_LABEL,
  IDENTITY_ADMISSION_HELP,
  privateUseBlockSentence,
  proposalDoorView,
  proposalBlockSentence,
  regionScopeNoticeView,
  metadataSaveFailureMessage,
  rowActionFailureMessage,
  rowMachineNarrative,
  reviewResourceSearchFamily,
  correctedCatalogNameCandidateConflict,
  rowNoteDisclosure,
  rowNoteLines,
  rowReviewFactsLine,
  reviewDisplayResourceName,
  rowSectionDisplay,
  candidateResourceTypeLabel,
  rowStateLabel,
  reviewRowBucket,
  staleRowRecoveryMessage,
  isStaleRowConflict,
  isAdmissionCandidateRefreshRequired,
  isAdmissionReviewFingerprintStale,
  rowNonStaleConflictMessage,
  WHY_DISCLOSURE_TITLE,
  type BasicPriceImportBatchSummary,
  type BasicPriceImportRowSummary,
} from '../utils/basicPriceImportDisplay';
import { importRequestMessage } from '../utils/basicPriceIntakeErrors';
import '../styles/basicPrice.css';

type BatchReadback = (value: BasicPriceImportBatchSummary) => void;

interface RowDraft {
  resource: ResourceLookupItem | null;
  unit: UnitLookupItem | null;
  resourcePending: boolean;
  unitPending: boolean;
  reason: string;
  /** Reason field stays hidden until the reviewer opens Tolak. */
  rejectOpen: boolean;
  /** Reason field stays hidden until the reviewer opens admission. */
  admitOpen: boolean;
  admitReason: string;
  /** One row-level name snapshot shared by BOTH actions; source evidence is immutable. */
  correctedCanonicalName: string | null;
  editingName: boolean;
  admitResourceType: ResourceType | null;
  refusedCandidateIds: string[];
}

type ReviewRowFilter = 'ALL' | 'RECOGNIZED' | 'NEEDS_REVIEW' | 'DECIDED';

const REVIEW_ROW_PAGE_SIZE = 30;
/** The existing backend admission contract accepts at most 100 explicit choices. */
const SAFE_NEW_SELECTION_LIMIT = 100;

const emptyDraft: RowDraft = {
  resource: null,
  unit: null,
  resourcePending: false,
  unitPending: false,
  reason: '',
  rejectOpen: false,
  admitOpen: false,
  admitReason: '',
  correctedCanonicalName: null,
  editingName: false,
  admitResourceType: null,
  refusedCandidateIds: [],
};

const admissionUnavailableReason = (reasonCode: string | null): string | null => {
  switch (reasonCode) {
    case 'SOURCE_TYPE_OVERRIDE_FORBIDDEN':
      return 'Jenis sumber daya pada berkas bersifat otoritatif dan tidak boleh diganti dari ruang ini.';
    case 'SOURCE_TYPE_NOT_PROVEN':
      return 'Jenis sumber daya belum terbukti, sehingga item baru belum boleh disimpan.';
    case 'IDENTITY_CANDIDATE_BLOCKED':
      return 'Ada item lain yang mungkin sama. Periksa perbedaannya sebelum membuat item baru.';
    case 'RESOURCE_IDENTITY_NOT_ADMISSIBLE':
      return 'Pemeriksaan identitas belum memenuhi syarat untuk membuat sumber daya baru.';
    default:
      return null;
  }
};

/**
 * A failed lifecycle action, in words — using the server's own named reason
 * whenever it gave one, and never inventing a cause when it did not.
 *
 * The `ImportRequestError` narrowing is what keeps this honest: only that class
 * carries a real status and a real body. Anything else (a network fault, a
 * thrown TypeError) has told us nothing, so it is reported as nothing known
 * rather than dressed up as a server verdict.
 */
const lifecycleFailure = (kind: 'PRIVATE_USE' | 'PROPOSAL', error: unknown): string =>
  error instanceof ImportRequestError
    ? lifecycleActionFailureMessage(kind, error.httpStatus, error.detail)
    : lifecycleActionFailureMessage(kind, 0, '');

const correctedNameCandidateNotice = (candidateName: string): string =>
  `Nama koreksi sama dengan kandidat SIMPROK “${candidateName}” dalam jenis yang dipilih. Periksa padanannya terlebih dahulu. Penolakan kandidat saja tidak membuktikan identitas berbeda; jika memang berbeda, nama katalog harus membedakannya.`;

const proposalFailureMessage = (error: unknown) => lifecycleFailure('PROPOSAL', error);

/**
 * A FAILED `Simpan & Gunakan`, WHICH IS NOT A FAILED PRIVATE-USE ACTION.
 *
 * Smart-save is one command over two independently durable steps, so the
 * private-use sentences — every one of which ends by promising an empty
 * database — can be flatly false here: bindings commit in bounded chunks, and a
 * failure afterwards leaves them in place. The server measures what actually
 * survived and sends it; this only renders that answer.
 *
 * A THROW THAT IS NOT AN `ImportRequestError` told us NOTHING — a dropped
 * connection can land on either side of a commit — so it is reported with no
 * status and no body, which the law reads as `UNKNOWN` rather than as zero.
 */
const smartSaveFailure = (error: unknown): string =>
  error instanceof ImportRequestError
    ? smartSaveFailureMessage(error.httpStatus, error.detail)
    : smartSaveFailureMessage(0, '');

/** Same discipline for a single row's decision: known status, or nothing claimed. */
const rowFailure = (
  action: 'RESOLVE' | 'REJECT' | 'ADMIT',
  sourceRowNumber: number,
  error: unknown,
) =>
  rowActionFailureMessage(
    action,
    sourceRowNumber,
    error instanceof ImportRequestError ? error.httpStatus : 0,
  );

/**
 * Row-by-row human resolution room (state machine B). Every row starts
 * NEEDS_REVIEW and only a human resolve/reject action ever moves it — there is
 * still no bulk and no automatic transition here, matching the "SIMPROK
 * menghitung, manusia memutuskan" law.
 *
 * INT-CONNECT-01 — WHAT CHANGED, AND WHAT DELIBERATELY DID NOT.
 *
 * This room used to open with two empty search boxes over engines nobody had
 * asked. It now opens with what the canonical Unit and Resource Identity
 * authorities ALREADY PROVED about each row, pre-filled and explained. That is
 * a change to how much work the human is made to repeat, not to who decides:
 * the reviewer still presses Selesaikan, the same endpoint still applies the
 * same fail-closed gates, and the same append-only mapping record still names a
 * real person.
 *
 * A selection is pre-filled ONLY where that leg is PROVEN — the unit and the
 * resource are judged by two authorities and are therefore offered
 * independently, so a proven unit still reaches the reviewer on a row whose
 * resource is genuinely open. Candidates, strong-but-unconfirmed matches and
 * ambiguous aliases are shown as evidence and NEVER pre-selected; raw UUID
 * entry is still not exposed; and nothing on this page decides what a unit or a
 * resource means.
 *
 * BP-UX-FINAL-01 §15/§16 — MACHINE TRUTH AND HUMAN JUDGEMENT, TOLD APART BY
 * SIGHT.
 *
 * Every row used to render as `simprok-rab-validation-alert` — a warning card —
 * whether SIMPROK had proved it, was waiting on a person, or had been turned
 * down. On the Owner's eighty-six-row workbook that meant eighty-six alerts for
 * a file that had been read successfully. Rows now carry the tone of what they
 * actually are (`rowTone`): quiet green for machine-proven and for finished
 * work, gold for the rows that genuinely need a person, red ONLY for a row a
 * human rejected.
 *
 * NO VERDICT MOVED. `rowTone` reads `rowMachineState`, `status` and
 * `savedAsPrivatePrice` — three existing server facts — and decides nothing.
 * The evidence a reviewer needs to choose is still on the row; only the
 * technical vocabulary stays folded away, exactly as before.
 */
export function BasicPriceReviewPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const navigate = useNavigate();
  const [batch, setBatch] = useState<BasicPriceImportBatchSummary | null>(null);
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  /** Rows a person has edited by hand since this batch was loaded. */
  const [touchedRowIds, setTouchedRowIds] = useState<Set<string>>(new Set());
  const [lookupRows, setLookupRows] = useState<Set<string>>(new Set());
  const [rowFilter, setRowFilter] = useState<ReviewRowFilter>('ALL');
  const [visibleRowLimit, setVisibleRowLimit] = useState(REVIEW_ROW_PAGE_SIZE);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [safeNewRowIds, setSafeNewRowIds] = useState<Set<string>>(new Set());
  const [safeNewResourceType, setSafeNewResourceType] = useState<ResourceType | ''>('');
  const [statusMessage, setStatusMessage] = useState('Memuat batch...');
  /** Local acknowledgement stays beside the row, even when the page is scrolled. */
  const [rowNotice, setRowNotice] = useState<{ rowId: string; text: string } | null>(null);
  const [categoryDrafts, setCategoryDrafts] = useState<Record<string, ResourceType | ''>>({});
  const [categoryEditRows, setCategoryEditRows] = useState<Set<string>>(new Set());
  // Read historical identity decisions; no external approval is required for private items.
  const [identityReviewStatuses, setIdentityReviewStatuses] = useState<Record<string, BasicPriceIdentityReviewRow> | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  /**
   * @param announceProgress whether the reload may replace the status line.
   *
   * A reload after a lifecycle action must NOT overwrite what that action
   * reported. "6 harga tersimpan dan siap dipakai" is the outcome the person
   * pressed for; replacing it a beat later with the batch's progress tally
   * would erase the only acknowledgement they get — the exact silence this
   * whole repair exists to remove.
   */
  const loadBatch = async (announceProgress = true, onReadback?: BatchReadback): Promise<boolean> => {
    if (!batchId) return false;
    try {
      const result = await getBasicPriceImportBatch(batchId);
      setBatch(result);
      onReadback?.(result);
      let historicalReviewNotice: string | null = null;
      try {
        // Preserve visibility of prior decisions even though private users no longer request new curation.
        const history = await getBasicPriceIdentityReviews(batchId);
        setIdentityReviewStatuses(history.rows);
      } catch (error) {
        setIdentityReviewStatuses(null);
        historicalReviewNotice = error instanceof ImportRequestError
          ? importRequestMessage(error.httpStatus)
          : 'Riwayat pemeriksaan identitas belum dapat dibaca.';
      }
      // INT-CONNECT-01 — CARRY THE MACHINE'S PROVEN ANSWER INTO THE FORM.
      //
      // The previous version of this page discarded it: the payload already
      // carried resolution facts and the drafts always started empty, so a
      // reviewer re-derived by hand what the server had proved. Seeding closes
      // exactly that gap and nothing more.
      //
      // A reviewer's OWN in-progress edit always wins — a reload must never
      // overwrite a choice a human is midway through making.
      setDrafts((current) => {
        const next = { ...current };
        for (const row of result.rows) {
          if (!isRowMutable(row) || next[row.id]) continue;
          // Each leg independently: a proven unit is offered even when the
          // resource beside it is still open, and vice versa. Neither helper
          // returns anything short of proven.
          const resource = machinePickedResource(row);
          const unit = machinePickedUnit(row);
          if (!resource && !unit) continue;
          next[row.id] = { ...emptyDraft, resource, unit };
        }
        return next;
      });
      if (announceProgress) setStatusMessage(historicalReviewNotice ? `${formatBatchProgress(result)} ${historicalReviewNotice}` : formatBatchProgress(result));
      /**
       * BP-VISUAL-TRUTH-07 §14 — WHETHER THE READ ACTUALLY HAPPENED, ANSWERED.
       *
       * This function handles its own failure and returns either way, so a
       * caller had no way to distinguish "the newest state is on screen" from
       * "the read failed and the screen is unchanged". The stale-recovery path
       * must not tell a person SIMPROK has loaded the newest version when it
       * has not — so the fact is now returned rather than inferred.
       */
      return true;
    } catch (error) {
      // The API client already parsed a status and a body; a bare `catch {}`
      // threw both away and told everyone to reload — including the reviewer
      // whose session had expired and the one who never had the authority.
      setStatusMessage(
        error instanceof ImportRequestError
          ? importRequestMessage(error.httpStatus)
          : 'Gagal memuat batch. Muat ulang halaman untuk mencoba lagi.',
      );
      return false;
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
    // A HUMAN TOUCHED THIS ROW. Recorded here and nowhere else, because
    // `updateDraft` is only ever reached from a person's own select/typing
    // handlers — the machine's proposals are seeded straight through
    // `setDrafts` when the batch loads, so a prefilled row is not a touched one.
    setTouchedRowIds((current) =>
      current.has(rowId) ? current : new Set(current).add(rowId),
    );
  };

  /** Snapshot this row's edited name for both resolution choices.
   * Previous catalog selections belong to the old spelling and must be cleared. */
  const changeWorkingName = (row: BasicPriceImportRowSummary, value: string) => {
    updateDraft(row.id, { correctedCanonicalName: value, resource: null, resourcePending: false });
    setRowNotice((current) => current?.rowId === row.id ? null : current);
    setSafeNewRowIds((current) => {
      if (!current.has(row.id)) return current;
      const next = new Set(current);
      next.delete(row.id);
      return next;
    });
  };

  /**
   * Rows the batch action must LEAVE ALONE.
   *
   * A reviewer who is mid-correction on a row SIMPROK happens to have proven
   * must not have their unsaved edit overwritten by the machine's earlier
   * proposal. This is intent about SCOPE — "not that one" — and never an
   * identity claim, so it is the one thing this page may state.
   */
  const editedRowIds = (): string[] => [...touchedRowIds];
  /** Once a human decision commits, it is no longer an unsaved draft.
   * Smart Save must not exclude a row that has already been resolved. */
  const forgetCompletedEdit = (rowId: string) => setTouchedRowIds((current) => {
    if (!current.has(rowId)) return current;
    const next = new Set(current);
    next.delete(rowId);
    return next;
  });

  /**
   * BP-VISUAL-TRUTH-07 §14 — WHAT HAPPENS AFTER A WRITE IS REFUSED FOR BEING
   * STALE.
   *
   * THE PROTECTION ITSELF IS UNTOUCHED AND MUST STAY THAT WAY. The row carries
   * a version, the endpoint compares it, and a mismatch is a 409 that writes
   * nothing (`ROW_VERSION_STALE`). No retry, no replay, no "try again with the
   * new version" — a stale decision is a decision made against facts that have
   * since changed, and re-sending it automatically is precisely the last-write-
   * wins behaviour the version exists to prevent.
   *
   * WHAT WAS MISSING WAS THE RECOVERY. The old path stated the refusal and
   * stopped, telling the reviewer to reload the page. On a workbook of 894 rows
   * that means discarding every unsaved selection on screen to repair one row.
   * So SIMPROK now fetches the current truth ITSELF — the same `loadBatch` read
   * every other path uses, no new endpoint — and the row redraws at its newest
   * version and newest state.
   *
   * THE REVIEWER'S OWN WORK IS KEPT, AS A DRAFT AND ONLY AS A DRAFT. The draft
   * map is deliberately NOT cleared here (the success path clears it; this one
   * must not), so the Item SIMPROK and Satuan they had chosen are still in the
   * boxes. Nothing is submitted on their behalf: the next write is a fresh
   * press against the refreshed version, which is an explicit reconfirmation by
   * a person who has now seen what changed.
   *
   * ONLY 409 MEANS THIS. A 401, 403, 404 or 500 is a different fact with a
   * different sentence, and refreshing on those would be noise.
   */
  const recoverFromRowFailure = async (
    action: 'RESOLVE' | 'REJECT' | 'ADMIT',
    row: BasicPriceImportRowSummary,
    error: unknown,
  ): Promise<string> => {
    const httpStatus = error instanceof ImportRequestError ? error.httpStatus : 0;
    if (httpStatus !== 409) return rowFailure(action, row.sourceRowNumber, error);
    // A changed candidate-review fingerprint is an evidence readback, NOT a
    // human decision and NOT proof that someone edited this row. Never replay.
    if (action === 'ADMIT' && error instanceof ImportRequestError &&
        isAdmissionCandidateRefreshRequired(error.detail)) {
      const candidateReadback: { row?: BasicPriceImportRowSummary } = {};
      const readBack = await loadBatch(false, (latest) => {
        candidateReadback.row = latest.rows.find((candidate) => candidate.id === row.id);
      });
      const currentRow = candidateReadback.row;
      if (!readBack || !currentRow) {
        return `Baris ${row.sourceRowNumber} belum disimpan. SIMPROK belum berhasil memuat bukti kandidat terkini. Jangan mengulangi keputusan lama; periksa koneksi dan muat kembali baris ini.`;
      }
      const freshReview = currentRow.machineProposal?.resource.admissionReview;
      const previousReview = row.machineProposal?.resource.admissionReview;
      // Preserve human-written reason/name/unit. Refusal checkmarks only apply
      // to the exact old candidate set; clear them and ask for human re-review.
      setDrafts((current) => ({
        ...current,
        [row.id]: {
          ...(current[row.id] ?? emptyDraft),
          refusedCandidateIds: [],
          admitResourceType: freshReview?.typeConfirmations.length === 1
            ? freshReview.typeConfirmations[0].resourceType
            : current[row.id]?.admitResourceType ?? null,
        },
      }));
      if (freshReview && previousReview && freshReview.reviewBindingFingerprint === previousReview.reviewBindingFingerprint) {
        if (isAdmissionReviewFingerprintStale(error.detail)) {
          return `Baris ${row.sourceRowNumber} belum disimpan. SIMPROK sudah memeriksa ulang, tetapi bukti kandidat tetap sama dan server masih menolak. Jangan ulangi tombol: ini perlu pemeriksaan konsistensi keputusan dan backend.`;
        }
        return `Baris ${row.sourceRowNumber} belum disimpan. Daftar kandidat tetap sama, tetapi tanda penolakan yang dikirim belum sesuai. Silakan tandai kembali kandidat yang memang sudah Anda periksa; alasan dan satuan tetap sebagai draf.`;
      }
      if (!freshReview?.offered) {
        const blocked = currentRow.machineProposal?.resource.candidates
          .filter((candidate) => candidate.admissionDisposition === 'BLOCKED')
          .map((candidate) => candidate.name) ?? [];
        return `Baris ${row.sourceRowNumber} belum disimpan. Kandidat terkini sudah dimuat. Item Baru kini tertahan oleh pemeriksaan identitas${blocked.length ? ': ' + blocked.join(', ') : ''}. Buka Bandingkan kandidat dan bukti identitas pada baris ini; alasan dan satuan Anda tetap sebagai draf.`;
      }
      const count = freshReview.humanRefusableCandidateIds.length;
      return `Baris ${row.sourceRowNumber} belum disimpan. Daftar kandidat terbaru sudah dimuat di baris ini. Periksa ${count} kandidat yang dapat Anda tolak jika memang berbeda, lalu tandai kembali kandidat yang telah diperiksa dan tekan Tetapkan Item Baru. Alasan dan satuan Anda tetap sebagai draf; tidak ada penetapan otomatis.`;
    }
    // Only an explicit ROW_VERSION_STALE is proof of an obsolete row version.
    if (error instanceof ImportRequestError && !isStaleRowConflict(error.detail)) {
      return rowNonStaleConflictMessage(row.sourceRowNumber, error.detail);
    }
    /**
     * `false` because THIS function owns the sentence. `loadBatch` would
     * otherwise announce the batch's progress tally, which would be overwritten
     * a line later — the same status-flicker the announce flag exists to stop.
     */
    const refreshed = await loadBatch(false);
    if (!refreshed) {
      /**
       * THE REFRESH IS THE COURTESY, NOT THE SAFETY. The write was refused
       * either way; what is lost here is only SIMPROK's ability to repair the
       * screen. So the reviewer is told to reload themselves — and is NOT told
       * that the newest version is on screen, because it is not.
       *
       * `loadBatch` never throws; it handles its own failure and reports it,
       * which is why this reads a returned fact rather than catching one. It
       * has already put its own reason on the status line (expired session,
       * missing authority, fault); that sentence is replaced here because the
       * person's actual question is what happened to their DECISION, and the
       * answer — refused as stale, nothing saved — is the one they can act on.
       */
      return rowFailure(action, row.sourceRowNumber, error);
    }
    if (action === 'ADMIT') {
      setDrafts((current) => ({
        ...current,
        [row.id]: {
          ...(current[row.id] ?? emptyDraft),
          admitOpen: false,
          admitReason: '',
          admitResourceType: null,
          refusedCandidateIds: [],
        },
      }));
    }
    return staleRowRecoveryMessage(row.sourceRowNumber);
  };

  /** One explicit human decision; source facts remain immutable and no catalog is minted here. */
  const handleConfirmSourceSpecifications = async (row: BasicPriceImportRowSummary) => {
    if (!batchId || !row.sourceSpecifications?.length) return;
    const facts = row.sourceSpecifications;
    if (facts.some((fact) => fact.value === null || !fact.value?.trim())) {
      const message = 'Ada spesifikasi yang belum dapat dibaca. Perbaikan memerlukan alasan dan pemeriksaan tersendiri.';
      setRowNotice({ rowId: row.id, text: message });
      setStatusMessage(message);
      return;
    }
    const sourceFacts = Object.fromEntries(facts.map((fact) => [fact.label, fact.value!]));
    setIsBusy(true);
    try {
      await confirmBasicPriceRowSpecifications(batchId, row.id, row.version, sourceFacts);
      const refreshed = await loadBatch(false);
      const message = refreshed
        ? 'Spesifikasi baris ' + row.sourceRowNumber + ' telah dikonfirmasi dan dicatat dalam riwayat. SIMPROK memeriksa identitas kembali.'
        : 'Konfirmasi diterima, tetapi pembacaan ulang gagal. Muat ulang sebelum memutuskan identitas.';
      setRowNotice({ rowId: row.id, text: message });
      setStatusMessage(message);
    } catch (error) {
      if (error instanceof ImportRequestError && error.httpStatus === 409) {
        await loadBatch(false);
      }
      const message = error instanceof ImportRequestError && error.httpStatus === 409
        ? 'Konfirmasi belum disimpan: data telah berubah atau berbeda dari berkas. Tinjau kembali spesifikasi.'
        : error instanceof ImportRequestError
          ? importRequestMessage(error.httpStatus)
          : 'Konfirmasi belum berhasil; tidak ada keputusan identitas baru.';
      setRowNotice({ rowId: row.id, text: message });
      setStatusMessage(message);
    } finally {
      setIsBusy(false);
    }
  };

  /** Existing audit writer: manual facts re-enter the canonical identity pathway on readback. */
  const handleSaveManualSpecifications = async (
    row: BasicPriceImportRowSummary,
    facts: Record<string, string>,
    kind: SpecDecisionKind,
    reason?: string,
  ): Promise<boolean> => {
    if (!batchId || !isRowMutable(row) || isBusy) return false;
    const existingDraft = drafts[row.id];
    if ((existingDraft?.resource || existingDraft?.admitOpen) &&
        !window.confirm('Keputusan spesifikasi dapat mengubah kecocokan identitas. Batalkan pilihan padanan/item baru yang belum disimpan dan lanjutkan?')) {
      return false;
    }
    setIsBusy(true);
    try {
      await confirmBasicPriceRowSpecifications(batchId, row.id, row.version, facts, kind, reason);
      // Never reuse a resource selection made before the specification decision.
      setDrafts((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
      setLookupRows((current) => {
        const next = new Set(current);
        next.delete(row.id);
        return next;
      });
      const readback = await loadBatch(false);
      const message = readback
        ? 'Spesifikasi baris ' + row.sourceRowNumber + ' tercatat. Identitas dan kandidat diperiksa ulang; pilih padanan atau item baru berdasarkan bukti terbaru.'
        : 'Keputusan tercatat, tetapi pembacaan ulang gagal. Muat ulang sebelum memilih identitas.';
      setRowNotice({ rowId: row.id, text: message });
      setStatusMessage(message);
      return readback;
    } catch (error) {
      if (error instanceof ImportRequestError && error.httpStatus === 409) await loadBatch(false);
      const message = error instanceof ImportRequestError && error.httpStatus === 409
        ? 'Spesifikasi belum disimpan: versi atau bukti bertentangan. Muat ulang dan periksa keputusan sebelumnya.'
        : error instanceof ImportRequestError
          ? importRequestMessage(error.httpStatus)
          : 'Keputusan spesifikasi belum berhasil disimpan.';
      setRowNotice({ rowId: row.id, text: message });
      setStatusMessage(message);
      return false;
    } finally {
      setIsBusy(false);
    }
  };

  const handleConfirmCategory = async (row: BasicPriceImportRowSummary) => {
    if (!batchId) return;
    const category = categoryDrafts[row.id] ?? row.section ?? '';
    if (!category) {
      setRowNotice({ rowId: row.id, text: 'Pilih jenis item terlebih dahulu.' });
      return;
    }
    if (!window.confirm('Tetapkan jenis ' + (category === 'LABOR' ? 'Tenaga kerja' : category === 'MATERIAL' ? 'Bahan' : 'Peralatan') + ' untuk baris ' + row.sourceRowNumber + '? Keterangan asli Excel tetap disimpan.')) return;
    setIsBusy(true);
    try {
      const result = await confirmBasicPriceImportRowCategory(batchId, row.id, row.version, category);
      // A category change invalidates any previous catalog/unit draft, which may
      // belong to another resource family. No old choice may silently survive.
      if (!result.unchanged) {
        setDrafts((current) => ({ ...current, [row.id]: {
          ...(current[row.id] ?? emptyDraft), resource: null, unit: null,
          resourcePending: false, unitPending: false, admitOpen: false,
          admitResourceType: null, refusedCandidateIds: [],
        } }));
        setTouchedRowIds((current) => new Set(current).add(row.id));
        setLookupRows((current) => { const next = new Set(current); next.delete(row.id); return next; });
      }
      const refreshed = await loadBatch(false);
      if (refreshed) {
        setCategoryEditRows((current) => { const next = new Set(current); next.delete(row.id); return next; });
        setCategoryDrafts((current) => { const next = { ...current }; delete next[row.id]; return next; });
      }
      const notice = !refreshed
        ? 'Keputusan diterima, tetapi tampilan belum dapat diperbarui. Muat ulang untuk memastikan hasil.'
        : result.unchanged
          ? 'Jenis pada baris ' + row.sourceRowNumber + ' sudah sesuai dan tidak diubah.'
          : 'Berhasil: jenis baris ' + row.sourceRowNumber + ' telah ditetapkan. Lanjutkan memilih item dan satuannya.';
      setRowNotice({ rowId: row.id, text: notice });
      setStatusMessage(notice);
    } catch (error) {
      const notice = error instanceof ImportRequestError && error.httpStatus === 409
        ? error.detail.includes('ROW_BUSY_RETRY')
          ? 'Baris ini sedang diproses. Muat ulang hasil peninjauan, lalu coba lagi. Tidak ada perubahan jenis yang disimpan.'
          : 'Data baris telah berubah atau tidak dapat diedit lagi. Muat ulang hasil peninjauan sebelum melanjutkan.'
        : error instanceof ImportRequestError
          ? importRequestMessage(error.httpStatus)
          : 'Jenis belum berhasil disimpan. Muat ulang baris lalu coba lagi.';
      setRowNotice({ rowId: row.id, text: notice });
      setStatusMessage(notice);
    } finally {
      setIsBusy(false);
    }
  };

  const handleResolve = async (row: BasicPriceImportRowSummary) => {
    if (!batchId) return;
    const draft = draftFor(row.id);
    if (draft.correctedCanonicalName !== null &&
        (!draft.correctedCanonicalName.trim() || draft.correctedCanonicalName !== draft.correctedCanonicalName.trim())) {
      setStatusMessage('Nama koreksi tidak boleh kosong atau memiliki spasi awal/akhir.');
      return;
    }
    if (!draft.resource || !draft.unit || draft.resourcePending || draft.unitPending) {
      setStatusMessage('Pilih satu Item SIMPROK dan satu Satuan standar sebelum mengonfirmasi pilihan.');
      return;
    }
    if (draft.correctedCanonicalName !== null && draft.correctedCanonicalName !== row.name) {
      const confirmed = window.confirm(
        'Anda yakin menggunakan pilihan padanan pada baris ' + row.sourceRowNumber + '?\n\n' +
        'Nama Excel: ' + row.name + '\nNama kerja: ' + draft.correctedCanonicalName + '\n\n' +
        'Yang disimpan adalah pilihan item dan satuan. Nama asli Excel dan nama katalog tidak diubah.',
      );
      if (!confirmed) {
        setStatusMessage('Baris ' + row.sourceRowNumber + ': belum disimpan. Draft koreksi tetap tersedia.');
        return;
      }
    }
    setIsBusy(true);
    try {
      await resolveBasicPriceImportRow(batchId, row.id, row.version, draft.resource.id, draft.unit.id);
      forgetCompletedEdit(row.id);
      setDrafts((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
      const refreshed = await loadBatch(false);
      const notice = refreshed
        ? 'Berhasil: padanan dan satuan baris ' + row.sourceRowNumber + ' telah disimpan.'
        : 'Baris ' + row.sourceRowNumber + ': pilihan diterima server, tetapi tampilan belum berhasil dimuat ulang. Muat ulang untuk verifikasi.';
      setRowNotice({ rowId: row.id, text: notice });
      setStatusMessage(notice);
    } catch (error) {
      const notice = await recoverFromRowFailure('RESOLVE', row, error);
      setRowNotice({ rowId: row.id, text: notice });
      setStatusMessage(notice);
    } finally {
      setIsBusy(false);
    }
  };

  const handleReject = async (row: BasicPriceImportRowSummary) => {
    if (!batchId) return;
    const draft = draftFor(row.id);
    if (!draft.rejectOpen) {
      updateDraft(row.id, { rejectOpen: true });
      setStatusMessage(`Tuliskan alasan penolakan untuk baris ${row.sourceRowNumber}.`);
      return;
    }
    if (!draft.reason.trim()) {
      setStatusMessage('Alasan penolakan wajib diisi.');
      return;
    }
    setIsBusy(true);
    try {
      await rejectBasicPriceImportRow(batchId, row.id, row.version, draft.reason.trim());
      forgetCompletedEdit(row.id);
      await loadBatch();
      setStatusMessage(`Baris ${row.sourceRowNumber} ditolak.`);
    } catch (error) {
      setStatusMessage(await recoverFromRowFailure('REJECT', row, error));
    } finally {
      setIsBusy(false);
    }
  };

  /**
   * RM-03D1 — CONNECT the existing admit-resource writer. The source name,
   * type, and code remain immutable; a corrected catalog name is a separate
   * human draft shared with the existing-resource picker, passed to the
   * authoritative admission writer only when the reviewer confirms. The door
   * is shown only when the existing
   * identity authority is exhausted — candidates stay a review, not an admit.
   */
  const handleAdmit = async (row: BasicPriceImportRowSummary) => {
    if (!batchId) return;
    const draft = draftFor(row.id);
    const review = row.machineProposal?.resource.admissionReview;
    if (!review?.offered) {
      setStatusMessage('Pertanyaan pengesahan berubah. Tinjau kembali baris ini.');
      return;
    }
    const refusalsConfirmed =
      draft.refusedCandidateIds.length ===
        review.humanRefusableCandidateIds.length &&
      review.humanRefusableCandidateIds.every((candidateId) =>
        draft.refusedCandidateIds.includes(candidateId),
      );
    const block = rowIdentityAdmissionBlockReason({
      unitSelected: Boolean(draft.unit),
      unitPending: draft.unitPending,
      reasonFilled: Boolean(draft.admitReason.trim()),
      admitOpen: draft.admitOpen,
      busy: isBusy,
      refusalsConfirmed,
      typeSelected: draft.admitResourceType !== null,
    });
    if (!draft.admitOpen) {
      if (block) {
        setStatusMessage(block);
        return;
      }
      updateDraft(row.id, {
        admitOpen: true,
        admitResourceType:
          review.typeConfirmations.length === 1
            ? review.typeConfirmations[0].resourceType
            : null,
      });
      setStatusMessage(
        `Tuliskan alasan pengesahan item baru untuk baris ${row.sourceRowNumber}.`,
      );
      return;
    }
    if (draft.correctedCanonicalName !== null && draft.correctedCanonicalName !== row.name &&
        batch?.reviewCapabilities?.correctedCanonicalNameOnAdmission !== true) {
      setStatusMessage('Backend preview belum mendukung penyimpanan koreksi nama. Penetapan item baru diblokir agar nama asli tidak tersimpan sebagai nama koreksi.');
      return;
    }
    if (draft.correctedCanonicalName !== null && (!draft.correctedCanonicalName.trim() || draft.correctedCanonicalName !== draft.correctedCanonicalName.trim())) {
      setStatusMessage('Nama katalog tidak boleh kosong atau memiliki spasi di awal/akhir.');
      return;
    }
    const sameNameCandidate = correctedCatalogNameCandidateConflict(
      row, draft.correctedCanonicalName ?? row.name, draft.admitResourceType,
    );
    if (sameNameCandidate) {
      setStatusMessage(correctedNameCandidateNotice(sameNameCandidate.name));
      return;
    }
    const typeConfirmation = review.typeConfirmations.find(
      (option) => option.resourceType === draft.admitResourceType,
    );
    if (block || !draft.unit || !draft.admitResourceType || !typeConfirmation) {
      setStatusMessage(block ?? IDENTITY_ADMISSION_HELP);
      return;
    }
    if (draft.correctedCanonicalName !== null && draft.correctedCanonicalName !== row.name) {
      const confirmed = window.confirm(
        'Anda yakin menetapkan item privat baru pada baris ' + row.sourceRowNumber + '?\n\n' +
        'Nama Excel: ' + row.name + '\nNama item baru: ' + draft.correctedCanonicalName.trim() + '\n\n' +
        'Data Excel asli tetap tercatat. Status berhasil hanya diberikan setelah server menerima keputusan.',
      );
      if (!confirmed) {
        setStatusMessage('Baris ' + row.sourceRowNumber + ': penetapan dibatalkan. Draft koreksi tetap tersedia.');
        return;
      }
    }
    setIsBusy(true);
    try {
      await admitResourceForImportRow(
        batchId,
        row.id,
        row.version,
        draft.unit.id,
        draft.admitReason.trim(),
        draft.admitResourceType,
        draft.refusedCandidateIds,
        typeConfirmation.reviewBindingFingerprint,
        draft.correctedCanonicalName?.trim() && draft.correctedCanonicalName.trim() !== row.name
          ? draft.correctedCanonicalName.trim()
          : undefined,
      );
      forgetCompletedEdit(row.id);
      setDrafts((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
      const refreshed = await loadBatch(false);
      const notice = refreshed
        ? 'Berhasil: item privat baru untuk baris ' + row.sourceRowNumber + ' telah disimpan.'
        : 'Baris ' + row.sourceRowNumber + ': penetapan diterima server, tetapi tampilan belum berhasil dimuat ulang. Muat ulang untuk verifikasi.';
      setRowNotice({ rowId: row.id, text: notice });
      setStatusMessage(notice);
    } catch (error) {
      const notice = await recoverFromRowFailure('ADMIT', row, error);
      setRowNotice({ rowId: row.id, text: notice });
      setStatusMessage(notice);
    } finally {
      setIsBusy(false);
    }
  };

  /**
   * BP-REGION-TRUTH-07S — THE SAME CONFIRMATION, AT THE BLOCKED SAVE.
   *
   * Import already records `confirmRegionScopeCompatibility`. Tinjau Hasil used
   * to print the refusal and send the reviewer away, so the existing action was
   * unreachable from the button that was actually disabled. This sends the
   * identical intent against the Wilayah already saved on the batch. It does
   * not pick a Region, does not confirm a dirty form, and does not open Simpan
   * by itself — the server re-evaluates `privateUseBlockReason` after reload.
   */
  const handleConfirmRegionScope = async () => {
    if (!batch) return;
    setIsBusy(true);
    setStatusMessage('Mencatat peninjauan wilayah...');
    try {
      const updated = await updateBasicPriceImportBatch(batch.batchId, batch.version, {
        confirmRegionScopeCompatibility: true,
      });
      setBatch(updated);
      setStatusMessage('Peninjauan wilayah tercatat.');
    } catch (error) {
      setStatusMessage(
        error instanceof ImportRequestError
          ? metadataSaveFailureMessage(error.httpStatus, error.detail)
          : 'Peninjauan tidak sampai ke SIMPROK. Periksa koneksi lalu coba lagi. Tidak ada yang tersimpan.',
      );
    } finally {
      setIsBusy(false);
    }
  };

  /**
   * SIMPAN & GUNAKAN — the primary action, and the one this room never had.
   *
   * It calls the RM-03C private-asset route, which turns the rows a human has
   * already finished into workspace-private Basic Prices this workspace can use
   * at once. No verifier, no publisher, no queue. The batch stays open, so the
   * remaining rows can still be worked on and this can be pressed again.
   *
   * The message afterwards is COUNTED FROM THE SERVER'S OWN ANSWER, never
   * predicted from the button's label, and it distinguishes prices created just
   * now from prices that were already kept — pressing twice must not read as
   * two successes.
   */
  const handleKeepPrivate = async () => {
    if (!batchId) return;
    setIsBusy(true);
    setStatusMessage('Menyimpan harga yang sudah selesai...');
    try {
      /**
       * ONE PRESS, ONE REQUEST, ONE BACKEND COMMAND.
       *
       * This page used to sequence the two halves itself — accept, await, keep —
       * which made the BROWSER the orchestrator of two business mutations. A
       * closed laptop or a dropped connection between them left the batch bound
       * but not kept, and the person who pressed once could not tell which half
       * had happened. Deciding what the product DOES belongs on the server; a
       * page states an intent and reports the answer.
       *
       * The two acts are still two acts server-side, with their own permissions
       * (`BASIC_PRICE_RESOLVE` and `BASIC_PRICE_SUBMIT`, required together via
       * `PermissionsAll`) and their own audit meanings. What changed is who
       * sequences them.
       *
       * `excludeRowIds` carries the rows a human is still editing on this
       * screen, so an unsaved manual correction is never overwritten by the
       * machine's earlier proposal. It is intent about SCOPE, never an identity.
       */
      const outcome = await smartSaveBatch(batchId, editedRowIds());
      setStatusMessage(smartSaveOutcomeMessage(outcome));
      // Re-read rather than patch locally: the server decides what this batch
      // may do next, and after a save that answer can change.
      await loadBatch(false);
    } catch (error) {
      setStatusMessage(smartSaveFailure(error));
    } finally {
      setIsBusy(false);
    }
  };

  /**
   * USULKAN KE SIMPROK — the optional, separate, TERMINAL act.
   *
   * It creates no usable price. It offers the batch to SIMPROK's curation and
   * closes it, which is why it legitimately needs every row decided first — and
   * why presenting it as the only way out of this room was the defect, not the
   * gate itself.
   */
  const handleSubmitBatch = async () => {
    if (!batchId) return;
    setIsBusy(true);
    setStatusMessage('Mengusulkan baris yang siap ke SIMPROK...');
    // What was already proposed BEFORE this click. The endpoint is idempotent:
    // an already-submitted batch is returned unchanged rather than re-processed,
    // and reporting its standing total as the result of this press would claim
    // work that did not happen.
    const alreadyProposed = batch?.submittedRows ?? 0;
    try {
      const updated = await submitBasicPriceImportBatch(batchId);
      setBatch(updated);
      const justProposed = updated.submittedRows - alreadyProposed;
      setStatusMessage(
        justProposed > 0
          ? `${justProposed} harga diusulkan ke SIMPROK dan sedang menunggu pemeriksaan. Harga yang sudah Anda simpan tetap bisa dipakai.`
          : `Batch ini sudah diusulkan sebelumnya — ${updated.submittedRows} harga sedang menunggu pemeriksaan. Tidak ada yang berubah.`,
      );
    } catch (error) {
      setStatusMessage(proposalFailureMessage(error));
    } finally {
      setIsBusy(false);
    }
  };

  if (!batch) {
    return (
      <div className="bp-room">
        <header className="bp-head">
          <div>
            <div className="bp-head__crumb">SIMPROK / Basic Price / Peninjauan</div>
            <h1 className="bp-head__title">Tinjau Daftar Harga</h1>
            <p className="bp-head__sub" role="status">{statusMessage}</p>
          </div>
        </header>
      </div>
    );
  }

  // WHAT ONE PRESS WOULD ACHIEVE — computed by the shared helper, so the
  // number on the button and the rule that enables it are the same statement.
  const oneAction = oneActionAcceptanceView(batch, touchedRowIds);
  const oneActionOffered = oneAction.offered;
  const oneActionRowCount = oneAction.rowCount;
  /** Non-null only when there is genuinely nothing left for this press to do. */
  const alreadyStored = alreadyStoredNotice(oneAction);
  const counters = reviewCounters(batch);
  const proposalDoor = proposalDoorView(batch.actions.simprokProposal);
  const regionScopeNotice = regionScopeNoticeView(batch);
  // These are view counts over the rows actually delivered with this batch.
  // They do not claim that a paginated response contains the whole source file.
  // Every row enters one exclusive group. A completed human decision is NOT
  // incorrectly counted as "Perlu Tinjauan" just because proposals are absent.
  const recognizedRowCount = batch.rows.filter((row) => reviewRowBucket(row) === 'RECOGNIZED').length;
  const decidedRowCount = batch.rows.filter((row) => reviewRowBucket(row) === 'DECIDED').length;
  const needsReviewRowCount = batch.rows.filter((row) => reviewRowBucket(row) === 'NEEDS_REVIEW').length;
  const filteredRows = batch.rows.filter((row) =>
    rowFilter === 'ALL' || reviewRowBucket(row) === rowFilter
  );
  const visibleRows = filteredRows.slice(0, visibleRowLimit);
  // The bulk writer uses the raw workbook name: never include a row whose
  // reviewer corrected that name without passing the correction to the writer.
  const safeNewRows = batch.rows.filter((row) =>
    !row.machineProposal?.blockingFacts.includes('SOURCE_SPECIFICATION_UNVERIFIED') &&
    rowSafeNewAdmissionEligible(row) &&
    (draftFor(row.id).correctedCanonicalName === null ||
      draftFor(row.id).correctedCanonicalName === row.name)
  );

  const handleAdmitSafeNew = async () => {
    if (!safeNewResourceType || safeNewRowIds.size === 0) return;
    if (safeNewRowIds.size > SAFE_NEW_SELECTION_LIMIT) {
      setStatusMessage(`Maksimal ${SAFE_NEW_SELECTION_LIMIT} item untuk satu tindakan. Selesaikan pilihan ini lalu lanjutkan pilihan berikutnya.`);
      return;
    }
    const selected = safeNewRows.filter((row) => safeNewRowIds.has(row.id));
    if (selected.length !== safeNewRowIds.size) {
      setStatusMessage('Pilihan berubah. Tinjau kembali baris dan jenis item.');
      return;
    }
    setIsBusy(true);
    try {
      const result = await admitSafeNewBasicPriceResources(
        batch.batchId,
        selected,
        safeNewResourceType,
      );
      setSafeNewRowIds(new Set());
      await loadBatch();
      setStatusMessage(
        `${result.acceptedCount} item baru ditetapkan. ${result.blockedCount} tetap Perlu Tinjauan.`,
      );
    } catch (error) {
      setStatusMessage(
        error instanceof ImportRequestError
          ? importRequestMessage(error.httpStatus)
          : 'Pengesahan pilihan belum dapat diselesaikan.',
      );
    } finally {
      setIsBusy(false);
    }
  };

  const selectRowFilter = (nextFilter: ReviewRowFilter) => {
    setRowFilter(nextFilter);
    setVisibleRowLimit(REVIEW_ROW_PAGE_SIZE);
  };

  const toggleExpandedRow = (rowId: string) => {
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };

  return (
    <div className="bp-room">
      {/*
        BACK TO THIS BATCH, not back to an empty upload form. Every reason an
        action is blocked below except "no rows finished yet" is a missing batch
        fact, and the only place to state one is the import room — which, until
        the batch could be reopened, meant starting the whole upload again.
      */}
      <div className="bp-head__doors" aria-label="Navigasi Peninjauan Basic Price">
        <button
          type="button"
          className="bp-btn bp-btn--sm"
          onClick={() => navigate(`/basic-price/import/${batch.batchId}`)}
          title="Kembali ke data batch"
          aria-label="Kembali ke data batch"
        >
          <ArrowLeft size={14} /> Data Batch
        </button>
        <button
          type="button"
          className="bp-btn bp-btn--link"
          onClick={() => navigate('/basic-price')}
          title="Kembali ke daftar Basic Price"
        >
          Basic Price →
        </button>
      </div>

      <header className="bp-head">
        <div>
          <div className="bp-head__crumb">SIMPROK / Basic Price / Peninjauan</div>
          <h1 className="bp-head__title">Tinjau Daftar Harga</h1>
          <p className="bp-head__sub">
            {batchStatusLabel(batch.status)} — {formatBatchProgress(batch)}
          </p>
        </div>
      </header>

      <BasicPriceJourneyStepper batch={batch} />

      {/*
        INT-CONNECT-01 — attention, directed. Reported from the server's own
        tally and the rows already on this page; no count here is predicted and
        none is hard-coded. `reviewCounters` renders only fields the payload
        carries — see §15's "do not invent counts".
      */}
      <ul className="bp-counters" aria-label="Ringkasan kerja SIMPROK">
        {counters.map((counter) => (
          <li
            key={counter.key}
            className={`bp-counter ${counter.tone === 'ok' ? 'bp-counter--ok' : counter.tone === 'attention' ? 'bp-counter--attention' : ''}`}
          >
            <div className="bp-counter__value">{counter.value}</div>
            <div className="bp-counter__label">{counter.label}</div>
          </li>
        ))}
      </ul>

      <p className="bp-field__help" aria-label="Ringkasan kerja SIMPROK dalam kalimat">
        {formatMachineFirstSummary(batch)}
      </p>

      <p className="bp-note bp-note--info" aria-live="polite">
        {statusMessage}
      </p>

      {/*
        THE TWO ACTIONS, NAMED FOR WHAT THEY ACTUALLY DO.

        This section used to hold one button, `Ajukan Batch (N siap)`, and it
        was untrue twice over. It did not save anything — `/submit` creates
        PriceSubmissions for a curator to judge and no usable price at all — and
        it was the ONLY way out of this room, so a person who simply wanted
        their own imported prices had no action that gave them any.

        Now: SIMPAN & GUNAKAN is primary and incremental — the finished rows
        become usable prices immediately and the remaining ones stay workable.
        USULKAN KE SIMPROK is optional, incremental for eligible rows only, and
        separately labelled. Unresolved rows stay open and may be proposed later.
        It is offered only for the source families SIMPROK actually routes to
        community curation.

        NEITHER BUTTON DECIDES ITS OWN AVAILABILITY. `batch.actions` is the
        server's verdict, from the same law its writers enforce, and when an
        action is not offered the REASON is rendered as a sentence instead of
        being lost inside a boolean. `aria-disabled` accompanies `disabled` so a
        door that cannot be opened does not look open.

        THE CLASS NAME STAYS `simprok-rab-toolbar` DELIBERATELY.
        `basicPriceReviewPageLaw.test.ts` HS-12 anchors the disabled/aria-disabled
        parity guard to this exact selector, and that guard exists because a
        fully-coloured button once sat over a door that could not open. Renaming
        it would silently delete the guard rather than move it. Its Basic-Price
        appearance is re-stated from `.bp-room .simprok-rab-toolbar` in
        basicPrice.css, which touches nothing outside this room.
      */}
      <section className="simprok-rab-toolbar" aria-label="Aksi Batch">
        {/*
          THE COUNT IS WHAT ONE PRESS ACHIEVES, not what is already finished.

          It used to read `readyForSubmissionRows` alone, which on a fresh batch
          is zero — so the Owner saw `Simpan & Gunakan (0 siap)` beside thirteen
          rows SIMPROK had already proven, and the only way to make the number
          move was thirteen `Selesaikan` clicks.

          AND A ROW ALREADY STORED IS NOT NEW WORK. The first term is the
          server's `actionableRows` (ready MINUS already private), so when the
          work is done the count is genuinely zero — and when there is nothing
          left to press, the room says so in a sentence instead of leaving a
          greyed-out control nobody can explain.
        */}
        {alreadyStored ? (
          <p className="bp-note bp-note--ok">{alreadyStored}</p>
        ) : (
          <button
            className="bp-btn bp-btn--primary"
            onClick={() => void handleKeepPrivate()}
            disabled={!oneActionOffered || isBusy}
            aria-disabled={!oneActionOffered || isBusy}
            title="Terima baris yang sudah dikenali SIMPROK, lalu simpan semuanya sebagai harga milik ruang kerja ini"
          >
            Simpan &amp; Gunakan ({oneActionRowCount})
          </button>
        )}
        <p className="bp-bulk-action__help">
          Simpan sekaligus semua harga yang sudah dipastikan SIMPROK; lainnya dapat ditinjau nanti.
        </p>
        {/*
          BP-SHARED-PROPOSAL-01 — door EXISTS vs door OPENS.
          `proposalDoor` reads only server fields. Enablement stays bound to
          `simprokProposal.offered` (write would accept now). Visibility keeps
          the optional Usulkan control when FIELD_PRICE is merely not-ready yet,
          so "tidak dirutekan" is never used for a community-survey batch.
        */}
        {proposalDoor.visible ? (
          <button
            className="bp-btn"
            onClick={() => void handleSubmitBatch()}
            disabled={!proposalDoor.enabled || isBusy}
            aria-disabled={!proposalDoor.enabled || isBusy}
            title={
              proposalDoor.enabled
                ? 'Hanya baris yang sudah siap. Baris lain tetap terbuka dan dapat diusulkan kemudian.'
                : 'Usulkan baris yang sudah siap ke SIMPROK untuk diperiksa bersama'
            }
          >
            Usulkan juga ke SIMPROK
            {proposalDoor.enabled ? ` (${batch.readyForSubmissionRows})` : ''}
          </button>
        ) : null}
      </section>

      {/*
        WHY NOT, WHEN NOT — the half that was missing entirely. A reason is
        printed only when the matching action is unavailable, so a working room
        stays quiet.

        GATED ON THE SAME VERDICT AS THE BUTTON, which it was not. This read the
        RAW server flag while the control beside it read `oneAction.offered` —
        and those two deliberately differ, because the server counts only rows a
        human has already finished. On the Owner's own batch the page therefore
        rendered an ENABLED `Simpan & Gunakan (13 siap)` directly above
        `Simpan & Gunakan belum bisa: Belum ada baris yang selesai` — a denial of
        the very action the button was offering. One screen, one story.
      */}
      {!oneActionOffered && !alreadyStored && privateUseBlockSentence(batch.actions.privateUse.reasonCode) ? (
        <p className="bp-note bp-note--attention" role="status" aria-label="Alasan Simpan dan Gunakan belum tersedia">
          Simpan &amp; Gunakan belum bisa: {privateUseBlockSentence(batch.actions.privateUse.reasonCode)}
        </p>
      ) : null}
      {regionScopeNotice ? (
        <div className="bp-region-prerequisite" role="group" aria-label="Peninjauan wilayah sumber">
          <p className="bp-field__help">
            {regionScopeNotice.sourceLabel} · {regionScopeNotice.regionLabel}
          </p>
          <details className="bp-details">
            <summary>Mengapa?</summary>
            <p>{regionScopeNotice.why}</p>
          </details>
          <div className="bp-rowcard__actions">
            <button
              type="button"
              className="bp-btn"
              onClick={() => void handleConfirmRegionScope()}
              disabled={isBusy}
              aria-disabled={isBusy}
            >
              {regionScopeNotice.actionLabel}
            </button>
          </div>
        </div>
      ) : null}
      {proposalDoor.visible && !batch.actions.simprokProposal.offered &&
      proposalBlockSentence(batch.actions.simprokProposal.reasonCode) &&
      (oneActionOffered ||
        proposalBlockSentence(batch.actions.simprokProposal.reasonCode) !==
          privateUseBlockSentence(batch.actions.privateUse.reasonCode)) ? (
        <p className="bp-note" role="status" aria-label="Status usulan ke SIMPROK">
          {proposalBlockSentence(batch.actions.simprokProposal.reasonCode)}
        </p>
      ) : null}

      <div className="bp-review-controls" aria-label="Filter baris peninjauan">
        <div className="bp-review-filter" role="group" aria-label="Tampilkan baris">
          <button
            type="button"
            className="bp-review-filter__chip"
            aria-pressed={rowFilter === 'ALL'}
            onClick={() => selectRowFilter('ALL')}
          >
            Semua ({batch.rows.length})
          </button>
          <button
            type="button"
            className="bp-review-filter__chip"
            aria-pressed={rowFilter === 'RECOGNIZED'}
            onClick={() => selectRowFilter('RECOGNIZED')}
          >
            Dikenali ({recognizedRowCount})
          </button>
          <button
            type="button"
            className="bp-review-filter__chip"
            aria-pressed={rowFilter === 'NEEDS_REVIEW'}
            onClick={() => selectRowFilter('NEEDS_REVIEW')}
          >
            Perlu Tinjauan ({needsReviewRowCount})
          </button>
          {decidedRowCount > 0 ? (
            <button
              type="button"
              className="bp-review-filter__chip"
              aria-pressed={rowFilter === 'DECIDED'}
              onClick={() => selectRowFilter('DECIDED')}
            >
              Sudah Diputuskan ({decidedRowCount})
            </button>
          ) : null}
        </div>
        <span className="bp-review-controls__count">
          Menampilkan {visibleRows.length} dari {filteredRows.length} baris yang dimuat
        </span>
      </div>

      {safeNewRows.length > 0 ? (
        <details className="bp-review-bulk-new">
          <summary>
            Item baru terpilih ({safeNewRowIds.size}/{safeNewRows.length})
          </summary>
          <div className="bp-review-bulk-new__controls" aria-label="Penyelesaian item baru terpilih">
            <p>
              Baris ini baru layak diperiksa bersama. Penetapan tetap mengikuti jenis yang Anda konfirmasi. Maksimal {SAFE_NEW_SELECTION_LIMIT} pilihan per tindakan; sisanya dapat diproses berikutnya.
            </p>
            <select
              className="bp-input"
              aria-label="Jenis item untuk pilihan"
              value={safeNewResourceType}
              onChange={(event) => setSafeNewResourceType(event.target.value as ResourceType | '')}
              disabled={isBusy}
            >
              <option value="">Pilih jenis untuk baris terpilih</option>
              <option value="LABOR">Tenaga kerja</option>
              <option value="MATERIAL">Bahan</option>
              <option value="EQUIPMENT">Peralatan</option>
            </select>
            <button
              type="button"
              className="bp-btn bp-btn--primary bp-btn--sm"
              disabled={isBusy || safeNewRowIds.size === 0 || !safeNewResourceType}
              onClick={() => void handleAdmitSafeNew()}
            >
              Tetapkan sebagai Item Baru
            </button>
          </div>
        </details>
      ) : null}

      <div className="bp-stack">
        {visibleRows.map((row) => {
          const draft = draftFor(row.id);
          const mutable = isRowMutable(row);
          const proven = row.machineProposal?.identityPairProven === true;
          const expanded = expandedRows.has(row.id);
          const resourceProven = machinePickedResource(row) !== null;
          const unitProven = machinePickedUnit(row) !== null;
          const collisionLabel = collisionWarningLabel(row.collisionType);
          // EVERY human-visible sentence of the machine block, derived once from
          // structured facts. The page prints these and composes none of its
          // own, so what the pure test asserts is what the reviewer reads.
          const narrative = rowMachineNarrative(row);
          const notes = rowNoteLines(row);
          const noteDisclosure = rowNoteDisclosure(notes, row.machineProposal?.identityPairProven === true);
          const reviewQuestion = noteDisclosure.primary ?? collisionLabel;
          const blockReason = completionBlockReason(row, {
            resource: draft.resource !== null,
            unit: draft.unit !== null,
            busy: isBusy || draft.resourcePending || draft.unitPending,
          });
          const admissionOffered = rowIdentityAdmissionOffered(row);
          const sourceSpecUnverified = row.machineProposal?.blockingFacts.includes('SOURCE_SPECIFICATION_UNVERIFIED') ?? false;
          const refusalChoices = rowIdentityRefusalChoices(row);
          const admissionReview = row.machineProposal?.resource.admissionReview;
          const refusalsConfirmed = admissionReview
            ? draft.refusedCandidateIds.length ===
                admissionReview.humanRefusableCandidateIds.length &&
              admissionReview.humanRefusableCandidateIds.every((candidateId) =>
                draft.refusedCandidateIds.includes(candidateId),
              )
            : false;
          const sameNameCandidate = draft.admitOpen
            ? correctedCatalogNameCandidateConflict(
                row, draft.correctedCanonicalName ?? row.name, draft.admitResourceType,
              )
            : null;
          const unsupportedNameCorrection = draft.admitOpen &&
            draft.correctedCanonicalName !== null &&
            draft.correctedCanonicalName !== row.name &&
            batch?.reviewCapabilities?.correctedCanonicalNameOnAdmission !== true;
          const admitBlock = row.machineProposal?.blockingFacts.includes('SOURCE_SPECIFICATION_UNVERIFIED')
            ? 'Spesifikasi pada berkas belum diperiksa bersama identitas item. Penetapan item baru belum tersedia.'
            : sameNameCandidate
            ? correctedNameCandidateNotice(sameNameCandidate.name)
            : unsupportedNameCorrection
            ? 'Backend preview belum mendukung penyimpanan koreksi nama. Penetapan diblokir sampai versi backend diselaraskan.'
            : admissionOffered
            ? rowIdentityAdmissionBlockReason({
                unitSelected: draft.unit !== null,
                unitPending: draft.unitPending,
                reasonFilled: Boolean(draft.admitReason.trim()),
                admitOpen: draft.admitOpen,
                busy: isBusy,
                refusalsConfirmed,
                typeSelected: draft.admitResourceType !== null,
              })
            : null;
          return (
            <section
              key={row.id}
              className={`bp-rowcard ${
                admissionOffered ? 'bp-rowcard--new' : ROW_TONE_CLASS[rowTone(row)]
              }`}
              aria-label={`Baris ${row.sourceRowNumber}`}
            >
              <div className="bp-rowcard__head">
                <div className="bp-rowcard__identity">
                  {safeNewRows.some((candidate) => candidate.id === row.id) ? (
                    <input
                      type="checkbox"
                      aria-label={`Pilih baris ${row.sourceRowNumber} sebagai item baru`}
                      checked={safeNewRowIds.has(row.id)}
                      disabled={isBusy || (!safeNewRowIds.has(row.id) && safeNewRowIds.size >= SAFE_NEW_SELECTION_LIMIT)}
                      title={safeNewRowIds.size >= SAFE_NEW_SELECTION_LIMIT && !safeNewRowIds.has(row.id) ? `Batas ${SAFE_NEW_SELECTION_LIMIT} pilihan tercapai. Proses pilihan sekarang terlebih dahulu.` : undefined}
                      onChange={(event) => setSafeNewRowIds((current) => {
                        if (event.target.checked && current.size >= SAFE_NEW_SELECTION_LIMIT && !current.has(row.id)) return current;
                        const next = new Set(current);
                        if (event.target.checked) next.add(row.id);
                        else next.delete(row.id);
                        return next;
                      })}
                    />
                  ) : null}
                  <span className="bp-rowcard__num">#{row.sourceRowNumber}</span>
                  <strong className="bp-rowcard__name">{reviewDisplayResourceName(draft.correctedCanonicalName ?? row.name)}</strong>
                  <span
                    className={`bp-rowcard__status ${
                      admissionOffered
                        ? 'bp-rowcard__status--new'
                        : row.status === 'REJECTED'
                          ? 'bp-rowcard__status--rejected'
                          : reviewRowBucket(row) === 'DECIDED' || proven
                            ? 'bp-rowcard__status--proven'
                            : 'bp-rowcard__status--attention'
                    }`}
                    title={
                      !proven && !admissionOffered
                        ? noteDisclosure.primary ?? narrative?.resource
                        : undefined
                    }
                  >
                    {reviewRowBucket(row) === 'DECIDED'
                      ? rowStateLabel(row)
                      : proven
                        ? 'Dikenali otomatis'
                        : 'Perlu Tinjauan'}
                  </span>
                </div>
                <div className="bp-rowcard__summary-actions">
                  <span className="bp-rowcard__meta">{rowReviewFactsLine(row)}</span>
                  <button
                    type="button"
                    className="bp-btn bp-btn--sm bp-rowcard__review-button"
                    aria-expanded={expanded}
                    onClick={() => toggleExpandedRow(row.id)}
                  >
                    {expanded ? 'Tutup' : 'Tinjau'}
                  </button>
                </div>
                {rowNotice?.rowId === row.id ? (
                  <p className="bp-note bp-note--info bp-rowcard__notice" role="status" aria-live="polite">
                    {rowNotice.text}
                  </p>
                ) : null}
              </div>
              {expanded ? (
                <>
                  {reviewRowBucket(row) === 'NEEDS_REVIEW' && reviewQuestion ? (
                    <div className="bp-rowcard__question" role="note">
                      <strong>Apa yang perlu ditinjau?</strong>
                      <span>{reviewQuestion}</span>
                    </div>
                  ) : null}
                  <div className="bp-rowcard__column bp-rowcard__source">
                    <h3>Data Item</h3>
                    <div className="bp-rowcard__editable-line">
                      <p className="bp-rowcard__source-name">{row.name}</p>
                      {row.canonicalResourceName && row.canonicalResourceName !== row.name ? (
                        <p className="bp-rowcard__facts">Nama katalog tersimpan: <strong>{row.canonicalResourceName}</strong></p>
                      ) : null}
                      {!proven && mutable ? (
                        <button
                          type="button"
                          className="bp-rowcard__edit"
                          title="Edit nama yang menjadi acuan Pilih Padanan maupun Tetapkan Item Baru; nama Excel tetap utuh."
                          aria-label={draft.editingName
                              ? `Selesaikan koreksi nama baris ${row.sourceRowNumber}`
                              : `Edit padanan nama pada baris ${row.sourceRowNumber}`}
                          onClick={() => {
                            if (draft.editingName) {
                              const workingName = draft.correctedCanonicalName ?? row.name;
                              if (!workingName.trim() || workingName !== workingName.trim()) {
                                setStatusMessage('Nama koreksi tidak boleh kosong atau memiliki spasi awal/akhir.');
                                return;
                              }
                              setDrafts((current) => ({
                                ...current,
                                [row.id]: { ...(current[row.id] ?? emptyDraft), editingName: false },
                              }));
                              const notice = workingName === row.name
                                ? 'Tidak ada perubahan nama pada baris ' + row.sourceRowNumber + '.'
                                : 'Baris ' + row.sourceRowNumber + ': koreksi siap digunakan sebagai nama kerja. Ini masih draft, belum tersimpan permanen. Selesaikan pemilihan padanan atau penetapan item baru.';
                              setRowNotice({ rowId: row.id, text: notice });
                              setStatusMessage(notice);
                            } else {
                              updateDraft(row.id, { editingName: true });
                              setStatusMessage('Nama kerja yang diedit menjadi acuan kedua pilihan. Nama asli Excel tetap tersimpan. Perubahan baru berupa draft.');
                            }
                          }}
                        >
                          &#9998; {draft.editingName ? 'Selesai Edit' : 'Edit'}
                        </button>
                      ) : null}
                    </div>
                    {draft.editingName && mutable ? (
                      <label className="bp-field">
                        <span className="bp-field__label">Nama item untuk kedua pilihan</span>
                        <input
                          className="bp-input"
                          type="text"
                          maxLength={240}
                          value={draft.correctedCanonicalName ?? row.name}
                          onChange={(event) => changeWorkingName(row, event.target.value)}
                          aria-label={`Nama koreksi baris ${row.sourceRowNumber}`}
                        />
                        <span className="bp-field__help" role="status">Draft koreksi — belum tersimpan permanen. Tekan Selesai Edit untuk melanjutkan. Pencarian padanan dan penetapan item baru selalu memakai nama ini. Data asli Excel tetap utuh.</span>
                      </label>
                    ) : draft.correctedCanonicalName !== null && draft.correctedCanonicalName !== row.name ? (
                      <p className="bp-rowcard__facts" role="status">Nama kerja: <strong>{draft.correctedCanonicalName}</strong> — draft untuk pencarian; belum tersimpan permanen.</p>
                    ) : null}
                    <dl className="bp-rowcard__source-facts">
                      <div><dt>Satuan</dt><dd>{row.unit?.trim() || 'Tidak tercantum'}</dd></div>
                      <div><dt>Harga</dt><dd>{row.rawPriceDisplayText ? `Rp ${row.rawPriceDisplayText}` : 'Tidak tercantum'}</dd></div>
                    </dl>
                    {row.sourceSpecifications && row.sourceSpecifications.length > 0 ? (
                      <details className="bp-details">
                        <summary>{row.specificationDecision ? 'Spesifikasi dari berkas · sudah diperiksa' : 'Spesifikasi dari berkas · perlu diperiksa'}</summary>
                        <dl className="bp-rowcard__source-facts">
                          {row.sourceSpecifications.map((fact, i) => (
                            <div key={`${fact.label}-${i}`}><dt>{fact.label}</dt><dd>{fact.value ?? 'Format sumber belum dapat dibaca sebagai spesifikasi'}</dd></div>
                          ))}
                        </dl>
                        <p className="bp-field__help">{row.specificationDecision
                          ? 'Spesifikasi asli berkas sudah diperiksa dan keputusan tercatat. Ini bukan otomatis bukti bahwa dua item katalog identik; pencocokan identitas tetap dilakukan SIMPROK.'
                          : 'Ini informasi asli berkas, belum menjadi bukti identitas kanonis. Item dengan spesifikasi yang belum diperiksa tidak boleh disimpan sebagai identitas yang terbukti sama.'}</p>
                        {row.specificationDecision ? (
                          <p className="bp-field__help" role="status">Spesifikasi telah dikonfirmasi pada versi {row.specificationDecision.resultingVersion}. Keputusan tersimpan dalam riwayat; pemeriksaan identitas tetap dilakukan SIMPROK.</p>
                        ) : sourceSpecUnverified && mutable ? (
                          <button
                            type="button"
                            className="bp-btn bp-btn--primary bp-btn--sm"
                            disabled={isBusy || row.sourceSpecifications.some((fact) => !fact.value?.trim())}
                            onClick={() => void handleConfirmSourceSpecifications(row)}
                            title="Periksa nilai spesifikasi yang tertulis pada berkas lalu catat keputusan Anda. Ini bukan persetujuan katalog dan tidak menyimpan harga."
                          >
                            Saya sudah memeriksa — Konfirmasi spesifikasi berkas
                          </button>
                        ) : null}
                      </details>
                    ) : null}
                    {(mutable || row.specificationDecision) ? (
                      <BasicPriceSpecificationEditor
                        key={row.id + ':' + (row.specificationDecision?.resultingVersion ?? 'none')}
                        rowNumber={row.sourceRowNumber}
                        sourceSpecifications={row.sourceSpecifications}
                        specificationDecision={row.specificationDecision}
                        mutable={mutable}
                        disabled={isBusy}
                        onSave={(facts, kind, reason) => handleSaveManualSpecifications(row, facts, kind, reason)}
                      />
                    ) : null}
                  </div>

                  <div className="bp-rowcard__column bp-rowcard__kind-unit">
                    <h3>Jenis dan Satuan</h3>
                    <dl className="bp-rowcard__review-facts">
                      <div>
                        <dt>Jenis</dt>
                        <dd>
                          <span>{rowSectionDisplay(row)}</span>
                          {!proven && mutable ? (
                            <button
                              type="button"
                              className="bp-rowcard__edit"
                              title="Pemilih jenis ada di panel penyelesaian sebelah kanan. Keputusan tercatat setelah Konfirmasi Jenis."
                              aria-expanded={categoryEditRows.has(row.id)}
                              aria-controls={`bp-category-editor-${row.id}`}
                              onClick={() => {
                                const opening = !categoryEditRows.has(row.id);
                                setCategoryEditRows((current) => {
                                  const next = new Set(current);
                                  if (opening) next.add(row.id); else next.delete(row.id);
                                  return next;
                                });
                                const notice = opening
                                  ? 'Pemilih jenis ada di panel penyelesaian sebelah kanan. Pilih Tenaga kerja, Bahan, atau Peralatan lalu tekan Konfirmasi Jenis.'
                                  : 'Belum ada keputusan jenis baru yang disimpan.';
                                setRowNotice({ rowId: row.id, text: notice });
                                setStatusMessage(notice);
                              }}
                            >
                              &#9998; Ubah Jenis
                            </button>
                          ) : null}
                        </dd>
                      </div>
                      <div>
                        <dt>Satuan</dt>
                        <dd>
                          <span>{row.canonicalUnit
                            ? `${row.canonicalUnit.displayName} (${row.canonicalUnit.symbol})`
                            : row.resolutionStatus === 'RESOLVED' && row.status === 'READY_FOR_SUBMISSION'
                              ? 'Satuan standar tersimpan'
                              : draft.unit
                                ? `${draft.unit.displayName} (${draft.unit.symbol})`
                                : 'Belum dipilih'}</span>

                        </dd>
                      </div>
                    </dl>
                    {(noteDisclosure.secondary.length > 0 || notes.technicalNotice || narrative) ? (
                      <details className="bp-details bp-rowcard__proof">
                        <summary>{WHY_DISCLOSURE_TITLE}</summary>
                        {narrative ? <><p>{narrative.resource}</p><p>{narrative.unit}</p></> : null}
                        {noteDisclosure.secondary.map((note) => <p key={note}>{note}</p>)}
                        {notes.technicalNotice ? <p>{notes.technicalNotice}</p> : null}
                      </details>
                    ) : null}
                    {row.proposedCanonicalKdn ? <p className="bp-rowcard__facts">KDN: {row.proposedCanonicalKdn.replace('.', ',')}%</p> : null}
                    {optionalRowCanEnrichKdnNow(row) && row.privateBasicPriceId ? (
                      <details className="bp-details">
                        <summary>Informasi tambahan (tidak wajib)</summary>
                        <p className="bp-field__help">{OPTIONAL_ENRICHMENT_EMPTY}</p>
                        <ReviewOptionalKdnForm
                          priceId={row.privateBasicPriceId}
                          onSaved={() => {
                            setStatusMessage(`Baris ${row.sourceRowNumber}: informasi tambahan berhasil disimpan.`);
                            void loadBatch(false);
                          }}
                        />
                      </details>
                    ) : null}
                  </div>

                  <div className="bp-rowcard__actions bp-rowcard__resolution">
                    <h3>Pilih Penyelesaian</h3>
                    {/* Reuse the sole canonical category editor in the decision panel. */}
                    {mutable &&
                     (row.section === null || categoryEditRows.has(row.id) || (row.sectionProvenance === 'UPLOADER_DECLARED' && !row.reasonCodes.includes('ROW_CATEGORY_CONFIRMED_BY_REVIEWER'))) &&
                     (row.section === null || row.sectionProvenance === 'UPLOADER_DECLARED') &&
                     !row.sourceCategoryName?.trim() && !row.sourceCategoryCode?.trim() ? (
                      <div id={`bp-category-editor-${row.id}`} className="bp-note bp-note--info" aria-label={`Tentukan jenis baris ${row.sourceRowNumber}`}>
                        <label className="bp-field">
                          <span className="bp-field__label">Tentukan Jenis</span>
                          <select
                            className="bp-input"
                            value={categoryDrafts[row.id] ?? row.section ?? ''}
                            disabled={isBusy}
                            onChange={(event) => setCategoryDrafts((current) => ({ ...current, [row.id]: event.target.value as ResourceType | '' }))}
                            aria-label={`Jenis item pada baris ${row.sourceRowNumber}`}
                          >
                            <option value="">Pilih jenis item</option>
                            <option value="LABOR">Tenaga kerja</option>
                            <option value="MATERIAL">Bahan</option>
                            <option value="EQUIPMENT">Peralatan</option>
                          </select>
                        </label>
                        <p className="bp-field__help">Jenis ini akan digunakan untuk mencari padanan yang tepat. Nama, satuan, dan harga asli Excel tetap disimpan.</p>
                        <button
                          type="button"
                          className="bp-btn bp-btn--primary bp-btn--sm"
                          disabled={isBusy || !(categoryDrafts[row.id] ?? row.section)}
                          onClick={() => void handleConfirmCategory(row)}
                        >Konfirmasi Jenis</button>
                      </div>
                    ) : null}
                    {mutable && !proven &&
                      (row.section === null || (row.sectionProvenance === 'UPLOADER_DECLARED' && !row.reasonCodes.includes('ROW_CATEGORY_CONFIRMED_BY_REVIEWER'))) &&
                      !row.sourceCategoryName?.trim() && !row.sourceCategoryCode?.trim() ? (
                        <p className="bp-field__help" role="status">
                          Langkah berikutnya ada di atas: tekan <strong>Konfirmasi Jenis</strong>. Pilihan Bahan yang sama dengan Excel tetap dihitung sebagai keputusan Anda dan tercatat.
                        </p>
                      ) : null}
                        {!admissionOffered && admissionReview?.reasonCode && admissionUnavailableReason(admissionReview.reasonCode) ? (
                          <div className="bp-field__help">
                            <p role="status">{row.machineProposal?.blockingFacts.includes('SOURCE_SPECIFICATION_UNVERIFIED')
                              ? 'Spesifikasi dari berkas belum diperiksa. Item ini belum bisa disimpan atau dinyatakan identik.'
                              : admissionReview.reasonCode === 'IDENTITY_CANDIDATE_BLOCKED'
                              ? 'Item Baru BELUM dapat disimpan: SIMPROK menemukan calon padanan yang belum terbukti berbeda. Periksa daftar kandidat di bawah sebelum menetapkan identitas baru.'
                              : 'Item baru belum tersedia: ' + admissionUnavailableReason(admissionReview.reasonCode)}</p>
                            {admissionReview.reasonCode === 'IDENTITY_CANDIDATE_BLOCKED' ? (
                              <details className="bp-details">
                                <summary>Bandingkan kandidat dan bukti identitas</summary>
                                {row.machineProposal?.resource.candidates.some((candidate) => candidate.admissionDisposition === 'BLOCKED') ? (
                                  <>
                                    <ul>
                                    {row.machineProposal.resource.candidates
                                      .filter((candidate) => candidate.admissionDisposition === 'BLOCKED')
                                      .map((candidate, index) => (
                                        <li key={index}>
                                          <strong>{candidate.name}</strong>
                                          {candidate.code ? ' (' + candidate.code + ')' : ''}
                                          {' — ' + candidateResourceTypeLabel(candidate.type) + ' · satuan ' + candidate.baseUnit}
                                          {candidate.specificationUnproved && candidate.unprovedSpecificationFacts.length > 0
                                            ? ' — bukti yang masih diperlukan: ' + candidate.unprovedSpecificationFacts.join(', ')
                                            : ''}
                                        </li>
                                      ))}
                                    </ul>
                                  </>
                                ) : <p>Daftar item yang mungkin sama belum dapat ditampilkan. Item baru belum dapat dibuat sebelum pemeriksaan.</p>}
                                <p>Jika sesuai, gunakan <strong>Pilih Item yang Sesuai Padanan</strong> dan pilih satuan. Jika berbeda, jangan pilih padanan yang salah; perbedaan spesifikasi masih memerlukan bukti.</p>
                                <p>Hasil pencarian kosong belum membuktikan bahwa item ini baru. Nama kerja bukan bukti spesifikasi; memuat ulang halaman saja tidak membuktikan perbedaan tersebut.</p>
                                <p>Item privat tidak memerlukan persetujuan katalog resmi SIMPROK.</p>
                                {!(row.sectionProvenance === 'SOURCE_ROW_CATEGORY' ||
                                    row.sectionProvenance === 'SOURCE_SECTION_TITLE' ||
                                    row.reasonCodes.includes('ROW_CATEGORY_CONFIRMED_BY_REVIEWER')) ? (
                                  <p role="status">Konfirmasi Jenis pada panel penyelesaian ini sebelum memutuskan padanan atau item baru.</p>
                                ) : null}
                              </details>
                            ) : null}
                          </div>
                        ) : null}
                    {identityReviewStatuses?.[row.id] && identityReviewStatuses[row.id].status !== 'NOT_REQUESTED' ? (
                      <details className="bp-details" aria-label={`Riwayat identitas baris ${row.sourceRowNumber}`}>
                        <summary>Riwayat keputusan identitas</summary>
                        {identityReviewStatuses[row.id].status === 'OBSERVED' ? (
                          <p>Riwayat: pemeriksaan identitas pernah diminta dan belum diputuskan. Persetujuan pihak lain bukan syarat pemakaian item privat.</p>
                        ) : identityReviewStatuses[row.id].status === 'RESOLVED_EXISTING' || identityReviewStatuses[row.id].status === 'ADMITTED_NEW' ? (
                          <p>Riwayat: identitas pernah diputuskan. Harga tidak otomatis disimpan.
                            {identityReviewStatuses[row.id].resource
                              ? <> Item: <strong>{identityReviewStatuses[row.id].resource?.name}</strong>. Pilih item dan satuan yang sesuai untuk melanjutkan.</>
                              : <> Item keputusan tidak tersedia untuk dipilih di workspace ini. Jangan membuat identitas duplikat.</>}
                          </p>
                        ) : <p>Riwayat: pemeriksaan identitas sebelumnya ditutup tanpa penetapan item.</p>}
                      </details>
                    ) : null}
                    {proven ? (
                      <p className="bp-field__help">Dikenali otomatis. Gunakan Simpan &amp; Gunakan di atas untuk menyimpan baris ini bersama baris pasti lainnya.</p>
                    ) : row.status === 'REJECTED' ? (
                      <p className="bp-field__help">{noteDisclosure.primary ?? 'Baris ini telah ditolak.'}</p>
                    ) : mutable ? (
                      <>
                        {sourceSpecUnverified ? (
                          <p className="bp-field__help" role="status">Spesifikasi pada berkas belum diperiksa sebagai bukti identitas. Pilihan item belum tersedia agar SIMPROK tidak menyamakan atau membuat barang yang salah. Data sumber tetap tersimpan; Anda dapat meninjau nanti.</p>
                        ) : null}
                        {!sourceSpecUnverified && resourceProven && !unitProven ? (
                          <button type="button" className="bp-btn bp-rowcard__choice" title="Pilih satuan standar untuk item yang sudah dikenali." aria-expanded={lookupRows.has(row.id)} onClick={() => { updateDraft(row.id, { admitOpen: false }); setLookupRows((current) => new Set(current).add(row.id)); }} disabled={isBusy}>
                            Pilih Satuan
                          </button>
                        ) : !sourceSpecUnverified && !resourceProven ? (
                          <button
                            type="button"
                            className="bp-btn bp-rowcard__choice"
                            title="Cari item yang sudah tersedia di SIMPROK. Gunakan hanya jika benar-benar sesuai."
                            aria-expanded={lookupRows.has(row.id)}
                            onClick={() => {
                              updateDraft(row.id, { admitOpen: false });
                              setLookupRows((current) => new Set(current).add(row.id));
                            }}
                            disabled={isBusy}
                          >
                            Pilih Item yang Sesuai Padanan
                          </button>
                        ) : null}
                        {!sourceSpecUnverified && lookupRows.has(row.id) && mutable && !proven ? (
                          <div id={`bp-lookup-${row.id}`} tabIndex={-1} className="bp-rowcard__lookup bp-rowcard__lookup--contextual" aria-label="Cari dan pilih item atau satuan">
                            <strong className="bp-rowcard__lookup-heading">{resourceProven ? "Pilih satuan yang sesuai" : "Cari item yang sudah ada di SIMPROK"}</strong>
                            {!resourceProven ? (
                              <CatalogSearchSelect
                                mode="resource"
                                key={`${row.id}:${draft.correctedCanonicalName ?? row.name}`}
                                initialQuery={(draft.correctedCanonicalName ?? row.name).trim().replace(/^-\s+/, '')}
                                initialResourceType={reviewResourceSearchFamily(row)}
                                selected={draft.resource}
                                disabled={isBusy}
                                onSelect={(item) => updateDraft(row.id, { resource: item as ResourceLookupItem | null })}
                                onPendingChange={(resourcePending) => updateDraft(row.id, { resourcePending })}
                              />
                            ) : null}
                            {!resourceProven && !draft.resource ? (
                              <p className="bp-field__help">
                                Teks dalam kotak hanya kata pencarian, belum menjadi pilihan. Klik item yang sesuai di daftar hasil. Jika tidak ada, jangan gunakan padanan yang salah; periksa jalur item baru.
                              </p>
                            ) : null}
                            <CatalogSearchSelect
                              mode="unit"
                              selected={draft.unit}
                              disabled={isBusy}
                              onSelect={(item) => {
                                updateDraft(row.id, { unit: item as UnitLookupItem | null });
                                setRowNotice({ rowId: row.id, text: 'Pilihan satuan masih draft. Tekan Gunakan Pilihan atau Gunakan Satuan setelah persyaratan item terpenuhi untuk menyimpannya.' });
                              }}
                              onPendingChange={(unitPending) => updateDraft(row.id, { unitPending })}
                            />
                            <button
                              type="button"
                              className="bp-btn bp-btn--primary bp-btn--sm"
                              onClick={() => void handleResolve(row)}
                              disabled={blockReason !== null}
                              aria-disabled={blockReason !== null}
                              title={blockReason ?? 'Gunakan Item SIMPROK dan Satuan yang dipilih'}
                            >
                              {resourceProven ? 'Gunakan Satuan' : 'Gunakan Pilihan'}
                            </button>
                            {blockReason && !isBusy ? (
                              <p className="bp-field__help" role="status">
                                Belum bisa disimpan: {blockReason}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                        {admissionOffered && admissionReview ? (
                          <>
                            <button
                              type="button"
                              className="bp-btn bp-rowcard__choice"
                              title="Tetapkan sebagai item privat baru apabila identitas dan satuannya telah diperiksa."
                              aria-expanded={draft.admitOpen}
                              onClick={() => {
                                setLookupRows((current) => {
                                  const next = new Set(current);
                                  next.delete(row.id);
                                  return next;
                                });
                                updateDraft(row.id, {
                                admitOpen: true,
                                admitResourceType: admissionReview.typeConfirmations.length === 1
                                  ? admissionReview.typeConfirmations[0].resourceType
                                  : draft.admitResourceType,
                                });
                              }}
                              disabled={isBusy}
                            >
                              {IDENTITY_ADMISSION_LABEL}
                            </button>
                            {draft.admitOpen ? (
                              <div className="bp-rowcard__admission">
                                <div className="bp-field">
                                  <span className="bp-field__label">Nama item yang akan disimpan</span>
                                  <strong>{draft.correctedCanonicalName ?? row.name}</strong>
                                  <span className="bp-field__help">Gunakan Edit pada Data Item untuk mengubah nama ini. Kedua pilihan mengacu pada satu nama kerja; teks Excel tetap utuh.</span>
                                  {batch?.reviewCapabilities?.correctedCanonicalNameOnAdmission !== true ? (
                                    <span className="bp-field__help" role="status">Server preview belum mendukung penyimpanan koreksi nama; penetapan dengan nama koreksi diblokir.</span>
                                  ) : null}
                                  {sameNameCandidate ? (
                                    <span className="bp-field__help" role="status">{correctedNameCandidateNotice(sameNameCandidate.name)}</span>
                                  ) : null}
                                </div>
                                {admissionReview.typeConfirmations.length > 1 ? (
                                  <label className="bp-field">
                                    <span className="bp-field__label">Jenis efektif</span>
                                    <select className="bp-input" value={draft.admitResourceType ?? ''} onChange={(event) => updateDraft(row.id, { admitResourceType: (event.target.value as ResourceType) || null })}>
                                      <option value="">Pilih jenis</option>
                                      {admissionReview.typeConfirmations.map((option) => (
                                        <option key={option.resourceType} value={option.resourceType}>
                                          {option.resourceType === 'LABOR' ? 'Tenaga kerja' : option.resourceType === 'MATERIAL' ? 'Bahan' : 'Peralatan'}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ) : null}
                                <div className="bp-field">
                                   <p className="bp-field__help">Pilih satuan yang benar untuk harga ini. Satuan Excel tetap tercatat sebagai sumber; jika salah baca atau salah tulis, pilihan Anda harus diperiksa sebelum disimpan.</p>
                                   <CatalogSearchSelect
                                     mode="unit"
                                     selected={draft.unit}
                                     disabled={isBusy}
                                     onSelect={(item) => updateDraft(row.id, { unit: item as UnitLookupItem | null })}
                                     onPendingChange={(unitPending) => updateDraft(row.id, { unitPending })}
                                   />
                                 </div>
                                {refusalChoices.map((choice) => (
                                  <label className="bp-field__help" key={choice.key}>
                                    <input
                                      type="checkbox"
                                      checked={draft.refusedCandidateIds.includes(choice.key)}
                                      onChange={(event) => updateDraft(row.id, {
                                        refusedCandidateIds: event.target.checked
                                          ? [...draft.refusedCandidateIds, choice.key]
                                          : draft.refusedCandidateIds.filter((id) => id !== choice.key),
                                      })}
                                    />{' '}
                                    Saya sudah memeriksa dan menolak {choice.name}{choice.code ? ` (${choice.code})` : ''} sebagai item yang sama.
                                  </label>
                                ))}
                                <label className="bp-field">
                                  <span className="bp-field__label">Alasan menetapkan item baru</span>
                                  <input className="bp-input" type="text" placeholder="Tuliskan alasan berdasarkan hasil pemeriksaan" value={draft.admitReason} onChange={(event) => updateDraft(row.id, { admitReason: event.target.value })} />
                                  <span className="bp-field__help">Jika ada kandidat, catat perbedaan nyata seperti ukuran atau spesifikasi.</span>
                                </label>
                                <button type="button" className="bp-btn bp-btn--primary" onClick={() => void handleAdmit(row)} disabled={admitBlock !== null} aria-disabled={admitBlock !== null} title={admitBlock ?? IDENTITY_ADMISSION_LABEL}>
                                  Tetapkan Item Baru
                                </button>
                                {admitBlock ? <p className="bp-field__help" role="status">{admitBlock}</p> : null}
                              </div>
                            ) : null}
                          </>
                        ) : null}
                        {draft.rejectOpen ? (
                          <label className="bp-field">
                            <span className="bp-field__label">Alasan tolak</span>
                            <input className="bp-input" type="text" placeholder="Mengapa baris ini ditolak?" value={draft.reason} onChange={(event) => updateDraft(row.id, { reason: event.target.value })} />
                          </label>
                        ) : null}
                        <button type="button" className="bp-btn bp-btn--danger-quiet" onClick={() => void handleReject(row)} disabled={isBusy} aria-disabled={isBusy}>Tolak</button>
                      </>
                    ) : <p className="bp-field__help">{rowStateLabel(row)}</p>}
                    <button type="button" className="bp-btn bp-btn--link bp-btn--sm" onClick={() => toggleExpandedRow(row.id)}>Tinjau nanti</button>
                  </div>
                </>
              ) : null}
            </section>
          );
        })}
      </div>
      {visibleRows.length < filteredRows.length ? (
        <div className="bp-review-more">
          <button
            type="button"
            className="bp-btn"
            onClick={() => setVisibleRowLimit((current) => current + REVIEW_ROW_PAGE_SIZE)}
          >
            Tampilkan berikutnya
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ReviewOptionalKdnForm({
  priceId,
  onSaved,
}: {
  priceId: string;
  onSaved: () => void;
}) {
  const [kdnPercent, setKdnPercent] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const handleSave = async () => {
    setBusy(true);
    setRefusal(null);
    try {
      await enrichBasicPriceKdn(
        priceId,
        kdnPercent,
        'Pelengkapan %KDN opsional',
        null,
      );
      onSaved();
    } catch (error) {
      if (error instanceof ImportRequestError) {
        setRefusal(
          error.httpStatus === 409
            ? 'KDN yang sudah tercatat tidak ditimpa diam-diam.'
            : 'Pelengkapan KDN belum berhasil. Coba lagi.',
        );
      } else {
        setRefusal('Pelengkapan KDN belum berhasil. Coba lagi.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bp-field">
      <label className="bp-field__label" htmlFor={`bp-optional-kdn-${priceId}`}>
        %KDN (opsional)
      </label>
      <input
        id={`bp-optional-kdn-${priceId}`}
        className="bp-input"
        type="text"
        inputMode="decimal"
        value={kdnPercent}
        onChange={(event) => setKdnPercent(event.target.value)}
      />
      <button
        type="button"
        className="bp-btn bp-btn--sm"
        disabled={busy}
        aria-disabled={busy}
        onClick={() => void handleSave()}
      >
        Simpan
      </button>
      {refusal ? (
        <p className="bp-field__help" role="status">
          {refusal}
        </p>
      ) : null}
    </div>
  );
}
