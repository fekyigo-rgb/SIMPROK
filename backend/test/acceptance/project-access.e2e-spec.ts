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
