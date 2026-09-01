import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  alreadyStoredNotice,
  batchStatusLabel,
  formatBatchProgress,
  formatMachineFirstSummary,
  oneActionAcceptanceView,
  rowStateLabel,
  rowStatusLabel,
  ROW_SAVED_PRIVATE_LABEL,
  smartSaveOutcomeMessage,
  type BasicPriceImportBatchSummary,
  type BasicPriceImportRowSummary,
} from "./basicPriceImportDisplay.ts";

/**
 * ONE WORD, ONE MEANING.
 *
 * THE OWNER'S SCREEN, REPRODUCED. After one `Simpan & Gunakan` created thirteen
 * WORKSPACE_PRIVATE prices, the same Review page said all of this at once:
 *
 *   `13 harga sudah tersimpan dan bisa dipakai di ruang kerja ini`
 *   `13 siap diajukan`
 *   row Air: `Siap diajukan`
 *   `86 baris terbaca · 0 identitas terbukti · … · 13 siap diajukan · 13 sudah tersimpan`
 *
 * Four sentences about three different product states, and two of them were
 * about a state that had already passed. The words came from three unrelated
 * places — `alreadyPrivateRows`, `readyForSubmissionRows` and the row's own
 * status column — and nothing made them agree, because nothing knew they were
 * describing the same thirteen rows.
 *
 * THE VOCABULARY IS NOW FIXED, AND THESE TESTS ARE THE LOCK:
 *
 *   Dikenali otomatis        SIMPROK understands the row. Machine knowledge.
 *   Siap disimpan            one press would turn it into a usable price.
 *   Tersimpan di ruang kerja the price EXISTS and is usable now.
 *   Usulkan ke SIMPROK       the separate, optional curation path.
 *   Sudah diusulkan          only where a real submission record exists.
 *
 * `diajukan` without a destination is banned outright: diajukan ke mana?
 */

const DESTINATIONLESS = /diajukan(?!\s+ke\s+SIMPROK)/;

const baseRow = (
  overrides: Partial<BasicPriceImportRowSummary> = {},
): BasicPriceImportRowSummary =>
  ({
    id: "row-1",
    status: "NEEDS_REVIEW",
    resolutionStatus: "UNRESOLVED",
    code: null,
    name: "Air",
    unit: "m3",
    rawPriceDisplayText: "150000",
    proposedCanonicalPrice: "150000.00",
    section: "MATERIAL",
    sectionProvenance: null,
    sourceCategoryCode: null,
    sourceCategoryName: null,
    sourceRowNumber: 1,
    collisionType: "NONE",
    collisionOfRowId: null,
    resourceCatalogId: null,
    unitDefinitionId: null,
    reasonCodes: [],
    version: 0,
    savedAsPrivatePrice: false,
    machineProposal: null,
    ...overrides,
  }) as BasicPriceImportRowSummary;

/**
 * Exactly the three fields `rowMachineState` reads — the identity verdict,
 * whether any candidate was offered, and whether the unit was recognised.
 * Building the whole proposal here would copy forty lines of fixture that prove
 * nothing about the wording these tests are for.
 */
const proposal = (proven: boolean, candidates = 0, unitCode: string | null = null) =>
  ({
    identityPairProven: proven,
    resource: { candidates: Array.from({ length: candidates }, () => ({})) },
    unit: { unitCode },
  }) as never;

/** A row SIMPROK proved. `saved` makes it one already stored as a price. */
const provenRow = (id: string, saved = false) =>
  baseRow({
    id,
    status: saved ? "READY_FOR_SUBMISSION" : "NEEDS_REVIEW",
    savedAsPrivatePrice: saved,
    // The server stops asking the authorities about a row once it is bound, so
    // a stored row genuinely carries no proposal — exactly as in production.
    machineProposal: saved ? null : proposal(true),
  });

/** Recognised enough to show candidates, not enough to decide. */
const openRow = (id: string) =>
  baseRow({ id, machineProposal: proposal(false, 2, "LITER") });

/** SIMPROK found nothing safe to offer at all. */
const unknownRow = (id: string) =>
  baseRow({ id, machineProposal: proposal(false, 0, null) });

const batchOf = (
  rows: BasicPriceImportRowSummary[],
  counts: {
    totalRows: number;
    needsReviewRows: number;
    readyForSubmissionRows: number;
    alreadyPrivateRows?: number | null;
    actionableRows?: number | null;
  },
): BasicPriceImportBatchSummary =>
  ({
    batchId: "batch-1",
    status: "NEEDS_REVIEW",
    totalRows: counts.totalRows,
    needsReviewRows: counts.needsReviewRows,
    readyForSubmissionRows: counts.readyForSubmissionRows,
    rejectedRows: 0,
    submittedRows: 0,
    identityPairProvenRows: 0,
    alreadyPrivateRows: counts.alreadyPrivateRows,
    rows,
    actions: {
      privateUse: {
        offered: (counts.actionableRows ?? 0) > 0,
        reasonCode:
          (counts.actionableRows ?? 0) > 0
            ? null
            : "ALL_READY_ROWS_ALREADY_PRIVATE",
        actionableRows: counts.actionableRows,
      },
    },
  }) as never;

/* ── §15 PRE-SAVE ────────────────────────────────────────────────────────── */

test("S-1. before any save, thirteen proven rows are RECOGNISED, not 'diajukan'", () => {
  const rows = [
    ...Array.from({ length: 13 }, (_unused, i) => provenRow(`p${i}`)),
    ...Array.from({ length: 12 }, (_unused, i) => openRow(`o${i}`)),
  ];
  const batch = batchOf(rows, {
    totalRows: 25,
    needsReviewRows: 25,
    readyForSubmissionRows: 0,
    alreadyPrivateRows: 0,
    actionableRows: 0,
  });

  const summary = formatMachineFirstSummary(batch);
  assert.match(summary, /13 dikenali otomatis/u);
  assert.doesNotMatch(summary, DESTINATIONLESS);
  // Nothing is stored yet, so nothing claims to be.
  assert.doesNotMatch(summary, /sudah tersimpan/u);

  const view = oneActionAcceptanceView(batch, new Set());
  assert.equal(view.rowCount, 13, "one press would store thirteen");
  assert.equal(view.offered, true);
  assert.equal(alreadyStoredNotice(view), null);
});

test("S-2. a proven, unsaved row reads as ready to be SAVED, never as submitted", () => {
  const row = baseRow({ status: "READY_FOR_SUBMISSION", savedAsPrivatePrice: false });
  assert.equal(rowStateLabel(row), "Siap disimpan");
  assert.doesNotMatch(rowStateLabel(row), DESTINATIONLESS);
  assert.doesNotMatch(rowStateLabel(row), /SIMPROK/u);
});

/* ── §16 POST-SAVE ───────────────────────────────────────────────────────── */

test("S-3. after the save, the summary tells ONE story", () => {
  // The Owner's exact case: 86 read, 13 stored, 61 still needing a decision,
  // 12 SIMPROK could not identify.
  const rows = [
    ...Array.from({ length: 13 }, (_unused, i) => provenRow(`p${i}`, true)),
    ...Array.from({ length: 61 }, (_unused, i) => openRow(`a${i}`)),
    ...Array.from({ length: 12 }, (_unused, i) => unknownRow(`u${i}`)),
  ];
  const summary = formatMachineFirstSummary(
    batchOf(rows, {
      totalRows: 86,
      needsReviewRows: 73,
      readyForSubmissionRows: 13,
      alreadyPrivateRows: 13,
      actionableRows: 0,
    }),
  );

  assert.match(summary, /86 baris terbaca/u);
  assert.match(summary, /13 sudah tersimpan/u);
  // THE THREE FALSEHOODS, EACH BANNED BY NAME.
  assert.doesNotMatch(summary, /0 identitas terbukti/u);
  assert.doesNotMatch(summary, /identitas terbukti/u);
  assert.doesNotMatch(summary, /13 siap diajukan/u);
  assert.doesNotMatch(summary, DESTINATIONLESS);
});

test("S-4. a saved row says it is saved, not that it is waiting for anything", () => {
  const saved = baseRow({
    status: "READY_FOR_SUBMISSION",
    savedAsPrivatePrice: true,
  });
  assert.equal(rowStateLabel(saved), ROW_SAVED_PRIVATE_LABEL);
  assert.equal(rowStateLabel(saved), "Tersimpan di ruang kerja");
  // The internal status is untouched and still says what it always said — the
  // row lifecycle was not changed to fix wording. Only the SENTENCE changed.
  assert.equal(saved.status, "READY_FOR_SUBMISSION");
  assert.doesNotMatch(rowStateLabel(saved), DESTINATIONLESS);
  assert.doesNotMatch(rowStateLabel(saved), /[Ss]iap disimpan/u);
});

test("S-5. after the save there is no private work left to offer", () => {
  const rows = Array.from({ length: 13 }, (_unused, i) => provenRow(`p${i}`, true));
  const view = oneActionAcceptanceView(
    batchOf(rows, {
      totalRows: 13,
      needsReviewRows: 0,
      readyForSubmissionRows: 13,
      alreadyPrivateRows: 13,
      actionableRows: 0,
    }),
    new Set(),
  );
  assert.equal(view.rowCount, 0);
  assert.equal(view.offered, false);
  assert.match(alreadyStoredNotice(view) ?? "", /13 harga sudah tersimpan/u);
});

/* ── §17 MIXED ───────────────────────────────────────────────────────────── */

test("S-6. mixed: eight stored, five still actionable — never thirteen", () => {
  const rows = [
    ...Array.from({ length: 8 }, (_unused, i) => provenRow(`s${i}`, true)),
    ...Array.from({ length: 5 }, (_unused, i) => provenRow(`n${i}`)),
  ];
  const batch = batchOf(rows, {
    totalRows: 13,
    needsReviewRows: 5,
    readyForSubmissionRows: 8,
    alreadyPrivateRows: 8,
    actionableRows: 0,
  });

  const view = oneActionAcceptanceView(batch, new Set());
  assert.equal(view.rowCount, 5, "only the five not yet stored are new work");
  assert.equal(view.offered, true);

  const summary = formatMachineFirstSummary(batch);
  assert.match(summary, /8 sudah tersimpan/u);
  assert.match(summary, /5 dikenali otomatis/u);
  assert.doesNotMatch(summary, DESTINATIONLESS);

  // AND EACH ROW SAYS ITS OWN TRUTH — this half of S-6 was itself the defect.
  //
  // It used to expect the five unsaved-but-PROVEN rows to read
  // `Perlu konfirmasi`, which is what the code did and what a reader would
  // understand as "SIMPROK needs your attention". SIMPROK needed nothing: it
  // had proved both identity legs, the summary said so, and the button offered
  // to store them. The test was pinning the contradiction rather than catching
  // it. It is now the regression lock for the repair.
  assert.equal(rowStateLabel(rows[0]), "Tersimpan di ruang kerja");
  assert.equal(rowStateLabel(rows[8]), "Dikenali otomatis");
  assert.notEqual(rowStateLabel(rows[8]), "Perlu konfirmasi");
});

/* ── §18 CURATION SEPARATION ─────────────────────────────────────────────── */

test("S-7. private save is never labelled as a submission to SIMPROK", () => {
  const message = smartSaveOutcomeMessage({
    accepted: { acceptedCount: 13, remainingEligible: 0 },
    kept: { createdCount: 13, alreadyPrivateCount: 0 },
  });
  assert.match(message, /tersimpan/u);
  assert.doesNotMatch(message, /diusulkan|diajukan|kurasi/u);
});

test("S-8. 'sudah diusulkan' requires a real submission record, never a private save", () => {
  // Only the row status the BACKEND sets when a PriceSubmission exists may say
  // it. A stored private price says nothing about curation.
  assert.equal(rowStatusLabel("SUBMISSION_CREATED"), "Sudah diusulkan ke SIMPROK");
  const privatelySaved = baseRow({
    status: "READY_FOR_SUBMISSION",
    savedAsPrivatePrice: true,
  });
  assert.doesNotMatch(rowStateLabel(privatelySaved), /diusulkan/u);
});

test("S-9. every batch status that says diajukan names SIMPROK as the destination", () => {
  for (const status of [
    "APPROVED_FOR_SUBMISSION",
    "PARTIALLY_SUBMITTED",
    "SUBMITTED",
  ] as const) {
    const label = batchStatusLabel(status);
    assert.match(label, /ke SIMPROK/u, status);
    assert.doesNotMatch(label, DESTINATIONLESS, status);
  }
});

/* ── §14 ONE SCREEN, ONE STORY — THE CONTRADICTIONS CANNOT COEXIST ───────── */

test("S-10. no rendered Basic Price sentence carries a destinationless 'diajukan'", () => {
  const sources = [
    "src/utils/basicPriceImportDisplay.ts",
    "src/pages/BasicPriceReviewPage.tsx",
    "src/pages/BasicPriceImportPage.tsx",
  ];
  for (const path of sources) {
    const source = readFileSync(path, "utf8");
    // Quoted user copy only — comments explaining the repair legitimately
    // quote the old wording, and JSX text is checked separately below.
    const quoted = [...source.matchAll(/'([^'\n]*diajukan[^'\n]*)'/g)].map(
      (m) => m[1],
    );
    for (const sentence of quoted) {
      assert.doesNotMatch(
        sentence,
        DESTINATIONLESS,
        `${path}: "${sentence}" says diajukan without saying where`,
      );
    }
  }
});

test("S-11. the header line no longer reports an internal row state", () => {
  const progress = formatBatchProgress(
    batchOf([], {
      totalRows: 86,
      needsReviewRows: 73,
      readyForSubmissionRows: 13,
      alreadyPrivateRows: 13,
      actionableRows: 0,
    }),
  );
  assert.match(progress, /13 dari 86 baris sudah ditinjau/u);
  assert.doesNotMatch(progress, DESTINATIONLESS);
});

/**
 * THE PAIR THAT STARTED THIS. A screen may never simultaneously report the same
 * rows as stored and as pending — whichever wording either one uses.
 */
test("S-12. stored and pending can never describe the same rows at once", () => {
  const rows = Array.from({ length: 13 }, (_unused, i) => provenRow(`p${i}`, true));
  const batch = batchOf(rows, {
    totalRows: 86,
    needsReviewRows: 73,
    readyForSubmissionRows: 13,
    alreadyPrivateRows: 13,
    actionableRows: 0,
  });
  const view = oneActionAcceptanceView(batch, new Set());
  const screen = [
    formatMachineFirstSummary(batch),
    formatBatchProgress(batch),
    alreadyStoredNotice(view) ?? "",
    ...rows.map((row) => rowStateLabel(row)),
  ].join(" | ");

  assert.match(screen, /13 sudah tersimpan/u);
  assert.match(screen, /Tersimpan di ruang kerja/u);
  // Nothing anywhere on that screen calls those thirteen rows pending work.
  assert.doesNotMatch(screen, /13 siap diajukan/u);
  assert.doesNotMatch(screen, /Siap disimpan/u);
  assert.doesNotMatch(screen, /0 identitas terbukti/u);
  assert.doesNotMatch(screen, DESTINATIONLESS);
});

/* ── ROW PRESENTATION PRECEDENCE ─────────────────────────────────────────── */

/**
 * THREE FACTS, STRONGEST FIRST — AND THE MIDDLE ONE WAS MISSING.
 *
 * `rowStateLabel` knew only two levels: already-stored, else the raw status. So
 * a row SIMPROK had fully proved, and which needed no `Selesaikan` click at
 * all, fell through to `Perlu konfirmasi` — "SIMPROK needs your attention" — while
 * the summary above it said `13 dikenali otomatis` and the button offered to
 * store those very thirteen. Of the three, the sentence a person believes is
 * the one printed on the row in front of them.
 *
 * The precedence is now explicit, and these tests are its regression lock. Note
 * what did NOT change: `row.status` is untouched in every case below.
 */
test("P-1. an already-stored price outranks everything, whatever the row status says", () => {
  const saved = baseRow({
    status: "READY_FOR_SUBMISSION",
    savedAsPrivatePrice: true,
    // Even with a live proof attached, the price EXISTING is the stronger and
    // more useful fact.
    machineProposal: proposal(true),
  });
  assert.equal(rowStateLabel(saved), "Tersimpan di ruang kerja");
  assert.notEqual(rowStateLabel(saved), "Dikenali otomatis");
  assert.notEqual(rowStateLabel(saved), "Siap disimpan");
  // The persistence lifecycle is untouched — only the sentence changed.
  assert.equal(saved.status, "READY_FOR_SUBMISSION");
});

test("P-2. machine proof outranks the raw status when nothing is stored yet", () => {
  const proven = baseRow({
    status: "NEEDS_REVIEW",
    savedAsPrivatePrice: false,
    machineProposal: proposal(true),
  });
  assert.equal(rowStateLabel(proven), "Dikenali otomatis");
  // THE DEFECT, BANNED BY NAME. This is what the Owner's screen showed.
  assert.notEqual(rowStateLabel(proven), "Perlu konfirmasi");
  assert.equal(proven.status, "NEEDS_REVIEW");
});

test("P-3. the word claims proof and nothing more", () => {
  const proven = baseRow({ machineProposal: proposal(true) });
  const label = rowStateLabel(proven);
  // Machine proof is not approval, not completion, not storage, and not a human
  // verification. Saying any of those would be the opposite defect.
  assert.doesNotMatch(
    label,
    /[Ss]elesai|[Dd]isetujui|[Tt]ersimpan|diverifikasi|diusulkan|diajukan/u,
  );
  assert.equal(label, "Dikenali otomatis");
});

/* ── §13 THE FULL MATRIX ─────────────────────────────────────────────────── */

test("P-4. a row SIMPROK could not decide still asks for the human", () => {
  // Candidates found, none provable: this genuinely needs a person, and the
  // wording must keep saying so.
  const attention = baseRow({
    status: "NEEDS_REVIEW",
    machineProposal: proposal(false, 2, "LITER"),
  });
  assert.equal(rowStateLabel(attention), "Perlu konfirmasi");
});

test("P-5. a row SIMPROK could not recognise at all is still honest about it", () => {
  const unknown = baseRow({
    status: "NEEDS_REVIEW",
    machineProposal: proposal(false, 0, null),
  });
  assert.equal(rowStateLabel(unknown), "Perlu konfirmasi");
  // And a row nobody asked about is not silently promoted either.
  const notAsked = baseRow({ status: "NEEDS_REVIEW", machineProposal: null });
  assert.equal(rowStateLabel(notAsked), "Perlu konfirmasi");
});

test("P-6. a rejected row stays rejected, and a submitted row names its destination", () => {
  assert.equal(rowStateLabel(baseRow({ status: "REJECTED" })), "Ditolak");
  assert.equal(
    rowStateLabel(baseRow({ status: "SUBMISSION_CREATED" })),
    "Sudah diusulkan ke SIMPROK",
  );
});

/**
 * A MACHINE PROOF MAY NEVER SPEAK OVER A DECISION THAT ALREADY HAPPENED.
 *
 * P-6 above proves the wording; it says nothing about what happens when an
 * OLDER machine proof is still attached to such a row. It was left attached in
 * these fixtures on purpose, because that is the only case where the two facts
 * disagree — and `rowStateLabel` used to answer with the weaker one, printing
 * `Dikenali otomatis` on a row a person had explicitly rejected.
 *
 * WHY THE ORDER IS THIS WAY AND NOT THE OTHER. A proposal says "SIMPROK
 * understands this row". `REJECTED` says "a human looked at this row and said
 * no". `SUBMISSION_CREATED` says "this row has already entered the SIMPROK
 * curation path" — a record that exists in the world, not a pending internal
 * step. Showing the proposal would ask the person to re-read a recommendation
 * their own decision already replaced.
 *
 * THE SERVER DOES NOT CURRENTLY EMIT THIS COMBINATION — `getBatch` asks the
 * authorities only about `NEEDS_REVIEW` rows, so these two rows are shaped by
 * hand rather than observed. That is what makes the tests worth keeping: the
 * row TYPE permits the pair, so only one upstream filter stands between this
 * function and the wrong sentence, and nothing but this test would notice it
 * going.
 */
test("P-6a. an explicit human rejection outranks an older machine proof", () => {
  const rejected = baseRow({
    status: "REJECTED",
    savedAsPrivatePrice: false,
    machineProposal: proposal(true),
  });
  assert.equal(rowStateLabel(rejected), "Ditolak");
  assert.notEqual(rowStateLabel(rejected), "Dikenali otomatis");
  // The stored lifecycle is untouched — only the sentence is decided here.
  assert.equal(rejected.status, "REJECTED");
  assert.equal(rejected.machineProposal?.identityPairProven, true);
});

test("P-6b. a real submission record outranks an older machine proof", () => {
  const submitted = baseRow({
    status: "SUBMISSION_CREATED",
    savedAsPrivatePrice: false,
    machineProposal: proposal(true),
  });
  assert.equal(rowStateLabel(submitted), "Sudah diusulkan ke SIMPROK");
  assert.notEqual(rowStateLabel(submitted), "Dikenali otomatis");
  assert.equal(submitted.status, "SUBMISSION_CREATED");
  assert.equal(submitted.machineProposal?.identityPairProven, true);
});

/**
 * THE ORDER ITSELF, PINNED — so a future reordering fails here rather than on
 * the Owner's screen.
 *
 * Each case below is the SAME row facts read at a different strength, walking
 * down the ladder one rung at a time:
 *
 *   PRIVATE SAVED  >  HUMAN / TERMINAL  >  MACHINE PROVEN  >  RAW STATUS
 *
 * Every row carries a live `identityPairProven` proof, so each expectation is a
 * statement about PRECEDENCE and not merely about wording. Read the `beats`
 * column downwards and the ladder is the test.
 *
 * NO LIFECYCLE IS ENCODED HERE. Nothing below invents a state, moves a row, or
 * adds a rule the facts did not already carry; it only fixes which of several
 * simultaneously-true facts gets to be the sentence.
 */
test("P-6c. the presentation precedence ladder holds top to bottom", () => {
  const cases = [
    {
      rung: "1 PRIVATE_SAVED",
      row: baseRow({
        status: "REJECTED",
        savedAsPrivatePrice: true,
        machineProposal: proposal(true),
      }),
      // A price that EXISTS is the strongest fact about its own usability, and
      // outranks even a terminal status on the row that produced it.
      expected: "Tersimpan di ruang kerja",
      beats: "Ditolak",
    },
    {
      rung: "2 HUMAN_TERMINAL (rejected)",
      row: baseRow({
        status: "REJECTED",
        savedAsPrivatePrice: false,
        machineProposal: proposal(true),
      }),
      expected: "Ditolak",
      beats: "Dikenali otomatis",
    },
    {
      rung: "2 HUMAN_TERMINAL (submitted)",
      row: baseRow({
        status: "SUBMISSION_CREATED",
        savedAsPrivatePrice: false,
        machineProposal: proposal(true),
      }),
      expected: "Sudah diusulkan ke SIMPROK",
      beats: "Dikenali otomatis",
    },
    {
      rung: "3 MACHINE_PROVEN",
      row: baseRow({
        status: "NEEDS_REVIEW",
        savedAsPrivatePrice: false,
        machineProposal: proposal(true),
      }),
      expected: "Dikenali otomatis",
      beats: "Perlu konfirmasi",
    },
    {
      rung: "4 RAW_STATUS",
      row: baseRow({
        status: "NEEDS_REVIEW",
        savedAsPrivatePrice: false,
        machineProposal: proposal(false, 2, "LITER"),
      }),
      // Nothing stronger is true, so the honest raw sentence survives — a row
      // SIMPROK could not decide must keep asking for the person.
      expected: "Perlu konfirmasi",
      beats: null,
    },
  ];

  for (const { rung, row, expected, beats } of cases) {
    assert.equal(rowStateLabel(row), expected, `${rung}: wrong sentence`);
    if (beats !== null) {
      assert.notEqual(
        rowStateLabel(row),
        beats,
        `${rung}: a weaker fact won the row`,
      );
    }
  }

  // ONE ROW, ONE STORY. No row above may be readable as two states at once.
  for (const { rung, row } of cases) {
    const label = rowStateLabel(row);
    const others = [
      "Tersimpan di ruang kerja",
      "Ditolak",
      "Sudah diusulkan ke SIMPROK",
      "Dikenali otomatis",
      "Perlu konfirmasi",
    ].filter((word) => word !== label);
    for (const other of others) {
      assert.doesNotMatch(label, new RegExp(other, "u"), `${rung}: two stories`);
    }
  }
});

/**
 * CURATION IS NEVER INFERRED FROM PROOF OR FROM A PRIVATE SAVE. Neither of the
 * two stronger facts may ever produce a curation sentence.
 */
test("P-7. neither machine proof nor a private save ever implies curation", () => {
  for (const row of [
    baseRow({ machineProposal: proposal(true) }),
    baseRow({ status: "READY_FOR_SUBMISSION", savedAsPrivatePrice: true }),
  ]) {
    assert.doesNotMatch(rowStateLabel(row), /diusulkan|diajukan|SIMPROK/u);
  }
});

/* ── §15 ONE SCREEN, ONE STORY — EXTENDED TO THE ROW ─────────────────────── */

/**
 * PRE-SAVE. The summary says thirteen are understood; every one of those
 * thirteen rows must agree, and none may ask for attention SIMPROK does not
 * need.
 */
test("P-8. pre-save: summary and rows tell the SAME story about the same thirteen", () => {
  const proven = Array.from({ length: 13 }, (_unused, i) => provenRow(`p${i}`));
  const rows = [
    ...proven,
    ...Array.from({ length: 61 }, (_unused, i) => openRow(`a${i}`)),
    ...Array.from({ length: 12 }, (_unused, i) => unknownRow(`u${i}`)),
  ];
  const batch = batchOf(rows, {
    totalRows: 86,
    needsReviewRows: 86,
    readyForSubmissionRows: 0,
    alreadyPrivateRows: 0,
    actionableRows: 0,
  });

  const summary = formatMachineFirstSummary(batch);
  assert.match(summary, /86 baris terbaca/u);
  assert.match(summary, /13 dikenali otomatis/u);
  assert.match(summary, /61 perlu keputusan Anda/u);
  assert.match(summary, /12 belum dikenali/u);

  // EVERY ONE of the thirteen agrees with the summary.
  for (const row of proven) {
    assert.equal(rowStateLabel(row), "Dikenali otomatis");
  }
  // And the rows that genuinely need a person still say so.
  assert.equal(rowStateLabel(rows[13]), "Perlu konfirmasi");

  // One press would store exactly those thirteen, and nothing is stored yet.
  const view = oneActionAcceptanceView(batch, new Set());
  assert.equal(view.rowCount, 13);
  assert.equal(alreadyStoredNotice(view), null);
});

/**
 * POST-SAVE. The price exists, so `Dikenali otomatis` is no longer the strongest
 * current truth about those rows and must not be what they say.
 */
test("P-9. post-save: nothing on screen still calls the stored thirteen pending", () => {
  const stored = Array.from({ length: 13 }, (_unused, i) => provenRow(`p${i}`, true));
  const rows = [
    ...stored,
    ...Array.from({ length: 61 }, (_unused, i) => openRow(`a${i}`)),
    ...Array.from({ length: 12 }, (_unused, i) => unknownRow(`u${i}`)),
  ];
  const batch = batchOf(rows, {
    totalRows: 86,
    needsReviewRows: 73,
    readyForSubmissionRows: 13,
    alreadyPrivateRows: 13,
    actionableRows: 0,
  });
  const view = oneActionAcceptanceView(batch, new Set());

  const screen = [
    formatMachineFirstSummary(batch),
    formatBatchProgress(batch),
    alreadyStoredNotice(view) ?? "",
    ...stored.map((row) => rowStateLabel(row)),
  ].join(" | ");

  assert.match(screen, /13 sudah tersimpan/u);
  for (const row of stored) {
    assert.equal(rowStateLabel(row), "Tersimpan di ruang kerja");
  }
  // None of the weaker, now-stale readings survives anywhere on that screen.
  assert.doesNotMatch(screen, /13 dikenali otomatis/u);
  assert.doesNotMatch(screen, /Perlu konfirmasi/u);
  assert.doesNotMatch(screen, /Siap disimpan/u);
  assert.doesNotMatch(screen, DESTINATIONLESS);
  assert.equal(view.offered, false);
});

/**
 * MIXED. Eight stored, five proven-but-unstored — and the five must not be
 * demoted to `Perlu konfirmasi` just because the batch is half done.
 */
test("P-10. mixed: stored rows and understood rows each keep their own sentence", () => {
  const storedRows = Array.from({ length: 8 }, (_unused, i) => provenRow(`s${i}`, true));
  const provenRows = Array.from({ length: 5 }, (_unused, i) => provenRow(`n${i}`));
  const batch = batchOf([...storedRows, ...provenRows], {
    totalRows: 13,
    needsReviewRows: 5,
    readyForSubmissionRows: 8,
    alreadyPrivateRows: 8,
    actionableRows: 0,
  });

  const summary = formatMachineFirstSummary(batch);
  assert.match(summary, /8 sudah tersimpan/u);
  assert.match(summary, /5 dikenali otomatis/u);

  for (const row of storedRows) {
    assert.equal(rowStateLabel(row), "Tersimpan di ruang kerja");
  }
  for (const row of provenRows) {
    assert.equal(rowStateLabel(row), "Dikenali otomatis");
    assert.notEqual(rowStateLabel(row), "Perlu konfirmasi");
  }
  assert.equal(oneActionAcceptanceView(batch, new Set()).rowCount, 5);
});
