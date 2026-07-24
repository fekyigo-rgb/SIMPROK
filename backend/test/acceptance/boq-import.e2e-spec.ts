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
const PROJECT_C = '35000000-0000-4000-8000-000000000006';
const DRAFT_C = '35000000-0000-4000-8000-000000000007';
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

  // RM-001: approve used to reject any non-empty Working Draft with 409
  // WORKING_DRAFT_NOT_EMPTY. It must now safely full-replace: delete only
  // this exact structure's existing items, insert the approved preview rows,
  // reuse the same container, leave everything else untouched.
  it('safely full-replaces an already non-empty Working Draft (RM-001)', async () => {
    await prisma.boqItem.createMany({ data: [
      { boqStructureId: DRAFT_A, wbsCode: 'OLD-1', name: 'Old folder', itemType: 'FOLDER', quantity: '0', unit: '', sortOrder: 0 },
      { boqStructureId: DRAFT_A, wbsCode: 'OLD-2', name: 'Old work item', itemType: 'WORK_ITEM', quantity: '5', unit: 'm2', unitPrice: '10000', lineTotal: '50000', sortOrder: 1 },
    ] });
    expect(await prisma.boqItem.count({ where: { boqStructureId: DRAFT_A } })).toBe(2);

    const p = await preview().expect(201);
    const response = await postFile(`/projects/${PROJECT_A}/boq/import/approve`, assignedToken).field('selectedSheet', 'RAB').field('importFingerprint', p.body.importFingerprint).expect(201);

    expect(response.body).toMatchObject({
      structureId: DRAFT_A, workingDraftId: DRAFT_A,
      importedRows: 4, importedItemCount: 4,
      replacedExistingItemCount: 2, state: 'DRAFT',
      importFingerprint: p.body.importFingerprint,
    });

    const items = await prisma.boqItem.findMany({ where: { boqStructureId: DRAFT_A } });
    expect(items).toHaveLength(4);
    expect(items.some((item) => item.wbsCode === 'OLD-1' || item.wbsCode === 'OLD-2')).toBe(false);
    expect(items.every((item) => item.unitPrice === null && item.lineTotal === null)).toBe(true);
    expect(await prisma.boqItem.count({ where: { boqStructureId: DRAFT_B } })).toBe(0);
    expect((await prisma.boqStructure.findUniqueOrThrow({ where: { id: DRAFT_A } })).status).toBe('DRAFT');
  });

  // Direct proof of the transaction primitive the fixed approve() depends on:
  // delete-then-insert inside one prisma.$transaction against this exact
  // schema/table. The adapter's own row validation makes it impossible to
  // drive a real mid-loop insert failure through the public HTTP surface (a
  // dangling parent reference safely falls back to null before it ever
  // reaches the database), so this exercises the identical delete+create
  // pattern directly with a deliberately invalid foreign key as the fault
  // injector, proving Prisma rolls the whole transaction back — including
  // the delete — when a later insert in the same transaction fails.
  it('rolls back the full delete+insert atomically when a later insert fails (RM-001 transaction proof)', async () => {
    await prisma.boqItem.createMany({ data: [
      { boqStructureId: DRAFT_A, wbsCode: 'OLD-1', name: 'Old folder', itemType: 'FOLDER', quantity: '0', unit: '', sortOrder: 0 },
      { boqStructureId: DRAFT_A, wbsCode: 'OLD-2', name: 'Old work item', itemType: 'WORK_ITEM', quantity: '5', unit: 'm2', sortOrder: 1 },
    ] });
    const before = await prisma.boqItem.findMany({ where: { boqStructureId: DRAFT_A }, orderBy: { wbsCode: 'asc' } });
    expect(before).toHaveLength(2);

    const nonExistentParentId = '99999999-0000-4000-8000-000000000000';
    await expect(prisma.$transaction(async (tx) => {
      await tx.boqItem.deleteMany({ where: { boqStructureId: DRAFT_A } });
      await tx.boqItem.create({ data: { boqStructureId: DRAFT_A, wbsCode: 'NEW-1', name: 'New folder', itemType: 'FOLDER', quantity: '0', unit: '', sortOrder: 0 } });
      await tx.boqItem.create({ data: { boqStructureId: DRAFT_A, parentId: nonExistentParentId, wbsCode: 'NEW-2', name: 'New work item', itemType: 'WORK_ITEM', quantity: '1', unit: 'm2', sortOrder: 1 } });
    })).rejects.toThrow();

    const after = await prisma.boqItem.findMany({ where: { boqStructureId: DRAFT_A }, orderBy: { wbsCode: 'asc' } });
    expect(after.map((item) => item.wbsCode)).toEqual(['OLD-1', 'OLD-2']);
    expect(await prisma.boqItem.count({ where: { wbsCode: { in: ['NEW-1', 'NEW-2'] } } })).toBe(0);
  });

  it('fails closed and mutates nothing when an approved RAB already exists (RM-001 lifecycle guard)', async () => {
    const p = await preview().expect(201);
    const rab = await prisma.rabDocument.create({ data: {
      projectId: PROJECT_A, boqStructureId: DRAFT_A, version: 1, name: 'Approved RAB',
      totalBaseCost: '0', totalFinalCost: '0', status: 'APPROVED',
    } });
    try {
      const before = await prisma.boqItem.count({ where: { boqStructureId: DRAFT_A } });
      const response = await postFile(`/projects/${PROJECT_A}/boq/import/approve`, assignedToken).field('selectedSheet', 'RAB').field('importFingerprint', p.body.importFingerprint).expect(409);
      expect(response.body.message).toBe('APPROVED_RAB_EXISTS');
      expect(await prisma.boqItem.count({ where: { boqStructureId: DRAFT_A } })).toBe(before);
    } finally {
      await prisma.rabDocument.delete({ where: { id: rab.id } });
    }
  });

  // The importFingerprint is sha256(projectId | workspaceId | sourceSha256 |
  // sheetName | parserVersion). Replaying Project A's preview fingerprint
  // against Project B's approve call must fail on that binding alone, before
  // any Working Draft lookup — proving cross-project (and, by the identical
  // mechanism, cross-workspace) preview reuse is structurally impossible.
  it('fails closed and mutates nothing when a Project A preview fingerprint is replayed against Project B (RM-001)', async () => {
    // Grant the same user access to Project B too, so ProjectAccessGuard lets
    // the request through and this test isolates the fingerprint binding
    // specifically, rather than being satisfied by the (also correct, but
    // different) project-assignment boundary catching it first.
    const assignedAccount = await prisma.account.findUniqueOrThrow({ where: { email: 'assigned@test.local' } });
    const assignedMembership = await prisma.workspaceMembership.findUniqueOrThrow({ where: { accountId_workspaceId: { accountId: assignedAccount.id, workspaceId: WORKSPACE_A } } });
    const grant = await prisma.projectAssignment.create({ data: { workspaceMembershipId: assignedMembership.id, projectId: PROJECT_B, roleInProject: 'PROJECT_MANAGER', isPrimaryAssignment: false, status: 'ASSIGNED' } });
    try {
      const p = await preview().expect(201);
      const beforeA = await prisma.boqItem.count({ where: { boqStructureId: DRAFT_A } });
      const beforeB = await prisma.boqItem.count({ where: { boqStructureId: DRAFT_B } });
      const response = await postFile(`/projects/${PROJECT_B}/boq/import/approve`, assignedToken).field('selectedSheet', 'RAB').field('importFingerprint', p.body.importFingerprint).expect(409);
      expect(response.body.message).toBe('IMPORT_FINGERPRINT_MISMATCH');
      expect(await prisma.boqItem.count({ where: { boqStructureId: DRAFT_A } })).toBe(beforeA);
      expect(await prisma.boqItem.count({ where: { boqStructureId: DRAFT_B } })).toBe(beforeB);
    } finally {
      await prisma.projectAssignment.delete({ where: { id: grant.id } });
    }
  });

  // RM-001 closure: WORKSPACE_B is a genuinely different workspace (its own
  // organization/tenant — see seed-acceptance.ts orgB/workspaceB), not just a
  // same-workspace sibling project like the Project A -> Project B test
  // above. Project C lives entirely inside Workspace B. The importFingerprint
  // binds workspaceId as well as projectId (see fingerprint() in
  // boq-import.service.ts), so a Project A / Workspace A preview replayed
  // against a real Workspace B project must fail on that binding alone.
  it('fails closed and mutates nothing when a Workspace A preview fingerprint is replayed against a Workspace B project (RM-001 cross-workspace)', async () => {
    const workspaceB = await prisma.workspace.findUniqueOrThrow({ where: { id: WORKSPACE_B }, select: { organizationId: true } });
    await prisma.project.create({ data: { id: PROJECT_C, workspaceId: WORKSPACE_B, organizationId: workspaceB.organizationId, code: 'ACC-IMPORT-C', name: 'Import isolation C (Workspace B)' } });
    await prisma.boqStructure.create({ data: { id: DRAFT_C, projectId: PROJECT_C, name: 'Working Draft', status: 'DRAFT', version: 1 } });
    // crosstenant@test.local already carries a real, seeded WorkspaceMembership
    // in Workspace B (org B) — only a role + project assignment are added
    // here, temporarily, so this account can legitimately reach the approve
    // handler's fingerprint check for Project C instead of being rejected
    // earlier by ProjectAccessGuard/PermissionsGuard.
    const role = await prisma.role.create({ data: { workspaceId: WORKSPACE_B, code: 'ACCEPTANCE_CROSS_WORKSPACE', name: 'Acceptance Cross-Workspace RAB Edit' } });
    const [rabView, rabDraftEdit] = await Promise.all([
      prisma.permission.findUniqueOrThrow({ where: { code: 'RAB_VIEW' } }),
      prisma.permission.findUniqueOrThrow({ where: { code: 'RAB_DRAFT_EDIT' } }),
    ]);
    await prisma.rolePermission.createMany({ data: [rabView, rabDraftEdit].map((permission) => ({ roleId: role.id, permissionId: permission.id })) });
    const crosstenantAccount = await prisma.account.findUniqueOrThrow({ where: { email: 'crosstenant@test.local' } });
    const crosstenantMembership = await prisma.workspaceMembership.findUniqueOrThrow({ where: { accountId_workspaceId: { accountId: crosstenantAccount.id, workspaceId: WORKSPACE_B } } });
    const membershipRole = await prisma.membershipRole.create({ data: { workspaceMembershipId: crosstenantMembership.id, roleId: role.id, isActive: true } });
    const assignment = await prisma.projectAssignment.create({ data: { workspaceMembershipId: crosstenantMembership.id, projectId: PROJECT_C, roleInProject: 'PROJECT_MANAGER', isPrimaryAssignment: false, status: 'ASSIGNED' } });
    try {
      const p = await preview().expect(201);
      const beforeA = await prisma.boqItem.count({ where: { boqStructureId: DRAFT_A } });
      const beforeC = await prisma.boqItem.count({ where: { boqStructureId: DRAFT_C } });
      const response = await postFile(`/projects/${PROJECT_C}/boq/import/approve`, crosstenantToken, WORKSPACE_B).field('selectedSheet', 'RAB').field('importFingerprint', p.body.importFingerprint).expect(409);
      expect(response.body.message).toBe('IMPORT_FINGERPRINT_MISMATCH');
      expect(await prisma.boqItem.count({ where: { boqStructureId: DRAFT_A } })).toBe(beforeA);
      expect(await prisma.boqItem.count({ where: { boqStructureId: DRAFT_C } })).toBe(beforeC);
      expect((await prisma.boqStructure.findUniqueOrThrow({ where: { id: DRAFT_A } })).status).toBe('DRAFT');
      expect((await prisma.boqStructure.findUniqueOrThrow({ where: { id: DRAFT_C } })).status).toBe('DRAFT');
    } finally {
      await prisma.projectAssignment.delete({ where: { id: assignment.id } });
      await prisma.membershipRole.delete({ where: { id: membershipRole.id } });
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
      await prisma.role.delete({ where: { id: role.id } });
      await prisma.boqItem.deleteMany({ where: { boqStructureId: DRAFT_C } });
      await prisma.boqStructure.delete({ where: { id: DRAFT_C } });
      await prisma.project.delete({ where: { id: PROJECT_C } });
    }
  });

  // This is an EXACT-fingerprint replay (both requests carry the identical,
  // validly-derived fingerprint from the same preview) — not a mismatched or
  // stale one. There is no one-time preview-consumption mechanism, by
  // design: both requests are expected and allowed to succeed. What this
  // proves is that the Working Draft row lock serializes them so the second
  // full-replace runs against the first's already-committed result, leaving
  // a deterministic final item set with no duplicate or interleaved rows.
  it('serializes concurrent approves via the Working Draft row lock into a deterministic final item set (RM-001)', async () => {
    const p = await preview().expect(201);
    const [first, second] = await Promise.all([
      postFile(`/projects/${PROJECT_A}/boq/import/approve`, assignedToken).field('selectedSheet', 'RAB').field('importFingerprint', p.body.importFingerprint),
      postFile(`/projects/${PROJECT_A}/boq/import/approve`, assignedToken).field('selectedSheet', 'RAB').field('importFingerprint', p.body.importFingerprint),
    ]);
    expect([first.status, second.status]).toEqual([201, 201]);
    const items = await prisma.boqItem.findMany({ where: { boqStructureId: DRAFT_A } });
    expect(items).toHaveLength(4);
    expect(new Set(items.map((item) => item.id)).size).toBe(4);
  });
});
