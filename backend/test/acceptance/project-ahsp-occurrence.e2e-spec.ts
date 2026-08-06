import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { WORKING_DRAFT_STRUCTURE_NAME } from '../../src/project/rab-lifecycle-policy.service';

describe('Project AHSP whole-version selection (e2e)', () => {
  const prisma = new PrismaClient();
  const password = 'E1aAcceptance123!';
  const tag = `E1A${Date.now()}`;
  const asOfDate = '2026-08-04';
  let app: INestApplication;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let projectId: string;
  let otherProjectId: string;
  let accountId: string;
  let token: string;
  let ahspOnlyToken: string;
  let rabOnlyToken: string;
  let unassignedToken: string;
  let crossToken: string;
  /** RM-03B: holds AHSP_MANAGE, for the AHSP/version write-side tenant proofs. */
  let manageToken: string;
  let manageAccountId: string;
  let regionId: string;
  let otherRegionId: string;
  let boqItemId: string;
  let wholeVersionId: string;
  let multipleVersionId: string;
  let unresolvedVersionId: string;
  let lineageVersionId: string;
  let wholeOccurrenceId: string;
  let wholeResolutionIds: string[] = [];
  let expiredPriceId: string;
  let ahspId: string;
  // RM-03B — workspace-private AHSP fixtures.
  // TEST_ONLY_SYNTHETIC_FIXTURE=YES  PRODUCTION_TRUTH=NO
  let privateVersionId: string;
  let privateBoqItemId: string;
  let nullWorkspacePrivateVersionId: string;
  let archivedPrivateVersionId: string;
  let supersededPrivateVersionId: string;
  let foreignPrivateVersionId: string;
  let foreignPrivateAhspId: string;
  const createdPermissionIds: string[] = [];

  const login = async (email: string) => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    return response.body.access_token as string;
  };

  const select = (
    key: string,
    versionId = wholeVersionId,
    bearer = token,
    itemId = boqItemId,
    selectedRegionId: string | null = regionId,
  ) =>
    // Nest's getHttpServer() is intentionally untyped at this boundary;
    // Supertest remains the runtime contract exercised by this E2E helper.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    request(app.getHttpServer())
      .post(
        `/projects/${projectId}/ahsp-occurrences/boq-items/${itemId}/select-ahsp`,
      )
      .set('Authorization', `Bearer ${bearer}`)
      .send({
        ahspVersionId: versionId,
        businessPricingAsOfDate: asOfDate,
        referenceRegionId: selectedRegionId,
        idempotencyKey: key,
      });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const passwordHash = await bcrypt.hash(password, 10);
    const org = await prisma.organization.create({
      data: { name: `${tag} Org`, type: 'COMPANY' },
    });
    const otherOrg = await prisma.organization.create({
      data: { name: `${tag} Other Org`, type: 'COMPANY' },
    });
    const workspace = await prisma.workspace.create({
      data: { name: `${tag} WS`, organizationId: org.id },
    });
    const otherWorkspace = await prisma.workspace.create({
      data: { name: `${tag} Other WS`, organizationId: otherOrg.id },
    });
    workspaceId = workspace.id;
    otherWorkspaceId = otherWorkspace.id;

    const project = await prisma.project.create({
      data: {
        workspaceId,
        organizationId: org.id,
        code: `${tag}-P`,
        name: `${tag} Project`,
        status: 'PLANNED',
      },
    });
    const otherProject = await prisma.project.create({
      data: {
        workspaceId,
        organizationId: org.id,
        code: `${tag}-P2`,
        name: `${tag} Other Project`,
        status: 'PLANNED',
      },
    });
    projectId = project.id;
    otherProjectId = otherProject.id;

    const structure = await prisma.boqStructure.create({
      data: {
        projectId,
        name: WORKING_DRAFT_STRUCTURE_NAME,
        version: 1,
        status: 'DRAFT',
      },
    });
    const item = await prisma.boqItem.create({
      data: {
        boqStructureId: structure.id,
        wbsCode: '1.1',
        name: `${tag} Work Item`,
        itemType: 'WORK_ITEM',
        quantity: '1.000000',
        unit: 'M1',
      },
    });
    boqItemId = item.id;

    const ensurePermission = async (
      code: 'RAB_DRAFT_EDIT' | 'AHSP_VIEW' | 'AHSP_MANAGE',
    ) => {
      const existing = await prisma.permission.findUnique({ where: { code } });
      if (existing) return existing;
      const created = await prisma.permission.create({
        data: { code, name: `${tag} ${code}`, description: 'E1A E2E fixture' },
      });
      createdPermissionIds.push(created.id);
      return created;
    };
    const rabPermission = await ensurePermission('RAB_DRAFT_EDIT');
    const ahspPermission = await ensurePermission('AHSP_VIEW');
    // RM-03B: AHSP_MANAGE is kept on a SEPARATE role so the existing
    // "requires both RAB_DRAFT_EDIT and AHSP_VIEW" fixtures keep their exact
    // permission shape and the write-side tests cannot weaken them.
    const ahspManagePermission = await ensurePermission('AHSP_MANAGE');
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
    const [bothRole, ahspRole, rabRole, crossRole, manageRole] =
      await Promise.all([
        makeRole('BOTH', workspaceId, [rabPermission.id, ahspPermission.id]),
        makeRole('AHSP', workspaceId, [ahspPermission.id]),
        makeRole('RAB', workspaceId, [rabPermission.id]),
        makeRole('CROSS', otherWorkspaceId, [
          rabPermission.id,
          ahspPermission.id,
        ]),
        makeRole('MANAGE', workspaceId, [
          ahspPermission.id,
          ahspManagePermission.id,
        ]),
      ]);

    const createActor = async (
      suffix: string,
      ws: string,
      roleId: string,
      assigned: boolean,
    ) => {
      const email = `${tag}.${suffix}@test.local`.toLowerCase();
      const account = await prisma.account.create({
        data: { email, passwordHash, displayName: suffix, status: 'ACTIVE' },
      });
      const membership = await prisma.workspaceMembership.create({
        data: {
          accountId: account.id,
          workspaceId: ws,
          status: 'ACTIVE',
          membershipRoles: { create: [{ roleId }] },
        },
      });
      await prisma.user.create({
        data: {
          workspaceMembershipId: membership.id,
          workspaceId: ws,
          fullName: suffix,
          status: 'ACTIVE',
        },
      });
      if (assigned) {
        await prisma.projectAssignment.create({
          data: {
            workspaceMembershipId: membership.id,
            projectId,
            roleInProject: 'MEMBER',
            isPrimaryAssignment: true,
            status: 'ASSIGNED',
          },
        });
      }
      return { id: account.id, email, membershipId: membership.id };
    };

    const actor = await createActor('actor', workspaceId, bothRole.id, true);
    const ahspOnly = await createActor(
      'ahsp-only',
      workspaceId,
      ahspRole.id,
      true,
    );
    const rabOnly = await createActor(
      'rab-only',
      workspaceId,
      rabRole.id,
      true,
    );
    const unassigned = await createActor(
      'unassigned',
      workspaceId,
      bothRole.id,
      false,
    );
    const cross = await createActor(
      'cross',
      otherWorkspaceId,
      crossRole.id,
      false,
    );
    const manager = await createActor(
      'manage',
      workspaceId,
      manageRole.id,
      true,
    );
    accountId = actor.id;
    manageAccountId = manager.id;
    await prisma.projectAssignment.create({
      data: {
        workspaceMembershipId: actor.membershipId,
        projectId: otherProjectId,
        roleInProject: 'MEMBER',
        isPrimaryAssignment: false,
        status: 'ASSIGNED',
      },
    });
    [
      token,
      ahspOnlyToken,
      rabOnlyToken,
      unassignedToken,
      crossToken,
      manageToken,
    ] = await Promise.all([
      login(actor.email),
      login(ahspOnly.email),
      login(rabOnly.email),
      login(unassigned.email),
      login(cross.email),
      login(manager.email),
    ]);

    const region = await prisma.region.create({
      data: { code: `${tag}-REG`, name: `${tag} Region`, isActive: true },
    });
    const otherRegion = await prisma.region.create({
      data: {
        code: `${tag}-OTHER`,
        name: `${tag} Other Region`,
        isActive: true,
      },
    });
    regionId = region.id;
    otherRegionId = otherRegion.id;

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
    const createVersion = async (versionNumber: number, names: string[]) => {
      const version = await prisma.aHSPVersion.create({
        data: {
          ahspId,
          workspaceId,
          versionNumber,
          status: 'PUBLISHED',
          effectiveDate: new Date('2026-08-01T00:00:00.000Z'),
          outputUnit: 'M1',
          resources: {
            create: names.map((resourceId) => ({
              resourceId,
              resourceType: 'LABOR',
              coefficient: '1.000000',
              baseUnit: 'OH',
            })),
          },
        },
        include: { resources: true },
      });
      return version;
    };
    const whole = await createVersion(1, [`${tag} Current`, `${tag} Expired`]);
    const multiple = await createVersion(2, [`${tag} Multiple`]);
    const unresolved = await createVersion(3, [`${tag} Missing`]);
    const lineage = await createVersion(4, [`${tag} Lineage`]);
    wholeVersionId = whole.id;
    multipleVersionId = multiple.id;
    unresolvedVersionId = unresolved.id;
    lineageVersionId = lineage.id;

    const createCatalog = (suffix: string) =>
      prisma.resourceCatalog.create({
        data: {
          workspaceId,
          code: `${tag}-${suffix.toUpperCase()}`,
          name: `${tag} ${suffix}`,
          type: 'LABOR',
          baseUnit: 'Org/Hari',
        },
      });
    const [currentCatalog, expiredCatalog, multipleCatalog, lineageCatalog] =
      await Promise.all([
        createCatalog('Current'),
        createCatalog('Expired'),
        createCatalog('Multiple'),
        createCatalog('Lineage'),
      ]);
    const priceData = (
      resourceId: string,
      value: string,
      freshnessStatus: string,
    ) => ({
      workspaceId,
      resourceId,
      regionId,
      effectiveDate: new Date('2026-08-01T00:00:00.000Z'),
      value,
      sourceOrigin: 'SUPPLIER' as const,
      verificationStatus: 'PUBLISHED' as const,
      freshnessStatus,
      status: 'PUBLISHED',
    });
    await prisma.basicPrice.create({
      data: priceData(currentCatalog.id, '100.00', 'CURRENT'),
    });
    const expiredPrice = await prisma.basicPrice.create({
      data: priceData(expiredCatalog.id, '200.00', 'EXPIRED'),
    });
    expiredPriceId = expiredPrice.id;
    await prisma.basicPrice.createMany({
      data: [
        priceData(multipleCatalog.id, '300.00', 'CURRENT'),
        priceData(multipleCatalog.id, '301.00', 'EXPIRED'),
        priceData(lineageCatalog.id, '400.00', 'EXPIRING'),
      ],
    });

    // ---- RM-03B workspace-private AHSP fixtures ----
    // Every one of these is DRAFT and was never nationally published. They
    // exist to prove that a workspace can use its OWN analysis, and that the
    // additive private route cannot be walked into another tenant's data.
    const createPrivateAhsp = async (
      suffix: string,
      overrides: Record<string, unknown> = {},
    ) =>
      prisma.aHSP.create({
        data: {
          workspaceId,
          workType: `${tag} ${suffix}`,
          methodType: 'MANUAL',
          locationType: 'GENERAL',
          methodName: `${tag}-${suffix}`,
          ownershipType: 'USER_ASSET',
          ...overrides,
        },
      });
    const createPrivateVersion = async (
      ownerAhspId: string,
      versionWorkspaceId: string | null,
      status: 'DRAFT' | 'SUPERSEDED' = 'DRAFT',
    ) =>
      prisma.aHSPVersion.create({
        data: {
          ahspId: ownerAhspId,
          workspaceId: versionWorkspaceId,
          versionNumber: 1,
          status,
          effectiveDate: new Date('2026-08-01T00:00:00.000Z'),
          outputUnit: 'M1',
          resources: {
            create: [
              {
                resourceId: `${tag} Current`,
                resourceType: 'LABOR',
                coefficient: '2.000000',
                baseUnit: 'OH',
              },
            ],
          },
        },
      });

    const privateAhsp = await createPrivateAhsp('Private');
    privateVersionId = (await createPrivateVersion(privateAhsp.id, workspaceId)).id;

    // A USER_ASSET with a NULL workspace. ownershipType defaults to USER_ASSET
    // even on the Official Repository create branch, so this row is the exact
    // shape that a loosely-written private predicate would leak to every tenant.
    const nullWorkspaceAhsp = await createPrivateAhsp('NullWs', {
      workspaceId: null,
    });
    nullWorkspacePrivateVersionId = (
      await createPrivateVersion(nullWorkspaceAhsp.id, null)
    ).id;

    const archivedAhsp = await createPrivateAhsp('Archived', {
      archivedAt: new Date('2026-08-02T00:00:00.000Z'),
    });
    archivedPrivateVersionId = (
      await createPrivateVersion(archivedAhsp.id, workspaceId)
    ).id;

    const supersededAhsp = await createPrivateAhsp('Superseded');
    supersededPrivateVersionId = (
      await createPrivateVersion(supersededAhsp.id, workspaceId, 'SUPERSEDED')
    ).id;

    const foreignAhsp = await createPrivateAhsp('Foreign', {
      workspaceId: otherWorkspaceId,
    });
    foreignPrivateAhspId = foreignAhsp.id;
    foreignPrivateVersionId = (
      await createPrivateVersion(foreignAhsp.id, otherWorkspaceId)
    ).id;

    const privateStructure = await prisma.boqStructure.findFirstOrThrow({
      where: { projectId, name: WORKING_DRAFT_STRUCTURE_NAME },
    });
    privateBoqItemId = (
      await prisma.boqItem.create({
        data: {
          boqStructureId: privateStructure.id,
          wbsCode: '9.1',
          name: `${tag} Private Item`,
          itemType: 'WORK_ITEM',
          quantity: '3',
          unit: 'M1',
        },
      })
    ).id;
  }, 40_000);

  afterAll(async () => {
    const accounts = await prisma.account.findMany({
      where: { email: { startsWith: tag.toLowerCase() } },
      select: { id: true },
    });
    const accountIds = accounts.map(({ id }) => id);
    const memberships = await prisma.workspaceMembership.findMany({
      where: { accountId: { in: accountIds } },
      select: { id: true },
    });
    const membershipIds = memberships.map(({ id }) => id);
    await prisma.boqStructure.deleteMany({ where: { projectId } });
    await prisma.projectAhspResourceResolution.deleteMany({
      where: { occurrence: { projectId } },
    });
    await prisma.projectAhspOccurrence.deleteMany({ where: { projectId } });
    await prisma.basicPrice.deleteMany({
      where: { resource: { code: { startsWith: tag } } },
    });
    await prisma.resourceCatalog.deleteMany({
      where: { code: { startsWith: tag } },
    });
    // RM-03B: scoped by tag rather than by the single `ahspId`, so the
    // private-asset fixtures (including the null-workspace and foreign-workspace
    // ones) are removed too. The outer Safe E2E harness fingerprints every
    // table, so any row left behind here fails the run.
    await prisma.aHSPResource.deleteMany({
      where: { ahspVersion: { ahsp: { workType: { startsWith: tag } } } },
    });
    await prisma.aHSPVersion.deleteMany({
      where: { ahsp: { workType: { startsWith: tag } } },
    });
    await prisma.aHSP.deleteMany({ where: { workType: { startsWith: tag } } });
    await prisma.region.deleteMany({
      where: { id: { in: [regionId, otherRegionId] } },
    });
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
    await prisma.project.deleteMany({
      where: { id: { in: [projectId, otherProjectId] } },
    });
    await prisma.workspace.deleteMany({
      where: { id: { in: [workspaceId, otherWorkspaceId] } },
    });
    await prisma.organization.deleteMany({
      where: { name: { startsWith: tag } },
    });
    await app.close();
    await prisma.$disconnect();
  }, 40_000);

  it('rejects a whole-version selection without JWT with 401', () =>
    request(app.getHttpServer())
      .post(
        `/projects/${projectId}/ahsp-occurrences/boq-items/${boqItemId}/select-ahsp`,
      )
      .send({
        ahspVersionId: wholeVersionId,
        businessPricingAsOfDate: asOfDate,
        referenceRegionId: regionId,
        idempotencyKey: `${tag}-no-jwt`,
      })
      .expect(401));

  it('requires both RAB_DRAFT_EDIT and AHSP_VIEW', async () => {
    await select(`${tag}-missing-rab`, wholeVersionId, ahspOnlyToken).expect(
      403,
    );
    await select(`${tag}-missing-ahsp`, wholeVersionId, rabOnlyToken).expect(
      403,
    );
  });

  it('rejects same-workspace unassigned and cross-workspace actors', async () => {
    await select(`${tag}-unassigned`, wholeVersionId, unassignedToken).expect(
      403,
    );
    await select(`${tag}-cross`, wholeVersionId, crossToken).expect(404);
  });

  it('writes zero occurrences for an invalid BOQ item or AHSP Version', async () => {
    const before = await prisma.projectAhspOccurrence.count({
      where: { projectId },
    });
    await select(`${tag}-bad-item`, wholeVersionId, token, randomUUID()).expect(
      404,
    );
    await select(`${tag}-bad-version`, randomUUID()).expect(404);
    expect(
      await prisma.projectAhspOccurrence.count({ where: { projectId } }),
    ).toBe(before);
  });

  it('creates one whole-version occurrence and atomically installs its working pointer', async () => {
    const response = await request(app.getHttpServer())
      .post(
        `/projects/${projectId}/ahsp-occurrences/boq-items/${boqItemId}/select-ahsp`,
      )
      .set('Authorization', `Bearer ${token}`)
      .send({
        ahspVersionId: wholeVersionId,
        businessPricingAsOfDate: asOfDate,
        referenceRegionId: regionId,
        idempotencyKey: `${tag}-whole`,
        workspaceId: otherWorkspaceId,
        projectId: otherProjectId,
        createdByAccountId: randomUUID(),
        selectionMode: 'USER_OVERRIDDEN',
        resolutionPolicyVersion: 'CALLER_SPOOF',
      })
      .expect(201);
    wholeOccurrenceId = response.body.id;
    wholeResolutionIds = response.body.resourceResolutions.map(
      (row: { id: string }) => row.id,
    );
    expect(response.body).toMatchObject({
      projectId,
      workspaceId,
      createdByAccountId: accountId,
      ahspVersionId: wholeVersionId,
      resolutionPolicyVersion: 'E1A_CONTEXTUAL_EXACT_REGION_V1',
    });
    expect(response.body.resourceResolutions).toHaveLength(2);
    expect(
      new Set(
        response.body.resourceResolutions.map(
          (row: { ahspResourceId: string }) => row.ahspResourceId,
        ),
      ).size,
    ).toBe(2);
    const selectionModeByRef = new Map(
      response.body.resourceResolutions.map(
        (row: { rawAhspResourceRef: string; selectionMode: string | null }) => [
          row.rawAhspResourceRef,
          row.selectionMode,
        ],
      ),
    );
    expect(selectionModeByRef.get(`${tag} Current`)).toBe('AUTO_SELECTED');
    expect(selectionModeByRef.get(`${tag} Expired`)).toBeNull();
    const item = await prisma.boqItem.findUniqueOrThrow({
      where: { id: boqItemId },
    });
    expect(item.workingOccurrenceId).toBe(wholeOccurrenceId);
    expect(item.ahspVersionId).toBe(wholeVersionId);
  });

  it('holds the single EXPIRED candidate for review without auto-selecting it', async () => {
    const occurrence = await prisma.projectAhspOccurrence.findUniqueOrThrow({
      where: { id: wholeOccurrenceId },
      include: { resourceResolutions: true },
    });
    const expired = occurrence.resourceResolutions.find(
      (row) => row.rawAhspResourceRef === `${tag} Expired`,
    );
    expect(expired).toMatchObject({
      status: 'NEEDS_REVIEW',
      selectedBasicPriceId: null,
      selectedFreshnessStatus: null,
      resourceCatalogId: null,
    });
    expect(expired?.reasonCodes).toContain(
      'ONLY_EXPIRED_BASIC_PRICE_CANDIDATES',
    );
  });

  it('returns NEEDS_REVIEW for CURRENT plus EXPIRED because there are multiple candidates', async () => {
    const response = await select(`${tag}-multiple`, multipleVersionId).expect(
      201,
    );
    expect(response.body.resourceResolutions[0]).toMatchObject({
      status: 'NEEDS_REVIEW',
      selectedBasicPriceId: null,
    });
    expect(response.body.resourceResolutions[0].reasonCodes).toContain(
      'MULTIPLE_BASIC_PRICE_CANDIDATES',
    );
  });

  it('persists UNRESOLVED without invented evidence when no exact catalog exists', async () => {
    const response = await select(
      `${tag}-unresolved`,
      unresolvedVersionId,
    ).expect(201);
    expect(response.body.resourceResolutions[0]).toMatchObject({
      status: 'UNRESOLVED',
      resourceCatalogId: null,
      selectedBasicPriceId: null,
      sourcePriceValue: null,
      selectedFreshnessStatus: null,
    });
  });

  it('enforces exact Region and forbids null or cross-region fallback', async () => {
    const before = await prisma.projectAhspOccurrence.count({
      where: { projectId },
    });
    await select(
      `${tag}-null-region`,
      wholeVersionId,
      token,
      boqItemId,
      null,
    ).expect(400);
    const crossRegion = await select(
      `${tag}-other-region`,
      wholeVersionId,
      token,
      boqItemId,
      otherRegionId,
    ).expect(201);
    expect(
      crossRegion.body.resourceResolutions.every(
        (row: { status: string; selectedBasicPriceId: string | null }) =>
          row.status === 'UNRESOLVED' && row.selectedBasicPriceId === null,
      ),
    ).toBe(true);
    expect(
      await prisma.projectAhspOccurrence.count({ where: { projectId } }),
    ).toBe(before + 1);
  });

  it('replays an identical payload with identical occurrence/resolution IDs and row counts', async () => {
    const beforeOccurrences = await prisma.projectAhspOccurrence.count({
      where: { idempotencyKey: `${tag}-whole`, projectId },
    });
    const replay = await select(`${tag}-whole`).expect(201);
    expect(replay.body.id).toBe(wholeOccurrenceId);
    expect(
      replay.body.resourceResolutions
        .map((row: { id: string }) => row.id)
        .sort(),
    ).toEqual([...wholeResolutionIds].sort());
    expect(
      await prisma.projectAhspOccurrence.count({
        where: { idempotencyKey: `${tag}-whole`, projectId },
      }),
    ).toBe(beforeOccurrences);
  });

  it('returns 409 for the same idempotency key with a different payload', async () => {
    await select(`${tag}-whole`, multipleVersionId).expect(409);
    const original = await prisma.projectAhspOccurrence.findUniqueOrThrow({
      where: { id: wholeOccurrenceId },
    });
    expect(original.ahspVersionId).toBe(wholeVersionId);
  });

  it('concurrent identical commands converge on one winner', async () => {
    const key = `${tag}-concurrent`;
    const [first, second] = await Promise.all([
      select(key, lineageVersionId).expect(201),
      select(key, lineageVersionId).expect(201),
    ]);
    expect(first.body.id).toBe(second.body.id);
    expect(
      await prisma.projectAhspOccurrence.count({
        where: { projectId, idempotencyKey: key },
      }),
    ).toBe(1);
  });

  it('a new retry key creates the next generation and never mutates the old occurrence', async () => {
    const first = await select(`${tag}-lineage-1`, lineageVersionId).expect(
      201,
    );
    const oldBefore = await prisma.projectAhspOccurrence.findUniqueOrThrow({
      where: { id: first.body.id },
    });
    const second = await select(`${tag}-lineage-2`, lineageVersionId).expect(
      201,
    );
    const oldAfter = await prisma.projectAhspOccurrence.findUniqueOrThrow({
      where: { id: first.body.id },
    });
    expect(second.body.generation).toBe(first.body.generation + 1);
    expect(second.body.previousOccurrenceId).toBe(first.body.id);
    expect(oldAfter).toEqual(oldBefore);
  });

  it('does not mutate master AHSP/version/resource evidence', async () => {
    const before = await prisma.aHSP.findUniqueOrThrow({
      where: { id: ahspId },
      include: {
        versions: {
          include: { resources: true },
          orderBy: { versionNumber: 'asc' },
        },
      },
    });
    await select(`${tag}-master-proof`, lineageVersionId).expect(201);
    const after = await prisma.aHSP.findUniqueOrThrow({
      where: { id: ahspId },
      include: {
        versions: {
          include: { resources: true },
          orderBy: { versionNumber: 'asc' },
        },
      },
    });
    expect(after).toEqual(before);
  });

  it('keeps GET permission, workspace, and project scoping', async () => {
    await request(app.getHttpServer())
      .get(`/projects/${projectId}/ahsp-occurrences/${wholeOccurrenceId}`)
      .set('Authorization', `Bearer ${rabOnlyToken}`)
      .expect(403);
    const visible = await request(app.getHttpServer())
      .get(`/projects/${projectId}/ahsp-occurrences/${wholeOccurrenceId}`)
      .set('Authorization', `Bearer ${ahspOnlyToken}`)
      .expect(200);
    expect(visible.body.id).toBe(wholeOccurrenceId);
    await request(app.getHttpServer())
      .get(`/projects/${otherProjectId}/ahsp-occurrences/${wholeOccurrenceId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/projects/${projectId}/ahsp-occurrences/${wholeOccurrenceId}`)
      .set('Authorization', `Bearer ${crossToken}`)
      .expect(404);
  });

  /**
   * RM-03B — workspace-private AHSP.
   *
   * Owner law: a workspace may use its OWN AHSP immediately, with no national
   * publication, no verifier, no publisher and no second human. The catalog
   * route is untouched, and the private route must not become a way to reach
   * another tenant's data.
   */
  describe('RM-03B workspace-private AHSP', () => {
    const listEligible = (bearer: string) =>
      request(app.getHttpServer())
        .get(
          `/projects/${projectId}/ahsp-occurrences/eligible-versions?businessPricingAsOfDate=${asOfDate}`,
        )
        .set('Authorization', `Bearer ${bearer}`);

    it('offers the workspace its own never-published AHSP, labelled as private', async () => {
      const response = await listEligible(token).expect(200);
      const found = response.body.find(
        (version: any) => version.id === privateVersionId,
      );
      expect(found).toBeDefined();
      expect(found.origin).toBe('WORKSPACE_PRIVATE');
    });

    it('still labels a nationally published version as catalog, not private', async () => {
      const response = await listEligible(token).expect(200);
      const catalog = response.body.find(
        (version: any) => version.id === wholeVersionId,
      );
      expect(catalog).toBeDefined();
      expect(catalog.origin).toBe('SIMPROK_CATALOG');
    });

    it('does NOT leak a null-workspace USER_ASSET through the private route', async () => {
      // ownershipType defaults to USER_ASSET even for the Official Repository,
      // so this row is the exact shape a loose private predicate would expose
      // to every tenant at once. It is unpublished, so it must be invisible.
      const response = await listEligible(token).expect(200);
      expect(
        response.body.some(
          (version: any) => version.id === nullWorkspacePrivateVersionId,
        ),
      ).toBe(false);
    });

    it('excludes an archived or superseded private asset', async () => {
      const response = await listEligible(token).expect(200);
      const ids = response.body.map((version: any) => version.id);
      expect(ids).not.toContain(archivedPrivateVersionId);
      expect(ids).not.toContain(supersededPrivateVersionId);
    });

    it('does not show one workspace the private AHSP of another', async () => {
      const response = await listEligible(token).expect(200);
      expect(
        response.body.some(
          (version: any) => version.id === foreignPrivateVersionId,
        ),
      ).toBe(false);
    });

    it('binds the workspace own private AHSP to a BOQ item and resolves its resources', async () => {
      const response = await request(app.getHttpServer())
        .post(
          `/projects/${projectId}/ahsp-occurrences/boq-items/${privateBoqItemId}/select-ahsp`,
        )
        .set('Authorization', `Bearer ${token}`)
        .send({
          ahspVersionId: privateVersionId,
          businessPricingAsOfDate: asOfDate,
          referenceRegionId: regionId,
          idempotencyKey: `${tag}-private-bind`,
        })
        .expect(201);

      expect(response.body.ahspVersionId).toBe(privateVersionId);
      expect(response.body.resourceResolutions).toHaveLength(1);
      const [resolution] = response.body.resourceResolutions;
      expect(resolution.status).toBe('RESOLVED');
      // Priced from a PUBLISHED catalog Basic Price — private AHSP, public price.
      expect(resolution.adaptedPriceValue).toBe('100');
      expect(resolution.ahspCoefficient).toBe('2');

      const item = await prisma.boqItem.findUniqueOrThrow({
        where: { id: privateBoqItemId },
      });
      expect(item.workingOccurrenceId).toBe(response.body.id);
    });

    it('refuses to bind another workspace private AHSP even with a valid session', async () => {
      // The picker never offered it; the server must refuse it anyway. The
      // list and this revalidation are built from the same predicate precisely
      // so this cannot diverge.
      await request(app.getHttpServer())
        .post(
          `/projects/${projectId}/ahsp-occurrences/boq-items/${privateBoqItemId}/select-ahsp`,
        )
        .set('Authorization', `Bearer ${token}`)
        .send({
          ahspVersionId: foreignPrivateVersionId,
          businessPricingAsOfDate: asOfDate,
          referenceRegionId: regionId,
          idempotencyKey: `${tag}-foreign-bind`,
        })
        .expect(404);
    });

    it('refuses to bind a null-workspace unpublished USER_ASSET', async () => {
      await request(app.getHttpServer())
        .post(
          `/projects/${projectId}/ahsp-occurrences/boq-items/${privateBoqItemId}/select-ahsp`,
        )
        .set('Authorization', `Bearer ${token}`)
        .send({
          ahspVersionId: nullWorkspacePrivateVersionId,
          businessPricingAsOfDate: asOfDate,
          referenceRegionId: regionId,
          idempotencyKey: `${tag}-nullws-bind`,
        })
        .expect(404);
    });

    it('refuses to bind an archived private AHSP', async () => {
      await request(app.getHttpServer())
        .post(
          `/projects/${projectId}/ahsp-occurrences/boq-items/${privateBoqItemId}/select-ahsp`,
        )
        .set('Authorization', `Bearer ${token}`)
        .send({
          ahspVersionId: archivedPrivateVersionId,
          businessPricingAsOfDate: asOfDate,
          referenceRegionId: regionId,
          idempotencyKey: `${tag}-archived-bind`,
        })
        .expect(404);
    });

    it('ignores a forged workspaceId in the AHSP create body', async () => {
      // The trusted workspace context wins. Previously the body value won, so
      // a member of one workspace could plant an asset into another — and with
      // private eligibility keyed on that column, plant it into their pricing.
      const response = await request(app.getHttpServer())
        .post('/ahsp')
        .set('Authorization', `Bearer ${manageToken}`)
        .set('x-workspace-id', workspaceId)
        .send({
          workspaceId: otherWorkspaceId,
          userId: manageAccountId,
          workType: `${tag} Forged`,
          methodType: 'MANUAL',
          locationType: 'GENERAL',
          methodName: `${tag}-forged`,
        })
        .expect(201);

      expect(response.body.workspaceId).toBe(workspaceId);
      expect(response.body.workspaceId).not.toBe(otherWorkspaceId);
    });

    it('refuses to append a version to another workspace AHSP', async () => {
      // A version is what gets bound and priced, so this was a write into
      // another tenant's pricing surface. Reported as not-found so the
      // endpoint never confirms an id the caller may not see.
      await request(app.getHttpServer())
        .post(`/ahsp/${foreignPrivateAhspId}/versions`)
        .set('Authorization', `Bearer ${manageToken}`)
        .set('x-workspace-id', workspaceId)
        .send({
          outputUnit: 'M1',
          userId: manageAccountId,
          effectiveDate: new Date('2026-08-01T00:00:00.000Z'),
          resources: [
            {
              resourceId: `${tag} Current`,
              resourceType: 'LABOR',
              coefficient: 1,
              baseUnit: 'OH',
            },
          ],
        })
        .expect(404);
    });
  });
});
