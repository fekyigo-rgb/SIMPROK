import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import * as bcrypt from 'bcrypt';

const PASSWORD = 'Test1234!';
const SALT_ROUNDS = 10;

describe('Workspace Security (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;

  let orgAId: string;
  let orgBId: string;
  let workspaceAId: string;
  let workspaceBId: string;

  let userAEmail = 'ws.sec.usera@test.local';
  let userBEmail = 'ws.sec.userb@test.local';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = new PrismaClient();

    const passwordHash = await bcrypt.hash(PASSWORD, SALT_ROUNDS);

    // Create two isolated orgs and workspaces
    const orgA = await prisma.organization.create({
      data: { name: 'Org WS Sec A', type: 'COMPANY' }
    });
    orgAId = orgA.id;
    const wsA = await prisma.workspace.create({
      data: { name: 'WS Sec A', organizationId: orgA.id }
    });
    workspaceAId = wsA.id;

    const orgB = await prisma.organization.create({
      data: { name: 'Org WS Sec B', type: 'COMPANY' }
    });
    orgBId = orgB.id;
    const wsB = await prisma.workspace.create({
      data: { name: 'WS Sec B', organizationId: orgB.id }
    });
    workspaceBId = wsB.id;

    // User A: ACTIVE member of Workspace-A only
    const accountA = await prisma.account.create({
      data: { email: userAEmail, passwordHash, displayName: userAEmail, status: 'ACTIVE' }
    });
    const membershipA = await prisma.workspaceMembership.create({
      data: { accountId: accountA.id, workspaceId: workspaceAId, status: 'ACTIVE' }
    });
    await prisma.user.create({
      data: {
        workspaceMembershipId: membershipA.id,
        workspaceId: workspaceAId,
        fullName: userAEmail,
        status: 'ACTIVE'
      }
    });

    // User B: ACTIVE member of Workspace-B only
    const accountB = await prisma.account.create({
      data: { email: userBEmail, passwordHash, displayName: userBEmail, status: 'ACTIVE' }
    });
    const membershipB = await prisma.workspaceMembership.create({
      data: { accountId: accountB.id, workspaceId: workspaceBId, status: 'ACTIVE' }
    });
    await prisma.user.create({
      data: {
        workspaceMembershipId: membershipB.id,
        workspaceId: workspaceBId,
        fullName: userBEmail,
        status: 'ACTIVE'
      }
    });
  });

  afterAll(async () => {
    const emails = [userAEmail, userBEmail];
    const accounts = await prisma.account.findMany({ where: { email: { in: emails } } });
    const accountIds = accounts.map(a => a.id);
    const memberships = await prisma.workspaceMembership.findMany({ where: { accountId: { in: accountIds } } });
    const membershipIds = memberships.map(m => m.id);

    await prisma.user.deleteMany({ where: { workspaceMembershipId: { in: membershipIds } } });
    await prisma.workspaceMembership.deleteMany({ where: { id: { in: membershipIds } } });
    await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.workspace.deleteMany({ where: { id: { in: [workspaceAId, workspaceBId] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgAId, orgBId] } } });

    await app.close();
    await prisma.$disconnect();
  });

  const login = async (email: string) => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(201);
    return res.body.access_token;
  };

  // ── Test 1: No token ────────────────────────────────────────────────────────
  it('1. no token -> GET /workspace returns 401', async () => {
    await request(app.getHttpServer())
      .get('/workspace')
      .expect(401);
  });

  // ── Test 2: User-A only sees Workspace-A ───────────────────────────────────
  it('2. Workspace-A user receives only their workspace, not Workspace-B', async () => {
    const token = await login(userAEmail);

    const res = await request(app.getHttpServer())
      .get('/workspace')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);

    const ids = res.body.map((w: any) => w.id);
    const names = res.body.map((w: any) => w.name);
    const orgIds = res.body.map((w: any) => w.organizationId);

    // Must include Workspace-A
    expect(ids).toContain(workspaceAId);

    // Must NOT include Workspace-B (id, name, organizationId)
    expect(ids).not.toContain(workspaceBId);
    expect(names).not.toContain('WS Sec B');
    expect(orgIds).not.toContain(orgBId);
  });

  // ── Test 3: User-B only sees Workspace-B ───────────────────────────────────
  it('3. Workspace-B user receives only their workspace, not Workspace-A', async () => {
    const token = await login(userBEmail);

    const res = await request(app.getHttpServer())
      .get('/workspace')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);

    const ids = res.body.map((w: any) => w.id);
    const names = res.body.map((w: any) => w.name);
    const orgIds = res.body.map((w: any) => w.organizationId);

    // Must include Workspace-B
    expect(ids).toContain(workspaceBId);

    // Must NOT include Workspace-A (id, name, organizationId)
    expect(ids).not.toContain(workspaceAId);
    expect(names).not.toContain('WS Sec A');
    expect(orgIds).not.toContain(orgAId);
  });

  // ── Test 4: Global leak regression ─────────────────────────────────────────
  it('4. GET /workspace does not return all workspaces globally', async () => {
    const token = await login(userAEmail);

    const totalWorkspaces = await prisma.workspace.count();
    const res = await request(app.getHttpServer())
      .get('/workspace')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);

    // If total workspaces > 1, scoped response must be strictly less than global count
    if (totalWorkspaces > 1) {
      expect(res.body.length).toBeLessThan(totalWorkspaces);
    }

    // Confirm Workspace-B is absolutely not present
    const returnedIds = res.body.map((w: any) => w.id);
    expect(returnedIds).not.toContain(workspaceBId);
  });
});
