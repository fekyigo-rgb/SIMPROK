import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import * as bcrypt from 'bcrypt';

const PASSWORD = 'Test1234!';
const SALT_ROUNDS = 10;

describe('Progress Security (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;

  let workspaceAId: string;
  let workspaceBId: string;
  
  let projectAId: string;
  let projectBId: string;
  let boqItemAId: string;

  let userViewEmail = 'prog.view.sec@test.local';
  let userSubmitEmail = 'prog.submit.sec@test.local';
  let userCrossEmail = 'prog.cross.sec@test.local';
  let userNoAccessEmail = 'prog.noaccess.sec@test.local';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = new PrismaClient();

    // Setup two orgs and workspaces
    const orgA = await prisma.organization.create({
      data: { name: 'Org Prog Sec A', type: 'COMPANY' }
    });
    const wsA = await prisma.workspace.create({
      data: { name: 'WS A Prog Sec', organizationId: orgA.id }
    });
    workspaceAId = wsA.id;

    const orgB = await prisma.organization.create({
      data: { name: 'Org Prog Sec B', type: 'COMPANY' }
    });
    const wsB = await prisma.workspace.create({
      data: { name: 'WS B Prog Sec', organizationId: orgB.id }
    });
    workspaceBId = wsB.id;

    // Create projects
    const projA = await prisma.project.create({
      data: {
        name: 'Project A Prog Sec',
        code: 'PROGA-SEC',
        workspaceId: wsA.id,
        organizationId: orgA.id,
        status: 'ACTIVE',
      }
    });
    projectAId = projA.id;

    const projB = await prisma.project.create({
      data: {
        name: 'Project B Prog Sec',
        code: 'PROGB-SEC',
        workspaceId: wsB.id,
        organizationId: orgB.id,
        status: 'ACTIVE',
      }
    });
    projectBId = projB.id;

    // Setup Baseline and BOQ for Project A so progress submission succeeds
    const boqStruct = await prisma.boqStructure.create({
      data: { projectId: projectAId, name: 'Main BOQ', version: 1 }
    });
    const boqItem = await prisma.boqItem.create({
      data: { boqStructureId: boqStruct.id, wbsCode: '1.1', name: 'Item', quantity: 10, unit: 'm3' }
    });
    boqItemAId = boqItem.id;
    const rab = await prisma.rabDocument.create({
      data: { projectId: projectAId, boqStructureId: boqStruct.id, name: 'RAB', version: 1, totalBaseCost: 1000, totalFinalCost: 1000, status: 'APPROVED' }
    });
    await prisma.projectBaseline.create({
      data: { projectId: projectAId, rabDocumentId: rab.id, versionNumber: 1, status: 'ACTIVE', approvedAt: new Date() }
    });

    // Setup permissions
    const permView = await prisma.permission.upsert({
      where: { code: 'PROJECT_VIEW' },
      update: {},
      create: { code: 'PROJECT_VIEW', name: 'Project View' }
    });
    const permSubmit = await prisma.permission.upsert({
      where: { code: 'FIELD_PROGRESS_SUBMIT' },
      update: {},
      create: { code: 'FIELD_PROGRESS_SUBMIT', name: 'Submit Progress' }
    });

    // Setup roles in Workspaces
    const roleViewA = await prisma.role.create({
      data: {
        name: 'Viewer A', code: 'ROLE_PROG_VIEW_A', workspaceId: workspaceAId,
        rolePermissions: { create: [{ permissionId: permView.id }] }
      }
    });
    const roleSubmitA = await prisma.role.create({
      data: {
        name: 'Submitter A', code: 'ROLE_PROG_SUBMIT_A', workspaceId: workspaceAId,
        rolePermissions: { create: [{ permissionId: permView.id }, { permissionId: permSubmit.id }] }
      }
    });
    const roleSubmitB = await prisma.role.create({
      data: {
        name: 'Submitter B', code: 'ROLE_PROG_SUBMIT_B', workspaceId: workspaceBId,
        rolePermissions: { create: [{ permissionId: permView.id }, { permissionId: permSubmit.id }] }
      }
    });

    // Setup accounts
    const passwordHash = await bcrypt.hash(PASSWORD, SALT_ROUNDS);

    async function createUser(email: string, wsId: string, roleId: string, assignProjectId?: string) {
      const account = await prisma.account.create({
        data: { email, passwordHash, displayName: email, status: 'ACTIVE' }
      });
      const membership = await prisma.workspaceMembership.create({
        data: {
          accountId: account.id, workspaceId: wsId, status: 'ACTIVE',
          membershipRoles: { create: [{ roleId }] }
        }
      });
      await prisma.user.create({
        data: { workspaceMembershipId: membership.id, workspaceId: wsId, fullName: email, status: 'ACTIVE' }
      });
      if (assignProjectId) {
        await prisma.projectAssignment.create({
          data: {
            workspaceMembershipId: membership.id,
            projectId: assignProjectId,
            roleInProject: 'MEMBER',
            isPrimaryAssignment: true,
            status: 'ASSIGNED'
          }
        });
      }
      return account;
    }

    await createUser(userViewEmail, workspaceAId, roleViewA.id, projectAId);
    await createUser(userSubmitEmail, workspaceAId, roleSubmitA.id, projectAId);
    await createUser(userCrossEmail, workspaceBId, roleSubmitB.id, projectBId);
    await createUser(userNoAccessEmail, workspaceAId, roleViewA.id); // No project assignment
  });

  afterAll(async () => {
    // Cleanup
    const emails = [userViewEmail, userSubmitEmail, userCrossEmail, userNoAccessEmail];
    const accounts = await prisma.account.findMany({ where: { email: { in: emails } } });
    const accountIds = accounts.map(a => a.id);
    const memberships = await prisma.workspaceMembership.findMany({ where: { accountId: { in: accountIds } } });
    const membershipIds = memberships.map(m => m.id);

    await prisma.progressEntry.deleteMany({ where: { progressReport: { projectId: { in: [projectAId, projectBId] } } } });
    await prisma.progressReport.deleteMany({ where: { projectId: { in: [projectAId, projectBId] } } });
    
    await prisma.projectAssignment.deleteMany({ where: { workspaceMembershipId: { in: membershipIds } } });
    await prisma.user.deleteMany({ where: { workspaceMembershipId: { in: membershipIds } } });
    await prisma.workspaceMembership.deleteMany({ where: { id: { in: membershipIds } } });
    await prisma.account.deleteMany({ where: { id: { in: accountIds } } });

    await prisma.role.deleteMany({ where: { code: { in: ['ROLE_PROG_VIEW_A', 'ROLE_PROG_SUBMIT_A', 'ROLE_PROG_SUBMIT_B'] } } });

    await prisma.projectBaseline.deleteMany({ where: { projectId: { in: [projectAId, projectBId] } } });
    await prisma.rabDocument.deleteMany({ where: { projectId: { in: [projectAId, projectBId] } } });
    await prisma.boqItem.deleteMany({ where: { boqStructure: { projectId: { in: [projectAId, projectBId] } } } });
    await prisma.boqStructure.deleteMany({ where: { projectId: { in: [projectAId, projectBId] } } });
    await prisma.project.deleteMany({ where: { id: { in: [projectAId, projectBId] } } });
    await prisma.workspace.deleteMany({ where: { id: { in: [workspaceAId, workspaceBId] } } });
    await prisma.organization.deleteMany({ where: { name: { in: ['Org Prog Sec A', 'Org Prog Sec B'] } } });

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

  it('1. no token -> POST /projects/:id/progress/field returns 401', async () => {
    await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/field`)
      .send({ projectId: projectAId, entries: [] })
      .expect(401);
  });

  it('2. authenticated user without project access -> rejected', async () => {
    const token = await login(userNoAccessEmail);
    await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/field`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({ projectId: projectAId, entries: [] })
      .expect(403);
  });

  it('3. project-assigned user with PROJECT_VIEW only -> POST progress rejected 403', async () => {
    const token = await login(userViewEmail);
    await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/field`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({ projectId: projectAId, entries: [] })
      .expect(403);
  });

  it('4. project-assigned user with FIELD_PROGRESS_SUBMIT -> accepted', async () => {
    const token = await login(userSubmitEmail);
    const beforeReports = await prisma.progressReport.count({ where: { projectId: projectAId } });
    
    await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/field`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({
        projectId: projectAId,
        entries: [{
          boqItemId: boqItemAId,
          installedQuantity: 2,
          workDate: new Date().toISOString()
        }]
      })
      .expect(201);

    const afterReports = await prisma.progressReport.count({ where: { projectId: projectAId } });
    expect(afterReports).toBe(beforeReports + 1);
  });

  it('5. cross-tenant user cannot submit progress to another workspace project', async () => {
    const token = await login(userCrossEmail);
    const beforeReports = await prisma.progressReport.count({ where: { projectId: projectAId } });

    // Try to submit to Project A using Workspace B user
    await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/field`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({
        projectId: projectAId,
        entries: [{
          boqItemId: boqItemAId,
          installedQuantity: 2,
          workDate: new Date().toISOString()
        }]
      })
      .expect(404); // ProjectAccessGuard usually returns 404 for cross-tenant

    const afterReports = await prisma.progressReport.count({ where: { projectId: projectAId } });
    expect(afterReports).toBe(beforeReports);
  });
});
