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
  lockedRabCount: 0,
});

const blockedLifecycle = (reasonCode: string): RabLifecycleProjection => ({
  canEnterEditableDraftWorkspace: false,
  canEditDraft: false,
  reasonCode,
  workingDraftCount: 0,
  activeBaselineCount: reasonCode === 'ACTIVE_BASELINE_EXISTS' ? 1 : 0,
  approvedRabCount: reasonCode === 'APPROVED_RAB_EXISTS' ? 1 : 0,
  lockedRabCount: reasonCode === 'RAB_LOCKED' ? 1 : 0,
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

// ─────────────────────────────────────────────────────────────────────────────
// RAB LIFECYCLE CONSISTENCY — the card must not overstate why a draft is shut
// ─────────────────────────────────────────────────────────────────────────────

test('a LOCKED RAB is reported as locked — never as approved, never as a baseline', () => {
  const action = primaryAction({ id: 'p7', status: 'draft', rabLifecycle: blockedLifecycle('RAB_LOCKED') });

  assert.equal(action.label, 'RAB Terkunci');
  assert.match(action.disabledReason ?? '', /dikunci/);
  // The old copy claimed baseline-or-approved for every blocked draft.
  assert.doesNotMatch(action.disabledReason ?? '', /baseline/i);
  assert.doesNotMatch(action.disabledReason ?? '', /disetujui/i);
});

test('each blocking reason states its own fact, and none borrows another\'s', () => {
  const reasonOf = (code: string) =>
    primaryAction({ id: 'p8', status: 'draft', rabLifecycle: blockedLifecycle(code) }).disabledReason ?? '';

  assert.match(reasonOf('ACTIVE_BASELINE_EXISTS'), /baseline aktif/i);
  assert.match(reasonOf('APPROVED_RAB_EXISTS'), /disetujui/i);
  assert.match(reasonOf('MULTIPLE_WORKING_DRAFTS'), /lebih dari satu draft/i);
  assert.match(reasonOf('PROJECT_NOT_DRAFT'), /tidak lagi berada pada tahap perencanaan/i);

  // A locked RAB must not be described with any other reason's words.
  const locked = reasonOf('RAB_LOCKED');
  assert.doesNotMatch(locked, /baseline/i);
  assert.doesNotMatch(locked, /lebih dari satu/i);
});

test('an unrecognised reason code is reported honestly, not guessed into a stronger claim', () => {
  const action = primaryAction({ id: 'p9', status: 'draft', rabLifecycle: blockedLifecycle('SOMETHING_NEW') });

  assert.equal(action.label, 'RAB Belum Dapat Diubah');
  assert.doesNotMatch(action.disabledReason ?? '', /baseline|disetujui|dikunci/i);
});
