import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

/**
 * RM-03D1 — RAB LOCK / FREEZE v1, proven against a REAL PostgreSQL database.
 *
 * The unit specs prove the decision logic over mocked clients. They cannot
 * prove the two things that only a real database can settle: that PostgreSQL's
 * FOR UPDATE actually serialises two concurrent freezes into one lock fact,
 * and that the real Basic Price authority — reading real rows through its own
 * eligibility predicate — notices when the price basis has moved.
 *
 * So every transition here runs through real HTTP, real guards, the real
 * service, a real Prisma transaction and real database constraints. Fixture
 * rows (accounts, prices, AHSP, occurrence) are seeded directly as prerequisite
 * source data; the acts under test — persist and lock — are never simulated.
 *
 * Runs against simprok_e2e only. Every fixture row is deleted in afterAll.
 */
describe('RM-03D1 RAB lock / freeze (e2e)', () => {
  const prisma = new PrismaClient();
  const tag = `RABLOCK${Date.now()}`;
  const password = 'RabLockFreeze!';
  const labels = 'TEST_FIXTURE_ONLY OWNER_SUPPLIED_EXAMPLE_NON_PRODUCTION';
  const asOf = '2026-07-31';
  const asOfDate = new Date('2026-07-31T00:00:00.000Z');

  let app: INestApplication;
  let workspaceId: string;
  let orgId: string;
  let regionId: string;
  let editorToken: string;
  let viewerToken: string;
  let verifierToken: string;
  let publisherToken: string;

  const createdPermissionIds: string[] = [];
  const accountIds: string[] = [];
  const membershipIds: string[] = [];
  const projectIds: string[] = [];
  const membershipBySuffix = new Map<string, string>();

  const login = async (email: string) => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    return response.body.access_token as string;
  };

  const ensurePermission = async (code: string) => {
    const permission =
      (await prisma.permission.findUnique({ where: { code } })) ??
      (await prisma.permission.create({
        data: { code, name: `${tag} ${code}`, description: labels },
      }));
    if (permission.name.startsWith(tag)) createdPermissionIds.push(permission.id);
    return permission;
  };

  const createActor = async (suffix: string, permissionCodes: string[]) => {
    const permissions = await Promise.all(permissionCodes.map(ensurePermission));
    const email = `${tag}.${suffix}@simprok.test`.toLowerCase();
    const account = await prisma.account.create({
      data: { email, passwordHash: await bcrypt.hash(password, 10), displayName: suffix, status: 'ACTIVE' },
    });
    accountIds.push(account.id);
    const role = await prisma.role.create({
      data: {
        workspaceId,
        code: `${tag}_${suffix.toUpperCase()}`,
        name: `${tag} ${suffix}`,
        rolePermissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
      },
    });
    const membership = await prisma.workspaceMembership.create({
      data: {
        accountId: account.id,
        workspaceId,
        status: 'ACTIVE',
        membershipRoles: { create: [{ roleId: role.id }] },
      },
    });
    membershipIds.push(membership.id);
    await prisma.user.create({
      data: { workspaceMembershipId: membership.id, workspaceId, fullName: suffix, status: 'ACTIVE' },
    });
    membershipBySuffix.set(suffix, membership.id);
    return { account, email };
  };

  /**
   * A published, TRACEABLE Basic Price — minted the way the product mints one.
   *
   * The Gate-2A persist gate refuses any price it cannot trace end-to-end
   * through submission -> review -> ACCEPT (verifier) -> PUBLISH (a distinct
   * publisher). Hand-writing a PUBLISHED row would fail that gate, so both
   * transitions run through their real HTTP routes here.
   */
  const createPrice = async (params: {
    resourceCatalogId: string;
    value: string;
    effectiveDate: Date;
    validUntil?: Date | null;
  }) => {
    const submission = await prisma.priceSubmission.create({
      data: {
        workspaceId,
        organizationId: orgId,
        resourceId: params.resourceCatalogId,
        regionId,
        sourceOrigin: 'SUPPLIER',
        sourceType: 'MARKET_SURVEY',
        status: 'UNDER_REVIEW',
      },
    });
    const revision = await prisma.priceSubmissionRevision.create({
      data: {
        submissionId: submission.id,
        revisionNumber: 1,
        value: params.value,
        effectiveDate: params.effectiveDate,
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

    const accepted = await request(app.getHttpServer())
      .post(`/basic-price-reviews/${review.id}/accept`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .set('x-workspace-id', workspaceId)
      .send({})
      .expect(201);
    const basicPriceId = accepted.body.basicPriceId as string;

    await request(app.getHttpServer())
      .post(`/basic-price-publications/${basicPriceId}/publish`)
      .set('Authorization', `Bearer ${publisherToken}`)
      .set('x-workspace-id', workspaceId)
      .expect(201);

    if (params.validUntil !== undefined) {
      await prisma.basicPrice.update({
        where: { id: basicPriceId },
        data: { validUntil: params.validUntil },
      });
    }
    return prisma.basicPrice.findUniqueOrThrow({ where: { id: basicPriceId } });
  };

  /**
   * One project holding one priced WORK_ITEM, ready to be locked. The
   * occurrence is seeded (prerequisite provenance); the money is written by
   * the REAL Gate-2A persist command over HTTP.
   */
  const buildLockableProject = async (params: {
    suffix: string;
    priceValue?: string;
    manual?: boolean;
  }) => {
    const project = await prisma.project.create({
      data: {
        workspaceId,
        organizationId: orgId,
        code: `${tag}-${params.suffix}`,
        name: `${tag} ${params.suffix}`,
        status: 'PLANNED',
      },
    });
    projectIds.push(project.id);
    // Project access is per-assignment: the actors are created before any
    // project exists, so each new project must admit them explicitly.
    for (const membershipId of membershipBySuffix.values()) {
      await prisma.projectAssignment.create({
        data: {
          workspaceMembershipId: membershipId,
          projectId: project.id,
          roleInProject: 'MEMBER',
          isPrimaryAssignment: true,
          status: 'ASSIGNED',
        },
      });
    }

    const catalog = await prisma.resourceCatalog.create({
      data: { workspaceId, name: `${tag} ${params.suffix} Besi`, type: 'MATERIAL', baseUnit: 'Kg' },
    });
    const price = await createPrice({
      resourceCatalogId: catalog.id,
      value: params.priceValue ?? '100000.00',
      effectiveDate: new Date('2026-01-01T00:00:00.000Z'),
    });

    const ahsp = await prisma.aHSP.create({
      data: {
        workspaceId,
        workType: `${tag} ${params.suffix}`,
        methodType: 'MANUAL',
        locationType: 'GENERAL',
        methodName: `${tag} ${params.suffix} method`,
      },
    });
    const version = await prisma.aHSPVersion.create({
      data: {
        ahspId: ahsp.id,
        workspaceId,
        versionNumber: 1,
        outputUnit: 'Kg',
        effectiveDate: new Date('2026-01-01T00:00:00.000Z'),
        regulationReference: `${tag} ${labels}`,
      },
    });
    const resource = await prisma.aHSPResource.create({
      data: {
        ahspVersionId: version.id,
        resourceId: catalog.name,
        resourceType: 'MATERIAL',
        coefficient: '2.000000',
        baseUnit: 'Kg',
      },
    });
    const occurrence = await prisma.projectAhspOccurrence.create({
      data: {
        workspaceId,
        projectId: project.id,
        ahspVersionId: version.id,
        idempotencyKey: `${tag}-${params.suffix}-occ`,
        businessPricingAsOfDate: asOfDate,
        referenceRegionId: regionId,
        resolutionPolicyVersion: 'E1A_CONTEXTUAL_EXACT_REGION_V1',
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
              resourceCatalogId: catalog.id,
              selectedBasicPriceId: price.id,
              canonicalUnit: 'Kg',
              sourcePriceValue: price.value.toString(),
              sourceUnit: 'Kg',
              adaptedPriceValue: price.value.toString(),
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
      data: { projectId: project.id, name: 'Working Draft', version: 1, status: 'DRAFT' },
    });
    const item = await prisma.boqItem.create({
      data: {
        boqStructureId: structure.id,
        wbsCode: '1.1',
        name: `${tag} ${params.suffix} item`,
        itemType: 'WORK_ITEM',
        quantity: '5',
        unit: 'Kg',
        ahspVersionId: version.id,
        workingOccurrenceId: occurrence.id,
        ...(params.manual
          ? { unitPrice: '123.00', lineTotal: '615.00', priceOrigin: 'MANUAL_CLIENT' as const }
          : {}),
      },
    });

    if (!params.manual) {
      // THE REAL Gate-2A persist command — the money is never written by hand.
      await request(app.getHttpServer())
        .post(`/projects/${project.id}/boq/items/${item.id}/cost-calculation/persist`)
        .set('Authorization', `Bearer ${editorToken}`)
        .send({ calculationAsOfDate: asOf })
        .expect(201);
    } else {
      await prisma.rabDocument.create({
        data: {
          projectId: project.id,
          boqStructureId: structure.id,
          name: 'Working Draft RAB',
          version: 1,
          status: 'DRAFT',
          totalBaseCost: '615.00',
          totalFinalCost: '615.00',
        },
      });
    }

    return {
      projectId: project.id,
      itemId: item.id,
      structureId: structure.id,
      catalogId: catalog.id,
      priceId: price.id,
      versionId: version.id,
    };
  };

  const lock = (projectId: string, token = editorToken) =>
    request(app.getHttpServer())
      .post(`/projects/${projectId}/rab/lock`)
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const org = await prisma.organization.create({ data: { name: `${tag} Org`, type: 'COMPANY' } });
    orgId = org.id;
    const workspace = await prisma.workspace.create({
      data: { name: `${tag} WS`, organizationId: org.id },
    });
    workspaceId = workspace.id;
    const region = await prisma.region.create({
      data: { code: `${tag}-REG`, name: `${tag} Region`, isActive: true },
    });
    regionId = region.id;

    await createActor('editor', ['RAB_DRAFT_EDIT', 'PROJECT_VIEW', 'RAB_VIEW', 'AHSP_VIEW']);
    await createActor('viewer', ['RAB_VIEW', 'PROJECT_VIEW']);
    await createActor('verifier', ['BASIC_PRICE_VERIFY']);
    await createActor('publisher', ['BASIC_PRICE_PUBLISH']);
    editorToken = await login(`${tag}.editor@simprok.test`.toLowerCase());
    viewerToken = await login(`${tag}.viewer@simprok.test`.toLowerCase());
    verifierToken = await login(`${tag}.verifier@simprok.test`.toLowerCase());
    publisherToken = await login(`${tag}.publisher@simprok.test`.toLowerCase());
  }, 120_000);

  afterAll(async () => {
    // Order matters and the Gate-2A truth constraint forbids the shortcut:
    // a SERVER_COST_KERNEL row may not have its calculationOccurrenceId
    // nulled, so the items are deleted outright rather than blanked first.
    for (const projectId of projectIds) {
      const structures = await prisma.boqStructure.findMany({ where: { projectId } });
      const structureIds = structures.map((s) => s.id);
      await prisma.boqItem.updateMany({
        where: { boqStructureId: { in: structureIds } },
        data: { parentId: null },
      });
      await prisma.boqItem.deleteMany({ where: { boqStructureId: { in: structureIds } } });
      await prisma.rabDocument.deleteMany({ where: { projectId } });
      await prisma.projectAhspResourceResolution.deleteMany({
        where: { occurrence: { projectId } },
      });
      await prisma.projectAhspOccurrence.deleteMany({ where: { projectId } });
      await prisma.boqStructure.deleteMany({ where: { projectId } });
    }
    await prisma.aHSPResource.deleteMany({ where: { ahspVersion: { workspaceId } } });
    await prisma.aHSPVersion.deleteMany({ where: { workspaceId } });
    await prisma.aHSPAuditLog.deleteMany({ where: { ahsp: { workspaceId } } });
    await prisma.aHSP.deleteMany({ where: { workspaceId } });
    await prisma.projectAssignment.deleteMany({ where: { workspaceMembershipId: { in: membershipIds } } });
    await prisma.project.deleteMany({ where: { workspaceId } });

    // The price chain, innermost dependents first.
    await prisma.basicPricePublicationAudit.deleteMany({ where: { basicPrice: { workspaceId } } });
    await prisma.basicPrice.deleteMany({ where: { workspaceId } });
    await prisma.priceSubmissionAudit.deleteMany({ where: { submission: { workspaceId } } });
    await prisma.priceSubmissionReviewDecision.deleteMany({
      where: { review: { workspaceId } },
    });
    await prisma.priceSubmissionReview.deleteMany({ where: { workspaceId } });
    await prisma.priceSubmission.updateMany({
      where: { workspaceId },
      data: { currentRevisionId: null },
    });
    await prisma.priceSubmissionRevision.deleteMany({ where: { submission: { workspaceId } } });
    await prisma.priceSubmission.deleteMany({ where: { workspaceId } });
    await prisma.resourceCatalog.deleteMany({ where: { workspaceId } });

    await prisma.membershipRole.deleteMany({ where: { workspaceMembershipId: { in: membershipIds } } });
    await prisma.user.deleteMany({ where: { workspaceMembershipId: { in: membershipIds } } });
    await prisma.workspaceMembership.deleteMany({ where: { id: { in: membershipIds } } });
    await prisma.rolePermission.deleteMany({ where: { role: { workspaceId } } });
    await prisma.role.deleteMany({ where: { workspaceId } });
    await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.permission.deleteMany({ where: { id: { in: createdPermissionIds } } });
    await prisma.region.deleteMany({ where: { id: regionId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await app.close();
    await prisma.$disconnect();
  }, 120_000);

  // ── E1 / E2 / E3 / E5 / E6 ────────────────────────────────────────────────
  it('E1-E6: a real DRAFT RAB locks once, is idempotent, stays readable, and is never approved', async () => {
    const f = await buildLockableProject({ suffix: 'happy' });

    // E1 — the real transition
    const first = await lock(f.projectId).expect(201);
    expect(first.body).toMatchObject({ status: 'LOCKED', changed: true, lockedFromStatus: 'DRAFT' });
    const lockedAt = first.body.lockedAt;
    const lockedBy = first.body.lockedByAccountId;
    expect(lockedAt).toBeTruthy();
    expect(lockedBy).toBeTruthy();

    // E2/E3 — a second lock changes nothing and rewrites no history
    const second = await lock(f.projectId).expect(201);
    expect(second.body).toMatchObject({ status: 'LOCKED', changed: false });
    expect(second.body.lockedAt).toBe(lockedAt);
    expect(second.body.lockedByAccountId).toBe(lockedBy);

    const row = await prisma.rabDocument.findFirstOrThrow({ where: { projectId: f.projectId } });
    expect(row.status).toBe('LOCKED');
    expect(row.lockedFromStatus).toBe('DRAFT');
    expect(row.lockedAt?.toISOString()).toBe(lockedAt);

    // E3 — frozen, not hidden
    const draft = await request(app.getHttpServer())
      .get(`/projects/${f.projectId}/boq/draft`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect(draft.body.items).toHaveLength(1);
    expect(draft.body.items[0].priceOrigin).toBe('SERVER_COST_KERNEL');
    expect(draft.body.capability.reasonCode).toBe('RAB_LOCKED');
    expect(draft.body.capability.canEditDraft).toBe(false);

    const proof = await request(app.getHttpServer())
      .get(`/projects/${f.projectId}/boq/items/${f.itemId}/persisted-calculation`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect(proof.body.status).toBe('VERIFIED');

    // E5/E6 — locked is not approved, and no baseline was fabricated
    expect(row.status).not.toBe('APPROVED');
    expect(await prisma.projectBaseline.count({ where: { projectId: f.projectId } })).toBe(0);
  }, 120_000);

  // ── E4 ────────────────────────────────────────────────────────────────────
  it('E4: after LOCK every real mutation route is refused and nothing changes', async () => {
    const f = await buildLockableProject({ suffix: 'immutable' });
    await lock(f.projectId).expect(201);

    const before = await prisma.boqItem.findUniqueOrThrow({ where: { id: f.itemId } });

    await request(app.getHttpServer())
      .put(`/projects/${f.projectId}/boq/draft`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ rows: [] })
      .expect((res) => {
        if (res.status < 400) throw new Error(`draft PUT was allowed: ${res.status}`);
      });

    await request(app.getHttpServer())
      .post(`/projects/${f.projectId}/ahsp-occurrences/boq-items/${f.itemId}/select-ahsp`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({
        ahspVersionId: f.versionId,
        businessPricingAsOfDate: asOf,
        referenceRegionId: regionId,
        idempotencyKey: `${tag}-after-lock`,
      })
      .expect((res) => {
        if (res.status < 400) throw new Error(`select-ahsp was allowed: ${res.status}`);
      });

    await request(app.getHttpServer())
      .post(`/projects/${f.projectId}/boq/items/${f.itemId}/cost-calculation/persist`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ calculationAsOfDate: asOf })
      .expect((res) => {
        if (res.status < 400) throw new Error(`persist was allowed: ${res.status}`);
      });

    const after = await prisma.boqItem.findUniqueOrThrow({ where: { id: f.itemId } });
    expect(after.unitPrice?.toString()).toBe(before.unitPrice?.toString());
    expect(after.lineTotal?.toString()).toBe(before.lineTotal?.toString());
    expect(after.calculationOccurrenceId).toBe(before.calculationOccurrenceId);
    expect(await prisma.boqItem.count({ where: { boqStructureId: f.structureId } })).toBe(1);
  }, 120_000);

  // ── E7 ────────────────────────────────────────────────────────────────────
  it('E7: a MANUAL_CLIENT line cannot be frozen, and the RAB stays DRAFT', async () => {
    const f = await buildLockableProject({ suffix: 'manual', manual: true });

    const response = await lock(f.projectId).expect(201);

    expect(response.body.status).toBe('REFUSED');
    expect(response.body.reason).toBe('PRELOCK_REVALIDATION_REQUIRED');
    expect(response.body.findings.map((x: any) => x.finding)).toContain(
      'MANUAL_PRICE_REQUIRES_CONFIRMATION',
    );
    const row = await prisma.rabDocument.findFirstOrThrow({ where: { projectId: f.projectId } });
    expect(row.status).toBe('DRAFT');
    expect(row.lockedAt).toBeNull();
  }, 120_000);

  // ── E8 — THE LOAD-BEARING TRAVELOKA PROOF ─────────────────────────────────
  it('E8: a newly eligible Basic Price refuses the lock even though the snapshot is still VERIFIED', async () => {
    const f = await buildLockableProject({ suffix: 'drift' });

    // The snapshot is healthy BEFORE anything moves.
    const healthy = await request(app.getHttpServer())
      .get(`/projects/${f.projectId}/boq/items/${f.itemId}/persisted-calculation`)
      .set('Authorization', `Bearer ${editorToken}`)
      .expect(200);
    expect(healthy.body.status).toBe('VERIFIED');

    // Lawful setup: the frozen price stops being applicable at this date, and a
    // different eligible price takes its place. The stored occurrence and
    // resolution rows are NOT touched.
    await prisma.basicPrice.update({
      where: { id: f.priceId },
      data: { validUntil: new Date('2026-06-30T00:00:00.000Z') },
    });
    await createPrice({
      resourceCatalogId: f.catalogId,
      value: '140000.00',
      effectiveDate: new Date('2026-07-01T00:00:00.000Z'),
    });

    // The snapshot STILL reproduces itself — that is the whole point.
    const stillVerified = await request(app.getHttpServer())
      .get(`/projects/${f.projectId}/boq/items/${f.itemId}/persisted-calculation`)
      .set('Authorization', `Bearer ${editorToken}`)
      .expect(200);
    expect(stillVerified.body.status).toBe('VERIFIED');

    const response = await lock(f.projectId).expect(201);

    expect(response.body.status).toBe('REFUSED');
    expect(response.body.reason).toBe('PRELOCK_REVALIDATION_REQUIRED');
    expect(response.body.findings.map((x: any) => x.finding)).toContain(
      'BASIC_PRICE_SELECTION_CHANGED',
    );
    const row = await prisma.rabDocument.findFirstOrThrow({ where: { projectId: f.projectId } });
    expect(row.status).toBe('DRAFT');
  }, 120_000);

  // ── E9 ────────────────────────────────────────────────────────────────────
  it('E9: a price effective AFTER the line’s own date creates no drift', async () => {
    const f = await buildLockableProject({ suffix: 'future' });

    await createPrice({
      resourceCatalogId: f.catalogId,
      value: '999999.00',
      effectiveDate: new Date('2026-12-31T00:00:00.000Z'),
    });

    const response = await lock(f.projectId).expect(201);
    expect(response.body.status).toBe('LOCKED');
    expect(response.body.changed).toBe(true);
  }, 120_000);

  // ── E10 ───────────────────────────────────────────────────────────────────
  it('E10: two equally eligible current prices are ambiguous, and SIMPROK refuses rather than choosing', async () => {
    const f = await buildLockableProject({ suffix: 'ambiguous' });

    await createPrice({
      resourceCatalogId: f.catalogId,
      value: '111111.00',
      effectiveDate: new Date('2026-02-01T00:00:00.000Z'),
    });

    const response = await lock(f.projectId).expect(201);
    expect(response.body.status).toBe('REFUSED');
    expect(response.body.reason).toBe('PRELOCK_REVALIDATION_REQUIRED');
    const row = await prisma.rabDocument.findFirstOrThrow({ where: { projectId: f.projectId } });
    expect(row.status).toBe('DRAFT');
  }, 120_000);

  // ── E11 — REAL CONCURRENCY ────────────────────────────────────────────────
  it('E11: two concurrent real lock requests produce exactly one lock fact', async () => {
    const f = await buildLockableProject({ suffix: 'race' });

    const [a, b] = await Promise.all([lock(f.projectId), lock(f.projectId)]);

    // Both callers end safely; neither 500s merely because they raced.
    for (const res of [a, b]) {
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('LOCKED');
    }
    // Exactly one of them performed the transition.
    expect([a.body.changed, b.body.changed].filter(Boolean)).toHaveLength(1);
    // And both describe the SAME single lock fact.
    expect(a.body.lockedAt).toBe(b.body.lockedAt);
    expect(a.body.lockedByAccountId).toBe(b.body.lockedByAccountId);

    const rows = await prisma.rabDocument.findMany({ where: { projectId: f.projectId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('LOCKED');
    expect(rows[0].lockedFromStatus).toBe('DRAFT');
  }, 120_000);

  // ── E12 — REAL LOCK vs MUTATION RACE ──────────────────────────────────────
  it('E12: lock racing a real mutation leaves one serially legal history — nothing commits after LOCK wins', async () => {
    const f = await buildLockableProject({ suffix: 'mutrace' });
    const before = await prisma.boqItem.findUniqueOrThrow({ where: { id: f.itemId } });

    const [lockRes, persistRes] = await Promise.all([
      lock(f.projectId),
      request(app.getHttpServer())
        .post(`/projects/${f.projectId}/boq/items/${f.itemId}/cost-calculation/persist`)
        .set('Authorization', `Bearer ${editorToken}`)
        .send({ calculationAsOfDate: asOf }),
    ]);

    const row = await prisma.rabDocument.findFirstOrThrow({ where: { projectId: f.projectId } });
    const after = await prisma.boqItem.findUniqueOrThrow({ where: { id: f.itemId } });

    // The winner is serialization-dependent and NOT asserted. The invariant is.
    if (row.status === 'LOCKED') {
      // LOCK won: the frozen line must be exactly what was frozen. A mutation
      // committing after the freeze is the one outcome that is never legal.
      expect(after.unitPrice?.toString()).toBe(before.unitPrice?.toString());
      expect(after.lineTotal?.toString()).toBe(before.lineTotal?.toString());
      expect(row.lockedFromStatus).toBe('DRAFT');
      expect(row.lockedAt).not.toBeNull();
    } else {
      // The mutation won: the RAB stayed a live draft and the lock refused or
      // validated against the mutated truth. Either way it is not frozen.
      expect(row.status).toBe('DRAFT');
    }
    // Whatever the order, exactly one RAB document exists and no second lock
    // fact was written.
    expect(await prisma.rabDocument.count({ where: { projectId: f.projectId } })).toBe(1);
    expect([lockRes.status, persistRes.status].every((s) => s < 500)).toBe(true);
  }, 120_000);
});
