import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import * as bcrypt from 'bcrypt';

const PASSWORD = 'Test1234!';
const SALT_ROUNDS = 10;

describe('Authority Security (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;

  let workspaceAId: string;
  let workspaceBId: string;
  let positionAId: string;
  let approvalMatrixAId: string;

  let userNoneEmail = 'none.authority@test.local';
  let userViewEmail = 'view.authority@test.local';
  let userManageEmail = 'manage.authority@test.local';
  let directorEmail = 'director.authority@test.local';
  let authorityId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = new PrismaClient();

    // Setup Orgs and Workspaces
    const org = await prisma.organization.create({
      data: { name: 'Org Authority Test', type: 'COMPANY' }
    });
    const workspaceA = await prisma.workspace.create({
      data: { name: 'Workspace A Auth', organizationId: org.id }
    });
    workspaceAId = workspaceA.id;
    const workspaceB = await prisma.workspace.create({
      data: { name: 'Workspace B Auth', organizationId: org.id }
    });
    workspaceBId = workspaceB.id;
    workspaceAId = workspaceA.id;
    workspaceBId = workspaceB.id;

    // Create Initial Data in Workspace A
    const position = await prisma.position.create({
      data: { name: 'Test Pos A', code: 'TPA', workspace: { connect: { id: workspaceA.id } } }
    });
    positionAId = position.id;

    const authority = await prisma.authority.create({
      data: { name: 'Test Auth A', code: 'TAA_UNIQUE_2' }
    });
    authorityId = authority.id;

    const approvalMatrix = await prisma.approvalMatrix.create({
      data: { 
        objectType: 'RAB', 
        priority: 1, 
        workspace: { connect: { id: workspaceA.id } }, 
        requiredPosition: { connect: { id: position.id } },
        authority: { connect: { id: authority.id } }
      }
    });
    approvalMatrixAId = approvalMatrix.id;

    // Setup Permissions
    const permView = await prisma.permission.upsert({
      where: { code: 'AUTHORITY_VIEW' },
      update: {},
      create: { code: 'AUTHORITY_VIEW', name: 'Auth View' }
    });
    const permManage = await prisma.permission.upsert({
      where: { code: 'AUTHORITY_MANAGE' },
      update: {},
      create: { code: 'AUTHORITY_MANAGE', name: 'Auth Manage' }
    });
    const permAppMatrixManage = await prisma.permission.upsert({
      where: { code: 'APPROVAL_MATRIX_MANAGE' },
      update: {},
      create: { code: 'APPROVAL_MATRIX_MANAGE', name: 'App Manage' }
    });
    const permAppMatrixView = await prisma.permission.upsert({
      where: { code: 'APPROVAL_MATRIX_VIEW' },
      update: {},
      create: { code: 'APPROVAL_MATRIX_VIEW', name: 'App View' }
    });
    const permAssign = await prisma.permission.upsert({
      where: { code: 'AUTHORITY_ASSIGN' },
      update: {},
      create: { code: 'AUTHORITY_ASSIGN', name: 'Auth Assign' }
    });

    // Setup Roles in Workspace A
    const roleNone = await prisma.role.create({
      data: { name: 'Role None', code: 'ROLE_NONE', workspace: { connect: { id: workspaceAId } } }
    });
    const roleView = await prisma.role.create({
      data: { 
        name: 'Role View', 
        code: 'ROLE_VIEW',
        workspace: { connect: { id: workspaceA.id } },
        rolePermissions: { create: [{ permissionId: permView.id }, { permissionId: permAppMatrixView.id }] }
      }
    });
    const roleManage = await prisma.role.create({
      data: { 
        name: 'Role Manage', 
        code: 'ROLE_MANAGE',
        workspace: { connect: { id: workspaceA.id } },
        rolePermissions: { create: [{ permissionId: permView.id }, { permissionId: permManage.id }, { permissionId: permAppMatrixManage.id }, { permissionId: permAppMatrixView.id }, { permissionId: permAssign.id }] }
      }
    });
    const roleDirector = await prisma.role.create({
      data: { 
        name: 'Role Director', 
        code: 'ROLE_DIRECTOR',
        workspace: { connect: { id: workspaceA.id } },
        rolePermissions: { create: [{ permissionId: permView.id }, { permissionId: permAppMatrixView.id }] }
      }
    });

    // Setup Users & Memberships
    const passwordHash = await bcrypt.hash(PASSWORD, SALT_ROUNDS);
    
    async function createUserWithRole(email: string, roleId: string) {
      const account = await prisma.account.create({
        data: { email, passwordHash, displayName: email, status: 'ACTIVE' }
      });
      const membership = await prisma.workspaceMembership.create({
        data: {
          account: { connect: { id: account.id } },
          workspace: { connect: { id: workspaceA.id } },
          status: 'ACTIVE',
          membershipRoles: { create: [{ roleId: roleId }] }
        }
      });
      const user = await prisma.user.create({
        data: { 
          workspaceMembershipId: membership.id,
          workspaceId: workspaceA.id,
          fullName: email, 
          status: 'ACTIVE' 
        }
      });
      return user;
    }

    await createUserWithRole(userNoneEmail, roleNone.id);
    await createUserWithRole(userViewEmail, roleView.id);
    await createUserWithRole(userManageEmail, roleManage.id);
    await createUserWithRole(directorEmail, roleDirector.id);
  });

  afterAll(async () => {
    // cleanup
    const accounts = await prisma.account.findMany({ where: { email: { contains: 'authority@test.local' } } });
    const accountIds = accounts.map(a => a.id);
    const memberships = await prisma.workspaceMembership.findMany({ where: { accountId: { in: accountIds } } });
    const membershipIds = memberships.map(m => m.id);

    await prisma.positionAuthority.deleteMany({ where: { authority: { code: 'TAA_UNIQUE_2' } } });
    await prisma.positionAssignment.deleteMany({ where: { position: { workspaceId: { in: [workspaceAId, workspaceBId] } } } });
    await prisma.user.deleteMany({ where: { workspaceMembershipId: { in: membershipIds } } });
    // removed workspaceMembershipRole deletion as it's an implicit table managed by prisma
    await prisma.workspaceMembership.deleteMany({ where: { id: { in: membershipIds } } });
    await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
    
    await prisma.approvalMatrix.deleteMany({ where: { workspaceId: { in: [workspaceAId, workspaceBId] } } });
    await prisma.authority.deleteMany({ where: { code: 'TAA_UNIQUE_2' } });
    await prisma.position.deleteMany({ where: { workspaceId: { in: [workspaceAId, workspaceBId] } } });
    await prisma.role.deleteMany({ where: { workspaceId: { in: [workspaceAId, workspaceBId] } } });
    await prisma.workspace.deleteMany({ where: { id: { in: [workspaceAId, workspaceBId] } } });
    await prisma.$disconnect();
    await app.close();
  });

  async function login(email: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(201);
    return response.body.access_token;
  }

  // Unauthenticated Tests
  it('no token -> POST /authority/positions returns 401', async () => {
    await request(app.getHttpServer()).post('/authority/positions').send({}).expect(401);
  });
  
  it('no token -> GET /authority/positions returns 401', async () => {
    await request(app.getHttpServer()).get('/authority/positions').expect(401);
  });

  it('no token -> POST /authority/approval-matrices returns 401', async () => {
    await request(app.getHttpServer()).post('/authority/approval-matrices').send({}).expect(401);
  });

  // Permission Separation Tests
  it('valid token without AUTHORITY_VIEW -> GET /authority/positions rejected 403', async () => {
    const token = await login(userNoneEmail);
    await request(app.getHttpServer()).get('/authority/positions').set('Authorization', `Bearer ${token}`).set('x-workspace-id', workspaceAId).expect(403);
  });

  it('valid token with AUTHORITY_VIEW -> GET /authority/positions allowed where appropriate', async () => {
    const token = await login(userViewEmail);
    await request(app.getHttpServer()).get('/authority/positions').set('Authorization', `Bearer ${token}`).set('x-workspace-id', workspaceAId).expect(200);
  });

  it('valid token with AUTHORITY_VIEW only -> POST /authority/positions rejected 403', async () => {
    const token = await login(userViewEmail);
    await request(app.getHttpServer()).post('/authority/positions').send({ name: 'T', code: 'T' }).set('Authorization', `Bearer ${token}`).set('x-workspace-id', workspaceAId).expect(403);
  });

  it('DIRECTOR -> GET /authority/positions allowed where appropriate', async () => {
    const token = await login(directorEmail);
    await request(app.getHttpServer()).get('/authority/positions').set('Authorization', `Bearer ${token}`).set('x-workspace-id', workspaceAId).expect(200);
  });

  it('DIRECTOR -> POST /authority/positions rejected 403', async () => {
    const token = await login(directorEmail);
    await request(app.getHttpServer()).post('/authority/positions').send({ name: 'T', code: 'T' }).set('Authorization', `Bearer ${token}`).set('x-workspace-id', workspaceAId).expect(403);
  });

  it('valid token without APPROVAL_MATRIX_MANAGE -> POST /authority/approval-matrices rejected 403', async () => {
    const token = await login(userNoneEmail);
    await request(app.getHttpServer()).post('/authority/approval-matrices').send({}).set('Authorization', `Bearer ${token}`).set('x-workspace-id', workspaceAId).expect(403);
  });

  it('valid token with APPROVAL_MATRIX_VIEW only -> POST /authority/approval-matrices rejected 403', async () => {
    const token = await login(userViewEmail);
    await request(app.getHttpServer()).post('/authority/approval-matrices').send({}).set('Authorization', `Bearer ${token}`).set('x-workspace-id', workspaceAId).expect(403);
  });

  // Tenant isolation Tests
  it('Workspace-A context cannot read Workspace-B positions', async () => {
    const token = await login(userManageEmail); // has perm in A
    // Trying to read B using B's context - wait, user is not in B, so 403 context forbidden
    await request(app.getHttpServer()).get('/authority/positions').set('Authorization', `Bearer ${token}`).set('x-workspace-id', workspaceBId).expect(403);
  });

  it('Workspace-A context cannot read Workspace-B approval matrices', async () => {
    const token = await login(userManageEmail);
    await request(app.getHttpServer()).get('/authority/approval-matrices').set('Authorization', `Bearer ${token}`).set('x-workspace-id', workspaceBId).expect(403);
  });

  it('Workspace-A context cannot create position into Workspace-B by body workspaceId override', async () => {
    const token = await login(userManageEmail);
    const res = await request(app.getHttpServer())
      .post('/authority/positions')
      .send({ name: 'Bad Pos', code: 'BAD', workspaceId: workspaceBId }) // attempting override
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId) // valid context
      .expect(201); // it creates but in workspace A!

    // Verify it was created in A
    const pos = await prisma.position.findUnique({ where: { id: res.body.id } });
    expect(pos?.workspaceId).toBe(workspaceAId);
  });

  it('Workspace-A context cannot create approval matrix into Workspace-B by body workspaceId override', async () => {
    const token = await login(userManageEmail);
    // Since requiredPositionId must belong to the workspace in context, we will pass a valid positionAId
    // but try to override workspaceId to workspaceBId
    const res = await request(app.getHttpServer())
      .post('/authority/approval-matrices')
      .send({ objectType: 'BOQ', priority: 2, requiredPositionId: positionAId, authorityId: authorityId, workspaceId: workspaceBId })
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .expect(201); // it creates but in A

    const am = await prisma.approvalMatrix.findUnique({ where: { id: res.body.id } });
    expect(am?.workspaceId).toBe(workspaceAId);
  });

  it('Assignment write cannot link or assign entities across workspaces', async () => {
    const token = await login(userManageEmail);
    
    // Create a user in B and position in B manually to attempt crossing
    const posB = await prisma.position.create({
      data: { name: 'Pos B', code: 'PB', workspaceId: workspaceBId }
    });

    const userNone = await prisma.user.findFirst({ where: { fullName: userNoneEmail } });

    // Attempt to assign posB (in Workspace B) while using Workspace A context
    await request(app.getHttpServer())
      .post('/authority/assignments')
      .send({ userId: userNone?.id, positionId: posB.id })
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .expect(404); // Not Found or does not belong to workspace
  });

  it('Workspace-A cannot create position with parentPositionId from Workspace-B', async () => {
    const token = await login(userManageEmail);
    // Create a parent position in Workspace-B manually
    const posB = await prisma.position.create({
      data: { name: 'Parent B', code: 'PAR_B', workspaceId: workspaceBId }
    });

    await request(app.getHttpServer())
      .post('/authority/positions')
      .send({ name: 'Child A', code: 'CH_A', parentPositionId: posB.id })
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .expect(404);

    const check = await prisma.position.findFirst({ where: { code: 'CH_A' } });
    expect(check).toBeNull();
  });

  it('Workspace-A cannot assign Workspace-B user to Workspace-A position', async () => {
    const token = await login(userManageEmail);

    // Create a user in Workspace-B
    const accountB = await prisma.account.create({ data: { email: 'userB.authority@test.local', passwordHash: 'abc', displayName: 'B', status: 'ACTIVE' } });
    const membershipB = await prisma.workspaceMembership.create({
      data: { account: { connect: { id: accountB.id } }, workspace: { connect: { id: workspaceBId } }, status: 'ACTIVE' }
    });
    const userB = await prisma.user.create({
      data: { workspaceMembershipId: membershipB.id, workspaceId: workspaceBId, fullName: 'User B', status: 'ACTIVE' }
    });

    await request(app.getHttpServer())
      .post('/authority/assignments')
      .send({ userId: userB.id, positionId: positionAId })
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .expect(404);

    const check = await prisma.positionAssignment.findFirst({ where: { userId: userB.id, positionId: positionAId } });
    expect(check).toBeNull();
  });

  // Health Check Tests
  it('GET /authority/health remains public only if response is non-sensitive', async () => {
    const response = await request(app.getHttpServer()).get('/authority/health').expect(200);
    expect(response.body).toEqual({ module: 'authority', status: 'ok' });
    
    // Assert health response does not include ids, names, counts, workspace data, role data, authority data, environment, or config.
    const bodyStr = JSON.stringify(response.body);
    expect(bodyStr).not.toContain('id');
    expect(bodyStr).not.toContain('count');
    expect(bodyStr).not.toContain('workspace');
    expect(bodyStr).not.toContain('env');
  });

});
