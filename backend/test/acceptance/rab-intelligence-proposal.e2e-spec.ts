import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../src/app.module';

const PASSWORD = 'Test1234!';
const SALT_ROUNDS = 10;

describe('RAB Intelligence proposal endpoint (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;

  let workspaceAId: string;
  let workspaceBId: string;
  let projectAId: string;
  let projectBId: string;
  let noBoqProjectId: string;
  let boqItemAId: string;
  let boqItemBId: string;

  const emails = {
    viewer: 'p8a3.viewer@test.local',
    noAssignment: 'p8a3.no.assignment@test.local',
    crossTenant: 'p8a3.cross@test.local',
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = new PrismaClient();
    const passwordHash = await bcrypt.hash(PASSWORD, SALT_ROUNDS);

    const projectView = await prisma.permission.upsert({
      where: { code: 'PROJECT_VIEW' },
      update: {},
      create: { code: 'PROJECT_VIEW', name: 'Project View' },
    });

    const orgA = await prisma.organization.create({ data: { name: 'P8A-3 Org A', type: 'COMPANY' } });
    const orgB = await prisma.organization.create({ data: { name: 'P8A-3 Org B', type: 'COMPANY' } });
    const workspaceA = await prisma.workspace.create({ data: { name: 'P8A-3 WS A', organizationId: orgA.id } });
    const workspaceB = await prisma.workspace.create({ data: { name: 'P8A-3 WS B', organizationId: orgB.id } });
    workspaceAId = workspaceA.id;
    workspaceBId = workspaceB.id;

    const roleViewA = await prisma.role.create({
      data: {
        name: 'P8A-3 Viewer A',
        code: 'P8A3_VIEW_A',
        workspaceId: workspaceAId,
        rolePermissions: { create: [{ permissionId: projectView.id }] },
      },
    });
    const roleViewB = await prisma.role.create({
      data: {
        name: 'P8A-3 Viewer B',
        code: 'P8A3_VIEW_B',
        workspaceId: workspaceBId,
        rolePermissions: { create: [{ permissionId: projectView.id }] },
      },
    });

    const [projectA, projectB, noBoqProject] = await Promise.all([
      prisma.project.create({
        data: { name: 'P8A-3 Project A', code: 'P8A3-A', workspaceId: workspaceAId, organizationId: orgA.id },
      }),
      prisma.project.create({
        data: { name: 'P8A-3 Project B', code: 'P8A3-B', workspaceId: workspaceBId, organizationId: orgB.id },
      }),
      prisma.project.create({
        data: { name: 'P8A-3 No BOQ', code: 'P8A3-NOBOQ', workspaceId: workspaceAId, organizationId: orgA.id },
      }),
    ]);
    projectAId = projectA.id;
    projectBId = projectB.id;
    noBoqProjectId = noBoqProject.id;

    const structureA = await prisma.boqStructure.create({
      data: { projectId: projectAId, name: 'Working Draft', version: 1, status: 'DRAFT' },
    });
    const itemA = await prisma.boqItem.create({
      data: {
        boqStructureId: structureA.id,
        wbsCode: '1.1',
        name: 'Galian tanah biasa',
        itemType: 'WORK_ITEM',
        quantity: '10',
        unit: 'm3',
        sortOrder: 0,
      },
    });
    boqItemAId = itemA.id;

    const structureB = await prisma.boqStructure.create({
      data: { projectId: projectBId, name: 'Working Draft', version: 1, status: 'DRAFT' },
    });
    const itemB = await prisma.boqItem.create({
      data: {
        boqStructureId: structureB.id,
        wbsCode: '1.1',
        name: 'Pekerjaan lain',
        itemType: 'WORK_ITEM',
        quantity: '5',
        unit: 'm2',
        sortOrder: 0,
      },
    });
    boqItemBId = itemB.id;

    async function createAccount(email: string, workspaceId: string, roleId: string, projectId?: string) {
      const account = await prisma.account.create({
        data: { email, passwordHash, displayName: email, status: 'ACTIVE' },
      });
      const membership = await prisma.workspaceMembership.create({
        data: {
          accountId: account.id,
          workspaceId,
          status: 'ACTIVE',
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

    const viewerMembershipId = await createAccount(emails.viewer, workspaceAId, roleViewA.id, projectAId);
    await prisma.projectAssignment.create({
      data: {
        workspaceMembershipId: viewerMembershipId,
        projectId: noBoqProjectId,
        roleInProject: 'MEMBER',
        isPrimaryAssignment: false,
        status: 'ASSIGNED',
      },
    });
    await createAccount(emails.noAssignment, workspaceAId, roleViewA.id);
    await createAccount(emails.crossTenant, workspaceBId, roleViewB.id, projectBId);
  });

  afterAll(async () => {
    const accounts = await prisma.account.findMany({ where: { email: { in: Object.values(emails) } } });
    const accountIds = accounts.map((account) => account.id);
    const memberships = await prisma.workspaceMembership.findMany({ where: { accountId: { in: accountIds } } });
    const membershipIds = memberships.map((membership) => membership.id);
    const projectIds = [projectAId, projectBId, noBoqProjectId].filter(Boolean);

    await prisma.intelligenceEvidence.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.boqItem.deleteMany({ where: { boqStructure: { projectId: { in: projectIds } } } });
    await prisma.boqStructure.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.projectAssignment.deleteMany({
      where: { OR: [{ workspaceMembershipId: { in: membershipIds } }, { projectId: { in: projectIds } }] },
    });
    await prisma.user.deleteMany({ where: { workspaceMembershipId: { in: membershipIds } } });
    await prisma.workspaceMembership.deleteMany({ where: { id: { in: membershipIds } } });
    await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.role.deleteMany({ where: { code: { in: ['P8A3_VIEW_A', 'P8A3_VIEW_B'] } } });
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    await prisma.workspace.deleteMany({ where: { id: { in: [workspaceAId, workspaceBId].filter(Boolean) } } });
    await prisma.organization.deleteMany({ where: { name: { in: ['P8A-3 Org A', 'P8A-3 Org B'] } } });
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

  it('rejects unauthenticated requests', async () => {
    await request(app.getHttpServer())
      .post(`/projects/${projectAId}/rab-intelligence/proposals`)
      .send({})
      .expect(401);
  });

  it('rejects a user without a project assignment', async () => {
    const token = await login(emails.noAssignment);

    await request(app.getHttpServer())
      .post(`/projects/${projectAId}/rab-intelligence/proposals`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({})
      .expect(403);
  });

  it('rejects a boqItemRef that belongs to another project/tenant', async () => {
    const token = await login(emails.viewer);

    await request(app.getHttpServer())
      .post(`/projects/${projectAId}/rab-intelligence/proposals`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({ boqItemRefs: [boqItemBId] })
      .expect(400);
  });

  it('rejects when the project has no BOQ to ground against', async () => {
    const token = await login(emails.viewer);

    await request(app.getHttpServer())
      .post(`/projects/${noBoqProjectId}/rab-intelligence/proposals`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({})
      .expect(400);
  });

  it('generates a DRAFT/REVIEW-only proposal, records exactly one evidence row, and never trusts a client-supplied requestId', async () => {
    const token = await login(emails.viewer);
    const spoofedRequestId = 'attacker-chosen-request-id';

    const response = await request(app.getHttpServer())
      .post(`/projects/${projectAId}/rab-intelligence/proposals`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({ boqItemRefs: [boqItemAId], requestId: spoofedRequestId })
      .expect(201);

    // Default test env has SIMPROK_AI_PROVIDER unset -> disabled provider ->
    // no live OpenAI network call, structured safe fallback only.
    expect(response.body.status).toBe('NEEDS_REVIEW');
    expect(response.body.items).toEqual([]);
    expect(response.body.requestId).not.toBe(spoofedRequestId);

    const evidenceRows = await prisma.intelligenceEvidence.findMany({
      where: { projectId: projectAId, requestId: response.body.requestId },
    });
    expect(evidenceRows).toHaveLength(1);
    expect(evidenceRows[0]).toMatchObject({
      workspaceId: workspaceAId,
      efPermission: 'NOT_ALLOWED',
      efReferences: [],
    });

    const spoofedRows = await prisma.intelligenceEvidence.findMany({
      where: { requestId: spoofedRequestId },
    });
    expect(spoofedRows).toHaveLength(0);

    // No RAB/BOQ/AHSP mutation occurred as a side effect of proposing.
    const boqItem = await prisma.boqItem.findUniqueOrThrow({ where: { id: boqItemAId } });
    expect(boqItem.ahspVersionId).toBeNull();
    expect(boqItem.unitPrice).toBeNull();
  });
});
