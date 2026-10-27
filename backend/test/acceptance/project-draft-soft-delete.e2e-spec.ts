import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { randomUUID } from 'node:crypto';

describe('Hapus Draft — canonical API + PostgreSQL acceptance', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let projectId: string;
  let workspaceId: string;
  let name: string;
  let token: string;

  beforeAll(async () => {
    const fixture = await prisma.account.findUniqueOrThrow({ where: { email: 'assigned@test.local' } });
    const membership = await prisma.workspaceMembership.findFirstOrThrow({ where: { accountId: fixture.id, status: 'ACTIVE' } });
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: membership.workspaceId } });
    workspaceId = workspace.id;
    name = 'E2E Draft Disposal ' + randomUUID().slice(0, 8);
    const project = await prisma.project.create({
      data: {
        code: 'DEL-E2E-' + randomUUID().slice(0, 10),
        name, workspaceId, organizationId: workspace.organizationId,
        assignments: { create: {
          workspaceMembershipId: membership.id,
          roleInProject: 'OWNER', isPrimaryAssignment: true, status: 'ASSIGNED',
        } },
        boqStructures: { create: { name: 'Working Draft', status: 'DRAFT', version: 1 } },
      },
    });
    projectId = project.id;
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'assigned@test.local', password: 'Test1234!' })
      .expect(201);
    token = response.body.access_token;
  });

  afterAll(async () => {
    if (projectId) {
      await prisma.boqStructure.deleteMany({ where: { projectId } });
      await prisma.projectAssignment.deleteMany({ where: { projectId } });
      await prisma.project.deleteMany({ where: { id: projectId } });
    }
    await app?.close();
    await prisma.$disconnect();
  });

  it('rejects unauthenticated and wrong-workspace attempts without mutation', async () => {
    await request(app.getHttpServer()).delete('/projects/' + projectId + '/draft')
      .send({ projectName: name }).expect(401);
    await request(app.getHttpServer()).delete('/projects/' + projectId + '/draft')
      .set('Authorization', 'Bearer ' + token)
      .set('x-workspace-id', '44444444-4444-4444-8444-444444444444')
      .send({ projectName: name }).expect(403);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).deletedAt).toBeNull();
  });

  it('rejects ACTIVE project before modification', async () => {
    await prisma.project.update({ where: { id: projectId }, data: { status: 'ACTIVE' } });
    await request(app.getHttpServer()).delete('/projects/' + projectId + '/draft')
      .set('Authorization', 'Bearer ' + token).set('x-workspace-id', workspaceId)
      .send({ projectName: name }).expect(409);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).deletedAt).toBeNull();
    await prisma.project.update({ where: { id: projectId }, data: { status: 'PLANNED' } });
  });

  it('keeps authorized draft visible and preserves canonical BOQ after denied deletes', async () => {
    const list = await request(app.getHttpServer()).get('/projects/mine')
      .set('Authorization', 'Bearer ' + token).set('x-workspace-id', workspaceId).expect(200);
    expect(list.body.some((row: { id: string }) => row.id === projectId)).toBe(true);
    expect(await prisma.boqStructure.count({ where: { projectId } })).toBe(1);
    expect(await prisma.progressAuditEvent.count({ where: { projectId, action: 'PROJECT_DRAFT_SOFT_DELETE' } })).toBe(0);
  });
});
