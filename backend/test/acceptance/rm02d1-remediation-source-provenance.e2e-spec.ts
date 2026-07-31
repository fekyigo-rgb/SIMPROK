import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { buildBasicPriceXlsx } from '../fixtures/basic-price-xlsx.fixture';
import { BASIC_PRICE_PARSER_CONTRACT_VERSION } from '../../src/basic-price/basic-price-xlsx-intake.adapter';

/**
 * RM-02D1-REMEDIATION-V3.1 — SOURCE_ROW_PROVENANCE.
 *
 * Covers exactly what this remediation adds: a BasicPriceSourceEquivalence
 * record is the ONLY thing that lets a row's mapping candidates cross from
 * this batch's own source hash to a differently-hashed "canonical" source's
 * recorded ResourceSourceIdentity provenance. Zero equivalence records for
 * a given batch hash must mean zero provenance candidates for every row in
 * that batch — proven here with a second, unauthorized batch hash that
 * shares identical row content but no equivalence record. Also covers the
 * PROVENANCE_NAME_CONFLICT case (provenance and normalized-name point at
 * different catalog entries — both surfaced, neither silently preferred)
 * and workspace isolation of equivalence records.
 */
const WORKSPACE_A = '10000000-0000-4000-8000-000000000004';
const WORKSPACE_B = '10000000-0000-4000-8000-000000000005';
const PASSWORD = 'Test1234!';
const SHEET_NAME = 'HARGA SATUAN UPAH DAN BAHAN';
// Must satisfy resource_source_identities_source_sha256_format_check (^[0-9A-F]{64}$) — a fabricated but validly-shaped 64-char hex fixture value, not a real workbook hash.
const CANONICAL_SHA = 'FEE1'.repeat(16);

const RESOURCE_PROVENANCE_ID = '43000000-0000-4000-8000-000000000001';
const RESOURCE_NAME_MATCH_ID = '43000000-0000-4000-8000-000000000002';
const UNIT_ID = '43000000-0000-4000-8000-000000000003';
const ROLE_ID = '43000000-0000-4000-8000-000000000004';
const RESOURCE_ALTERNATE_LABOR_ID = '43000000-0000-4000-8000-000000000005';
const RESOURCE_MATERIAL_FOR_MISMATCH_ID = '43000000-0000-4000-8000-000000000006';

const PERMISSION_CODES = ['BASIC_PRICE_IMPORT', 'BASIC_PRICE_RESOLVE', 'BASIC_PRICE_REVIEW_VIEW'];

describe('RM02D1-REMEDIATION-V3.1 Source Row Provenance (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let assignedToken: string;
  let assignedAccountId: string;
  let membershipRoleId: string;

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    await app.init();
    prisma = new PrismaClient();

    const permissions = await Promise.all(
      PERMISSION_CODES.map((code) => prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} })),
    );
    await prisma.role.upsert({
      where: { id: ROLE_ID },
      create: { id: ROLE_ID, workspaceId: WORKSPACE_A, code: 'ACCEPTANCE_RM02D1_PROVENANCE', name: 'Acceptance RM-02D1 Provenance' },
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
    const membershipRole = await prisma.membershipRole.create({ data: { workspaceMembershipId: assignedMembership.id, roleId: ROLE_ID, isActive: true } });
    membershipRoleId = membershipRole.id;

    // RESOURCE_NAME_MATCH_ID is deliberately NOT created here — it is
    // scoped to only the "conflict" test below (created and torn down
    // there), so every other test in this file sees a clean, unambiguous
    // single-provenance-candidate world with no accidental second
    // normalized-name match.
    await prisma.resourceCatalog.createMany({
      data: [
        { id: RESOURCE_PROVENANCE_ID, workspaceId: WORKSPACE_A, code: 'RM02D1-PROV-01', name: 'Pekerja (provenanced)', type: 'LABOR', baseUnit: 'Org/Hari' },
        { id: RESOURCE_ALTERNATE_LABOR_ID, workspaceId: WORKSPACE_A, code: 'RM02D1-ALT-LABOR-01', name: 'Mandor (alternate, not name-matched)', type: 'LABOR', baseUnit: 'Org/Hari' },
        { id: RESOURCE_MATERIAL_FOR_MISMATCH_ID, workspaceId: WORKSPACE_A, code: 'RM02D1-MAT-MISMATCH-01', name: 'Semen (wrong type on purpose)', type: 'MATERIAL', baseUnit: 'Zak' },
      ],
    });
    await prisma.unitDefinition.upsert({
      where: { id: UNIT_ID },
      create: { id: UNIT_ID, code: 'RM02D1-PROV-UNIT', displayName: 'Acceptance Provenance Unit', symbol: 'APU', dimension: 'PERSON_TIME', kind: 'CANONICAL' },
      update: {},
    });
    // The canonical-side provenance evidence: row 9 of the fixture workbook
    // ("Pekerja"/L.01/Org-Hari) is recorded, under a distinct fabricated
    // canonical hash, as resolving to RESOURCE_PROVENANCE_ID.
    await prisma.resourceSourceIdentity.create({
      data: {
        resourceCatalogId: RESOURCE_PROVENANCE_ID,
        workspaceId: WORKSPACE_A,
        sourceSha256: CANONICAL_SHA,
        sourceFileName: 'canonical-fixture.xlsx',
        parserContractVersion: BASIC_PRICE_PARSER_CONTRACT_VERSION,
        sheetName: SHEET_NAME,
        sourceRowNumber: 9,
        sourceSection: 'LABOR',
        sourceNameCellAddress: 'C9',
        rawCode: 'L.01',
        rawName: 'Pekerja',
        rawUnit: 'Org/Hari',
      },
    });

    const login = async (email: string) => (await request(app.getHttpServer()).post('/auth/login').send({ email, password: PASSWORD })).body.access_token;
    assignedToken = await login('assigned@test.local');
  });

  afterEach(async () => {
    await prisma.basicPriceImportBatch.deleteMany({ where: { workspaceId: WORKSPACE_A } });
    await prisma.basicPriceSourceEquivalence.deleteMany({ where: { workspaceId: { in: [WORKSPACE_A, WORKSPACE_B] } } });
  });

  afterAll(async () => {
    await prisma.basicPriceImportBatch.deleteMany({ where: { workspaceId: WORKSPACE_A } });
    await prisma.basicPriceSourceEquivalence.deleteMany({ where: { workspaceId: { in: [WORKSPACE_A, WORKSPACE_B] } } });
    await prisma.resourceSourceIdentity.deleteMany({ where: { resourceCatalogId: RESOURCE_PROVENANCE_ID } });
    await prisma.resourceCatalog.deleteMany({
      where: { id: { in: [RESOURCE_PROVENANCE_ID, RESOURCE_NAME_MATCH_ID, RESOURCE_ALTERNATE_LABOR_ID, RESOURCE_MATERIAL_FOR_MISMATCH_ID] } },
    });
    await prisma.unitDefinition.deleteMany({ where: { id: UNIT_ID } });
    await prisma.membershipRole.deleteMany({ where: { id: membershipRoleId } });
    await prisma.rolePermission.deleteMany({ where: { roleId: ROLE_ID } });
    await prisma.role.deleteMany({ where: { id: ROLE_ID } });
    await prisma.permission.deleteMany({ where: { code: { in: PERMISSION_CODES } } });
    await prisma.$disconnect();
    await app.close();
  });

  const previewFile = (buffer: Buffer, sourceVendorName: string) =>
    request(app.getHttpServer())
      .post('/basic-price-imports/preview')
      .set('Authorization', `Bearer ${assignedToken}`)
      .set('x-workspace-id', WORKSPACE_A)
      .attach('file', buffer, { filename: 'basic-price.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      .field('selectedSheet', SHEET_NAME)
      .field('sourceVendorName', sourceVendorName);

  const getCandidates = (batchId: string, rowId: string) =>
    request(app.getHttpServer())
      .get(`/basic-price-imports/${batchId}/rows/${rowId}/candidates`)
      .set('Authorization', `Bearer ${assignedToken}`)
      .set('x-workspace-id', WORKSPACE_A);

  const resolveRow = (batchId: string, rowId: string, version: number, resourceCatalogId: string) =>
    request(app.getHttpServer())
      .post(`/basic-price-imports/${batchId}/rows/${rowId}/resolve`)
      .set('Authorization', `Bearer ${assignedToken}`)
      .set('x-workspace-id', WORKSPACE_A)
      .send({ version, resourceCatalogId, unitDefinitionId: UNIT_ID });

  it('negative (fail-closed): with zero equivalence record, provenanceCandidate is always null even though the row content is byte-identical to what the canonical hash has provenance for', async () => {
    const preview = await previewFile(await buildBasicPriceXlsx(), 'd1r-no-equivalence').expect(201);
    const row = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === 9);

    const response = await getCandidates(preview.body.batchId, row.id).expect(200);
    expect(response.body.provenanceCandidate).toBeNull();
    expect(response.body.provenanceEquivalenceFound).toBe(false);
  });

  it('positive: once a human-authorized equivalence record exists for this batch source hash, the row surfaces its provenanced candidate and resolving to it is recorded as SOURCE_ROW_PROVENANCE', async () => {
    const preview = await previewFile(await buildBasicPriceXlsx(), 'd1r-with-equivalence').expect(201);
    const batch = await prisma.basicPriceImportBatch.findUniqueOrThrow({ where: { id: preview.body.batchId } });

    await prisma.basicPriceSourceEquivalence.create({
      data: {
        workspaceId: WORKSPACE_A,
        batchSourceSha256: batch.sourceSha256,
        canonicalSourceSha256: CANONICAL_SHA,
        evidence: 'ROW_IDENTICAL_TEST_FIXTURE',
        comparedFields: ['sourceSection', 'rawResourceCodeText', 'rawResourceNameText', 'rawUnitText'],
        verifiedByAccountId: assignedAccountId,
      },
    });

    const row = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === 9);
    const candidatesResponse = await getCandidates(preview.body.batchId, row.id).expect(200);
    expect(candidatesResponse.body.provenanceEquivalenceFound).toBe(true);
    expect(candidatesResponse.body.provenanceCandidate).toEqual(
      expect.objectContaining({ resourceCatalogId: RESOURCE_PROVENANCE_ID, name: 'Pekerja (provenanced)' }),
    );
    expect(candidatesResponse.body.conflict).toBe(false);

    const resolveResponse = await resolveRow(preview.body.batchId, row.id, row.version, RESOURCE_PROVENANCE_ID).expect(201);
    expect(resolveResponse.body.status).toBe('READY_FOR_SUBMISSION');

    const mapping = await prisma.basicPriceImportRowResourceMapping.findFirstOrThrow({ where: { rowId: row.id } });
    expect(mapping.suggestionSource).toBe('SOURCE_ROW_PROVENANCE');
    expect(mapping.reviewerAccountId).toBe(assignedAccountId);
  });

  it('conflict: provenance and normalized-name point at different catalog entries — both are surfaced, conflict is true, and resolving either way is recorded as PROVENANCE_NAME_CONFLICT (never silently reconciled)', async () => {
    // RESOURCE_NAME_MATCH_ID is created locally to this test only — it must
    // NOT exist during the other tests above, or it would also match row
    // 9's normalized name there and turn every "no conflict" assertion into
    // a false conflict.
    await prisma.resourceCatalog.create({
      data: { id: RESOURCE_NAME_MATCH_ID, workspaceId: WORKSPACE_A, code: 'RM02D1-NAME-01', name: 'Pekerja', type: 'LABOR', baseUnit: 'Org/Hari' },
    });
    try {
      const preview = await previewFile(await buildBasicPriceXlsx(), 'd1r-conflict').expect(201);
      const batch = await prisma.basicPriceImportBatch.findUniqueOrThrow({ where: { id: preview.body.batchId } });
      await prisma.basicPriceSourceEquivalence.create({
        data: {
          workspaceId: WORKSPACE_A,
          batchSourceSha256: batch.sourceSha256,
          canonicalSourceSha256: CANONICAL_SHA,
          evidence: 'ROW_IDENTICAL_TEST_FIXTURE',
          comparedFields: ['sourceSection', 'rawResourceCodeText', 'rawResourceNameText', 'rawUnitText'],
          verifiedByAccountId: assignedAccountId,
        },
      });

      const row = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === 9);
      expect(row.name).toBe('Pekerja');

      const candidatesResponse = await getCandidates(preview.body.batchId, row.id).expect(200);
      expect(candidatesResponse.body.provenanceCandidate.resourceCatalogId).toBe(RESOURCE_PROVENANCE_ID);
      expect(candidatesResponse.body.candidates.map((c: { resourceCatalogId: string }) => c.resourceCatalogId)).toContain(RESOURCE_NAME_MATCH_ID);
      expect(candidatesResponse.body.conflict).toBe(true);

      // The reviewer sides with the normalized-name candidate instead of provenance.
      await resolveRow(preview.body.batchId, row.id, row.version, RESOURCE_NAME_MATCH_ID).expect(201);
      const mapping = await prisma.basicPriceImportRowResourceMapping.findFirstOrThrow({ where: { rowId: row.id } });
      expect(mapping.suggestionSource).toBe('PROVENANCE_NAME_CONFLICT');
      expect(mapping.resourceCatalogId).toBe(RESOURCE_NAME_MATCH_ID);
    } finally {
      // The batch (and its rows, and their mapping-decision audit rows)
      // must go first — BasicPriceImportRowResourceMapping.resourceCatalogId
      // is onDelete: Restrict, so RESOURCE_NAME_MATCH_ID can't be removed
      // while a mapping row still references it.
      await prisma.basicPriceImportBatch.deleteMany({ where: { workspaceId: WORKSPACE_A } });
      await prisma.resourceCatalog.deleteMany({ where: { id: RESOURCE_NAME_MATCH_ID } });
    }
  });

  it('never auto-resolves: candidates are fetched repeatedly without ever mutating the row, even when a single unambiguous provenance candidate exists', async () => {
    const preview = await previewFile(await buildBasicPriceXlsx(), 'd1r-no-auto-resolve').expect(201);
    const batch = await prisma.basicPriceImportBatch.findUniqueOrThrow({ where: { id: preview.body.batchId } });
    await prisma.basicPriceSourceEquivalence.create({
      data: {
        workspaceId: WORKSPACE_A,
        batchSourceSha256: batch.sourceSha256,
        canonicalSourceSha256: CANONICAL_SHA,
        evidence: 'ROW_IDENTICAL_TEST_FIXTURE',
        comparedFields: ['sourceSection', 'rawResourceCodeText', 'rawResourceNameText', 'rawUnitText'],
        verifiedByAccountId: assignedAccountId,
      },
    });
    const row = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === 9);
    const before = await prisma.basicPriceImportRow.findUniqueOrThrow({ where: { id: row.id } });

    await getCandidates(preview.body.batchId, row.id).expect(200);
    await getCandidates(preview.body.batchId, row.id).expect(200);

    const after = await prisma.basicPriceImportRow.findUniqueOrThrow({ where: { id: row.id } });
    expect(after).toEqual(before);
    expect(after.resourceCatalogId).toBeNull();
    expect(after.status).toBe('NEEDS_REVIEW');
  });

  it('workspace isolation: an equivalence record recorded for Workspace B under the same batch source hash never authorizes provenance for Workspace A', async () => {
    const preview = await previewFile(await buildBasicPriceXlsx(), 'd1r-tenant-isolation').expect(201);
    const batch = await prisma.basicPriceImportBatch.findUniqueOrThrow({ where: { id: preview.body.batchId } });

    // Equivalence recorded under Workspace B, not A -- must not leak.
    await prisma.basicPriceSourceEquivalence.create({
      data: {
        workspaceId: WORKSPACE_B,
        batchSourceSha256: batch.sourceSha256,
        canonicalSourceSha256: CANONICAL_SHA,
        evidence: 'ROW_IDENTICAL_TEST_FIXTURE',
        comparedFields: ['sourceSection', 'rawResourceCodeText', 'rawResourceNameText', 'rawUnitText'],
        verifiedByAccountId: assignedAccountId,
      },
    });

    const row = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === 9);
    const response = await getCandidates(preview.body.batchId, row.id).expect(200);
    expect(response.body.provenanceEquivalenceFound).toBe(false);
    expect(response.body.provenanceCandidate).toBeNull();
  });

  // RM-02D1-REMEDIATION-V3.2.1 (Blocker 1) — honest audit.
  it('honest audit: an equivalence record and provenance candidate A exist, but the reviewer resolves to a different resource B — recorded as MANUAL_SEARCH, never SOURCE_ROW_PROVENANCE just because A existed', async () => {
    const preview = await previewFile(await buildBasicPriceXlsx(), 'd1r-honest-audit-manual').expect(201);
    const batch = await prisma.basicPriceImportBatch.findUniqueOrThrow({ where: { id: preview.body.batchId } });
    await prisma.basicPriceSourceEquivalence.create({
      data: {
        workspaceId: WORKSPACE_A,
        batchSourceSha256: batch.sourceSha256,
        canonicalSourceSha256: CANONICAL_SHA,
        evidence: 'ROW_IDENTICAL_TEST_FIXTURE',
        comparedFields: ['sourceSection', 'rawResourceCodeText', 'rawResourceNameText', 'rawUnitText'],
        verifiedByAccountId: assignedAccountId,
      },
    });

    const row = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === 9);
    // Provenance candidate for this row is RESOURCE_PROVENANCE_ID (A) --
    // confirm the signal really is present before proving it gets ignored.
    const candidatesResponse = await getCandidates(preview.body.batchId, row.id).expect(200);
    expect(candidatesResponse.body.provenanceCandidate.resourceCatalogId).toBe(RESOURCE_PROVENANCE_ID);

    // The reviewer picks RESOURCE_ALTERNATE_LABOR_ID (B) instead -- a
    // different, same-typed (LABOR) resource with no normalized-name
    // relationship to "Pekerja" at all.
    const resolveResponse = await resolveRow(preview.body.batchId, row.id, row.version, RESOURCE_ALTERNATE_LABOR_ID).expect(201);
    expect(resolveResponse.body.status).toBe('READY_FOR_SUBMISSION');

    const mapping = await prisma.basicPriceImportRowResourceMapping.findFirstOrThrow({ where: { rowId: row.id } });
    expect(mapping.resourceCatalogId).toBe(RESOURCE_ALTERNATE_LABOR_ID);
    expect(mapping.suggestionSource).toBe('MANUAL_SEARCH');
    expect(mapping.suggestionSource).not.toBe('SOURCE_ROW_PROVENANCE');
  });

  // RM-02D1-REMEDIATION-V3.2.1 (Blocker 2) — resource type safety.
  describe('RESOURCE_TYPE_MISMATCH', () => {
    it('rejects resolving a LABOR row to a MATERIAL resource with HTTP 409 RESOURCE_TYPE_MISMATCH, leaving the row and mapping audit untouched', async () => {
      const preview = await previewFile(await buildBasicPriceXlsx(), 'd1r-type-mismatch').expect(201);
      const row = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === 9);
      expect(row.section).toBe('LABOR');
      const before = await prisma.basicPriceImportRow.findUniqueOrThrow({ where: { id: row.id } });

      const response = await resolveRow(preview.body.batchId, row.id, row.version, RESOURCE_MATERIAL_FOR_MISMATCH_ID).expect(409);
      expect(response.body.message).toBe('RESOURCE_TYPE_MISMATCH');

      const after = await prisma.basicPriceImportRow.findUniqueOrThrow({ where: { id: row.id } });
      expect(after).toEqual(before);
      expect(after.resourceCatalogId).toBeNull();
      expect(after.status).toBe('NEEDS_REVIEW');
      expect(after.version).toBe(before.version);

      expect(await prisma.basicPriceImportRowResourceMapping.count({ where: { rowId: row.id } })).toBe(0);
    });
  });
});
