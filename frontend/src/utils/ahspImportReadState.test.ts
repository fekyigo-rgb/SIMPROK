import test from "node:test";
import assert from "node:assert/strict";

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
  importScopePages,
  isAnswer,
  isRefusal,
  mergeImportJobs,
  nextRefreshCursor,
  readAgainFor,
  runListRead,
  type ActionTicket,
  type DocumentTicket,
  type ImportJobPage,
  type ListKey,
  type ListRead,
  type ImportScope,
  type ReadCoordinator,
  type ReadResult,
  type SessionTicket,
} from "./ahspImportReadState.ts";
import type { ImportJobWire } from "./ahspImportIntakeDisplay.ts";

/**
 * F03 — THE READ-STATE LAWS, exercised on the real functions the page uses.
 *
 * Each test states a truth a reader must be able to rely on: refused data leaves
 * the screen, a failed refresh is said, every opened page is re-read, and a
 * broken answer is a failed read rather than an empty queue.
 */

const job = (importJobId: string, over: Partial<ImportJobWire> = {}): ImportJobWire => ({
  importJobId,
  sourceFileName: importJobId + ".xlsx",
  counts: { received: 1, represented: 0, waiting: 1 },
  waiting: [],
  ...over,
});
const page = (rows: ImportJobWire[], nextCursor: string | null = null): ImportJobPage => ({
  rows,
  nextCursor,
  hasMore: nextCursor !== null,
});
const answered = (data: ImportJobPage): ReadResult<ImportJobPage> => ({ ok: true, data });
const refused: ReadResult<never> = { ok: false, unauthorized: true };
const failed: ReadResult<never> = { ok: false, unauthorized: false };

// ── R1 — a refusal takes the refused data off the screen ────────────────────

test("R1: a refused read empties that list — on the first read and on a later one", () => {
  const held: ListRead<string> = { phase: "READY", rows: ["one", "two"] };
  for (const mode of ["INITIAL", "REFRESH"] as const) {
    const after: ListRead<string> = applyListRead<string>(held, refused, mode);
    assert.equal(after.phase, "UNAUTHORIZED");
    assert.deepEqual(after.rows, [], "rows the server just refused must not stay on screen");
  }
});

test("R1: a refused page of imports empties the scope — initial, older page, and refresh alike", () => {
  const opened: ImportScope = {
    phase: "READY",
    jobs: [job("a"), job("b")],
    cursors: [null, "cursor-2"],
    // FIXTURE SHAPE (import trust seams): the scope now also counts the pages opened. No expectation changed.
    pagesOpened: 2,
    nextCursor: "cursor-3",
    hasMore: true,
  };
  const refusals: ImportScope[] = [
    applyInitialImportPage(opened, refused),
    applyOlderImportPage(opened, "cursor-3", refused),
    applyImportRefresh(opened, [answered(page([job("a")], "cursor-2")), refused]),
  ];
  for (const after of refusals) {
    assert.equal(after.phase, "UNAUTHORIZED");
    assert.deepEqual(after.jobs, []);
    assert.deepEqual(after.cursors, []);
    assert.equal(after.nextCursor, null);
    assert.equal(after.hasMore, false, "no door to more of what was refused");
  }
});

// ── R1 FINAL — per-list refusal isolation, exercised on the real orchestration ──
//
// CHANGE NOTE (R1 final race closeout): the F03 test here pinned ONE global read
// token (`readTokenChanged` / `nextGeneration`). That token was the defect: a
// refusal of one list moved it, so another list's refusal already in flight was
// dropped as stale before it could clear its own rows. The law it guarded — an
// answer from before a refusal can never put rows back — is kept, now per list,
// and the tests below drive the orchestration itself with deferred answers.
// TEST_WEAKENING=NO.

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

const refusal = { ok: false, unauthorized: true } as const;
const rowsOf = (data: string[]): ReadResult<readonly string[]> => ({ ok: true, data });

/**
 * Three lists held the way the page holds them — rows, and the receipts and
 * choices derived from each — driven through runListRead with gates this test
 * opens in the order it chooses.
 */
const board = (onForget?: (list: ListKey) => void) => {
  const reads = createReadCoordinator();
  const lists: { observations: ListRead<string>; questions: ListRead<string> } = {
    observations: { phase: "READY", rows: ["obs-1"] },
    questions: { phase: "READY", rows: ["question-1", "question-2"] },
  };
  let imports: ImportScope = applyInitialImportPage(EMPTY_IMPORT_SCOPE, answered(page([job("job-1")], "cursor-2")));
  const derived: Record<ListKey, { receipts: string[]; choices: string[] }> = {
    observations: { receipts: ["curation receipt"], choices: ["remember obs-1"] },
    questions: { receipts: ["question receipt"], choices: ["reason for question-1"] },
    imports: { receipts: ["recheck receipt"], choices: ["job-1: KEEP_SEPARATE"] },
  };
  const forget = (list: ListKey) => () => {
    derived[list] = { receipts: [], choices: [] };
    onForget?.(list);
  };
  const readList = (list: "observations" | "questions", gate: Promise<ReadResult<readonly string[]>>, mode: "INITIAL" | "REFRESH" = "REFRESH") =>
    runListRead(reads, {
      list,
      read: () => gate,
      refusedBy: isRefusal,
      answeredBy: isAnswer,
      apply: (answer) => {
        lists[list] = applyListRead(lists[list], answer, mode);
      },
      forget: forget(list),
    });
  const readImports = (gate: Promise<ReadResult<ImportJobPage>[]>) =>
    runListRead(reads, {
      list: "imports",
      read: () => gate,
      refusedBy: (results) => results.some(isRefusal),
      answeredBy: (results) => results.length > 0 && results.every(isAnswer),
      apply: (results) => {
        imports = applyImportRefresh(imports, results);
      },
      forget: forget("imports"),
    });
  /** A workspace change, as the page's effect runs it: every list starts again from nothing. */
  const resetLists = () => {
    lists.observations = emptyListRead<string>();
    lists.questions = emptyListRead<string>();
    imports = EMPTY_IMPORT_SCOPE;
  };
  return {
    reads,
    lists,
    derived: () => derived,
    imports: () => imports,
    readList,
    readImports,
    forget: (list: ListKey) => forget(list)(),
    resetLists,
  };
};

/** Start the three refreshes together, as the page does, each behind its own gate. */
const startAll = (b: ReturnType<typeof board>) => {
  const gates = {
    observations: deferred<ReadResult<readonly string[]>>(),
    questions: deferred<ReadResult<readonly string[]>>(),
    imports: deferred<ReadResult<ImportJobPage>[]>(),
  };
  const running = {
    observations: b.readList("observations", gates.observations.promise),
    questions: b.readList("questions", gates.questions.promise),
    imports: b.readImports(gates.imports.promise),
  };
  return { gates, running };
};

const assertRefused = (b: ReturnType<typeof board>, list: ListKey) => {
  if (list === "imports") {
    assert.equal(b.imports().phase, "UNAUTHORIZED");
    assert.deepEqual(b.imports().jobs, []);
    assert.equal(b.imports().nextCursor, null);
    assert.equal(b.imports().hasMore, false);
  } else {
    assert.equal(b.lists[list].phase, "UNAUTHORIZED", list + " must be refused");
    assert.deepEqual(b.lists[list].rows, [], list + " rows must leave the screen");
  }
  assert.deepEqual(b.derived()[list], { receipts: [], choices: [] }, list + " receipts and choices must go too");
};

const REFUSAL_ORDERS: ListKey[][] = [
  ["observations", "questions", "imports"],
  ["questions", "observations", "imports"],
  ["imports", "observations", "questions"],
  ["imports", "questions", "observations"],
  ["observations", "imports", "questions"],
  ["questions", "imports", "observations"],
];

for (const [index, order] of REFUSAL_ORDERS.entries()) {
  test(`R1-${index < 2 ? index + 1 : "1/2 (extra order)"}: three refusals in flight together, answered ${order.join(" → ")} — every one of them is processed`, async () => {
    const b = board();
    const { gates, running } = startAll(b);
    for (const list of order) {
      if (list === "imports") gates.imports.resolve([refusal]);
      else gates[list].resolve(refusal);
      await running[list];
    }
    for (const list of order) assertRefused(b, list);
  });
}

test("R1-3: observations refused, questions and imports answered — only observations leave the screen", async () => {
  const b = board();
  const { gates, running } = startAll(b);
  gates.observations.resolve(refusal);
  await running.observations;
  gates.questions.resolve(rowsOf(["question-1", "question-2", "question-3"]));
  gates.imports.resolve([answered(page([job("job-1"), job("job-2")], "cursor-2"))]);
  await Promise.all([running.questions, running.imports]);
  assertRefused(b, "observations");
  assert.equal(b.lists.questions.phase, "READY");
  assert.deepEqual(b.lists.questions.rows, ["question-1", "question-2", "question-3"]);
  assert.equal(b.imports().phase, "READY");
  assert.deepEqual(b.imports().jobs.map((entry) => entry.importJobId), ["job-1", "job-2"]);
  assert.deepEqual(b.derived().questions.receipts, ["question receipt"], "a lawful list keeps its receipts");
  assert.deepEqual(b.derived().imports.receipts, ["recheck receipt"]);
});

test("R1-4: questions refused, observations and imports answered — only questions leave the screen", async () => {
  const b = board();
  const { gates, running } = startAll(b);
  gates.questions.resolve(refusal);
  await running.questions;
  gates.observations.resolve(rowsOf(["obs-1", "obs-2"]));
  gates.imports.resolve([answered(page([job("job-1")], "cursor-2"))]);
  await Promise.all([running.observations, running.imports]);
  assertRefused(b, "questions");
  assert.deepEqual(b.lists.observations.rows, ["obs-1", "obs-2"]);
  assert.equal(b.imports().phase, "READY");
  assert.deepEqual(b.derived().observations.receipts, ["curation receipt"]);
});

test("R1-5: imports refused, observations and questions answered — only imports leave the screen", async () => {
  const b = board();
  const { gates, running } = startAll(b);
  gates.imports.resolve([refusal]);
  await running.imports;
  gates.observations.resolve(rowsOf(["obs-1"]));
  gates.questions.resolve(rowsOf(["question-1"]));
  await Promise.all([running.observations, running.questions]);
  assertRefused(b, "imports");
  assert.equal(b.lists.observations.phase, "READY");
  assert.equal(b.lists.questions.phase, "READY");
  assert.deepEqual(b.derived().questions.receipts, ["question receipt"]);
});

test("R1-6: an older successful answer of a list arriving after that list's refusal never revives it", async () => {
  const b = board();
  const older = deferred<ReadResult<readonly string[]>>();
  const newer = deferred<ReadResult<readonly string[]>>();
  const olderRead = b.readList("observations", older.promise, "INITIAL");
  const newerRead = b.readList("observations", newer.promise);
  newer.resolve(refusal);
  await newerRead;
  assertRefused(b, "observations");
  older.resolve(rowsOf(["obs-1", "privileged-late-row"]));
  assert.deepEqual(await olderRead, { applied: false, obsolete: "SUPERSEDED" });
  assertRefused(b, "observations");
});

// CHANGE NOTE (R1 mutation-epoch closeout): R1-7 and R1-8 keep their law and read
// it through per-list action tickets instead of the session a mutation captured.
// R1-10 is a DEFECT-CORRECTION, not TEST_WEAKENING: it asserted that an action
// captured BEFORE a refusal may write again once the list is read lawfully
// (`mayShow(list, session)` true after the recovery). That expectation was the
// defect — an old decision's receipt and spent choices came back. It now asserts
// the opposite for that action, with a positive control for an action begun
// after the recovery. TEST_WEAKENING=NO.

test("R1-7: a mutation's receipt arriving after its list was refused is not shown — other lists still may", async () => {
  const b = board();
  // Each action takes its ticket before it waits on the server.
  const actions: Record<ListKey, ActionTicket> = {
    observations: b.reads.captureAction("observations"),
    questions: b.reads.captureAction("questions"),
    imports: b.reads.captureAction("imports"),
  };
  const refreshed = deferred<ReadResult<readonly string[]>>();
  const read = b.readList("observations", refreshed.promise);
  refreshed.resolve(refusal);
  await read;
  assert.equal(b.reads.mayApply(actions.observations), false, "no receipt for a refused list");
  assert.equal(b.reads.mayApply(actions.questions), true, "a lawful list is not affected");
  assert.equal(b.reads.mayApply(actions.imports), true);
});

test("R1-8: a workspace switch while three reads are in flight drops every one of their answers", async () => {
  const b = board();
  const actions: Record<ListKey, ActionTicket> = {
    observations: b.reads.captureAction("observations"),
    questions: b.reads.captureAction("questions"),
    imports: b.reads.captureAction("imports"),
  };
  const { gates, running } = startAll(b);
  b.reads.resetSession();
  gates.observations.resolve(refusal);
  gates.questions.resolve(rowsOf(["other-workspace-question"]));
  gates.imports.resolve([answered(page([job("other-workspace-job")]))]);
  assert.deepEqual(await running.observations, { applied: false, obsolete: "SESSION" });
  assert.deepEqual(await running.questions, { applied: false, obsolete: "SESSION" });
  assert.deepEqual(await running.imports, { applied: false, obsolete: "SESSION" });
  assert.deepEqual(b.lists.questions.rows, ["question-1", "question-2"], "nothing from the old session was applied");
  assert.deepEqual(b.imports().jobs.map((entry) => entry.importJobId), ["job-1"]);
  assert.deepEqual(b.derived().observations.receipts, ["curation receipt"], "not even its refusal is processed");
  for (const list of ["observations", "questions", "imports"] as const) {
    assert.equal(b.reads.mayApply(actions[list]), false, "no receipt from the old session");
  }
});

test("R1-9: a newer read of the same list supersedes only that list's older read", async () => {
  const b = board();
  const older = deferred<ReadResult<readonly string[]>>();
  const newer = deferred<ReadResult<readonly string[]>>();
  const questions = deferred<ReadResult<readonly string[]>>();
  const olderRead = b.readList("observations", older.promise);
  const questionsRead = b.readList("questions", questions.promise);
  const newerRead = b.readList("observations", newer.promise);
  newer.resolve(rowsOf(["obs-new"]));
  await newerRead;
  older.resolve(rowsOf(["obs-old"]));
  assert.deepEqual(await olderRead, { applied: false, obsolete: "SUPERSEDED" });
  assert.deepEqual(b.lists.observations.rows, ["obs-new"]);
  questions.resolve(rowsOf(["question-9"]));
  const questionsOutcome = await questionsRead;
  assert.equal(questionsOutcome.applied, true, "another list's read is not superseded");
  assert.deepEqual(b.lists.questions.rows, ["question-9"]);
});

test("R1-10: after a refusal, a new lawful read brings the list back — an action begun before the refusal stays obsolete, a new one may write", async () => {
  const b = board();
  const before = b.reads.captureAction("questions");
  const refused = deferred<ReadResult<readonly string[]>>();
  const first = b.readList("questions", refused.promise);
  refused.resolve(refusal);
  await first;
  assertRefused(b, "questions");
  assert.equal(b.reads.mayApply(before), false);
  const lawful = deferred<ReadResult<readonly string[]>>();
  const second = b.readList("questions", lawful.promise, "INITIAL");
  lawful.resolve(rowsOf(["question-1"]));
  await second;
  assert.equal(b.lists.questions.phase, "READY");
  assert.deepEqual(b.lists.questions.rows, ["question-1"]);
  // DEFECT-CORRECTION: this asserted true — the old action regaining its right to write.
  assert.equal(b.reads.mayApply(before), false, "an action begun before the refusal never writes again");
  assert.equal(b.reads.mayApply(b.reads.captureAction("questions")), true, "an action begun after the recovery may");
});

test("R1: the coordinator names why an answer is obsolete — session first, then the list itself", () => {
  const reads: ReadCoordinator = createReadCoordinator();
  const ticket = reads.begin("observations");
  assert.equal(reads.obsolete(ticket), null);
  // Another list refusing does not touch this ticket.
  reads.refuse(reads.begin("questions"));
  assert.equal(reads.obsolete(ticket), null);
  reads.refuse(ticket);
  assert.equal(reads.obsolete(ticket), "SUPERSEDED");
  const next = reads.begin("imports");
  reads.resetSession();
  assert.equal(reads.obsolete(next), "SESSION");
});

test("R1: access returning later is not blocked by the earlier refusal", () => {
  const refusedRead = applyListRead<string>({ phase: "READY", rows: ["one"] }, refused, "REFRESH");
  const recovered = applyListRead(refusedRead, { ok: true, data: ["one", "two"] }, "INITIAL");
  assert.equal(recovered.phase, "READY");
  assert.deepEqual(recovered.rows, ["one", "two"]);
});

// ── R1 MUTATION EPOCH — an action begun before a refusal never writes again ──
//
// REGRESSION FIRST: these tests were written before the repair and run on a desk
// that mirrored the page as it was — a boolean lock held until `finally`, the
// session captured before the request, `mayShow(list, session)` in front of the
// receipt, and every list read again unconditionally. On that shape R1-T1, T1b,
// T2, T3, T4b, T5 and T7 FAILED (a refusal followed by a recovery handed the old
// action its right to write back); T4, T6 and T8 passed as positive controls. The
// expectations are unchanged; the desk now mirrors the repaired page.

type Post = { readonly ok: boolean };
const LISTS: readonly ListKey[] = ["observations", "questions", "imports"];

/**
 * The page's three list actions — curateGroup, governQuestion, recheckImport —
 * over the board above: each list's controls held by the action that owns them,
 * the receipt and the local choice an action may write, and the lists it reads
 * again once the server answered. The server's answer to the action waits on a
 * gate this test opens; the reads that refuse or restore a list are the page's
 * own reads.
 */
const desk = () => {
  // Like the page: the controls are held by an action's ticket, and a refusal of the list frees them.
  const locks: Record<ListKey, ActionTicket | null> = { observations: null, questions: null, imports: null };
  const b = board((list) => {
    locks[list] = null;
  });
  const posts: string[] = [];
  const refreshes: ListKey[] = [];
  // What the server answers when a list is read now.
  const truth: {
    observations: ReadResult<readonly string[]>;
    questions: ReadResult<readonly string[]>;
    imports: ReadResult<ImportJobPage>[];
  } = {
    observations: rowsOf(["obs-1"]),
    questions: rowsOf(["question-1", "question-2"]),
    imports: [answered(page([job("job-1")], "cursor-2"))],
  };
  const again = {
    observations: () => {
      refreshes.push("observations");
      return b.readList("observations", Promise.resolve(truth.observations));
    },
    questions: () => {
      refreshes.push("questions");
      return b.readList("questions", Promise.resolve(truth.questions));
    },
    imports: () => {
      refreshes.push("imports");
      return b.readImports(Promise.resolve(truth.imports));
    },
  };
  const phaseOf = (list: ListKey) => (list === "imports" ? b.imports().phase : b.lists[list].phase);
  const receipt = (list: ListKey, text: string) => {
    b.derived()[list].receipts.push(text);
  };
  const spend = (list: ListKey, prefix: string) => {
    b.derived()[list].choices = b.derived()[list].choices.filter((choice) => !choice.startsWith(prefix));
  };

  /** curateGroup — one decision for a group of identical rows, sent row by row. */
  const curateRows = async (keys: readonly string[], answers: readonly Promise<Post>[]) => {
    if (locks.observations !== null || phaseOf("observations") === "UNAUTHORIZED") return;
    const ticket = b.reads.captureAction("observations");
    locks.observations = ticket;
    try {
      let saved = 0;
      for (const [index, key] of keys.entries()) {
        if (!b.reads.mayApply(ticket)) break;
        posts.push("curate " + key);
        const { ok } = await answers[index];
        if (!ok) break;
        saved += 1;
      }
      await readAgainFor(b.reads, ticket, "observations", again.observations);
      if (b.reads.mayApply(ticket)) {
        receipt("observations", saved === keys.length ? "curation receipt: " + keys.join(", ") : `curation partial: ${saved}/${keys.length}`);
      }
      await Promise.all([
        readAgainFor(b.reads, ticket, "questions", again.questions),
        readAgainFor(b.reads, ticket, "imports", again.imports),
      ]);
    } finally {
      if (locks.observations === ticket) locks.observations = null;
    }
  };
  const curate = (key: string, answer: Promise<Post>) => curateRows([key], [answer]);

  /** governQuestion */
  const govern = async (key: string, answer: Promise<Post>) => {
    if (locks.questions !== null || phaseOf("questions") === "UNAUTHORIZED") return;
    const ticket = b.reads.captureAction("questions");
    const record = (text: string) => {
      if (!b.reads.mayApply(ticket)) return;
      receipt("questions", text);
    };
    locks.questions = ticket;
    try {
      posts.push("govern " + key);
      const { ok } = await answer;
      if (ok) {
        record("question receipt: " + key);
        if (b.reads.mayApply(ticket)) spend("questions", "reason for " + key);
      } else {
        record("question failure: " + key);
      }
      await Promise.all([
        readAgainFor(b.reads, ticket, "questions", again.questions),
        readAgainFor(b.reads, ticket, "observations", again.observations),
      ]);
    } finally {
      if (locks.questions === ticket) locks.questions = null;
    }
  };

  /** recheckImport */
  const recheck = async (key: string, answer: Promise<Post>) => {
    if (locks.imports !== null || phaseOf("imports") === "UNAUTHORIZED") return;
    const ticket = b.reads.captureAction("imports");
    locks.imports = ticket;
    try {
      posts.push("recheck " + key);
      const { ok } = await answer;
      if (ok && b.reads.mayApply(ticket)) spend("imports", key + ":");
      await readAgainFor(b.reads, ticket, "imports", again.imports);
      if (b.reads.mayApply(ticket)) receipt("imports", (ok ? "recheck receipt: " : "recheck failure: ") + key);
      await Promise.all([
        readAgainFor(b.reads, ticket, "observations", again.observations),
        readAgainFor(b.reads, ticket, "questions", again.questions),
      ]);
    } finally {
      if (locks.imports === ticket) locks.imports = null;
    }
  };

  return {
    ...b,
    posts,
    refreshes,
    truth,
    curate,
    curateRows,
    govern,
    recheck,
    locked: (list: ListKey): boolean => locks[list] !== null,
    holder: (list: ListKey): unknown => locks[list],
    choose: (list: ListKey, choice: string) => {
      b.derived()[list].choices.push(choice);
    },
    /** A read of the list the server refuses. */
    refuse: (list: ListKey) =>
      list === "imports" ? b.readImports(Promise.resolve([refusal])) : b.readList(list, Promise.resolve(refusal)),
    /** A lawful read of the list: whatever the server holds now. */
    restore: (list: ListKey) =>
      list === "imports" ? b.readImports(Promise.resolve(truth.imports)) : b.readList(list, Promise.resolve(truth[list])),
    /** The page's effect on a workspace change. */
    switchWorkspace: () => {
      b.reads.resetSession();
      b.resetLists();
      for (const list of LISTS) b.forget(list);
    },
  };
};

test("R1-T1: a re-check begun before the imports were refused writes nothing after they recover — no receipt, no spent choice, no second POST", async () => {
  const d = desk();
  const answer = deferred<Post>();
  const running = d.recheck("job-1", answer.promise);
  await d.refuse("imports");
  assertRefused(d, "imports");
  // The server has run the re-check; the import is read back as it stands now.
  d.truth.imports = [answered(page([job("job-1", { counts: { received: 1, represented: 1, waiting: 0 } })], "cursor-2"))];
  await d.restore("imports");
  // On the card that came back, the reader decides again.
  d.choose("imports", "job-1: USE_EXISTING");
  answer.resolve({ ok: true });
  await running;
  assert.deepEqual(
    {
      receipts: d.derived().imports.receipts,
      choices: d.derived().imports.choices,
      posts: d.posts,
      // Which phase a refresh gives a scope a refusal emptied is the opened-scope rule's
      // business (R3), not this one's: here the list only has to be back and usable.
      usable: d.imports().phase !== "UNAUTHORIZED",
      counts: d.imports().jobs[0]?.counts,
      controlsHeld: d.locked("imports"),
    },
    {
      receipts: [], // no receipt from before the refusal
      choices: ["job-1: USE_EXISTING"], // the choice made after the recovery is not spent by the old re-check
      posts: ["recheck job-1"], // sent once, never again
      usable: true,
      counts: { received: 1, represented: 1, waiting: 0 }, // what shows is the server's truth, read again
      controlsHeld: false,
    },
  );
});

test("R1-T1b: an obsolete re-check never becomes the reason a list the server still refuses is asked for again", async () => {
  const d = desk();
  const answer = deferred<Post>();
  const running = d.recheck("job-1", answer.promise);
  await d.refuse("imports");
  answer.resolve({ ok: true });
  await running;
  assert.deepEqual(
    { receipts: d.derived().imports.receipts, phase: d.imports().phase, refreshes: d.refreshes, posts: d.posts },
    { receipts: [], phase: "UNAUTHORIZED", refreshes: ["observations", "questions"], posts: ["recheck job-1"] },
  );
});

test("R1-T2: a curation decision begun before the curation list was refused writes nothing after it recovers", async () => {
  const d = desk();
  d.truth.observations = rowsOf(["obs-1", "obs-2"]);
  const answer = deferred<Post>();
  const running = d.curate("obs-1", answer.promise);
  await d.refuse("observations");
  // Back again — obs-1 still asks, because the decision has not landed yet.
  await d.restore("observations");
  d.choose("observations", "remember obs-2");
  // Then it lands on the server.
  d.truth.observations = rowsOf(["obs-2"]);
  answer.resolve({ ok: true });
  await running;
  assert.deepEqual(
    {
      receipts: d.derived().observations.receipts,
      choices: d.derived().observations.choices,
      rows: d.lists.observations.rows,
      posts: d.posts,
      controlsHeld: d.locked("observations"),
    },
    {
      receipts: [], // no receipt from before the refusal
      choices: ["remember obs-2"], // the reader's own choice on the list that came back stays
      rows: ["obs-2"], // the list is what a fresh GET says
      posts: ["curate obs-1"],
      controlsHeld: false,
    },
  );
});

test("R1-T3: a learning decision begun before the questions were refused writes nothing after they recover — no receipt, no cleared reason", async () => {
  const d = desk();
  const answer = deferred<Post>();
  const running = d.govern("question-1", answer.promise);
  await d.refuse("questions");
  await d.restore("questions");
  d.choose("questions", "reason for question-1: typed after the recovery");
  d.truth.questions = rowsOf(["question-2"]);
  answer.resolve({ ok: true });
  await running;
  assert.deepEqual(
    {
      receipts: d.derived().questions.receipts,
      choices: d.derived().questions.choices,
      rows: d.lists.questions.rows,
      posts: d.posts,
      controlsHeld: d.locked("questions"),
    },
    {
      receipts: [],
      choices: ["reason for question-1: typed after the recovery"],
      rows: ["question-2"],
      posts: ["govern question-1"],
      controlsHeld: false,
    },
  );
});

test("R1-T4: after a refusal and a recovery, a NEW action of each list writes its receipt and spends its own choice as usual", async () => {
  const d = desk();
  const run = {
    observations: (answer: Promise<Post>) => d.curate("obs-1", answer),
    questions: (answer: Promise<Post>) => d.govern("question-1", answer),
    imports: (answer: Promise<Post>) => d.recheck("job-1", answer),
  };
  for (const list of LISTS) {
    await d.refuse(list);
    await d.restore(list);
    d.choose(list, list === "imports" ? "job-1: KEEP_SEPARATE" : list === "questions" ? "reason for question-1: new" : "remember obs-1");
    const answer = deferred<Post>();
    const running = run[list](answer.promise);
    answer.resolve({ ok: true });
    await running;
  }
  assert.deepEqual(
    {
      receipts: LISTS.map((list) => d.derived()[list].receipts),
      choices: LISTS.map((list) => d.derived()[list].choices),
      posts: d.posts,
      controlsHeld: LISTS.map((list) => d.locked(list)),
    },
    {
      receipts: [["curation receipt: obs-1"], ["question receipt: question-1"], ["recheck receipt: job-1"]],
      // A curation decision spends no choice of its own; a learning decision clears its reason; a re-check spends its decision.
      choices: [["remember obs-1"], [], []],
      posts: ["curate obs-1", "govern question-1", "recheck job-1"],
      controlsHeld: [false, false, false],
    },
  );
});

test("R1-T4b: a refusal frees the list's controls — a new decision may begin while the old one still waits, and the old one never takes them back", async () => {
  const d = desk();
  d.truth.observations = rowsOf(["obs-1", "obs-2"]);
  const oldAnswer = deferred<Post>();
  const old = d.curate("obs-1", oldAnswer.promise);
  await d.refuse("observations");
  const freedByRefusal = !d.locked("observations");
  await d.restore("observations");
  const newAnswer = deferred<Post>();
  const fresh = d.curate("obs-2", newAnswer.promise);
  const holder = d.holder("observations");
  oldAnswer.resolve({ ok: true });
  await old;
  const stillHeldByNew = d.locked("observations") && d.holder("observations") === holder;
  const receiptsWhenOldLanded = [...d.derived().observations.receipts];
  newAnswer.resolve({ ok: true });
  await fresh;
  assert.deepEqual(
    {
      freedByRefusal,
      posts: d.posts,
      stillHeldByNew,
      receiptsWhenOldLanded,
      receipts: d.derived().observations.receipts,
      controlsHeld: d.locked("observations"),
    },
    {
      freedByRefusal: true,
      posts: ["curate obs-1", "curate obs-2"],
      stillHeldByNew: true,
      receiptsWhenOldLanded: [],
      receipts: ["curation receipt: obs-2"],
      controlsHeld: false,
    },
  );
});

test("R1-T5: a workspace change while an action waits — its late success writes and reads nothing; a new action in the new workspace works", async () => {
  const d = desk();
  const oldAnswer = deferred<Post>();
  const old = d.recheck("job-1", oldAnswer.promise);
  d.switchWorkspace();
  // The new workspace's own first read, and a choice made there.
  d.truth.imports = [answered(page([job("job-9")]))];
  await d.restore("imports");
  d.choose("imports", "job-9: KEEP_SEPARATE");
  const readsBefore = d.refreshes.length;
  oldAnswer.resolve({ ok: true });
  await old;
  const oldWrote = {
    receipts: [...d.derived().imports.receipts],
    choices: [...d.derived().imports.choices],
    reads: d.refreshes.length - readsBefore,
  };
  const newAnswer = deferred<Post>();
  const fresh = d.recheck("job-9", newAnswer.promise);
  newAnswer.resolve({ ok: true });
  await fresh;
  assert.deepEqual(
    { oldWrote, receipts: d.derived().imports.receipts, choices: d.derived().imports.choices, posts: d.posts },
    {
      oldWrote: { receipts: [], choices: ["job-9: KEEP_SEPARATE"], reads: 0 },
      receipts: ["recheck receipt: job-9"],
      choices: [],
      posts: ["recheck job-1", "recheck job-9"],
    },
  );
});

test("R1-T6: a refusal of one list does not stop an action of another list from finishing", async () => {
  const cases: Array<{ refused: ListKey; acting: ListKey; act: (d: ReturnType<typeof desk>, answer: Promise<Post>) => Promise<void> }> = [
    { refused: "questions", acting: "observations", act: (d, answer) => d.curate("obs-1", answer) },
    { refused: "imports", acting: "questions", act: (d, answer) => d.govern("question-1", answer) },
    { refused: "observations", acting: "imports", act: (d, answer) => d.recheck("job-1", answer) },
  ];
  for (const { refused: refusedList, acting, act } of cases) {
    const d = desk();
    // The server keeps refusing the other list.
    if (refusedList === "imports") d.truth.imports = [refusal];
    else d.truth[refusedList] = refusal;
    const answer = deferred<Post>();
    const running = act(d, answer.promise);
    await d.refuse(refusedList);
    answer.resolve({ ok: true });
    await running;
    const written = d.derived()[acting].receipts;
    assert.equal(written.length, 2, `${acting} writes its receipt although ${refusedList} was refused: ${JSON.stringify(written)}`);
    assert.equal(d.locked(acting), false);
    assertRefused(d, refusedList);
  }
});

test("R1-T7: an action begun before two refusals of its list — each followed by a recovery — stays obsolete", async () => {
  const d = desk();
  const answer = deferred<Post>();
  const running = d.govern("question-1", answer.promise);
  for (let round = 0; round < 2; round += 1) {
    await d.refuse("questions");
    await d.restore("questions");
  }
  answer.resolve({ ok: true });
  await running;
  assert.deepEqual(
    { receipts: d.derived().questions.receipts, phase: d.lists.questions.phase, posts: d.posts },
    { receipts: [], phase: "READY", posts: ["govern question-1"] },
  );
});

test("R1-T8: ordinary successful reads of a list while its action waits do not make the action obsolete", async () => {
  const d = desk();
  const answer = deferred<Post>();
  const running = d.recheck("job-1", answer.promise);
  await d.restore("imports");
  await d.restore("imports");
  answer.resolve({ ok: true });
  await running;
  assert.deepEqual(
    { receipts: d.derived().imports.receipts, choices: d.derived().imports.choices },
    { receipts: ["recheck receipt", "recheck receipt: job-1"], choices: [] },
  );
});

test("R1-T (coordinator): a list's action epoch moves only when that list is refused or comes back — never back, never on an ordinary read", () => {
  const reads = createReadCoordinator();
  const action = reads.captureAction("imports");
  // Reads of the list — begun, superseded, answered — move nothing.
  reads.begin("imports");
  reads.accept(reads.begin("imports"));
  assert.equal(reads.mayApply(action), true);
  // Another list's refusal and recovery move nothing here.
  reads.refuse(reads.begin("questions"));
  reads.accept(reads.begin("questions"));
  assert.equal(reads.mayApply(action), true);
  // Its own list's refusal ends it.
  reads.refuse(reads.begin("imports"));
  const whileRefused = reads.captureAction("imports");
  assert.equal(reads.mayApply(action), false);
  assert.equal(reads.mayApply(whileRefused), false, "nothing is written for a list while it is refused");
  // The recovery gives neither of them the right to write.
  reads.accept(reads.begin("imports"));
  assert.equal(reads.mayApply(action), false, "an action begun before the refusal stays obsolete");
  assert.equal(reads.mayApply(whileRefused), false, "so does one taken while the list was refused");
  const afterRecovery = reads.captureAction("imports");
  assert.ok(afterRecovery.epoch > action.epoch, "the epoch only ever moves forward");
  assert.equal(reads.mayApply(afterRecovery), true);
  // A session change ends every action; one begun in the new session may write.
  reads.resetSession();
  assert.equal(reads.mayApply(afterRecovery), false);
  assert.equal(reads.mayApply(reads.captureAction("imports")), true);
});

test("R1-T (coordinator): an obsolete action asks again only for lists the server is not refusing now, and nothing after a session change", async () => {
  const reads = createReadCoordinator();
  const action = reads.captureAction("observations");
  // While it may still apply, it may ask for any list — even one refused now.
  reads.refuse(reads.begin("questions"));
  assert.equal(reads.mayRead("questions", action), true);
  // Its own list refused: obsolete.
  reads.refuse(reads.begin("observations"));
  assert.equal(reads.mayRead("observations", action), false, "not a list refused now");
  assert.equal(reads.mayRead("questions", action), false);
  assert.equal(reads.mayRead("imports", action), true, "a list the server is not refusing may still show its truth");
  let loads = 0;
  const load = async () => {
    loads += 1;
    return "read";
  };
  assert.equal(await readAgainFor(reads, action, "observations", load), null);
  assert.equal(loads, 0, "a refused list is not asked for on an obsolete action's behalf");
  // The list comes back: it may be read again for its truth — and still nothing may be written.
  reads.accept(reads.begin("observations"));
  assert.equal(await readAgainFor(reads, action, "observations", load), "read");
  assert.equal(loads, 1);
  assert.equal(reads.mayApply(action), false);
  // Another session: nothing at all.
  reads.resetSession();
  for (const list of LISTS) assert.equal(reads.mayRead(list, action), false);
});

// ── IMPORT TRUST SEAMS — regression first ───────────────────────────────────
//
// These tests were written before the repair and run on harnesses that mirrored
// the page as it was: the refresh walked only the recorded pages; a preview, a
// commit and a create had no ticket and always released their buttons; a group
// decision sent every row. On that shape R3-A1, A2, A3, A4, A6, DOC-1..DOC-7
// (except DOC-3b), GROUP-1, GROUP-3 and CREATE-1..CREATE-3 FAILED; R3-A5, DOC-3b,
// GROUP-2, GROUP-4, GROUP-5 and CREATE-4 passed as positive controls. The test
// bodies are unchanged; the harnesses now mirror the repaired page.

// GAP-A — the refresh of the imports after a refusal.

const ids = (scope: ImportScope) => scope.jobs.map((entry) => entry.importJobId);
/** A server that answers each page by its cursor; a page it does not know did not arrive. */
const serverOf =
  (pages: Record<string, ReadResult<ImportJobPage>>) =>
  (cursor: string | null): ReadResult<ImportJobPage> =>
    pages[cursor ?? "root"] ?? failed;

/** The page's refresh walk: the page `nextRefreshCursor` names next, until it names none. */
const refreshWalk = (scope: ImportScope, server: (cursor: string | null) => ReadResult<ImportJobPage>) => {
  const asked: (string | null)[] = [];
  const results: ReadResult<ImportJobPage>[] = [];
  for (let cursor = nextRefreshCursor(scope, results); cursor !== undefined; cursor = nextRefreshCursor(scope, results)) {
    asked.push(cursor);
    results.push(server(cursor));
  }
  return { scope: applyImportRefresh(scope, results), asked };
};

/** Pages 1 and 2 opened, then refused. */
const twoPagesThenRefused = () => {
  let scope = applyInitialImportPage(EMPTY_IMPORT_SCOPE, answered(page([job("a")], "c2")));
  scope = applyOlderImportPage(scope, "c2", answered(page([job("b")])));
  return applyImportRefresh(scope, [refused]);
};
const current = { received: 1, represented: 1, waiting: 0 };

test("R3-A1: after a refusal, a successful read of the first page is READY — not STALE — and records the first page", () => {
  const refusedScope = applyImportRefresh(applyInitialImportPage(EMPTY_IMPORT_SCOPE, answered(page([job("a")]))), [refused]);
  const { scope, asked } = refreshWalk(refusedScope, serverOf({ root: answered(page([job("a")])) }));
  assert.deepEqual(
    { phase: scope.phase, jobs: ids(scope), cursors: scope.cursors, asked },
    { phase: "READY", jobs: ["a"], cursors: [null], asked: [null] },
  );
});

test("R3-A2: two pages opened, a refusal, then the recovery reads both — through the server's own new cursor — and is READY", () => {
  const server = serverOf({
    root: answered(page([job("a", { counts: current })], "c2-new")),
    "c2-new": answered(page([job("b", { counts: current })])),
  });
  const { scope, asked } = refreshWalk(twoPagesThenRefused(), server);
  assert.deepEqual(
    { phase: scope.phase, jobs: ids(scope), counts: scope.jobs.map((entry) => entry.counts), cursors: scope.cursors, asked },
    { phase: "READY", jobs: ["a", "b"], counts: [current, current], cursors: [null, "c2-new"], asked: [null, "c2-new"] },
  );
});

test("R3-A3: after a refusal the first page comes back but the second does not — STALE, with the first page current and recorded", () => {
  const server = serverOf({ root: answered(page([job("a", { counts: current })], "c2-new")) });
  const { scope, asked } = refreshWalk(twoPagesThenRefused(), server);
  assert.deepEqual(
    { phase: scope.phase, jobs: ids(scope), counts: scope.jobs.map((entry) => entry.counts), cursors: scope.cursors, asked },
    { phase: "STALE", jobs: ["a"], counts: [current], cursors: [null], asked: [null, "c2-new"] },
  );
});

test("R3-A4: once the first page is back, every later refresh reads it — also after an older page is opened again", () => {
  const server = serverOf({ root: answered(page([job("a")], "c2")), c2: answered(page([job("b")])) });
  let scope = applyImportRefresh(applyInitialImportPage(EMPTY_IMPORT_SCOPE, answered(page([job("a")], "c2"))), [refused]);
  scope = refreshWalk(scope, server).scope;
  scope = applyOlderImportPage(scope, "c2", server("c2"));
  const again = refreshWalk(scope, server);
  assert.deepEqual(
    { asked: again.asked, cursors: again.scope.cursors, phase: again.scope.phase, jobs: ids(again.scope) },
    { asked: [null, "c2"], cursors: [null, "c2"], phase: "READY", jobs: ["a", "b"] },
  );
});

// CHANGE NOTE (R3 cursor convergence): DEFECT-CORRECTION, not TEST_WEAKENING. This test expected
// STALE because the walk read the RECORDED cursor "after-b", skipped "b" where it now stands, and
// kept it. That walk was the defect (R3-C1, R3-C2). The walk now follows the server's fresh cursor
// "after-a", so "b" is read again where it now is: still nothing lost, and READY. The law the title
// names — no visible import disappears — is unchanged.
test("R3-A5: a new import arriving on the first page after a recovery — the fresh chain reads every visible import again: nothing lost, READY", () => {
  let scope = applyInitialImportPage(EMPTY_IMPORT_SCOPE, answered(page([job("a"), job("b")], "after-b")));
  scope = applyOlderImportPage(scope, "after-b", answered(page([job("c")])));
  scope = applyImportRefresh(scope, [refused]);
  scope = refreshWalk(scope, serverOf({ root: answered(page([job("a"), job("b")], "after-b")), "after-b": answered(page([job("c")])) })).scope;
  const visible = ids(scope);
  // "n" arrives on top: the first page now ends at "a", and "b" moves past the boundary.
  const moved = serverOf({
    root: answered(page([job("n"), job("a")], "after-a")),
    "after-a": answered(page([job("b"), job("c")])),
    "after-b": answered(page([job("c")])),
  });
  const again = refreshWalk(scope, moved).scope;
  assert.deepEqual(
    { lost: visible.filter((id) => !ids(again).includes(id)), phase: again.phase },
    { lost: [], phase: "READY" },
  );
});

test("R3-A6: a retry after a partial recovery reads both pages — nothing twice, the first page kept", () => {
  const partial = refreshWalk(twoPagesThenRefused(), serverOf({ root: answered(page([job("a")], "c2-new")) })).scope;
  const server = serverOf({ root: answered(page([job("a")], "c2-new")), "c2-new": answered(page([job("b")])) });
  const { scope, asked } = refreshWalk(partial, server);
  assert.deepEqual(
    { phase: scope.phase, jobs: ids(scope), cursors: scope.cursors, asked },
    { phase: "READY", jobs: ["a", "b"], cursors: [null, "c2-new"], asked: [null, "c2-new"] },
  );
});

// ── R3 CURSOR CONVERGENCE — every refresh starts at the first page and follows fresh cursors ──
//
// REGRESSION FIRST: written before the repair and run on the walk as it was, which read the
// recorded cursors first. On that walk they fail: after newer imports arrived in front, a
// refresh read the recorded cursor, kept what it skipped and said STALE — and every retry read
// the same recorded cursor and said STALE again.

/** Two pages opened: [a, b] and, by the cursor after b, [c, d]. */
const twoPagesOpened = () =>
  applyOlderImportPage(
    applyInitialImportPage(EMPTY_IMPORT_SCOPE, answered(page([job("a"), job("b")], "after-b"))),
    "after-b",
    answered(page([job("c"), job("d")], "after-d")),
  );
/** Then "n" arrives in front: the first page now ends at "a". The recorded cursor still answers, from the old boundary. */
const shiftedServer = serverOf({
  root: answered(page([job("n"), job("a")], "after-a")),
  "after-a": answered(page([job("b"), job("c")], "after-c")),
  "after-b": answered(page([job("c"), job("d")], "after-d")),
});

test("R3-C1: newer imports arrived in front — the first refresh reads the first page, then the server's FRESH cursor, never the recorded one, and is READY", () => {
  const { scope, asked } = refreshWalk(twoPagesOpened(), shiftedServer);
  assert.deepEqual(
    { asked, phase: scope.phase, jobs: ids(scope), cursors: scope.cursors, door: { nextCursor: scope.nextCursor, hasMore: scope.hasMore } },
    { asked: [null, "after-a"], phase: "READY", jobs: ["n", "a", "b", "c"], cursors: [null, "after-a"], door: { nextCursor: "after-c", hasMore: true } },
  );
});

test("R3-C2: a scope left STALE by the old chain converges — the retry reads the first page and fresh cursors, is READY, and stays READY on the next retry", () => {
  // What a refresh by the recorded cursor left behind: "b" kept, the scope STALE.
  const stale: ImportScope = {
    phase: "STALE",
    jobs: [job("n"), job("a"), job("c"), job("d"), job("b")],
    cursors: [null, "after-b"],
    pagesOpened: 2,
    nextCursor: "after-d",
    hasMore: true,
  };
  const retry = refreshWalk(stale, shiftedServer);
  const again = refreshWalk(retry.scope, shiftedServer);
  assert.deepEqual(
    {
      retry: { asked: retry.asked, phase: retry.scope.phase, jobs: ids(retry.scope) },
      again: { asked: again.asked, phase: again.scope.phase, jobs: ids(again.scope) },
    },
    {
      retry: { asked: [null, "after-a"], phase: "READY", jobs: ["n", "a", "b", "c"] },
      again: { asked: [null, "after-a"], phase: "READY", jobs: ["n", "a", "b", "c"] },
    },
  );
});

test("R3-C3: whatever cursors are recorded, the walk follows the cursor the server has just given — the old one never wins", () => {
  const recorded: ImportScope = {
    phase: "READY",
    jobs: [job("a"), job("b"), job("c")],
    cursors: [null, "recorded-2", "recorded-3"],
    pagesOpened: 3,
    nextCursor: "recorded-4",
    hasMore: true,
  };
  const server = serverOf({
    root: answered(page([job("a")], "fresh-2")),
    "fresh-2": answered(page([job("b")], "fresh-3")),
    "fresh-3": answered(page([job("c")], "fresh-4")),
    "recorded-2": answered(page([job("stale-b")], "recorded-3")),
    "recorded-3": answered(page([job("stale-c")], "recorded-4")),
  });
  const { asked } = refreshWalk(recorded, server);
  assert.deepEqual(
    { first: nextRefreshCursor(recorded, []), afterRoot: nextRefreshCursor(recorded, [server(null)]), asked },
    { first: null, afterRoot: "fresh-2", asked: [null, "fresh-2", "fresh-3"] },
  );
});

test("R3-C4: the fresh second page fails — STALE, the first page current and the rest kept as it was; the retry starts at the first page again and is READY", () => {
  const failing = serverOf({
    root: answered(page([job("n"), job("a")], "after-a")),
    "after-b": answered(page([job("c"), job("d")], "after-d")),
  });
  const partial = refreshWalk(twoPagesOpened(), failing);
  const retry = refreshWalk(partial.scope, shiftedServer);
  assert.deepEqual(
    {
      partial: { asked: partial.asked, phase: partial.scope.phase, jobs: ids(partial.scope) },
      retry: { asked: retry.asked, phase: retry.scope.phase, jobs: ids(retry.scope) },
    },
    {
      partial: { asked: [null, "after-a"], phase: "STALE", jobs: ["n", "a", "b", "c", "d"] },
      retry: { asked: [null, "after-a"], phase: "READY", jobs: ["n", "a", "b", "c"] },
    },
  );
});

test("R3-C5: three pages were opened but the server now ends after two — READY, and no third page is asked for", () => {
  let scope = applyInitialImportPage(EMPTY_IMPORT_SCOPE, answered(page([job("a")], "after-a")));
  scope = applyOlderImportPage(scope, "after-a", answered(page([job("b")], "after-b")));
  scope = applyOlderImportPage(scope, "after-b", answered(page([job("c")])));
  const server = serverOf({
    root: answered(page([job("a")], "after-a")),
    "after-a": answered(page([job("b")])),
    "after-b": answered(page([job("c")])),
  });
  const { scope: refreshed, asked } = refreshWalk(scope, server);
  assert.deepEqual(
    { asked, phase: refreshed.phase, jobs: ids(refreshed), cursors: refreshed.cursors, hasMore: refreshed.hasMore },
    { asked: [null, "after-a"], phase: "READY", jobs: ["a", "b"], cursors: [null, "after-a"], hasMore: false },
  );
});

test("R3-C6: [a,b][c,d] becomes [n,a][b,c] — the fresh chain shows the current truth: b not lost, nothing twice, READY after the full walk", () => {
  const { scope } = refreshWalk(twoPagesOpened(), shiftedServer);
  const jobs = ids(scope);
  assert.deepEqual(
    { jobs, twice: jobs.filter((id, at) => jobs.indexOf(id) !== at), hasB: jobs.includes("b"), phase: scope.phase },
    { jobs: ["n", "a", "b", "c"], twice: [], hasB: true, phase: "READY" },
  );
});

test("R3-C7: cursors are opaque — imports created in the same instant, and the walk hands the server exactly the cursor it gave", () => {
  // As the server writes them (createdAt|id, base64url); the walk never reads what is inside.
  const sameInstant = (id: string) => Buffer.from(`2026-09-16T09:00:00.000Z|${id}`).toString("base64url");
  const opened = applyOlderImportPage(
    applyInitialImportPage(EMPTY_IMPORT_SCOPE, answered(page([job("job-z"), job("job-y")], sameInstant("job-y")))),
    sameInstant("job-y"),
    answered(page([job("job-x")])),
  );
  // Another import arrives in the same instant, in front: the boundary moves by id alone.
  const server = serverOf({
    root: answered(page([job("job-zz"), job("job-z")], sameInstant("job-z"))),
    [sameInstant("job-z")]: answered(page([job("job-y"), job("job-x")])),
    [sameInstant("job-y")]: answered(page([job("job-x")])),
  });
  const { asked, scope } = refreshWalk(opened, server);
  assert.deepEqual(
    { asked, phase: scope.phase, jobs: ids(scope) },
    { asked: [null, sameInstant("job-z")], phase: "READY", jobs: ["job-zz", "job-z", "job-y", "job-x"] },
  );
});

test("R3-C9: after a partial refresh, an older page the reader opens adds one page to the depth — and the next refresh reads that deep", () => {
  const partial = refreshWalk(twoPagesOpened(), serverOf({ root: answered(page([job("n"), job("a")], "after-a")) })).scope;
  const older = applyOlderImportPage(partial, partial.nextCursor as string, answered(page([job("e")])));
  const server = serverOf({
    root: answered(page([job("n"), job("a")], "after-a")),
    "after-a": answered(page([job("b"), job("c")], "after-c")),
    "after-c": answered(page([job("d"), job("e")])),
  });
  const { asked, scope } = refreshWalk(older, server);
  assert.deepEqual(
    { depth: older.pagesOpened, asked, phase: scope.phase },
    { depth: 3, asked: [null, "after-a", "after-c"], phase: "READY" },
  );
});

// ── STALE-CONTINUATION GUARD — a STALE scope's cursor is knowledge, never a door ──
//
// REGRESSION FIRST: these tests were written before the repair and run on a desk that
// mirrored the page as it was — "Tampilkan import lebih lama" offered on `hasMore` alone, and
// `loadOlderImports` reading `nextCursor` whatever the phase. On that shape SG-1, SG-2, SG-4
// and SG-7 FAILED (the remembered cursor of a STALE, LOADING or FAILED scope was read, and the
// way on was offered while STALE); SG-3, SG-5 and SG-6 passed as positive controls. The
// expectations are unchanged; the desk now mirrors the repaired page.

/** The page's `olderImportsCursor`: the way on, and only from a READY scope. */
const olderImportsCursor = (scope: ImportScope): string | null =>
  scope.phase === "READY" && scope.hasMore && scope.nextCursor !== null && scope.nextCursor !== "" ? scope.nextCursor : null;

/**
 * The page's imports list: the refresh walk (the notice's "Coba lagi" reads the same way),
 * the notice, and "Tampilkan import lebih lama" with its handler. The server answers as
 * `serve` last said; every GET is recorded by the road it came from.
 */
const continuationDesk = (start: ImportScope) => {
  let scope = start;
  let server: (cursor: string | null) => ReadResult<ImportJobPage> = serverOf({});
  const walked: (string | null)[] = [];
  const older: string[] = [];
  return {
    scope: () => scope,
    walked,
    older,
    serve: (next: (cursor: string | null) => ReadResult<ImportJobPage>) => {
      server = next;
    },
    /** loadImportJobs('REFRESH'). */
    refresh: () => {
      const results: ReadResult<ImportJobPage>[] = [];
      for (let cursor = nextRefreshCursor(scope, results); cursor !== undefined; cursor = nextRefreshCursor(scope, results)) {
        walked.push(cursor);
        results.push(server(cursor));
      }
      scope = applyImportRefresh(scope, results);
    },
    /** ReadNotice offers "Coba lagi". */
    offersRetry: () => scope.phase === "FAILED" || scope.phase === "STALE",
    /** "Tampilkan import lebih lama" is offered: importMayLoadOlder. */
    offersOlder: () => olderImportsCursor(scope) !== null,
    /** loadOlderImports: the cursor only through the guard, before anything is read. */
    loadOlder: () => {
      const cursor = olderImportsCursor(scope);
      if (cursor === null) return;
      older.push(cursor);
      scope = applyOlderImportPage(scope, cursor, server(cursor));
    },
  };
};

/** The reader opened two pages; a third waits behind the cursor page 2 handed out, "old-3". */
const twoOfThreeOpened = () =>
  applyOlderImportPage(
    applyInitialImportPage(EMPTY_IMPORT_SCOPE, answered(page([job("a"), job("b")], "after-b"))),
    "after-b",
    answered(page([job("c"), job("d")], "old-3")),
  );
/** "n" arrived in front, and the fresh second page does not arrive. The remembered cursor would still answer. */
const partialServer = serverOf({
  root: answered(page([job("n"), job("a")], "after-a")),
  "old-3": answered(page([job("e")])),
});
/** The same server once the second page arrives again: the way on is now "new-3". */
const recoveredServer = serverOf({
  root: answered(page([job("n"), job("a")], "after-a")),
  "after-a": answered(page([job("b"), job("c")], "new-3")),
  "new-3": answered(page([job("d"), job("e")])),
  "old-3": answered(page([job("e")])),
});
/** READY with two of three pages opened, then a refresh whose fresh second page fails: STALE. */
const staleDesk = () => {
  const d = continuationDesk(twoOfThreeOpened());
  d.serve(partialServer);
  d.refresh();
  return d;
};

test("SG-1: STALE after a partial refresh remembers its old cursor — a press on the way on sends nothing, spends nothing, opens nothing deeper", () => {
  const d = staleDesk();
  const stale = d.scope();
  d.loadOlder();
  assert.deepEqual(
    {
      remembered: { phase: stale.phase, jobs: ids(stale), hasMore: stale.hasMore, nextCursor: stale.nextCursor, pagesOpened: stale.pagesOpened },
      pressed: { requests: d.older, scope: d.scope() },
    },
    {
      remembered: { phase: "STALE", jobs: ["n", "a", "b", "c", "d"], hasMore: true, nextCursor: "old-3", pagesOpened: 2 },
      pressed: { requests: [], scope: stale },
    },
  );
});

test("SG-2: while STALE, \"Tampilkan import lebih lama\" is not offered — the notice's \"Coba lagi\" is", () => {
  const d = staleDesk();
  assert.deepEqual({ offersOlder: d.offersOlder(), offersRetry: d.offersRetry() }, { offersOlder: false, offersRetry: true });
});

test("SG-3: the retry starts at the first page, follows the fresh cursor, is READY — and the way on is offered again", () => {
  const d = staleDesk();
  d.serve(recoveredServer);
  const before = d.walked.length;
  d.refresh();
  assert.deepEqual(
    { asked: d.walked.slice(before), phase: d.scope().phase, jobs: ids(d.scope()), way: d.scope().nextCursor, offersOlder: d.offersOlder(), offersRetry: d.offersRetry() },
    { asked: [null, "after-a"], phase: "READY", jobs: ["n", "a", "b", "c"], way: "new-3", offersOlder: true, offersRetry: false },
  );
});

test("SG-4: after the recovery the way on is the FRESH cursor — the remembered one is never asked", () => {
  const d = staleDesk();
  d.loadOlder();
  d.serve(recoveredServer);
  d.refresh();
  d.loadOlder();
  assert.deepEqual(
    { older: d.older, oldEverAsked: [...d.walked, ...d.older].includes("old-3"), phase: d.scope().phase, jobs: ids(d.scope()), hasMore: d.scope().hasMore },
    { older: ["new-3"], oldEverAsked: false, phase: "READY", jobs: ["n", "a", "b", "c", "d", "e"], hasMore: false },
  );
});

test("SG-5: READY with a way on — \"Tampilkan import lebih lama\" reads the next page exactly as before, and a failed press loses nothing", () => {
  const opened = applyInitialImportPage(EMPTY_IMPORT_SCOPE, answered(page([job("a"), job("b")], "after-b")));
  const d = continuationDesk(opened);
  const offered = d.offersOlder();
  // The first press does not arrive: nothing moves, and the way on is still offered.
  d.loadOlder();
  const afterFailure = { unchanged: d.scope() === opened, offered: d.offersOlder() };
  d.serve(serverOf({ "after-b": answered(page([job("c"), job("d")], "after-d")) }));
  d.loadOlder();
  const s = d.scope();
  assert.deepEqual(
    { offered, afterFailure, older: d.older, phase: s.phase, jobs: ids(s), cursors: s.cursors, pagesOpened: s.pagesOpened, way: { nextCursor: s.nextCursor, hasMore: s.hasMore }, offeredAgain: d.offersOlder() },
    {
      offered: true,
      afterFailure: { unchanged: true, offered: true },
      older: ["after-b", "after-b"],
      phase: "READY",
      jobs: ["a", "b", "c", "d"],
      cursors: [null, "after-b"],
      pagesOpened: 2,
      way: { nextCursor: "after-d", hasMore: true },
      offeredAgain: true,
    },
  );
});

test("SG-6: READY at the end — no way on is offered, and a press sends nothing", () => {
  const d = continuationDesk(applyInitialImportPage(EMPTY_IMPORT_SCOPE, answered(page([job("a")]))));
  const offered = d.offersOlder();
  d.loadOlder();
  assert.deepEqual(
    { phase: d.scope().phase, hasMore: d.scope().hasMore, nextCursor: d.scope().nextCursor, offered, older: d.older },
    { phase: "READY", hasMore: false, nextCursor: null, offered: false, older: [] },
  );
});

test("SG-7: IDLE, LOADING, FAILED and UNAUTHORIZED hold no way on — whatever cursor they remember", () => {
  const ready = twoOfThreeOpened();
  const states: Record<string, ImportScope> = {
    IDLE: EMPTY_IMPORT_SCOPE,
    // The page's first read marks the scope it keeps as LOADING.
    LOADING: { ...ready, phase: "LOADING" },
    // A first read that fails keeps what the scope remembered.
    FAILED: applyInitialImportPage(ready, failed),
    UNAUTHORIZED: applyImportRefresh(ready, [refused]),
  };
  const outcome = Object.fromEntries(
    Object.entries(states).map(([name, scope]) => {
      const d = continuationDesk(scope);
      d.serve(recoveredServer);
      const offered = d.offersOlder();
      d.loadOlder();
      return [name, { remembered: scope.nextCursor, offered, older: d.older, phase: d.scope().phase }];
    }),
  );
  assert.deepEqual(outcome, {
    IDLE: { remembered: null, offered: false, older: [], phase: "IDLE" },
    LOADING: { remembered: "old-3", offered: false, older: [], phase: "LOADING" },
    FAILED: { remembered: "old-3", offered: false, older: [], phase: "FAILED" },
    UNAUTHORIZED: { remembered: null, offered: false, older: [], phase: "UNAUTHORIZED" },
  });
});

// GAP-B — preview and commit belong to the workspace and the document they began for.

/** The page's document requests — previewDocument, commitDocument, the file input and the workspace effect. */
const documentDesk = () => {
  const reads = createReadCoordinator();
  const state = {
    file: null as string | null,
    preview: null as string | null,
    commitResult: null as string | null,
    decisions: [] as string[],
    settled: false,
    importError: null as string | null,
    importAction: null as "PREVIEW" | "COMMIT" | null,
  };
  const posts: string[] = [];
  const refreshes: string[] = [];
  // Like the page: the request that owns the buttons holds them with its ticket.
  let lock: DocumentTicket | null = null;

  /** forgetDocument */
  const forgetDocument = () => {
    state.preview = null;
    state.commitResult = null;
    state.settled = false;
    state.decisions = [];
    state.importError = null;
    lock = null;
    state.importAction = null;
  };
  /** previewDocument */
  const preview = async (answer: Promise<Post>) => {
    if (state.file === null || lock !== null) return;
    const file = state.file;
    const ticket = reads.captureDocument();
    lock = ticket;
    state.importAction = "PREVIEW";
    state.importError = null;
    state.commitResult = null;
    state.decisions = [];
    state.settled = false;
    try {
      posts.push("preview " + file);
      const { ok } = await answer;
      if (!ok) {
        if (reads.mayApplyDocument(ticket)) state.importError = "not understood: " + file;
        return;
      }
      if (reads.mayApplyDocument(ticket)) state.preview = "understood " + file;
    } finally {
      if (lock === ticket) {
        lock = null;
        state.importAction = null;
      }
    }
  };
  /** commitDocument */
  const commit = async (answer: Promise<Post>) => {
    if (state.file === null || lock !== null) return;
    const file = state.file;
    const ticket = reads.captureDocument();
    lock = ticket;
    state.importAction = "COMMIT";
    state.importError = null;
    try {
      posts.push("commit " + file);
      const { ok } = await answer;
      if (!ok) {
        if (reads.mayApplyDocument(ticket)) state.importError = "not saved: " + file;
        if (reads.sameSession(ticket)) refreshes.push("imports");
        return;
      }
      if (reads.mayApplyDocument(ticket)) {
        state.commitResult = "saved " + file;
        state.preview = "knowledge of " + file;
        state.decisions = [];
        state.settled = true;
      }
      if (reads.sameSession(ticket)) refreshes.push("observations", "imports");
    } finally {
      if (lock === ticket) {
        lock = null;
        state.importAction = null;
      }
    }
  };
  /** The file input's onChange. */
  const chooseFile = (name: string | null) => {
    reads.changeDocument();
    state.file = name;
    forgetDocument();
  };
  /** The page's effect on a workspace change. */
  const switchWorkspace = () => {
    reads.resetSession();
    forgetDocument();
  };
  return {
    state,
    posts,
    refreshes,
    preview,
    commit,
    chooseFile,
    switchWorkspace,
    decide: (decision: string) => {
      state.decisions.push(decision);
    },
  };
};

test("DOC-1: a preview of file A answering after the reader chose file B is never shown for B", async () => {
  const d = documentDesk();
  d.chooseFile("A");
  const answer = deferred<Post>();
  const running = d.preview(answer.promise);
  d.chooseFile("B");
  answer.resolve({ ok: true });
  await running;
  assert.deepEqual(
    { file: d.state.file, preview: d.state.preview, busy: d.state.importAction, posts: d.posts },
    { file: "B", preview: null, busy: null, posts: ["preview A"] },
  );
});

test("DOC-2: a preview answering after a workspace change is never shown in the new workspace", async () => {
  const d = documentDesk();
  d.chooseFile("A");
  const answer = deferred<Post>();
  const running = d.preview(answer.promise);
  d.switchWorkspace();
  answer.resolve({ ok: true });
  await running;
  assert.deepEqual({ preview: d.state.preview, busy: d.state.importAction }, { preview: null, busy: null });
});

test("DOC-3: after a change of file, a preview of the new file works — also while the old one still waits", async () => {
  const d = documentDesk();
  d.chooseFile("A");
  const oldAnswer = deferred<Post>();
  const old = d.preview(oldAnswer.promise);
  d.chooseFile("B");
  const newAnswer = deferred<Post>();
  const fresh = d.preview(newAnswer.promise);
  newAnswer.resolve({ ok: true });
  await fresh;
  const whileOldWaits = { preview: d.state.preview, busy: d.state.importAction };
  oldAnswer.resolve({ ok: true });
  await old;
  assert.deepEqual(
    { whileOldWaits, preview: d.state.preview, busy: d.state.importAction, posts: d.posts },
    { whileOldWaits: { preview: "understood B", busy: null }, preview: "understood B", busy: null, posts: ["preview A", "preview B"] },
  );
});

test("DOC-3b: a preview of the new file after the old one has finished works as before", async () => {
  const d = documentDesk();
  d.chooseFile("A");
  const first = deferred<Post>();
  const running = d.preview(first.promise);
  first.resolve({ ok: true });
  await running;
  d.chooseFile("B");
  const second = deferred<Post>();
  const again = d.preview(second.promise);
  second.resolve({ ok: true });
  await again;
  assert.deepEqual({ preview: d.state.preview, posts: d.posts }, { preview: "understood B", posts: ["preview A", "preview B"] });
});

test("DOC-4: a commit of file A answering after the reader chose file B writes nothing for B — and the saved import is still read back", async () => {
  const d = documentDesk();
  d.chooseFile("A");
  const understood = deferred<Post>();
  const previewing = d.preview(understood.promise);
  understood.resolve({ ok: true });
  await previewing;
  d.decide("A: USE_EXISTING");
  const answer = deferred<Post>();
  const running = d.commit(answer.promise);
  d.chooseFile("B");
  d.decide("B: KEEP_SEPARATE");
  answer.resolve({ ok: true });
  await running;
  assert.deepEqual(
    {
      commitResult: d.state.commitResult,
      preview: d.state.preview,
      settled: d.state.settled,
      decisions: d.state.decisions,
      busy: d.state.importAction,
      refreshes: d.refreshes,
    },
    { commitResult: null, preview: null, settled: false, decisions: ["B: KEEP_SEPARATE"], busy: null, refreshes: ["observations", "imports"] },
  );
});

test("DOC-5: a commit answering after a workspace change writes nothing there, and reads nothing there", async () => {
  const d = documentDesk();
  d.chooseFile("A");
  const understood = deferred<Post>();
  const previewing = d.preview(understood.promise);
  understood.resolve({ ok: true });
  await previewing;
  d.decide("A: USE_EXISTING");
  const answer = deferred<Post>();
  const running = d.commit(answer.promise);
  d.switchWorkspace();
  answer.resolve({ ok: true });
  await running;
  assert.deepEqual(
    {
      commitResult: d.state.commitResult,
      preview: d.state.preview,
      settled: d.state.settled,
      decisions: d.state.decisions,
      busy: d.state.importAction,
      refreshes: d.refreshes,
    },
    { commitResult: null, preview: null, settled: false, decisions: [], busy: null, refreshes: [] },
  );
});

test("DOC-6: in the new workspace a preview and a commit work normally — also while the old commit still waits", async () => {
  const d = documentDesk();
  d.chooseFile("A");
  const oldAnswer = deferred<Post>();
  const old = d.commit(oldAnswer.promise);
  d.switchWorkspace();
  const understood = deferred<Post>();
  const previewing = d.preview(understood.promise);
  understood.resolve({ ok: true });
  await previewing;
  const saved = deferred<Post>();
  const committing = d.commit(saved.promise);
  saved.resolve({ ok: true });
  await committing;
  oldAnswer.resolve({ ok: true });
  await old;
  assert.deepEqual(
    { commitResult: d.state.commitResult, settled: d.state.settled, busy: d.state.importAction, posts: d.posts },
    { commitResult: "saved A", settled: true, busy: null, posts: ["commit A", "preview A", "commit A"] },
  );
});

test("DOC-7: a failure of the old document's request is not told for the new document", async () => {
  const d = documentDesk();
  d.chooseFile("A");
  const answer = deferred<Post>();
  const running = d.preview(answer.promise);
  d.chooseFile("B");
  answer.resolve({ ok: false });
  await running;
  assert.deepEqual({ importError: d.state.importError, busy: d.state.importAction }, { importError: null, busy: null });
});

// GAP-C — one decision for a group of identical rows stops sending once it may no longer write.

test("GROUP-1: a refusal while row 1 of a group decision waits — row 1 stays saved, rows 2 and 3 are never sent", async () => {
  const d = desk();
  const rows = [deferred<Post>(), deferred<Post>(), deferred<Post>()];
  const running = d.curateRows(["obs-1", "obs-2", "obs-3"], rows.map((row) => row.promise));
  await d.refuse("observations");
  for (const row of rows) row.resolve({ ok: true });
  await running;
  assert.deepEqual(
    { posts: d.posts, receipts: d.derived().observations.receipts, controlsHeld: d.locked("observations") },
    { posts: ["curate obs-1"], receipts: [], controlsHeld: false },
  );
});

test("GROUP-2: an ordinary successful read of the list while row 1 waits — every row is sent", async () => {
  const d = desk();
  const rows = [deferred<Post>(), deferred<Post>(), deferred<Post>()];
  const running = d.curateRows(["obs-1", "obs-2", "obs-3"], rows.map((row) => row.promise));
  await d.restore("observations");
  for (const row of rows) row.resolve({ ok: true });
  await running;
  assert.deepEqual(
    { posts: d.posts, receipts: d.derived().observations.receipts },
    { posts: ["curate obs-1", "curate obs-2", "curate obs-3"], receipts: ["curation receipt", "curation receipt: obs-1, obs-2, obs-3"] },
  );
});

test("GROUP-3: a workspace change while row 1 waits — the rows not yet sent are never sent", async () => {
  const d = desk();
  const rows = [deferred<Post>(), deferred<Post>(), deferred<Post>()];
  const running = d.curateRows(["obs-1", "obs-2", "obs-3"], rows.map((row) => row.promise));
  d.switchWorkspace();
  for (const row of rows) row.resolve({ ok: true });
  await running;
  assert.deepEqual({ posts: d.posts, receipts: d.derived().observations.receipts }, { posts: ["curate obs-1"], receipts: [] });
});

test("GROUP-4: a new group decision after a refusal and a recovery sends every row and writes its receipt", async () => {
  const d = desk();
  await d.refuse("observations");
  await d.restore("observations");
  const rows = [deferred<Post>(), deferred<Post>()];
  const running = d.curateRows(["obs-1", "obs-2"], rows.map((row) => row.promise));
  for (const row of rows) row.resolve({ ok: true });
  await running;
  assert.deepEqual(
    { posts: d.posts, receipts: d.derived().observations.receipts },
    { posts: ["curate obs-1", "curate obs-2"], receipts: ["curation receipt: obs-1, obs-2"] },
  );
});

test("GROUP-5: when the server itself refuses row 2, row 3 is not sent and the partial outcome is told", async () => {
  const d = desk();
  const rows = [deferred<Post>(), deferred<Post>(), deferred<Post>()];
  const running = d.curateRows(["obs-1", "obs-2", "obs-3"], rows.map((row) => row.promise));
  rows[0].resolve({ ok: true });
  rows[1].resolve({ ok: false });
  rows[2].resolve({ ok: true });
  await running;
  assert.deepEqual(
    { posts: d.posts, receipts: d.derived().observations.receipts },
    { posts: ["curate obs-1", "curate obs-2"], receipts: ["curation receipt", "curation partial: 1/3"] },
  );
});

// GAP-D — the manual create belongs to the workspace it began in.

type Created = { readonly ok: boolean; readonly id?: string };

/** The page's createWorkspaceAhsp and the workspace effect. */
const createDesk = () => {
  const reads = createReadCoordinator();
  const state = { creating: false, createError: null as string | null };
  const navigations: string[] = [];
  const posts: string[] = [];
  // Like the page: the create that owns the button holds it with its ticket.
  let lock: SessionTicket | null = null;
  /** createWorkspaceAhsp */
  const create = async (name: string, answer: Promise<Created>) => {
    if (lock !== null) return;
    const ticket = reads.captureSession();
    lock = ticket;
    state.creating = true;
    state.createError = null;
    try {
      posts.push("create " + name);
      const response = await answer;
      if (!response.ok) {
        if (reads.sameSession(ticket)) state.createError = "not created: " + name;
        return;
      }
      if (!reads.sameSession(ticket)) return;
      if (!response.id) {
        state.createError = "no identity for: " + name;
        return;
      }
      navigations.push("/ahsp/" + response.id);
    } finally {
      if (lock === ticket) {
        lock = null;
        state.creating = false;
      }
    }
  };
  /** The page's effect on a workspace change (forgetCreate). */
  const switchWorkspace = () => {
    reads.resetSession();
    state.createError = null;
    lock = null;
    state.creating = false;
  };
  return { state, navigations, posts, create, switchWorkspace };
};

test("CREATE-1: a create answering after a workspace change never moves the reader", async () => {
  const c = createDesk();
  const answer = deferred<Created>();
  const running = c.create("A", answer.promise);
  c.switchWorkspace();
  answer.resolve({ ok: true, id: "ahsp-a" });
  await running;
  assert.deepEqual({ navigations: c.navigations, busy: c.state.creating }, { navigations: [], busy: false });
});

test("CREATE-2: a create failing after a workspace change says nothing in the new workspace", async () => {
  const c = createDesk();
  const answer = deferred<Created>();
  const running = c.create("A", answer.promise);
  c.switchWorkspace();
  answer.resolve({ ok: false });
  await running;
  assert.deepEqual({ createError: c.state.createError, busy: c.state.creating }, { createError: null, busy: false });
});

test("CREATE-3: a create in the new workspace moves the reader normally — also while the old one still waits", async () => {
  const c = createDesk();
  const oldAnswer = deferred<Created>();
  const old = c.create("A", oldAnswer.promise);
  c.switchWorkspace();
  const newAnswer = deferred<Created>();
  const fresh = c.create("B", newAnswer.promise);
  newAnswer.resolve({ ok: true, id: "ahsp-b" });
  await fresh;
  oldAnswer.resolve({ ok: true, id: "ahsp-a" });
  await old;
  assert.deepEqual({ navigations: c.navigations, posts: c.posts, busy: c.state.creating }, { navigations: ["/ahsp/ahsp-b"], posts: ["create A", "create B"], busy: false });
});

test("CREATE-4: an ordinary create, with no change of workspace, moves the reader as before", async () => {
  const c = createDesk();
  const answer = deferred<Created>();
  const running = c.create("A", answer.promise);
  answer.resolve({ ok: true, id: "ahsp-a" });
  await running;
  assert.deepEqual({ navigations: c.navigations, createError: c.state.createError, busy: c.state.creating }, { navigations: ["/ahsp/ahsp-a"], createError: null, busy: false });
});

test("TRUST SEAMS (coordinator): a document ticket ends with another document or session; a session ticket only with the session; neither touches the lists", () => {
  const reads = createReadCoordinator();
  const preview = reads.captureDocument();
  const create = reads.captureSession();
  const action = reads.captureAction("imports");
  // Reads and refusals of a list end neither a document request nor a create.
  reads.refuse(reads.begin("imports"));
  reads.accept(reads.begin("imports"));
  assert.equal(reads.mayApplyDocument(preview), true);
  assert.equal(reads.sameSession(create), true);
  // Another document ends the document request only — and moves nothing about the lists.
  const fresh = reads.captureAction("questions");
  reads.changeDocument();
  assert.equal(reads.mayApplyDocument(preview), false);
  assert.equal(reads.sameSession(preview), true, "its lists may still be read back in the same session");
  assert.equal(reads.mayApplyDocument(reads.captureDocument()), true);
  assert.equal(reads.sameSession(create), true);
  assert.equal(reads.mayApply(fresh), true);
  assert.equal(reads.mayApply(action), false, "the list refusal above, not the document, ended this one");
  // A session change ends every ticket.
  const later = reads.captureDocument();
  reads.resetSession();
  assert.equal(reads.mayApplyDocument(later), false);
  assert.equal(reads.sameSession(create), false);
  assert.equal(reads.sameSession(reads.captureSession()), true);
});

// ── R2 — a failed refresh keeps the rows and SAYS they are not current ──────

test("R2: a failed refresh of a populated list keeps its rows and reports STALE", () => {
  const held: ListRead<string> = { phase: "READY", rows: ["question-1", "question-2"] };
  const after: ListRead<string> = applyListRead<string>(held, failed, "REFRESH");
  assert.equal(after.phase, "STALE");
  assert.deepEqual(after.rows, held.rows, "what was last read stays readable");
});

test("R2: a failed FIRST read claims nothing about the list", () => {
  const after = applyListRead(emptyListRead<string>(), failed, "INITIAL");
  assert.equal(after.phase, "FAILED");
  assert.deepEqual(after.rows, []);
});

test("R2: a recovered read replaces the stale rows with the answer", () => {
  const stale = applyListRead<string>({ phase: "READY", rows: ["old"] }, failed, "REFRESH");
  const recovered = applyListRead(stale, { ok: true, data: ["new"] }, "REFRESH");
  assert.equal(recovered.phase, "READY");
  assert.deepEqual(recovered.rows, ["new"]);
});

// ── R3 — every page the reader opened is re-read and reconciled ─────────────

test("R3: a refresh replaces the server's view of a job already on screen, without duplicating it", () => {
  const opened = applyOlderImportPage(
    applyInitialImportPage(EMPTY_IMPORT_SCOPE, answered(page([job("new-1")], "cursor-2"))),
    "cursor-2",
    answered(page([job("old-21", { counts: { received: 10, represented: 1, waiting: 9 } })])),
  );
  assert.deepEqual(opened.jobs.map((entry) => entry.importJobId), ["new-1", "old-21"]);
  assert.deepEqual(importScopePages(opened), [null, "cursor-2"]);

  const refreshed = applyImportRefresh(opened, [
    answered(page([job("new-1")], "cursor-2")),
    answered(page([job("old-21", { counts: { received: 10, represented: 2, waiting: 8 } })])),
  ]);
  assert.equal(refreshed.phase, "READY");
  assert.deepEqual(refreshed.jobs.map((entry) => entry.importJobId), ["new-1", "old-21"]);
  assert.deepEqual(refreshed.jobs[1].counts, { received: 10, represented: 2, waiting: 8 });
});

test("R3: a page that fails leaves its jobs as they were, keeps the cursor, and says STALE", () => {
  const opened = applyOlderImportPage(
    applyInitialImportPage(EMPTY_IMPORT_SCOPE, answered(page([job("new-1")], "cursor-2"))),
    "cursor-2",
    answered(page([job("old-21")], "cursor-3")),
  );
  const refreshed = applyImportRefresh(opened, [answered(page([job("new-1")], "cursor-2")), failed]);
  assert.equal(refreshed.phase, "STALE", "a partly-read scope is never called current");
  assert.deepEqual(refreshed.jobs.map((entry) => entry.importJobId), ["new-1", "old-21"]);
  assert.equal(refreshed.nextCursor, "cursor-3", "a failed read moves nothing");
  assert.equal(refreshed.hasMore, true);
});

// CHANGE NOTE (R3 cursor convergence): DEFECT-CORRECTION, not TEST_WEAKENING. This test pinned
// that after a COMPLETE read of the opened pages, an import pushed past them by newer ones is
// kept on screen and the scope says STALE. That is what kept every retry from converging: each
// retry read the same opened pages, kept the same import and said STALE again — for good. The
// scope is what the server answers now, as deep as the reader had opened: READY, with the way on
// pointing at the pushed-out import, which the older page brings back from where it now is.
// Stale knowledge is still kept, and STALE still said, when a read does NOT complete
// ("a page that fails leaves its jobs as they were" above, and R3-C4).
test("R3: an import pushed past the opened pages by newer ones leaves the scope READY, with the way on to it", () => {
  const opened = applyInitialImportPage(
    EMPTY_IMPORT_SCOPE,
    answered(page([job("a"), job("b")], "cursor-2")),
  );
  // A new import arrived in front: the one page the reader opened now ends at "a".
  const refreshed = applyImportRefresh(opened, [answered(page([job("new"), job("a")], "cursor-2b"))]);
  assert.deepEqual(refreshed.jobs.map((entry) => entry.importJobId), ["new", "a"]);
  assert.equal(refreshed.phase, "READY", "the page the reader opened was read again, completely");
  assert.equal(refreshed.nextCursor, "cursor-2b");
  assert.equal(refreshed.hasMore, true, "the way on to b stays open");
  const older = applyOlderImportPage(refreshed, "cursor-2b", answered(page([job("b")])));
  assert.deepEqual(older.jobs.map((entry) => entry.importJobId), ["new", "a", "b"], "b is read back from where it now is");
});

test("R3: a job named twice across pages is listed once, in server order", () => {
  const opened = applyInitialImportPage(EMPTY_IMPORT_SCOPE, answered(page([job("a")], "cursor-2")));
  const refreshed = applyImportRefresh(opened, [
    answered(page([job("a"), job("b")], "cursor-2")),
    answered(page([job("b"), job("c")])),
  ]);
  assert.deepEqual(refreshed.jobs.map((entry) => entry.importJobId), ["a", "b", "c"]);
});

test("R3: loading an older page again adds nothing twice and replaces what it restates", () => {
  const first = applyInitialImportPage(EMPTY_IMPORT_SCOPE, answered(page([job("a")], "cursor-2")));
  const older = applyOlderImportPage(first, "cursor-2", answered(page([job("b")])));
  const again = applyOlderImportPage(older, "cursor-2", answered(page([job("b", { sourceFileName: "renamed.xlsx" })])));
  assert.deepEqual(again.jobs.map((entry) => entry.importJobId), ["a", "b"]);
  assert.equal(again.jobs[1].sourceFileName, "renamed.xlsx");
});

test("R3: a failed older page keeps the scope and its cursor exactly as they were", () => {
  const first = applyInitialImportPage(EMPTY_IMPORT_SCOPE, answered(page([job("a")], "cursor-2")));
  const after = applyOlderImportPage(first, "cursor-2", failed);
  assert.deepEqual(after, first, "nothing is lost and nothing advances when the answer did not arrive");
});

test("R3: merging by id is what keeps one card per import", () => {
  const merged = mergeImportJobs(
    [job("a"), job("b")],
    [job("b", { sourceFileName: "b-new.xlsx" }), job("c")],
  );
  assert.deepEqual(merged.map((entry) => entry.importJobId), ["a", "b", "c"]);
  assert.equal(merged[1].sourceFileName, "b-new.xlsx");
});

// ── R4 — a broken contract is a failed read, not an empty queue ─────────────

test("R4: a malformed page is refused, field by field", () => {
  const broken: unknown[] = [
    { items: [], hasMore: "rusak", nextCursor: 123 },
    { items: [], hasMore: true, nextCursor: null },
    { items: [], hasMore: false, nextCursor: "cursor-2" },
    { items: [], hasMore: true, nextCursor: "" },
    { items: [], nextCursor: null },
    { hasMore: false, nextCursor: null },
    { items: {}, hasMore: false, nextCursor: null },
    { items: [null], hasMore: false, nextCursor: null },
    { items: [{ sourceFileName: "no-identity.xlsx" }], hasMore: false, nextCursor: null },
    { items: [{ importJobId: "" }], hasMore: false, nextCursor: null },
    [],
    null,
    "not json at all",
  ];
  for (const value of broken) {
    assert.equal(asImportPage(value), null, "refused: " + JSON.stringify(value));
  }
});

test("R4: a lawful page is read exactly as the server stated it", () => {
  const empty = asImportPage({ items: [], hasMore: false, nextCursor: null });
  assert.deepEqual(empty, { rows: [], nextCursor: null, hasMore: false });

  const more = asImportPage({ items: [], hasMore: true, nextCursor: "cursor-2" });
  assert.deepEqual(more, { rows: [], nextCursor: "cursor-2", hasMore: true });

  const withData = asImportPage({
    items: [{ importJobId: "a", sourceFileName: "a.xlsx", unknownFutureField: 1 }],
    hasMore: false,
    nextCursor: null,
  });
  assert.equal(withData?.rows.length, 1);
  assert.equal(withData?.rows[0].importJobId, "a");
  assert.equal(
    (withData?.rows[0] as unknown as { unknownFutureField: number }).unknownFutureField,
    1,
    "an unknown field is not the frontend's business to refuse",
  );
});

test("R4: a malformed answer becomes a failed read — FAILED first, STALE over data", () => {
  const first = applyInitialImportPage(EMPTY_IMPORT_SCOPE, failed);
  assert.equal(first.phase, "FAILED");
  assert.deepEqual(first.jobs, []);
  assert.equal(first.hasMore, false);

  const opened = applyInitialImportPage(EMPTY_IMPORT_SCOPE, answered(page([job("a")], "cursor-2")));
  const broken = applyImportRefresh(opened, [failed]);
  assert.equal(broken.phase, "STALE");
  assert.deepEqual(broken.jobs.map((entry) => entry.importJobId), ["a"]);
  assert.equal(broken.nextCursor, "cursor-2", "a broken answer never rewrites where the scope ends");
  assert.equal(broken.hasMore, true, "and never hides that more waits");
});

test("R4: rows of the other lists are read as an array or not at all", () => {
  assert.deepEqual(asRows<string>(["a"]), ["a"]);
  assert.deepEqual(asRows<string>([]), []);
  assert.equal(asRows<string>({ items: [] }), null);
  assert.equal(asRows<string>(null), null);
});
