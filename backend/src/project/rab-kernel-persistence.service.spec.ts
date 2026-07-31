import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RabKernelPersistenceService } from './rab-kernel-persistence.service';
import { RabLifecyclePolicyService } from './rab-lifecycle-policy.service';
import { BasicPriceEligibilityPolicy } from '../basic-price/basic-price-eligibility.policy';
import { RAB_KERNEL_PERSISTENCE_REASON } from './rab-kernel-persistence.contracts';
import { COST_CALCULATION_REASON } from './cost-kernel.contracts';

const PROJECT_ID = 'project-fixture';
const WORKSPACE_ID = 'workspace-fixture';
const STRUCTURE_ID = 'structure-fixture';
const BOQ_ITEM_ID = 'boq-item-fixture';
const AHSP_VERSION_ID = 'ahsp-version-fixture';
const OCCURRENCE_ID = 'occurrence-fixture';
const RESOLUTION_ID = 'resolution-fixture';
const BASIC_PRICE_ID = 'basic-price-fixture';
const SUBMISSION_ID = 'submission-fixture';
const REVIEW_ID = 'review-fixture';
const VERIFIER_USER_ID = 'verifier-user-fixture';
const VERIFIER_ACCOUNT_ID = 'verifier-account-fixture';
const PUBLISHER_ACCOUNT_ID = 'publisher-account-fixture';
const AS_OF_DATE = '2026-07-31';

/** One-resource fixture: coefficient 2 x price 100000.00 = 200000.00 unit price; volume 5 -> lineTotal 1000000.00. */
function buildResolution(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: RESOLUTION_ID,
    ahspResourceId: 'ahsp-resource-fixture',
    status: 'RESOLVED',
    selectedBasicPriceId: BASIC_PRICE_ID,
    sourcePriceValue: new Prisma.Decimal('100000.00'),
    adaptedPriceValue: new Prisma.Decimal('100000.00'),
    ahspCoefficient: new Prisma.Decimal('2.000000'),
    originalResource: { ahspVersionId: AHSP_VERSION_ID },
    ...overrides,
  };
}

function buildOccurrence(resolutions = [buildResolution()]) {
  return {
    id: OCCURRENCE_ID,
    projectId: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    ahspVersionId: AHSP_VERSION_ID,
    resourceResolutions: resolutions,
  };
}

function buildBoqItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: BOQ_ITEM_ID,
    boqStructureId: STRUCTURE_ID,
    itemType: 'WORK_ITEM',
    quantity: new Prisma.Decimal('5'),
    unit: 'M1',
    ahspVersionId: AHSP_VERSION_ID,
    unitPrice: null,
    lineTotal: null,
    ...overrides,
  };
}

function buildBasicPrice(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: BASIC_PRICE_ID,
    value: new Prisma.Decimal('100000.00'),
    effectiveDate: new Date('2026-01-01T00:00:00.000Z'),
    validUntil: null as Date | null,
    sourceSubmissionId: SUBMISSION_ID,
    ...overrides,
  };
}

/** Full traceable chain: submission -> review -> ACCEPT decision (verifier). Publisher identity comes from the separate publication-audit mock. */
function buildTraceableSubmission(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: SUBMISSION_ID,
    review: {
      id: REVIEW_ID,
      decisions: [{ decidedByUserId: VERIFIER_USER_ID }],
    },
    ...overrides,
  };
}

interface Fixture {
  occurrence?: ReturnType<typeof buildOccurrence> | null;
  occurrences?: ReturnType<typeof buildOccurrence>[];
  boqItem?: ReturnType<typeof buildBoqItem> | null;
  basicPrice?: ReturnType<typeof buildBasicPrice> | null;
  submission?: ReturnType<typeof buildTraceableSubmission> | null;
  verifierUser?: { membership: { accountId: string } | null } | null;
  publicationAudit?: { actorAccountId: string } | null;
  allItemsAfterUpdate?: unknown[];
  otherItems?: unknown[];
  existingRab?: unknown | null;
}

function createHarness(fixture: Fixture) {
  const boqItemUpdate = jest.fn().mockResolvedValue({});
  const rabDocumentUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
  const rabDocumentCreate = jest.fn().mockResolvedValue({});
  const rabDocumentFindFirst = jest
    .fn()
    .mockResolvedValue(fixture.existingRab ?? null);

  const tx = {
    $queryRaw: jest
      .fn()
      .mockResolvedValue([
        { id: PROJECT_ID, status: 'PLANNED', workspaceId: WORKSPACE_ID },
      ]),
    projectBaseline: { count: jest.fn().mockResolvedValue(0) },
    rabDocument: {
      count: jest.fn().mockResolvedValue(0),
      findFirst: rabDocumentFindFirst,
      updateMany: rabDocumentUpdateMany,
      create: rabDocumentCreate,
    },
    boqStructure: {
      count: jest.fn().mockResolvedValue(1),
      findFirst: jest.fn().mockResolvedValue({
        id: STRUCTURE_ID,
        projectId: PROJECT_ID,
        name: 'Working Draft',
        status: 'DRAFT',
      }),
    },
    boqItem: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          fixture.boqItem === undefined ? buildBoqItem() : fixture.boqItem,
        ),
      update: boqItemUpdate,
      // Two distinct call sites share this one mock, disambiguated by
      // `where.id` (only the §5.1 "every OTHER WORK_ITEM row" read excludes
      // the target by id): that call returns `otherItems` (default: empty,
      // i.e. this line is the only WORK_ITEM — always projected-complete).
      // The later full-row `computeSubtotal` read (no `id` filter) returns
      // `allItemsAfterUpdate`, defaulting to the one already-priced target
      // row as it would look immediately after its own update.
      findMany: jest.fn().mockImplementation((args: { where?: { id?: unknown } }) => {
        if (args?.where && 'id' in args.where) {
          return Promise.resolve(fixture.otherItems ?? []);
        }
        return Promise.resolve(
          fixture.allItemsAfterUpdate ?? [
            buildBoqItem({
              unitPrice: new Prisma.Decimal('200000.00'),
              lineTotal: new Prisma.Decimal('1000000.00'),
            }),
          ],
        );
      }),
    },
    aHSPVersion: {
      findUnique: jest.fn().mockResolvedValue({ id: AHSP_VERSION_ID, outputUnit: 'M1' }),
    },
    projectAhspOccurrence: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          fixture.occurrences ??
            (fixture.occurrence === undefined
              ? [buildOccurrence()]
              : fixture.occurrence
                ? [fixture.occurrence]
                : []),
        ),
    },
    basicPrice: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          fixture.basicPrice === undefined
            ? buildBasicPrice()
            : fixture.basicPrice,
        ),
    },
    priceSubmission: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          fixture.submission === undefined
            ? buildTraceableSubmission()
            : fixture.submission,
        ),
    },
    user: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          fixture.verifierUser === undefined
            ? { membership: { accountId: VERIFIER_ACCOUNT_ID } }
            : fixture.verifierUser,
        ),
    },
    basicPricePublicationAudit: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          fixture.publicationAudit === undefined
            ? { actorAccountId: PUBLISHER_ACCOUNT_ID }
            : fixture.publicationAudit,
        ),
    },
  };

  const prisma = {
    $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
  };

  const rabLifecyclePolicy = new RabLifecyclePolicyService(prisma as never);
  const eligibility = new BasicPriceEligibilityPolicy();
  const service = new RabKernelPersistenceService(
    prisma as never,
    rabLifecyclePolicy,
    eligibility,
  );

  return { service, tx, prisma, boqItemUpdate, rabDocumentUpdateMany, rabDocumentCreate };
}

/** Default: boqItem.findMany ("every other WORK_ITEM row") returns none — the target is the only line, always projected-complete. */
function withNoOtherItems(overrides: Fixture = {}): Fixture {
  return { otherItems: [], ...overrides };
}

const call = (service: RabKernelPersistenceService) =>
  service.persistBoqItemCalculation({
    projectId: PROJECT_ID,
    boqItemId: BOQ_ITEM_ID,
    workspaceId: WORKSPACE_ID,
    calculationAsOfDateRaw: AS_OF_DATE,
  });

describe('RabKernelPersistenceService', () => {
  it('persists a successful one-line complete DRAFT kernel calculation', async () => {
    const { service } = createHarness(withNoOtherItems());
    const result = await call(service);

    expect(result.unitPrice).toBe('200000.00');
    expect(result.lineTotal).toBe('1000000.00');
  });

  it('writes exact unitPrice and lineTotal onto the BoqItem row', async () => {
    const { service, boqItemUpdate } = createHarness(withNoOtherItems());
    await call(service);

    const writtenData = boqItemUpdate.mock.calls[0][0].data;
    expect(new Prisma.Decimal(writtenData.unitPrice).toFixed(2)).toBe('200000.00');
    expect(new Prisma.Decimal(writtenData.lineTotal).toFixed(2)).toBe('1000000.00');
  });

  it('persists full SERVER_COST_KERNEL provenance: origin, occurrence, as-of date, calculatedAt, policy version', async () => {
    const { service, boqItemUpdate } = createHarness(withNoOtherItems());
    const result = await call(service);

    const writtenData = boqItemUpdate.mock.calls[0][0].data;
    expect(writtenData.priceOrigin).toBe('SERVER_COST_KERNEL');
    expect(writtenData.calculationOccurrenceId).toBe(OCCURRENCE_ID);
    expect(writtenData.calculationAsOfDate.toISOString().slice(0, 10)).toBe(AS_OF_DATE);
    expect(writtenData.calculatedAt).toBeInstanceOf(Date);
    expect(typeof writtenData.calculationPolicyVersion).toBe('string');
    expect(result.priceOrigin).toBe('SERVER_COST_KERNEL');
    expect(result.calculationOccurrenceId).toBe(OCCURRENCE_ID);
  });

  it('accepts a current, date-valid, traceable BasicPrice', async () => {
    const { service } = createHarness(
      withNoOtherItems({
        basicPrice: buildBasicPrice({
          effectiveDate: new Date('2026-01-01T00:00:00.000Z'),
          validUntil: null,
        }),
      }),
    );
    await expect(call(service)).resolves.toBeDefined();
  });

  it('rejects a BasicPrice whose effectiveDate is after the calculation as-of date', async () => {
    const { service } = createHarness(
      withNoOtherItems({
        basicPrice: buildBasicPrice({ effectiveDate: new Date('2026-08-15T00:00:00.000Z') }),
      }),
    );
    await expect(call(service)).rejects.toMatchObject({
      message: RAB_KERNEL_PERSISTENCE_REASON.BASIC_PRICE_NOT_YET_EFFECTIVE,
    });
  });

  it('rejects a BasicPrice whose validUntil has already passed the as-of date', async () => {
    const { service } = createHarness(
      withNoOtherItems({
        basicPrice: buildBasicPrice({ validUntil: new Date('2026-06-30T00:00:00.000Z') }),
      }),
    );
    await expect(call(service)).rejects.toMatchObject({
      message: RAB_KERNEL_PERSISTENCE_REASON.BASIC_PRICE_EXPIRED,
    });
  });

  it('rejects an untraceable BasicPrice: no sourceSubmissionId', async () => {
    const { service } = createHarness(
      withNoOtherItems({ basicPrice: buildBasicPrice({ sourceSubmissionId: null }) }),
    );
    await expect(call(service)).rejects.toMatchObject({
      message: RAB_KERNEL_PERSISTENCE_REASON.BASIC_PRICE_PROVENANCE_INCOMPLETE,
    });
  });

  it('rejects an untraceable BasicPrice: submission exists but no ACCEPT review decision', async () => {
    const { service } = createHarness(
      withNoOtherItems({
        submission: buildTraceableSubmission({ review: { id: REVIEW_ID, decisions: [] } }),
      }),
    );
    await expect(call(service)).rejects.toMatchObject({
      message: RAB_KERNEL_PERSISTENCE_REASON.BASIC_PRICE_PROVENANCE_INCOMPLETE,
    });
  });

  it('rejects an untraceable BasicPrice: verifier identity cannot be resolved', async () => {
    const { service } = createHarness(withNoOtherItems({ verifierUser: null }));
    await expect(call(service)).rejects.toMatchObject({
      message: RAB_KERNEL_PERSISTENCE_REASON.BASIC_PRICE_PROVENANCE_INCOMPLETE,
    });
  });

  it('rejects an untraceable BasicPrice: no PUBLISH publication audit', async () => {
    const { service } = createHarness(withNoOtherItems({ publicationAudit: null }));
    await expect(call(service)).rejects.toMatchObject({
      message: RAB_KERNEL_PERSISTENCE_REASON.BASIC_PRICE_PROVENANCE_INCOMPLETE,
    });
  });

  it('rejects a PUBLISHED/PUBLISHED price whose verifier and publisher are the same identity', async () => {
    const { service } = createHarness(
      withNoOtherItems({ publicationAudit: { actorAccountId: VERIFIER_ACCOUNT_ID } }),
    );
    await expect(call(service)).rejects.toMatchObject({
      message: RAB_KERNEL_PERSISTENCE_REASON.BASIC_PRICE_PROVENANCE_INCOMPLETE,
    });
  });

  it('fails closed on an unresolved resource without touching money', async () => {
    const { service, boqItemUpdate } = createHarness(
      withNoOtherItems({
        occurrence: buildOccurrence([buildResolution({ status: 'NEEDS_REVIEW' })]),
      }),
    );
    await expect(call(service)).rejects.toMatchObject({
      message: RAB_KERNEL_PERSISTENCE_REASON.UNRESOLVED_RESOURCE,
    });
    expect(boqItemUpdate).not.toHaveBeenCalled();
  });

  it('fails closed on a resolved resource missing an adapted price', async () => {
    const { service, boqItemUpdate } = createHarness(
      withNoOtherItems({
        occurrence: buildOccurrence([buildResolution({ adaptedPriceValue: null })]),
      }),
    );
    await expect(call(service)).rejects.toMatchObject({
      message: RAB_KERNEL_PERSISTENCE_REASON.MISSING_ADAPTED_PRICE,
    });
    expect(boqItemUpdate).not.toHaveBeenCalled();
  });

  it('rejects a BasicPrice value that has drifted from the resolution snapshot', async () => {
    const { service } = createHarness(
      withNoOtherItems({ basicPrice: buildBasicPrice({ value: new Prisma.Decimal('999999.00') }) }),
    );
    await expect(call(service)).rejects.toMatchObject({
      message: RAB_KERNEL_PERSISTENCE_REASON.BASIC_PRICE_VALUE_DRIFTED,
    });
  });

  it('never accepts a client-supplied unitPrice or lineTotal — extra request fields cannot reach persistence', async () => {
    const { service, prisma, boqItemUpdate } = createHarness(withNoOtherItems());
    const tampered = {
      projectId: PROJECT_ID,
      boqItemId: BOQ_ITEM_ID,
      workspaceId: WORKSPACE_ID,
      calculationAsOfDateRaw: AS_OF_DATE,
      unitPrice: 1,
      lineTotal: 1,
    };
    await service.persistBoqItemCalculation(tampered as never);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const writtenData = boqItemUpdate.mock.calls[0][0].data;
    expect(new Prisma.Decimal(writtenData.unitPrice).toFixed(2)).toBe('200000.00');
    expect(new Prisma.Decimal(writtenData.lineTotal).toFixed(2)).toBe('1000000.00');
  });

  it('rejects RAB_TOTAL_INCOMPLETE and mutates nothing when another WORK_ITEM in the draft is still unpriced', async () => {
    const { service, boqItemUpdate, rabDocumentUpdateMany, rabDocumentCreate } = createHarness({
      otherItems: [{ itemType: 'WORK_ITEM', unitPrice: null }],
    });

    await expect(call(service)).rejects.toMatchObject({
      message: RAB_KERNEL_PERSISTENCE_REASON.RAB_TOTAL_INCOMPLETE,
    });
    expect(boqItemUpdate).not.toHaveBeenCalled();
    expect(rabDocumentUpdateMany).not.toHaveBeenCalled();
    expect(rabDocumentCreate).not.toHaveBeenCalled();
  });

  it('a FOLDER/NOTE row never blocks projected completeness (only WORK_ITEM rows count)', async () => {
    const { service } = createHarness({
      otherItems: [{ itemType: 'FOLDER', unitPrice: null }],
      allItemsAfterUpdate: [
        buildBoqItem({
          unitPrice: new Prisma.Decimal('200000.00'),
          lineTotal: new Prisma.Decimal('1000000.00'),
        }),
      ],
    });
    await expect(call(service)).resolves.toBeDefined();
  });

  it('writes exact complete RAB totals once the one-line draft is complete', async () => {
    const { service, rabDocumentCreate } = createHarness(
      withNoOtherItems({
        allItemsAfterUpdate: [
          buildBoqItem({
            unitPrice: new Prisma.Decimal('200000.00'),
            lineTotal: new Prisma.Decimal('1000000.00'),
          }),
        ],
      }),
    );

    const result = await call(service);

    expect(result.rabTotals.pricingStatus).toBe('COMPLETE');
    expect(result.rabTotals.totalBaseCost).toBe('1000000.00');
    // default margin 10% + tax 11% on (subtotal + margin): 1,000,000 + 100,000 = 1,100,000; +11% tax = 1,221,000.00
    expect(result.rabTotals.totalFinalCost).toBe('1221000.00');
    expect(rabDocumentCreate).toHaveBeenCalledTimes(1);
  });

  it('rolls back without any partial mutation when the RAB lifecycle blocks the draft', async () => {
    const { service, tx, boqItemUpdate, rabDocumentUpdateMany } = createHarness(withNoOtherItems());
    (tx.rabDocument.count as jest.Mock).mockResolvedValue(1); // APPROVED_RAB_EXISTS

    await expect(call(service)).rejects.toBeInstanceOf(ConflictException);
    expect(boqItemUpdate).not.toHaveBeenCalled();
    expect(rabDocumentUpdateMany).not.toHaveBeenCalled();
  });

  it('fails closed with NotFoundException when the BOQ item is not in the Working Draft — zero mutation', async () => {
    const { service, boqItemUpdate } = createHarness({ boqItem: null });
    await expect(call(service)).rejects.toBeInstanceOf(NotFoundException);
    expect(boqItemUpdate).not.toHaveBeenCalled();
  });

  it('reuses the existing Cost Kernel unit-mismatch reason unchanged', async () => {
    const { service } = createHarness(
      withNoOtherItems({ boqItem: buildBoqItem({ unit: 'Kg' }) }),
    );
    await expect(call(service)).rejects.toMatchObject({
      message: COST_CALCULATION_REASON.BOQ_AHSP_UNIT_MISMATCH,
    });
  });
});
