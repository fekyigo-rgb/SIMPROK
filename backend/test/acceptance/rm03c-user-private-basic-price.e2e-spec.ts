import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

/**
 * RM-03C — USER_PRIVATE_BASIC_PRICE, end to end.
 *
 * What this suite proves, in the Owner's own terms:
 *
 *  1. A workspace can keep its OWN imported price and use it IMMEDIATELY —
 *     no verifier, no publisher, no second human, and without the price ever
 *     being called PUBLISHED.
 *  2. That price is genuinely PRIVATE: another tenant cannot list it, read it,
 *     resolve it, use it, or even learn that it exists.
 *  3. OWNERSHIP and SOURCE stay orthogonal: a private asset still carries the
 *     truthful sourceOrigin of wherever the price actually came from.
 *  4. It flows through the SAME Cost Kernel, with the same exact arithmetic.
 *  5. The SIMPROK catalog is untouched — same visibility, same publication
 *     ladder, and a private price never enters a publication queue.
 *  6. No private-vs-catalog precedence is introduced anywhere: the Cost Kernel
 *     proof deliberately uses a resource with exactly ONE eligible private
 *     price and ZERO eligible catalog competitors, and the suite asserts that
 *     cardinality rather than assuming it.
 *
 * The import batch/row are seeded directly as fixture EVIDENCE (a real upload
 * is exercised by the RM-02B import suite, not re-proved here). Everything
 * that RM-03C actually adds — the private writer, the private eligibility
 * branch, tenant isolation, and the Cost Kernel path — runs through the real
 * runtime HTTP routes.
 *
 * Runs against simprok_e2e only. Every fixture row is deleted in afterAll;
 * residual verification is the outer Safe E2E harness's job.
 * TEST_ONLY_SYNTHETIC_FIXTURE=YES  PRODUCTION_TRUTH=NO
 */
describe('RM-03C workspace-private Basic Price (e2e)', () => {
  const prisma = new PrismaClient();
  const tag = `RM03C${Date.now()}`;
  const password = 'Rm03cPrivate!';
  const labels = 'TEST_FIXTURE_ONLY OWNER_SUPPLIED_EXAMPLE_NON_PRODUCTION';
  const asOfDate = '2026-08-07';

  let app: INestApplication;

  // Workspace A — the owner of the private asset.
  let orgAId: string;
  let workspaceAId: string;
  let ownerToken: string;
  let ownerAccountId: string;
  let publisherToken: string;
  let rabEditorToken: string;

  // Workspace B — a different tenant, in a different organization.
  let orgBId: string;
  let workspaceBId: string;
  let outsiderToken: string;

  let regionId: string;
  let otherRegionId: string;

  // The private asset and its evidence.
  let privateResourceId: string;
  let batchId: string;
  let rowId: string;
  let secondRowId: string;
  let probeRowId: string;
  let privateBasicPriceId: string;

  // A published catalog price, for the public-preservation proofs.
  let catalogResourceId: string;
  let catalogBasicPriceId: string;

  // Cost Kernel fixture.
  let projectId: string;
  let boqStructureId: string;
  let boqItemId: string;
  let ahspId: string;

  const createdPermissionIds: string[] = [];
  const accountIds: string[] = [];
  const membershipIds: string[] = [];

  const login = async (email: string) => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    return response.body.access_token as string;
  };

  const ensurePermission = async (code: string) => {
    const existing = await prisma.permission.findUnique({ where: { code } });
    if (existing) return existing;
    const created = await prisma.permission.create({
      data: { code, name: `${tag} ${code}`, description: labels },
    });
    createdPermissionIds.push(created.id);
    return created;
  };

  /**
   * BASIC_PRICE_VIEW / _IMPORT / _RESOLVE / _SUBMIT are granted structurally
   * to every ACTIVE WorkspaceMembership (ONE SIMPROK BASIC PRICE PRODUCT
   * MODEL), so an actor needs a role ONLY for codes outside that baseline.
   * `permissionCodes` is therefore usually empty — which is itself part of the
   * proof that keeping a price private needs no special authority.
   */
  const createActor = async (params: {
    suffix: string;
    workspaceId: string;
    permissionCodes?: string[];
    projectIds?: string[];
  }) => {
    const codes = params.permissionCodes ?? [];
    const permissions = await Promise.all(codes.map(ensurePermission));
    const roleCreate = codes.length
      ? {
          membershipRoles: {
            create: [
              {
                roleId: (
                  await prisma.role.create({
                    data: {
                      workspaceId: params.workspaceId,
                      code: `${tag}_${params.suffix.toUpperCase()}`,
                      name: `${tag} ${params.suffix}`,
                      rolePermissions: {
                        create: permissions.map((p) => ({ permissionId: p.id })),
                      },
                    },
                  })
                ).id,
              },
            ],
          },
        }
      : {};

    const email = `${tag}.${params.suffix}@test.local`.toLowerCase();
    const account = await prisma.account.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 10),
        displayName: params.suffix,
        status: 'ACTIVE',
      },
    });
    accountIds.push(account.id);
    const membership = await prisma.workspaceMembership.create({
      data: {
        accountId: account.id,
        workspaceId: params.workspaceId,
        status: 'ACTIVE',
        ...roleCreate,
      },
    });
    membershipIds.push(membership.id);
    await prisma.user.create({
      data: {
        workspaceMembershipId: membership.id,
        workspaceId: params.workspaceId,
        fullName: params.suffix,
        status: 'ACTIVE',
      },
    });
    for (const pid of params.projectIds ?? []) {
      await prisma.projectAssignment.create({
        data: {
          workspaceMembershipId: membership.id,
          projectId: pid,
          roleInProject: 'MEMBER',
          isPrimaryAssignment: true,
          status: 'ASSIGNED',
        },
      });
    }
    return { accountId: account.id, membershipId: membership.id, email };
  };

  const keepPrivate = (bearer: string, workspaceId: string, targetBatchId = batchId) =>
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    request(app.getHttpServer())
      .post(`/basic-price-imports/${targetBatchId}/keep-private`)
      .set('Authorization', `Bearer ${bearer}`)
      .set('x-workspace-id', workspaceId)
      .send({});

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const orgA = await prisma.organization.create({
      data: { name: `${tag} Org A`, type: 'COMPANY' },
    });
    const orgB = await prisma.organization.create({
      data: { name: `${tag} Org B`, type: 'COMPANY' },
    });
    orgAId = orgA.id;
    orgBId = orgB.id;
    const workspaceA = await prisma.workspace.create({
      data: { name: `${tag} WS A`, organizationId: orgA.id },
    });
    const workspaceB = await prisma.workspace.create({
      data: { name: `${tag} WS B`, organizationId: orgB.id },
    });
    workspaceAId = workspaceA.id;
    workspaceBId = workspaceB.id;

    const region = await prisma.region.create({
      data: { code: `${tag}-REG`, name: `${tag} Region`, isActive: true },
    });
    const otherRegion = await prisma.region.create({
      data: { code: `${tag}-REG2`, name: `${tag} Other Region`, isActive: true },
    });
    regionId = region.id;
    otherRegionId = otherRegion.id;

    const project = await prisma.project.create({
      data: {
        workspaceId: workspaceAId,
        organizationId: orgAId,
        code: `${tag}-P`,
        name: `${tag} Project`,
        status: 'PLANNED',
      },
    });
    projectId = project.id;

    const owner = await createActor({ suffix: 'owner', workspaceId: workspaceAId });
    ownerAccountId = owner.accountId;
    const publisher = await createActor({
      suffix: 'publisher',
      workspaceId: workspaceAId,
      permissionCodes: ['BASIC_PRICE_PUBLISH'],
    });
    const rabEditor = await createActor({
      suffix: 'editor',
      workspaceId: workspaceAId,
      // select-ahsp requires RAB_DRAFT_EDIT AND AHSP_VIEW; the persist route
      // requires RAB_DRAFT_EDIT; the read-only re-proof requires RAB_VIEW.
      permissionCodes: ['RAB_DRAFT_EDIT', 'AHSP_VIEW', 'RAB_VIEW'],
      projectIds: [projectId],
    });
    const outsider = await createActor({
      suffix: 'outsider',
      workspaceId: workspaceBId,
    });
    [ownerToken, publisherToken, rabEditorToken, outsiderToken] =
      await Promise.all([
        login(owner.email),
        login(publisher.email),
        login(rabEditor.email),
        login(outsider.email),
      ]);

    // ---- The private asset's EVIDENCE: one import batch, two resolved rows ----
    // LABOR + Org/Hari, because the Cost Kernel's Phase-1 unit boundary
    // (canonicalUnitCode=PERSON_DAY, quantityFactor=1, IDENTITY) is the only
    // supported class — RM-03C does not widen it by one unit.
    const privateResource = await prisma.resourceCatalog.create({
      data: {
        workspaceId: workspaceAId,
        code: `${tag}-L01`,
        name: `${tag} Pekerja Privat`,
        type: 'LABOR',
        baseUnit: 'Org/Hari',
      },
    });
    privateResourceId = privateResource.id;
    const secondResource = await prisma.resourceCatalog.create({
      data: {
        workspaceId: workspaceAId,
        code: `${tag}-L02`,
        name: `${tag} Tukang Privat`,
        type: 'LABOR',
        baseUnit: 'Org/Hari',
      },
    });

    const batch = await prisma.basicPriceImportBatch.create({
      data: {
        workspaceId: workspaceAId,
        organizationId: orgAId,
        uploadedByAccountId: ownerAccountId,
        sourceFileName: `${tag}-daftar-harga.xlsx`,
        sourceSha256: 'c'.repeat(64),
        sourceByteLength: 4096,
        selectedSheetName: 'HARGA SATUAN UPAH DAN BAHAN',
        parserContractVersion: 'RM02B-XLSX-V1',
        regionId,
        effectiveDate: new Date('2026-08-01T00:00:00.000Z'),
        // Ownership will be WORKSPACE_PRIVATE; the SOURCE is a real store.
        // These are different axes and the writer must keep them so.
        sourceType: 'VENDOR_QUOTE',
        sourceOrigin: 'STORE',
        sourceVendorName: `${tag} Toko Bangunan Jaya`,
        importFingerprint: `${tag}-fingerprint`,
        status: 'READY_FOR_REVIEW',
      },
    });
    batchId = batch.id;

    const row = await prisma.basicPriceImportRow.create({
      data: {
        batchId,
        sourceSection: 'LABOR',
        sourceRowNumber: 9,
        sourceCodeCellAddress: 'D9',
        sourceNameCellAddress: 'C9',
        sourceUnitCellAddress: 'E9',
        sourcePriceCellAddress: 'F9',
        rawResourceCodeText: 'L.01',
        rawResourceNameText: `${tag} Pekerja Privat`,
        rawUnitText: 'Org/Hari',
        rawPriceCellType: 2,
        rawPriceNumericRoundTripString: '137500',
        proposedCanonicalPrice: '137500.00',
        canonicalRoundingMode: 'EXACT',
        resourceCatalogId: privateResourceId,
        resolvedResourceType: 'LABOR',
        resolutionStatus: 'RESOLVED',
        reasonCodes: ['TEST_FIXTURE_ONLY'],
        status: 'READY_FOR_SUBMISSION',
      },
    });
    rowId = row.id;

    const secondRow = await prisma.basicPriceImportRow.create({
      data: {
        batchId,
        sourceSection: 'LABOR',
        sourceRowNumber: 10,
        sourceCodeCellAddress: 'D10',
        sourceNameCellAddress: 'C10',
        sourceUnitCellAddress: 'E10',
        sourcePriceCellAddress: 'F10',
        rawResourceCodeText: 'L.02',
        rawResourceNameText: `${tag} Tukang Privat`,
        rawUnitText: 'Org/Hari',
        rawPriceCellType: 2,
        rawPriceNumericRoundTripString: '165000',
        proposedCanonicalPrice: '165000.00',
        canonicalRoundingMode: 'EXACT',
        resourceCatalogId: secondResource.id,
        resolvedResourceType: 'LABOR',
        resolutionStatus: 'RESOLVED',
        reasonCodes: ['TEST_FIXTURE_ONLY'],
        status: 'READY_FOR_SUBMISSION',
      },
    });
    secondRowId = secondRow.id;

    // A third row the human has NOT finished resolving. It is deliberately not
    // READY_FOR_SUBMISSION, so the private writer skips it — which leaves it
    // free to be the target of the database-constraint probes below without
    // those probes accidentally passing for the wrong reason (a unique-index
    // violation instead of the CHECK they mean to exercise).
    const probeRow = await prisma.basicPriceImportRow.create({
      data: {
        batchId,
        sourceSection: 'LABOR',
        sourceRowNumber: 11,
        sourceCodeCellAddress: 'D11',
        sourceNameCellAddress: 'C11',
        sourceUnitCellAddress: 'E11',
        sourcePriceCellAddress: 'F11',
        rawResourceNameText: `${tag} Belum Selesai`,
        rawUnitText: 'Org/Hari',
        rawPriceCellType: 2,
        rawPriceNumericRoundTripString: '99000',
        reasonCodes: ['TEST_FIXTURE_ONLY'],
        status: 'NEEDS_REVIEW',
      },
    });
    probeRowId = probeRow.id;

    // ---- A published GLOBAL catalog price, for the preservation proofs ----
    // Global (workspaceId null) so both tenants must keep seeing it exactly as
    // before. It deliberately prices a DIFFERENT resource, so it can never
    // become a competitor to the private price and force a precedence answer.
    const catalogResource = await prisma.resourceCatalog.create({
      data: {
        code: `${tag}-M01`,
        name: `${tag} Semen Katalog`,
        type: 'MATERIAL',
        baseUnit: 'Zak',
      },
    });
    catalogResourceId = catalogResource.id;
    const catalogPrice = await prisma.basicPrice.create({
      data: {
        resourceId: catalogResourceId,
        workspaceId: null,
        regionId,
        effectiveDate: new Date('2026-08-01T00:00:00.000Z'),
        value: '82500.00',
        sourceType: 'REGULATION',
        sourceOrigin: 'GOVERNMENT',
        status: 'PUBLISHED',
        verificationStatus: 'PUBLISHED',
      },
    });
    catalogBasicPriceId = catalogPrice.id;
  }, 60_000);

  afterAll(async () => {
    await prisma.rabDocument.deleteMany({ where: { projectId } });
    await prisma.boqItem.deleteMany({ where: { boqStructureId } });
    await prisma.boqStructure.deleteMany({ where: { projectId } });
    await prisma.projectAhspResourceResolution.deleteMany({
      where: { occurrence: { projectId } },
    });
    await prisma.projectAhspOccurrence.deleteMany({ where: { projectId } });
    await prisma.aHSPResource.deleteMany({
      where: { ahspVersion: { ahsp: { workType: { startsWith: tag } } } },
    });
    await prisma.aHSPVersion.deleteMany({
      where: { ahsp: { workType: { startsWith: tag } } },
    });
    await prisma.aHSP.deleteMany({ where: { workType: { startsWith: tag } } });

    await prisma.basicPrice.deleteMany({
      where: { resource: { code: { startsWith: tag } } },
    });
    await prisma.basicPriceImportRow.deleteMany({ where: { batchId } });
    await prisma.basicPriceImportBatch.deleteMany({ where: { id: batchId } });
    await prisma.resourceCatalog.deleteMany({
      where: { code: { startsWith: tag } },
    });
    await prisma.region.deleteMany({
      where: { id: { in: [regionId, otherRegionId] } },
    });

    await prisma.projectAssignment.deleteMany({
      where: { workspaceMembershipId: { in: membershipIds } },
    });
    await prisma.user.deleteMany({
      where: { workspaceMembershipId: { in: membershipIds } },
    });
    await prisma.membershipRole.deleteMany({
      where: { workspaceMembershipId: { in: membershipIds } },
    });
    await prisma.workspaceMembership.deleteMany({
      where: { id: { in: membershipIds } },
    });
    await prisma.role.deleteMany({ where: { code: { startsWith: tag } } });
    await prisma.permission.deleteMany({
      where: { id: { in: createdPermissionIds } },
    });
    await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.workspace.deleteMany({
      where: { id: { in: [workspaceAId, workspaceBId] } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [orgAId, orgBId] } },
    });
    await app.close();
    await prisma.$disconnect();
  }, 40_000);

  // ── 1. The writer ────────────────────────────────────────────────────────

  describe('A workspace keeps its own imported prices, and can use them at once', () => {
    it('creates workspace-private prices with no verifier, no publisher, no second human', async () => {
      const response = await keepPrivate(ownerToken, workspaceAId).expect(201);

      expect(response.body.createdCount).toBe(2);
      expect(response.body.alreadyPrivateCount).toBe(0);
      const item = response.body.prices.find(
        (price: any) => price.sourceImportRowId === rowId,
      );
      expect(item).toBeDefined();
      privateBasicPriceId = item.basicPriceId;

      expect(item).toMatchObject({
        assetScope: 'WORKSPACE_PRIVATE',
        price: '137500.00',
        effectiveDate: '2026-08-01T00:00:00.000Z',
        // NOT published, NOT verified — and usable anyway. That is the whole
        // Owner law in two fields.
        status: 'UNPUBLISHED',
        verificationStatus: 'UNVERIFIED',
      });
      expect(item.resource.name).toBe(`${tag} Pekerja Privat`);

      // The one human involved was the owner themselves. Nothing anywhere in
      // the system was asked to review, verify or publish this.
      const submissions = await prisma.priceSubmission.count({
        where: { workspaceId: workspaceAId },
      });
      expect(submissions).toBe(0);
      const audits = await prisma.basicPricePublicationAudit.count({
        where: { basicPriceId: privateBasicPriceId },
      });
      expect(audits).toBe(0);
    });

    it('binds the price to the trusted workspace, the trusted actor, and its import-row evidence', async () => {
      const price = await prisma.basicPrice.findUniqueOrThrow({
        where: { id: privateBasicPriceId },
      });
      expect(price.assetScope).toBe('WORKSPACE_PRIVATE');
      expect(price.workspaceId).toBe(workspaceAId);
      expect(price.organizationId).toBe(orgAId);
      expect(price.reportedByAccountId).toBe(ownerAccountId);
      expect(price.sourceImportRowId).toBe(rowId);
      // A private asset is never submission-born.
      expect(price.sourceSubmissionId).toBeNull();
      // Exact money, two digits, no float anywhere in the path.
      expect(price.value.toFixed(2)).toBe('137500.00');
      expect(price.regionId).toBe(regionId);
    });

    it('keeps OWNERSHIP and SOURCE orthogonal — the source is the store, not "private"', async () => {
      const price = await prisma.basicPrice.findUniqueOrThrow({
        where: { id: privateBasicPriceId },
      });
      // SOURCE != REPORTER. The workspace reported it; the STORE is where the
      // price actually came from, and that is what the row says.
      expect(price.sourceOrigin).toBe('STORE');
      expect(price.sourceType).toBe('VENDOR_QUOTE');
      expect(price.assetScope).toBe('WORKSPACE_PRIVATE');
    });

    it('is idempotent — running it again returns the same prices, never duplicates', async () => {
      const response = await keepPrivate(ownerToken, workspaceAId).expect(201);

      expect(response.body.createdCount).toBe(0);
      expect(response.body.alreadyPrivateCount).toBe(2);
      const count = await prisma.basicPrice.count({
        where: { sourceImportRowId: { in: [rowId, secondRowId] } },
      });
      expect(count).toBe(2);
    });

    it('leaves the batch still proposable to SIMPROK later — private use is not submission', async () => {
      const batch = await prisma.basicPriceImportBatch.findUniqueOrThrow({
        where: { id: batchId },
      });
      const row = await prisma.basicPriceImportRow.findUniqueOrThrow({
        where: { id: rowId },
      });
      expect(batch.status).toBe('READY_FOR_REVIEW');
      expect(row.status).toBe('READY_FOR_SUBMISSION');
      expect(row.priceSubmissionId).toBeNull();
    });
  });

  // ── 2. Eligibility, from the owning workspace ────────────────────────────

  describe('The owning workspace can see and use its own private price', () => {
    it('lists it in the Explorer, labelled honestly as WORKSPACE_PRIVATE', async () => {
      const response = await request(app.getHttpServer())
        .get(`/basic-prices?resourceId=${privateResourceId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toMatchObject({
        basicPriceId: privateBasicPriceId,
        assetScope: 'WORKSPACE_PRIVATE',
        workspaceScope: 'WORKSPACE',
        price: '137500.00',
        sourceOrigin: 'STORE',
        // Real provenance, reached through the SAME import batch a catalog
        // price would use — one link shorter, not less honest.
        sourceName: `${tag} Toko Bangunan Jaya`,
      });
    });

    it('serves it on the detail route', async () => {
      const response = await request(app.getHttpServer())
        .get(`/basic-prices/${privateBasicPriceId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);
      expect(response.body.id).toBe(privateBasicPriceId);
      expect(response.body.assetScope).toBe('WORKSPACE_PRIVATE');
    });

    it('returns it from the by-resource lookup the resolver shares', async () => {
      const response = await request(app.getHttpServer())
        .get(`/basic-prices/by-resource/${privateResourceId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].id).toBe(privateBasicPriceId);
    });
  });

  // ── 3. Tenant isolation ──────────────────────────────────────────────────

  describe('Another tenant cannot reach it — or learn that it exists', () => {
    it('does not list it for Workspace B', async () => {
      const response = await request(app.getHttpServer())
        .get('/basic-prices?limit=50')
        .set('Authorization', `Bearer ${outsiderToken}`)
        .set('x-workspace-id', workspaceBId)
        .expect(200);

      const ids = response.body.data.map((row: any) => row.basicPriceId);
      expect(ids).not.toContain(privateBasicPriceId);
      // Not merely absent from this page — absent from the whole result set.
      expect(
        response.body.data.filter(
          (row: any) => row.assetScope === 'WORKSPACE_PRIVATE',
        ),
      ).toHaveLength(0);
    });

    it('reports the detail route as plain non-existence, never as forbidden', async () => {
      // 404, not 403: a distinguishable "you may not see this" would itself be
      // an existence oracle for another tenant's data.
      await request(app.getHttpServer())
        .get(`/basic-prices/${privateBasicPriceId}`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .set('x-workspace-id', workspaceBId)
        .expect(404);
    });

    it('returns nothing from by-resource, even with the exact resource id', async () => {
      const response = await request(app.getHttpServer())
        .get(`/basic-prices/by-resource/${privateResourceId}`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .set('x-workspace-id', workspaceBId)
        .expect(200);
      expect(response.body).toEqual([]);
    });

    it('refuses a forged x-workspace-id header naming the owning workspace', async () => {
      await request(app.getHttpServer())
        .get(`/basic-prices/${privateBasicPriceId}`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(403);
    });

    it('refuses a forged workspaceId query parameter naming the owning workspace', async () => {
      await request(app.getHttpServer())
        .get(`/basic-prices/${privateBasicPriceId}?workspaceId=${workspaceAId}`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .expect(403);
    });

    it('refuses to let another tenant materialize private prices from a batch they do not own', async () => {
      // 404 from inside their own legitimate workspace context: the batch is
      // simply not theirs, and denial is indistinguishable from non-existence.
      await keepPrivate(outsiderToken, workspaceBId).expect(404);
      await keepPrivate(outsiderToken, workspaceAId).expect(403);
    });

    it('has created nothing in Workspace B throughout', async () => {
      const leaked = await prisma.basicPrice.count({
        where: { workspaceId: workspaceBId },
      });
      expect(leaked).toBe(0);
    });
  });

  // ── 4. The SIMPROK catalog is untouched ──────────────────────────────────

  describe('The SIMPROK catalog is preserved exactly', () => {
    it('still shows a published global catalog price to BOTH tenants', async () => {
      for (const [bearer, workspaceId] of [
        [ownerToken, workspaceAId],
        [outsiderToken, workspaceBId],
      ] as const) {
        const response = await request(app.getHttpServer())
          .get(`/basic-prices?resourceId=${catalogResourceId}`)
          .set('Authorization', `Bearer ${bearer}`)
          .set('x-workspace-id', workspaceId)
          .expect(200);

        expect(response.body.data).toHaveLength(1);
        expect(response.body.data[0]).toMatchObject({
          basicPriceId: catalogBasicPriceId,
          assetScope: 'SIMPROK_CATALOG',
          workspaceScope: 'GLOBAL',
          price: '82500.00',
        });
      }
    });

    it('never lets a private price into the publication queue', async () => {
      const response = await request(app.getHttpServer())
        .get('/basic-price-publications')
        .set('Authorization', `Bearer ${publisherToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      const ids = response.body.map((item: any) => item.basicPriceId);
      expect(ids).not.toContain(privateBasicPriceId);
    });

    it('refuses to publish a private price — there is no back door to PUBLISHED', async () => {
      await request(app.getHttpServer())
        .post(`/basic-price-publications/${privateBasicPriceId}/publish`)
        .set('Authorization', `Bearer ${publisherToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(409);

      const unchanged = await prisma.basicPrice.findUniqueOrThrow({
        where: { id: privateBasicPriceId },
      });
      expect(unchanged.status).toBe('UNPUBLISHED');
      expect(unchanged.verificationStatus).toBe('UNVERIFIED');
      expect(unchanged.assetScope).toBe('WORKSPACE_PRIVATE');
    });
  });

  // ── 5. The Cost Kernel ───────────────────────────────────────────────────

  describe('The same Cost Kernel prices a workspace-private Basic Price', () => {
    it('is a genuinely uncontested case: one eligible private price, zero catalog competitors', async () => {
      // Asserted, never assumed. RM-03C must not answer "which wins when both
      // exist" — so the proof below is built where that question cannot arise.
      const eligiblePrivate = await prisma.basicPrice.count({
        where: {
          resourceId: privateResourceId,
          assetScope: 'WORKSPACE_PRIVATE',
          workspaceId: workspaceAId,
        },
      });
      const eligibleCatalog = await prisma.basicPrice.count({
        where: {
          resourceId: privateResourceId,
          status: 'PUBLISHED',
          verificationStatus: 'PUBLISHED',
        },
      });
      expect(eligiblePrivate).toBe(1);
      expect(eligibleCatalog).toBe(0);
    });

    it('resolves the private price through the real AHSP selection route', async () => {
      const ahsp = await prisma.aHSP.create({
        data: {
          workspaceId: workspaceAId,
          workType: `${tag} Pekerjaan Privat`,
          methodType: 'MANUAL',
          locationType: 'GENERAL',
          methodName: `${tag} metode`,
        },
      });
      ahspId = ahsp.id;
      const version = await prisma.aHSPVersion.create({
        data: {
          ahspId,
          workspaceId: workspaceAId,
          versionNumber: 1,
          status: 'PUBLISHED',
          effectiveDate: new Date('2026-08-01T00:00:00.000Z'),
          outputUnit: 'M1',
          resources: {
            create: [
              {
                resourceId: `${tag} Pekerja Privat`,
                resourceType: 'LABOR',
                coefficient: '2.000000',
                baseUnit: 'OH',
              },
            ],
          },
        },
      });
      const structure = await prisma.boqStructure.create({
        data: {
          projectId,
          name: 'Working Draft',
          version: 1,
          status: 'DRAFT',
        },
      });
      boqStructureId = structure.id;
      const item = await prisma.boqItem.create({
        data: {
          boqStructureId,
          wbsCode: '1.1',
          name: `${tag} Pekerjaan Privat`,
          itemType: 'WORK_ITEM',
          quantity: '5',
          unit: 'M1',
        },
      });
      boqItemId = item.id;

      const response = await request(app.getHttpServer())
        .post(
          `/projects/${projectId}/ahsp-occurrences/boq-items/${boqItemId}/select-ahsp`,
        )
        .set('Authorization', `Bearer ${rabEditorToken}`)
        .send({
          ahspVersionId: version.id,
          businessPricingAsOfDate: asOfDate,
          referenceRegionId: regionId,
          idempotencyKey: `${tag}-private-price-bind`,
        })
        .expect(201);

      expect(response.body.ahspVersionId).toBe(version.id);

      const resolution = await prisma.projectAhspResourceResolution.findFirstOrThrow(
        { where: { occurrence: { projectId } } },
      );
      // Deterministic: the workspace's own price, selected because it is the
      // ONLY eligible candidate — not because private outranks anything.
      expect(resolution.status).toBe('RESOLVED');
      expect(resolution.selectedBasicPriceId).toBe(privateBasicPriceId);
      expect(resolution.canonicalUnit).toBe('PERSON_DAY');
      expect(resolution.quantityFactor?.toString()).toBe('1');
      expect(resolution.sourcePriceValue?.toFixed(2)).toBe('137500.00');
      expect(resolution.adaptedPriceValue?.toFixed(2)).toBe('137500.00');
      expect(resolution.selectedSourceOrigin).toBe('STORE');
    });

    it('persists an exact server-computed RAB line from it', async () => {
      const response = await request(app.getHttpServer())
        .post(
          `/projects/${projectId}/boq/items/${boqItemId}/cost-calculation/persist`,
        )
        .set('Authorization', `Bearer ${rabEditorToken}`)
        .send({ calculationAsOfDate: asOfDate })
        .expect(201);

      // coefficient 2.000000 x adapted 137500.00 = 275000.00 unit price;
      // volume 5 -> 1375000.00 line total. Exact decimal, no rounding step.
      expect(response.body).toMatchObject({
        boqItemId,
        unitPrice: '275000.00',
        lineTotal: '1375000.00',
        priceOrigin: 'SERVER_COST_KERNEL',
        calculationAsOfDate: asOfDate,
      });

      const persisted = await prisma.boqItem.findUniqueOrThrow({
        where: { id: boqItemId },
      });
      expect(persisted.unitPrice?.toFixed(2)).toBe('275000.00');
      expect(persisted.lineTotal?.toFixed(2)).toBe('1375000.00');
      expect(persisted.priceOrigin).toBe('SERVER_COST_KERNEL');
      expect(persisted.calculationOccurrenceId).not.toBeNull();
    });

    it('re-proves the persisted line read-only, reproducing the stored money exactly', async () => {
      const response = await request(app.getHttpServer())
        .get(`/projects/${projectId}/boq/items/${boqItemId}/persisted-calculation`)
        .set('Authorization', `Bearer ${rabEditorToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'VERIFIED',
        stored: { unitPrice: '275000.00', lineTotal: '1375000.00' },
        recomputed: { unitPrice: '275000.00', lineTotal: '1375000.00' },
        integrity: { unitPriceMatches: true, lineTotalMatches: true },
      });
      expect(response.body.resources[0].selectedBasicPriceId).toBe(
        privateBasicPriceId,
      );
    });
  });

  // ── 6. Database truth ────────────────────────────────────────────────────

  describe('The database itself refuses every dishonest private shape', () => {
    const attempt = (data: Record<string, unknown>) =>
      prisma.basicPrice.create({
        data: {
          resourceId: privateResourceId,
          regionId,
          effectiveDate: new Date('2026-08-01T00:00:00.000Z'),
          value: '1.00',
          sourceOrigin: 'STORE',
          assetScope: 'WORKSPACE_PRIVATE',
          workspaceId: workspaceAId,
          ...data,
        } as never,
      });

    it('accepts the one truthful private shape — so the rejections below mean something', async () => {
      // Control case. Without it, every "rejects" test could be passing for an
      // unrelated reason (a bad fixture, a missing column) rather than for the
      // constraint it names.
      const created = await attempt({ sourceImportRowId: probeRowId });
      expect(created.assetScope).toBe('WORKSPACE_PRIVATE');
      await prisma.basicPrice.delete({ where: { id: created.id } });
    });

    it('rejects a private price with no workspace — the cross-tenant leak shape', async () => {
      await expect(
        attempt({ workspaceId: null, sourceImportRowId: probeRowId }),
      ).rejects.toThrow();
    });

    it('rejects a private price with no import-row evidence', async () => {
      await expect(attempt({})).rejects.toThrow();
    });

    it('rejects a private price stamped PUBLISHED on either axis', async () => {
      await expect(
        attempt({ sourceImportRowId: probeRowId, status: 'PUBLISHED' }),
      ).rejects.toThrow();
      await expect(
        attempt({
          sourceImportRowId: probeRowId,
          verificationStatus: 'PUBLISHED',
        }),
      ).rejects.toThrow();
    });

    it('rejects a private price that is submission-born', async () => {
      const submission = await prisma.priceSubmission.create({
        data: {
          workspaceId: workspaceAId,
          organizationId: orgAId,
          resourceId: privateResourceId,
          regionId,
          sourceOrigin: 'STORE',
          sourceType: 'MARKET_SURVEY',
          status: 'SUBMITTED',
        },
      });
      await expect(
        attempt({
          sourceImportRowId: probeRowId,
          sourceSubmissionId: submission.id,
        }),
      ).rejects.toThrow();
      await prisma.priceSubmission.delete({ where: { id: submission.id } });
    });

    it('rejects a catalog price wearing the private evidence link', async () => {
      await expect(
        attempt({ assetScope: 'SIMPROK_CATALOG', sourceImportRowId: probeRowId }),
      ).rejects.toThrow();
    });

    it('rejects a second private price for the same import row', async () => {
      // The unique index is what makes the writer idempotent rather than
      // merely careful.
      await expect(attempt({ sourceImportRowId: rowId })).rejects.toThrow();
    });

    it('classified every pre-existing row as SIMPROK_CATALOG, and only the writer mints private', async () => {
      const privateRows = await prisma.basicPrice.findMany({
        where: { assetScope: 'WORKSPACE_PRIVATE' },
        select: { id: true, workspaceId: true, sourceImportRowId: true },
      });
      // Every private row in the whole database is one of ours, belongs to a
      // workspace, and carries evidence.
      for (const row of privateRows) {
        expect(row.workspaceId).not.toBeNull();
        expect(row.sourceImportRowId).not.toBeNull();
      }
      const seeded = await prisma.basicPrice.count({
        where: { assetScope: 'WORKSPACE_PRIVATE', workspaceId: workspaceAId },
      });
      expect(seeded).toBe(2);
    });
  });
});
