import assert from "node:assert/strict";
import test from "node:test";
import {
  RAB_APPROVAL_COPY,
  rabApprovalRefusalMessage,
  resolveRabApprovalDoor,
} from "./rabApprovalDisplay.ts";

// ─────────────────────────────────────────────────────────────────────────────
// PAB-03 — ONE HUMAN DECISION, AND AN HONEST DOOR AROUND IT
// ─────────────────────────────────────────────────────────────────────────────

test("A1: the configured holder of a locked RAB gets an open door", () => {
  const door = resolveRabApprovalDoor({
    rabStatus: "LOCKED",
    canApprove: true,
    blocker: null,
    authorizedPositions: [{ id: "p1", code: "PPK", name: "Pejabat Pembuat Komitmen" }],
  });

  assert.equal(door.visible, true);
  assert.equal(door.enabled, true);
  assert.equal(door.message, "");
});

test("A2: a governance gap is stated as a configuration fact, never as a denial of the reader", () => {
  const door = resolveRabApprovalDoor({
    rabStatus: "LOCKED",
    canApprove: false,
    blocker: "NO_CONFIGURED_AUTHORITY",
    authorizedPositions: [],
  });

  assert.equal(door.visible, true);
  assert.equal(door.enabled, false);
  assert.ok(door.message.includes("belum ada Jabatan yang memegang kewenangan"));
  // Nobody can be named — and the reader is still never asked to pick one.
  assert.equal(door.authorizedLabel, "");
  assert.ok(!door.message.toLowerCase().includes("pilih"));
});

test("A3: when the reader is not the holder, the door names WHO may act — from existing governance", () => {
  const door = resolveRabApprovalDoor({
    rabStatus: "LOCKED",
    canApprove: false,
    blocker: "ACTOR_IS_NOT_HOLDER",
    authorizedPositions: [
      { id: "p1", code: "PPK", name: "Pejabat Pembuat Komitmen" },
      { id: "p2", code: "KABID", name: "Kepala Bidang" },
    ],
  });

  assert.equal(door.enabled, false);
  assert.equal(
    door.authorizedLabel,
    "Kewenangan: Pejabat Pembuat Komitmen, Kepala Bidang",
  );
  assert.ok(!door.message.toLowerCase().includes("pilih"));
});

test("A4: a Position with no name falls back to its own code", () => {
  const door = resolveRabApprovalDoor({
    canApprove: false,
    blocker: "ACTOR_IS_NOT_HOLDER",
    authorizedPositions: [{ id: "p1", code: "KETUA", name: "  " }],
  });

  assert.equal(door.authorizedLabel, "Kewenangan: KETUA");
});

test("A5: once a baseline governs the project the door disappears entirely", () => {
  const door = resolveRabApprovalDoor({
    rabStatus: "APPROVED",
    canApprove: false,
    blocker: "ACTIVE_BASELINE_EXISTS",
    activeBaselineCount: 1,
  });

  assert.equal(door.visible, false);
  assert.equal(door.message, "");
});

test("A6: the approval card never repeats 'lock it first' — that act has its own door", () => {
  for (const blocker of [
    "RAB_NOT_LOCKED",
    "RAB_DOCUMENT_NOT_FOUND",
    "WORKING_DRAFT_NOT_FOUND",
  ]) {
    assert.equal(
      resolveRabApprovalDoor({ canApprove: false, blocker }).visible,
      false,
      blocker,
    );
  }
});

test("A7: before the server answers, the door says nothing at all", () => {
  assert.deepEqual(resolveRabApprovalDoor(null), {
    visible: false,
    enabled: false,
    message: "",
    authorizedLabel: "",
  });
  assert.equal(resolveRabApprovalDoor(undefined).visible, false);
});

test("A8: HUKUM PINTU — a closed door is grey and explained, never a full-colour door that lands nowhere", () => {
  const door = resolveRabApprovalDoor({
    canApprove: false,
    blocker: "PERMISSION_REQUIRED",
  });

  assert.equal(door.visible, true);
  assert.equal(door.enabled, false);
  assert.ok(door.message.length > 0);
});

test("A9: an unknown blocker is explained honestly instead of echoing the code", () => {
  const door = resolveRabApprovalDoor({
    canApprove: false,
    blocker: "SOMETHING_NEW_FROM_THE_SERVER",
  });

  assert.equal(door.message, "RAB belum dapat disetujui pada keadaan ini.");
  assert.ok(!door.message.includes("SOMETHING_NEW_FROM_THE_SERVER"));
});

test("A10: a command refusal reaches the Owner in their own words", () => {
  assert.ok(
    rabApprovalRefusalMessage("ACTIVE_BASELINE_EXISTS").includes(
      "baseline resmi yang aktif",
    ),
  );
  assert.ok(rabApprovalRefusalMessage("RAB_NOT_LOCKED").includes("dikunci"));
});

test("A11: an unknown refusal falls back to a plain sentence, and no reason code ever leaks", () => {
  assert.equal(rabApprovalRefusalMessage(undefined), RAB_APPROVAL_COPY.failed);
  assert.equal(rabApprovalRefusalMessage("WHATEVER"), RAB_APPROVAL_COPY.failed);
  assert.ok(
    !rabApprovalRefusalMessage("APPROVAL_MATRIX_VALUE_OUT_OF_BAND").includes(
      "APPROVAL_MATRIX",
    ),
  );
});
