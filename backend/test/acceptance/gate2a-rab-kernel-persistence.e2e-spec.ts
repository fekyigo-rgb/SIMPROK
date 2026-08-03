import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import {
  cleanupGate2aPositiveFixture,
  createGate2aPositiveFixture,
  Gate2aPositiveFixture,
} from '../support/gate2a-productization-d.fixture';

/**
 * GATE-2A deterministic Safe E2E proof.
 *
 * Positive: one canonically SUBMITTED Basic Price -> ACCEPT by verifier A
 * (real HTTP POST /basic-price-reviews/:id/accept) -> publish by publisher B
 * (real HTTP POST /basic-price-publications/:id/publish, distinct actor) ->
 * traceable PUBLISHED/PUBLISHED BasicPrice -> one AHSP occurrence/resolution
 * -> one WORK_ITEM -> the Gate-2A persist command -> exact SERVER_COST_KERNEL
 * line + exact complete RAB totals + full provenance.
 *
 * The submission/revision/review rows themselves are seeded directly
 * (prerequisite source data, not a "final transition"), but the two
 * transitions this gate actually depends on — ACCEPT and PUBLISH — run
 * through the real runtime HTTP paths, never a direct Prisma write of a
 * PUBLISHED BasicPrice.
 *
 * Negative: a PUBLISHED/PUBLISHED BasicPrice fabricated with NO submission
 * chain (the one deliberate exception — this is the untraceable case the
 * gate must catch) is rejected by the persist command with
 * BASIC_PRICE_PROVENANCE_INCOMPLETE, writing nothing.
 *
 * Runs against simprok_e2e only. Every fixture row is deleted in afterAll —
 * residual verification is the outer Safe E2E harness's job
 * (backend/scripts/e2e-database-lifecycle.ts fingerprint compare).
 */
describe('GATE-2A traceable RAB kernel persistence (e2e)', () => {
  const prisma = new PrismaClient();
  const tag = `GATE2A${Date.now()}`;
  const labels = 'TEST_FIXTURE_ONLY OWNER_SUPPLIED_EXAMPLE_NON_PRODUCTION';
  let app: INestApplication;
  let positiveFixture: Gate2aPositiveFixture;
  let workspaceId: string;
  let orgId: string;

  // Positive fixture
  let projectId: string;
  let boqItemId: string;
  let boqStructureId: string;
  let ahspId: string;
  let resourceCatalogId: string;
  let basicPriceId: string;
  let submissionId: string;
  let reviewId: string;
  let rabEditorToken: string;
  let verifierToken: string;
  let publisherToken: string;

  // Negative fixture
  let negativeProjectId: string;
  let negativeBoqItemId: string;
  let negativeBoqStructureId: string;
  let negativeAhspId: string;
  let negativeResourceCatalogId: string;
  let negativeBasicPriceId: string;

  // §PR57 Gap A negative fixture: resolution.resourceCatalogId points to a
  // DIFFERENT ResourceCatalog than the one the selected BasicPrice actually
  // belongs to.
  let mismatchProjectId: string;
  let mismatchBoqItemId: string;
  let mismatchBoqStructureId: string;
  let mismatchAhspId: string;
  let mismatchResourceCatalogAId: string;
  let mismatchResourceCatalogBId: string;
  let mismatchBasicPriceId: string;

  /** One AHSP version/resource + one Working Draft WORK_ITEM occurring against `selectedBasicPriceId`. */
  const buildAhspAndBoqFixture = async (params: {
    projectId: string;
    resourceName: string;
    selectedBasicPriceId: string;
    sourcePriceValue: string;
    /** §PR57 Gap A: the ResourceCatalog id this RESOLVED resolution truthfully identifies. */
    resourceCatalogId: string;
  }) => {
    const ahsp = await prisma.aHSP.create({
      data: {
        workspaceId,
        workType: `${tag} ${params.resourceName}`,
        methodType: 'MANUAL',
        locationType: 'GENERAL',
        methodName: `${tag} ${params.resourceName} method`,
      },
    });
    const version = await prisma.aHSPVersion.create({
      data: {
        ahspId: ahsp.id,
        workspaceId,
        versionNumber: 1,
        outputUnit: 'Kg',
        regulationReference: `${tag} ${labels}`,
      },
    });
    const resource = await prisma.aHSPResource.create({
      data: {
        ahspVersionId: version.id,
        resourceId: params.resourceName,
        resourceType: 'MATERIAL',
        coefficient: '2.000000',
        baseUnit: 'Kg',
      },
    });
    await prisma.projectAhspOccurrence.create({
      data: {
        workspaceId,
        projectId: params.projectId,
        ahspVersionId: version.id,
        idempotencyKey: `${tag}-${params.resourceName}-occurrence`,
        resourceResolutions: {
          create: [
            {
              ahspResourceId: resource.id,
              rawAhspResourceRef: resource.resourceId,
              rawAhspResourceType: 'MATERIAL',
              ahspCoefficient: '2.000000',
              ahspUnit: 'Kg',
              status: 'RESOLVED',
              selectionMode: 'AUTO_SELECTED',
              resourceCatalogId: params.resourceCatalogId,
              selectedBasicPriceId: params.selectedBasicPriceId,
              canonicalUnit: 'Kg',
              sourcePriceValue: params.sourcePriceValue,
              sourceUnit: 'Kg',
              adaptedPriceValue: params.sourcePriceValue,
              selectedSourceOrigin: 'SUPPLIER',
              selectedFreshnessStatus: 'CURRENT',
              selectedEffectiveDate: new Date('2026-01-01T00:00:00.000Z'),
              resolutionMethod: 'EXACT_DETERMINISTIC',
              reasonCodes: ['TEST_FIXTURE_ONLY'],
              explanation: labels,
              policyVersion: labels,
            },
          ],
        },
      },
    });
    const structure = await prisma.boqStructure.create({
      data: {
        projectId: params.projectId,
        name: 'Working Draft',
        version: 1,
        status: 'DRAFT',
      },
    });
    const item = await prisma.boqItem.create({
      data: {
        boqStructureId: structure.id,
        wbsCode: '1.1',
        name: `${tag} ${params.resourceName}`,
        itemType: 'WORK_ITEM',
        quantity: '5',
        unit: 'Kg',
        unitPrice: null,
        lineTotal: null,
        ahspVersionId: version.id,
      },
    });
    return { ahspId: ahsp.id, structureId: structure.id, itemId: item.id };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    positiveFixture = await createGate2aPositiveFixture({ prisma, app, tag });
    orgId = positiveFixture.organizationId;
    workspaceId = positiveFixture.workspaceId;
    projectId = positiveFixture.projectId;
    boqItemId = positiveFixture.boqItemId;
    boqStructureId = positiveFixture.boqStructureId;
    ahspId = positiveFixture.ahspId;
    resourceCatalogId = positiveFixture.resourceCatalogId;
    basicPriceId = positiveFixture.basicPriceId;
    submissionId = positiveFixture.submissionId;
    reviewId = positiveFixture.reviewId;
    rabEditorToken = positiveFixture.browserActorToken;
    verifierToken = positiveFixture.verifierToken;
    publisherToken = positiveFixture.publisherToken;

    const negativeProject = await prisma.project.create({
      data: {
        workspaceId,
        organizationId: orgId,
        code: `${tag}-NEG`,
        name: `${tag} Negative Project`,
        status: 'PLANNED',
      },
    });
    negativeProjectId = negativeProject.id;
    const mismatchProject = await prisma.project.create({
      data: {
        workspaceId,
        organizationId: orgId,
        code: `${tag}-MISMATCH`,
        name: `${tag} Mismatch Project`,
        status: 'PLANNED',
      },
    });
    mismatchProjectId = mismatchProject.id;
    for (const assignedProjectId of [negativeProjectId, mismatchProjectId]) {
      await prisma.projectAssignment.create({
        data: {
          workspaceMembershipId: positiveFixture.membershipIds[0],
          projectId: assignedProjectId,
          roleInProject: 'MEMBER',
          isPrimaryAssignment: true,
          status: 'ASSIGNED',
        },
      });
    }

    // ---- Negative: a PUBLISHED/PUBLISHED price fabricated with NO submission chain ----
    const negativeResourceCatalog = await prisma.resourceCatalog.create({
      data: {
        workspaceId,
        name: `${tag} Pasir Untraceable`,
        type: 'MATERIAL',
        baseUnit: 'Kg',
      },
    });
    negativeResourceCatalogId = negativeResourceCatalog.id;
    const negativeBasicPrice = await prisma.basicPrice.create({
      data: {
        resourceId: negativeResourceCatalogId,
        workspaceId,
        effectiveDate: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: null,
        value: '100000.00',
        sourceType: 'MARKET_SURVEY',
        sourceOrigin: 'SUPPLIER',
        status: 'PUBLISHED',
        verificationStatus: 'PUBLISHED',
        // sourceSubmissionId intentionally omitted (null) — this is the
        // untraceable case §3.3/§7 requires the gate to reject.
      },
    });
    negativeBasicPriceId = negativeBasicPrice.id;

    const negativeFixture = await buildAhspAndBoqFixture({
      projectId: negativeProjectId,
      resourceName: `${tag} Pasir Untraceable`,
      selectedBasicPriceId: negativeBasicPriceId,
      sourcePriceValue: '100000.00',
      resourceCatalogId: negativeResourceCatalogId,
    });
    negativeAhspId = negativeFixture.ahspId;
    negativeBoqStructureId = negativeFixture.structureId;
    negativeBoqItemId = negativeFixture.itemId;

    // ---- §PR57 Gap A negative: resolution.resourceCatalogId names a
    // DIFFERENT ResourceCatalog than the one the selected BasicPrice
    // actually belongs to (two genuinely distinct ResourceCatalog rows). ----
    const mismatchResourceCatalogA = await prisma.resourceCatalog.create({
      data: {
        workspaceId,
        name: `${tag} Semen A`,
        type: 'MATERIAL',
        baseUnit: 'Kg',
      },
    });
    mismatchResourceCatalogAId = mismatchResourceCatalogA.id;
    const mismatchResourceCatalogB = await prisma.resourceCatalog.create({
      data: {
        workspaceId,
        name: `${tag} Semen B`,
        type: 'MATERIAL',
        baseUnit: 'Kg',
      },
    });
    mismatchResourceCatalogBId = mismatchResourceCatalogB.id;
    // This BasicPrice genuinely belongs to resource A.
    const mismatchBasicPrice = await prisma.basicPrice.create({
      data: {
        resourceId: mismatchResourceCatalogAId,
        workspaceId,
        effectiveDate: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: null,
        value: '100000.00',
        sourceType: 'MARKET_SURVEY',
        sourceOrigin: 'SUPPLIER',
        status: 'PUBLISHED',
        verificationStatus: 'PUBLISHED',
      },
    });
    mismatchBasicPriceId = mismatchBasicPrice.id;

    // ...but the resolution claims resource B — the exact identity mismatch
    // Gap A's BASIC_PRICE_RESOURCE_IDENTITY_MISMATCH must catch.
    const mismatchFixture = await buildAhspAndBoqFixture({
      projectId: mismatchProjectId,
      resourceName: `${tag} Semen Mismatch`,
      selectedBasicPriceId: mismatchBasicPriceId,
      sourcePriceValue: '100000.00',
      resourceCatalogId: mismatchResourceCatalogBId,
    });
    mismatchAhspId = mismatchFixture.ahspId;
    mismatchBoqStructureId = mismatchFixture.structureId;
    mismatchBoqItemId = mismatchFixture.itemId;
  }, 60_000);

  afterAll(async () => {
    const negativeProjectIds = [negativeProjectId, mismatchProjectId];
    const negativeStructureIds = [
      negativeBoqStructureId,
      mismatchBoqStructureId,
    ];
    const negativeAhspIds = [negativeAhspId, mismatchAhspId];
    const negativeBasicPriceIds = [negativeBasicPriceId, mismatchBasicPriceId];
    const allResourceCatalogIds = [
      negativeResourceCatalogId,
      mismatchResourceCatalogAId,
      mismatchResourceCatalogBId,
    ];

    await prisma.rabDocument.deleteMany({
      where: { projectId: { in: negativeProjectIds } },
    });
    await prisma.boqItem.deleteMany({
      where: { boqStructureId: { in: negativeStructureIds } },
    });
    await prisma.boqStructure.deleteMany({
      where: { projectId: { in: negativeProjectIds } },
    });
    await prisma.projectAhspResourceResolution.deleteMany({
      where: { occurrence: { projectId: { in: negativeProjectIds } } },
    });
    await prisma.projectAhspOccurrence.deleteMany({
      where: { projectId: { in: negativeProjectIds } },
    });
    await prisma.aHSPResource.deleteMany({
      where: { ahspVersion: { ahspId: { in: negativeAhspIds } } },
    });
    await prisma.aHSPVersion.deleteMany({
      where: { ahspId: { in: negativeAhspIds } },
    });
    await prisma.aHSP.deleteMany({ where: { id: { in: negativeAhspIds } } });

    await prisma.basicPrice.deleteMany({
      where: { id: { in: negativeBasicPriceIds } },
    });
    await prisma.resourceCatalog.deleteMany({
      where: { id: { in: allResourceCatalogIds } },
    });
    await prisma.projectAssignment.deleteMany({
      where: { projectId: { in: negativeProjectIds } },
    });
    await prisma.project.deleteMany({
      where: { id: { in: negativeProjectIds } },
    });
    await cleanupGate2aPositiveFixture(prisma, positiveFixture);
    await app.close();
    await prisma.$disconnect();
  }, 30_000);

  it('F: traceable proof — ACCEPT and PUBLISH used distinct real actors and produced a genuinely traceable PUBLISHED/PUBLISHED price', async () => {
    const decision = await prisma.priceSubmissionReviewDecision.findFirstOrThrow({
      where: { reviewId, action: 'ACCEPT' },
    });
    const audit = await prisma.basicPricePublicationAudit.findFirstOrThrow({
      where: { basicPriceId, action: 'PUBLISH' },
    });
    const verifierUser = await prisma.user.findUniqueOrThrow({
      where: { id: decision.decidedByUserId },
      include: { membership: true },
    });
    expect(verifierUser.membership.accountId).not.toBe(audit.actorAccountId);

    const price = await prisma.basicPrice.findUniqueOrThrow({ where: { id: basicPriceId } });
    expect(price.sourceSubmissionId).toBe(submissionId);
    expect(price.status).toBe('PUBLISHED');
    expect(price.verificationStatus).toBe('PUBLISHED');
  });

  it('persists one server-computed RAB line and exact complete RAB totals from one traceable Basic Price', async () => {
    const response = await request(app.getHttpServer())
      .post(`/projects/${projectId}/boq/items/${boqItemId}/cost-calculation/persist`)
      .set('Authorization', `Bearer ${rabEditorToken}`)
      .send({ calculationAsOfDate: '2026-07-31' })
      .expect(201);

    // coefficient 2 x price 100000.00 = 200000.00 unit price; volume 5 -> lineTotal 1000000.00.
    expect(response.body).toMatchObject({
      boqItemId,
      unitPrice: '200000.00',
      lineTotal: '1000000.00',
      priceOrigin: 'SERVER_COST_KERNEL',
      calculationAsOfDate: '2026-07-31',
      calculationPolicyVersion: 'RAB_KERNEL_PERSISTENCE_GRADE_A_V1',
      rabTotals: {
        pricingStatus: 'COMPLETE',
        totalBaseCost: '1000000.00',
        totalFinalCost: '1221000.00',
      },
    });

    const persistedItem = await prisma.boqItem.findUniqueOrThrow({ where: { id: boqItemId } });
    expect(persistedItem.unitPrice?.toFixed(2)).toBe('200000.00');
    expect(persistedItem.lineTotal?.toFixed(2)).toBe('1000000.00');
    expect(persistedItem.priceOrigin).toBe('SERVER_COST_KERNEL');
    expect(persistedItem.calculationOccurrenceId).not.toBeNull();
    expect(persistedItem.calculationAsOfDate?.toISOString().slice(0, 10)).toBe('2026-07-31');
    expect(persistedItem.calculatedAt).not.toBeNull();
    expect(persistedItem.calculationPolicyVersion).toBe('RAB_KERNEL_PERSISTENCE_GRADE_A_V1');

    const persistedRab = await prisma.rabDocument.findFirstOrThrow({
      where: { projectId, boqStructureId, status: 'DRAFT' },
    });
    expect(persistedRab.totalBaseCost?.toFixed(2)).toBe('1000000.00');
    expect(persistedRab.totalFinalCost?.toFixed(2)).toBe('1221000.00');
  });

  it('rejects a client-supplied unitPrice via saveDraftBoq once the line is server-authored', async () => {
    const response = await request(app.getHttpServer())
      .put(`/projects/${projectId}/boq/draft`)
      .set('Authorization', `Bearer ${rabEditorToken}`)
      .send({
        rows: [
          { tempId: boqItemId, itemType: 'WORK_ITEM', name: `${tag} Besi Beton`, wbsCode: '1.1', quantity: 5, unit: 'Kg', unitPrice: 1 },
        ],
      })
      .expect(409);

    expect(response.body.message).toBe('SERVER_ROW_UNIT_PRICE_OVERWRITE_FORBIDDEN');
    const stillPersisted = await prisma.boqItem.findUniqueOrThrow({ where: { id: boqItemId } });
    expect(stillPersisted.unitPrice?.toFixed(2)).toBe('200000.00');
    expect(stillPersisted.priceOrigin).toBe('SERVER_COST_KERNEL');
  });

  it('G: rejects an untraceable PUBLISHED/PUBLISHED price with BASIC_PRICE_PROVENANCE_INCOMPLETE and writes nothing', async () => {
    const response = await request(app.getHttpServer())
      .post(`/projects/${negativeProjectId}/boq/items/${negativeBoqItemId}/cost-calculation/persist`)
      .set('Authorization', `Bearer ${rabEditorToken}`)
      .send({ calculationAsOfDate: '2026-07-31' })
      .expect(409);

    expect(response.body.message).toBe('BASIC_PRICE_PROVENANCE_INCOMPLETE');

    const untouchedItem = await prisma.boqItem.findUniqueOrThrow({ where: { id: negativeBoqItemId } });
    expect(untouchedItem.unitPrice).toBeNull();
    expect(untouchedItem.priceOrigin).toBeNull();
    expect(untouchedItem.calculationOccurrenceId).toBeNull();

    const rab = await prisma.rabDocument.findFirst({ where: { projectId: negativeProjectId } });
    expect(rab).toBeNull();
  });

  it('§PR57 Gap A: rejects a resolution whose resourceCatalogId names a different ResourceCatalog than the selected BasicPrice actually belongs to, with BASIC_PRICE_RESOURCE_IDENTITY_MISMATCH and zero mutation', async () => {
    const response = await request(app.getHttpServer())
      .post(`/projects/${mismatchProjectId}/boq/items/${mismatchBoqItemId}/cost-calculation/persist`)
      .set('Authorization', `Bearer ${rabEditorToken}`)
      .send({ calculationAsOfDate: '2026-07-31' })
      .expect(409);

    expect(response.body.message).toBe('BASIC_PRICE_RESOURCE_IDENTITY_MISMATCH');

    const untouchedItem = await prisma.boqItem.findUniqueOrThrow({ where: { id: mismatchBoqItemId } });
    expect(untouchedItem.unitPrice).toBeNull();
    expect(untouchedItem.priceOrigin).toBeNull();
    expect(untouchedItem.calculationOccurrenceId).toBeNull();

    const rab = await prisma.rabDocument.findFirst({ where: { projectId: mismatchProjectId } });
    expect(rab).toBeNull();
  });

  it('G: route validation — an unknown request field is rejected with 400 before any mutation', async () => {
    const before = await prisma.boqItem.findUniqueOrThrow({ where: { id: negativeBoqItemId } });

    await request(app.getHttpServer())
      .post(`/projects/${negativeProjectId}/boq/items/${negativeBoqItemId}/cost-calculation/persist`)
      .set('Authorization', `Bearer ${rabEditorToken}`)
      .send({ calculationAsOfDate: '2026-07-31', unitPrice: 1 })
      .expect(400);

    const after = await prisma.boqItem.findUniqueOrThrow({ where: { id: negativeBoqItemId } });
    expect(after.unitPrice).toEqual(before.unitPrice);
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  it('G: route validation — an invalid calendar date (Feb 30) is rejected with 400', async () => {
    await request(app.getHttpServer())
      .post(`/projects/${negativeProjectId}/boq/items/${negativeBoqItemId}/cost-calculation/persist`)
      .set('Authorization', `Bearer ${rabEditorToken}`)
      .send({ calculationAsOfDate: '2026-02-30' })
      .expect(400);
  });

  it('G: route validation — a non-YYYY-MM-DD shape (single-digit month) is rejected with 400', async () => {
    await request(app.getHttpServer())
      .post(`/projects/${negativeProjectId}/boq/items/${negativeBoqItemId}/cost-calculation/persist`)
      .set('Authorization', `Bearer ${rabEditorToken}`)
      .send({ calculationAsOfDate: '2026-7-1' })
      .expect(400);
  });

  describe('§2.2 database truth — boq_items_price_origin_truth_check rejects every invalid shape directly', () => {
    const attempt = (data: Record<string, unknown>) =>
      prisma.boqItem.create({
        data: {
          boqStructureId,
          wbsCode: 'X',
          name: 'constraint-probe',
          itemType: 'WORK_ITEM',
          quantity: '1',
          unit: 'ls',
          ...data,
        } as never,
      });

    it('rejects MANUAL_CLIENT with null money', async () => {
      await expect(
        attempt({ unitPrice: null, lineTotal: null, priceOrigin: 'MANUAL_CLIENT' }),
      ).rejects.toThrow();
    });

    it('rejects MANUAL_CLIENT carrying kernel provenance', async () => {
      await expect(
        attempt({
          unitPrice: '1.00',
          lineTotal: '1.00',
          priceOrigin: 'MANUAL_CLIENT',
          calculationOccurrenceId: null,
          calculationAsOfDate: new Date('2026-07-31'),
          calculatedAt: new Date(),
          calculationPolicyVersion: 'x',
        }),
      ).rejects.toThrow();
    });

    it('rejects SERVER_COST_KERNEL missing provenance', async () => {
      await expect(
        attempt({
          unitPrice: '1.00',
          lineTotal: '1.00',
          priceOrigin: 'SERVER_COST_KERNEL',
          calculationOccurrenceId: null,
          calculationAsOfDate: null,
          calculatedAt: null,
          calculationPolicyVersion: null,
        }),
      ).rejects.toThrow();
    });

    it('rejects SERVER_COST_KERNEL with null money', async () => {
      await expect(
        attempt({ unitPrice: null, lineTotal: null, priceOrigin: 'SERVER_COST_KERNEL' }),
      ).rejects.toThrow();
    });

    it('rejects a priced row with a null priceOrigin (money without origin)', async () => {
      await expect(
        attempt({ unitPrice: '1.00', lineTotal: '1.00', priceOrigin: null }),
      ).rejects.toThrow();
    });

    it('rejects provenance attached to an unpriced row', async () => {
      await expect(
        attempt({
          unitPrice: null,
          lineTotal: null,
          priceOrigin: null,
          calculationOccurrenceId: null,
          calculationAsOfDate: new Date('2026-07-31'),
          calculatedAt: new Date(),
          calculationPolicyVersion: 'x',
        }),
      ).rejects.toThrow();
    });

    it('accepts the three truthful shapes: unpriced, MANUAL_CLIENT, SERVER_COST_KERNEL', async () => {
      const unpriced = await attempt({});
      const manual = await attempt({ unitPrice: '5.00', lineTotal: '5.00', priceOrigin: 'MANUAL_CLIENT' });
      await prisma.boqItem.deleteMany({ where: { id: { in: [unpriced.id, manual.id] } } });
      // SERVER_COST_KERNEL shape is already proven by the earlier positive-proof test.
    });
  });
});
