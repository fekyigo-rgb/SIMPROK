/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- The Supertest E2E transport exposes untyped JSON/HTTP server boundaries; all money, identity and response fields are asserted against real HTTP and PostgreSQL below. This exemption is TEST-ONLY and never applies to production engines. */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { StorageService } from '../../src/reality-intake/storage.service';

/**
 * RAB-AUTO-08: COMPLETE SIX-LINE PROJECT WITH REAL HTTP+DB, not mocks or test-only
 * shortcuts for the decision/price transitions.
 *
 * Synthetic fixture data exists only in simprok_e2e. Owner-approved BOQ
 * import is performed through real preview/approve HTTP, Price via real
 * ACCEPT/PUBLISH HTTP, then first AHSP bind and canonical cost persistence.
 */
describe('RAB-AUTO-08 — multi-line complete project Golden Thread (e2e)', () => {
  const prisma = new PrismaClient();
  const tag = 'RAB08' + Date.now();
  const password = 'IsolatedRab08Only!';
  const lines = [
    { code: 'B.64', label: 'Pembesian Pondasi', qty: 5, coeff: 2 },
    { code: 'B.65', label: 'Pembesian Kolom', qty: 8, coeff: 3 },
    { code: 'B.66', label: 'Pembesian Balok', qty: 3, coeff: 1 },
    { code: 'B.67', label: 'Pembesian Pelat', qty: 12, coeff: 4 },
    { code: 'B.68', label: 'Pembesian Tangga', qty: 4, coeff: 2 },
    { code: 'B.69', label: 'Pembesian Pagar', qty: 6, coeff: 5 },
  ].map((line, index) => ({
    ...line,
    wbs: '1.' + (index + 1),
    description: tag + ' ' + line.label,
    expectedUnit: (line.coeff * 100000).toFixed(2),
    expectedTotal: (line.coeff * 100000 * line.qty).toFixed(2),
  }));
  // Genuine NEW uncoded BOQ work, NOT a copy of any coded line.
  const uncodedLine = {
    wbs: '1.7',
    description: tag + ' Penguatan Sambungan Pelat Baja Tebal 12 mm',
    qty: 2, expectedUnit: '200000.00', expectedTotal: '400000.00',
  };
  const description = lines[0].description;
  const expectedProjectTotal = lines
    .reduce((sum, line) => sum + Number(line.expectedTotal),
      Number(uncodedLine.expectedTotal))
    .toFixed(2);
  const resourceName = tag + ' Besi Beton';
  const asOfDate = '2026-10-29';
  let app: INestApplication;
  let storage: StorageService;
  let orgId: string;
  let workspaceId: string;
  let projectId: string;
  let structureId: string;
  let regionId: string;
  let resourceId: string;
  let basicPriceId: string;
  let submissionId: string;
  let reviewId: string;
  let editorToken: string;
  let verifierToken: string;
  let publisherToken: string;
  const ahspIds: string[] = [];
  const versionIds: string[] = [];
  const createdPermissionIds: string[] = [];
  const accountIds: string[] = [];
  const membershipIds: string[] = [];
  const nodeIds: string[] = [];
  let docBuffer: Buffer;

  const ensurePermission = async (code: string) => {
    const found = await prisma.permission.findUnique({ where: { code } });
    if (found) return found;
    const created = await prisma.permission.create({
      data: { code, name: tag + ' ' + code, description: 'RAB07 E2E fixture' },
    });
    createdPermissionIds.push(created.id);
    return created;
  };
  const createActor = async (
    suffix: string,
    permissionCodes: string[],
    assigned: boolean,
  ) => {
    const permissions = await Promise.all(
      permissionCodes.map(ensurePermission),
    );
    const role = await prisma.role.create({
      data: {
        workspaceId,
        code: tag + '_' + suffix.toUpperCase(),
        name: tag + ' ' + suffix,
        rolePermissions: {
          create: permissions.map((perm) => ({ permissionId: perm.id })),
        },
      },
    });
    const email = (tag + '.' + suffix + '@test.local').toLowerCase();
    const account = await prisma.account.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 10),
        displayName: suffix,
        status: 'ACTIVE',
      },
    });
    accountIds.push(account.id);
    const membership = await prisma.workspaceMembership.create({
      data: {
        accountId: account.id,
        workspaceId,
        status: 'ACTIVE',
        membershipRoles: { create: [{ roleId: role.id }] },
      },
    });
    membershipIds.push(membership.id);
    await prisma.user.create({
      data: {
        workspaceMembershipId: membership.id,
        workspaceId,
        fullName: suffix,
        status: 'ACTIVE',
      },
    });
    if (assigned) {
      await prisma.projectAssignment.create({
        data: {
          workspaceMembershipId: membership.id,
          projectId,
          roleInProject: 'PROJECT_MANAGER',
          isPrimaryAssignment: true,
          status: 'ASSIGNED',
        },
      });
    }
    const result = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    return result.body.access_token as string;
  };

  const createClassificationPath = async () => {
    const levels = [
      ['JENIS_PENGADAAN', tag + ' Konstruksi'],
      ['KATEGORI', tag + ' Pekerjaan Struktur'],
      ['SUBKATEGORI', tag + ' Besi Beton'],
      ['JENIS_PEKERJAAN', description],
    ] as const;
    let parentId: string | null = null;
    let kategoriId = '';
    for (const [level, name] of levels) {
      const node = await prisma.constructionClassificationNode.create({
        data: {
          level,
          name,
          normalizedName: name.toLowerCase(),
          parentId,
          workspaceId,
          isActive: true,
        },
      });
      nodeIds.push(node.id);
      parentId = node.id;
      if (level === 'KATEGORI') kategoriId = node.id;
    }
    return { kategoriId, leafId: parentId! };
  };

  const upload = (route: string) =>
    request(app.getHttpServer())
      .post(`/projects/${projectId}/boq/import/${route}`)
      .set('Authorization', `Bearer ${editorToken}`)
      .set('x-workspace-id', workspaceId)
      .attach('file', docBuffer, {
        filename: tag + '-boq.xlsx',
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.init();
    storage = app.get(StorageService);

    const org = await prisma.organization.create({
      data: { name: tag + ' Org', type: 'COMPANY' },
    });
    orgId = org.id;
    const workspace = await prisma.workspace.create({
      data: { organizationId: orgId, name: tag + ' Workspace' },
    });
    workspaceId = workspace.id;
    const project = await prisma.project.create({
      data: {
        organizationId: orgId,
        workspaceId,
        code: tag + '-PROJECT',
        name: tag + ' Real RAB',
        status: 'PLANNED',
      },
    });
    projectId = project.id;
    const structure = await prisma.boqStructure.create({
      data: { projectId, name: 'Working Draft', status: 'DRAFT', version: 1 },
    });
    structureId = structure.id;
    const region = await prisma.region.create({
      data: { code: tag + '-REG', name: tag + ' Region', isActive: true },
    });
    regionId = region.id;
    await prisma.projectRegionSelection.create({
      data: { projectId, regionId },
    });

    editorToken = await createActor(
      'editor',
      ['RAB_DRAFT_EDIT', 'RAB_VIEW', 'AHSP_VIEW', 'PROJECT_VIEW'],
      true,
    );
    verifierToken = await createActor(
      'verifier',
      ['BASIC_PRICE_VERIFY'],
      false,
    );
    publisherToken = await createActor(
      'publisher',
      ['BASIC_PRICE_PUBLISH'],
      false,
    );

    const path = await createClassificationPath();
    await prisma.projectClassificationSelection.create({
      data: { projectId, classificationNodeId: path.kategoriId },
    });

    const resource = await prisma.resourceCatalog.create({
      data: {
        workspaceId,
        code: tag + '-RES',
        name: resourceName,
        type: 'MATERIAL',
        baseUnit: 'Kg',
      },
    });
    resourceId = resource.id;
    const submission = await prisma.priceSubmission.create({
      data: {
        workspaceId,
        organizationId: orgId,
        resourceId,
        regionId,
        sourceOrigin: 'SUPPLIER',
        sourceType: 'MARKET_SURVEY',
        status: 'UNDER_REVIEW',
      },
    });
    submissionId = submission.id;
    const revision = await prisma.priceSubmissionRevision.create({
      data: {
        submissionId,
        revisionNumber: 1,
        value: '100000.00',
        effectiveDate: new Date('2026-01-01T00:00:00.000Z'),
        validationPassed: true,
      },
    });
    await prisma.priceSubmission.update({
      where: { id: submissionId },
      data: { currentRevisionId: revision.id },
    });
    const review = await prisma.priceSubmissionReview.create({
      data: {
        priceSubmissionId: submissionId,
        workspaceId,
        organizationId: orgId,
        slaState: 'OPEN',
        openedAt: new Date(),
      },
    });
    reviewId = review.id;
    const accepted = await request(app.getHttpServer())
      .post(`/basic-price-reviews/${reviewId}/accept`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .set('x-workspace-id', workspaceId)
      .send({})
      .expect(201);
    basicPriceId = accepted.body.basicPriceId;
    await request(app.getHttpServer())
      .post(`/basic-price-publications/${basicPriceId}/publish`)
      .set('Authorization', `Bearer ${publisherToken}`)
      .set('x-workspace-id', workspaceId)
      .expect(201);

    // Each BOQ has its own exact source code, AHSP parent, canonical version,
    // coefficient and classification evidence. All share one verified Basic Price.
    const rootLeaf =
      await prisma.constructionClassificationNode.findUniqueOrThrow({
        where: { id: path.leafId },
      });
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let leafId = path.leafId;
      if (i > 0) {
        const leaf = await prisma.constructionClassificationNode.create({
          data: {
            level: 'JENIS_PEKERJAAN',
            name: line.description,
            normalizedName: line.description.toLowerCase(),
            parentId: rootLeaf.parentId,
            workspaceId,
            isActive: true,
          },
        });
        leafId = leaf.id;
        nodeIds.push(leaf.id);
      }
      const ahsp = await prisma.aHSP.create({
        data: {
          workspaceId,
          code: line.code,
          workType: line.description,
          methodName: line.description,
          methodType: 'MANUAL',
          locationType: 'GENERAL',
          ownershipType: 'USER_ASSET',
        },
      });
      ahspIds.push(ahsp.id);
      const version = await prisma.aHSPVersion.create({
        data: {
          ahspId: ahsp.id,
          workspaceId,
          versionNumber: 1,
          status: 'DRAFT',
          effectiveDate: new Date('2026-08-01T00:00:00.000Z'),
          outputUnit: 'Kg',
          resources: {
            create: [
              {
                resourceId: resourceName,
                resourceType: 'MATERIAL',
                coefficient: line.coeff.toFixed(6),
                baseUnit: 'Kg',
              },
            ],
          },
        },
      });
      versionIds.push(version.id);
      await prisma.ahspClassificationAssignment.create({
        data: {
          ahspId: ahsp.id,
          leafNodeId: leafId,
          provenance: 'HUMAN_ADDED',
          isActive: true,
        },
      });
    }

    // Distinct eligible AHSP method for the new BOQ with NO source code.
    // Reuses existing AHSP/Resource/Price engines, not test-only matching.
    const uncodedLeaf = await prisma.constructionClassificationNode.create({
      data: {
        level: 'JENIS_PEKERJAAN',
        name: uncodedLine.description,
        normalizedName: uncodedLine.description.toLowerCase(),
        parentId: rootLeaf.parentId,
        workspaceId,
        isActive: true,
      },
    });
    nodeIds.push(uncodedLeaf.id);
    const uncodedAhsp = await prisma.aHSP.create({
      data: {
        workspaceId,
        code: 'UC-70',
        workType: uncodedLine.description,
        methodName: uncodedLine.description,
        methodType: 'MANUAL',
        locationType: 'GENERAL',
        ownershipType: 'USER_ASSET',
      },
    });
    ahspIds.push(uncodedAhsp.id);
    const uncodedVersion = await prisma.aHSPVersion.create({
      data: {
        ahspId: uncodedAhsp.id,
        workspaceId,
        versionNumber: 1,
        status: 'DRAFT',
        effectiveDate: new Date('2026-08-01T00:00:00.000Z'),
        outputUnit: 'Kg',
        resources: {
          create: [{
            resourceId: resourceName,
            resourceType: 'MATERIAL',
            coefficient: '2.000000',
            baseUnit: 'Kg',
          }],
        },
      },
    });
    versionIds.push(uncodedVersion.id);
    await prisma.ahspClassificationAssignment.create({
      data: {
        ahspId: uncodedAhsp.id,
        leafNodeId: uncodedLeaf.id,
        provenance: 'HUMAN_ADDED',
        isActive: true,
      },
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('RAB');
    sheet.addRow(['No', 'Uraian Pekerjaan', 'Volume', 'Satuan', 'Kode AHSP']);
    for (const line of lines) {
      sheet.addRow([line.wbs, line.description, line.qty, 'Kg', line.code]);
    }
    sheet.addRow([uncodedLine.wbs, uncodedLine.description,
      uncodedLine.qty, 'Kg', '']);
    docBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
  }, 90000);

  afterAll(async () => {
    // The E2E is restricted to its unique synthetic project/workspace.
    // Restore the exact seeded fingerprint: no fixture must survive.
    try {
      if (projectId) {
        const requests = await prisma.intakeRequest.findMany({
          where: { projectId },
          select: { sourceDocumentId: true },
        });
        const jobs = await prisma.intakeJob.findMany({
          where: { projectId, knowledgeType: 'BOQ' },
          select: { sourceDocumentId: true },
        });
        const docIds = [
          ...new Set([...requests, ...jobs].map((x) => x.sourceDocumentId)),
        ];
        await prisma.$executeRawUnsafe(
          'ALTER TABLE boq_business_use_events DISABLE TRIGGER boq_business_use_events_immutable_trigger',
        );
        try {
          await prisma.boqBusinessUseEvent.deleteMany({ where: { projectId } });
        } finally {
          await prisma.$executeRawUnsafe(
            'ALTER TABLE boq_business_use_events ENABLE TRIGGER boq_business_use_events_immutable_trigger',
          );
        }
        await prisma.rabDocument.deleteMany({ where: { projectId } });
        await prisma.boqItem.deleteMany({
          where: { boqStructure: { projectId } },
        });
        await prisma.projectAhspResourceResolution.deleteMany({
          where: { occurrence: { projectId } },
        });
        await prisma.projectAhspOccurrence.deleteMany({ where: { projectId } });
        await prisma.boqStructure.deleteMany({ where: { projectId } });
        await prisma.intakeRequest.deleteMany({ where: { projectId } });
        await prisma.intakeJob.deleteMany({
          where: { projectId, knowledgeType: 'BOQ' },
        });
        const removable = await prisma.sourceDocument.findMany({
          where: {
            id: { in: docIds },
            intakeJobs: { none: {} },
            intakeRequests: { none: {} },
          },
          select: { id: true, storageRef: true },
        });
        await prisma.sourceDocument.deleteMany({
          where: { id: { in: removable.map((x) => x.id) } },
        });
        for (const row of removable) {
          await storage.deleteFinal(row.storageRef);
        }
      }
      if (ahspIds.length) {
        await prisma.ahspClassificationAssignment.deleteMany({
          where: { ahspId: { in: ahspIds } },
        });
        await prisma.aHSPResource.deleteMany({
          where: { ahspVersion: { ahspId: { in: ahspIds } } },
        });
        await prisma.aHSPVersion.deleteMany({
          where: { ahspId: { in: ahspIds } },
        });
        await prisma.aHSP.deleteMany({
          where: { id: { in: ahspIds } },
        });
      }
      if (basicPriceId) {
        await prisma.basicPricePublicationAudit.deleteMany({
          where: { basicPriceId },
        });
        await prisma.basicPrice.deleteMany({ where: { id: basicPriceId } });
      }
      if (reviewId) {
        await prisma.priceSubmissionReviewDecision.deleteMany({
          where: { reviewId },
        });
        await prisma.priceSubmissionReview.deleteMany({
          where: { id: reviewId },
        });
      }
      if (submissionId) {
        await prisma.priceSubmissionAudit.deleteMany({
          where: { submissionId },
        });
        await prisma.priceSubmissionRevision.deleteMany({
          where: { submissionId },
        });
        await prisma.priceSubmission.deleteMany({
          where: { id: submissionId },
        });
      }
      if (resourceId) {
        await prisma.resourceCatalog.deleteMany({
          where: { id: resourceId },
        });
      }
      if (projectId) {
        await prisma.projectClassificationSelection.deleteMany({
          where: { projectId },
        });
        await prisma.projectRegionSelection.deleteMany({
          where: { projectId },
        });
        await prisma.projectAssignment.deleteMany({ where: { projectId } });
      }
      if (membershipIds.length) {
        await prisma.user.deleteMany({
          where: { workspaceMembershipId: { in: membershipIds } },
        });
        await prisma.workspaceMembership.deleteMany({
          where: { id: { in: membershipIds } },
        });
      }
      if (workspaceId) {
        await prisma.role.deleteMany({ where: { workspaceId } });
      }
      if (createdPermissionIds.length) {
        await prisma.permission.deleteMany({
          where: { id: { in: createdPermissionIds } },
        });
      }
      if (accountIds.length) {
        await prisma.account.deleteMany({
          where: { id: { in: accountIds } },
        });
      }
      if (projectId)
        await prisma.project.deleteMany({ where: { id: projectId } });
      for (const id of nodeIds.slice().reverse()) {
        await prisma.constructionClassificationNode.delete({
          where: { id },
        });
      }
      if (regionId) await prisma.region.deleteMany({ where: { id: regionId } });
      if (workspaceId)
        await prisma.workspace.deleteMany({ where: { id: workspaceId } });
      if (orgId) await prisma.organization.deleteMany({ where: { id: orgId } });
    } finally {
      if (app) await app.close();
      await prisma.$disconnect();
    }
  }, 90000);

  it('completes 6 coded and one independent uncoded job, verifies complete persisted RAB after fresh app', async () => {
    const preview = await upload('preview')
      .field('selectedSheet', 'RAB')
      .expect(201);
    expect(preview.body.canApprove).toBe(true);
    const approved = await upload('approve')
      .field('selectedSheet', 'RAB')
      .field('intakeRequestId', preview.body.intakeRequestId)
      .field('importFingerprint', preview.body.importFingerprint)
      .expect(201);
    expect(approved.body.businessUseEvent.projectId).toBe(projectId);

    const imported = await prisma.boqItem.findMany({
      where: { boqStructureId: structureId, itemType: 'WORK_ITEM' },
    });
    expect(imported).toHaveLength(lines.length + 1);
    let newUncoded = imported.find((row) =>
      row.name === uncodedLine.description);
    expect(newUncoded).toBeDefined();
    expect(newUncoded).toMatchObject({
      sourceAhspCode: null, unit: 'Kg', priceOrigin: null,
    });
    for (const line of lines) {
      const item = imported.find((row) => row.name === line.description);
      expect(item).toBeDefined();
      expect(item).toMatchObject({
        sourceAhspCode: line.code,
        unit: 'Kg',
        priceOrigin: null,
      });
    }

    const initialDraft = await request(app.getHttpServer())
      .get(`/projects/${projectId}/boq/draft`)
      .set('Authorization', `Bearer ${editorToken}`)
      .expect(200);
    expect(
      initialDraft.body.items.filter(
        (row: { itemType: string }) => row.itemType === 'WORK_ITEM',
      ),
    ).toHaveLength(lines.length + 1);
    expect(initialDraft.body.recap).toMatchObject({
      pricingStatus: 'INCOMPLETE',
      grandTotal: null,
      subtotal: null,
    });

    // THE MISSING REAL USER ORDER: approve source -> SAVE unchanged draft
    // BEFORE any first AHSP association. Full-replace mints new BoqItem IDs
    // but must preserve only the originally approved logical source revision.
    const approvedEventBefore = await prisma.boqBusinessUseEvent.findUniqueOrThrow({
      where: { id: approved.body.businessUseEvent.id },
    });
    const noOpSaved = await request(app.getHttpServer())
      .put('/projects/' + projectId + '/boq/draft')
      .set('Authorization', 'Bearer ' + editorToken)
      .send({
        rows: initialDraft.body.items.map((row: {
          id: string; itemType: string; name: string; wbsCode: string;
          quantity: string; unit: string; sortOrder: number;
        }) => ({
          tempId: row.id, itemType: row.itemType,
          name: row.name, wbsCode: row.wbsCode,
          quantity: Number(row.quantity), unit: row.unit,
          sortOrder: row.sortOrder,
        })),
      }).expect(200);
    expect(noOpSaved.body.items).toHaveLength(imported.length);
    const afterNoOp = await prisma.boqItem.findMany({
      where: { boqStructureId: structureId, itemType: 'WORK_ITEM' },
    });
    expect(afterNoOp).toHaveLength(imported.length);
    for (const old of imported) {
      const current = afterNoOp.find((row) => row.name === old.name);
      expect(current).toBeDefined();
      expect(current!.id).not.toBe(old.id);
      expect(current!.createdAt.getTime()).toBe(old.createdAt.getTime());
      expect(current!.updatedAt.getTime()).toBe(old.updatedAt.getTime());
      expect(current!.sourceAhspCode).toBe(old.sourceAhspCode);
      expect(current!.ahspVersionId).toBeNull();
      expect(current!.workingOccurrenceId).toBeNull();
    }
    newUncoded = afterNoOp.find((row) =>
      row.name === uncodedLine.description);
    expect(newUncoded).toBeDefined();
    const approvedEventAfter = await prisma.boqBusinessUseEvent.findUniqueOrThrow({
      where: { id: approvedEventBefore.id },
    });
    expect(approvedEventAfter).toEqual(approvedEventBefore);
    expect(await prisma.boqBusinessUseEvent.count({
      where: { projectId, boqStructureId: structureId },
    })).toBe(1);

    // A second region must block the ENTIRE project, not guess a region
    // and incorrectly report a project total based on partial work.
    const extraRegion = await prisma.region.create({
      data: {
        code: tag + '-AMB',
        name: tag + ' Second Region',
        isActive: true,
      },
    });
    await prisma.projectRegionSelection.create({
      data: { projectId, regionId: extraRegion.id },
    });
    try {
      const blocked = await request(app.getHttpServer())
        .post(
          `/projects/${projectId}/ahsp-occurrences/boq-items/working-draft/auto-bind-explicit-references`,
        )
        .set('Authorization', `Bearer ${editorToken}`)
        .send({ businessPricingAsOfDate: asOfDate })
        .expect(201);
      expect(blocked.body.automaticBindingPerformed).toBe(false);
      expect(blocked.body.summary.PRICE_REGION_NOT_UNIQUE).toBe(lines.length + 1);
      expect(
        await prisma.projectAhspOccurrence.count({ where: { projectId } }),
      ).toBe(0);
      expect(
        await prisma.boqItem.count({
          where: { boqStructureId: structureId, unitPrice: { not: null } },
        }),
      ).toBe(0);
    } finally {
      await prisma.projectRegionSelection.deleteMany({
        where: { projectId, regionId: extraRegion.id },
      });
      await prisma.region.delete({ where: { id: extraRegion.id } });
    }


    // Regression of the independent Architect finding: even an identical
    // method in another category MUST count as a competing identity.
    // Query ONLY page 7/limit 1: no coded BOQ can be mutated by this probe.
    const selectedCategory = await prisma.projectClassificationSelection.findFirstOrThrow({
      where: { projectId },
      include: { classificationNode: true },
    });
    const alternateCategory = await prisma.constructionClassificationNode.create({
      data: {
        level: 'KATEGORI',
        name: tag + ' Kategori Alternatif',
        normalizedName: (tag + ' Kategori Alternatif').toLowerCase(),
        parentId: selectedCategory.classificationNode.parentId,
        workspaceId, isActive: true,
      },
    });
    nodeIds.push(alternateCategory.id);
    const alternateSub = await prisma.constructionClassificationNode.create({
      data: {
        level: 'SUBKATEGORI',
        name: tag + ' Subkategori Alternatif',
        normalizedName: (tag + ' Subkategori Alternatif').toLowerCase(),
        parentId: alternateCategory.id,
        workspaceId, isActive: true,
      },
    });
    nodeIds.push(alternateSub.id);
    const alternateLeaf = await prisma.constructionClassificationNode.create({
      data: {
        level: 'JENIS_PEKERJAAN',
        name: uncodedLine.description,
        normalizedName: uncodedLine.description.toLowerCase(),
        parentId: alternateSub.id,
        workspaceId, isActive: true,
      },
    });
    nodeIds.push(alternateLeaf.id);
    const competingAhsp = await prisma.aHSP.create({
      data: {
        workspaceId,
        workType: tag + ' Metode Alternatif',
        methodName: uncodedLine.description.replace(' ', '   '),
        methodType: 'MANUAL',
        locationType: 'GENERAL',
        ownershipType: 'USER_ASSET',
      },
    });
    ahspIds.push(competingAhsp.id);
    await prisma.aHSPVersion.create({
      data: {
        ahspId: competingAhsp.id, workspaceId, versionNumber: 1,
        status: 'DRAFT',
        effectiveDate: new Date('2026-08-01T00:00:00.000Z'),
        outputUnit: 'Kg',
        resources: {
          create: [{
            resourceId: resourceName, resourceType: 'MATERIAL',
            coefficient: '2.000000', baseUnit: 'Kg',
          }],
        },
      },
    });
    await prisma.ahspClassificationAssignment.create({
      data: {
        ahspId: competingAhsp.id, leafNodeId: alternateLeaf.id,
        provenance: 'HUMAN_ADDED', isActive: true,
      },
    });
    try {
      const conflict = await request(app.getHttpServer())
        .post('/projects/' + projectId +
          '/ahsp-occurrences/boq-items/working-draft/auto-bind-explicit-references?page=7&limit=1')
        .set('Authorization', 'Bearer ' + editorToken)
        .send({ businessPricingAsOfDate: asOfDate })
        .expect(201);
      expect(conflict.body.summary.UNCODED_EXACT_WORK_AMBIGUOUS).toBe(1);
      expect(conflict.body.automaticBindingPerformed).toBe(false);
      expect(conflict.body.results[0].boqItemId).toBe(newUncoded!.id);
      expect(await prisma.projectAhspOccurrence.count({
        where: { projectId },
      })).toBe(0);
    } finally {
      await prisma.ahspClassificationAssignment.deleteMany({
        where: { ahspId: competingAhsp.id },
      });
      await prisma.aHSPResource.deleteMany({
        where: { ahspVersion: { ahspId: competingAhsp.id } },
      });
      await prisma.aHSPVersion.deleteMany({
        where: { ahspId: competingAhsp.id },
      });
      await prisma.aHSP.delete({ where: { id: competingAhsp.id } });
    }

    // Same selected Kategorie but a conflicting explicit Subkategori must
    // block automatic authority; a PREFERRED_KATEGORI rank is insufficient.
    const wrongSubcategory = await prisma.constructionClassificationNode.create({
      data: {
        level: 'SUBKATEGORI',
        name: tag + ' Subkategori Pilihan Berbeda',
        normalizedName: (tag + ' Subkategori Pilihan Berbeda').toLowerCase(),
        parentId: selectedCategory.classificationNodeId,
        workspaceId, isActive: true,
      },
    });
    nodeIds.push(wrongSubcategory.id);
    await prisma.projectClassificationSelection.create({
      data: { projectId, classificationNodeId: wrongSubcategory.id },
    });
    try {
      const wrongSub = await request(app.getHttpServer())
        .post('/projects/' + projectId +
          '/ahsp-occurrences/boq-items/working-draft/auto-bind-explicit-references?page=7&limit=1')
        .set('Authorization', 'Bearer ' + editorToken)
        .send({ businessPricingAsOfDate: asOfDate })
        .expect(201);
      expect(wrongSub.body.summary.UNCODED_EXACT_WORK_NOT_PROVEN).toBe(1);
      expect(wrongSub.body.automaticBindingPerformed).toBe(false);
      expect(await prisma.projectAhspOccurrence.count({
        where: { projectId },
      })).toBe(0);
    } finally {
      await prisma.projectClassificationSelection.deleteMany({
        where: {
          projectId,
          classificationNodeId: wrongSubcategory.id,
        },
      });
    }

    const chosen = await request(app.getHttpServer())
      .post(
        `/projects/${projectId}/ahsp-occurrences/boq-items/working-draft/auto-bind-explicit-references`,
      )
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ businessPricingAsOfDate: asOfDate })
      .expect(201);
    expect(chosen.body.summary.FIRST_ASSOCIATION_PROVEN_AND_LINKED).toBe(
      lines.length,
    );
    expect(chosen.body.summary.FIRST_UNCODED_EXACT_WORK_LINKED).toBe(1);
    expect(chosen.body.automaticBindingPerformed).toBe(true);
    expect(
      await prisma.projectAhspOccurrence.count({ where: { projectId } }),
    ).toBe(lines.length + 1);

    const calculated = await request(app.getHttpServer())
      .post(`/projects/${projectId}/rab/auto-price-ready?page=1&limit=25`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ calculationAsOfDate: asOfDate })
      .expect(201);
    expect(calculated.body.counts.calculatedAndPersisted).toBe(lines.length + 1);

    const saved = await prisma.boqItem.findMany({
      where: { boqStructureId: structureId, itemType: 'WORK_ITEM' },
    });
    expect(saved).toHaveLength(lines.length + 1);
    let storedTotal = 0;
    for (const line of lines) {
      const item = saved.find((row) => row.name === line.description);
      expect(item).toBeDefined();
      expect(item).toMatchObject({
        sourceAhspCode: line.code,
        priceOrigin: 'SERVER_COST_KERNEL',
        workingOccurrenceId: null,
      });
      expect(item!.ahspVersionId).toBe(versionIds[lines.indexOf(line)]);
      expect(item!.calculationOccurrenceId).not.toBeNull();
      expect(item!.unitPrice?.toFixed(2)).toBe(line.expectedUnit);
      expect(item!.lineTotal?.toFixed(2)).toBe(line.expectedTotal);
      storedTotal += Number(item!.lineTotal!.toFixed(2));
    }
    const uncodedSaved = saved.find((row) =>
      row.name === uncodedLine.description);
    expect(uncodedSaved).toBeDefined();
    expect(uncodedSaved?.sourceAhspCode).toBeNull();
    expect(uncodedSaved?.ahspVersionId).toBe(versionIds[lines.length]);
    expect(uncodedSaved?.priceOrigin).toBe('SERVER_COST_KERNEL');
    expect(uncodedSaved?.unitPrice?.toFixed(2)).toBe(uncodedLine.expectedUnit);
    expect(uncodedSaved?.lineTotal?.toFixed(2)).toBe(uncodedLine.expectedTotal);
    storedTotal += Number(uncodedSaved?.lineTotal?.toFixed(2));
    expect(storedTotal.toFixed(2)).toBe(expectedProjectTotal);
    expect(await prisma.aHSP.count({ where: { id: { in: ahspIds } } })).toBe(
      lines.length + 1,
    );

    // Recreate the ACTUAL NestJS application; re-read and independently
    // recompute ALL six rows via the protected product verification API.
    await app.close();
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.init();
    const officialDraft = await request(app.getHttpServer())
      .get(`/projects/${projectId}/boq/draft`)
      .set('Authorization', `Bearer ${editorToken}`)
      .expect(200);
    expect(
      officialDraft.body.items.filter(
        (row: { itemType: string }) => row.itemType === 'WORK_ITEM',
      ),
    ).toHaveLength(lines.length + 1);
    expect(officialDraft.body.recap).toMatchObject({
      pricingStatus: 'COMPLETE',
      subtotal: expectedProjectTotal,
      marginPercent: '10.00',
      marginAmount: '1270000.00',
      taxPercent: '11.00',
      taxAmount: '1536700.00',
      grandTotal: '15506700.00',
    });
    let verifiedTotal = 0;
    for (const line of lines) {
      const item = saved.find((row) => row.name === line.description)!;
      const response = await request(app.getHttpServer())
        .get(
          `/projects/${projectId}/boq/items/${item.id}/persisted-calculation`,
        )
        .set('Authorization', `Bearer ${editorToken}`)
        .expect(200);
      expect(response.body).toMatchObject({
        status: 'VERIFIED',
        priceOrigin: 'SERVER_COST_KERNEL',
        stored: {
          unitPrice: line.expectedUnit,
          lineTotal: line.expectedTotal,
          unit: 'Kg',
        },
        recomputed: {
          unitPrice: line.expectedUnit,
          lineTotal: line.expectedTotal,
        },
        integrity: {
          unitPriceMatches: true,
          lineTotalMatches: true,
          allResourceCostsReproduced: true,
        },
      });
      expect(response.body.resources).toHaveLength(1);
      expect(response.body.resources[0].selectedBasicPriceId).toBe(
        basicPriceId,
      );
      verifiedTotal += Number(response.body.stored.lineTotal);
    }
    const persistedUncoded = await request(app.getHttpServer())
      .get('/projects/' + projectId + '/boq/items/' +
        uncodedSaved!.id + '/persisted-calculation')
      .set('Authorization', 'Bearer ' + editorToken)
      .expect(200);
    expect(persistedUncoded.body).toMatchObject({
      status: 'VERIFIED', priceOrigin: 'SERVER_COST_KERNEL',
      stored: { unitPrice: '200000.00', lineTotal: '400000.00' },
      recomputed: { unitPrice: '200000.00', lineTotal: '400000.00' },
      integrity: {
        unitPriceMatches: true, lineTotalMatches: true,
        allResourceCostsReproduced: true,
      },
    });
    verifiedTotal += Number(persistedUncoded.body.stored.lineTotal);
    expect(verifiedTotal.toFixed(2)).toBe(expectedProjectTotal);

    // Full-replace draft save must not preserve an already-priced AHSP when
    // the work description/specification changes. No protected row may
    // silently inherit the old amount or occurrence.
    const renamedAttempt = await request(app.getHttpServer())
      .put('/projects/' + projectId + '/boq/draft')
      .set('Authorization', 'Bearer ' + editorToken)
      .send({
        rows: officialDraft.body.items.map((row: {
          id: string; itemType: string; name: string; wbsCode: string;
          quantity: string; unit: string; sortOrder: number;
        }) => ({
          tempId: row.id, itemType: row.itemType,
          name: row.id === uncodedSaved!.id
            ? uncodedLine.description + ' Tipe Khusus'
            : row.name,
          wbsCode: row.wbsCode, quantity: Number(row.quantity),
          unit: row.unit, sortOrder: row.sortOrder,
        })),
      })
      .expect(409);
    expect(renamedAttempt.body.message).toBe(
      'SERVER_ROW_INPUT_CHANGED_REQUIRES_RECALCULATION',
    );
    const protectedUncoded = await prisma.boqItem.findUniqueOrThrow({
      where: { id: uncodedSaved!.id },
    });
    expect(protectedUncoded.name).toBe(uncodedLine.description);
    expect(protectedUncoded.priceOrigin).toBe('SERVER_COST_KERNEL');
    expect(protectedUncoded.lineTotal?.toFixed(2)).toBe('400000.00');

    const repeated = await request(app.getHttpServer())
      .post(`/projects/${projectId}/rab/auto-price-ready?page=1&limit=25`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ calculationAsOfDate: asOfDate })
      .expect(201);
    expect(repeated.body.results).toHaveLength(lines.length + 1);
    expect(
      repeated.body.results.every(
        (row: { status: string }) => row.status === 'ALREADY_CALCULATED',
      ),
    ).toBe(true);
    expect(
      await prisma.projectAhspOccurrence.count({ where: { projectId } }),
    ).toBe(lines.length + 1);
  }, 120000);

  it('preserves imported AHSP source references through an unchanged Working Draft save and fresh readback', async () => {
    const before = await request(app.getHttpServer())
      .get('/projects/' + projectId + '/boq/draft')
      .set('Authorization', 'Bearer ' + editorToken).expect(200);
    expect(before.body.items.filter((row: { itemType: string }) =>
      row.itemType === 'WORK_ITEM')).toHaveLength(lines.length + 1);
    const saved = await request(app.getHttpServer())
      .put('/projects/' + projectId + '/boq/draft')
      .set('Authorization', 'Bearer ' + editorToken)
      .send({ rows: before.body.items.map((row: {
        id: string; itemType: string; name: string; wbsCode: string;
        quantity: string; unit: string; sortOrder: number;
      }) => ({
        tempId: row.id, itemType: row.itemType, name: row.name,
        wbsCode: row.wbsCode, quantity: Number(row.quantity),
        unit: row.unit, sortOrder: row.sortOrder,
        // Source code is intentionally NOT writable by the client.
      })) }).expect(200);
    for (const line of lines) {
      const row = saved.body.items.find((v: { name: string }) => v.name === line.description);
      expect(row?.sourceAhspCode).toBe(line.code);
      expect(row?.priceOrigin).toBe('SERVER_COST_KERNEL');
      expect(Number(row?.lineTotal).toFixed(2)).toBe(line.expectedTotal);
    }
    const readback = await request(app.getHttpServer())
      .get('/projects/' + projectId + '/boq/draft')
      .set('Authorization', 'Bearer ' + editorToken).expect(200);
    for (const line of lines) {
      const row = readback.body.items.find((v: { name: string }) => v.name === line.description);
      expect(row?.sourceAhspCode).toBe(line.code);
      expect(Number(row?.lineTotal).toFixed(2)).toBe(line.expectedTotal);
    }
    // New row IDs/timestamps do not silently renew prior import approval.
    const postSaveBind = await request(app.getHttpServer())
      .post('/projects/' + projectId +
        '/ahsp-occurrences/boq-items/working-draft/auto-bind-explicit-references')
      .set('Authorization', 'Bearer ' + editorToken)
      .send({ businessPricingAsOfDate: asOfDate }).expect(201);
    expect(postSaveBind.body.automaticBindingPerformed).toBe(false);
  }, 120000);
  it('reuses a previously governed AHSP decision for a NO-CODE legacy BOQ and persists RAB via real HTTP and PostgreSQL', async () => {
    const source = await prisma.boqItem.create({
      data: {
        boqStructureId: structureId, wbsNodeId: null, wbsCode: '9.9',
        name: lines[0].description, quantity: '1', unit: 'Kg',
        sortOrder: 900, itemType: 'WORK_ITEM', sourceAhspCode: null,
      },
    });
    const target = await prisma.boqItem.create({
      data: {
        boqStructureId: structureId, wbsNodeId: null, wbsCode: '9.9',
        name: 'Pek. ' + lines[0].description, quantity: '2', unit: 'Kg',
        sortOrder: 901, itemType: 'WORK_ITEM', sourceAhspCode: null,
      },
    });
    // Only the source is selected once by an authorized actor.
    const chosen = await request(app.getHttpServer())
      .post('/projects/' + projectId + '/ahsp-occurrences/boq-items/' +
        source.id + '/select-ahsp')
      .set('Authorization', 'Bearer ' + editorToken)
      .send({
        ahspVersionId: versionIds[0],
        businessPricingAsOfDate: asOfDate,
        referenceRegionId: regionId,
        idempotencyKey: tag + '-legacy-human-source',
      })
      .expect(201);
    expect(chosen.body.id).toBeTruthy();
    const untouched = await prisma.boqItem.findUniqueOrThrow({
      where: { id: target.id },
    });
    expect(untouched).toMatchObject({
      ahspVersionId: null, workingOccurrenceId: null, sourceAhspCode: null,
    });

    // A second prior decision whose description differs ONLY by spaces
    // MUST be counted, not hidden by a raw substring search.
    const competitor = await prisma.boqItem.create({ data: {
      boqStructureId: structureId, wbsNodeId: null, wbsCode: '9.9',
      name: lines[0].description.replace(' ', '   '),
      quantity: '1', unit: 'Kg', sortOrder: 902,
      itemType: 'WORK_ITEM', sourceAhspCode: null,
      ahspVersionId: versionIds[0], workingOccurrenceId: chosen.body.id,
    } });
    try {
      const refused = await request(app.getHttpServer())
        .post('/projects/' + projectId +
          '/ahsp-occurrences/boq-items/working-draft/auto-reuse-proven?page=1&limit=25')
        .set('Authorization', 'Bearer ' + editorToken)
        .send({ businessPricingAsOfDate: asOfDate }).expect(201);
      expect(refused.body.summary.MULTIPLE_SOURCE_DECISIONS).toBe(1);
      expect((await prisma.boqItem.findUniqueOrThrow({ where: { id: target.id } }))
        .workingOccurrenceId).toBeNull();
    } finally {
      await prisma.boqItem.delete({ where: { id: competitor.id } });
    }
    // Existing "Lengkapi Otomatis" route; no manual selection on target.
    const reused = await request(app.getHttpServer())
      .post('/projects/' + projectId +
        '/ahsp-occurrences/boq-items/working-draft/auto-reuse-proven?page=1&limit=25')
      .set('Authorization', 'Bearer ' + editorToken)
      .send({ businessPricingAsOfDate: asOfDate })
      .expect(201);
    expect(reused.body.summary.PROVEN_ASSOCIATION_REUSED).toBe(1);
    expect(reused.body.automaticBindingPerformed).toBe(true);
    const joined = await prisma.boqItem.findUniqueOrThrow({
      where: { id: target.id },
    });
    expect(joined.ahspVersionId).toBe(versionIds[0]);
    expect(joined.workingOccurrenceId).not.toBeNull();
    expect(joined.sourceAhspCode).toBeNull();

    // Existing Cost Kernel + RAB writer, no standalone price calculator.
    const priced = await request(app.getHttpServer())
      .post('/projects/' + projectId + '/rab/auto-price-ready?page=1&limit=25')
      .set('Authorization', 'Bearer ' + editorToken)
      .send({ calculationAsOfDate: asOfDate })
      .expect(201);
    expect(priced.body.counts.calculatedAndPersisted).toBe(2);
    const rows = await prisma.boqItem.findMany({
      where: { id: { in: [source.id, target.id] } },
    });
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === source.id)?.lineTotal?.toFixed(2))
      .toBe('200000.00');
    expect(rows.find((row) => row.id === target.id)?.unitPrice?.toFixed(2))
      .toBe('200000.00');
    expect(rows.find((row) => row.id === target.id)?.lineTotal?.toFixed(2))
      .toBe('400000.00');
    expect(rows.every((row) => row.priceOrigin === 'SERVER_COST_KERNEL'))
      .toBe(true);

    // Fresh Nest app, official persisted readback and idempotency proof.
    await app.close();
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.init();
    const verified = await request(app.getHttpServer())
      .get('/projects/' + projectId + '/boq/items/' + target.id +
        '/persisted-calculation')
      .set('Authorization', 'Bearer ' + editorToken)
      .expect(200);
    expect(verified.body).toMatchObject({
      status: 'VERIFIED', priceOrigin: 'SERVER_COST_KERNEL',
      stored: { unitPrice: '200000.00', lineTotal: '400000.00' },
      recomputed: { unitPrice: '200000.00', lineTotal: '400000.00' },
      integrity: {
        unitPriceMatches: true, lineTotalMatches: true,
        allResourceCostsReproduced: true,
      },
    });
    const repeated = await request(app.getHttpServer())
      .post('/projects/' + projectId + '/rab/auto-price-ready?page=1&limit=25')
      .set('Authorization', 'Bearer ' + editorToken)
      .send({ calculationAsOfDate: asOfDate })
      .expect(201);
    expect(repeated.body.counts.calculatedAndPersisted).toBe(0);
    expect(repeated.body.counts.alreadyCalculated).toBe(9);
  }, 120000);

  it('drops an UNPRICED stale AHSP occurrence after a work-spec edit while keeping completed RAB prices', async () => {
    const pending = await prisma.boqItem.create({
      data: {
        boqStructureId: structureId, wbsNodeId: null, wbsCode: '9.10',
        name: tag + ' Sambungan Pelat Baru Tipe A',
        quantity: '1', unit: 'Kg', sortOrder: 902,
        itemType: 'WORK_ITEM', sourceAhspCode: lines[0].code,
      },
    });
    await request(app.getHttpServer())
      .post('/projects/' + projectId + '/ahsp-occurrences/boq-items/' +
        pending.id + '/select-ahsp')
      .set('Authorization', 'Bearer ' + editorToken)
      .send({
        ahspVersionId: versionIds[0],
        businessPricingAsOfDate: asOfDate, referenceRegionId: regionId,
        idempotencyKey: tag + '-unpriced-to-edit',
      })
      .expect(201);
    const before = await prisma.boqItem.findUniqueOrThrow({
      where: { id: pending.id },
    });
    expect(before.workingOccurrenceId).not.toBeNull();
    expect(before.ahspVersionId).toBe(versionIds[0]);
    expect(before.priceOrigin).toBeNull();

    const draft = await request(app.getHttpServer())
      .get('/projects/' + projectId + '/boq/draft')
      .set('Authorization', 'Bearer ' + editorToken)
      .expect(200);
    const changedName = pending.name + ' Tebal 20 mm';
    const saved = await request(app.getHttpServer())
      .put('/projects/' + projectId + '/boq/draft')
      .set('Authorization', 'Bearer ' + editorToken)
      .send({
        rows: draft.body.items.map((row: {
          id: string; itemType: string; name: string; wbsCode: string;
          quantity: string; unit: string; sortOrder: number;
        }) => ({
          tempId: row.id, itemType: row.itemType,
          name: row.id === pending.id ? changedName : row.name,
          wbsCode: row.wbsCode, quantity: Number(row.quantity),
          unit: row.unit, sortOrder: row.sortOrder,
        })),
      })
      .expect(200);
    const changed = saved.body.items.find(
      (row: { name: string }) => row.name === changedName,
    );
    expect(changed).toBeTruthy();
    expect(changed).toMatchObject({
      ahspVersionId: null, workingOccurrenceId: null,
      sourceAhspCode: null,
      priceOrigin: null, unitPrice: null, lineTotal: null,
    });
    const preserved = saved.body.items.filter(
      (row: { priceOrigin: string | null }) =>
        row.priceOrigin === 'SERVER_COST_KERNEL',
    );
    expect(preserved).toHaveLength(lines.length + 3);
    expect(preserved.every((row: {
      ahspVersionId: string | null; lineTotal: string | null;
    }) => row.ahspVersionId && row.lineTotal !== null)).toBe(true);
  }, 120000);

  it('protects the full nested BOQ ancestor context over real Working Draft HTTP and PostgreSQL', async () => {
    const rootName = tag + ' Pekerjaan Beton Bertulang';
    const subName = tag + ' Pekerjaan Permukaan';
    const childName = tag + ' Pengecatan Permukaan';
    const root = await prisma.boqItem.create({
      data: {
        boqStructureId: structureId, wbsNodeId: null, wbsCode: 'Z',
        name: rootName, itemType: 'FOLDER', parentId: null,
        quantity: '0', unit: '', sortOrder: 2000,
      },
    });
    const sub = await prisma.boqItem.create({
      data: {
        boqStructureId: structureId, wbsNodeId: null, wbsCode: 'Z.1',
        name: subName, itemType: 'FOLDER', parentId: root.id,
        quantity: '0', unit: '', sortOrder: 0,
      },
    });
    const child = await prisma.boqItem.create({
      data: {
        boqStructureId: structureId, wbsNodeId: null, wbsCode: 'Z.1.1',
        name: childName, itemType: 'WORK_ITEM', parentId: sub.id,
        quantity: '1', unit: 'Kg', sortOrder: 0,
        sourceAhspCode: lines[0].code,
      },
    });
    const selection = await request(app.getHttpServer())
      .post('/projects/' + projectId + '/ahsp-occurrences/boq-items/' +
        child.id + '/select-ahsp')
      .set('Authorization', 'Bearer ' + editorToken)
      .send({
        ahspVersionId: versionIds[0],
        businessPricingAsOfDate: asOfDate,
        referenceRegionId: regionId,
        idempotencyKey: tag + '-nested-ancestor-source',
      }).expect(201);
    expect(selection.body.id).toBeTruthy();
    const canonicalSaveRows = (items: Array<{
      id: string; parentId: string | null; itemType: string;
      name: string; wbsCode: string; quantity: string;
      unit: string; sortOrder: number;
    }>, renamedId?: string, renamedName?: string) =>
      items.map((row) => ({
        tempId: row.id, parentTempId: row.parentId,
        itemType: row.itemType,
        name: row.id === renamedId ? renamedName : row.name,
        wbsCode: row.wbsCode, quantity: Number(row.quantity),
        unit: row.unit, sortOrder: row.sortOrder,
      }));
    const initial = await request(app.getHttpServer())
      .get('/projects/' + projectId + '/boq/draft')
      .set('Authorization', 'Bearer ' + editorToken).expect(200);
    const unchanged = await request(app.getHttpServer())
      .put('/projects/' + projectId + '/boq/draft')
      .set('Authorization', 'Bearer ' + editorToken)
      .send({ rows: canonicalSaveRows(initial.body.items) })
      .expect(200);
    const unchangedChild = unchanged.body.items.find(
      (row: { name: string }) => row.name === childName,
    );
    expect(unchangedChild).toBeTruthy();
    expect(unchangedChild.sourceAhspCode).toBe(lines[0].code);
    expect(unchangedChild.ahspVersionId).toBe(versionIds[0]);
    expect(unchangedChild.workingOccurrenceId).not.toBeNull();

    const changedRoot = unchanged.body.items.find(
      (row: { name: string }) => row.name === rootName,
    );
    const modified = await request(app.getHttpServer())
      .put('/projects/' + projectId + '/boq/draft')
      .set('Authorization', 'Bearer ' + editorToken)
      .send({
        rows: canonicalSaveRows(
          unchanged.body.items,
          changedRoot.id, tag + ' Pekerjaan Tanah dan Galian',
        ),
      }).expect(200);
    const invalidated = modified.body.items.find(
      (row: { name: string }) => row.name === childName,
    );
    expect(invalidated).toBeTruthy();
    expect(invalidated).toMatchObject({
      sourceAhspCode: null,
      ahspVersionId: null,
      workingOccurrenceId: null,
      priceOrigin: null,
      unitPrice: null,
      lineTotal: null,
    });
    const healthy = modified.body.items.filter(
      (row: { priceOrigin: string | null }) =>
        row.priceOrigin === 'SERVER_COST_KERNEL',
    );
    expect(healthy).toHaveLength(lines.length + 3);
    expect(healthy.every((row: { lineTotal: string | null }) =>
      row.lineTotal !== null)).toBe(true);
  }, 120000);
});
