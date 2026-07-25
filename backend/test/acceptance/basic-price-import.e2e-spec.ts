import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { buildBasicPriceXlsx } from '../fixtures/basic-price-xlsx.fixture';

// RM-02B Basic Price import foundation (e2e). WRITE-ONLY AT COMMIT TIME:
// this suite cannot be executed in this session — .env.test's local
// PostgreSQL credential is rejected (BLOCKER_ID
// RM02B-SIMPROK-TEST-CREDENTIAL-STALE-01, recorded in
// docs/implementation-gates/RM02B0_PRODUCTION_FACT_RECONCILIATION.md).
// Written to the same standard as every other passing suite in this
// directory; must be run via `npm run test:e2e:safe` once that credential
// is restored, before this branch can be called merge-ready.
//
// BASIC_PRICE_IMPORT/RESOLVE/SUBMIT/VERIFY/PUBLISH/REVIEW_VIEW are declared
// permission codes with no seeded Permission row anywhere yet (see
// DECLARED_NOT_SEEDED_PERMISSION_CODES in
// src/common/constants/permissions.ts) — this suite upserts the Permission
// catalog rows itself and grants them via a dedicated ad-hoc Role, exactly
// the mechanism WorkspacePermissionResolverService uses in production, so
// PermissionsGuard is genuinely exercised rather than bypassed. It also
// proves the current real-world default (foremanToken, ungranted) fails
// closed with 403.
const WORKSPACE_A = '10000000-0000-4000-8000-000000000004';
const PASSWORD = 'Test1234!';

const REGION_ID = '41000000-0000-4000-8000-000000000001';
const RESOURCE_MATERIAL_ID = '41000000-0000-4000-8000-000000000002';
const RESOURCE_LABOR_ID = '41000000-0000-4000-8000-000000000003';
const UNIT_ID = '41000000-0000-4000-8000-000000000004';
const ROLE_ID = '41000000-0000-4000-8000-000000000005';

const BASIC_PRICE_PERMISSION_CODES = [
  'BASIC_PRICE_IMPORT',
  'BASIC_PRICE_RESOLVE',
  'BASIC_PRICE_SUBMIT',
  'BASIC_PRICE_VERIFY',
  'BASIC_PRICE_PUBLISH',
  'BASIC_PRICE_REVIEW_VIEW',
];

async function buildPriceColumnFormulaErrorXlsx(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('HARGA SATUAN UPAH DAN BAHAN');
  sheet.getCell('B5').value = 'DAFTAR HARGA SATUAN UPAH';
  sheet.getCell('B7').value = 'NO';
  sheet.getCell('C7').value = 'TENAGA KERJA';
  sheet.getCell('D7').value = 'SATUAN';
  sheet.getCell('E7').value = 'SATUAN';
  sheet.getCell('F7').value = 'HARGA  (Rp)';
  sheet.getCell('B9').value = '1';
  sheet.getCell('C9').value = 'Tukang harga rusak';
  sheet.getCell('D9').value = 'L.99';
  sheet.getCell('E9').value = 'Org/Hari';
  // Error directly in the price column itself (F), not the unread KET
  // column — distinct from the adapter's own "#REF! on KET never blocks
  // the price column" unit test.
  sheet.getCell('F9').value = { formula: 'BROKEN_REF', result: { error: '#REF!' } } as any;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('RM02B Basic Price import (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let assignedToken: string;
  let foremanToken: string;
  let assignedAccountId: string;
  let membershipRoleId: string;

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    await app.init();
    prisma = new PrismaClient();

    const permissions = await Promise.all(
      BASIC_PRICE_PERMISSION_CODES.map((code) =>
        prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} }),
      ),
    );
    await prisma.role.upsert({
      where: { id: ROLE_ID },
      create: { id: ROLE_ID, workspaceId: WORKSPACE_A, code: 'ACCEPTANCE_BASIC_PRICE_IMPORT', name: 'Acceptance Basic Price Import' },
      update: {},
    });
    await prisma.rolePermission.createMany({
      data: permissions.map((permission) => ({ roleId: ROLE_ID, permissionId: permission.id })),
      skipDuplicates: true,
    });

    const assignedAccount = await prisma.account.findUniqueOrThrow({ where: { email: 'assigned@test.local' } });
    assignedAccountId = assignedAccount.id;
    const assignedMembership = await prisma.workspaceMembership.findUniqueOrThrow({
      where: { accountId_workspaceId: { accountId: assignedAccount.id, workspaceId: WORKSPACE_A } },
    });
    const membershipRole = await prisma.membershipRole.create({
      data: { workspaceMembershipId: assignedMembership.id, roleId: ROLE_ID, isActive: true },
    });
    membershipRoleId = membershipRole.id;

    await prisma.region.upsert({
      where: { id: REGION_ID },
      create: { id: REGION_ID, code: 'ACC-RM02-REGION', name: 'Acceptance Region' },
      update: {},
    });
    await prisma.resourceCatalog.upsert({
      where: { id: RESOURCE_MATERIAL_ID },
      create: { id: RESOURCE_MATERIAL_ID, workspaceId: WORKSPACE_A, code: 'ACC-MAT-01', name: 'Acceptance Material', type: 'MATERIAL', baseUnit: 'Lbr' },
      update: {},
    });
    await prisma.resourceCatalog.upsert({
      where: { id: RESOURCE_LABOR_ID },
      create: { id: RESOURCE_LABOR_ID, workspaceId: WORKSPACE_A, code: 'ACC-LAB-01', name: 'Acceptance Labor', type: 'LABOR', baseUnit: 'Org/Hari' },
      update: {},
    });
    await prisma.unitDefinition.upsert({
      where: { id: UNIT_ID },
      create: { id: UNIT_ID, code: 'ACC-UNIT-ORGHARI', displayName: 'Orang per Hari', symbol: 'Org/Hari', dimension: 'PERSON_TIME', kind: 'CANONICAL' },
      update: {},
    });

    const login = async (email: string) =>
      (await request(app.getHttpServer()).post('/auth/login').send({ email, password: PASSWORD })).body.access_token;
    assignedToken = await login('assigned@test.local');
    foremanToken = await login('foreman@test.local');
  });

  afterEach(async () => {
    // BasicPriceImportRow cascades away with its batch (onDelete: Cascade),
    // which clears the Restrict FKs pointing at our resource/unit fixtures
    // — this must run before the resource/unit/region deletes in afterAll.
    await prisma.basicPriceImportBatch.deleteMany({ where: { workspaceId: WORKSPACE_A } });
    await prisma.priceSubmission.deleteMany({ where: { resourceId: { in: [RESOURCE_MATERIAL_ID, RESOURCE_LABOR_ID] } } });
    await prisma.basicPrice.deleteMany({ where: { resourceId: { in: [RESOURCE_MATERIAL_ID, RESOURCE_LABOR_ID] } } });
  });

  afterAll(async () => {
    await prisma.basicPriceImportBatch.deleteMany({ where: { workspaceId: WORKSPACE_A } });
    await prisma.priceSubmission.deleteMany({ where: { resourceId: { in: [RESOURCE_MATERIAL_ID, RESOURCE_LABOR_ID] } } });
    await prisma.basicPrice.deleteMany({ where: { resourceId: { in: [RESOURCE_MATERIAL_ID, RESOURCE_LABOR_ID] } } });
    await prisma.resourceCatalog.deleteMany({ where: { id: { in: [RESOURCE_MATERIAL_ID, RESOURCE_LABOR_ID] } } });
    await prisma.unitDefinition.deleteMany({ where: { id: UNIT_ID } });
    await prisma.region.deleteMany({ where: { id: REGION_ID } });
    await prisma.membershipRole.deleteMany({ where: { id: membershipRoleId } });
    await prisma.rolePermission.deleteMany({ where: { roleId: ROLE_ID } });
    await prisma.role.deleteMany({ where: { id: ROLE_ID } });
    await prisma.permission.deleteMany({ where: { code: { in: BASIC_PRICE_PERMISSION_CODES } } });
    await prisma.$disconnect();
    await app.close();
  });

  const previewFile = (buffer: Buffer, sourceVendorName: string, token = assignedToken, extraFields: Record<string, string> = {}) => {
    let req = request(app.getHttpServer())
      .post('/basic-price-imports/preview')
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', WORKSPACE_A)
      .attach('file', buffer, { filename: 'basic-price.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      .field('selectedSheet', 'HARGA SATUAN UPAH DAN BAHAN')
      .field('sourceVendorName', sourceVendorName);
    for (const [key, value] of Object.entries(extraFields)) req = req.field(key, value);
    return req;
  };

  const getBatch = (batchId: string, token = assignedToken) =>
    request(app.getHttpServer()).get(`/basic-price-imports/${batchId}`).set('Authorization', `Bearer ${token}`).set('x-workspace-id', WORKSPACE_A);

  describe('permission boundary', () => {
    it('the current default state (permission not granted) fails closed with 403, never 500', async () => {
      const buffer = await buildBasicPriceXlsx();
      await previewFile(buffer, 'fail-closed-default', foremanToken).expect(403);
    });

    it('a granted BASIC_PRICE_IMPORT permission allows preview, exercising the real PermissionsGuard/resolver path', async () => {
      const buffer = await buildBasicPriceXlsx();
      const response = await previewFile(buffer, 'granted-permission-check').expect(201);
      expect(response.body.batchId).toBeDefined();
    });
  });

  describe('preview / parsing evidence', () => {
    it('creates a persisted batch with every row starting NEEDS_REVIEW — never auto-resolved', async () => {
      const buffer = await buildBasicPriceXlsx();
      const response = await previewFile(buffer, 'preview-basic').expect(201);
      expect(response.body.status).toBe('NEEDS_REVIEW');
      expect(response.body.totalRows).toBeGreaterThan(0);
      expect(response.body.needsReviewRows).toBe(response.body.totalRows);
      expect((response.body.rows as Array<{ status: string }>).every((r) => r.status === 'NEEDS_REVIEW')).toBe(true);
    });

    it('exact-tie ROUND_HALF_UP: 0.125 rounds up to 0.13, never down (test matrix B06)', async () => {
      const buffer = await buildBasicPriceXlsx({ includeExactTieRounding: true });
      const response = await previewFile(buffer, 'exact-tie-rounding').expect(201);
      const row = (response.body.rows as Array<{ sourceRowNumber: number; proposedCanonicalPrice: string | null }>).find((r) => r.sourceRowNumber === 10);
      expect(row?.proposedCanonicalPrice).toBe('0.13');
    });

    it('retains the real-evidence long round-trip decimal exactly, rounding only the canonical projection', async () => {
      const buffer = await buildBasicPriceXlsx({ includeLongRoundTripDecimal: true });
      const response = await previewFile(buffer, 'long-round-trip-decimal').expect(201);
      const dbRow = await prisma.basicPriceImportRow.findFirstOrThrow({ where: { batchId: response.body.batchId, sourceRowNumber: 9 } });
      expect(dbRow.rawPriceNumericRoundTripString).toBe('158333.33333333334');
      expect(dbRow.proposedCanonicalPrice?.toFixed(2)).toBe('158333.33');
    });

    it('a formula error directly in the price column is preserved as NEEDS_REVIEW with no fabricated canonical price', async () => {
      const buffer = await buildPriceColumnFormulaErrorXlsx();
      const response = await previewFile(buffer, 'price-column-formula-error').expect(201);
      expect(response.body.totalRows).toBe(1);
      const row = response.body.rows[0];
      expect(row.status).toBe('NEEDS_REVIEW');
      expect(row.proposedCanonicalPrice).toBeNull();
      expect(row.reasonCodes).toEqual(expect.arrayContaining(['FORMULA_ERROR']));
    });

    it('missing unit and missing price rows are preserved (never discarded) and reported honestly', async () => {
      const buffer = await buildBasicPriceXlsx({ includeMissingUnit: true, includeMissingPrice: true });
      const response = await previewFile(buffer, 'missing-unit-and-price').expect(201);
      const rows = response.body.rows as Array<{ name: string; proposedCanonicalPrice: string | null; reasonCodes: string[] }>;
      const missingUnitRow = rows.find((r) => r.name.startsWith('Kawat BRC'));
      const missingPriceRow = rows.find((r) => r.name.startsWith('Balok kayu'));
      expect(missingUnitRow?.proposedCanonicalPrice).toBeNull();
      expect(missingUnitRow?.reasonCodes).toEqual(expect.arrayContaining(['UNIT_REQUIRED']));
      expect(missingPriceRow?.reasonCodes).toEqual(expect.arrayContaining(['PRICE_CELL_EMPTY']));
    });
  });

  describe('fingerprint replay', () => {
    it('an identical file + identical metadata returns the same batch, never duplicate rows (I01/I02)', async () => {
      const buffer = await buildBasicPriceXlsx();
      const first = await previewFile(buffer, 'replay-identical').expect(201);
      const second = await previewFile(buffer, 'replay-identical').expect(201);
      expect(second.body.batchId).toBe(first.body.batchId);
      expect(await prisma.basicPriceImportBatch.count({ where: { workspaceId: WORKSPACE_A } })).toBe(1);
      expect(second.body.totalRows).toBe(first.body.totalRows);
    });

    it('the same file with different metadata produces a genuinely different batch (I03)', async () => {
      const buffer = await buildBasicPriceXlsx();
      const first = await previewFile(buffer, 'replay-variant-A', assignedToken, { sourceOrigin: 'SUPPLIER' }).expect(201);
      const second = await previewFile(buffer, 'replay-variant-A', assignedToken, { sourceOrigin: 'DISTRIBUTOR' }).expect(201);
      expect(second.body.batchId).not.toBe(first.body.batchId);
    });

    it('concurrent identical preview requests race safely to one batch, no duplicate rows (I04/I05 analog)', async () => {
      const buffer = await buildBasicPriceXlsx();
      const [first, second] = await Promise.all([
        previewFile(buffer, 'concurrent-identical'),
        previewFile(buffer, 'concurrent-identical'),
      ]);
      expect([first.status, second.status]).toEqual([201, 201]);
      expect(first.body.batchId).toBe(second.body.batchId);
      const rows = await prisma.basicPriceImportRow.count({ where: { batchId: first.body.batchId } });
      expect(rows).toBe(first.body.totalRows);
    });
  });

  describe('row resolution', () => {
    const resolveRow = (batchId: string, rowId: string, version: number, resourceCatalogId: string, unitDefinitionId: string, token = assignedToken) =>
      request(app.getHttpServer())
        .post(`/basic-price-imports/${batchId}/rows/${rowId}/resolve`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', WORKSPACE_A)
        .send({ version, resourceCatalogId, unitDefinitionId });

    const rejectRow = (batchId: string, rowId: string, version: number, reason: string, token = assignedToken) =>
      request(app.getHttpServer())
        .post(`/basic-price-imports/${batchId}/rows/${rowId}/reject`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', WORKSPACE_A)
        .send({ version, reason });

    it('resolves a row to READY_FOR_SUBMISSION when the identity is unambiguous', async () => {
      const buffer = await buildBasicPriceXlsx();
      const preview = await previewFile(buffer, 'resolve-clean').expect(201);
      const row = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === 9);

      const response = await resolveRow(preview.body.batchId, row.id, row.version, RESOURCE_LABOR_ID, UNIT_ID).expect(201);
      expect(response.body.status).toBe('READY_FOR_SUBMISSION');
      expect(response.body.collisionType).toBe('NONE');
    });

    it('a stale version is rejected with 409, never silently applied (test matrix I06)', async () => {
      const buffer = await buildBasicPriceXlsx();
      const preview = await previewFile(buffer, 'resolve-stale-version').expect(201);
      const row = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === 9);

      await resolveRow(preview.body.batchId, row.id, 99, RESOURCE_LABOR_ID, UNIT_ID).expect(409);
    });

    it('two rows resolved to the same identity with the same value stay NEEDS_REVIEW, flagged as a collision, never both silently promoted', async () => {
      const buffer = await buildBasicPriceXlsx({ includeExactTieRounding: true });
      const preview = await previewFile(buffer, 'resolve-collision').expect(201);
      const rowA = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === 9);
      const rowB = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === 10);

      const first = await resolveRow(preview.body.batchId, rowA.id, rowA.version, RESOURCE_LABOR_ID, UNIT_ID).expect(201);
      expect(first.body.status).toBe('READY_FOR_SUBMISSION');

      const second = await resolveRow(preview.body.batchId, rowB.id, rowB.version, RESOURCE_LABOR_ID, UNIT_ID).expect(201);
      expect(second.body.status).toBe('NEEDS_REVIEW');
      expect(second.body.collisionType).toBe('SAME_IDENTITY_DIFFERENT_VALUE');
    });

    it('a rejected row requires a reason and can structurally never reach PriceSubmission', async () => {
      const buffer = await buildBasicPriceXlsx();
      const preview = await previewFile(buffer, 'reject-row').expect(201);
      const row = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === 9);

      await request(app.getHttpServer())
        .post(`/basic-price-imports/${preview.body.batchId}/rows/${row.id}/reject`)
        .set('Authorization', `Bearer ${assignedToken}`)
        .set('x-workspace-id', WORKSPACE_A)
        .send({ version: row.version })
        .expect(400); // reason is required — DTO validation, never a silent empty-reason reject

      const rejected = await rejectRow(preview.body.batchId, row.id, row.version, 'duplicate of an already-verified price').expect(201);
      expect(rejected.body.status).toBe('REJECTED');
      expect(await prisma.priceSubmission.count({ where: { resourceId: RESOURCE_LABOR_ID } })).toBe(0);
    });
  });

  describe('batch submission', () => {
    it('fails closed on missing effectiveDate/regionId/sourceOrigin, mutating nothing', async () => {
      const buffer = await buildBasicPriceXlsx();
      const preview = await previewFile(buffer, 'submit-preconditions').expect(201);
      const row = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === 9);
      const otherRows = preview.body.rows.filter((r: { sourceRowNumber: number }) => r.sourceRowNumber !== 9);

      await request(app.getHttpServer())
        .post(`/basic-price-imports/${preview.body.batchId}/rows/${row.id}/resolve`)
        .set('Authorization', `Bearer ${assignedToken}`).set('x-workspace-id', WORKSPACE_A)
        .send({ version: row.version, resourceCatalogId: RESOURCE_LABOR_ID, unitDefinitionId: UNIT_ID })
        .expect(201);
      // Every other row must also leave NEEDS_REVIEW so the batch genuinely
      // reaches READY_FOR_REVIEW -- otherwise submit's very first check
      // (BATCH_NOT_READY_FOR_REVIEW) would 409 before ever reaching the
      // effectiveDate/regionId/sourceOrigin checks this test means to prove.
      for (const other of otherRows) {
        await request(app.getHttpServer())
          .post(`/basic-price-imports/${preview.body.batchId}/rows/${other.id}/reject`)
          .set('Authorization', `Bearer ${assignedToken}`).set('x-workspace-id', WORKSPACE_A)
          .send({ version: other.version, reason: 'out of scope for this precondition scenario' })
          .expect(201);
      }

      const response = await request(app.getHttpServer())
        .post(`/basic-price-imports/${preview.body.batchId}/submit`)
        .set('Authorization', `Bearer ${assignedToken}`).set('x-workspace-id', WORKSPACE_A)
        .expect(409);
      expect(response.body.message).toBe('EFFECTIVE_DATE_REQUIRED_BEFORE_SUBMISSION');
      expect(await prisma.priceSubmission.count({ where: { resourceId: RESOURCE_LABOR_ID } })).toBe(0);
    });

    it('submits every READY_FOR_SUBMISSION row as a real PriceSubmission and is idempotent on replay', async () => {
      // The base fixture always yields three rows (LABOR row 9, MATERIAL
      // row 33, EQUIPMENT row 316) -- recomputeBatchStatus() only advances
      // the batch to READY_FOR_REVIEW once every row has left NEEDS_REVIEW
      // (resolved OR rejected), so the two rows this scenario isn't
      // exercising must be explicitly rejected, not just ignored.
      const buffer = await buildBasicPriceXlsx();
      const preview = await previewFile(buffer, 'submit-full-flow', assignedToken, {
        effectiveDate: '2026-07-25', regionId: REGION_ID, sourceOrigin: 'SUPPLIER', sourceType: 'MARKET_SURVEY',
      }).expect(201);
      const row = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === 9);
      const otherRows = preview.body.rows.filter((r: { sourceRowNumber: number }) => r.sourceRowNumber !== 9);

      await request(app.getHttpServer())
        .post(`/basic-price-imports/${preview.body.batchId}/rows/${row.id}/resolve`)
        .set('Authorization', `Bearer ${assignedToken}`).set('x-workspace-id', WORKSPACE_A)
        .send({ version: row.version, resourceCatalogId: RESOURCE_LABOR_ID, unitDefinitionId: UNIT_ID })
        .expect(201);
      for (const other of otherRows) {
        await request(app.getHttpServer())
          .post(`/basic-price-imports/${preview.body.batchId}/rows/${other.id}/reject`)
          .set('Authorization', `Bearer ${assignedToken}`).set('x-workspace-id', WORKSPACE_A)
          .send({ version: other.version, reason: 'out of scope for this submission scenario' })
          .expect(201);
      }

      const submitPath = `/basic-price-imports/${preview.body.batchId}/submit`;
      const first = await request(app.getHttpServer()).post(submitPath).set('Authorization', `Bearer ${assignedToken}`).set('x-workspace-id', WORKSPACE_A).expect(201);
      expect(first.body.status).toBe('SUBMITTED');
      expect(first.body.submittedRows).toBe(1);

      const submissions = await prisma.priceSubmission.findMany({ where: { resourceId: RESOURCE_LABOR_ID } });
      expect(submissions).toHaveLength(1);
      expect(submissions[0].status).toBe('SUBMITTED');
      expect(await prisma.priceSubmissionRevision.count({ where: { submissionId: submissions[0].id } })).toBe(1);
      expect(await prisma.priceSubmissionAudit.count({ where: { submissionId: submissions[0].id } })).toBe(1);

      // Idempotent replay: same batch, already SUBMITTED, no duplicate submission.
      const second = await request(app.getHttpServer()).post(submitPath).set('Authorization', `Bearer ${assignedToken}`).set('x-workspace-id', WORKSPACE_A).expect(201);
      expect(second.body.status).toBe('SUBMITTED');
      expect(await prisma.priceSubmission.count({ where: { resourceId: RESOURCE_LABOR_ID } })).toBe(1);
    });
  });

  describe('publication', () => {
    it('rejects publishing a BasicPrice that is not yet VERIFIED', async () => {
      const basicPrice = await prisma.basicPrice.create({
        data: { resourceId: RESOURCE_MATERIAL_ID, effectiveDate: new Date('2026-07-25'), value: '158333.33', verificationStatus: 'UNVERIFIED' },
      });
      await request(app.getHttpServer())
        .post(`/basic-prices/${basicPrice.id}/publish`)
        .set('Authorization', `Bearer ${assignedToken}`).set('x-workspace-id', WORKSPACE_A)
        .expect(409);
      expect((await prisma.basicPrice.findUniqueOrThrow({ where: { id: basicPrice.id } })).status).toBe('UNPUBLISHED');
    });

    it('publishes a VERIFIED BasicPrice, writes exactly one audit row with the human actor, and is idempotent on replay', async () => {
      const basicPrice = await prisma.basicPrice.create({
        data: { resourceId: RESOURCE_MATERIAL_ID, effectiveDate: new Date('2026-07-25'), value: '1100000.00', verificationStatus: 'VERIFIED' },
      });
      const publishPath = `/basic-prices/${basicPrice.id}/publish`;
      const first = await request(app.getHttpServer()).post(publishPath).set('Authorization', `Bearer ${assignedToken}`).set('x-workspace-id', WORKSPACE_A).expect(201);
      expect(first.body.status).toBe('PUBLISHED');

      const audits = await prisma.basicPricePublicationAudit.findMany({ where: { basicPriceId: basicPrice.id } });
      expect(audits).toHaveLength(1);
      expect(audits[0].actorAccountId).toBe(assignedAccountId);

      const second = await request(app.getHttpServer()).post(publishPath).set('Authorization', `Bearer ${assignedToken}`).set('x-workspace-id', WORKSPACE_A).expect(201);
      expect(second.body.status).toBe('PUBLISHED');
      expect(await prisma.basicPricePublicationAudit.count({ where: { basicPriceId: basicPrice.id } })).toBe(1);
    });
  });

  // Standalone, self-contained regression: BoqItem.quantity widened from
  // Decimal(18,2) to Decimal(18,6) (lossless widen, needed for the RM-02
  // migration's shared migration file) must never alter an existing
  // negative-quantity row's exact value — preserve-and-report-only, no new
  // classification (NEGATIVE_QUANTITY_SCOPE=PRESERVE_AND_REPORT_ONLY).
  it('preserves an existing negative BoqItem quantity byte-exactly through the widened Decimal(18,6) column', async () => {
    const projectId = '41000000-0000-4000-8000-000000000006';
    const structureId = '41000000-0000-4000-8000-000000000007';
    const orgA = await prisma.workspace.findUniqueOrThrow({ where: { id: WORKSPACE_A }, select: { organizationId: true } });
    try {
      await prisma.project.create({ data: { id: projectId, workspaceId: WORKSPACE_A, organizationId: orgA.organizationId, code: 'ACC-RM02-NEG-QTY', name: 'RM-02 negative quantity regression' } });
      await prisma.boqStructure.create({ data: { id: structureId, projectId, name: 'Working Draft', status: 'DRAFT', version: 1 } });
      const created = await prisma.boqItem.create({
        data: { boqStructureId: structureId, wbsCode: 'NEG-1', name: 'Negative quantity regression row', itemType: 'WORK_ITEM', quantity: '-5.00', unit: 'm3', sortOrder: 0 },
      });
      const reread = await prisma.boqItem.findUniqueOrThrow({ where: { id: created.id } });
      expect(reread.quantity.toFixed(2)).toBe('-5.00');
    } finally {
      await prisma.boqItem.deleteMany({ where: { boqStructureId: structureId } });
      await prisma.boqStructure.deleteMany({ where: { id: structureId } });
      await prisma.project.deleteMany({ where: { id: projectId } });
    }
  });
});
