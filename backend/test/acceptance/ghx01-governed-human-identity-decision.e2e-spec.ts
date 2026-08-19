import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { WORKING_DRAFT_STRUCTURE_NAME } from '../../src/project/rab-lifecycle-policy.service';
import { E1A_RESOLUTION_POLICY_VERSION } from '../../src/project-ahsp/ahsp-resource-resolution.orchestrator';
import { candidateContextDigest } from '../../src/resource-catalog/ghx-candidate-context';
import {
  GhxDecisionContextTokenService,
  GHX_DECISION_CONTEXT_TTL_SECONDS,
} from '../../src/resource-catalog/ghx-decision-context-token.service';

/**
 * GHX-01 — THE GOVERNED HUMAN RESOURCE IDENTITY DECISION, PROVEN END TO END.
 *
 * Nothing is stubbed. Real HTTP, real guards, real PostgreSQL, real migrations,
 * real Unit Kernel alias catalogue, real price publication chain. Every fact this
 * file asserts is a fact the shipped runtime produced.
 *
 * The spine of the proof is ONE integrated lifecycle:
 *
 *   occurrence N  ->  GHX READ  ->  GHX WRITE  ->  the SAME normal product
 *   action a user performs  ->  occurrence N+1  ->  downstream truth
 *
 * with occurrence N left byte-identical throughout. Everything else — idempotency,
 * machine-first, unit independence, the hostile authority matrix, real concurrency,
 * decision history, source scope, fail-closed mixing and query boundedness — hangs
 * off that same spine rather than off a second, parallel construction.
 */

const ASOF = '2026-08-14';
const PASSWORD = 'Ghx01Acceptance123!';

describe('GHX-01 governed human Resource Identity decision (e2e)', () => {
  const prisma = new PrismaClient();
  const tag = `GHX${Date.now()}`;

  let app: INestApplication;
  let appPrisma: PrismaService;
  let tokens: GhxDecisionContextTokenService;

  // ---- tenancy ----
  let orgId: string;
  let orgBId: string;
  let workspaceId: string;
  let workspaceBId: string;
  let projectId: string;
  let projectTwoId: string;
  let projectBId: string;
  let regionId: string;

  // ---- actors ----
  let deciderToken: string;
  let deciderTwoToken: string;
  let noDecideToken: string;
  let unassignedToken: string;
  let foreignToken: string;
  let verifierToken: string;
  let publisherToken: string;
  let deciderAccountId: string;

  // ---- boq ----
  let structureId: string;
  let structureTwoId: string;
  let structureBId: string;
  const item: Record<string, string> = {};

  // ---- ahsp ----
  let ahspId: string;
  let globalAhspId: string;
  const version: Record<string, string> = {};
  /** rawAhspResourceRef -> AHSPResource.id, per version key. */
  const ahspResourceId: Record<string, Record<string, string>> = {};

  // ---- catalog ----
  const catalog: Record<string, string> = {};

  // ---- price chain ----
  let besiBasicPriceId: string;
  let submissionId: string;
  let reviewId: string;
  const simpleBasicPriceIds: string[] = [];

  const createdPermissionIds: string[] = [];
  const accountIds: string[] = [];
  const membershipIds: string[] = [];
  const createdUnitAliasIds: string[] = [];

  // =====================================================================
  // HELPERS
  // =====================================================================

  const http = () => app.getHttpServer() as never;

  const login = async (email: string) => {
    const response = await request(http())
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(201);
    return response.body.access_token as string;
  };

  const select = (
    itemId: string,
    versionId: string,
    idempotencyKey: string,
    bearer: string = deciderToken,
    pid: string = projectId,
  ) =>
    request(http())
      .post(`/projects/${pid}/ahsp-occurrences/boq-items/${itemId}/select-ahsp`)
      .set('Authorization', `Bearer ${bearer}`)
      .send({
        ahspVersionId: versionId,
        businessPricingAsOfDate: ASOF,
        referenceRegionId: regionId,
        idempotencyKey,
      });

  const readContext = (
    resolutionId: string,
    bearer: string = deciderToken,
    pid: string = projectId,
  ) =>
    request(http())
      .get(
        `/projects/${pid}/ahsp-occurrences/resource-resolutions/${resolutionId}/identity-decision-context`,
      )
      .set('Authorization', `Bearer ${bearer}`);

  const decide = (
    resolutionId: string,
    body: Record<string, unknown>,
    bearer: string = deciderToken,
    pid: string = projectId,
  ) =>
    request(http())
      .post(
        `/projects/${pid}/ahsp-occurrences/resource-resolutions/${resolutionId}/identity-decision`,
      )
      .set('Authorization', `Bearer ${bearer}`)
      .send(body);

  /** The resolution row of one named AHSP source line inside an occurrence body. */
  const resolutionFor = (occurrence: any, rawRef: string) => {
    const row = occurrence.resourceResolutions.find(
      (candidate: any) => candidate.rawAhspResourceRef === rawRef,
    );
    if (!row) throw new Error(`no resolution for ${rawRef}`);
    return row;
  };

  /** A stable, comparable snapshot of one occurrence and everything under it. */
  const snapshotOccurrence = async (occurrenceId: string) => {
    const occurrence = await prisma.projectAhspOccurrence.findUniqueOrThrow({
      where: { id: occurrenceId },
      include: { resourceResolutions: { orderBy: { ahspResourceId: 'asc' } } },
    });
    return JSON.parse(JSON.stringify(occurrence));
  };

  const decisionRows = (subjectAhspResourceId: string) =>
    prisma.ahspResourceIdentityDecision.findMany({
      where: { ahspResourceId: subjectAhspResourceId },
      orderBy: { generation: 'asc' },
    });

  /**
   * The whole decision context, read and then spent, in one lawful step.
   * Returns both the context the human saw and the recorded decision.
   */
  const readThenDecide = async (
    resolutionId: string,
    pick: (context: any) => string,
    reason?: string,
  ) => {
    const context = await readContext(resolutionId).expect(200);
    expect(context.body.humanDecidable).toBe(true);
    const response = await decide(resolutionId, {
      selectedResourceCatalogId: pick(context.body),
      decisionContextToken: context.body.decisionContextToken,
      ...(reason === undefined ? {} : { reason }),
    }).expect(201);
    return { context: context.body, decision: response.body };
  };

  // =====================================================================
  // FIXTURE
  // =====================================================================

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    appPrisma = app.get(PrismaService);
    tokens = app.get(GhxDecisionContextTokenService);

    const passwordHash = await bcrypt.hash(PASSWORD, 10);

    const org = await prisma.organization.create({
      data: { name: `${tag} Org`, type: 'COMPANY' },
    });
    const orgB = await prisma.organization.create({
      data: { name: `${tag} Org B`, type: 'COMPANY' },
    });
    orgId = org.id;
    orgBId = orgB.id;

    const workspace = await prisma.workspace.create({
      data: { name: `${tag} WS`, organizationId: orgId },
    });
    const workspaceB = await prisma.workspace.create({
      data: { name: `${tag} WS B`, organizationId: orgBId },
    });
    workspaceId = workspace.id;
    workspaceBId = workspaceB.id;

    const project = await prisma.project.create({
      data: {
        workspaceId,
        organizationId: orgId,
        code: `${tag}-P1`,
        name: `${tag} Project Satu`,
        status: 'PLANNED',
      },
    });
    const projectTwo = await prisma.project.create({
      data: {
        workspaceId,
        organizationId: orgId,
        code: `${tag}-P2`,
        name: `${tag} Project Dua`,
        status: 'PLANNED',
      },
    });
    const projectB = await prisma.project.create({
      data: {
        workspaceId: workspaceBId,
        organizationId: orgBId,
        code: `${tag}-PB`,
        name: `${tag} Project Tetangga`,
        status: 'PLANNED',
      },
    });
    projectId = project.id;
    projectTwoId = projectTwo.id;
    projectBId = projectB.id;

    const region = await prisma.region.create({
      data: { code: `${tag}-REG`, name: `${tag} Region`, isActive: true },
    });
    regionId = region.id;

    // ---- BOQ working drafts ----
    const makeStructure = async (pid: string) =>
      prisma.boqStructure.create({
        data: {
          projectId: pid,
          name: WORKING_DRAFT_STRUCTURE_NAME,
          version: 1,
          status: 'DRAFT',
        },
      });
    structureId = (await makeStructure(projectId)).id;
    structureTwoId = (await makeStructure(projectTwoId)).id;
    structureBId = (await makeStructure(projectBId)).id;

    const makeItem = async (
      structure: string,
      key: string,
      wbsCode: string,
      quantity = '2.000000',
    ) => {
      const row = await prisma.boqItem.create({
        data: {
          boqStructureId: structure,
          wbsCode,
          name: `${tag} ${key}`,
          itemType: 'WORK_ITEM',
          quantity,
          unit: 'M1',
        },
      });
      item[key] = row.id;
      return row.id;
    };
    const itemKeys = [
      'down',
      'mix',
      'machine',
      'concSame',
      'concDiff',
      'hostile',
      'history',
      'twin',
      'global',
      'bulk',
    ];
    for (const [index, key] of itemKeys.entries()) {
      await makeItem(structureId, key, `1.${index + 1}`);
    }
    await makeItem(structureTwoId, 'downTwo', '1.1');
    await makeItem(structureBId, 'globalB', '1.1');

    // ---- permissions / roles / actors ----
    const ensurePermission = async (code: string) => {
      const existing = await prisma.permission.findUnique({ where: { code } });
      if (existing) return existing;
      const created = await prisma.permission.create({
        data: { code, name: `${tag} ${code}`, description: 'GHX-01 E2E fixture' },
      });
      createdPermissionIds.push(created.id);
      return created;
    };
    const codes = [
      'PROJECT_VIEW',
      'RAB_VIEW',
      'RAB_DRAFT_EDIT',
      'AHSP_VIEW',
      'AHSP_RESOURCE_IDENTITY_DECIDE',
      'BASIC_PRICE_VIEW',
      'BASIC_PRICE_VERIFY',
      'BASIC_PRICE_PUBLISH',
    ];
    const permission: Record<string, string> = {};
    for (const code of codes) {
      permission[code] = (await ensurePermission(code)).id;
    }

    const makeRole = (suffix: string, ws: string, permissionIds: string[]) =>
      prisma.role.create({
        data: {
          workspaceId: ws,
          code: `${tag}_${suffix}`,
          name: `${tag} ${suffix}`,
          rolePermissions: {
            create: permissionIds.map((permissionId) => ({ permissionId })),
          },
        },
      });

    const projectStack = [
      permission.PROJECT_VIEW,
      permission.RAB_VIEW,
      permission.RAB_DRAFT_EDIT,
      permission.AHSP_VIEW,
      permission.BASIC_PRICE_VIEW,
    ];
    const [
      roleDecider,
      roleNoDecide,
      roleVerifier,
      rolePublisher,
      roleForeign,
    ] = await Promise.all([
      makeRole('DECIDER', workspaceId, [
        ...projectStack,
        permission.AHSP_RESOURCE_IDENTITY_DECIDE,
      ]),
      makeRole('NODECIDE', workspaceId, projectStack),
      makeRole('VERIFIER', workspaceId, [permission.BASIC_PRICE_VERIFY]),
      makeRole('PUBLISHER', workspaceId, [permission.BASIC_PRICE_PUBLISH]),
      makeRole('FOREIGN', workspaceBId, [
        ...projectStack,
        permission.AHSP_RESOURCE_IDENTITY_DECIDE,
      ]),
    ]);

    const createActor = async (
      suffix: string,
      ws: string,
      roleId: string,
      assignedProjectIds: string[],
    ) => {
      const email = `${tag}.${suffix}@test.local`.toLowerCase();
      const account = await prisma.account.create({
        data: { email, passwordHash, displayName: suffix, status: 'ACTIVE' },
      });
      accountIds.push(account.id);
      const membership = await prisma.workspaceMembership.create({
        data: {
          accountId: account.id,
          workspaceId: ws,
          status: 'ACTIVE',
          membershipRoles: { create: [{ roleId }] },
        },
      });
      membershipIds.push(membership.id);
      const user = await prisma.user.create({
        data: {
          workspaceMembershipId: membership.id,
          workspaceId: ws,
          fullName: suffix,
          status: 'ACTIVE',
        },
      });
      for (const [index, pid] of assignedProjectIds.entries()) {
        await prisma.projectAssignment.create({
          data: {
            workspaceMembershipId: membership.id,
            projectId: pid,
            roleInProject: 'MEMBER',
            isPrimaryAssignment: index === 0,
            status: 'ASSIGNED',
          },
        });
      }
      return { accountId: account.id, email, userId: user.id };
    };

    const decider = await createActor('decider', workspaceId, roleDecider.id, [
      projectId,
      projectTwoId,
    ]);
    const deciderTwo = await createActor(
      'decider-two',
      workspaceId,
      roleDecider.id,
      [projectId],
    );
    const noDecide = await createActor('no-decide', workspaceId, roleNoDecide.id, [
      projectId,
    ]);
    const unassigned = await createActor(
      'unassigned',
      workspaceId,
      roleDecider.id,
      [],
    );
    const foreign = await createActor('foreign', workspaceBId, roleForeign.id, [
      projectBId,
    ]);
    const verifier = await createActor('verifier', workspaceId, roleVerifier.id, []);
    const publisher = await createActor(
      'publisher',
      workspaceId,
      rolePublisher.id,
      [],
    );
    deciderAccountId = decider.accountId;

    [
      deciderToken,
      deciderTwoToken,
      noDecideToken,
      unassignedToken,
      foreignToken,
      verifierToken,
      publisherToken,
    ] = await Promise.all([
      login(decider.email),
      login(deciderTwo.email),
      login(noDecide.email),
      login(unassigned.email),
      login(foreign.email),
      login(verifier.email),
      login(publisher.email),
    ]);

    // ---- ResourceCatalog ----
    //
    // Every ambiguity below is a REAL one: two rows the machine may not choose
    // between, never a fabricated duplicate. "m1" and "m'" are two spellings the
    // shipped alias catalogue both prove to canonical M1, so the source's own
    // unit cannot separate them — which is precisely the question only a human
    // can answer.
    const makeCatalog = async (
      key: string,
      name: string,
      baseUnit: string,
      ws: string | null = workspaceId,
      type = 'MATERIAL',
    ) => {
      const row = await prisma.resourceCatalog.create({
        data: {
          workspaceId: ws,
          name,
          type: type as never,
          baseUnit,
          status: 'ACTIVE',
        },
      });
      catalog[key] = row.id;
      return row.id;
    };

    await makeCatalog('besiM1', `Besi${tag}`, 'm1');
    await makeCatalog('besiMPrime', `Besi${tag}`, "m'");
    await makeCatalog('twinM1', `Besi${tag}`, 'm1', workspaceBId);
    await makeCatalog('twinMPrime', `Besi${tag}`, "m'", workspaceBId);
    await makeCatalog('semenSak', `Semen${tag}`, 'sak');
    await makeCatalog('semenKg', `Semen${tag}`, 'kg');
    await makeCatalog('mortarM3', `Mortar${tag}`, 'm3');
    await makeCatalog('mortarKg', `Mortar${tag}`, 'kg');
    await makeCatalog('pasir', `Pasir${tag}`, 'm3');
    await makeCatalog('kerikil', `Kerikil${tag}`, 'm3');
    await makeCatalog('hostilM1', `Hostil${tag}`, 'm1');
    await makeCatalog('hostilMPrime', `Hostil${tag}`, "m'");
    await makeCatalog('riwayatM1', `Riwayat${tag}`, 'm1');
    await makeCatalog('riwayatMPrime', `Riwayat${tag}`, "m'");
    await makeCatalog('alien', `Alien${tag}`, 'm1');

    // ---- AHSP versions ----
    const makeVersion = async (
      key: string,
      owningAhspId: string,
      ws: string | null,
      versionNumber: number,
      resources: Array<{ resourceId: string; baseUnit: string; coefficient?: string }>,
    ) => {
      const created = await prisma.aHSPVersion.create({
        data: {
          ahspId: owningAhspId,
          workspaceId: ws,
          versionNumber,
          status: 'PUBLISHED',
          effectiveDate: new Date('2026-08-01T00:00:00.000Z'),
          outputUnit: 'M1',
          resources: {
            create: resources.map((resource) => ({
              resourceId: resource.resourceId,
              resourceType: 'MATERIAL',
              coefficient: resource.coefficient ?? '3.000000',
              baseUnit: resource.baseUnit,
            })),
          },
        },
        include: { resources: true },
      });
      version[key] = created.id;
      ahspResourceId[key] = Object.fromEntries(
        created.resources.map((resource) => [resource.resourceId, resource.id]),
      );
      return created;
    };

    const ahsp = await prisma.aHSP.create({
      data: {
        workspaceId,
        workType: `${tag} Work`,
        methodType: 'MANUAL',
        locationType: 'GENERAL',
        methodName: tag,
      },
    });
    ahspId = ahsp.id;
    const globalAhsp = await prisma.aHSP.create({
      data: {
        workspaceId: null,
        workType: `${tag} Global Work`,
        methodType: 'MANUAL',
        locationType: 'GENERAL',
        methodName: `${tag}-GLOBAL`,
      },
    });
    globalAhspId = globalAhsp.id;

    await makeVersion('down', ahspId, workspaceId, 1, [
      { resourceId: `Besi${tag}`, baseUnit: 'm' },
    ]);
    await makeVersion('mix', ahspId, workspaceId, 2, [
      { resourceId: `Pasir${tag}`, baseUnit: 'm3' },
      { resourceId: `Semen${tag}`, baseUnit: 'zak' },
      { resourceId: `Hantu${tag}`, baseUnit: 'm3' },
      { resourceId: `Kerikil${tag}`, baseUnit: 'm3' },
    ]);
    await makeVersion('machine', ahspId, workspaceId, 3, [
      { resourceId: `Mortar${tag}`, baseUnit: `${tag}mtr` },
    ]);
    await makeVersion('concSame', ahspId, workspaceId, 4, [
      { resourceId: `Besi${tag}`, baseUnit: 'm' },
    ]);
    await makeVersion('concDiff', ahspId, workspaceId, 5, [
      { resourceId: `Besi${tag}`, baseUnit: 'm' },
    ]);
    await makeVersion('hostile', ahspId, workspaceId, 6, [
      { resourceId: `Hostil${tag}`, baseUnit: 'm' },
    ]);
    await makeVersion('history', ahspId, workspaceId, 7, [
      { resourceId: `Riwayat${tag}`, baseUnit: 'm' },
    ]);
    await makeVersion('twin', ahspId, workspaceId, 8, [
      { resourceId: `Besi${tag}`, baseUnit: 'm' },
    ]);
    await makeVersion('global', globalAhspId, null, 1, [
      { resourceId: `Besi${tag}`, baseUnit: 'm' },
    ]);

    // ---- 40-resource version for the boundedness proof ----
    const bulkResources: Array<{ resourceId: string; baseUnit: string }> = [];
    const bulkCatalogData: Array<{
      workspaceId: string;
      name: string;
      type: 'MATERIAL';
      baseUnit: string;
      status: string;
    }> = [];
    for (let index = 1; index <= 35; index += 1) {
      const name = `Massal${index}x${tag}`;
      bulkResources.push({ resourceId: name, baseUnit: 'm3' });
      bulkCatalogData.push({
        workspaceId,
        name,
        type: 'MATERIAL',
        baseUnit: 'm3',
        status: 'ACTIVE',
      });
    }
    for (let index = 1; index <= 5; index += 1) {
      const name = `Ambigu${index}x${tag}`;
      bulkResources.push({ resourceId: name, baseUnit: 'm' });
      bulkCatalogData.push({
        workspaceId,
        name,
        type: 'MATERIAL',
        baseUnit: 'm1',
        status: 'ACTIVE',
      });
      bulkCatalogData.push({
        workspaceId,
        name,
        type: 'MATERIAL',
        baseUnit: "m'",
        status: 'ACTIVE',
      });
    }
    await prisma.resourceCatalog.createMany({ data: bulkCatalogData as never });
    await makeVersion('bulk', ahspId, workspaceId, 9, bulkResources);

    // ---- Basic Prices ----
    //
    // The Besi price is built through the REAL submission -> ACCEPT -> PUBLISH
    // chain, because the RAB persistence gate re-proves that chain end to end.
    // The rest are ordinary published catalog prices: they only need to be
    // selectable, never persistable.
    const besiCatalogId = catalog.besiM1;
    const submission = await prisma.priceSubmission.create({
      data: {
        workspaceId,
        organizationId: orgId,
        resourceId: besiCatalogId,
        regionId,
        sourceOrigin: 'SUPPLIER',
        sourceType: 'MARKET_SURVEY',
        status: 'UNDER_REVIEW',
      },
    });
    submissionId = submission.id;
    const revision = await prisma.priceSubmissionRevision.create({
      data: {
        submissionId: submission.id,
        revisionNumber: 1,
        value: '100000.00',
        effectiveDate: new Date('2026-01-01T00:00:00.000Z'),
        validationPassed: true,
      },
    });
    await prisma.priceSubmission.update({
      where: { id: submission.id },
      data: { currentRevisionId: revision.id },
    });
    const review = await prisma.priceSubmissionReview.create({
      data: {
        priceSubmissionId: submission.id,
        workspaceId,
        organizationId: orgId,
        slaState: 'OPEN',
        openedAt: new Date(),
      },
    });
    reviewId = review.id;

    const acceptResponse = await request(http())
      .post(`/basic-price-reviews/${reviewId}/accept`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .set('x-workspace-id', workspaceId)
      .send({})
      .expect(201);
    besiBasicPriceId = acceptResponse.body.basicPriceId;

    await request(http())
      .post(`/basic-price-publications/${besiBasicPriceId}/publish`)
      .set('Authorization', `Bearer ${publisherToken}`)
      .set('x-workspace-id', workspaceId)
      .expect(201);

    const simplePrice = async (resourceCatalogId: string, value: string) => {
      const row = await prisma.basicPrice.create({
        data: {
          workspaceId,
          resourceId: resourceCatalogId,
          regionId,
          effectiveDate: new Date('2026-01-01T00:00:00.000Z'),
          value,
          sourceOrigin: 'SUPPLIER',
          sourceType: 'MARKET_SURVEY',
          verificationStatus: 'PUBLISHED',
          freshnessStatus: 'CURRENT',
          status: 'PUBLISHED',
        },
      });
      simpleBasicPriceIds.push(row.id);
      return row.id;
    };
    await simplePrice(catalog.pasir, '250000.00');
    await simplePrice(catalog.kerikil, '300000.00');
    await simplePrice(catalog.mortarM3, '4752.00');
    await simplePrice(catalog.mortarKg, '17.00');
    await simplePrice(catalog.semenSak, '75000.00');
  }, 180_000);

  afterAll(async () => {
    const allProjectIds = [projectId, projectTwoId, projectBId].filter(Boolean);
    const allAhspIds = [ahspId, globalAhspId].filter(Boolean);
    const allStructureIds = [structureId, structureTwoId, structureBId].filter(
      Boolean,
    );

    // Decision memory first, newest generation first: previousDecisionId is a
    // RESTRICT self-reference, so a parent may only be removed after its child.
    const decisions = await prisma.ahspResourceIdentityDecision.findMany({
      where: { workspaceId: { in: [workspaceId, workspaceBId].filter(Boolean) } },
      orderBy: { generation: 'desc' },
      select: { id: true },
    });
    for (const decision of decisions) {
      await prisma.ahspResourceIdentityDecision.delete({
        where: { id: decision.id },
      });
    }

    await prisma.rabDocument.deleteMany({
      where: { projectId: { in: allProjectIds } },
    });
    await prisma.boqItem.deleteMany({
      where: { boqStructureId: { in: allStructureIds } },
    });
    await prisma.boqStructure.deleteMany({
      where: { projectId: { in: allProjectIds } },
    });
    await prisma.projectAhspResourceResolution.deleteMany({
      where: { occurrence: { projectId: { in: allProjectIds } } },
    });
    await prisma.projectAhspOccurrence.deleteMany({
      where: { projectId: { in: allProjectIds } },
    });
    await prisma.aHSPResource.deleteMany({
      where: { ahspVersion: { ahspId: { in: allAhspIds } } },
    });
    await prisma.aHSPVersion.deleteMany({ where: { ahspId: { in: allAhspIds } } });
    await prisma.aHSP.deleteMany({ where: { id: { in: allAhspIds } } });

    if (besiBasicPriceId) {
      await prisma.basicPricePublicationAudit.deleteMany({
        where: { basicPriceId: besiBasicPriceId },
      });
    }
    await prisma.basicPrice.deleteMany({
      where: {
        id: { in: [...simpleBasicPriceIds, besiBasicPriceId].filter(Boolean) },
      },
    });
    if (reviewId) {
      await prisma.priceSubmissionReviewDecision.deleteMany({ where: { reviewId } });
      await prisma.priceSubmissionReview.deleteMany({ where: { id: reviewId } });
    }
    if (submissionId) {
      await prisma.priceSubmissionAudit.deleteMany({ where: { submissionId } });
      await prisma.priceSubmissionRevision.deleteMany({ where: { submissionId } });
      await prisma.priceSubmission.deleteMany({ where: { id: submissionId } });
    }
    await prisma.resourceCatalog.deleteMany({
      where: { workspaceId: { in: [workspaceId, workspaceBId].filter(Boolean) } },
    });
    if (createdUnitAliasIds.length > 0) {
      await prisma.unitAlias.deleteMany({ where: { id: { in: createdUnitAliasIds } } });
    }
    if (regionId) await prisma.region.deleteMany({ where: { id: regionId } });

    await prisma.projectAssignment.deleteMany({
      where: { workspaceMembershipId: { in: membershipIds } },
    });
    await prisma.user.deleteMany({
      where: { workspaceMembershipId: { in: membershipIds } },
    });
    await prisma.workspaceMembership.deleteMany({
      where: { id: { in: membershipIds } },
    });
    await prisma.role.deleteMany({ where: { code: { startsWith: tag } } });
    await prisma.permission.deleteMany({
      where: { id: { in: createdPermissionIds } },
    });
    await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.project.deleteMany({ where: { id: { in: allProjectIds } } });
    await prisma.workspace.deleteMany({
      where: { id: { in: [workspaceId, workspaceBId].filter(Boolean) } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [orgId, orgBId].filter(Boolean) } },
    });

    await app.close();
    await prisma.$disconnect();
  }, 180_000);

  // =====================================================================
  // 1. THE CORE INTEGRATED LIFECYCLE
  // =====================================================================

  describe('A. core lifecycle — occurrence N -> governed decision -> normal action -> N+1', () => {
    let occurrenceN: string;
    let occurrenceNSnapshot: unknown;
    let resolutionN: string;
    let subjectId: string;
    let decisionId: string;
    let occurrenceNPlus1: string;

    it('baseline — the normal product action produces occurrence N with a legitimate human-decidable ambiguity', async () => {
      const response = await select(item.down, version.down, `${tag}-down-1`).expect(
        201,
      );
      occurrenceN = response.body.id;
      subjectId = ahspResourceId.down[`Besi${tag}`];

      expect(response.body).toMatchObject({
        generation: 1,
        previousOccurrenceId: null,
        resolutionPolicyVersion: E1A_RESOLUTION_POLICY_VERSION,
      });

      const resolution = resolutionFor(response.body, `Besi${tag}`);
      resolutionN = resolution.id;
      expect(resolution.status).toBe('NEEDS_REVIEW');
      expect(resolution.resourceCatalogId).toBeNull();
      expect(resolution.reasonCodes).toEqual(
        expect.arrayContaining([
          'MULTIPLE_CANDIDATES_NEEDS_REVIEW',
          'UNIT_CONTEXT_MULTIPLE_MATCHING_REPRESENTATIONS',
        ]),
      );

      const boqItem = await prisma.boqItem.findUniqueOrThrow({
        where: { id: item.down },
      });
      expect(boqItem.workingOccurrenceId).toBe(occurrenceN);
      expect(boqItem.calculationOccurrenceId).toBeNull();

      occurrenceNSnapshot = await snapshotOccurrence(occurrenceN);
    }, 120_000);

    it('STEP A — READ issues a bounded, signed decision context for exactly the legitimate candidates', async () => {
      const response = await readContext(resolutionN).expect(200);

      expect(response.body.humanDecidable).toBe(true);
      expect(response.body.currentDecision).toBeNull();
      expect(response.body.resource).toEqual({
        statedName: `Besi${tag}`,
        statedType: 'MATERIAL',
        statedUnit: 'm',
      });
      expect(
        response.body.candidates.map((candidate: any) => candidate.resourceCatalogId).sort(),
      ).toEqual([catalog.besiM1, catalog.besiMPrime].sort());
      expect(typeof response.body.decisionContextToken).toBe('string');

      // The context is a real signed capability bound to this exact subject.
      const claims = tokens.verify(response.body.decisionContextToken, {
        workspaceId,
        ahspResourceId: subjectId,
        originResolutionId: resolutionN,
        actorAccountId: deciderAccountId,
        resolutionPolicyVersion: E1A_RESOLUTION_POLICY_VERSION,
      });
      expect(claims.expectedGeneration).toBe(0);
      expect(claims.candidateContextDigest).toBe(
        candidateContextDigest(response.body.candidates),
      );
      expect(claims.expiresAt - claims.issuedAt).toBe(
        GHX_DECISION_CONTEXT_TTL_SECONDS,
      );

      // READING NEVER WRITES.
      expect(await decisionRows(subjectId)).toHaveLength(0);
      expect(await snapshotOccurrence(occurrenceN)).toEqual(occurrenceNSnapshot);
    });

    it('STEP B — WRITE records governed memory, derives the actor server-side, and touches no occurrence', async () => {
      const { decision } = await readThenDecide(
        resolutionN,
        () => catalog.besiM1,
        'Sumber B1 menyebut meter panjang tunggal.',
      );

      decisionId = decision.decisionId;
      expect(decision).toMatchObject({
        generation: 1,
        idempotent: false,
        selectedResourceCatalogId: catalog.besiM1,
      });
      // The decision reports the truth AFTER it, produced by re-running the one
      // pipeline — never asserted from the human's choice.
      expect(decision.identityAfterDecision).toEqual({
        status: 'RESOLVED',
        authority: 'VERIFIED_MAPPING_REUSED',
        resolvedResourceCatalogId: catalog.besiM1,
      });

      const rows = await decisionRows(subjectId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        workspaceId,
        ahspResourceId: subjectId,
        selectedResourceCatalogId: catalog.besiM1,
        generation: 1,
        previousDecisionId: null,
        candidateCountAtDecision: 2,
        resolutionPolicyVersion: E1A_RESOLUTION_POLICY_VERSION,
        // SERVER-DERIVED: the client never stated who it was.
        decidedByAccountId: deciderAccountId,
        originProjectId: projectId,
        originProjectName: `${tag} Project Satu`,
        originOccurrenceId: occurrenceN,
        originResolutionId: resolutionN,
        originAhspVersionId: version.down,
      });

      // NO occurrence, resolution or BoQ pointer moved.
      expect(await snapshotOccurrence(occurrenceN)).toEqual(occurrenceNSnapshot);
      const boqItem = await prisma.boqItem.findUniqueOrThrow({
        where: { id: item.down },
      });
      expect(boqItem.workingOccurrenceId).toBe(occurrenceN);
      expect(
        await prisma.projectAhspOccurrence.count({ where: { projectId } }),
      ).toBe(1);
    });

    it('STEP C1 — the SAME idempotency key replays occurrence N; no evaluation, no N+1', async () => {
      const response = await select(item.down, version.down, `${tag}-down-1`).expect(
        201,
      );
      expect(response.body.id).toBe(occurrenceN);
      expect(response.body.generation).toBe(1);
      expect(await snapshotOccurrence(occurrenceN)).toEqual(occurrenceNSnapshot);
      expect(
        await prisma.projectAhspOccurrence.count({ where: { projectId } }),
      ).toBe(1);
    });

    it('STEP C2 — a NEW idempotency key re-evaluates through the existing lifecycle and appends occurrence N+1', async () => {
      const response = await select(item.down, version.down, `${tag}-down-2`).expect(
        201,
      );
      occurrenceNPlus1 = response.body.id;

      expect(occurrenceNPlus1).not.toBe(occurrenceN);
      expect(response.body.generation).toBe(2);
      expect(response.body.previousOccurrenceId).toBe(occurrenceN);

      // THE SAME orchestrator and the SAME kernel consumed the governed memory.
      const resolution = resolutionFor(response.body, `Besi${tag}`);
      expect(resolution.status).toBe('RESOLVED');
      expect(resolution.resourceCatalogId).toBe(catalog.besiM1);
      expect(resolution.selectedBasicPriceId).toBe(besiBasicPriceId);
      expect(resolution.reasonCodes).toEqual(
        expect.arrayContaining(['VERIFIED_MAPPING_REUSED']),
      );
      // TRUTHFUL PROVENANCE: the sentence says human-verified, not machine-proven.
      expect(resolution.explanation).toContain('DIVERIFIKASI MANUSIA');
      expect(resolution.explanation).toContain(deciderAccountId);
      expect(resolution.explanation).toContain('generasi 1');

      // HISTORY IS NOT REWRITTEN.
      expect(await snapshotOccurrence(occurrenceN)).toEqual(occurrenceNSnapshot);
      const rows = await decisionRows(subjectId);
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(decisionId);
    }, 120_000);

    it('STEP D — the working pointer follows the newest lawful evaluation; the calculation pointer does not yet exist', async () => {
      const boqItem = await prisma.boqItem.findUniqueOrThrow({
        where: { id: item.down },
      });
      // workingOccurrenceId = "the evaluation this line is currently working
      // from". selectForBoqItem re-points it on every real evaluation.
      expect(boqItem.workingOccurrenceId).toBe(occurrenceNPlus1);
      // calculationOccurrenceId = "the evaluation the persisted money was
      // derived from". Nothing has been persisted yet, so it is honestly null.
      expect(boqItem.calculationOccurrenceId).toBeNull();
      expect(boqItem.unitPrice).toBeNull();
    });

    it('STEP E1 — the Cost Kernel prices this line from the working occurrence, i.e. from N+1', async () => {
      const response = await request(http())
        .get(`/projects/${projectId}/boq/items/${item.down}/cost-calculation`)
        .set('Authorization', `Bearer ${deciderToken}`)
        .expect(200);

      expect(response.body.status).toBe('CALCULATED');
      expect(response.body.occurrenceId).toBe(occurrenceNPlus1);
      // coefficient 3 x price 100000 = 300000 per output unit; volume 2.
      expect(response.body.ahspUnitPrice).toBe('300000');
      expect(response.body.lineTotal).toBe('600000');
    });

    it('STEP E2 — persisting moves the truth to calculationOccurrenceId = N+1 and clears the working pointer', async () => {
      const response = await request(http())
        .post(
          `/projects/${projectId}/boq/items/${item.down}/cost-calculation/persist`,
        )
        .set('Authorization', `Bearer ${deciderToken}`)
        .send({ calculationAsOfDate: ASOF })
        .expect(201);

      expect(response.body.calculationOccurrenceId).toBe(occurrenceNPlus1);

      const boqItem = await prisma.boqItem.findUniqueOrThrow({
        where: { id: item.down },
      });
      expect(boqItem.calculationOccurrenceId).toBe(occurrenceNPlus1);
      expect(boqItem.workingOccurrenceId).toBeNull();
      expect(boqItem.priceOrigin).toBe('SERVER_COST_KERNEL');
      expect(boqItem.unitPrice?.toString()).toBe('300000');
      expect(boqItem.lineTotal?.toString()).toBe('600000');

      // Occurrence N is STILL untouched, after the entire downstream flow.
      expect(await snapshotOccurrence(occurrenceN)).toEqual(occurrenceNSnapshot);
    }, 120_000);

    it('STEP E3 — the persisted line re-proves itself through calculationOccurrenceId, carrying the human provenance', async () => {
      const response = await request(http())
        .get(`/projects/${projectId}/boq/items/${item.down}/persisted-calculation`)
        .set('Authorization', `Bearer ${deciderToken}`)
        .expect(200);

      expect(response.body.status).toBe('VERIFIED');
      expect(response.body.provenance.calculationOccurrenceId).toBe(
        occurrenceNPlus1,
      );
      expect(response.body.provenance.occurrenceGeneration).toBe(2);
      expect(response.body.stored.unitPrice).toBe('300000.00');
      expect(response.body.recomputed.unitPrice).toBe('300000.00');
      expect(response.body.integrity.unitPriceMatches).toBe(true);
      // The human provenance survives all the way into the persisted line's own
      // per-resource breakdown.
      expect(response.body.resources[0].reasonCodes).toEqual(
        expect.arrayContaining(['VERIFIED_MAPPING_REUSED']),
      );

      // And the read is genuinely following the CALCULATION pointer: the working
      // pointer is null, so the Cost Kernel route can no longer price this line.
      const working = await request(http())
        .get(`/projects/${projectId}/boq/items/${item.down}/cost-calculation`)
        .set('Authorization', `Bearer ${deciderToken}`)
        .expect(200);
      expect(working.body.status).not.toBe('CALCULATED');
      expect(working.body.reason).toBe('OCCURRENCE_NOT_FOUND');
    });

it('STEP E4 — the draft RAB read derives price-source authority from that SAME calculation occurrence', async () => {
      const response = await request(http())
        .get(`/projects/${projectId}/boq/draft`)
        .set('Authorization', `Bearer ${deciderToken}`)
        .expect(200);

      const row = response.body.items.find(
        (entry: any) => entry.id === item.down,
      );
      expect(row.calculationOccurrenceId).toBe(occurrenceNPlus1);
      expect(row.workingOccurrenceId).toBeNull();

      // Derived by EXPLICIT ID from that occurrence's own frozen facts — never
      // from the amount, the name, or "the project's latest occurrence". This
      // is the sixth and last non-type reader of either pointer in src/, so the
      // whole consumer set is now proven at runtime rather than inferred.
      expect(row.sourceAuthority).toMatchObject({
        privateBasicPriceCount: 0,
        catalogBasicPriceCount: 1,
      });
    });

    it('STEP F — sequential idempotency: the same semantic decision again changes nothing', async () => {
      const before = await decisionRows(subjectId);
      const context = await readContext(resolutionN).expect(200);
      // Memory now answers the question, so the machine-plus-memory pipeline has
      // settled it and no NEW question is offered.
      expect(context.body.humanDecidable).toBe(false);
      expect(context.body.decisionContextToken).toBeNull();
      expect(context.body.reason).toContain('keputusan manusia');

      // Replaying the ORIGINAL command — the exact context the first decision
      // was made under, the same candidate — is idempotent rather than a second
      // generation. Everything else the write needs, it re-derives itself.
      const replayToken = tokens.issue({
        workspaceId,
        ahspResourceId: subjectId,
        originResolutionId: resolutionN,
        actorAccountId: deciderAccountId,
        resolutionPolicyVersion: E1A_RESOLUTION_POLICY_VERSION,
        expectedGeneration: 0,
        candidateContextDigest: before[0].candidateContextDigest,
      });
      const replay = await decide(resolutionN, {
        selectedResourceCatalogId: catalog.besiM1,
        decisionContextToken: replayToken,
      }).expect(201);

      expect(replay.body).toMatchObject({
        decisionId: before[0].id,
        generation: 1,
        idempotent: true,
        selectedResourceCatalogId: catalog.besiM1,
      });

      const after = await decisionRows(subjectId);
      expect(after).toHaveLength(1);
      expect(JSON.parse(JSON.stringify(after))).toEqual(
        JSON.parse(JSON.stringify(before)),
      );
      expect(await snapshotOccurrence(occurrenceN)).toEqual(occurrenceNSnapshot);
      expect(
        await prisma.projectAhspOccurrence.count({ where: { projectId } }),
      ).toBe(2);
    });
  });

  // =====================================================================
  // 2. MACHINE-FIRST AND UNIT INDEPENDENCE
  // =====================================================================

  describe('B. machine-first and Unit independence', () => {
    let resolutionId: string;
    let subjectId: string;

    it('a human may settle a Mortar ambiguity the machine cannot', async () => {
      const response = await select(
        item.machine,
        version.machine,
        `${tag}-machine-1`,
      ).expect(201);
      subjectId = ahspResourceId.machine[`Mortar${tag}`];
      resolutionId = resolutionFor(response.body, `Mortar${tag}`).id;

      const { decision } = await readThenDecide(
        resolutionId,
        () => catalog.mortarM3,
        'B4-B8 memakai mortar per m3.',
      );
      expect(decision.selectedResourceCatalogId).toBe(catalog.mortarM3);
    }, 120_000);

    it('UNIT INDEPENDENCE — identity becomes human-governed while the Unit truth stays unproved, so the line is not falsely usable', async () => {
      const response = await select(
        item.machine,
        version.machine,
        `${tag}-machine-2`,
      ).expect(201);
      const resolution = resolutionFor(response.body, `Mortar${tag}`);

      // The IDENTITY question was answered, and the row says so in the one
      // place the composed identity+price story lives. (`reasonCodes` here
      // carry the PRICE kernel's verdict only: when the source unit itself is
      // unprovable that kernel returns UNIT_NOT_SUPPORTED before it reports any
      // identity authority — pre-existing behaviour, identical for a machine
      // exact-name match, and the identity truth is not lost because the
      // orchestrator composes both explanations into the persisted row.)
      expect(resolution.explanation).toContain('DIVERIFIKASI MANUSIA');
      expect(resolution.explanation).toContain(catalog.mortarM3);
      expect(resolution.explanation).toContain(
        'Kebenaran unit dan harga tidak ikut',
      );
      // ...and the UNIT question was NOT. No invented certainty reaches the
      // Cost Kernel: no catalog id, no price, no canonical unit is written.
      expect(resolution.status).not.toBe('RESOLVED');
      expect(resolution.resourceCatalogId).toBeNull();
      expect(resolution.selectedBasicPriceId).toBeNull();
      expect(resolution.adaptedPriceValue).toBeNull();
      expect(resolution.canonicalUnit).toBeNull();
      expect(resolution.reasonCodes).toEqual(['UNIT_NOT_SUPPORTED']);
      expect(resolution.explanation).toContain('Kamus Unit');

      // And the RAB persistence gate refuses the line rather than pricing it.
      await request(http())
        .post(
          `/projects/${projectId}/boq/items/${item.machine}/cost-calculation/persist`,
        )
        .set('Authorization', `Bearer ${deciderToken}`)
        .send({ calculationAsOfDate: ASOF })
        .expect(409);
    }, 120_000);

    it('MACHINE FIRST — once the Unit Kernel can prove the source unit, the machine verdict wins over the recorded human memory', async () => {
      // A real, ordinary event: the alias catalogue gains the spelling this
      // source used, and it canonicalizes to KG — not to the m3 representation
      // the human had chosen while nothing could be proven.
      const kg = await prisma.unitDefinition.findFirstOrThrow({
        where: { code: 'KG' },
      });
      const alias = await prisma.unitAlias.create({
        data: {
          rawAlias: `${tag}mtr`,
          normalizedAlias: `${tag}mtr`.toLowerCase(),
          unitDefinitionId: kg.id,
          context: null,
          isActive: true,
        },
      });
      createdUnitAliasIds.push(alias.id);

      const response = await select(
        item.machine,
        version.machine,
        `${tag}-machine-3`,
      ).expect(201);
      const resolution = resolutionFor(response.body, `Mortar${tag}`);

      expect(resolution.status).toBe('RESOLVED');
      // KG WINS. The human memory named the m3 row and is not applied at all.
      expect(resolution.resourceCatalogId).toBe(catalog.mortarKg);
      expect(resolution.reasonCodes).toEqual(
        expect.arrayContaining(['EXACT_RESOURCE_NAME_MATCH_WITH_UNIT_CONTEXT']),
      );
      expect(resolution.reasonCodes).not.toContain('VERIFIED_MAPPING_REUSED');
      expect(resolution.explanation).not.toContain('DIVERIFIKASI MANUSIA');

      // The memory is not deleted, corrected or resurrected — it is simply not
      // reached, because the machine settled the question first.
      const rows = await decisionRows(subjectId);
      expect(rows).toHaveLength(1);
      expect(rows[0].selectedResourceCatalogId).toBe(catalog.mortarM3);

      // And the READ now states plainly that there is no question to answer.
      const context = await readContext(
        resolutionFor(response.body, `Mortar${tag}`).id,
      ).expect(200);
      expect(context.body.humanDecidable).toBe(false);
      expect(context.body.decisionContextToken).toBeNull();
      expect(context.body.reason).toContain('terbukti otomatis');
    }, 120_000);
  });

  // =====================================================================
  // 3. TOKEN / AUTHORITY / TENANT — ONE HOSTILE MATRIX
  // =====================================================================

  describe('C. hostile token, authority and tenant matrix', () => {
    let resolutionId: string;
    let subjectId: string;
    let occurrenceId: string;
    let occurrenceSnapshot: unknown;
    let validToken: string;
    let validDigest: string;
    /** Set by the single test that is SUPPOSED to write. */
    let lawfulWriteExpected = false;

    const expectNothingHappened = async () => {
      if (lawfulWriteExpected) return;
      expect(await decisionRows(subjectId)).toHaveLength(0);
      expect(await snapshotOccurrence(occurrenceId)).toEqual(occurrenceSnapshot);
      expect(
        await prisma.projectAhspOccurrence.count({
          where: { projectId, ahspVersionId: version.hostile },
        }),
      ).toBe(1);
    };

    beforeAll(async () => {
      const response = await select(
        item.hostile,
        version.hostile,
        `${tag}-hostile-1`,
      ).expect(201);
      occurrenceId = response.body.id;
      resolutionId = resolutionFor(response.body, `Hostil${tag}`).id;
      subjectId = ahspResourceId.hostile[`Hostil${tag}`];
      occurrenceSnapshot = await snapshotOccurrence(occurrenceId);

      const context = await readContext(resolutionId).expect(200);
      validToken = context.body.decisionContextToken;
      validDigest = candidateContextDigest(context.body.candidates);
    }, 120_000);

    afterEach(expectNothingHappened);

    const forge = (over: Record<string, unknown>, nowSeconds?: number) =>
      tokens.issue(
        {
          workspaceId,
          ahspResourceId: subjectId,
          originResolutionId: resolutionId,
          actorAccountId: deciderAccountId,
          resolutionPolicyVersion: E1A_RESOLUTION_POLICY_VERSION,
          expectedGeneration: 0,
          candidateContextDigest: validDigest,
          ...over,
        } as never,
        nowSeconds,
      );

    it('an EXPIRED context is refused', async () => {
      const expired = forge(
        {},
        Math.floor(Date.now() / 1000) - GHX_DECISION_CONTEXT_TTL_SECONDS - 60,
      );
      const response = await decide(resolutionId, {
        selectedResourceCatalogId: catalog.hostilM1,
        decisionContextToken: expired,
      }).expect(401);
      expect(response.body.message).toBe('DECISION_CONTEXT_TOKEN_INVALID');
    });

    it('a MALFORMED context is refused', async () => {
      await decide(resolutionId, {
        selectedResourceCatalogId: catalog.hostilM1,
        decisionContextToken: 'not-a-token',
      }).expect(401);
    });

    it('a BAD SIGNATURE is refused', async () => {
      const [payload, signature] = validToken.split('.');
      const flipped = `${signature.slice(0, -1)}${signature.slice(-1) === 'A' ? 'B' : 'A'}`;
      await decide(resolutionId, {
        selectedResourceCatalogId: catalog.hostilM1,
        decisionContextToken: `${payload}.${flipped}`,
      }).expect(401);
    });

    it('a NORMAL LOGIN JWT cannot substitute for a decision context', async () => {
      await decide(resolutionId, {
        selectedResourceCatalogId: catalog.hostilM1,
        decisionContextToken: deciderToken,
      }).expect(401);
    });

    it('a DECISION CONTEXT cannot substitute for authentication', async () => {
      await request(http())
        .get(
          `/projects/${projectId}/ahsp-occurrences/resource-resolutions/${resolutionId}/identity-decision-context`,
        )
        .set('Authorization', `Bearer ${validToken}`)
        .expect(401);
    });

    it('the WRONG ACTOR cannot spend another human context', async () => {
      await decide(
        resolutionId,
        {
          selectedResourceCatalogId: catalog.hostilM1,
          decisionContextToken: validToken,
        },
        deciderTwoToken,
      ).expect(401);
    });

    it('a context bound to ANOTHER RESOLUTION is refused', async () => {
      const foreignResolution = forge({ originResolutionId: randomUUID() });
      await decide(resolutionId, {
        selectedResourceCatalogId: catalog.hostilM1,
        decisionContextToken: foreignResolution,
      }).expect(401);
    });

    it('a context bound to ANOTHER AHSP SOURCE FACT is refused', async () => {
      const otherSubject = forge({
        ahspResourceId: ahspResourceId.down[`Besi${tag}`],
      });
      await decide(resolutionId, {
        selectedResourceCatalogId: catalog.hostilM1,
        decisionContextToken: otherSubject,
      }).expect(401);
    });

    it('a context bound to ANOTHER WORKSPACE is refused', async () => {
      await decide(resolutionId, {
        selectedResourceCatalogId: catalog.hostilM1,
        decisionContextToken: forge({ workspaceId: workspaceBId }),
      }).expect(401);
    });

    it('a context issued under ANOTHER POLICY is refused', async () => {
      await decide(resolutionId, {
        selectedResourceCatalogId: catalog.hostilM1,
        decisionContextToken: forge({
          resolutionPolicyVersion: 'E1A_SOMETHING_ELSE_V9',
        }),
      }).expect(401);
    });

    it('a STALE CANDIDATE DIGEST is refused as a stale context', async () => {
      const response = await decide(resolutionId, {
        selectedResourceCatalogId: catalog.hostilM1,
        decisionContextToken: forge({
          candidateContextDigest: 'f'.repeat(64),
        }),
      }).expect(409);
      expect(response.body.message).toBe('DECISION_CONTEXT_STALE');
    });

    it('a STALE GENERATION is refused', async () => {
      const response = await decide(resolutionId, {
        selectedResourceCatalogId: catalog.hostilM1,
        decisionContextToken: forge({ expectedGeneration: 7 }),
      }).expect(409);
      expect(response.body.message).toBe('DECISION_GENERATION_STALE');
    });

    it('a candidate the machine never nominated is refused', async () => {
      const response = await decide(resolutionId, {
        selectedResourceCatalogId: catalog.alien,
        decisionContextToken: validToken,
      }).expect(409);
      expect(response.body.message).toBe('CANDIDATE_NOT_LEGITIMATE');
    });

    it('a CHANGED CANDIDATE SET after issuance invalidates the context', async () => {
      const extra = await prisma.resourceCatalog.create({
        data: {
          workspaceId,
          name: `Hostil${tag}`,
          type: 'MATERIAL',
          baseUnit: 'm2',
          status: 'ACTIVE',
        },
      });
      try {
        const response = await decide(resolutionId, {
          selectedResourceCatalogId: catalog.hostilM1,
          decisionContextToken: validToken,
        }).expect(409);
        expect(response.body.message).toBe('DECISION_CONTEXT_STALE');
      } finally {
        await prisma.resourceCatalog.delete({ where: { id: extra.id } });
      }
    });

    it('MACHINE PROOF APPEARING AFTER ISSUANCE prevents the now-obsolete human decision', async () => {
      await prisma.resourceCatalog.update({
        where: { id: catalog.hostilMPrime },
        data: { status: 'INACTIVE' },
      });
      try {
        const response = await decide(resolutionId, {
          selectedResourceCatalogId: catalog.hostilM1,
          decisionContextToken: validToken,
        }).expect(409);
        expect(response.body.message).toBe(
          'NOT_HUMAN_DECIDABLE_IDENTITY_ALREADY_PROVEN',
        );
      } finally {
        await prisma.resourceCatalog.update({
          where: { id: catalog.hostilMPrime },
          data: { status: 'ACTIVE' },
        });
      }
    });

    it('MISSING PERMISSION is refused on both the read and the write', async () => {
      await readContext(resolutionId, noDecideToken).expect(403);
      await decide(
        resolutionId,
        {
          selectedResourceCatalogId: catalog.hostilM1,
          decisionContextToken: validToken,
        },
        noDecideToken,
      ).expect(403);
    });

    it('NO PROJECT ACCESS is refused even with the permission', async () => {
      await readContext(resolutionId, unassignedToken).expect(403);
      await decide(
        resolutionId,
        {
          selectedResourceCatalogId: catalog.hostilM1,
          decisionContextToken: validToken,
        },
        unassignedToken,
      ).expect(403);
    });

    it('ANOTHER TENANT cannot see or spend this subject, and learns nothing about it', async () => {
      // Through the foreign tenant's own project route, the resolution is simply
      // not found — no existence oracle.
      const read = await readContext(resolutionId, foreignToken, projectBId).expect(
        404,
      );
      expect(read.body.message).toBe('RESOLUTION_NOT_FOUND');

      await decide(
        resolutionId,
        {
          selectedResourceCatalogId: catalog.hostilM1,
          decisionContextToken: validToken,
        },
        foreignToken,
        projectBId,
      ).expect(404);

      // And through THIS project's route, the foreign actor has no access at
      // all. ProjectAccessGuard answers 404 rather than 403 here — deliberately
      // the stronger refusal: a tenant is not told that someone else's project
      // exists.
      const denied = await readContext(resolutionId, foreignToken);
      expect([403, 404]).toContain(denied.status);
    });

    it('after the entire hostile matrix, one valid decision still succeeds exactly once', async () => {
      lawfulWriteExpected = true;
      const fresh = await readContext(resolutionId).expect(200);
      expect(fresh.body.humanDecidable).toBe(true);
      const response = await decide(resolutionId, {
        selectedResourceCatalogId: catalog.hostilM1,
        decisionContextToken: fresh.body.decisionContextToken,
      }).expect(201);
      expect(response.body).toMatchObject({ generation: 1, idempotent: false });

      // This one legitimately writes, so the shared invariant is restated here
      // rather than by the blanket afterEach.
      expect(await decisionRows(subjectId)).toHaveLength(1);
      expect(await snapshotOccurrence(occurrenceId)).toEqual(occurrenceSnapshot);
    });
  });

  // =====================================================================
  // 4. REAL CONCURRENCY
  // =====================================================================

  describe('D. real concurrency against the isolated PostgreSQL', () => {
    const race = async (
      versionKey: string,
      itemKey: string,
      rawRef: string,
      candidates: [string, string],
    ) => {
      const occurrence = await select(
        item[itemKey],
        version[versionKey],
        `${tag}-${versionKey}-1`,
      ).expect(201);
      const resolutionId = resolutionFor(occurrence.body, rawRef).id;
      const subjectId = ahspResourceId[versionKey][rawRef];
      const snapshot = await snapshotOccurrence(occurrence.body.id);

      const context = await readContext(resolutionId).expect(200);
      const token = context.body.decisionContextToken;

      const [first, second] = await Promise.all([
        decide(resolutionId, {
          selectedResourceCatalogId: candidates[0],
          decisionContextToken: token,
        }),
        decide(resolutionId, {
          selectedResourceCatalogId: candidates[1],
          decisionContextToken: token,
        }),
      ]);

      return { first, second, subjectId, snapshot, occurrenceId: occurrence.body.id };
    };

    it('IDENTICAL concurrent writes converge on ONE decision, one generation, one history', async () => {
      const { first, second, subjectId, snapshot, occurrenceId } = await race(
        'concSame',
        'concSame',
        `Besi${tag}`,
        [catalog.besiM1, catalog.besiM1],
      );

      expect([first.status, second.status]).toEqual([201, 201]);
      expect(first.body.decisionId).toBe(second.body.decisionId);
      expect(first.body.generation).toBe(1);
      expect(second.body.generation).toBe(1);
      // Exactly one of them created the row; the other reconciled onto it.
      expect([first.body.idempotent, second.body.idempotent].sort()).toEqual([
        false,
        true,
      ]);

      const rows = await decisionRows(subjectId);
      expect(rows).toHaveLength(1);
      expect(rows[0].generation).toBe(1);
      expect(rows[0].previousDecisionId).toBeNull();
      expect(await snapshotOccurrence(occurrenceId)).toEqual(snapshot);
    }, 120_000);

    it('CONFLICTING concurrent writes produce one coherent winner and a truthful refusal for the loser', async () => {
      const { first, second, subjectId, snapshot, occurrenceId } = await race(
        'concDiff',
        'concDiff',
        `Besi${tag}`,
        [catalog.besiM1, catalog.besiMPrime],
      );

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([201, 409]);

      const winner = first.status === 201 ? first : second;
      const loser = first.status === 201 ? second : first;

      expect(winner.body.generation).toBe(1);
      expect(winner.body.idempotent).toBe(false);

      // THE LOSER IS TOLD THE TRUTH ABOUT WHY, AND NEVER SILENTLY SUCCEEDS.
      //
      // Which of these three the loser sees is decided by real scheduling, not
      // by the code, so pinning one would be pinning a race:
      //
      //   DECISION_SUPERSEDED       the loser's REPEATABLE READ snapshot opened
      //                             BEFORE the winner committed, so it derived
      //                             the same next generation, took the unique
      //                             violation on
      //                             ahsp_resource_identity_decisions_subject_generation_key
      //                             (Prisma P2002), and reconciled against the
      //                             winner in a fresh transaction.
      //   DECISION_GENERATION_STALE the snapshot opened AFTER the commit, so it
      //                             saw generation 1 already on record and
      //                             refused before writing anything.
      //   DECISION_CONTEXT_STALE    the candidate context itself moved first.
      //
      // All three are the same law reached by different routes: exactly one
      // authoritative decision, and the loser never overwrites it.
      //
      // MEASURED, not assumed: on this machine against real PostgreSQL 17 the
      // observed route is DECISION_SUPERSEDED — i.e. a genuine unique violation
      // (SQLSTATE 23505, surfaced by Prisma as P2002) really does fire and really
      // is reconciled. Neither 40001 nor P2034 occurred, because the two writers
      // contend on an INDEX rather than on a row either of them updated. The set
      // is kept because the route is scheduling-dependent, not because the
      // outcome is uncertain.
      expect([
        'DECISION_SUPERSEDED',
        'DECISION_GENERATION_STALE',
        'DECISION_CONTEXT_STALE',
      ]).toContain(loser.body.message);

      const rows = await decisionRows(subjectId);
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(winner.body.decisionId);
      expect(rows[0].selectedResourceCatalogId).toBe(
        winner.body.selectedResourceCatalogId,
      );
      expect(rows[0].generation).toBe(1);
      expect(await snapshotOccurrence(occurrenceId)).toEqual(snapshot);
    }, 120_000);
  });

  // =====================================================================
  // 5. HISTORY AND SOURCE SCOPE
  // =====================================================================

  describe('E. decision history, lineage and source scope', () => {
    let resolutionId: string;
    let subjectId: string;
    let generationOne: any;
    let generationTwo: any;
    let thirdCandidateId: string;

    it('generation 1 is recorded for a genuine ambiguity', async () => {
      const occurrence = await select(
        item.history,
        version.history,
        `${tag}-history-1`,
      ).expect(201);
      resolutionId = resolutionFor(occurrence.body, `Riwayat${tag}`).id;
      subjectId = ahspResourceId.history[`Riwayat${tag}`];

      await readThenDecide(resolutionId, () => catalog.riwayatM1, 'Generasi satu.');
      const rows = await decisionRows(subjectId);
      expect(rows).toHaveLength(1);
      generationOne = JSON.parse(JSON.stringify(rows[0]));
      expect(generationOne.generation).toBe(1);
      expect(generationOne.previousDecisionId).toBeNull();
    }, 120_000);

    it('a materially changed candidate context makes the old decision INAPPLICABLE, not wrong', async () => {
      const extra = await prisma.resourceCatalog.create({
        data: {
          workspaceId,
          name: `Riwayat${tag}`,
          type: 'MATERIAL',
          baseUnit: 'm2',
          status: 'ACTIVE',
        },
      });
      thirdCandidateId = extra.id;

      const context = await readContext(resolutionId).expect(200);
      expect(context.body.humanDecidable).toBe(true);
      expect(context.body.candidates).toHaveLength(3);
      expect(context.body.currentDecision).toEqual({
        generation: 1,
        selectedResourceCatalogId: catalog.riwayatM1,
        applicable: false,
      });

      // The stored generation-1 row is untouched by becoming inapplicable.
      const rows = await decisionRows(subjectId);
      expect(JSON.parse(JSON.stringify(rows[0]))).toEqual(generationOne);
    });

    it('generation 2 is APPENDED with previousDecisionId pointing at generation 1', async () => {
      const context = await readContext(resolutionId).expect(200);
      const response = await decide(resolutionId, {
        selectedResourceCatalogId: catalog.riwayatMPrime,
        decisionContextToken: context.body.decisionContextToken,
        reason: 'Generasi dua, konteks berubah.',
      }).expect(201);

      expect(response.body.generation).toBe(2);
      expect(response.body.idempotent).toBe(false);

      const rows = await decisionRows(subjectId);
      expect(rows).toHaveLength(2);
      generationTwo = JSON.parse(JSON.stringify(rows[1]));
      expect(generationTwo.generation).toBe(2);
      expect(generationTwo.previousDecisionId).toBe(generationOne.id);
      expect(generationTwo.selectedResourceCatalogId).toBe(catalog.riwayatMPrime);
      // GENERATION 1 IS IMMUTABLE.
      expect(JSON.parse(JSON.stringify(rows[0]))).toEqual(generationOne);
    });

    it('LATEST-GENERATION-ONLY: the newest decision is consumed and the old one never resurrects', async () => {
      const withThree = await select(
        item.history,
        version.history,
        `${tag}-history-2`,
      ).expect(201);
      const applied = resolutionFor(withThree.body, `Riwayat${tag}`);
      expect(applied.reasonCodes).toEqual(
        expect.arrayContaining(['VERIFIED_MAPPING_REUSED']),
      );
      expect(applied.explanation).toContain('generasi 2');
      expect(applied.explanation).not.toContain('generasi 1');

      // Now put the candidate context back to what generation 1 was made under.
      // Generation 2 stops applying — and generation 1 does NOT come back to
      // life behind it. Reviving a superseded decision would be archaeology.
      await prisma.resourceCatalog.delete({ where: { id: thirdCandidateId } });
      const restored = await select(
        item.history,
        version.history,
        `${tag}-history-3`,
      ).expect(201);
      const resolution = resolutionFor(restored.body, `Riwayat${tag}`);
      expect(resolution.status).toBe('NEEDS_REVIEW');
      expect(resolution.reasonCodes).not.toContain('VERIFIED_MAPPING_REUSED');
      expect(resolution.reasonCodes).toEqual(
        expect.arrayContaining(['MULTIPLE_CANDIDATES_NEEDS_REVIEW']),
      );

      const rows = await decisionRows(subjectId);
      expect(rows).toHaveLength(2);
      expect(JSON.parse(JSON.stringify(rows[0]))).toEqual(generationOne);
      expect(JSON.parse(JSON.stringify(rows[1]))).toEqual(generationTwo);
    }, 120_000);

    it('SAME SOURCE, ANOTHER PROJECT — the memory applies, because the subject is the same source fact', async () => {
      const response = await select(
        item.downTwo,
        version.down,
        `${tag}-down-two-1`,
        deciderToken,
        projectTwoId,
      ).expect(201);

      expect(response.body.generation).toBe(1);
      expect(response.body.previousOccurrenceId).toBeNull();
      const resolution = resolutionFor(response.body, `Besi${tag}`);
      expect(resolution.status).toBe('RESOLVED');
      expect(resolution.resourceCatalogId).toBe(catalog.besiM1);
      expect(resolution.reasonCodes).toEqual(
        expect.arrayContaining(['VERIFIED_MAPPING_REUSED']),
      );
    }, 120_000);

    it('DIFFERENT SOURCE, IDENTICAL SPELLING — the memory does NOT apply', async () => {
      const response = await select(item.twin, version.twin, `${tag}-twin-1`).expect(
        201,
      );
      const resolution = resolutionFor(response.body, `Besi${tag}`);

      // Same workspace, same name, same type, same unit — and a DIFFERENT
      // AHSPResource. Nothing is inherited.
      expect(resolution.status).toBe('NEEDS_REVIEW');
      expect(resolution.resourceCatalogId).toBeNull();
      expect(resolution.reasonCodes).not.toContain('VERIFIED_MAPPING_REUSED');
      expect(
        await decisionRows(ahspResourceId.twin[`Besi${tag}`]),
      ).toHaveLength(0);
    }, 120_000);

    it('DIFFERENT WORKSPACE, SAME GLOBAL SOURCE FACT — the memory does NOT cross the tenant boundary', async () => {
      const globalSubjectId = ahspResourceId.global[`Besi${tag}`];

      // Workspace A decides about the GLOBAL AHSP source fact.
      const mine = await select(item.global, version.global, `${tag}-global-1`).expect(
        201,
      );
      const resolutionId = resolutionFor(mine.body, `Besi${tag}`).id;
      await readThenDecide(resolutionId, () => catalog.besiM1);

      const applied = await select(
        item.global,
        version.global,
        `${tag}-global-2`,
      ).expect(201);
      expect(resolutionFor(applied.body, `Besi${tag}`).reasonCodes).toEqual(
        expect.arrayContaining(['VERIFIED_MAPPING_REUSED']),
      );

      // Workspace B reaches the very same global AHSP source fact and faces the
      // very same ambiguity in its OWN catalog — and inherits nothing.
      const theirs = await select(
        item.globalB,
        version.global,
        `${tag}-global-b-1`,
        foreignToken,
        projectBId,
      ).expect(201);
      const foreignResolution = resolutionFor(theirs.body, `Besi${tag}`);
      expect(foreignResolution.status).toBe('NEEDS_REVIEW');
      expect(foreignResolution.reasonCodes).not.toContain('VERIFIED_MAPPING_REUSED');
      expect(foreignResolution.reasonCodes).toEqual(
        expect.arrayContaining(['MULTIPLE_CANDIDATES_NEEDS_REVIEW']),
      );

      const rows = await prisma.ahspResourceIdentityDecision.findMany({
        where: { ahspResourceId: globalSubjectId },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].workspaceId).toBe(workspaceId);
    }, 180_000);
  });

  // =====================================================================
  // 6. MULTI-ITEM FAIL-CLOSED
  // =====================================================================

  describe('F. mixed multi-resource workflow fails closed per item, never globally', () => {
    let occurrence: any;
    let semenResolutionId: string;

    it('machine-resolved lines continue, the ambiguous one is isolated, the unresolvable one stays unresolved', async () => {
      const response = await select(item.mix, version.mix, `${tag}-mix-1`).expect(201);
      occurrence = response.body;

      const pasir = resolutionFor(occurrence, `Pasir${tag}`);
      const semen = resolutionFor(occurrence, `Semen${tag}`);
      const hantu = resolutionFor(occurrence, `Hantu${tag}`);
      const kerikil = resolutionFor(occurrence, `Kerikil${tag}`);
      semenResolutionId = semen.id;

      // A and D continue, fully and independently.
      expect(pasir.status).toBe('RESOLVED');
      expect(pasir.resourceCatalogId).toBe(catalog.pasir);
      expect(kerikil.status).toBe('RESOLVED');
      expect(kerikil.resourceCatalogId).toBe(catalog.kerikil);

      // B is a legitimate human question — isolated, not guessed.
      expect(semen.status).toBe('NEEDS_REVIEW');
      expect(semen.resourceCatalogId).toBeNull();

      // C is genuinely unresolvable and says so.
      expect(hantu.status).toBe('UNRESOLVED');
      expect(hantu.resourceCatalogId).toBeNull();

      // The workflow did not collapse: one occurrence, all four facts recorded.
      expect(occurrence.resourceResolutions).toHaveLength(4);
    }, 120_000);

    it('only the ambiguous line offers a decision; the unresolvable line refuses to invent one', async () => {
      const semen = await readContext(semenResolutionId).expect(200);
      expect(semen.body.humanDecidable).toBe(true);
      expect(
        semen.body.candidates.map((candidate: any) => candidate.resourceCatalogId).sort(),
      ).toEqual([catalog.semenSak, catalog.semenKg].sort());

      const hantu = await readContext(
        resolutionFor(occurrence, `Hantu${tag}`).id,
      ).expect(200);
      expect(hantu.body.humanDecidable).toBe(false);
      expect(hantu.body.decisionContextToken).toBeNull();
      expect(hantu.body.candidates).toHaveLength(0);

      const pasir = await readContext(
        resolutionFor(occurrence, `Pasir${tag}`).id,
      ).expect(200);
      expect(pasir.body.humanDecidable).toBe(false);
      expect(pasir.body.reason).toContain('terbukti otomatis');
    });

    it('deciding the one ambiguity advances only that line, and leaves the rest exactly as they were', async () => {
      const before = await snapshotOccurrence(occurrence.id);
      await readThenDecide(semenResolutionId, () => catalog.semenSak);
      expect(await snapshotOccurrence(occurrence.id)).toEqual(before);

      const next = await select(item.mix, version.mix, `${tag}-mix-2`).expect(201);
      expect(next.body.generation).toBe(2);
      expect(next.body.previousOccurrenceId).toBe(occurrence.id);

      const semen = resolutionFor(next.body, `Semen${tag}`);
      // Identity settled by the recorded human decision...
      expect(semen.explanation).toContain('DIVERIFIKASI MANUSIA');
      expect(semen.explanation).toContain(catalog.semenSak);
      // ...and Unit still unproved ("zak" is in no alias catalogue), so the line
      // is honestly still not usable money.
      expect(semen.status).not.toBe('RESOLVED');
      expect(semen.resourceCatalogId).toBeNull();
      expect(semen.adaptedPriceValue).toBeNull();

      // C is still unresolved, and A/D are untouched by any of it.
      expect(resolutionFor(next.body, `Hantu${tag}`).status).toBe('UNRESOLVED');
      expect(resolutionFor(next.body, `Pasir${tag}`).status).toBe('RESOLVED');
      expect(resolutionFor(next.body, `Kerikil${tag}`).status).toBe('RESOLVED');

      expect(await snapshotOccurrence(occurrence.id)).toEqual(before);
    }, 120_000);
  });

  // =====================================================================
  // 7. BOUNDEDNESS ACROSS A REAL 40-RESOURCE LIFECYCLE
  // =====================================================================

  describe('G. a 40-resource lifecycle introduces no new query multiplication', () => {
    /** Counts real Prisma operations issued by the APPLICATION's own client. */
    const counters = { active: false, ghx: 0, total: 0, byAction: {} as Record<string, number> };

    beforeAll(() => {
      appPrisma.$use(async (params, next) => {
        if (counters.active) {
          counters.total += 1;
          if (params.model === 'AhspResourceIdentityDecision') {
            counters.ghx += 1;
            const key = `${params.model}.${params.action}`;
            counters.byAction[key] = (counters.byAction[key] ?? 0) + 1;
          }
        }
        return next(params);
      });
    });

    const measure = async <T>(run: () => Promise<T>): Promise<[T, typeof counters]> => {
      counters.active = true;
      counters.ghx = 0;
      counters.total = 0;
      counters.byAction = {};
      try {
        const result = await run();
        return [result, { ...counters, byAction: { ...counters.byAction } }];
      } finally {
        counters.active = false;
      }
    };

    let firstTotal = 0;
    const ambiguousResolutionIds: string[] = [];

    it('the first evaluation of 40 resources issues exactly ONE governed-memory query', async () => {
      const [response, measured] = await measure(() =>
        select(item.bulk, version.bulk, `${tag}-bulk-1`).expect(201),
      );

      expect(response.body.resourceResolutions).toHaveLength(40);
      expect(measured.ghx).toBe(1);
      expect(measured.byAction).toEqual({
        'AhspResourceIdentityDecision.findMany': 1,
      });
      firstTotal = measured.total;

      const resolved = response.body.resourceResolutions.filter(
        (row: any) => row.status === 'RESOLVED',
      );
      expect(resolved).toHaveLength(0); // no prices for the bulk catalog rows
      const ambiguous = response.body.resourceResolutions.filter((row: any) =>
        row.reasonCodes.includes('MULTIPLE_CANDIDATES_NEEDS_REVIEW'),
      );
      expect(ambiguous).toHaveLength(5);
      ambiguousResolutionIds.push(...ambiguous.map((row: any) => row.id));
    }, 180_000);

    it('re-evaluating with five governed decisions in place stays on the same ONE bounded query', async () => {
      for (const resolutionId of ambiguousResolutionIds) {
        const context = await readContext(resolutionId).expect(200);
        expect(context.body.humanDecidable).toBe(true);
        await decide(resolutionId, {
          selectedResourceCatalogId: context.body.candidates.find(
            (candidate: any) => candidate.baseUnit === 'm1',
          ).resourceCatalogId,
          decisionContextToken: context.body.decisionContextToken,
        }).expect(201);
      }

      const [response, measured] = await measure(() =>
        select(item.bulk, version.bulk, `${tag}-bulk-2`).expect(201),
      );

      expect(response.body.generation).toBe(2);
      // STILL EXACTLY ONE, with five decisions in play instead of none. The GHX
      // read is O(1) in resources AND O(1) in decisions.
      expect(measured.ghx).toBe(1);
      expect(measured.byAction).toEqual({
        'AhspResourceIdentityDecision.findMany': 1,
      });

      // The evaluation as a whole grew only by the ordinary unit/price work the
      // five NEWLY-IDENTIFIED lines now legitimately reach — a resource with no
      // identity never gets a unit question asked about it. The growth is
      // bounded by the number of newly identified lines, NOT by the 40
      // resources, which is what "no new multiplication" means here.
      const applied = response.body.resourceResolutions.filter((row: any) =>
        row.explanation.includes('DIVERIFIKASI MANUSIA'),
      );
      expect(applied).toHaveLength(5);
      const growth = measured.total - firstTotal;
      expect(growth).toBeGreaterThan(0);
      expect(growth).toBeLessThanOrEqual(applied.length * 4);
    }, 240_000);

    it('the governed-memory read stays ONE query for a one-resource version too — it scales with nothing', async () => {
      const [, measured] = await measure(() =>
        select(item.down, version.down, `${tag}-bounded-1`).expect(201),
      );
      expect(measured.ghx).toBe(1);
      expect(measured.byAction).toEqual({
        'AhspResourceIdentityDecision.findMany': 1,
      });
    }, 120_000);
  });

  // =====================================================================
  // 8. THE RAB PRE-LOCK GATE CONSUMES THE SAME GHX-AWARE RESOLUTION
  // =====================================================================

  describe('H. the RAB pre-lock freeze re-runs the SAME resolution, governed memory included', () => {
    /**
     * Project Dua carries exactly ONE work item, priced from a line whose
     * identity was settled by a governed human decision (proved in E). That
     * makes it the honest place to ask the last downstream question: does the
     * freeze gate consume the calculation occurrence, and does it re-ask the
     * SAME resolution authority — the one that reads governed memory?
     */
    let calculationOccurrenceId: string;

    const lock = () =>
      request(http())
        .post(`/projects/${projectTwoId}/rab/lock`)
        .set('Authorization', `Bearer ${deciderToken}`)
        .send({});

    it('the human-settled line persists and binds its own calculation occurrence', async () => {
      const persisted = await request(http())
        .post(
          `/projects/${projectTwoId}/boq/items/${item.downTwo}/cost-calculation/persist`,
        )
        .set('Authorization', `Bearer ${deciderToken}`)
        .send({ calculationAsOfDate: ASOF })
        .expect(201);

      calculationOccurrenceId = persisted.body.calculationOccurrenceId;
      const row = await prisma.boqItem.findUniqueOrThrow({
        where: { id: item.downTwo },
      });
      expect(row.calculationOccurrenceId).toBe(calculationOccurrenceId);
      expect(row.workingOccurrenceId).toBeNull();
      expect(row.priceOrigin).toBe('SERVER_COST_KERNEL');
    }, 120_000);

    it('when the governed decision stops applying, the freeze is REFUSED rather than blessed', async () => {
      // The pre-lock gate re-runs resolveVersionResources — the SAME
      // orchestrator the occurrence path uses, governed memory and all. Change
      // the candidate context and the decision stops applying, so the gate can
      // no longer prove the frozen basis and says so instead of freezing it.
      const extra = await prisma.resourceCatalog.create({
        data: {
          workspaceId,
          name: `Besi${tag}`,
          type: 'MATERIAL',
          baseUnit: 'm2',
          status: 'ACTIVE',
        },
      });
      try {
        const refused = await lock().expect(201);
        expect(refused.body.status).toBe('REFUSED');
        expect(refused.body.reason).toBe('PRELOCK_REVALIDATION_REQUIRED');
        expect(refused.body.findings).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              boqItemId: item.downTwo,
              finding: 'BASIC_PRICE_AMBIGUOUS',
              detail: `Besi${tag}`,
            }),
          ]),
        );
      } finally {
        await prisma.resourceCatalog.delete({ where: { id: extra.id } });
      }

      const rab = await prisma.rabDocument.findFirstOrThrow({
        where: { projectId: projectTwoId },
      });
      expect(rab.status).toBe('DRAFT');
      expect(rab.lockedAt).toBeNull();
    }, 120_000);

    it('with the governed decision applying again, the freeze succeeds against that same calculation occurrence', async () => {
      const locked = await lock().expect(201);
      expect(locked.body.status).toBe('LOCKED');
      expect(locked.body.changed).toBe(true);
      expect(locked.body.frozen.workItemCount).toBe(1);

      const row = await prisma.boqItem.findUniqueOrThrow({
        where: { id: item.downTwo },
      });
      expect(row.calculationOccurrenceId).toBe(calculationOccurrenceId);
      expect(row.workingOccurrenceId).toBeNull();
    }, 120_000);
  });
});
