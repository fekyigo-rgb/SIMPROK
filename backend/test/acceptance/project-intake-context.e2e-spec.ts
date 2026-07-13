import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../src/app.module';

const PASSWORD = 'Test1234!';
const SALT_ROUNDS = 10;

describe('Project intake context security (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let workspaceAId: string;
  let workspaceBId: string;
  let projectAId: string;
  let lockedProjectId: string;
  let projectBId: string;

  const emails = {
    activeCreator: 'p7c.active.creator@test.local',
    viewOnly: 'p7c.view.only@test.local',
    noAssignment: 'p7c.no.assignment@test.local',
    inactive: 'p7c.inactive@test.local',
    crossTenant: 'p7c.cross@test.local',
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = new PrismaClient();
    const passwordHash = await bcrypt.hash(PASSWORD, SALT_ROUNDS);

    const [projectView, projectCreate] = await Promise.all([
      prisma.permission.findUniqueOrThrow({
        where: { code: 'PROJECT_VIEW' },
      }),
      prisma.permission.findUniqueOrThrow({
        where: { code: 'PROJECT_CREATE' },
      }),
    ]);

    const orgA = await prisma.organization.create({ data: { name: 'P7C Intake Org A', type: 'COMPANY' } });
    const orgB = await prisma.organization.create({ data: { name: 'P7C Intake Org B', type: 'COMPANY' } });
    const workspaceA = await prisma.workspace.create({ data: { name: 'P7C Intake WS A', organizationId: orgA.id } });
    const workspaceB = await prisma.workspace.create({ data: { name: 'P7C Intake WS B', organizationId: orgB.id } });
    workspaceAId = workspaceA.id;
    workspaceBId = workspaceB.id;

    const roleCreateA = await prisma.role.create({
      data: {
        name: 'P7C Intake Creator A',
        code: 'P7C_INTAKE_CREATE_A',
        workspaceId: workspaceAId,
        rolePermissions: { create: [{ permissionId: projectView.id }, { permissionId: projectCreate.id }] },
      },
    });
    const roleViewA = await prisma.role.create({
      data: {
        name: 'P7C Intake Viewer A',
        code: 'P7C_INTAKE_VIEW_A',
        workspaceId: workspaceAId,
        rolePermissions: { create: [{ permissionId: projectView.id }] },
      },
    });
    const roleCreateB = await prisma.role.create({
      data: {
        name: 'P7C Intake Creator B',
        code: 'P7C_INTAKE_CREATE_B',
        workspaceId: workspaceBId,
        rolePermissions: { create: [{ permissionId: projectView.id }, { permissionId: projectCreate.id }] },
      },
    });

    const [projectA, lockedProject, projectB] = await Promise.all([
      prisma.project.create({
        data: { name: 'P7C Intake Project A', code: 'P7C-INTAKE-A', workspaceId: workspaceAId, organizationId: orgA.id },
      }),
      prisma.project.create({
        data: { name: 'P7C Intake Locked Project', code: 'P7C-INTAKE-LOCKED', workspaceId: workspaceAId, organizationId: orgA.id },
      }),
      prisma.project.create({
        data: { name: 'P7C Intake Project B', code: 'P7C-INTAKE-B', workspaceId: workspaceBId, organizationId: orgB.id },
      }),
    ]);
    projectAId = projectA.id;
    lockedProjectId = lockedProject.id;
    projectBId = projectB.id;

    async function createAccount(email: string, workspaceId: string, roleId: string, status: 'ACTIVE' | 'INACTIVE', projectId?: string) {
      const account = await prisma.account.create({
        data: { email, passwordHash, displayName: email, status: 'ACTIVE' },
      });
      const membership = await prisma.workspaceMembership.create({
        data: {
          accountId: account.id,
          workspaceId,
          status,
          membershipRoles: { create: [{ roleId }] },
        },
      });
      await prisma.user.create({
        data: { workspaceMembershipId: membership.id, workspaceId, fullName: email, status: 'ACTIVE' },
      });
      if (projectId) {
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
      return membership.id;
    }

    const activeMembershipId = await createAccount(emails.activeCreator, workspaceAId, roleCreateA.id, 'ACTIVE', projectAId);
    await prisma.projectAssignment.create({
      data: {
        workspaceMembershipId: activeMembershipId,
        projectId: lockedProjectId,
        roleInProject: 'MEMBER',
        isPrimaryAssignment: false,
        status: 'ASSIGNED',
      },
    });
    await createAccount(emails.viewOnly, workspaceAId, roleViewA.id, 'ACTIVE', projectAId);
    await createAccount(emails.noAssignment, workspaceAId, roleCreateA.id, 'ACTIVE');
    await createAccount(emails.inactive, workspaceAId, roleCreateA.id, 'INACTIVE', projectAId);
    await createAccount(emails.crossTenant, workspaceBId, roleCreateB.id, 'ACTIVE', projectBId);

    const structure = await prisma.boqStructure.create({
      data: { projectId: lockedProjectId, name: 'Locked BOQ', version: 1, status: 'APPROVED' },
    });
    const rab = await prisma.rabDocument.create({
      data: {
        projectId: lockedProjectId,
        boqStructureId: structure.id,
        name: 'Locked RAB',
        version: 1,
        totalBaseCost: 1,
        totalFinalCost: 1,
        status: 'APPROVED',
      },
    });
    await prisma.projectBaseline.create({
      data: {
        projectId: lockedProjectId,
        rabDocumentId: rab.id,
        versionNumber: 1,
        status: 'ACTIVE',
        approvedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    const accounts = await prisma.account.findMany({ where: { email: { in: Object.values(emails) } } });
    const accountIds = accounts.map((account) => account.id);
    const memberships = await prisma.workspaceMembership.findMany({ where: { accountId: { in: accountIds } } });
    const membershipIds = memberships.map((membership) => membership.id);
    const projectIds = [projectAId, lockedProjectId, projectBId].filter(Boolean);

    await prisma.projectBaseline.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.rabDocument.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.boqItem.deleteMany({ where: { boqStructure: { projectId: { in: projectIds } } } });
    await prisma.boqStructure.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.projectAssignment.deleteMany({ where: { OR: [{ workspaceMembershipId: { in: membershipIds } }, { projectId: { in: projectIds } }] } });
    await prisma.user.deleteMany({ where: { workspaceMembershipId: { in: membershipIds } } });
    await prisma.workspaceMembership.deleteMany({ where: { id: { in: membershipIds } } });
    await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.role.deleteMany({ where: { code: { in: ['P7C_INTAKE_CREATE_A', 'P7C_INTAKE_VIEW_A', 'P7C_INTAKE_CREATE_B'] } } });
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    await prisma.workspace.deleteMany({ where: { id: { in: [workspaceAId, workspaceBId].filter(Boolean) } } });
    await prisma.organization.deleteMany({ where: { name: { in: ['P7C Intake Org A', 'P7C Intake Org B'] } } });
    await app.close();
    await prisma.$disconnect();
  });

  const login = async (email: string) => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(201);
    return response.body.access_token;
  };

  it('allows assigned PROJECT_CREATE user to update intake context before official baseline', async () => {
    const token = await login(emails.activeCreator);

    const response = await request(app.getHttpServer())
      .patch(`/projects/${projectAId}/intake-context`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({ budgetBaseline: '250000000.00', mainMaterialSpec: ' Beton K-300 ' })
      .expect(200);

    expect(response.body.budgetBaseline).toBe('250000000');
    expect(response.body.mainMaterialSpec).toBe('Beton K-300');
  });

  it('rejects assigned PROJECT_VIEW user without PROJECT_CREATE on PATCH', async () => {
    const token = await login(emails.viewOnly);

    await request(app.getHttpServer())
      .patch(`/projects/${projectAId}/intake-context`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({ budgetBaseline: '1' })
      .expect(403);
  });

  it('rejects user without project assignment', async () => {
    const token = await login(emails.noAssignment);

    await request(app.getHttpServer())
      .patch(`/projects/${projectAId}/intake-context`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({ budgetBaseline: '1' })
      .expect(403);
  });

  it('rejects inactive membership', async () => {
    const token = await login(emails.inactive);

    await request(app.getHttpServer())
      .patch(`/projects/${projectAId}/intake-context`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({ budgetBaseline: '1' })
      .expect(404);
  });

  it('rejects workspace other than project tenant without leakage', async () => {
    const token = await login(emails.crossTenant);

    await request(app.getHttpServer())
      .patch(`/projects/${projectAId}/intake-context`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceBId)
      .send({ budgetBaseline: '1' })
      .expect(404);
  });

  it('returns 404 for unknown projectId', async () => {
    const token = await login(emails.activeCreator);

    await request(app.getHttpServer())
      .patch('/projects/10000000-0000-4000-8000-000000009999/intake-context')
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({ budgetBaseline: '1' })
      .expect(404);
  });

  it('ignores workspaceId and organizationId in body', async () => {
    const token = await login(emails.activeCreator);

    await request(app.getHttpServer())
      .patch(`/projects/${projectAId}/intake-context`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({ budgetBaseline: '2', workspaceId: workspaceBId, organizationId: 'attack' })
      .expect(200);

    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectAId } });
    expect(project.workspaceId).toBe(workspaceAId);
    expect(project.budgetBaseline?.toString()).toBe('2');
  });

  it('serves GET intake-mode with PROJECT_VIEW', async () => {
    const token = await login(emails.viewOnly);

    const response = await request(app.getHttpServer())
      .get(`/projects/${projectAId}/intake-mode`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .expect(200);

    expect(response.body).toMatchObject({
      boq: { status: 'EMPTY' },
      pagu: { status: 'AVAILABLE' },
      mode: 'E',
    });
  });

  it('blocks PATCH when official active baseline exists', async () => {
    const token = await login(emails.activeCreator);

    await request(app.getHttpServer())
      .patch(`/projects/${lockedProjectId}/intake-context`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({ budgetBaseline: '3' })
      .expect(409);
  });
});
