import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePermission } from "./capability.ts";

test("READY with the code present grants the permission", () => {
  assert.equal(evaluatePermission('READY', ['RAB_VIEW', 'RAB_DRAFT_EDIT'], 'RAB_VIEW'), true);
});

test("READY without the code present denies the permission", () => {
  assert.equal(evaluatePermission('READY', ['RAB_VIEW'], 'RAB_DRAFT_EDIT'), false);
});

test("IDLE always denies, even if the code would otherwise be present", () => {
  assert.equal(evaluatePermission('IDLE', ['RAB_VIEW'], 'RAB_VIEW'), false);
});

test("LOADING always denies — a fetch in flight is never treated as granted", () => {
  assert.equal(evaluatePermission('LOADING', ['RAB_VIEW'], 'RAB_VIEW'), false);
});

test("ERROR always denies, never silently falls back to empty-as-granted", () => {
  assert.equal(evaluatePermission('ERROR', ['RAB_VIEW'], 'RAB_VIEW'), false);
});

test("an empty permissions array denies every code while READY", () => {
  assert.equal(evaluatePermission('READY', [], 'PROJECT_CREATE'), false);
});
