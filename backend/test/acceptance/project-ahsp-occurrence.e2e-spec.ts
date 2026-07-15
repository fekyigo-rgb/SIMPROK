import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

describe('Project AHSP occurrence persistence (e2e)', () => {
  const prisma = new PrismaClient();
  const password = 'CommitD123!';
  const tag = `CDAHSP${Date.now()}`;
  let app: INestApplication;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let projectId: string;
  let otherProjectId: string;
  let accountId: string;
  let token: string;
  let noManageToken: string;
  let noViewToken: string;
  let unassignedToken: string;
  let crossToken: string;
  let ahspId: string;
  let versionId: string;
  let otherVersionId: string;
  let resolvedResourceId: string;
  let unresolvedResourceId: string;
  let expiredResourceId: string;
  let multipleResourceId: string;
  let selectedPriceId: string;
  let resolvedOccurrenceId: string;
  let resolvedResolutionId: string;
  const createdPermissionIds: string[] = [];

  const login = async (email: string) => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    return response.body.access_token as string;
  };

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
        status: 'ACTIVE',
      },
    });
    const otherProject = await prisma.project.create({
      data: {
        workspaceId,
        organizationId: org.id,
        code: `${tag}-P2`,
        name: `${tag} Project 2`,
        status: 'ACTIVE',
      },
    });
    projectId = project.id;
    otherProjectId = otherProject.id;

    const ensurePermission = async (code: 'AHSP_MANAGE' | 'AHSP_VIEW') => {
      const existing = await prisma.permission.findUnique({ where: { code } });
      if (existing) return existing;
      const created = await prisma.permission.create({
        data: {
          code,
          name: `${tag} ${code}`,
          description: 'Commit D isolated E2E permission fixture',
        },
      });
      createdPermissionIds.push(created.id);
      return created;
    };
    const managePermission = await ensurePermission('AHSP_MANAGE');
    const viewPermission = await ensurePermission('AHSP_VIEW');
    const manageRole = await prisma.role.create({
      data: {
        workspaceId,
        code: `${tag}_MANAGE`,
        name: `${tag} Manage`,
        rolePermissions: {
          create: [
            { permissionId: managePermission.id },
            { permissionId: viewPermission.id },
          ],
        },
      },
    });
    const viewRole = await prisma.role.create({
      data: {
        workspaceId,
        code: `${tag}_VIEW`,
        name: `${tag} View`,
        rolePermissions: { create: [{ permissionId: viewPermission.id }] },
      },
    });
    const manageOnlyRole = await prisma.role.create({
      data: {
        workspaceId,
        code: `${tag}_MANAGE_ONLY`,
        name: `${tag} Manage Only`,
        rolePermissions: { create: [{ permissionId: managePermission.id }] },
      },
    });
    const noPermissionRole = await prisma.role.create({
      data: { workspaceId, code: `${tag}_NONE`, name: `${tag} None` },
    });
    const crossRole = await prisma.role.create({
      data: {
        workspaceId: otherWorkspaceId,
        code: `${tag}_CROSS`,
        name: `${tag} Cross`,
        rolePermissions: {
          create: [
            { permissionId: managePermission.id },
            { permissionId: viewPermission.id },
          ],
        },
      },
    });

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

    const actor = await createActor('actor', workspaceId, manageRole.id, true);
    const viewer = await createActor('viewer', workspaceId, viewRole.id, true);
    const managerOnly = await createActor(
      'manager-only',
      workspaceId,
      manageOnlyRole.id,
      true,
    );
    const unassigned = await createActor(
      'unassigned',
      workspaceId,
      noPermissionRole.id,
      false,
    );
    const cross = await createActor(
      'cross',
      otherWorkspaceId,
      crossRole.id,
      false,
    );
    accountId = actor.id;
    await prisma.projectAssignment.create({
      data: {
        workspaceMembershipId: actor.membershipId,
        projectId: otherProjectId,
        roleInProject: 'MEMBER',
        isPrimaryAssignment: false,
        status: 'ASSIGNED',
      },
    });
    token = await login(actor.email);
    noManageToken = await login(viewer.email);
    noViewToken = await login(managerOnly.email);
    unassignedToken = await login(unassigned.email);
    crossToken = await login(cross.email);

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
    const version = await prisma.aHSPVersion.create({
      data: { ahspId, workspaceId, versionNumber: 1 },
    });
    const otherVersion = await prisma.aHSPVersion.create({
      data: { ahspId, workspaceId, versionNumber: 2 },
    });
    versionId = version.id;
    otherVersionId = otherVersion.id;
    const resources = await Promise.all([
      prisma.aHSPResource.create({
        data: {
          ahspVersionId: versionId,
          resourceId: `${tag} Pekerja`,
          resourceType: 'LABOR',
          coefficient: '1.234567',
          baseUnit: 'OH',
        },
      }),
      prisma.aHSPResource.create({
        data: {
          ahspVersionId: versionId,
          resourceId: `${tag} Missing`,
          resourceType: 'LABOR',
          coefficient: '1',
          baseUnit: 'OH',
        },
      }),
      prisma.aHSPResource.create({
        data: {
          ahspVersionId: versionId,
          resourceId: `${tag} Expired`,
          resourceType: 'LABOR',
          coefficient: '1',
          baseUnit: 'OH',
        },
      }),
      prisma.aHSPResource.create({
        data: {
          ahspVersionId: versionId,
          resourceId: `${tag} Multiple`,
          resourceType: 'LABOR',
          coefficient: '1',
          baseUnit: 'OH',
        },
      }),
    ]);
    [
      resolvedResourceId,
      unresolvedResourceId,
      expiredResourceId,
      multipleResourceId,
    ] = resources.map((row) => row.id);

    const resolvedCatalog = await prisma.resourceCatalog.create({
      data: {
        workspaceId,
        code: `${tag}-RC`,
        name: `${tag} Pekerja`,
        type: 'LABOR',
        baseUnit: 'Org/Hari',
      },
    });
    const expiredCatalog = await prisma.resourceCatalog.create({
      data: {
        workspaceId,
        code: `${tag}-EX`,
        name: `${tag} Expired`,
        type: 'LABOR',
        baseUnit: 'Org/Hari',
      },
    });
    const multipleCatalog = await prisma.resourceCatalog.create({
      data: {
        workspaceId,
        code: `${tag}-MU`,
        name: `${tag} Multiple`,
        type: 'LABOR',
        baseUnit: 'Org/Hari',
      },
    });
    const selectedPrice = await prisma.basicPrice.create({
      data: {
        workspaceId,
        resourceId: resolvedCatalog.id,
        effectiveDate: new Date('2026-07-15T00:00:00Z'),
        value: '1234567890123456.78',
        sourceOrigin: 'SUPPLIER',
        verificationStatus: 'PUBLISHED',
        freshnessStatus: 'CURRENT',
        status: 'PUBLISHED',
      },
    });
    selectedPriceId = selectedPrice.id;
    await prisma.basicPrice.create({
      data: {
        workspaceId,
        resourceId: expiredCatalog.id,
        effectiveDate: new Date(),
        value: '50.00',
        sourceOrigin: 'STORE',
        verificationStatus: 'PUBLISHED',
        freshnessStatus: 'EXPIRED',
        status: 'PUBLISHED',
      },
    });
    await prisma.basicPrice.createMany({
      data: [
        {
          workspaceId,
          resourceId: multipleCatalog.id,
          effectiveDate: new Date(),
          value: '60.00',
          sourceOrigin: 'STORE',
          verificationStatus: 'PUBLISHED',
          freshnessStatus: 'CURRENT',
          status: 'PUBLISHED',
        },
        {
          workspaceId,
          resourceId: multipleCatalog.id,
          effectiveDate: new Date(),
          value: '70.00',
          sourceOrigin: 'SUPPLIER',
          verificationStatus: 'PUBLISHED',
          freshnessStatus: 'EXPIRING',
          status: 'PUBLISHED',
        },
      ],
    });
  }, 30_000);

  afterAll(async () => {
    await prisma.projectAhspResourceResolution.deleteMany({
      where: { occurrence: { projectId: { in: [projectId, otherProjectId] } } },
    });
    await prisma.projectAhspOccurrence.deleteMany({
      where: { projectId: { in: [projectId, otherProjectId] } },
    });
    await prisma.basicPrice.deleteMany({
      where: { resource: { code: { startsWith: tag } } },
    });
    await prisma.resourceCatalog.deleteMany({
      where: { code: { startsWith: tag } },
    });
    await prisma.aHSPResource.deleteMany({
      where: { ahspVersion: { ahspId } },
    });
    await prisma.aHSPVersion.deleteMany({ where: { ahspId } });
    await prisma.aHSP.deleteMany({ where: { id: ahspId } });
    const accounts = await prisma.account.findMany({
      where: { email: { startsWith: tag.toLowerCase() } },
    });
    const accountIds = accounts.map((row) => row.id);
    const memberships = await prisma.workspaceMembership.findMany({
      where: { accountId: { in: accountIds } },
    });
    const membershipIds = memberships.map((row) => row.id);
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
  }, 30_000);

  const post = (
    resourceId: string,
    key: string,
    bearer = token,
    version = versionId,
  ) =>
    request(app.getHttpServer())
      .post(`/projects/${projectId}/ahsp-occurrences`)
      .set('Authorization', `Bearer ${bearer}`)
      .send({
        ahspVersionId: version,
        ahspResourceId: resourceId,
        idempotencyKey: key,
      });

  it('POST without JWT returns 401', () =>
    request(app.getHttpServer())
      .post(`/projects/${projectId}/ahsp-occurrences`)
      .send({})
      .expect(401));

  it('POST without AHSP_MANAGE returns 403', () =>
    post(resolvedResourceId, `${tag}-no-manage`, noManageToken).expect(403));

  it('same-workspace unassigned and cross-workspace actors are rejected', async () => {
    await post(resolvedResourceId, `${tag}-unassigned`, unassignedToken).expect(
      403,
    );
    await post(resolvedResourceId, `${tag}-cross`, crossToken).expect(404);
  });

  it('resource/version mismatch returns 404 and writes zero rows', async () => {
    const before = await prisma.projectAhspOccurrence.count({
      where: { projectId },
    });
    await post(
      resolvedResourceId,
      `${tag}-mismatch`,
      token,
      otherVersionId,
    ).expect(404);
    expect(
      await prisma.projectAhspOccurrence.count({ where: { projectId } }),
    ).toBe(before);
  });

  it('valid POST ignores spoof fields and persists server-owned exact evidence', async () => {
    const response = await request(app.getHttpServer())
      .post(`/projects/${projectId}/ahsp-occurrences`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        ahspVersionId: versionId,
        ahspResourceId: resolvedResourceId,
        idempotencyKey: `${tag}-resolved`,
        workspaceId: otherWorkspaceId,
        projectId: otherProjectId,
        createdByAccountId: '00000000-0000-4000-8000-000000000000',
        status: 'UNRESOLVED',
        selectionMode: 'USER_OVERRIDDEN',
        selectedBasicPriceId: '00000000-0000-4000-8000-000000000000',
        sourcePriceValue: '1.00',
        policyVersion: 'SPOOFED',
      })
      .expect(201);
    const occurrence = response.body;
    const resolution = occurrence.resourceResolutions[0];
    resolvedOccurrenceId = occurrence.id;
    resolvedResolutionId = resolution.id;
    expect(occurrence.projectId).toBe(projectId);
    expect(occurrence.workspaceId).toBe(workspaceId);
    expect(occurrence.createdByAccountId).toBe(accountId);
    expect(resolution.status).toBe('RESOLVED');
    expect(resolution.selectionMode).toBe('AUTO_SELECTED');
    expect(resolution.selectedBasicPriceId).toBe(selectedPriceId);
    expect(resolution.sourcePriceValue).toBe('1234567890123456.78');
    expect(resolution.adaptedPriceValue).toBe('1234567890123456.78');
    expect(resolution.policyVersion).toBe(
      'BP_AHSP_PHASE2_NAME_EXACT_OPTION_C_V1',
    );
  });

  it('GET without AHSP_VIEW returns 403 and valid GET returns the same IDs', async () => {
    await request(app.getHttpServer())
      .get(`/projects/${projectId}/ahsp-occurrences/${resolvedOccurrenceId}`)
      .set('Authorization', `Bearer ${noViewToken}`)
      .expect(403);
    const response = await request(app.getHttpServer())
      .get(`/projects/${projectId}/ahsp-occurrences/${resolvedOccurrenceId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(response.body.id).toBe(resolvedOccurrenceId);
    expect(response.body.resourceResolutions[0].id).toBe(resolvedResolutionId);
  });

  it('cross-project and cross-workspace GET remain concealed', async () => {
    await request(app.getHttpServer())
      .get(
        `/projects/${otherProjectId}/ahsp-occurrences/${resolvedOccurrenceId}`,
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/projects/${projectId}/ahsp-occurrences/${resolvedOccurrenceId}`)
      .set('Authorization', `Bearer ${crossToken}`)
      .expect(404);
  });

  it('no exact catalog persists UNRESOLVED with no invented selection', async () => {
    const response = await post(
      unresolvedResourceId,
      `${tag}-unresolved`,
    ).expect(201);
    expect(response.body.resourceResolutions[0]).toMatchObject({
      status: 'UNRESOLVED',
      selectedBasicPriceId: null,
      resourceCatalogId: null,
      sourcePriceValue: null,
    });
  });

  it('expired-only persists NEEDS_REVIEW without selected price', async () => {
    const response = await post(expiredResourceId, `${tag}-expired`).expect(
      201,
    );
    expect(response.body.resourceResolutions[0].status).toBe('NEEDS_REVIEW');
    expect(
      response.body.resourceResolutions[0].selectedBasicPriceId,
    ).toBeNull();
    expect(response.body.resourceResolutions[0].reasonCodes).toContain(
      'ONLY_EXPIRED_BASIC_PRICE_CANDIDATES',
    );
  });

  it('multiple active prices persist NEEDS_REVIEW without ranking', async () => {
    const response = await post(multipleResourceId, `${tag}-multiple`).expect(
      201,
    );
    expect(response.body.resourceResolutions[0].status).toBe('NEEDS_REVIEW');
    expect(
      response.body.resourceResolutions[0].selectedBasicPriceId,
    ).toBeNull();
    expect(response.body.resourceResolutions[0].reasonCodes).toContain(
      'MULTIPLE_BASIC_PRICE_CANDIDATES',
    );
  });

  it('sequential replay returns identical IDs without increasing row counts', async () => {
    const beforeOccurrence = await prisma.projectAhspOccurrence.count({
      where: { id: resolvedOccurrenceId },
    });
    const response = await post(resolvedResourceId, `${tag}-resolved`).expect(
      201,
    );
    expect(response.body.id).toBe(resolvedOccurrenceId);
    expect(response.body.resourceResolutions[0].id).toBe(resolvedResolutionId);
    expect(
      await prisma.projectAhspOccurrence.count({
        where: { id: resolvedOccurrenceId },
      }),
    ).toBe(beforeOccurrence);
  });

  it('same key with different payload returns 409 and preserves original', async () => {
    await post(unresolvedResourceId, `${tag}-resolved`).expect(409);
    const original = await prisma.projectAhspOccurrence.findUniqueOrThrow({
      where: { id: resolvedOccurrenceId },
    });
    expect(original.ahspVersionId).toBe(versionId);
  });

  it('concurrent identical requests converge on one occurrence and resolution', async () => {
    const key = `${tag}-concurrent`;
    const responses = await Promise.all([
      post(resolvedResourceId, key).expect(201),
      post(resolvedResourceId, key).expect(201),
    ]);
    expect(responses[0].body.id).toBe(responses[1].body.id);
    expect(responses[0].body.resourceResolutions[0].id).toBe(
      responses[1].body.resourceResolutions[0].id,
    );
    expect(
      await prisma.projectAhspOccurrence.count({
        where: { projectId, idempotencyKey: key },
      }),
    ).toBe(1);
    expect(
      await prisma.projectAhspResourceResolution.count({
        where: { occurrence: { projectId, idempotencyKey: key } },
      }),
    ).toBe(1);
  });

  it('does not mutate master AHSP evidence while resolving', async () => {
    const ahsp = await prisma.aHSP.findUniqueOrThrow({ where: { id: ahspId } });
    const resource = await prisma.aHSPResource.findUniqueOrThrow({
      where: { id: resolvedResourceId },
    });
    expect(ahsp.deletedAt).toBeNull();
    expect(resource.resourceId).toBe(`${tag} Pekerja`);
    expect(resource.coefficient.toString()).toBe('1.234567');
  });
});
