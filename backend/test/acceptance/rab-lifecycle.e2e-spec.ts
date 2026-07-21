import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../src/app.module';
import { buildPortableBoqXlsx } from '../fixtures/boq-xlsx.fixture';

const PASSWORD = 'Test1234!';
const SALT_ROUNDS = 10;
const ACC_X_CODE = 'ACC-X';

const PROJECT_ZERO = '36000000-0000-4000-8000-000000000001';
const PROJECT_ACTIVE_BASELINE = '36000000-0000-4000-8000-000000000002';
const PROJECT_APPROVED_RAB = '36000000-0000-4000-8000-000000000003';
const PROJECT_DUPLICATE = '36000000-0000-4000-8000-000000000004';
const PROJECT_LAWFUL_IMPORT = '36000000-0000-4000-8000-000000000005';
const DRAFT_LAWFUL_IMPORT = '36000000-0000-4000-8000-000000000006';
const STRUCTURE_BASELINE_A = '36000000-0000-4000-8000-000000000007';
const STRUCTURE_BASELINE_B = '36000000-0000-4000-8000-000000000008';
const STRUCTURE_DUPLICATE_1 = '36000000-0000-4000-8000-000000000009';
const STRUCTURE_DUPLICATE_2 = '36000000-0000-4000-8000-00000000000a';
const RAB_ACTIVE_BASELINE = '36000000-0000-4000-8000-00000000000b';
const RAB_APPROVED_ONLY = '36000000-0000-4000-8000-00000000000c';
const BASELINE_ACTIVE_ID = '36000000-0000-4000-8000-00000000000d';

// TOCTOU approve fixtures: each starts unblocked with one empty Working
// Draft, gets a valid preview fingerprint, then is mutated into a blocked
// state before approve() is called with that still-matching fingerprint.
const PROJECT_TOCTOU_BASELINE = '36000000-0000-4000-8000-00000000000e';
const PROJECT_TOCTOU_APPROVED = '36000000-0000-4000-8000-00000000000f';
const PROJECT_TOCTOU_DUPLICATE = '36000000-0000-4000-8000-000000000010';
const DRAFT_TOCTOU_BASELINE = '36000000-0000-4000-8000-000000000011';
const DRAFT_TOCTOU_APPROVED = '36000000-0000-4000-8000-000000000012';
const DRAFT_TOCTOU_DUPLICATE = '36000000-0000-4000-8000-000000000013';

const CREATE_ONLY_EMAIL = 'create.only.lifecycle@test.local';
const CREATE_ONLY_ROLE_CODE = 'ROLE_LIFECYCLE_CREATE_ONLY';

describe('PR-35 canonical RAB lifecycle (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let assignedToken: string;
  let foremanToken: string;
  let createOnlyToken: string;
  let nonassignedToken: string;
  let source: Buffer;
  let workspaceAId: string;
  let orgAId: string;
  let assignedMembershipId: string;
  let accXProjectId: string;

  const login = async (email: string) => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(201);
    return response.body.access_token;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = new PrismaClient();
    source = await buildPortableBoqXlsx();

    const accX = await prisma.project.findFirstOrThrow({
      where: { code: ACC_X_CODE },
      select: {
        id: true,
        workspaceId: true,
        organizationId: true,
        status: true,
      },
    });
    workspaceAId = accX.workspaceId;
    orgAId = accX.organizationId;
    accXProjectId = accX.id;
    // Canonical law addendum: ACC-X (status ACTIVE, zero baseline/approved/draft
    // on this branch) is exactly the PROJECT_NOT_DRAFT case — Project.status is
    // an eligibility gate now, not ignored. This resolves the earlier-reported
    // gap: ACC-X is used directly below as the PROJECT_NOT_DRAFT fixture.
    if (accX.status !== 'ACTIVE') {
      throw new Error(
        `Expected ACC-X seed status ACTIVE, found ${accX.status} — PROJECT_NOT_DRAFT fixture assumption no longer holds`,
      );
    }

    const assignedAccount = await prisma.account.findUniqueOrThrow({
      where: { email: 'assigned@test.local' },
    });
    const assignedMembership =
      await prisma.workspaceMembership.findUniqueOrThrow({
        where: {
          accountId_workspaceId: {
            accountId: assignedAccount.id,
            workspaceId: workspaceAId,
          },
        },
      });
    assignedMembershipId = assignedMembership.id;

    // --- Ad-hoc lifecycle fixture projects, self-contained per the existing
    // boq-import / project-security e2e convention. ACC-X itself is left
    // untouched: on this branch it carries zero baseline/approved-RAB/draft
    // state, so it is lawfully a zero-draft editable project, not a blocked
    // one — see PR body / UTANG-LIFECYCLE-06 for the documented gap against
    // the original task's "ACC-X negative fixture" assumption.
    await prisma.project.createMany({
      data: [
        {
          id: PROJECT_ZERO,
          workspaceId: workspaceAId,
          organizationId: orgAId,
          code: 'LC-ZERO',
          name: 'Lifecycle Zero Draft',
        },
        {
          id: PROJECT_ACTIVE_BASELINE,
          workspaceId: workspaceAId,
          organizationId: orgAId,
          code: 'LC-BASELINE',
          name: 'Lifecycle Active Baseline',
        },
        {
          id: PROJECT_APPROVED_RAB,
          workspaceId: workspaceAId,
          organizationId: orgAId,
          code: 'LC-APPROVED',
          name: 'Lifecycle Approved RAB',
        },
        {
          id: PROJECT_DUPLICATE,
          workspaceId: workspaceAId,
          organizationId: orgAId,
          code: 'LC-DUPLICATE',
          name: 'Lifecycle Duplicate Draft',
        },
        {
          id: PROJECT_LAWFUL_IMPORT,
          workspaceId: workspaceAId,
          organizationId: orgAId,
          code: 'LC-LAWFUL',
          name: 'Lifecycle Lawful Import',
        },
        {
          id: PROJECT_TOCTOU_BASELINE,
          workspaceId: workspaceAId,
          organizationId: orgAId,
          code: 'LC-TOCTOU-BASELINE',
          name: 'Lifecycle TOCTOU Baseline',
        },
        {
          id: PROJECT_TOCTOU_APPROVED,
          workspaceId: workspaceAId,
          organizationId: orgAId,
          code: 'LC-TOCTOU-APPROVED',
          name: 'Lifecycle TOCTOU Approved',
        },
        {
          id: PROJECT_TOCTOU_DUPLICATE,
          workspaceId: workspaceAId,
          organizationId: orgAId,
          code: 'LC-TOCTOU-DUPLICATE',
          name: 'Lifecycle TOCTOU Duplicate',
        },
      ],
    });

    await prisma.projectAssignment.createMany({
      data: [
        PROJECT_ZERO,
        PROJECT_ACTIVE_BASELINE,
        PROJECT_APPROVED_RAB,
        PROJECT_DUPLICATE,
        PROJECT_LAWFUL_IMPORT,
        PROJECT_TOCTOU_BASELINE,
        PROJECT_TOCTOU_APPROVED,
        PROJECT_TOCTOU_DUPLICATE,
      ].map((projectId) => ({
        workspaceMembershipId: assignedMembershipId,
        projectId,
        roleInProject: 'PROJECT_MANAGER',
        status: 'ASSIGNED' as const,
      })),
    });

    // PROJECT_ACTIVE_BASELINE: a RAB document that became an ACTIVE baseline —
    // mirrors what ProjectService.initiateSetup produces.
    await prisma.boqStructure.create({
      data: {
        id: STRUCTURE_BASELINE_A,
        projectId: PROJECT_ACTIVE_BASELINE,
        name: 'Baseline BOQ',
        version: 1,
        status: 'LOCKED',
      },
    });
    await prisma.rabDocument.create({
      data: {
        id: RAB_ACTIVE_BASELINE,
        projectId: PROJECT_ACTIVE_BASELINE,
        boqStructureId: STRUCTURE_BASELINE_A,
        name: 'Baseline RAB',
        version: 1,
        totalBaseCost: 0,
        totalFinalCost: 0,
        status: 'APPROVED',
      },
    });
    await prisma.projectBaseline.create({
      data: {
        id: BASELINE_ACTIVE_ID,
        projectId: PROJECT_ACTIVE_BASELINE,
        rabDocumentId: RAB_ACTIVE_BASELINE,
        versionNumber: 1,
        status: 'ACTIVE',
        approvedAt: new Date(),
      },
    });

    // PROJECT_APPROVED_RAB: an approved RAB document with no baseline at all
    // — an isolated edge state, proving APPROVED_RAB_EXISTS blocks on its own.
    await prisma.boqStructure.create({
      data: {
        id: STRUCTURE_BASELINE_B,
        projectId: PROJECT_APPROVED_RAB,
        name: 'Approved BOQ',
        version: 1,
        status: 'LOCKED',
      },
    });
    await prisma.rabDocument.create({
      data: {
        id: RAB_APPROVED_ONLY,
        projectId: PROJECT_APPROVED_RAB,
        boqStructureId: STRUCTURE_BASELINE_B,
        name: 'Approved RAB',
        version: 1,
        totalBaseCost: 0,
        totalFinalCost: 0,
        status: 'APPROVED',
      },
    });

    // PROJECT_DUPLICATE: two Working Drafts — ambiguous authority.
    await prisma.boqStructure.createMany({
      data: [
        {
          id: STRUCTURE_DUPLICATE_1,
          projectId: PROJECT_DUPLICATE,
          name: 'Working Draft',
          version: 1,
          status: 'DRAFT',
        },
        {
          id: STRUCTURE_DUPLICATE_2,
          projectId: PROJECT_DUPLICATE,
          name: 'Working Draft',
          version: 2,
          status: 'DRAFT',
        },
      ],
    });

    // PROJECT_LAWFUL_IMPORT: exactly one empty Working Draft — the positive path.
    await prisma.boqStructure.create({
      data: {
        id: DRAFT_LAWFUL_IMPORT,
        projectId: PROJECT_LAWFUL_IMPORT,
        name: 'Working Draft',
        version: 1,
        status: 'DRAFT',
      },
    });

    // TOCTOU approve fixtures start unblocked with one empty Working Draft each.
    await prisma.boqStructure.createMany({
      data: [
        {
          id: DRAFT_TOCTOU_BASELINE,
          projectId: PROJECT_TOCTOU_BASELINE,
          name: 'Working Draft',
          version: 1,
          status: 'DRAFT',
        },
        {
          id: DRAFT_TOCTOU_APPROVED,
          projectId: PROJECT_TOCTOU_APPROVED,
          name: 'Working Draft',
          version: 1,
          status: 'DRAFT',
        },
        {
          id: DRAFT_TOCTOU_DUPLICATE,
          projectId: PROJECT_TOCTOU_DUPLICATE,
          name: 'Working Draft',
          version: 1,
          status: 'DRAFT',
        },
      ],
    });

    // Account with PROJECT_CREATE but explicitly no RAB_DRAFT_EDIT.
    const permCreate = await prisma.permission.findUniqueOrThrow({
      where: { code: 'PROJECT_CREATE' },
    });
    const roleCreateOnly = await prisma.role.create({
      data: {
        name: 'Lifecycle Create Only',
        code: CREATE_ONLY_ROLE_CODE,
        workspace: { connect: { id: workspaceAId } },
        rolePermissions: { create: [{ permissionId: permCreate.id }] },
      },
    });
    const passwordHash = await bcrypt.hash(PASSWORD, SALT_ROUNDS);
    const createOnlyAccount = await prisma.account.create({
      data: {
        email: CREATE_ONLY_EMAIL,
        passwordHash,
        displayName: 'Create Only Actor',
        status: 'ACTIVE',
      },
    });
    const createOnlyMembership = await prisma.workspaceMembership.create({
      data: {
        accountId: createOnlyAccount.id,
        workspaceId: workspaceAId,
        status: 'ACTIVE',
        membershipRoles: { create: [{ roleId: roleCreateOnly.id }] },
      },
    });
    await prisma.user.create({
      data: {
        workspaceMembershipId: createOnlyMembership.id,
        workspaceId: workspaceAId,
        fullName: 'Create Only Actor',
        status: 'ACTIVE',
      },
    });

    assignedToken = await login('assigned@test.local');
    foremanToken = await login('foreman@test.local');
    createOnlyToken = await login(CREATE_ONLY_EMAIL);
    nonassignedToken = await login('nonassigned@test.local');
  });

  beforeEach(async () => {
    await prisma.boqItem.deleteMany({
      where: { boqStructureId: DRAFT_LAWFUL_IMPORT },
    });
  });

  afterAll(async () => {
    const createdProjectIds = [
      PROJECT_ZERO,
      PROJECT_ACTIVE_BASELINE,
      PROJECT_APPROVED_RAB,
      PROJECT_DUPLICATE,
      PROJECT_LAWFUL_IMPORT,
      PROJECT_TOCTOU_BASELINE,
      PROJECT_TOCTOU_APPROVED,
      PROJECT_TOCTOU_DUPLICATE,
    ];
    await prisma.boqItem.deleteMany({
      where: { boqStructure: { projectId: { in: createdProjectIds } } },
    });
    await prisma.projectBaseline.deleteMany({
      where: { projectId: { in: createdProjectIds } },
    });
    await prisma.rabDocument.deleteMany({
      where: { projectId: { in: createdProjectIds } },
    });
    await prisma.boqStructure.deleteMany({
      where: { projectId: { in: createdProjectIds } },
    });
    await prisma.projectAssignment.deleteMany({
      where: { projectId: { in: createdProjectIds } },
    });

    const createOnlyAccount = await prisma.account.findUnique({
      where: { email: CREATE_ONLY_EMAIL },
    });
    if (createOnlyAccount) {
      const memberships = await prisma.workspaceMembership.findMany({
        where: { accountId: createOnlyAccount.id },
      });
      const membershipIds = memberships.map((m) => m.id);
      const createdByCreateOnly = await prisma.projectAssignment.findMany({
        where: { workspaceMembershipId: { in: membershipIds } },
        select: { projectId: true },
      });
      const extraProjectIds = createdByCreateOnly.map((a) => a.projectId);
      await prisma.projectAssignment.deleteMany({
        where: { workspaceMembershipId: { in: membershipIds } },
      });
      await prisma.progressReport.deleteMany({
        where: { projectId: { in: extraProjectIds } },
      });
      await prisma.projectBaseline.deleteMany({
        where: { projectId: { in: extraProjectIds } },
      });
      await prisma.rabDocument.deleteMany({
        where: { projectId: { in: extraProjectIds } },
      });
      await prisma.boqItem.deleteMany({
        where: { boqStructure: { projectId: { in: extraProjectIds } } },
      });
      await prisma.boqStructure.deleteMany({
        where: { projectId: { in: extraProjectIds } },
      });
      await prisma.project.deleteMany({
        where: { id: { in: extraProjectIds } },
      });
      await prisma.user.deleteMany({
        where: { workspaceMembershipId: { in: membershipIds } },
      });
      await prisma.workspaceMembership.deleteMany({
        where: { id: { in: membershipIds } },
      });
      await prisma.account.delete({ where: { id: createOnlyAccount.id } });
    }
    await prisma.role.deleteMany({ where: { code: CREATE_ONLY_ROLE_CODE } });

    await prisma.project.deleteMany({
      where: { id: { in: createdProjectIds } },
    });

    await prisma.$disconnect();
    await app.close();
  });

  const postFile = (path: string, token: string) =>
    request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .attach('file', source, {
        filename: 'portable.xlsx',
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

  describe('zero-draft project (lawful new-project state)', () => {
    it('GET returns a truthful empty draft with capability, PUT creates exactly one Working Draft and reuses it on the next save', async () => {
      const getResponse = await request(app.getHttpServer())
        .get(`/projects/${PROJECT_ZERO}/boq/draft`)
        .set('Authorization', `Bearer ${assignedToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      expect(getResponse.body.structureId).toBeNull();
      expect(getResponse.body.items).toEqual([]);
      expect(getResponse.body.capability).toMatchObject({
        canEnterEditableDraftWorkspace: true,
        canEditDraft: true,
        reasonCode: null,
        workingDraftCount: 0,
      });

      const firstPut = await request(app.getHttpServer())
        .put(`/projects/${PROJECT_ZERO}/boq/draft`)
        .set('Authorization', `Bearer ${assignedToken}`)
        .set('x-workspace-id', workspaceAId)
        .send({ rows: [] })
        .expect(200);

      const createdStructureId = firstPut.body.structureId;
      expect(createdStructureId).toEqual(expect.any(String));

      const secondPut = await request(app.getHttpServer())
        .put(`/projects/${PROJECT_ZERO}/boq/draft`)
        .set('Authorization', `Bearer ${assignedToken}`)
        .set('x-workspace-id', workspaceAId)
        .send({ rows: [] })
        .expect(200);

      expect(secondPut.body.structureId).toBe(createdStructureId);

      const finalDraftCount = await prisma.boqStructure.count({
        where: {
          projectId: PROJECT_ZERO,
          name: 'Working Draft',
          status: 'DRAFT',
        },
      });
      expect(finalDraftCount).toBe(1);
    });
  });

  describe.each([
    ['ACTIVE_BASELINE_EXISTS', PROJECT_ACTIVE_BASELINE],
    ['APPROVED_RAB_EXISTS', PROJECT_APPROVED_RAB],
    ['MULTIPLE_WORKING_DRAFTS', PROJECT_DUPLICATE],
    ['PROJECT_NOT_DRAFT', undefined], // resolved to accXProjectId at test time — see beforeAll
  ])('blocked project — %s', (reasonCode, staticProjectId) => {
    const projectId = () => staticProjectId ?? accXProjectId;

    // GET's contract is intentionally always 200 — it only describes reality
    // and never expresses lifecycle state as an HTTP error. capability is the
    // sole signal; PUT/preview/approve below are the routes that 409.
    it(`GET returns 200 with capability.canEditDraft=false and reasonCode ${reasonCode}, without mutating anything`, async () => {
      const draftCountBefore = await prisma.boqStructure.count({
        where: { projectId: projectId() },
      });
      const itemCountBefore = await prisma.boqItem.count({
        where: { boqStructure: { projectId: projectId() } },
      });

      const response = await request(app.getHttpServer())
        .get(`/projects/${projectId()}/boq/draft`)
        .set('Authorization', `Bearer ${assignedToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      expect(response.body.capability).toMatchObject({
        canEnterEditableDraftWorkspace: false,
        canEditDraft: false,
        reasonCode,
      });

      expect(
        await prisma.boqStructure.count({ where: { projectId: projectId() } }),
      ).toBe(draftCountBefore);
      expect(
        await prisma.boqItem.count({
          where: { boqStructure: { projectId: projectId() } },
        }),
      ).toBe(itemCountBefore);
    });

    it(`PUT fails closed with 409 ${reasonCode} and writes nothing`, async () => {
      const draftCountBefore = await prisma.boqStructure.count({
        where: { projectId: projectId() },
      });
      const itemCountBefore = await prisma.boqItem.count({
        where: { boqStructure: { projectId: projectId() } },
      });

      const response = await request(app.getHttpServer())
        .put(`/projects/${projectId()}/boq/draft`)
        .set('Authorization', `Bearer ${assignedToken}`)
        .set('x-workspace-id', workspaceAId)
        .send({ rows: [] })
        .expect(409);
      expect(response.body.message).toBe(reasonCode);

      expect(
        await prisma.boqStructure.count({ where: { projectId: projectId() } }),
      ).toBe(draftCountBefore);
      expect(
        await prisma.boqItem.count({
          where: { boqStructure: { projectId: projectId() } },
        }),
      ).toBe(itemCountBefore);
    });

    it(`import preview fails closed with 409 ${reasonCode} before any file is parsed`, async () => {
      const response = await postFile(
        `/projects/${projectId()}/boq/import/preview`,
        assignedToken,
      )
        .field('selectedSheet', 'RAB')
        .expect(409);
      expect(response.body.message).toBe(reasonCode);
    });

    // RabEditableLifecycleGuard runs before FileInterceptor/Multer and before
    // the controller ever calls BoqImportService.approve — so a project that
    // is already blocked at request time is rejected here regardless of
    // fingerprint validity. This is different from (and does not replace) the
    // transactional TOCTOU re-check covered below, which handles a project
    // that becomes blocked *during* the request.
    it(`import approve fails closed with 409 ${reasonCode} before the fingerprint is even checked`, async () => {
      const response = await postFile(
        `/projects/${projectId()}/boq/import/approve`,
        assignedToken,
      )
        .field('selectedSheet', 'RAB')
        .field('importFingerprint', 'x')
        .expect(409);
      expect(response.body.message).toBe(reasonCode);
    });
  });

  describe('import approve TOCTOU safety — project becomes blocked between a valid preview and approve', () => {
    it('re-evaluates lifecycle inside the approve transaction: ACTIVE_BASELINE_EXISTS wins even with a matching fingerprint', async () => {
      const preview = await postFile(
        `/projects/${PROJECT_TOCTOU_BASELINE}/boq/import/preview`,
        assignedToken,
      )
        .field('selectedSheet', 'RAB')
        .expect(201);

      const structureId = '36000000-0000-4000-8000-000000000014';
      const rabId = '36000000-0000-4000-8000-000000000015';
      await prisma.boqStructure.create({
        data: {
          id: structureId,
          projectId: PROJECT_TOCTOU_BASELINE,
          name: 'Baseline BOQ',
          version: 1,
          status: 'LOCKED',
        },
      });
      await prisma.rabDocument.create({
        data: {
          id: rabId,
          projectId: PROJECT_TOCTOU_BASELINE,
          boqStructureId: structureId,
          name: 'Baseline RAB',
          version: 1,
          totalBaseCost: 0,
          totalFinalCost: 0,
          status: 'APPROVED',
        },
      });
      await prisma.projectBaseline.create({
        data: {
          projectId: PROJECT_TOCTOU_BASELINE,
          rabDocumentId: rabId,
          versionNumber: 1,
          status: 'ACTIVE',
          approvedAt: new Date(),
        },
      });

      const approve = await postFile(
        `/projects/${PROJECT_TOCTOU_BASELINE}/boq/import/approve`,
        assignedToken,
      )
        .field('selectedSheet', 'RAB')
        .field('importFingerprint', preview.body.importFingerprint)
        .expect(409);
      expect(approve.body.message).toBe('ACTIVE_BASELINE_EXISTS');
      expect(
        await prisma.boqItem.count({
          where: { boqStructureId: DRAFT_TOCTOU_BASELINE },
        }),
      ).toBe(0);
    });

    it('re-evaluates lifecycle inside the approve transaction: APPROVED_RAB_EXISTS wins even with a matching fingerprint', async () => {
      const preview = await postFile(
        `/projects/${PROJECT_TOCTOU_APPROVED}/boq/import/preview`,
        assignedToken,
      )
        .field('selectedSheet', 'RAB')
        .expect(201);

      const structureId = '36000000-0000-4000-8000-000000000016';
      const rabId = '36000000-0000-4000-8000-000000000017';
      await prisma.boqStructure.create({
        data: {
          id: structureId,
          projectId: PROJECT_TOCTOU_APPROVED,
          name: 'Approved BOQ',
          version: 1,
          status: 'LOCKED',
        },
      });
      await prisma.rabDocument.create({
        data: {
          id: rabId,
          projectId: PROJECT_TOCTOU_APPROVED,
          boqStructureId: structureId,
          name: 'Approved RAB',
          version: 1,
          totalBaseCost: 0,
          totalFinalCost: 0,
          status: 'APPROVED',
        },
      });

      const approve = await postFile(
        `/projects/${PROJECT_TOCTOU_APPROVED}/boq/import/approve`,
        assignedToken,
      )
        .field('selectedSheet', 'RAB')
        .field('importFingerprint', preview.body.importFingerprint)
        .expect(409);
      expect(approve.body.message).toBe('APPROVED_RAB_EXISTS');
      expect(
        await prisma.boqItem.count({
          where: { boqStructureId: DRAFT_TOCTOU_APPROVED },
        }),
      ).toBe(0);
    });

    it('re-evaluates lifecycle inside the approve transaction: a second Working Draft appearing before approve still 409s MULTIPLE_WORKING_DRAFTS', async () => {
      const preview = await postFile(
        `/projects/${PROJECT_TOCTOU_DUPLICATE}/boq/import/preview`,
        assignedToken,
      )
        .field('selectedSheet', 'RAB')
        .expect(201);

      const secondDraftId = '36000000-0000-4000-8000-000000000018';
      await prisma.boqStructure.create({
        data: {
          id: secondDraftId,
          projectId: PROJECT_TOCTOU_DUPLICATE,
          name: 'Working Draft',
          version: 2,
          status: 'DRAFT',
        },
      });

      const approve = await postFile(
        `/projects/${PROJECT_TOCTOU_DUPLICATE}/boq/import/approve`,
        assignedToken,
      )
        .field('selectedSheet', 'RAB')
        .field('importFingerprint', preview.body.importFingerprint)
        .expect(409);
      expect(approve.body.message).toBe('MULTIPLE_WORKING_DRAFTS');
      expect(
        await prisma.boqItem.count({
          where: { boqStructureId: DRAFT_TOCTOU_DUPLICATE },
        }),
      ).toBe(0);
    });
  });

  describe('lawful positive journey on an assigned, non-baselined project', () => {
    it('GET -> PUT -> import preview -> import approve all succeed and no baseline/approved-RAB/progress-report is created', async () => {
      await request(app.getHttpServer())
        .get(`/projects/${PROJECT_LAWFUL_IMPORT}/boq/draft`)
        .set('Authorization', `Bearer ${assignedToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      await request(app.getHttpServer())
        .put(`/projects/${PROJECT_LAWFUL_IMPORT}/boq/draft`)
        .set('Authorization', `Bearer ${assignedToken}`)
        .set('x-workspace-id', workspaceAId)
        .send({ rows: [] })
        .expect(200);

      const preview = await postFile(
        `/projects/${PROJECT_LAWFUL_IMPORT}/boq/import/preview`,
        assignedToken,
      )
        .field('selectedSheet', 'RAB')
        .expect(201);
      expect(preview.body.canApprove).toBe(true);

      const approve = await postFile(
        `/projects/${PROJECT_LAWFUL_IMPORT}/boq/import/approve`,
        assignedToken,
      )
        .field('selectedSheet', 'RAB')
        .field('importFingerprint', preview.body.importFingerprint)
        .expect(201);
      expect(approve.body.importedRows).toBe(4);

      expect(
        await prisma.projectBaseline.count({
          where: { projectId: PROJECT_LAWFUL_IMPORT },
        }),
      ).toBe(0);
      expect(
        await prisma.rabDocument.count({
          where: { projectId: PROJECT_LAWFUL_IMPORT, status: 'APPROVED' },
        }),
      ).toBe(0);
      expect(
        await prisma.progressReport.count({
          where: { projectId: PROJECT_LAWFUL_IMPORT },
        }),
      ).toBe(0);
    });
  });

  describe('RM-01a-CODE null-integrity: import -> save -> reload -> save -> reload', () => {
    it('never collapses an unpriced WORK_ITEM into a fabricated 0, and reports pricingStatus honestly', async () => {
      const preview = await postFile(
        `/projects/${PROJECT_LAWFUL_IMPORT}/boq/import/preview`,
        assignedToken,
      )
        .field('selectedSheet', 'RAB')
        .expect(201);
      expect(preview.body.folderRows).toBe(2);
      expect(preview.body.workItemRows).toBe(2);
      expect(preview.body.noteRows).toBe(0);
      expect(preview.body.acceptedRows).toBe(4);

      const approve = await postFile(
        `/projects/${PROJECT_LAWFUL_IMPORT}/boq/import/approve`,
        assignedToken,
      )
        .field('selectedSheet', 'RAB')
        .field('importFingerprint', preview.body.importFingerprint)
        .expect(201);
      expect(approve.body.importedRows).toBe(4);

      const importedWorkItems = await prisma.boqItem.findMany({
        where: { boqStructureId: DRAFT_LAWFUL_IMPORT, itemType: 'WORK_ITEM' },
      });
      expect(importedWorkItems).toHaveLength(2);
      for (const item of importedWorkItems) {
        expect(item.unitPrice).toBeNull();
        expect(item.lineTotal).toBeNull();
      }

      const firstGet = await request(app.getHttpServer())
        .get(`/projects/${PROJECT_LAWFUL_IMPORT}/boq/draft`)
        .set('Authorization', `Bearer ${assignedToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);
      expect(firstGet.body.recap.pricingStatus).toBe('INCOMPLETE');
      expect(firstGet.body.recap.subtotal).toBeNull();
      expect(firstGet.body.recap.grandTotal).toBeNull();
      for (const item of firstGet.body.items.filter(
        (i: { itemType: string }) => i.itemType === 'WORK_ITEM',
      )) {
        expect(item.unitPrice).toBeNull();
        expect(item.lineTotal).toBeNull();
      }

      // Frontend omits unitPrice entirely for rows it never manually priced —
      // saveDraftBoq must not treat that omission as "set it to 0".
      const savePayload = {
        rows: firstGet.body.items.map(
          (item: {
            id: string;
            parentId: string | null;
            itemType: string;
            name: string;
            wbsCode: string;
            quantity: string | null;
            unit: string | null;
            sortOrder: number;
          }) => ({
            tempId: item.id,
            parentTempId: item.parentId,
            itemType: item.itemType,
            name: item.name,
            wbsCode: item.wbsCode,
            quantity:
              item.quantity === null ? undefined : Number(item.quantity),
            unit: item.unit ?? undefined,
            sortOrder: item.sortOrder,
          }),
        ),
      };
      const firstPut = await request(app.getHttpServer())
        .put(`/projects/${PROJECT_LAWFUL_IMPORT}/boq/draft`)
        .set('Authorization', `Bearer ${assignedToken}`)
        .set('x-workspace-id', workspaceAId)
        .send(savePayload)
        .expect(200);
      expect(firstPut.body.recap.pricingStatus).toBe('INCOMPLETE');
      expect(firstPut.body.recap.grandTotal).toBeNull();
      const savedWorkItems = firstPut.body.items.filter(
        (i: { itemType: string }) => i.itemType === 'WORK_ITEM',
      );
      expect(savedWorkItems).toHaveLength(2);
      for (const item of savedWorkItems) {
        expect(item.unitPrice).toBeNull();
        expect(item.lineTotal).toBeNull();
      }

      const secondGet = await request(app.getHttpServer())
        .get(`/projects/${PROJECT_LAWFUL_IMPORT}/boq/draft`)
        .set('Authorization', `Bearer ${assignedToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);
      expect(secondGet.body.recap.pricingStatus).toBe('INCOMPLETE');
      expect(secondGet.body.recap.grandTotal).toBeNull();
      for (const item of secondGet.body.items.filter(
        (i: { itemType: string }) => i.itemType === 'WORK_ITEM',
      )) {
        expect(item.unitPrice).toBeNull();
        expect(item.lineTotal).toBeNull();
      }
    });

    it('an explicit manual 0 stays a real 0, distinct from null, once every row is priced', async () => {
      const preview = await postFile(
        `/projects/${PROJECT_LAWFUL_IMPORT}/boq/import/preview`,
        assignedToken,
      )
        .field('selectedSheet', 'RAB')
        .expect(201);
      const approve = await postFile(
        `/projects/${PROJECT_LAWFUL_IMPORT}/boq/import/approve`,
        assignedToken,
      )
        .field('selectedSheet', 'RAB')
        .field('importFingerprint', preview.body.importFingerprint)
        .expect(201);
      const items = approve.body.items as Array<{
        id: string;
        itemType: string;
        name: string;
        parentId: string | null;
        wbsCode: string;
        quantity: string;
        unit: string;
        sortOrder: number;
      }>;
      const workItems = items.filter((item) => item.itemType === 'WORK_ITEM');
      expect(workItems).toHaveLength(2);

      const payload = {
        rows: items.map((item) => ({
          tempId: item.id,
          parentTempId: item.parentId,
          itemType: item.itemType,
          name: item.name,
          wbsCode: item.wbsCode,
          quantity:
            item.itemType === 'WORK_ITEM' ? Number(item.quantity) : undefined,
          unit: item.itemType === 'WORK_ITEM' ? item.unit : undefined,
          unitPrice:
            item.itemType === 'WORK_ITEM'
              ? item.name === 'Mobilisasi'
                ? 0
                : 50000
              : undefined,
          sortOrder: item.sortOrder,
        })),
        marginPercent: 10,
        taxPercent: 11,
      };

      const put = await request(app.getHttpServer())
        .put(`/projects/${PROJECT_LAWFUL_IMPORT}/boq/draft`)
        .set('Authorization', `Bearer ${assignedToken}`)
        .set('x-workspace-id', workspaceAId)
        .send(payload)
        .expect(200);

      expect(put.body.recap.pricingStatus).toBe('COMPLETE');
      expect(put.body.recap.grandTotal).not.toBeNull();
      const mobilisasi = put.body.items.find(
        (i: { name: string }) => i.name === 'Mobilisasi',
      );
      // Prisma Decimal fields serialize as JSON strings ("0"), not numbers.
      expect(Number(mobilisasi.unitPrice)).toBe(0);
      expect(Number(mobilisasi.lineTotal)).toBe(0);
      expect(mobilisasi.unitPrice).not.toBeNull();
      const galian = put.body.items.find(
        (i: { name: string }) => i.name === 'Galian tanah',
      );
      expect(Number(galian.unitPrice)).toBe(50000);

      const reload = await request(app.getHttpServer())
        .get(`/projects/${PROJECT_LAWFUL_IMPORT}/boq/draft`)
        .set('Authorization', `Bearer ${assignedToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);
      expect(reload.body.recap.pricingStatus).toBe('COMPLETE');
      const reloadedMobilisasi = reload.body.items.find(
        (i: { name: string }) => i.name === 'Mobilisasi',
      );
      expect(Number(reloadedMobilisasi.unitPrice)).toBe(0);
      expect(reloadedMobilisasi.unitPrice).not.toBeNull();
    });
  });

  describe('permission activation safety', () => {
    it('PROJECT_CREATE creates exactly one empty Working Draft atomically, with zero baseline/approved-RAB/progress-report', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/projects')
        .set('Authorization', `Bearer ${createOnlyToken}`)
        .set('x-workspace-id', workspaceAId)
        .send({ name: 'Lifecycle New Project Proof', code: 'LC-NEW-PROJECT' })
        .expect(201);

      const newProjectId = createResponse.body.id;
      expect(createResponse.body.status).toBe('PLANNED');
      const drafts = await prisma.boqStructure.findMany({
        where: { projectId: newProjectId },
      });
      expect(drafts).toHaveLength(1);
      expect(drafts[0]).toMatchObject({
        name: 'Working Draft',
        status: 'DRAFT',
        version: 1,
      });
      expect(
        await prisma.boqItem.count({ where: { boqStructureId: drafts[0].id } }),
      ).toBe(0);
      expect(
        await prisma.projectBaseline.count({
          where: { projectId: newProjectId },
        }),
      ).toBe(0);
      expect(
        await prisma.rabDocument.count({ where: { projectId: newProjectId } }),
      ).toBe(0);
      expect(
        await prisma.progressReport.count({
          where: { projectId: newProjectId },
        }),
      ).toBe(0);

      // Same account (PROJECT_CREATE, no RAB_DRAFT_EDIT) cannot edit or import into what it just created.
      await request(app.getHttpServer())
        .put(`/projects/${newProjectId}/boq/draft`)
        .set('Authorization', `Bearer ${createOnlyToken}`)
        .set('x-workspace-id', workspaceAId)
        .send({ rows: [] })
        .expect(403);

      await postFile(
        `/projects/${newProjectId}/boq/import/approve`,
        createOnlyToken,
      )
        .field('selectedSheet', 'RAB')
        .field('importFingerprint', 'x')
        .expect(403);

      // RM-01a authority matrix: /initiate writes Working Draft content, so it
      // now requires RAB_DRAFT_EDIT — PROJECT_CREATE alone is not sufficient.
      await request(app.getHttpServer())
        .post(`/projects/${newProjectId}/initiate`)
        .set('Authorization', `Bearer ${createOnlyToken}`)
        .set('x-workspace-id', workspaceAId)
        .send({ items: [] })
        .expect(403);
    });

    it('initiateSetup reuses the sole DRAFT by state and remains draft-only across retries', async () => {
      // Project creation stays on createOnlyToken (proves PROJECT_CREATE is
      // sufficient to create), but /initiate now requires RAB_DRAFT_EDIT
      // (RM-01a authority matrix), so this test grants assignedMembershipId
      // (already holds RAB_DRAFT_EDIT) a direct ProjectAssignment on the new
      // project and drives /initiate with assignedToken. This test proves
      // initiateSetup's idempotent/draft-only *behavior*, not the permission
      // boundary — that is covered separately above and in the "account
      // without RAB_DRAFT_EDIT" test below. Cleanup is unaffected: the
      // project is still found and cascade-deleted via createOnlyAccount's
      // own ProjectAssignment in afterAll.
      const createResponse = await request(app.getHttpServer())
        .post('/projects')
        .set('Authorization', `Bearer ${createOnlyToken}`)
        .set('x-workspace-id', workspaceAId)
        .send({
          name: 'Lifecycle Idempotent Setup',
          code: 'LC-IDEMPOTENT-SETUP',
        })
        .expect(201);

      const projectId = createResponse.body.id;
      const structuresAfterCreate = await prisma.boqStructure.findMany({
        where: { projectId },
      });
      expect(structuresAfterCreate).toHaveLength(1);

      const originalStructureId = structuresAfterCreate[0].id;
      expect(structuresAfterCreate[0].status).toBe('DRAFT');
      expect(
        await prisma.rabDocument.count({
          where: { projectId, status: 'APPROVED' },
        }),
      ).toBe(0);
      expect(await prisma.projectBaseline.count({ where: { projectId } })).toBe(
        0,
      );
      expect(await prisma.progressReport.count({ where: { projectId } })).toBe(
        0,
      );
      await prisma.boqStructure.update({
        where: { id: originalStructureId },
        data: { name: 'Owner-Named Draft Container' },
      });
      await prisma.projectAssignment.create({
        data: {
          workspaceMembershipId: assignedMembershipId,
          projectId,
          roleInProject: 'PROJECT_MANAGER',
          status: 'ASSIGNED',
        },
      });

      const payload = {
        items: [
          {
            wbsCode: '1',
            name: 'Mobilisasi',
            itemType: 'WORK_ITEM',
            quantity: 2,
            unit: 'ls',
            unitPrice: 100,
          },
        ],
      };
      const initiate = () =>
        request(app.getHttpServer())
          .post(`/projects/${projectId}/initiate`)
          .set('Authorization', `Bearer ${assignedToken}`)
          .set('x-workspace-id', workspaceAId)
          .send(payload);

      const first = await initiate().expect(201);
      const second = await initiate().expect(201);

      expect(second.body).toEqual(first.body);
      const structuresAfterRetries = await prisma.boqStructure.findMany({
        where: { projectId },
      });
      expect(structuresAfterRetries).toHaveLength(1);
      expect(structuresAfterRetries[0]).toMatchObject({
        id: originalStructureId,
        name: 'Owner-Named Draft Container',
        status: 'DRAFT',
      });
      expect(
        await prisma.boqItem.count({
          where: { boqStructureId: originalStructureId },
        }),
      ).toBe(1);
      const rabDocuments = await prisma.rabDocument.findMany({
        where: { projectId },
        select: { status: true },
      });
      expect(rabDocuments.every((rab) => rab.status === 'DRAFT')).toBe(true);
      expect(
        await prisma.rabDocument.count({
          where: { projectId, status: 'APPROVED' },
        }),
      ).toBe(0);
      expect(await prisma.projectBaseline.count({ where: { projectId } })).toBe(
        0,
      );
      expect(await prisma.progressReport.count({ where: { projectId } })).toBe(
        0,
      );
      expect(
        await prisma.project.findUnique({
          where: { id: projectId },
          select: { status: true },
        }),
      ).toMatchObject({ status: 'PLANNED' });
    });

    it('initiateSetup rejects two DRAFT containers regardless of their names and creates no setup artifacts', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/projects')
        .set('Authorization', `Bearer ${createOnlyToken}`)
        .set('x-workspace-id', workspaceAId)
        .send({ name: 'Lifecycle Collision Guard', code: 'LC-COLLISION-GUARD' })
        .expect(201);

      const projectId = createResponse.body.id;
      await prisma.boqStructure.updateMany({
        where: { projectId },
        data: { name: 'First Arbitrary Draft Name' },
      });
      await prisma.boqStructure.create({
        data: {
          projectId,
          name: 'Second Unrelated Draft Name',
          version: 2,
          status: 'DRAFT',
        },
      });
      await prisma.projectAssignment.create({
        data: {
          workspaceMembershipId: assignedMembershipId,
          projectId,
          roleInProject: 'PROJECT_MANAGER',
          status: 'ASSIGNED',
        },
      });

      const response = await request(app.getHttpServer())
        .post(`/projects/${projectId}/initiate`)
        .set('Authorization', `Bearer ${assignedToken}`)
        .set('x-workspace-id', workspaceAId)
        .send({ items: [] })
        .expect(409);

      expect(response.body.message).toBe('MULTIPLE_DRAFT_BOQ_STRUCTURES');
      expect(
        await prisma.boqStructure.count({
          where: { projectId, status: 'DRAFT' },
        }),
      ).toBe(2);
      expect(
        await prisma.boqItem.count({ where: { boqStructure: { projectId } } }),
      ).toBe(0);
      expect(await prisma.rabDocument.count({ where: { projectId } })).toBe(0);
      expect(await prisma.projectBaseline.count({ where: { projectId } })).toBe(
        0,
      );
      expect(await prisma.progressReport.count({ where: { projectId } })).toBe(
        0,
      );
    });

    it('account without PROJECT_CREATE cannot create a project — the "Buat RAB" door\'s backend half', async () => {
      await request(app.getHttpServer())
        .post('/projects')
        .set('Authorization', `Bearer ${nonassignedToken}`)
        .set('x-workspace-id', workspaceAId)
        .send({ name: 'Should Not Be Created', code: 'LC-DENIED-CREATE' })
        .expect(403);

      expect(
        await prisma.project.count({ where: { code: 'LC-DENIED-CREATE' } }),
      ).toBe(0);
    });

    it('FOREMAN cannot save a draft (PUT), mirroring the existing FOREMAN import-approve denial', async () => {
      await request(app.getHttpServer())
        .put(`/projects/${PROJECT_LAWFUL_IMPORT}/boq/draft`)
        .set('Authorization', `Bearer ${foremanToken}`)
        .set('x-workspace-id', workspaceAId)
        .send({ rows: [] })
        .expect(403);
    });
  });

  describe('/projects/mine backend-derived lifecycle projection', () => {
    it('reflects blocked and editable projects correctly, and never derives editability from Project.status', async () => {
      const response = await request(app.getHttpServer())
        .get('/projects/mine')
        .set('Authorization', `Bearer ${assignedToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      const byId = new Map<
        string,
        {
          rabLifecycle?: {
            canEnterEditableDraftWorkspace: boolean;
            reasonCode: string | null;
            workingDraftCount: number;
          };
        }
      >(response.body.map((project: { id: string }) => [project.id, project]));

      expect(byId.get(PROJECT_ACTIVE_BASELINE)?.rabLifecycle).toMatchObject({
        canEnterEditableDraftWorkspace: false,
        reasonCode: 'ACTIVE_BASELINE_EXISTS',
      });
      expect(byId.get(PROJECT_APPROVED_RAB)?.rabLifecycle).toMatchObject({
        canEnterEditableDraftWorkspace: false,
        reasonCode: 'APPROVED_RAB_EXISTS',
      });
      expect(byId.get(PROJECT_DUPLICATE)?.rabLifecycle).toMatchObject({
        canEnterEditableDraftWorkspace: false,
        reasonCode: 'MULTIPLE_WORKING_DRAFTS',
      });
      expect(byId.get(PROJECT_ZERO)?.rabLifecycle).toMatchObject({
        canEnterEditableDraftWorkspace: true,
        reasonCode: null,
      });
      expect(byId.get(accXProjectId)?.rabLifecycle).toMatchObject({
        canEnterEditableDraftWorkspace: false,
        reasonCode: 'PROJECT_NOT_DRAFT',
      });
    });
  });

  describe('ACC-X canonical result (Section 4 addendum)', () => {
    // RM-01a-CODE §6.5: ACC-X's ACTIVE status is a direct simprok_test
    // fixture fact (seed-acceptance.ts upserts it via Prisma, never through
    // ProjectService.create()/initiateSetup()) — proven statically by source
    // review, not by product-code creation here. This test proves the
    // negative facts underneath it directly from the database, independent
    // of the capability projection asserted elsewhere in this block.
    it('has zero APPROVED RabDocument, zero ACTIVE ProjectBaseline, and zero ProgressReport — Project.status ACTIVE is a fixture fact only', async () => {
      const accX = await prisma.project.findUniqueOrThrow({
        where: { id: accXProjectId },
        select: { status: true },
      });
      expect(accX.status).toBe('ACTIVE');
      expect(
        await prisma.rabDocument.count({
          where: { projectId: accXProjectId, status: 'APPROVED' },
        }),
      ).toBe(0);
      expect(
        await prisma.projectBaseline.count({
          where: { projectId: accXProjectId, status: 'ACTIVE' },
        }),
      ).toBe(0);
      expect(
        await prisma.progressReport.count({
          where: { projectId: accXProjectId },
        }),
      ).toBe(0);
    });

    it('GET returns 200 with the exact projection shape: PROJECT_NOT_DRAFT, zero baseline/approved/draft facts, no write', async () => {
      const structureCountBefore = await prisma.boqStructure.count({
        where: { projectId: accXProjectId },
      });
      const itemCountBefore = await prisma.boqItem.count({
        where: { boqStructure: { projectId: accXProjectId } },
      });

      const response = await request(app.getHttpServer())
        .get(`/projects/${accXProjectId}/boq/draft`)
        .set('Authorization', `Bearer ${assignedToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      expect(response.body.capability).toMatchObject({
        canEnterEditableDraftWorkspace: false,
        canEditDraft: false,
        reasonCode: 'PROJECT_NOT_DRAFT',
        activeBaselineCount: 0,
        approvedRabCount: 0,
        workingDraftCount: 0,
      });

      expect(
        await prisma.boqStructure.count({
          where: { projectId: accXProjectId },
        }),
      ).toBe(structureCountBefore);
      expect(
        await prisma.boqItem.count({
          where: { boqStructure: { projectId: accXProjectId } },
        }),
      ).toBe(itemCountBefore);
    });

    it('a corrupt XLSX on a blocked project reports 409 PROJECT_NOT_DRAFT, not a file-validation error', async () => {
      const response = await request(app.getHttpServer())
        .post(`/projects/${accXProjectId}/boq/import/preview`)
        .set('Authorization', `Bearer ${assignedToken}`)
        .set('x-workspace-id', workspaceAId)
        .field('selectedSheet', 'RAB')
        .attach('file', Buffer.from('this is not a real xlsx file'), {
          filename: 'corrupt.xlsx',
          contentType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        })
        .expect(409);
      expect(response.body.message).toBe('PROJECT_NOT_DRAFT');
    });

    it('a wrong file extension on a blocked project reports 409 PROJECT_NOT_DRAFT, not ONLY_XLSX', async () => {
      const response = await request(app.getHttpServer())
        .post(`/projects/${accXProjectId}/boq/import/preview`)
        .set('Authorization', `Bearer ${assignedToken}`)
        .set('x-workspace-id', workspaceAId)
        .field('selectedSheet', 'RAB')
        .attach('file', Buffer.from('plain text'), {
          filename: 'wrong-extension.txt',
          contentType: 'text/plain',
        })
        .expect(409);
      expect(response.body.message).toBe('PROJECT_NOT_DRAFT');
    });

    it('an incorrect fingerprint on approve for a blocked project reports 409 PROJECT_NOT_DRAFT, not IMPORT_FINGERPRINT_MISMATCH', async () => {
      const response = await postFile(
        `/projects/${accXProjectId}/boq/import/approve`,
        assignedToken,
      )
        .field('selectedSheet', 'RAB')
        .field('importFingerprint', 'definitely-not-a-real-fingerprint')
        .expect(409);
      expect(response.body.message).toBe('PROJECT_NOT_DRAFT');
    });

    it('no request body/file at all still reports 409 PROJECT_NOT_DRAFT on both import routes', async () => {
      const previewResponse = await request(app.getHttpServer())
        .post(`/projects/${accXProjectId}/boq/import/preview`)
        .set('Authorization', `Bearer ${assignedToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(409);
      expect(previewResponse.body.message).toBe('PROJECT_NOT_DRAFT');

      const approveResponse = await request(app.getHttpServer())
        .post(`/projects/${accXProjectId}/boq/import/approve`)
        .set('Authorization', `Bearer ${assignedToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(409);
      expect(approveResponse.body.message).toBe('PROJECT_NOT_DRAFT');
    });
  });
});
