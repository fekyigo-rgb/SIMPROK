import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import * as bcrypt from 'bcrypt';

const PASSWORD = 'Test1234!';
const SALT_ROUNDS = 10;

describe('Basic Price (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;

  let workspaceAId: string;
  let workspaceBId: string;

  let userAEmail = 'bp2.usera@test.local';
  let userBEmail = 'bp2.userb@test.local';
  let userNoRoleEmail = 'bp2.usernorole@test.local';

  let tokenA: string;
  let tokenB: string;
  let tokenNoRole: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = new PrismaClient();

    const passwordHash = await bcrypt.hash(PASSWORD, SALT_ROUNDS);

    // Setup Orgs & Workspaces
    const orgA = await prisma.organization.create({ data: { name: 'Org BP A2', type: 'COMPANY' } });
    const wsA = await prisma.workspace.create({ data: { name: 'WS BP A2', organizationId: orgA.id } });
    workspaceAId = wsA.id;

    const orgB = await prisma.organization.create({ data: { name: 'Org BP B2', type: 'COMPANY' } });
    const wsB = await prisma.workspace.create({ data: { name: 'WS BP B2', organizationId: orgB.id } });
    workspaceBId = wsB.id;

    // Permissions
    const permView = await prisma.permission.upsert({
      where: { code: 'BASIC_PRICE_VIEW' },
      update: {},
      create: { code: 'BASIC_PRICE_VIEW', name: 'Basic Price View' }
    });

    // Roles and Permissions
    const viewerRole = await prisma.role.create({
      data: {
        workspaceId: workspaceAId,
        name: 'Basic Price Viewer',
        code: 'BP_VIEWER_A',
        rolePermissions: {
          create: [{ permissionId: permView.id }]
        }
      }
    });
    const viewerRoleB = await prisma.role.create({
      data: {
        workspaceId: workspaceBId,
        name: 'Basic Price Viewer B',
        code: 'BP_VIEWER_B',
        rolePermissions: {
          create: [{ permissionId: permView.id }]
        }
      }
    });

    // Users
    const accountA = await prisma.account.create({ data: { email: userAEmail, passwordHash, displayName: 'BP A', status: 'ACTIVE' } });
    const memberA = await prisma.workspaceMembership.create({
      data: { accountId: accountA.id, workspaceId: workspaceAId, status: 'ACTIVE', membershipRoles: { create: [{ roleId: viewerRole.id }] } }
    });
    await prisma.user.create({ data: { workspaceMembershipId: memberA.id, workspaceId: workspaceAId, fullName: 'BP A', status: 'ACTIVE' } });

    const accountB = await prisma.account.create({ data: { email: userBEmail, passwordHash, displayName: 'BP B', status: 'ACTIVE' } });
    const memberB = await prisma.workspaceMembership.create({
      data: { accountId: accountB.id, workspaceId: workspaceBId, status: 'ACTIVE', membershipRoles: { create: [{ roleId: viewerRoleB.id }] } }
    });
    await prisma.user.create({ data: { workspaceMembershipId: memberB.id, workspaceId: workspaceBId, fullName: 'BP B', status: 'ACTIVE' } });

    const accountNoRole = await prisma.account.create({ data: { email: userNoRoleEmail, passwordHash, displayName: 'No Role', status: 'ACTIVE' } });
    const memberNoRole = await prisma.workspaceMembership.create({ data: { accountId: accountNoRole.id, workspaceId: workspaceAId, status: 'ACTIVE' } });
    await prisma.user.create({ data: { workspaceMembershipId: memberNoRole.id, workspaceId: workspaceAId, fullName: 'No Role', status: 'ACTIVE' } });

    // Login users
    const resA = await request(app.getHttpServer()).post('/auth/login').send({ email: userAEmail, password: PASSWORD });
    tokenA = resA.body.access_token;

    const resB = await request(app.getHttpServer()).post('/auth/login').send({ email: userBEmail, password: PASSWORD });
    tokenB = resB.body.access_token;

    const resNoRole = await request(app.getHttpServer()).post('/auth/login').send({ email: userNoRoleEmail, password: PASSWORD });
    tokenNoRole = resNoRole.body.access_token;

    // Seed Data: Resource catalogs and Basic prices
    const globalRes = await prisma.resourceCatalog.create({ data: { workspaceId: null, code: 'MAT-GLOBAL', name: 'Global Cement', type: 'MATERIAL', baseUnit: 'Zak' } });
    await prisma.basicPrice.create({ data: { workspaceId: null, resourceId: globalRes.id, status: 'PUBLISHED', value: 120000, effectiveDate: new Date('2026-05-01'), sourceOrigin: 'GOVERNMENT', sourceType: 'MARKET_SURVEY', verificationStatus: 'VERIFIED', freshnessStatus: 'CURRENT' } });

    const tenantARes = await prisma.resourceCatalog.create({ data: { workspaceId: workspaceAId, code: 'MAT-TENANT-A', name: 'Tenant A Cement', type: 'MATERIAL', baseUnit: 'ZAK' } });
    await prisma.basicPrice.create({ data: { workspaceId: workspaceAId, resourceId: tenantARes.id, status: 'PUBLISHED', value: 150000, effectiveDate: new Date('2026-06-01'), sourceOrigin: 'SUPPLIER', sourceType: 'SYSTEM_ESTIMATE', verificationStatus: 'UNVERIFIED', freshnessStatus: 'EXPIRED' } });

    const tenantBRes = await prisma.resourceCatalog.create({ data: { workspaceId: workspaceBId, code: 'MAT-TENANT-B', name: 'Tenant B Cement', type: 'MATERIAL', baseUnit: 'KILOGRAM' } });
    await prisma.basicPrice.create({ data: { workspaceId: workspaceBId, resourceId: tenantBRes.id, status: 'PUBLISHED', value: 160000, effectiveDate: new Date('2026-07-01'), sourceOrigin: 'STORE', sourceType: 'VENDOR_QUOTE', verificationStatus: 'REJECTED', freshnessStatus: 'EXPIRED' } });
  });

  afterAll(async () => {
    // Teardown
    await prisma.basicPrice.deleteMany({
      where: { OR: [{ workspaceId: workspaceAId }, { workspaceId: workspaceBId }, { workspaceId: null, resource: { code: 'MAT-GLOBAL' } }] }
    });
    await prisma.resourceCatalog.deleteMany({
      where: { OR: [{ workspaceId: workspaceAId }, { workspaceId: workspaceBId }, { workspaceId: null, code: 'MAT-GLOBAL' }] }
    });
    const accountIds = await prisma.account.findMany({ where: { email: { in: [userAEmail, userBEmail, userNoRoleEmail] } } }).then(a => a.map(x => x.id));
    const memberships = await prisma.workspaceMembership.findMany({ where: { accountId: { in: accountIds } } });
    const membershipIds = memberships.map(m => m.id);

    await prisma.user.deleteMany({ where: { workspaceMembershipId: { in: membershipIds } } });
    // Also delete any dangling roles
    await prisma.role.deleteMany({ where: { workspaceId: { in: [workspaceAId, workspaceBId] } } });
    await prisma.workspaceMembership.deleteMany({ where: { id: { in: membershipIds } } });
    await prisma.workspaceMembership.deleteMany({ where: { workspaceId: { in: [workspaceAId, workspaceBId] } } });
    await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.workspace.deleteMany({ where: { id: { in: [workspaceAId, workspaceBId] } } });

    const orgA = await prisma.organization.findFirst({ where: { name: 'Org BP A2' }});
    const orgB = await prisma.organization.findFirst({ where: { name: 'Org BP B2' }});
    const orgIds = [];
    if (orgA) orgIds.push(orgA.id);
    if (orgB) orgIds.push(orgB.id);

    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });

    await prisma.$disconnect();
    await app.close();
  });

  it('rejects 401 when no token is provided', () => {
    return request(app.getHttpServer())
      .get('/basic-prices')
      .expect(401);
  });

  it('rejects 403 when user lacks BASIC_PRICE_VIEW permission', () => {
    return request(app.getHttpServer())
      .get('/basic-prices')
      .set('Authorization', `Bearer ${tokenNoRole}`)
      .set('X-Workspace-ID', workspaceAId)
      .expect(403);
  });

  it('returns global and own tenant prices only (isolation)', async () => {
    const res = await request(app.getHttpServer())
      .get('/basic-prices')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Workspace-ID', workspaceAId)
      .expect(200);

    expect(res.body.meta).toBeDefined();
    expect(res.body.data).toBeDefined();

    // Should see global + tenant A
    const codes = res.body.data.map((p: any) => p.resource.code);
    expect(codes).toContain('MAT-GLOBAL');
    expect(codes).toContain('MAT-TENANT-A');
    expect(codes).not.toContain('MAT-TENANT-B');

    // Honesty/Provenance check
    const tenantAPrice = res.body.data.find((p: any) => p.resource.code === 'MAT-TENANT-A');
    expect(tenantAPrice.sourceOrigin).toBe('SUPPLIER');
    expect(tenantAPrice.verificationStatus).toBe('UNVERIFIED');
    expect(tenantAPrice.freshnessStatus).toBe('EXPIRED');
  });

  it('filters basic prices correctly', async () => {
    const res = await request(app.getHttpServer())
      .get('/basic-prices?search=Global')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Workspace-ID', workspaceAId)
      .expect(200);

    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].resource.code).toBe('MAT-GLOBAL');
  });

  it('gets detail of a basic price correctly', async () => {
    const listRes = await request(app.getHttpServer())
      .get('/basic-prices?search=Global')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Workspace-ID', workspaceAId)
      .expect(200);

    const priceId = listRes.body.data[0].id;

    const detailRes = await request(app.getHttpServer())
      .get(`/basic-prices/${priceId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Workspace-ID', workspaceAId)
      .expect(200);

    expect(detailRes.body.id).toBe(priceId);
    expect(detailRes.body.resource).toBeDefined();
    expect(detailRes.body.resource.code).toBe('MAT-GLOBAL');
  });

  it('cannot view details of other tenant price', async () => {
    // Token A gets price from Tenant B
    const listResB = await request(app.getHttpServer())
      .get('/basic-prices')
      .set('Authorization', `Bearer ${tokenB}`)
      .set('X-Workspace-ID', workspaceBId)
      .expect(200);

    const priceBId = listResB.body.data.find((p: any) => p.resource.code === 'MAT-TENANT-B').id;

    await request(app.getHttpServer())
      .get(`/basic-prices/${priceBId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Workspace-ID', workspaceAId)
      .expect(404);
  });
});
