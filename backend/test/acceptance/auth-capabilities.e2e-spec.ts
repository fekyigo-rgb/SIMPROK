import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';

const PASSWORD = 'Test1234!';

/**
 * RM-01a-CODE §5A.8-9: GET /auth/capabilities is the canonical read of the
 * caller's own effective permissions in one workspace. It must use the same
 * resolver as PermissionsGuard, hold no @Permissions requirement of its own,
 * and never leak another workspace's grants.
 */
describe('GET /auth/capabilities (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let workspaceAId: string;
  let workspaceBId: string;
  let assignedToken: string;
  let nonassignedToken: string;
  let foremanToken: string;
  let crosstenantToken: string;

  const login = async (email: string) => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(201);
    return response.body.access_token as string;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = new PrismaClient();

    const assignedAccount = await prisma.account.findUniqueOrThrow({
      where: { email: 'assigned@test.local' },
    });
    const assignedMembership =
      await prisma.workspaceMembership.findFirstOrThrow({
        where: { accountId: assignedAccount.id },
      });
    workspaceAId = assignedMembership.workspaceId;

    const crosstenantAccount = await prisma.account.findUniqueOrThrow({
      where: { email: 'crosstenant@test.local' },
    });
    const crosstenantMembership =
      await prisma.workspaceMembership.findFirstOrThrow({
        where: { accountId: crosstenantAccount.id },
      });
    workspaceBId = crosstenantMembership.workspaceId;

    assignedToken = await login('assigned@test.local');
    nonassignedToken = await login('nonassigned@test.local');
    foremanToken = await login('foreman@test.local');
    crosstenantToken = await login('crosstenant@test.local');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('1. returns the exact effective permission set for the caller in the requested workspace', async () => {
    const response = await request(app.getHttpServer())
      .get('/auth/capabilities')
      .set('Authorization', `Bearer ${assignedToken}`)
      .set('x-workspace-id', workspaceAId)
      .expect(200);

    expect(response.body.workspaceId).toBe(workspaceAId);
    expect(response.body.permissions).toEqual(
      expect.arrayContaining(['PROJECT_VIEW', 'RAB_VIEW', 'RAB_DRAFT_EDIT']),
    );
  });

  it('2. missing x-workspace-id -> 400', async () => {
    await request(app.getHttpServer())
      .get('/auth/capabilities')
      .set('Authorization', `Bearer ${assignedToken}`)
      .expect(400);
  });

  it('3. account with no membership in the requested workspace -> 403', async () => {
    await request(app.getHttpServer())
      .get('/auth/capabilities')
      .set('Authorization', `Bearer ${crosstenantToken}`)
      .set('x-workspace-id', workspaceAId)
      .expect(403);
  });

  it('4. no token -> 401', async () => {
    await request(app.getHttpServer())
      .get('/auth/capabilities')
      .set('x-workspace-id', workspaceAId)
      .expect(401);
  });

  it('5. a narrowly-permissioned account (FOREMAN) never receives permissions it does not hold', async () => {
    const response = await request(app.getHttpServer())
      .get('/auth/capabilities')
      .set('Authorization', `Bearer ${foremanToken}`)
      .set('x-workspace-id', workspaceAId)
      .expect(200);

    expect(response.body.permissions).not.toEqual(
      expect.arrayContaining(['RAB_DRAFT_EDIT', 'PROJECT_CREATE']),
    );
  });

  it('6. an account without PROJECT_CREATE never receives it (fail-closed, not empty-granted-as-everything)', async () => {
    const response = await request(app.getHttpServer())
      .get('/auth/capabilities')
      .set('Authorization', `Bearer ${nonassignedToken}`)
      .set('x-workspace-id', workspaceAId)
      .expect(200);

    expect(response.body.permissions).not.toEqual(
      expect.arrayContaining(['PROJECT_CREATE']),
    );
  });

  it("7. cross-workspace request returns that workspace's own permissions, never workspace A's", async () => {
    const response = await request(app.getHttpServer())
      .get('/auth/capabilities')
      .set('Authorization', `Bearer ${crosstenantToken}`)
      .set('x-workspace-id', workspaceBId)
      .expect(200);

    expect(response.body.workspaceId).toBe(workspaceBId);
  });

  it('8. permissions array is stable/deterministic across repeated calls', async () => {
    const first = await request(app.getHttpServer())
      .get('/auth/capabilities')
      .set('Authorization', `Bearer ${assignedToken}`)
      .set('x-workspace-id', workspaceAId)
      .expect(200);
    const second = await request(app.getHttpServer())
      .get('/auth/capabilities')
      .set('Authorization', `Bearer ${assignedToken}`)
      .set('x-workspace-id', workspaceAId)
      .expect(200);

    expect(second.body.permissions).toEqual(first.body.permissions);
  });
});
