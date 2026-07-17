import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

describe('Cost Kernel Grade A R1 test certification (e2e)', () => {
  const prisma = new PrismaClient();
  const tag = `CKR1${Date.now()}`;
  const password = 'CostKernelR1!';
  const labels = 'TEST_FIXTURE_ONLY OWNER_SUPPLIED_EXAMPLE_NON_PRODUCTION';
  let app: INestApplication;
  let projectId: string;
  let boqItemId: string;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let ahspId: string;
  let token: string;
  let noPermissionToken: string;
  let otherTenantToken: string;
  const createdPermissionIds: string[] = [];
  const accountIds: string[] = [];
  const membershipIds: string[] = [];

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
    projectId = project.id;

    const permission =
      (await prisma.permission.findUnique({
        where: { code: 'PROJECT_VIEW' },
      })) ??
      (await prisma.permission.create({
        data: {
          code: 'PROJECT_VIEW',
          name: `${tag} PROJECT_VIEW`,
          description: labels,
        },
      }));
    if (permission.name.startsWith(tag))
      createdPermissionIds.push(permission.id);
    const viewRole = await prisma.role.create({
      data: {
        workspaceId,
        code: `${tag}_VIEW`,
        name: `${tag} View`,
        rolePermissions: { create: [{ permissionId: permission.id }] },
      },
    });
    const noPermissionRole = await prisma.role.create({
      data: { workspaceId, code: `${tag}_NONE`, name: `${tag} None` },
    });
    const otherRole = await prisma.role.create({
      data: {
        workspaceId: otherWorkspaceId,
        code: `${tag}_OTHER`,
        name: `${tag} Other`,
        rolePermissions: { create: [{ permissionId: permission.id }] },
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
      await prisma.user.create({
        data: {
          workspaceMembershipId: membership.id,
          workspaceId: ws,
          fullName: suffix,
          status: 'ACTIVE',
        },
      });
      if (assigned)
        await prisma.projectAssignment.create({
          data: {
            workspaceMembershipId: membership.id,
            projectId,
            roleInProject: 'MEMBER',
            isPrimaryAssignment: true,
            status: 'ASSIGNED',
          },
        });
      return email;
    };

    token = await login(
      await createActor('viewer', workspaceId, viewRole.id, true),
    );
    noPermissionToken = await login(
      await createActor(
        'no-permission',
        workspaceId,
        noPermissionRole.id,
        true,
      ),
    );
    otherTenantToken = await login(
      await createActor('other-tenant', otherWorkspaceId, otherRole.id, false),
    );

    const ahsp = await prisma.aHSP.create({
      data: {
        workspaceId,
        workType: 'Pembuatan pagar sementara dari kayu tinggi 2 meter',
        methodType: 'MANUAL',
        locationType: 'GENERAL',
        methodName: `${tag} 1.1.1.1`,
      },
    });
    ahspId = ahsp.id;
    const version = await prisma.aHSPVersion.create({
      data: {
        ahspId,
        workspaceId,
        versionNumber: 1,
        outputUnit: 'M1',
        regulationReference: `1.1.1.1 ${labels}`,
      },
    });
    const names = [
      'Pekerja',
      'Tukang Kayu',
      'Tukang batu',
      'Kepala Tukang',
      'Mandor',
      'kaso kayu5/7 kayu kelas II',
      'Papan Kayu Uk 2/20cm',
      'Paku biasa',
      'Semen Portland',
      'Pasir beton',
      'Kerikil',
      'Air',
      'Residu atau ter',
    ];
    const units = [
      'OH',
      'OH',
      'OH',
      'OH',
      'OH',
      'm3',
      'm3',
      'Kg',
      'Kg',
      'Kg',
      'Kg',
      'Liter',
      'Liter',
    ];
    const coefficients = [
      '0.600000',
      '0.200000',
      '0.200000',
      '0.040000',
      '0.013000',
      '0.038700',
      '0.039600',
      '0.587200',
      '26.406000',
      '61.560000',
      '83.349000',
      '17.415000',
      '0.400000',
    ];
    const prices = [
      '100000.00',
      '100000.00',
      '100000.00',
      '120000.00',
      '100000.00',
      '10000.00',
      '10000.00',
      '10000.00',
      '10000.00',
      '10000.00',
      '10000.00',
      '10000.00',
      '10000.00',
    ];
    const resources = await Promise.all(
      names.map((name, index) =>
        prisma.aHSPResource.create({
          data: {
            ahspVersionId: version.id,
            resourceId: name,
            resourceType: index < 5 ? 'LABOR' : 'MATERIAL',
            coefficient: coefficients[index],
            baseUnit: units[index],
          },
        }),
      ),
    );
    await prisma.projectAhspOccurrence.create({
      data: {
        workspaceId,
        projectId,
        ahspVersionId: version.id,
        idempotencyKey: `${tag}-${labels}`,
        resourceResolutions: {
          create: resources.map((resource, index) => ({
            ahspResourceId: resource.id,
            rawAhspResourceRef: names[index],
            rawAhspResourceType: index < 5 ? 'LABOR' : 'MATERIAL',
            ahspCoefficient: coefficients[index],
            ahspUnit: units[index],
            status: 'RESOLVED',
            adaptedPriceValue: prices[index],
            resolutionMethod: 'EXACT_DETERMINISTIC',
            reasonCodes: ['TEST_FIXTURE_ONLY'],
            explanation: labels,
            policyVersion: labels,
          })),
        },
      },
    });
    const structure = await prisma.boqStructure.create({
      data: {
        projectId,
        name: `${tag} Working Draft`,
        version: 1,
        status: 'DRAFT',
      },
    });
    const item = await prisma.boqItem.create({
      data: {
        boqStructureId: structure.id,
        wbsCode: '1.1.1.1',
        name: 'Pembuatan pagar sementara dari kayu tinggi 2 meter',
        itemType: 'WORK_ITEM',
        quantity: '10',
        unit: 'M1',
        unitPrice: null,
        lineTotal: null,
        ahspVersionId: version.id,
      },
    });
    boqItemId = item.id;
  }, 30_000);

  afterAll(async () => {
    await prisma.boqItem.deleteMany({ where: { boqStructure: { projectId } } });
    await prisma.boqStructure.deleteMany({ where: { projectId } });
    await prisma.projectAhspResourceResolution.deleteMany({
      where: { occurrence: { projectId } },
    });
    await prisma.projectAhspOccurrence.deleteMany({ where: { projectId } });
    await prisma.aHSPResource.deleteMany({
      where: { ahspVersion: { ahspId } },
    });
    await prisma.aHSPVersion.deleteMany({ where: { ahspId } });
    await prisma.aHSP.deleteMany({ where: { id: ahspId } });
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
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.workspace.deleteMany({
      where: { id: { in: [workspaceId, otherWorkspaceId] } },
    });
    await prisma.organization.deleteMany({
      where: { name: { startsWith: tag } },
    });
    await app.close();
    await prisma.$disconnect();
  }, 30_000);

  const getCalculation = (bearer: string) =>
    request(app.getHttpServer())
      .get(`/projects/${projectId}/boq/items/${boqItemId}/cost-calculation`)
      .set('Authorization', `Bearer ${bearer}`);

  it('returns the exact backend calculation from 13 frozen prices without persisting it', async () => {
    const before = await prisma.boqItem.findUniqueOrThrow({
      where: { id: boqItemId },
    });
    expect(before.unitPrice).toBeNull();
    expect(before.lineTotal).toBeNull();
    const response = await getCalculation(token).expect(200);
    expect(response.body).toMatchObject({
      status: 'CALCULATED',
      volume: '10',
      outputUnit: 'M1',
      ahspUnitPrice: '2004055',
      lineTotal: '20040550',
      currency: 'IDR',
      calculationPolicy: 'COST_KERNEL_GRADE_A_V1',
    });
    expect(response.body.resources).toHaveLength(13);
    const after = await prisma.boqItem.findUniqueOrThrow({
      where: { id: boqItemId },
    });
    expect(after.unitPrice).toBeNull();
    expect(after.lineTotal).toBeNull();
  });

  it('rejects an assigned member without PROJECT_VIEW', async () => {
    await getCalculation(noPermissionToken).expect(403);
  });

  it('rejects a token from another tenant', async () => {
    await getCalculation(otherTenantToken).expect(404);
  });
});
