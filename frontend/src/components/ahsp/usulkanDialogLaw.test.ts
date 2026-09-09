import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * "Usulkan ke SIMPROK" confirms before it submits, everywhere. The dialog asks
 * with the Owner-locked words and [Batal]/[Ya, Usulkan]; confirming runs the
 * EXISTING propose lifecycle; cancelling submits nothing. ONE dialog, reused by
 * the room bulk action and the detail single action — no second engine, and the
 * dialog itself holds no propose endpoint of its own.
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

const dialog = codeOnly(readFileSync("src/components/ahsp/UsulkanSimprokDialog.tsx", "utf8"));
const room = codeOnly(readFileSync("src/pages/AhspRoomPage.tsx", "utf8"));
const detail = codeOnly(readFileSync("src/pages/AhspDetailPage.tsx", "utf8"));

test("the dialog is a real confirmation, worded from the locked copy, holding no endpoint", () => {
  assert.ok(dialog.includes('role="dialog"'));
  assert.ok(dialog.includes('aria-modal="true"'));
  for (const token of [
    "USULKAN_MODAL_TITLE",
    "USULKAN_MODAL_BODY_1",
    "USULKAN_MODAL_BODY_2",
    "USULKAN_CANCEL",
    "USULKAN_CONFIRM",
  ]) {
    assert.ok(dialog.includes(token), `dialog must render ${token}`);
  }
  // It only asks — it never proposes on its own.
  assert.ok(!dialog.includes("/propose"));
  assert.ok(!dialog.includes("apiFetch"));
});

test("the room bulk action shows the tooltip, confirms, then uses the existing propose route", () => {
  assert.ok(room.includes("UsulkanSimprokDialog"));
  assert.ok(room.includes("title={USULKAN_TOOLTIP}"));
  assert.ok(room.includes("setShowProposeConfirm(true)"));
  assert.ok(room.includes("'/ahsp/' + row.id + '/propose'"));
});

test("the detail single action shows the tooltip, confirms, then uses the existing propose route", () => {
  assert.ok(detail.includes("UsulkanSimprokDialog"));
  assert.ok(detail.includes("title={USULKAN_TOOLTIP}"));
  assert.ok(detail.includes("setShowProposeConfirm(true)"));
  assert.ok(detail.includes("'/ahsp/' + ahspId + '/propose'"));
});
