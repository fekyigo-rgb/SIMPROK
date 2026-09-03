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
const WORKSPACE_B = '10000000-0000-4000-8000-000000000005';
const PASSWORD = 'Test1234!';

const REGION_ID = '41000000-0000-4000-8000-000000000001';
const RESOURCE_MATERIAL_ID = '41000000-0000-4000-8000-000000000002';
const RESOURCE_LABOR_ID = '41000000-0000-4000-8000-000000000003';
const UNIT_ID = '41000000-0000-4000-8000-000000000004';
const ROLE_ID = '41000000-0000-4000-8000-000000000005';
const RESOURCE_WORKSPACE_B_ID = '41000000-0000-4000-8000-000000000006';
const RESOURCE_GLOBAL_ID = '41000000-0000-4000-8000-000000000007';
const RESOURCE_INACTIVE_ID = '41000000-0000-4000-8000-000000000008';
const UNIT_INACTIVE_ID = '41000000-0000-4000-8000-000000000009';
const UNIT_ALIAS_ID = '41000000-0000-4000-8000-00000000000a';
const ROLE_B_ID = '41000000-0000-4000-8000-00000000000b';
// RM-02D2A-1: a second human, distinct from `assigned@test.local` (the
// verifier in the publication tests below), holding ONLY BASIC_PRICE_PUBLISH
// — proves Owner Lock's VERIFIER_MUST_DIFFER_FROM_PUBLISHER against a real
// least-privilege actor, not a superuser.
const ROLE_PUBLISHER_ID = '41000000-0000-4000-8000-00000000000c';

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
  let crosstenantToken: string;
  let assignedAccountId: string;
  let foremanAccountId: string;
  let membershipRoleId: string;
  let membershipRoleBId: string;
  let publisherMembershipRoleId: string;
  /**
   * The REAL canonical unit for row 9's own spelling "Org/Hari" (PERSON_DAY).
   * ACC-UNIT-ORGHARI below stays: it is this suite's lookup-shape fixture, and
   * a unit no alias can reach is exactly what a reviewer must not be able to
   * bind a price to.
   */
  let personDayUnitId: string;

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
    const reviewPermission = permissions.find((permission) => permission.code === 'BASIC_PRICE_REVIEW_VIEW')!;
    await prisma.role.upsert({
      where: { id: ROLE_B_ID },
      create: { id: ROLE_B_ID, workspaceId: WORKSPACE_B, code: 'RM02C2_LOOKUP_B', name: 'RM02C2 Lookup Workspace B' },
      update: {},
    });
    await prisma.rolePermission.createMany({
      data: [{ roleId: ROLE_B_ID, permissionId: reviewPermission.id }],
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
    const crosstenantAccount = await prisma.account.findUniqueOrThrow({ where: { email: 'crosstenant@test.local' } });
    const crosstenantMembership = await prisma.workspaceMembership.findUniqueOrThrow({
      where: { accountId_workspaceId: { accountId: crosstenantAccount.id, workspaceId: WORKSPACE_B } },
    });
    const membershipRoleB = await prisma.membershipRole.create({
      data: { workspaceMembershipId: crosstenantMembership.id, roleId: ROLE_B_ID, isActive: true },
    });
    membershipRoleBId = membershipRoleB.id;

    // RM-02D2A-1: foreman@test.local becomes the dedicated publisher actor
    // — explicitly granted ONLY BASIC_PRICE_PUBLISH via role, distinct from
    // assigned@test.local (the verifier). RM02D2A2-REMEDIATION-03: foreman's
    // WorkspaceMembership is ACTIVE (seed-acceptance.ts), so under the
    // active-membership baseline (Owner Decision ONE SIMPROK BASIC PRICE
    // PRODUCT MODEL) foreman ALSO holds BASIC_PRICE_VIEW/_IMPORT/_RESOLVE/
    // _SUBMIT structurally now, regardless of role — foreman genuinely
    // lacks only BASIC_PRICE_VERIFY and BASIC_PRICE_REVIEW_VIEW (both
    // remain governed/role-only, never baseline).
    const foremanAccount = await prisma.account.findUniqueOrThrow({ where: { email: 'foreman@test.local' } });
    foremanAccountId = foremanAccount.id;
    const foremanMembership = await prisma.workspaceMembership.findUniqueOrThrow({
      where: { accountId_workspaceId: { accountId: foremanAccount.id, workspaceId: WORKSPACE_A } },
    });
    const publishPermission = permissions.find((permission) => permission.code === 'BASIC_PRICE_PUBLISH')!;
    await prisma.role.upsert({
      where: { id: ROLE_PUBLISHER_ID },
      create: { id: ROLE_PUBLISHER_ID, workspaceId: WORKSPACE_A, code: 'ACCEPTANCE_BASIC_PRICE_PUBLISHER', name: 'Acceptance Basic Price Publisher' },
      update: {},
    });
    await prisma.rolePermission.createMany({
      data: [{ roleId: ROLE_PUBLISHER_ID, permissionId: publishPermission.id }],
      skipDuplicates: true,
    });
    const publisherMembershipRole = await prisma.membershipRole.create({
      data: { workspaceMembershipId: foremanMembership.id, roleId: ROLE_PUBLISHER_ID, isActive: true },
    });
    publisherMembershipRoleId = publisherMembershipRole.id;

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
    await prisma.resourceCatalog.createMany({
      data: [
        { id: RESOURCE_WORKSPACE_B_ID, workspaceId: WORKSPACE_B, code: 'B-SECRET', name: 'Workspace B Secret', type: 'MATERIAL', baseUnit: 'M3' },
        { id: RESOURCE_GLOBAL_ID, workspaceId: null, code: 'GLOBAL-HIDDEN', name: 'Global Hidden', type: 'MATERIAL', baseUnit: 'M3' },
        { id: RESOURCE_INACTIVE_ID, workspaceId: WORKSPACE_A, code: 'INACTIVE-HIDDEN', name: 'Inactive Hidden', type: 'MATERIAL', baseUnit: 'M3', status: 'INACTIVE' },
      ],
      skipDuplicates: true,
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
    await prisma.unitDefinition.upsert({
      where: { id: UNIT_INACTIVE_ID },
      create: { id: UNIT_INACTIVE_ID, code: 'ACC-INACTIVE-UNIT', displayName: 'Inactive Unit', symbol: 'IU', dimension: 'COUNT', kind: 'CANONICAL', isActive: false },
      update: { isActive: false },
    });
    personDayUnitId = (
      await prisma.unitDefinition.findFirstOrThrow({
        where: { code: 'PERSON_DAY' },
      })
    ).id;
    await prisma.unitAlias.upsert({
      where: { id: UNIT_ALIAS_ID },
      create: { id: UNIT_ALIAS_ID, unitDefinitionId: UNIT_ID, rawAlias: 'orang hari', normalizedAlias: 'ORANG_HARI', isActive: true },
      update: { isActive: true },
    });

    const login = async (email: string) =>
      (await request(app.getHttpServer()).post('/auth/login').send({ email, password: PASSWORD })).body.access_token;
    assignedToken = await login('assigned@test.local');
    foremanToken = await login('foreman@test.local');
    crosstenantToken = await login('crosstenant@test.local');
  });

  afterEach(async () => {
    // BasicPriceImportRow cascades away with its batch (onDelete: Cascade),
    // which clears the Restrict FKs pointing at our resource/unit fixtures
    // — this must run before the resource/unit/region deletes in afterAll.
    // BasicPrice.sourceSubmissionId -> PriceSubmission has no cascade
    // (RM-02D2A-1 CONTRACT_UPDATE), so BasicPrice must be deleted before
    // PriceSubmission or the delete violates that FK.
    await prisma.basicPriceImportBatch.deleteMany({ where: { workspaceId: WORKSPACE_A } });
    await prisma.basicPrice.deleteMany({ where: { resourceId: { in: [RESOURCE_MATERIAL_ID, RESOURCE_LABOR_ID] } } });
    await prisma.priceSubmission.deleteMany({ where: { resourceId: { in: [RESOURCE_MATERIAL_ID, RESOURCE_LABOR_ID] } } });
  });

  afterAll(async () => {
    await prisma.basicPriceImportBatch.deleteMany({ where: { workspaceId: WORKSPACE_A } });
    await prisma.basicPrice.deleteMany({ where: { resourceId: { in: [RESOURCE_MATERIAL_ID, RESOURCE_LABOR_ID] } } });
    await prisma.priceSubmission.deleteMany({ where: { resourceId: { in: [RESOURCE_MATERIAL_ID, RESOURCE_LABOR_ID] } } });
    await prisma.membershipRole.deleteMany({ where: { id: publisherMembershipRoleId } });
    await prisma.rolePermission.deleteMany({ where: { roleId: ROLE_PUBLISHER_ID } });
    await prisma.role.deleteMany({ where: { id: ROLE_PUBLISHER_ID } });
    await prisma.resourceCatalog.deleteMany({
      where: { id: { in: [RESOURCE_MATERIAL_ID, RESOURCE_LABOR_ID, RESOURCE_WORKSPACE_B_ID, RESOURCE_GLOBAL_ID, RESOURCE_INACTIVE_ID] } },
    });
    await prisma.unitAlias.deleteMany({ where: { id: UNIT_ALIAS_ID } });
    await prisma.unitDefinition.deleteMany({ where: { id: { in: [UNIT_ID, UNIT_INACTIVE_ID] } } });
    await prisma.region.deleteMany({ where: { id: REGION_ID } });
    await prisma.membershipRole.deleteMany({ where: { id: membershipRoleId } });
    await prisma.membershipRole.deleteMany({ where: { id: membershipRoleBId } });
    await prisma.rolePermission.deleteMany({ where: { roleId: { in: [ROLE_ID, ROLE_B_ID] } } });
    await prisma.role.deleteMany({ where: { id: { in: [ROLE_ID, ROLE_B_ID] } } });
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

  const lookup = (route: 'resources' | 'units', token?: string, workspaceId = WORKSPACE_A) => {
    let req = request(app.getHttpServer()).get(`/basic-price-import-lookups/${route}`).set('x-workspace-id', workspaceId);
    if (token) req = req.set('Authorization', `Bearer ${token}`);
    return req;
  };

  describe('RM-02C2 catalog lookup boundary', () => {
    const lookupDataFingerprint = async () =>
      JSON.stringify({
        resources: await prisma.resourceCatalog.findMany({
          select: { id: true, workspaceId: true, code: true, name: true, type: true, baseUnit: true, status: true },
          orderBy: { id: 'asc' },
        }),
        units: await prisma.unitDefinition.findMany({
          select: { id: true, code: true, displayName: true, symbol: true, dimension: true, kind: true, isActive: true },
          orderBy: { id: 'asc' },
        }),
        aliases: await prisma.unitAlias.findMany({
          select: { id: true, rawAlias: true, normalizedAlias: true, unitDefinitionId: true, isActive: true },
          orderBy: { id: 'asc' },
        }),
      });

    // LEGACY_TEST_CHANGE_REGISTER (Amendment A2): OLD_EXPECTATION was that
    // an ACTIVE-but-ungranted actor (foremanToken) is denied this route
    // (403). RM02D2A2-REMEDIATION-03 moved this lookup's guard from the
    // internal BASIC_PRICE_REVIEW_VIEW to the user-owned-import
    // BASIC_PRICE_RESOLVE (Owner Decision: this is Activity A — a user
    // resolving their own batch's rows — never internal curation), which is
    // an active-membership baseline permission. foreman's ACTIVE membership
    // now structurally holds it, so the route now succeeds (200).
    // TEST_WEAKENING=NO: unauthenticated access still 401 (unchanged); a
    // genuinely different workspace/tenant is still denied (see the
    // dedicated cross-tenant test below), and internal-curation routes
    // (/basic-price-reviews/*, /basic-price-publications/*) are untouched
    // and still require their own governed permission.
    it('requires authentication; any ACTIVE membership (even foreman, granted only BASIC_PRICE_PUBLISH) reaches this user-owned-import lookup via the active-membership baseline', async () => {
      await lookup('resources').expect(401);
      await lookup('resources', foremanToken).expect(200);
      await lookup('resources', assignedToken).expect(200);
    });

    it('returns only active resources owned by the active workspace', async () => {
      const first = await lookup('resources', assignedToken).query({ q: 'Acceptance', page: 1, limit: 1 }).expect(200);
      const second = await lookup('resources', assignedToken).query({ q: 'Acceptance', page: 2, limit: 1 }).expect(200);
      expect(first.body).toEqual(expect.objectContaining({ page: 1, limit: 1, total: 2, hasNext: true }));
      expect(second.body).toEqual(expect.objectContaining({ page: 2, limit: 1, total: 2, hasNext: false }));
      expect(first.body.items).toHaveLength(1);
      expect(second.body.items).toHaveLength(1);
      expect(second.body.items[0].id).not.toBe(first.body.items[0].id);

      const hidden = await lookup('resources', assignedToken).query({ q: 'Hidden' }).expect(200);
      expect(hidden.body.items).toEqual([]);
      expect(JSON.stringify(hidden.body)).not.toContain(RESOURCE_GLOBAL_ID);
      expect(JSON.stringify(hidden.body)).not.toContain(RESOURCE_INACTIVE_ID);
      expect(JSON.stringify(hidden.body)).not.toContain(RESOURCE_WORKSPACE_B_ID);
    });

    it('keeps Workspace-A candidates undiscoverable from authorized Workspace-B', async () => {
      const response = await lookup('resources', crosstenantToken, WORKSPACE_B).query({ q: 'Acceptance' }).expect(200);
      expect(response.body.items).toEqual([]);
      const own = await lookup('resources', crosstenantToken, WORKSPACE_B).query({ q: 'Workspace B Secret' }).expect(200);
      expect(own.body.items).toHaveLength(1);
      expect(own.body.items[0].id).toBe(RESOURCE_WORKSPACE_B_ID);
    });

    it('finds an active alias once and returns only the bounded canonical-unit shape', async () => {
      const response = await lookup('units', assignedToken).query({ q: 'orang hari' }).expect(200);
      expect(response.body.items).toEqual([
        {
          id: UNIT_ID,
          code: 'ACC-UNIT-ORGHARI',
          displayName: 'Orang per Hari',
          symbol: 'Org/Hari',
          dimension: 'PERSON_TIME',
          kind: 'CANONICAL',
        },
      ]);
      expect(JSON.stringify(response.body)).not.toContain('conversion');
    });

    it('both GET lookup routes leave their complete source data fingerprint unchanged', async () => {
      const before = await lookupDataFingerprint();
      await lookup('resources', assignedToken).query({ q: 'ACC', type: 'MATERIAL', page: 1, limit: 20 }).expect(200);
      await lookup('units', assignedToken).query({ q: 'orang hari', dimension: 'PERSON_TIME', kind: 'CANONICAL' }).expect(200);
      expect(await lookupDataFingerprint()).toBe(before);
    });
  });

  describe('permission boundary', () => {
    // LEGACY_TEST_CHANGE_REGISTER (Amendment A2): OLD_EXPECTATION was that
    // an actor with no explicit BASIC_PRICE_IMPORT role grant is denied
    // (403). Owner Decision ONE SIMPROK BASIC PRICE PRODUCT MODEL makes
    // BASIC_PRICE_IMPORT an active-membership baseline — foreman's ACTIVE
    // membership grants it structurally, with no role needed. This is not
    // "permission not granted" any more; it is the corrected default.
    // TEST_WEAKENING=NO: PermissionsGuard/resolver is still genuinely
    // exercised (see the dedicated resolver unit tests for the true
    // denied case — missing/inactive/invited/suspended membership).
    it('any ACTIVE membership (even foreman, granted only BASIC_PRICE_PUBLISH) can preview via the active-membership baseline — never 500', async () => {
      const buffer = await buildBasicPriceXlsx();
      const response = await previewFile(buffer, 'baseline-import-default', foremanToken).expect(201);
      expect(response.body.batchId).toBeDefined();
    });

    it('a granted BASIC_PRICE_IMPORT permission allows preview, exercising the real PermissionsGuard/resolver path', async () => {
      const buffer = await buildBasicPriceXlsx();
      const response = await previewFile(buffer, 'granted-permission-check').expect(201);
      expect(response.body.batchId).toBeDefined();
    });
  });

  describe('preview / parsing evidence', () => {
    /**
     * UNSUPPORTED INPUT FAILS SPECIFICALLY, NOT GENERICALLY.
     *
     * The reader law already refuses unreadable bytes, but it was proven only at
     * the reader — never through the door a person actually uses. That gap
     * matters because the failure mode being guarded against is not "it was
     * rejected", it is "it was rejected with a sentence nobody can act on":
     * a 500, or a message blaming a workbook SIMPROK never opened.
     *
     * So this asserts the SHAPE of the refusal at the official endpoint — a 4xx
     * carrying one of intake's own NAMED codes, which is what lets the browser
     * tell a question about the document apart from a permission or a fault.
     */
    it('refuses an unsupported/unreadable source with a NAMED intake code, never a generic fault', async () => {
      const notAWorkbook = Buffer.from(
        'this is not a spreadsheet, it is a sentence',
        'utf8',
      );
      const response = await previewFile(notAWorkbook, 'unsupported-source');
      const body = response.body as { message?: unknown };

      // 4xx: SIMPROK's own refusal, never a crash.
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
      // A named code the browser can turn into a question about the document.
      expect(typeof body.message).toBe('string');
      expect([
        'UNSUPPORTED_SOURCE_FORMAT',
        'SOURCE_UNREADABLE',
        'WORKBOOK_HAS_NO_SHEETS',
        'NO_PRICE_TABLE_DETECTED',
      ]).toContain(body.message);

      // AND NOTHING WAS STORED. A refused document leaves no half-batch.
      const batches = await prisma.basicPriceImportBatch.count({
        where: {
          workspaceId: WORKSPACE_A,
          sourceVendorName: 'unsupported-source',
        },
      });
      expect(batches).toBe(0);
    });

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

      const response = await resolveRow(preview.body.batchId, row.id, row.version, RESOURCE_LABOR_ID, personDayUnitId).expect(201);
      expect(response.body.status).toBe('READY_FOR_SUBMISSION');
      expect(response.body.collisionType).toBe('NONE');
    });

    it.each([
      ['cross-workspace', RESOURCE_WORKSPACE_B_ID],
      ['global', RESOURCE_GLOBAL_ID],
      ['inactive', RESOURCE_INACTIVE_ID],
    ])('rejects direct %s resource IDs even when the UI is bypassed', async (_label, resourceId) => {
      const preview = await previewFile(await buildBasicPriceXlsx(), `blocked-${_label}`).expect(201);
      const row = preview.body.rows.find((candidate: { sourceRowNumber: number }) => candidate.sourceRowNumber === 9);
      const before = await prisma.basicPriceImportRow.findUniqueOrThrow({ where: { id: row.id } });
      const response = await resolveRow(preview.body.batchId, row.id, row.version, resourceId, personDayUnitId).expect(409);
      expect(response.body.message).toBe('RESOURCE_UNKNOWN_OR_OUTSIDE_WORKSPACE');
      const after = await prisma.basicPriceImportRow.findUniqueOrThrow({ where: { id: row.id } });
      expect(after.version).toBe(before.version);
      expect(after.resourceCatalogId).toBe(before.resourceCatalogId);
    });

    it('rejects a direct inactive UnitDefinition ID without writing the row', async () => {
      const preview = await previewFile(await buildBasicPriceXlsx(), 'blocked-inactive-unit').expect(201);
      const row = preview.body.rows.find((candidate: { sourceRowNumber: number }) => candidate.sourceRowNumber === 9);
      await resolveRow(preview.body.batchId, row.id, row.version, RESOURCE_LABOR_ID, UNIT_INACTIVE_ID).expect(409);
      const after = await prisma.basicPriceImportRow.findUniqueOrThrow({ where: { id: row.id } });
      expect(after.version).toBe(row.version);
      expect(after.unitDefinitionId).toBeNull();
    });

    it('a stale version is rejected with 409, never silently applied (test matrix I06)', async () => {
      const buffer = await buildBasicPriceXlsx();
      const preview = await previewFile(buffer, 'resolve-stale-version').expect(201);
      const row = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === 9);

      await resolveRow(preview.body.batchId, row.id, 99, RESOURCE_LABOR_ID, personDayUnitId).expect(409);
    });

    it('two rows resolved to the same identity with the same value stay NEEDS_REVIEW, flagged as a collision, never both silently promoted', async () => {
      const buffer = await buildBasicPriceXlsx({ includeExactTieRounding: true });
      const preview = await previewFile(buffer, 'resolve-collision').expect(201);
      const rowA = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === 9);
      const rowB = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === 10);

      const first = await resolveRow(preview.body.batchId, rowA.id, rowA.version, RESOURCE_LABOR_ID, personDayUnitId).expect(201);
      expect(first.body.status).toBe('READY_FOR_SUBMISSION');

      const second = await resolveRow(preview.body.batchId, rowB.id, rowB.version, RESOURCE_LABOR_ID, personDayUnitId).expect(201);
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
        .send({ version: row.version, resourceCatalogId: RESOURCE_LABOR_ID, unitDefinitionId: personDayUnitId })
        .expect(201);
      // Partial proposal no longer requires every neighbour to leave
      // NEEDS_REVIEW first. This scenario still rejects the other rows so
      // the batch is fully decided — it is proving the metadata gate, not
      // the all-rows-ready gate.
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
      const preview = await previewFile(
        buffer,
        'submit-full-flow',
        assignedToken,
        {
          effectiveDate: '2026-07-25',
          regionId: REGION_ID,
          // FIELD_REPORT, because this test SUBMITS, and the curation door
          // serves the field/community family only — a supplier's own quote is
          // recorded with its source rather than put to community
          // verification, and the endpoint now enforces that rather than the UI
          // merely hiding it.
          sourceOrigin: 'FIELD_REPORT',
          sourceType: 'MARKET_SURVEY',
        },
      ).expect(201);
      const row = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === 9);
      const otherRows = preview.body.rows.filter((r: { sourceRowNumber: number }) => r.sourceRowNumber !== 9);

      await request(app.getHttpServer())
        .post(`/basic-price-imports/${preview.body.batchId}/rows/${row.id}/resolve`)
        .set('Authorization', `Bearer ${assignedToken}`).set('x-workspace-id', WORKSPACE_A)
        .send({ version: row.version, resourceCatalogId: RESOURCE_LABOR_ID, unitDefinitionId: personDayUnitId })
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
      // PARTIALLY_SUBMITTED, not SUBMITTED: the other two rows in this
      // batch were deliberately rejected above, and submitBatch's final
      // status is PARTIALLY_SUBMITTED whenever any row in the batch is
      // REJECTED, even though every READY_FOR_SUBMISSION row succeeded.
      expect(first.body.status).toBe('PARTIALLY_SUBMITTED');
      expect(first.body.submittedRows).toBe(1);

      const submissions = await prisma.priceSubmission.findMany({ where: { resourceId: RESOURCE_LABOR_ID } });
      expect(submissions).toHaveLength(1);
      // RM-02D2A-1 CONTRACT_UPDATE: submitBatch() now creates the
      // PriceSubmissionReview in the same transaction (Work Package A), so
      // the submission has already moved past SUBMITTED to UNDER_REVIEW by
      // the time this response returns — it is never observably left at
      // SUBMITTED with no review, which was the RUNTIME_HUMAN_REVIEW_
      // ENTRYPOINT=MISSING gap this task closes.
      expect(submissions[0].status).toBe('UNDER_REVIEW');
      expect(await prisma.priceSubmissionRevision.count({ where: { submissionId: submissions[0].id } })).toBe(1);
      // RM02_IMPORT_SUBMISSION (submit) + STEP-2.6b_REVIEW_CREATED (review
      // creation, same transaction).
      expect(await prisma.priceSubmissionAudit.count({ where: { submissionId: submissions[0].id } })).toBe(2);
      const review = await prisma.priceSubmissionReview.findUnique({ where: { priceSubmissionId: submissions[0].id } });
      expect(review).not.toBeNull();
      expect(review!.slaState).toBe('OPEN');

      // Idempotent replay: same batch, already PARTIALLY_SUBMITTED, no duplicate submission.
      const second = await request(app.getHttpServer()).post(submitPath).set('Authorization', `Bearer ${assignedToken}`).set('x-workspace-id', WORKSPACE_A).expect(201);
      expect(second.body.status).toBe('PARTIALLY_SUBMITTED');
      expect(await prisma.priceSubmission.count({ where: { resourceId: RESOURCE_LABOR_ID } })).toBe(1);
    });

    it('proposes only READY_FOR_SUBMISSION rows while unresolved neighbours stay open', async () => {
      const buffer = await buildBasicPriceXlsx();
      const preview = await previewFile(
        buffer,
        'submit-partial-wave',
        assignedToken,
        {
          effectiveDate: '2026-07-25',
          regionId: REGION_ID,
          sourceOrigin: 'FIELD_REPORT',
          sourceType: 'MARKET_SURVEY',
        },
      ).expect(201);
      const row = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === 9);
      const otherRows = preview.body.rows.filter((r: { sourceRowNumber: number }) => r.sourceRowNumber !== 9);
      expect(otherRows.length).toBeGreaterThan(0);

      await request(app.getHttpServer())
        .post(`/basic-price-imports/${preview.body.batchId}/rows/${row.id}/resolve`)
        .set('Authorization', `Bearer ${assignedToken}`).set('x-workspace-id', WORKSPACE_A)
        .send({ version: row.version, resourceCatalogId: RESOURCE_LABOR_ID, unitDefinitionId: personDayUnitId })
        .expect(201);

      const submitPath = `/basic-price-imports/${preview.body.batchId}/submit`;
      const first = await request(app.getHttpServer())
        .post(submitPath)
        .set('Authorization', `Bearer ${assignedToken}`)
        .set('x-workspace-id', WORKSPACE_A)
        .expect(201);

      expect(first.body.status).toBe('NEEDS_REVIEW');
      expect(first.body.submittedRows).toBe(1);
      expect(first.body.needsReviewRows).toBe(otherRows.length);

      const submittedRow = await prisma.basicPriceImportRow.findUniqueOrThrow({
        where: { id: row.id },
      });
      expect(submittedRow.status).toBe('SUBMISSION_CREATED');
      expect(submittedRow.priceSubmissionId).toBeTruthy();
      expect(
        await prisma.basicPrice.count({
          where: { sourceSubmissionId: submittedRow.priceSubmissionId! },
        }),
      ).toBe(0);

      for (const other of otherRows) {
        const leftover = await prisma.basicPriceImportRow.findUniqueOrThrow({
          where: { id: other.id },
        });
        expect(leftover.status).toBe('NEEDS_REVIEW');
        expect(leftover.priceSubmissionId).toBeNull();
      }

      const replay = await request(app.getHttpServer())
        .post(submitPath)
        .set('Authorization', `Bearer ${assignedToken}`)
        .set('x-workspace-id', WORKSPACE_A)
        .expect(409);
      expect(replay.body.message).toBe('NO_ROWS_READY_FOR_SUBMISSION');
      expect(
        await prisma.priceSubmission.count({
          where: { id: submittedRow.priceSubmissionId! },
        }),
      ).toBe(1);
    });
  });

  describe('publication (RM-02D2A-1 Owner Lock: atomic two-axis, verifier != publisher)', () => {
    // Builds the exact real evidence chain
    // BasicPrice.sourceSubmission -> PriceSubmission.review ->
    // PriceSubmissionReviewDecision(ACCEPT) -> decidedByUserId that
    // BasicPricePublicationService traces to find the verifier's Account.
    const buildVerifiedBasicPrice = async (verifierUserId: string) => {
      const { organizationId } = await prisma.workspace.findUniqueOrThrow({ where: { id: WORKSPACE_A }, select: { organizationId: true } });
      const submission = await prisma.priceSubmission.create({
        data: {
          workspaceId: WORKSPACE_A,
          organizationId,
          resourceId: RESOURCE_MATERIAL_ID,
          sourceOrigin: 'FIELD_REPORT',
          sourceType: 'MARKET_SURVEY',
          status: 'VERIFIED',
        },
      });
      const revision = await prisma.priceSubmissionRevision.create({
        data: { submissionId: submission.id, revisionNumber: 1, value: '1100000.00', effectiveDate: new Date('2026-07-25'), validationPassed: true },
      });
      await prisma.priceSubmission.update({ where: { id: submission.id }, data: { currentRevisionId: revision.id } });
      const review = await prisma.priceSubmissionReview.create({
        data: { priceSubmissionId: submission.id, workspaceId: WORKSPACE_A, organizationId, slaState: 'RESOLVED', resolvedAt: new Date() },
      });
      await prisma.priceSubmissionReviewDecision.create({
        data: { reviewId: review.id, decidedByUserId: verifierUserId, action: 'ACCEPT' },
      });
      const basicPrice = await prisma.basicPrice.create({
        data: {
          resourceId: RESOURCE_MATERIAL_ID,
          workspaceId: WORKSPACE_A,
          organizationId,
          effectiveDate: new Date('2026-07-25'),
          value: '1100000.00',
          verificationStatus: 'VERIFIED',
          sourceSubmissionId: submission.id,
        },
      });
      return basicPrice;
    };

    it('rejects publishing a BasicPrice that is not yet VERIFIED', async () => {
      const { organizationId } = await prisma.workspace.findUniqueOrThrow({ where: { id: WORKSPACE_A }, select: { organizationId: true } });
      const basicPrice = await prisma.basicPrice.create({
        data: { resourceId: RESOURCE_MATERIAL_ID, workspaceId: WORKSPACE_A, organizationId, effectiveDate: new Date('2026-07-25'), value: '158333.33', verificationStatus: 'UNVERIFIED' },
      });
      const response = await request(app.getHttpServer())
        .post(`/basic-price-publications/${basicPrice.id}/publish`)
        .set('Authorization', `Bearer ${foremanToken}`).set('x-workspace-id', WORKSPACE_A)
        .expect(409);
      expect(response.body.message).toBe('INCONSISTENT_BASIC_PRICE_STATE');
      expect((await prisma.basicPrice.findUniqueOrThrow({ where: { id: basicPrice.id } })).status).toBe('UNPUBLISHED');
    });

    it('rejects a VERIFIED BasicPrice with no traceable ACCEPT-decision evidence', async () => {
      const { organizationId } = await prisma.workspace.findUniqueOrThrow({ where: { id: WORKSPACE_A }, select: { organizationId: true } });
      const basicPrice = await prisma.basicPrice.create({
        data: { resourceId: RESOURCE_MATERIAL_ID, workspaceId: WORKSPACE_A, organizationId, effectiveDate: new Date('2026-07-25'), value: '1100000.00', verificationStatus: 'VERIFIED' },
      });
      const response = await request(app.getHttpServer())
        .post(`/basic-price-publications/${basicPrice.id}/publish`)
        .set('Authorization', `Bearer ${foremanToken}`).set('x-workspace-id', WORKSPACE_A)
        .expect(409);
      expect(response.body.message).toBe('VERIFIER_EVIDENCE_MISSING');
    });

    it('rejects publish when the caller is the same human who verified it (VERIFIER_CANNOT_PUBLISH)', async () => {
      const verifierMembership = await prisma.workspaceMembership.findUniqueOrThrow({
        where: { accountId_workspaceId: { accountId: assignedAccountId, workspaceId: WORKSPACE_A } },
      });
      const verifierUser = await prisma.user.findUniqueOrThrow({ where: { workspaceMembershipId: verifierMembership.id } });
      const basicPrice = await buildVerifiedBasicPrice(verifierUser.id);

      const response = await request(app.getHttpServer())
        .post(`/basic-price-publications/${basicPrice.id}/publish`)
        .set('Authorization', `Bearer ${assignedToken}`).set('x-workspace-id', WORKSPACE_A)
        .expect(409);
      expect(response.body.message).toBe('VERIFIER_CANNOT_PUBLISH');
      expect((await prisma.basicPrice.findUniqueOrThrow({ where: { id: basicPrice.id } })).status).toBe('UNPUBLISHED');
      expect(await prisma.basicPricePublicationAudit.count({ where: { basicPriceId: basicPrice.id } })).toBe(0);
    });

    it('publishes a VERIFIED BasicPrice when the publisher differs from the verifier, writes exactly one atomic two-axis audit row, and is idempotent on replay', async () => {
      const verifierMembership = await prisma.workspaceMembership.findUniqueOrThrow({
        where: { accountId_workspaceId: { accountId: assignedAccountId, workspaceId: WORKSPACE_A } },
      });
      const verifierUser = await prisma.user.findUniqueOrThrow({ where: { workspaceMembershipId: verifierMembership.id } });
      const basicPrice = await buildVerifiedBasicPrice(verifierUser.id);

      const publishPath = `/basic-price-publications/${basicPrice.id}/publish`;
      const first = await request(app.getHttpServer()).post(publishPath).set('Authorization', `Bearer ${foremanToken}`).set('x-workspace-id', WORKSPACE_A).expect(201);
      expect(first.body.status).toBe('PUBLISHED');
      expect(first.body.verificationStatus).toBe('PUBLISHED');

      const audits = await prisma.basicPricePublicationAudit.findMany({ where: { basicPriceId: basicPrice.id } });
      expect(audits).toHaveLength(1);
      expect(audits[0].actorAccountId).toBe(foremanAccountId);
      expect(audits[0].actorAccountId).not.toBe(assignedAccountId);

      const second = await request(app.getHttpServer()).post(publishPath).set('Authorization', `Bearer ${foremanToken}`).set('x-workspace-id', WORKSPACE_A).expect(201);
      expect(second.body.status).toBe('PUBLISHED');
      expect(second.body.verificationStatus).toBe('PUBLISHED');
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
