import assert from "node:assert/strict";
import test from "node:test";
import {
  RAB_LOCK_COPY,
  resolveRabWorkspacePresentation,
  toPrelockFindingLines,
  resolveRabLifecycleStatus,
  resolveProjectStatusLabel,
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
// RAB LIFECYCLE CONSISTENCY — PROJECT STATUS is not RAB STATUS
//
// Percobaan 1 is the case these tests exist for: a project still PLANNED whose
// RAB is LOCKED, with no approval and no baseline. Every surface used to read
// Project.status and announce an open draft.
// ─────────────────────────────────────────────────────────────────────────────

test("a PLANNED project with a LOCKED RAB reports the RAB as locked", () => {
  const view = resolveRabLifecycleStatus({
    reasonCode: "RAB_LOCKED",
    canEditDraft: false,
    approvedRabCount: 0,
    lockedRabCount: 1,
    workingDraftCount: 1,
    activeBaselineCount: 0,
  });

  assert.equal(view.rab, "LOCKED");
  assert.equal(view.rabLabel, "RAB Terkunci");
  assert.doesNotMatch(view.rabLabel, /draft/i);
  // LOCKED is not APPROVED, and neither is a baseline.
  assert.equal(view.approved, false);
  assert.equal(view.approvalLabel, "Belum disetujui");
  assert.equal(view.baseline, false);
  assert.equal(view.baselineLabel, "Belum ada baseline");
});

test("approval outranks a freeze, and a freeze outranks a working draft", () => {
  const approved = resolveRabLifecycleStatus({ approvedRabCount: 1, lockedRabCount: 1, workingDraftCount: 1 });
  assert.equal(approved.rab, "APPROVED");
  assert.equal(approved.approved, true);

  const locked = resolveRabLifecycleStatus({ approvedRabCount: 0, lockedRabCount: 1, workingDraftCount: 1 });
  assert.equal(locked.rab, "LOCKED");

  const draft = resolveRabLifecycleStatus({ approvedRabCount: 0, lockedRabCount: 0, workingDraftCount: 1 });
  assert.equal(draft.rab, "DRAFT");
});

test("no RAB document at all is stated as such, not as a draft", () => {
  const view = resolveRabLifecycleStatus({ approvedRabCount: 0, lockedRabCount: 0, workingDraftCount: 0 });
  assert.equal(view.rab, "NONE");
  assert.equal(view.rabLabel, "RAB Belum Dibuat");
});

test("absent lifecycle facts are reported as unknown — never defaulted to zero", () => {
  for (const absent of [undefined, null, {}]) {
    const view = resolveRabLifecycleStatus(absent);
    assert.equal(view.rab, "UNKNOWN", `expected UNKNOWN for ${JSON.stringify(absent)}`);
    assert.equal(view.approved, null);
    assert.equal(view.baseline, null);
    assert.doesNotMatch(view.rabLabel, /terkunci|disetujui/i);
  }
});

test("a baseline is reported beside the RAB state, never folded into it", () => {
  const view = resolveRabLifecycleStatus({ approvedRabCount: 0, lockedRabCount: 1, workingDraftCount: 0, activeBaselineCount: 1 });
  assert.equal(view.rab, "LOCKED");
  assert.equal(view.baseline, true);
  assert.equal(view.baselineLabel, "Baseline aktif");
});

test("the chip reuses the existing colour vocabulary only", () => {
  const allowed = ["approved", "terkunci", "draft"];
  const cases = [
    { approvedRabCount: 1 },
    { approvedRabCount: 0, lockedRabCount: 1 },
    { approvedRabCount: 0, lockedRabCount: 0, workingDraftCount: 1 },
    { approvedRabCount: 0, lockedRabCount: 0, workingDraftCount: 0 },
    undefined,
  ];
  for (const facts of cases) {
    assert.equal(allowed.includes(resolveRabLifecycleStatus(facts).chipModifier), true);
  }
});

test("a project is described in project words — 'Terkunci' belongs to a RAB", () => {
  assert.equal(resolveProjectStatusLabel("PLANNED"), "Perencanaan");
  assert.equal(resolveProjectStatusLabel("ACTIVE"), "Berjalan");
  assert.equal(resolveProjectStatusLabel("ON_HOLD"), "Ditahan");
  assert.equal(resolveProjectStatusLabel("COMPLETED"), "Selesai");
  assert.equal(resolveProjectStatusLabel("ARCHIVED"), "Arsip");
  // Unknown or missing is said plainly, not guessed into "Draft".
  assert.equal(resolveProjectStatusLabel(undefined), "Belum diketahui");
  assert.equal(resolveProjectStatusLabel("WHATEVER"), "Belum diketahui");
});
