import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { buildBasicPriceXlsx } from '../fixtures/basic-price-xlsx.fixture';

/**
 * RM-03D1 — BASIC PRICE PROVENANCE CORRECTION (e2e).
 *
 * Runs the whole real path against the real database and the real migration:
 * import → resolve → keep-private → PATCH the batch → correct. Unit mocks can
 * pin which fields the service writes, but only this can prove the migration
 * applies, the CHECK constraints hold, the columns round-trip, and a correction
 * genuinely leaves money and publication untouched in stored rows.
 *
 * The locked temporal law under test:
 *
 *   sourcePeriodLabel       = "TA 2024"      ← what the source actually says
 *   sourcePeriodGranularity = YEAR           ← machine-readable coarseness
 *   effectiveDate           = 2024-01-01     ← SIMPROK's operational date
 *   effectiveDateProvenance = DERIVED_FROM_SOURCE_PERIOD
 *   effectiveDateDerivationRule = PERIOD_START
 *
 * 2024-01-01 is NOT a date the workbook printed. That is the entire point.
 */
const WORKSPACE_A = '10000000-0000-4000-8000-000000000004';
const PASSWORD = 'Test1234!';

const RESOURCE_ID = '45000000-0000-4000-8000-000000000001';
const UNIT_ID = '45000000-0000-4000-8000-000000000002';
// Owned, not borrowed: depending on whatever region another suite left behind
// made this suite fail whenever it ran first.
const REGION_ID = '45000000-0000-4000-8000-000000000003';

describe('RM03D1 Basic Price provenance correction (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let token: string;
  let regionId: string;
  let accountId: string;

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    await app.init();
    prisma = new PrismaClient();
    regionId = (
      await prisma.region.upsert({
        where: { id: REGION_ID },
        create: { id: REGION_ID, code: 'RM03D1-PROV-REGION', name: 'RM03D1 Provenance Region', isActive: true },
        update: {},
      })
    ).id;
    accountId = (
      await prisma.account.findUniqueOrThrow({ where: { email: 'assigned@test.local' } })
    ).id;

    // The LABOR row of the shared fixture is "Pekerja"; one canonical resource
    // and one unit is all this suite needs to reach a private price.
    await prisma.resourceCatalog.upsert({
      where: { id: RESOURCE_ID },
      create: {
        id: RESOURCE_ID,
        workspaceId: WORKSPACE_A,
        code: 'RM03D1-PROV-01',
        name: 'Pekerja',
        type: 'LABOR',
        baseUnit: 'Org/Hari',
      },
      update: {},
    });
    await prisma.unitDefinition.upsert({
      where: { id: UNIT_ID },
      create: {
        id: UNIT_ID,
        code: 'RM03D1-PROV-UNIT',
        displayName: 'Provenance suite unit',
        symbol: 'RM03D1PU',
        dimension: 'PERSON_TIME',
        kind: 'CANONICAL',
      },
      update: {},
    });

    token = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'assigned@test.local', password: PASSWORD })
    ).body.access_token;
  });

  afterEach(async () => {
    await prisma.basicPriceProvenanceCorrection.deleteMany({ where: { workspaceId: WORKSPACE_A } });
    await prisma.basicPrice.deleteMany({ where: { workspaceId: WORKSPACE_A } });
    await prisma.basicPriceImportBatch.deleteMany({ where: { workspaceId: WORKSPACE_A } });
  });

  afterAll(async () => {
    await prisma.basicPriceProvenanceCorrection.deleteMany({ where: { workspaceId: WORKSPACE_A } });
    await prisma.basicPrice.deleteMany({ where: { workspaceId: WORKSPACE_A } });
    await prisma.basicPriceImportBatch.deleteMany({ where: { workspaceId: WORKSPACE_A } });
    await prisma.resourceCatalog.deleteMany({ where: { id: RESOURCE_ID } });
    await prisma.unitDefinition.deleteMany({ where: { id: UNIT_ID } });
    await prisma.region.deleteMany({ where: { id: REGION_ID } });
    await prisma.$disconnect();
    await app.close();
  });

  const hdr = () => ({ Authorization: `Bearer ${token}`, 'x-workspace-id': WORKSPACE_A });

  /**
   * Import → resolve the one LABOR row → keep it private. The batch starts with
   * a coherent classification but NO temporal provenance, which is the state the
   * correction exists to repair — and the only mis-described state that is
   * lawfully reachable now that an incoherent pair is refused at the writer.
   */
  const materializeUnprovenancedPrivatePrice = async (vendor: string) => {
    const preview = await request(app.getHttpServer())
      .post('/basic-price-imports/preview')
      .set(hdr())
      .attach('file', await buildBasicPriceXlsx(), {
        filename: 'basic-price.xlsx',
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .field('selectedSheet', 'HARGA SATUAN UPAH DAN BAHAN')
      .field('sourceVendorName', vendor)
      .field('regionId', regionId)
      .field('effectiveDate', '2024-01-01')
      .field('sourceOrigin', 'GOVERNMENT')
      .field('sourceType', 'REGULATION')
      // No sourcePeriodLabel, no granularity, no derivation rule. This is the
      // defect the correction repairs: an exact date with NOTHING recording
      // that it was derived from "TA 2024" rather than printed by the source.
      .expect(201);

    const batchId: string = preview.body.batchId;
    const row = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === 9);

    await request(app.getHttpServer())
      .post(`/basic-price-imports/${batchId}/rows/${row.id}/resolve`)
      .set(hdr())
      .send({ version: row.version, resourceCatalogId: RESOURCE_ID, unitDefinitionId: UNIT_ID })
      .expect(201);
    // Reject the other rows so the batch reaches READY_FOR_REVIEW with exactly
    // one price to correct.
    for (const other of preview.body.rows.filter((r: { id: string }) => r.id !== row.id)) {
      await request(app.getHttpServer())
        .post(`/basic-price-imports/${batchId}/rows/${other.id}/reject`)
        .set(hdr())
        .send({ version: other.version, reason: 'not needed by this suite' })
        .expect(201);
    }

    const kept = await request(app.getHttpServer())
      .post(`/basic-price-imports/${batchId}/keep-private`)
      .set(hdr())
      .expect(201);
    expect(kept.body.createdCount).toBe(1);

    return { batchId, basicPriceId: kept.body.prices[0].basicPriceId as string };
  };

  const patchBatchToTruth = (batchId: string, version: number, over: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .patch(`/basic-price-imports/${batchId}`)
      .set(hdr())
      .send({
        version,
        sourceOrigin: 'GOVERNMENT',
        sourceType: 'REGULATION',
        sourcePeriodLabel: 'TA 2024',
        sourcePeriodGranularity: 'YEAR',
        effectiveDate: '2024-01-01',
        effectiveDateProvenance: 'DERIVED_FROM_SOURCE_PERIOD',
        effectiveDateDerivationRule: 'PERIOD_START',
        ...over,
      });

  const correct = (batchId: string, reason = 'sourceType was an unsupported guess; period provenance was unrecordable') =>
    request(app.getHttpServer())
      .post(`/basic-price-imports/${batchId}/correct-private-provenance`)
      .set(hdr())
      .send({ reason });

  it('A: corrects the stored price to the batch truth, leaving money, identity and publication untouched', async () => {
    const { batchId, basicPriceId } = await materializeUnprovenancedPrivatePrice('prov-correct-happy');
    const before = await prisma.basicPrice.findUniqueOrThrow({ where: { id: basicPriceId } });
    expect(before.sourceType).toBe('REGULATION');
    // The defect: a real date with no record of where it came from.
    expect(before.effectiveDateProvenance).toBeNull();
    expect(before.sourcePeriodLabel).toBeNull();
    expect(before.sourcePeriodGranularity).toBeNull();

    const batch = await prisma.basicPriceImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    await patchBatchToTruth(batchId, batch.version).expect(200);

    const response = await correct(batchId).expect(201);
    expect(response.body.correctedCount).toBe(1);

    const after = await prisma.basicPrice.findUniqueOrThrow({ where: { id: basicPriceId } });

    // UNCHANGED — a correction describes, it never reprices or re-identifies.
    expect(after.value.toString()).toBe(before.value.toString());
    expect(after.resourceId).toBe(before.resourceId);
    expect(after.regionId).toBe(before.regionId);
    expect(after.sourceImportRowId).toBe(before.sourceImportRowId);
    expect(after.assetScope).toBe('WORKSPACE_PRIVATE');
    expect(after.status).toBe('UNPUBLISHED');
    expect(after.verificationStatus).toBe('UNVERIFIED');

    // CORRECTED — and every provenance column round-trips through the migration.
    expect(after.sourceOrigin).toBe('GOVERNMENT');
    expect(after.sourceType).toBe('REGULATION');
    expect(after.sourcePeriodLabel).toBe('TA 2024');
    expect(after.sourcePeriodGranularity).toBe('YEAR');
    expect(after.effectiveDate.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect(after.effectiveDateProvenance).toBe('DERIVED_FROM_SOURCE_PERIOD');
    expect(after.effectiveDateDerivationRule).toBe('PERIOD_START');
  });

  it('B: writes exactly ONE correction record carrying before, after, actor and reason', async () => {
    const { batchId, basicPriceId } = await materializeUnprovenancedPrivatePrice('prov-correct-audit');
    const batch = await prisma.basicPriceImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    await patchBatchToTruth(batchId, batch.version).expect(200);

    await correct(batchId, 'recording that 2024-01-01 was derived from TA 2024, not printed by the source').expect(201);

    const records = await prisma.basicPriceProvenanceCorrection.findMany({
      where: { basicPriceId },
    });
    expect(records).toHaveLength(1);
    expect(records[0].actorAccountId).toBe(accountId);
    expect(records[0].reason).toContain('derived from TA 2024');
    expect(records[0].before).toMatchObject({
      effectiveDateProvenance: null,
      sourcePeriodLabel: null,
      sourcePeriodGranularity: null,
    });
    expect(records[0].after).toMatchObject({
      sourceType: 'REGULATION',
      sourcePeriodLabel: 'TA 2024',
      sourcePeriodGranularity: 'YEAR',
      effectiveDateProvenance: 'DERIVED_FROM_SOURCE_PERIOD',
      effectiveDateDerivationRule: 'PERIOD_START',
    });
  });

  it('C: IDEMPOTENT — a second correction with an unchanged batch changes nothing and adds no record', async () => {
    const { batchId, basicPriceId } = await materializeUnprovenancedPrivatePrice('prov-correct-idem');
    const batch = await prisma.basicPriceImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    await patchBatchToTruth(batchId, batch.version).expect(200);

    await correct(batchId).expect(201);
    const second = await correct(batchId).expect(201);

    expect(second.body.correctedCount).toBe(0);
    expect(second.body.unchangedCount).toBe(1);
    expect(await prisma.basicPriceProvenanceCorrection.count({ where: { basicPriceId } })).toBe(1);
  });

  it('D: an incoherent GOVERNMENT + MARKET_SURVEY batch is never propagated to a price', async () => {
    const { batchId, basicPriceId } = await materializeUnprovenancedPrivatePrice('prov-correct-incoherent');
    const batch = await prisma.basicPriceImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    // Make the BATCH incoherent, then try to propagate it. The correction must
    // refuse rather than faithfully copy a falsehood onto a price.
    await request(app.getHttpServer())
      .patch(`/basic-price-imports/${batchId}`)
      .set(hdr())
      .send({ version: batch.version, sourceType: 'MARKET_SURVEY' })
      .expect(200);

    const response = await correct(batchId).expect(409);
    expect(response.body.message).toBe('SOURCE_ORIGIN_TYPE_INCOHERENT');
    expect(response.body.expectedSourceType).toBe('REGULATION');

    const untouched = await prisma.basicPrice.findUniqueOrThrow({ where: { id: basicPriceId } });
    expect(untouched.sourceType).toBe('REGULATION');
    expect(await prisma.basicPriceProvenanceCorrection.count({ where: { basicPriceId } })).toBe(0);
  });

  it('E: a DERIVED date with no granularity is refused — a label alone is not machine-readable', async () => {
    const { batchId } = await materializeUnprovenancedPrivatePrice('prov-correct-nogran');
    const batch = await prisma.basicPriceImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    // PATCH sets everything EXCEPT the granularity.
    await request(app.getHttpServer())
      .patch(`/basic-price-imports/${batchId}`)
      .set(hdr())
      .send({
        version: batch.version,
        sourceType: 'REGULATION',
        sourcePeriodLabel: 'TA 2024',
        effectiveDateProvenance: 'DERIVED_FROM_SOURCE_PERIOD',
        effectiveDateDerivationRule: 'PERIOD_START',
      })
      .expect(200);

    const response = await correct(batchId).expect(409);
    expect(response.body.message).toBe('SOURCE_PERIOD_GRANULARITY_REQUIRED_FOR_DERIVED_DATE');
  });

  it('F: a whitespace-only period label is rejected at the boundary, never stored', async () => {
    const { batchId } = await materializeUnprovenancedPrivatePrice('prov-correct-blank');
    const batch = await prisma.basicPriceImportBatch.findUniqueOrThrow({ where: { id: batchId } });

    await patchBatchToTruth(batchId, batch.version, { sourcePeriodLabel: '   ' }).expect(400);
    await patchBatchToTruth(batchId, batch.version, { effectiveDateDerivationRule: '  ' }).expect(400);

    const unchanged = await prisma.basicPriceImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(unchanged.sourcePeriodLabel).toBeNull();
  });

  it('G: the database itself refuses an incoherent derived provenance, even for a writer that never asked', async () => {
    // Belt and braces: the service raises a named error, and the CHECK
    // constraint makes the row unrepresentable regardless of which writer tries.
    const { batchId } = await materializeUnprovenancedPrivatePrice('prov-correct-constraint');
    await expect(
      prisma.basicPriceImportBatch.update({
        where: { id: batchId },
        data: {
          effectiveDateProvenance: 'DERIVED_FROM_SOURCE_PERIOD',
          sourcePeriodLabel: null,
          sourcePeriodGranularity: null,
          effectiveDateDerivationRule: null,
        },
      }),
    ).rejects.toThrow();
  });

  it('H: a batch from another workspace corrects nothing', async () => {
    const { batchId } = await materializeUnprovenancedPrivatePrice('prov-correct-foreign');
    await request(app.getHttpServer())
      .post(`/basic-price-imports/${batchId}/correct-private-provenance`)
      .set({ Authorization: `Bearer ${token}`, 'x-workspace-id': '10000000-0000-4000-8000-000000000005' })
      .send({ reason: 'foreign workspace' })
      .expect(404);
  });

  it('I: a reason is required', async () => {
    const { batchId } = await materializeUnprovenancedPrivatePrice('prov-correct-noreason');
    await request(app.getHttpServer())
      .post(`/basic-price-imports/${batchId}/correct-private-provenance`)
      .set(hdr())
      .send({})
      .expect(400);
  });
});
