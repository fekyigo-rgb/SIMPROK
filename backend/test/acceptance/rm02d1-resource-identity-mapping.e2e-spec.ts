import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { buildBasicPriceXlsx } from '../fixtures/basic-price-xlsx.fixture';

/**
 * RM-02D1 — Resource Identity Mapping (e2e).
 *
 * Covers exactly what RM-02D1 adds on top of the already-merged RM-02B/C2/C3
 * resolve flow: a normalized-name candidate-suggestion signal (never
 * auto-applied), and an append-only mapping-decision audit trail
 * (reviewer/timestamp/source row/reason/suggestion source) recorded on
 * every resolve. Deliberately does not touch submission or publication —
 * those are already covered by basic-price-import.e2e-spec.ts, and RM-02D1
 * is explicitly scoped away from publication/location.
 */
const WORKSPACE_A = '10000000-0000-4000-8000-000000000004';
const WORKSPACE_B = '10000000-0000-4000-8000-000000000005';
const PASSWORD = 'Test1234!';

const RESOURCE_LABOR_EXACT_ID = '42000000-0000-4000-8000-000000000001';
const RESOURCE_MATERIAL_AMBIG_A_ID = '42000000-0000-4000-8000-000000000002';
const RESOURCE_MATERIAL_AMBIG_B_ID = '42000000-0000-4000-8000-000000000003';
const RESOURCE_WORKSPACE_B_SAME_NAME_ID = '42000000-0000-4000-8000-000000000004';
const UNIT_ID = '42000000-0000-4000-8000-000000000005';
const ROLE_ID = '42000000-0000-4000-8000-000000000006';
const ROLE_B_ID = '42000000-0000-4000-8000-000000000007';
// RM-02D1-REMEDIATION-V3.2.1 (Blocker 2): row 316 ("Sewa crane") is
// EQUIPMENT, so its "fully manual" resolve target must also be EQUIPMENT —
// resolving it to a LABOR resource is now correctly rejected with
// RESOURCE_TYPE_MISMATCH, which is a different, dedicated scenario covered
// in rm02d1-remediation-source-provenance.e2e-spec.ts, not this test.
const RESOURCE_EQUIPMENT_FOR_MANUAL_ID = '42000000-0000-4000-8000-000000000008';

const PERMISSION_CODES = ['BASIC_PRICE_IMPORT', 'BASIC_PRICE_RESOLVE', 'BASIC_PRICE_REVIEW_VIEW'];

describe('RM02D1 Resource Identity Mapping (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let assignedToken: string;
  let foremanToken: string;
  let crosstenantToken: string;
  let assignedAccountId: string;
  let membershipRoleId: string;
  let membershipRoleBId: string;

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    await app.init();
    prisma = new PrismaClient();

    const permissions = await Promise.all(
      PERMISSION_CODES.map((code) => prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} })),
    );
    await prisma.role.upsert({
      where: { id: ROLE_ID },
      create: { id: ROLE_ID, workspaceId: WORKSPACE_A, code: 'ACCEPTANCE_RM02D1_MAPPING', name: 'Acceptance RM-02D1 Mapping' },
      update: {},
    });
    await prisma.rolePermission.createMany({
      data: permissions.map((permission) => ({ roleId: ROLE_ID, permissionId: permission.id })),
      skipDuplicates: true,
    });
    const reviewPermission = permissions.find((p) => p.code === 'BASIC_PRICE_REVIEW_VIEW')!;
    await prisma.role.upsert({
      where: { id: ROLE_B_ID },
      create: { id: ROLE_B_ID, workspaceId: WORKSPACE_B, code: 'RM02D1_CROSSTENANT_B', name: 'RM-02D1 Crosstenant Workspace B' },
      update: {},
    });
    await prisma.rolePermission.createMany({ data: [{ roleId: ROLE_B_ID, permissionId: reviewPermission.id }], skipDuplicates: true });

    const assignedAccount = await prisma.account.findUniqueOrThrow({ where: { email: 'assigned@test.local' } });
    assignedAccountId = assignedAccount.id;
    const assignedMembership = await prisma.workspaceMembership.findUniqueOrThrow({
      where: { accountId_workspaceId: { accountId: assignedAccount.id, workspaceId: WORKSPACE_A } },
    });
    const membershipRole = await prisma.membershipRole.create({ data: { workspaceMembershipId: assignedMembership.id, roleId: ROLE_ID, isActive: true } });
    membershipRoleId = membershipRole.id;

    const crosstenantAccount = await prisma.account.findUniqueOrThrow({ where: { email: 'crosstenant@test.local' } });
    const crosstenantMembership = await prisma.workspaceMembership.findUniqueOrThrow({
      where: { accountId_workspaceId: { accountId: crosstenantAccount.id, workspaceId: WORKSPACE_B } },
    });
    const membershipRoleB = await prisma.membershipRole.create({ data: { workspaceMembershipId: crosstenantMembership.id, roleId: ROLE_B_ID, isActive: true } });
    membershipRoleBId = membershipRoleB.id;

    // Fixture catalog: one exact single-candidate match for the LABOR row
    // ("Pekerja"), two deliberately ambiguous candidates sharing a
    // normalized name for the MATERIAL row ("Kawat jaring" /
    // " kawat   JARING " differ only in whitespace/case), and a
    // same-named resource in Workspace B that must never surface as a
    // candidate for a Workspace-A row.
    await prisma.resourceCatalog.createMany({
      data: [
        { id: RESOURCE_LABOR_EXACT_ID, workspaceId: WORKSPACE_A, code: 'RM02D1-LAB-01', name: 'Pekerja', type: 'LABOR', baseUnit: 'Org/Hari' },
        { id: RESOURCE_MATERIAL_AMBIG_A_ID, workspaceId: WORKSPACE_A, code: 'RM02D1-MAT-01', name: 'Kawat jaring', type: 'MATERIAL', baseUnit: 'Lbr' },
        { id: RESOURCE_MATERIAL_AMBIG_B_ID, workspaceId: WORKSPACE_A, code: 'RM02D1-MAT-02', name: ' kawat   JARING ', type: 'MATERIAL', baseUnit: 'Lbr' },
        { id: RESOURCE_WORKSPACE_B_SAME_NAME_ID, workspaceId: WORKSPACE_B, code: 'RM02D1-B-01', name: 'Pekerja', type: 'LABOR', baseUnit: 'Org/Hari' },
        { id: RESOURCE_EQUIPMENT_FOR_MANUAL_ID, workspaceId: WORKSPACE_A, code: 'RM02D1-EQ-01', name: 'Alat berat (manual pick target)', type: 'EQUIPMENT', baseUnit: 'U/J' },
      ],
      skipDuplicates: true,
    });
    await prisma.unitDefinition.upsert({
      where: { id: UNIT_ID },
      create: { id: UNIT_ID, code: 'RM02D1-UNIT', displayName: 'Acceptance Unit', symbol: 'AU', dimension: 'PERSON_TIME', kind: 'CANONICAL' },
      update: {},
    });

    const login = async (email: string) => (await request(app.getHttpServer()).post('/auth/login').send({ email, password: PASSWORD })).body.access_token;
    assignedToken = await login('assigned@test.local');
    foremanToken = await login('foreman@test.local');
    crosstenantToken = await login('crosstenant@test.local');
  });

  afterEach(async () => {
    await prisma.basicPriceImportBatch.deleteMany({ where: { workspaceId: WORKSPACE_A } });
  });

  afterAll(async () => {
    await prisma.basicPriceImportBatch.deleteMany({ where: { workspaceId: WORKSPACE_A } });
    await prisma.resourceCatalog.deleteMany({
      where: {
        id: {
          in: [
            RESOURCE_LABOR_EXACT_ID,
            RESOURCE_MATERIAL_AMBIG_A_ID,
            RESOURCE_MATERIAL_AMBIG_B_ID,
            RESOURCE_WORKSPACE_B_SAME_NAME_ID,
            RESOURCE_EQUIPMENT_FOR_MANUAL_ID,
          ],
        },
      },
    });
    await prisma.unitDefinition.deleteMany({ where: { id: UNIT_ID } });
    await prisma.membershipRole.deleteMany({ where: { id: { in: [membershipRoleId, membershipRoleBId] } } });
    await prisma.rolePermission.deleteMany({ where: { roleId: { in: [ROLE_ID, ROLE_B_ID] } } });
    await prisma.role.deleteMany({ where: { id: { in: [ROLE_ID, ROLE_B_ID] } } });
    await prisma.permission.deleteMany({ where: { code: { in: PERMISSION_CODES } } });
    await prisma.$disconnect();
    await app.close();
  });

  const previewFile = (buffer: Buffer, sourceVendorName: string, token = assignedToken) =>
    request(app.getHttpServer())
      .post('/basic-price-imports/preview')
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', WORKSPACE_A)
      .attach('file', buffer, { filename: 'basic-price.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      .field('selectedSheet', 'HARGA SATUAN UPAH DAN BAHAN')
      .field('sourceVendorName', sourceVendorName);

  const getCandidates = (batchId: string, rowId: string, token = assignedToken, workspaceId = WORKSPACE_A) =>
    request(app.getHttpServer())
      .get(`/basic-price-imports/${batchId}/rows/${rowId}/candidates`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceId);

  const resolveRow = (
    batchId: string,
    rowId: string,
    version: number,
    resourceCatalogId: string,
    unitDefinitionId: string,
    reason?: string,
    token = assignedToken,
  ) =>
    request(app.getHttpServer())
      .post(`/basic-price-imports/${batchId}/rows/${rowId}/resolve`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', WORKSPACE_A)
      .send({ version, resourceCatalogId, unitDefinitionId, ...(reason !== undefined ? { reason } : {}) });

  describe('candidate suggestions (review signal only, never a decision)', () => {
    it('returns exactly the one unambiguous normalized-name candidate for a clean match, and never mutates the row', async () => {
      const preview = await previewFile(await buildBasicPriceXlsx(), 'd1-candidates-single').expect(201);
      const row = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === 9);
      const before = await prisma.basicPriceImportRow.findUniqueOrThrow({ where: { id: row.id } });

      const response = await getCandidates(preview.body.batchId, row.id).expect(200);
      expect(response.body).toEqual({
        rowId: row.id,
        matchBasis: 'NORMALIZED_NAME',
        candidates: [{ resourceCatalogId: RESOURCE_LABOR_EXACT_ID, code: 'RM02D1-LAB-01', name: 'Pekerja', type: 'LABOR', baseUnit: 'Org/Hari' }],
        // RM-02D1-REMEDIATION-V3.1: no BasicPriceSourceEquivalence record
        // exists for this batch's source hash in this suite, so provenance
        // is fail-closed here — proven end-to-end separately in
        // rm02d1-remediation-source-provenance.e2e-spec.ts.
        provenanceCandidate: null,
        provenanceEquivalenceFound: false,
        conflict: false,
      });

      const after = await prisma.basicPriceImportRow.findUniqueOrThrow({ where: { id: row.id } });
      expect(after).toEqual(before);
      expect(after.resolutionStatus).toBe('UNRESOLVED');
      expect(after.status).toBe('NEEDS_REVIEW');
      expect(after.resourceCatalogId).toBeNull();
    });

    it('an ambiguous normalized name returns every candidate, none preferred — the row stays NEEDS_REVIEW until a human explicitly resolves it', async () => {
      const preview = await previewFile(await buildBasicPriceXlsx(), 'd1-candidates-ambiguous').expect(201);
      const row = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === 33);
      expect(row.name).toBe('Kawat jaring');

      const response = await getCandidates(preview.body.batchId, row.id).expect(200);
      expect(response.body.matchBasis).toBe('NORMALIZED_NAME');
      expect(response.body.candidates).toHaveLength(2);
      expect(response.body.candidates.map((c: { resourceCatalogId: string }) => c.resourceCatalogId).sort()).toEqual(
        [RESOURCE_MATERIAL_AMBIG_A_ID, RESOURCE_MATERIAL_AMBIG_B_ID].sort(),
      );

      const after = await prisma.basicPriceImportRow.findUniqueOrThrow({ where: { id: row.id } });
      expect(after.resolutionStatus).toBe('UNRESOLVED');
      expect(after.resourceCatalogId).toBeNull();
    });

    it('a row with no normalized-name match returns an empty candidate list, never a fabricated suggestion', async () => {
      const preview = await previewFile(await buildBasicPriceXlsx(), 'd1-candidates-none').expect(201);
      const row = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === 316); // "Sewa crane" — no fixture catalog entry
      const response = await getCandidates(preview.body.batchId, row.id).expect(200);
      expect(response.body.candidates).toEqual([]);
    });

    it('never surfaces a same-named Workspace-B resource as a candidate for a Workspace-A row', async () => {
      const preview = await previewFile(await buildBasicPriceXlsx(), 'd1-candidates-cross-tenant').expect(201);
      const row = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === 9);
      const response = await getCandidates(preview.body.batchId, row.id).expect(200);
      expect(response.body.candidates.map((c: { resourceCatalogId: string }) => c.resourceCatalogId)).not.toContain(RESOURCE_WORKSPACE_B_SAME_NAME_ID);
    });

    // LEGACY_TEST_CHANGE_REGISTER (Amendment A2): OLD_EXPECTATION was that
    // foremanToken is denied with 403 for lacking BASIC_PRICE_REVIEW_VIEW.
    // RM02D2A2-REMEDIATION-03 (a) moved this route's guard to
    // BASIC_PRICE_RESOLVE, an active-membership baseline foreman's ACTIVE
    // membership now holds structurally, so it clears the permission guard;
    // and (b) added the user-owned import boundary — this batch was
    // uploaded by assignedToken's account, and foreman is a different
    // account, so the service layer now denies it as 404 (the same
    // "not found" used for a workspace mismatch — ownership denial is never
    // distinguishable from non-existence). TEST_WEAKENING=NO: this is a
    // *stronger*, ownership-scoped denial than the old permission-only
    // check, not a widened one — even a foreman explicitly granted
    // BASIC_PRICE_REVIEW_VIEW today would still be denied, because
    // reviewing/resolving this route is now about batch ownership, not
    // just holding a capability code.
    it('requires authentication; a same-workspace ACTIVE account that did not upload this batch is denied by the user-owned import boundary (404), even though it holds the resolve permission via the active-membership baseline', async () => {
      const preview = await previewFile(await buildBasicPriceXlsx(), 'd1-candidates-permission').expect(201);
      const row = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === 9);
      await request(app.getHttpServer())
        .get(`/basic-price-imports/${preview.body.batchId}/rows/${row.id}/candidates`)
        .set('x-workspace-id', WORKSPACE_A)
        .expect(401);
      await getCandidates(preview.body.batchId, row.id, foremanToken).expect(404);
      await getCandidates(preview.body.batchId, row.id, assignedToken).expect(200);
    });

    it('404s for a row that does not belong to the caller workspace', async () => {
      const preview = await previewFile(await buildBasicPriceXlsx(), 'd1-candidates-not-found').expect(201);
      const row = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === 9);
      await getCandidates(preview.body.batchId, row.id, crosstenantToken, WORKSPACE_B).expect(404);
    });
  });

  describe('mapping decision audit trail (reviewer / timestamp / source row / reason / suggestion source)', () => {
    it('positive: resolving to the single unambiguous candidate records the real authenticated reviewer, a reason when given, and NORMALIZED_NAME_SINGLE_CANDIDATE', async () => {
      const preview = await previewFile(await buildBasicPriceXlsx(), 'd1-resolve-single-candidate').expect(201);
      const row = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === 9);
      const before = new Date();

      const response = await resolveRow(preview.body.batchId, row.id, row.version, RESOURCE_LABOR_EXACT_ID, UNIT_ID, 'matches the single suggested candidate').expect(201);
      expect(response.body.status).toBe('READY_FOR_SUBMISSION');

      const updatedRow = await prisma.basicPriceImportRow.findUniqueOrThrow({ where: { id: row.id } });
      expect(updatedRow.resolvedByAccountId).toBe(assignedAccountId);

      const mappings = await prisma.basicPriceImportRowResourceMapping.findMany({ where: { rowId: row.id } });
      expect(mappings).toHaveLength(1);
      expect(mappings[0]).toEqual(
        expect.objectContaining({
          workspaceId: WORKSPACE_A,
          rowId: row.id,
          resourceCatalogId: RESOURCE_LABOR_EXACT_ID,
          unitDefinitionId: UNIT_ID,
          reviewerAccountId: assignedAccountId,
          reason: 'matches the single suggested candidate',
          suggestionSource: 'NORMALIZED_NAME_SINGLE_CANDIDATE',
          candidateCountAtDecision: 1,
        }),
      );
      expect(mappings[0].decidedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    });

    it('stores a null reason when none is supplied, never fabricating a justification', async () => {
      const preview = await previewFile(await buildBasicPriceXlsx(), 'd1-resolve-no-reason').expect(201);
      const row = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === 9);
      await resolveRow(preview.body.batchId, row.id, row.version, RESOURCE_LABOR_EXACT_ID, UNIT_ID).expect(201);
      const mapping = await prisma.basicPriceImportRowResourceMapping.findFirstOrThrow({ where: { rowId: row.id } });
      expect(mapping.reason).toBeNull();
    });

    it('negative: resolving an ambiguous row to one of several candidates records NORMALIZED_NAME_MULTIPLE_CANDIDATES with the true candidate count — the ambiguity was never auto-resolved, only the human pick is recorded', async () => {
      const preview = await previewFile(await buildBasicPriceXlsx(), 'd1-resolve-ambiguous').expect(201);
      const row = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === 33);

      await resolveRow(preview.body.batchId, row.id, row.version, RESOURCE_MATERIAL_AMBIG_A_ID, UNIT_ID, 'chose the first ambiguous candidate after manual review').expect(201);

      const mapping = await prisma.basicPriceImportRowResourceMapping.findFirstOrThrow({ where: { rowId: row.id } });
      expect(mapping.suggestionSource).toBe('NORMALIZED_NAME_MULTIPLE_CANDIDATES');
      expect(mapping.candidateCountAtDecision).toBe(2);
      expect(mapping.resourceCatalogId).toBe(RESOURCE_MATERIAL_AMBIG_A_ID);
    });

    it('negative: a fully manual pick with no normalized-name candidate at all records MANUAL_SEARCH with zero candidates', async () => {
      const preview = await previewFile(await buildBasicPriceXlsx(), 'd1-resolve-manual').expect(201);
      const row = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === 316); // "Sewa crane" (EQUIPMENT), no fixture candidate
      await resolveRow(preview.body.batchId, row.id, row.version, RESOURCE_EQUIPMENT_FOR_MANUAL_ID, UNIT_ID, 'manual pick, unrelated to the name').expect(201);
      const mapping = await prisma.basicPriceImportRowResourceMapping.findFirstOrThrow({ where: { rowId: row.id } });
      expect(mapping.suggestionSource).toBe('MANUAL_SEARCH');
      expect(mapping.candidateCountAtDecision).toBe(0);
    });

    it('a resolve attempt that collides with an already-resolved row in the same batch still stays NEEDS_REVIEW, but the mapping decision is still recorded (decision history is independent of row-current-state)', async () => {
      const preview = await previewFile(await buildBasicPriceXlsx({ includeExactTieRounding: true }), 'd1-resolve-collision').expect(201);
      const rowA = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === 9);
      const rowB = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === 10);

      await resolveRow(preview.body.batchId, rowA.id, rowA.version, RESOURCE_LABOR_EXACT_ID, UNIT_ID).expect(201);
      const second = await resolveRow(preview.body.batchId, rowB.id, rowB.version, RESOURCE_LABOR_EXACT_ID, UNIT_ID).expect(201);
      expect(second.body.status).toBe('NEEDS_REVIEW');
      expect(second.body.collisionType).not.toBe('NONE');

      const mappingB = await prisma.basicPriceImportRowResourceMapping.findFirstOrThrow({ where: { rowId: rowB.id } });
      expect(mappingB.reviewerAccountId).toBe(assignedAccountId);
      expect(mappingB.resourceCatalogId).toBe(RESOURCE_LABOR_EXACT_ID);
    });

    it('never publishes and never touches Region/BasicPrice — resolving a row only ever produces READY_FOR_SUBMISSION, not a submission or a publication', async () => {
      const preview = await previewFile(await buildBasicPriceXlsx(), 'd1-resolve-no-publication').expect(201);
      const row = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === 9);
      await resolveRow(preview.body.batchId, row.id, row.version, RESOURCE_LABOR_EXACT_ID, UNIT_ID).expect(201);

      expect(await prisma.priceSubmission.count({ where: { resourceId: RESOURCE_LABOR_EXACT_ID } })).toBe(0);
      expect(await prisma.basicPrice.count({ where: { resourceId: RESOURCE_LABOR_EXACT_ID } })).toBe(0);
      const batch = await prisma.basicPriceImportBatch.findUniqueOrThrow({ where: { id: preview.body.batchId } });
      expect(batch.regionId).toBeNull();
    });
  });
});
