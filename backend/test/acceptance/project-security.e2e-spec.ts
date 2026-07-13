import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import * as bcrypt from 'bcrypt';

const PASSWORD = 'Test1234!';
const SALT_ROUNDS = 10;

describe('Project Security (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;

  let workspaceAId: string;
  let workspaceBId: string;
  let workspaceBProjectId: string;

  let userCreateEmail = 'proj.create.sec.v2@test.local';
  let userViewEmail = 'proj.view.sec.v2@test.local';
  let userDirectorEmail = 'proj.director.sec.v2@test.local';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = new PrismaClient();

    // Setup two orgs and workspaces
    const orgA = await prisma.organization.create({
      data: { name: 'Org Project Sec A v2', type: 'COMPANY' }
    });
    const wsA = await prisma.workspace.create({
      data: { name: 'WS A Proj Sec v2', organizationId: orgA.id }
    });
    workspaceAId = wsA.id;

    const orgB = await prisma.organization.create({
      data: { name: 'Org Project Sec B v2', type: 'COMPANY' }
    });
    const wsB = await prisma.workspace.create({
      data: { name: 'WS B Proj Sec v2', organizationId: orgB.id }
    });
    workspaceBId = wsB.id;

    // Create a project in Workspace-B (the target for cross-tenant read/write attacks)
    const wsBProject = await prisma.project.create({
      data: {
        name: 'Workspace B Probe Project v2',
        code: 'WSB-PROBE-SEC-2',
        workspaceId: wsB.id,
        organizationId: orgB.id,
      }
    });
    workspaceBProjectId = wsBProject.id;

    // Setup permissions
    const permCreate = await prisma.permission.upsert({
      where: { code: 'PROJECT_CREATE' },
      update: {},
      create: { code: 'PROJECT_CREATE', name: 'Project Create' }
    });
    const permView = await prisma.permission.upsert({
      where: { code: 'PROJECT_VIEW' },
      update: {},
      create: { code: 'PROJECT_VIEW', name: 'Project View' }
    });
    const permObservatory = await prisma.permission.upsert({
      where: { code: 'OBSERVATORY_VIEW' },
      update: {},
      create: { code: 'OBSERVATORY_VIEW', name: 'Observatory View' }
    });

    // Setup roles in Workspace-A
    const roleCreate = await prisma.role.create({
      data: {
        name: 'Project Creator Sec v2',
        code: 'ROLE_PROJ_CREATE_SEC_V2',
        workspace: { connect: { id: workspaceAId } },
        rolePermissions: { create: [{ permissionId: permCreate.id }, { permissionId: permView.id }] }
      }
    });
    const roleView = await prisma.role.create({
      data: {
        name: 'Project Viewer Sec v2',
        code: 'ROLE_PROJ_VIEW_SEC_V2',
        workspace: { connect: { id: workspaceAId } },
        rolePermissions: { create: [{ permissionId: permView.id }] }
      }
    });
    const roleDirector = await prisma.role.create({
      data: {
        name: 'Project Director Sec v2',
        code: 'ROLE_PROJ_DIRECTOR_SEC_V2',
        workspace: { connect: { id: workspaceAId } },
        rolePermissions: { create: [{ permissionId: permObservatory.id }, { permissionId: permView.id }] }
      }
    });

    // Create accounts, memberships, users for Workspace-A
    const passwordHash = await bcrypt.hash(PASSWORD, SALT_ROUNDS);

    async function createUserWithRole(email: string, roleId: string, wsId: string = workspaceAId) {
      const account = await prisma.account.create({
        data: { email, passwordHash, displayName: email, status: 'ACTIVE' }
      });
      const membership = await prisma.workspaceMembership.create({
        data: {
          account: { connect: { id: account.id } },
          workspace: { connect: { id: wsId } },
          status: 'ACTIVE',
          membershipRoles: { create: [{ roleId }] }
        }
      });
      await prisma.user.create({
        data: {
          workspaceMembershipId: membership.id,
          workspaceId: wsId,
          fullName: email,
          status: 'ACTIVE'
        }
      });
    }

    await createUserWithRole(userCreateEmail, roleCreate.id);
    await createUserWithRole(userViewEmail, roleView.id);
    await createUserWithRole(userDirectorEmail, roleDirector.id);
  });

  afterAll(async () => {
    const emailPatterns = [userCreateEmail, userViewEmail, userDirectorEmail];
    const accounts = await prisma.account.findMany({ where: { email: { in: emailPatterns } } });
    const accountIds = accounts.map(a => a.id);
    const memberships = await prisma.workspaceMembership.findMany({ where: { accountId: { in: accountIds } } });
    const membershipIds = memberships.map(m => m.id);

    await prisma.user.deleteMany({ where: { workspaceMembershipId: { in: membershipIds } } });
    await prisma.workspaceMembership.deleteMany({ where: { id: { in: membershipIds } } });
    await prisma.account.deleteMany({ where: { id: { in: accountIds } } });

    await prisma.role.deleteMany({ where: { code: { in: ['ROLE_PROJ_CREATE_SEC_V2', 'ROLE_PROJ_VIEW_SEC_V2', 'ROLE_PROJ_DIRECTOR_SEC_V2'] } } });

    // cleanup probe project
    await prisma.project.deleteMany({ where: { id: workspaceBProjectId } });

    await prisma.workspace.deleteMany({ where: { id: { in: [workspaceAId, workspaceBId] } } });
    await prisma.organization.deleteMany({ where: { name: { in: ['Org Project Sec A v2', 'Org Project Sec B v2'] } } });

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

  // ──────────────────────────────────────────────────────────────────────
  // Unauthenticated / baseline
  // ──────────────────────────────────────────────────────────────────────

  it('1. no token -> POST /projects returns 401', async () => {
    await request(app.getHttpServer())
      .post('/projects')
      .send({ name: 'Test', code: 'T1', workspaceId: workspaceAId })
      .expect(401);
  });

  it('2. no token -> GET /projects/workspace/:workspaceId returns 401', async () => {
    await request(app.getHttpServer())
      .get(`/projects/workspace/${workspaceAId}`)
      .expect(401);
  });

  it('2b. no token -> GET /projects returns 401', async () => {
    await request(app.getHttpServer())
      .get('/projects')
      .expect(401);
  });

  // ──────────────────────────────────────────────────────────────────────
  // POST /projects — tenant write hardening
  // ──────────────────────────────────────────────────────────────────────

  it('3. mismatched body workspaceId is rejected and cannot create in either workspace', async () => {
    const token = await login(userCreateEmail);

    await request(app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)        // context = Workspace-A
      .send({ name: 'Attack Project', code: 'ATTACK-B', workspaceId: workspaceBId })
      .expect(403);

    const created = await prisma.project.findMany({
      where: {
        workspaceId: { in: [workspaceAId, workspaceBId] },
        code: 'ATTACK-B',
      },
    });
    expect(created).toHaveLength(0);
  });

  it('4a. Workspace-A user can create project when body workspaceId matches context', async () => {
    const token = await login(userCreateEmail);

    const res = await request(app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({ name: 'Valid Project Match', code: 'VALID-MATCH', workspaceId: workspaceAId })
      .expect(201);

    expect(res.body.workspaceId).toBe(workspaceAId);

    // cleanup
    await prisma.project.delete({ where: { id: res.body.id } });
  });

  it('4b. Workspace-A user can create project when body workspaceId is omitted (context is used)', async () => {
    const token = await login(userCreateEmail);

    const res = await request(app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({ name: 'Valid Project No WsId', code: 'VALID-NOWS' })
      .expect(201);

    expect(res.body.workspaceId).toBe(workspaceAId);

    // cleanup
    await prisma.project.delete({ where: { id: res.body.id } });
  });

  it('4c. project creation without workspace context is rejected safely', async () => {
    const token = await login(userCreateEmail);

    await request(app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'No Context Project', code: 'NO-CONTEXT' })
      .expect(400);

    await expect(prisma.project.findFirst({ where: { code: 'NO-CONTEXT' } }))
      .resolves.toBeNull();
  });

  // ──────────────────────────────────────────────────────────────────────
  // GET /projects/workspace/:workspaceId — tenant read hardening
  // ──────────────────────────────────────────────────────────────────────

  it('5. Workspace-A user cannot query GET /projects/workspace/:workspaceBId', async () => {
    const token = await login(userViewEmail);

    await request(app.getHttpServer())
      .get(`/projects/workspace/${workspaceBId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)    // context = A, param = B
      .expect(403);
  });

  it('6. Workspace-A user can query GET /projects/workspace/:workspaceAId', async () => {
    const token = await login(userViewEmail);

    const res = await request(app.getHttpServer())
      .get(`/projects/workspace/${workspaceAId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)    // context = A, param = A
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    // All returned projects must belong to Workspace-A
    for (const p of res.body) {
      expect(p.workspaceId).toBe(workspaceAId);
    }
    const leakedIds = res.body.map((p: any) => p.id);
    expect(leakedIds).not.toContain(workspaceBProjectId);
  });

  // ──────────────────────────────────────────────────────────────────────
  // GET /projects — Observatory/portfolio list read hardening
  // ──────────────────────────────────────────────────────────────────────

  it('7. Non-observatory role (PROJECT_VIEW only) cannot GET /projects', async () => {
    const token = await login(userViewEmail);

    await request(app.getHttpServer())
      .get('/projects')
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .expect(403);
  });

  it('8. DIRECTOR role (OBSERVATORY_VIEW) can GET /projects and it is tenant-scoped', async () => {
    const token = await login(userDirectorEmail);

    const res = await request(app.getHttpServer())
      .get('/projects')
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    // All returned projects must belong to Workspace-A
    for (const p of res.body) {
      expect(p.workspaceId).toBe(workspaceAId);
    }
    // Must NOT contain Workspace-B probe project
    const leakedIds = res.body.map((p: any) => p.id);
    expect(leakedIds).not.toContain(workspaceBProjectId);
  });


});
