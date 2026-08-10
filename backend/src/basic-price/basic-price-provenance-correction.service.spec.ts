import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  BasicPricePrivateAssetService,
  assertSourceClassificationCoherent,
  assertTemporalProvenanceCoherent,
  resolvePriceTemporalFacts,
  derivedEffectiveDateFor,
} from './basic-price-private-asset.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * RM-03D1 — TEMPORAL PROVENANCE TRUTH.
 *
 * The Ambon evidence states a PERIOD ("TA 2024") and never a day, but
 * BasicPrice.effectiveDate is NOT NULL, so an exact operational date must be
 * derived. Before this slice there was nowhere to record that the date was
 * derived, from what, or by which rule — so a derived 2024-01-01 was
 * indistinguishable from a date the workbook printed. And once `keep-private`
 * had copied the batch's metadata, nothing could lawfully correct it: the only
 * other writer of a BasicPrice is the publication ladder, which would stamp a
 * private asset PUBLISHED.
 *
 * These prove the correction can restate what a price CLAIMS, can never move
 * what it COSTS, and can never publish or verify anything.
 */
describe('BasicPricePrivateAssetService — provenance correction (RM-03D1)', () => {
  let service: BasicPricePrivateAssetService;
  let tx: any;
  let prisma: { $transaction: jest.Mock };

  const WORKSPACE = 'ws-01';
  const ORG = 'org-01';
  const BATCH = 'batch-01';
  const ACTOR = { workspaceId: WORKSPACE, accountId: 'actor-01' } as any;

  const batchRow = (over: Record<string, unknown> = {}) => ({
    id: BATCH,
    workspaceId: WORKSPACE,
    organizationId: ORG,
    status: 'READY_FOR_REVIEW',
    effectiveDate: new Date('2024-01-01T00:00:00.000Z'),
    sourceType: 'REGULATION',
    sourceOrigin: 'GOVERNMENT',
    uploadedByAccountId: ACTOR.accountId,
    sourcePeriodLabel: 'TA 2024',
    sourcePeriodGranularity: 'YEAR',
    effectiveDateProvenance: 'DERIVED_FROM_SOURCE_PERIOD',
    effectiveDateDerivationRule: 'PERIOD_START',
    ...over,
  });

  /** A price as keep-private originally wrote it: guessed type, bare date. */
  const priceRow = (over: Record<string, unknown> = {}) => ({
    id: 'price-01',
    value: '132000.00',
    effectiveDate: new Date('2024-01-01T00:00:00.000Z'),
    status: 'UNPUBLISHED',
    verificationStatus: 'UNVERIFIED',
    sourceType: 'MARKET_SURVEY',
    sourceOrigin: 'GOVERNMENT',
    sourcePeriodLabel: null,
    sourcePeriodGranularity: null,
    effectiveDateProvenance: null,
    effectiveDateDerivationRule: null,
    sourceImportRowId: 'row-01',
    createdAt: new Date('2026-08-08T00:00:00.000Z'),
    ...over,
  });

  let batch: any;
  let prices: any[];

  beforeEach(async () => {
    batch = batchRow();
    prices = [priceRow()];

    tx = {
      $queryRaw: jest.fn(async () => [batch]),
      workspace: { findUnique: jest.fn(async () => ({ organizationId: ORG })) },
      basicPrice: {
        findMany: jest.fn(async () => prices),
        update: jest.fn(async ({ where, data }: any) => ({
          ...prices.find((p) => p.id === where.id),
          ...data,
          resource: { id: 'r', code: null, name: 'Pekerja', type: 'LABOR' },
          region: { id: 'reg', code: '8171030', name: 'Baguala' },
        })),
      },
      basicPriceImportRow: { findUnique: jest.fn(async () => ({ effectiveDateOverride: null })) },
      basicPriceProvenanceCorrection: { create: jest.fn(async () => ({ id: 'corr-01' })) },
    };
    prisma = { $transaction: jest.fn((cb: any) => cb(tx)) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BasicPricePrivateAssetService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(BasicPricePrivateAssetService);
  });

  const correct = (reason = 'sourceType was an unsupported guess; period provenance was unrecordable') =>
    service.correctPrivateProvenanceFromBatch({ batchId: BATCH, actor: ACTOR, reason });

  it('1. corrects the price to the batch truth, and records before AND after so history survives', async () => {
    const result = await correct();

    expect(result.correctedCount).toBe(1);
    expect(tx.basicPrice.update).toHaveBeenCalledTimes(1);
    expect(tx.basicPrice.update.mock.calls[0][0].data).toMatchObject({
      sourceType: 'REGULATION',
      sourcePeriodLabel: 'TA 2024',
      sourcePeriodGranularity: 'YEAR',
      effectiveDateProvenance: 'DERIVED_FROM_SOURCE_PERIOD',
      effectiveDateDerivationRule: 'PERIOD_START',
    });

    const audit = tx.basicPriceProvenanceCorrection.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({ workspaceId: WORKSPACE, actorAccountId: ACTOR.accountId });
    // The claim SIMPROK made yesterday is still readable.
    expect(audit.before).toMatchObject({
      sourceType: 'MARKET_SURVEY',
      effectiveDateProvenance: null,
      effectiveDate: '2024-01-01T00:00:00.000Z',
    });
    expect(audit.after).toMatchObject({
      sourceType: 'REGULATION',
      effectiveDateProvenance: 'DERIVED_FROM_SOURCE_PERIOD',
      effectiveDate: '2024-01-01T00:00:00.000Z',
    });
    expect(audit.reason).toContain('unsupported guess');
  });

  it('2. A DERIVED DATE NEVER MASQUERADES AS SOURCE-STATED — the rule that produced it travels with it', async () => {
    await correct();

    const data = tx.basicPrice.update.mock.calls[0][0].data;
    expect(data.effectiveDateProvenance).toBe('DERIVED_FROM_SOURCE_PERIOD');
    expect(data.effectiveDateDerivationRule).toBeTruthy();
    // The source's own wording survives verbatim; it is never normalized away
    // into the date, which is the whole false-precision failure.
    expect(data.sourcePeriodLabel).toBe('TA 2024');
  });

  it('3. NEVER MOVES MONEY — value is not a correctable field', async () => {
    await correct();

    const data = tx.basicPrice.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('value');
  });

  it('4. NEVER PUBLISHES OR VERIFIES — the publication axes are not correctable', async () => {
    await correct();

    const data = tx.basicPrice.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('status');
    expect(data).not.toHaveProperty('verificationStatus');
    expect(data).not.toHaveProperty('assetScope');
  });

  it('5. never re-identifies or re-regions a price', async () => {
    await correct();

    const data = tx.basicPrice.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('resourceId');
    expect(data).not.toHaveProperty('regionId');
    expect(data).not.toHaveProperty('sourceImportRowId');
  });

  it('6. IDEMPOTENT — a second run with an unchanged batch writes nothing and leaves no audit row', async () => {
    prices = [
      priceRow({
        sourceType: 'REGULATION',
        effectiveDate: new Date('2024-01-01T00:00:00.000Z'),
        sourcePeriodLabel: 'TA 2024',
        sourcePeriodGranularity: 'YEAR',
        effectiveDateProvenance: 'DERIVED_FROM_SOURCE_PERIOD',
        effectiveDateDerivationRule: 'PERIOD_START',
      }),
    ];

    const result = await correct();

    expect(result.correctedCount).toBe(0);
    expect(result.unchangedCount).toBe(1);
    expect(tx.basicPrice.update).not.toHaveBeenCalled();
    expect(tx.basicPriceProvenanceCorrection.create).not.toHaveBeenCalled();
  });

  it('7. only this workspace OWN private prices from THIS batch are ever touched', async () => {
    await correct();

    expect(tx.basicPrice.findMany.mock.calls[0][0].where).toEqual({
      assetScope: 'WORKSPACE_PRIVATE',
      workspaceId: WORKSPACE,
      sourceImportRow: { batchId: BATCH },
    });
  });

  it('8. a foreign workspace corrects nothing, and reads as not-found', async () => {
    batch = batchRow({ workspaceId: 'ws-other' });

    await expect(correct()).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.basicPrice.update).not.toHaveBeenCalled();
  });

  it('9. a batch uploaded by someone else corrects nothing', async () => {
    batch = batchRow({ uploadedByAccountId: 'someone-else' });

    await expect(correct()).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.basicPrice.update).not.toHaveBeenCalled();
  });

  it('10. FAILS CLOSED when the batch cannot supply the facts — never defaults, never fabricates', async () => {
    batch = batchRow({ sourceType: null });

    // The same error code the create path raises: correction and creation now
    // share ONE coherence authority, so they cannot disagree about what
    // "truthful enough to write" means.
    await expect(correct()).rejects.toThrow('SOURCE_TYPE_REQUIRED_BEFORE_PRIVATE_USE');
    expect(tx.basicPrice.update).not.toHaveBeenCalled();
  });

  it('10b. a correction can never REINTRODUCE an incoherent classification', async () => {
    batch = batchRow({ sourceType: 'MARKET_SURVEY' });

    await expect(correct()).rejects.toThrow('SOURCE_ORIGIN_TYPE_INCOHERENT');
    expect(tx.basicPrice.update).not.toHaveBeenCalled();
    expect(tx.basicPriceProvenanceCorrection.create).not.toHaveBeenCalled();
  });

  it('10c. a correction can never propagate an incomplete derived provenance', async () => {
    batch = batchRow({ sourcePeriodGranularity: null });

    await expect(correct()).rejects.toThrow(
      'SOURCE_PERIOD_GRANULARITY_REQUIRED_FOR_DERIVED_DATE',
    );
    expect(tx.basicPrice.update).not.toHaveBeenCalled();
  });

  it('11. refuses to write into a price that is no longer private', async () => {
    prices = [priceRow({ status: 'PUBLISHED' })];

    await expect(correct()).rejects.toThrow('PRICE_NOT_PRIVATE_CORRECTABLE');
    expect(tx.basicPrice.update).not.toHaveBeenCalled();
  });

  it('12. a row-level effectiveDateOverride still wins, exactly as it does on the original write', async () => {
    tx.basicPriceImportRow.findUnique = jest.fn(async () => ({
      effectiveDateOverride: new Date('2024-06-15T00:00:00.000Z'),
    }));

    await correct();

    expect(tx.basicPrice.update.mock.calls[0][0].data.effectiveDate).toEqual(
      new Date('2024-06-15T00:00:00.000Z'),
    );
  });

  it('13. a batch with no private prices reports that honestly instead of silently succeeding', async () => {
    prices = [];

    await expect(correct()).rejects.toThrow('NO_PRIVATE_PRICE_TO_CORRECT');
  });
});

/**
 * RM-03D1 GAP-1 / GAP-2 — the two coherence rules, exercised directly.
 *
 * These are the guards that stop the corrected system from re-creating the
 * falsehood it was built to remove: a government price list classified as a
 * market survey, and a derived date with nothing to derive it from.
 */
describe('provenance coherence guards (RM-03D1)', () => {
  const derived = (over: Record<string, unknown> = {}) => ({
    sourceOrigin: 'GOVERNMENT',
    sourceType: 'REGULATION',
    sourcePeriodLabel: 'TA 2024',
    sourcePeriodGranularity: 'YEAR',
    effectiveDateProvenance: 'DERIVED_FROM_SOURCE_PERIOD',
    effectiveDateDerivationRule: 'PERIOD_START',
    ...over,
  });

  describe('source classification', () => {
    it('GOVERNMENT + REGULATION is the coherent government pair', () => {
      expect(() =>
        assertSourceClassificationCoherent('GOVERNMENT', 'REGULATION'),
      ).not.toThrow();
    });

    it('GOVERNMENT + MARKET_SURVEY is refused — the exact falsehood this slice removes', () => {
      const error = (() => {
        try {
          assertSourceClassificationCoherent('GOVERNMENT', 'MARKET_SURVEY');
          return null;
        } catch (e) {
          return e as any;
        }
      })();
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toMatchObject({
        message: 'SOURCE_ORIGIN_TYPE_INCOHERENT',
        sourceOrigin: 'GOVERNMENT',
        sourceType: 'MARKET_SURVEY',
        expectedSourceType: 'REGULATION',
      });
    });

    it('a MISSING sourceType fails closed — there is no default any more', () => {
      expect(() =>
        assertSourceClassificationCoherent('GOVERNMENT', null),
      ).toThrow('SOURCE_TYPE_REQUIRED_BEFORE_PRIVATE_USE');
    });

    it('a missing origin fails closed too', () => {
      expect(() =>
        assertSourceClassificationCoherent(null, 'REGULATION'),
      ).toThrow('SOURCE_ORIGIN_REQUIRED_BEFORE_PRIVATE_USE');
    });

    it('every other origin keeps its own coherent type', () => {
      expect(() => assertSourceClassificationCoherent('SUPPLIER', 'VENDOR_QUOTE')).not.toThrow();
      expect(() => assertSourceClassificationCoherent('FIELD_REPORT', 'MARKET_SURVEY')).not.toThrow();
      expect(() => assertSourceClassificationCoherent('SUPPLIER', 'REGULATION')).toThrow(
        'SOURCE_ORIGIN_TYPE_INCOHERENT',
      );
    });
  });

  describe('temporal provenance', () => {
    it('a fully-formed derived provenance is accepted', () => {
      expect(() => assertTemporalProvenanceCoherent(derived() as any)).not.toThrow();
    });

    it('DERIVED requires a period label', () => {
      expect(() =>
        assertTemporalProvenanceCoherent(derived({ sourcePeriodLabel: null }) as any),
      ).toThrow('SOURCE_PERIOD_LABEL_REQUIRED_FOR_DERIVED_DATE');
    });

    it('DERIVED requires a machine-readable granularity — a label alone is not one', () => {
      expect(() =>
        assertTemporalProvenanceCoherent(derived({ sourcePeriodGranularity: null }) as any),
      ).toThrow('SOURCE_PERIOD_GRANULARITY_REQUIRED_FOR_DERIVED_DATE');
    });

    it('DERIVED requires a named derivation rule', () => {
      expect(() =>
        assertTemporalProvenanceCoherent(derived({ effectiveDateDerivationRule: null }) as any),
      ).toThrow('DERIVATION_RULE_REQUIRED_FOR_DERIVED_DATE');
    });

    it('whitespace is not a period label, and not a rule', () => {
      expect(() =>
        assertTemporalProvenanceCoherent(derived({ sourcePeriodLabel: '   ' }) as any),
      ).toThrow('SOURCE_PERIOD_LABEL_REQUIRED_FOR_DERIVED_DATE');
      expect(() =>
        assertTemporalProvenanceCoherent(derived({ effectiveDateDerivationRule: '  \t ' }) as any),
      ).toThrow('DERIVATION_RULE_REQUIRED_FOR_DERIVED_DATE');
    });

    it('SOURCE_STATED forbids a derivation rule — nothing was derived', () => {
      expect(() =>
        assertTemporalProvenanceCoherent(
          derived({ effectiveDateProvenance: 'SOURCE_STATED' }) as any,
        ),
      ).toThrow('DERIVATION_RULE_FORBIDDEN_FOR_SOURCE_STATED');
    });

    it('SOURCE_STATED may still carry a period label — a document can print both', () => {
      expect(() =>
        assertTemporalProvenanceCoherent(
          derived({
            effectiveDateProvenance: 'SOURCE_STATED',
            effectiveDateDerivationRule: null,
          }) as any,
        ),
      ).not.toThrow();
    });

    it('UNKNOWN provenance stays legal, and is never read as SOURCE_STATED', () => {
      expect(() =>
        assertTemporalProvenanceCoherent({
          sourceOrigin: 'GOVERNMENT',
          sourceType: 'REGULATION',
          sourcePeriodLabel: null,
          sourcePeriodGranularity: null,
          effectiveDateProvenance: null,
          effectiveDateDerivationRule: null,
        } as any),
      ).not.toThrow();
    });

    it('a rule with no provenance claim is incoherent', () => {
      expect(() =>
        assertTemporalProvenanceCoherent(
          derived({ effectiveDateProvenance: null }) as any,
        ),
      ).toThrow('DERIVATION_RULE_REQUIRES_PROVENANCE');
    });

    it('THE LOCKED TA 2024 REPRESENTATION is exactly what the law prescribes', () => {
      // sourcePeriodLabel "TA 2024" · granularity YEAR · PERIOD_START ·
      // DERIVED_FROM_SOURCE_PERIOD. 2024-01-01 is SIMPROK's operational date,
      // never a date the workbook printed.
      expect(() =>
        assertTemporalProvenanceCoherent({
          sourceOrigin: 'GOVERNMENT',
          sourceType: 'REGULATION',
          sourcePeriodLabel: 'TA 2024',
          sourcePeriodGranularity: 'YEAR',
          effectiveDateProvenance: 'DERIVED_FROM_SOURCE_PERIOD',
          effectiveDateDerivationRule: 'PERIOD_START',
        } as any),
      ).not.toThrow();
    });
  });
});

/**
 * RM-03D1 FINAL CLOSURE — provenance must describe THE DATE THE PRICE CARRIES.
 *
 * `effectiveDate` follows a row-level override when one exists, but the
 * provenance columns were copied from the batch unconditionally. A row
 * overriding the date would still inherit "DERIVED_FROM_SOURCE_PERIOD by
 * PERIOD_START from TA 2024" — a derivation that does not produce that date.
 * Provenance for a DIFFERENT date is worse than no provenance at all.
 */
describe('resolvePriceTemporalFacts (RM-03D1)', () => {
  const batch = {
    effectiveDate: new Date('2024-01-01T00:00:00.000Z'),
    sourcePeriodLabel: 'TA 2024',
    sourcePeriodGranularity: 'YEAR',
    effectiveDateProvenance: 'DERIVED_FROM_SOURCE_PERIOD',
    effectiveDateDerivationRule: 'PERIOD_START',
  };

  it('without an override, the batch derivation explains the date and travels intact', () => {
    expect(resolvePriceTemporalFacts(batch, null)).toEqual({
      effectiveDate: batch.effectiveDate,
      sourcePeriodLabel: 'TA 2024',
      sourcePeriodGranularity: 'YEAR',
      effectiveDateProvenance: 'DERIVED_FROM_SOURCE_PERIOD',
      effectiveDateDerivationRule: 'PERIOD_START',
    });
  });

  it('WITH an override, the derivation no longer explains the date and is DROPPED', () => {
    const override = new Date('2024-06-15T00:00:00.000Z');
    const facts = resolvePriceTemporalFacts(batch, override);

    expect(facts.effectiveDate).toEqual(override);
    // The claim that would have been a lie.
    expect(facts.effectiveDateProvenance).toBeNull();
    expect(facts.effectiveDateDerivationRule).toBeNull();
  });

  it('but the SOURCE PERIOD survives an override — it is still what the document says', () => {
    const facts = resolvePriceTemporalFacts(batch, new Date('2024-06-15T00:00:00.000Z'));

    expect(facts.sourcePeriodLabel).toBe('TA 2024');
    expect(facts.sourcePeriodGranularity).toBe('YEAR');
  });

  it('a PERIOD_START derivation can never accompany a date that is not the period start', () => {
    // The invariant stated directly: if a rule is present, it came from the
    // batch, and the batch's own date is the one it explains.
    for (const override of [null, new Date('2024-06-15T00:00:00.000Z')]) {
      const facts = resolvePriceTemporalFacts(batch, override);
      if (facts.effectiveDateDerivationRule !== null) {
        expect(facts.effectiveDate).toEqual(batch.effectiveDate);
      }
    }
  });

  it('an UNKNOWN batch stays UNKNOWN either way — nothing is invented by resolving', () => {
    const unknown = {
      effectiveDate: new Date('2024-01-01T00:00:00.000Z'),
      sourcePeriodLabel: null,
      sourcePeriodGranularity: null,
      effectiveDateProvenance: null,
      effectiveDateDerivationRule: null,
    };
    expect(resolvePriceTemporalFacts(unknown, null).effectiveDateProvenance).toBeNull();
    expect(
      resolvePriceTemporalFacts(unknown, new Date('2024-06-15T00:00:00.000Z'))
        .effectiveDateProvenance,
    ).toBeNull();
  });
});

/**
 * RM-03D1 FINAL TEMPORAL CLOSURE — STRUCTURE IS NOT TRUTH.
 *
 * A provenance claim with every field populated can still be false. These pin
 * the one thing that makes it true: the stated derivation must actually produce
 * the date it describes.
 */
describe('derivedEffectiveDateFor — the derivation authority (RM-03D1)', () => {
  it('YEAR + PERIOD_START of "TA 2024" is 2024-01-01, and nothing else', () => {
    const derived = derivedEffectiveDateFor('TA 2024', 'YEAR', 'PERIOD_START');
    expect(derived?.toISOString()).toBe('2024-01-01T00:00:00.000Z');
  });

  it('reads the year out of the verbatim label rather than assuming it', () => {
    for (const label of ['TA 2024', '2024', 'Tahun Anggaran 2024', 'Basic Price TA 2024']) {
      expect(derivedEffectiveDateFor(label, 'YEAR', 'PERIOD_START')?.toISOString()).toBe(
        '2024-01-01T00:00:00.000Z',
      );
    }
  });

  it('a label with NO year is unprovable — null, never a guess', () => {
    expect(derivedEffectiveDateFor('Tahun Anggaran', 'YEAR', 'PERIOD_START')).toBeNull();
  });

  it('a label with SEVERAL years is ambiguous — null, never the first one', () => {
    expect(derivedEffectiveDateFor('TA 2023/2024', 'YEAR', 'PERIOD_START')).toBeNull();
  });

  it('an unknown rule or granularity is unprovable — no vocabulary is invented', () => {
    expect(derivedEffectiveDateFor('TA 2024', 'YEAR', 'END_OF_PERIOD')).toBeNull();
    expect(derivedEffectiveDateFor('TA 2024', 'MONTH' as any, 'PERIOD_START')).toBeNull();
  });
});

describe('assertTemporalProvenanceCoherent — derivation must explain the date', () => {
  const derived = (over: Record<string, unknown> = {}) => ({
    sourceOrigin: 'GOVERNMENT',
    sourceType: 'REGULATION',
    effectiveDate: new Date('2024-01-01T00:00:00.000Z'),
    sourcePeriodLabel: 'TA 2024',
    sourcePeriodGranularity: 'YEAR',
    effectiveDateProvenance: 'DERIVED_FROM_SOURCE_PERIOD',
    effectiveDateDerivationRule: 'PERIOD_START',
    ...over,
  });

  it('T5. the LOCKED representation is accepted: TA 2024 · YEAR · PERIOD_START · 2024-01-01', () => {
    expect(() => assertTemporalProvenanceCoherent(derived() as any)).not.toThrow();
  });

  it('T6. the SAME claim against 2024-06-15 FAILS CLOSED — every field filled, still false', () => {
    const error = (() => {
      try {
        assertTemporalProvenanceCoherent(
          derived({ effectiveDate: new Date('2024-06-15T00:00:00.000Z') }) as any,
        );
        return null;
      } catch (e) {
        return e as any;
      }
    })();
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({
      message: 'DERIVATION_DOES_NOT_EXPLAIN_EFFECTIVE_DATE',
      effectiveDate: '2024-06-15',
      derivedEffectiveDate: '2024-01-01',
    });
  });

  it('an UNPROVABLE derivation is refused rather than trusted', () => {
    expect(() =>
      assertTemporalProvenanceCoherent(
        derived({ sourcePeriodLabel: 'Tahun Anggaran' }) as any,
      ),
    ).toThrow('DERIVATION_RULE_NOT_PROVABLE');
  });

  it('SOURCE_STATED is never held to a derivation — it claims none', () => {
    expect(() =>
      assertTemporalProvenanceCoherent(
        derived({
          effectiveDate: new Date('2024-06-15T00:00:00.000Z'),
          effectiveDateProvenance: 'SOURCE_STATED',
          effectiveDateDerivationRule: null,
        }) as any,
      ),
    ).not.toThrow();
  });

  it('UNKNOWN is never held to a derivation either', () => {
    expect(() =>
      assertTemporalProvenanceCoherent(
        derived({
          effectiveDate: new Date('2024-06-15T00:00:00.000Z'),
          effectiveDateProvenance: null,
          effectiveDateDerivationRule: null,
        }) as any,
      ),
    ).not.toThrow();
  });

  it('with no date supplied the structural half still applies — an absent date proves nothing', () => {
    expect(() =>
      assertTemporalProvenanceCoherent(
        derived({ effectiveDate: null, sourcePeriodLabel: null }) as any,
      ),
    ).toThrow('SOURCE_PERIOD_LABEL_REQUIRED_FOR_DERIVED_DATE');
  });

  it('T11/T12. every shape the resolver can emit is coherent, so create and correction agree', () => {
    const batch = {
      effectiveDate: new Date('2024-01-01T00:00:00.000Z'),
      sourcePeriodLabel: 'TA 2024',
      sourcePeriodGranularity: 'YEAR',
      effectiveDateProvenance: 'DERIVED_FROM_SOURCE_PERIOD',
      effectiveDateDerivationRule: 'PERIOD_START',
    };
    for (const override of [null, new Date('2024-06-15T00:00:00.000Z')]) {
      const facts = resolvePriceTemporalFacts(batch, override);
      expect(() =>
        assertTemporalProvenanceCoherent({
          sourceOrigin: 'GOVERNMENT',
          sourceType: 'REGULATION',
          ...facts,
        } as any),
      ).not.toThrow();
    }
  });
});
