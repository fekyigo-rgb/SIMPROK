import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useBlocker, useMatch, useNavigate } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, CheckCircle2, Database, FileText, Info, Sparkles } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { useAuth } from '../contexts/AuthContext';
import {
  AhspImportAssistedClassificationPanel,
  type AssistedClassificationContext,
} from '../components/AhspImportAssistedClassificationPanel';
import { AhspUnitResolutionPanel } from '../components/AhspUnitResolutionPanel';
import { emptyAssistedContext } from '../utils/ahspAssistedContext';
import { explainWaitingItemReasons } from '../utils/ahspDocumentUserCopy';
import {
  EXISTING_RESOURCE_LINE,
  IDENTITY_PENDING_ITEM_LINE,
  NEW_RESOURCE_CONFIRM_LINE,
  admissionOf,
  admissionShownAfterSave,
  workItemHasGenuineNewOnly,
  confirmImportFigures,
  confirmImportDoorRows,
  isDeletedIdentical,
  previewIdentityQuestions,
  type ConfirmImportDoor,
  describeImportIntake,
  describeImportRecheck,
  describeImportRecheckFailure,
  describePreviewAttention,
  describeWaitingImports,
  nextSavedImportAction,
  previewIntakeLine,
  previewUnitIssues,
  waitingUnitIssues,
  IMPORT_JOURNEY_SUBTITLE,
  type AttentionRowView,
  type ImportJobView,
  type ImportWaitingItemView,
  type IntakeSummaryWire,
  type UnitResolutionIssue,
} from '../utils/ahspImportIntakeDisplay';
import {
  IQL_COPY,
  REASON_MISSING_OUTCOME,
  describeGovernanceFailure,
  describeGovernanceSuccess,
  describeGovernedQuestion,
  describeGroupLearning,
  describeResourceDecisionFailure,
  describeResourceDecisionSuccess,
  groupIdenticalObservations,
  isGovernedQuestionShown,
  nextBusyNameReviewOwners,
  learningOutcomeOf,
  observationOccurrenceLine,
  previewCandidateNames,
  previewRuledOutLine,
  previewRuledOutNames,
  type CuratableObservationWire,
  type GovernedQuestionView,
  type GovernedQuestionWire,
  type ObservationCandidateChoice,
  type ObservationGroup,
  type PreviewResourceWire,
  type ResourceDecisionInput,
} from '../utils/resourceObservationDisplay';
import {
  EMPTY_IMPORT_SCOPE,
  applyImportRefresh,
  applyInitialImportPage,
  applyListRead,
  applyOlderImportPage,
  asImportPage,
  asRows,
  createReadCoordinator,
  emptyListRead,
  isAnswer,
  isRefusal,
  nextRefreshCursor,
  readAgainFor,
  runListRead,
  type ActionTicket,
  type DocumentTicket,
  type ImportJobPage,
  type ImportScope,
  type ListPhase,
  type ListRead,
  type ReadMode,
  type ReadResult,
} from '../utils/ahspImportReadState';
import {
  NETWORK_FAILURE,
  placeOutcomes,
  readApiFailure,
  withOutcome,
  type ActionOutcome,
  type AnchoredOutcome,
  type ApiFailure,
  type PlacedEntry,
} from '../utils/ahspActionFeedback';
import {
  describeSameness,
  identicalAggregateLine,
  identicalDeletedAggregateLine,
  type AhspIdentityMatchWire,
  type SamenessView,
} from '../utils/ahspSamenessDisplay';
import { ActionOutcomeNotice } from '../components/ahsp/ActionOutcomeNotice';
import { ObservedNameReviewPanel } from '../components/ahsp/ObservedNameReviewPanel';
import '../styles/ahsp.css';

type SamenessDecision = 'USE_EXISTING' | 'KEEP_SEPARATE' | 'SKIP';

/**
 * THE Import AHSP door — its own page, separate from the AHSP list, so the list
 * stays a clean library and this is the workspace for understanding a document.
 *
 * NOTHING about the canonical pipeline changes. Upload still uses the EXISTING
 * POST /ahsp/document/preview and /commit; unresolved resources still surface as
 * the EXISTING shared observation lifecycle (GET /resource-observations +
 * /curate-existing | /curate-new). Manual create ("Buat AHSP Manual") lives on
 * AhspRoomPage via the EXISTING POST /ahsp — not duplicated here. Bytes ->
 * SourceEnvelope -> ReaderRegistry -> SourceTable -> understanding -> Unit Kernel
 * -> Resource Identity -> Observation/Curation -> canonical writer, unchanged.
 *
 * ACG-01 OWNER BROWSER GAP: every action here now shows that it was pressed,
 * that it is working, and what it actually did — beside the item it acted on.
 *
 * IMPORT ACCEPTANCE BOUNDARY: saving a document COMPLETES the import — every
 * recognised work item is kept, and curation below is optional and downstream.
 * "Diterima" and "siap digunakan" are told as the two different truths they
 * are. An earlier import is checked again from what SIMPROK kept, through the
 * AHSP document jobs endpoints — never by asking for the file a second time.
 */

type PreviewItem = {
  status: string;
  /** The server's admission: PROVEN, IDENTITY_PENDING or HELD. */
  admission?: string | null;
  reasonCodes: string[];
  workType: { raw: string } | null;
  methodName: { raw: string } | null;
  outputUnitRaw?: { raw: string } | null;
  resolvedOutputUnit?: string | null;
  outputUnitStatements?: Array<{ raw: string }>;
  resources?: PreviewResourceWire[];
  identityVerdict?: string;
  identityMatches?: AhspIdentityMatchWire[];
};

/** How many identity questions the curation section lists before the reader asks for the rest. */
const CURATION_SHOWN = 5;

/**
 * One list read. A refusal, a network failure and an unreadable answer are all
 * "not read" — what each of those MEANS for the list is decided by the read-state
 * module, which can be exercised on its own.
 */
const readList = async <T,>(path: string, shape: (value: unknown) => T | null): Promise<ReadResult<T>> => {
  try {
    const response = await apiFetch(path);
    if (!response.ok) {
      return { ok: false, unauthorized: response.status === 401 || response.status === 403 };
    }
    const parsed = shape(await response.json().catch(() => null));
    return parsed === null ? { ok: false, unauthorized: false } : { ok: true, data: parsed };
  } catch {
    return { ok: false, unauthorized: false };
  }
};

/** The imports endpoint, and the one page of it being asked for. */
const jobsPath = (cursor: string | null): string =>
  '/ahsp/document/jobs' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : '');

/**
 * THE WAY ON TO OLDER IMPORTS — or none. Only a READY scope's cursor is the server's
 * latest word, handed out by the last read that completed. A STALE scope keeps its
 * cursor as knowledge of where it stood, never as a door: the notice's retry reads the
 * chain again from the first page, and READY opens the way on again.
 */
const olderImportsCursor = (scope: ImportScope): string | null =>
  scope.phase === 'READY' && scope.hasMore && scope.nextCursor !== null && scope.nextCursor !== '' ? scope.nextCursor : null;

const FAILED_READ_LINE = 'Daftar ini belum berhasil dimuat, jadi keadaannya belum dapat ditampilkan.';
const STALE_READ_LINE = 'Daftar belum dapat diperbarui. Yang tampil adalah keadaan terakhir yang berhasil dimuat.';

/**
 * A read that did not arrive, said in the reader's words, with the one safe thing
 * to do about it. The retry only READS again: no decision is ever resent, and the
 * retry is a prop — nothing here runs while the page renders.
 */
function ReadNotice({ phase, onRetry, label }: { phase: ListPhase; onRetry: () => void; label: string }) {
  if (phase !== 'FAILED' && phase !== 'STALE') return null;
  return (
    <p role="status" className="ahsp-read-state">
      <span className="ahsp-line ahsp-line--abu">{phase === 'FAILED' ? FAILED_READ_LINE : STALE_READ_LINE}</span>
      <button
        type="button"
        className="ahsp-action ahsp-action--quiet ahsp-action--compact"
        aria-label={label}
        onClick={onRetry}
      >
        Coba lagi
      </button>
    </p>
  );
}

/** Which curation request is in flight, and on which button. */
type CurationBusy = { key: string; action: string };
type GovernanceAction = 'approve' | 'reject' | 'revoke';

const NAVY = 'var(--simprok-authority-navy-800)';
const MUTED = 'var(--simprok-engineering-blue-500)';
const BLUE = 'var(--simprok-trust-blue-500)';
const RED = '#C0392B';
// Color Lock: ungu is ONLY SIMPROK recommendation/insight — the POSSIBLY match.
const UNGU = '#6D4A9E';
// Color Lock: emas = menunggu approval; abu = tidak berlaku / belum ada mesin.
const EMAS = '#C77A17';
const ABU = '#98A2B3';
const HAIRLINE = '1px solid var(--simprok-engineering-blue-100)';
const CARD: CSSProperties = { background: '#FFFFFF', border: HAIRLINE, borderRadius: '12px', padding: 'var(--space-4)' };
const controlBox: CSSProperties = { color: NAVY, padding: 'var(--space-2)', border: HAIRLINE, borderRadius: '8px', background: '#FFFFFF', width: '100%' };

// PostgreSQL JSON fields need key-order-independent comparison. The backend
// retains canonical classification facts but strips UI-only displayLabels.
const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => JSON.stringify(key) + ':' + stableJson(item))
      .join(',') + '}';
  }
  return JSON.stringify(value) ?? 'null';
};
const savedDraftFacts = (context: AssistedClassificationContext | null) => ({
  jenisPengadaanRootId: context?.jenisPengadaanRootId?.trim() || null,
  paths: (context?.paths ?? []).map((path) => ({
    leafNodeId: path.leafNodeId.trim(),
    provenanceHint: path.provenanceHint === 'FROM_SOURCE' ? 'FROM_SOURCE' : 'FROM_USER',
    sourceEvidence: path.sourceEvidence ?? null,
  })),
  pendingPaths: (context?.pendingPaths ?? []).map((path) => ({
    kategori: path.kategori.trim(),
    subkategori: path.subkategori.trim(),
    jenisPekerjaan: path.jenisPekerjaan.trim(),
  })),
  dasarAcuan: context?.dasarAcuan?.trim() || null,
  penerbit: context?.penerbit?.trim() || null,
});

export function AhspImportPage() {
  const navigate = useNavigate();
  const reviewJobId = useMatch('/ahsp/import/review/:importJobId')?.params.importJobId ?? null;
  const isReviewPage = reviewJobId !== null;
  const { hasPermission, activeWorkspaceId } = useAuth();
  const canManage = hasPermission('AHSP_MANAGE');
  const canCurate = hasPermission('AHSP_RESOURCE_IDENTITY_DECIDE');
  // IQL-01 second holder: may JUDGE pending learning candidates here — nothing else.
  const canSeeQuestions = canCurate || hasPermission('AHSP_RESOURCE_IDENTITY_QUESTION_APPROVE');
  const canViewAhsp = hasPermission('AHSP_VIEW');

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<null | {
    workItems: PreviewItem[];
    document?: { regulationReference?: { raw?: string } | null };
    source?: { contentDigestSha256?: string | null; fileName?: string | null };
  }>(null);
  /**
   * STAGE 2A Door A — server-side scope for GET /resource-observations.
   * importJobId or sourceSha256 only; never whole-workspace client filter.
   */
  type ObservationScope =
    | { kind: 'importJobId'; importJobId: string }
    | { kind: 'sourceSha256'; sourceSha256: string }
    | null;
  const [observationScope, setObservationScope] = useState<ObservationScope>(null);
  const curationSectionRef = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [assistedClassification, setAssistedClassification] =
    useState<AssistedClassificationContext>(() => emptyAssistedContext());
  const [commitResult, setCommitResult] = useState<null | {
    summary?: IntakeSummaryWire | null;
    importJobId?: string | null;
    written?: ReadonlyArray<{
      workType: string;
      methodName: string;
      admission: string;
    }> | null;
  }>(null);
  const [importError, setImportError] = useState<string | null>(null);
  /** Owner PASS Import journey: classify after preview, then confirm before save. */
  const [journeyStep, setJourneyStep] = useState<'idle' | 'classify' | 'confirm'>('idle');
  const [unitDoor, setUnitDoor] = useState<null | {
    spelling: string | null;
    lineKey: string | null;
    source: 'preview' | 'job';
    jobKey: string | null;
  }>(null);
  const [openFailureJob, setOpenFailureJob] = useState<string | null>(null);
  const failureSectionRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!openFailureJob) return;
    failureSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    failureSectionRef.current?.focus();
  }, [openFailureJob]);
  /** The preview's journal, created only when a unit choice needs a durable line. */
  const [previewIntakeJobId, setPreviewIntakeJobId] = useState<string | null>(null);
  // Which document request is running, so each button tells the truth about itself.
  const [importAction, setImportAction] = useState<'PREVIEW' | 'COMMIT' | null>(null);
  const importing = importAction !== null;
  // The preview or commit that owns the document buttons; another document or workspace takes them from it.
  const documentLock = useRef<DocumentTicket | null>(null);

  const [observationsRead, setObservationsRead] = useState<ListRead<CuratableObservationWire>>(() =>
    emptyListRead<CuratableObservationWire>(),
  );
  const observations = observationsRead.rows;
  const observationsPhase = observationsRead.phase;
  const [curationBusy, setCurationBusy] = useState<CurationBusy | null>(null);
  // Track ownership by observation, not one shared Boolean: the first save to
  // finish must not unlock curation while a second observation is still saving.
  const nameReviewBusyOwners = useRef<Set<string>>(new Set());
  const [nameReviewBusyCount, setNameReviewBusyCount] = useState(0);
  const nameReviewBusy = nameReviewBusyCount > 0;
  const [nameReviewReceipt, setNameReviewReceipt] = useState<string | null>(null);
  // A ref, not state: a second press in the same tick must be refused before React re-renders.
  // It holds the action that owns the controls, and a refusal of the list takes them from it.
  const curationLock = useRef<ActionTicket | null>(null);
  const [curationOutcomes, setCurationOutcomes] = useState<AnchoredOutcome[]>([]);
  // IQL-01 — offering a decision as learning is a separate, explicit choice per question.
  const [rememberFor, setRememberFor] = useState<Record<string, boolean>>({});
  const [questionsRead, setQuestionsRead] = useState<ListRead<GovernedQuestionWire>>(() =>
    emptyListRead<GovernedQuestionWire>(),
  );
  const questions = questionsRead.rows;
  const questionsPhase = questionsRead.phase;
  const [questionReasons, setQuestionReasons] = useState<Record<string, string>>({});
  const [questionBusy, setQuestionBusy] = useState<{ key: string; action: GovernanceAction } | null>(null);
  const questionLock = useRef<ActionTicket | null>(null);
  const [questionOutcomes, setQuestionOutcomes] = useState<AnchoredOutcome[]>([]);
  // Earlier imports that still hold work items, and the one re-check in flight.
  // IMPORT-SEAM-05 — every import the reader has opened, which pages they came
  // from, and whether older ones wait behind them. The door to those stays open
  // even when the first page holds nothing.
  const [importScope, setImportScope] = useState<ImportScope>(EMPTY_IMPORT_SCOPE);
  const importJobs = importScope.jobs;
  const importPhase = importScope.phase;
  const importHasMore = importScope.hasMore;
  const importMayLoadOlder = olderImportsCursor(importScope) !== null;
  const [olderImports, setOlderImports] = useState<'IDLE' | 'LOADING' | 'FAILED'>('IDLE');
  const [reviewLookupPausedFor, setReviewLookupPausedFor] = useState<string | null>(null);
  const [jobBusy, setJobBusy] = useState<string | null>(null);
  const jobLock = useRef<ActionTicket | null>(null);
  const [jobOutcomes, setJobOutcomes] = useState<AnchoredOutcome[]>([]);
  // A decision on an earlier import's possible twin, keyed by the import and its
  // line. It rides that import's next re-check, exactly as a preview decision
  // rides its commit, and is spent by it.
  const [jobDecisions, setJobDecisions] = useState<Record<string, SamenessDecision>>({});
  const jobDecisionKey = (job: ImportJobView, item: ImportWaitingItemView) => job.key + ':' + item.key;
  // DETAIL ON DEMAND. What an import needs is said once per question; the item by
  // item list behind it opens only when the reader asks.
  const [previewDetailOpen, setPreviewDetailOpen] = useState(false);
  const [previewDetailDoor, setPreviewDetailDoor] = useState<ConfirmImportDoor>('understood');
  const [showAllPreviewQuestions, setShowAllPreviewQuestions] = useState(false);
  const confirmDetailRef = useRef<HTMLDivElement | null>(null);
  const primarySaveRef = useRef<HTMLButtonElement | null>(null);
  const savedReviewActionsRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    if (journeyStep !== 'confirm' || !previewDetailOpen || isReviewPage) return;
    confirmDetailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    confirmDetailRef.current?.focus();
  }, [journeyStep, previewDetailOpen, previewDetailDoor, isReviewPage]);
  const [openJobDetails, setOpenJobDetails] = useState<Record<string, boolean>>({});
  // Detail is CONCISE by default and COMPLETE on demand: the rest of a saved
  // import's waiting work, and the reasons behind one curation question.
  const [openJobAllWaiting, setOpenJobAllWaiting] = useState<Record<string, boolean>>({});
  const [openCurationReason, setOpenCurationReason] = useState<Record<string, boolean>>({});
  const [curationShowAll, setCurationShowAll] = useState(false);
  // Manual create lives on the AHSP room door ("Buat AHSP Manual"), not on Import.

  // Human decisions for AHSPs the identity classifier flagged. Keyed by the same
  // source-name identity the backend uses, so a decision travels from this
  // preview to the commit upload of the same file. Never a frontend-only truth.
  const [decisions, setDecisions] = useState<Record<string, SamenessDecision>>({});
  // A commit SPENDS the decisions it carried. The list that comes back is the
  // knowledge computed before those writes, so leaving the controls live would let
  // one human intent be recorded twice. They stay closed until the reader asks
  // SIMPROK to understand the document again.
  const [settled, setSettled] = useState(false);
  // A saved import is not a new upload. Keep old work discoverable but closed until chosen.
  const [savedImportsOpen, setSavedImportsOpen] = useState(false);
  const [selectedSavedImport, setSelectedSavedImport] = useState<string | null>(null);
  const [learningOpen, setLearningOpen] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftReceipt, setDraftReceipt] = useState<string | null>(null);
  const [draftDeleteReceipt, setDraftDeleteReceipt] = useState<string | null>(null);
  const [draftDeleteTarget, setDraftDeleteTarget] = useState<ImportJobView | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const hasUnsavedUpload = file !== null && !settled && !draftSaved;
  // The intake journal persists source bytes/classification, NOT duplicate choices.
  // Never treat a draft save as permission to silently discard those choices.
  const hasUnsavedPreviewChoices = !settled && Object.keys(decisions).length > 0;
  // Decisions on a reopened job are also unsaved until /continue accepts them.
  const hasUnsavedSavedJobChoices = Object.keys(jobDecisions).length > 0;
  const hasUnsavedWork = hasUnsavedUpload || hasUnsavedPreviewChoices || hasUnsavedSavedJobChoices;
  const navigationBlocker = useBlocker(hasUnsavedWork);
  useEffect(() => {
    if (!hasUnsavedWork) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasUnsavedWork]);
  // Collision-proof separator (matches the backend decisionMap): a real space
  // would let a different (workType, methodName) split map two distinct items to
  // ONE Record key. The null char never appears in a source name.
  const decisionKey = (item: PreviewItem) => (item.workType?.raw ?? '') + '\u0000' + (item.methodName?.raw ?? '');
  const setDecision = (item: PreviewItem, action: SamenessDecision) => {
    setDraftSaved(false);
    setDecisions((prev) => ({ ...prev, [decisionKey(item)]: action }));
  };

  // WHO MAY STILL APPLY AN ANSWER. A workspace or session change ends every read
  // of every list; a refusal ends only the reads of the list that was refused, so
  // another list's refusal already in flight is still processed — never dropped
  // as stale before it could clear its own rows. An action takes its ticket before
  // it sends anything: once its list is refused, nothing the action hears later is
  // written — not even after the list comes back.
  const [reads] = useState(createReadCoordinator);
  // The opened scope as the async reads see it: a read started now asks about the
  // pages that are open now, not the ones that were open when the page rendered.
  const scopeRef = useRef<ImportScope>(EMPTY_IMPORT_SCOPE);
  const applyScope = (next: ImportScope) => {
    scopeRef.current = next;
    setImportScope(next);
  };
  // Import reads run one at a time, so a refresh and a load-more can never
  // overwrite each other's answer or double a card between them.
  const importReads = useRef<Promise<unknown>>(Promise.resolve());
  const queueImportRead = (task: () => Promise<void>): Promise<void> => {
    const next = importReads.current.then(task, task);
    importReads.current = next.catch(() => undefined);
    return next;
  };

  /**
   * WHAT A REFUSAL MEANS FOR ONE LIST. The rows leave the screen with everything
   * derived from them — the choices, the receipts, the opened details — because
   * none of it may be read or acted on any more. An action still waiting on that
   * list loses its hold on the list's controls, so they are free the moment the
   * list comes back. Nothing in the database is touched, and the other lists are
   * left alone.
   */
  const forgetCuration = () => {
    setRememberFor({});
    setCurationOutcomes([]);
    setOpenCurationReason({});
    setCurationShowAll(false);
    setObservationScope(null);
    curationLock.current = null;
    setCurationBusy(null);
    nameReviewBusyOwners.current.clear();
    setNameReviewBusyCount(0);
    setNameReviewReceipt(null);
  };
  const forgetImports = () => {
    setJobDecisions({});
    setJobOutcomes([]);
    setOpenJobDetails({});
    setOpenJobAllWaiting({});
    setOlderImports('IDLE');
    jobLock.current = null;
    setJobBusy(null);
  };
  const forgetQuestions = () => {
    setQuestionReasons({});
    setQuestionOutcomes([]);
    questionLock.current = null;
    setQuestionBusy(null);
  };
  /**
   * WHAT ANOTHER DOCUMENT — OR ANOTHER WORKSPACE — MEANS FOR THE UPLOAD. What the
   * server said about the document before leaves the screen: its understanding, what
   * was saved, the decisions it carried, an error from its request. A request still
   * waiting for it loses its hold on the buttons. The file the reader chose stays
   * chosen; it is simply understood again when they ask.
   */
  const forgetDocument = () => {
    setPreview(null);
    setCommitResult(null);
    setSettled(false);
    setPreviewDetailOpen(false);
    setJourneyStep('idle');
    setPreviewIntakeJobId(null);
    // A new file's items are new decisions — drop any prior ones so a stale decision
    // can never ride a different document to commit.
    setDecisions({});
    setAssistedClassification(emptyAssistedContext());
    setImportError(null);
    documentLock.current = null;
    setImportAction(null);
  };
  const observationsListPath = (scope: ObservationScope): string => {
    if (scope?.kind === 'importJobId') {
      return '/resource-observations?importJobId=' + encodeURIComponent(scope.importJobId);
    }
    if (scope?.kind === 'sourceSha256') {
      return '/resource-observations?sourceSha256=' + encodeURIComponent(scope.sourceSha256);
    }
    return '/resource-observations';
  };

  /** The curation list as the server holds it now; null when it could not be read. */
  const loadObservations = async (
    mode: ReadMode = 'REFRESH',
    scope: ObservationScope = observationScope,
  ): Promise<readonly CuratableObservationWire[] | null> => {
    if (!canCurate) return null;
    if (mode === 'INITIAL') setObservationsRead((previous) => ({ ...previous, phase: 'LOADING' }));
    // A curation-list read failure is never rendered as "no work to review", and a
    // refusal never leaves the refused rows behind.
    const outcome = await runListRead(reads, {
      list: 'observations',
      read: () => readList(observationsListPath(scope), asRows<CuratableObservationWire>),
      refusedBy: isRefusal,
      answeredBy: isAnswer,
      apply: (answer) => setObservationsRead((previous) => applyListRead(previous, answer, mode)),
      forget: forgetCuration,
    });
    return outcome.applied && outcome.answer.ok ? outcome.answer.data : null;
  };

  /** Door A — open existing curation scoped to THIS document. Read only. */
  const openIdentityReview = async (scope: Exclude<ObservationScope, null>) => {
    if (!canCurate) return;
    setObservationScope(scope);
    setCurationShowAll(true);
    await loadObservations('INITIAL', scope);
    curationSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    curationSectionRef.current?.focus();
  };

  /**
   * Earlier imports, as SIMPROK kept them. A first read states the scope; a
   * refresh reads EVERY page the reader has opened, in order, so an import on an
   * older page can become current instead of merely being kept.
   */
  const loadImportJobs = (mode: ReadMode = 'REFRESH'): Promise<void> =>
    queueImportRead(async () => {
      if (!canManage) return;
      if (mode === 'INITIAL') {
        applyScope({ ...scopeRef.current, phase: 'LOADING' });
        await runListRead(reads, {
          list: 'imports',
          read: () => readList(jobsPath(null), asImportPage),
          refusedBy: isRefusal,
          answeredBy: isAnswer,
          apply: (answer) => applyScope(applyInitialImportPage(scopeRef.current, answer)),
          forget: forgetImports,
        });
        return;
      }
      await runListRead(reads, {
        list: 'imports',
        read: async () => {
          const results: ReadResult<ImportJobPage>[] = [];
          // The opened pages in order, the first page first — and, after a refusal, as far
          // again as the reader had read. A page that did not arrive stops the walk.
          for (
            let cursor = nextRefreshCursor(scopeRef.current, results);
            cursor !== undefined;
            cursor = nextRefreshCursor(scopeRef.current, results)
          ) {
            results.push(await readList(jobsPath(cursor), asImportPage));
          }
          return results;
        },
        refusedBy: (results) => results.some(isRefusal),
        answeredBy: (results) => results.length > 0 && results.every(isAnswer),
        apply: (results) => applyScope(applyImportRefresh(scopeRef.current, results)),
        forget: forgetImports,
      });
    });

  /**
   * IMPORT-SEAM-05 — the imports older than the opened scope. Stored work stays
   * reachable without the file: the cursor only advances on an answer, so a failed
   * press loses nothing and can simply be pressed again. The way on is taken from the
   * scope as it stands when this read's turn comes — while it is not READY, nothing is read.
   */
  const loadOlderImports = (): Promise<void> =>
    queueImportRead(async () => {
      const cursor = olderImportsCursor(scopeRef.current);
      if (!canManage || cursor === null) return;
      setOlderImports('LOADING');
      const outcome = await runListRead(reads, {
        list: 'imports',
        read: () => readList(jobsPath(cursor), asImportPage),
        refusedBy: isRefusal,
        answeredBy: isAnswer,
        apply: (answer) => applyScope(applyOlderImportPage(scopeRef.current, cursor, answer)),
        forget: forgetImports,
      });
      if (!outcome.applied || isRefusal(outcome.answer)) return;
      setOlderImports(outcome.answer.ok ? 'IDLE' : 'FAILED');
    });

  // IQL-01 — the governed exact questions, with the doors open to THIS reader.
  const loadQuestions = async (mode: ReadMode = 'REFRESH') => {
    if (!canSeeQuestions) return;
    if (mode === 'INITIAL') setQuestionsRead((previous) => ({ ...previous, phase: 'LOADING' }));
    // Never rendered as "nothing to govern", and never kept after a refusal.
    await runListRead(reads, {
      list: 'questions',
      read: () => readList('/resource-observations/questions', asRows<GovernedQuestionWire>),
      refusedBy: isRefusal,
      answeredBy: isAnswer,
      apply: (answer) => setQuestionsRead((previous) => applyListRead(previous, answer, mode)),
      forget: forgetQuestions,
    });
  };

  useEffect(() => {
    // On-mount fetch of the standing curation queue; a documented, intentional effect.
    // A workspace change starts again from nothing: another workspace's queue is
    // never what this one shows, and a read started for the old one is dropped.
    reads.resetSession();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setObservationsRead(emptyListRead<CuratableObservationWire>());
    setQuestionsRead(emptyListRead<GovernedQuestionWire>());
    applyScope(EMPTY_IMPORT_SCOPE);
    forgetCuration();
    forgetImports();
    forgetQuestions();
    // Nor does a preview or commit begun there write anything here.
    forgetDocument();
    setFile(null);
    setDraftSaved(false);
    setDraftReceipt(null);
    setSavedImportsOpen(Boolean(reviewJobId));
    setSelectedSavedImport(reviewJobId);
    setObservationScope(reviewJobId ? { kind: 'importJobId', importJobId: reviewJobId } : null);
    setLearningOpen(false);
    void loadObservations('INITIAL', reviewJobId ? { kind: 'importJobId', importJobId: reviewJobId } : null);
    void loadQuestions('INITIAL');
    void loadImportJobs('INITIAL');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId, canCurate, canSeeQuestions, canManage]);

  const previewDocument = async () => {
    if (!canManage || !file || documentLock.current !== null) return;
    // The request this is: what it hears later is written only while it is still
    // about this workspace and this file.
    const ticket = reads.captureDocument();
    documentLock.current = ticket;
    setImportAction('PREVIEW');
    setImportError(null);
    setCommitResult(null);
    // A fresh understanding is a fresh set of items to decide — never carry a
    // stale decision from a previous document/preview into this one.
    setDecisions({});
    setSettled(false);
    setPreviewDetailOpen(false);
    setDraftSaved(false);
    setDraftReceipt(null);
    setAssistedClassification(emptyAssistedContext());
    setJourneyStep('idle');
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await apiFetch('/ahsp/document/preview', { method: 'POST', body });
      if (!response.ok) {
        if (reads.mayApplyDocument(ticket)) {
          setImportError('Dokumen AHSP belum dapat dipahami. Periksa berkas lalu coba lagi.');
        }
        return;
      }
      const understood = await response.json();
      if (reads.mayApplyDocument(ticket)) {
        setPreview(understood);
        setPreviewIntakeJobId(null);
        setJourneyStep('classify');
        const dasar = understood?.document?.regulationReference?.raw ?? null;
        if (typeof dasar === 'string' && dasar.trim()) {
          setAssistedClassification((prev) => ({
            ...prev,
            dasarAcuan: prev.dasarAcuan ?? dasar.trim(),
          }));
        }
      }
    } catch {
      if (reads.mayApplyDocument(ticket)) setImportError('Dokumen AHSP tidak dapat dihubungi.');
    } finally {
      // Only the request that still holds the buttons lets them go.
      if (documentLock.current === ticket) {
        documentLock.current = null;
        setImportAction(null);
      }
    }
  };

  /**
   * Reuse the EXISTING server-side intake journal. This is NOT /document/commit:
   * source bytes and immutable knowledge are kept, but no canonical AHSP is created.
   * Human duplicate decisions are still commit-time choices, and must not be
   * represented as having been saved in this draft.
   */
  const saveAsDraft = async (leaveAfterSave = false) => {
    if (!canManage || !file || draftBusy || documentLock.current !== null) return;
    const ticket = reads.captureDocument();
    documentLock.current = ticket;
    setDraftBusy(true);
    setDraftReceipt(null);
    try {
      let jobId = previewIntakeJobId;
      if (!jobId) {
        const form = new FormData();
        form.append('file', file);
        const intake = await apiFetch('/ahsp/document/intake', { method: 'POST', body: form });
        if (!intake.ok) throw new Error('Draft belum tersimpan. Catatan dokumen ditolak oleh server.');
        const saved = await intake.json().catch(() => null);
        if (typeof saved?.importJobId !== 'string' || !saved.importJobId) {
          throw new Error('Draft belum terverifikasi: server tidak mengembalikan identitas jurnal.');
        }
        jobId = saved.importJobId;
        if (reads.mayApplyDocument(ticket)) setPreviewIntakeJobId(jobId);
      }
      if (!jobId) throw new Error('Identitas draft tidak ditemukan. Dokumen belum terverifikasi.');

      const hasAssisted =
        assistedClassification.jenisPengadaanRootId !== null ||
        assistedClassification.paths.length > 0 ||
        (assistedClassification.pendingPaths?.length ?? 0) > 0 ||
        Boolean(assistedClassification.dasarAcuan?.trim()) ||
        Boolean(assistedClassification.penerbit?.trim());
      if (hasAssisted) {
        const context = await apiFetch(
          '/ahsp/document/jobs/' + encodeURIComponent(jobId) + '/assisted-classification',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(assistedClassification),
          },
        );
        if (!context.ok) {
          throw new Error('Berkas telah dicatat, tetapi klasifikasi draft belum tersimpan. Perbaiki dan coba lagi sebelum keluar.');
        }
      }
      // A read of this job's guarded context also proves the journal exists in
      // this workspace (404 otherwise). Do not claim a successful save on POST alone.
      const check = await apiFetch(
        '/ahsp/document/jobs/' + encodeURIComponent(jobId) + '/assisted-classification',
      );
      if (!check.ok) {
        throw new Error('Server menerima draft, tetapi pemeriksaan ulang belum berhasil. Jangan keluar dahulu.');
      }
      if (hasAssisted) {
        const verified = (await check.json().catch(() => null)) as AssistedClassificationContext | null;
        if (!verified || stableJson(savedDraftFacts(verified)) !== stableJson(savedDraftFacts(assistedClassification))) {
          throw new Error('Klasifikasi draft belum terbukti tersimpan. Periksa ulang sebelum keluar.');
        }
      }
      if (reads.mayApplyDocument(ticket)) {
        setDraftSaved(true);
        setDraftReceipt(
          'Draft dokumen berhasil disimpan di jurnal SIMPROK. Belum menjadi AHSP siap digunakan.' +
          (Object.keys(decisions).length > 0
            ? ' Pilihan kesamaan sementara belum ikut tersimpan; tinjau kembali saat melanjutkan.'
            : ''),
        );
        await loadImportJobs('REFRESH');
        // The modal's Save choice exits ONLY after durable read-back, and only
        // when no unsaved duplicate decisions would be lost along the way.
        if (leaveAfterSave && Object.keys(decisions).length === 0 &&
            Object.keys(jobDecisions).length === 0 && navigationBlocker.state === 'blocked') {
          navigationBlocker.proceed();
        }
      }
    } catch (error) {
      if (reads.mayApplyDocument(ticket)) {
        setDraftReceipt(error instanceof Error ? error.message : 'Draft belum dapat disimpan.');
      }
    } finally {
      if (documentLock.current === ticket) documentLock.current = null;
      setDraftBusy(false);
    }
  };

  const commitDocument = async () => {
    if (!canManage || !file || documentLock.current !== null) return;
    const ticket = reads.captureDocument();
    documentLock.current = ticket;
    setImportAction('COMMIT');
    setImportError(null);
    try {
      const body = new FormData();
      body.append('file', file);
      // The human's duplicate decisions travel to the canonical writer alongside
      // the file. Only decided-and-flagged items are sent; the backend re-derives
      // the verdict and holds anything left undecided.
      // One identity quoted twice in a document is ONE decision, so the same key is
      // never sent twice (which would record the same human intent twice).
      const alreadySent = new Set<string>();
      const chosen = (preview?.workItems ?? [])
        .filter(
          (item) =>
            item.workType &&
            item.methodName &&
            (item.identityVerdict === 'IDENTICAL' ||
              item.identityVerdict === 'POSSIBLY_IDENTICAL') &&
            decisions[decisionKey(item)],
        )
        .filter((item) => {
          const key = decisionKey(item);
          if (alreadySent.has(key)) return false;
          alreadySent.add(key);
          return true;
        })
        .map((item) => ({
          workType: item.workType!.raw,
          methodName: item.methodName!.raw,
          action: decisions[decisionKey(item)],
        }));
      if (chosen.length > 0) body.append('decisions', JSON.stringify(chosen));
      body.append('assistedClassification', JSON.stringify(assistedClassification));
      const response = await apiFetch('/ahsp/document/commit', { method: 'POST', body });
      if (!response.ok) {
        // Saving the same document again never records what was already kept twice.
        if (reads.mayApplyDocument(ticket)) {
          setImportError('Import belum selesai. Coba simpan lagi sebentar; yang sudah diterima tidak akan tercatat dua kali.');
        }
        if (reads.sameSession(ticket)) await loadImportJobs();
        return;
      }
      const data = await response.json();
      // What was saved is told only for the document and the workspace it was saved from.
      // The save itself stands on the server either way, and the lists below read it back.
      if (reads.mayApplyDocument(ticket)) {
        setCommitResult(data);
        setPreview(data.knowledge ?? preview);
        // The decisions have been acted on. Clearing them stops a spent choice from
        // staying lit on screen and from riding a later commit of the same preview.
        setDecisions({});
        setSettled(true);
      }
      if (reads.sameSession(ticket)) await Promise.all([loadObservations(), loadImportJobs()]);
    } catch {
      if (reads.mayApplyDocument(ticket)) {
        setImportError('Layanan import AHSP tidak dapat dihubungi. Yang sudah diterima tidak akan tercatat dua kali saat disimpan lagi.');
      }
    } finally {
      if (documentLock.current === ticket) {
        documentLock.current = null;
        setImportAction(null);
      }
    }
  };

  /**
   * Record ONE human answer for one identical question, through the SAME
   * per-observation endpoints as before.
   *
   * A confirmation is recorded against every observation that asked, so each row
   * keeps its own decision record, its own actor and its own provenance — what
   * stops repeating is the asking, not the recording. A NEW resource is different:
   * it is admitted ONCE. A second admission of the same identity is refused by the
   * admission law, so it is never attempted (IMPORT-SEAM-06); the refreshed list
   * shows whether the other rows still wait, and that is what the reader is told.
   *
   * What each row's server answer SAID is read, not just whether it was 2xx: the
   * outcome names what was recorded and — separately — whether learning was
   * offered. Partial outcomes are told, never rounded up: rows that were saved
   * stay saved and the reader is told exactly how many were not, and why.
   */
  const curateGroup = async (request: {
    group: ObservationGroup;
    at: number;
    action: string;
    path: '/curate-existing' | '/curate-new';
    // The rows this decision is sent for.
    ids: readonly string[];
    // Each row sends its OWN body, so each carries its own signed context.
    bodyFor: (id: string) => Record<string, unknown>;
    decision: ResourceDecisionInput;
    remember: boolean;
  }) => {
    const { group } = request;
    // Nothing may be decided from rows this reader has just been refused.
    if (nameReviewBusyOwners.current.size > 0 || curationLock.current !== null || request.ids.length === 0 || observationsPhase === 'UNAUTHORIZED') return;
    // The action this decision is. What it writes later is judged against it: a
    // receipt from another session, or for a list refused since it began, never
    // reaches the screen — not even once the list has come back.
    const ticket = reads.captureAction('observations');
    curationLock.current = ticket;
    setCurationBusy({ key: group.key, action: request.action });
    let saved = 0;
    let failure: ApiFailure | null = null;
    const results: Array<{ identicalQuestion?: { state?: string | null; replayed?: boolean | null } | null } | null> = [];
    try {
      for (const id of request.ids) {
        // One decision may be sent row by row. Once it may no longer write — its list
        // refused, or the session changed — the rows not yet sent are not sent; rows
        // already saved stay saved, and nothing is sent to undo them.
        if (!reads.mayApply(ticket)) break;
        let response: Response;
        try {
          response = await apiFetch('/resource-observations/' + id + request.path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request.bodyFor(id)),
          });
        } catch {
          failure = NETWORK_FAILURE;
          break;
        }
        if (!response.ok) {
          failure = await readApiFailure(response);
          break;
        }
        saved += 1;
        results.push(await response.json().catch(() => null));
      }
      const refreshed = await readAgainFor(reads, ticket, 'observations', () => loadObservations('REFRESH'));
      const learning = request.remember ? learningOutcomeOf(results) : null;
      const unsent = group.ids.filter((id) => !request.ids.includes(id));
      const outcome: ActionOutcome =
        failure === null
          ? describeResourceDecisionSuccess({
              ...request.decision,
              rows: saved,
              learning,
              otherOccurrences:
                unsent.length > 0
                  ? {
                      total: unsent.length,
                      stillWaiting: refreshed === null ? null : refreshed.filter((row) => unsent.includes(row.id)).length,
                    }
                  : null,
            })
          : describeResourceDecisionFailure({
              saved,
              total: request.ids.length,
              failure,
              learning: saved > 0 ? learning : null,
            });
      // The receipt and the refreshed list land together, so the eye is never sent away —
      // unless the list was refused since this decision began: then nothing it says is shown.
      if (reads.mayApply(ticket)) {
        setCurationOutcomes((prev) =>
          withOutcome(prev, { key: group.key, at: request.at, title: group.view.title, outcome }),
        );
      }
      // A resource decision can change what an import still needs, so the import
      // cards are asked again — the receipt above never claims that by itself.
      await Promise.all([
        readAgainFor(reads, ticket, 'questions', () => loadQuestions()),
        readAgainFor(reads, ticket, 'imports', () => loadImportJobs()),
      ]);
    } finally {
      // Only the action that still holds the controls lets them go.
      if (curationLock.current === ticket) {
        curationLock.current = null;
        setCurationBusy(null);
      }
    }
  };

  const wireById = new Map(observations.map((observation) => [observation.id, observation]));

  const curateExisting = (group: ObservationGroup, at: number, choice: ObservationCandidateChoice, remember: boolean) =>
    curateGroup({
      group,
      at,
      action: 'existing:' + choice.resourceCatalogId,
      path: '/curate-existing',
      ids: group.ids,
      bodyFor: (id) =>
        remember
          ? {
              selectedResourceCatalogId: choice.resourceCatalogId,
              rememberForIdenticalQuestions: true,
              decisionContextToken: wireById.get(id)?.identicalQuestion?.decisionContextToken,
            }
          : { selectedResourceCatalogId: choice.resourceCatalogId },
      decision: { kind: 'EXISTING', title: group.view.title, chosenName: choice.name },
      remember,
    });

  const curateNew = (group: ObservationGroup, at: number, unitDefinitionId: string) =>
    curateGroup({
      group,
      at,
      action: 'new',
      path: '/curate-new',
      // ONE admission for the question, never one per row.
      ids: group.ids.slice(0, 1),
      // Branch (c): the nominations the reader is refusing, and the candidate
      // context they were shown under — re-proved by the server under its lock.
      bodyFor: () =>
        group.view.newResourceRefusal
          ? {
              unitDefinitionId,
              refusedCandidateIds: group.view.newResourceRefusal.candidateIds,
              candidateContextDigest: group.view.newResourceRefusal.candidateContextDigest,
            }
          : { unitDefinitionId },
      decision: { kind: 'NEW', title: group.view.title, chosenName: null },
      remember: false,
    });

  /** IQL-01 — one governance act on one exact question, spending the context the server issued. */
  const recheckJournal = async (importJobId: string) => {
    const response = await apiFetch('/ahsp/document/jobs/' + importJobId + '/recheck', {
      method: 'POST',
    });
    if (!response.ok) return null;
    return response.json().catch(() => null);
  };

  const confirmPreviewUnit = async (
    issue: { lineKey: string; occurrenceKey?: string | null },
    unitDefinitionId: string,
  ) => {
    if (!canManage || !file || !issue.occurrenceKey || !issue.lineKey) return;
    const lineNumber = Number(issue.lineKey) + 1;
    if (!Number.isInteger(lineNumber) || lineNumber < 1) return;
    let importJobId = previewIntakeJobId;
    if (!importJobId) {
      const body = new FormData();
      body.append('file', file);
      const opened = await apiFetch('/ahsp/document/intake', { method: 'POST', body });
      if (!opened.ok) {
        setImportError('Impor belum dapat ditahan untuk satuan ini. Coba lagi.');
        return;
      }
      const intake = await opened.json().catch(() => null);
      if (typeof intake?.importJobId !== 'string' || intake.importJobId === '') return;
      importJobId = intake.importJobId;
      setPreviewIntakeJobId(importJobId);
    }
    if (!importJobId) return;
    const saved = await apiFetch(
      '/ahsp/document/jobs/' + importJobId + '/lines/' + lineNumber + '/unit-decisions/' + encodeURIComponent(issue.occurrenceKey),
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitDefinitionId }),
      },
    );
    if (!saved.ok) return;
    const reviewed = await recheckJournal(importJobId);
    if (reviewed?.knowledge?.workItems && Array.isArray(reviewed.lines)) {
      setPreview((current) => {
        if (!current) return current;
        const workItems = current.workItems.slice();
        reviewed.lines.forEach((line: { lineNumber?: number }, index: number) => {
          const next = reviewed.knowledge.workItems[index];
          const at = typeof line?.lineNumber === 'number' ? line.lineNumber - 1 : -1;
          if (next && at >= 0 && at < workItems.length) workItems[at] = next as PreviewItem;
        });
        return { ...current, workItems };
      });
    }
    setUnitDoor(null);
    await loadImportJobs();
  };

  const confirmUnitDecision = async (
    job: ImportJobView,
    issue: { lineKey: string; occurrenceKey?: string | null },
    unitDefinitionId: string,
  ) => {
    if (!issue.occurrenceKey) return;
    const response = await apiFetch(
      '/ahsp/document/jobs/' + job.key + '/lines/' + issue.lineKey + '/unit-decisions/' + encodeURIComponent(issue.occurrenceKey),
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitDefinitionId }),
      },
    );
    if (!response.ok) return;
    await recheckJournal(job.key);
    setUnitDoor(null);
    await loadImportJobs();
  };

  const governQuestion = async (question: GovernedQuestionView, at: number, action: GovernanceAction) => {
    if (questionLock.current !== null || !question.token || questionsPhase === 'UNAUTHORIZED') return;
    const ticket = reads.captureAction('questions');
    // A receipt about a question is written only while this action may still write.
    const record = (outcome: ActionOutcome) => {
      if (!reads.mayApply(ticket)) return;
      setQuestionOutcomes((prev) =>
        withOutcome(prev, { key: question.questionKey, at, title: question.title, outcome }),
      );
    };
    const reason = (questionReasons[question.questionKey] ?? '').trim();
    if (action !== 'approve' && reason === '') {
      record(REASON_MISSING_OUTCOME);
      return;
    }
    questionLock.current = ticket;
    setQuestionBusy({ key: question.questionKey, action });
    try {
      try {
        const response = await apiFetch('/resource-observations/questions/' + question.questionKey + '/' + action, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            action === 'approve'
              ? { decisionContextToken: question.token }
              : { decisionContextToken: question.token, reason },
          ),
        });
        if (response.ok) {
          record(describeGovernanceSuccess(action, await response.json().catch(() => null)));
          // The reason is spent — but a reason typed after a refusal of this list is not this action's to clear.
          if (reads.mayApply(ticket)) {
            setQuestionReasons((prev) => ({ ...prev, [question.questionKey]: '' }));
          }
        } else {
          record(describeGovernanceFailure(await readApiFailure(response)));
        }
      } catch {
        record(describeGovernanceFailure(NETWORK_FAILURE));
      }
      await Promise.all([
        readAgainFor(reads, ticket, 'questions', () => loadQuestions()),
        readAgainFor(reads, ticket, 'observations', () => loadObservations()),
      ]);
    } finally {
      if (questionLock.current === ticket) {
        questionLock.current = null;
        setQuestionBusy(null);
      }
    }
  };

  /**
   * IMPORT-SEAM-05 — check an earlier import again, ONCE for all its waiting
   * items, from what SIMPROK kept of it: no file, no click per AHSP. Whatever is
   * lawful today is kept as AHSP; whatever still lacks a fact keeps waiting.
   */
  const recheckImport = async (job: ImportJobView, at: number) => {
    if (!canManage || jobLock.current !== null || importPhase === 'UNAUTHORIZED') return;
    // The historical 'Periksa ulang' calls /continue, which CAN materialize AHSP.
    // A journal-only draft must never become canonical by an ambiguous click.
    if (!window.confirm('Periksa dan simpan AHSP yang sudah memenuhi syarat? Pekerjaan yang belum siap tetap menunggu. Ini bukan pemeriksaan tanpa penyimpanan.')) return;
    const ticket = reads.captureAction('imports');
    jobLock.current = ticket;
    setJobBusy(job.key);
    // The reader's decisions on this import's possible twins travel with the
    // re-check, as a preview's travel with its commit; the server re-derives the
    // verdict and holds whatever is left undecided.
    const decisions = job.waitingItems.flatMap((item) => {
      const action = jobDecisions[jobDecisionKey(job, item)];
      return item.decisionFor && action ? [{ ...item.decisionFor, action }] : [];
    });
    // The selected OLD job already has its own persisted classification context.
    // Passing the current upload's form here could overwrite that saved truth.
    // Null instructs continueImportJob to read the job's canonical stored context.
    const assistedClassification = null;
    try {
      let outcome: ActionOutcome;
      try {
        const response = await apiFetch('/ahsp/document/jobs/' + job.key + '/continue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decisions, assistedClassification }),
        });
        outcome = response.ok
          ? describeImportRecheck((await response.json().catch(() => null))?.summary ?? null)
          : describeImportRecheckFailure(await readApiFailure(response));
        // Acted on: a spent decision never stays lit, nor rides a later re-check — but a
        // choice made after a refusal of this list is the reader's, not this re-check's.
        if (response.ok && reads.mayApply(ticket)) {
          setJobDecisions((prev) =>
            Object.fromEntries(Object.entries(prev).filter(([key]) => !key.startsWith(job.key + ':'))),
          );
        }
      } catch {
        outcome = describeImportRecheckFailure(NETWORK_FAILURE);
      }
      // What was done is recorded whatever a FAILED refresh does: a receipt is never
      // lost because the list could not be read again. A REFUSED list is another
      // matter — nothing this re-check says is put back, not even after the list returns.
      await readAgainFor(reads, ticket, 'imports', () => loadImportJobs('REFRESH'));
      if (reads.mayApply(ticket)) {
        setJobOutcomes((prev) => withOutcome(prev, { key: job.key, at, title: job.title, outcome }));
      }
      await Promise.all([
        readAgainFor(reads, ticket, 'observations', () => loadObservations('REFRESH')),
        readAgainFor(reads, ticket, 'questions', () => loadQuestions('REFRESH')),
      ]);
    } finally {
      if (jobLock.current === ticket) {
        jobLock.current = null;
        setJobBusy(null);
      }
    }
  };

  /** One explicit, scoped delete. The server checks EACH line again and
   * preserves every completed AHSP/resource; only the unfinished journal data
   * may be removed. No optimistic disappearance before server confirmation. */
  const deleteUnfinishedDraft = async (job: ImportJobView) => {
    if (!canManage || jobLock.current !== null || hasUnsavedWork || job.waitingItems.length === 0) return;
    // The user already confirmed the exact journal and count in SIMPROK's
    // own alertdialog. No deletion is attempted from opening that dialog.
    setDraftDeleteTarget(null);
    const count = job.waitingItems.length;
    const ticket = reads.captureAction('imports');
    jobLock.current = ticket;
    setJobBusy(job.key);
    if (reads.mayApply(ticket)) setDraftDeleteReceipt(null);
    try {
      const response = await apiFetch('/ahsp/document/jobs/' + job.key + '/draft', {
        method: 'DELETE',
      });
      if (!response.ok) {
        if (reads.mayApply(ticket)) {
          setDraftDeleteReceipt('Draft belum dihapus. Data telah berubah atau akses ditolak; muat ulang riwayat sebelum mencoba lagi.');
        }
        return;
      }
      const receipt = await response.json() as {
        deletedDraftItems?: number; preservedCompletedItems?: number;
      };
      if (reads.mayApply(ticket)) {
        setJobDecisions((prev) => Object.fromEntries(
          Object.entries(prev).filter(([key]) => !key.startsWith(job.key + ':')),
        ));
        setSelectedSavedImport((prev) => prev === job.key ? null : prev);
        setDraftDeleteReceipt(
          String(receipt.deletedDraftItems ?? count) + ' pekerjaan draft dihapus. ' +
          String(receipt.preservedCompletedItems ?? 0) + ' pekerjaan yang sudah tersimpan tetap aman.',
        );
      }
      await readAgainFor(reads, ticket, 'imports', () => loadImportJobs('REFRESH'));
    } catch {
      if (reads.mayApply(ticket)) {
        setDraftDeleteReceipt('Belum dapat dipastikan apakah draft dihapus. Muat ulang riwayat untuk memeriksa status sebenarnya.');
      }
    } finally {
      if (jobLock.current === ticket) {
        jobLock.current = null;
        setJobBusy(null);
      }
    }
  };

  const shownQuestions = questions.filter(isGovernedQuestionShown).map(describeGovernedQuestion);

  // Received and ready are different truths: the summary of a SAVED document
  // comes from the server's own count, never from the preview list.
  const intake = commitResult?.summary ? describeImportIntake(commitResult.summary) : null;
  // After save, the written admission is the current status. The knowledge
  // item keeps the reading from before the save.
  const currentWorkItems = (preview?.workItems ?? []).map((item) =>
    admissionShownAfterSave(item, commitResult?.written),
  );
  const previewAttention = preview
    ? describePreviewAttention(preview.workItems, { canCurate })
    : [];
  const confirmFigures = preview
    ? confirmImportFigures(settled ? currentWorkItems : (preview.workItems ?? []))
    : null;
  const focusedDoorRows = preview
    ? confirmImportDoorRows(settled ? currentWorkItems : preview.workItems ?? [], previewDetailDoor)
    : [];
  const previewIdentityRows = previewIdentityQuestions(preview?.workItems);
  const previewIdentityUses = previewIdentityRows.reduce((sum, question) => sum + question.uses, 0);
  const deletedReviewRows = preview?.workItems.filter(isDeletedIdentical) ?? [];
  const openConfirmDoor = (door: ConfirmImportDoor) => {
    setPreviewDetailDoor(door);
    setPreviewDetailOpen(true);
    if (door !== 'review') setShowAllPreviewQuestions(false);
  };
  const moveToPrimarySave = () => {
    primarySaveRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    primarySaveRef.current?.focus();
  };

  // AUTOMATION BEFORE HUMAN INTERVENTION.
  //
  // An exact identity is deterministic: SIMPROK never stores it twice, whatever
  // the reader clicks. So a document full of AHSPs SIMPROK already holds must not
  // become a wall of identical decision blocks — it is aggregated into ONE line,
  // with ONE optional action that records the "I used the existing one" provenance
  // for all of them at once. POSSIBLY items are NEVER aggregated: each carries its
  // own candidates and evidence, so each stays a separate human decision.
  // An item saved while a component's identity is pending is admitted too, so an
  // exact twin of it is just as surely already held.
  const identicalItems = (preview?.workItems ?? []).filter(
    (item) => admissionOf(item) !== 'HELD' && item.identityVerdict === 'IDENTICAL',
  );
  // Whether an existing AHSP can be adopted is decided in ONE place — the display
  // module — never re-derived here, so the two can never drift apart.
  const adoptableIdentical = identicalItems.filter(
    (item) => describeSameness(item)?.canUseExisting === true,
  );
  const deletedIdentical = identicalItems.filter(
    (item) => describeSameness(item)?.canUseExisting !== true,
  );
  // POSSIBLY items are never aggregated: each is its own comparison and its own choice.
  const possibleTwins = (preview?.workItems ?? []).flatMap((item, index) =>
    item.identityVerdict === 'POSSIBLY_IDENTICAL' ? [{ item, index }] : [],
  );
  // Count IDENTITIES, not rows: one existing AHSP quoted twice in a document is
  // still one AHSP that already exists.
  const distinctIdentities = (items: PreviewItem[]) =>
    new Set(items.map(decisionKey)).size;
  const allIdenticalAdopted =
    adoptableIdentical.length > 0 &&
    adoptableIdentical.every((item) => decisions[decisionKey(item)] === 'USE_EXISTING');
  // A real toggle, not a latch: a mis-click must be undoable without discarding
  // every other decision on the page.
  const toggleAllExisting = () =>
    setDecisions((prev) => {
      const next = { ...prev };
      for (const item of adoptableIdentical) {
        if (allIdenticalAdopted) delete next[decisionKey(item)];
        else next[decisionKey(item)] = 'USE_EXISTING';
      }
      return next;
    });

  // OUTCOMES STAY WHERE THEY HAPPENED. A decided question leaves the refreshed
  // queue; its receipt takes its place, so the reader's eye is never sent away.
  const curationEntries = placeOutcomes(groupIdenticalObservations(observations), (group) => group.key, curationOutcomes);
  const dismissCuration = (key: string) => setCurationOutcomes((prev) => prev.filter((outcome) => outcome.key !== key));

  const renderCurationGroup = (group: ObservationGroup, at: number, anchored: AnchoredOutcome | null): ReactNode => {
    const view = group.view;
    const repeated = observationOccurrenceLine(group);
    const members = group.ids.map((id) => wireById.get(id));
    // Offered, or its absence explained — from the server's own facts only.
    const learning = describeGroupLearning(members, view);
    const correctedHere = members.some((member) => member?.reviewedName && member.reviewedName !== member.rawName);
    // A spelling correction belongs to ONE observation; do not teach it globally.
    const mayRemember = learning.offered && !correctedHere;
    const remember = mayRemember && rememberFor[group.key] === true;
    const locked = curationBusy !== null || nameReviewBusy;
    const busyOn = (action: string) => curationBusy?.key === group.key && curationBusy.action === action;
    const blockedReasonId = 'ahsp-new-blocked-' + at;
    // CALM PAGE, CLEAR ACTIONS. Each question shows what it IS, the evidence a
    // decision needs, and the decisions themselves. Everything that explains
    // rather than decides — how the row was understood, what was ruled out, the
    // standing guidance — waits behind one quiet door, said once per question
    // instead of read again in every group.
    const reasonOpen = openCurationReason[group.key] === true;
    const reasonId = 'ahsp-curation-reason-' + at;
    return (
      <li key={group.key} aria-label={'Tinjau ' + view.title} className="ahsp-curation-item">
        <span className="ahsp-curation-item__title">{view.title}</span>
        {/* C2 — WHERE THIS COMPONENT CAME FROM, beside the buttons that settle it.
            A bare "Pekerja (Jam)" is not answerable; the work item that quoted it
            is what makes the question a question. Shown for all three outcomes,
            because "more than one work item quotes this" and "we cannot trace it"
            are things the person deciding is entitled to know BEFORE deciding. */}
        <span
          className={
            view.workContext.kind === 'FOUND'
              ? 'ahsp-line'
              : 'ahsp-line ahsp-line--abu'
          }
          style={view.workContext.kind === 'FOUND' ? { color: MUTED } : undefined}
        >
          {view.workContext.line}
          {view.workContext.detail ? ` (${view.workContext.detail})` : ''}
        </span>
        {/* Said plainly, because one click will answer for all of them. */}
        {repeated ? <span className="ahsp-line" style={{ color: MUTED }}>{repeated}</span> : null}
        {/* Only append/read the correction of the addressed observation, not the group. */}
        {group.ids.map((observationId) => (
          <ObservedNameReviewPanel
            key={observationId}
            observationId={observationId}
            onBusyChange={(busy) => {
              nameReviewBusyOwners.current = nextBusyNameReviewOwners(
                nameReviewBusyOwners.current,
                observationId,
                busy,
              );
              setNameReviewBusyCount(nameReviewBusyOwners.current.size);
            }}
            onSaved={async () => {
              await loadObservations('REFRESH');
              setNameReviewReceipt('Koreksi nama berhasil disimpan dan dibaca kembali. Daftar telah diminta diperbarui; keputusan identitas tetap terpisah.');
            }}
          />
        ))}
        {view.candidateLine ? <span className="ahsp-line" style={{ color: MUTED }}>{view.candidateLine}</span> : null}
        {/* A decision already offered for learning is WAITING on someone else —
            that is this question's state, not an explanation, so it stays here. */}
        {learning.stateLine && learning.stateTone === 'PENDING' ? (
          <span className="ahsp-line ahsp-line--emas">{learning.stateLine}</span>
        ) : null}
        {correctedHere ? <span className="ahsp-line ahsp-line--abu">Koreksi ini berlaku hanya pada observasi tersebut, tanpa pembelajaran bersama.</span> : null}
        {mayRemember ? (
          <label className="ahsp-check">
            <input
              type="checkbox"
              checked={remember}
              disabled={locked}
              onChange={(event) => setRememberFor((prev) => ({ ...prev, [group.key]: event.target.checked }))}
            />
            <span>{IQL_COPY.remember}</span>
          </label>
        ) : null}
        {/* The label asks the reader to CONFIRM what SIMPROK found,
            and never asserts the match on SIMPROK's behalf. Only
            candidates the kernel backed with evidence it can name
            reach this list at all; a shared-word nomination is not
            rendered as a button anywhere. No candidate is styled as
            the recommended action: SIMPROK does not choose among them. */}
        {view.candidateChoices.length > 0 ? (
          <div className="ahsp-choice-list">
            {view.candidateChoices.map((choice) => {
              const busy = busyOn('existing:' + choice.resourceCatalogId);
              return (
                <button
                  key={choice.resourceCatalogId}
                  type="button"
                  className="ahsp-action ahsp-action--choice"
                  disabled={locked}
                  aria-busy={busy || undefined}
                  onClick={() => void curateExisting(group, at, choice, remember)}
                >
                  <span>{busy ? 'Menyimpan…' : 'Benar, ini sama dengan: ' + choice.name}</span>
                  <span className="ahsp-action__sub">{choice.basis}</span>
                  {choice.unprovedFacts.length > 0 ? (
                    <span className="ahsp-action__sub">Belum dinyatakan sumber: {choice.unprovedFacts.join(', ')}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}
        <div className="ahsp-new-resource">
          {view.canProposeNew && view.newUnitDefinitionId ? (
            <button
              type="button"
              className="ahsp-action ahsp-action--outline"
              disabled={locked}
              aria-busy={busyOn('new') || undefined}
              onClick={() => void curateNew(group, at, view.newUnitDefinitionId as string)}
            >
              {busyOn('new') ? 'Menyimpan…' : view.newResourceActionLabel}
            </button>
          ) : view.newResourceBlockedLine ? (
            // A door that cannot open is shown shut and explained — never a refusal waiting to happen.
            <>
              <button type="button" className="ahsp-action ahsp-action--outline" disabled aria-describedby={blockedReasonId}>
                Tetapkan sebagai sumber daya baru
              </button>
              <span id={blockedReasonId} className="ahsp-line ahsp-line--abu">{view.newResourceBlockedLine}</span>
            </>
          ) : null}
        </div>
        <div className="ahsp-action-row">
          <button
            type="button"
            className="ahsp-action ahsp-action--quiet ahsp-action--compact"
            aria-expanded={reasonOpen}
            aria-controls={reasonId}
            onClick={() => setOpenCurationReason((prev) => ({ ...prev, [group.key]: !reasonOpen }))}
          >
            {reasonOpen ? 'Sembunyikan alasan' : 'Lihat alasan'}
          </button>
        </div>
        {reasonOpen ? (
          <div id={reasonId} className="ahsp-detail">
            {/* WHAT SIMPROK UNDERSTOOD. A row can be fully understood — class,
                unit, source code — and still not be identified. */}
            <span className="ahsp-line" style={{ color: MUTED }}>{view.understanding}</span>
            {/* Nominations too weak to act on are SHOWN and never offered: hiding
                them would make SIMPROK look like it had not looked, offering them
                would make a shared word look like an answer. */}
            {view.weakPossibilityLine ? <span className="ahsp-line ahsp-line--abu">{view.weakPossibilityLine}</span> : null}
            {/* Rows the kernel RULED OUT are shown as what they are — never a button. */}
            {view.ruledOutLine ? <span className="ahsp-line ahsp-line--abu">{view.ruledOutLine}</span> : null}
            {learning.stateLine && learning.stateTone !== 'PENDING' ? (
              <span className="ahsp-line ahsp-line--abu">{learning.stateLine}</span>
            ) : null}
            <span className="ahsp-line" style={{ color: MUTED }}>{view.guidance}</span>
            {!learning.offered && learning.unavailableLine ? (
              <span className="ahsp-line ahsp-line--abu">{learning.unavailableLine}</span>
            ) : null}
          </div>
        ) : null}
        {anchored ? <ActionOutcomeNotice outcome={anchored.outcome} onDismiss={() => dismissCuration(anchored.key)} /> : null}
      </li>
    );
  };

  const renderReceipt = (anchored: AnchoredOutcome, dismiss: (key: string) => void): ReactNode => (
    <li key={'receipt-' + anchored.key} className="ahsp-curation-item">
      <ActionOutcomeNotice outcome={anchored.outcome} title={anchored.title} onDismiss={() => dismiss(anchored.key)} />
    </li>
  );

  // A long queue opens with its first questions and says how many follow; each
  // question is still one decision for every row that asks it.
  const shownCuration = curationShowAll ? curationEntries : curationEntries.slice(0, CURATION_SHOWN);
  const curationList = (
    <>
      <ul className="ahsp-curation-list">
        {shownCuration.map((entry: PlacedEntry<ObservationGroup>, at) =>
          entry.kind === 'ITEM' ? renderCurationGroup(entry.item, at, entry.outcome) : renderReceipt(entry.outcome, dismissCuration),
        )}
      </ul>
      {curationEntries.length > CURATION_SHOWN ? (
        <div className="ahsp-action-row" style={{ marginTop: 'var(--space-2)' }}>
          <button
            type="button"
            className="ahsp-action ahsp-action--quiet ahsp-action--compact"
            aria-expanded={curationShowAll}
            onClick={() => setCurationShowAll((all) => !all)}
          >
            {curationShowAll ? 'Tampilkan lebih sedikit' : 'Tampilkan ' + (curationEntries.length - CURATION_SHOWN) + ' pertanyaan lainnya'}
          </button>
        </div>
      ) : null}
    </>
  );

  const questionEntries = placeOutcomes(shownQuestions, (question) => question.questionKey, questionOutcomes);
  const dismissQuestion = (key: string) => setQuestionOutcomes((prev) => prev.filter((outcome) => outcome.key !== key));

  const renderQuestion = (question: GovernedQuestionView, at: number, anchored: AnchoredOutcome | null): ReactNode => {
    const locked = questionBusy !== null;
    const busyOn = (action: GovernanceAction) => questionBusy?.key === question.questionKey && questionBusy.action === action;
    const tone = question.tone === 'PENDING' ? EMAS : question.tone === 'EFFECTIVE' ? NAVY : ABU;
    const needsReason = question.canReject || question.canRevoke;
    return (
      <li key={question.questionKey} aria-label={'Pembelajaran ' + question.title} className="ahsp-curation-item">
        <span className="ahsp-curation-item__title">{question.title}</span>
        <span className="ahsp-line" style={{ color: tone, fontWeight: 600 }}>{question.stateLabel}</span>
        {question.answerLine ? <span className="ahsp-line" style={{ color: NAVY }}>{question.answerLine}</span> : null}
        <span className="ahsp-line" style={{ color: MUTED, marginBottom: 'var(--space-2)' }}>{question.guidance}</span>
        {needsReason ? (
          <input
            aria-label={'Alasan untuk ' + question.title}
            placeholder="Alasan (wajib untuk menolak atau mencabut)"
            value={questionReasons[question.questionKey] ?? ''}
            disabled={locked}
            onChange={(event) => setQuestionReasons((prev) => ({ ...prev, [question.questionKey]: event.target.value }))}
            style={{ ...controlBox, maxWidth: '36rem', marginBottom: 'var(--space-2)' }}
          />
        ) : null}
        <div className="ahsp-action-row ahsp-action-row--stack">
          {question.canApprove && question.token ? (
            <button type="button" className="ahsp-action ahsp-action--primary" disabled={locked} aria-busy={busyOn('approve') || undefined} onClick={() => void governQuestion(question, at, 'approve')}>
              {busyOn('approve') ? 'Menyimpan…' : 'Setujui pembelajaran'}
            </button>
          ) : null}
          {question.canReject && question.token ? (
            <button type="button" className="ahsp-action ahsp-action--outline" disabled={locked} aria-busy={busyOn('reject') || undefined} onClick={() => void governQuestion(question, at, 'reject')}>
              {busyOn('reject') ? 'Menyimpan…' : 'Tolak'}
            </button>
          ) : null}
          {question.canRevoke && question.token ? (
            <button type="button" className="ahsp-action ahsp-action--outline" disabled={locked} aria-busy={busyOn('revoke') || undefined} onClick={() => void governQuestion(question, at, 'revoke')}>
              {busyOn('revoke') ? 'Menyimpan…' : 'Cabut pembelajaran'}
            </button>
          ) : null}
        </div>
        {anchored ? <ActionOutcomeNotice outcome={anchored.outcome} onDismiss={() => dismissQuestion(anchored.key)} /> : null}
      </li>
    );
  };

  const questionList = (
    <ul className="ahsp-curation-list">
      {questionEntries.map((entry: PlacedEntry<GovernedQuestionView>, at) =>
        entry.kind === 'ITEM' ? renderQuestion(entry.item, at, entry.outcome) : renderReceipt(entry.outcome, dismissQuestion),
      )}
    </ul>
  );

  // ONE rendering of a possible twin and the decisions it offers — for a document
  // being read and for an earlier import's waiting line alike, so the two doors can
  // never offer different choices for the same verdict.
  const renderPossibleTwin = (
    sameness: SamenessView,
    chosen: SamenessDecision | undefined,
    choose: (action: SamenessDecision) => void,
    decidable: boolean,
  ): ReactNode => {
    const decisionButton = (action: SamenessDecision, label: string) => (
      <button
        type="button"
        className="ahsp-action ahsp-action--outline ahsp-action--compact"
        aria-pressed={chosen === action}
        onClick={() => choose(action)}
      >
        {label}
      </button>
    );
    return (
      <span style={{ display: 'block', marginTop: 'var(--space-1)', paddingLeft: 'var(--space-2)', borderLeft: `2px solid ${UNGU}` }}>
        <span style={{ display: 'block', fontWeight: 600, color: UNGU }}>{sameness.title}</span>
        <span style={{ display: 'block', color: MUTED }}>{sameness.guidance}</span>
        {sameness.refs.map((ref, refIndex) => (
          <span key={refIndex} style={{ display: 'block', color: MUTED }}>
            <Link to={ref.openHref} style={{ color: BLUE }}>Buka AHSP yang ada</Link>
            {`: ${ref.title}`}{ref.detail ? ` · ${ref.detail}` : ''}
          </span>
        ))}
        {/* The guidance asks the reader to compare, so never hide
            that more padanan exist than the list shows. */}
        {sameness.hiddenRefCount > 0 ? (
          <span style={{ display: 'block', color: MUTED }}>
            {`dan ${sameness.hiddenRefCount} padanan lainnya.`}
          </span>
        ) : null}
        {decidable ? (
          <span className="ahsp-action-row" style={{ marginTop: 'var(--space-1)' }}>
            {sameness.canUseExisting ? decisionButton('USE_EXISTING', 'Gunakan yang sudah ada') : null}
            {sameness.canKeepSeparate ? decisionButton('KEEP_SEPARATE', 'Simpan sebagai AHSP berbeda') : null}
            {decisionButton('SKIP', 'Lewati')}
          </span>
        ) : null}
      </span>
    );
  };

  // ONE rendering of what an import still needs — for a document being read and a
  // saved import alike: one row per question, never one per work item.
  // STAGE 2A: identity cards are ENTRY POINTS only — they open scoped curation,
  // they never curate, mint, or materialize.
  const attentionBadge = (detail: string): string | null => {
    const match = detail.match(/(\d[\d.]*)\s+pekerjaan/u) ?? detail.match(/(\d[\d.]*)\s+pertanyaan/u);
    return match ? match[0] : null;
  };
  const attentionIcon = (tone: AttentionRowView['tone']): ReactNode => {
    if (tone === 'IDENTITY' || tone === 'DECISION') {
      return <Database size={16} aria-hidden className="ahsp-attention__icon-svg" />;
    }
    if (tone === 'FAILED') {
      return <AlertTriangle size={16} aria-hidden className="ahsp-attention__icon-svg" />;
    }
    if (tone === 'UNIT' || tone === 'SOURCE' || tone === 'OTHER') {
      return <AlertTriangle size={16} aria-hidden className="ahsp-attention__icon-svg" />;
    }
    return <Info size={16} aria-hidden className="ahsp-attention__icon-svg" />;
  };
  const renderAttention = (
    rows: readonly AttentionRowView[],
    label: string,
    identityScope: Exclude<ObservationScope, null> | null,
    unitScope: { source: 'preview' | 'job'; jobKey: string | null } | null = null,
    failureJobKey: string | null = null,
  ): ReactNode =>
    rows.length > 0 ? (
      <ul className="ahsp-attention" aria-label={label}>
        {rows.map((row) => {
          const isIdentity = row.tone === 'IDENTITY' || row.key === 'identity' || row.key.startsWith('identity:');
          const previewIdentityDoor = unitScope?.source === 'preview' && !settled && isIdentity;
          const identityDoor = previewIdentityDoor || (canCurate && identityScope !== null && isIdentity);
          const unitDoorRow = unitScope !== null && row.tone === 'UNIT' && row.key.startsWith('unit:');
          const badge = attentionBadge(row.detail);
          return (
            <li key={row.key} className="ahsp-attention__row" data-tone={row.tone.toLowerCase()}>
              <span className="ahsp-attention__icon" aria-hidden>
                {attentionIcon(row.tone)}
              </span>
              {unitDoorRow ? (
                <button
                  type="button"
                  className="ahsp-action ahsp-action--quiet ahsp-attention__door"
                  onClick={() =>
                    setUnitDoor({
                      spelling: row.key.slice('unit:'.length),
                      lineKey: null,
                      source: unitScope.source,
                      jobKey: unitScope.jobKey,
                    })
                  }
                  aria-label={'Selesaikan satuan: ' + row.title}
                >
                  <span className="ahsp-attention__title">{row.title}</span>
                  <span className="ahsp-attention__detail">{row.detail}</span>
                  <span className="ahsp-attention__action">Selesaikan satuan</span>
                </button>
              ) : identityDoor ? (
                <button
                  type="button"
                  className="ahsp-action ahsp-action--quiet ahsp-attention__door"
                  onClick={() => {
                    if (previewIdentityDoor) openConfirmDoor('review');
                    else if (identityScope) void openIdentityReview(identityScope);
                  }}
                  aria-label={'Tinjau: ' + row.title}
                >
                  <span className="ahsp-attention__title">{row.title}</span>
                  <span className="ahsp-attention__detail">{row.detail}</span>
                  <span className="ahsp-attention__action">{row.actionLabel}</span>
                </button>
              ) : row.tone === 'FAILED' && row.actionLabel && failureJobKey ? (
                <button
                  type="button"
                  className="ahsp-action ahsp-action--quiet ahsp-attention__door"
                  aria-expanded={openFailureJob === failureJobKey}
                  onClick={() => setOpenFailureJob((current) => (current === failureJobKey ? null : failureJobKey))}
                  aria-label={row.actionLabel + ': ' + row.title}
                >
                  <span className="ahsp-attention__title">{row.title}</span>
                  <span className="ahsp-attention__detail">{row.detail}</span>
                  <span className="ahsp-attention__action">{row.actionLabel}</span>
                </button>
              ) : (
                <div className="ahsp-attention__body">
                  <span className="ahsp-attention__title">{row.title}</span>
                  <span className="ahsp-attention__detail">{row.detail}</span>
                </div>
              )}
              {badge ? <span className="ahsp-attention__badge">{badge}</span> : null}
            </li>
          );
        })}
      </ul>
    ) : null;

  const waitingImports = describeWaitingImports(importJobs, { canCurate });
  const selectedReviewJob = isReviewPage ? waitingImports.find((job) => job.key === reviewJobId) : null;
  const savedReviewGuide = selectedReviewJob ? nextSavedImportAction(selectedReviewJob, canCurate) : null;
  const hasEarlierWorkOrUnreadHistory =
    waitingImports.length > 0 ||
    importHasMore ||
    importPhase === 'FAILED' ||
    importPhase === 'STALE';
  const openSavedImport = (importJobId: string) => {
    if (hasUnsavedUpload || hasUnsavedPreviewChoices || hasUnsavedSavedJobChoices) return;
    setSavedImportsOpen(true);
    setSelectedSavedImport(importJobId);
    setLearningOpen(false);
    const scope: ObservationScope = { kind: 'importJobId', importJobId };
    setObservationScope(scope);
    void loadObservations('REFRESH', scope);
    navigate('/ahsp/import/review/' + encodeURIComponent(importJobId));
  };
  // The URL identifies the saved document on direct entry or refresh. The prior
  // page's temporary selection may be null: never hide the journal behind it.
  const effectiveSavedImportId = isReviewPage ? reviewJobId : selectedSavedImport;
  const jobEntries = placeOutcomes(waitingImports, (job) => job.key, jobOutcomes).filter(
    (entry) => entry.kind === 'ITEM'
      ? entry.item.key === effectiveSavedImportId
      : entry.outcome.key === effectiveSavedImportId,
  );
  const dismissJob = (key: string) => setJobOutcomes((prev) => prev.filter((outcome) => outcome.key !== key));

  // These handlers are invoked ONLY by the user's buttons, never by renderUnitWorkspace.
  // Keep the original server writers, job identity lookup, and authorization guards.
  const recheckUnitJobOnClick = () => {
    if (unitDoor?.source !== 'job' || !unitDoor.jobKey) return;
    const at = waitingImports.findIndex((job) => job.key === unitDoor.jobKey);
    const job = waitingImports[at];
    if (job) recheckImport(job, at);
  };
  const confirmUnitJobOnClick = (issue: UnitResolutionIssue, unitDefinitionId: string) => {
    if (unitDoor?.source !== 'job' || !unitDoor.jobKey) return;
    const job = waitingImports.find((item) => item.key === unitDoor.jobKey);
    if (job) void confirmUnitDecision(job, issue, unitDefinitionId);
  };

  const runExistingImportRecheck = (job: ImportJobView, at: number) => void recheckImport(job, at);

  const renderUnitWorkspace = (source: 'preview' | 'job', jobKey: string | null): ReactNode => {
    if (!unitDoor || unitDoor.source !== source) return null;
    if (source === 'job' && unitDoor.jobKey !== jobKey) return null;
    return (
      <AhspUnitResolutionPanel
        issues={
          unitDoor.source === 'preview'
            ? previewUnitIssues(preview?.workItems)
            : waitingUnitIssues(
                unitDoor.jobKey ?? '',
                waitingImports.find((job) => job.key === unitDoor.jobKey)?.waitingItems ?? [],
              )
        }
        spelling={unitDoor.spelling}
        lineKey={unitDoor.lineKey}
        onClose={() => setUnitDoor(null)}
        onRecheck={
          unitDoor.source === 'job' && unitDoor.jobKey ? recheckUnitJobOnClick : null
        }
        onConfirm={
          unitDoor.source === 'job' && unitDoor.jobKey
            ? confirmUnitJobOnClick
            : unitDoor.source === 'preview'
              ? (issue, unitDefinitionId) => {
                  void confirmPreviewUnit(issue, unitDefinitionId);
                }
              : null
        }
      />
    );
  };

  // PURPOSE â†’ STATUS â†’ WHAT IT NEEDS â†’ THE ONE ACTION â†’ DECISIONS â†’ DETAIL ON DEMAND.
  const renderImportJob = (job: ImportJobView, at: number, anchored: AnchoredOutcome | null): ReactNode => {
    const busy = jobBusy === job.key;
    const open = openJobDetails[job.key] === true;
    const allWaitingOpen = openJobAllWaiting[job.key] === true;
    const waitingDetail = job.waitingItems.filter((item) => item.sameness === null);
    const detailId = 'ahsp-import-detail-' + at;
    const decisionItems = job.waitingItems.filter((item) => item.sameness !== null);
    const recheckLabel = busy ? 'Memproses…' : 'Periksa & simpan yang siap';
    const quietRecheckLabel = busy ? 'Memproses…' : 'Periksa ulang status';
    const recheck = () => runExistingImportRecheck(job, at);
    // The blue action is emphasized only where something is worth checking again — a
    // change the server reported, a write to retry, or a decision the reader chose
    // that the check will carry. "Lewati" carries nothing, so it urges nothing. It is
    // never a promise: the server decides what moves. Elsewhere the check is offered,
    // lighter, and still one press away.
    const urged =
      job.recheckWarranted ||
      decisionItems.some((item) => {
        const chosen = jobDecisions[jobDecisionKey(job, item)];
        return chosen !== undefined && chosen !== 'SKIP';
      });
    return (
      <li key={job.key} ref={isReviewPage && job.key === reviewJobId ? savedReviewActionsRef : undefined} aria-label={'Import ' + job.title} className={isReviewPage ? 'ahsp-completion ahsp-completion--review' : 'ahsp-completion'}>
        {!isReviewPage ? <span className="ahsp-curation-item__title">{job.title}</span> : null}
        <p className="ahsp-completion__summary">{job.summaryLine}</p>
        {renderAttention(
          job.attention,
          'Yang masih dibutuhkan',
          job.key ? { kind: 'importJobId', importJobId: job.key } : null,
          { source: 'job', jobKey: job.key },
          job.key,
        )}
        {renderUnitWorkspace('job', job.key)}
        {openFailureJob === job.key ? (
          <section ref={failureSectionRef} tabIndex={-1} className="ahsp-unit-workspace" aria-label="Kegagalan penyimpanan">
            <h3 className="ahsp-section-title">Penyimpanan yang belum berhasil</h3>
            <ul className="ahsp-detail-list">
              {(job.attention.find((row) => row.key === 'failed')?.failures ?? []).map((failure) => (
                <li key={failure.code + failure.description} className="ahsp-line">
                  <span style={{ display: 'block', fontWeight: 600, color: NAVY }}>{failure.code}</span>
                  <span style={{ display: 'block' }}>{failure.description}</span>
                  <span style={{ display: 'block', color: MUTED }}>{failure.statement}</span>
                </li>
              ))}
            </ul>
            {job.canRecheck ? (
              <div className="ahsp-action-row">
                <button type="button" className="ahsp-action ahsp-action--primary" disabled={jobBusy !== null} onClick={recheck}>
                  {recheckLabel}
                </button>
              </div>
            ) : null}
          </section>
        ) : null}
        {decisionItems.length > 0 ? (
          <div className="ahsp-decisions" aria-label="Keputusan Anda">
            {decisionItems.map((item) => (
              <div key={item.key} className="ahsp-decision">
                <span className="ahsp-decision__title">{item.title}</span>
                {/* A possible twin kept from an earlier import: the same comparison and
                    the same decisions the preview offers, sent with the re-check. */}
                {item.sameness
                  ? renderPossibleTwin(
                      item.sameness,
                      jobDecisions[jobDecisionKey(job, item)],
                      (action) => setJobDecisions((prev) => ({ ...prev, [jobDecisionKey(job, item)]: action })),
                      !busy,
                    )
                  : null}
              </div>
            ))}
            {job.decisionLine ? <span className="ahsp-line" style={{ color: NAVY }}>{job.decisionLine}</span> : null}
          </div>
        ) : null}
        {isReviewPage && job.canRecheck && !urged ? (
          <p className="ahsp-import-review-action-note">Belum ada perubahan baru yang ditandai untuk disimpan. Pemeriksaan ulang meminta SIMPROK mengecek kembali status dokumen; tidak menjamin hasil tersimpan.</p>
        ) : null}
        <div className="ahsp-action-row">
          {/* One check for the whole document; shown only where there is something to check. */}
          {job.canRecheck && urged ? (
            <button type="button" className="ahsp-action ahsp-action--primary" disabled={jobBusy !== null} aria-busy={busy || undefined} onClick={recheck}>
              {recheckLabel}
            </button>
          ) : null}
          {job.canRecheck && !urged ? (
            <button type="button" className="ahsp-action ahsp-action--outline" disabled={jobBusy !== null} aria-busy={busy || undefined} onClick={recheck}>
              {isReviewPage ? quietRecheckLabel : recheckLabel}
            </button>
          ) : null}
          <button
            type="button"
            className="ahsp-action ahsp-action--quiet ahsp-action--compact"
            aria-expanded={open}
            aria-controls={detailId}
            onClick={() => setOpenJobDetails((prev) => ({ ...prev, [job.key]: !open }))}
          >
            {open ? 'Sembunyikan rincian' : 'Lihat rincian'}
          </button>
        </div>
        {open ? (
          <div id={detailId} className="ahsp-detail">
            <h3 className="ahsp-import-review-detail-title">Catatan jurnal dan pekerjaan yang masih menunggu</h3>
            <span className="ahsp-line">{job.receivedLine}</span>
            {job.canRecheck ? <span className="ahsp-line">{job.waitingLine}</span> : null}
            <ul className="ahsp-detail-list">
              {(allWaitingOpen ? waitingDetail : waitingDetail.slice(0, job.waitingShown)).map((item) => (
                <li key={item.key} className="ahsp-line">
                  {item.title} · {item.reason}
                  {item.unknownUnits.length > 0 ? (
                    <button
                      type="button"
                      className="ahsp-action ahsp-action--quiet ahsp-action--compact"
                      onClick={() => setUnitDoor({ spelling: null, lineKey: item.key, source: 'job', jobKey: job.key })}
                    >
                      Selesaikan satuan AHSP ini
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            {/* Everything stored is reachable from here — nothing is a dead end. */}
            {waitingDetail.length > job.waitingShown ? (
              <div className="ahsp-action-row">
                <button
                  type="button"
                  className="ahsp-action ahsp-action--quiet ahsp-action--compact"
                  aria-expanded={allWaitingOpen}
                  onClick={() => setOpenJobAllWaiting((prev) => ({ ...prev, [job.key]: !allWaitingOpen }))}
                >
                  {allWaitingOpen
                    ? 'Tampilkan lebih sedikit'
                    : 'Tampilkan ' + (waitingDetail.length - job.waitingShown) + ' pekerjaan lainnya'}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        {anchored ? <ActionOutcomeNotice outcome={anchored.outcome} onDismiss={() => dismissJob(anchored.key)} /> : null}
      </li>
    );
  };

  const importJobList = (
    <ul className="ahsp-curation-list" aria-label="Rincian pekerjaan terpilih">
      {jobEntries.map((entry: PlacedEntry<ImportJobView>, at) =>
        entry.kind === 'ITEM' ? renderImportJob(entry.item, at, entry.outcome) : renderReceipt(entry.outcome, dismissJob),
      )}
    </ul>
  );

  const importJobIntro = (
    <div className="ahsp-import-history-overview">
      <span>{waitingImports.length} dokumen pada halaman riwayat yang dimuat{importHasMore ? ' · masih ada riwayat lebih lama' : ''}</span>
      <span>Status impor dan kesiapan AHSP tidak selalu sama.</span>
    </div>
  );

  const curationIntro = (
    <>
      <h2 style={{ fontSize: 'var(--text-lg)', color: NAVY, margin: '0 0 var(--space-2)' }}>Sumber daya untuk ditinjau</h2>
      <p style={{ fontSize: 'var(--text-sm)', color: MUTED, margin: '0 0 var(--space-3)' }}>
        Sumber daya dari dokumen resmi yang sudah diterima serta disimpan SIMPROK; yang belum pasti hanya identitasnya dalam katalog, dan identitas itu dibutuhkan agar harganya dapat dihitung. Satu keputusan berlaku untuk semua kemunculan pertanyaan yang sama.
      </p>
    </>
  );

  const learningIntro = (
    <>
      <h2 style={{ fontSize: 'var(--text-lg)', color: NAVY, margin: '0 0 var(--space-2)' }}>Pembelajaran pertanyaan identik</h2>
      <p style={{ fontSize: 'var(--text-sm)', color: MUTED, margin: '0 0 var(--space-3)' }}>
        SIMPROK hanya memakai ulang keputusan untuk pertanyaan yang persis sama, dan hanya setelah disetujui orang lain yang berwenang.
      </p>
    </>
  );

  // Follow the existing paged, workspace-guarded import journal on a direct
  // detail link. Do not create a second API, download the whole catalogue, or
  // mistake an unloaded historical page for a missing document.
  useEffect(() => {
    if (!isReviewPage || !reviewJobId || importPhase !== 'READY' || selectedReviewJob || !canManage) return;
    let active = true;
    void (async () => {
      let pagesExamined = 0;
      while (active && pagesExamined < 8) {
        const before = scopeRef.current;
        if (describeWaitingImports(before.jobs, { canCurate }).some((job) => job.key === reviewJobId)) return;
        if (olderImportsCursor(before) === null) return;
        await loadOlderImports();
        if (!active || scopeRef.current === before || scopeRef.current.phase !== 'READY') return;
        pagesExamined++;
      }
      if (active && olderImportsCursor(scopeRef.current) !== null) {
        setReviewLookupPausedFor(reviewJobId);
      }
    })();
    return () => { active = false; };
    // Intentional one lookup per navigated document and refreshed server list.
    // The existing serialized cursor loader owns every subsequent page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewJobId, importPhase, activeWorkspaceId, canManage]);

  return (
    <main aria-label={isReviewPage ? 'Pemeriksaan dokumen AHSP' : 'Import AHSP'} className="ahsp-import-room">
      <nav aria-label="Jejak navigasi" style={{ fontSize: 'var(--text-sm)', color: MUTED, marginBottom: 'var(--space-3)' }}>
        {/* A door only for whoever may open it — the second holder may judge here, not browse AHSP. */}
        {canViewAhsp ? <Link to="/ahsp" style={{ color: MUTED, textDecoration: 'none' }}>AHSP</Link> : <span>AHSP</span>}
        <span style={{ margin: '0 var(--space-2)' }}>{'\u203A'}</span>
        {isReviewPage ? (
          <>
            <Link to="/ahsp/import" style={{ color: MUTED, textDecoration: 'none' }}>Import AHSP</Link>
            <span style={{ margin: '0 var(--space-2)' }}>{'\u203A'}</span>
            <span style={{ color: NAVY }}>Pemeriksaan dokumen</span>
          </>
        ) : <span style={{ color: NAVY }}>Import AHSP</span>}
      </nav>

      <header style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: NAVY, margin: 0 }}>
            {isReviewPage ? 'Pemeriksaan Dokumen AHSP' : 'Import AHSP'}
          </h1>
          <p style={{ fontSize: 'var(--text-sm)', color: MUTED, margin: 'var(--space-1) 0 0' }}>
            {isReviewPage ? 'Tinjau pekerjaan tersimpan dan selesaikan pertanyaan yang memerlukan keputusan Anda.' : IMPORT_JOURNEY_SUBTITLE}
          </p>
        </div>
        {isReviewPage ? (
          <Link to="/ahsp/import" className="ahsp-action ahsp-action--outline">
            <ArrowLeft size={16} /> Kembali ke Riwayat Import
          </Link>
        ) : canViewAhsp ? (
          <Link to="/ahsp" className="ahsp-action ahsp-action--outline">
            <ArrowLeft size={16} /> Kembali ke Daftar AHSP
          </Link>
        ) : null}
      </header>

      {!canManage && !canCurate ? (
        <section className="simprok-honest-frame" role="alert" aria-label="Import tidak tersedia">
          <span className="simprok-honest-frame__badge">Tidak tersedia</span>
          <p>Workspace aktif Anda tidak memiliki kewenangan untuk mengimpor atau meninjau AHSP.</p>
        </section>
      ) : null}

      {/* Upload -> Pahami dokumen -> Simpan hasil import -> Import selesai */}
      {canManage && !isReviewPage ? (
        <section aria-label="Unggah dan pahami dokumen" className="ahsp-import-upload" style={{ ...CARD, marginBottom: 'var(--space-4)' }}>
          <input
            ref={fileInputRef}
            id="ahsp-import-file"
            type="file"
            accept=".xlsx"
            aria-label="Berkas AHSP resmi"
            disabled={draftBusy || importing}
            className="ahsp-import-upload__native"
            onChange={(event) => {
              // A new file must not silently erase an unfinished preview and choices.
              if (preview && (hasUnsavedUpload || hasUnsavedPreviewChoices)) {
                setImportError('Dokumen lama masih mempunyai perubahan sementara. Simpan sebagai draft atau keluar tanpa menyimpan sebelum mengganti berkas.');
                if (fileInputRef.current) fileInputRef.current.value = '';
                return;
              }
              reads.changeDocument();
              setFile(event.target.files?.[0] ?? null);
              setDraftSaved(false);
              setDraftReceipt(null);
              setSavedImportsOpen(false);
              setSelectedSavedImport(null);
              setLearningOpen(false);
              forgetDocument();
            }}
          />
          {!file ? (
            <label htmlFor="ahsp-import-file" className="ahsp-import-file-card ahsp-import-file-card--empty">
              <span className="ahsp-import-file-card__icon" aria-hidden>xlsx</span>
              <span className="ahsp-import-file-card__body">
                <strong>Pilih berkas AHSP</strong>
                <span>Unggah dokumen resmi (.xlsx). Mesin pembacaan tidak berubah.</span>
              </span>
              <span className="ahsp-action ahsp-action--outline ahsp-action--compact">Pilih berkas</span>
            </label>
          ) : (
            <div className="ahsp-import-file-card ahsp-import-file-card--ready">
              <span className="ahsp-import-file-card__icon" aria-hidden>xlsx</span>
              <span className="ahsp-import-file-card__body">
                <strong>{file.name}</strong>
                <span>
                  {(file.size / (1024 * 1024)).toFixed(2)} MB
                  {preview?.workItems?.length
                    ? ` · ${preview.workItems.length} pekerjaan terdeteksi`
                    : ' · siap dibaca'}
                </span>
                {preview ? <span className="ahsp-import-file-card__status">File siap diproses</span> : null}
              </span>
              <label htmlFor="ahsp-import-file" className="ahsp-action ahsp-action--outline ahsp-action--compact">
                Ganti File
              </label>
            </div>
          )}
          <div className="ahsp-action-row ahsp-action-row--stack" style={{ marginTop: 'var(--space-3)' }}>
            <button type="button" className="ahsp-action ahsp-action--primary" disabled={!file || importing || draftBusy} aria-busy={importAction === 'PREVIEW' || undefined} onClick={() => void previewDocument()}>
              {importAction === 'PREVIEW' ? 'Membaca…' : 'Pahami dokumen'}
            </button>
            {file && !settled ? (
              <button
                type="button"
                className="ahsp-action ahsp-action--outline"
                disabled={draftBusy || importing || draftSaved}
                aria-busy={draftBusy || undefined}
                onClick={() => void saveAsDraft()}
              >
                {draftBusy ? 'Menyimpan draft…' : draftSaved ? 'Draft tersimpan' : 'Simpan sebagai draft'}
              </button>
            ) : null}
            {file && !settled ? (
              <button
                type="button"
                className="ahsp-action ahsp-action--quiet"
                disabled={draftBusy || importing}
                onClick={() => {
                  // Cancel only the current local selection. A saved intake journal
                  // or existing canonical AHSP is never deleted by this action.
                  if (preview && !window.confirm('Batalkan pekerjaan pada berkas ini? Perubahan sementara yang belum tersimpan akan hilang. Catatan yang sudah tersimpan di SIMPROK tetap ada.')) return;
                  reads.changeDocument();
                  forgetDocument();
                  setFile(null);
                  setDraftSaved(false);
                  setDraftReceipt(null);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
              >
                {draftSaved ? 'Tutup dokumen ini (draft tetap tersimpan)' : 'Batalkan import baru'}
              </button>
            ) : null}
          </div>
          {file && !settled ? (
            <p className="ahsp-line ahsp-line--abu">
              Draft menyimpan berkas sumber dan jurnal pembacaan ke SIMPROK, tanpa menjadikannya AHSP siap digunakan.
              Pilihan kesamaan yang belum dikomit perlu diperiksa kembali saat melanjutkan.
            </p>
          ) : null}
          {draftReceipt ? (
            <p role="status" className="ahsp-line" style={{ color: draftSaved ? '#24513A' : RED }}>
              {draftReceipt}
            </p>
          ) : null}
          {preview && !settled ? (
            <ol
              aria-label="Langkah import AHSP"
              style={{
                display: 'flex',
                gap: 'var(--space-3)',
                listStyle: 'none',
                padding: 0,
                margin: 'var(--space-3) 0 0',
                flexWrap: 'wrap',
                fontSize: 'var(--text-sm)',
                color: MUTED,
              }}
            >
              <li style={{ color: BLUE, fontWeight: 600 }}>1. Unggah (selesai)</li>
              <li style={{ color: journeyStep === 'classify' ? BLUE : NAVY, fontWeight: journeyStep === 'classify' ? 600 : 400 }}>
                2. Klasifikasi{journeyStep === 'confirm' || settled ? ' (selesai)' : ''}
              </li>
              <li style={{ color: journeyStep === 'confirm' ? BLUE : MUTED, fontWeight: journeyStep === 'confirm' ? 600 : 400 }}>
                3. Tinjau &amp; Simpan
              </li>
            </ol>
          ) : null}
          {importError ? <p role="alert" style={{ color: RED, fontSize: 'var(--text-sm)' }}>{importError}</p> : null}
          {/* What a SAVED document now is, beside the button that saved it. */}
          {intake ? (
            <div role="status" aria-label="Hasil import" style={{ marginTop: 'var(--space-3)' }}>
              <p style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--text-sm)', fontWeight: 600, color: NAVY }}>{intake.headline}</p>
              <dl className="ahsp-intake-figures">
                {intake.figures.map((figure) => (
                  <div key={figure.label} className="ahsp-intake-figure">
                    <dt>{figure.label}</dt>
                    <dd>{figure.value}</dd>
                  </div>
                ))}
              </dl>
              {intake.details.map((line) => (
                <span key={line} className="ahsp-line" style={{ color: MUTED }}>{line}</span>
              ))}
            </div>
          ) : null}
          {preview && journeyStep === 'classify' ? (
            <div className="ahsp-completion ahsp-completion--preview">
              <AhspImportAssistedClassificationPanel
                enabled={canManage && !settled}
                prefillDasarAcuan={preview.document?.regulationReference?.raw ?? null}
                value={assistedClassification}
                onChange={(next) => {
                  setDraftSaved(false);
                  setAssistedClassification(next);
                }}
              />
              {intake ? null : (
                <section className="ahsp-ringkasan" aria-label="Ringkasan hasil analisis">
                  <header className="ahsp-ringkasan__header">
                    <h3 className="ahsp-section-title ahsp-ringkasan__title">
                      <Sparkles size={16} aria-hidden className="ahsp-ringkasan__spark" />
                      Ringkasan hasil analisis
                    </h3>
                    <span className="ahsp-ringkasan__count">
                      {preview.workItems.length} pekerjaan terdeteksi
                    </span>
                  </header>
                  <p className="ahsp-completion__summary">{previewIntakeLine(preview.workItems)}</p>
                  {renderAttention(
                    previewAttention,
                    'Yang perlu diperhatikan',
                    typeof preview.source?.contentDigestSha256 === 'string' &&
                      /^[0-9a-fA-F]{64}$/.test(preview.source.contentDigestSha256)
                      ? { kind: 'sourceSha256', sourceSha256: preview.source.contentDigestSha256 }
                      : null,
                    { source: 'preview', jobKey: null },
                  )}
                </section>
              )}
              {intake ? null : renderUnitWorkspace('preview', null)}
              {adoptableIdentical.length > 0 ? (
                <p style={{ margin: '0 0 var(--space-2)', paddingLeft: 'var(--space-2)', borderLeft: `2px solid ${NAVY}`, color: NAVY }}>
                  <span style={{ fontWeight: 600 }}>{identicalAggregateLine(distinctIdentities(adoptableIdentical))}</span>
                  {settled ? null : (
                    <button
                      type="button"
                      className="ahsp-action ahsp-action--outline ahsp-action--compact"
                      aria-pressed={allIdenticalAdopted}
                      onClick={toggleAllExisting}
                      style={{ marginLeft: 'var(--space-2)' }}
                    >
                      Gunakan yang sudah ada
                    </button>
                  )}
                </p>
              ) : null}
              {deletedIdentical.length > 0 ? (
                <div className="ahsp-deleted-review-notice" role="status">
                  <p>{identicalDeletedAggregateLine(distinctIdentities(deletedIdentical))} Pekerjaan ini memerlukan pemeriksaan riwayat; tidak boleh dianggap aktif atau dipulihkan otomatis.</p>
                  <button type="button" className="ahsp-action ahsp-action--outline ahsp-action--compact" onClick={() => {
                    setJourneyStep('confirm');
                    openConfirmDoor('review');
                  }}>
                    Periksa {distinctIdentities(deletedIdentical)} AHSP yang dihapus
                  </button>
                </div>
              ) : null}
              {possibleTwins.length > 0 ? (
                <div className="ahsp-decisions" aria-label="Kemungkinan sama dengan AHSP yang sudah ada">
                  {possibleTwins.map(({ item, index }) => {
                    const sameness = describeSameness(item);
                    if (!sameness) return null;
                    const admission = admissionOf(item);
                    const decidable = admission !== 'HELD' && !settled;
                    return (
                      <div key={index} className="ahsp-decision">
                        <span className="ahsp-decision__title">{item.workType?.raw ?? '—'} — {item.methodName?.raw ?? '—'}</span>
                        {renderPossibleTwin(
                          sameness,
                          decisions[decisionKey(item)],
                          (action) => setDecision(item, action),
                          decidable,
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : null}
              <div className="ahsp-action-row" style={{ marginTop: 'var(--space-4)', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="ahsp-action ahsp-action--primary"
                  disabled={settled}
                  onClick={() => {
                    setUnitDoor({ spelling: null, lineKey: null, source: 'preview', jobKey: null });
                    setJourneyStep('confirm');
                  }}
                >
                  Lanjutkan ke Tinjauan {'\u2192'}
                </button>
              </div>
            </div>
          ) : null}
          {preview && journeyStep === 'confirm' ? (
            <div className="ahsp-completion ahsp-completion--confirm" aria-label="Konfirmasi Hasil Import">
              <header style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-3)' }}>
                <div>
                  <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: MUTED }}>
                    AHSP {'\u203A'} Import AHSP {'\u203A'} Konfirmasi Hasil Import
                  </p>
                  <h2 style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--text-xl)', color: NAVY }}>Konfirmasi Hasil Import</h2>
                </div>
                <div className="ahsp-action-row">
                  <button
                    type="button"
                    className="ahsp-action ahsp-action--outline"
                    disabled={importing}
                    onClick={() => setJourneyStep('classify')}
                  >
                    <ArrowLeft size={16} /> Kembali ke Klasifikasi &amp; Konteks
                  </button>
                  <button
                    type="button"
                    className="ahsp-action ahsp-action--primary"
                    ref={primarySaveRef}
                    disabled={!file || importing || settled}
                    aria-busy={importAction === 'COMMIT' || undefined}
                    onClick={() => void commitDocument()}
                  >
                    {importAction === 'COMMIT' ? 'Menyimpan…' : 'Simpan Hasil Import'}
                  </button>
                  {settled && commitResult?.importJobId ? (
                    <button
                      type="button"
                      className="ahsp-action ahsp-action--primary"
                      onClick={() => navigate('/ahsp/import/review/' + encodeURIComponent(commitResult.importJobId!))}
                    >Buka Pemeriksaan Dokumen</button>
                  ) : null}
                </div>
              </header>
              {confirmFigures ? (
                <>
                  <div className="ahsp-confirm-summary" aria-label="Ringkasan konfirmasi import">
                    <button
                      type="button"
                      className="ahsp-action ahsp-action--quiet ahsp-confirm-summary__card ahsp-confirm-summary__card--understood"
                      onClick={() => openConfirmDoor('understood')}
                      aria-expanded={previewDetailOpen && previewDetailDoor === 'understood'}
                    >
                      <span className="ahsp-confirm-summary__icon" aria-hidden>
                        <CheckCircle2 size={22} />
                      </span>
                      <span className="ahsp-confirm-summary__body">
                        <span className="ahsp-confirm-summary__value">{confirmFigures.understood} AHSP dipahami</span>
                        <span className="ahsp-confirm-summary__hint">Dari pekerjaan yang dikenali dalam dokumen.</span>
                        <span className="ahsp-confirm-summary__action">Buka rincian</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="ahsp-action ahsp-action--quiet ahsp-confirm-summary__card ahsp-confirm-summary__card--existing"
                      onClick={() => openConfirmDoor('existing')}
                      aria-expanded={previewDetailOpen && previewDetailDoor === 'existing'}
                    >
                      <span className="ahsp-confirm-summary__icon" aria-hidden>
                        <Database size={22} />
                      </span>
                      <span className="ahsp-confirm-summary__body">
                        <span className="ahsp-confirm-summary__value">{confirmFigures.already} AHSP masih ada</span>
                        <span className="ahsp-confirm-summary__hint">Tersimpan dan belum tentu siap digunakan. Tidak dibuat duplikat.</span>
                        <span className="ahsp-confirm-summary__action">Buka rincian</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="ahsp-action ahsp-action--quiet ahsp-confirm-summary__card ahsp-confirm-summary__card--will-save"
                      onClick={() => openConfirmDoor('willSave')}
                      aria-expanded={previewDetailOpen && previewDetailDoor === 'willSave'}
                    >
                      <span className="ahsp-confirm-summary__icon" aria-hidden>
                        <FileText size={22} />
                      </span>
                      <span className="ahsp-confirm-summary__body">
                        <span className="ahsp-confirm-summary__value">{confirmFigures.willSave} AHSP baru</span>
                        <span className="ahsp-confirm-summary__hint">Disimpan dari dokumen; siap digunakan hanya bila seluruh faktanya terbukti.</span>
                        <span className="ahsp-confirm-summary__action">Buka rincian</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="ahsp-action ahsp-action--quiet ahsp-confirm-summary__card ahsp-confirm-summary__card--review"
                      onClick={() => openConfirmDoor('review')}
                      aria-expanded={previewDetailOpen && previewDetailDoor === 'review'}
                    >
                      <span className="ahsp-confirm-summary__icon" aria-hidden>
                        <AlertTriangle size={22} />
                      </span>
                      <span className="ahsp-confirm-summary__body">
                        <span className="ahsp-confirm-summary__value">{confirmFigures.needsReview} perlu penanganan</span>
                        <span className="ahsp-confirm-summary__hint">Termasuk {confirmFigures.deleted} AHSP terhapus. Pertanyaan identitas dihitung terpisah.</span>
                        <span className="ahsp-confirm-summary__action">Buka rincian</span>
                      </span>
                    </button>
                  </div>
                  {confirmFigures.cannotSave > 0 ? (
                    <p className="ahsp-confirm-held" role="status">
                      {confirmFigures.cannotSave} belum dapat disimpan — menunggu fakta atau keputusan yang menahan penerimaan.
                    </p>
                  ) : null}
                </>
              ) : null}
              <div className="ahsp-confirm-panels">
                <section className="ahsp-confirm-panel ahsp-confirm-panel--save">
                  <h3 className="ahsp-section-title">{confirmFigures?.willSave === 0 ? 'Tidak ada induk AHSP baru' : 'Apa yang akan disimpan'}</h3>
                  {confirmFigures?.willSave === 0 ? <p className="ahsp-line ahsp-line--abu">Tidak ada calon induk AHSP baru. {confirmFigures.deleted} identitas cocok dengan AHSP terhapus sehingga belum dapat digunakan atau dipulihkan otomatis. {confirmFigures.already} AHSP masih tersimpan, tetapi kesiapan resepnya harus dibuktikan secara terpisah.</p> : null}
                  <ul className="ahsp-confirm-checklist">
                    <li>Identitas AHSP dari dokumen</li>
                    <li>Klasifikasi &amp; konteks yang Anda pilih</li>
                    <li>Formula tenaga, bahan, dan peralatan</li>
                    <li>Dasar / acuan dan penerbit (bila diisi)</li>
                    <li>Status AHSP yang sudah ada (tanpa duplikasi)</li>
                  </ul>
                </section>
                <section className="ahsp-confirm-panel ahsp-confirm-panel--review">
                  <h3 className="ahsp-section-title ahsp-confirm-panel__review-title">Yang masih perlu ditinjau</h3>
                  {previewAttention.length === 0 ? (
                    <p className="ahsp-line ahsp-line--abu">Tidak ada perhatian khusus pada preview ini.</p>
                  ) : (
                    renderAttention(
                      previewAttention,
                      'Perhatian dari pembacaan dokumen',
                      typeof preview.source?.contentDigestSha256 === 'string' &&
                        /^[0-9a-fA-F]{64}$/.test(preview.source.contentDigestSha256)
                        ? { kind: 'sourceSha256', sourceSha256: preview.source.contentDigestSha256 }
                        : null,
                      { source: 'preview', jobKey: null },
                    )
                  )}
                  {renderUnitWorkspace('preview', null)}
                  {previewIdentityRows.length > 0 ? (
                    <p className="ahsp-line" role="status">
                      {previewIdentityRows.length} pertanyaan identitas sumber daya mewakili {previewIdentityUses} kemunculan. Angka ini berbeda dari jumlah AHSP yang ditahan pada ringkasan.
                    </p>
                  ) : null}
                  <p className="ahsp-confirm-info-strip" role="note">
                    <Info size={16} aria-hidden />
                    <span>
                      {(confirmFigures?.deleted ?? 0) > 0 && (confirmFigures?.willSave ?? 0) === 0
                        ? 'Dokumen dapat disimpan sebagai catatan impor, tetapi AHSP yang sudah dihapus tidak otomatis dipulihkan atau siap digunakan. Pertanyaan identitas tetap perlu diselesaikan.'
                        : 'Dokumen dapat disimpan tanpa menduplikasi induk AHSP. Peninjauan dapat dilanjutkan setelah penyimpanan tanpa mengunggah ulang berkas.'}
                    </span>
                  </p>
                </section>
              </div>
              {previewDetailOpen ? (
                <div id="ahsp-confirm-focus" ref={confirmDetailRef} tabIndex={-1} className="ahsp-confirm-focus">
                  <div className="ahsp-confirm-focus__header">
                    <h3 className="ahsp-section-title">
                      {previewDetailDoor === 'understood' ? 'AHSP yang dipahami' :
                        previewDetailDoor === 'existing' ? 'AHSP yang masih tersimpan' :
                        previewDetailDoor === 'willSave' ? 'Calon AHSP baru' : 'AHSP terhapus dan pertanyaan identitas'}
                    </h3>
                    <button type="button" className="ahsp-action ahsp-action--quiet ahsp-action--compact" onClick={() => setPreviewDetailOpen(false)}>Tutup rincian</button>
                  </div>
                  <p className="ahsp-line ahsp-line--abu">{focusedDoorRows.length} pekerjaan sesuai kartu yang dipilih. Rincian pekerjaan ada pada tabel di bawah.</p>
                  {previewDetailDoor === 'review' && deletedReviewRows.length > 0 ? <p className="ahsp-line" role="status">{deletedReviewRows.length} pekerjaan identik dengan AHSP yang sudah dihapus. Tidak dapat digunakan, disimpan sebagai induk duplikat, atau dipulihkan otomatis. Lihat rinciannya pada tabel di bawah; pemulihan membutuhkan tindakan sah terpisah.</p> : null}
                  {previewDetailDoor === 'review' ? (
                    <section aria-label="Pertanyaan identitas dari dokumen" className="ahsp-preview-identity">
                      <h4>Pertanyaan identitas sumber daya yang belum terbukti</h4>
                      {previewIdentityRows.length > 0 ? (
                        <>
                          <p>{previewIdentityRows.length} pertanyaan identitas berbeda, {previewIdentityUses} kemunculan. Ini hasil pembacaan dokumen, bukan keputusan tersimpan.</p>
                          <ul>
                            {previewIdentityRows.slice(0, showAllPreviewQuestions ? undefined : 12).map((question) => (
                              <li key={JSON.stringify([question.group, question.name, question.code, question.unit])}>
                                <strong>{question.name}</strong>
                                <span>{question.group} · Kode {question.code ?? '—'} · Satuan {question.unit ?? '—'} · {question.uses} kemunculan</span>
                              </li>
                            ))}
                          </ul>
                          {previewIdentityRows.length > 12 ? (
                            <button type="button" className="ahsp-action ahsp-action--quiet ahsp-action--compact" onClick={() => setShowAllPreviewQuestions((shown) => !shown)}>
                              {showAllPreviewQuestions ? 'Tampilkan lebih sedikit' : 'Tampilkan semua ' + previewIdentityRows.length + ' pertanyaan'}
                            </button>
                          ) : null}
                          {!settled ? (
                            <div className="ahsp-preview-identity__next">
                              <p>Ini belum menjadi keputusan identitas. Simpan dokumen melalui aksi resmi, lalu buka Pemeriksaan Dokumen untuk menyelesaikan pertanyaan tanpa mengunggah ulang.</p>
                              <button type="button" className="ahsp-action ahsp-action--primary" onClick={moveToPrimarySave}>Ke tombol Simpan Hasil Import</button>
                            </div>
                          ) : commitResult?.importJobId ? (
                            <button type="button" className="ahsp-action ahsp-action--primary" onClick={() => navigate('/ahsp/import/review/' + encodeURIComponent(commitResult.importJobId!))}>Buka Penyelesaian Dokumen Tersimpan</button>
                          ) : null}
                        </>
                      ) : <p>Tidak ada pertanyaan identitas yang terdeteksi dari pembacaan saat ini.</p>}
                    </section>
                  ) : null}
                </div>
              ) : null}
              <div className="ahsp-confirm-detail-bar">
                <button
                  type="button"
                  className="ahsp-action ahsp-action--quiet ahsp-action--compact"
                  aria-expanded={previewDetailOpen}
                  aria-controls="ahsp-preview-detail"
                  onClick={() => setPreviewDetailOpen((open) => !open)}
                >
                  {previewDetailOpen ? 'Sembunyikan rincian' : 'Lihat rincian ' + preview.workItems.length + ' pekerjaan'}
                </button>
              </div>
            </div>
          ) : null}
          {preview && (journeyStep === 'classify' || journeyStep === 'confirm') && previewDetailOpen ? (
              journeyStep === 'confirm' ? (
                <div id="ahsp-preview-detail" className="ahsp-confirm-table-wrap">
                  <h3 className="ahsp-section-title">Daftar Hasil Import</h3>
                  <table className="ahsp-confirm-table" aria-label="Daftar hasil import">
                    <thead>
                      <tr>
                        <th>Jenis Pekerjaan</th>
                        <th>Uraian</th>
                        <th>Satuan Output</th>
                        <th>Kondisi Import</th>
                      </tr>
                    </thead>
                    <tbody>
                      {focusedDoorRows.map(({ item, index }) => {
                        const admission = admissionOf(item);
                        const genuineNew = workItemHasGenuineNewOnly(item);
                        const condition =
                          admission === 'HELD'
                            ? { label: 'Perlu tinjauan', tone: 'review' as const }
                            : isDeletedIdentical(item)
                              ? { label: 'Terhapus — perlu pemeriksaan', tone: 'review' as const }
                            : item.identityVerdict === 'IDENTICAL'
                              ? { label: 'Masih tersimpan', tone: 'existing' as const }
                              : genuineNew
                                ? { label: 'Resource baru — akan ditambahkan', tone: 'new' as const }
                                : admission === 'PROVEN'
                                  ? { label: 'Baru', tone: 'new' as const }
                                  : { label: 'Perlu tinjauan', tone: 'review' as const };
                        return (
                          <tr key={index}>
                            <td>{item.workType?.raw ?? '—'}</td>
                            <td>{item.methodName?.raw ?? '—'}</td>
                            <td>{item.resolvedOutputUnit ?? item.outputUnitRaw?.raw ?? '—'}</td>
                            <td>
                              <span className={'ahsp-condition-badge ahsp-condition-badge--' + condition.tone}>
                                {condition.label}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
              <ul id="ahsp-preview-detail" className="ahsp-detail-list">
                {preview.workItems.map((item, index) => {
                  const admission = admissionOf(item);
                  const genuineNew = workItemHasGenuineNewOnly(item);
                  const knownNames = (item.resources ?? [])
                    .filter((resource) => resource.resolvedResourceCatalogId && resource.rawName)
                    .map((resource) => resource.rawName as string);
                  const candidateNames = admission === 'PROVEN' ? [] : previewCandidateNames(item.resources);
                  // Rows the kernel ruled out are said as NOT used — never as possible matches.
                  const ruledOutLine = admission === 'PROVEN' ? null : previewRuledOutLine(previewRuledOutNames(item.resources));
                  return (
                    <li key={index} style={{ marginBottom: 'var(--space-2)', overflowWrap: 'anywhere' }}>
                      {item.workType?.raw ?? '—'} — {item.methodName?.raw ?? '—'}
                      {previewUnitIssues(preview.workItems).some((issue) => issue.lineKey === String(index)) ? (
                        <button
                          type="button"
                          className="ahsp-action ahsp-action--quiet ahsp-action--compact"
                          onClick={() => setUnitDoor({ spelling: null, lineKey: String(index), source: 'preview', jobKey: null })}
                        >
                          Selesaikan satuan AHSP ini
                        </button>
                      ) : null}
                      {admission === 'HELD'
                        ? ` · ${explainWaitingItemReasons(item.reasonCodes)}`
                        : item.identityVerdict === 'IDENTICAL'
                          // Admitted, but it will NOT be written — it already exists. Saying
                          // "siap digunakan" here would promise a save that never happens.
                          ? ' · sudah ada di SIMPROK'
                          : genuineNew
                            ? ` · ${NEW_RESOURCE_CONFIRM_LINE}`
                            : admission === 'PROVEN'
                              ? ' · siap digunakan'
                              : ` · ${IDENTITY_PENDING_ITEM_LINE}`}
                      {knownNames.length > 0 ? (
                        <span style={{ display: 'block', color: MUTED }}>
                          {EXISTING_RESOURCE_LINE}: {knownNames.join(', ')}
                        </span>
                      ) : null}
                      {candidateNames.length > 0 ? (
                        // ACG-01.1 U1 — the preview knows the NAMES SIMPROK found, never how
                        // strong the evidence was. The queue below can tell a confirmable row
                        // from a shared word and says so; here that distinction does not exist
                        // yet, so the line stays neutral: something to look at, not a match.
                        <span style={{ display: 'block', color: MUTED }}>
                          Kemungkinan yang masih perlu diperiksa: {candidateNames.slice(0, 4).join(', ')}
                          {candidateNames.length > 4 ? `, dan ${candidateNames.length - 4} lainnya` : ''}. Simpan untuk meninjaunya di bawah.
                        </span>
                      ) : null}
                      {ruledOutLine ? <span style={{ display: 'block', color: ABU }}>{ruledOutLine}</span> : null}
                      {(() => {
                        // An item can be an exact twin of an AHSP SIMPROK already holds while
                        // its own components are still uncurated — the ordinary first import
                        // of an official document. So the reference is ALWAYS shown.
                        const sameness = describeSameness(item);
                        if (!sameness) return null;
                        if (sameness.verdict === 'IDENTICAL') {
                          // Spoken once, above, for all of them. Here only the door to the
                          // AHSP that already exists — and the deleted note when it applies,
                          // because that one IS exceptional and must be said.
                          return (
                            <span style={{ display: 'block', marginTop: 'var(--space-1)', paddingLeft: 'var(--space-2)', borderLeft: `2px solid ${NAVY}` }}>
                              {sameness.refs.map((ref, refIndex) => (
                                <span key={refIndex} style={{ display: 'block', color: MUTED }}>
                                  {/* A deleted AHSP has no room to open — naming it in
                                      plain abu is honest; a full-colour door would land
                                      on a record the detail route no longer returns. */}
                                  {ref.deleted ? (
                                    <span>AHSP yang cocok</span>
                                  ) : (
                                    <Link to={ref.openHref} style={{ color: BLUE }}>Buka AHSP yang ada</Link>
                                  )}
                                  {`: ${ref.title}`}{ref.detail ? ` · ${ref.detail}` : ''}
                                </span>
                              ))}
                              {sameness.refs.some((ref) => ref.deleted) ? (
                                <span style={{ display: 'block', color: MUTED }}>{sameness.guidance}</span>
                              ) : null}
                            </span>
                          );
                        }
                        return <span style={{ display: 'block', color: MUTED }}>Perbandingannya ditampilkan di atas.</span>;
                      })()}
                    </li>
                  );
                })}
              </ul>
              )
          ) : null}
        </section>
      ) : null}

      {/* Earlier imports are visible as a CHOICE, never opened as the new upload. */}
      {canManage && !isReviewPage ? (
        <section aria-label="Pekerjaan import sebelumnya" style={{ ...CARD, marginBottom: 'var(--space-4)' }}>
          <div className="ahsp-import-history-topline">
            <div>
              <h2 style={{ fontSize: 'var(--text-lg)', color: NAVY, margin: 0 }}>
                {savedImportsOpen ? 'Riwayat dokumen AHSP' : 'Pekerjaan import sebelumnya'}
              </h2>
              <p className="ahsp-line" style={{ color: MUTED }}>
                {savedImportsOpen
                  ? 'Pilih dokumen untuk memeriksa detailnya pada halaman tersendiri.'
                  : 'Buka daftar dokumen yang pernah dicatat SIMPROK tanpa mengunggah ulang.'}
              </p>
            </div>
            {hasEarlierWorkOrUnreadHistory && importPhase === 'READY' ? (
              <span className="ahsp-import-history-count">{waitingImports.length}{importHasMore ? '+' : ''} dokumen</span>
            ) : null}
          </div>
          <button
            type="button"
            className="ahsp-action ahsp-action--outline"
            aria-expanded={savedImportsOpen}
            aria-controls="ahsp-saved-imports"
            disabled={hasUnsavedUpload || hasUnsavedPreviewChoices || hasUnsavedSavedJobChoices}
            onClick={() => {
              setSavedImportsOpen((value) => !value);
              setSelectedSavedImport(null);
              setLearningOpen(false);
              setObservationScope(null);
            }}
          >
            {savedImportsOpen ? 'Tutup pekerjaan sebelumnya' : 'Lihat pekerjaan tersimpan'}
            {importPhase === 'READY' ? ` (${waitingImports.length}${importHasMore ? '+' : ''})` : ''}
          </button>
          {hasUnsavedUpload ? (
            <p className="ahsp-line ahsp-line--abu">
              Selesaikan, simpan sebagai draft, atau tinggalkan pekerjaan baru sebelum membuka pekerjaan lama.
            </p>
          ) : null}
          {savedImportsOpen ? (
            <div id="ahsp-saved-imports" style={{ marginTop: 'var(--space-3)' }}>
              {importJobIntro}
              <ReadNotice
                phase={importPhase}
                onRetry={() => void loadImportJobs(importJobs.length === 0 ? 'INITIAL' : 'REFRESH')}
                label="Muat ulang daftar import"
              />
              {importPhase === 'READY' && waitingImports.length === 0 ? (
                <p role="status" className="ahsp-pending-empty">Tidak ada dokumen terdahulu yang memerlukan perhatian.</p>
              ) : null}
              {draftDeleteReceipt ? (
                <p className="ahsp-line" role="status" aria-live="polite">{draftDeleteReceipt}</p>
              ) : null}
              <ul className="ahsp-curation-list ahsp-import-history-list" aria-label="Daftar pekerjaan tersimpan">
                {waitingImports.map((job) => (
                  <li key={job.key} className="ahsp-import-history-card">
                    <div className="ahsp-import-history__heading">
                      <strong style={{ color: NAVY }}>{job.title}</strong>
                      {job.recordedAtLine ? (
                        <span className="ahsp-import-history__recorded-at" title={`ID jurnal: ${job.key}`}>
                          Dicatat {job.recordedAtLine}
                        </span>
                      ) : null}
                    </div>
                    <div className="ahsp-import-history-state">
                      <span className="ahsp-import-history-tag">
                        {job.historyOnlyDeleted ? 'Riwayat penghapusan' : job.waitingItems.length > 0 ? 'Draft perlu dilengkapi' : 'Perlu ditinjau'}
                      </span>
                      <p className="ahsp-import-history-summary">{job.summaryLine}</p>
                    </div>
                    <div className="ahsp-action-row ahsp-import-history-actions">
                      <button
                        type="button"
                        className="ahsp-action ahsp-action--primary ahsp-action--compact"
                        aria-pressed={selectedSavedImport === job.key}
                        disabled={jobBusy !== null}
                        onClick={() => openSavedImport(job.key)}
                      >
                        {job.historyOnlyDeleted ? 'Lihat riwayat' : 'Lanjutkan pemeriksaan'}
                      </button>
                      {job.waitingItems.length > 0 ? (
                        <button
                          type="button"
                          className="ahsp-action ahsp-action--danger ahsp-action--compact"
                          disabled={jobBusy !== null || hasUnsavedWork}
                          aria-label={'Hapus sisa draft dari ' + job.title + (job.recordedAtLine ? ', ' + job.recordedAtLine : '')}
                          onClick={() => {
                            if (canManage && !hasUnsavedWork && jobBusy === null) setDraftDeleteTarget(job);
                          }}
                        >
                          {jobBusy === job.key ? 'Memproses…' : 'Hapus draft'}
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
              {importMayLoadOlder ? (
                <div className="ahsp-action-row" style={{ marginTop: 'var(--space-2)' }}>
                  <button
                    type="button"
                    className="ahsp-action ahsp-action--quiet ahsp-action--compact"
                    disabled={olderImports === 'LOADING'}
                    aria-busy={olderImports === 'LOADING' || undefined}
                    onClick={() => void loadOlderImports()}
                  >
                    {olderImports === 'LOADING' ? 'Memuat…' : 'Tampilkan import lebih lama'}
                  </button>
                </div>
              ) : null}
              {olderImports === 'FAILED' ? (
                <p role="status" className="ahsp-line ahsp-line--abu">
                  Import lebih lama belum dapat dibaca. Catatan tidak dihapus. Coba muat lagi.
                </p>
              ) : null}
              {canSeeQuestions ? (
                <button
                  type="button"
                  className="ahsp-action ahsp-action--quiet ahsp-action--compact"
                  aria-expanded={learningOpen}
                  onClick={() => setLearningOpen((value) => !value)}
                >
                  {learningOpen ? 'Tutup pembelajaran bersama' : 'Tinjau pembelajaran bersama (semua dokumen)'}
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {isReviewPage && canManage ? (
        <section aria-label="Rincian pekerjaan terpilih" className="ahsp-import-review-section" style={{ ...CARD, marginBottom: 'var(--space-4)' }}>
          <div className="ahsp-import-review-heading">
            <div>
              <span className="ahsp-import-review-kicker">Dokumen yang ditinjau</span>
              <h2 className="ahsp-section-title">{selectedReviewJob?.title ?? 'Memuat pekerjaan tersimpan'}</h2>
              {selectedReviewJob?.recordedAtLine ? <p className="ahsp-import-history-summary">Dicatat {selectedReviewJob.recordedAtLine}</p> : null}
            </div>
            {selectedReviewJob ? <span className="ahsp-import-review-status">{selectedReviewJob.historyOnlyDeleted ? 'Riwayat penghapusan' : selectedReviewJob.waitingItems.length > 0 ? 'Masih perlu dilengkapi' : 'Dokumen tersimpan'}</span> : null}
          </div>
          <ReadNotice phase={importPhase} onRetry={() => void loadImportJobs(importJobs.length === 0 ? 'INITIAL' : 'REFRESH')} label="Muat ulang dokumen tersimpan" />
          {selectedReviewJob && savedReviewGuide ? (
            <div className="ahsp-guided-review" aria-label="Jalur penyelesaian dokumen AHSP">
              <p className="ahsp-guided-review__kicker">Jalur penyelesaian dokumen ini</p>
              <ol className="ahsp-guided-review__steps">
                <li><strong>Dokumen diterima</strong><span>Sudah dicatat. Tidak perlu mengunggah ulang.</span></li>
                <li><strong>Selesaikan pertanyaan</strong><span>Putuskan kesamaan, satuan, atau identitas yang masih memerlukan bukti.</span></li>
                <li><strong>Periksa ulang hasil</strong><span>Jalankan pemeriksaan server setelah keputusan benar-benar tercatat.</span></li>
                <li><strong>Buktikan siap digunakan</strong><span>Periksa status AHSP aktif, resep, sumber daya dan harga sebelum dipakai untuk RAB.</span></li>
              </ol>
              <div className="ahsp-guided-review__next" role="status">
                <strong>Langkah Anda berikutnya: {savedReviewGuide.title}</strong>
                <p>{savedReviewGuide.explanation}</p>
                {selectedReviewJob.deletedAhsp > 0 ? (
                  <p><strong>{selectedReviewJob.deletedAhsp} AHSP terhapus belum aktif.</strong> Pemeriksaan tidak memulihkannya secara otomatis; pemulihan memerlukan jalur berwenang yang belum tersedia.</p>
                ) : null}
                {savedReviewGuide.buttonLabel ? (
                  <button
                    type="button"
                    className="ahsp-action ahsp-action--primary"
                    disabled={jobBusy !== null}
                    onClick={() => {
                      if (savedReviewGuide.kind === 'DECIDE') {
                        savedReviewActionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      } else if (savedReviewGuide.kind === 'UNIT') {
                        setUnitDoor({ spelling: null, lineKey: null, source: 'job', jobKey: selectedReviewJob.key });
                        savedReviewActionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      } else if (savedReviewGuide.kind === 'IDENTITY') {
                        void openIdentityReview({ kind: 'importJobId', importJobId: selectedReviewJob.key });
                      } else if (savedReviewGuide.kind === 'RECHECK') {
                        runExistingImportRecheck(selectedReviewJob, waitingImports.findIndex((job) => job.key === selectedReviewJob.key));
                      }
                    }}
                  >
                    {savedReviewGuide.buttonLabel}
                  </button>
                ) : savedReviewGuide.kind === 'VERIFY' && canViewAhsp ? (
                  <Link className="ahsp-action ahsp-action--outline" to="/ahsp">Periksa kesiapan pada daftar AHSP</Link>
                ) : (
                  <p className="ahsp-guided-review__blocker">Tidak ada tindakan lanjutan yang sah dari halaman ini saat ini. Statusnya belum selesai.</p>
                )}
              </div>
            </div>
          ) : null}
          {selectedReviewJob ? importJobList : importPhase === 'READY' && importMayLoadOlder ? (
            <div className="ahsp-import-review-lookup" role="status">
              <p className="ahsp-line">
                {reviewLookupPausedFor === reviewJobId
                  ? 'Dokumen belum ditemukan pada halaman riwayat yang diperiksa. Riwayat lama masih tersedia.'
                  : 'Mencari dokumen pada halaman riwayat yang sudah disimpan SIMPROK…'}
              </p>
              {reviewLookupPausedFor === reviewJobId ? (
                <button type="button" className="ahsp-action ahsp-action--outline" disabled={olderImports === 'LOADING'} onClick={() => void loadOlderImports()}>
                  {olderImports === 'LOADING' ? 'Mencari…' : 'Cari di riwayat lebih lama'}
                </button>
              ) : null}
            </div>
          ) : importPhase === 'READY' ? (
            <p role="alert" className="ahsp-line">Dokumen tidak ditemukan pada riwayat yang dapat dibaca di workspace ini. Kembali ke Riwayat Import untuk memeriksa daftar dokumen.</p>
          ) : null}
        </section>
      ) : null}

      {/* Curation queue — the shared observed-resource lifecycle. Shown when there
          is work, when the last decisions still have something to say, or when the
          queue could not be read at all: an unread queue is never an empty one. */}
      {canCurate && (isReviewPage && selectedSavedImport !== null || !isReviewPage && settled && observationScope !== null) &&
      (observations.length > 0 ||
        curationOutcomes.length > 0 ||
        observationScope !== null ||
        observationsPhase === 'FAILED' ||
        observationsPhase === 'STALE') ? (
        <section
          ref={curationSectionRef}
          tabIndex={-1}
          aria-label="Sumber daya untuk ditinjau"
          style={{ ...CARD, marginBottom: 'var(--space-4)', outline: 'none' }}
        >
          {curationIntro}
          {nameReviewReceipt ? <p role="status" className="ahsp-line" style={{ color: '#24513A' }}>{nameReviewReceipt}</p> : null}
          {observationScope ? (
            <p role="status" style={{ fontSize: 'var(--text-sm)', color: NAVY, margin: '0 0 var(--space-2)' }}>
              Menampilkan pertanyaan untuk dokumen yang Anda buka dari Ringkasan.
              <button
                type="button"
                className="ahsp-action ahsp-action--quiet ahsp-action--compact"
                style={{ marginLeft: 'var(--space-2)' }}
                onClick={() => {
                  setObservationScope(null);
                  void loadObservations('REFRESH', null);
                }}
              >
                Tampilkan semua
              </button>
            </p>
          ) : null}
          <ReadNotice
            phase={observationsPhase}
            onRetry={() => void loadObservations(observations.length === 0 ? 'INITIAL' : 'REFRESH')}
            label="Muat ulang daftar tinjauan"
          />
          {observations.length === 0 && observationsPhase === 'READY' ? (
            <p role="status" style={{ fontSize: 'var(--text-sm)', color: NAVY, margin: '0 0 var(--space-2)' }}>
              Tidak ada lagi sumber daya yang menunggu tinjauan
              {observationScope ? ' untuk dokumen ini' : ''}.
            </p>
          ) : null}
          {curationList}
        </section>
      ) : null}

      {/* IQL-01 — governed exact-question learning: offered by one person, approved
          by another. ONE section, whether it holds questions or not: a list that
          could not be read says so even while its last answer is still readable. */}
      {canSeeQuestions && learningOpen &&
      (shownQuestions.length > 0 ||
        questionOutcomes.length > 0 ||
        questionsPhase === 'FAILED' ||
        questionsPhase === 'STALE') ? (
        <section aria-label="Pembelajaran pertanyaan identik" style={{ ...CARD, marginBottom: 'var(--space-4)' }}>
          {learningIntro}
          <ReadNotice
            phase={questionsPhase}
            onRetry={() => void loadQuestions(questions.length === 0 ? 'INITIAL' : 'REFRESH')}
            label="Muat ulang daftar pembelajaran"
          />
          {questionList}
        </section>
      ) : null}

      {/* Draft deletion is confirmed in SIMPROK, not by browser OK/Cancel.
          Opening this dialog does not perform any write. */}
      {draftDeleteTarget ? (
        <div className="ahsp-draft-delete-backdrop">
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="ahsp-draft-delete-title"
            aria-describedby="ahsp-draft-delete-description"
            className="ahsp-draft-delete-dialog"
            onKeyDown={(event) => {
              if (event.key === 'Escape' && jobBusy === null) {
                event.preventDefault();
                setDraftDeleteTarget(null);
              }
              if (event.key === 'Tab') {
                const choices = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
                );
                const first = choices[0];
                const last = choices[choices.length - 1];
                if (!first || !last) return;
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first.focus();
                }
              }
            }}
          >
            <h2 id="ahsp-draft-delete-title" className="ahsp-section-title">Hapus pekerjaan draft?</h2>
            <p id="ahsp-draft-delete-description" className="ahsp-line">
              <strong>{draftDeleteTarget.title}</strong>
              {draftDeleteTarget.recordedAtLine ? ' · ' + draftDeleteTarget.recordedAtLine : ''}
            </p>
            <p className="ahsp-line">
              {draftDeleteTarget.waitingItems.length} pekerjaan belum selesai beserta keputusan dan resource
              sementaranya akan dihapus.
            </p>
            <p className="ahsp-line ahsp-line--abu">
              AHSP dan resource yang sudah tersimpan tetap aman.
            </p>
            <div className="ahsp-action-row ahsp-draft-delete-actions">
              <button
                type="button"
                className="ahsp-action ahsp-action--outline"
                autoFocus
                onClick={() => setDraftDeleteTarget(null)}
              >
                Batal
              </button>
              <button
                type="button"
                className="ahsp-action ahsp-action--danger"
                disabled={!canManage || jobBusy !== null || hasUnsavedWork}
                onClick={() => void deleteUnfinishedDraft(draftDeleteTarget)}
              >
                Hapus {draftDeleteTarget.waitingItems.length} draft
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {/* Three choices only for an unfinished NEW upload, never for a saved
          historical job. React Router blocks internal navigation and back/forward;
          native tab closing uses the browser's own beforeunload confirmation. */}
      {navigationBlocker.state === 'blocked' ? (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1200,
            background: 'rgba(22, 41, 75, 0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)',
          }}
        >
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="ahsp-leave-title"
            aria-describedby="ahsp-leave-description"
            style={{ ...CARD, maxWidth: '36rem', width: '100%', boxShadow: '0 18px 48px rgba(0,0,0,.22)' }}
          >
            <h2 id="ahsp-leave-title" className="ahsp-section-title">Pekerjaan AHSP belum selesai</h2>
            <p id="ahsp-leave-description" className="ahsp-line">
              {hasUnsavedUpload ? (
                <>Berkas <strong>{file?.name}</strong> masih mempunyai perubahan sementara.</>
              ) : hasUnsavedPreviewChoices ? (
                <>Dokumen <strong>{file?.name}</strong> sudah dicatat, tetapi pilihan kesamaannya masih belum tersimpan.</>
              ) : (
                <>Pilihan kesamaan pada pekerjaan AHSP tersimpan masih belum disimpan.</>
              )}
            </p>
            {previewIntakeJobId ? (
              <p className="ahsp-line ahsp-line--abu">
                Keputusan satuan sebelumnya sudah dicatat dalam jurnal SIMPROK. Keluar tanpa menyimpan tidak menghapus catatan tersebut.
              </p>
            ) : null}
            {draftReceipt ? (
              <p role="status" className="ahsp-line" style={{ color: draftSaved ? '#24513A' : RED }}>
                {draftReceipt}
              </p>
            ) : null}
            <div className="ahsp-action-row ahsp-action-row--stack">
              <button
                type="button"
                className="ahsp-action ahsp-action--outline"
                autoFocus
                disabled={draftBusy}
                onClick={() => navigationBlocker.reset()}
              >
                Tetap di halaman
              </button>
              <span className="ahsp-draft-save-help">
                <button
                  type="button"
                  className="ahsp-action ahsp-action--primary"
                  disabled={!file || draftBusy || importing || draftSaved}
                  aria-busy={draftBusy || undefined}
                  aria-describedby="ahsp-draft-save-tooltip"
                  onClick={() => void saveAsDraft(true)}
                >
                  {draftBusy ? 'Menyimpan draft…' : draftSaved ? 'Draft tersimpan' : 'Simpan sebagai draft'}
                </button>
                <span id="ahsp-draft-save-tooltip" className="ahsp-draft-save-help__tooltip" role="tooltip">
                  {hasUnsavedUpload || hasUnsavedPreviewChoices
                    ? 'Simpan sebagai draft merekam dokumen dan konteks klasifikasi di server. Pilihan kesamaan sementara yang belum dikomit tidak ikut tersimpan dan harus diputuskan lagi saat melanjutkan.'
                    : 'Pilihan kesamaan pada pekerjaan lama belum memiliki penyimpanan draft tersendiri. Tetap di halaman untuk menyelesaikannya melalui Periksa ulang yang meminta konfirmasi, atau tinggalkan hanya pilihan sementaranya.'}
                  {' '}Tinggalkan tanpa menyimpan tidak menghapus dokumen maupun AHSP yang sudah tercatat.
                </span>
              </span>
              <button
                type="button"
                className="ahsp-action ahsp-action--quiet"
                disabled={draftBusy || importing}
                onClick={() => navigationBlocker.proceed()}
              >
                {draftSaved && !hasUnsavedPreviewChoices && !hasUnsavedSavedJobChoices ? 'Keluar (draft sudah tersimpan)' : 'Tinggalkan tanpa menyimpan'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {/* Manual AHSP create is NOT on Import — see AhspRoomPage "Buat AHSP Manual". */}
    </main>
  );
}

export default AhspImportPage;
