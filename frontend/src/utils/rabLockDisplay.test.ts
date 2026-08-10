import assert from "node:assert/strict";
import test from "node:test";
import {
  RAB_LOCK_COPY,
  resolveRabWorkspacePresentation,
  toPrelockFindingLines,
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
