import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { buildPortableBoqXlsx } from '../fixtures/boq-xlsx.fixture';

// PROJECT_A is a dedicated ad-hoc PLANNED project, not ACC-X. Under the
// canonical RAB draft-lifecycle law (RabLifecyclePolicyService), ACC-X's
// status is ACTIVE, which is now correctly PROJECT_NOT_DRAFT and therefore
// blocked from import — see docs/project-memory/SIMPROK_PROJECT_MEMORY.md
// §12.3. This suite needs a project that is actually lawfully editable.
const PROJECT_A = '35000000-0000-4000-8000-000000000005';
const PROJECT_B = '35000000-0000-4000-8000-000000000001';
const WORKSPACE_A = '10000000-0000-4000-8000-000000000004';
const WORKSPACE_B = '10000000-0000-4000-8000-000000000005';
const DRAFT_A = '35000000-0000-4000-8000-000000000002';
const DRAFT_B = '35000000-0000-4000-8000-000000000003';
const DUPLICATE_DRAFT = '35000000-0000-4000-8000-000000000004';
const PASSWORD = 'Test1234!';

describe('IMPORT-FIRST-01 BOQ import (e2e)', () => {
  let app: INestApplication; let prisma: PrismaClient; let assignedToken: string;
  let foremanToken: string; let nonassignedToken: string; let crosstenantToken: string; let source: Buffer;

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    await app.init(); prisma = new PrismaClient(); source = await buildPortableBoqXlsx();
    const orgA = await prisma.workspace.findUniqueOrThrow({ where: { id: WORKSPACE_A }, select: { organizationId: true } });
    await prisma.project.upsert({ where: { id: PROJECT_A }, update: { workspaceId: WORKSPACE_A, organizationId: orgA.organizationId, status: 'PLANNED' }, create: { id: PROJECT_A, workspaceId: WORKSPACE_A, organizationId: orgA.organizationId, code: 'ACC-IMPORT-A', name: 'Import isolation A' } });
    await prisma.project.upsert({ where: { id: PROJECT_B }, update: { workspaceId: WORKSPACE_A, organizationId: orgA.organizationId }, create: { id: PROJECT_B, workspaceId: WORKSPACE_A, organizationId: orgA.organizationId, code: 'ACC-IMPORT-B', name: 'Import isolation B' } });

    const assignedAccount = await prisma.account.findUniqueOrThrow({ where: { email: 'assigned@test.local' } });
    const assignedMembership = await prisma.workspaceMembership.findUniqueOrThrow({ where: { accountId_workspaceId: { accountId: assignedAccount.id, workspaceId: WORKSPACE_A } } });
    const foremanAccount = await prisma.account.findUniqueOrThrow({ where: { email: 'foreman@test.local' } });
    const foremanMembership = await prisma.workspaceMembership.findUniqueOrThrow({ where: { accountId_workspaceId: { accountId: foremanAccount.id, workspaceId: WORKSPACE_A } } });
    await prisma.projectAssignment.upsert({
      where: { workspaceMembershipId_projectId: { workspaceMembershipId: assignedMembership.id, projectId: PROJECT_A } },
      update: { status: 'ASSIGNED' }, create: { workspaceMembershipId: assignedMembership.id, projectId: PROJECT_A, roleInProject: 'PROJECT_MANAGER', isPrimaryAssignment: false, status: 'ASSIGNED' },
    });
    await prisma.projectAssignment.upsert({
      where: { workspaceMembershipId_projectId: { workspaceMembershipId: foremanMembership.id, projectId: PROJECT_A } },
      update: { status: 'ASSIGNED' }, create: { workspaceMembershipId: foremanMembership.id, projectId: PROJECT_A, roleInProject: 'FOREMAN', isPrimaryAssignment: false, status: 'ASSIGNED' },
    });

    await prisma.boqStructure.deleteMany({ where: { id: { in: [DRAFT_A, DRAFT_B, DUPLICATE_DRAFT] } } });
    await prisma.boqStructure.createMany({ data: [
      { id: DRAFT_A, projectId: PROJECT_A, name: 'Working Draft', status: 'DRAFT', version: 1 },
      { id: DRAFT_B, projectId: PROJECT_B, name: 'Working Draft', status: 'DRAFT', version: 1 },
    ] });
    const login = async (email: string) => (await request(app.getHttpServer()).post('/auth/login').send({ email, password: PASSWORD })).body.access_token;
    assignedToken = await login('assigned@test.local'); foremanToken = await login('foreman@test.local');
    nonassignedToken = await login('nonassigned@test.local'); crosstenantToken = await login('crosstenant@test.local');
  });

  beforeEach(async () => {
    await prisma.boqItem.deleteMany({ where: { boqStructureId: { in: [DRAFT_A, DRAFT_B, DUPLICATE_DRAFT] } } });
    await prisma.boqStructure.deleteMany({ where: { id: DUPLICATE_DRAFT } });
    await prisma.boqStructure.update({ where: { id: DRAFT_A }, data: { name: 'Working Draft', status: 'DRAFT' } });
  });

  afterAll(async () => {
    await prisma.boqItem.deleteMany({ where: { boqStructureId: { in: [DRAFT_A, DRAFT_B, DUPLICATE_DRAFT] } } });
    await prisma.boqStructure.deleteMany({ where: { id: { in: [DRAFT_A, DRAFT_B, DUPLICATE_DRAFT] } } });
    await prisma.projectAssignment.deleteMany({ where: { projectId: PROJECT_A } });
    await prisma.project.deleteMany({ where: { id: { in: [PROJECT_A, PROJECT_B] } } });
    await prisma.$disconnect(); await app.close();
  });

  const postFile = (path: string, token: string, workspace = WORKSPACE_A) => request(app.getHttpServer()).post(path)
    .set('Authorization', `Bearer ${token}`).set('x-workspace-id', workspace)
    .attach('file', source, { filename: 'portable.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const preview = (token = assignedToken) => postFile(`/projects/${PROJECT_A}/boq/import/preview`, token).field('selectedSheet', 'RAB');

  it('previews without writes and reports the honest row-type breakdown', async () => {
    const response = await preview().expect(201);
    expect(response.body).toMatchObject({ acceptedRows: 4, folderRows: 2, workItemRows: 2, noteRows: 0, rejectedRows: 0, canApprove: true });
    expect(await prisma.boqItem.count({ where: { boqStructureId: DRAFT_A } })).toBe(0);
  });

  it('enforces account, tenant, workspace, project, and FOREMAN boundaries', async () => {
    await postFile(`/projects/${PROJECT_A}/boq/import/approve`, foremanToken).field('selectedSheet', 'RAB').field('importFingerprint', 'x').expect(403);
    await preview(nonassignedToken).expect(403); await preview(crosstenantToken).expect(404);
    await postFile(`/projects/${PROJECT_A}/boq/import/preview`, assignedToken, WORKSPACE_B).field('selectedSheet', 'RAB').expect(403);
    await postFile('/projects/10000000-0000-4000-8000-000000000099/boq/import/preview', assignedToken).field('selectedSheet', 'RAB').expect(404);
  });

  it('imports only Project A and leaves same-workspace Project B untouched', async () => {
    const p = await preview().expect(201);
    const response = await postFile(`/projects/${PROJECT_A}/boq/import/approve`, assignedToken).field('selectedSheet', 'RAB').field('importFingerprint', p.body.importFingerprint).expect(201);
    expect(response.body).toMatchObject({ structureId: DRAFT_A, importedRows: 4 });
    const items = await prisma.boqItem.findMany({ where: { boqStructureId: DRAFT_A } });
    expect(items).toHaveLength(4);
    expect(items.filter((item) => item.itemType !== 'WORK_ITEM').every((item) => item.quantity.toString() === '0' && item.unit === '')).toBe(true);
    expect(items.every((item) => item.unitPrice === null && item.lineTotal === null)).toBe(true);
    expect(await prisma.boqItem.count({ where: { boqStructureId: DRAFT_B } })).toBe(0);
  });

  it('returns 404 for zero matching Working Draft', async () => {
    const p = await preview().expect(201); await prisma.boqStructure.update({ where: { id: DRAFT_A }, data: { name: 'Not Working Draft' } });
    const response = await postFile(`/projects/${PROJECT_A}/boq/import/approve`, assignedToken).field('selectedSheet', 'RAB').field('importFingerprint', p.body.importFingerprint).expect(404);
    expect(response.body.message).toBe('WORKING_DRAFT_NOT_FOUND');
  });

  it('returns 409 rather than choosing duplicate Working Drafts', async () => {
    const p = await preview().expect(201);
    await prisma.boqStructure.create({ data: { id: DUPLICATE_DRAFT, projectId: PROJECT_A, name: 'Working Draft', status: 'DRAFT', version: 2 } });
    const response = await postFile(`/projects/${PROJECT_A}/boq/import/approve`, assignedToken).field('selectedSheet', 'RAB').field('importFingerprint', p.body.importFingerprint).expect(409);
    expect(response.body.message).toBe('MULTIPLE_WORKING_DRAFTS');
  });

  it('rejects fingerprint mismatch and malformed/non-XLSX input', async () => {
    await postFile(`/projects/${PROJECT_A}/boq/import/approve`, assignedToken).field('selectedSheet', 'RAB').field('importFingerprint', 'BAD').expect(409);
    await request(app.getHttpServer()).post(`/projects/${PROJECT_A}/boq/import/preview`).set('Authorization', `Bearer ${assignedToken}`).set('x-workspace-id', WORKSPACE_A).attach('file', Buffer.from('bad'), { filename: 'bad.txt' }).expect(400);
    await request(app.getHttpServer()).post(`/projects/${PROJECT_A}/boq/import/preview`).set('Authorization', `Bearer ${assignedToken}`).set('x-workspace-id', WORKSPACE_A).attach('file', Buffer.from('bad'), { filename: 'bad.xlsx' }).expect(400);
  });
});
