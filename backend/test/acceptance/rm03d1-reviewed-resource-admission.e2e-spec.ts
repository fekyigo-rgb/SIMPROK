import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { BasicPriceRowResolutionService } from '../../src/basic-price/basic-price-row-resolution.service';
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
const BP_CORRECTED_NAME_FIXTURE = 'BPNameCorrectionSyntheticUniqueQ7R9X2';
const ADMITTED_NAMES = [...Object.values(ADMISSION_ROWS).map((entry) => entry.name), BP_CORRECTED_NAME_FIXTURE];

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
    // Concurrent admission tests must share one stable listening socket.
    // Supertest may otherwise open/close its ephemeral listener per request,
    // racing independent POSTs and causing ECONNRESET/ECONNREFUSED noise.
    await app.listen(0);
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

  /**
   * Read the server-issued admission question, exactly as the review UI does.
   * The old fixture sent a three-field body and got DTO 400 before any business
   * law ran. The review fingerprint is an authority binding, never invented
   * by a test. Cache only for the deliberate replay case after row closure.
   */
  const admissionSnapshots = new Map<string, {
    confirmedResourceType: 'LABOR' | 'MATERIAL' | 'EQUIPMENT';
    reviewBindingFingerprint: string;
    refusedCandidateIds: string[];
  }>();
  const admit = async (
    batchId: string,
    rowId: string,
    version: number,
    unitDefinitionId = unitM3Id,
    token = assignedToken,
    workspaceId = WORKSPACE_A,
    correctedCanonicalName?: string,
  ) => {
    const current = await request(app.getHttpServer())
      .get(`/basic-price-imports/${batchId}`)
      .set('Authorization', `Bearer ${assignedToken}`)
      .set('x-workspace-id', WORKSPACE_A)
      .expect(200);
    const row = current.body.rows.find((candidate: { id: string }) => candidate.id === rowId);
    const review = row?.machineProposal?.resource?.admissionReview;
    const previous = admissionSnapshots.get(rowId);
    const confirmedResourceType = (
      review?.typeConfirmations?.find(
        (choice: { resourceType: string }) => choice.resourceType === row?.section,
      )?.resourceType ??
      review?.typeConfirmations?.[0]?.resourceType ??
      previous?.confirmedResourceType ??
      row?.section
    ) as 'LABOR' | 'MATERIAL' | 'EQUIPMENT';
    const reviewBindingFingerprint = (
      review?.typeConfirmations?.find(
        (choice: { resourceType: string }) => choice.resourceType === confirmedResourceType,
      )?.reviewBindingFingerprint ??
      review?.reviewBindingFingerprint ??
      previous?.reviewBindingFingerprint
    ) as string | undefined;
    if (!reviewBindingFingerprint || !confirmedResourceType) {
      throw new Error('TEST_REQUIRES_SERVER_ISSUED_ADMISSION_REVIEW');
    }
    // No person has refused any candidate in this fixture. Never silently
    // turn a visible suggestion into a human rejection on their behalf.
    const refusedCandidateIds: string[] = previous?.refusedCandidateIds ?? [];
    admissionSnapshots.set(rowId, {
      confirmedResourceType,
      reviewBindingFingerprint,
      refusedCandidateIds,
    });
    return request(app.getHttpServer())
      .post(`/basic-price-imports/${batchId}/rows/${rowId}/admit-resource`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceId)
      .send({
        version,
        unitDefinitionId,
        reason: 'Tidak ada resource kanonik yang sepadan.',
        confirmedResourceType,
        refusedCandidateIds,
        reviewBindingFingerprint,
        ...(correctedCanonicalName ? { correctedCanonicalName } : {}),
      });
  };

  const assertAdmissionResponse = async (
    result: ReturnType<typeof admit>,
    expectedStatus: number,
  ) => {
    const response = await result;
    expect(response.status).toBe(expectedStatus);
    return response;
  };

  /** Preview once and hand back the parsed row for a fixture source row. */
  const previewWithRow = async (vendor: string, sourceRowNumber: number) => {
    const preview = await previewFile(vendor);
    const row = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === sourceRowNumber);
    expect(row).toBeDefined();
    return { batchId: preview.body.batchId as string, row };
  };

  /**
   * How many resources ADMISSION brought into being.
   *
   * The seeded fixtures are preconditions, not products — and one of them
   * ("Semen Portlan") deliberately shares a name with a source row, because
   * that pair is what the different-spelling cases are built on. Counting by
   * name alone would count the precondition too, so the fixtures are excluded
   * by id.
   */
  const catalogCount = () =>
    prisma.resourceCatalog.count({
      where: {
        workspaceId: WORKSPACE_A,
        name: { in: ADMITTED_NAMES },
        id: { notIn: [RESOURCE_DIFFERENT_SPELLING_ID, RESOURCE_GLOBAL_ID, RESOURCE_RETIRED_ID] },
      },
    });

  // ============================================================
  // A. HAPPY PATH
  // ============================================================
  it('A: admits a genuinely unknown resource exactly once, with provenance, a mapping decision, and a resolved row', async () => {
    const { batchId, row } = await previewWithRow('d1-admit-happy', ADMISSION_ROWS.UNKNOWN.row);
    expect(row.name).toBe(ADMISSION_ROWS.UNKNOWN.name);

    const response = await assertAdmissionResponse(admit(batchId, row.id, row.version), 201);
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
  // BP-NAME-CORRECTION-01. SAME SOURCE, CORRECTED CATALOG NAME
  // ============================================================
  it('NAME-1: admitted corrected catalog name is durable but source spelling remains unmodified provenance', async () => {
    const { batchId, row } = await previewWithRow('d1-admit-name-correction', ADMISSION_ROWS.UNKNOWN.row);
    const canonicalName = BP_CORRECTED_NAME_FIXTURE;
    const response = await assertAdmissionResponse(
      admit(batchId, row.id, row.version, unitM3Id, assignedToken, WORKSPACE_A, canonicalName),
      201,
    );
    const resourceId = response.body.admittedResource.id;
    const [catalog, provenance, persistedRow, mapping] = await Promise.all([
      prisma.resourceCatalog.findUniqueOrThrow({ where: { id: resourceId } }),
      prisma.resourceSourceIdentity.findFirstOrThrow({ where: { resourceCatalogId: resourceId } }),
      prisma.basicPriceImportRow.findUniqueOrThrow({ where: { id: row.id } }),
      prisma.basicPriceImportRowResourceMapping.findFirstOrThrow({ where: { rowId: row.id } }),
    ]);
    expect(catalog.name).toBe(canonicalName);
    expect(provenance.rawName).toBe(row.name);
    expect(persistedRow.rawResourceNameText).toBe(row.name);
    expect(mapping.reviewerAccountId).toBe(assignedAccountId);
    expect(mapping.resourceCatalogId).toBe(resourceId);
    const refreshed = await request(app.getHttpServer())
      .get(`/basic-price-imports/${batchId}`)
      .set('Authorization', `Bearer ${assignedToken}`)
      .set('x-workspace-id', WORKSPACE_A)
      .expect(200);
    const readback = refreshed.body.rows.find((item: { id: string }) => item.id === row.id);
    expect(readback.name).toBe(row.name);
    expect(readback.canonicalResourceName).toBe(canonicalName);
    expect(refreshed.body.reviewCapabilities.correctedCanonicalNameOnAdmission).toBe(true);
    const savedUnit = await prisma.unitDefinition.findUniqueOrThrow({ where: { id: unitM3Id } });
    expect(readback.canonicalUnit).toEqual({
      code: savedUnit.code,
      displayName: savedUnit.displayName,
      symbol: savedUnit.symbol,
    });
  });

  it('NAME-2: a corrected name already known to the global catalog cannot mint a duplicate', async () => {
    const { batchId, row } = await previewWithRow('d1-admit-corrected-duplicate', ADMISSION_ROWS.UNKNOWN.row);
    const before = await catalogCount();
    const response = await assertAdmissionResponse(
      admit(batchId, row.id, row.version, unitM3Id, assignedToken, WORKSPACE_A, ADMISSION_ROWS.GLOBAL_KNOWN.name),
      409,
    );
    expect(response.body.message).toBe('RESOURCE_ADMISSION_REVIEW_STALE');
    expect(await catalogCount()).toBe(before);
    expect(await prisma.basicPriceImportRowResourceMapping.count({ where: { rowId: row.id } })).toBe(0);
    const after = await prisma.basicPriceImportRow.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.rawResourceNameText).toBe(row.name);
    expect(after.status).toBe('NEEDS_REVIEW');
  });

  it('NAME-3: corrected spelling identical to existing WORKSPACE catalog is rejected without minting a twin', async () => {
    const { batchId, row } = await previewWithRow('d1-corrected-same-workspace-block', ADMISSION_ROWS.UNKNOWN.row);
    const beforeCount = await prisma.resourceCatalog.count({ where: { workspaceId: WORKSPACE_A } });
    const response = await assertAdmissionResponse(
      admit(batchId, row.id, row.version, unitM3Id, assignedToken, WORKSPACE_A, 'Semen Portlan'),
      409,
    );
    expect(response.body.message).toBe('RESOURCE_ADMISSION_REVIEW_STALE');
    expect(await prisma.resourceCatalog.count({ where: { workspaceId: WORKSPACE_A } })).toBe(beforeCount);
    expect(await prisma.basicPriceImportRowResourceMapping.count({ where: { rowId: row.id } })).toBe(0);
    const retained = await prisma.basicPriceImportRow.findUniqueOrThrow({ where: { id: row.id } });
    expect(retained.status).toBe('NEEDS_REVIEW');
    expect(retained.rawResourceNameText).toBe(ADMISSION_ROWS.UNKNOWN.name);
  });

  it('NAME-4: selecting an existing catalog after correcting a matching name binds the existing ID and preserves the Excel name', async () => {
    const { batchId, row } = await previewWithRow('d1-corrected-existing-choose', ADMISSION_ROWS.DIFFERENT_SPELLING.row);
    const beforeCount = await prisma.resourceCatalog.count({ where: { workspaceId: WORKSPACE_A } });
    await request(app.getHttpServer())
      .post(`/basic-price-imports/${batchId}/rows/${row.id}/resolve`)
      .set('Authorization', `Bearer ${assignedToken}`)
      .set('x-workspace-id', WORKSPACE_A)
      .send({ version: row.version, resourceCatalogId: RESOURCE_DIFFERENT_SPELLING_ID, unitDefinitionId: unitM3Id })
      .expect(201);
    const after = await prisma.basicPriceImportRow.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.resourceCatalogId).toBe(RESOURCE_DIFFERENT_SPELLING_ID);
    expect(after.rawResourceNameText).toBe(ADMISSION_ROWS.DIFFERENT_SPELLING.name);
    const catalog = await prisma.resourceCatalog.findUniqueOrThrow({ where: { id: RESOURCE_DIFFERENT_SPELLING_ID } });
    expect(catalog.name).toBe('Semen Portlan');
    expect(await prisma.resourceCatalog.count({ where: { workspaceId: WORKSPACE_A } })).toBe(beforeCount);
    const readback = await request(app.getHttpServer())
      .get(`/basic-price-imports/${batchId}`)
      .set('Authorization', `Bearer ${assignedToken}`)
      .set('x-workspace-id', WORKSPACE_A)
      .expect(200);
    const resolved = readback.body.rows.find((item: { id: string }) => item.id === row.id);
    expect(resolved.name).toBe(ADMISSION_ROWS.DIFFERENT_SPELLING.name);
    expect(resolved.canonicalResourceName).toBe('Semen Portlan');
  });

  // ============================================================
  // BP-ROW8-COMPENSATION-01 — REAL DB TRANSACTION, GUARANTEED ROLLBACK
  // The immutable audit cannot be "cleaned up" via DELETE. Instead this
  // acceptance test proves the committed state INSIDE a real transaction,
  // then intentionally rolls it back, leaving the E2E baseline untouched.
  // ============================================================
  it('COMP-1: real compensation retires only its admitted catalog, reopens one row, preserves mapping and source, and rolls back the fixture', async () => {
    const { batchId, row } = await previewWithRow('d1-compensate-rollback-verified', ADMISSION_ROWS.UNKNOWN.row);
    const admitted = await assertAdmissionResponse(admit(batchId, row.id, row.version), 201);
    const resourceId = admitted.body.admittedResource.id as string;
    const prior = await prisma.basicPriceImportRow.findUniqueOrThrow({ where: { id: row.id } });
    const priorMapping = await prisma.basicPriceImportRowResourceMapping.findFirstOrThrow({ where: { rowId: row.id } });
    const provenance = await prisma.resourceSourceIdentity.findFirstOrThrow({ where: { resourceCatalogId: resourceId } });
    const signal = 'COMPENSATION_E2E_INTENTIONAL_ROLLBACK';
    await expect(prisma.$transaction(async (tx) => {
      // Reuse the production writer against a transaction OWNED BY THIS TEST;
      // do not let the writer commit outside the test's rollback boundary.
      const writer = new BasicPriceRowResolutionService(
        { $transaction: (work: (transaction: typeof tx) => Promise<unknown>) => work(tx) } as never,
        {} as never, {} as never, {} as never, {} as never,
      );
      const result = await writer.compensateOwnDecision(WORKSPACE_A, batchId, row.id, assignedAccountId, {
        version: prior.version,
        reason: 'Kesalahan penetapan nama katalog pada peninjauan Basic Price; ulangi keputusan.',
      });
      expect(result.priorRowVersion).toBe(prior.version);
      expect(result.newRowVersion).toBe(prior.version + 1);
      const [compensation, reopened, catalog, mapping, source] = await Promise.all([
        tx.basicPriceImportRowResolutionCompensation.findUniqueOrThrow({ where: { id: result.compensationEventId } }),
        tx.basicPriceImportRow.findUniqueOrThrow({ where: { id: row.id } }),
        tx.resourceCatalog.findUniqueOrThrow({ where: { id: resourceId } }),
        tx.basicPriceImportRowResourceMapping.findUniqueOrThrow({ where: { id: priorMapping.id } }),
        tx.resourceSourceIdentity.findUniqueOrThrow({ where: { id: provenance.id } }),
      ]);
      expect(compensation.mappingId).toBe(priorMapping.id);
      expect(compensation.actorAccountId).toBe(assignedAccountId);
      expect(compensation.priorRowVersion).toBe(prior.version);
      expect(reopened.status).toBe('NEEDS_REVIEW');
      expect(reopened.resolutionStatus).toBe('UNRESOLVED');
      expect(reopened.version).toBe(prior.version + 1);
      expect(reopened.resourceCatalogId).toBeNull();
      expect(reopened.unitDefinitionId).toBeNull();
      expect(reopened.rawResourceNameText).toBe(prior.rawResourceNameText);
      expect(reopened.proposedCanonicalPrice?.toString()).toBe(prior.proposedCanonicalPrice?.toString());
      expect(catalog.status).toBe('RETIRED');
      expect(mapping).toMatchObject({ id: priorMapping.id, resourceCatalogId: resourceId, reviewerAccountId: assignedAccountId });
      expect(source.rawName).toBe(provenance.rawName);
      // Never commit immutable fixture events. The database does the rollback.
      throw new Error(signal);
    }, { timeout: 20_000, maxWait: 20_000 })).rejects.toThrow(signal);
    const [after, catalogAfter, originalMapping, originalSource, residue] = await Promise.all([
      prisma.basicPriceImportRow.findUniqueOrThrow({ where: { id: row.id } }),
      prisma.resourceCatalog.findUniqueOrThrow({ where: { id: resourceId } }),
      prisma.basicPriceImportRowResourceMapping.findUniqueOrThrow({ where: { id: priorMapping.id } }),
      prisma.resourceSourceIdentity.findUniqueOrThrow({ where: { id: provenance.id } }),
      prisma.basicPriceImportRowResolutionCompensation.count({ where: { rowId: row.id } }),
    ]);
    expect(after.status).toBe(prior.status);
    expect(after.version).toBe(prior.version);
    expect(catalogAfter.status).toBe('ACTIVE');
    expect(originalMapping.resourceCatalogId).toBe(resourceId);
    expect(originalSource.rawName).toBe(provenance.rawName);
    expect(residue).toBe(0);
  });

  it('COMP-2: exposed route denies another account and stale versions with zero mutation', async () => {
    const { batchId, row } = await previewWithRow('d1-compensate-route-denied', ADMISSION_ROWS.UNKNOWN.row);
    const admitted = await assertAdmissionResponse(admit(batchId, row.id, row.version), 201);
    const catalogId = admitted.body.admittedResource.id as string;
    const current = await prisma.basicPriceImportRow.findUniqueOrThrow({ where: { id: row.id } });
    const path = `/basic-price-imports/${batchId}/rows/${row.id}/compensate-own-decision`;
    const payload = { version: current.version, reason: 'Bukti identitas katalog perlu dikoreksi oleh pelaku keputusan.' };
    await request(app.getHttpServer()).post(path)
      .set('Authorization', `Bearer ${foremanToken}`)
      .set('x-workspace-id', WORKSPACE_A).send(payload).expect(404);
    await request(app.getHttpServer()).post(path)
      .set('Authorization', `Bearer ${assignedToken}`)
      .set('x-workspace-id', WORKSPACE_A)
      .send({ ...payload, version: current.version - 1 }).expect(409);
    const [retainedRow, catalog, eventCount] = await Promise.all([
      prisma.basicPriceImportRow.findUniqueOrThrow({ where: { id: row.id } }),
      prisma.resourceCatalog.findUniqueOrThrow({ where: { id: catalogId } }),
      prisma.basicPriceImportRowResolutionCompensation.count({ where: { rowId: row.id } }),
    ]);
    expect(retainedRow.status).toBe('READY_FOR_SUBMISSION');
    expect(retainedRow.version).toBe(current.version);
    expect(catalog.status).toBe('ACTIVE');
    expect(eventCount).toBe(0);
  });

  it('COMP-3: database audit table is append-only and the mapping id is unique', async () => {
    const triggers = await prisma.$queryRaw<Array<{ name: string; definition: string }>>`
      SELECT t.tgname AS name, pg_get_triggerdef(t.oid) AS definition
      FROM pg_trigger t
      WHERE t.tgrelid = 'basic_price_import_row_resolution_compensations'::regclass
        AND NOT t.tgisinternal
    `;
    expect(triggers.some((t) =>
      t.name === 'bp_row_compensations_append_only' &&
      /BEFORE (?:UPDATE OR DELETE|DELETE OR UPDATE)/i.test(t.definition),
    )).toBe(true);
    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'basic_price_import_row_resolution_compensations'
    `;
    expect(indexes.some((index) => index.indexname === 'bp_row_compensations_mappingId_key')).toBe(true);
  });

  // ============================================================
  // B. SMART DIFFERENT-NAME PROTECTION (load-bearing)
  // ============================================================
  it('B: a resource SIMPROK already knows under a different spelling is never duplicated — the authoritative candidate is returned instead', async () => {
    const { batchId, row } = await previewWithRow('d1-admit-spelling', ADMISSION_ROWS.DIFFERENT_SPELLING.row);
    expect(row.name).toBe('Semen Portland');

    const response = await assertAdmissionResponse(admit(batchId, row.id, row.version), 409);

    expect(response.body.message).toBe('RESOURCE_ADMISSION_REFUSALS_INVALID');
    // The candidate appears in the refreshed SERVER review, not in a fabricated
    // admission answer. Without a human expressly refusing it, nothing is made.
    const refreshed = await request(app.getHttpServer())
      .get(`/basic-price-imports/${batchId}`)
      .set('Authorization', `Bearer ${assignedToken}`)
      .set('x-workspace-id', WORKSPACE_A)
      .expect(200);
    const candidateRow = refreshed.body.rows.find((item: { id: string }) => item.id === row.id);
    expect(candidateRow.machineProposal.resource.candidates.map(
      (candidate: { resourceCatalogId: string }) => candidate.resourceCatalogId,
    )).toContain(RESOURCE_DIFFERENT_SPELLING_ID);

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

    const response = await assertAdmissionResponse(admit(batchId, row.id, row.version), 409);

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
    await assertAdmissionResponse(admit(batchId, row.id, row.version, unitM3Id, foremanToken), 404);
    await assertAdmissionResponse(admit(batchId, row.id, row.version, unitM3Id, crosstenantToken, WORKSPACE_B), 404);

    expect(await catalogCount()).toBe(0);
    expect(await prisma.basicPriceImportRowResourceMapping.count({ where: { rowId: row.id } })).toBe(0);
  });

  // ============================================================
  // E. REPLAY
  // ============================================================
  it('E: replaying the same reviewed decision admits at most one resource', async () => {
    const { batchId, row } = await previewWithRow('d1-admit-replay', ADMISSION_ROWS.UNKNOWN.row);

    await assertAdmissionResponse(admit(batchId, row.id, row.version), 201);
    await assertAdmissionResponse(admit(batchId, row.id, row.version), 409);

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

    // The second request's earlier review is stale once the winner creates a
    // catalog identity. No automatic replay. On a fresh GET, show the winner.
    const loser = a.status === 409 ? a : b;
    const loserRow = a.status === 409 ? rowA : rowB;
    expect([
      'RESOURCE_ADMISSION_REVIEW_STALE',
      'RESOURCE_IDENTITY_NOT_EXHAUSTED',
    ]).toContain(loser.body.message);
    const saved = await prisma.resourceCatalog.findFirstOrThrow({
      where: { workspaceId: WORKSPACE_A, name: ADMISSION_ROWS.CONCURRENT_A.name },
    });
    const refreshed = await request(app.getHttpServer())
      .get(`/basic-price-imports/${preview.body.batchId}`)
      .set('Authorization', `Bearer ${assignedToken}`)
      .set('x-workspace-id', WORKSPACE_A)
      .expect(200);
    const current = refreshed.body.rows.find((item: { id: string }) => item.id === loserRow.id);
    const resolution = current.machineProposal.resource;
    expect([
      resolution.resourceCatalogId,
      ...resolution.candidates.map((candidate: { resourceCatalogId: string }) => candidate.resourceCatalogId),
    ]).toContain(saved.id);
  });

  // ============================================================
  // F2. CONCURRENT DIFFERENT-SPELLING, ONE PLAUSIBLE IDENTITY
  //     (the hardest race, and the one a name-keyed lock loses)
  // ============================================================
  it('F2: two concurrent requests spelling one plausible identity two ways still produce exactly ONE canonical resource', async () => {
    // Neither spelling may exist beforehand, or the race would be won by a
    // trivial refusal instead of by the serialization boundary.
    await prisma.resourceCatalog.deleteMany({ where: { id: RESOURCE_DIFFERENT_SPELLING_ID } });
    const namesInPlay = [ADMISSION_ROWS.DIFFERENT_SPELLING.name, ADMISSION_ROWS.CONCURRENT_SPELLING.name];
    expect(
      await prisma.resourceCatalog.count({ where: { type: 'MATERIAL', name: { in: namesInPlay } } }),
    ).toBe(0);

    const preview = await previewFile('d1-admit-concurrent-spelling');
    const rowPortland = preview.body.rows.find(
      (r: { sourceRowNumber: number }) => r.sourceRowNumber === ADMISSION_ROWS.DIFFERENT_SPELLING.row,
    );
    const rowPortlan = preview.body.rows.find(
      (r: { sourceRowNumber: number }) => r.sourceRowNumber === ADMISSION_ROWS.CONCURRENT_SPELLING.row,
    );
    expect(rowPortland.name).toBe('Semen Portland');
    expect(rowPortlan.name).toBe('Semen Portlan');
    expect(rowPortland.name).not.toBe(rowPortlan.name);

    const [a, b] = await Promise.all([
      admit(preview.body.batchId, rowPortland.id, rowPortland.version),
      admit(preview.body.batchId, rowPortlan.id, rowPortlan.version),
    ]);

    // EXACTLY ONE canonical resource, whichever spelling got there first.
    expect(
      await prisma.resourceCatalog.count({ where: { workspaceId: WORKSPACE_A, name: { in: namesInPlay } } }),
    ).toBe(1);
    expect([a.status, b.status].sort()).toEqual([201, 409]);

    const winner = a.status === 201 ? a : b;
    const loser = a.status === 201 ? b : a;
    const winnerRow = a.status === 201 ? rowPortland : rowPortlan;
    const loserRow = a.status === 201 ? rowPortlan : rowPortland;
    const admittedId = winner.body.admittedResource.id;

    // The competing decision was bound to an earlier candidate question and
    // must fail closed. A new GET (not an automatic retry) shows the identity
    // which won, even when its spelling differs from the losing source row.
    expect([
      'RESOURCE_ADMISSION_REVIEW_STALE',
      'RESOURCE_IDENTITY_NOT_EXHAUSTED',
    ]).toContain(loser.body.message);
    const refreshed = await request(app.getHttpServer())
      .get(`/basic-price-imports/${preview.body.batchId}`)
      .set('Authorization', `Bearer ${assignedToken}`)
      .set('x-workspace-id', WORKSPACE_A)
      .expect(200);
    const current = refreshed.body.rows.find((item: { id: string }) => item.id === loserRow.id);
    const identity = current.machineProposal.resource;
    const surfaced = [
      identity.resourceCatalogId,
      ...identity.candidates.map((candidate: { resourceCatalogId: string }) => candidate.resourceCatalogId),
    ];
    expect(surfaced).toContain(admittedId);

    // Nothing of the loser survives: no second resource, no provenance, no
    // mapping decision, no row transition.
    expect(await prisma.resourceSourceIdentity.count({ where: { workspaceId: WORKSPACE_A } })).toBe(1);
    expect(
      (await prisma.resourceSourceIdentity.findFirstOrThrow({ where: { workspaceId: WORKSPACE_A } })).resourceCatalogId,
    ).toBe(admittedId);
    expect(await prisma.basicPriceImportRowResourceMapping.count({ where: { rowId: loserRow.id } })).toBe(0);
    const untouched = await prisma.basicPriceImportRow.findUniqueOrThrow({ where: { id: loserRow.id } });
    expect(untouched.status).toBe('NEEDS_REVIEW');
    expect(untouched.resourceCatalogId).toBeNull();

    // The winner is whole, and still tenant-scoped.
    const admitted = await prisma.resourceCatalog.findUniqueOrThrow({ where: { id: admittedId } });
    expect(admitted.workspaceId).toBe(WORKSPACE_A);
    expect(admitted.name).toBe(winnerRow.name);
    expect(await prisma.basicPriceImportRowResourceMapping.count({ where: { rowId: winnerRow.id } })).toBe(1);

    // Identity only — no price, no submission, no publication.
    expect(await prisma.basicPrice.count({ where: { resourceId: admittedId } })).toBe(0);
    expect(await prisma.priceSubmission.count({ where: { resourceId: admittedId } })).toBe(0);
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

    const response = await assertAdmissionResponse(admit(batchId, row.id, row.version), 409);
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

    const response = await assertAdmissionResponse(admit(batchId, row.id, row.version, UNIT_WITHOUT_ALIAS_ID), 409);

    expect(response.body.message).toBe('UNIT_NOT_REPRESENTABLE_BY_UNIT_AUTHORITY');
    expect(response.body.unitResolution.reasonCodes).toContain('UNKNOWN_UNIT_ALIAS');
    expect(await catalogCount()).toBe(0);
  });
});
