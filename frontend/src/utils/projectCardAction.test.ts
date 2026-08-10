import assert from "node:assert/strict";
import test from "node:test";
import {
  primaryAction,
  type ProjectCardActionInput,
  type RabLifecycleProjection,
} from "./projectCardAction.ts";

const editableLifecycle = (workingDraftCount: number): RabLifecycleProjection => ({
  canEnterEditableDraftWorkspace: true,
  canEditDraft: true,
  reasonCode: null,
  projectStatus: 'PLANNED',
  workingDraftCount,
  activeBaselineCount: 0,
  approvedRabCount: 0,
  lockedRabCount: 0,
});

const blockedLifecycle = (reasonCode: string): RabLifecycleProjection => ({
  canEnterEditableDraftWorkspace: false,
  canEditDraft: false,
  reasonCode,
  projectStatus: 'PLANNED',
  workingDraftCount: 0,
  activeBaselineCount: reasonCode === 'ACTIVE_BASELINE_EXISTS' ? 1 : 0,
  approvedRabCount: reasonCode === 'APPROVED_RAB_EXISTS' ? 1 : 0,
  lockedRabCount: reasonCode === 'RAB_LOCKED' ? 1 : 0,
});

test('PLANNED project with zero Working Draft shows "Mulai RAB"', () => {
  const project: ProjectCardActionInput = { id: 'p1', rabLifecycle: editableLifecycle(0) };

  const action = primaryAction(project);
  assert.equal(action?.label, 'Mulai RAB');
  assert.equal(action?.path, '/project/p1/rab/workspace');
});

test('PLANNED project with an existing Working Draft shows "Lanjutkan Draft"', () => {
  const project: ProjectCardActionInput = { id: 'p2', rabLifecycle: editableLifecycle(1) };

  const action = primaryAction(project);
  assert.equal(action?.label, 'Lanjutkan Draft');
  assert.equal(action?.path, '/project/p2/rab/workspace');
});

// ─────────────────────────────────────────────────────────────────────────────
// OWNER PRODUCT LAW — a status badge is information, never a fake control
// ─────────────────────────────────────────────────────────────────────────────

test('when nothing lawful can be done, the card offers no action at all', () => {
  const reasonCodes = [
    'ACTIVE_BASELINE_EXISTS',
    'APPROVED_RAB_EXISTS',
    'RAB_LOCKED',
    'MULTIPLE_WORKING_DRAFTS',
    'PROJECT_NOT_DRAFT',
  ];

  for (const reasonCode of reasonCodes) {
    assert.equal(
      primaryAction({ id: 'blocked', rabLifecycle: blockedLifecycle(reasonCode) }),
      null,
      `reasonCode=${reasonCode} should offer no action`,
    );
  }
});

test('no unlock, monitoring, progress or archive control is ever offered', () => {
  // These labels were produced from Project.status for capabilities that do
  // not exist. Nothing may bring them back.
  const forbidden = ['Buka Kunci', 'Monitoring HOLD', 'Progress HOLD', 'Lihat Arsip', 'RAB Terkunci'];
  const everyLifecycle = [
    editableLifecycle(0),
    editableLifecycle(1),
    ...['ACTIVE_BASELINE_EXISTS', 'APPROVED_RAB_EXISTS', 'RAB_LOCKED', 'MULTIPLE_WORKING_DRAFTS', 'PROJECT_NOT_DRAFT'].map(blockedLifecycle),
  ];

  for (const rabLifecycle of everyLifecycle) {
    const label = primaryAction({ id: 'p', rabLifecycle })?.label;
    if (label === undefined) continue;
    assert.equal(forbidden.includes(label), false, `unexpectedly offered "${label}"`);
  }
});

test('missing rabLifecycle fails closed — no action is assumed to be open', () => {
  assert.equal(primaryAction({ id: 'p3' }), null);
});

test('an action, when offered, always carries a real path', () => {
  for (const count of [0, 1, 5]) {
    const action = primaryAction({ id: 'p4', rabLifecycle: editableLifecycle(count) });
    assert.equal(typeof action?.path, 'string');
    assert.notEqual(action?.path, '');
  }
});
