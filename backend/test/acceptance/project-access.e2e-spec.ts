import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';

const PASSWORD = 'Test1234!';
const PROJECT_CODE = 'ACC-X';

describe('ProjectAccessGuard acceptance (e2e)', () => {
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

  it('rejects GET /projects when workspace context is missing', async () => {
    const token = await login('assigned@test.local');

    await request(app.getHttpServer())
      .get('/projects')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('returns only projects for the requested workspace context', async () => {
    const token = await login('assigned@test.local');

    const response = await request(app.getHttpServer())
      .get(`/projects/workspace/${workspaceAId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .expect(200);

    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: projectId,
          code: PROJECT_CODE,
          workspaceId: workspaceAId,
        }),
      ]),
    );
    expect(response.body).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: workspaceBProjectId,
          workspaceId: workspaceBId,
        }),
      ]),
    );
  });

  it('does not leak Workspace-B projects through Workspace-A context', async () => {
    const token = await login('assigned@test.local');

    const response = await request(app.getHttpServer())
      .get(`/projects/workspace/${workspaceAId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .expect(200);

    const workspaceIds = response.body.map(
      (project: { workspaceId: string }) => project.workspaceId,
    );

    expect(workspaceIds).toContain(workspaceAId);
    expect(workspaceIds).not.toContain(workspaceBId);
  });

  it('rejects GET /projects for an account outside the requested workspace', async () => {
    const token = await login('crosstenant@test.local');

    await request(app.getHttpServer())
      .get(`/projects/workspace/${workspaceAId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .expect(403);
  });

  it('returns 200 for an assigned workspace member', async () => {
    const token = await login('assigned@test.local');

    await request(app.getHttpServer())
      .get(`/projects/${projectId}/reality`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .expect(200);
  });

  it('returns 403 for a workspace member without project assignment', async () => {
    const token = await login('nonassigned@test.local');

    await request(app.getHttpServer())
      .get(`/projects/${projectId}/reality`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .expect(403);
  });

  it('returns 404 for cross-tenant access', async () => {
    const token = await login('crosstenant@test.local');

    await request(app.getHttpServer())
      .get(`/projects/${projectId}/reality`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .expect(404);
  });
});
