import {
  evaluateBatchLifecycleActions,
  privateUseBlockReason,
  proposalBlockReason,
  regionScopeCompatibilityUnproven,
  type BatchLifecycleFacts,
} from './basic-price-batch-actions.policy';

/**
 * BP-REGION-TRUTH-07S §8/§9/§10 — WHAT SIMPROK DOES WITH AN UNRECONCILED
 * GEOGRAPHIC CLAIM.
 *
 * THE OWNER'S CASE, EXACTLY. The workbook says KECAMATAN over SIRIMAU, the
 * reviewer picked the SIRIMAU column, and the canonical Region on the batch is
 * "Kecamatan Teluk Ambon Baguala". SIMPROK holds no fact by which those are the
 * same place or different ones — `Region` is a flat code/name table — so it may
 * neither accept the pair silently nor reject it.
 *
 * These pins hold both halves of that: the pair is not save-ready, AND the
 * ordinary non-geographic import is not disturbed by the rule that governs it.
 */
describe('BP-REGION-TRUTH-07S — region scope compatibility gate', () => {
  const REGION_BAGUALA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const REGION_OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  /** A batch that is otherwise completely ready to be kept. */
  const readyFacts = (
    overrides: Partial<BatchLifecycleFacts> = {},
  ): BatchLifecycleFacts => ({
    status: 'NEEDS_REVIEW',
    effectiveDate: new Date('2026-08-28T00:00:00.000Z'),
    regionId: REGION_BAGUALA,
    sourceOrigin: 'GOVERNMENT_PUBLICATION',
    sourceType: 'REGULATION',
    readyForSubmissionRows: 3,
    ...overrides,
  });

  const ownerCase = (overrides: Partial<BatchLifecycleFacts> = {}) =>
    readyFacts({
      sourceRegionScopeLabel: 'SIRIMAU',
      sourceRegionScopeGeographicEvidence: 'KECAMATAN',
      ...overrides,
    });

  it('SOURCE-GEO-02: SIRIMAU under a canonical Baguala is NOT silently save-ready', () => {
    const facts = ownerCase();

    expect(regionScopeCompatibilityUnproven(facts)).toBe(true);
    expect(privateUseBlockReason(facts)).toBe(
      'REGION_SCOPE_COMPATIBILITY_UNCONFIRMED_BEFORE_PRIVATE_USE',
    );
    // The proposal door is refused in its OWN vocabulary — an unreconciled
    // geography must not reach SIMPROK's curation either.
    expect(proposalBlockReason(ownerCase({ status: 'READY_FOR_REVIEW' }))).toBe(
      'REGION_SCOPE_COMPATIBILITY_UNCONFIRMED_BEFORE_SUBMISSION',
    );
  });

  it('SOURCE-GEO-03: the review room stays OPEN, so safe work continues', () => {
    const actions = evaluateBatchLifecycleActions(ownerCase());

    // ONLY THE FINAL SAVE IS HELD. Row resolution, unit decisions and every
    // other piece of work in this batch remain reachable — the unresolved fact
    // is isolated, not turned into a wall in front of everything else.
    expect(actions.reviewGate.reviewAllowed).toBe(true);
    expect(actions.reviewGate.metadataComplete).toBe(true);
    expect(actions.privateUse.offered).toBe(false);
    // And the room is given the two facts it must show, plus the verdict —
    // which it never computes for itself.
    expect(actions.regionScope).toEqual({
      sourceLabel: 'SIRIMAU',
      geographicEvidence: 'KECAMATAN',
      confirmedRegionId: null,
      compatibilityUnproven: true,
    });
  });

  it('SOURCE-NONGEO-01: a non-geographic column choice raises nothing at all', () => {
    // The SAME shape of answer — a source scope label was chosen — but the
    // source wrote no region word, so there is no geography to reconcile.
    const facts = readyFacts({
      sourceRegionScopeLabel: 'GROSIR',
      sourceRegionScopeGeographicEvidence: null,
    });

    expect(regionScopeCompatibilityUnproven(facts)).toBe(false);
    expect(privateUseBlockReason(facts)).toBeNull();
    expect(
      evaluateBatchLifecycleActions(facts).regionScope.compatibilityUnproven,
    ).toBe(false);
  });

  it('a batch that carries neither fact is untouched — every import before this one', () => {
    const facts = readyFacts();

    expect(regionScopeCompatibilityUnproven(facts)).toBe(false);
    expect(privateUseBlockReason(facts)).toBeNull();
  });

  it('one confirmation clears it, and only for the Region it was given about', () => {
    const confirmed = ownerCase({
      regionScopeConfirmedRegionId: REGION_BAGUALA,
    });
    expect(regionScopeCompatibilityUnproven(confirmed)).toBe(false);
    expect(privateUseBlockReason(confirmed)).toBeNull();

    // MOVING THE REGION REOPENS THE QUESTION. A person who said "SIRIMAU goes
    // with Baguala" has said nothing whatsoever about anywhere else, and an
    // answer that slid onto a new region would be a falsehood with a signature
    // on it.
    const movedRegion = ownerCase({
      regionId: REGION_OTHER,
      regionScopeConfirmedRegionId: REGION_BAGUALA,
    });
    expect(regionScopeCompatibilityUnproven(movedRegion)).toBe(true);
    expect(privateUseBlockReason(movedRegion)).toBe(
      'REGION_SCOPE_COMPATIBILITY_UNCONFIRMED_BEFORE_PRIVATE_USE',
    );
  });

  it('the question is not asked before a Region exists', () => {
    // An absent Region is already reported as a missing required fact, in words
    // a person can act on. Asking them to reconcile an answer they have not
    // given yet would be noise on top of that.
    const noRegion = ownerCase({ regionId: null });

    expect(regionScopeCompatibilityUnproven(noRegion)).toBe(false);
    expect(privateUseBlockReason(noRegion)).toBe(
      'REGION_REQUIRED_BEFORE_PRIVATE_USE',
    );
  });

  it('a geographic source that offered only ONE place asks nothing', () => {
    // No scope question was ever put, so there is no second answer to
    // reconcile — even though the source is plainly about places.
    const singleScope = readyFacts({
      sourceRegionScopeLabel: null,
      sourceRegionScopeGeographicEvidence: 'WILAYAH',
    });

    expect(regionScopeCompatibilityUnproven(singleScope)).toBe(false);
    expect(privateUseBlockReason(singleScope)).toBeNull();
  });
});
