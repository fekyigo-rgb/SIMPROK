// RM02D2A2-REMEDIATION-02 — the single, production-used source of truth for
// Basic Price door/content visibility. Consumed by both the Sidebar (Basic
// Price item only) and the Basic Price space shell — neither is allowed to
// duplicate this matrix with its own ad-hoc permission logic.
//
// Inputs are already-resolved capability booleans (from AuthContext's
// fail-closed hasPermission/evaluatePermission — see utils/capability.ts).
// This module does not re-implement permission-state fail-closed evaluation;
// it only derives door/content decisions from capabilities already resolved
// upstream. BASIC_PRICE_VERIFY is deliberately not one of the four inputs:
// verify alone never grants entry to the Basic Price space (a verifier
// without BASIC_PRICE_REVIEW_VIEW cannot read the review queue or detail).

export interface BasicPriceCapabilities {
  hasView: boolean;
  hasImport: boolean;
  hasReviewView: boolean;
  hasPublish: boolean;
}

export interface BasicPriceSpaceViewModel {
  /** Whether the Sidebar shows the "Basic Price" entry at all. */
  showBasicPriceSidebarDoor: boolean;
  /** Whether a direct visit to /basic-price renders content instead of failing closed. */
  canEnterBasicPriceSpace: boolean;
  /** Explorer is the primary content — only for an actor with BASIC_PRICE_VIEW. */
  showExplorer: boolean;
  showImportDoor: boolean;
  showReviewDoor: boolean;
  showPublicationDoor: boolean;
  /** Secondary link cluster shown ALONGSIDE the Explorer (never a substitute for it). */
  showManagementArea: boolean;
  /** Primary content when the actor can enter the space but has no BASIC_PRICE_VIEW. */
  showCapabilityLanding: boolean;
  /** Whether the Explorer's GET /basic-prices fetch is structurally reachable. */
  mayReachExplorerFetch: boolean;
}

export function computeBasicPriceSpaceViewModel(
  capabilities: BasicPriceCapabilities,
): BasicPriceSpaceViewModel {
  const { hasView, hasImport, hasReviewView, hasPublish } = capabilities;
  const canEnter = hasView || hasImport || hasReviewView || hasPublish;
  const showExplorer = hasView;

  return {
    showBasicPriceSidebarDoor: canEnter,
    canEnterBasicPriceSpace: canEnter,
    showExplorer,
    showImportDoor: hasImport,
    showReviewDoor: hasReviewView,
    showPublicationDoor: hasPublish,
    showManagementArea: showExplorer && (hasReviewView || hasPublish),
    showCapabilityLanding: canEnter && !showExplorer,
    mayReachExplorerFetch: showExplorer,
  };
}
