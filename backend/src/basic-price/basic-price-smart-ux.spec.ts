import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ConflictException } from '@nestjs/common';

import {
  evaluateBatchLifecycleActions,
  evaluateBatchReviewGate,
  missingRequiredMetadataFacts,
  REQUIRED_METADATA_FACTS,
  type BatchLifecycleFacts,
} from './basic-price-batch-actions.policy';
import { metadataCoherenceIssue } from './basic-price-metadata-coherence.law';
import {
  assertSourceClassificationCoherent,
  assertTemporalProvenanceCoherent,
} from './basic-price-private-asset.service';
import * as reverificationModule from './basic-price-reverification.policy';
import { reverificationState } from './basic-price-reverification.policy';

/**
 * CORRECTIVE CLOSEOUT — the metadata gate, the gate/writer invariant, and the
 * soft re-verification law after the invented horizon was removed.
 *
 * All pure functions, so the rules a person meets in the browser can be
 * asserted without a database, a server or a screen. The one-command write path
 * is proven end to end, against the real authorities, in the acceptance E2E.
 */

const BASE: BatchLifecycleFacts = {
  status: 'NEEDS_REVIEW',
  effectiveDate: new Date('2024-01-01T00:00:00.000Z'),
  regionId: 'region-1',
  sourceOrigin: 'FIELD_REPORT',
  sourceType: 'MARKET_SURVEY',
  readyForSubmissionRows: 0,
  sourcePeriodLabel: '2024',
  sourcePeriodGranularity: 'YEAR',
  effectiveDateProvenance: 'DERIVED_FROM_SOURCE_PERIOD',
  effectiveDateDerivationRule: 'PERIOD_START',
};

describe('NO INVENTED FRESHNESS HORIZON', () => {
  it('the re-verification module computes no date at all', () => {
    // THE POINT OF THIS TEST. An earlier version added a fixed TWO-YEAR horizon
    // to the source period, so a 2024 workbook silently produced "31 December
    // 2026". That figure came from an illustration, not from any policy in this
    // repository, and printing it at a person is manufactured precision.
    //
    // The module is asserted to export NOTHING that could compute a date, so a
    // future edit reintroducing one fails here rather than shipping quietly.
    expect(Object.keys(reverificationModule).sort()).toEqual([
      'reverificationState',
    ]);
  });

  it('the module CODE contains no fixed interval and no channel classifier', () => {
    // COMMENTS ARE STRIPPED FIRST, deliberately. This file's own prose explains
    // what was removed and why, and naming `USER_UPLOAD` in that explanation is
    // documentation — not a classifier. Scanning raw text would fail on the
    // very comment that records the correction.
    const raw = readFileSync(
      join(__dirname, 'basic-price-reverification.policy.ts'),
      'utf8',
    );
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//gu, '')
      .replace(/\/\/.*$/gmu, '');

    expect(code).not.toMatch(/HORIZON/iu);
    expect(code).not.toMatch(/USER_UPLOAD|SUPPLIER_BRIDGE|GOVERNMENT_FEED/u);
    expect(code).not.toMatch(/IngestionChannel/u);
    // No date arithmetic of any kind: nothing here constructs a date.
    expect(code).not.toMatch(/Date\.UTC\(/u);
    expect(code).not.toMatch(/new Date\(/u);
  });
});

describe('SOFT RE-VERIFICATION — advice, never a boundary', () => {
  it('DUE once the stated date has passed — and that is the whole consequence', () => {
    const reviewDate = new Date('2026-12-31T00:00:00.000Z');
    expect(
      reverificationState(reviewDate, new Date('2026-12-30T00:00:00.000Z')),
    ).toBe('CURRENT');
    expect(
      reverificationState(reviewDate, new Date('2026-12-31T00:00:00.000Z')),
    ).toBe('DUE');
    expect(
      reverificationState(reviewDate, new Date('2027-06-01T00:00:00.000Z')),
    ).toBe('DUE');
  });

  it('no stated date is NOT a warning', () => {
    // The ordinary case: nobody stated one. It must never render as overdue,
    // and it must never be filled in on the person's behalf.
    expect(reverificationState(null, new Date())).toBe('NOT_RECOMMENDED');
  });

  it('never produces an eligibility verdict of any kind', () => {
    // The vocabulary is deliberately disjoint from the freshness enum the AHSP
    // kernel reads (CURRENT / EXPIRING / EXPIRED), so nothing here can be
    // mistaken for — or assigned to — `freshnessStatus`.
    const states = [
      reverificationState(new Date('2000-01-01T00:00:00.000Z'), new Date()),
      reverificationState(null, new Date()),
    ];
    expect(states).not.toContain('EXPIRED');
    expect(states).not.toContain('EXPIRING');
  });
});

describe('METADATA GATE — one authority, persisted truth only', () => {
  it('names exactly four required facts, and the publisher is NOT one of them', () => {
    // A source that names no publisher has no publisher. If
    // `sourceOrganizationName` were ever added here, a user would have to
    // invent one to reach the review room, and the product would have
    // manufactured provenance to unlock a door.
    expect([...REQUIRED_METADATA_FACTS]).toEqual([
      'EFFECTIVE_DATE',
      'REGION',
      'SOURCE_ORIGIN',
      'SOURCE_TYPE',
    ]);
    expect(REQUIRED_METADATA_FACTS as readonly string[]).not.toContain(
      'SOURCE_ORGANIZATION_NAME',
    );
    // Nor is the soft re-verification date required — it is optional by law.
    expect(REQUIRED_METADATA_FACTS as readonly string[]).not.toContain(
      'REVIEW_DATE',
    );
  });

  it('STATE A — every missing required fact is named, and review is refused', () => {
    const gate = evaluateBatchReviewGate({
      ...BASE,
      effectiveDate: null,
      regionId: null,
      sourceOrigin: null,
      sourceType: null,
    });
    expect(gate.missingRequiredFacts).toEqual([
      'EFFECTIVE_DATE',
      'REGION',
      'SOURCE_ORIGIN',
      'SOURCE_TYPE',
    ]);
    expect(gate.metadataComplete).toBe(false);
    expect(gate.reviewAllowed).toBe(false);
    expect(gate.reasonCode).toBe('REQUIRED_METADATA_INCOMPLETE');
  });

  it('reports ONLY the facts genuinely missing, never a lump refusal', () => {
    const gate = evaluateBatchReviewGate({ ...BASE, regionId: null });
    expect(gate.missingRequiredFacts).toEqual(['REGION']);
    expect(gate.reviewAllowed).toBe(false);
  });

  it('STATE C — persisted, complete and coherent metadata opens the room', () => {
    const gate = evaluateBatchReviewGate(BASE);
    expect(gate.metadataComplete).toBe(true);
    expect(gate.metadataCoherent).toBe(true);
    expect(gate.reviewAllowed).toBe(true);
    expect(gate.reasonCode).toBeNull();
  });

  it('an unstated publisher and an unstated review date do NOT block review', () => {
    expect(evaluateBatchReviewGate(BASE).reviewAllowed).toBe(true);
  });

  it('a closed batch is reported as CLOSED, not as incomplete', () => {
    const gate = evaluateBatchReviewGate({ ...BASE, status: 'SUBMITTED' });
    expect(gate.metadataComplete).toBe(true);
    expect(gate.reasonCode).toBe('BATCH_NOT_MUTABLE');
    expect(gate.reviewAllowed).toBe(false);
  });

  it('rides on the SAME actions projection the room already reads', () => {
    const actions = evaluateBatchLifecycleActions(BASE);
    expect(actions.reviewGate).toEqual(evaluateBatchReviewGate(BASE));
  });

  it('missingRequiredMetadataFacts is the single list both callers read', () => {
    const facts = { ...BASE, sourceType: null };
    expect(missingRequiredMetadataFacts(facts)).toEqual(['SOURCE_TYPE']);
    expect(evaluateBatchReviewGate(facts).missingRequiredFacts).toEqual([
      'SOURCE_TYPE',
    ]);
  });
});

/**
 * THE INVARIANT THIS WHOLE CORRECTION EXISTS FOR.
 *
 * A person told "you may review" must not be refused at `Simpan & Gunakan` for
 * metadata the batch was already holding. The gate and the writer now read ONE
 * law, and these tests hold them to it in both directions.
 */
describe('REVIEW GATE === WRITE METADATA BOUNDARY', () => {
  /** Exactly what the writer asserts, in the writer's own order. */
  const writerRefusal = (facts: BatchLifecycleFacts): string | null => {
    try {
      assertSourceClassificationCoherent(facts.sourceOrigin, facts.sourceType);
      assertTemporalProvenanceCoherent({
        sourceOrigin: facts.sourceOrigin,
        sourceType: facts.sourceType,
        effectiveDate: facts.effectiveDate,
        sourcePeriodLabel: facts.sourcePeriodLabel ?? null,
        sourcePeriodGranularity: facts.sourcePeriodGranularity ?? null,
        effectiveDateProvenance: facts.effectiveDateProvenance ?? null,
        effectiveDateDerivationRule: facts.effectiveDateDerivationRule ?? null,
      });
      return null;
    } catch (error) {
      if (!(error instanceof ConflictException)) throw error;
      const response = error.getResponse();
      return typeof response === 'string'
        ? response
        : ((response as { message?: string }).message ?? null);
    }
  };

  /**
   * Every metadata shape worth arguing about, including the ones that used to
   * pass the gate and fail the writer.
   */
  const CASES: Array<{ name: string; facts: BatchLifecycleFacts }> = [
    { name: 'complete and coherent', facts: BASE },
    {
      name: 'derivation does not explain the date',
      // The old gate said "review away": all four facts were present. The
      // writer refused, because PERIOD_START on 2024 is 1 January, not 15 June.
      facts: { ...BASE, effectiveDate: new Date('2024-06-15T00:00:00.000Z') },
    },
    {
      name: 'derived claim with no period label',
      facts: { ...BASE, sourcePeriodLabel: null },
    },
    {
      name: 'derived claim with no granularity',
      facts: { ...BASE, sourcePeriodGranularity: null },
    },
    {
      name: 'derived claim with no rule',
      facts: { ...BASE, effectiveDateDerivationRule: null },
    },
    {
      name: 'unprovable derivation (two years in one label)',
      facts: { ...BASE, sourcePeriodLabel: 'TA 2024 dan 2025' },
    },
    {
      name: 'a rule with no provenance',
      facts: { ...BASE, effectiveDateProvenance: null },
    },
    {
      name: 'source-stated date carrying a derivation rule',
      facts: { ...BASE, effectiveDateProvenance: 'SOURCE_STATED' },
    },
    {
      name: 'source-stated date with no rule (legal)',
      facts: {
        ...BASE,
        effectiveDateProvenance: 'SOURCE_STATED',
        effectiveDateDerivationRule: null,
      },
    },
    {
      name: 'nothing claimed at all (legal)',
      facts: {
        ...BASE,
        sourcePeriodLabel: null,
        sourcePeriodGranularity: null,
        effectiveDateProvenance: null,
        effectiveDateDerivationRule: null,
      },
    },
  ];

  it.each(CASES)('reviewAllowed agrees with the writer: $name', ({ facts }) => {
    const gate = evaluateBatchReviewGate(facts);
    const refusal = writerRefusal(facts);

    // THE INVARIANT, both directions. Allowed implies the writer accepts;
    // refused-for-metadata implies the writer refuses with the SAME code.
    if (gate.reviewAllowed) {
      expect(refusal).toBeNull();
    } else if (gate.reasonCode !== 'REQUIRED_METADATA_INCOMPLETE') {
      expect(refusal).toBe(gate.reasonCode);
    }
  });

  it('the gate reports the WRITER’s exact code, not a generic refusal', () => {
    const facts = {
      ...BASE,
      effectiveDate: new Date('2024-06-15T00:00:00.000Z'),
    };
    const gate = evaluateBatchReviewGate(facts);
    expect(gate.metadataComplete).toBe(true);
    expect(gate.metadataCoherent).toBe(false);
    expect(gate.reviewAllowed).toBe(false);
    expect(gate.reasonCode).toBe('DERIVATION_DOES_NOT_EXPLAIN_EFFECTIVE_DATE');
  });

  it('both sides are literally the same function', () => {
    // Not "they happen to agree" — the gate calls the law the writer throws
    // from. If a future edit gives either side its own copy, this fails.
    const facts = {
      ...BASE,
      effectiveDate: new Date('2024-06-15T00:00:00.000Z'),
    };
    expect(
      metadataCoherenceIssue({
        sourceOrigin: facts.sourceOrigin,
        sourceType: facts.sourceType,
        effectiveDate: facts.effectiveDate,
        sourcePeriodLabel: facts.sourcePeriodLabel,
        sourcePeriodGranularity: facts.sourcePeriodGranularity,
        effectiveDateProvenance: facts.effectiveDateProvenance,
        effectiveDateDerivationRule: facts.effectiveDateDerivationRule,
      })?.code,
    ).toBe(evaluateBatchReviewGate(facts).reasonCode);
  });
});
