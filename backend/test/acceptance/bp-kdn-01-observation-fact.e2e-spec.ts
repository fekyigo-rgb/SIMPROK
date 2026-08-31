import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { buildBasicPriceXlsx } from '../fixtures/basic-price-xlsx.fixture';

/**
 * BP-KDN-01 — observation %KDN persistence on the real import path.
 *
 * Safe E2E database only (simprok_e2e). Proves:
 *   source raw KDN → normalized 72.50 → BasicPrice.kdnPercent → Detail
 * and a second row with no KDN stays unknown, not zero.
 */
const WORKSPACE_A = '10000000-0000-4000-8000-000000000004';
const WORKSPACE_B = '10000000-0000-4000-8000-000000000005';
const PASSWORD = 'Test1234!';

const RESOURCE_ID = '47000000-0000-4000-8000-000000000001';
const REGION_ID = '47000000-0000-4000-8000-000000000003';

interface LoginBody {
  access_token: string;
}

interface PreviewRow {
  id: string;
  sourceRowNumber: number;
  version: number;
  proposedCanonicalKdn: string | null;
  proposedCanonicalPrice: string | null;
  sourceKdnHeaderText: string | null;
}

interface PreviewBody {
  batchId: string;
  kdnMapping: { status: string };
  rows: PreviewRow[];
}

interface KeptBody {
  createdCount: number;
  prices: Array<{ basicPriceId: string }>;
}

interface DetailBody {
  domesticContent: { kdnPercent: string | null };
  price: { price: string };
  evidence: { kdnSourceSummary: string | null };
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

function asDetailBody(body: unknown): DetailBody {
  if (typeof body !== 'object' || body === null) {
    throw new Error('detail body missing');
  }
  return body as DetailBody;
}

describe('BP-KDN-01 observation %KDN (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let token: string;
  let tokenB: string;
  let personDayUnitId: string;

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
        code: 'BP-KDN-01-REGION',
        name: 'BP-KDN-01 Region',
        isActive: true,
      },
      update: {},
    });
    await prisma.resourceCatalog.upsert({
      where: { id: RESOURCE_ID },
      create: {
        id: RESOURCE_ID,
        workspaceId: WORKSPACE_A,
        code: 'BP-KDN-01-01',
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

    token = readLoginToken(
      (
        await request(app.getHttpServer() as Server)
          .post('/auth/login')
          .send({ email: 'assigned@test.local', password: PASSWORD })
      ).body,
    );
    tokenB = readLoginToken(
      (
        await request(app.getHttpServer() as Server)
          .post('/auth/login')
          .send({ email: 'foreman@test.local', password: PASSWORD })
      ).body,
    );
  });

  afterEach(async () => {
    await prisma.basicPriceProvenanceCorrection.deleteMany({
      where: { workspaceId: WORKSPACE_A },
    });
    await prisma.basicPrice.deleteMany({ where: { workspaceId: WORKSPACE_A } });
    await prisma.basicPriceImportBatch.deleteMany({
      where: { workspaceId: WORKSPACE_A },
    });
  });

  afterAll(async () => {
    await prisma.basicPriceProvenanceCorrection.deleteMany({
      where: { workspaceId: WORKSPACE_A },
    });
    await prisma.basicPrice.deleteMany({ where: { workspaceId: WORKSPACE_A } });
    await prisma.basicPriceImportBatch.deleteMany({
      where: { workspaceId: WORKSPACE_A },
    });
    await prisma.resourceCatalog.deleteMany({ where: { id: RESOURCE_ID } });
    await prisma.region.deleteMany({ where: { id: REGION_ID } });
    await prisma.$disconnect();
    await app.close();
  });

  const http = (): Server => app.getHttpServer() as Server;

  const hdr = (bearer = token, workspace = WORKSPACE_A) => ({
    Authorization: `Bearer ${bearer}`,
    'x-workspace-id': workspace,
  });

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
      .field('effectiveDate', '2026-08-27')
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
        .send({ version: other.version, reason: 'out of scope for BP-KDN-01' })
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

    return {
      preview: previewBody,
      laborRow: row,
      batchId,
      basicPriceId: created.basicPriceId,
    };
  };

  it('KDN-FLOW-03/04 — stated 72.5 persists as 72.50 on the price and Detail', async () => {
    const { preview, laborRow, basicPriceId } = await importAndKeep({
      vendor: 'bp-kdn-01-stated',
      includeKdnColumn: true,
    });

    expect(preview.kdnMapping.status).toBe('ESTABLISHED');
    expect(laborRow.proposedCanonicalKdn).toBe('72.50');
    expect(laborRow.proposedCanonicalPrice).toMatch(/^100000(\.00)?$/);
    expect(laborRow.sourceKdnHeaderText).toBe('KDN (%)');

    const stored = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: basicPriceId },
      select: {
        value: true,
        kdnPercent: true,
        kdnEstablishment: true,
        resourceId: true,
      },
    });
    expect(stored.value.toString()).toBe('100000');
    expect(stored.kdnPercent?.toString()).toBe('72.5');
    expect(stored.kdnEstablishment).toBe('SOURCE_IMPORT_ROW');
    expect(stored.resourceId).toBe(RESOURCE_ID);

    const catalog = await prisma.resourceCatalog.findUniqueOrThrow({
      where: { id: RESOURCE_ID },
      select: { tkdnValue: true },
    });
    expect(catalog.tkdnValue).toBeNull();

    const detail = await request(http())
      .get(`/basic-prices/${basicPriceId}/detail`)
      .set(hdr())
      .expect(200);
    const detailBody = asDetailBody(detail.body);
    expect(detailBody.domesticContent.kdnPercent).toBe('72.50');
    expect(detailBody.price.price).toBe('100000.00');
    expect(JSON.stringify(detailBody)).not.toContain('tkdnValue');
    expect(JSON.stringify(detailBody)).not.toContain('TKDN');
    expect(detailBody.evidence.kdnSourceSummary).toMatch(/KDN \(%\)/);
  });

  it('KDN-FLOW-01 — missing KDN stays unknown, not zero, and may be enriched later', async () => {
    const { laborRow, basicPriceId } = await importAndKeep({
      vendor: 'bp-kdn-01-missing',
      includeKdnColumn: false,
    });

    expect(laborRow.proposedCanonicalKdn).toBeNull();

    const stored = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: basicPriceId },
      select: { value: true, kdnPercent: true, kdnEstablishment: true },
    });
    expect(stored.value.toString()).toBe('100000');
    expect(stored.kdnPercent).toBeNull();
    expect(stored.kdnEstablishment).toBeNull();

    const detailBefore = await request(http())
      .get(`/basic-prices/${basicPriceId}/detail`)
      .set(hdr())
      .expect(200);
    const beforeBody = asDetailBody(detailBefore.body);
    expect(beforeBody.domesticContent.kdnPercent).toBeNull();
    expect(beforeBody.price.price).toBe('100000.00');

    await request(http())
      .post(`/basic-price-imports/prices/${basicPriceId}/kdn`)
      .set(hdr())
      .send({ kdnPercent: '72.5', reason: 'Sertifikat pabrik 2024' })
      .expect(201);

    const after = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: basicPriceId },
      select: { value: true, kdnPercent: true, kdnEstablishment: true },
    });
    expect(after.value.toString()).toBe('100000');
    expect(after.kdnPercent?.toString()).toBe('72.5');
    expect(after.kdnEstablishment).toBe('MANUAL_ENRICHMENT');

    const detailAfter = await request(http())
      .get(`/basic-prices/${basicPriceId}/detail`)
      .set(hdr())
      .expect(200);
    const afterBody = asDetailBody(detailAfter.body);
    expect(afterBody.domesticContent.kdnPercent).toBe('72.50');
    expect(afterBody.evidence.kdnSourceSummary).toBe('Dilengkapi kemudian');
    expect(afterBody.price.price).toBe('100000.00');
  });

  it('KDN-SEC-01/02 — a foreign workspace cannot read or mutate private KDN', async () => {
    const { basicPriceId } = await importAndKeep({
      vendor: 'bp-kdn-01-tenant',
      includeKdnColumn: true,
    });

    await request(http())
      .get(`/basic-prices/${basicPriceId}/detail`)
      .set(hdr(tokenB, WORKSPACE_B))
      .expect((res) => {
        expect([403, 404]).toContain(res.status);
      });

    await request(http())
      .post(`/basic-price-imports/prices/${basicPriceId}/kdn`)
      .set(hdr(tokenB, WORKSPACE_B))
      .send({ kdnPercent: '40', reason: 'coba' })
      .expect((res) => {
        expect([403, 404]).toContain(res.status);
      });

    const stored = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: basicPriceId },
      select: { kdnPercent: true, value: true },
    });
    expect(stored.kdnPercent?.toString()).toBe('72.5');
    expect(stored.value.toString()).toBe('100000');
  });
});
