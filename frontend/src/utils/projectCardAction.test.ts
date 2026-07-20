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
  workingDraftCount,
  activeBaselineCount: 0,
  approvedRabCount: 0,
});

const blockedLifecycle = (reasonCode: string): RabLifecycleProjection => ({
  canEnterEditableDraftWorkspace: false,
  canEditDraft: false,
  reasonCode,
  workingDraftCount: 0,
  activeBaselineCount: 0,
  approvedRabCount: 0,
});

test('PLANNED project with zero Working Draft shows "Mulai RAB"', () => {
  const project: ProjectCardActionInput = {
    id: 'p1',
    status: 'draft', // 'draft' is the PLANNED-status chip mapping
    rabLifecycle: editableLifecycle(0),
  };
  const action = primaryAction(project);
  assert.equal(action.label, 'Mulai RAB');
  assert.equal(action.path, '/project/p1/rab/workspace');
});

test('PLANNED project with exactly one Working Draft shows "Lanjutkan Draft"', () => {
  const project: ProjectCardActionInput = {
    id: 'p2',
    status: 'draft',
    rabLifecycle: editableLifecycle(1),
  };
  const action = primaryAction(project);
  assert.equal(action.label, 'Lanjutkan Draft');
  assert.equal(action.path, '/project/p2/rab/workspace');
});

test('non-editable projects never show "Mulai RAB" or "Lanjutkan Draft", regardless of Project.status', () => {
  const editableLabels = ['Mulai RAB', 'Lanjutkan Draft'];
  const statuses: ProjectCardActionInput['status'][] = ['draft', 'terkunci', 'approved', 'berjalan', 'selesai'];
  const reasonCodes = ['ACTIVE_BASELINE_EXISTS', 'APPROVED_RAB_EXISTS', 'MULTIPLE_WORKING_DRAFTS', 'PROJECT_NOT_DRAFT'];

  let checked = 0;
  for (const status of statuses) {
    for (const reasonCode of reasonCodes) {
      const action = primaryAction({ id: 'blocked', status, rabLifecycle: blockedLifecycle(reasonCode) });
      assert.equal(editableLabels.includes(action.label), false, `status=${status} reasonCode=${reasonCode} unexpectedly showed "${action.label}"`);
      checked += 1;
    }
  }
  assert.equal(checked, statuses.length * reasonCodes.length);
});

test('missing rabLifecycle (e.g. backend projection absent) fails closed — no editable label, no path assumed editable', () => {
  const action = primaryAction({ id: 'p3', status: 'draft' });
  assert.equal(['Mulai RAB', 'Lanjutkan Draft'].includes(action.label), false);
});

test('blocked project falls back to the Project.status-driven informational label, never an editable one', () => {
  assert.equal(primaryAction({ id: 'p4', status: 'terkunci', rabLifecycle: blockedLifecycle('PROJECT_NOT_DRAFT') }).label, 'Buka Kunci');
  assert.equal(primaryAction({ id: 'p5', status: 'berjalan', rabLifecycle: blockedLifecycle('PROJECT_NOT_DRAFT') }).label, 'Progress HOLD');
  assert.equal(primaryAction({ id: 'p6', status: 'selesai', rabLifecycle: blockedLifecycle('PROJECT_NOT_DRAFT') }).label, 'Lihat Arsip');
});
