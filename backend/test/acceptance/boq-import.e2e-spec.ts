import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { StorageService } from '../../src/reality-intake/storage.service';
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
  let storage: StorageService; let assignedAccountId: string; let foremanAccountId: string;
  let requestProofRoleId: string; let requestProofMembershipRoleId: string;

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    await app.init(); prisma = new PrismaClient(); storage = app.get(StorageService); source = await buildPortableBoqXlsx();
    const orgA = await prisma.workspace.findUniqueOrThrow({ where: { id: WORKSPACE_A }, select: { organizationId: true } });
    await prisma.project.upsert({ where: { id: PROJECT_A }, update: { workspaceId: WORKSPACE_A, organizationId: orgA.organizationId, status: 'PLANNED' }, create: { id: PROJECT_A, workspaceId: WORKSPACE_A, organizationId: orgA.organizationId, code: 'ACC-IMPORT-A', name: 'Import isolation A' } });
    await prisma.project.upsert({ where: { id: PROJECT_B }, update: { workspaceId: WORKSPACE_A, organizationId: orgA.organizationId }, create: { id: PROJECT_B, workspaceId: WORKSPACE_A, organizationId: orgA.organizationId, code: 'ACC-IMPORT-B', name: 'Import isolation B' } });

    const assignedAccount = await prisma.account.findUniqueOrThrow({ where: { email: 'assigned@test.local' } });
    assignedAccountId = assignedAccount.id;
    const assignedMembership = await prisma.workspaceMembership.findUniqueOrThrow({ where: { accountId_workspaceId: { accountId: assignedAccount.id, workspaceId: WORKSPACE_A } } });
    const foremanAccount = await prisma.account.findUniqueOrThrow({ where: { email: 'foreman@test.local' } });
    foremanAccountId = foremanAccount.id;
    const foremanMembership = await prisma.workspaceMembership.findUniqueOrThrow({ where: { accountId_workspaceId: { accountId: foremanAccount.id, workspaceId: WORKSPACE_A } } });
    const rabView = await prisma.permission.findUniqueOrThrow({ where: { code: 'RAB_VIEW' } });
    const requestProofRole = await prisma.role.upsert({
      where: { workspaceId_code: { workspaceId: WORKSPACE_A, code: 'BOQ_REQUEST_PROOF' } },
      update: {},
      create: { workspaceId: WORKSPACE_A, code: 'BOQ_REQUEST_PROOF', name: 'BOQ request proof' },
    });
    requestProofRoleId = requestProofRole.id;
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: requestProofRole.id, permissionId: rabView.id } },
      update: {},
      create: { roleId: requestProofRole.id, permissionId: rabView.id },
    });
    const existingRequestProofMembership = await prisma.membershipRole.findFirst({
      where: { workspaceMembershipId: foremanMembership.id, roleId: requestProofRole.id, isActive: true },
    });
    const requestProofMembership = existingRequestProofMembership ?? await prisma.membershipRole.create({
      data: { workspaceMembershipId: foremanMembership.id, roleId: requestProofRole.id, isActive: true },
    });
    requestProofMembershipRoleId = requestProofMembership.id;
    await prisma.projectAssignment.upsert({
      where: { workspaceMembershipId_projectId: { workspaceMembershipId: assignedMembership.id, projectId: PROJECT_A } },
      update: { status: 'ASSIGNED' }, create: { workspaceMembershipId: assignedMembership.id, projectId: PROJECT_A, roleInProject: 'PROJECT_MANAGER', isPrimaryAssignment: false, status: 'ASSIGNED' },
    });
    await prisma.projectAssignment.upsert({
      where: { workspaceMembershipId_projectId: { workspaceMembershipId: foremanMembership.id, projectId: PROJECT_A } },
      update: { status: 'ASSIGNED' }, create: { workspaceMembershipId: foremanMembership.id, projectId: PROJECT_A, roleInProject: 'FOREMAN', isPrimaryAssignment: false, status: 'ASSIGNED' },
    });

    await cleanupBoqBusinessUse([PROJECT_A, PROJECT_B, PROJECT_C]);
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
    await cleanupBoqBusinessUse([PROJECT_A, PROJECT_B, PROJECT_C]);
    await prisma.boqItem.deleteMany({ where: { boqStructureId: { in: [DRAFT_A, DRAFT_B, DUPLICATE_DRAFT] } } });
    await prisma.boqStructure.deleteMany({ where: { id: DUPLICATE_DRAFT } });
    await prisma.boqStructure.update({ where: { id: DRAFT_A }, data: { name: 'Working Draft', status: 'DRAFT' } });
  });

  afterAll(async () => {
    await cleanupBoqBusinessUse([PROJECT_A, PROJECT_B, PROJECT_C]);
    await cleanupBoqIntake([PROJECT_A, PROJECT_B, PROJECT_C]);
    await prisma.boqItem.deleteMany({ where: { boqStructureId: { in: [DRAFT_A, DRAFT_B, DUPLICATE_DRAFT] } } });
    await prisma.boqStructure.deleteMany({ where: { id: { in: [DRAFT_A, DRAFT_B, DUPLICATE_DRAFT] } } });
    await prisma.projectAssignment.deleteMany({ where: { projectId: PROJECT_A } });
    await prisma.project.deleteMany({ where: { id: { in: [PROJECT_A, PROJECT_B] } } });
    await prisma.membershipRole.deleteMany({ where: { id: requestProofMembershipRoleId } });
    await prisma.rolePermission.deleteMany({ where: { roleId: requestProofRoleId } });
    await prisma.role.deleteMany({ where: { id: requestProofRoleId } });
    await prisma.$disconnect(); await app.close();
  });

  const postFile = (path: string, token: string, workspace = WORKSPACE_A, upload = source, fileName = 'portable.xlsx') => request(app.getHttpServer()).post(path)
    .set('Authorization', `Bearer ${token}`).set('x-workspace-id', workspace)
    .attach('file', upload, { filename: fileName, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const preview = (token = assignedToken) => postFile(`/projects/${PROJECT_A}/boq/import/preview`, token).field('selectedSheet', 'RAB');

  const cleanupBoqBusinessUse = async (projectIds: string[]) => {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE boq_business_use_events DISABLE TRIGGER boq_business_use_events_immutable_trigger',
    );
    try {
      await prisma.boqBusinessUseEvent.deleteMany({
        where: { projectId: { in: projectIds } },
      });
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE boq_business_use_events ENABLE TRIGGER boq_business_use_events_immutable_trigger',
      );
    }
  };

  const cleanupBoqIntake = async (projectIds: string[]) => {
    const [requests, jobs] = await Promise.all([
      prisma.intakeRequest.findMany({ where: { projectId: { in: projectIds } }, select: { sourceDocumentId: true } }),
      prisma.intakeJob.findMany({ where: { projectId: { in: projectIds }, knowledgeType: 'BOQ' }, select: { sourceDocumentId: true } }),
    ]);
    const sourceIds = [...new Set([...requests, ...jobs].map((row) => row.sourceDocumentId))];
    await prisma.intakeRequest.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.intakeJob.deleteMany({ where: { projectId: { in: projectIds }, knowledgeType: 'BOQ' } });
    if (sourceIds.length > 0) {
      const removable = await prisma.sourceDocument.findMany({
        where: { id: { in: sourceIds }, intakeJobs: { none: {} }, intakeRequests: { none: {} } },
        select: { id: true, storageRef: true },
      });
      await prisma.sourceDocument.deleteMany({ where: { id: { in: removable.map((row) => row.id) } } });
      await Promise.all(removable.map((row) => storage.deleteFinal(row.storageRef)));
    }
  };

  it('converges concurrent authorized requests onto one canonical interpretation with zero BOQ write', async () => {
    await cleanupBoqIntake([PROJECT_A]);
    const concurrentSource = await buildPortableBoqXlsx({ scaleViolations: 1 });
    const digest = createHash('sha256').update(concurrentSource).digest('hex');
    expect(await prisma.sourceDocument.count({
      where: {
        workspaceId: WORKSPACE_A,
        byteSize: concurrentSource.length,
        checksum: { equals: digest, mode: 'insensitive' },
      },
    })).toBe(0);
    const [first, second] = await Promise.all([
      postFile(`/projects/${PROJECT_A}/boq/import/preview`, assignedToken, WORKSPACE_A, concurrentSource, 'concurrent.xlsx').field('selectedSheet', 'RAB'),
      postFile(`/projects/${PROJECT_A}/boq/import/preview`, foremanToken, WORKSPACE_A, concurrentSource, 'concurrent.xlsx').field('selectedSheet', 'RAB'),
    ]);
    expect([first.status, second.status]).toEqual([201, 201]);

    const requests = await prisma.intakeRequest.findMany({
      where: { projectId: PROJECT_A, presentedFileName: 'concurrent.xlsx' },
      orderBy: { createdAt: 'asc' },
    });
    const jobs = await prisma.intakeJob.findMany({
      where: {
        projectId: PROJECT_A,
        knowledgeType: 'BOQ',
        sourceDocument: { is: { checksum: { equals: digest, mode: 'insensitive' } } },
      },
    });
    expect(requests).toHaveLength(2);
    expect(new Set(requests.map((row) => row.requestingAccountId))).toEqual(new Set([assignedAccountId, foremanAccountId]));
    expect(new Set(requests.map((row) => row.sourceDocumentId)).size).toBe(1);
    expect(await prisma.sourceDocument.count({
      where: {
        workspaceId: WORKSPACE_A,
        byteSize: concurrentSource.length,
        checksum: { equals: digest, mode: 'insensitive' },
      },
    })).toBe(1);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].sourceDocumentId).toBe(requests[0].sourceDocumentId);
    expect(requests.every((row) => row.intakeJobId === jobs[0].id)).toBe(true);
    expect(await prisma.boqItem.count({ where: { boqStructureId: DRAFT_A } })).toBe(0);
  });

  it('accepts same-account replay and a different authorized account without duplicating interpretation truth', async () => {
    await preview(assignedToken).expect(201);
    await preview(assignedToken).expect(201);
    await preview(foremanToken).expect(201);

    const requests = await prisma.intakeRequest.findMany({
      where: { projectId: PROJECT_A, presentedFileName: 'portable.xlsx' },
      include: { sourceDocument: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(requests).toHaveLength(3);
    expect(requests.filter((row) => row.requestingAccountId === assignedAccountId)).toHaveLength(2);
    expect(requests.filter((row) => row.requestingAccountId === foremanAccountId)).toHaveLength(1);
    expect(new Set(requests.map((row) => row.sourceDocumentId)).size).toBe(1);
    expect(new Set(requests.map((row) => row.intakeJobId)).size).toBe(1);
    expect(requests[0].sourceDocument.uploadedByAccountId).toBe(assignedAccountId);
    const foremanRequest = requests.find((row) => row.requestingAccountId === foremanAccountId);
    expect(foremanRequest?.sourceDocument.uploadedByAccountId).toBe(assignedAccountId);
    expect(await prisma.intakeJob.count({
      where: { projectId: PROJECT_A, knowledgeType: 'BOQ', selectedSheet: 'RAB', sourceDocumentId: requests[0].sourceDocumentId },
    })).toBe(1);
    expect(await prisma.boqItem.count({ where: { boqStructureId: DRAFT_A } })).toBe(0);
  });

  it('previews without writes and reports the honest row-type breakdown', async () => {
    const historicalItem = await prisma.boqItem.create({ data: {
      boqStructureId: DRAFT_A, wbsCode: 'HIST-1', name: 'Historical un-attributed row',
      itemType: 'WORK_ITEM', quantity: '1', unit: 'm2', sortOrder: 0,
    } });
    const response = await preview().expect(201);
    expect(response.body).toMatchObject({ acceptedRows: 4, folderRows: 2, workItemRows: 2, noteRows: 0, rejectedRows: 0, canApprove: true });
    expect(response.body.intakeRequestId).toEqual(expect.any(String));
    expect(response.body.draftImpact).toEqual({ existingItemCount: 1, previouslyAppliedToThisDraft: false });
    const intakeRequest = await prisma.intakeRequest.findUniqueOrThrow({
      where: { id: response.body.intakeRequestId },
      include: { intakeJob: true, sourceDocument: true },
    });
    expect(intakeRequest).toMatchObject({
      projectId: PROJECT_A,
      workspaceId: WORKSPACE_A,
      requestingAccountId: assignedAccountId,
      requestedKnowledgeType: 'BOQ',
    });
    expect(intakeRequest.intakeJob).toMatchObject({
      projectId: PROJECT_A,
      workspaceId: WORKSPACE_A,
      knowledgeType: 'BOQ',
      selectedSheet: 'RAB',
    });
    expect(intakeRequest.sourceDocument.checksum.toUpperCase()).toBe(response.body.sourceSha256);
    expect(await prisma.boqItem.findUnique({ where: { id: historicalItem.id } })).not.toBeNull();
    expect(await prisma.boqBusinessUseEvent.count({ where: { projectId: PROJECT_A } })).toBe(0);
  });

  it('enforces account, tenant, workspace, project, and FOREMAN boundaries', async () => {
    await postFile(`/projects/${PROJECT_A}/boq/import/approve`, foremanToken).field('selectedSheet', 'RAB').field('importFingerprint', 'x').expect(403);
    await preview(nonassignedToken).expect(403); await preview(crosstenantToken).expect(404);
    await postFile(`/projects/${PROJECT_A}/boq/import/preview`, assignedToken, WORKSPACE_B).field('selectedSheet', 'RAB').expect(403);
    await postFile('/projects/10000000-0000-4000-8000-000000000099/boq/import/preview', assignedToken).field('selectedSheet', 'RAB').expect(404);
  });

  it('binds approve to the trusted actor own IntakeRequest', async () => {
    const foremanPreview = await preview(foremanToken).expect(201);
    const response = await postFile(`/projects/${PROJECT_A}/boq/import/approve`, assignedToken)
      .field('selectedSheet', 'RAB')
      .field('intakeRequestId', foremanPreview.body.intakeRequestId)
      .field('importFingerprint', foremanPreview.body.importFingerprint)
      .expect(404);
    expect(response.body.message).toBe('BOQ_INTAKE_REQUEST_NOT_FOUND');
    expect(await prisma.boqItem.count({ where: { boqStructureId: DRAFT_A } })).toBe(0);
    expect(await prisma.boqBusinessUseEvent.count({ where: { projectId: PROJECT_A } })).toBe(0);
  });

  it('fails closed when the request canonical interpretation version no longer matches the approved file', async () => {
    const p = await preview().expect(201);
    const requestRow = await prisma.intakeRequest.findUniqueOrThrow({
      where: { id: p.body.intakeRequestId },
    });
    const intakeJobId = requestRow.intakeJobId!;
    const original = await prisma.intakeJob.findUniqueOrThrow({ where: { id: intakeJobId } });
    await prisma.intakeJob.update({
      where: { id: intakeJobId },
      data: { semanticContractVersion: 'TAMPERED_VERSION' },
    });
    try {
      const response = await postFile(`/projects/${PROJECT_A}/boq/import/approve`, assignedToken)
        .field('selectedSheet', 'RAB')
        .field('intakeRequestId', p.body.intakeRequestId)
        .field('importFingerprint', p.body.importFingerprint)
        .expect(409);
      expect(response.body.message).toBe('BOQ_INTAKE_PROVENANCE_MISMATCH');
      expect(await prisma.boqItem.count({ where: { boqStructureId: DRAFT_A } })).toBe(0);
      expect(await prisma.boqBusinessUseEvent.count({ where: { projectId: PROJECT_A } })).toBe(0);
    } finally {
      await prisma.intakeJob.update({
        where: { id: intakeJobId },
        data: { semanticContractVersion: original.semanticContractVersion },
      });
    }
  });

  it('imports only Project A and leaves same-workspace Project B untouched', async () => {
    const p = await preview().expect(201);
    expect(p.body.draftImpact).toEqual({ existingItemCount: 0, previouslyAppliedToThisDraft: false });
    const response = await postFile(`/projects/${PROJECT_A}/boq/import/approve`, assignedToken)
      .field('selectedSheet', 'RAB')
      .field('intakeRequestId', p.body.intakeRequestId)
      .field('importFingerprint', p.body.importFingerprint)
      .field('approvedByAccountId', foremanAccountId)
      .expect(201);
    expect(response.body).toMatchObject({
      structureId: DRAFT_A,
      importedRows: 4,
      businessUseEvent: {
        workspaceId: WORKSPACE_A,
        projectId: PROJECT_A,
        boqStructureId: DRAFT_A,
        intakeRequestId: p.body.intakeRequestId,
        approvedByAccountId: assignedAccountId,
        importFingerprint: p.body.importFingerprint,
        previousUseEventId: null,
        appliedItemCount: 4,
        replacedItemCount: 0,
      },
    });
    const items = await prisma.boqItem.findMany({ where: { boqStructureId: DRAFT_A } });
    expect(items).toHaveLength(4);
    expect(items.filter((item) => item.itemType !== 'WORK_ITEM').every((item) => item.quantity.toString() === '0' && item.unit === '')).toBe(true);
    expect(items.every((item) => item.unitPrice === null && item.lineTotal === null)).toBe(true);
    expect(await prisma.boqItem.count({ where: { boqStructureId: DRAFT_B } })).toBe(0);

    const replayPreview = await preview().expect(201);
    expect(replayPreview.body.draftImpact).toEqual({ existingItemCount: 4, previouslyAppliedToThisDraft: true });
    expect(await prisma.boqBusinessUseEvent.count({ where: { projectId: PROJECT_A } })).toBe(1);

    const readbackClient = new PrismaClient();
    try {
      const durable = await readbackClient.boqBusinessUseEvent.findUniqueOrThrow({
        where: { id: response.body.businessUseEvent.id },
      });
      expect(durable.intakeRequestId).toBe(p.body.intakeRequestId);
      expect(durable.appliedItemCount).toBe(4);
    } finally {
      await readbackClient.$disconnect();
    }
  });

  it('returns 404 for zero matching Working Draft', async () => {
    const p = await preview().expect(201); await prisma.boqStructure.update({ where: { id: DRAFT_A }, data: { name: 'Not Working Draft' } });
    const response = await postFile(`/projects/${PROJECT_A}/boq/import/approve`, assignedToken).field('selectedSheet', 'RAB').field('intakeRequestId', p.body.intakeRequestId).field('importFingerprint', p.body.importFingerprint).expect(404);
    expect(response.body.message).toBe('WORKING_DRAFT_NOT_FOUND');
  });

  it('returns 409 rather than choosing duplicate Working Drafts', async () => {
    const p = await preview().expect(201);
    await prisma.boqStructure.create({ data: { id: DUPLICATE_DRAFT, projectId: PROJECT_A, name: 'Working Draft', status: 'DRAFT', version: 2 } });
    const response = await postFile(`/projects/${PROJECT_A}/boq/import/approve`, assignedToken).field('selectedSheet', 'RAB').field('intakeRequestId', p.body.intakeRequestId).field('importFingerprint', p.body.importFingerprint).expect(409);
    expect(response.body.message).toBe('MULTIPLE_WORKING_DRAFTS');
  });

  it('rejects fingerprint mismatch and malformed/non-XLSX input', async () => {
    const p = await preview().expect(201);
    const missingRequest = await postFile(`/projects/${PROJECT_A}/boq/import/approve`, assignedToken)
      .field('selectedSheet', 'RAB')
      .field('importFingerprint', p.body.importFingerprint)
      .expect(400);
    expect(missingRequest.body.message).toBe('INTAKE_REQUEST_ID_REQUIRED');
    await postFile(`/projects/${PROJECT_A}/boq/import/approve`, assignedToken).field('selectedSheet', 'RAB').field('intakeRequestId', p.body.intakeRequestId).field('importFingerprint', 'BAD').expect(409);
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
      { boqStructureId: DRAFT_A, wbsCode: 'OLD-2', name: 'Old work item', itemType: 'WORK_ITEM', quantity: '5', unit: 'm2', unitPrice: '10000', lineTotal: '50000', priceOrigin: 'MANUAL_CLIENT', sortOrder: 1 },
    ] });
    expect(await prisma.boqItem.count({ where: { boqStructureId: DRAFT_A } })).toBe(2);

    const p = await preview().expect(201);
    const response = await postFile(`/projects/${PROJECT_A}/boq/import/approve`, assignedToken).field('selectedSheet', 'RAB').field('intakeRequestId', p.body.intakeRequestId).field('importFingerprint', p.body.importFingerprint).expect(201);

    expect(response.body).toMatchObject({
      structureId: DRAFT_A, workingDraftId: DRAFT_A,
      importedRows: 4, importedItemCount: 4,
      replacedExistingItemCount: 2, state: 'DRAFT',
      importFingerprint: p.body.importFingerprint,
      businessUseEvent: {
        intakeRequestId: p.body.intakeRequestId,
        previousUseEventId: null,
        appliedItemCount: 4,
        replacedItemCount: 2,
      },
    });

    const items = await prisma.boqItem.findMany({ where: { boqStructureId: DRAFT_A } });
    expect(items).toHaveLength(4);
    expect(items.some((item) => item.wbsCode === 'OLD-1' || item.wbsCode === 'OLD-2')).toBe(false);
    expect(items.every((item) => item.unitPrice === null && item.lineTotal === null)).toBe(true);
    expect(await prisma.boqItem.count({ where: { boqStructureId: DRAFT_B } })).toBe(0);
    expect((await prisma.boqStructure.findUniqueOrThrow({ where: { id: DRAFT_A } })).status).toBe('DRAFT');
  });

  it('records a different BOQ replacement as a new event linked to the prior use', async () => {
    const firstPreview = await preview().expect(201);
    const firstApprove = await postFile(`/projects/${PROJECT_A}/boq/import/approve`, assignedToken)
      .field('selectedSheet', 'RAB')
      .field('intakeRequestId', firstPreview.body.intakeRequestId)
      .field('importFingerprint', firstPreview.body.importFingerprint)
      .expect(201);

    const replacement = await buildPortableBoqXlsx({ secondQuantity: '13' });
    const secondPreview = await postFile(
      `/projects/${PROJECT_A}/boq/import/preview`,
      assignedToken,
      WORKSPACE_A,
      replacement,
      'replacement.xlsx',
    ).field('selectedSheet', 'RAB').expect(201);
    const secondApprove = await postFile(
      `/projects/${PROJECT_A}/boq/import/approve`,
      assignedToken,
      WORKSPACE_A,
      replacement,
      'replacement.xlsx',
    )
      .field('selectedSheet', 'RAB')
      .field('intakeRequestId', secondPreview.body.intakeRequestId)
      .field('importFingerprint', secondPreview.body.importFingerprint)
      .expect(201);

    expect(secondPreview.body.importFingerprint).not.toBe(firstPreview.body.importFingerprint);
    expect(secondPreview.body.draftImpact).toEqual({ existingItemCount: 4, previouslyAppliedToThisDraft: false });
    expect(secondApprove.body.businessUseEvent).toMatchObject({
      previousUseEventId: firstApprove.body.businessUseEvent.id,
      intakeRequestId: secondPreview.body.intakeRequestId,
      appliedItemCount: 4,
      replacedItemCount: 4,
    });
    const history = await prisma.boqBusinessUseEvent.findMany({
      where: { boqStructureId: DRAFT_A },
    });
    expect(history).toHaveLength(2);
    const replacedWorkItem = await prisma.boqItem.findFirstOrThrow({
      where: { boqStructureId: DRAFT_A, wbsCode: '2' },
    });
    expect(replacedWorkItem.quantity.toString()).toBe('13');

    await expect(prisma.boqBusinessUseEvent.update({
      where: { id: firstApprove.body.businessUseEvent.id },
      data: { appliedItemCount: 99 },
    })).rejects.toThrow(/BOQ_BUSINESS_USE_APPEND_ONLY/);
    await expect(prisma.boqBusinessUseEvent.delete({
      where: { id: firstApprove.body.businessUseEvent.id },
    })).rejects.toThrow(/BOQ_BUSINESS_USE_APPEND_ONLY/);
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

  it('rolls back Working Draft replacement when business-use evidence cannot be written', async () => {
    await prisma.boqItem.create({ data: {
      boqStructureId: DRAFT_A, wbsCode: 'OLD-ATOMIC', name: 'Atomic old row',
      itemType: 'WORK_ITEM', quantity: '2', unit: 'm2', sortOrder: 0,
    } });
    const p = await preview().expect(201);
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION reject_test_boq_business_use_insert() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'TEST_BOQ_BUSINESS_USE_WRITE_FAILURE';
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS test_boq_business_use_insert_trigger ON boq_business_use_events',
    );
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_boq_business_use_insert_trigger
      BEFORE INSERT ON boq_business_use_events
      FOR EACH ROW EXECUTE FUNCTION reject_test_boq_business_use_insert()
    `);
    try {
      await postFile(`/projects/${PROJECT_A}/boq/import/approve`, assignedToken)
        .field('selectedSheet', 'RAB')
        .field('intakeRequestId', p.body.intakeRequestId)
        .field('importFingerprint', p.body.importFingerprint)
        .expect(500);
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS test_boq_business_use_insert_trigger ON boq_business_use_events',
      );
      await prisma.$executeRawUnsafe(
        'DROP FUNCTION IF EXISTS reject_test_boq_business_use_insert()',
      );
    }

    const items = await prisma.boqItem.findMany({ where: { boqStructureId: DRAFT_A } });
    expect(items).toHaveLength(1);
    expect(items[0].wbsCode).toBe('OLD-ATOMIC');
    expect(await prisma.boqBusinessUseEvent.count({ where: { projectId: PROJECT_A } })).toBe(0);
  });

  it('fails closed and mutates nothing when an approved RAB already exists (RM-001 lifecycle guard)', async () => {
    const p = await preview().expect(201);
    const rab = await prisma.rabDocument.create({ data: {
      projectId: PROJECT_A, boqStructureId: DRAFT_A, version: 1, name: 'Approved RAB',
      totalBaseCost: '0', totalFinalCost: '0', status: 'APPROVED',
    } });
    try {
      const before = await prisma.boqItem.count({ where: { boqStructureId: DRAFT_A } });
      const response = await postFile(`/projects/${PROJECT_A}/boq/import/approve`, assignedToken).field('selectedSheet', 'RAB').field('intakeRequestId', p.body.intakeRequestId).field('importFingerprint', p.body.importFingerprint).expect(409);
      expect(response.body.message).toBe('APPROVED_RAB_EXISTS');
      expect(await prisma.boqItem.count({ where: { boqStructureId: DRAFT_A } })).toBe(before);
      expect(await prisma.boqBusinessUseEvent.count({ where: { projectId: PROJECT_A } })).toBe(0);
    } finally {
      await prisma.rabDocument.delete({ where: { id: rab.id } });
    }
  });

  // The importFingerprint is sha256(projectId | workspaceId | sourceSha256 |
  // sheetName | parserVersion). Replaying Project A's preview fingerprint
  // against Project B's approve call must fail on that binding alone, before
  // any Working Draft lookup — proving cross-project (and, by the identical
  // mechanism, cross-workspace) preview reuse is structurally impossible.
  it('allows same-account use on an independent project but rejects Project A identity on Project B', async () => {
    // Grant the same user access to Project B too, so ProjectAccessGuard lets
    // the request through and this test isolates the fingerprint binding
    // specifically, rather than being satisfied by the (also correct, but
    // different) project-assignment boundary catching it first.
    const assignedAccount = await prisma.account.findUniqueOrThrow({ where: { email: 'assigned@test.local' } });
    const assignedMembership = await prisma.workspaceMembership.findUniqueOrThrow({ where: { accountId_workspaceId: { accountId: assignedAccount.id, workspaceId: WORKSPACE_A } } });
    const grant = await prisma.projectAssignment.create({ data: { workspaceMembershipId: assignedMembership.id, projectId: PROJECT_B, roleInProject: 'PROJECT_MANAGER', isPrimaryAssignment: false, status: 'ASSIGNED' } });
    try {
      const p = await preview().expect(201);
      await postFile(`/projects/${PROJECT_A}/boq/import/approve`, assignedToken)
        .field('selectedSheet', 'RAB')
        .field('intakeRequestId', p.body.intakeRequestId)
        .field('importFingerprint', p.body.importFingerprint)
        .expect(201);
      const projectBPreview = await postFile(`/projects/${PROJECT_B}/boq/import/preview`, assignedToken)
        .field('selectedSheet', 'RAB')
        .expect(201);
      expect(projectBPreview.body.draftImpact).toEqual({ existingItemCount: 0, previouslyAppliedToThisDraft: false });
      await postFile(`/projects/${PROJECT_B}/boq/import/approve`, assignedToken)
        .field('selectedSheet', 'RAB')
        .field('intakeRequestId', projectBPreview.body.intakeRequestId)
        .field('importFingerprint', projectBPreview.body.importFingerprint)
        .expect(201);
      const independentUses = await prisma.boqBusinessUseEvent.findMany({
        where: { projectId: { in: [PROJECT_A, PROJECT_B] } },
        orderBy: { projectId: 'asc' },
      });
      expect(independentUses).toHaveLength(2);
      expect(independentUses.every((event) => event.previousUseEventId === null)).toBe(true);
      expect(new Set(independentUses.map((event) => event.projectId))).toEqual(new Set([PROJECT_A, PROJECT_B]));

      const beforeA = await prisma.boqItem.count({ where: { boqStructureId: DRAFT_A } });
      const beforeB = await prisma.boqItem.count({ where: { boqStructureId: DRAFT_B } });
      const response = await postFile(`/projects/${PROJECT_B}/boq/import/approve`, assignedToken).field('selectedSheet', 'RAB').field('intakeRequestId', p.body.intakeRequestId).field('importFingerprint', p.body.importFingerprint).expect(409);
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
      const workspaceAJobIds = (await prisma.intakeJob.findMany({
        where: { projectId: PROJECT_A, knowledgeType: 'BOQ' },
        select: { id: true },
      })).map((row) => row.id);
      const tenantPreview = await postFile(`/projects/${PROJECT_C}/boq/import/preview`, crosstenantToken, WORKSPACE_B)
        .field('selectedSheet', 'RAB')
        .expect(201);
      const tenantRequest = await prisma.intakeRequest.findFirstOrThrow({
        where: { projectId: PROJECT_C, workspaceId: WORKSPACE_B },
        include: { intakeJob: true, sourceDocument: true },
      });
      expect(tenantRequest.intakeJob).not.toBeNull();
      expect(tenantRequest.sourceDocument.workspaceId).toBe(WORKSPACE_B);
      expect(workspaceAJobIds).not.toContain(tenantRequest.intakeJobId);
      await postFile(`/projects/${PROJECT_C}/boq/import/approve`, crosstenantToken, WORKSPACE_B)
        .field('selectedSheet', 'RAB')
        .field('intakeRequestId', tenantPreview.body.intakeRequestId)
        .field('importFingerprint', tenantPreview.body.importFingerprint)
        .expect(201);
      const tenantUse = await prisma.boqBusinessUseEvent.findFirstOrThrow({
        where: { projectId: PROJECT_C },
      });
      expect(tenantUse).toMatchObject({
        workspaceId: WORKSPACE_B,
        projectId: PROJECT_C,
        approvedByAccountId: crosstenantAccount.id,
        previousUseEventId: null,
      });

      const p = await preview().expect(201);
      const crossTenantRequest = await postFile(`/projects/${PROJECT_A}/boq/import/approve`, assignedToken)
        .field('selectedSheet', 'RAB')
        .field('intakeRequestId', tenantPreview.body.intakeRequestId)
        .field('importFingerprint', p.body.importFingerprint)
        .expect(404);
      expect(crossTenantRequest.body.message).toBe('BOQ_INTAKE_REQUEST_NOT_FOUND');
      const beforeA = await prisma.boqItem.count({ where: { boqStructureId: DRAFT_A } });
      const beforeC = await prisma.boqItem.count({ where: { boqStructureId: DRAFT_C } });
      const response = await postFile(`/projects/${PROJECT_C}/boq/import/approve`, crosstenantToken, WORKSPACE_B).field('selectedSheet', 'RAB').field('intakeRequestId', p.body.intakeRequestId).field('importFingerprint', p.body.importFingerprint).expect(409);
      expect(response.body.message).toBe('IMPORT_FINGERPRINT_MISMATCH');
      expect(await prisma.boqItem.count({ where: { boqStructureId: DRAFT_A } })).toBe(beforeA);
      expect(await prisma.boqItem.count({ where: { boqStructureId: DRAFT_C } })).toBe(beforeC);
      expect((await prisma.boqStructure.findUniqueOrThrow({ where: { id: DRAFT_A } })).status).toBe('DRAFT');
      expect((await prisma.boqStructure.findUniqueOrThrow({ where: { id: DRAFT_C } })).status).toBe('DRAFT');
    } finally {
      await cleanupBoqBusinessUse([PROJECT_C]);
      await cleanupBoqIntake([PROJECT_C]);
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
      postFile(`/projects/${PROJECT_A}/boq/import/approve`, assignedToken).field('selectedSheet', 'RAB').field('intakeRequestId', p.body.intakeRequestId).field('importFingerprint', p.body.importFingerprint),
      postFile(`/projects/${PROJECT_A}/boq/import/approve`, assignedToken).field('selectedSheet', 'RAB').field('intakeRequestId', p.body.intakeRequestId).field('importFingerprint', p.body.importFingerprint),
    ]);
    expect([first.status, second.status]).toEqual([201, 201]);
    const items = await prisma.boqItem.findMany({ where: { boqStructureId: DRAFT_A } });
    expect(items).toHaveLength(4);
    expect(new Set(items.map((item) => item.id)).size).toBe(4);
    const uses = await prisma.boqBusinessUseEvent.findMany({
      where: { boqStructureId: DRAFT_A },
    });
    expect(uses).toHaveLength(2);
    const root = uses.find((event) => event.previousUseEventId === null);
    expect(root).toBeDefined();
    expect(uses.find((event) => event.previousUseEventId === root!.id)).toBeDefined();
    expect(uses.map((event) => event.replacedItemCount).sort((a, b) => a - b)).toEqual([0, 4]);
    expect(new Set(uses.map((event) => event.intakeRequestId))).toEqual(new Set([p.body.intakeRequestId]));
  });
});
