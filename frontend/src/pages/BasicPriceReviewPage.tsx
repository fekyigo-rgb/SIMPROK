import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import {
  smartSaveBatch,
  getBasicPriceImportBatch,
  updateBasicPriceImportBatch,
  rejectBasicPriceImportRow,
  resolveBasicPriceImportRow,
  confirmBasicPriceImportRowCategory,
  getBasicPriceIdentityReviews,
  requestBasicPriceIdentityReview,
  admitResourceForImportRow,
  admitSafeNewBasicPriceResources,
  submitBasicPriceImportBatch,
  enrichBasicPriceKdn,
  ImportRequestError,
} from '../api/basicPriceImport';
import type { BasicPriceIdentityReviewRow } from '../api/basicPriceImport';
import type {
  ResourceLookupItem,
  ResourceType,
  UnitLookupItem,
} from '../api/basicPriceImport';
import { CatalogSearchSelect } from '../components/basic-price/CatalogSearchSelect';
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
  rowStateLabel,
  reviewRowBucket,
  staleRowRecoveryMessage,
  WHY_DISCLOSURE_TITLE,
  type BasicPriceImportBatchSummary,
  type BasicPriceImportRowSummary,
} from '../utils/basicPriceImportDisplay';
import { importRequestMessage } from '../utils/basicPriceIntakeErrors';
import '../styles/basicPrice.css';

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
      return 'Masih ada kandidat identitas yang wajib diperiksa sebelum item baru dapat disimpan.';
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
  const [identityReviewStatuses, setIdentityReviewStatuses] = useState<Record<string, BasicPriceIdentityReviewRow> | null>(null);
  /** A unit edit scrolls/focuses the canonical picker in the 65% decision panel. */
  const pendingUnitFocusRow = useRef<string | null>(null);
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
  const loadBatch = async (announceProgress = true): Promise<boolean> => {
    if (!batchId) return false;
    try {
      const result = await getBasicPriceImportBatch(batchId);
      setBatch(result);
      // The ONE shared curation lifecycle is read in a batch-scoped request,
      // not once per item, and cannot be confused with a catalog admission.
      let identityReviewReadNotice: string | null = null;
      try {
        const identityReviews = await getBasicPriceIdentityReviews(batchId);
        setIdentityReviewStatuses(identityReviews.rows);
      } catch (error) {
        // UNKNOWN is not 'no request'. An authorization failure is not empty
        // work either, so preserve the real refusal instead of silently hiding.
        setIdentityReviewStatuses(null);
        identityReviewReadNotice = error instanceof ImportRequestError
          ? importRequestMessage(error.httpStatus)
          : 'Status pemeriksaan identitas belum dapat dibaca. Coba muat ulang.';
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
      if (announceProgress) setStatusMessage(identityReviewReadNotice ? `${formatBatchProgress(result)} ${identityReviewReadNotice}` : formatBatchProgress(result));
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

  // Keep the Owner-locked 35:65 layout: Edit Satuan focuses the existing
  // picker on the decision side rather than duplicating a catalog picker
  // beneath the left-hand source facts.
  useEffect(() => {
    const rowId = pendingUnitFocusRow.current;
    if (!rowId) return;
    const target = document.getElementById(`bp-lookup-${rowId}`);
    if (!target) return;
    pendingUnitFocusRow.current = null;
    target.focus();
    target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [lookupRows]);

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
        pendingUnitFocusRow.current = null;
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

  /** An explicit review request, not an approval or a new ResourceCatalog. */
  const handleRequestIdentityReview = async (row: BasicPriceImportRowSummary) => {
    if (!batchId) return;
    setIsBusy(true);
    try {
      const result = await requestBasicPriceIdentityReview(batchId, row.id, row.version);
      setIdentityReviewStatuses((current) => ({
        ...(current ?? {}), [row.id]: { status: result.status, resource: null },
      }));
      const notice = result.status === 'OBSERVED'
        ? 'Permintaan pemeriksaan identitas sudah tercatat. Pengelola yang berwenang akan memeriksa kandidat. Item baru belum disimpan.'
        : 'Pemeriksaan identitas telah memiliki keputusan. Muat ulang peninjauan untuk melihat pilihan yang tersedia.';
      setRowNotice({ rowId: row.id, text: notice });
      setStatusMessage(notice);
    } catch (error) {
      const notice = error instanceof ImportRequestError && error.httpStatus === 409
        ? 'Permintaan belum dapat dikirim. Jenis atau bukti kandidat telah berubah; periksa kembali baris ini lalu coba lagi.'
        : error instanceof ImportRequestError
          ? importRequestMessage(error.httpStatus)
          : 'Belum berhasil mengirim permintaan pemeriksaan. Tidak ada keputusan item baru yang dibuat.';
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
          const admitBlock = sameNameCandidate
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
              </div>
              {rowNotice?.rowId === row.id ? (
                <p className="bp-note bp-note--info" role="status" aria-live="polite">
                  {rowNotice.text}
                </p>
              ) : null}
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
                              title="Ubah kategori awal impor untuk baris ini. Keputusan baru disimpan setelah Konfirmasi Jenis berhasil."
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
                                  ? 'Pilihan jenis dibuka pada baris ini. Pilih Tenaga kerja, Bahan, atau Peralatan lalu tekan Konfirmasi Jenis. Data asli Excel tidak berubah.'
                                  : 'Pemilih jenis ditutup. Tidak ada keputusan kategori baru yang disimpan.';
                                setRowNotice({ rowId: row.id, text: notice });
                                setStatusMessage(notice);
                              }}
                            >
                              &#9998; {categoryEditRows.has(row.id) ? 'Tutup Pilihan Jenis' : 'Ubah Jenis'}
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
                          {!proven && mutable ? (
                            <button
                              type="button"
                              className="bp-rowcard__edit"
                              title="Buka dan fokuskan pemilih satuan standar di panel Pilih Penyelesaian."
                              aria-expanded={lookupRows.has(row.id)}
                              aria-controls={`bp-lookup-${row.id}`}
                              onClick={() => {
                                pendingUnitFocusRow.current = row.id;
                                setDrafts((current) => ({
                                  ...current,
                                  [row.id]: { ...(current[row.id] ?? emptyDraft), admitOpen: false },
                                }));
                                setLookupRows((current) => new Set(current).add(row.id));
                                const notice = 'Pemilih satuan tersedia pada panel Pilih Penyelesaian di sebelah kanan. Pilihan baru masih draft; tekan Gunakan Pilihan atau Gunakan Satuan setelah itemnya sesuai.';
                                setRowNotice({ rowId: row.id, text: notice });
                                setStatusMessage(notice);
                              }}
                            >
                              &#9998; Pilih/Ubah Satuan
                            </button>
                          ) : null}
                        </dd>
                      </div>
                    </dl>
                    {mutable &&
                     (row.section === null || categoryEditRows.has(row.id)) &&
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
                    {identityReviewStatuses?.[row.id] &&
                     identityReviewStatuses[row.id].status !== 'NOT_REQUESTED' &&
                     admissionReview?.reasonCode !== 'IDENTITY_CANDIDATE_BLOCKED' ? (
                      <div className="bp-note bp-note--info" role="status" aria-label={`Hasil pemeriksaan identitas baris ${row.sourceRowNumber}`}>
                        {identityReviewStatuses[row.id].status === 'OBSERVED'
                          ? <p>Permintaan pemeriksaan identitas sedang menunggu keputusan pengelola. Item baru belum disimpan.</p>
                          : identityReviewStatuses[row.id].status === 'RESOLVED_EXISTING' ||
                            identityReviewStatuses[row.id].status === 'ADMITTED_NEW'
                            ? <p>Identitas telah diputuskan pengelola.
                              {identityReviewStatuses[row.id].resource
                                ? <> Item katalog: <strong>{identityReviewStatuses[row.id].resource?.name}</strong>. Pilih item dan satuannya pada panel ini, lalu simpan melalui keputusan yang tersedia.</>
                                : <> Item keputusan belum tersedia sebagai katalog aktif yang dapat diakses. Minta pengelola menuntaskan aksesnya.</>}
                            </p>
                            : <p>Permintaan pemeriksaan telah ditutup. Periksa data sumber sebelum melanjutkan.</p>}
                      </div>
                    ) : null}
                    {proven ? (
                      <p className="bp-field__help">Dikenali otomatis. Gunakan Simpan &amp; Gunakan di atas untuk menyimpan baris ini bersama baris pasti lainnya.</p>
                    ) : row.status === 'REJECTED' ? (
                      <p className="bp-field__help">{noteDisclosure.primary ?? 'Baris ini telah ditolak.'}</p>
                    ) : mutable ? (
                      <>
                        {resourceProven && !unitProven ? (
                          <button type="button" className="bp-btn bp-rowcard__choice" title="Pilih satuan standar untuk item yang sudah dikenali." aria-expanded={lookupRows.has(row.id)} onClick={() => { updateDraft(row.id, { admitOpen: false }); setLookupRows((current) => new Set(current).add(row.id)); }} disabled={isBusy}>
                            Pilih Satuan
                          </button>
                        ) : !resourceProven ? (
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
                        {lookupRows.has(row.id) && mutable && !proven ? (
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
                                {!draft.unit ? <button type="button" className="bp-btn bp-btn--sm" onClick={() => { updateDraft(row.id, { admitOpen: false }); setLookupRows((current) => new Set(current).add(row.id)); }}>Pilih satuan</button> : null}
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
                        {!admissionOffered && admissionReview?.reasonCode && admissionUnavailableReason(admissionReview.reasonCode) ? (
                          <div className="bp-field__help" role="status">
                            <p>Item baru belum tersedia: {admissionUnavailableReason(admissionReview.reasonCode)}</p>
                            {admissionReview.reasonCode === 'IDENTITY_CANDIDATE_BLOCKED' ? (
                              <details className="bp-details">
                                <summary>Periksa kandidat yang menghalangi item baru</summary>
                                {row.machineProposal?.resource.candidates.some((candidate) => candidate.admissionDisposition === 'BLOCKED') ? (
                                  <ul>
                                    {row.machineProposal.resource.candidates
                                      .filter((candidate) => candidate.admissionDisposition === 'BLOCKED')
                                      .map((candidate, index) => (
                                        <li key={index}>
                                          <strong>{candidate.name}</strong>
                                          {candidate.code ? ' (' + candidate.code + ')' : ''}
                                          {' — '}kandidat ini belum boleh ditolak dari halaman ini.
                                        </li>
                                      ))}
                                  </ul>
                                ) : <p>Rincian kandidat belum tersedia pada respons ini; keputusan membuat item baru tetap ditahan.</p>}
                                <p>Jika benar item yang sama, pilih padanan yang tersedia. Jika berbeda, minta pengelola katalog memeriksa identitas dan kewenangannya melalui tombol di bawah. Pencarian manual yang kosong tidak menghapus bukti kandidat dari SIMPROK.</p>
                                {!(row.sectionProvenance === 'SOURCE_ROW_CATEGORY' ||
                                    row.sectionProvenance === 'SOURCE_SECTION_TITLE' ||
                                    row.reasonCodes.includes('ROW_CATEGORY_CONFIRMED_BY_REVIEWER')) ? (
                                  <p role="status">Pastikan jenis item terlebih dahulu melalui <strong>Ubah Jenis</strong> di sebelah kiri dan <strong>Konfirmasi Jenis</strong>. Kategori awal berkas belum cukup untuk mengirim pemeriksaan identitas.</p>
                                ) : identityReviewStatuses?.[row.id]?.status === 'OBSERVED' ? (
                                  <p role="status">Permintaan sudah tercatat dan menunggu keputusan pengelola. Belum ada item baru yang disimpan.</p>
                                ) : identityReviewStatuses?.[row.id]?.status === 'RESOLVED_EXISTING' ||
                                    identityReviewStatuses?.[row.id]?.status === 'ADMITTED_NEW' ? (
                                  <div role="status">
                                    <p>Pengelola telah memutuskan identitas; keputusan tersebut tidak otomatis menyimpan harga.</p>
                                    {identityReviewStatuses?.[row.id]?.resource ? (
                                      <p>Item yang diputuskan: <strong>{identityReviewStatuses[row.id].resource?.name}</strong>. Buka Pilih Item yang Sesuai Padanan, pilih item tersebut dan satuan yang tepat, lalu simpan melalui tombol yang sudah ada.</p>
                                    ) : (
                                      <p>Item keputusan belum tersedia sebagai katalog aktif dalam ruang kerja ini. Minta pengelola memastikan akses atau keputusan katalog, bukan membuat item duplikat.</p>
                                    )}
                                  </div>
                                ) : identityReviewStatuses?.[row.id]?.status === 'DISMISSED' ? (
                                  <p role="status">Pengelola menutup pemeriksaan ini. Periksa kembali data item dan sumbernya sebelum mengajukan keputusan berikutnya.</p>
                                ) : (
                                  <>
                                    {identityReviewStatuses === null ? (
                                      <p role="status">Status pemeriksaan sebelumnya belum dapat dibaca. Permintaan yang sama tidak akan menggandakan pemeriksaan.</p>
                                    ) : null}
                                    <button
                                      type="button"
                                      className="bp-btn bp-btn--primary bp-btn--sm"
                                      disabled={isBusy}
                                      onClick={() => void handleRequestIdentityReview(row)}
                                    >Minta Pemeriksaan Identitas</button>
                                    <p>Pengelola akan memeriksa apakah item ini sama dengan katalog atau benar-benar baru. Anda tetap dapat meninjau baris lain.</p>
                                  </>
                                )}
                              </details>
                            ) : null}
                          </div>
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
