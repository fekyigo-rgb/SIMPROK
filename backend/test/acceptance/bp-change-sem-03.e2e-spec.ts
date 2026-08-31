import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, PrismaClient } from '@prisma/client';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { basicPriceApplicabilityAnd } from '../../src/basic-price/basic-price-applicability';
import {
  basicPriceCurrentnessWhere,
  mergeCurrentnessAnd,
} from '../../src/basic-price/basic-price-currentness';
import { buildBasicPriceXlsx } from '../fixtures/basic-price-xlsx.fixture';

/**
 * BP-CHANGE-SEM-03 — new observation ≠ correction, against simprok_e2e.
 * Never touches 55432 / simprok_db.
 */
const WORKSPACE_A = '10000000-0000-4000-8000-000000000004';
const WORKSPACE_B = '10000000-0000-4000-8000-000000000005';
const ORG_A = '10000000-0000-4000-8000-000000000002';
const PASSWORD = 'Test1234!';
const RESOURCE_ID = '48000000-0000-4000-8000-000000000031';
const REGION_ID = '48000000-0000-4000-8000-000000000033';
const MAY = new Date('2026-05-01T00:00:00.000Z');

interface LoginBody {
  access_token: string;
}

interface PreviewRow {
  id: string;
  sourceRowNumber: number;
  version: number;
}

interface PreviewBody {
  batchId: string;
  rows: PreviewRow[];
}

interface KeptBody {
  createdCount: number;
  prices: Array<{ basicPriceId: string }>;
}

interface MutationBody {
  basicPriceId: string;
  value?: string;
  kdnPercent?: string | null;
  unchanged: boolean;
}

interface ListBody {
  data: Array<{ basicPriceId: string; price: string }>;
}

function readLoginToken(body: unknown): string {
  if (
    typeof body === 'object' &&
    body !== null &&
    'access_token' in body &&
    typeof (body as LoginBody).access_token === 'string'
  ) {
    return (body as LoginBody).access_token;
  }
  throw new Error('login did not return an access_token');
}

function asPreviewBody(body: unknown): PreviewBody {
  if (typeof body !== 'object' || body === null) {
    throw new Error('preview body missing');
  }
  return body as PreviewBody;
}

function asKeptBody(body: unknown): KeptBody {
  if (typeof body !== 'object' || body === null) {
    throw new Error('keep-private body missing');
  }
  return body as KeptBody;
}

function asMutationBody(body: unknown): MutationBody {
  if (typeof body !== 'object' || body === null) {
    throw new Error('mutation body missing');
  }
  return body as MutationBody;
}

function asListBody(body: unknown): ListBody {
  if (typeof body !== 'object' || body === null) {
    throw new Error('list body missing');
  }
  return body as ListBody;
}

async function expectCheckRejects(
  work: () => Promise<unknown>,
  constraint: string,
): Promise<void> {
  try {
    await work();
    throw new Error(`expected ${constraint} to reject`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('expected ')) {
      throw error;
    }
    expect(isCheckViolation(error, constraint)).toBe(true);
  }
}

function isCheckViolation(error: unknown, constraint: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const blob = `${message} ${JSON.stringify(error)}`;
  const code =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
      ? (error as { code: string }).code
      : '';
  return (
    blob.includes(constraint) || blob.includes('23514') || code === 'P2004'
  );
}

describe('BP-CHANGE-SEM-03 new observation ≠ correction (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let submitToken: string;
  let personDayUnitId: string;
  let actorAccountId: string;

  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.init();
    prisma = new PrismaClient();
    await prisma.region.upsert({
      where: { id: REGION_ID },
      create: {
        id: REGION_ID,
        code: 'BP-SEM-03-REGION',
        name: 'BP-SEM-03 Region',
        isActive: true,
      },
      update: {},
    });
    await prisma.resourceCatalog.upsert({
      where: { id: RESOURCE_ID },
      create: {
        id: RESOURCE_ID,
        workspaceId: WORKSPACE_A,
        code: 'BP-SEM-03-01',
        name: 'Pekerja semantics',
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
    actorAccountId = (
      await prisma.account.findUniqueOrThrow({
        where: { email: 'assigned@test.local' },
      })
    ).id;
    submitToken = readLoginToken(
      (
        await request(app.getHttpServer() as Server)
          .post('/auth/login')
          .send({ email: 'assigned@test.local', password: PASSWORD })
      ).body,
    );
  });

  afterEach(async () => {
    await prisma.basicPriceProvenanceCorrection.deleteMany({
      where: { workspaceId: { in: [WORKSPACE_A, WORKSPACE_B] } },
    });
    await prisma.basicPrice.deleteMany({
      where: { resourceId: RESOURCE_ID, supersedesBasicPriceId: { not: null } },
    });
    await prisma.basicPrice.deleteMany({ where: { resourceId: RESOURCE_ID } });
    await prisma.basicPriceImportBatch.deleteMany({
      where: { workspaceId: WORKSPACE_A },
    });
  });

  afterAll(async () => {
    await prisma.basicPriceProvenanceCorrection.deleteMany({
      where: { workspaceId: { in: [WORKSPACE_A, WORKSPACE_B] } },
    });
    await prisma.basicPrice.deleteMany({
      where: { resourceId: RESOURCE_ID, supersedesBasicPriceId: { not: null } },
    });
    await prisma.basicPrice.deleteMany({ where: { resourceId: RESOURCE_ID } });
    await prisma.basicPriceImportBatch.deleteMany({
      where: { workspaceId: WORKSPACE_A },
    });
    await prisma.resourceCatalog.deleteMany({ where: { id: RESOURCE_ID } });
    await prisma.region.deleteMany({ where: { id: REGION_ID } });
    await prisma.$disconnect();
    await app.close();
  });

  const http = (): Server => app.getHttpServer() as Server;

  const hdr = (bearer = submitToken, workspace = WORKSPACE_A) => ({
    Authorization: `Bearer ${bearer}`,
    'x-workspace-id': workspace,
  });

  const offerIds = async (asOf: Date, ids: string[]) => {
    const rows = await prisma.basicPrice.findMany({
      where: {
        id: { in: ids },
        ...mergeCurrentnessAnd(
          basicPriceCurrentnessWhere({ asOf }),
          basicPriceApplicabilityAnd({ asOf }),
        ),
      },
      select: { id: true },
    });
    return rows.map((row) => row.id).sort();
  };

  const importAndKeep = async (options: {
    vendor: string;
    includeKdnColumn: boolean;
  }) => {
    const preview = await request(http())
      .post('/basic-price-imports/preview')
      .set(hdr())
      .attach(
        'file',
        await buildBasicPriceXlsx({
          includeKdnColumn: options.includeKdnColumn,
        }),
        {
          filename: `${options.vendor}.xlsx`,
          contentType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      )
      .field('selectedSheet', 'HARGA SATUAN UPAH DAN BAHAN')
      .field('sourceVendorName', options.vendor)
      .field('regionId', REGION_ID)
      .field('effectiveDate', '2026-05-01')
      .field('sourceOrigin', 'GOVERNMENT')
      .field('sourceType', 'REGULATION')
      .expect(201);

    const previewBody = asPreviewBody(preview.body);
    const batchId = previewBody.batchId;
    const row = previewBody.rows.find(
      (candidate) => candidate.sourceRowNumber === 9,
    );
    if (!row) {
      throw new Error('LABOR row 9 missing from preview');
    }

    await request(http())
      .post(`/basic-price-imports/${batchId}/rows/${row.id}/resolve`)
      .set(hdr())
      .send({
        version: row.version,
        resourceCatalogId: RESOURCE_ID,
        unitDefinitionId: personDayUnitId,
      })
      .expect(201);
    for (const other of previewBody.rows.filter(
      (candidate) => candidate.id !== row.id,
    )) {
      await request(http())
        .post(`/basic-price-imports/${batchId}/rows/${other.id}/reject`)
        .set(hdr())
        .send({ version: other.version, reason: 'out of scope for SEM-03' })
        .expect(201);
    }

    const kept = await request(http())
      .post(`/basic-price-imports/${batchId}/keep-private`)
      .set(hdr())
      .expect(201);
    const keptBody = asKeptBody(kept.body);
    expect(keptBody.createdCount).toBe(1);
    const created = keptBody.prices[0];
    if (!created) {
      throw new Error('keep-private created no price');
    }
    return { batchId, predecessorId: created.basicPriceId };
  };

  it('PRICE-SEM-01 / PRICE-ASOF-01 / PRICE-TIME-01 / PRICE-PROV-01 — later observation is not a correction', async () => {
    const { predecessorId } = await importAndKeep({
      vendor: 'sem-03-obs',
      includeKdnColumn: false,
    });
    const predecessor = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: predecessorId },
    });
    expect(predecessor.effectiveDate.toISOString()).toBe(MAY.toISOString());
    const oldMoney = predecessor.value.toFixed(2);

    const observed = asMutationBody(
      (
        await request(http())
          .post(`/basic-price-imports/prices/${predecessorId}/observations`)
          .set(hdr())
          .send({
            expectedValue: oldMoney,
            proposedValue: '105000.00',
            effectiveDate: '2026-08-28',
            reason: 'survei pasar Agustus',
          })
          .expect(201)
      ).body,
    );
    expect(observed.unchanged).toBe(false);
    const observationId = observed.basicPriceId;
    expect(observationId).not.toBe(predecessorId);

    const stillOld = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: predecessorId },
    });
    expect(stillOld.value.toFixed(2)).toBe(oldMoney);
    expect(
      await prisma.basicPrice.findFirst({
        where: { supersedesBasicPriceId: predecessorId },
      }),
    ).toBeNull();

    const observation = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: observationId },
      include: { provenanceCorrections: true },
    });
    expect(observation.recordsNewObservation).toBe(true);
    expect(observation.supersedesBasicPriceId).toBeNull();
    expect(observation.sourceImportRowId).toBeNull();
    expect(observation.sourceType).toBe('MARKET_SURVEY');
    expect(observation.verificationStatus).toBe('UNVERIFIED');
    expect(observation.effectiveDate.toISOString()).toBe(
      '2026-08-28T00:00:00.000Z',
    );
    expect(observation.createdAt.getTime()).not.toBe(
      observation.effectiveDate.getTime(),
    );
    expect(observation.effectiveDateProvenance).toBe('SOURCE_STATED');
    expect(observation.sourcePeriodLabel).toBeNull();
    expect(observation.value.toFixed(2)).toBe('105000.00');
    const audit = observation.provenanceCorrections[0]?.after as {
      semantic?: string;
      evidenceClass?: string;
      sourceIdentityName?: string;
      sameSourceIdentity?: boolean;
    };
    expect(audit?.semantic).toBe('NEW_OBSERVATION');
    expect(audit?.evidenceClass).toBe('FIELD_REPORTED');
    expect(audit?.sameSourceIdentity).toBe(true);
    expect(JSON.stringify(audit)).not.toContain('basic-price-intake');

    expect(await offerIds(MAY, [predecessorId, observationId])).toEqual([
      predecessorId,
    ]);
    expect(
      await offerIds(new Date('2026-08-28T00:00:00.000Z'), [
        predecessorId,
        observationId,
      ]),
    ).toEqual([observationId, predecessorId].sort());

    const historicalList = asListBody(
      (
        await request(http())
          .get('/basic-prices')
          .query({ resourceId: RESOURCE_ID, asOf: '2026-05-01' })
          .set(hdr())
          .expect(200)
      ).body,
    );
    const historicalIds = historicalList.data.map((row) => row.basicPriceId);
    expect(historicalIds).toContain(predecessorId);
    expect(historicalIds).not.toContain(observationId);

    const detail = (
      await request(http())
        .get(`/basic-prices/${observationId}/detail`)
        .set(hdr())
        .expect(200)
    ).body as {
      price: { sourceType: string; sourceName: string | null };
      evidence: {
        observationBasis: string;
        importBatchLinked: boolean;
        originalFileRetained: boolean;
      };
    };
    expect(detail.price.sourceType).toBe('MARKET_SURVEY');
    expect(detail.evidence.observationBasis).toBe('FIELD_REPORTED');
    expect(detail.evidence.importBatchLinked).toBe(false);
    expect(detail.evidence.originalFileRetained).toBe(false);
    const detailJson = JSON.stringify(detail);
    expect(detailJson).not.toContain('sourceStorageRef');
    expect(detailJson).not.toContain('sourceImportRowId');
    expect(detailJson).not.toContain('basic-price-intake');
  });

  it('PRICE-EVID-02 — different-source field observation keeps predecessor source and records a new identity', async () => {
    const { predecessorId } = await importAndKeep({
      vendor: 'sem-03-diffsrc',
      includeKdnColumn: false,
    });
    const predecessor = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: predecessorId },
    });
    const predecessorType = predecessor.sourceType;
    const predecessorOrigin = predecessor.sourceOrigin;
    const observed = asMutationBody(
      (
        await request(http())
          .post(`/basic-price-imports/prices/${predecessorId}/observations`)
          .set(hdr())
          .send({
            expectedValue: predecessor.value.toFixed(2),
            proposedValue: '107000.00',
            effectiveDate: '2026-08-28',
            reason: 'sumber berbeda',
            sameSource: false,
            sourceIdentityName: 'Toko Baru Ambon',
          })
          .expect(201)
      ).body,
    );
    const stillOld = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: predecessorId },
    });
    expect(stillOld.sourceType).toBe(predecessorType);
    expect(stillOld.sourceOrigin).toBe(predecessorOrigin);
    const observation = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: observed.basicPriceId },
      include: { provenanceCorrections: true },
    });
    expect(observation.sourceOrigin).toBe('FIELD_REPORT');
    expect(observation.sourceType).toBe('MARKET_SURVEY');
    expect(observation.sourceImportRowId).toBeNull();
    const after = observation.provenanceCorrections[0]?.after as {
      sourceIdentityName?: string;
      sameSourceIdentity?: boolean;
    };
    expect(after?.sourceIdentityName).toBe('Toko Baru Ambon');
    expect(after?.sameSourceIdentity).toBe(false);
    const detail = (
      await request(http())
        .get(`/basic-prices/${observation.id}/detail`)
        .set(hdr())
        .expect(200)
    ).body as { price: { sourceName: string | null; sourceOrigin: string } };
    expect(detail.price.sourceName).toBe('Toko Baru Ambon');
    expect(detail.price.sourceOrigin).toBe('FIELD_REPORT');
  });

  it('PRICE-SEM-02 / PRICE-IDEMP-02 — correction remains correction and is idempotent', async () => {
    const { predecessorId } = await importAndKeep({
      vendor: 'sem-03-corr',
      includeKdnColumn: false,
    });
    const predecessor = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: predecessorId },
    });
    const first = asMutationBody(
      (
        await request(http())
          .post(`/basic-price-imports/prices/${predecessorId}/corrections`)
          .set(hdr())
          .send({
            expectedValue: predecessor.value.toFixed(2),
            proposedValue: '102000.00',
            reason: 'salah baca invoice Mei',
          })
          .expect(201)
      ).body,
    );
    const second = asMutationBody(
      (
        await request(http())
          .post(`/basic-price-imports/prices/${predecessorId}/corrections`)
          .set(hdr())
          .send({
            expectedValue: predecessor.value.toFixed(2),
            proposedValue: '102000.00',
            reason: 'salah baca invoice Mei',
          })
          .expect(201)
      ).body,
    );
    expect(first.basicPriceId).toBe(second.basicPriceId);
    expect(second.unchanged).toBe(true);
    const successor = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: first.basicPriceId },
      include: { provenanceCorrections: true },
    });
    expect(successor.supersedesBasicPriceId).toBe(predecessorId);
    expect(successor.recordsNewObservation).toBe(false);
    expect(successor.effectiveDate.toISOString()).toBe(MAY.toISOString());
    const audit = successor.provenanceCorrections[0]?.before as {
      semantic?: string;
      value?: string;
    };
    expect(audit?.semantic).toBeUndefined();
    expect(audit?.value).toBe(predecessor.value.toFixed(2));
  });

  it('PRICE-CONC-01 / PRICE-IDEMP-01 — stale observation fails; duplicate observation is one row', async () => {
    const { predecessorId } = await importAndKeep({
      vendor: 'sem-03-conc',
      includeKdnColumn: false,
    });
    const predecessor = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: predecessorId },
    });
    await request(http())
      .post(`/basic-price-imports/prices/${predecessorId}/observations`)
      .set(hdr())
      .send({
        expectedValue: '1.00',
        proposedValue: '106000.00',
        effectiveDate: '2026-08-28',
        reason: 'stale',
      })
      .expect(409);

    const first = asMutationBody(
      (
        await request(http())
          .post(`/basic-price-imports/prices/${predecessorId}/observations`)
          .set(hdr())
          .send({
            expectedValue: predecessor.value.toFixed(2),
            proposedValue: '106000.00',
            effectiveDate: '2026-08-28',
            reason: 'survei pasar',
          })
          .expect(201)
      ).body,
    );
    const second = asMutationBody(
      (
        await request(http())
          .post(`/basic-price-imports/prices/${predecessorId}/observations`)
          .set(hdr())
          .send({
            expectedValue: predecessor.value.toFixed(2),
            proposedValue: '106000.00',
            effectiveDate: '2026-08-28',
            reason: 'survei pasar',
          })
          .expect(201)
      ).body,
    );
    expect(first.basicPriceId).toBe(second.basicPriceId);
    expect(second.unchanged).toBe(true);
    expect(
      await prisma.basicPrice.count({
        where: { resourceId: RESOURCE_ID, recordsNewObservation: true },
      }),
    ).toBe(1);
  });

  it('KDN-SEM-01 / KDN-SEM-02 / KDN-SEM-03 / KDN-CONC-01 / KDN-IDEMP-01', async () => {
    const missing = await importAndKeep({
      vendor: 'sem-03-kdn-miss',
      includeKdnColumn: false,
    });
    const missingRow = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: missing.predecessorId },
    });
    expect(missingRow.kdnPercent).toBeNull();
    await request(http())
      .post(`/basic-price-imports/prices/${missing.predecessorId}/kdn`)
      .set(hdr())
      .send({
        kdnPercent: '72.50',
        reason: 'sertifikat pabrik',
        expectedKdnPercent: null,
      })
      .expect(201);
    const enriched = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: missing.predecessorId },
    });
    expect(enriched.kdnPercent?.toFixed(2)).toBe('72.50');
    expect(enriched.kdnEstablishment).toBe('MANUAL_ENRICHMENT');

    await request(http())
      .post(`/basic-price-imports/prices/${missing.predecessorId}/kdn`)
      .set(hdr())
      .send({
        kdnPercent: '68.20',
        reason: 'should not overwrite',
        expectedKdnPercent: '72.50',
      })
      .expect(409);

    const firstCorrect = asMutationBody(
      (
        await request(http())
          .post(
            `/basic-price-imports/prices/${missing.predecessorId}/kdn-corrections`,
          )
          .set(hdr())
          .send({
            expectedValue: missingRow.value.toFixed(2),
            expectedKdnPercent: '72.50',
            proposedKdnPercent: '68.20',
            reason: 'angka sertifikat salah baca',
          })
          .expect(201)
      ).body,
    );
    const secondCorrect = asMutationBody(
      (
        await request(http())
          .post(
            `/basic-price-imports/prices/${missing.predecessorId}/kdn-corrections`,
          )
          .set(hdr())
          .send({
            expectedValue: missingRow.value.toFixed(2),
            expectedKdnPercent: '72.50',
            proposedKdnPercent: '68.20',
            reason: 'angka sertifikat salah baca',
          })
          .expect(201)
      ).body,
    );
    expect(firstCorrect.basicPriceId).toBe(secondCorrect.basicPriceId);
    expect(secondCorrect.unchanged).toBe(true);
    const corrected = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: firstCorrect.basicPriceId },
    });
    expect(corrected.supersedesBasicPriceId).toBe(missing.predecessorId);
    expect(corrected.kdnPercent?.toFixed(2)).toBe('68.20');
    expect(corrected.kdnEstablishment).toBe('MANUAL_CORRECTION');
    expect(corrected.value.toFixed(2)).toBe(missingRow.value.toFixed(2));

    const stated = await importAndKeep({
      vendor: 'sem-03-kdn-new',
      includeKdnColumn: true,
    });
    const statedRow = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: stated.predecessorId },
    });
    expect(statedRow.kdnPercent?.toFixed(2)).toBe('72.50');
    await request(http())
      .post(
        `/basic-price-imports/prices/${stated.predecessorId}/kdn-corrections`,
      )
      .set(hdr())
      .send({
        expectedValue: statedRow.value.toFixed(2),
        expectedKdnPercent: '1.00',
        proposedKdnPercent: '70.00',
        reason: 'stale',
      })
      .expect(409);
    const observed = asMutationBody(
      (
        await request(http())
          .post(
            `/basic-price-imports/prices/${stated.predecessorId}/kdn-observations`,
          )
          .set(hdr())
          .send({
            expectedValue: statedRow.value.toFixed(2),
            expectedKdnPercent: '72.50',
            proposedKdnPercent: '70.00',
            effectiveDate: '2026-08-28',
            reason: 'sertifikat pabrik baru',
          })
          .expect(201)
      ).body,
    );
    const stillStated = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: stated.predecessorId },
    });
    expect(stillStated.kdnPercent?.toFixed(2)).toBe('72.50');
    const kdnObservation = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: observed.basicPriceId },
    });
    expect(kdnObservation.recordsNewObservation).toBe(true);
    expect(kdnObservation.supersedesBasicPriceId).toBeNull();
    expect(kdnObservation.kdnPercent?.toFixed(2)).toBe('70.00');
    expect(kdnObservation.kdnEstablishment).toBe('MANUAL_NEW_OBSERVATION');
    expect(kdnObservation.value.toFixed(2)).toBe(statedRow.value.toFixed(2));
    const kdnDetail = (
      await request(http())
        .get(`/basic-prices/${kdnObservation.id}/detail`)
        .set(hdr())
        .expect(200)
    ).body as {
      evidence: { kdnSourceSummary: string | null; observationBasis: string };
    };
    expect(kdnDetail.evidence.kdnSourceSummary).toBe('Informasi KDN terbaru');
    expect(kdnDetail.evidence.kdnSourceSummary).not.toMatch(/sertifikat/i);
  });

  it('DETAIL-ROUTE-03 / DETAIL-ROUTE-04 — catalog and foreign private rows are 404', async () => {
    const catalog = await prisma.basicPrice.create({
      data: {
        assetScope: 'SIMPROK_CATALOG',
        workspaceId: WORKSPACE_A,
        organizationId: ORG_A,
        resourceId: RESOURCE_ID,
        regionId: REGION_ID,
        effectiveDate: MAY,
        value: new Prisma.Decimal('88000.00'),
        status: 'PUBLISHED',
        verificationStatus: 'PUBLISHED',
      },
    });
    await request(http())
      .post(`/basic-price-imports/prices/${catalog.id}/observations`)
      .set(hdr())
      .send({
        expectedValue: '88000.00',
        proposedValue: '89000.00',
        effectiveDate: '2026-08-28',
        reason: 'catalog deny',
      })
      .expect(404);

    const foreign = await prisma.basicPrice.create({
      data: {
        assetScope: 'WORKSPACE_PRIVATE',
        workspaceId: WORKSPACE_B,
        organizationId: ORG_A,
        resourceId: RESOURCE_ID,
        regionId: REGION_ID,
        effectiveDate: MAY,
        value: new Prisma.Decimal('91000.00'),
        recordsNewObservation: true,
        reportedByAccountId: actorAccountId,
      },
    });
    await request(http())
      .post(`/basic-price-imports/prices/${foreign.id}/observations`)
      .set(hdr())
      .send({
        expectedValue: '91000.00',
        proposedValue: '92000.00',
        effectiveDate: '2026-08-28',
        reason: 'foreign deny',
      })
      .expect(404);
    await request(http())
      .get(`/basic-prices/${foreign.id}/detail`)
      .set(hdr())
      .expect(404);
  });

  it('DB — I4a third channel is new observation, never silent evidence-free private rows', async () => {
    await expectCheckRejects(
      () =>
        prisma.basicPrice.create({
          data: {
            assetScope: 'WORKSPACE_PRIVATE',
            workspaceId: WORKSPACE_A,
            organizationId: ORG_A,
            resourceId: RESOURCE_ID,
            regionId: REGION_ID,
            effectiveDate: MAY,
            value: new Prisma.Decimal('93000.00'),
            reportedByAccountId: actorAccountId,
          },
        }),
      'basic_prices_private_requires_import_row_provenance_check',
    );

    const lawful = await prisma.basicPrice.create({
      data: {
        assetScope: 'WORKSPACE_PRIVATE',
        workspaceId: WORKSPACE_A,
        organizationId: ORG_A,
        resourceId: RESOURCE_ID,
        regionId: REGION_ID,
        effectiveDate: MAY,
        value: new Prisma.Decimal('94000.00'),
        recordsNewObservation: true,
        reportedByAccountId: actorAccountId,
      },
    });
    expect(lawful.recordsNewObservation).toBe(true);

    await expectCheckRejects(
      () =>
        prisma.basicPrice.create({
          data: {
            assetScope: 'WORKSPACE_PRIVATE',
            workspaceId: WORKSPACE_A,
            organizationId: ORG_A,
            resourceId: RESOURCE_ID,
            regionId: REGION_ID,
            effectiveDate: MAY,
            value: new Prisma.Decimal('95000.00'),
            recordsNewObservation: true,
            reportedByAccountId: actorAccountId,
            supersedesBasicPriceId: lawful.id,
          },
        }),
      'basic_prices_new_observation_is_new_observation_check',
    );
  });
});
