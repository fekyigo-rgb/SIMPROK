import {
  evaluateBatchLifecycleActions,
  familyOffersCommunityCuration,
  privateUseBlockReason,
  proposalBlockReason,
  type BatchLifecycleFacts,
} from './basic-price-batch-actions.policy';
import { SOURCE_FAMILIES } from './basic-price-source-family.util';
import { PriceSourceOrigin } from '@prisma/client';

/**
 * THE LAW THAT REPLACED A SILENT BUTTON.
 *
 * The Owner pressed `Ajukan Batch (6 siap)` and nothing happened — no request,
 * no message, no navigation. The button was natively disabled, because the
 * frontend held its own copy of these preconditions and that copy could only
 * answer yes or no. A "no" with no reason inside it can only be rendered as a
 * dead control.
 *
 * So what these tests protect is not a decision. It is that every "no" carries
 * the reason a person needs, and that the reason is the SAME one the writer
 * would have thrown — checked against the services' own spec files.
 */

/** A batch with every precondition satisfied. Each test spoils exactly one. */
const lawful = (
  overrides: Partial<BatchLifecycleFacts> = {},
): BatchLifecycleFacts => ({
  status: 'READY_FOR_REVIEW',
  effectiveDate: new Date('2024-01-01T00:00:00.000Z'),
  regionId: 'region-01',
  sourceOrigin: 'FIELD_REPORT',
  sourceType: 'MARKET_SURVEY',
  readyForSubmissionRows: 6,
  ...overrides,
});

describe('privateUseBlockReason', () => {
  it('allows a fully described batch with at least one finished row', () => {
    expect(privateUseBlockReason(lawful())).toBeNull();
  });

  /**
   * THE ONE GATE THIS TASK WIDENED, and the whole reason the product had no
   * usable action. A batch reaches READY_FOR_REVIEW only when EVERY row is
   * decided, so requiring it here meant six finished rows out of eighty-six
   * could not be kept until the other eighty were finished too.
   */
  it('accepts a batch still NEEDS_REVIEW — finished rows do not wait for their neighbours', () => {
    expect(
      privateUseBlockReason(lawful({ status: 'NEEDS_REVIEW' })),
    ).toBeNull();
  });

  it('refuses a batch past its mutable window', () => {
    for (const status of [
      'PREVIEWED',
      'SUBMITTED',
      'PARTIALLY_SUBMITTED',
      'REJECTED',
      'SUPERSEDED',
    ]) {
      expect(privateUseBlockReason(lawful({ status }))).toBe(
        'BATCH_NOT_MUTABLE',
      );
    }
  });

  it('names each missing fact rather than failing generically', () => {
    expect(privateUseBlockReason(lawful({ effectiveDate: null }))).toBe(
      'EFFECTIVE_DATE_REQUIRED_BEFORE_PRIVATE_USE',
    );
    expect(privateUseBlockReason(lawful({ regionId: null }))).toBe(
      'REGION_REQUIRED_BEFORE_PRIVATE_USE',
    );
    expect(privateUseBlockReason(lawful({ sourceOrigin: null }))).toBe(
      'SOURCE_ORIGIN_REQUIRED_BEFORE_PRIVATE_USE',
    );
    expect(privateUseBlockReason(lawful({ sourceType: null }))).toBe(
      'SOURCE_TYPE_REQUIRED_BEFORE_PRIVATE_USE',
    );
    expect(privateUseBlockReason(lawful({ readyForSubmissionRows: 0 }))).toBe(
      'NO_ROWS_READY_FOR_PRIVATE_USE',
    );
  });

  /**
   * ORIGIN AND TYPE ARE INDEPENDENT AXES (Owner law,
   * BASIC-PRICE-MASTER-DECISION §10). This policy briefly refused pairs that
   * disagreed with SOURCE_TYPE_BY_ORIGIN, which made an ordinary document — a
   * market survey published BY a government agency — unrepresentable.
   *
   * What blocks is the fact SIMPROK was never told, never the fact it dislikes.
   */
  it('accepts every stated pair, and blocks only on silence', () => {
    for (const origin of [
      'GOVERNMENT',
      'SUPPLIER',
      'STORE',
      'DISTRIBUTOR',
      'FIELD_REPORT',
      'COMMUNITY_REPORT',
    ]) {
      for (const sourceType of [
        'VENDOR_QUOTE',
        'MARKET_SURVEY',
        'REGULATION',
        'SYSTEM_ESTIMATE',
      ]) {
        expect(
          privateUseBlockReason(lawful({ sourceOrigin: origin, sourceType })),
        ).toBeNull();
      }
    }
  });

  it('checks facts in the writer order, so one cause is named at a time', () => {
    // Everything is wrong at once; the FIRST cause is what a person is told.
    expect(
      privateUseBlockReason({
        status: 'READY_FOR_REVIEW',
        effectiveDate: null,
        regionId: null,
        sourceOrigin: null,
        sourceType: null,
        readyForSubmissionRows: 0,
      }),
    ).toBe('EFFECTIVE_DATE_REQUIRED_BEFORE_PRIVATE_USE');
  });
});

describe('proposalBlockReason', () => {
  it('allows a fully described, fully decided batch', () => {
    expect(proposalBlockReason(lawful())).toBeNull();
  });

  /**
   * THE GATE THAT MATCHES PRIVATE USE, for the same Owner law. Proposing
   * used to freeze the batch, so it required every row to have been decided.
   * Eligible rows do not depend on their neighbours: 16 READY_FOR_SUBMISSION
   * of 86 may be proposed while 70 remain NEEDS_REVIEW.
   */
  it('accepts a batch still NEEDS_REVIEW when finished rows are ready to propose', () => {
    expect(
      proposalBlockReason(lawful({ status: 'NEEDS_REVIEW' })),
    ).toBeNull();
  });

  it('still refuses a batch outside the review window', () => {
    expect(proposalBlockReason(lawful({ status: 'PREVIEWED' }))).toBe(
      'BATCH_NOT_READY_FOR_REVIEW',
    );
  });

  it('blocks when no row is ready, even if the batch is still open', () => {
    expect(
      proposalBlockReason(
        lawful({ status: 'NEEDS_REVIEW', readyForSubmissionRows: 0 }),
      ),
    ).toBe('NO_ROWS_READY_FOR_SUBMISSION');
  });

  it('names each missing fact rather than failing generically', () => {
    expect(proposalBlockReason(lawful({ effectiveDate: null }))).toBe(
      'EFFECTIVE_DATE_REQUIRED_BEFORE_SUBMISSION',
    );
    expect(proposalBlockReason(lawful({ regionId: null }))).toBe(
      'REGION_REQUIRED_BEFORE_SUBMISSION',
    );
    expect(proposalBlockReason(lawful({ sourceOrigin: null }))).toBe(
      'SOURCE_ORIGIN_REQUIRED_BEFORE_SUBMISSION',
    );
    expect(proposalBlockReason(lawful({ sourceType: null }))).toBe(
      'SOURCE_TYPE_REQUIRED_BEFORE_SUBMISSION',
    );
    expect(proposalBlockReason(lawful({ readyForSubmissionRows: 0 }))).toBe(
      'NO_ROWS_READY_FOR_SUBMISSION',
    );
  });

  /**
   * THE ROUTING IS A PRECONDITION, AND THAT IS THE POINT.
   *
   * It briefly lived only in the read projection: the review room hid this
   * action for government and supplier batches while POST :batchId/submit went
   * on accepting them. A rule the API contradicts is not a rule — it is a UI
   * decoration that holds exactly as long as a person goes through the screen.
   *
   * `submitBatch` consumes this function, so a family refused here is refused
   * at the write boundary.
   */
  it('refuses the curation door to the families it does not serve', () => {
    expect(
      proposalBlockReason(
        lawful({ sourceOrigin: 'GOVERNMENT', sourceType: 'REGULATION' }),
      ),
    ).toBe('SOURCE_FAMILY_NOT_ROUTED_TO_COMMUNITY_CURATION');
    for (const origin of ['SUPPLIER', 'STORE', 'DISTRIBUTOR']) {
      expect(
        proposalBlockReason(
          lawful({ sourceOrigin: origin, sourceType: 'VENDOR_QUOTE' }),
        ),
      ).toBe('SOURCE_FAMILY_NOT_ROUTED_TO_COMMUNITY_CURATION');
    }
    // And it DOES serve field/community — which is what this door is for.
    for (const origin of ['FIELD_REPORT', 'COMMUNITY_REPORT']) {
      expect(
        proposalBlockReason(
          lawful({ sourceOrigin: origin, sourceType: 'MARKET_SURVEY' }),
        ),
      ).toBeNull();
    }
  });
});

describe('source-policy routing', () => {
  /**
   * Owner law: an official government list and a supplier's own quote must not
   * be pushed through field-survey business curation merely because they are
   * Basic Prices. `PriceSubmissionReview` is exactly that curation.
   */
  it('routes only field/community prices to community curation', () => {
    expect(familyOffersCommunityCuration('FIELD_PRICE')).toBe(true);
    expect(familyOffersCommunityCuration('GOVERNMENT')).toBe(false);
    expect(familyOffersCommunityCuration('STORE_SUPPLIER')).toBe(false);
  });

  it('every declared family has a stated route — none is left undecided', () => {
    for (const family of SOURCE_FAMILIES) {
      expect(typeof familyOffersCommunityCuration(family)).toBe('boolean');
    }
  });

  it('states the route for every origin the schema defines', () => {
    for (const origin of Object.values(PriceSourceOrigin)) {
      const actions = evaluateBatchLifecycleActions(
        lawful({ sourceOrigin: origin, sourceType: null }),
      );
      expect(actions.simprokProposal.sourceFamily).not.toBeNull();
    }
  });
});

describe('evaluateBatchLifecycleActions', () => {
  /**
   * THE OWNER'S EXACT MOMENT: 86 rows, six finished, eighty still open, and a
   * fully described field-survey batch. Before this law the room offered one
   * button, and it was inert.
   */
  it('offers private use AND proposal on a part-finished batch', () => {
    const actions = evaluateBatchLifecycleActions(
      lawful({ status: 'NEEDS_REVIEW', readyForSubmissionRows: 6 }),
    );

    expect(actions.privateUse.offered).toBe(true);
    expect(actions.privateUse.reasonCode).toBeNull();

    expect(actions.simprokProposal.offered).toBe(true);
    expect(actions.simprokProposal.reasonCode).toBeNull();
    expect(actions.simprokProposal.sourceFamily).toBe('FIELD_PRICE');
  });

  it('does not offer community curation to a government batch, and says which family it is', () => {
    const actions = evaluateBatchLifecycleActions(
      lawful({ sourceOrigin: 'GOVERNMENT', sourceType: 'REGULATION' }),
    );

    // Private use is offered to EVERY family. Keeping your own lawful price is
    // not a claim about anyone else's knowledge.
    expect(actions.privateUse.offered).toBe(true);
    expect(actions.simprokProposal.offered).toBe(false);
    expect(actions.simprokProposal.reasonCode).toBe(
      'SOURCE_FAMILY_NOT_ROUTED_TO_COMMUNITY_CURATION',
    );
    expect(actions.simprokProposal.sourceFamily).toBe('GOVERNMENT');
  });

  it('does not offer community curation to a supplier batch either', () => {
    for (const origin of ['SUPPLIER', 'STORE', 'DISTRIBUTOR'] as const) {
      const actions = evaluateBatchLifecycleActions(
        lawful({ sourceOrigin: origin, sourceType: 'VENDOR_QUOTE' }),
      );
      expect(actions.simprokProposal.sourceFamily).toBe('STORE_SUPPLIER');
      expect(actions.simprokProposal.reasonCode).toBe(
        'SOURCE_FAMILY_NOT_ROUTED_TO_COMMUNITY_CURATION',
      );
      expect(actions.privateUse.offered).toBe(true);
    }
  });

  it('offers community curation to a community report', () => {
    const actions = evaluateBatchLifecycleActions(
      lawful({ sourceOrigin: 'COMMUNITY_REPORT', sourceType: 'MARKET_SURVEY' }),
    );
    expect(actions.simprokProposal.offered).toBe(true);
    expect(actions.simprokProposal.reasonCode).toBeNull();
  });

  it('reports an already-proposed batch as proposed, never as broken', () => {
    for (const status of [
      'APPROVED_FOR_SUBMISSION',
      'PARTIALLY_SUBMITTED',
      'SUBMITTED',
    ]) {
      const actions = evaluateBatchLifecycleActions(lawful({ status }));
      expect(actions.simprokProposal.reasonCode).toBe('ALREADY_PROPOSED');
      // And the batch is closed, so its rows can no longer be kept from here.
      expect(actions.privateUse.reasonCode).toBe('BATCH_NOT_MUTABLE');
    }
  });

  it('never reports an action as offered while also naming a reason', () => {
    const spoiled: Partial<BatchLifecycleFacts>[] = [
      {},
      { status: 'NEEDS_REVIEW' },
      { status: 'SUBMITTED' },
      { effectiveDate: null },
      { regionId: null },
      { sourceOrigin: null },
      { sourceType: null },
      { readyForSubmissionRows: 0 },
      { sourceOrigin: 'GOVERNMENT', sourceType: 'REGULATION' },
    ];
    for (const overrides of spoiled) {
      const actions = evaluateBatchLifecycleActions(lawful(overrides));
      expect(actions.privateUse.offered).toBe(
        actions.privateUse.reasonCode === null,
      );
      expect(actions.simprokProposal.offered).toBe(
        actions.simprokProposal.reasonCode === null,
      );
    }
  });
});
