import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { explainWaitingItemReasons } from '../utils/ahspDocumentUserCopy';
import {
  IDENTITY_PENDING_ITEM_LINE,
  admissionOf,
  describeImportIntake,
  describeImportRecheck,
  describeImportRecheckFailure,
  describePreviewAttention,
  describeWaitingImports,
  previewIntakeLine,
  type AttentionRowView,
  type ImportJobView,
  type ImportWaitingItemView,
  type IntakeSummaryWire,
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
  type SessionTicket,
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
import '../styles/ahsp.css';

type SamenessDecision = 'USE_EXISTING' | 'KEEP_SEPARATE' | 'SKIP';

/**
 * THE Import AHSP door — its own page, separate from the AHSP list, so the list
 * stays a clean library and this is the workspace for understanding a document.
 *
 * NOTHING about the canonical pipeline changes. Upload still uses the EXISTING
 * POST /ahsp/document/preview and /commit; unresolved resources still surface as
 * the EXISTING shared observation lifecycle (GET /resource-observations +
 * /curate-existing | /curate-new); manual create still uses the EXISTING
 * POST /ahsp. This file only rehomes that surface out of the room — bytes ->
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
const labelStyle: CSSProperties = { display: 'block', fontSize: 'var(--text-sm)', color: MUTED, marginBottom: 'var(--space-1)' };

export function AhspImportPage() {
  const navigate = useNavigate();
  const { hasPermission, activeWorkspaceId } = useAuth();
  const canManage = hasPermission('AHSP_MANAGE');
  const canCurate = hasPermission('AHSP_RESOURCE_IDENTITY_DECIDE');
  // IQL-01 second holder: may JUDGE pending learning candidates here — nothing else.
  const canSeeQuestions = canCurate || hasPermission('AHSP_RESOURCE_IDENTITY_QUESTION_APPROVE');
  const canViewAhsp = hasPermission('AHSP_VIEW');

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<null | { workItems: PreviewItem[] }>(null);
  const [commitResult, setCommitResult] = useState<null | { summary?: IntakeSummaryWire | null }>(null);
  const [importError, setImportError] = useState<string | null>(null);
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
  const [openJobDetails, setOpenJobDetails] = useState<Record<string, boolean>>({});
  // Detail is CONCISE by default and COMPLETE on demand: the rest of a saved
  // import's waiting work, and the reasons behind one curation question.
  const [openJobAllWaiting, setOpenJobAllWaiting] = useState<Record<string, boolean>>({});
  const [openCurationReason, setOpenCurationReason] = useState<Record<string, boolean>>({});
  const [curationShowAll, setCurationShowAll] = useState(false);
  // The manual door stays on this page, one press away, without dominating it.
  const [manualOpen, setManualOpen] = useState(false);

  const [workType, setWorkType] = useState('');
  const [methodName, setMethodName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // The create that owns the manual form's button; a workspace change takes it from it.
  const createLock = useRef<SessionTicket | null>(null);

  // Human decisions for AHSPs the identity classifier flagged. Keyed by the same
  // source-name identity the backend uses, so a decision travels from this
  // preview to the commit upload of the same file. Never a frontend-only truth.
  const [decisions, setDecisions] = useState<Record<string, SamenessDecision>>({});
  // A commit SPENDS the decisions it carried. The list that comes back is the
  // knowledge computed before those writes, so leaving the controls live would let
  // one human intent be recorded twice. They stay closed until the reader asks
  // SIMPROK to understand the document again.
  const [settled, setSettled] = useState(false);
  // Collision-proof separator (matches the backend decisionMap): a real space
  // would let a different (workType, methodName) split map two distinct items to
  // ONE Record key. The null char never appears in a source name.
  const decisionKey = (item: PreviewItem) => (item.workType?.raw ?? '') + '\u0000' + (item.methodName?.raw ?? '');
  const setDecision = (item: PreviewItem, action: SamenessDecision) =>
    setDecisions((prev) => ({ ...prev, [decisionKey(item)]: action }));

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
    curationLock.current = null;
    setCurationBusy(null);
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
    // A new file's items are new decisions — drop any prior ones so a stale decision
    // can never ride a different document to commit.
    setDecisions({});
    setImportError(null);
    documentLock.current = null;
    setImportAction(null);
  };
  /** A workspace change: a create begun in the workspace before says nothing here. */
  const forgetCreate = () => {
    setCreateError(null);
    createLock.current = null;
    setCreating(false);
  };
  /** The curation list as the server holds it now; null when it could not be read. */
  const loadObservations = async (
    mode: ReadMode = 'REFRESH',
  ): Promise<readonly CuratableObservationWire[] | null> => {
    if (!canCurate) return null;
    if (mode === 'INITIAL') setObservationsRead((previous) => ({ ...previous, phase: 'LOADING' }));
    // A curation-list read failure is never rendered as "no work to review", and a
    // refusal never leaves the refused rows behind.
    const outcome = await runListRead(reads, {
      list: 'observations',
      read: () => readList('/resource-observations', asRows<CuratableObservationWire>),
      refusedBy: isRefusal,
      answeredBy: isAnswer,
      apply: (answer) => setObservationsRead((previous) => applyListRead(previous, answer, mode)),
      forget: forgetCuration,
    });
    return outcome.applied && outcome.answer.ok ? outcome.answer.data : null;
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
    // Nor does a preview, a commit or a create begun there write anything here.
    forgetDocument();
    forgetCreate();
    void loadObservations('INITIAL');
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
      if (reads.mayApplyDocument(ticket)) setPreview(understood);
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
    if (curationLock.current !== null || request.ids.length === 0 || observationsPhase === 'UNAUTHORIZED') return;
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
    try {
      let outcome: ActionOutcome;
      try {
        const response = await apiFetch('/ahsp/document/jobs/' + job.key + '/continue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decisions }),
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

  const shownQuestions = questions.filter(isGovernedQuestionShown).map(describeGovernedQuestion);

  const createWorkspaceAhsp = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage || createLock.current !== null) return;
    // The workspace this AHSP is created in: its answer may move the reader, or say what
    // went wrong, only while that workspace is still the one on screen. What the server
    // created stays created there.
    const ticket = reads.captureSession();
    createLock.current = ticket;
    setCreating(true);
    setCreateError(null);
    try {
      const response = await apiFetch('/ahsp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workType: workType.trim(), methodName: methodName.trim(), methodType: 'OTHER', locationType: 'OTHER' }),
      });
      if (!response.ok) {
        if (reads.sameSession(ticket)) setCreateError('AHSP milik Anda belum dapat dibuat. Periksa isian lalu coba lagi.');
        return;
      }
      const created = (await response.json()) as { id?: string };
      if (!reads.sameSession(ticket)) return;
      if (typeof created.id !== 'string' || created.id === '') {
        setCreateError('Server tidak mengembalikan identitas AHSP yang baru dibuat.');
        return;
      }
      navigate('/ahsp/' + created.id);
    } catch {
      if (reads.sameSession(ticket)) setCreateError('AHSP milik Anda tidak dapat dihubungi.');
    } finally {
      if (createLock.current === ticket) {
        createLock.current = null;
        setCreating(false);
      }
    }
  };

  // Received and ready are different truths: the summary of a SAVED document
  // comes from the server's own count, never from the preview list.
  const intake = commitResult?.summary ? describeImportIntake(commitResult.summary) : null;

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
    const remember = learning.offered && rememberFor[group.key] === true;
    const locked = curationBusy !== null;
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
        {view.candidateLine ? <span className="ahsp-line" style={{ color: MUTED }}>{view.candidateLine}</span> : null}
        {/* A decision already offered for learning is WAITING on someone else —
            that is this question's state, not an explanation, so it stays here. */}
        {learning.stateLine && learning.stateTone === 'PENDING' ? (
          <span className="ahsp-line ahsp-line--emas">{learning.stateLine}</span>
        ) : null}
        {learning.offered ? (
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
  const renderAttention = (rows: readonly AttentionRowView[], label: string): ReactNode =>
    rows.length > 0 ? (
      <ul className="ahsp-attention" aria-label={label}>
        {rows.map((row) => (
          <li key={row.key} className="ahsp-attention__row" data-tone={row.tone.toLowerCase()}>
            <span className="ahsp-attention__title">{row.title}</span>
            <span className="ahsp-attention__detail">{row.detail}</span>
          </li>
        ))}
      </ul>
    ) : null;

  const waitingImports = describeWaitingImports(importJobs, { canCurate });
  const jobEntries = placeOutcomes(waitingImports, (job) => job.key, jobOutcomes);
  const dismissJob = (key: string) => setJobOutcomes((prev) => prev.filter((outcome) => outcome.key !== key));

  // PURPOSE → STATUS → WHAT IT NEEDS → THE ONE ACTION → DECISIONS → DETAIL ON DEMAND.
  const renderImportJob = (job: ImportJobView, at: number, anchored: AnchoredOutcome | null): ReactNode => {
    const busy = jobBusy === job.key;
    const open = openJobDetails[job.key] === true;
    const allWaitingOpen = openJobAllWaiting[job.key] === true;
    const waitingDetail = job.waitingItems.filter((item) => item.sameness === null);
    const detailId = 'ahsp-import-detail-' + at;
    const decisionItems = job.waitingItems.filter((item) => item.sameness !== null);
    const recheckLabel = busy ? 'Memeriksa…' : 'Periksa ulang';
    const recheck = () => void recheckImport(job, at);
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
      <li key={job.key} aria-label={'Import ' + job.title} className="ahsp-completion">
        <span className="ahsp-curation-item__title">{job.title}</span>
        <p className="ahsp-completion__summary">{job.summaryLine}</p>
        {renderAttention(job.attention, 'Yang masih dibutuhkan')}
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
        <div className="ahsp-action-row">
          {/* One check for the whole document; shown only where there is something to check. */}
          {job.canRecheck && urged ? (
            <button type="button" className="ahsp-action ahsp-action--primary" disabled={jobBusy !== null} aria-busy={busy || undefined} onClick={recheck}>
              {recheckLabel}
            </button>
          ) : null}
          {job.canRecheck && !urged ? (
            <button type="button" className="ahsp-action ahsp-action--outline" disabled={jobBusy !== null} aria-busy={busy || undefined} onClick={recheck}>
              {recheckLabel}
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
            <span className="ahsp-line">{job.receivedLine}</span>
            {job.canRecheck ? <span className="ahsp-line">{job.waitingLine}</span> : null}
            <ul className="ahsp-detail-list">
              {(allWaitingOpen ? waitingDetail : waitingDetail.slice(0, job.waitingShown)).map((item) => (
                <li key={item.key} className="ahsp-line">
                  {item.title} · {item.reason}
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
    <ul className="ahsp-curation-list">
      {jobEntries.map((entry: PlacedEntry<ImportJobView>, at) =>
        entry.kind === 'ITEM' ? renderImportJob(entry.item, at, entry.outcome) : renderReceipt(entry.outcome, dismissJob),
      )}
    </ul>
  );

  const importJobIntro = (
    <>
      <h2 style={{ fontSize: 'var(--text-lg)', color: NAVY, margin: '0 0 var(--space-2)' }}>Import yang masih dilengkapi</h2>
      <p style={{ fontSize: 'var(--text-sm)', color: MUTED, margin: '0 0 var(--space-3)' }}>
        Semua pekerjaan di bawah ini sudah diterima SIMPROK. Bila yang ditunggu sudah tersedia — misalnya satuan yang kini dikenali — satu pemeriksaan ulang memeriksa seluruh dokumen, tanpa mengunggah ulang berkasnya.
      </p>
    </>
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

  return (
    <main aria-label="Import AHSP" style={{ padding: 'var(--space-5, 1.25rem)' }}>
      <nav aria-label="Jejak navigasi" style={{ fontSize: 'var(--text-sm)', color: MUTED, marginBottom: 'var(--space-3)' }}>
        {/* A door only for whoever may open it — the second holder may judge here, not browse AHSP. */}
        {canViewAhsp ? <Link to="/ahsp" style={{ color: MUTED, textDecoration: 'none' }}>AHSP</Link> : <span>AHSP</span>}
        <span style={{ margin: '0 var(--space-2)' }}>›</span>
        <span style={{ color: NAVY }}>Import AHSP</span>
      </nav>

      <header style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: NAVY, margin: 0 }}>Import AHSP</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: MUTED, margin: 'var(--space-1) 0 0' }}>
            Unggah dokumen resmi, pahami isinya, lalu simpan hasil import. Semua pekerjaan yang dikenali diterima SIMPROK; yang belum lengkap tetap tersimpan untuk dilengkapi.
          </p>
        </div>
        {canViewAhsp ? (
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
      {canManage ? (
        <section aria-label="Unggah dan pahami dokumen" style={{ ...CARD, marginBottom: 'var(--space-4)' }}>
          <input
            type="file"
            accept=".xlsx"
            aria-label="Berkas AHSP resmi"
            style={{ maxWidth: '100%' }}
            onChange={(event) => {
              // Another document: nothing understood, saved or decided for the one before is
              // about this one, and a request still waiting for it never writes here.
              reads.changeDocument();
              setFile(event.target.files?.[0] ?? null);
              forgetDocument();
            }}
          />
          <div className="ahsp-action-row ahsp-action-row--stack" style={{ marginTop: 'var(--space-3)' }}>
            <button type="button" className="ahsp-action ahsp-action--primary" disabled={!file || importing} aria-busy={importAction === 'PREVIEW' || undefined} onClick={() => void previewDocument()}>
              {importAction === 'PREVIEW' ? 'Membaca…' : 'Pahami dokumen'}
            </button>
            <button type="button" className="ahsp-action ahsp-action--outline" disabled={!file || importing || !preview} aria-busy={importAction === 'COMMIT' || undefined} onClick={() => void commitDocument()}>
              {importAction === 'COMMIT' ? 'Menyimpan…' : 'Simpan hasil import'}
            </button>
          </div>
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
          {preview ? (
            <div className="ahsp-completion ahsp-completion--preview">
              {intake ? null : <p className="ahsp-completion__summary">{previewIntakeLine(preview.workItems)}</p>}
              {intake ? null : renderAttention(describePreviewAttention(preview.workItems, { canCurate }), 'Yang perlu diperhatikan')}
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
                <p style={{ margin: '0 0 var(--space-2)', paddingLeft: 'var(--space-2)', borderLeft: `2px solid ${MUTED}`, color: MUTED }}>
                  {identicalDeletedAggregateLine(distinctIdentities(deletedIdentical))}
                </p>
              ) : null}
              {/* A possible twin is a question only the reader can answer, so it is never
                  folded behind the detail: each keeps its own evidence and its own choice. */}
              {possibleTwins.length > 0 ? (
                <div className="ahsp-decisions" aria-label="Kemungkinan sama dengan AHSP yang sudah ada">
                  {possibleTwins.map(({ item, index }) => {
                    // Sameness and readiness are DIFFERENT questions, so the comparison is
                    // ALWAYS shown; only the decision is withheld when the item could not be
                    // admitted anyway (commit holds a HELD item before it reads any decision,
                    // so a button there would land nowhere).
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
              <div className="ahsp-action-row">
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
              {previewDetailOpen ? (
              <ul id="ahsp-preview-detail" className="ahsp-detail-list">
                {preview.workItems.map((item, index) => {
                  const admission = admissionOf(item);
                  const candidateNames = admission === 'PROVEN' ? [] : previewCandidateNames(item.resources);
                  // Rows the kernel ruled out are said as NOT used — never as possible matches.
                  const ruledOutLine = admission === 'PROVEN' ? null : previewRuledOutLine(previewRuledOutNames(item.resources));
                  return (
                    <li key={index} style={{ marginBottom: 'var(--space-2)', overflowWrap: 'anywhere' }}>
                      {item.workType?.raw ?? '—'} — {item.methodName?.raw ?? '—'}
                      {admission === 'HELD'
                        ? ` · ${explainWaitingItemReasons(item.reasonCodes)}`
                        : item.identityVerdict === 'IDENTICAL'
                          // Admitted, but it will NOT be written — it already exists. Saying
                          // "siap digunakan" here would promise a save that never happens.
                          ? ' · sudah ada di SIMPROK'
                          : admission === 'PROVEN'
                            ? ' · siap digunakan'
                            : ` · ${IDENTITY_PENDING_ITEM_LINE}`}
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
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Earlier imports still holding work items — checked again once per document, never re-uploaded */}
      {/* A journal that was READ and holds nothing says so; an unread one says it
          could not be read. The panel is never simply absent after a read, so its
          absence is never mistaken for "no import jobs". */}
      {canManage &&
      (waitingImports.length > 0 ||
        jobOutcomes.length > 0 ||
        importHasMore ||
        importPhase === 'READY' ||
        importPhase === 'FAILED' ||
        importPhase === 'STALE') ? (
        <section aria-label="Import yang masih dilengkapi" style={{ ...CARD, marginBottom: 'var(--space-4)' }}>
          {importJobIntro}
          <ReadNotice
            phase={importPhase}
            onRetry={() => void loadImportJobs(importJobs.length === 0 ? 'INITIAL' : 'REFRESH')}
            label="Muat ulang daftar import"
          />
          {/* "Nothing waiting" is said only of what was actually READ — and only as
              far as this page reaches, while older imports remain one press away. */}
          {waitingImports.length === 0 && importPhase === 'READY' ? (
            <p role="status" style={{ fontSize: 'var(--text-sm)', color: NAVY, margin: '0 0 var(--space-2)' }}>
              {importHasMore
                ? 'Tidak ada import yang menunggu dilengkapi pada bagian ini.'
                : 'Tidak ada lagi import yang menunggu dilengkapi.'}
            </p>
          ) : null}
          {importJobList}
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
              Import yang lebih lama belum berhasil dimuat. Tidak ada yang hilang — coba tekan lagi.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Curation queue — the shared observed-resource lifecycle. Shown when there
          is work, when the last decisions still have something to say, or when the
          queue could not be read at all: an unread queue is never an empty one. */}
      {canCurate &&
      (observations.length > 0 ||
        curationOutcomes.length > 0 ||
        observationsPhase === 'FAILED' ||
        observationsPhase === 'STALE') ? (
        <section aria-label="Sumber daya untuk ditinjau" style={{ ...CARD, marginBottom: 'var(--space-4)' }}>
          {curationIntro}
          <ReadNotice
            phase={observationsPhase}
            onRetry={() => void loadObservations(observations.length === 0 ? 'INITIAL' : 'REFRESH')}
            label="Muat ulang daftar tinjauan"
          />
          {observations.length === 0 && observationsPhase === 'READY' ? (
            <p role="status" style={{ fontSize: 'var(--text-sm)', color: NAVY, margin: '0 0 var(--space-2)' }}>
              Tidak ada lagi sumber daya yang menunggu tinjauan.
            </p>
          ) : null}
          {curationList}
        </section>
      ) : null}

      {/* IQL-01 — governed exact-question learning: offered by one person, approved
          by another. ONE section, whether it holds questions or not: a list that
          could not be read says so even while its last answer is still readable. */}
      {canSeeQuestions &&
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

      {/* Manual create — relocated here from the list (the "AHSP Milik Saya" door), same POST /ahsp capability */}
      {canManage ? (
        <section aria-label="Buat AHSP milik saya" style={CARD}>
          <h2 style={{ fontSize: 'var(--text-lg)', color: NAVY, margin: '0 0 var(--space-1)' }}>Buat AHSP milik saya</h2>
          <p style={{ fontSize: 'var(--text-sm)', color: MUTED, margin: '0 0 var(--space-3)' }}>
            Tidak punya berkas? Buat AHSP milik Anda secara manual, lalu lengkapi komponennya di halaman detail.
          </p>
          {/* The same capability, still here and still one press away — but this is
              an import page, and a manual form standing open owns a page it is not
              about. What is typed is kept while it is closed. */}
          <div className="ahsp-action-row">
            <button
              type="button"
              className="ahsp-action ahsp-action--quiet ahsp-action--compact"
              aria-expanded={manualOpen}
              aria-controls="ahsp-manual-form"
              onClick={() => setManualOpen((open) => !open)}
            >
              {manualOpen ? 'Tutup formulir manual' : 'Buat AHSP secara manual'}
            </button>
          </div>
          {manualOpen ? (
          <form id="ahsp-manual-form" onSubmit={createWorkspaceAhsp} style={{ maxWidth: '36rem' }}>
            <label style={labelStyle}>Jenis pekerjaan
              <input required value={workType} onChange={(event) => setWorkType(event.target.value)} aria-label="Jenis pekerjaan" style={controlBox} />
            </label>
            <label style={{ ...labelStyle, marginTop: 'var(--space-3)' }}>Uraian
              <input required value={methodName} onChange={(event) => setMethodName(event.target.value)} aria-label="Uraian AHSP" style={controlBox} />
            </label>
            {createError ? <p role="alert" style={{ color: RED, fontSize: 'var(--text-sm)' }}>{createError}</p> : null}
            <button type="submit" className="ahsp-action ahsp-action--outline" disabled={creating} aria-busy={creating || undefined} style={{ marginTop: 'var(--space-3)' }}>
              {creating ? 'Menyimpan…' : 'Simpan AHSP milik saya'}
            </button>
          </form>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}

export default AhspImportPage;
