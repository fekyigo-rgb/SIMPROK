import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import * as bcrypt from 'bcrypt';

const PASSWORD = 'Test1234!';
const SALT_ROUNDS = 10;

/**
 * Focused E2E proof for the PermissionsGuard project-workspace authority fix.
 *
 * Uses only the existing, read-only GET /projects/:projectId/reality route
 * (ProjectAccessGuard + PermissionsGuard, PROJECT_VIEW) — no new endpoint is created.
 */
describe('Project permission workspace authority (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;

  let workspaceAId: string;
  let workspaceBId: string;
  let projectAId: string;

  const emails = {
    legitA: 'ppwa.legit.a@test.local',
    dual: 'ppwa.dual@test.local',
    crossB: 'ppwa.cross.b@test.local',
    unassignedA: 'ppwa.unassigned.a@test.local',
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = new PrismaClient();
    const passwordHash = await bcrypt.hash(PASSWORD, SALT_ROUNDS);

    const projectView = await prisma.permission.findUniqueOrThrow({
      where: { code: 'PROJECT_VIEW' },
    });

    const orgA = await prisma.organization.create({ data: { name: 'PPWA Org A', type: 'COMPANY' } });
    const orgB = await prisma.organization.create({ data: { name: 'PPWA Org B', type: 'COMPANY' } });
    const wsA = await prisma.workspace.create({ data: { name: 'PPWA WS A', organizationId: orgA.id } });
    const wsB = await prisma.workspace.create({ data: { name: 'PPWA WS B', organizationId: orgB.id } });
    workspaceAId = wsA.id;
    workspaceBId = wsB.id;

    const projectA = await prisma.project.create({
      data: {
        name: 'PPWA Project A',
        code: 'PPWA-A',
        workspaceId: workspaceAId,
        organizationId: orgA.id,
        status: 'ACTIVE',
      },
    });
    projectAId = projectA.id;

    // roleViewA: PROJECT_VIEW inside Workspace A.
    const roleViewA = await prisma.role.create({
      data: {
        name: 'PPWA Viewer A',
        code: 'PPWA_VIEW_A',
        workspaceId: workspaceAId,
        rolePermissions: { create: [{ permissionId: projectView.id }] },
      },
    });
    // roleNoPermA: a real, ACTIVE Workspace A membership with zero permissions —
    // used to prove Workspace B's permission cannot be borrowed for a Workspace A project.
    const roleNoPermA = await prisma.role.create({
      data: {
        name: 'PPWA No-Permission A',
        code: 'PPWA_NOPERM_A',
        workspaceId: workspaceAId,
      },
    });
    // roleViewB: PROJECT_VIEW inside Workspace B.
    const roleViewB = await prisma.role.create({
      data: {
        name: 'PPWA Viewer B',
        code: 'PPWA_VIEW_B',
        workspaceId: workspaceBId,
        rolePermissions: { create: [{ permissionId: projectView.id }] },
      },
    });

    async function createAccount(email: string): Promise<string> {
      const account = await prisma.account.create({
        data: { email, passwordHash, displayName: email, status: 'ACTIVE' },
      });
      return account.id;
    }

    async function addMembership(
      accountId: string,
      workspaceId: string,
      roleId: string,
      assignProjectId?: string,
    ): Promise<string> {
      const membership = await prisma.workspaceMembership.create({
        data: {
          accountId,
          workspaceId,
          status: 'ACTIVE',
          membershipRoles: { create: [{ roleId }] },
        },
      });
      await prisma.user.create({
        data: { workspaceMembershipId: membership.id, workspaceId, fullName: accountId, status: 'ACTIVE' },
      });
      if (assignProjectId) {
        await prisma.projectAssignment.create({
          data: {
            workspaceMembershipId: membership.id,
            projectId: assignProjectId,
            roleInProject: 'MEMBER',
            isPrimaryAssignment: true,
            status: 'ASSIGNED',
          },
        });
      }
      return membership.id;
    }

    // legitA: genuine Workspace A member with PROJECT_VIEW, assigned to Project A.
    const legitAId = await createAccount(emails.legitA);
    await addMembership(legitAId, workspaceAId, roleViewA.id, projectAId);

    // dual: assigned to Project A via a Workspace A membership that has NO permissions,
    // but also holds a genuine PROJECT_VIEW membership in Workspace B. Proves Workspace B's
    // permission must not leak into a Workspace A project operation.
    const dualId = await createAccount(emails.dual);
    await addMembership(dualId, workspaceAId, roleNoPermA.id, projectAId);
    await addMembership(dualId, workspaceBId, roleViewB.id);

    // crossB: Workspace B member only, no membership in Workspace A at all.
    const crossBId = await createAccount(emails.crossB);
    await addMembership(crossBId, workspaceBId, roleViewB.id);

    // unassignedA: Workspace A member with PROJECT_VIEW, but never assigned to Project A.
    const unassignedAId = await createAccount(emails.unassignedA);
    await addMembership(unassignedAId, workspaceAId, roleViewA.id);
  });

  afterAll(async () => {
    const accounts = await prisma.account.findMany({ where: { email: { in: Object.values(emails) } } });
    const accountIds = accounts.map((account) => account.id);
    const memberships = await prisma.workspaceMembership.findMany({ where: { accountId: { in: accountIds } } });
    const membershipIds = memberships.map((membership) => membership.id);

    await prisma.projectAssignment.deleteMany({
      where: { OR: [{ workspaceMembershipId: { in: membershipIds } }, { projectId: projectAId }] },
    });
    await prisma.user.deleteMany({ where: { workspaceMembershipId: { in: membershipIds } } });
    await prisma.workspaceMembership.deleteMany({ where: { id: { in: membershipIds } } });
    await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.role.deleteMany({
      where: { code: { in: ['PPWA_VIEW_A', 'PPWA_NOPERM_A', 'PPWA_VIEW_B'] } },
    });
    await prisma.project.deleteMany({ where: { id: projectAId } });
    await prisma.workspace.deleteMany({ where: { id: { in: [workspaceAId, workspaceBId] } } });
    await prisma.organization.deleteMany({ where: { name: { in: ['PPWA Org A', 'PPWA Org B'] } } });

    await app.close();
    await prisma.$disconnect();
  });

  const login = async (email: string): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(201);
    return response.body.access_token;
  };

  it('1. project route without x-workspace-id uses the DB-verified project workspace', async () => {
    const token = await login(emails.legitA);

    await request(app.getHttpServer())
      .get(`/projects/${projectAId}/reality`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('2. matching explicit x-workspace-id header follows normal behavior', async () => {
    const token = await login(emails.legitA);

    await request(app.getHttpServer())
      .get(`/projects/${projectAId}/reality`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .expect(200);
  });

  it('3. mismatched explicit x-workspace-id header returns 403', async () => {
    const token = await login(emails.dual);

    await request(app.getHttpServer())
      .get(`/projects/${projectAId}/reality`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceBId)
      .expect(403);
  });

  it('4. permission held only in Workspace B cannot authorize a Workspace A project operation', async () => {
    const token = await login(emails.dual);

    // Attempting to borrow Workspace B's PROJECT_VIEW for Project A (Workspace A) is rejected...
    await request(app.getHttpServer())
      .get(`/projects/${projectAId}/reality`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceBId)
      .expect(403);

    // ...and omitting the header does not fall back to Workspace B either — the account's
    // real Workspace A role has no PROJECT_VIEW, so the DB-verified project workspace
    // correctly denies access.
    await request(app.getHttpServer())
      .get(`/projects/${projectAId}/reality`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('5. permission genuinely granted in Workspace A still works', async () => {
    const token = await login(emails.legitA);

    const response = await request(app.getHttpServer())
      .get(`/projects/${projectAId}/reality`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .expect(200);

    // No progress report exists for this fresh fixture project — the service's documented
    // "not yet available" shape still proves the guard let the request through to the handler.
    expect(response.body).toMatchObject({ available: false, status: 'UNAVAILABLE' });
  });

  it('6. an account invisible to the project workspace still gets 404 (no existence leak)', async () => {
    const token = await login(emails.crossB);

    await request(app.getHttpServer())
      .get(`/projects/${projectAId}/reality`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('7. a Workspace A member without a project assignment still gets 403', async () => {
    const token = await login(emails.unassignedA);

    await request(app.getHttpServer())
      .get(`/projects/${projectAId}/reality`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .expect(403);
  });

  it('8. no cross-workspace data leak accompanies the 403 from a mismatched/borrowed workspace', async () => {
    const token = await login(emails.dual);

    const response = await request(app.getHttpServer())
      .get(`/projects/${projectAId}/reality`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceBId)
      .expect(403);

    expect(response.body).not.toHaveProperty('available');
    expect(response.body).not.toHaveProperty('data');
  });

  it('9. a matching header cannot mask a conflicting query workspace -> 403 with no data leak', async () => {
    const token = await login(emails.legitA);

    const response = await request(app.getHttpServer())
      .get(`/projects/${projectAId}/reality`)
      .query({ workspaceId: workspaceBId })
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .expect(403);

    expect(response.body).not.toHaveProperty('available');
    expect(response.body).not.toHaveProperty('data');
  });
});
