import { strict as assert } from "node:assert";
import test from "node:test";

import {
  draftStatesFact,
  metadataGateView,
  oneActionAcceptanceView,
  smartSaveOutcomeMessage,
  smartSaveFailureMessage,
  alreadyStoredNotice,
  effectiveDateCopy,
  reverificationIsOffered,
  formatMachineFirstSummary,
  REVERIFICATION_NOT_NEEDED_NOTE,
  UNKNOWN_REQUIRED_FACT_MESSAGE,
  type RequiredMetadataFact,
  type BatchReviewGate,
} from "./basicPriceImportDisplay.ts";
import {
  REVERIFICATION_DUE_BADGE,
  REVERIFICATION_HELP_TEXT,
  REVERIFICATION_HELP_TRIGGER,
  REVERIFICATION_LABEL,
  reverificationLine,
} from "./basicPriceExplorerDisplay.ts";

/**
 * SMART-UX CLOSURE — the three doors, asserted as pure functions.
 *
 * Every rule here is one a person meets with their hands: whether Save is
 * pressable, whether the review room opens, what one press of Simpan & Gunakan
 * would actually do, and what a date on a price means. None of them needs a
 * browser to be true, so none of them is tested through one.
 */

const OPEN_GATE: BatchReviewGate = {
  requiredFacts: ["EFFECTIVE_DATE", "REGION", "SOURCE_ORIGIN", "SOURCE_TYPE"],
  missingRequiredFacts: [],
  metadataComplete: true,
  metadataCoherent: true,
  reviewAllowed: true,
  reasonCode: null,
};

const SHUT_GATE: BatchReviewGate = {
  requiredFacts: ["EFFECTIVE_DATE", "REGION", "SOURCE_ORIGIN", "SOURCE_TYPE"],
  missingRequiredFacts: ["REGION"],
  metadataComplete: false,
  metadataCoherent: true,
  reviewAllowed: false,
  reasonCode: "REQUIRED_METADATA_INCOMPLETE",
};

const FULL_DRAFT = {
  effectiveDate: "2024-01-01",
  regionId: "region-1",
  sourceOrigin: "FIELD_REPORT",
  sourceType: "MARKET_SURVEY",
};

const batchWith = (gate: BatchReviewGate) => ({ actions: { reviewGate: gate } });

test("STATE A — an incomplete draft cannot save and cannot enter review", () => {
  const view = metadataGateView(
    batchWith(SHUT_GATE),
    { ...FULL_DRAFT, regionId: undefined },
    true,
    false,
  );
  assert.equal(view.saveEnabled, false);
  assert.equal(view.reviewEnabled, false);
  // It names the missing fact in words, never as a code.
  assert.deepEqual(view.missingInDraft, ["Wilayah harga"]);
  assert.match(view.message, /Wilayah harga/u);
  assert.doesNotMatch(view.message, /REGION/u);
});

test("STATE B — complete but unsaved: Save is offered, Review is NOT", () => {
  // The server still says no, because nothing has been persisted yet.
  const view = metadataGateView(batchWith(SHUT_GATE), FULL_DRAFT, true, false);
  assert.equal(view.saveEnabled, true);
  assert.equal(view.reviewEnabled, false);
  assert.match(view.message, /belum tersimpan/u);
});

test("STATE C — saved and unchanged: the review room opens", () => {
  const view = metadataGateView(batchWith(OPEN_GATE), FULL_DRAFT, false, false);
  assert.equal(view.reviewEnabled, true);
  // Nothing left to save, so Save is not offered either.
  assert.equal(view.saveEnabled, false);
});

test("STATE D — editing after a successful save RE-LOCKS the review door", () => {
  // This is the defect the whole gate exists for: the server's verdict is still
  // "allowed", because it describes the STORED batch — but the form no longer
  // matches it, so walking into the room would carry unsaved work.
  const view = metadataGateView(batchWith(OPEN_GATE), FULL_DRAFT, true, false);
  assert.equal(view.reviewEnabled, false);
  assert.equal(view.saveEnabled, true);
});

test("local completeness is NEVER accepted as proof of persistence", () => {
  // A form that looks perfect while the server says the batch is incomplete
  // must not open the door on the form's own say-so.
  const view = metadataGateView(batchWith(SHUT_GATE), FULL_DRAFT, false, false);
  assert.equal(view.reviewEnabled, false);
});

test("a missing server verdict fails CLOSED", () => {
  const view = metadataGateView(null, FULL_DRAFT, false, false);
  assert.equal(view.saveEnabled, false);
  assert.equal(view.reviewEnabled, false);
});

test("an unstated publisher never blocks anything — optional stays optional", () => {
  // The draft states the four required facts and no publisher at all.
  const view = metadataGateView(batchWith(OPEN_GATE), FULL_DRAFT, false, false);
  assert.deepEqual(view.missingInDraft, []);
  assert.equal(view.reviewEnabled, true);
});

test("requiredness comes from the SERVER's list, not from this page", () => {
  // A server that requires only a region asks only for a region — this page has
  // no opinion of its own to override it with.
  const gate: BatchReviewGate = { ...SHUT_GATE, requiredFacts: ["REGION"] };
  const view = metadataGateView(
    batchWith(gate),
    { regionId: "region-1" },
    true,
    false,
  );
  assert.deepEqual(view.missingInDraft, []);
  assert.equal(view.saveEnabled, true);
});

test("draftStatesFact maps each fact to the input that holds it", () => {
  assert.equal(draftStatesFact(FULL_DRAFT, "EFFECTIVE_DATE"), true);
  assert.equal(draftStatesFact({ ...FULL_DRAFT, sourceType: undefined }, "SOURCE_TYPE"), false);
});

test("a busy form offers nothing, so a double press cannot happen", () => {
  const view = metadataGateView(batchWith(OPEN_GATE), FULL_DRAFT, true, true);
  assert.equal(view.saveEnabled, false);
  assert.equal(view.reviewEnabled, false);
});

/* ── ONE GOVERNED ACTION ─────────────────────────────────────────────────── */

const provenRow = (id: string) => ({
  id,
  machineProposal: { identityPairProven: true } as never,
  // A proven identity is only work one press does if the row ALSO has a price
  // and no in-batch identity collision — both facts the server already sends.
  proposedCanonicalPrice: "150000.00",
  collisionType: "NONE" as const,
});
const openRow = (id: string) => ({
  id,
  machineProposal: { identityPairProven: false } as never,
  proposedCanonicalPrice: "150000.00",
  collisionType: "NONE" as const,
});

const reviewBatch = (
  rows: Array<{ id: string; machineProposal: unknown }>,
  readyForSubmissionRows: number,
  privateUse: { offered: boolean; reasonCode: string | null },
) =>
  ({
    readyForSubmissionRows,
    rows,
    actions: { privateUse },
  }) as never;

test("the count is what one press ACHIEVES, not what is already finished", () => {
  // Thirteen proven rows, nothing finished yet. The old label said "(0 siap)".
  const rows = Array.from({ length: 13 }, (_, i) => provenRow(`r${i}`));
  const view = oneActionAcceptanceView(
    reviewBatch(rows, 0, {
      offered: false,
      reasonCode: "NO_ROWS_READY_FOR_PRIVATE_USE",
    }),
    new Set(),
  );
  assert.equal(view.machineProvenCount, 13);
  assert.equal(view.rowCount, 13);
  assert.equal(view.offered, true);
});

test("rows a human has touched are NOT counted and NOT auto-bound", () => {
  const rows = [provenRow("a"), provenRow("b"), provenRow("c")];
  const view = oneActionAcceptanceView(
    reviewBatch(rows, 0, {
      offered: false,
      reasonCode: "NO_ROWS_READY_FOR_PRIVATE_USE",
    }),
    new Set(["b"]),
  );
  assert.equal(view.machineProvenCount, 2);
});

test("rows the machine could not prove are never counted", () => {
  const rows = [provenRow("a"), openRow("b"), openRow("c")];
  const view = oneActionAcceptanceView(
    reviewBatch(rows, 0, {
      offered: false,
      reasonCode: "NO_ROWS_READY_FOR_PRIVATE_USE",
    }),
    new Set(),
  );
  assert.equal(view.machineProvenCount, 1);
  assert.equal(view.rowCount, 1);
});

test("already-finished rows and newly provable rows are added together", () => {
  const view = oneActionAcceptanceView(
    reviewBatch([provenRow("a"), provenRow("b")], 4, {
      offered: true,
      reasonCode: null,
    }),
    new Set(),
  );
  assert.equal(view.rowCount, 6);
  assert.equal(view.offered, true);
});

test("a refusal the accept step CANNOT fix still closes the door", () => {
  // Missing metadata is not repaired by binding rows, so the action stays shut
  // even though thirteen rows are provable.
  const rows = Array.from({ length: 13 }, (_, i) => provenRow(`r${i}`));
  const view = oneActionAcceptanceView(
    reviewBatch(rows, 0, {
      offered: false,
      reasonCode: "REGION_REQUIRED_BEFORE_PRIVATE_USE",
    }),
    new Set(),
  );
  assert.equal(view.offered, false);
});

test("nothing proven and nothing ready offers nothing", () => {
  const view = oneActionAcceptanceView(
    reviewBatch([openRow("a")], 0, {
      offered: false,
      reasonCode: "NO_ROWS_READY_FOR_PRIVATE_USE",
    }),
    new Set(),
  );
  assert.equal(view.rowCount, 0);
  assert.equal(view.offered, false);
});


/* ── UNKNOWN REQUIRED FACT — FAIL CLOSED, AND SAY SO IN WORDS ────────────── */

test("a required fact this build cannot render never prints `undefined`", () => {
  // The server is ahead of this tab: it requires a fifth fact that did not
  // exist when this bundle was built. The old code mapped the code through a
  // label table and rendered the miss, producing "Lengkapi dulu: undefined".
  const gate: BatchReviewGate = {
    ...OPEN_GATE,
    requiredFacts: [
      ...OPEN_GATE.requiredFacts,
      "SOME_FUTURE_FACT" as RequiredMetadataFact,
    ],
  };
  const view = metadataGateView(batchWith(gate), FULL_DRAFT, true, false);
  assert.doesNotMatch(view.message, /undefined/u);
  assert.doesNotMatch(view.message, /[A-Z]{3,}_[A-Z]{3,}/u);
  assert.equal(view.message, UNKNOWN_REQUIRED_FACT_MESSAGE);
});

test("an unknown required fact FAILS CLOSED — no save, no review", () => {
  // This build has no input that could satisfy the fact, so letting the person
  // save would guarantee a refusal they cannot act on.
  const gate: BatchReviewGate = {
    ...OPEN_GATE,
    requiredFacts: [
      ...OPEN_GATE.requiredFacts,
      "SOME_FUTURE_FACT" as RequiredMetadataFact,
    ],
  };
  const view = metadataGateView(batchWith(gate), FULL_DRAFT, true, false);
  assert.equal(view.saveEnabled, false);
  assert.equal(view.reviewEnabled, false);
  // And it never claims the unknown fact is one of the ones it CAN name.
  assert.deepEqual(view.missingInDraft, []);
});

/* ── ONE COMMAND OUTCOME, IN WORDS ──────────────────────────────────────── */

test("the outcome names both halves of the one command", () => {
  const message = smartSaveOutcomeMessage({
    accepted: { acceptedCount: 13, remainingEligible: 0 },
    kept: { createdCount: 13, alreadyPrivateCount: 0 },
  });
  assert.match(message, /13 baris yang dikenali otomatis diterima/u);
  assert.match(message, /13 harga tersimpan/u);
});

test("pressing twice does not read as two successes", () => {
  const message = smartSaveOutcomeMessage({
    accepted: { acceptedCount: 0, remainingEligible: 0 },
    kept: { createdCount: 0, alreadyPrivateCount: 13 },
  });
  assert.match(message, /sudah tersimpan sebelumnya/u);
  assert.doesNotMatch(message, /13 harga tersimpan dan siap/u);
});

test("a deferred remainder is an instruction, not an error", () => {
  const message = smartSaveOutcomeMessage({
    accepted: { acceptedCount: 500, remainingEligible: 40 },
    kept: { createdCount: 500, alreadyPrivateCount: 0 },
  });
  assert.match(message, /Masih ada 40 baris/u);
  assert.match(message, /tekan sekali lagi/u);
  assert.doesNotMatch(message, /gagal|error/iu);
});

test("nothing to do says so plainly", () => {
  const message = smartSaveOutcomeMessage({
    accepted: { acceptedCount: 0, remainingEligible: 0 },
    kept: { createdCount: 0, alreadyPrivateCount: 0 },
  });
  assert.match(message, /Belum ada baris yang bisa disimpan/u);
});

/* ── RE-VERIFICATION WORDING ─────────────────────────────────────────────── */

const fmt = (iso: string) => iso.slice(0, 10);

test("the Explorer says 'Verifikasi ulang pada', never 'Berlaku sampai'", () => {
  const line = reverificationLine(
    { reviewDate: "2026-12-31T00:00:00.000Z", reverification: "CURRENT" },
    fmt,
  );
  assert.equal(line, `${REVERIFICATION_LABEL} 2026-12-31`);
  assert.doesNotMatch(line ?? "", /Berlaku sampai/u);
  assert.doesNotMatch(line ?? "", /Berlaku sejak/u);
});

test("an overdue price is FLAGGED, not withdrawn", () => {
  const line = reverificationLine(
    { reviewDate: "2020-12-31T00:00:00.000Z", reverification: "DUE" },
    fmt,
  );
  assert.match(line ?? "", new RegExp(REVERIFICATION_DUE_BADGE, "u"));
  // The wording asks for a check; it never says the price may not be used.
  assert.doesNotMatch(line ?? "", /tidak boleh|kedaluwarsa|kadaluarsa|expired/iu);
});

test("no stated date renders NOTHING, not an empty date", () => {
  assert.equal(
    reverificationLine({ reviewDate: null, reverification: "NOT_RECOMMENDED" }, fmt),
    null,
  );
});

test("the help text explains meaning, when it applies, and when it does not", () => {
  const [meaning, whenUsed, whenNot] = REVERIFICATION_HELP_TEXT;
  // Meaning: crossing the date does not invalidate the price.
  assert.match(meaning, /tidak otomatis membuat harga salah/u);
  assert.match(meaning, /diverifikasi/u);
  // When it applies: human-captured snapshots.
  assert.match(whenUsed, /survei|laporan lapangan|quotation/u);
  // When it does not: sources kept fresh by real synchronisation evidence.
  assert.match(whenNot, /terhubung langsung|sinkronisasi|observasi/u);
  assert.equal(REVERIFICATION_HELP_TRIGGER, "Apa maksud tanggal ini?");
});

test("the help text never exposes field names or backend vocabulary", () => {
  for (const paragraph of REVERIFICATION_HELP_TEXT) {
    assert.doesNotMatch(paragraph, /reviewDate|validUntil|effectiveDate/u);
    assert.doesNotMatch(paragraph, /[A-Z]{3,}_[A-Z]{3,}/u);
  }
});

/* ── SMART-SAVE FAILURE TRUTH ────────────────────────────────────────────── */

/**
 * THE SENTENCE THAT MUST NEVER BE SAID WITHOUT PROOF.
 *
 * `smart-save` is one command over two independently durable steps: bindings
 * commit in bounded chunks, prices materialize in a transaction of their own.
 * So a failure in the second step happens AFTER the first step's commits are
 * permanent, and the private-use vocabulary this page used to borrow — every
 * line of which ends `Tidak ada yang tersimpan.` — was a fluent falsehood at
 * exactly the moment a reviewer most needed the truth.
 *
 * The server now measures the two facts before the command and again after it
 * fails, and sends the verdict. These tests are the guarantee that the browser
 * repeats that verdict and never improves on it.
 */
const failureBody = (
  message: string,
  smartSave: Record<string, unknown>,
): string => JSON.stringify({ message, smartSave });

const FALSE_ZERO = /Tidak ada yang tersimpan|Tidak ada yang disimpan|tidak ada yang tersimpan/iu;

test("committed bindings are NEVER reported as an empty database", () => {
  const message = smartSaveFailureMessage(
    500,
    failureBody("SMART_SAVE_INTERRUPTED", {
      persistence: "PARTIAL",
      boundRowsDelta: 13,
      keptPricesDelta: 0,
    }),
  );
  assert.doesNotMatch(message, FALSE_ZERO);
  assert.match(message, /13 keputusan baris sudah tersimpan/u);
  // And the fear is removed in the same breath: pressing again is safe.
  assert.match(message, /coba lagi/iu);
  assert.match(message, /tidak akan membuat duplikasi/u);
});

test("a zero count is not printed as noise", () => {
  const message = smartSaveFailureMessage(
    500,
    failureBody("SMART_SAVE_INTERRUPTED", {
      persistence: "PARTIAL",
      boundRowsDelta: 12,
      keptPricesDelta: 0,
    }),
  );
  assert.doesNotMatch(message, /0 harga/u);
  assert.match(message, /12 keputusan baris sudah tersimpan\./u);
});

test("both halves are named when both survived", () => {
  const message = smartSaveFailureMessage(
    500,
    failureBody("SMART_SAVE_INTERRUPTED", {
      persistence: "PARTIAL",
      boundRowsDelta: 13,
      keptPricesDelta: 4,
    }),
  );
  assert.match(message, /13 keputusan baris sudah tersimpan dan 4 harga sudah tersimpan/u);
});

test("a MEASURED empty database may still be reported as empty", () => {
  const message = smartSaveFailureMessage(
    409,
    failureBody("EFFECTIVE_DATE_REQUIRED_BEFORE_PRIVATE_USE", { persistence: "NONE" }),
  );
  // The reviewer is told the thing they can actually fix...
  assert.match(message, /Tanggal berlaku harga belum diisi/u);
  // ...and the certainty is allowed here, because it was measured.
  assert.match(message, /Tidak ada yang tersimpan\./u);
});

test("UNKNOWN admits it does not know, and promises a safe retry", () => {
  const message = smartSaveFailureMessage(
    500,
    failureBody("SMART_SAVE_INTERRUPTED", { persistence: "UNKNOWN" }),
  );
  assert.doesNotMatch(message, FALSE_ZERO);
  assert.match(message, /mungkin sudah tersimpan/u);
  assert.match(message, /membaca keadaan terakhir/u);
  assert.match(message, /tanpa membuat duplikasi/u);
});

/**
 * A DROPPED CONNECTION IS NOT EVIDENCE OF AN EMPTY DATABASE. The request may
 * have been fully processed and only the answer lost, so the one thing the
 * browser may not do here is claim a clean slate.
 */
test("a network fault with no status and no body is UNKNOWN, never zero", () => {
  const message = smartSaveFailureMessage(0, "");
  assert.doesNotMatch(message, FALSE_ZERO);
  assert.match(message, /mungkin sudah tersimpan/u);
});

/**
 * A GUARD REFUSAL IS DIFFERENT, and provably so: the validation pipe and the
 * permission guard both run BEFORE the handler, so the command never started.
 */
test("a refusal decided before the command ran is a proven zero", () => {
  for (const status of [400, 401, 403]) {
    const message = smartSaveFailureMessage(status, "");
    assert.match(message, /Tidak ada yang tersimpan\./u, `status ${status}`);
  }
  assert.match(
    smartSaveFailureMessage(403, ""),
    /belum memiliki kewenangan/u,
  );
});

/**
 * A BODY THAT MERELY LOOKS LIKE THE ENVELOPE MUST NOT BE ABLE TO CLAIM ZERO.
 * `NONE` is the one verdict that licenses "nothing was saved", so an
 * unrecognised shape falls back to the honest ceiling rather than to the
 * convenient sentence.
 */
test("a malformed envelope degrades to UNKNOWN, not to a false certainty", () => {
  for (const raw of [
    JSON.stringify({ message: "X", smartSave: { persistence: "MAYBE" } }),
    JSON.stringify({ message: "X", smartSave: "NONE" }),
    JSON.stringify({ message: "Forbidden resource" }),
    "not json at all",
  ]) {
    assert.doesNotMatch(smartSaveFailureMessage(500, raw), FALSE_ZERO, raw);
  }
});

/**
 * NO INTERNALS LEAK. A reviewer is never asked to understand the recovery
 * mechanics — only what happened to their work and what pressing again does.
 */
test("no transaction, chunk, row-version, Prisma or error-code vocabulary reaches a person", () => {
  const messages = [
    smartSaveFailureMessage(500, failureBody("SMART_SAVE_INTERRUPTED", { persistence: "UNKNOWN" })),
    smartSaveFailureMessage(
      500,
      failureBody("SMART_SAVE_INTERRUPTED", {
        persistence: "PARTIAL",
        boundRowsDelta: 13,
        keptPricesDelta: 0,
      }),
    ),
    smartSaveFailureMessage(0, ""),
  ];
  for (const message of messages) {
    assert.doesNotMatch(
      message,
      /transaction|transaksi|chunk|row.?version|prisma|database|basis data|SQL|P20\d\d|SMART_SAVE_INTERRUPTED|\b50\d\b/iu,
      message,
    );
  }
});

/**
 * THE EXACT SENTENCE A PERSON READS FOR A STATED DATE.
 *
 * The acceptance suite proves the date survives the whole journey — import
 * metadata, batch, one smart-save, BasicPrice, Explorer projection — and stops
 * at the ISO string the API returns. This is the last hop: the words built
 * around it, in the page's own locale and options.
 *
 * THE FORMATTER IS PINNED TO UTC HERE, and only here. The page formats in the
 * reader's own timezone, which is right for a person looking at their own
 * screen and useless for an assertion that must mean the same thing on every
 * machine. What is under test is the WORDING and the Indonesian month name,
 * never which side of midnight a given browser lands on.
 */
const idLongDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("id-ID", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

test("a stated re-verification date reads as a date, in words, in Indonesian", () => {
  const line = reverificationLine(
    { reviewDate: "2027-06-30T00:00:00.000Z", reverification: "CURRENT" },
    idLongDate,
  );
  assert.equal(line, "Verifikasi ulang pada 30 Juni 2027");
  // It is a note about freshness, never a claim about validity.
  assert.doesNotMatch(line ?? "", /Berlaku sampai|kedaluwarsa|kadaluarsa|expired/iu);
});

/* ── POST-SAVE TRUTH — A STORED ROW IS NOT NEW WORK ──────────────────────── */

/**
 * THE DEFECT THE OWNER MET IN THE BROWSER.
 *
 * Thirteen machine-proven rows became thirteen WORKSPACE_PRIVATE prices. The
 * status line said so. And the primary button, beside it, went on reading
 * `Simpan & Gunakan (13 siap)` — because the count was
 * `readyForSubmissionRows + machineProven`, a kept row never leaves
 * READY_FOR_SUBMISSION, and the server stops asking the identity authorities
 * about rows no longer awaiting a decision. The first term stayed 13, the
 * second collapsed to 0, and the label printed the same number it had printed
 * before the work happened.
 *
 * The repair is a SERVER fact — `actionableRows` = ready MINUS already
 * private — computed by the same policy that decides whether the action is
 * offered, so the number and the verdict can never disagree.
 */
const savedBatch = (
  rows: Array<{ id: string; machineProposal: unknown }>,
  counts: {
    readyForSubmissionRows: number;
    alreadyPrivateRows?: number | null;
    actionableRows?: number | null;
  },
  privateUse: { offered: boolean; reasonCode: string | null },
) =>
  ({
    readyForSubmissionRows: counts.readyForSubmissionRows,
    alreadyPrivateRows: counts.alreadyPrivateRows,
    rows,
    actions: {
      privateUse: { ...privateUse, actionableRows: counts.actionableRows },
    },
  }) as never;

test("after every proven row is stored, the button offers nothing", () => {
  const view = oneActionAcceptanceView(
    savedBatch(
      [],
      { readyForSubmissionRows: 13, alreadyPrivateRows: 13, actionableRows: 0 },
      { offered: false, reasonCode: "ALL_READY_ROWS_ALREADY_PRIVATE" },
    ),
    new Set(),
  );
  assert.equal(view.rowCount, 0);
  assert.equal(view.offered, false);
  assert.equal(view.alreadyStoredCount, 13);
});

test("and the room says the prices exist instead of greying a button", () => {
  const view = oneActionAcceptanceView(
    savedBatch(
      [],
      { readyForSubmissionRows: 13, alreadyPrivateRows: 13, actionableRows: 0 },
      { offered: false, reasonCode: "ALL_READY_ROWS_ALREADY_PRIVATE" },
    ),
    new Set(),
  );
  const notice = alreadyStoredNotice(view);
  assert.match(notice ?? "", /13 harga sudah tersimpan/u);
  // It reassures; it never reports a failure or asks for another press.
  assert.doesNotMatch(notice ?? "", /gagal|error|coba lagi|belum/iu);
});

test("a mixed batch counts ONLY the rows not yet stored", () => {
  const view = oneActionAcceptanceView(
    savedBatch(
      [],
      { readyForSubmissionRows: 13, alreadyPrivateRows: 10, actionableRows: 3 },
      { offered: true, reasonCode: null },
    ),
    new Set(),
  );
  assert.equal(view.rowCount, 3);
  assert.equal(view.offered, true);
  // Still work to do, so the finished-work sentence stays out of the way.
  assert.equal(alreadyStoredNotice(view), null);
});

/**
 * EVERYTHING FINISHED MAY BE STORED WHILE ROWS THIS PRESS COULD STILL BIND SIT
 * RIGHT THERE. The server counts only rows a human already finished, so this is
 * the one narrow overrule the room has always had — now extended to the new
 * code for exactly the same reason and no other.
 */
test("stored work does not hide rows the press could still bind", () => {
  const rows = Array.from({ length: 4 }, (_, i) => provenRow(`p${i}`));
  const view = oneActionAcceptanceView(
    savedBatch(
      rows,
      { readyForSubmissionRows: 13, alreadyPrivateRows: 13, actionableRows: 0 },
      { offered: false, reasonCode: "ALL_READY_ROWS_ALREADY_PRIVATE" },
    ),
    new Set(),
  );
  assert.equal(view.rowCount, 4);
  assert.equal(view.offered, true);
  assert.equal(alreadyStoredNotice(view), null);
});

/**
 * AN UNMEASURED QUESTION IS NOT A ZERO. Preview and patch never pay for the
 * private-price count, and on those paths the old sum is the honest best
 * answer — the button must not silently claim there is nothing to do.
 */
test("a path that never measured falls back to the old sum, never to zero", () => {
  const view = oneActionAcceptanceView(
    savedBatch(
      [provenRow("a")],
      { readyForSubmissionRows: 5 },
      { offered: true, reasonCode: null },
    ),
    new Set(),
  );
  assert.equal(view.rowCount, 6);
  assert.equal(view.alreadyStoredCount, null);
  assert.equal(alreadyStoredNotice(view), null);
});

test("the review summary tells ONE story after a save", () => {
  const summary = formatMachineFirstSummary({
    totalRows: 86,
    readyForSubmissionRows: 13,
    alreadyPrivateRows: 13,
    rejectedRows: 0,
    rows: [],
  } as never);
  // The finished half is NAMED rather than left to be inferred from a number
  // that did not move, so "13 siap diajukan" can no longer be read as
  // "13 still waiting for you" beside a status line saying they are stored.
  assert.match(summary, /13 sudah tersimpan/u);
});

/* ── SOURCE-AWARE TEMPORAL WORDING ───────────────────────────────────────── */

/**
 * ONE REQUIRED DAY, ASKED IN THE WORDS THAT ARE TRUE FOR THE SOURCE.
 *
 * `Tanggal Berlaku` was one label for every price that has ever existed. For a
 * survey it is a false claim: nobody decreed a start, somebody OBSERVED a
 * price. The column, its meaning and its requiredness are untouched — only the
 * question changed, and the SERVER decides which question, never this file.
 */
test("a survey is asked when the price was observed, not when it 'becomes' effective", () => {
  const copy = effectiveDateCopy("OBSERVED_PRICE_DATE");
  assert.match(copy.label, /Tanggal \/ periode harga/u);
  assert.doesNotMatch(copy.label, /Mulai berlaku|Berlaku sampai/u);
  assert.match(copy.help, /survei|pengamatan|penawaran/iu);
});

test("a regulation keeps the one meaning that label was ever true for", () => {
  const copy = effectiveDateCopy("SOURCE_STATED_START");
  assert.match(copy.label, /Mulai berlaku menurut sumber/u);
  // A future start is lawful and is said to be lawful, so nobody "corrects" it.
  assert.match(copy.help, /masa depan/u);
});

test("an unclassified source gets neutral wording, never a guessed one", () => {
  for (const question of [null, undefined, "SOMETHING_NEWER" as never]) {
    const copy = effectiveDateCopy(question);
    assert.equal(copy.label, "Tanggal harga");
    assert.doesNotMatch(copy.label, /survei|Mulai berlaku/u);
  }
});

test("no temporal label promises a validity window it cannot enforce", () => {
  for (const question of [
    "OBSERVED_PRICE_DATE",
    "SOURCE_STATED_START",
    "PRICE_DATE_UNSPECIFIED",
  ] as const) {
    const copy = effectiveDateCopy(question);
    assert.doesNotMatch(
      `${copy.label} ${copy.help}`,
      /kedaluwarsa|kadaluarsa|expired|berlaku sampai/iu,
    );
  }
});

test("an uploaded snapshot is offered the soft date; a live feed is told why not", () => {
  assert.equal(reverificationIsOffered("RECOMMENDED"), true);
  assert.equal(reverificationIsOffered(undefined), true);
  assert.equal(reverificationIsOffered("FOLLOWS_SOURCE_UPDATES"), false);
  // And the reason is said out loud rather than left as a vanished control.
  assert.match(REVERIFICATION_NOT_NEEDED_NOTE, /diperbarui langsung oleh sistem/u);
  assert.match(REVERIFICATION_NOT_NEEDED_NOTE, /tidak perlu diisi/u);
});

/**
 * NO PROGRAMMER VOCABULARY REACHES A SITE ENGINEER. `freshness` was the one
 * English word left in a sentence meant for one, and the fact it names has
 * ordinary Indonesian words.
 */
test("the re-verification help speaks Indonesian throughout", () => {
  const help = REVERIFICATION_HELP_TEXT.join(" ");
  assert.doesNotMatch(help, /freshness/iu);
  assert.match(help, /kemutakhiran harga|waktu pembaruan/u);
});

/* ── ONE SCREEN, ONE STORY ───────────────────────────────────────────────── */

/**
 * THE ROOM MUST NOT OFFER AN ACTION AND DENY IT AT THE SAME TIME.
 *
 * The button reads the client's `oneAction.offered`, which deliberately
 * overrules the server for the two codes the press itself removes — the server
 * counts only rows a human already finished, so a batch of machine-proven
 * unbound rows honestly reads as "nothing ready yet" until this very press
 * binds them. The "why not" paragraph used to read the RAW server flag, so on
 * the Owner's own batch the page rendered an ENABLED `Simpan & Gunakan (13
 * siap)` directly above `Simpan & Gunakan belum bisa: Belum ada baris yang
 * selesai` — a denial of the action being offered, false the moment it showed.
 */
test("a batch of proven-but-unbound rows is offered, so nothing denies it", () => {
  const rows = Array.from({ length: 13 }, (_, i) => provenRow(`r${i}`));
  const view = oneActionAcceptanceView(
    savedBatch(
      rows,
      { readyForSubmissionRows: 0, alreadyPrivateRows: 0, actionableRows: 0 },
      { offered: false, reasonCode: "NO_ROWS_READY_FOR_PRIVATE_USE" },
    ),
    new Set(),
  );
  assert.equal(view.rowCount, 13);
  // The page gates the refusal paragraph on THIS, not on the server flag.
  assert.equal(view.offered, true);
  assert.equal(alreadyStoredNotice(view), null);
});

test("when everything is stored, exactly one sentence explains it", () => {
  const view = oneActionAcceptanceView(
    savedBatch(
      [],
      { readyForSubmissionRows: 13, alreadyPrivateRows: 13, actionableRows: 0 },
      { offered: false, reasonCode: "ALL_READY_ROWS_ALREADY_PRIVATE" },
    ),
    new Set(),
  );
  // Not offered, so the button is gone; the notice speaks, and the page
  // suppresses the block-reason line whenever the notice is showing — the two
  // would otherwise say the same thing twice.
  assert.equal(view.offered, false);
  assert.match(alreadyStoredNotice(view) ?? "", /13 harga sudah tersimpan/u);
});

/* ── A PROVEN IDENTITY IS NOT YET A PRICE ────────────────────────────────── */

/**
 * `identityPairProven` is the two AUTHORITIES' verdict about a NAME and a
 * SPELLING. It says nothing about the row having a readable price, or being the
 * only row in the batch claiming that identity. Binding such a row succeeds and
 * leaves it at NEEDS_REVIEW, so the keep half never stores it — the button
 * would promise a price and deliver none.
 */
const pricelessProvenRow = (id: string) => ({
  ...provenRow(id),
  proposedCanonicalPrice: null,
  collisionType: "NONE" as const,
});
const collidingProvenRow = (id: string) => ({
  ...provenRow(id),
  proposedCanonicalPrice: "150000.00",
  collisionType: "SAME_IDENTITY_DIFFERENT_VALUE" as const,
});

test("a proven row with no readable price is not counted as work one press does", () => {
  const view = oneActionAcceptanceView(
    savedBatch(
      [pricelessProvenRow("a"), pricelessProvenRow("b"), provenRow("c")],
      { readyForSubmissionRows: 0, alreadyPrivateRows: 0, actionableRows: 0 },
      { offered: false, reasonCode: "NO_ROWS_READY_FOR_PRIVATE_USE" },
    ),
    new Set(),
  );
  // Only the row that could genuinely become a price is counted.
  assert.equal(view.rowCount, 1);
});

test("a proven row colliding with another on the same identity is not counted either", () => {
  const view = oneActionAcceptanceView(
    savedBatch(
      [collidingProvenRow("a"), provenRow("b")],
      { readyForSubmissionRows: 0, alreadyPrivateRows: 0, actionableRows: 0 },
      { offered: false, reasonCode: "NO_ROWS_READY_FOR_PRIVATE_USE" },
    ),
    new Set(),
  );
  assert.equal(view.rowCount, 1);
});

test("a batch of only priceless proven rows offers nothing at all", () => {
  const view = oneActionAcceptanceView(
    savedBatch(
      [pricelessProvenRow("a"), pricelessProvenRow("b")],
      { readyForSubmissionRows: 0, alreadyPrivateRows: 0, actionableRows: 0 },
      { offered: false, reasonCode: "NO_ROWS_READY_FOR_PRIVATE_USE" },
    ),
    new Set(),
  );
  assert.equal(view.rowCount, 0);
  // And with nothing to offer, the server's own reason is the one that shows.
  assert.equal(view.offered, false);
  assert.equal(alreadyStoredNotice(view), null);
});

/* ── THE INSTRUCTION NAMES THE CONTROL THAT EXISTS ───────────────────────── */

/**
 * The date input is labelled by the source-aware question. A completion
 * instruction that still said "Tanggal berlaku harga" would send a person
 * looking for a field that appears nowhere on their screen.
 */
test("the completion instruction names the field the form actually shows", () => {
  const surveyGate: BatchReviewGate = {
    requiredFacts: ["EFFECTIVE_DATE", "REGION", "SOURCE_ORIGIN", "SOURCE_TYPE"],
    missingRequiredFacts: ["EFFECTIVE_DATE"],
    metadataComplete: false,
    metadataCoherent: true,
    reviewAllowed: false,
    reasonCode: "REQUIRED_METADATA_INCOMPLETE",
  };
  const view = metadataGateView(
    {
      actions: { reviewGate: surveyGate },
      temporal: {
        effectiveDateQuestion: "OBSERVED_PRICE_DATE",
        reverification: "RECOMMENDED",
      },
    },
    { ...FULL_DRAFT, effectiveDate: undefined },
    true,
    false,
  );
  assert.deepEqual(view.missingInDraft, ["Tanggal / periode harga"]);
  assert.match(view.message, /Tanggal \/ periode harga/u);
  assert.doesNotMatch(view.message, /Tanggal berlaku harga/u);
});

test("a regulation is told to fill in the field a regulation actually shows", () => {
  const view = metadataGateView(
    {
      actions: {
        reviewGate: {
          requiredFacts: ["EFFECTIVE_DATE"],
          missingRequiredFacts: ["EFFECTIVE_DATE"],
          metadataComplete: false,
          metadataCoherent: true,
          reviewAllowed: false,
          reasonCode: "REQUIRED_METADATA_INCOMPLETE",
        },
      },
      temporal: {
        effectiveDateQuestion: "SOURCE_STATED_START",
        reverification: "RECOMMENDED",
      },
    },
    { ...FULL_DRAFT, effectiveDate: undefined },
    true,
    false,
  );
  assert.deepEqual(view.missingInDraft, ["Mulai berlaku menurut sumber"]);
});

test("a batch that stated no temporal question still gets a usable instruction", () => {
  const view = metadataGateView(
    {
      actions: {
        reviewGate: {
          requiredFacts: ["EFFECTIVE_DATE"],
          missingRequiredFacts: ["EFFECTIVE_DATE"],
          metadataComplete: false,
          metadataCoherent: true,
          reviewAllowed: false,
          reasonCode: "REQUIRED_METADATA_INCOMPLETE",
        },
      },
    },
    { ...FULL_DRAFT, effectiveDate: undefined },
    true,
    false,
  );
  assert.deepEqual(view.missingInDraft, ["Tanggal harga"]);
});
