import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * IMPORT AHSP IS ITS OWN DOOR (gap F). Upload -> Pahami dokumen -> Simpan hasil
 * import -> Import selesai lives at /ahsp/import, on the EXISTING canonical
 * pipeline (no second importer). The list page no longer carries the import
 * surface. Manual create — the relocated "AHSP Milik Saya" capability — lives
 * here too, on the same POST /ahsp, never a second create engine.
 */

const NEWLINE = String.fromCharCode(10);
const CARRIAGE_RETURN = String.fromCharCode(13);
const codeOnly = (source: string) =>
  source
    .split(CARRIAGE_RETURN)
    .join("")
    .split(NEWLINE)
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*") && !t.startsWith("{/*");
    })
    .join(NEWLINE);

const app = codeOnly(readFileSync("src/App.tsx", "utf8"));
const importPage = codeOnly(readFileSync("src/pages/AhspImportPage.tsx", "utf8"));
const room = codeOnly(readFileSync("src/pages/AhspRoomPage.tsx", "utf8"));
const readState = codeOnly(readFileSync("src/utils/ahspImportReadState.ts", "utf8"));

// LEGACY_TEST_CHANGE_REGISTER: OLD_EXPECTATION was permission="AHSP_VIEW" only.
// IQL-01 SECOND HOLDER (Owner ruling): the EXISTING pending-learning queue on
// this door must be reachable by the second holder, who may JUDGE a candidate
// but is deliberately NOT given AHSP_VIEW — no wider authority than IQL-01
// needs. NEW_EXPECTATION: AHSP_VIEW, or exactly the one judging code, nothing
// else; every other section keeps its own gate (asserted in the next test).
// TEST_WEAKENING=NO.
test("App routes /ahsp/import behind the AHSP permission — or exactly the IQL-01 judging authority — as its own door", () => {
  assert.match(
    app,
    /path="ahsp\/import" element=\{<PermissionRoute permission=\{\['AHSP_VIEW', 'AHSP_RESOURCE_IDENTITY_QUESTION_APPROVE'\]\}><AhspImportPage \/><\/PermissionRoute>\}/,
  );
});

test("the second holder reaches ONLY the learning card: import, curation and create keep their own gates", () => {
  assert.ok(importPage.includes("hasPermission('AHSP_RESOURCE_IDENTITY_QUESTION_APPROVE')"));
  // CHANGE NOTE (F03/R2): the learning surface is ONE section now — a populated
  // list whose refresh failed must be able to say so, which two competing
  // sections could not. The permission gate is unchanged and still first.
  // TEST_WEAKENING=NO.
  assert.ok(importPage.includes("{canSeeQuestions &&"));
  assert.ok(importPage.includes("shownQuestions.length > 0 ||"));
  assert.equal(importPage.split('aria-label="Pembelajaran pertanyaan identik"').length - 1, 1);
  // CHANGE NOTE (F03): the curation card is no longer shown by row count alone —
  // a queue that could not be READ is not an empty queue. The permission gate is
  // unchanged and still first. TEST_WEAKENING=NO.
  assert.ok(importPage.includes("{canCurate &&"));
  assert.ok(importPage.includes("observationsPhase === 'FAILED'"));
  assert.ok(importPage.includes("{canManage ? ("));
  // No door that lands on a refusal: the list links exist only for AHSP readers.
  assert.ok(importPage.includes('canViewAhsp ? <Link to="/ahsp"'));
  assert.ok(importPage.includes("canViewAhsp ? ("));
});

test("the room's Import action navigates to the door — it no longer toggles an inline panel", () => {
  assert.ok(room.includes("Import AHSP"));
  assert.ok(room.includes("navigate('/ahsp/import')"));
  assert.ok(!room.includes("setShowImport"));
});

// LEGACY_TEST_CHANGE_REGISTER: OLD_EXPECTATION pinned the page's own count
// sentence ("pekerjaan dikenali", "masih perlu dilengkapi") and readiness read
// from `item.status === 'READY'`. IMPORT ACCEPTANCE BOUNDARY (B3/B7): READY was
// the only thing a save could keep, so "siap digunakan" doubled as "diterima".
// An item whose only gap is a component's identity is now saved too, so the
// page reads the server's ADMISSION (PROVEN / IDENTITY_PENDING / HELD) and the
// counts are worded — and unit-tested — in the one intake display module.
// NEW_EXPECTATION: same endpoints, same "no reason code" law, readiness from
// the server's admission, copy from the shared module. TEST_WEAKENING=NO.
test("the import door uses the EXISTING canonical pipeline endpoints, no second importer", () => {
  assert.ok(importPage.includes("/ahsp/document/preview"));
  assert.ok(importPage.includes("/ahsp/document/commit"));
  assert.ok(importPage.includes("previewIntakeLine(preview.workItems)"));
  assert.ok(importPage.includes("' · siap digunakan'"));
  assert.ok(importPage.includes("const admission = admissionOf(item);"));
  assert.ok(importPage.includes("admission === 'HELD'"));
  // Readiness is never re-derived from the old status token in the page.
  assert.ok(!importPage.includes("item.status === 'READY'"));
  // Human words, never reason codes.
  assert.ok(!importPage.includes("MISSING_OUTPUT_UNIT"));
  assert.ok(!importPage.includes("RESOURCE_UNRESOLVED"));
  assert.ok(!importPage.includes("RESOURCE_IDENTITY_NOT_EXHAUSTED"));
  assert.ok(!importPage.includes("IDENTITY_PENDING'"));
});

test("B7: saving COMPLETES the import — received, ready and still-being-completed are three truths from the server's count", () => {
  // The result of a saved document is the server's own summary, never the preview list.
  assert.ok(importPage.includes("describeImportIntake(commitResult.summary)"));
  assert.ok(importPage.includes("intake.figures.map"));
  assert.ok(importPage.includes("intake.details.map"));
  // The save is not "save what is proven": everything recognised is received.
  assert.ok(!importPage.includes("Simpan yang terbukti"));
  assert.ok(importPage.includes("'Simpan hasil import'"));
  // The old READY-only receipt is gone.
  assert.ok(!importPage.includes("commitResult.written.length"));
  assert.ok(!importPage.includes("pekerjaan belum disimpan"));
  const display = readFileSync("src/utils/ahspImportIntakeDisplay.ts", "utf8");
  assert.ok(display.includes("'Diterima'"));
  assert.ok(display.includes("'Siap digunakan'"));
  assert.ok(display.includes("'Masih dilengkapi'"));
});

// CHANGE NOTE (closeout TASK 3): this B5 test pinned an EMPTY JSON body,
// `JSON.stringify({})`. A possible twin kept from an earlier import is now
// decidable after a reload, and the reader's decision rides the SAME continuation,
// as a preview decision rides its commit. NEW_EXPECTATION: still one JSON body per
// import, carrying only `decisions` — never a file, never FormData. TEST_WEAKENING=NO.
// CHANGE NOTE (AHSP COMPLETION): the imports are still described by the one display
// module, now told whether the reader may decide identities, so an identity need
// points to where it is decided. NEW_EXPECTATION: `describeWaitingImports(importJobs,
// { canCurate })`. TEST_WEAKENING=NO.
// CHANGE NOTE (F02a/F03): the same GET, now read through `readList` so a refusal,
// a network failure and an unreadable answer are one honest "not read", and paged
// so an import older than this page stays reachable. Still ONE request family.
// NEW_EXPECTATION: readList('/ahsp/document/jobs', asImportPage). TEST_WEAKENING=NO.
test("B5: an earlier import is checked again ONCE per document from what SIMPROK kept — never re-uploaded", () => {
  // CHANGE NOTE (F03/R3): the one GET is written once, in jobsPath, because a
  // refresh now asks it for every page the reader opened. Still ONE request
  // family and no second route. TEST_WEAKENING=NO.
  assert.ok(importPage.includes("const jobsPath = (cursor: string | null): string =>"));
  assert.ok(importPage.includes("readList(jobsPath(null), asImportPage)"));
  assert.ok(importPage.includes("readList(jobsPath(cursor), asImportPage)"));
  assert.ok(importPage.includes("'/ahsp/document/jobs/' + job.key + '/continue'"));
  // The continuation carries no file: only a JSON body.
  const recheck = importPage.slice(importPage.indexOf("const recheckImport"), importPage.indexOf("const shownQuestions"));
  assert.ok(recheck.includes("JSON.stringify({ decisions })"));
  assert.ok(!recheck.includes("FormData"));
  assert.ok(!recheck.includes("body.append('file'"));
  // One button per import, not one per AHSP; a second press is refused while one runs.
  assert.ok(importPage.includes("jobLock.current"));
  assert.ok(importPage.includes("'Periksa ulang'"));
  assert.ok(importPage.includes("describeWaitingImports(importJobs, { canCurate })"));
  // The same outcome contract as every other action on this door.
  assert.ok(importPage.includes("placeOutcomes(waitingImports"));
  // It lives on this door, behind the import authority — no new route.
  assert.ok(importPage.includes("{canManage &&"));
  assert.ok(importPage.includes("waitingImports.length > 0 ||"));
  assert.ok(!app.includes("ahsp/import/jobs"));
});

// F02a — WHAT IS STORED STAYS REACHABLE. One page at a time, and the door to the
// older imports is offered from the page itself, never from a second route.
test("F02a: imports older than this page are reachable from this door, by cursor, without the file", () => {
  assert.ok(importPage.includes("const loadOlderImports = (): Promise<void> =>"));
  assert.ok(importPage.includes("'?cursor=' + encodeURIComponent(cursor)"));
  assert.ok(importPage.includes("Tampilkan import lebih lama"));
  // A failed press loses nothing: the scope — cursor included — is only moved by
  // an answer, which is the module's law and is exercised there.
  const older = importPage.slice(
    importPage.indexOf("const loadOlderImports"),
    importPage.indexOf("const loadQuestions"),
  );
  assert.ok(older.includes("setOlderImports(outcome.answer.ok ? 'IDLE' : 'FAILED');"));
  assert.ok(older.includes("applyOlderImportPage(scopeRef.current, cursor, answer)"));
  assert.ok(readState.includes("export const applyOlderImportPage ="));
  assert.ok(readState.includes("const idOf = (job: ImportJobWire): string => job.importJobId ?? '';"));
  // The door stays offered even when this page holds nothing to complete.
  // CHANGE NOTE (stale-continuation guard): DEFECT-CORRECTION, not TEST_WEAKENING. The line pinned
  // here offered the door on `hasMore` alone — also while the list was STALE, when the cursor behind
  // it is remembered knowledge, not the server's latest word, and a press read from it. The door is
  // now offered on the READY scope's way on alone (the SG test below); it still does not wait for
  // this page to hold anything to complete.
  assert.ok(importPage.includes("{importMayLoadOlder ? ("));
  assert.ok(!importPage.includes("{importHasMore ? ("));
  assert.ok(!app.includes("ahsp/import/jobs"));
});

// F03/R3 — a refresh covers every page the reader has opened, and reads run one
// at a time so two of them cannot overwrite each other.
test("R3: a refresh re-reads the opened scope and reconciles it by import id", () => {
  // CHANGE NOTE (import trust seams): DEFECT-CORRECTION, not TEST_WEAKENING. Two lines here
  // pinned `for (const cursor of importScopePages(scopeRef.current))` and `if (!result.ok) break;`
  // — a walk of the RECORDED pages only. After a refusal it read the first page but never
  // recorded it: the list stayed STALE and later refreshes skipped the first page. The walk now
  // asks `nextRefreshCursor`, which reads the recorded pages first page first and, after a
  // refusal, as far again as the reader had read; a page that did not arrive still stops it.
  assert.ok(importPage.includes("let cursor = nextRefreshCursor(scopeRef.current, results);"));
  assert.ok(importPage.includes("cursor = nextRefreshCursor(scopeRef.current, results)"));
  assert.ok(!importPage.includes("importScopePages(scopeRef.current)"));
  assert.ok(importPage.includes("applyImportRefresh(scopeRef.current, results)"));
  // CHANGE NOTE (R3 cursor convergence): DEFECT-CORRECTION, not TEST_WEAKENING. The line pinned
  // here was the walk that read the RECORDED cursors first; after newer imports arrived in front
  // it read the old boundary on every refresh and retry, and never converged. The walk now always
  // starts at the first page and follows only the cursor the server has just handed out.
  const walk = readState.slice(readState.indexOf("export const nextRefreshCursor"), readState.indexOf("export const applyImportRefresh"));
  assert.ok(walk.includes("if (last === undefined) return null;"), "every walk starts at the first page");
  assert.ok(walk.includes("return last.data.nextCursor;"), "and follows the cursor the server just gave");
  assert.ok(!walk.includes("importScopePages") && !walk.includes(".cursors"), "a recorded cursor never chooses a page");
  // A page that did not arrive stops the walk; the rest stays as it was.
  assert.ok(walk.includes("if (!last.ok) return undefined;"));
  // One import read at a time: a refresh and a load-more cannot interleave.
  assert.ok(importPage.includes("const queueImportRead = (task: () => Promise<void>): Promise<void> =>"));
  assert.equal(importPage.split("queueImportRead(async () => {").length - 1, 2);
  // The reconciliation itself lives in the module, where it is exercised.
  assert.ok(readState.includes("export const applyImportRefresh ="));
  assert.ok(readState.includes("export const mergeImportJobs ="));
});

// R3 CURSOR CONVERGENCE — a refresh and its retry only ever READ: the walk sends each page
// through readList, a plain GET, and the retry on the notice reads the list again.
test("R3-C8: a refresh and its retry only read — GETs through readList, never a method, never a resend", () => {
  const walk = importPage.slice(
    importPage.indexOf("let cursor = nextRefreshCursor(scopeRef.current, results);"),
    importPage.indexOf("return results;"),
  );
  assert.ok(walk.includes("results.push(await readList(jobsPath(cursor), asImportPage));"));
  assert.ok(!walk.includes("method:") && !walk.includes("apiFetch("));
  const readList = importPage.slice(importPage.indexOf("const readList = async"), importPage.indexOf("const jobsPath ="));
  assert.ok(readList.includes("await apiFetch(path);") && !readList.includes("method:"), "a list read is a plain GET");
  assert.ok(importPage.includes("onRetry={() => void loadImportJobs(importJobs.length === 0 ? 'INITIAL' : 'REFRESH')}"));
});

// STALE-CONTINUATION GUARD — a STALE scope keeps its cursor as knowledge, never as a door. The
// way on to older imports is offered, and read, only from a READY scope; while STALE the
// notice's retry is the way back. The behaviour is exercised on the desk in ahspImportReadState.test.ts.
test("SG: the page's way on to older imports opens only from a READY scope — the button and the handler ask one guard, before anything is read", () => {
  const guard = importPage.slice(importPage.indexOf("const olderImportsCursor ="), importPage.indexOf("const FAILED_READ_LINE ="));
  assert.ok(
    guard.includes("scope.phase === 'READY' && scope.hasMore && scope.nextCursor !== null && scope.nextCursor !== '' ? scope.nextCursor : null;"),
    "a cursor is a way on only while the scope is READY, has more, and holds a cursor",
  );
  // The handler takes its cursor from the guard, when its turn comes, before it marks anything or reads.
  const older = importPage.slice(importPage.indexOf("const loadOlderImports"), importPage.indexOf("const loadQuestions"));
  const taken = older.indexOf("const cursor = olderImportsCursor(scopeRef.current);");
  const refused = older.indexOf("if (!canManage || cursor === null) return;");
  assert.ok(taken > older.indexOf("queueImportRead(async () => {") && refused > taken);
  assert.ok(refused < older.indexOf("setOlderImports('LOADING');"));
  assert.ok(refused < older.indexOf("read: () => readList(jobsPath(cursor), asImportPage),"));
  assert.ok(refused < older.indexOf("applyOlderImportPage(scopeRef.current, cursor, answer)"));
  // No other road to a remembered cursor.
  assert.ok(!importPage.includes("scopeRef.current.nextCursor") && !importPage.includes("importScope.nextCursor"));
  // The button asks the same guard; the notice's retry is untouched.
  assert.ok(importPage.includes("const importMayLoadOlder = olderImportsCursor(importScope) !== null;"));
  const door = importPage.slice(importPage.indexOf("{importMayLoadOlder ? ("), importPage.indexOf("{olderImports === 'FAILED' ? ("));
  assert.ok(door.includes("onClick={() => void loadOlderImports()}") && door.includes("'Tampilkan import lebih lama'"));
  assert.ok(importPage.includes("if (phase !== 'FAILED' && phase !== 'STALE') return null;"));
});

// F03/R1 — a refusal takes the refused data, and everything derived from it,
// off the screen.
// CHANGE NOTE (R1 final race closeout): the F03 shape pinned ONE global read
// token that every refusal moved, so another list's refusal already in flight was
// dropped before it cleared its own rows. The law is kept and tightened: each list
// is read through runListRead with its OWN generation, only a workspace/session
// change ends every read, and the global token is forbidden. TEST_WEAKENING=NO.
test("R1: a refused list is emptied on screen, with its choices, receipts and details", () => {
  assert.ok(readState.includes("if (result.unauthorized) return { phase: 'UNAUTHORIZED', rows: [] };"));
  assert.ok(readState.includes("const REFUSED_SCOPE: ImportScope = { ...EMPTY_IMPORT_SCOPE, phase: 'UNAUTHORIZED' };"));
  for (const forget of ["const forgetCuration = ()", "const forgetImports = ()", "const forgetQuestions = ()"]) {
    assert.ok(importPage.includes(forget));
  }
  // Each list's refusal forgets that list — and only that list.
  assert.equal(importPage.split("forget: forgetCuration,").length - 1, 1);
  assert.equal(importPage.split("forget: forgetQuestions,").length - 1, 1);
  assert.equal(importPage.split("forget: forgetImports,").length - 1, 3);
  // One coordinator: a session epoch for every list, a generation per list.
  assert.ok(importPage.includes("const [reads] = useState(createReadCoordinator);"));
  assert.ok(importPage.includes("reads.resetSession();"));
  assert.ok(readState.includes("if (ticket.session !== session) return 'SESSION';"));
  assert.ok(readState.includes("if (ticket.generation !== generation[ticket.list]) return 'SUPERSEDED';"));
  // The global token that let one refusal cancel another is gone for good.
  assert.ok(!importPage.includes("readTokenChanged"));
  assert.ok(!importPage.includes("nextGeneration"));
  assert.ok(!readState.includes("readTokenChanged"));
  // CHANGE NOTE (R1 mutation-epoch closeout): DEFECT-CORRECTION, not TEST_WEAKENING.
  // Three lines here pinned `mayShow(list, session)`: a receipt was written when the
  // session was unchanged and the list not refused AT THAT MOMENT — so an action begun
  // before a refusal wrote again once the list recovered. The per-list action ticket
  // that replaces it is pinned in the next test, and the old guard is forbidden.
  assert.ok(!importPage.includes("reads.mayShow("));
  assert.ok(!importPage.includes("reads.session()"));
  assert.ok(!readState.includes("mayShow"));
  // And no action may still be taken from what was refused.
  assert.ok(importPage.includes("observationsPhase === 'UNAUTHORIZED'"));
  assert.ok(importPage.includes("importPhase === 'UNAUTHORIZED'"));
  assert.ok(importPage.includes("questionsPhase === 'UNAUTHORIZED'"));
});

/** Every call of `setter` in `source` sits behind `reads.mayApply(ticket)` with no await between the check and the call. */
const everyWriteGuarded = (source: string, setter: string): boolean => {
  let at = source.indexOf(setter + "(");
  if (at === -1) return false;
  while (at !== -1) {
    const guard = source.lastIndexOf("reads.mayApply(ticket)", at);
    if (guard === -1 || source.lastIndexOf("await ", at) > guard) return false;
    at = source.indexOf(setter + "(", at + 1);
  }
  return true;
};

// R1 MUTATION EPOCH — an action begun before a refusal of its list never writes
// again, not even after the list comes back. Each list action takes its ticket
// before it sends anything; everything it writes after an await is behind
// mayApply; the lists it reads again are asked through readAgainFor; a refusal
// frees the list's controls, and only the action still holding them lets them go.
test("R1 mutation epoch: every list action takes its ticket first and writes nothing after an await unless it may still apply", () => {
  // The coordinator: one refusal epoch per list, moved on by a refusal and by the
  // recovery after it — never back, never reset.
  assert.ok(readState.includes("export interface ActionTicket {"));
  assert.ok(readState.includes("epoch[ticket.list] += 1;"));
  assert.ok(readState.includes("action.session === session && action.epoch === epoch[action.list] && !refused[action.list]"));
  assert.ok(readState.includes("mayRead: (list, action) => action.session === session && (mayApply(action) || !refused[list]),"));
  assert.ok(readState.includes("export const readAgainFor = <T>("));
  assert.ok(!readState.includes("epoch[ticket.list] -= "));
  assert.ok(!readState.includes("epoch[ticket.list] = "));
  assert.ok(!readState.includes("epoch[list] = "));

  const handlers = [
    { name: "curateGroup", list: "observations", from: "const curateGroup = async", to: "const wireById", lock: "curationLock", writes: ["setCurationOutcomes"] },
    { name: "governQuestion", list: "questions", from: "const governQuestion = async", to: "const recheckImport = async", lock: "questionLock", writes: ["setQuestionOutcomes", "setQuestionReasons"] },
    { name: "recheckImport", list: "imports", from: "const recheckImport = async", to: "const shownQuestions", lock: "jobLock", writes: ["setJobDecisions", "setJobOutcomes"] },
  ];
  for (const handler of handlers) {
    const source = importPage.slice(importPage.indexOf(handler.from), importPage.indexOf(handler.to));
    // The ticket is taken before anything is sent, and it is what holds the controls.
    const captured = source.indexOf(`const ticket = reads.captureAction('${handler.list}');`);
    assert.ok(captured !== -1 && captured < source.indexOf("apiFetch("), handler.name + " takes its ticket before the request");
    assert.ok(source.includes(`${handler.lock}.current = ticket;`), handler.name + " holds the controls with its ticket");
    // Every write it makes is behind mayApply, with no await in between.
    for (const write of handler.writes) {
      assert.ok(everyWriteGuarded(source, write), `${handler.name}: every ${write} is guarded, with no await in between`);
    }
    // Lists are read again only through readAgainFor — never unconditionally for an obsolete action.
    assert.ok(!/(await|\[|,)\s*load(Observations|Questions|ImportJobs)\(/.test(source), handler.name + " reads lists again only through readAgainFor");
    assert.ok(source.includes("readAgainFor(reads, ticket, "), handler.name + " asks the server again for its truth");
    // Only the action that still holds the controls lets them go.
    assert.ok(source.includes(`if (${handler.lock}.current === ticket) {`), handler.name + " releases only its own hold");
  }
  assert.equal(importPage.split("readAgainFor(reads, ticket, ").length - 1, 8);
  // A refusal of a list frees that list's controls.
  for (const [forget, lock, busy] of [
    ["forgetCuration", "curationLock", "setCurationBusy"],
    ["forgetImports", "jobLock", "setJobBusy"],
    ["forgetQuestions", "questionLock", "setQuestionBusy"],
  ]) {
    const start = importPage.indexOf(`const ${forget} = () => {`);
    const body = importPage.slice(start, importPage.indexOf("};", start));
    assert.ok(body.includes(`${lock}.current = null;`) && body.includes(`${busy}(null);`), forget + " frees the list's controls");
  }
});

/** Every call of `setter` after the first await in `source` sits behind `guard`, with no await between the guard and the call. */
const writesAfterAwaitGuarded = (source: string, setter: string, guard: string): boolean => {
  const firstAwait = source.indexOf("await ");
  let at = source.indexOf(setter + "(", firstAwait);
  while (at !== -1) {
    const lastGuard = source.lastIndexOf(guard, at);
    if (lastGuard === -1 || lastGuard < firstAwait || source.lastIndexOf("await ", at) > lastGuard) return false;
    at = source.indexOf(setter + "(", at + 1);
  }
  return true;
};

// IMPORT TRUST SEAMS — a preview and a commit answer to the workspace and the document they
// began for; the rows of one group decision stop once it may no longer write; the manual
// create answers to the workspace it began in. Each takes its ticket before it sends anything,
// and only the request that still holds the buttons lets them go.
test("TRUST SEAMS: document requests carry a document ticket, a group decision stops sending rows, the manual create carries a session ticket", () => {
  assert.ok(readState.includes("export interface DocumentTicket {"));
  assert.ok(readState.includes("export interface SessionTicket {"));
  assert.ok(readState.includes("mayApplyDocument: (ticket) => ticket.session === session && ticket.document === documentEpoch,"));

  // Another document ends what was begun for the one before, and clears what it said.
  const fileInput = importPage.slice(importPage.indexOf('type="file"'), importPage.indexOf("Pahami dokumen"));
  assert.ok(fileInput.includes("reads.changeDocument();") && fileInput.includes("forgetDocument();"));
  // So does a workspace change — for the document and for the create.
  const effect = importPage.slice(importPage.indexOf("reads.resetSession();"), importPage.indexOf("}, [activeWorkspaceId"));
  assert.ok(effect.includes("forgetDocument();") && effect.includes("forgetCreate();"));
  const forgetDocument = importPage.slice(importPage.indexOf("const forgetDocument = () => {"), importPage.indexOf("const forgetCreate = () => {"));
  for (const cleared of ["setPreview(null);", "setCommitResult(null);", "setSettled(false);", "setDecisions({});", "setImportError(null);", "documentLock.current = null;", "setImportAction(null);"]) {
    assert.ok(forgetDocument.includes(cleared), "forgetDocument: " + cleared);
  }

  const requests = [
    { name: "previewDocument", from: "const previewDocument = async", to: "const commitDocument = async", writes: ["setPreview", "setImportError"] },
    { name: "commitDocument", from: "const commitDocument = async", to: "const curateGroup = async", writes: ["setCommitResult", "setPreview", "setDecisions", "setSettled", "setImportError"] },
  ];
  for (const request of requests) {
    const source = importPage.slice(importPage.indexOf(request.from), importPage.indexOf(request.to));
    const captured = source.indexOf("const ticket = reads.captureDocument();");
    assert.ok(captured !== -1 && captured < source.indexOf("apiFetch("), request.name + " takes its ticket before the request");
    assert.ok(source.includes("documentLock.current = ticket;"));
    for (const write of request.writes) {
      assert.ok(writesAfterAwaitGuarded(source, write, "reads.mayApplyDocument(ticket)"), `${request.name}: every ${write} after the request is guarded`);
    }
    assert.ok(source.includes("if (documentLock.current === ticket) {"), request.name + " releases only its own hold");
  }
  const commit = importPage.slice(importPage.indexOf("const commitDocument = async"), importPage.indexOf("const curateGroup = async"));
  // What was saved is read back only in the workspace it was saved in.
  assert.ok(commit.includes("if (reads.sameSession(ticket)) await loadImportJobs();"));
  assert.ok(commit.includes("if (reads.sameSession(ticket)) await Promise.all([loadObservations(), loadImportJobs()]);"));

  // Each row of a group decision is sent only while the decision may still write.
  const group = importPage.slice(importPage.indexOf("const curateGroup = async"), importPage.indexOf("const wireById"));
  const loop = group.slice(group.indexOf("for (const id of request.ids) {"));
  assert.ok(loop.indexOf("if (!reads.mayApply(ticket)) break;") !== -1 && loop.indexOf("if (!reads.mayApply(ticket)) break;") < loop.indexOf("apiFetch("));

  // The manual create answers to the workspace it began in.
  const create = importPage.slice(importPage.indexOf("const createWorkspaceAhsp = async"), importPage.indexOf("const intake = commitResult?.summary"));
  assert.ok(create.length > 0 && create.includes("navigate('/ahsp/' + created.id);"), "the create is sliced on its own");
  const sessionCaptured = create.indexOf("const ticket = reads.captureSession();");
  assert.ok(sessionCaptured !== -1 && sessionCaptured < create.indexOf("apiFetch("));
  assert.ok(create.includes("createLock.current = ticket;"));
  assert.ok(writesAfterAwaitGuarded(create, "setCreateError", "reads.sameSession(ticket)"));
  assert.ok(writesAfterAwaitGuarded(create, "navigate", "reads.sameSession(ticket)"));
  assert.ok(create.includes("if (createLock.current === ticket) {"));
  const forgetCreate = importPage.slice(importPage.indexOf("const forgetCreate = () => {"), importPage.indexOf("};", importPage.indexOf("const forgetCreate = () => {")));
  assert.ok(forgetCreate.includes("createLock.current = null;") && forgetCreate.includes("setCreating(false);") && forgetCreate.includes("setCreateError(null);"));
});

// F03/R4 — the page contract is proved before it is believed.
test("R4: a malformed page of imports is a failed read, never an empty queue", () => {
  assert.ok(readState.includes("export const asImportPage = (value: unknown): ImportJobPage | null =>"));
  assert.ok(readState.includes("if (typeof hasMore !== 'boolean') return null;"));
  assert.ok(readState.includes("if (hasMore && !isNonEmptyString(nextCursor)) return null;"));
  assert.ok(readState.includes("if (!hasMore && nextCursor !== null) return null;"));
  assert.ok(readState.includes("if (!isNonEmptyString(item.importJobId)) return null;"));
  // Nothing is coerced into a shape the page can render.
  assert.ok(!readState.includes("hasMore: page?.hasMore === true"));
  assert.ok(!importPage.includes("hasMore: page?.hasMore === true"));
});

// F03 — A READ THAT DID NOT ARRIVE IS NEVER AN EMPTY LIST, and the retry only reads.
test("F03: a list that could not be read says so, offers one retry, and never resends a decision", () => {
  assert.ok(importPage.includes("const FAILED_READ_LINE ="));
  assert.ok(importPage.includes("const STALE_READ_LINE ="));
  assert.ok(importPage.includes("function ReadNotice({ phase, onRetry, label }"));
  // One notice, used by each of the three lists this page reads.
  assert.equal(importPage.split("<ReadNotice").length - 1, 3);
  // Retry reads the list again — it never carries a decision or a method.
  const notice = importPage.slice(importPage.indexOf("function ReadNotice("), importPage.indexOf("export function AhspImportPage"));
  assert.ok(!notice.includes("method:"));
  assert.ok(!notice.includes("curate"));
  assert.ok(notice.includes("Coba lagi"));
  // A refresh that fails keeps what was read before, and says it is not current —
  // the rule itself now lives in the module, where it is exercised directly.
  assert.ok(readState.includes("return { phase: mode === 'INITIAL' ? 'FAILED' : 'STALE', rows: previous.rows };"));
  assert.equal(importPage.split("applyListRead(previous, answer, mode)").length - 1, 2);
  // A late answer — from another workspace, or superseded within its own list — is
  // dropped by the one orchestration every read goes through.
  assert.equal(importPage.split("runListRead(reads, {").length - 1, 5);
  assert.ok(readState.includes("export const runListRead = async <R>("));
  assert.ok(readState.includes("export const createReadCoordinator = (): ReadCoordinator =>"));
});

test("TASK 3: a possible twin kept from an earlier import is decided on THIS door, with the preview's own renderer, on the existing continuation", () => {
  // One renderer for both doors: the preview and the waiting line cannot drift apart.
  assert.ok(importPage.includes("const renderPossibleTwin = ("));
  assert.equal(importPage.split("renderPossibleTwin(").length - 1, 2);
  assert.equal(importPage.split("decisionButton('KEEP_SEPARATE', 'Simpan sebagai AHSP berbeda')").length - 1, 1);
  assert.ok(importPage.includes("item.sameness"));
  assert.ok(importPage.includes("jobDecisions[jobDecisionKey(job, item)]"));
  // Only an item that still asks carries a decision; the server re-derives the verdict.
  const recheck = importPage.slice(importPage.indexOf("const recheckImport"), importPage.indexOf("const shownQuestions"));
  assert.ok(recheck.includes("item.decisionFor && action"));
  // Spent by the re-check that carried it, exactly as a commit spends a preview decision.
  assert.ok(recheck.includes("setJobDecisions((prev) =>"));
  // No second queue, no new route, no second request family.
  assert.ok(!app.includes("ahsp/import/jobs"));
  assert.equal(importPage.split("/continue'").length - 1, 1);
});

test("B6: a new resource is admitted ONCE for its question — never once per row", () => {
  // Confirming an existing resource is still recorded on every row that asked...
  assert.ok(importPage.includes("ids: group.ids,"));
  // ...but "genuinely new" is one admission; the refreshed list tells what became of the rest.
  assert.ok(importPage.includes("ids: group.ids.slice(0, 1),"));
  assert.ok(importPage.includes("otherOccurrences:"));
  assert.ok(importPage.includes("for (const id of request.ids)"));
});

test("the relocated manual-create lives here on the same POST /ahsp, and left the list", () => {
  assert.ok(importPage.includes("apiFetch('/ahsp', {"));
  assert.ok(importPage.includes("method: 'POST'"));
  assert.ok(importPage.includes("Buat AHSP milik saya"));
  assert.ok(importPage.includes("Simpan AHSP milik saya"));
  // The list no longer creates.
  assert.ok(!room.includes("createWorkspaceAhsp"));
  assert.ok(!room.includes("Simpan AHSP milik saya"));
});

test("the reader can return to the canonical list", () => {
  assert.ok(importPage.includes('to="/ahsp"'));
  assert.ok(importPage.includes("Kembali ke Daftar AHSP"));
});

test("the import door surfaces AHSP duplicate intelligence as a HUMAN DECISION, not a silent skip", () => {
  // Sameness copy comes from the shared display module (no raw verdict token rendered).
  assert.ok(importPage.includes("describeSameness"));
  // The Owner-approved decision verbs are present in the review.
  assert.ok(importPage.includes("Gunakan yang sudah ada"));
  assert.ok(importPage.includes("Simpan sebagai AHSP berbeda"));
  assert.ok(importPage.includes("Lewati"));
  // The decision reaches the backend on the SAME commit upload — never frontend-only.
  assert.ok(importPage.includes("body.append('decisions'"));
  assert.ok(importPage.includes("USE_EXISTING"));
  assert.ok(importPage.includes("KEEP_SEPARATE"));
  // The door still opens the existing AHSP as the reference, reusing the detail route.
  assert.ok(importPage.includes("Buka AHSP yang ada"));
});

test("AUTOMATION: many identical AHSPs cost ONE line and ONE optional action, not N decision blocks", () => {
  // Exact identities are deterministic, so they are aggregated above the list.
  assert.ok(importPage.includes("identicalAggregateLine"));
  // A real toggle, so a mis-click is undoable without discarding other decisions.
  assert.ok(importPage.includes("toggleAllExisting"));
  assert.ok(importPage.includes("allIdenticalAdopted"));
  // Adoptability is read from the ONE display module, never re-derived in the page.
  assert.ok(importPage.includes("describeSameness(item)?.canUseExisting === true"));
  // Deleted twins are counted and spoken separately from the offered action.
  assert.ok(importPage.includes("identicalDeletedAggregateLine"));
  // POSSIBLY is NEVER aggregated — each keeps its own candidates and its own decision.
  assert.ok(importPage.includes("identityVerdict === 'IDENTICAL'"));
  // An IDENTICAL row renders no per-item decision buttons; only the door to what exists.
  assert.ok(importPage.includes("sameness.verdict === 'IDENTICAL'"));
  assert.ok(importPage.includes("Buka AHSP yang ada"));
});

test("an already-known AHSP is never announced as 'siap digunakan' — it will not be written", () => {
  // It is READY, but commit skips it as a duplicate. Saying 'siap digunakan' would
  // promise a save that never happens.
  assert.ok(importPage.includes("' · sudah ada di SIMPROK'"));
  assert.ok(importPage.includes("item.identityVerdict === 'IDENTICAL'"));
});

test("a commit SPENDS its decisions — the controls close so one intent cannot be recorded twice", () => {
  assert.ok(importPage.includes("setSettled(true)"));
  assert.ok(importPage.includes("setSettled(false)"));
  assert.ok(importPage.includes("settled ? null :"));
});

// LEGACY_TEST_CHANGE_REGISTER: OLD_EXPECTATION was
// `const decidable = item.status === 'READY' && !settled;`. IMPORT-SEAM-01: commit
// now admits an item whose only gap is a component's identity, and reads a
// sameness decision for it exactly as for a READY one; only a HELD item is held
// before any decision is read. The law — no decision button where commit could
// not act on it — is unchanged; the predicate follows commit's own admission.
// TEST_WEAKENING=NO.
test("an item that cannot be admitted is still TOLD it already exists, but is offered no decision", () => {
  // Sameness and readiness are different questions: an exact twin whose components
  // are still uncurated must still show its reference (the ordinary first import of
  // an official document), so the identity is never hidden...
  assert.ok(importPage.includes("const sameness = describeSameness(item);"));
  // ...while the decision is withheld unless the item could actually be admitted,
  // because commit() holds a HELD item before it reads any decision.
  assert.ok(importPage.includes("const decidable = admission !== 'HELD' && !settled;"));
  assert.ok(importPage.includes("decidable ? ("));
});

test("AHSP COMPLETION: a need is said once per question, from the display module — the item list waits behind 'Lihat rincian'", () => {
  // One renderer for what a document being read and a saved import still need.
  assert.ok(importPage.includes("const renderAttention = ("));
  assert.equal(importPage.split("renderAttention(").length - 1, 2);
  assert.ok(importPage.includes("describePreviewAttention(preview.workItems, { canCurate })"));
  // The page formats no need of its own: no unit spelling, no count sentence.
  assert.ok(!importPage.includes("belum dikenali SIMPROK"));
  assert.ok(!importPage.includes("pertanyaan unik"));
  // Detail on demand, and said as a toggle to assistive technology.
  assert.ok(importPage.includes("aria-expanded={previewDetailOpen}"));
  assert.ok(importPage.includes("aria-expanded={open}"));
  assert.ok(importPage.includes("previewDetailOpen ? ("));
  // CHANGE NOTE (closeout P3-A, correction 2): the emphasis was named `recheckMovesNow`
  // and read as a promise that the check moves something. It names what the server
  // reported worth checking again, and "Lewati" — which the check carries as nothing —
  // no longer urges it. NEW_EXPECTATION: emphasis from `recheckWarranted` or a chosen
  // decision other than SKIP; the check is still offered in both states. TEST_WEAKENING=NO.
  // A re-check is offered only where something still waits, emphasized (blue) only where
  // something is worth checking again; either way it is one action per import.
  assert.ok(importPage.includes("job.canRecheck && urged ? ("));
  assert.ok(importPage.includes("job.canRecheck && !urged ? ("));
  assert.ok(importPage.includes("job.recheckWarranted ||"));
  assert.ok(importPage.includes("chosen !== undefined && chosen !== 'SKIP'"));
  assert.ok(!importPage.includes("recheckMovesNow"));
  assert.equal(importPage.split("void recheckImport(").length - 1, 1);
  // A long identity queue opens with its first questions and says how many follow.
  assert.ok(importPage.includes("curationEntries.slice(0, CURATION_SHOWN)"));
  // F02b — and a saved import's detail reaches EVERY waiting line on demand.
  assert.ok(importPage.includes("waitingDetail.slice(0, job.waitingShown)"));
  assert.ok(importPage.includes("aria-expanded={allWaitingOpen}"));
  assert.ok(importPage.includes("'Tampilkan ' + (waitingDetail.length - job.waitingShown) + ' pekerjaan lainnya'"));
  // Still no second route and no second request family.
  assert.ok(!app.includes("ahsp/import/jobs"));
  // ONE request family, written once: the path and its one optional cursor.
  assert.equal(importPage.split("'/ahsp/document/jobs'").length - 1, 1);
  assert.equal(importPage.split("'?cursor=' + encodeURIComponent(cursor)").length - 1, 1);
});

// F04 — CALM PAGE, CLEAR ACTIONS. What decides stays in front; what only explains
// waits behind one door per question, and the manual form stops owning the page.
test("F04: a curation question shows its name, evidence and actions — the reasons open on demand", () => {
  const group = importPage.slice(
    importPage.indexOf("const renderCurationGroup = ("),
    importPage.indexOf("const renderReceipt = ("),
  );
  assert.ok(group.includes("{reasonOpen ? 'Sembunyikan alasan' : 'Lihat alasan'}"));
  // The standing explanation and the ruled-out evidence are said once, on demand.
  assert.ok(group.indexOf("view.understanding") > group.indexOf("reasonOpen ? ("));
  assert.ok(group.indexOf("view.guidance") > group.indexOf("reasonOpen ? ("));
  assert.ok(group.indexOf("learning.unavailableLine") > group.indexOf("reasonOpen ? ("));
  // What a decision needs stays in front of the reader.
  assert.ok(group.indexOf("view.candidateLine") < group.indexOf("reasonOpen ? ("));
  assert.ok(group.includes("view.candidateChoices.map"));
  assert.ok(group.includes("Tetapkan sebagai sumber daya baru"));
  // The manual door is kept, collapsed, and is no longer the page's loudest action.
  assert.ok(importPage.includes("Buat AHSP secara manual"));
  assert.ok(importPage.includes("aria-expanded={manualOpen}"));
  assert.ok(importPage.includes("{manualOpen ? ("));
  assert.ok(!importPage.includes('className="ahsp-action ahsp-action--primary" disabled={creating}'));
});

test("a duplicate decision never rides a stale document to commit (reset + flagged-only)", () => {
  // Stale decisions are dropped on a new file AND on a fresh understanding.
  assert.ok(importPage.includes("setDecisions({})"));
  // Only an item the classifier STILL flags carries a decision to the backend —
  // a decision left on a now-DISTINCT item is never silently transmitted.
  assert.ok(importPage.includes("item.identityVerdict === 'IDENTICAL'"));
  assert.ok(importPage.includes("item.identityVerdict === 'POSSIBLY_IDENTICAL'"));
});
