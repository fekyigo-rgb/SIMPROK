import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBasicPriceSpaceViewModel } from './basicPriceSpaceViewModel.ts';

const NONE = { hasView: false, hasImport: false, hasReviewView: false, hasPublish: false };

test('1. no Basic Price capability at all: door hidden, space closed, nothing rendered', () => {
  const vm = computeBasicPriceSpaceViewModel(NONE);
  assert.equal(vm.showBasicPriceSidebarDoor, false);
  assert.equal(vm.canEnterBasicPriceSpace, false);
  assert.equal(vm.showExplorer, false);
  assert.equal(vm.showImportDoor, false);
  assert.equal(vm.showReviewDoor, false);
  assert.equal(vm.showPublicationDoor, false);
  assert.equal(vm.mayReachExplorerFetch, false);
});

test('2. BASIC_PRICE_VIEW: Explorer is primary content, fetch structurally reachable', () => {
  const vm = computeBasicPriceSpaceViewModel({ ...NONE, hasView: true });
  assert.equal(vm.showBasicPriceSidebarDoor, true);
  assert.equal(vm.canEnterBasicPriceSpace, true);
  assert.equal(vm.showExplorer, true);
  assert.equal(vm.mayReachExplorerFetch, true);
});

test('3. BASIC_PRICE_IMPORT without VIEW: import door only, Explorer never fetched', () => {
  const vm = computeBasicPriceSpaceViewModel({ ...NONE, hasImport: true });
  assert.equal(vm.showBasicPriceSidebarDoor, true);
  assert.equal(vm.canEnterBasicPriceSpace, true);
  assert.equal(vm.showExplorer, false);
  assert.equal(vm.showImportDoor, true);
  assert.equal(vm.mayReachExplorerFetch, false);
});

test('4. BASIC_PRICE_REVIEW_VIEW without VIEW: review door only, Explorer never fetched', () => {
  const vm = computeBasicPriceSpaceViewModel({ ...NONE, hasReviewView: true });
  assert.equal(vm.showBasicPriceSidebarDoor, true);
  assert.equal(vm.canEnterBasicPriceSpace, true);
  assert.equal(vm.showExplorer, false);
  assert.equal(vm.showReviewDoor, true);
  assert.equal(vm.mayReachExplorerFetch, false);
});

test('5. BASIC_PRICE_PUBLISH without VIEW: publication door only, Explorer never fetched', () => {
  const vm = computeBasicPriceSpaceViewModel({ ...NONE, hasPublish: true });
  assert.equal(vm.showBasicPriceSidebarDoor, true);
  assert.equal(vm.canEnterBasicPriceSpace, true);
  assert.equal(vm.showExplorer, false);
  assert.equal(vm.showPublicationDoor, true);
  assert.equal(vm.mayReachExplorerFetch, false);
});

test('6. BASIC_PRICE_VERIFY alone (not one of the four inputs) grants nothing', () => {
  // VERIFY is deliberately not a BasicPriceCapabilities field — a caller
  // that only has VERIFY passes all four booleans as false.
  const vm = computeBasicPriceSpaceViewModel(NONE);
  assert.equal(vm.showBasicPriceSidebarDoor, false);
  assert.equal(vm.showReviewDoor, false);
  assert.equal(vm.canEnterBasicPriceSpace, false);
});

test('7. VIEW-only ordinary user: Explorer only, no management doors', () => {
  const vm = computeBasicPriceSpaceViewModel({ ...NONE, hasView: true });
  assert.equal(vm.showExplorer, true);
  assert.equal(vm.showImportDoor, false);
  assert.equal(vm.showReviewDoor, false);
  assert.equal(vm.showPublicationDoor, false);
});

test('8. IMPORT + REVIEW_VIEW without VIEW: both secondary doors, no Explorer, no fetch', () => {
  const vm = computeBasicPriceSpaceViewModel({
    ...NONE,
    hasImport: true,
    hasReviewView: true,
  });
  assert.equal(vm.showExplorer, false);
  assert.equal(vm.showImportDoor, true);
  assert.equal(vm.showReviewDoor, true);
  assert.equal(vm.showPublicationDoor, false);
  assert.equal(vm.mayReachExplorerFetch, false);
});

test('9. PUBLISH + VIEW: Explorer primary, publication becomes a secondary management action', () => {
  const vm = computeBasicPriceSpaceViewModel({ ...NONE, hasView: true, hasPublish: true });
  assert.equal(vm.showExplorer, true);
  assert.equal(vm.showPublicationDoor, true);
  assert.equal(vm.mayReachExplorerFetch, true);
  assert.equal(vm.showManagementArea, true);
});

test('showManagementArea is only ever true alongside the Explorer, never as a substitute for it', () => {
  const importReviewOnly = computeBasicPriceSpaceViewModel({
    ...NONE,
    hasImport: true,
    hasReviewView: true,
  });
  assert.equal(importReviewOnly.showManagementArea, false);
  assert.equal(importReviewOnly.showCapabilityLanding, true);

  const viewOnly = computeBasicPriceSpaceViewModel({ ...NONE, hasView: true });
  assert.equal(viewOnly.showManagementArea, false);
  assert.equal(viewOnly.showCapabilityLanding, false);
});

test('showCapabilityLanding is true only when the space is enterable but Explorer is not shown', () => {
  assert.equal(computeBasicPriceSpaceViewModel(NONE).showCapabilityLanding, false);
  assert.equal(
    computeBasicPriceSpaceViewModel({ ...NONE, hasView: true }).showCapabilityLanding,
    false,
  );
  assert.equal(
    computeBasicPriceSpaceViewModel({ ...NONE, hasImport: true }).showCapabilityLanding,
    true,
  );
});
