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
  assert.equal(action.label, 'Mulai RAB');
  assert.equal(action.path, '/project/p1/rab/workspace');
});

test('PLANNED project with an existing Working Draft shows "Lanjutkan Draft"', () => {
  const project: ProjectCardActionInput = { id: 'p2', rabLifecycle: editableLifecycle(1) };

  const action = primaryAction(project);
  assert.equal(action.label, 'Lanjutkan Draft');
  assert.equal(action.path, '/project/p2/rab/workspace');
});

// ─────────────────────────────────────────────────────────────────────────────
// OWNER UI LAW — the lifecycle action slot is permanent, and never lies
//
// Four functions, four places: the project name opens Ruang Hidup RAB, the
// badge is status, this slot is the RAB's lifecycle action, and "Lihat Detail"
// opens Detail Proyek. The slot is never deleted because a later capability
// is unbuilt — it says so instead.
// ─────────────────────────────────────────────────────────────────────────────

test('the slot always exists — every lifecycle stage fills it with something', () => {
  const everyLifecycle = [
    editableLifecycle(0),
    editableLifecycle(1),
    ...['ACTIVE_BASELINE_EXISTS', 'APPROVED_RAB_EXISTS', 'RAB_LOCKED', 'MULTIPLE_WORKING_DRAFTS', 'PROJECT_NOT_DRAFT'].map(blockedLifecycle),
  ];

  for (const rabLifecycle of everyLifecycle) {
    const action = primaryAction({ id: 'p', rabLifecycle });
    assert.notEqual(action, null);
    assert.equal(typeof action.label, 'string');
    assert.notEqual(action.label.trim(), '');
  }

  // Even with no lifecycle facts at all, the slot is present and honest.
  const blind = primaryAction({ id: 'p' });
  assert.notEqual(blind.label.trim(), '');
  assert.equal(blind.path, undefined);
  assert.equal(typeof blind.disabledReason, 'string');
});

test('a LOCKED RAB gets a real door into its own working room, read-only', () => {
  const action = primaryAction({ id: 'p5', rabLifecycle: blockedLifecycle('RAB_LOCKED') });

  assert.equal(action.label, 'Buka Ruang Kerja');
  assert.equal(action.path, '/project/p5/rab/workspace');
  assert.equal(action.disabledReason, undefined);
  // Not a second way into the room the project name already opens.
  assert.notEqual(action.path, '/project/p5/rab');
  // Not an unlock: the label must not promise a capability that does not exist.
  assert.doesNotMatch(action.label, /buka kunci|reopen|approve|setuju/i);
});

test('stages whose machine is unbuilt hold the slot open and say so', () => {
  for (const reasonCode of ['APPROVED_RAB_EXISTS', 'ACTIVE_BASELINE_EXISTS', 'MULTIPLE_WORKING_DRAFTS', 'PROJECT_NOT_DRAFT']) {
    const action = primaryAction({ id: 'p6', rabLifecycle: blockedLifecycle(reasonCode) });

    assert.equal(action.path, undefined, `${reasonCode} must not navigate anywhere`);
    assert.equal(typeof action.disabledReason, 'string');
    assert.notEqual(action.disabledReason?.trim(), '');
  }
});

test('each waiting reason states its own fact, and none borrows another', () => {
  const reasonOf = (code: string) =>
    primaryAction({ id: 'p7', rabLifecycle: blockedLifecycle(code) }).disabledReason ?? '';

  assert.match(reasonOf('ACTIVE_BASELINE_EXISTS'), /baseline aktif/i);
  assert.match(reasonOf('APPROVED_RAB_EXISTS'), /disetujui/i);
  assert.match(reasonOf('MULTIPLE_WORKING_DRAFTS'), /lebih dari satu draft/i);
  assert.match(reasonOf('PROJECT_NOT_DRAFT'), /tidak lagi berada pada tahap perencanaan/i);

  assert.doesNotMatch(reasonOf('ACTIVE_BASELINE_EXISTS'), /disetujui/i);
  assert.doesNotMatch(reasonOf('APPROVED_RAB_EXISTS'), /baseline/i);
});

test('no unlock, approval, monitoring, revision or addendum control is ever offered', () => {
  const forbidden = /buka kunci|reopen|monitoring|progress|addendum|revisi|approve|setujui/i;
  const everyLifecycle = [
    editableLifecycle(0),
    editableLifecycle(1),
    ...['ACTIVE_BASELINE_EXISTS', 'APPROVED_RAB_EXISTS', 'RAB_LOCKED', 'MULTIPLE_WORKING_DRAFTS', 'PROJECT_NOT_DRAFT'].map(blockedLifecycle),
  ];

  for (const rabLifecycle of everyLifecycle) {
    assert.doesNotMatch(primaryAction({ id: 'p8', rabLifecycle }).label, forbidden);
  }
});

test('the slot never duplicates the status badge text', () => {
  // A dead button repeating the badge is what made the card read as two
  // controls for one fact.
  const badges = ['RAB Draft', 'RAB Terkunci', 'RAB Approved', 'Berjalan', 'Selesai', 'Menunggu Data'];
  const everyLifecycle = [
    editableLifecycle(0),
    editableLifecycle(1),
    ...['ACTIVE_BASELINE_EXISTS', 'APPROVED_RAB_EXISTS', 'RAB_LOCKED', 'MULTIPLE_WORKING_DRAFTS', 'PROJECT_NOT_DRAFT'].map(blockedLifecycle),
  ];

  for (const rabLifecycle of everyLifecycle) {
    const label = primaryAction({ id: 'p9', rabLifecycle }).label;
    assert.equal(badges.includes(label), false, `slot label "${label}" repeats a status badge`);
  }
});
