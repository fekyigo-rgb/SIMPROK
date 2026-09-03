import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import {
  smartSaveBatch,
  getBasicPriceImportBatch,
  rejectBasicPriceImportRow,
  resolveBasicPriceImportRow,
  submitBasicPriceImportBatch,
  ImportRequestError,
} from '../api/basicPriceImport';
import type { ResourceLookupItem, UnitLookupItem } from '../api/basicPriceImport';
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
  privateUseBlockSentence,
  proposalDoorView,
  proposalBlockSentence,
  rowActionFailureMessage,
  rowMachineNarrative,
  rowNoteDisclosure,
  rowNoteLines,
  rowReviewFactsLine,
  rowSectionDisplay,
  rowStateLabel,
  staleRowRecoveryMessage,
  WHY_DISCLOSURE_TITLE,
  type BasicPriceImportBatchSummary,
  type BasicPriceImportRowSummary,
} from '../utils/basicPriceImportDisplay';
// The one place this app already settled on for programmer vocabulary. Reused
// rather than re-spelled, so both rooms hide technical text under one title.
import { TECHNICAL_DETAIL_TITLE } from '../utils/rabTraceDisplay';
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
}

const emptyDraft: RowDraft = {
  resource: null,
  unit: null,
  resourcePending: false,
  unitPending: false,
  reason: '',
  rejectOpen: false,
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
const rowFailure = (action: 'RESOLVE' | 'REJECT', sourceRowNumber: number, error: unknown) =>
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
  const [statusMessage, setStatusMessage] = useState('Memuat batch...');
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
      if (announceProgress) setStatusMessage(formatBatchProgress(result));
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

  /**
   * Rows the batch action must LEAVE ALONE.
   *
   * A reviewer who is mid-correction on a row SIMPROK happens to have proven
   * must not have their unsaved edit overwritten by the machine's earlier
   * proposal. This is intent about SCOPE — "not that one" — and never an
   * identity claim, so it is the one thing this page may state.
   */
  const editedRowIds = (): string[] => [...touchedRowIds];

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
    action: 'RESOLVE' | 'REJECT',
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
    return staleRowRecoveryMessage(row.sourceRowNumber);
  };

  const handleResolve = async (row: BasicPriceImportRowSummary) => {
    if (!batchId) return;
    const draft = draftFor(row.id);
    if (!draft.resource || !draft.unit || draft.resourcePending || draft.unitPending) {
      setStatusMessage('Pilih satu Item SIMPROK dan satu Satuan standar sebelum mengonfirmasi pilihan.');
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
    } catch (error) {
      setStatusMessage(await recoverFromRowFailure('RESOLVE', row, error));
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
      await loadBatch();
      setStatusMessage(`Baris ${row.sourceRowNumber} ditolak.`);
    } catch (error) {
      setStatusMessage(await recoverFromRowFailure('REJECT', row, error));
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
      {!batch.actions.simprokProposal.offered && proposalBlockSentence(batch.actions.simprokProposal.reasonCode) ? (
        <p className="bp-note" role="status" aria-label="Status usulan ke SIMPROK">
          {proposalBlockSentence(batch.actions.simprokProposal.reasonCode)}
        </p>
      ) : null}

      <div className="bp-stack">
        {batch.rows.map((row) => {
          const draft = draftFor(row.id);
          const mutable = isRowMutable(row);
          const collisionLabel = collisionWarningLabel(row.collisionType);
          // EVERY human-visible sentence of the machine block, derived once from
          // structured facts. The page prints these and composes none of its
          // own, so what the pure test asserts is what the reviewer reads.
          const narrative = rowMachineNarrative(row);
          const notes = rowNoteLines(row);
          const noteDisclosure = rowNoteDisclosure(notes);
          const blockReason = completionBlockReason(row, {
            resource: draft.resource !== null,
            unit: draft.unit !== null,
            busy: isBusy || draft.resourcePending || draft.unitPending,
          });
          return (
            <section
              key={row.id}
              className={`bp-rowcard ${ROW_TONE_CLASS[rowTone(row)]}`}
              aria-label={`Baris ${row.sourceRowNumber}`}
            >
              <div className="bp-rowcard__head">
                <span className="bp-rowcard__name">
                  {row.name}{' '}
                  <span className="bp-rowcard__num">
                    #{row.sourceRowNumber} · {rowSectionDisplay(row)}
                  </span>
                </span>
                <span className="bp-rowcard__num">{rowStateLabel(row)}</span>
              </div>
              <p className="bp-rowcard__facts">{rowReviewFactsLine(row)}</p>
              {/*
                The row's own notes, in words. What has a sentence is said; what
                does not is COUNTED and disclosed as a count.

                Detail Teknis is not a licence to print enums. An earlier version
                of this block put untranslated codes there, on the reasoning that
                a disclosure is not the first read — but a site engineer cannot
                act on a raw code wherever it appears on the page. So the notice
                names HOW MANY facts are still unexplained and nothing else. The
                codes stay on the row, in the payload, for logs and audit; they
                have simply stopped being rendered.
              */}
              {/*
                BP-VISUAL-TRUTH-07 §17/§20 — the instruction stays on the card;
                the reasons behind it wait to be asked for. Nothing is dropped:
                `rowNoteDisclosure` splits the SAME list this block used to
                print in full, in the same server-given order.
              */}
              {noteDisclosure.primary ? (
                <p className="bp-rowcard__facts">Catatan: {noteDisclosure.primary}</p>
              ) : null}
              {noteDisclosure.secondary.length > 0 ? (
                <details className="bp-details">
                  <summary>{WHY_DISCLOSURE_TITLE}</summary>
                  {noteDisclosure.secondary.map((note) => (
                    <p className="bp-rowcard__facts" key={note}>{note}</p>
                  ))}
                </details>
              ) : null}
              {notes.technicalNotice ? (
                <details className="bp-details">
                  <summary>{TECHNICAL_DETAIL_TITLE}</summary>
                  <p>{notes.technicalNotice}</p>
                </details>
              ) : null}
              {collisionLabel ? (
                <p className="bp-note bp-note--attention" role="alert">
                  {collisionLabel}
                </p>
              ) : null}

              {/*
                INT-CONNECT-01 — VISIBLE ACCOUNTABILITY, LAYERED, AND HUMAN.

                LEVEL 1 is the one-word state. LEVEL 2 is the sentence under it:
                what SIMPROK understood, and what it is still waiting for.

                THE AUTHORITIES' `explanation` IS NOT HERE, AND IS NOT SENT.
                That string is real and it stays rich inside the engines — but it
                is written for an auditor, and it names ResourceCatalog row ids,
                the model's own name, raw reason codes, and on the
                governed-decision branch the account, the moment and the
                free-text note of a human who decided something elsewhere.
                Rendering it put a UUID in front of a site engineer and, on that
                branch, another person's record. So it was first unrendered, and
                then removed from the outward contract altogether.

                Every sentence here is derived from the proposal's STRUCTURED
                fields by `rowMachineNarrative` — status, candidate count, named
                reason codes, the resource's own name and code, the unit's own
                display name. There is no sanitiser to outwit, because there is
                nothing arriving that would need sanitising.

                A candidate's catalog id still keys its list item. That is the
                one lawful use of an internal id here, and it is kept apart from
                the printed text by the narrative's own key/text split.
              */}
              {narrative ? (
                <div className="bp-rowcard__machine" aria-label={`Hasil SIMPROK baris ${row.sourceRowNumber}`}>
                  <strong>
                    {narrative.state === 'PROVEN' ? '✓ ' : ''}
                    {narrative.stateLabel}
                  </strong>
                  <p>Satuan: {narrative.unit}</p>
                  <p>Sumber daya: {narrative.resource}</p>
                  {narrative.candidates.length > 0 ? (
                    <ul aria-label="Kandidat yang ditemukan SIMPROK">
                      {narrative.candidates.map((candidate) => (
                        <li key={candidate.key}>{candidate.text}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}

              {mutable ? (
                <div className="bp-rowcard__actions">
                  {/* A family SIMPROK could not map is passed as NO type filter,
                      never as one of the three it knows — see rowSectionDisplay. */}
                  <CatalogSearchSelect
                    mode="resource"
                    initialResourceType={row.section ?? undefined}
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
                  {/*
                    BP-INT-13/14 — one truth, and it says why.

                    The predicate is unchanged and still mirrors the resolve
                    endpoint's own requirement: an exact ResourceCatalog and an
                    exact UnitDefinition. What changed is that both are usually
                    already filled by the time a human arrives, and that a
                    disabled button now explains itself instead of leaving the
                    reviewer to guess which of two empty boxes it meant.

                    ONE STRONG ACTION PER ROW (§15). This is the decision;
                    `Tolak` is the rare exception and reads as one.

                    BP-VISUAL-TRUTH-07 §15 — AND IT NAMES THE ACT, NOT THE
                    OUTCOME. It read `Selesaikan`, which a person reasonably
                    takes to mean the item is finished — so the Owner pressed it
                    expecting completion and got a row that still had to be
                    saved. The state machine underneath was right and is
                    untouched; only the verb changed, to the one thing this
                    press actually does: it confirms the identity chosen above.
                    What comes after keeps its own words — the row then reads
                    `Siap disimpan`, and `Tersimpan di ruang kerja` once stored.
                  */}
                  <button
                    className="bp-btn bp-btn--primary"
                    onClick={() => void handleResolve(row)}
                    disabled={blockReason !== null}
                    aria-disabled={blockReason !== null}
                    title={blockReason ?? 'Konfirmasi Item SIMPROK dan Satuan untuk baris ini'}
                  >
                    Konfirmasi pilihan
                  </button>
                  {draft.rejectOpen ? (
                    <div className="bp-field">
                      <label className="bp-field__label" htmlFor={`bp-reject-${row.id}`}>
                        Alasan tolak
                      </label>
                      <input
                        id={`bp-reject-${row.id}`}
                        className="bp-input"
                        type="text"
                        placeholder="Mengapa baris ini ditolak?"
                        value={draft.reason}
                        onChange={(event) => updateDraft(row.id, { reason: event.target.value })}
                      />
                    </div>
                  ) : null}
                  <button
                    className="bp-btn bp-btn--danger-quiet"
                    onClick={() => void handleReject(row)}
                    disabled={isBusy}
                    aria-disabled={isBusy}
                  >
                    Tolak
                  </button>
                  {blockReason ? (
                    <p className="bp-field__help" role="status">
                      {blockReason}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
