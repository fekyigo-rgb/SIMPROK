import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import * as bcrypt from 'bcrypt';

const PASSWORD = 'Test1234!';
const SALT_ROUNDS = 10;

describe('Organization Security (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;

  let orgAId: string;
  let orgBId: string;
  let workspaceAId: string;
  let workspaceBId: string;

  let userAEmail = 'org.sec.usera@test.local';
  let userBEmail = 'org.sec.userb@test.local';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = new PrismaClient();

    const passwordHash = await bcrypt.hash(PASSWORD, SALT_ROUNDS);

    // Org A + Workspace A
    const orgA = await prisma.organization.create({
      data: { name: 'Org Security A', type: 'COMPANY' }
    });
    orgAId = orgA.id;
    const wsA = await prisma.workspace.create({
      data: { name: 'WS Org Sec A', organizationId: orgA.id }
    });
    workspaceAId = wsA.id;

    // Org B + Workspace B
    const orgB = await prisma.organization.create({
      data: { name: 'Org Security B', type: 'COMPANY' }
    });
    orgBId = orgB.id;
    const wsB = await prisma.workspace.create({
      data: { name: 'WS Org Sec B', organizationId: orgB.id }
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
  it('1. no token -> GET /organizations returns 401', async () => {
    await request(app.getHttpServer())
      .get('/organizations')
      .expect(401);
  });

  // ── Test 2: No x-workspace-id header ────────────────────────────────────────
  it('2. no x-workspace-id header -> GET /organizations still returns authorized org (not blocked)', async () => {
    const token = await login(userAEmail);

    // Should succeed without x-workspace-id since GET no longer uses PermissionsGuard
    const res = await request(app.getHttpServer())
      .get('/organizations')
      .set('Authorization', `Bearer ${token}`)
      // Deliberately omit x-workspace-id
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    const ids = res.body.map((o: any) => o.id);
    expect(ids).toContain(orgAId);
  });

  // ── Test 3: User-A only sees Org-A ─────────────────────────────────────────
  it('3. Workspace-A user receives only Org-A, not Org-B', async () => {
    const token = await login(userAEmail);

    const res = await request(app.getHttpServer())
      .get('/organizations')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);

    const ids = res.body.map((o: any) => o.id);
    const names = res.body.map((o: any) => o.name);
    const types = res.body.map((o: any) => o.type);

    // Must contain Org-A
    expect(ids).toContain(orgAId);

    // Must NOT contain Org-B
    expect(ids).not.toContain(orgBId);
    expect(names).not.toContain('Org Security B');
    // Explicitly verify no Org-B data in any field
    const orgBEntry = res.body.find((o: any) => o.id === orgBId);
    expect(orgBEntry).toBeUndefined();
  });

  // ── Test 4: User-B only sees Org-B ─────────────────────────────────────────
  it('4. Workspace-B user receives only Org-B, not Org-A', async () => {
    const token = await login(userBEmail);

    const res = await request(app.getHttpServer())
      .get('/organizations')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);

    const ids = res.body.map((o: any) => o.id);
    const names = res.body.map((o: any) => o.name);

    // Must contain Org-B
    expect(ids).toContain(orgBId);

    // Must NOT contain Org-A
    expect(ids).not.toContain(orgAId);
    expect(names).not.toContain('Org Security A');
    const orgAEntry = res.body.find((o: any) => o.id === orgAId);
    expect(orgAEntry).toBeUndefined();
  });

  // ── Test 5: Global leak regression ─────────────────────────────────────────
  it('5. GET /organizations does not return all organizations globally', async () => {
    const token = await login(userAEmail);

    const totalOrgs = await prisma.organization.count();
    const res = await request(app.getHttpServer())
      .get('/organizations')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);

    // If there are more orgs in DB than user-A belongs to, the response must be < total
    if (totalOrgs > 1) {
      expect(res.body.length).toBeLessThan(totalOrgs);
    }

    // Confirm Org-B not present for User-A
    const returnedIds = res.body.map((o: any) => o.id);
    expect(returnedIds).not.toContain(orgBId);
  });

  // ── Test 6: Spoofed x-workspace-id regression ──────────────────────────────
  it('6. Workspace-A user with spoofed x-workspace-id=workspaceBId still cannot see Org-B', async () => {
    const token = await login(userAEmail);

    // Send Workspace-B ID as the x-workspace-id header — spoofed
    const res = await request(app.getHttpServer())
      .get('/organizations')
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceBId)   // spoofed header
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);

    // User-A is NOT a member of Workspace-B, so Org-B must not appear
    const ids = res.body.map((o: any) => o.id);
    expect(ids).not.toContain(orgBId);

    // User-A IS a member of Workspace-A, so Org-A should still appear
    expect(ids).toContain(orgAId);
  });
});
