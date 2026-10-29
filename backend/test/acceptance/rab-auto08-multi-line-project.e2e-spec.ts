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
  const description = lines[0].description;
  const expectedProjectTotal = lines
    .reduce((sum, line) => sum + Number(line.expectedTotal), 0)
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

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('RAB');
    sheet.addRow(['No', 'Uraian Pekerjaan', 'Volume', 'Satuan', 'Kode AHSP']);
    for (const line of lines) {
      sheet.addRow([line.wbs, line.description, line.qty, 'Kg', line.code]);
    }
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

  it('completes all six jobs, verifies project total from persisted RAB after fresh app and prevents duplicate writes', async () => {
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
    expect(imported).toHaveLength(lines.length);
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
    ).toHaveLength(lines.length);
    expect(initialDraft.body.recap).toMatchObject({
      pricingStatus: 'INCOMPLETE',
      grandTotal: null,
      subtotal: null,
    });

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
      expect(blocked.body.summary.PRICE_REGION_NOT_UNIQUE).toBe(lines.length);
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
    expect(chosen.body.automaticBindingPerformed).toBe(true);
    expect(
      await prisma.projectAhspOccurrence.count({ where: { projectId } }),
    ).toBe(lines.length);

    const calculated = await request(app.getHttpServer())
      .post(`/projects/${projectId}/rab/auto-price-ready?page=1&limit=25`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ calculationAsOfDate: asOfDate })
      .expect(201);
    expect(calculated.body.counts.calculatedAndPersisted).toBe(lines.length);

    const saved = await prisma.boqItem.findMany({
      where: { boqStructureId: structureId, itemType: 'WORK_ITEM' },
    });
    expect(saved).toHaveLength(lines.length);
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
    expect(storedTotal.toFixed(2)).toBe(expectedProjectTotal);
    expect(await prisma.aHSP.count({ where: { id: { in: ahspIds } } })).toBe(
      lines.length,
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
    ).toHaveLength(lines.length);
    expect(officialDraft.body.recap).toMatchObject({
      pricingStatus: 'COMPLETE',
      subtotal: expectedProjectTotal,
      marginPercent: '10.00',
      marginAmount: '1230000.00',
      taxPercent: '11.00',
      taxAmount: '1488300.00',
      grandTotal: '15018300.00',
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
    expect(verifiedTotal.toFixed(2)).toBe(expectedProjectTotal);
    const repeated = await request(app.getHttpServer())
      .post(`/projects/${projectId}/rab/auto-price-ready?page=1&limit=25`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ calculationAsOfDate: asOfDate })
      .expect(201);
    expect(repeated.body.results).toHaveLength(lines.length);
    expect(
      repeated.body.results.every(
        (row: { status: string }) => row.status === 'ALREADY_CALCULATED',
      ),
    ).toBe(true);
    expect(
      await prisma.projectAhspOccurrence.count({ where: { projectId } }),
    ).toBe(lines.length);
  }, 120000);
});
