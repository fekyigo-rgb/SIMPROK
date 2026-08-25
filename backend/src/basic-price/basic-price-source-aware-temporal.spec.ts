import {
  actionablePrivateUseRows,
  evaluateBatchLifecycleActions,
  privateUseBlockReason,
  REQUIRED_METADATA_FACTS,
  type BatchLifecycleFacts,
} from './basic-price-batch-actions.policy';
import {
  batchTemporalQuestions,
  effectiveDateQuestionFor,
  reverificationApplicabilityFor,
} from './basic-price-temporal-question.law';

/**
 * SOURCE-AWARE TIME, AND A COUNT THAT MEANS WORK.
 *
 * Two laws, one file, because they are the same product mistake made twice:
 * asking every source the same question because the database has the same
 * column, and counting every ready row as pending because the projection could
 * not see that it was already stored.
 *
 * Both are pure functions with no database and no workbook, so they run on
 * every `npm test` — which is the point. The real 86-row acceptance suite
 * proves SIMPROK's intelligence and skips itself without the Owner's file;
 * these laws must hold everywhere, always.
 */

/* ── SOURCE-AWARE TEMPORAL QUESTION ──────────────────────────────────────── */

describe('WHICH TEMPORAL QUESTION IS TRUE FOR THIS SOURCE', () => {
  /**
   * The old form asked `Tanggal Berlaku` of everything. For a survey that is a
   * false claim: nobody decreed a start date, somebody OBSERVED a price.
   */
  it('a survey and a quotation are asked when the price was OBSERVED', () => {
    expect(effectiveDateQuestionFor('MARKET_SURVEY')).toBe(
      'OBSERVED_PRICE_DATE',
    );
    expect(effectiveDateQuestionFor('VENDOR_QUOTE')).toBe(
      'OBSERVED_PRICE_DATE',
    );
  });

  /**
   * And the one case the old label actually described stays exactly that: a
   * regulation really does name the day it begins, and that day may lawfully
   * be in the future.
   */
  it('a regulation is asked what the SOURCE ITSELF states as the start', () => {
    expect(effectiveDateQuestionFor('REGULATION')).toBe('SOURCE_STATED_START');
  });

  it('an unstated or estimated source gets the neutral question, never a guessed one', () => {
    expect(effectiveDateQuestionFor(null)).toBe('PRICE_DATE_UNSPECIFIED');
    expect(effectiveDateQuestionFor(undefined)).toBe('PRICE_DATE_UNSPECIFIED');
    expect(effectiveDateQuestionFor('SYSTEM_ESTIMATE')).toBe(
      'PRICE_DATE_UNSPECIFIED',
    );
    // A value this build has never heard of must not be folded into a sharper
    // claim just because it is unfamiliar.
    expect(effectiveDateQuestionFor('SOMETHING_NEW')).toBe(
      'PRICE_DATE_UNSPECIFIED',
    );
  });

  /**
   * THE DISTINCTION THAT MATTERS MOST. A government body running a price
   * survey has origin GOVERNMENT and type MARKET_SURVEY. Its date is an
   * observation, not a decree — so the question must follow the DOCUMENT KIND,
   * never who produced it.
   */
  it('WHO produced the price never decides the question — WHAT KIND of document does', () => {
    expect(
      batchTemporalQuestions({ sourceType: 'MARKET_SURVEY' })
        .effectiveDateQuestion,
    ).toBe('OBSERVED_PRICE_DATE');
    expect(
      batchTemporalQuestions({ sourceType: 'REGULATION' })
        .effectiveDateQuestion,
    ).toBe('SOURCE_STATED_START');
  });
});

describe('WHEN A SOFT RE-VERIFICATION DATE IS WORTH OFFERING', () => {
  it('an uploaded snapshot ages in silence, so a re-check date is recommended', () => {
    expect(reverificationApplicabilityFor('USER_UPLOAD')).toBe('RECOMMENDED');
    expect(reverificationApplicabilityFor('MOBILE')).toBe('RECOMMENDED');
  });

  /**
   * A live feed's freshness is a fact about actual synchronisation. Asking a
   * person to PREDICT when a machine-updated price goes stale manufactures
   * precision nobody has — the same invented horizon this codebase already
   * deleted once.
   */
  it('a live feed follows its own updates instead of a human prediction', () => {
    expect(reverificationApplicabilityFor('SUPPLIER_BRIDGE')).toBe(
      'FOLLOWS_SOURCE_UPDATES',
    );
    expect(reverificationApplicabilityFor('EXTERNAL_API')).toBe(
      'FOLLOWS_SOURCE_UPDATES',
    );
    expect(reverificationApplicabilityFor('GOVERNMENT_FEED')).toBe(
      'FOLLOWS_SOURCE_UPDATES',
    );
  });

  /**
   * SOURCE FAMILY IS NOT INGESTION CHANNEL. A supplier's price list emailed as
   * a spreadsheet and uploaded by hand is a snapshot, however "supplier" the
   * source is. Inferring SUPPLIER ⇒ LIVE is the exact conflation the law
   * forbids.
   */
  it('a supplier source uploaded by hand is still a snapshot', () => {
    expect(
      batchTemporalQuestions({
        sourceType: 'VENDOR_QUOTE',
        ingestionChannel: 'USER_UPLOAD',
      }).reverification,
    ).toBe('RECOMMENDED');
  });

  it('an unknown or absent channel keeps the optional field on offer', () => {
    expect(reverificationApplicabilityFor(null)).toBe('RECOMMENDED');
    expect(reverificationApplicabilityFor('A_CHANNEL_ADDED_LATER')).toBe(
      'RECOMMENDED',
    );
  });
});

/* ── WHAT REMAINS REQUIRED, AND WHAT NEVER BECAME REQUIRED ───────────────── */

const lawful = (
  overrides: Partial<BatchLifecycleFacts> = {},
): BatchLifecycleFacts => ({
  status: 'NEEDS_REVIEW',
  effectiveDate: new Date('2024-01-01T00:00:00.000Z'),
  regionId: 'region-01',
  sourceOrigin: 'FIELD_REPORT',
  sourceType: 'MARKET_SURVEY',
  readyForSubmissionRows: 13,
  ...overrides,
});

describe('ASKING A TRUER QUESTION IS NOT ASKING FEWER', () => {
  /**
   * A `BasicPrice` genuinely cannot exist without a calendar day to apply
   * from — the AHSP and Cost Kernel resolve candidates by it. So the required
   * set is untouched: what changed is the WORDING of one question, not whether
   * it must be answered.
   */
  it('the four required facts are exactly the four they were', () => {
    expect([...REQUIRED_METADATA_FACTS]).toEqual([
      'EFFECTIVE_DATE',
      'REGION',
      'SOURCE_ORIGIN',
      'SOURCE_TYPE',
    ]);
  });

  it('no temporal fact beyond the effective date was made mandatory', () => {
    // A survey batch with no re-verification date, no period label and no
    // provenance claim is fully lawful for private use.
    expect(privateUseBlockReason(lawful())).toBeNull();
  });

  it('a missing effective date still refuses, for every source kind alike', () => {
    for (const sourceType of ['MARKET_SURVEY', 'REGULATION', 'VENDOR_QUOTE']) {
      expect(
        privateUseBlockReason(lawful({ sourceType, effectiveDate: null })),
      ).toBe('EFFECTIVE_DATE_REQUIRED_BEFORE_PRIVATE_USE');
    }
  });
});

/* ── AN ACTION COUNT THAT MEANS ACTIONABLE WORK ──────────────────────────── */

describe('POST-SAVE TRUTH — a stored row is not new work', () => {
  it('before any save, every ready row is work one press would do', () => {
    const facts = lawful({ readyForSubmissionRows: 13, alreadyPrivateRows: 0 });
    expect(actionablePrivateUseRows(facts)).toBe(13);
    expect(privateUseBlockReason(facts)).toBeNull();
  });

  /** THE DEFECT, AS A UNIT LAW. */
  it('once all thirteen are stored, the action is no longer offered', () => {
    const facts = lawful({
      readyForSubmissionRows: 13,
      alreadyPrivateRows: 13,
    });
    expect(actionablePrivateUseRows(facts)).toBe(0);
    expect(privateUseBlockReason(facts)).toBe('ALL_READY_ROWS_ALREADY_PRIVATE');
  });

  it('a mixed batch counts only the rows not yet stored', () => {
    const facts = lawful({
      readyForSubmissionRows: 13,
      alreadyPrivateRows: 10,
    });
    expect(actionablePrivateUseRows(facts)).toBe(3);
    expect(privateUseBlockReason(facts)).toBeNull();
  });

  /**
   * "NOTHING IS FINISHED YET" AND "EVERYTHING FINISHED IS ALREADY STORED" ARE
   * OPPOSITE FACTS. They must never borrow each other's sentence, so the
   * already-stored rule sits strictly after the nothing-ready one.
   */
  it('an empty batch still says nothing is ready, never that everything is stored', () => {
    expect(
      privateUseBlockReason(
        lawful({ readyForSubmissionRows: 0, alreadyPrivateRows: 0 }),
      ),
    ).toBe('NO_ROWS_READY_FOR_PRIVATE_USE');
  });

  /**
   * AN UNMEASURED QUESTION MAY NOT BECOME A VERDICT. Preview, patch and submit
   * never pay for the private-price count, and on those paths the projection
   * must answer "not measured" rather than a zero that would be wrong by
   * exactly the number of prices that do exist.
   */
  it('a path that never measured says NULL, and reaches no already-stored verdict', () => {
    const facts = lawful({ readyForSubmissionRows: 13 });
    expect(facts.alreadyPrivateRows).toBeUndefined();
    expect(actionablePrivateUseRows(facts)).toBeNull();
    expect(privateUseBlockReason(facts)).toBeNull();

    expect(
      actionablePrivateUseRows(lawful({ alreadyPrivateRows: null })),
    ).toBeNull();
    expect(
      privateUseBlockReason(lawful({ alreadyPrivateRows: null })),
    ).toBeNull();
  });

  /**
   * A count can never go negative, however the two numbers drift — a batch
   * proposed to curation leaves READY_FOR_SUBMISSION while its prices remain.
   */
  it('more stored than ready is still zero work, never a negative count', () => {
    expect(
      actionablePrivateUseRows(
        lawful({ readyForSubmissionRows: 3, alreadyPrivateRows: 13 }),
      ),
    ).toBe(0);
  });

  it('the projection carries the count the room actually renders', () => {
    const actions = evaluateBatchLifecycleActions(
      lawful({ readyForSubmissionRows: 13, alreadyPrivateRows: 13 }),
    );
    expect(actions.privateUse).toMatchObject({
      offered: false,
      reasonCode: 'ALL_READY_ROWS_ALREADY_PRIVATE',
      actionableRows: 0,
    });

    const pending = evaluateBatchLifecycleActions(
      lawful({ readyForSubmissionRows: 13, alreadyPrivateRows: 3 }),
    );
    expect(pending.privateUse).toMatchObject({
      offered: true,
      reasonCode: null,
      actionableRows: 10,
    });
  });

  /**
   * THE ROOM'S CLARITY IS NOT THE SERVER'S SAFETY. `keepBatchPrivate` stays
   * idempotent whatever this says: a stale tab that presses anyway is still
   * answered with `alreadyPrivateCount` and creates no duplicate. The proof of
   * that lives in the command's own suites; what this pins is that the policy
   * only ever withholds an INVITATION.
   */
  it('withholding the invitation blocks no other lawful action', () => {
    const stored = lawful({
      readyForSubmissionRows: 13,
      alreadyPrivateRows: 13,
    });
    // The review room is still open and the batch is still mutable.
    const actions = evaluateBatchLifecycleActions(stored);
    expect(actions.reviewGate.reviewAllowed).toBe(true);
    // And the separate, optional curation door is judged on its own terms.
    expect(actions.simprokProposal.reasonCode).not.toBe(
      'ALL_READY_ROWS_ALREADY_PRIVATE',
    );
  });
});
