import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { readFile } from 'fs/promises';
import { AppModule } from '../../src/app.module';

const PROJECT_ID = '10000000-0000-4000-8000-000000000018';
const WORKSPACE_ID = '10000000-0000-4000-8000-000000000004';
const DRAFT_ID = 'dec139d9-a978-4cbd-8e29-9fa88ec23b93';
const PASSWORD = 'Test1234!';

describe('IMPORT-FIRST-01 BOQ import (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let assignedToken: string;
  let foremanToken: string;
  let source: Buffer;

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    await app.init(); prisma = new PrismaClient();
    source = await readFile('C:/SIMPROK/data/first-real-input/BOQ(1).xlsx');
    await prisma.boqStructure.upsert({ where: { id: DRAFT_ID }, update: { projectId: PROJECT_ID, status: 'DRAFT', name: 'Working Draft' }, create: { id: DRAFT_ID, projectId: PROJECT_ID, name: 'Working Draft', status: 'DRAFT', version: 1 } });
    assignedToken = (await request(app.getHttpServer()).post('/auth/login').send({ email: 'assigned@test.local', password: PASSWORD })).body.access_token;
    foremanToken = (await request(app.getHttpServer()).post('/auth/login').send({ email: 'foreman@test.local', password: PASSWORD })).body.access_token;
  });

  afterAll(async () => {
    await prisma.boqItem.deleteMany({ where: { boqStructureId: DRAFT_ID } });
    await prisma.boqStructure.deleteMany({ where: { id: DRAFT_ID } });
    await prisma.$disconnect(); await app.close();
  });

  const postFile = (path: string, token: string) => request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token}`).set('x-workspace-id', WORKSPACE_ID).attach('file', source, { filename: 'BOQ(1).xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  it('allows authorized preview without database writes and rejects malformed/non-xlsx', async () => {
    const before = await prisma.boqItem.count({ where: { boqStructureId: DRAFT_ID } });
    const preview = await postFile(`/projects/${PROJECT_ID}/boq/import/preview`, assignedToken).field('selectedSheet', 'RAB').expect(201);
    expect(preview.body).toMatchObject({ totalSourceRows: 84, acceptedRows: 74, rejectedRows: 0, sourceQuantityMaxScale: 0, sourceQuantityRowsExceedingScale2: 0, canApprove: true });
    expect(await prisma.boqItem.count({ where: { boqStructureId: DRAFT_ID } })).toBe(before);
    await request(app.getHttpServer()).post(`/projects/${PROJECT_ID}/boq/import/preview`).set('Authorization', `Bearer ${assignedToken}`).set('x-workspace-id', WORKSPACE_ID).attach('file', Buffer.from('bad'), { filename: 'bad.txt', contentType: 'text/plain' }).expect(400);
    await request(app.getHttpServer()).post(`/projects/${PROJECT_ID}/boq/import/preview`).set('Authorization', `Bearer ${assignedToken}`).set('x-workspace-id', WORKSPACE_ID).attach('file', Buffer.from('bad'), { filename: 'bad.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }).expect(400);
  });

  it('enforces project access, workspace authority, and FOREMAN denial', async () => {
    await postFile(`/projects/${PROJECT_ID}/boq/import/approve`, foremanToken).field('selectedSheet', 'RAB').field('importFingerprint', 'x').expect(403);
    await postFile(`/projects/${PROJECT_ID}/boq/import/preview`, assignedToken).set('x-workspace-id', '10000000-0000-4000-8000-000000000005').field('selectedSheet', 'RAB').expect(403);
    await postFile('/projects/10000000-0000-4000-8000-000000000099/boq/import/preview', assignedToken).field('selectedSheet', 'RAB').expect(404);
  });

  it('reparses server-side, rejects fingerprint mismatch, imports atomically, and rejects replay', async () => {
    const preview = await postFile(`/projects/${PROJECT_ID}/boq/import/preview`, assignedToken).field('selectedSheet', 'RAB').expect(201);
    await postFile(`/projects/${PROJECT_ID}/boq/import/approve`, assignedToken).field('selectedSheet', 'RAB').field('importFingerprint', 'BAD').expect(409);
    const approved = await postFile(`/projects/${PROJECT_ID}/boq/import/approve`, assignedToken).field('selectedSheet', 'RAB').field('importFingerprint', preview.body.importFingerprint).expect(201);
    expect(approved.body.importedRows).toBe(74);
    const items = await prisma.boqItem.findMany({ where: { boqStructureId: DRAFT_ID } });
    expect(items).toHaveLength(74); expect(items.every((item) => item.unitPrice === null && item.lineTotal === null)).toBe(true);
    expect(items.some((item) => /^(jumlah|subtotal|total|profit|ppn|terbilang)/i.test(item.name))).toBe(false);
    await postFile(`/projects/${PROJECT_ID}/boq/import/approve`, assignedToken).field('selectedSheet', 'RAB').field('importFingerprint', preview.body.importFingerprint).expect(409);
    expect(await prisma.boqItem.count({ where: { boqStructureId: DRAFT_ID } })).toBe(74);
  });
});
