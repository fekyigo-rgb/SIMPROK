import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';

const PASSWORD = 'Test1234!';
const PROJECT_CODE = 'ACC-X';

describe('Project assignment access contract (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let projectId: string;
  let workspaceAId: string;
  let workspaceBId: string;
  let workspaceBProjectId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = new PrismaClient();
    const project = await prisma.project.findFirstOrThrow({
      where: { code: PROJECT_CODE },
      select: { id: true, workspaceId: true },
    });

    projectId = project.id;
    workspaceAId = project.workspaceId;

    const workspaceB = await prisma.workspace.findFirstOrThrow({
      where: { name: 'Workspace-B' },
      select: { id: true, organizationId: true },
    });

    workspaceBId = workspaceB.id;

    const workspaceBProject = await prisma.project.upsert({
      where: {
        workspaceId_code: {
          workspaceId: workspaceB.id,
          code: 'TENANT-B-PROBE',
        },
      },
      update: {
        organizationId: workspaceB.organizationId,
        name: 'Tenant B Probe Project',
        status: 'ACTIVE',
      },
      create: {
        workspaceId: workspaceB.id,
        organizationId: workspaceB.organizationId,
        code: 'TENANT-B-PROBE',
        name: 'Tenant B Probe Project',
        status: 'ACTIVE',
      },
      select: { id: true },
    });

    workspaceBProjectId = workspaceBProject.id;
  });

  afterAll(async () => {
    await prisma.project.delete({ where: { id: workspaceBProjectId } });
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

  it('rejects GET /projects/mine when workspace context is missing', async () => {
    const token = await login('assigned@test.local');

    await request(app.getHttpServer())
      .get('/projects/mine')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('proves the nonassigned actor has PROJECT_VIEW but no ACC-X assignment', async () => {
    const account = await prisma.account.findUniqueOrThrow({
      where: { email: 'nonassigned@test.local' },
      select: {
        memberships: {
          where: { workspaceId: workspaceAId },
          select: {
            membershipRoles: {
              where: { isActive: true },
              select: {
                role: {
                  select: {
                    rolePermissions: {
                      select: {
                        permission: { select: { code: true } },
                      },
                    },
                  },
                },
              },
            },
            assignments: {
              where: { projectId, status: 'ASSIGNED' },
              select: { id: true },
            },
          },
        },
      },
    });

    const membership = account.memberships[0];
    const permissions =
      membership?.membershipRoles.flatMap((membershipRole) =>
        membershipRole.role.rolePermissions.map(
          (rolePermission) => rolePermission.permission.code,
        ),
      ) ?? [];

    expect(permissions).toContain('PROJECT_VIEW');
    expect(membership?.assignments).toEqual([]);
  });

  it('returns ACC-X from /projects/mine for the assigned member', async () => {
    const token = await login('assigned@test.local');

    const response = await request(app.getHttpServer())
      .get('/projects/mine')
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .expect(200);

    expect(response.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: projectId,
          code: PROJECT_CODE,
          workspaceId: workspaceAId,
          access: expect.objectContaining({
            assignmentId: expect.any(String),
            roleInProject: expect.any(String),
            isPrimaryAssignment: expect.any(Boolean),
          }),
        }),
      ]),
    );
  });

  it('returns an empty mine list for PROJECT_VIEW member without assignment', async () => {
    const token = await login('nonassigned@test.local');

    const response = await request(app.getHttpServer())
      .get('/projects/mine')
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .expect(200);

    expect(response.body).toEqual([]);
  });

  it('rejects mine list for an account outside the active workspace', async () => {
    const token = await login('crosstenant@test.local');

    await request(app.getHttpServer())
      .get('/projects/mine')
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .expect(403);
  });

  it('keeps workspace-wide list unavailable to non-observatory members', async () => {
    const token = await login('assigned@test.local');

    await request(app.getHttpServer())
      .get(`/projects/workspace/${workspaceAId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .expect(403);
  });

  it.each([
    ['assigned@test.local', true, 200],
    ['nonassigned@test.local', false, 403],
  ])(
    'enforces mine-list iff project-guard equivalence for %s',
    async (email, expectedListed, expectedGuardStatus) => {
      const token = await login(email);

      const mineResponse = await request(app.getHttpServer())
        .get('/projects/mine')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      const listed = mineResponse.body.some(
        (candidate: { id: string }) => candidate.id === projectId,
      );

      const guardResponse = await request(app.getHttpServer())
        .get(`/projects/${projectId}/reality`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspaceAId);

      const guardGranted = guardResponse.status === 200;

      expect(listed).toBe(expectedListed);
      expect(guardResponse.status).toBe(expectedGuardStatus);
      expect(listed).toBe(guardGranted);
    },
  );

  it('preserves cross-tenant concealment on project-scoped access', async () => {
    const token = await login('crosstenant@test.local');

    await request(app.getHttpServer())
      .get(`/projects/${projectId}/reality`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .expect(404);
  });

  it('does not include Workspace-B projects in the assigned mine list', async () => {
    const token = await login('assigned@test.local');

    const response = await request(app.getHttpServer())
      .get('/projects/mine')
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .expect(200);

    const workspaceIds = response.body.map(
      (project: { workspaceId: string }) => project.workspaceId,
    );

    expect(workspaceIds).toContain(workspaceAId);
    expect(workspaceIds).not.toContain(workspaceBId);
  });
});
