import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { explainAhspItemReasons } from '../utils/ahspDocumentUserCopy';
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
 */

type PreviewItem = {
  status: string;
  reasonCodes: string[];
  workType: { raw: string } | null;
  methodName: { raw: string } | null;
  resources?: PreviewResourceWire[];
  identityVerdict?: string;
  identityMatches?: AhspIdentityMatchWire[];
};

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
  const { hasPermission } = useAuth();
  const canManage = hasPermission('AHSP_MANAGE');
  const canCurate = hasPermission('AHSP_RESOURCE_IDENTITY_DECIDE');
  // IQL-01 second holder: may JUDGE pending learning candidates here — nothing else.
  const canSeeQuestions = canCurate || hasPermission('AHSP_RESOURCE_IDENTITY_QUESTION_APPROVE');
  const canViewAhsp = hasPermission('AHSP_VIEW');

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<null | { workItems: PreviewItem[] }>(null);
  const [commitResult, setCommitResult] = useState<null | { written: unknown[]; skipped: unknown[] }>(null);
  const [importError, setImportError] = useState<string | null>(null);
  // Which document request is running, so each button tells the truth about itself.
  const [importAction, setImportAction] = useState<'PREVIEW' | 'COMMIT' | null>(null);
  const importing = importAction !== null;

  const [observations, setObservations] = useState<CuratableObservationWire[]>([]);
  const [curationBusy, setCurationBusy] = useState<CurationBusy | null>(null);
  // A ref, not state: a second press in the same tick must be refused before React re-renders.
  const curationLock = useRef(false);
  const [curationOutcomes, setCurationOutcomes] = useState<AnchoredOutcome[]>([]);
  // IQL-01 — offering a decision as learning is a separate, explicit choice per question.
  const [rememberFor, setRememberFor] = useState<Record<string, boolean>>({});
  const [questions, setQuestions] = useState<GovernedQuestionWire[]>([]);
  const [questionReasons, setQuestionReasons] = useState<Record<string, string>>({});
  const [questionBusy, setQuestionBusy] = useState<{ key: string; action: GovernanceAction } | null>(null);
  const questionLock = useRef(false);
  const [questionOutcomes, setQuestionOutcomes] = useState<AnchoredOutcome[]>([]);

  const [workType, setWorkType] = useState('');
  const [methodName, setMethodName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

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

  const loadObservations = async () => {
    if (!canCurate) return;
    try {
      const response = await apiFetch('/resource-observations');
      if (!response.ok) return;
      const data = await response.json();
      setObservations(Array.isArray(data) ? data : []);
    } catch {
      // A curation-list read failure is never rendered as "no work to review".
    }
  };

  // IQL-01 — the governed exact questions, with the doors open to THIS reader.
  const loadQuestions = async () => {
    if (!canSeeQuestions) return;
    try {
      const response = await apiFetch('/resource-observations/questions');
      if (!response.ok) return;
      const data = await response.json();
      setQuestions(Array.isArray(data) ? data : []);
    } catch {
      // Never rendered as "nothing to govern".
    }
  };

  useEffect(() => {
    // On-mount fetch of the standing curation queue; a documented, intentional effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadObservations();
    void loadQuestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCurate, canSeeQuestions]);

  const previewDocument = async () => {
    if (!canManage || !file || importing) return;
    setImportAction('PREVIEW');
    setImportError(null);
    setCommitResult(null);
    // A fresh understanding is a fresh set of items to decide — never carry a
    // stale decision from a previous document/preview into this one.
    setDecisions({});
    setSettled(false);
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await apiFetch('/ahsp/document/preview', { method: 'POST', body });
      if (!response.ok) {
        setImportError('Dokumen AHSP belum dapat dipahami. Periksa berkas lalu coba lagi.');
        return;
      }
      setPreview(await response.json());
    } catch {
      setImportError('Dokumen AHSP tidak dapat dihubungi.');
    } finally {
      setImportAction(null);
    }
  };

  const commitDocument = async () => {
    if (!canManage || !file || importing) return;
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
        setImportError('AHSP terbukti belum dapat disimpan. Coba lagi sebentar.');
        return;
      }
      const data = await response.json();
      setCommitResult(data);
      setPreview(data.knowledge ?? preview);
      // The decisions have been acted on. Clearing them stops a spent choice from
      // staying lit on screen and from riding a later commit of the same preview.
      setDecisions({});
      setSettled(true);
      await loadObservations();
    } catch {
      setImportError('AHSP terbukti tidak dapat dihubungi.');
    } finally {
      setImportAction(null);
    }
  };

  /**
   * Record ONE human answer against every observation that asked that identical
   * question, through the SAME per-observation endpoint as before. Each row still
   * gets its own decision record, its own actor and its own provenance — what
   * stops repeating is the asking, not the recording.
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
    // Each row sends its OWN body, so each carries its own signed context.
    bodyFor: (id: string) => Record<string, unknown>;
    decision: ResourceDecisionInput;
    remember: boolean;
  }) => {
    const { group } = request;
    if (curationLock.current || group.ids.length === 0) return;
    curationLock.current = true;
    setCurationBusy({ key: group.key, action: request.action });
    let saved = 0;
    let failure: ApiFailure | null = null;
    const results: Array<{ identicalQuestion?: { state?: string | null; replayed?: boolean | null } | null } | null> = [];
    try {
      for (const id of group.ids) {
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
      const learning = request.remember ? learningOutcomeOf(results) : null;
      const outcome: ActionOutcome =
        failure === null
          ? describeResourceDecisionSuccess({ ...request.decision, rows: saved, learning })
          : describeResourceDecisionFailure({
              saved,
              total: group.ids.length,
              failure,
              learning: saved > 0 ? learning : null,
            });
      setCurationOutcomes((prev) =>
        withOutcome(prev, { key: group.key, at: request.at, title: group.view.title, outcome }),
      );
      await Promise.all([loadObservations(), loadQuestions()]);
    } finally {
      curationLock.current = false;
      setCurationBusy(null);
    }
  };

  const wireById = new Map(observations.map((observation) => [observation.id, observation]));

  const curateExisting = (group: ObservationGroup, at: number, choice: ObservationCandidateChoice, remember: boolean) =>
    curateGroup({
      group,
      at,
      action: 'existing:' + choice.resourceCatalogId,
      path: '/curate-existing',
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
      bodyFor: () => ({ unitDefinitionId }),
      decision: { kind: 'NEW', title: group.view.title, chosenName: null },
      remember: false,
    });

  /** IQL-01 — one governance act on one exact question, spending the context the server issued. */
  const governQuestion = async (question: GovernedQuestionView, at: number, action: GovernanceAction) => {
    if (questionLock.current || !question.token) return;
    const record = (outcome: ActionOutcome) =>
      setQuestionOutcomes((prev) =>
        withOutcome(prev, { key: question.questionKey, at, title: question.title, outcome }),
      );
    const reason = (questionReasons[question.questionKey] ?? '').trim();
    if (action !== 'approve' && reason === '') {
      record(REASON_MISSING_OUTCOME);
      return;
    }
    questionLock.current = true;
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
          setQuestionReasons((prev) => ({ ...prev, [question.questionKey]: '' }));
        } else {
          record(describeGovernanceFailure(await readApiFailure(response)));
        }
      } catch {
        record(describeGovernanceFailure(NETWORK_FAILURE));
      }
      await Promise.all([loadQuestions(), loadObservations()]);
    } finally {
      questionLock.current = false;
      setQuestionBusy(null);
    }
  };

  const shownQuestions = questions.filter(isGovernedQuestionShown).map(describeGovernedQuestion);

  const createWorkspaceAhsp = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const response = await apiFetch('/ahsp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workType: workType.trim(), methodName: methodName.trim(), methodType: 'OTHER', locationType: 'OTHER' }),
      });
      if (!response.ok) {
        setCreateError('AHSP milik Anda belum dapat dibuat. Periksa isian lalu coba lagi.');
        return;
      }
      const created = (await response.json()) as { id?: string };
      if (typeof created.id !== 'string' || created.id === '') {
        setCreateError('Server tidak mengembalikan identitas AHSP yang baru dibuat.');
        return;
      }
      navigate('/ahsp/' + created.id);
    } catch {
      setCreateError('AHSP milik Anda tidak dapat dihubungi.');
    } finally {
      setCreating(false);
    }
  };

  const recognized = preview?.workItems.length ?? 0;
  const ready = preview?.workItems.filter((item) => item.status === 'READY').length ?? 0;
  const unresolved = preview ? recognized - ready : 0;

  // AUTOMATION BEFORE HUMAN INTERVENTION.
  //
  // An exact identity is deterministic: SIMPROK never stores it twice, whatever
  // the reader clicks. So a document full of AHSPs SIMPROK already holds must not
  // become a wall of identical decision blocks — it is aggregated into ONE line,
  // with ONE optional action that records the "I used the existing one" provenance
  // for all of them at once. POSSIBLY items are NEVER aggregated: each carries its
  // own candidates and evidence, so each stays a separate human decision.
  const identicalItems = (preview?.workItems ?? []).filter(
    (item) => item.status === 'READY' && item.identityVerdict === 'IDENTICAL',
  );
  // Whether an existing AHSP can be adopted is decided in ONE place — the display
  // module — never re-derived here, so the two can never drift apart.
  const adoptableIdentical = identicalItems.filter(
    (item) => describeSameness(item)?.canUseExisting === true,
  );
  const deletedIdentical = identicalItems.filter(
    (item) => describeSameness(item)?.canUseExisting !== true,
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
    return (
      <li key={group.key} aria-label={'Tinjau ' + view.title} className="ahsp-curation-item">
        <span className="ahsp-curation-item__title">{view.title}</span>
        {/* Said plainly, because one click will answer for all of them. */}
        {repeated ? <span className="ahsp-line" style={{ color: MUTED }}>{repeated}</span> : null}
        {/* WHAT SIMPROK UNDERSTOOD, FIRST. A row can be fully
            understood — class, unit, source code — and still not be
            identified. Saying so before asking anything is what stops
            the screen reading as "which one do you think this is?". */}
        <span className="ahsp-line" style={{ color: MUTED }}>{view.understanding}</span>
        {view.candidateLine ? <span className="ahsp-line" style={{ color: MUTED }}>{view.candidateLine}</span> : null}
        {/* Nominations too weak to act on are SHOWN and never offered:
            hiding them would make SIMPROK look like it had not looked,
            offering them would make a shared word look like an answer. */}
        {view.weakPossibilityLine ? <span className="ahsp-line ahsp-line--abu">{view.weakPossibilityLine}</span> : null}
        {/* Rows the kernel RULED OUT are shown as what they are — never a button. */}
        {view.ruledOutLine ? <span className="ahsp-line ahsp-line--abu">{view.ruledOutLine}</span> : null}
        {learning.stateLine ? (
          <span className={learning.stateTone === 'PENDING' ? 'ahsp-line ahsp-line--emas' : 'ahsp-line ahsp-line--abu'}>{learning.stateLine}</span>
        ) : null}
        <span className="ahsp-line" style={{ color: MUTED, marginTop: 'var(--space-1)' }}>{view.guidance}</span>
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
        ) : learning.unavailableLine ? (
          <span className="ahsp-line ahsp-line--abu" style={{ marginTop: 'var(--space-2)' }}>{learning.unavailableLine}</span>
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
              {busyOn('new') ? 'Menyimpan…' : 'Tetapkan sebagai sumber daya baru'}
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
        {anchored ? <ActionOutcomeNotice outcome={anchored.outcome} onDismiss={() => dismissCuration(anchored.key)} /> : null}
      </li>
    );
  };

  const renderReceipt = (anchored: AnchoredOutcome, dismiss: (key: string) => void): ReactNode => (
    <li key={'receipt-' + anchored.key} className="ahsp-curation-item">
      <ActionOutcomeNotice outcome={anchored.outcome} title={anchored.title} onDismiss={() => dismiss(anchored.key)} />
    </li>
  );

  const curationList = (
    <ul className="ahsp-curation-list">
      {curationEntries.map((entry: PlacedEntry<ObservationGroup>, at) =>
        entry.kind === 'ITEM' ? renderCurationGroup(entry.item, at, entry.outcome) : renderReceipt(entry.outcome, dismissCuration),
      )}
    </ul>
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

  const curationIntro = (
    <>
      <h2 style={{ fontSize: 'var(--text-lg)', color: NAVY, margin: '0 0 var(--space-2)' }}>Sumber daya untuk ditinjau</h2>
      <p style={{ fontSize: 'var(--text-sm)', color: MUTED, margin: '0 0 var(--space-3)' }}>
        Sumber daya di bawah ini berasal dari dokumen resmi dan sudah diterima serta disimpan SIMPROK; yang belum pasti adalah identitas canonical-nya. Setiap item menyebutkan apa yang sudah dipahami SIMPROK dan keputusan apa yang masih dibutuhkan dari Anda.
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
            Unggah dokumen resmi, pahami isinya, tinjau hasilnya, lalu simpan yang terbukti.
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

      {/* Upload -> Pahami dokumen -> Tinjau hasil -> Simpan yang terbukti */}
      {canManage ? (
        <section aria-label="Unggah dan pahami dokumen" style={{ ...CARD, marginBottom: 'var(--space-4)' }}>
          <input
            type="file"
            accept=".xlsx"
            aria-label="Berkas AHSP resmi"
            style={{ maxWidth: '100%' }}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setPreview(null);
              setCommitResult(null);
              setSettled(false);
              // A new file's items are new decisions — drop any prior ones so a
              // stale decision can never ride a different document to commit.
              setDecisions({});
            }}
          />
          <div className="ahsp-action-row ahsp-action-row--stack" style={{ marginTop: 'var(--space-3)' }}>
            <button type="button" className="ahsp-action ahsp-action--primary" disabled={!file || importing} aria-busy={importAction === 'PREVIEW' || undefined} onClick={() => void previewDocument()}>
              {importAction === 'PREVIEW' ? 'Membaca…' : 'Pahami dokumen'}
            </button>
            <button type="button" className="ahsp-action ahsp-action--outline" disabled={!file || importing || !preview} aria-busy={importAction === 'COMMIT' || undefined} onClick={() => void commitDocument()}>
              {importAction === 'COMMIT' ? 'Menyimpan…' : 'Simpan yang terbukti'}
            </button>
          </div>
          {importError ? <p role="alert" style={{ color: RED, fontSize: 'var(--text-sm)' }}>{importError}</p> : null}
          {preview ? (
            <div style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-sm)', color: NAVY }}>
              <p style={{ margin: '0 0 var(--space-2)' }}>
                {recognized} pekerjaan dikenali. {ready} pekerjaan siap digunakan. {unresolved} pekerjaan masih perlu dilengkapi.
              </p>
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
              <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
                {preview.workItems.map((item, index) => {
                  const candidateNames = item.status === 'READY' ? [] : previewCandidateNames(item.resources);
                  // Rows the kernel ruled out are said as NOT used — never as possible matches.
                  const ruledOutLine = item.status === 'READY' ? null : previewRuledOutLine(previewRuledOutNames(item.resources));
                  return (
                    <li key={index} style={{ marginBottom: 'var(--space-2)', overflowWrap: 'anywhere' }}>
                      {item.workType?.raw ?? '—'} — {item.methodName?.raw ?? '—'}
                      {item.status !== 'READY'
                        ? ` · ${explainAhspItemReasons(item.reasonCodes)}`
                        : item.identityVerdict === 'IDENTICAL'
                          // READY, but it will NOT be written — it already exists. Saying
                          // "siap digunakan" here would promise a save that never happens.
                          ? ' · sudah ada di SIMPROK'
                          : ' · siap digunakan'}
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
                        // Sameness and readiness are DIFFERENT questions. An item can be
                        // an exact twin of an AHSP SIMPROK already holds while its own
                        // components are still uncurated — the ordinary first import of
                        // an official document. So the reference is ALWAYS shown; only
                        // the decision is withheld below when the item could not be
                        // admitted anyway (commit refuses a non-READY item before it
                        // reads any decision, so a button there would land nowhere).
                        const sameness = describeSameness(item);
                        if (!sameness) return null;
                        const decidable = item.status === 'READY' && !settled;
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
                        const chosen = decisions[decisionKey(item)];
                        const decisionButton = (action: SamenessDecision, label: string) => (
                          <button
                            type="button"
                            className="ahsp-action ahsp-action--outline ahsp-action--compact"
                            aria-pressed={chosen === action}
                            onClick={() => setDecision(item, action)}
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
                      })()}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          {commitResult ? (
            <p role="status" style={{ fontSize: 'var(--text-sm)', color: NAVY, marginTop: 'var(--space-3)' }}>
              {commitResult.written.length} pekerjaan disimpan. {commitResult.skipped.length} pekerjaan belum disimpan.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Curation queue — the shared observed-resource lifecycle (only when there is work) */}
      {canCurate && observations.length > 0 ? (
        <section aria-label="Sumber daya untuk ditinjau" style={{ ...CARD, marginBottom: 'var(--space-4)' }}>
          {curationIntro}
          {curationList}
        </section>
      ) : null}
      {/* The queue just emptied: the last decisions still say what they did. */}
      {canCurate && observations.length === 0 && curationOutcomes.length > 0 ? (
        <section aria-label="Sumber daya untuk ditinjau" style={{ ...CARD, marginBottom: 'var(--space-4)' }}>
          {curationIntro}
          <p role="status" style={{ fontSize: 'var(--text-sm)', color: NAVY, margin: '0 0 var(--space-2)' }}>
            Tidak ada lagi sumber daya yang menunggu tinjauan.
          </p>
          {curationList}
        </section>
      ) : null}

      {/* IQL-01 — governed exact-question learning: offered by one person, approved by another. */}
      {canSeeQuestions && shownQuestions.length > 0 ? (
        <section aria-label="Pembelajaran pertanyaan identik" style={{ ...CARD, marginBottom: 'var(--space-4)' }}>
          {learningIntro}
          {questionList}
        </section>
      ) : null}
      {canSeeQuestions && shownQuestions.length === 0 && questionOutcomes.length > 0 ? (
        <section aria-label="Pembelajaran pertanyaan identik" style={{ ...CARD, marginBottom: 'var(--space-4)' }}>
          {learningIntro}
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
          <form onSubmit={createWorkspaceAhsp} style={{ maxWidth: '36rem' }}>
            <label style={labelStyle}>Jenis pekerjaan
              <input required value={workType} onChange={(event) => setWorkType(event.target.value)} aria-label="Jenis pekerjaan" style={controlBox} />
            </label>
            <label style={{ ...labelStyle, marginTop: 'var(--space-3)' }}>Uraian
              <input required value={methodName} onChange={(event) => setMethodName(event.target.value)} aria-label="Uraian AHSP" style={controlBox} />
            </label>
            {createError ? <p role="alert" style={{ color: RED, fontSize: 'var(--text-sm)' }}>{createError}</p> : null}
            <button type="submit" className="ahsp-action ahsp-action--primary" disabled={creating} aria-busy={creating || undefined} style={{ marginTop: 'var(--space-3)' }}>
              {creating ? 'Menyimpan…' : 'Simpan AHSP milik saya'}
            </button>
          </form>
        </section>
      ) : null}
    </main>
  );
}

export default AhspImportPage;
