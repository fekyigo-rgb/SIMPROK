import assert from "node:assert/strict";
import test from "node:test";
import {
  RAB_LOCK_COPY,
  resolveRabWorkspacePresentation,
  toPrelockFindingLines,
  resolveProjectPresentationStatus,
  presentationLabel,
  PRESENTATION_FILTER_ORDER,
} from "./rabLockDisplay.ts";

// ─────────────────────────────────────────────────────────────────────────────
// RM-03D1 — LOCKED IS FROZEN, NOT HIDDEN (§15)
// ─────────────────────────────────────────────────────────────────────────────

test("T7: a locked RAB opens read-only — it is never sent to the denial screen", () => {
  const presentation = resolveRabWorkspacePresentation({
    canEditDraft: false,
    canEnterEditableDraftWorkspace: false,
    reasonCode: "RAB_LOCKED",
  });
  assert.deepEqual(presentation, { mode: "frozen", reasonCode: "RAB_LOCKED" });
});

test("an editable draft is unchanged", () => {
  assert.deepEqual(
    resolveRabWorkspacePresentation({ canEditDraft: true, reasonCode: null }),
    { mode: "editable" },
  );
});

test("every other denial keeps its existing behaviour — this slice widens nothing", () => {
  for (const reasonCode of [
    "ACTIVE_BASELINE_EXISTS",
    "APPROVED_RAB_EXISTS",
    "MULTIPLE_WORKING_DRAFTS",
    "PROJECT_NOT_DRAFT",
  ]) {
    assert.deepEqual(resolveRabWorkspacePresentation({ canEditDraft: false, reasonCode }), {
      mode: "denied",
      reasonCode,
    });
  }
});

test("a missing or malformed capability fails closed to denied, never to editable", () => {
  assert.equal(resolveRabWorkspacePresentation(null).mode, "denied");
  assert.equal(resolveRabWorkspacePresentation(undefined).mode, "denied");
  assert.equal(resolveRabWorkspacePresentation({}).mode, "denied");
  // canEditDraft must be exactly true — not merely truthy-ish
  assert.equal(
    resolveRabWorkspacePresentation({ canEditDraft: "yes" as unknown as boolean }).mode,
    "denied",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// §16 — the Owner is told what happened, never a reason code
// ─────────────────────────────────────────────────────────────────────────────

test("the pre-lock confirmation says the check will happen before anything is frozen", () => {
  assert.match(RAB_LOCK_COPY.confirm, /memeriksa ulang harga/);
  assert.equal(RAB_LOCK_COPY.lockedBadge, "TERKUNCI");
});

test("findings become human sentences carrying the row they belong to", () => {
  const lines = toPrelockFindingLines([
    { wbsCode: "R75", name: "1 m3 Timbunan", finding: "CALCULATION_MISMATCH" },
    { wbsCode: "R76", name: "Galian", finding: "UNPRICED_WORK_ITEM" },
  ]);
  assert.equal(lines[0].label, "R75 — 1 m3 Timbunan");
  assert.match(lines[0].message, /tidak lagi sama/);
  assert.match(lines[1].message, /belum mempunyai harga/);
  for (const line of lines) {
    assert.doesNotMatch(line.message, /[A-Z]{4,}_[A-Z]/); // no reason codes leak through
  }
});

test("an unknown finding code still produces a human sentence, never a raw code", () => {
  const [line] = toPrelockFindingLines([{ wbsCode: "R9", name: "X", finding: "SOMETHING_NEW" }]);
  assert.doesNotMatch(line.message, /SOMETHING_NEW/);
  assert.ok(line.message.length > 0);
});

test("a RAB-level finding with no row still gets a usable label", () => {
  const [line] = toPrelockFindingLines([{ wbsCode: "", name: "", finding: "RAB_PRICING_INCOMPLETE" }]);
  assert.equal(line.label, "RAB");
});

test("no findings is an empty list, never a fabricated one", () => {
  assert.deepEqual(toPrelockFindingLines(undefined), []);
  assert.deepEqual(toPrelockFindingLines([]), []);
});

// ─────────────────────────────────────────────────────────────────────────────
// OWNER PRODUCT LAW — ONE PRESENTATION STATUS
//
//   Draft → Terkunci → Approved → Berjalan → Selesai
//
// Internally RabDocument stays DRAFT/LOCKED/APPROVED and the project keeps its
// own lifecycle. This joins them for a human without bending either, and says
// so honestly when the combination it is handed is not lawful.
// ─────────────────────────────────────────────────────────────────────────────

const facts = (over = {}) => ({
  projectStatus: 'PLANNED',
  workingDraftCount: 0,
  lockedRabCount: 0,
  approvedRabCount: 0,
  activeBaselineCount: 0,
  ...over,
});

test("Percobaan 1: PLANNED project + LOCKED RAB reads Terkunci, never Draft", () => {
  const view = resolveProjectPresentationStatus(
    facts({ lockedRabCount: 1, workingDraftCount: 1, reasonCode: 'RAB_LOCKED' }),
  );

  assert.equal(view.status, 'TERKUNCI');
  assert.equal(view.label, 'Terkunci');
  assert.equal(view.badgeLabel, 'RAB Terkunci');
  assert.equal(view.chipModifier, 'terkunci');
  // The project is still PLANNED, and that must not leak into the badge.
  assert.doesNotMatch(view.badgeLabel, /draft|perencanaan/i);
});

test("a working draft — or no RAB yet — sits at the first stage: Draft", () => {
  assert.equal(resolveProjectPresentationStatus(facts({ workingDraftCount: 1 })).status, 'DRAFT');
  assert.equal(resolveProjectPresentationStatus(facts()).status, 'DRAFT');
  assert.equal(resolveProjectPresentationStatus(facts()).badgeLabel, 'RAB Draft');
});

test("an APPROVED RAB reads by the project's own stage", () => {
  const statusFor = (projectStatus: string) =>
    resolveProjectPresentationStatus(facts({ approvedRabCount: 1, projectStatus })).status;

  assert.equal(statusFor('PLANNED'), 'APPROVED');
  assert.equal(statusFor('ACTIVE'), 'BERJALAN');
  assert.equal(statusFor('ON_HOLD'), 'BERJALAN'); // never a separate "held" status
  assert.equal(statusFor('COMPLETED'), 'SELESAI');
  assert.equal(statusFor('ARCHIVED'), 'SELESAI');
});

test("an approved RAB on an unrecognised project stage fails honestly", () => {
  const view = resolveProjectPresentationStatus(facts({ approvedRabCount: 1, projectStatus: 'SOMETHING_NEW' }));
  assert.equal(view.status, 'UNKNOWN');
  assert.doesNotMatch(view.badgeLabel, /draft|terkunci|approved|berjalan|selesai/i);
});

test("APPROVED and LOCKED together is not lawful — no winner is picked", () => {
  // One RAB, one house, three states. Two governing documents is a defect,
  // and guessing which one rules would hide it.
  const view = resolveProjectPresentationStatus(facts({ approvedRabCount: 1, lockedRabCount: 1 }));
  assert.equal(view.status, 'UNKNOWN');
});

test("absent facts are reported as unknown — never defaulted into Draft", () => {
  for (const absent of [undefined, null, {}]) {
    const view = resolveProjectPresentationStatus(absent);
    assert.equal(view.status, 'UNKNOWN', `expected UNKNOWN for ${JSON.stringify(absent)}`);
    assert.equal(view.badgeLabel, 'Menunggu Data');
  }
});

test("the badge only ever uses the existing chip vocabulary", () => {
  const allowed = ['draft', 'terkunci', 'approved', 'berjalan', 'selesai'];
  const cases = [
    facts({ workingDraftCount: 1 }),
    facts({ lockedRabCount: 1 }),
    facts({ approvedRabCount: 1 }),
    facts({ approvedRabCount: 1, projectStatus: 'ACTIVE' }),
    facts({ approvedRabCount: 1, projectStatus: 'COMPLETED' }),
    undefined,
  ];
  for (const f of cases) {
    assert.equal(allowed.includes(resolveProjectPresentationStatus(f).chipModifier), true);
  }
});

test("the filter offers exactly the lifecycle the user reads, in order", () => {
  assert.deepEqual(PRESENTATION_FILTER_ORDER, ['DRAFT', 'TERKUNCI', 'APPROVED', 'BERJALAN', 'SELESAI']);
  assert.deepEqual(
    PRESENTATION_FILTER_ORDER.map(presentationLabel),
    ['Draft', 'Terkunci', 'Approved', 'Berjalan', 'Selesai'],
  );
});

test("filtering and the badge cannot disagree — both come from this resolver", () => {
  // A card shown as 'Terkunci' must be found by the 'Terkunci' filter.
  const locked = facts({ lockedRabCount: 1 });
  const view = resolveProjectPresentationStatus(locked);
  assert.equal(view.status, 'TERKUNCI');
  assert.equal(presentationLabel(view.status), 'Terkunci');
  assert.equal(PRESENTATION_FILTER_ORDER.includes(view.status), true);
});
