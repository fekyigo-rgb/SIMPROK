import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { ADMISSION_ROWS, buildBasicPriceXlsx } from '../fixtures/basic-price-xlsx.fixture';

/**
 * RM-03D1 — REVIEWED RESOURCE ADMISSION (e2e).
 *
 * A green build proves nothing about a write route nobody called. This suite
 * drives the real endpoint against the real database and asserts the exact
 * rows it does and does not leave behind.
 *
 * The law under test: ADMISSION DOES NOT DEFINE WHAT SIMPROK DOES NOT KNOW.
 * ResourceIdentityResolutionService does, and admission acts only after that
 * authority has exhausted every defensible avenue. So the load-bearing cases
 * here are the refusals — a resource known under a different spelling, a
 * resource known globally rather than locally, and two concurrent requests
 * racing for the same genuinely-new one.
 *
 * Scope discipline: nothing here submits, publishes, or touches Region /
 * BasicPrice / PriceSubmission. Admission settles identity and nothing else.
 */
const WORKSPACE_A = '10000000-0000-4000-8000-000000000004';
const WORKSPACE_B = '10000000-0000-4000-8000-000000000005';
const PASSWORD = 'Test1234!';

const RESOURCE_DIFFERENT_SPELLING_ID = '43000000-0000-4000-8000-000000000001';
const RESOURCE_GLOBAL_ID = '43000000-0000-4000-8000-000000000002';
const RESOURCE_RETIRED_ID = '43000000-0000-4000-8000-000000000003';
const UNIT_WITHOUT_ALIAS_ID = '43000000-0000-4000-8000-000000000004';

/** Every name this suite may ever bring into the catalog, for exact cleanup. */
const ADMITTED_NAMES = Object.values(ADMISSION_ROWS).map((entry) => entry.name);

describe('RM03D1 Reviewed Resource Admission (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let assignedToken: string;
  let foremanToken: string;
  let crosstenantToken: string;
  let assignedAccountId: string;
  let unitM3Id: string;

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    await app.init();
    prisma = new PrismaClient();

    const assignedAccount = await prisma.account.findUniqueOrThrow({ where: { email: 'assigned@test.local' } });
    assignedAccountId = assignedAccount.id;

    // The canonical unit the reviewer asserts. Seeded by the unit-kernel
    // migration together with its alias, so the UnitKernel can genuinely
    // represent it — which admission now insists on.
    unitM3Id = (await prisma.unitDefinition.findFirstOrThrow({ where: { code: 'M3' } })).id;

    // A unit definition with NO alias: it exists, and the unit authority still
    // cannot see it. Admission must refuse rather than write an unprovable
    // baseUnit into the canonical catalog.
    await prisma.unitDefinition.upsert({
      where: { id: UNIT_WITHOUT_ALIAS_ID },
      create: {
        id: UNIT_WITHOUT_ALIAS_ID,
        code: 'RM03D1-NO-ALIAS',
        displayName: 'Unit the kernel cannot represent',
        symbol: 'RM03D1NA',
        dimension: 'VOLUME',
        kind: 'CANONICAL',
      },
      update: {},
    });

    const login = async (email: string) =>
      (await request(app.getHttpServer()).post('/auth/login').send({ email, password: PASSWORD })).body.access_token;
    assignedToken = await login('assigned@test.local');
    foremanToken = await login('foreman@test.local');
    crosstenantToken = await login('crosstenant@test.local');
  });

  beforeEach(async () => {
    await prisma.resourceCatalog.createMany({
      data: [
        // Known under a DIFFERENT SPELLING from what the workbook says.
        {
          id: RESOURCE_DIFFERENT_SPELLING_ID,
          workspaceId: WORKSPACE_A,
          code: 'RM03D1-MAT-01',
          name: 'Semen Portlan',
          type: 'MATERIAL',
          baseUnit: 'M3',
        },
        // Genuinely global reference data — no workspace owns it.
        {
          id: RESOURCE_GLOBAL_ID,
          workspaceId: null,
          code: 'RM03D1-GLOBAL-01',
          name: ADMISSION_ROWS.GLOBAL_KNOWN.name,
          type: 'MATERIAL',
          baseUnit: 'M3',
        },
        // Retired, so the identity authority correctly ignores it — but its
        // provenance binding still exists and must not be stolen.
        {
          id: RESOURCE_RETIRED_ID,
          workspaceId: WORKSPACE_A,
          code: 'RM03D1-RETIRED-01',
          name: 'Pasir lama yang sudah dipensiunkan',
          type: 'MATERIAL',
          baseUnit: 'M3',
          status: 'RETIRED',
        },
      ],
      skipDuplicates: true,
    });
  });

  afterEach(async () => {
    await prisma.basicPriceImportBatch.deleteMany({ where: { workspaceId: WORKSPACE_A } });
    await prisma.resourceSourceIdentity.deleteMany({ where: { workspaceId: WORKSPACE_A } });
    await prisma.resourceCatalog.deleteMany({
      where: {
        OR: [
          { id: { in: [RESOURCE_DIFFERENT_SPELLING_ID, RESOURCE_GLOBAL_ID, RESOURCE_RETIRED_ID] } },
          { workspaceId: WORKSPACE_A, name: { in: ADMITTED_NAMES } },
        ],
      },
    });
  });

  afterAll(async () => {
    await prisma.unitDefinition.deleteMany({ where: { id: UNIT_WITHOUT_ALIAS_ID } });
    await prisma.$disconnect();
    await app.close();
  });

  const previewFile = async (sourceVendorName: string) =>
    request(app.getHttpServer())
      .post('/basic-price-imports/preview')
      .set('Authorization', `Bearer ${assignedToken}`)
      .set('x-workspace-id', WORKSPACE_A)
      .attach('file', await buildBasicPriceXlsx({ includeAdmissionRows: true }), {
        filename: 'basic-price.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .field('selectedSheet', 'HARGA SATUAN UPAH DAN BAHAN')
      .field('sourceVendorName', sourceVendorName)
      .expect(201);

  const admit = (
    batchId: string,
    rowId: string,
    version: number,
    unitDefinitionId = unitM3Id,
    token = assignedToken,
    workspaceId = WORKSPACE_A,
  ) =>
    request(app.getHttpServer())
      .post(`/basic-price-imports/${batchId}/rows/${rowId}/admit-resource`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceId)
      .send({ version, unitDefinitionId, reason: 'Tidak ada resource kanonik yang sepadan.' });

  /** Preview once and hand back the parsed row for a fixture source row. */
  const previewWithRow = async (vendor: string, sourceRowNumber: number) => {
    const preview = await previewFile(vendor);
    const row = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === sourceRowNumber);
    expect(row).toBeDefined();
    return { batchId: preview.body.batchId as string, row };
  };

  const catalogCount = () =>
    prisma.resourceCatalog.count({ where: { workspaceId: WORKSPACE_A, name: { in: ADMITTED_NAMES } } });

  // ============================================================
  // A. HAPPY PATH
  // ============================================================
  it('A: admits a genuinely unknown resource exactly once, with provenance, a mapping decision, and a resolved row', async () => {
    const { batchId, row } = await previewWithRow('d1-admit-happy', ADMISSION_ROWS.UNKNOWN.row);
    expect(row.name).toBe(ADMISSION_ROWS.UNKNOWN.name);

    const response = await admit(batchId, row.id, row.version).expect(201);
    const admittedId = response.body.admittedResource.id;

    const catalogRows = await prisma.resourceCatalog.findMany({
      where: { workspaceId: WORKSPACE_A, name: ADMISSION_ROWS.UNKNOWN.name },
    });
    expect(catalogRows).toHaveLength(1);
    expect(catalogRows[0]).toEqual(
      expect.objectContaining({
        id: admittedId,
        workspaceId: WORKSPACE_A,
        // Exactly what the source says, the class the source declared, and the
        // canonical unit code the reviewer proved.
        name: ADMISSION_ROWS.UNKNOWN.name,
        type: 'MATERIAL',
        baseUnit: 'M3',
        // The source supplied no code and no specification; neither is invented.
        code: null,
        specifications: null,
        status: 'ACTIVE',
      }),
    );

    const provenance = await prisma.resourceSourceIdentity.findMany({ where: { resourceCatalogId: admittedId } });
    expect(provenance).toHaveLength(1);
    expect(provenance[0]).toEqual(
      expect.objectContaining({
        workspaceId: WORKSPACE_A,
        sheetName: 'HARGA SATUAN UPAH DAN BAHAN',
        sourceRowNumber: ADMISSION_ROWS.UNKNOWN.row,
        sourceSection: 'MATERIAL',
        sourceNameCellAddress: `C${ADMISSION_ROWS.UNKNOWN.row}`,
        rawName: ADMISSION_ROWS.UNKNOWN.name,
        rawUnit: ADMISSION_ROWS.UNKNOWN.unit,
        rawCode: null,
      }),
    );
    const batch = await prisma.basicPriceImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(provenance[0].sourceSha256).toBe(batch.sourceSha256);
    expect(provenance[0].parserContractVersion).toBe(batch.parserContractVersion);

    const mappings = await prisma.basicPriceImportRowResourceMapping.findMany({ where: { rowId: row.id } });
    expect(mappings).toHaveLength(1);
    expect(mappings[0]).toEqual(
      expect.objectContaining({
        workspaceId: WORKSPACE_A,
        resourceCatalogId: admittedId,
        unitDefinitionId: unitM3Id,
        reviewerAccountId: assignedAccountId,
        // Nothing suggested this identity — a human supplied it. The row this
        // very transaction created is excluded from the decision-time signals.
        suggestionSource: 'MANUAL_SEARCH',
        candidateCountAtDecision: 0,
      }),
    );

    const updatedRow = await prisma.basicPriceImportRow.findUniqueOrThrow({ where: { id: row.id } });
    expect(updatedRow.status).toBe('READY_FOR_SUBMISSION');
    expect(updatedRow.resourceCatalogId).toBe(admittedId);
    expect(updatedRow.unitDefinitionId).toBe(unitM3Id);
    expect(updatedRow.resolvedByAccountId).toBe(assignedAccountId);

    // Identity only: admission never prices, submits, or publishes.
    expect(await prisma.basicPrice.count({ where: { resourceId: admittedId } })).toBe(0);
    expect(await prisma.priceSubmission.count({ where: { resourceId: admittedId } })).toBe(0);
    expect(batch.regionId).toBeNull();
  });

  // ============================================================
  // B. SMART DIFFERENT-NAME PROTECTION (load-bearing)
  // ============================================================
  it('B: a resource SIMPROK already knows under a different spelling is never duplicated — the authoritative candidate is returned instead', async () => {
    const { batchId, row } = await previewWithRow('d1-admit-spelling', ADMISSION_ROWS.DIFFERENT_SPELLING.row);
    expect(row.name).toBe('Semen Portland');

    const response = await admit(batchId, row.id, row.version).expect(409);

    expect(response.body.message).toBe('RESOURCE_IDENTITY_NOT_EXHAUSTED');
    expect(response.body.resourceIdentity.status).toBe('NEEDS_REVIEW');
    expect(response.body.resourceIdentity.candidates.map((c: { resourceCatalogId: string }) => c.resourceCatalogId)).toContain(
      RESOURCE_DIFFERENT_SPELLING_ID,
    );

    expect(await catalogCount()).toBe(0);
    expect(await prisma.basicPriceImportRowResourceMapping.count({ where: { rowId: row.id } })).toBe(0);
    const untouched = await prisma.basicPriceImportRow.findUniqueOrThrow({ where: { id: row.id } });
    expect(untouched.status).toBe('NEEDS_REVIEW');
    expect(untouched.resourceCatalogId).toBeNull();
  });

  // ============================================================
  // C. GLOBAL-CATALOG PROTECTION
  // ============================================================
  it('C: a defensible GLOBAL resource is never duplicated into a workspace-local copy', async () => {
    const { batchId, row } = await previewWithRow('d1-admit-global', ADMISSION_ROWS.GLOBAL_KNOWN.row);

    const response = await admit(batchId, row.id, row.version).expect(409);

    expect(response.body.message).toBe('RESOURCE_IDENTITY_NOT_EXHAUSTED');
    expect(response.body.resourceIdentity.resolvedResourceCatalogId).toBe(RESOURCE_GLOBAL_ID);
    expect(await catalogCount()).toBe(0);
  });

  // ============================================================
  // D. CROSS-WORKSPACE / FOREIGN UPLOADER
  // ============================================================
  it('D: a foreign workspace and a same-workspace non-uploader both admit nothing, with no information leaked and zero writes', async () => {
    const { batchId, row } = await previewWithRow('d1-admit-denied', ADMISSION_ROWS.UNKNOWN.row);

    await request(app.getHttpServer())
      .post(`/basic-price-imports/${batchId}/rows/${row.id}/admit-resource`)
      .set('x-workspace-id', WORKSPACE_A)
      .send({ version: row.version, unitDefinitionId: unitM3Id, reason: 'no token' })
      .expect(401);
    // Same workspace, holds BASIC_PRICE_RESOLVE via the active-membership
    // baseline, but did not upload this batch — denied as "not found", never
    // distinguishable from non-existence.
    await admit(batchId, row.id, row.version, unitM3Id, foremanToken).expect(404);
    await admit(batchId, row.id, row.version, unitM3Id, crosstenantToken, WORKSPACE_B).expect(404);

    expect(await catalogCount()).toBe(0);
    expect(await prisma.basicPriceImportRowResourceMapping.count({ where: { rowId: row.id } })).toBe(0);
  });

  // ============================================================
  // E. REPLAY
  // ============================================================
  it('E: replaying the same reviewed decision admits at most one resource', async () => {
    const { batchId, row } = await previewWithRow('d1-admit-replay', ADMISSION_ROWS.UNKNOWN.row);

    await admit(batchId, row.id, row.version).expect(201);
    await admit(batchId, row.id, row.version).expect(409);

    expect(await catalogCount()).toBe(1);
    expect(await prisma.basicPriceImportRowResourceMapping.count({ where: { rowId: row.id } })).toBe(1);
  });

  // ============================================================
  // F. CONCURRENT ADMISSION (load-bearing)
  // ============================================================
  it('F: two independent rows racing for the same genuinely-new resource produce exactly ONE canonical resource', async () => {
    const preview = await previewFile('d1-admit-concurrent');
    const rowA = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === ADMISSION_ROWS.CONCURRENT_A.row);
    const rowB = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === ADMISSION_ROWS.CONCURRENT_B.row);
    expect(rowA.name).toBe(rowB.name);

    const before = await prisma.resourceCatalog.count({
      where: { workspaceId: WORKSPACE_A, name: ADMISSION_ROWS.CONCURRENT_A.name },
    });

    const [a, b] = await Promise.all([
      admit(preview.body.batchId, rowA.id, rowA.version),
      admit(preview.body.batchId, rowB.id, rowB.version),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);

    const after = await prisma.resourceCatalog.count({
      where: { workspaceId: WORKSPACE_A, name: ADMISSION_ROWS.CONCURRENT_A.name },
    });
    expect(after - before).toBe(1);

    // The loser was not merely rejected — it was shown the identity that won.
    const loser = a.status === 409 ? a : b;
    expect(loser.body.message).toBe('RESOURCE_IDENTITY_NOT_EXHAUSTED');
    expect(loser.body.resourceIdentity.resolvedResourceCatalogId).not.toBeNull();
  });

  // ============================================================
  // G. TRANSACTION FAILURE
  // ============================================================
  it('G: a downstream provenance conflict leaves no residue — no catalog row, no provenance, no mapping, no row transition', async () => {
    const { batchId, row } = await previewWithRow('d1-admit-rollback', ADMISSION_ROWS.ROLLBACK.row);
    const batch = await prisma.basicPriceImportBatch.findUniqueOrThrow({ where: { id: batchId } });

    // This exact source row is already bound to a RETIRED resource, which the
    // identity authority rightly ignores as a candidate. Admission therefore
    // reaches the provenance write and fails there — after the catalog row has
    // already been created inside the transaction.
    await prisma.resourceSourceIdentity.create({
      data: {
        resourceCatalogId: RESOURCE_RETIRED_ID,
        workspaceId: WORKSPACE_A,
        sourceSha256: batch.sourceSha256,
        sourceFileName: batch.sourceFileName,
        parserContractVersion: batch.parserContractVersion,
        sheetName: batch.selectedSheetName,
        sourceRowNumber: ADMISSION_ROWS.ROLLBACK.row,
        sourceSection: 'MATERIAL',
        sourceNameCellAddress: `C${ADMISSION_ROWS.ROLLBACK.row}`,
        rawName: ADMISSION_ROWS.ROLLBACK.name,
        rawUnit: ADMISSION_ROWS.ROLLBACK.unit,
      },
    });

    const response = await admit(batchId, row.id, row.version).expect(409);
    expect(response.body.message).toBe('RESOURCE_PROVENANCE_ALREADY_BOUND');

    expect(
      await prisma.resourceCatalog.count({ where: { workspaceId: WORKSPACE_A, name: ADMISSION_ROWS.ROLLBACK.name } }),
    ).toBe(0);
    // Only the pre-existing binding survives — nothing was added, nothing stolen.
    const provenance = await prisma.resourceSourceIdentity.findMany({ where: { workspaceId: WORKSPACE_A } });
    expect(provenance).toHaveLength(1);
    expect(provenance[0].resourceCatalogId).toBe(RESOURCE_RETIRED_ID);
    expect(await prisma.basicPriceImportRowResourceMapping.count({ where: { rowId: row.id } })).toBe(0);
    const untouched = await prisma.basicPriceImportRow.findUniqueOrThrow({ where: { id: row.id } });
    expect(untouched.status).toBe('NEEDS_REVIEW');
    expect(untouched.resourceCatalogId).toBeNull();
  });

  // ============================================================
  // UNIT AUTHORITY
  // ============================================================
  it('H: a UnitDefinition the UnitKernel cannot represent admits nothing — no unprovable baseUnit ever reaches the catalog', async () => {
    const { batchId, row } = await previewWithRow('d1-admit-unit', ADMISSION_ROWS.UNKNOWN.row);

    const response = await admit(batchId, row.id, row.version, UNIT_WITHOUT_ALIAS_ID).expect(409);

    expect(response.body.message).toBe('UNIT_NOT_REPRESENTABLE_BY_UNIT_AUTHORITY');
    expect(response.body.unitResolution.reasonCodes).toContain('UNKNOWN_UNIT_ALIAS');
    expect(await catalogCount()).toBe(0);
  });
});
