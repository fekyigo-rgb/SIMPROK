/**
 * WHAT A LIST READ IS, AND WHAT A READ DOES TO IT.
 *
 * The Import door reads three lists and pages one of them. Every honesty rule
 * those reads must keep is a pure function here, so the rule can be exercised
 * directly — not inferred from the page's source:
 *
 *  - a refusal (401/403) does not leave refused data on the screen;
 *  - a failed refresh keeps what was last read and SAYS it is not current;
 *  - a malformed answer is a failed read, never an empty queue;
 *  - a refresh covers every page the reader has already opened, and says so
 *    honestly when it could not cover all of them.
 *
 * Nothing here fetches, renders or stores; the page supplies the answers and
 * applies the results.
 */
import type { ImportJobWire } from './ahspImportIntakeDisplay';

/**
 * IDLE / LOADING — not asked yet, or being asked.
 * READY — the server answered and what is shown is that answer.
 * FAILED — the first read did not arrive: nothing is claimed about the list.
 * STALE — a later read did not arrive: what is shown is the last answer, said so.
 * UNAUTHORIZED — this reader may not see it, which is not an error and never
 * leaves the previous rows on the screen.
 */
export type ListPhase = 'IDLE' | 'LOADING' | 'READY' | 'FAILED' | 'STALE' | 'UNAUTHORIZED';

/** A read is either an answer, or a refusal/failure — never a silent empty. */
export type ReadResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly unauthorized: boolean };

/** Whether this read is the first one for a list, or a later one over what it already holds. */
export type ReadMode = 'INITIAL' | 'REFRESH';

export interface ListRead<T> {
  readonly phase: ListPhase;
  readonly rows: readonly T[];
}

export const emptyListRead = <T>(): ListRead<T> => ({ phase: 'IDLE', rows: [] });

/**
 * One list, one read. A refusal empties the list HERE — the browser must not
 * keep showing rows the server has just said this reader may not have. That is
 * a display truth, not a deletion: nothing in the database is touched.
 */
export const applyListRead = <T>(
  previous: ListRead<T>,
  result: ReadResult<readonly T[]>,
  mode: ReadMode,
): ListRead<T> => {
  if (result.ok) return { phase: 'READY', rows: result.data };
  if (result.unauthorized) return { phase: 'UNAUTHORIZED', rows: [] };
  return { phase: mode === 'INITIAL' ? 'FAILED' : 'STALE', rows: previous.rows };
};

// ---------------------------------------------------------------------------
// WHO MAY STILL APPLY AN ANSWER — one session epoch, one generation per list,
// and one refusal epoch per list for the actions begun on it
// ---------------------------------------------------------------------------

/** The three lists this door reads. Each one's reads end independently of the others. */
export type ListKey = 'observations' | 'questions' | 'imports';

/** One read of one list, as it was started. */
export interface ReadTicket {
  readonly list: ListKey;
  /** The workspace/session epoch the read belongs to. */
  readonly session: number;
  /** That list's OWN generation when the read began. */
  readonly generation: number;
}

/** Why an answer may no longer be applied — the two reasons are different truths. */
export type ReadObsolescence = 'SESSION' | 'SUPERSEDED';

/** A request that belongs only to the workspace/session it began in — the manual create. */
export interface SessionTicket {
  readonly session: number;
}

/** A preview or a commit, as it was begun: its session, and the document chosen then. */
export interface DocumentTicket {
  readonly session: number;
  /** The document epoch when the request began: choosing another document, or none, moves it. */
  readonly document: number;
}

/** One action on one list — a decision or a re-check — as it was begun. */
export interface ActionTicket {
  readonly list: ListKey;
  /** The workspace/session epoch the action belongs to. */
  readonly session: number;
  /** That list's refusal epoch when the action began. */
  readonly epoch: number;
}

export interface ReadCoordinator {
  /**
   * A workspace or session change: every read of EVERY list becomes obsolete,
   * and no refusal is remembered into the new context.
   */
  resetSession(): void;
  /** Begin a read of ONE list. An earlier read of that same list is superseded; other lists are untouched. */
  begin(list: ListKey): ReadTicket;
  /** Whether an answer can still be applied, and if not, why. */
  obsolete(ticket: ReadTicket): ReadObsolescence | null;
  /**
   * The server refused this list: only THIS list's earlier reads end, the refusal
   * is remembered, and every action begun on the list before now loses the right
   * to write — for good.
   */
  refuse(ticket: ReadTicket): void;
  /**
   * A lawful answer for this list: a refusal of it is no longer remembered. What the
   * refusal ended stays ended — and so does an action taken while the list was refused.
   */
  accept(ticket: ReadTicket): void;
  /** Begin an action on ONE list. The ticket is taken before anything is sent. */
  captureAction(list: ListKey): ActionTicket;
  /**
   * May this action still write on screen — a receipt, a spent choice, a cleared
   * input? Only in its own session, only if its list was not refused since it
   * began (a recovery does not give that back), and only while its list is not
   * refused now.
   */
  mayApply(action: ActionTicket): boolean;
  /**
   * May a list be read again on this action's behalf? Never once the session has
   * changed. While the action may still apply, any list it touched may be asked
   * again; once it is obsolete, only a list the server is not refusing now — an
   * obsolete action is never the reason a refused list is asked for.
   */
  mayRead(list: ListKey, action: ActionTicket): boolean;
  /** Begin a request that belongs only to the current workspace/session. */
  captureSession(): SessionTicket;
  /** Is the session a ticket — of any kind — began in still the current one? */
  sameSession(ticket: { readonly session: number }): boolean;
  /**
   * The reader chose another document, or none: every preview or commit begun for
   * the document before is obsolete. Nothing about the lists moves.
   */
  changeDocument(): void;
  /** Begin a preview or a commit of the document chosen now. */
  captureDocument(): DocumentTicket;
  /** May this preview or commit still write on screen? Only in its own session, and only for the document still chosen. */
  mayApplyDocument(ticket: DocumentTicket): boolean;
}

/**
 * SESSION INVALIDATION and LIST INVALIDATION are kept apart. A refusal of one
 * list moves only that list's generation, so a refusal of another list that is
 * already in flight is still recognised as current — and still processed —
 * instead of being dropped as "stale" before it could clear its own rows.
 *
 * A READ and an ACTION end differently. A newer read supersedes an older read and
 * leaves an action alone; a refusal of the list ends both. A later lawful answer
 * brings the list back without handing an action begun before the refusal its
 * right to write again, because a list's refusal epoch only ever moves forward.
 *
 * A DOCUMENT is neither a list nor an action on one. A preview or a commit belongs to
 * the session it began in and to the document chosen then: choosing another document
 * ends it; no read and no refusal of a list does.
 */
export const createReadCoordinator = (): ReadCoordinator => {
  let session = 0;
  let documentEpoch = 0;
  const generation: Record<ListKey, number> = { observations: 0, questions: 0, imports: 0 };
  const refused: Record<ListKey, boolean> = { observations: false, questions: false, imports: false };
  const epoch: Record<ListKey, number> = { observations: 0, questions: 0, imports: 0 };
  const lists = Object.keys(generation) as ListKey[];
  const mayApply = (action: ActionTicket): boolean =>
    action.session === session && action.epoch === epoch[action.list] && !refused[action.list];
  return {
    resetSession() {
      session += 1;
      for (const list of lists) {
        generation[list] += 1;
        refused[list] = false;
      }
    },
    begin(list) {
      generation[list] += 1;
      return { list, session, generation: generation[list] };
    },
    obsolete(ticket) {
      if (ticket.session !== session) return 'SESSION';
      if (ticket.generation !== generation[ticket.list]) return 'SUPERSEDED';
      return null;
    },
    refuse(ticket) {
      generation[ticket.list] += 1;
      refused[ticket.list] = true;
      epoch[ticket.list] += 1;
    },
    accept(ticket) {
      // Coming back moves the epoch on as well: the recovery never resets it, and an
      // action begun while the list was refused (before the screen caught up) never writes.
      if (refused[ticket.list]) epoch[ticket.list] += 1;
      refused[ticket.list] = false;
    },
    captureAction: (list) => ({ list, session, epoch: epoch[list] }),
    mayApply,
    mayRead: (list, action) => action.session === session && (mayApply(action) || !refused[list]),
    captureSession: () => ({ session }),
    sameSession: (ticket) => ticket.session === session,
    changeDocument() {
      documentEpoch += 1;
    },
    captureDocument: () => ({ session, document: documentEpoch }),
    mayApplyDocument: (ticket) => ticket.session === session && ticket.document === documentEpoch,
  };
};

/** A read the server refused (401/403) — as opposed to one that failed or answered. */
export const isRefusal = (result: ReadResult<unknown>): boolean => !result.ok && result.unauthorized;
/** A read the server answered with a usable body. */
export const isAnswer = (result: ReadResult<unknown>): boolean => result.ok;

/** What one list read needs to be orchestrated: how to ask, and what an answer or a refusal does. */
export interface ListReadStep<R> {
  readonly list: ListKey;
  readonly read: () => Promise<R>;
  /** The server refused this reader. */
  readonly refusedBy: (answer: R) => boolean;
  /** The server answered lawfully, so an earlier refusal is not remembered. */
  readonly answeredBy: (answer: R) => boolean;
  /** Put the answer on screen (through the pure transitions above). */
  readonly apply: (answer: R) => void;
  /** Take everything derived from THIS list off the screen: choices, receipts, opened details. */
  readonly forget: () => void;
}

export type ListReadOutcome<R> =
  | { readonly applied: true; readonly answer: R }
  | { readonly applied: false; readonly obsolete: ReadObsolescence };

/**
 * ONE READ OF ONE LIST, ORCHESTRATED. An answer is applied only if its session
 * is still current and no newer read of the SAME list has begun. A refusal is
 * then handled for this list alone — its rows, choices and receipts leave the
 * screen, and only its own earlier reads are ended — whatever any other list
 * did while this one was waiting.
 */
export const runListRead = async <R>(
  reads: ReadCoordinator,
  step: ListReadStep<R>,
): Promise<ListReadOutcome<R>> => {
  const ticket = reads.begin(step.list);
  const answer = await step.read();
  const obsolete = reads.obsolete(ticket);
  if (obsolete !== null) return { applied: false, obsolete };
  if (step.refusedBy(answer)) {
    reads.refuse(ticket);
    step.forget();
  } else if (step.answeredBy(answer)) {
    reads.accept(ticket);
  }
  step.apply(answer);
  return { applied: true, answer };
};

/**
 * AFTER AN ACTION THE SERVER IS ASKED AGAIN — through the list's own loader, under
 * the current session and authorization, never from the action's own answer — but
 * only while that action may still ask for the list.
 */
export const readAgainFor = <T>(
  reads: ReadCoordinator,
  action: ActionTicket,
  list: ListKey,
  load: () => Promise<T>,
): Promise<T | null> => (reads.mayRead(list, action) ? load() : Promise.resolve(null));

// ---------------------------------------------------------------------------
// ONE PAGE OF IMPORTS — the contract, proved before it is believed
// ---------------------------------------------------------------------------

/** One page of imports, exactly as GET /ahsp/document/jobs answers it. */
export interface ImportJobPage {
  readonly rows: readonly ImportJobWire[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

/** A plain array of rows, or nothing: an answer of another shape was not read. */
export const asRows = <T>(value: unknown): T[] | null => (Array.isArray(value) ? (value as T[]) : null);

/**
 * THE PAGE CONTRACT, PROVED. A shape the read-model cannot use is not a page:
 * it is a failed read, and the caller says so rather than showing an empty
 * queue. Nothing is coerced — a broken `hasMore` never becomes `false`, and a
 * broken cursor never becomes `null`, because that would hide the damage.
 *
 * Unknown extra fields are allowed: this frontend is not a second, narrower
 * definition of the API. The cursor stays opaque — its shape is the server's
 * business, so only "absent" and "a non-empty string" are distinguished here.
 */
export const asImportPage = (value: unknown): ImportJobPage | null => {
  if (!isPlainObject(value)) return null;
  const { items, nextCursor, hasMore } = value;
  if (!Array.isArray(items)) return null;
  if (typeof hasMore !== 'boolean') return null;
  if (nextCursor !== null && !isNonEmptyString(nextCursor)) return null;
  // A page that says more waits must say where to continue; a page that says it
  // is the last one must not carry a way on.
  if (hasMore && !isNonEmptyString(nextCursor)) return null;
  if (!hasMore && nextCursor !== null) return null;
  const rows: ImportJobWire[] = [];
  for (const item of items) {
    if (!isPlainObject(item)) return null;
    // Identity is what the reader's list is keyed and reconciled by. A row
    // without one cannot be shown, replaced or acted on.
    if (!isNonEmptyString(item.importJobId)) return null;
    rows.push(item as ImportJobWire);
  }
  return { rows, nextCursor, hasMore };
};

// ---------------------------------------------------------------------------
// THE IMPORTS THE READER HAS OPENED — one scope, kept up to date
// ---------------------------------------------------------------------------

export interface ImportScope {
  readonly phase: ListPhase;
  /** Every import the reader has opened, in the order the server gave them. */
  readonly jobs: readonly ImportJobWire[];
  /** The cursor each opened page was read with; the first page is always null. */
  readonly cursors: readonly (string | null)[];
  /**
   * How many pages the reader has opened. A refusal takes the pages off the screen —
   * rows, cursors, the way on — but not how far the reader had read, so the lawful read
   * that brings the list back reads as far again, by the server's own cursors.
   */
  readonly pagesOpened: number;
  /** Where the opened scope ends. Only an answer moves it. */
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export const EMPTY_IMPORT_SCOPE: ImportScope = {
  phase: 'IDLE',
  jobs: [],
  cursors: [],
  pagesOpened: 0,
  nextCursor: null,
  hasMore: false,
};

const REFUSED_SCOPE: ImportScope = { ...EMPTY_IMPORT_SCOPE, phase: 'UNAUTHORIZED' };

/** A refusal empties the scope; only how many pages were opened is kept, for the read that brings it back. */
const refusedFrom = (previous: ImportScope): ImportScope => ({ ...REFUSED_SCOPE, pagesOpened: previous.pagesOpened });

const idOf = (job: ImportJobWire): string => job.importJobId ?? '';

/**
 * A later answer about the same import REPLACES the one on screen — it is the
 * same job, freshly stated, not a duplicate to be dropped. Jobs not named by
 * the answer keep their place; jobs the answer adds are appended once, in the
 * order the server gave them.
 */
export const mergeImportJobs = (
  previous: readonly ImportJobWire[],
  incoming: readonly ImportJobWire[],
): ImportJobWire[] => {
  const byId = new Map(incoming.map((job) => [idOf(job), job]));
  const merged = previous.map((job) => byId.get(idOf(job)) ?? job);
  const known = new Set(previous.map(idOf));
  for (const job of incoming) {
    if (!known.has(idOf(job))) {
      merged.push(job);
      known.add(idOf(job));
    }
  }
  return merged;
};

/** The first page: it states the scope anew. */
export const applyInitialImportPage = (
  previous: ImportScope,
  result: ReadResult<ImportJobPage>,
): ImportScope => {
  if (result.ok) {
    return {
      phase: 'READY',
      jobs: result.data.rows,
      cursors: [null],
      pagesOpened: 1,
      nextCursor: result.data.nextCursor,
      hasMore: result.data.hasMore,
    };
  }
  if (result.unauthorized) return refusedFrom(previous);
  return { ...previous, phase: 'FAILED' };
};

/**
 * One more page at the end of the opened scope. A failure moves nothing: the
 * cursor is not advanced, so pressing again asks the same question and loses
 * nothing.
 */
export const applyOlderImportPage = (
  previous: ImportScope,
  cursor: string,
  result: ReadResult<ImportJobPage>,
): ImportScope => {
  if (result.ok) {
    // The first page always stands first in the scope.
    const cursors = [...importScopePages(previous), cursor];
    return {
      phase: previous.phase === 'STALE' ? 'STALE' : 'READY',
      jobs: mergeImportJobs(previous.jobs, result.data.rows),
      cursors,
      // One page deeper than the reader had opened — also when a refresh that failed part way
      // left fewer pages recorded than were opened.
      pagesOpened: Math.max(previous.pagesOpened, importScopePages(previous).length) + 1,
      nextCursor: result.data.nextCursor,
      hasMore: result.data.hasMore,
    };
  }
  if (result.unauthorized) return refusedFrom(previous);
  return previous;
};

/**
 * THE PAGE A REFRESH READS NEXT — or `undefined` when the walk is done. Every refresh
 * and every retry starts at the first page, then follows the cursor the server has
 * just handed out, page after page, as deep as the reader had opened (`pagesOpened`)
 * and no further than the server has pages. A cursor recorded earlier never chooses a
 * page: when newer imports arrive in front, the server's page boundaries move, and
 * only its latest answer knows where they are now. A page that did not arrive ends
 * the walk. The cursor is the server's own — handed back as it came, never read.
 */
export const nextRefreshCursor = (
  scope: ImportScope,
  results: readonly ReadResult<ImportJobPage>[],
): string | null | undefined => {
  const last = results[results.length - 1];
  if (last === undefined) return null;
  if (!last.ok) return undefined;
  if (!last.data.hasMore || results.length >= Math.max(scope.pagesOpened, 1)) return undefined;
  return last.data.nextCursor;
};

/**
 * THE OPENED PAGES, AS THE SERVER HOLDS THEM NOW — one result per page the walk read
 * (`nextRefreshCursor`): the first page, then the server's fresh cursors, as deep as
 * the reader had opened. A walk that COMPLETED — every page arrived, to that depth or
 * to the server's last page — is the scope: what it read is what is shown, READY, and
 * an import pushed past the depth by newer ones is one "older imports" press away,
 * where the way on now points. A walk that did NOT complete says STALE: the pages that
 * arrived replace what they name, what could not be read again is kept as it was, and
 * where the scope ends is left where it was. Either way, the next retry starts again
 * at the first page, so a scope that was STALE converges as soon as a walk completes.
 */
export const applyImportRefresh = (
  previous: ImportScope,
  results: readonly ReadResult<ImportJobPage>[],
): ImportScope => {
  if (results.some((result) => !result.ok && result.unauthorized)) return refusedFrom(previous);
  const answered: ImportJobPage[] = [];
  let arrived = results.length > 0;
  for (const result of results) {
    if (!result.ok) {
      arrived = false;
      break;
    }
    answered.push(result.data);
  }
  const last = answered[answered.length - 1];
  const complete =
    arrived && last !== undefined && (!last.hasMore || answered.length >= Math.max(previous.pagesOpened, 1));
  const refreshed: ImportJobWire[] = [];
  const seen = new Set<string>();
  for (const page of answered) {
    for (const job of page.rows) {
      if (seen.has(idOf(job))) continue;
      seen.add(idOf(job));
      refreshed.push(job);
    }
  }
  const kept = complete ? [] : previous.jobs.filter((job) => !seen.has(idOf(job)));
  // The cursor each answered page was read with, as the walk chose it: the first page, then fresh cursors.
  const walked: (string | null)[] = [];
  for (let index = 0; index < answered.length; index += 1) {
    const cursor = nextRefreshCursor(previous, results.slice(0, index));
    if (cursor === undefined) break;
    walked.push(cursor);
  }
  // The scope records the pages as this walk read them — never a cursor from an earlier walk.
  const cursors = walked.length > 0 ? walked : previous.cursors;
  return {
    phase: complete ? 'READY' : 'STALE',
    jobs: [...refreshed, ...kept],
    cursors,
    pagesOpened: Math.max(previous.pagesOpened, cursors.length),
    // Only a complete walk may restate where the scope ends.
    nextCursor: complete ? last.nextCursor : previous.nextCursor,
    hasMore: complete ? last.hasMore : previous.hasMore,
  };
};

/** The pages the scope records as opened, the first page first — its depth, never a refresh's choice of page. */
export const importScopePages = (scope: ImportScope): readonly (string | null)[] =>
  scope.cursors.length > 0 ? scope.cursors : [null];
