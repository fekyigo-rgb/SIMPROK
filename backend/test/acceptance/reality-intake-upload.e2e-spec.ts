import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';

const PASSWORD = 'Test1234!';
const PROJECT_CODE = 'ACC-X';

describe('Reality intake upload acceptance (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let storageDir: string;
  let workspaceAId: string;
  let assignedAccountId: string;
  let organizationId: string;
  let fixtureIntakeJobId: string | undefined;
  let fixtureSourceDocumentId: string | undefined;

  beforeAll(async () => {
    storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'simprok-intake-'));
    process.env.INTAKE_STORAGE_DIR = storageDir;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = new PrismaClient();

    const project = await prisma.project.findFirstOrThrow({
      where: { code: PROJECT_CODE },
      select: { workspaceId: true, organizationId: true },
    });
    workspaceAId = project.workspaceId;
    organizationId = project.organizationId;

    const assignedAccount = await prisma.account.findUniqueOrThrow({
      where: { email: 'assigned@test.local' },
      select: { id: true },
    });
    assignedAccountId = assignedAccount.id;
  });

  afterAll(async () => {
    if (fixtureIntakeJobId) {
      await prisma.intakeJob.delete({ where: { id: fixtureIntakeJobId } });
    }
    if (fixtureSourceDocumentId) {
      await prisma.sourceDocument.delete({
        where: { id: fixtureSourceDocumentId },
      });
    }
    await prisma.$disconnect();
    await app.close();
    await fs.rm(storageDir, { recursive: true, force: true });
  });

  async function login(email: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(201);

    return response.body.access_token;
  }

  async function counts() {
    const [
      sourceDocuments,
      intakeJobs,
      extractionArtifacts,
      knowledgeCandidates,
      knowledgeEvents,
    ] = await Promise.all([
      prisma.sourceDocument.count(),
      prisma.intakeJob.count(),
      prisma.extractionArtifact.count(),
      prisma.knowledgeCandidate.count(),
      prisma.knowledgeEvent.count(),
    ]);

    return {
      sourceDocuments,
      intakeJobs,
      extractionArtifacts,
      knowledgeCandidates,
      knowledgeEvents,
    };
  }

  function xlsxBuffer(label: string): Buffer {
    return Buffer.from(`acceptance,xlsx,${label}`);
  }

  it('enqueues a valid upload and returns the existing job on duplicate', async () => {
    const token = await login('assigned@test.local');
    const before = await counts();
    const file = xlsxBuffer(`happy-${Date.now()}`);

    const first = await request(app.getHttpServer())
      .post('/reality-intake/uploads')
      .set('Authorization', `Bearer ${token}`)
      .field('workspaceId', workspaceAId)
      .attach('file', file, {
        filename: 'acceptance.xlsx',
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(201);

    fixtureIntakeJobId = first.body.intakeJobId;
    fixtureSourceDocumentId = first.body.sourceDocumentId;

    expect(first.body).toMatchObject({
      status: 'QUEUED',
      duplicate: false,
    });
    expect(first.body.intakeJobId).toBeDefined();
    expect(first.body.sourceDocumentId).toBeDefined();
    expect(first.body.checksum).toBeDefined();

    const sourceDocument = await prisma.sourceDocument.findUniqueOrThrow({
      where: { id: first.body.sourceDocumentId },
    });
    const intakeJob = await prisma.intakeJob.findUniqueOrThrow({
      where: { id: first.body.intakeJobId },
    });

    expect(sourceDocument.workspaceId).toBe(workspaceAId);
    expect(sourceDocument.organizationId).toBe(organizationId);
    expect(sourceDocument.uploadedByAccountId).toBe(assignedAccountId);
    expect(sourceDocument.fileName).toBe('acceptance.xlsx');
    expect(sourceDocument.storageRef).not.toContain('acceptance.xlsx');
    await expect(fs.stat(sourceDocument.storageRef)).resolves.toBeDefined();
    expect(intakeJob.sourceDocumentId).toBe(sourceDocument.id);
    expect(intakeJob.status).toBe('QUEUED');
    expect(intakeJob.correlationId).toBeDefined();

    const duplicate = await request(app.getHttpServer())
      .post('/reality-intake/uploads')
      .set('Authorization', `Bearer ${token}`)
      .field('workspaceId', workspaceAId)
      .attach('file', file, {
        filename: 'acceptance.xlsx',
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(200);

    expect(duplicate.body).toMatchObject({
      intakeJobId: first.body.intakeJobId,
      sourceDocumentId: first.body.sourceDocumentId,
      status: 'QUEUED',
      checksum: first.body.checksum,
      duplicate: true,
    });

    const after = await counts();
    expect(after.sourceDocuments).toBe(before.sourceDocuments + 1);
    expect(after.intakeJobs).toBe(before.intakeJobs + 1);
    expect(after.extractionArtifacts).toBe(before.extractionArtifacts);
    expect(after.knowledgeCandidates).toBe(before.knowledgeCandidates);
    expect(after.knowledgeEvents).toBe(before.knowledgeEvents);
  });

  it('rejects invalid type without writing intake rows', async () => {
    const token = await login('assigned@test.local');
    const before = await counts();

    await request(app.getHttpServer())
      .post('/reality-intake/uploads')
      .set('Authorization', `Bearer ${token}`)
      .field('workspaceId', workspaceAId)
      .attach('file', Buffer.from('not allowed'), {
        filename: 'notes.txt',
        contentType: 'text/plain',
      })
      .expect(400);

    expect(await counts()).toEqual(before);
  });

  it('rejects oversize upload without writing intake rows', async () => {
    const token = await login('assigned@test.local');
    const before = await counts();
    const oversize = Buffer.alloc(20 * 1024 * 1024 + 1, 1);

    await request(app.getHttpServer())
      .post('/reality-intake/uploads')
      .set('Authorization', `Bearer ${token}`)
      .field('workspaceId', workspaceAId)
      .attach('file', oversize, {
        filename: 'oversize.pdf',
        contentType: 'application/pdf',
      })
      .expect(413);

    expect(await counts()).toEqual(before);
  });

  it('rejects missing workspaceId without writing intake rows', async () => {
    const token = await login('assigned@test.local');
    const before = await counts();

    await request(app.getHttpServer())
      .post('/reality-intake/uploads')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', xlsxBuffer('missing-workspace'), {
        filename: 'acceptance.xlsx',
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(400);

    expect(await counts()).toEqual(before);
  });

  it('rejects unauthorized workspace without writing intake rows', async () => {
    const token = await login('crosstenant@test.local');
    const before = await counts();

    await request(app.getHttpServer())
      .post('/reality-intake/uploads')
      .set('Authorization', `Bearer ${token}`)
      .field('workspaceId', workspaceAId)
      .attach('file', xlsxBuffer('unauthorized'), {
        filename: 'acceptance.xlsx',
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(403);

    expect(await counts()).toEqual(before);
  });
});
