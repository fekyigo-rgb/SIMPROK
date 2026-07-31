import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeReviewActionViewModel } from './reviewActionViewModel.ts';

test('A. REVIEW_VIEW without VERIFY on an actionable review: read-only message, no action area, no reviewer-candidates reachability', () => {
  const vm = computeReviewActionViewModel({
    actionable: true,
    hasReviewView: true,
    hasVerify: false,
  });
  assert.equal(vm.showReadOnlyMessage, true);
  assert.equal(vm.showActionArea, false);
  assert.equal(vm.showAcceptAction, false);
  assert.equal(vm.showRejectAction, false);
  assert.equal(vm.showReassignAction, false);
  assert.equal(vm.showReviewerSelector, false);
  assert.equal(vm.reviewerCandidatesRequestStructurallyAllowed, false);
});

test('B. REVIEW_VIEW + VERIFY on an actionable review: full action area, reviewer-candidates reachable', () => {
  const vm = computeReviewActionViewModel({
    actionable: true,
    hasReviewView: true,
    hasVerify: true,
  });
  assert.equal(vm.showReadOnlyMessage, false);
  assert.equal(vm.showActionArea, true);
  assert.equal(vm.showAcceptAction, true);
  assert.equal(vm.showRejectAction, true);
  assert.equal(vm.showReassignAction, true);
  assert.equal(vm.showReviewerSelector, true);
  assert.equal(vm.reviewerCandidatesRequestStructurallyAllowed, true);
});

test('C. VERIFY without REVIEW_VIEW: no review door/detail-reading capability — neither action area nor read-only message', () => {
  const vm = computeReviewActionViewModel({
    actionable: true,
    hasReviewView: false,
    hasVerify: true,
  });
  assert.equal(vm.showActionArea, false);
  assert.equal(vm.showReadOnlyMessage, false);
  assert.equal(vm.reviewerCandidatesRequestStructurallyAllowed, false);
});

test('D. non-actionable/terminal review: VERIFY does not make it actionable, for either capability combination', () => {
  const verifierOnTerminal = computeReviewActionViewModel({
    actionable: false,
    hasReviewView: true,
    hasVerify: true,
  });
  assert.equal(verifierOnTerminal.showActionArea, false);
  assert.equal(verifierOnTerminal.showReadOnlyMessage, false);

  const viewerOnTerminal = computeReviewActionViewModel({
    actionable: false,
    hasReviewView: true,
    hasVerify: false,
  });
  assert.equal(viewerOnTerminal.showActionArea, false);
  assert.equal(viewerOnTerminal.showReadOnlyMessage, false);
});

test('neither hasReviewView nor hasVerify nor actionable: everything absent', () => {
  const vm = computeReviewActionViewModel({
    actionable: false,
    hasReviewView: false,
    hasVerify: false,
  });
  assert.equal(vm.showActionArea, false);
  assert.equal(vm.showReadOnlyMessage, false);
  assert.equal(vm.reviewerCandidatesRequestStructurallyAllowed, false);
});
