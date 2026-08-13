import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RabKernelPersistenceService } from './rab-kernel-persistence.service';
import { RabLifecyclePolicyService } from './rab-lifecycle-policy.service';
import { BasicPriceEligibilityPolicy } from '../basic-price/basic-price-eligibility.policy';
import { RAB_KERNEL_PERSISTENCE_REASON } from './rab-kernel-persistence.contracts';
import { COST_CALCULATION_REASON } from './cost-kernel.contracts';

const PROJECT_ID = 'project-fixture';
const WORKSPACE_ID = 'workspace-fixture';
const OTHER_WORKSPACE_ID = 'other-workspace-fixture';
const ORGANIZATION_ID = 'organization-fixture';
const OTHER_ORGANIZATION_ID = 'other-organization-fixture';
const STRUCTURE_ID = 'structure-fixture';
const BOQ_ITEM_ID = 'boq-item-fixture';
const AHSP_VERSION_ID = 'ahsp-version-fixture';
const OCCURRENCE_ID = 'occurrence-fixture';
const RESOLUTION_ID = 'resolution-fixture';
const BASIC_PRICE_ID = 'basic-price-fixture';
const RESOURCE_CATALOG_ID = 'resource-catalog-fixture';
const OTHER_RESOURCE_CATALOG_ID = 'other-resource-catalog-fixture';
const SUBMISSION_ID = 'submission-fixture';
const IMPORT_ROW_ID = 'import-row-fixture';
const REVIEW_ID = 'review-fixture';
const VERIFIER_USER_ID = 'verifier-user-fixture';
const VERIFIER_ACCOUNT_ID = 'verifier-account-fixture';
const PUBLISHER_ACCOUNT_ID = 'publisher-account-fixture';
const AS_OF_DATE = '2026-07-31';
const REGION_ID = 'region-fixture';

/** One-resource fixture: coefficient 2 x price 100000.00 = 200000.00 unit price; volume 5 -> lineTotal 1000000.00. */
function buildResolution(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: RESOLUTION_ID,
    ahspResourceId: 'ahsp-resource-fixture',
    status: 'RESOLVED',
    resourceCatalogId: RESOURCE_CATALOG_ID,
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
    businessPricingAsOfDate: new Date(`${AS_OF_DATE}T00:00:00.000Z`),
    referenceRegionId: REGION_ID,
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
    workingOccurrenceId: OCCURRENCE_ID,
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
    assetScope: 'SIMPROK_CATALOG',
    sourceSubmissionId: SUBMISSION_ID,
    sourceImportRowId: null as string | null,
    resourceId: RESOURCE_CATALOG_ID,
    workspaceId: WORKSPACE_ID,
    organizationId: ORGANIZATION_ID,
    regionId: REGION_ID,
    ...overrides,
  };
}

/**
 * RM-03C — the same price, owned privately by this workspace. It has NO
 * submission (and must not), and its only evidence is the import row.
 */
function buildPrivateBasicPrice(overrides: Partial<Record<string, unknown>> = {}) {
  return buildBasicPrice({
    assetScope: 'WORKSPACE_PRIVATE',
    sourceSubmissionId: null,
    sourceImportRowId: IMPORT_ROW_ID,
    ...overrides,
  });
}

/**
 * RM-03C — the private provenance chain: a human-resolved import row bound to
 * the same resource, inside a batch bound to the same tenant and region, with
 * the real workbook hash, source origin and effective date on it.
 */
function buildTraceableImportRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    resourceCatalogId: RESOURCE_CATALOG_ID,
    resolutionStatus: 'RESOLVED',
    batch: {
      workspaceId: WORKSPACE_ID,
      organizationId: ORGANIZATION_ID,
      regionId: REGION_ID,
      effectiveDate: new Date('2026-01-01T00:00:00.000Z'),
      sourceOrigin: 'STORE',
      sourceSha256: 'a'.repeat(64),
    },
    ...overrides,
  };
}

/**
 * Full traceable chain: submission (bound to the exact resource/workspace/
 * organization) -> review (same workspace/organization) -> ACCEPT decision
 * (verifier). Publisher identity comes from the separate publication-audit
 * mock.
 */
function buildTraceableSubmission(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: SUBMISSION_ID,
    resourceId: RESOURCE_CATALOG_ID,
    workspaceId: WORKSPACE_ID,
    organizationId: ORGANIZATION_ID,
    review: {
      id: REVIEW_ID,
      workspaceId: WORKSPACE_ID,
      organizationId: ORGANIZATION_ID,
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
  importRow?: ReturnType<typeof buildTraceableImportRow> | null;
  verifierUser?: { membership: { accountId: string; workspaceId: string } | null } | null;
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
      findFirst: jest
        .fn()
        .mockResolvedValue(
          fixture.occurrences?.[0] ??
            (fixture.occurrence === undefined ? buildOccurrence() : fixture.occurrence),
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
    basicPriceImportRow: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          fixture.importRow === undefined
            ? buildTraceableImportRow()
            : fixture.importRow,
        ),
    },
    user: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          fixture.verifierUser === undefined
            ? { membership: { accountId: VERIFIER_ACCOUNT_ID, workspaceId: WORKSPACE_ID } }
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
        submission: buildTraceableSubmission({
          review: { id: REVIEW_ID, workspaceId: WORKSPACE_ID, organizationId: ORGANIZATION_ID, decisions: [] },
        }),
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

  it('B-06: rejects a PUBLISHED/PUBLISHED price whose verifier and publisher are the same identity', async () => {
    const { service } = createHarness(
      withNoOtherItems({ publicationAudit: { actorAccountId: VERIFIER_ACCOUNT_ID } }),
    );
    await expect(call(service)).rejects.toMatchObject({
      message: RAB_KERNEL_PERSISTENCE_REASON.BASIC_PRICE_PROVENANCE_INCOMPLETE,
    });
  });

  it('B-07: a legitimate historical publisher/verifier Account is valid provenance even though this read never checks their CURRENT status', async () => {
    // Neither the verifierUser nor publicationAudit mocks below carry any
    // ACTIVE/status field at all — assertTraceableProvenance only proves
    // the Account ids resolve and differ, exactly as required. If this
    // method ever started re-authorizing historical actors, a suspended
    // fixture would need a status flag to pass; it does not.
    const { service } = createHarness(
      withNoOtherItems({
        verifierUser: { membership: { accountId: VERIFIER_ACCOUNT_ID, workspaceId: WORKSPACE_ID } },
        publicationAudit: { actorAccountId: PUBLISHER_ACCOUNT_ID },
      }),
    );
    await expect(call(service)).resolves.toBeDefined();
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

  /**
   * CONTINUE SAFELY ON WORKFLOW — the sibling's fact is not this line's verdict.
   *
   * This line's own evidence is complete, so its money is proven and is
   * written. Another WORK_ITEM in the draft is not priced yet, so the SECTION
   * total is not a fact anyone can state — and it is written as NULL rather
   * than as a sum of the part that happens to be provable.
   *
   * The earlier law refused the whole command here. That made one genuinely
   * unresolvable row destroy every healthy row in the section, which inverts
   * the locked law: fail closed on the FACT, continue safely on the WORKFLOW.
   */
  it('persists THIS line and withholds only the SECTION total when another WORK_ITEM is still unpriced', async () => {
    const { service, boqItemUpdate, rabDocumentUpdateMany } = createHarness({
      otherItems: [{ itemType: 'WORK_ITEM', unitPrice: null }],
    });

    const result = await call(service);

    // The line's own money is proven, and therefore persisted.
    expect(result).toMatchObject({
      unitPrice: '200000.00',
      lineTotal: '1000000.00',
      priceOrigin: 'SERVER_COST_KERNEL',
    });
    const written = boqItemUpdate.mock.calls[0][0].data;
    expect(new Prisma.Decimal(written.unitPrice).toFixed(2)).toBe('200000.00');
    expect(new Prisma.Decimal(written.lineTotal).toFixed(2)).toBe('1000000.00');
    expect(written.priceOrigin).toBe('SERVER_COST_KERNEL');

    // The section total is withheld — NULL, never a partial sum.
    expect(result.rabTotals).toEqual({
      pricingStatus: 'INCOMPLETE',
      totalBaseCost: null,
      totalFinalCost: null,
    });
    const rabData = rabDocumentUpdateMany.mock.calls[0][0].data;
    expect(rabData.totalBaseCost).toBeNull();
    expect(rabData.totalFinalCost).toBeNull();
  });

  /**
   * The guarantee that must NOT move: a line whose OWN evidence is incomplete
   * still fails closed and writes nothing. Only a SIBLING's incompleteness
   * stopped being this line's verdict.
   */
  it('still fails closed, writing nothing, when THIS line’s own resource is unresolved and a sibling is unpriced too', async () => {
    const { service, boqItemUpdate, rabDocumentUpdateMany, rabDocumentCreate } =
      createHarness({
        otherItems: [{ itemType: 'WORK_ITEM', unitPrice: null }],
        occurrence: buildOccurrence([
          buildResolution({ status: 'NEEDS_REVIEW' }),
        ]),
      });

    await expect(call(service)).rejects.toMatchObject({
      message: RAB_KERNEL_PERSISTENCE_REASON.UNRESOLVED_RESOURCE,
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

  it('writes exact complete RAB totals once the one-line draft is complete (C-05)', async () => {
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

  describe('§PR57 Gap A — resource identity must match', () => {
    it('A-01: resolution.resourceCatalogId=null fails closed with zero mutation', async () => {
      const { service, boqItemUpdate, rabDocumentUpdateMany, rabDocumentCreate } = createHarness(
        withNoOtherItems({
          occurrence: buildOccurrence([buildResolution({ resourceCatalogId: null })]),
        }),
      );
      await expect(call(service)).rejects.toMatchObject({
        message: RAB_KERNEL_PERSISTENCE_REASON.BASIC_PRICE_RESOURCE_IDENTITY_MISMATCH,
      });
      expect(boqItemUpdate).not.toHaveBeenCalled();
      expect(rabDocumentUpdateMany).not.toHaveBeenCalled();
      expect(rabDocumentCreate).not.toHaveBeenCalled();
    });

    it('A-02: BasicPrice.resourceId != resolution.resourceCatalogId fails closed with zero mutation', async () => {
      const { service, boqItemUpdate, rabDocumentUpdateMany, rabDocumentCreate } = createHarness(
        withNoOtherItems({
          basicPrice: buildBasicPrice({ resourceId: OTHER_RESOURCE_CATALOG_ID }),
        }),
      );
      await expect(call(service)).rejects.toMatchObject({
        message: RAB_KERNEL_PERSISTENCE_REASON.BASIC_PRICE_RESOURCE_IDENTITY_MISMATCH,
      });
      expect(boqItemUpdate).not.toHaveBeenCalled();
      expect(rabDocumentUpdateMany).not.toHaveBeenCalled();
      expect(rabDocumentCreate).not.toHaveBeenCalled();
    });

    it('A-03: PriceSubmission.resourceId != BasicPrice.resourceId fails closed before money mutation', async () => {
      const { service, boqItemUpdate } = createHarness(
        withNoOtherItems({
          submission: buildTraceableSubmission({ resourceId: OTHER_RESOURCE_CATALOG_ID }),
        }),
      );
      await expect(call(service)).rejects.toMatchObject({
        message: RAB_KERNEL_PERSISTENCE_REASON.BASIC_PRICE_PROVENANCE_INCOMPLETE,
      });
      expect(boqItemUpdate).not.toHaveBeenCalled();
    });

    it('A-04: a positive matching resourceCatalogId/resourceId/submission chain still succeeds', async () => {
      const { service } = createHarness(withNoOtherItems());
      const result = await call(service);
      expect(result.unitPrice).toBe('200000.00');
    });
  });

  describe('§PR57 Gap B — publication audit provenance binding', () => {
    it('B-02: submission workspace mismatch fails closed', async () => {
      const { service, boqItemUpdate } = createHarness(
        withNoOtherItems({
          submission: buildTraceableSubmission({ workspaceId: OTHER_WORKSPACE_ID }),
        }),
      );
      await expect(call(service)).rejects.toMatchObject({
        message: RAB_KERNEL_PERSISTENCE_REASON.BASIC_PRICE_PROVENANCE_INCOMPLETE,
      });
      expect(boqItemUpdate).not.toHaveBeenCalled();
    });

    it('B-03: submission organization mismatch fails closed', async () => {
      const { service, boqItemUpdate } = createHarness(
        withNoOtherItems({
          submission: buildTraceableSubmission({ organizationId: OTHER_ORGANIZATION_ID }),
        }),
      );
      await expect(call(service)).rejects.toMatchObject({
        message: RAB_KERNEL_PERSISTENCE_REASON.BASIC_PRICE_PROVENANCE_INCOMPLETE,
      });
      expect(boqItemUpdate).not.toHaveBeenCalled();
    });

    it('B-04: review workspace/organization mismatch fails closed', async () => {
      const { service } = createHarness(
        withNoOtherItems({
          submission: buildTraceableSubmission({
            review: {
              id: REVIEW_ID,
              workspaceId: OTHER_WORKSPACE_ID,
              organizationId: ORGANIZATION_ID,
              decisions: [{ decidedByUserId: VERIFIER_USER_ID }],
            },
          }),
        }),
      );
      await expect(call(service)).rejects.toMatchObject({
        message: RAB_KERNEL_PERSISTENCE_REASON.BASIC_PRICE_PROVENANCE_INCOMPLETE,
      });
    });

    it('B-05: verifier User/membership belongs to another workspace fails closed', async () => {
      const { service } = createHarness(
        withNoOtherItems({
          verifierUser: { membership: { accountId: VERIFIER_ACCOUNT_ID, workspaceId: OTHER_WORKSPACE_ID } },
        }),
      );
      await expect(call(service)).rejects.toMatchObject({
        message: RAB_KERNEL_PERSISTENCE_REASON.BASIC_PRICE_PROVENANCE_INCOMPLETE,
      });
    });
  });

  /**
   * RM-03C — a workspace-private Basic Price flows through the SAME Cost
   * Kernel, with the SAME arithmetic, and proves a DIFFERENT but equally
   * exacting provenance chain: not "who verified and who published", which a
   * private asset legitimately has neither of, but "which human-resolved
   * import row, in which workbook, is this number".
   */
  describe('RM-03C — workspace-private Basic Price through the Cost Kernel', () => {
    const privateFixture = (overrides: Fixture = {}): Fixture =>
      withNoOtherItems({
        basicPrice: buildPrivateBasicPrice(),
        // Deliberately removed: a private price has NO submission chain, and
        // must not need one. If the private branch ever fell back to the
        // catalog chain, these nulls would make it fail.
        submission: null,
        verifierUser: null,
        publicationAudit: null,
        ...overrides,
      });

    it('persists the same exact result: coefficient 2 x 100000.00, volume 5', async () => {
      const { service, boqItemUpdate } = createHarness(privateFixture());

      const result = await call(service);

      // Byte-identical to the catalog case at the top of this file. Private
      // ownership changes WHICH prices are eligible, never HOW they are
      // calculated — no kernel fork, no convenience conversion.
      expect(result.unitPrice).toBe('200000.00');
      expect(result.lineTotal).toBe('1000000.00');
      expect(result.priceOrigin).toBe('SERVER_COST_KERNEL');
      expect(boqItemUpdate).toHaveBeenCalledTimes(1);
    });

    it('needs no verifier, no publisher, and no publication audit', async () => {
      const { service, tx } = createHarness(privateFixture());
      await call(service);

      // Nothing in the catalog chain is even consulted for a private price.
      expect(tx.priceSubmission.findFirst).not.toHaveBeenCalled();
      expect(tx.user.findFirst).not.toHaveBeenCalled();
      expect(tx.basicPricePublicationAudit.findFirst).not.toHaveBeenCalled();
    });

    it('proves the import-row chain instead, bound by exact id', async () => {
      const { service, tx } = createHarness(privateFixture());
      await call(service);

      expect(tx.basicPriceImportRow.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: IMPORT_ROW_ID } }),
      );
    });

    it('fails closed when the private price carries no import-row evidence', async () => {
      const { service, boqItemUpdate } = createHarness(
        privateFixture({
          basicPrice: buildPrivateBasicPrice({ sourceImportRowId: null }),
        }),
      );
      await expect(call(service)).rejects.toMatchObject({
        message: RAB_KERNEL_PERSISTENCE_REASON.BASIC_PRICE_PROVENANCE_INCOMPLETE,
      });
      expect(boqItemUpdate).not.toHaveBeenCalled();
    });

    it('fails closed when the evidence row does not exist', async () => {
      const { service } = createHarness(privateFixture({ importRow: null }));
      await expect(call(service)).rejects.toMatchObject({
        message: RAB_KERNEL_PERSISTENCE_REASON.BASIC_PRICE_PROVENANCE_INCOMPLETE,
      });
    });

    it('fails closed when the evidence row is about a DIFFERENT resource', async () => {
      const { service } = createHarness(
        privateFixture({
          importRow: buildTraceableImportRow({
            resourceCatalogId: OTHER_RESOURCE_CATALOG_ID,
          }),
        }),
      );
      await expect(call(service)).rejects.toMatchObject({
        message: RAB_KERNEL_PERSISTENCE_REASON.BASIC_PRICE_PROVENANCE_INCOMPLETE,
      });
    });

    it('fails closed when the evidence row was never resolved by a human', async () => {
      const { service } = createHarness(
        privateFixture({
          importRow: buildTraceableImportRow({ resolutionStatus: 'UNRESOLVED' }),
        }),
      );
      await expect(call(service)).rejects.toMatchObject({
        message: RAB_KERNEL_PERSISTENCE_REASON.BASIC_PRICE_PROVENANCE_INCOMPLETE,
      });
    });

    it.each([
      ['workspaceId', OTHER_WORKSPACE_ID],
      ['organizationId', OTHER_ORGANIZATION_ID],
      ['regionId', 'other-region-fixture'],
    ])('fails closed when the evidence batch %s does not match the price', async (field, value) => {
      const { service } = createHarness(
        privateFixture({
          importRow: buildTraceableImportRow({
            batch: { ...buildTraceableImportRow().batch, [field]: value },
          }),
        }),
      );
      await expect(call(service)).rejects.toMatchObject({
        message: RAB_KERNEL_PERSISTENCE_REASON.BASIC_PRICE_PROVENANCE_INCOMPLETE,
      });
    });

    it.each(['sourceSha256', 'sourceOrigin', 'effectiveDate'])(
      'fails closed when the evidence batch has no %s — evidence must be evidence',
      async (field) => {
        const { service } = createHarness(
          privateFixture({
            importRow: buildTraceableImportRow({
              batch: { ...buildTraceableImportRow().batch, [field]: null },
            }),
          }),
        );
        await expect(call(service)).rejects.toMatchObject({
          message: RAB_KERNEL_PERSISTENCE_REASON.BASIC_PRICE_PROVENANCE_INCOMPLETE,
        });
      },
    );

    it('fails closed when a private price claims a submission it must not have', async () => {
      const { service } = createHarness(
        privateFixture({
          basicPrice: buildPrivateBasicPrice({ sourceSubmissionId: SUBMISSION_ID }),
        }),
      );
      await expect(call(service)).rejects.toMatchObject({
        message: RAB_KERNEL_PERSISTENCE_REASON.BASIC_PRICE_PROVENANCE_INCOMPLETE,
      });
    });

    it.each([
      ['a foreign workspace', OTHER_WORKSPACE_ID],
      ['a null workspace', null],
    ])('fails closed when the private price belongs to %s', async (_label, workspaceId) => {
      const { service, boqItemUpdate } = createHarness(
        privateFixture({
          basicPrice: buildPrivateBasicPrice({ workspaceId }),
        }),
      );
      await expect(call(service)).rejects.toMatchObject({
        message: RAB_KERNEL_PERSISTENCE_REASON.BASIC_PRICE_PROVENANCE_INCOMPLETE,
      });
      expect(boqItemUpdate).not.toHaveBeenCalled();
    });

    it('re-reads the selected price under the two-branch eligibility predicate', async () => {
      const { service, tx } = createHarness(privateFixture());
      await call(service);

      const where = tx.basicPrice.findFirst.mock.calls[0][0].where;
      expect(where.id).toBe(BASIC_PRICE_ID);
      const [catalog, priv] = where.OR;
      expect(catalog.status).toBe('PUBLISHED');
      expect(catalog.verificationStatus).toBe('PUBLISHED');
      expect(priv.assetScope).toBe('WORKSPACE_PRIVATE');
      expect(priv.workspaceId).toBe(WORKSPACE_ID);
      // The re-read must never be the place a null-workspace row slips in.
      expect(priv).not.toHaveProperty('OR');
    });
  });
});
