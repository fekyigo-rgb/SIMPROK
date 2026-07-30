// RM02D2A2-REMEDIATION-02 — the single, production-used source of truth for
// what BasicPriceReviewDetailPage renders. Consumed by that page instead of
// its own inline `actionable && canVerify` branching, so the permission
// matrix lives in exactly one tested place.

export interface ReviewActionCapabilities {
  /** Whether the review's live state (slaState + submissionStatus) allows any decision at all. */
  actionable: boolean;
  /** BASIC_PRICE_REVIEW_VIEW — required even to read a review detail; the page is route-gated on it, but this stays an explicit input so the matrix is testable in isolation. */
  hasReviewView: boolean;
  /** BASIC_PRICE_VERIFY — required to accept/reject/reassign. */
  hasVerify: boolean;
}

export interface ReviewActionViewModel {
  /** Honest "you can view but not decide" message for a REVIEW_VIEW-only actor. */
  showReadOnlyMessage: boolean;
  /** Whether the accept/reject/reassign action area renders at all. */
  showActionArea: boolean;
  showAcceptAction: boolean;
  showRejectAction: boolean;
  showReassignAction: boolean;
  showReviewerSelector: boolean;
  /**
   * Whether the reviewer-candidates network call is structurally reachable
   * from this render — i.e. whether ReviewerSearchSelect is ever mounted.
   * This is a structural/reachability fact, not a runtime network count.
   */
  reviewerCandidatesRequestStructurallyAllowed: boolean;
}

export function computeReviewActionViewModel(
  capabilities: ReviewActionCapabilities,
): ReviewActionViewModel {
  const { actionable, hasReviewView, hasVerify } = capabilities;

  // Without BASIC_PRICE_REVIEW_VIEW there is no review door/detail-reading
  // capability at all — neither the action area NOR the read-only message
  // renders (matches the route gate: this page is unreachable without it).
  const showActionArea = hasReviewView && actionable && hasVerify;
  const showReadOnlyMessage = hasReviewView && actionable && !hasVerify;

  return {
    showReadOnlyMessage,
    showActionArea,
    showAcceptAction: showActionArea,
    showRejectAction: showActionArea,
    showReassignAction: showActionArea,
    showReviewerSelector: showActionArea,
    reviewerCandidatesRequestStructurallyAllowed: showActionArea,
  };
}
