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
// Owned, not borrowed: depending on whatever region another suite left behind
// made this suite fail whenever it ran first.
const REGION_ID = '45000000-0000-4000-8000-000000000003';

describe('RM03D1 Basic Price provenance correction (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let token: string;
  let regionId: string;
  let accountId: string;
  /**
   * The REAL canonical unit for this fixture's own source spelling: row 9 of
   * the fixture workbook writes "Org/Hari", which the Unit Kernel already
   * knows as PERSON_DAY. An acceptance-only UnitDefinition would be a unit no
   * alias can reach, so nothing would prove the stored price is a price per
   * person-day — and the trusted unit context seam refuses exactly that.
   */
  let personDayUnitId: string;

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
    personDayUnitId = (
      await prisma.unitDefinition.findFirstOrThrow({
        where: { code: 'PERSON_DAY' },
      })
    ).id;

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
      .send({ version: row.version, resourceCatalogId: RESOURCE_ID, unitDefinitionId: personDayUnitId })
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

  it('D: a GOVERNMENT + MARKET_SURVEY batch is lawful, and propagates as stated', async () => {
    const { batchId, basicPriceId } = await materializeUnprovenancedPrivatePrice('prov-correct-incoherent');
    const batch = await prisma.basicPriceImportBatch.findUniqueOrThrow({ where: { id: batchId } });

    // THIS TEST HAS BEEN WRONG TWICE, IN OPPOSITE DIRECTIONS.
    //
    // It first proved that the CORRECTION refused to copy this pair onto a
    // price. It was then changed to prove the PATCH refused to store it at all.
    // Both rested on the same mistake: reading SOURCE_TYPE_BY_ORIGIN as a law
    // about what is true, when it is only the type an origin TYPICALLY implies
    // — a default for a source that cannot speak for itself.
    //
    // A government agency publishing the results of a market survey is an
    // ordinary document. Owner law keeps the axes apart in as many words
    // (BASIC-PRICE-MASTER-DECISION §10: SOURCE_TYPE ≠ SOURCE_ORIGIN), so
    // SIMPROK records the pair the human stated.
    await request(app.getHttpServer())
      .patch(`/basic-price-imports/${batchId}`)
      .set(hdr())
      .send({ version: batch.version, sourceType: 'MARKET_SURVEY' })
      .expect(200);

    const stored = await prisma.basicPriceImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(stored.sourceOrigin).toBe('GOVERNMENT');
    expect(stored.sourceType).toBe('MARKET_SURVEY');

    // And the correction carries that stated truth onto the price rather than
    // substituting the type the table would have guessed.
    await correct(batchId).expect(201);
    const after = await prisma.basicPrice.findUniqueOrThrow({ where: { id: basicPriceId } });
    expect(after.sourceOrigin).toBe('GOVERNMENT');
    expect(after.sourceType).toBe('MARKET_SURVEY');
  });

  it('E: a DERIVED date with no granularity is refused — a label alone is not machine-readable', async () => {
    const { batchId } = await materializeUnprovenancedPrivatePrice('prov-correct-nogran');
    const batch = await prisma.basicPriceImportBatch.findUniqueOrThrow({ where: { id: batchId } });

    // Everything EXCEPT the granularity. The batch itself refuses to hold an
    // incomplete derived provenance, so the incoherent state never even reaches
    // the correction — a stronger guarantee than refusing to propagate it.
    const response = await request(app.getHttpServer())
      .patch(`/basic-price-imports/${batchId}`)
      .set(hdr())
      .send({
        version: batch.version,
        sourceType: 'REGULATION',
        sourcePeriodLabel: 'TA 2024',
        effectiveDateProvenance: 'DERIVED_FROM_SOURCE_PERIOD',
        effectiveDateDerivationRule: 'PERIOD_START',
      });
    expect(response.status).toBe(409);
    expect(response.body.message).toBe('SOURCE_PERIOD_GRANULARITY_REQUIRED_FOR_DERIVED_DATE');

    const unchanged = await prisma.basicPriceImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(unchanged.effectiveDateProvenance).toBeNull();
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
    const { batchId, basicPriceId } = await materializeUnprovenancedPrivatePrice('prov-correct-foreign');
    const response = await request(app.getHttpServer())
      .post(`/basic-price-imports/${batchId}/correct-private-provenance`)
      .set({ Authorization: `Bearer ${token}`, 'x-workspace-id': '10000000-0000-4000-8000-000000000005' })
      .send({ reason: 'foreign workspace' });

    // Denied at the workspace boundary. Whether that denial is the permission
    // guard (403, the caller holds nothing in workspace B) or the service's
    // ownership check (404) is not the claim under test — the claim is that
    // nothing crossed the boundary.
    expect([403, 404]).toContain(response.status);
    expect(await prisma.basicPriceProvenanceCorrection.count({ where: { basicPriceId } })).toBe(0);
  });

  it('I: a reason is required', async () => {
    const { batchId } = await materializeUnprovenancedPrivatePrice('prov-correct-noreason');
    await request(app.getHttpServer())
      .post(`/basic-price-imports/${batchId}/correct-private-provenance`)
      .set(hdr())
      .send({})
      .expect(400);
  });

  it('J: DERIVED → SOURCE_STATED is reachable — an explicit null CLEARS the obsolete rule', async () => {
    const { batchId, basicPriceId } = await materializeUnprovenancedPrivatePrice('prov-clear-stated');
    let batch = await prisma.basicPriceImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    await patchBatchToTruth(batchId, batch.version).expect(200);
    await correct(batchId).expect(201);

    // The source turned out to state the date after all. Becoming SOURCE_STATED
    // REQUIRES dropping the derivation rule — with "?? undefined" semantics an
    // explicit null was swallowed as "unchanged" and this transition was simply
    // unreachable: the batch could never stop claiming a derivation it no
    // longer had.
    batch = await prisma.basicPriceImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    await request(app.getHttpServer())
      .patch(`/basic-price-imports/${batchId}`)
      .set(hdr())
      .send({
        version: batch.version,
        effectiveDateProvenance: 'SOURCE_STATED',
        effectiveDateDerivationRule: null,
      })
      .expect(200);

    const afterPatch = await prisma.basicPriceImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(afterPatch.effectiveDateProvenance).toBe('SOURCE_STATED');
    expect(afterPatch.effectiveDateDerivationRule).toBeNull();
    // The period label is NOT cleared: a document may truthfully print both.
    expect(afterPatch.sourcePeriodLabel).toBe('TA 2024');

    await correct(batchId, 'the source states the exact date after all').expect(201);
    const price = await prisma.basicPrice.findUniqueOrThrow({ where: { id: basicPriceId } });
    expect(price.effectiveDateProvenance).toBe('SOURCE_STATED');
    expect(price.effectiveDateDerivationRule).toBeNull();
  });

  it('K: DERIVED → UNKNOWN is reachable — clearing the claim is not the same as keeping it', async () => {
    const { batchId, basicPriceId } = await materializeUnprovenancedPrivatePrice('prov-clear-unknown');
    let batch = await prisma.basicPriceImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    await patchBatchToTruth(batchId, batch.version).expect(200);
    await correct(batchId).expect(201);

    batch = await prisma.basicPriceImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    await request(app.getHttpServer())
      .patch(`/basic-price-imports/${batchId}`)
      .set(hdr())
      .send({
        version: batch.version,
        effectiveDateProvenance: null,
        effectiveDateDerivationRule: null,
      })
      .expect(200);

    await correct(batchId, 'the derivation was withdrawn; provenance is unknown').expect(201);
    const price = await prisma.basicPrice.findUniqueOrThrow({ where: { id: basicPriceId } });
    // UNKNOWN, and pointedly not SOURCE_STATED.
    expect(price.effectiveDateProvenance).toBeNull();
    expect(price.effectiveDateDerivationRule).toBeNull();
  });

  it('L: OMITTING a field still means unchanged — clearing requires saying null', async () => {
    const { batchId } = await materializeUnprovenancedPrivatePrice('prov-omit-unchanged');
    let batch = await prisma.basicPriceImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    await patchBatchToTruth(batchId, batch.version).expect(200);

    batch = await prisma.basicPriceImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    await request(app.getHttpServer())
      .patch(`/basic-price-imports/${batchId}`)
      .set(hdr())
      .send({ version: batch.version, sourceVendorName: 'unrelated edit' })
      .expect(200);

    const after = await prisma.basicPriceImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(after.effectiveDateProvenance).toBe('DERIVED_FROM_SOURCE_PERIOD');
    expect(after.effectiveDateDerivationRule).toBe('PERIOD_START');
    expect(after.sourcePeriodLabel).toBe('TA 2024');
  });

  it('M: clearing the provenance while KEEPING the rule is refused — incoherence is unrepresentable', async () => {
    const { batchId } = await materializeUnprovenancedPrivatePrice('prov-clear-incoherent');
    let batch = await prisma.basicPriceImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    await patchBatchToTruth(batchId, batch.version).expect(200);

    batch = await prisma.basicPriceImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    const response = await request(app.getHttpServer())
      .patch(`/basic-price-imports/${batchId}`)
      .set(hdr())
      .send({ version: batch.version, effectiveDateProvenance: null })
      .expect(409);
    expect(response.body.message).toBe('DERIVATION_RULE_REQUIRES_PROVENANCE');
  });

  it('N: a whitespace-only reason is refused — an audit trail must say something', async () => {
    const { batchId } = await materializeUnprovenancedPrivatePrice('prov-blank-reason');
    const batch = await prisma.basicPriceImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    await patchBatchToTruth(batchId, batch.version).expect(200);

    await request(app.getHttpServer())
      .post(`/basic-price-imports/${batchId}/correct-private-provenance`)
      .set(hdr())
      .send({ reason: '   ' })
      .expect(400);
    expect(await prisma.basicPriceProvenanceCorrection.count({ where: { workspaceId: WORKSPACE_A } })).toBe(0);
  });

  it('O: the response STATES the provenance it applied, rather than leaving the caller to assume', async () => {
    const { batchId } = await materializeUnprovenancedPrivatePrice('prov-response-shape');
    const batch = await prisma.basicPriceImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    await patchBatchToTruth(batchId, batch.version).expect(200);

    const response = await correct(batchId).expect(201);
    expect(response.body.corrections[0].price).toMatchObject({
      sourcePeriodLabel: 'TA 2024',
      sourcePeriodGranularity: 'YEAR',
      effectiveDateProvenance: 'DERIVED_FROM_SOURCE_PERIOD',
      effectiveDateDerivationRule: 'PERIOD_START',
    });
  });

  it('P: a ROW-OVERRIDDEN date never inherits a batch derivation that does not explain it', async () => {
    // effectiveDateOverride has no application writer today, so the state is
    // seeded directly. The two READERS are live production code, and a latent
    // lie in a provenance system is still a lie — this proves the stored row,
    // not just the pure resolver.
    const preview = await request(app.getHttpServer())
      .post('/basic-price-imports/preview')
      .set(hdr())
      .attach('file', await buildBasicPriceXlsx(), {
        filename: 'basic-price.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .field('selectedSheet', 'HARGA SATUAN UPAH DAN BAHAN')
      .field('sourceVendorName', 'prov-row-override')
      .field('regionId', regionId)
      .field('effectiveDate', '2024-01-01')
      .field('sourceOrigin', 'GOVERNMENT')
      .field('sourceType', 'REGULATION')
      .field('sourcePeriodLabel', 'TA 2024')
      .field('sourcePeriodGranularity', 'YEAR')
      .field('effectiveDateProvenance', 'DERIVED_FROM_SOURCE_PERIOD')
      .field('effectiveDateDerivationRule', 'PERIOD_START')
      .expect(201);

    const batchId: string = preview.body.batchId;
    const row = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === 9);

    await request(app.getHttpServer())
      .post(`/basic-price-imports/${batchId}/rows/${row.id}/resolve`)
      .set(hdr())
      .send({ version: row.version, resourceCatalogId: RESOURCE_ID, unitDefinitionId: personDayUnitId })
      .expect(201);
    for (const other of preview.body.rows.filter((r: { id: string }) => r.id !== row.id)) {
      await request(app.getHttpServer())
        .post(`/basic-price-imports/${batchId}/rows/${other.id}/reject`)
        .set(hdr())
        .send({ version: other.version, reason: 'not needed by this suite' })
        .expect(201);
    }

    // This row's date is NOT the batch's derived date.
    await prisma.basicPriceImportRow.update({
      where: { id: row.id },
      data: { effectiveDateOverride: new Date('2024-06-15T00:00:00.000Z') },
    });

    const kept = await request(app.getHttpServer())
      .post(`/basic-price-imports/${batchId}/keep-private`)
      .set(hdr())
      .expect(201);
    const price = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: kept.body.prices[0].basicPriceId },
    });

    expect(price.effectiveDate.toISOString()).toBe('2024-06-15T00:00:00.000Z');
    // PERIOD_START of TA 2024 is 2024-01-01, so it cannot explain 2024-06-15.
    expect(price.effectiveDateProvenance).toBeNull();
    expect(price.effectiveDateDerivationRule).toBeNull();
    // But what the SOURCE says about its period is still true.
    expect(price.sourcePeriodLabel).toBe('TA 2024');
    expect(price.sourcePeriodGranularity).toBe('YEAR');

    // And a correction re-derives the same honest facts, never re-attaching the
    // derivation the date does not follow from.
    await correct(batchId, 're-applying batch provenance to an overridden row').expect(201);
    const after = await prisma.basicPrice.findUniqueOrThrow({ where: { id: price.id } });
    expect(after.effectiveDate.toISOString()).toBe('2024-06-15T00:00:00.000Z');
    expect(after.effectiveDateProvenance).toBeNull();
    expect(after.effectiveDateDerivationRule).toBeNull();
  });

  /**
   * RM-03D1 FINAL TEMPORAL CLOSURE — a provenance decision belongs to the date
   * it explained. Changing the date must not let the old decision follow.
   */
  describe('date changes and provenance decisions', () => {
    /** A batch holding the LOCKED representation, ready to be attacked. */
    const derivedBatch = async (vendor: string) => {
      const { batchId } = await materializeUnprovenancedPrivatePrice(vendor);
      const batch = await prisma.basicPriceImportBatch.findUniqueOrThrow({ where: { id: batchId } });
      await patchBatchToTruth(batchId, batch.version).expect(200);
      return batchId;
    };

    /** PATCH with the batch's current version; returns the raw response. */
    const patchBatch = async (batchId: string, body: Record<string, unknown>) => {
      const batch = await prisma.basicPriceImportBatch.findUniqueOrThrow({ where: { id: batchId } });
      return request(app.getHttpServer())
        .patch(`/basic-price-imports/${batchId}`)
        .set(hdr())
        .send({ version: batch.version, ...body });
    };

    const storedBatch = (batchId: string) =>
      prisma.basicPriceImportBatch.findUniqueOrThrow({ where: { id: batchId } });

    it('T1: a DATE-ONLY change against an existing claim FAILS CLOSED, and writes nothing', async () => {
      const batchId = await derivedBatch('t1-date-only');

      const response = await patchBatch(batchId, { effectiveDate: '2024-06-15' });
      expect(response.status).toBe(409);
      expect(response.body.message).toBe('TEMPORAL_PROVENANCE_DECISION_REQUIRED');
      expect(response.body.storedEffectiveDate).toBe('2024-01-01');
      expect(response.body.requestedEffectiveDate).toBe('2024-06-15');

      // Nothing moved: not the date, not the claim.
      const after = await storedBatch(batchId);
      expect(after.effectiveDate?.toISOString()).toBe('2024-01-01T00:00:00.000Z');
      expect(after.effectiveDateProvenance).toBe('DERIVED_FROM_SOURCE_PERIOD');
      expect(after.effectiveDateDerivationRule).toBe('PERIOD_START');
    });

    it('T2: a new date WITH an explicit UNKNOWN decision is accepted', async () => {
      const batchId = await derivedBatch('t2-explicit-unknown');

      const response = await patchBatch(batchId, {
        effectiveDate: '2024-06-15',
        effectiveDateProvenance: null,
        effectiveDateDerivationRule: null,
      });
      expect(response.status).toBe(200);

      const after = await storedBatch(batchId);
      expect(after.effectiveDate?.toISOString()).toBe('2024-06-15T00:00:00.000Z');
      expect(after.effectiveDateProvenance).toBeNull();
      expect(after.effectiveDateDerivationRule).toBeNull();
      // The period wording is not erased just because the date became unknown.
      expect(after.sourcePeriodLabel).toBe('TA 2024');
      expect(after.sourcePeriodGranularity).toBe('YEAR');
    });

    it('T3: a new date WITH an explicit SOURCE_STATED decision is accepted', async () => {
      const batchId = await derivedBatch('t3-explicit-stated');

      const response = await patchBatch(batchId, {
        effectiveDate: '2024-06-15',
        effectiveDateProvenance: 'SOURCE_STATED',
        effectiveDateDerivationRule: null,
      });
      expect(response.status).toBe(200);

      const after = await storedBatch(batchId);
      expect(after.effectiveDate?.toISOString()).toBe('2024-06-15T00:00:00.000Z');
      expect(after.effectiveDateProvenance).toBe('SOURCE_STATED');
      expect(after.effectiveDateDerivationRule).toBeNull();
    });

    it('T6: an explicit DERIVED claim that does not explain the new date FAILS CLOSED', async () => {
      const batchId = await derivedBatch('t6-derived-wrong-date');

      const response = await patchBatch(batchId, {
        effectiveDate: '2024-06-15',
        sourcePeriodLabel: 'TA 2024',
        sourcePeriodGranularity: 'YEAR',
        effectiveDateProvenance: 'DERIVED_FROM_SOURCE_PERIOD',
        effectiveDateDerivationRule: 'PERIOD_START',
      });
      expect(response.status).toBe(409);
      expect(response.body.message).toBe('DERIVATION_DOES_NOT_EXPLAIN_EFFECTIVE_DATE');
      expect(response.body.derivedEffectiveDate).toBe('2024-01-01');

      const after = await storedBatch(batchId);
      expect(after.effectiveDate?.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    });

    it('T4/T7: an unrelated PATCH disturbs no temporal truth, and demands no decision', async () => {
      const batchId = await derivedBatch('t4-unrelated');

      const response = await patchBatch(batchId, { sourceVendorName: 'a totally unrelated edit' });
      expect(response.status).toBe(200);

      const after = await storedBatch(batchId);
      expect(after.effectiveDate?.toISOString()).toBe('2024-01-01T00:00:00.000Z');
      expect(after.effectiveDateProvenance).toBe('DERIVED_FROM_SOURCE_PERIOD');
      expect(after.effectiveDateDerivationRule).toBe('PERIOD_START');
      expect(after.sourcePeriodLabel).toBe('TA 2024');
    });

    it('T10: SOURCE_STATED does not survive a changed date either', async () => {
      const batchId = await derivedBatch('t10-stated-then-moved');
      const toStated = await patchBatch(batchId, {
        effectiveDateProvenance: 'SOURCE_STATED',
        effectiveDateDerivationRule: null,
      });
      expect(toStated.status).toBe(200);

      const response = await patchBatch(batchId, { effectiveDate: '2024-09-09' });
      expect(response.status).toBe(409);
      expect(response.body.message).toBe('TEMPORAL_PROVENANCE_DECISION_REQUIRED');
      expect(response.body.storedEffectiveDateProvenance).toBe('SOURCE_STATED');
    });

    it('an UNKNOWN batch may change its date freely — there is no decision to invalidate', async () => {
      const { batchId } = await materializeUnprovenancedPrivatePrice('t-unknown-date-move');

      const response = await patchBatch(batchId, { effectiveDate: '2024-06-15' });
      expect(response.status).toBe(200);

      const after = await storedBatch(batchId);
      expect(after.effectiveDate?.toISOString()).toBe('2024-06-15T00:00:00.000Z');
      expect(after.effectiveDateProvenance).toBeNull();
    });

    it('moving the PERIOD while leaving the date also fails closed — the claim must still explain it', async () => {
      const batchId = await derivedBatch('t-label-only-move');

      // The date stays 2024-01-01; only the period moves to TA 2025. PERIOD_START
      // of TA 2025 is 2025-01-01, so the claim no longer explains the stored date.
      const response = await patchBatch(batchId, { sourcePeriodLabel: 'TA 2025' });
      expect(response.status).toBe(409);
      expect(response.body.message).toBe('DERIVATION_DOES_NOT_EXPLAIN_EFFECTIVE_DATE');
      expect(response.body.derivedEffectiveDate).toBe('2025-01-01');
      expect(response.body.effectiveDate).toBe('2024-01-01');

      const after = await storedBatch(batchId);
      expect(after.sourcePeriodLabel).toBe('TA 2024');
    });

    it('PREVIEW cannot mint a false claim either — the first writer obeys the same authority', async () => {
      const response = await request(app.getHttpServer())
        .post('/basic-price-imports/preview')
        .set(hdr())
        .attach('file', await buildBasicPriceXlsx(), {
          filename: 'basic-price.xlsx',
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        })
        .field('selectedSheet', 'HARGA SATUAN UPAH DAN BAHAN')
        .field('sourceVendorName', 'preview-false-claim')
        .field('regionId', regionId)
        // The derivation produces 2024-01-01; the date says otherwise.
        .field('effectiveDate', '2024-06-15')
        .field('sourceOrigin', 'GOVERNMENT')
        .field('sourceType', 'REGULATION')
        .field('sourcePeriodLabel', 'TA 2024')
        .field('sourcePeriodGranularity', 'YEAR')
        .field('effectiveDateProvenance', 'DERIVED_FROM_SOURCE_PERIOD')
        .field('effectiveDateDerivationRule', 'PERIOD_START');
      expect(response.status).toBe(409);
      expect(response.body.message).toBe('DERIVATION_DOES_NOT_EXPLAIN_EFFECTIVE_DATE');

      // Refused before anything was persisted.
      expect(
        await prisma.basicPriceImportBatch.count({
          where: { workspaceId: WORKSPACE_A, sourceVendorName: 'preview-false-claim' },
        }),
      ).toBe(0);
    });
  });
});
