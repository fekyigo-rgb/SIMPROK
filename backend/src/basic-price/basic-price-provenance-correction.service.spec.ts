import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { BasicPricePrivateAssetService } from './basic-price-private-asset.service';
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
    effectiveDate: new Date('2024-04-01T00:00:00.000Z'),
    sourceType: 'REGULATION',
    sourceOrigin: 'GOVERNMENT',
    uploadedByAccountId: ACTOR.accountId,
    sourcePeriodLabel: 'TA 2024',
    effectiveDateProvenance: 'DERIVED_FROM_SOURCE_PERIOD',
    effectiveDateDerivationRule: 'RM03D1_DOCUMENT_ISSUE_DATE',
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
      effectiveDateProvenance: 'DERIVED_FROM_SOURCE_PERIOD',
      effectiveDateDerivationRule: 'RM03D1_DOCUMENT_ISSUE_DATE',
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
      effectiveDate: '2024-04-01T00:00:00.000Z',
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
        effectiveDate: new Date('2024-04-01T00:00:00.000Z'),
        sourcePeriodLabel: 'TA 2024',
        effectiveDateProvenance: 'DERIVED_FROM_SOURCE_PERIOD',
        effectiveDateDerivationRule: 'RM03D1_DOCUMENT_ISSUE_DATE',
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

    await expect(correct()).rejects.toThrow('SOURCE_TYPE_REQUIRED_BEFORE_PROVENANCE_CORRECTION');
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
