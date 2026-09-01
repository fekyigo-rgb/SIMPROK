import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, PrismaClient } from '@prisma/client';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { basicPriceApplicabilityAnd } from '../../src/basic-price/basic-price-applicability';
import { BasicPricePromotionService } from '../../src/basic-price/basic-price-promotion.service';
import {
  basicPriceCurrentnessWhere,
  mergeCurrentnessAnd,
} from '../../src/basic-price/basic-price-currentness';
import { buildBasicPriceXlsx } from '../fixtures/basic-price-xlsx.fixture';

/**
 * BP-DETAIL-MAINT-02R — executable ratification of the five remaining seams
 * against simprok_e2e. Never touches 55432 / simprok_db.
 */
const WORKSPACE_A = '10000000-0000-4000-8000-000000000004';
const WORKSPACE_B = '10000000-0000-4000-8000-000000000005';
const ORG_A = '10000000-0000-4000-8000-000000000002';
const PASSWORD = 'Test1234!';
const RESOURCE_ID = '48000000-0000-4000-8000-000000000001';
const REGION_ID = '48000000-0000-4000-8000-000000000003';
const ROLE_VERIFIER_ID = '48000000-0000-4000-8000-000000000010';
const ROLE_PUBLISHER_ID = '48000000-0000-4000-8000-000000000011';
const CURATOR_ROLE_IDS = [ROLE_VERIFIER_ID, ROLE_PUBLISHER_ID];
const MARCH = new Date('2026-03-01T00:00:00.000Z');

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

interface CorrectionBody {
  basicPriceId: string;
  value: string;
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

function asCorrectionBody(body: unknown): CorrectionBody {
  if (typeof body !== 'object' || body === null) {
    throw new Error('correction body missing');
  }
  return body as CorrectionBody;
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

describe('BP-DETAIL-MAINT-02R ratification (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let submitToken: string;
  let verifyToken: string;
  let publishToken: string;
  let personDayUnitId: string;
  let promotionService: BasicPricePromotionService;
  let publisherAccountId: string;
  const createdPermissionIds: string[] = [];

  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.init();
    // The SAME governed promotion service bpcat01b drives. There is no
    // production route yet, so this is the existing flow, not a new one.
    promotionService = app.get(BasicPricePromotionService);
    prisma = new PrismaClient();
    await prisma.region.upsert({
      where: { id: REGION_ID },
      create: {
        id: REGION_ID,
        code: 'BP-MAINT-02R-REGION',
        name: 'BP-MAINT-02R Region',
        isActive: true,
      },
      update: {},
    });
    await prisma.resourceCatalog.upsert({
      where: { id: RESOURCE_ID },
      create: {
        id: RESOURCE_ID,
        workspaceId: WORKSPACE_A,
        code: 'BP-MAINT-02R-01',
        name: 'Pekerja ratification',
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

    const curatorCodes = [
      'BASIC_PRICE_VERIFY',
      'BASIC_PRICE_PUBLISH',
      'BASIC_PRICE_VIEW',
      // Owner Law D — needed only so the SHARED half of a promotion lineage is
      // reachable at all. Without it the copy-refusal below is masked as 404
      // (permission), and the lineage law would never be the thing under test.
      'BASIC_PRICE_PROMOTE_SHARED',
    ];
    const permissionsBefore = await prisma.permission.findMany({
      where: { code: { in: curatorCodes } },
      select: { code: true },
    });
    const preexistingPermissionCodes = new Set(
      permissionsBefore.map((row) => row.code),
    );
    const curatorPermissions = await Promise.all(
      curatorCodes.map((code) =>
        prisma.permission.upsert({
          where: { code },
          create: { code, name: code },
          update: {},
        }),
      ),
    );
    createdPermissionIds.push(
      ...curatorPermissions
        .filter((row) => !preexistingPermissionCodes.has(row.code))
        .map((row) => row.id),
    );
    const permissionId = (code: string) =>
      curatorPermissions.find((row) => row.code === code)!.id;
    const grantCuratorRole = async (
      roleId: string,
      roleCode: string,
      codes: string[],
      email: string,
    ) => {
      await prisma.role.upsert({
        where: { id: roleId },
        create: {
          id: roleId,
          workspaceId: WORKSPACE_A,
          code: roleCode,
          name: roleCode,
        },
        update: {},
      });
      await prisma.rolePermission.createMany({
        data: codes.map((code) => ({
          roleId,
          permissionId: permissionId(code),
        })),
        skipDuplicates: true,
      });
      const account = await prisma.account.findUniqueOrThrow({
        where: { email },
      });
      const membership = await prisma.workspaceMembership.findUniqueOrThrow({
        where: {
          accountId_workspaceId: {
            accountId: account.id,
            workspaceId: WORKSPACE_A,
          },
        },
      });
      const already = await prisma.membershipRole.findFirst({
        where: { workspaceMembershipId: membership.id, roleId },
      });
      if (!already) {
        await prisma.membershipRole.create({
          data: {
            workspaceMembershipId: membership.id,
            roleId,
            isActive: true,
          },
        });
      }
    };
    await grantCuratorRole(
      ROLE_VERIFIER_ID,
      'BP_MAINT_02R_VERIFIER',
      ['BASIC_PRICE_VERIFY'],
      'nonassigned@test.local',
    );
    await grantCuratorRole(
      ROLE_PUBLISHER_ID,
      'BP_MAINT_02R_PUBLISHER',
      ['BASIC_PRICE_PUBLISH', 'BASIC_PRICE_VIEW', 'BASIC_PRICE_PROMOTE_SHARED'],
      'foreman@test.local',
    );

    submitToken = readLoginToken(
      (
        await request(app.getHttpServer() as Server)
          .post('/auth/login')
          .send({ email: 'assigned@test.local', password: PASSWORD })
      ).body,
    );
    verifyToken = readLoginToken(
      (
        await request(app.getHttpServer() as Server)
          .post('/auth/login')
          .send({ email: 'nonassigned@test.local', password: PASSWORD })
      ).body,
    );
    publishToken = readLoginToken(
      (
        await request(app.getHttpServer() as Server)
          .post('/auth/login')
          .send({ email: 'foreman@test.local', password: PASSWORD })
      ).body,
    );
    publisherAccountId = (
      await prisma.account.findUniqueOrThrow({
        where: { email: 'foreman@test.local' },
      })
    ).id;
  });

  afterEach(async () => {
    await prisma.basicPriceProvenanceCorrection.deleteMany({
      where: { workspaceId: { in: [WORKSPACE_A, WORKSPACE_B] } },
    });
    await prisma.basicPrice.deleteMany({
      where: { resourceId: RESOURCE_ID, supersedesBasicPriceId: { not: null } },
    });
    // A promoted descendant names its origin through `promotedFromBasicPriceId`
    // with onDelete: Restrict, so it must go FIRST. One DELETE covering both
    // would depend on a row order Postgres does not promise.
    await prisma.basicPrice.deleteMany({
      where: {
        resourceId: RESOURCE_ID,
        promotedFromBasicPriceId: { not: null },
      },
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
    // A promoted descendant names its origin through `promotedFromBasicPriceId`
    // with onDelete: Restrict, so it must go FIRST. One DELETE covering both
    // would depend on a row order Postgres does not promise.
    await prisma.basicPrice.deleteMany({
      where: {
        resourceId: RESOURCE_ID,
        promotedFromBasicPriceId: { not: null },
      },
    });
    await prisma.basicPrice.deleteMany({ where: { resourceId: RESOURCE_ID } });
    await prisma.basicPriceImportBatch.deleteMany({
      where: { workspaceId: WORKSPACE_A },
    });
    await prisma.resourceCatalog.deleteMany({ where: { id: RESOURCE_ID } });
    await prisma.region.deleteMany({ where: { id: REGION_ID } });
    await prisma.membershipRole.deleteMany({
      where: { roleId: { in: CURATOR_ROLE_IDS } },
    });
    await prisma.rolePermission.deleteMany({
      where: { roleId: { in: CURATOR_ROLE_IDS } },
    });
    await prisma.role.deleteMany({ where: { id: { in: CURATOR_ROLE_IDS } } });
    if (createdPermissionIds.length > 0) {
      await prisma.permission.deleteMany({
        where: { id: { in: createdPermissionIds } },
      });
    }
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

  const importAndKeep = async (vendor: string) => {
    const preview = await request(http())
      .post('/basic-price-imports/preview')
      .set(hdr())
      .attach('file', await buildBasicPriceXlsx({ includeKdnColumn: false }), {
        filename: `${vendor}.xlsx`,
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .field('selectedSheet', 'HARGA SATUAN UPAH DAN BAHAN')
      .field('sourceVendorName', vendor)
      .field('regionId', REGION_ID)
      .field('effectiveDate', '2026-03-01')
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
        .send({ version: other.version, reason: 'out of scope for MAINT-02R' })
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

  const correctPrivate = async (
    predecessorId: string,
    expectedValue: string,
    proposedValue: string,
  ) => {
    const response = await request(http())
      .post(`/basic-price-imports/prices/${predecessorId}/corrections`)
      .set(hdr())
      .send({
        expectedValue,
        proposedValue,
        reason: 'koreksi angka invoice',
      });
    return response;
  };

  it('PRIVATE-ASOF-01 — an August successor is absent from a March historical offer', async () => {
    const { predecessorId } = await importAndKeep('maint-02r-asof');
    const predecessor = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: predecessorId },
    });
    expect(predecessor.effectiveDate.toISOString()).toBe(MARCH.toISOString());

    const corrected = asCorrectionBody(
      (
        await correctPrivate(
          predecessorId,
          predecessor.value.toFixed(2),
          '105000.00',
        )
      ).body,
    );
    expect(corrected.unchanged).toBe(false);
    const successorId = corrected.basicPriceId;
    const successor = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: successorId },
    });
    expect(successor.effectiveDate.toISOString()).toBe(MARCH.toISOString());
    expect(successor.createdAt.getTime()).toBeGreaterThan(MARCH.getTime());

    const justBefore = new Date(successor.createdAt.getTime() - 1000);
    expect(await offerIds(justBefore, [predecessorId, successorId])).toEqual([
      predecessorId,
    ]);
    expect(
      await offerIds(successor.createdAt, [predecessorId, successorId]),
    ).toEqual([successorId]);
    expect(
      await offerIds(new Date(successor.createdAt.getTime() + 1000), [
        predecessorId,
        successorId,
      ]),
    ).toEqual([successorId]);

    const historicalList = asListBody(
      (
        await request(http())
          .get('/basic-prices')
          .query({ resourceId: RESOURCE_ID, asOf: '2026-03-01' })
          .set(hdr())
          .expect(200)
      ).body,
    );
    const historicalIds = historicalList.data.map((row) => row.basicPriceId);
    expect(historicalIds).toContain(predecessorId);
    expect(historicalIds).not.toContain(successorId);

    const presentList = asListBody(
      (
        await request(http())
          .get('/basic-prices')
          .query({ resourceId: RESOURCE_ID })
          .set(hdr())
          .expect(200)
      ).body,
    );
    const presentIds = presentList.data.map((row) => row.basicPriceId);
    expect(presentIds).toContain(successorId);
    expect(presentIds).not.toContain(predecessorId);
  });

  it('PRIVATE-LIFECYCLE-01 — lawful transitions do not retcon the March answer', async () => {
    const { predecessorId } = await importAndKeep('maint-02r-life');
    const predecessor = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: predecessorId },
    });
    const successorId = asCorrectionBody(
      (
        await correctPrivate(
          predecessorId,
          predecessor.value.toFixed(2),
          '106000.00',
        )
      ).body,
    ).basicPriceId;

    await request(http())
      .post(`/basic-price-imports/prices/${successorId}/kdn`)
      .set(hdr())
      .send({
        kdnPercent: '72.50',
        reason: 'sertifikat pabrik',
        expectedKdnPercent: null,
      })
      .expect(201);

    await request(http())
      .post(`/basic-price-publications/${successorId}/publish`)
      .set(hdr(publishToken))
      .send({})
      .expect(409);

    await expectCheckRejects(
      () =>
        prisma.basicPrice.update({
          where: { id: successorId },
          data: { verificationStatus: 'VERIFIED' },
        }),
      'basic_prices_supersession_successor_is_published_check',
    );

    const successor = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: successorId },
      select: {
        verificationStatus: true,
        status: true,
        createdAt: true,
        value: true,
        kdnPercent: true,
      },
    });
    expect(successor.verificationStatus).toBe('UNVERIFIED');
    expect(successor.status).toBe('UNPUBLISHED');
    expect(successor.kdnPercent?.toFixed(2)).toBe('72.50');
    expect(successor.value.toFixed(2)).toBe('106000.00');

    const justBefore = new Date(successor.createdAt.getTime() - 1000);
    expect(await offerIds(justBefore, [predecessorId, successorId])).toEqual([
      predecessorId,
    ]);
    expect(
      await offerIds(successor.createdAt, [predecessorId, successorId]),
    ).toEqual([successorId]);
  });

  it('DB-PRIVATE-SUP-01..06 — final CHECK law on the live e2e database', async () => {
    const defs = await prisma.$queryRaw<Array<{ name: string; def: string }>>`
      SELECT c.conname AS name, pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = 'basic_prices'
        AND c.conname IN (
          'basic_prices_supersession_successor_is_published_check',
          'basic_prices_private_requires_import_row_provenance_check',
          'basic_prices_supersession_not_self_check',
          'basic_prices_supersession_not_promoted_row_check'
        )
      ORDER BY c.conname`;
    const byName = Object.fromEntries(defs.map((row) => [row.name, row.def]));
    expect(
      byName.basic_prices_supersession_successor_is_published_check,
    ).toContain('WORKSPACE_PRIVATE');
    expect(
      byName.basic_prices_supersession_successor_is_published_check,
    ).toContain('UNVERIFIED');
    expect(
      byName.basic_prices_supersession_successor_is_published_check,
    ).toContain('PUBLISHED');
    expect(byName.basic_prices_supersession_not_self_check).toContain('<>');
    expect(byName.basic_prices_supersession_not_promoted_row_check).toContain(
      'promotedFromBasicPriceId',
    );

    const { predecessorId } = await importAndKeep('maint-02r-db');
    const predecessor = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: predecessorId },
    });
    const successorId = asCorrectionBody(
      (
        await correctPrivate(
          predecessorId,
          predecessor.value.toFixed(2),
          '107000.00',
        )
      ).body,
    ).basicPriceId;
    const successor = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: successorId },
    });
    expect(successor.assetScope).toBe('WORKSPACE_PRIVATE');
    expect(successor.supersedesBasicPriceId).toBe(predecessorId);

    const catalogProbe = await prisma.basicPrice.create({
      data: {
        assetScope: 'SIMPROK_CATALOG',
        workspaceId: WORKSPACE_A,
        organizationId: ORG_A,
        resourceId: RESOURCE_ID,
        regionId: REGION_ID,
        effectiveDate: MARCH,
        value: new Prisma.Decimal('77000.00'),
        status: 'PUBLISHED',
        verificationStatus: 'PUBLISHED',
      },
    });

    await expectCheckRejects(
      () =>
        prisma.basicPrice.create({
          data: {
            assetScope: 'SIMPROK_CATALOG',
            workspaceId: WORKSPACE_A,
            organizationId: ORG_A,
            resourceId: RESOURCE_ID,
            regionId: REGION_ID,
            effectiveDate: MARCH,
            value: new Prisma.Decimal('108000.00'),
            status: 'UNPUBLISHED',
            verificationStatus: 'UNVERIFIED',
            supersedesBasicPriceId: catalogProbe.id,
          },
        }),
      'basic_prices_supersession_successor_is_published_check',
    );

    await expectCheckRejects(
      () =>
        prisma.basicPrice.update({
          where: { id: successorId },
          data: { supersedesBasicPriceId: successorId },
        }),
      'basic_prices_supersession_not_self_check',
    );

    await expect(
      prisma.basicPrice.create({
        data: {
          assetScope: 'WORKSPACE_PRIVATE',
          workspaceId: WORKSPACE_A,
          organizationId: ORG_A,
          resourceId: RESOURCE_ID,
          regionId: REGION_ID,
          effectiveDate: MARCH,
          value: new Prisma.Decimal('109000.00'),
          status: 'UNPUBLISHED',
          verificationStatus: 'UNVERIFIED',
          supersedesBasicPriceId: predecessorId,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    const catalogA = await prisma.basicPrice.create({
      data: {
        assetScope: 'SIMPROK_CATALOG',
        workspaceId: WORKSPACE_A,
        organizationId: ORG_A,
        resourceId: RESOURCE_ID,
        regionId: REGION_ID,
        effectiveDate: MARCH,
        value: new Prisma.Decimal('78000.00'),
        status: 'PUBLISHED',
        verificationStatus: 'PUBLISHED',
      },
    });
    const catalogB = await prisma.basicPrice.create({
      data: {
        assetScope: 'SIMPROK_CATALOG',
        workspaceId: WORKSPACE_A,
        organizationId: ORG_A,
        resourceId: RESOURCE_ID,
        regionId: REGION_ID,
        effectiveDate: MARCH,
        value: new Prisma.Decimal('81000.00'),
        status: 'PUBLISHED',
        verificationStatus: 'PUBLISHED',
        supersedesBasicPriceId: catalogA.id,
      },
    });
    expect(catalogB.supersedesBasicPriceId).toBe(catalogA.id);

    await expectCheckRejects(
      () =>
        prisma.basicPrice.create({
          data: {
            assetScope: 'SIMPROK_CATALOG',
            workspaceId: null,
            organizationId: null,
            resourceId: RESOURCE_ID,
            regionId: REGION_ID,
            effectiveDate: MARCH,
            value: new Prisma.Decimal('82000.00'),
            status: 'PUBLISHED',
            verificationStatus: 'PUBLISHED',
            promotedFromBasicPriceId: catalogA.id,
            supersedesBasicPriceId: catalogB.id,
          },
        }),
      'basic_prices_supersession_not_promoted_row_check',
    );
  });

  it('PRIVATE-PROV-01..05 — new money is audited; KDN and money stay independent', async () => {
    const { predecessorId } = await importAndKeep('maint-02r-prov');
    const before = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: predecessorId },
    });
    expect(before.kdnPercent).toBeNull();
    expect(before.sourceImportRowId).not.toBeNull();

    const corrected = asCorrectionBody(
      (
        await correctPrivate(
          predecessorId,
          before.value.toFixed(2),
          '110000.00',
        )
      ).body,
    );
    const successor = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: corrected.basicPriceId },
    });
    const predecessorAfter = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: predecessorId },
    });
    expect(predecessorAfter.value.toFixed(2)).toBe(before.value.toFixed(2));
    expect(successor.value.toFixed(2)).toBe('110000.00');
    expect(successor.sourceImportRowId).toBeNull();
    expect(successor.kdnPercent).toBeNull();
    expect(successor.reportedByAccountId).toBeTruthy();
    expect(successor.effectiveDate.toISOString()).toBe(
      before.effectiveDate.toISOString(),
    );

    const audit = await prisma.basicPriceProvenanceCorrection.findFirstOrThrow({
      where: { basicPriceId: successor.id },
    });
    expect(audit.reason).toBe('koreksi angka invoice');
    expect(audit.actorAccountId).toBeTruthy();
    expect(audit.before).toMatchObject({ value: before.value.toFixed(2) });
    expect(audit.after).toMatchObject({ value: '110000.00' });

    await request(http())
      .post(`/basic-price-imports/prices/${successor.id}/kdn`)
      .set(hdr())
      .send({
        kdnPercent: '63.20',
        reason: 'dokumen KDN',
        expectedKdnPercent: null,
      })
      .expect(201);
    const afterKdn = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: successor.id },
    });
    expect(afterKdn.value.toFixed(2)).toBe('110000.00');
    expect(afterKdn.kdnPercent?.toFixed(2)).toBe('63.20');
    expect(
      (
        await prisma.basicPrice.findUniqueOrThrow({
          where: { id: predecessorId },
        })
      ).value.toFixed(2),
    ).toBe(before.value.toFixed(2));
  });

  it('CAT-KDN-01..08 — curator fill, ordinary deny, stale, idempotent, foreign', async () => {
    const catalog = await prisma.basicPrice.create({
      data: {
        assetScope: 'SIMPROK_CATALOG',
        workspaceId: WORKSPACE_A,
        organizationId: ORG_A,
        resourceId: RESOURCE_ID,
        regionId: REGION_ID,
        effectiveDate: MARCH,
        value: new Prisma.Decimal('99000.00'),
        status: 'PUBLISHED',
        verificationStatus: 'PUBLISHED',
        kdnPercent: null,
        kdnEstablishment: null,
      },
    });

    await request(http())
      .post(`/basic-price-imports/prices/${catalog.id}/catalog-kdn`)
      .set(hdr(submitToken))
      .send({
        kdnPercent: '72.50',
        reason: 'kurasi',
        expectedKdnPercent: null,
      })
      .expect(403);

    const filled = await request(http())
      .post(`/basic-price-imports/prices/${catalog.id}/catalog-kdn`)
      .set(hdr(verifyToken))
      .send({
        kdnPercent: '72.50',
        reason: 'kurasi katalog',
        expectedKdnPercent: null,
      })
      .expect(201);
    expect(filled.body).toMatchObject({
      basicPriceId: catalog.id,
      kdnPercent: '72.50',
      unchanged: false,
    });
    const afterFill = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: catalog.id },
    });
    expect(afterFill.value.toFixed(2)).toBe('99000.00');
    expect(afterFill.kdnPercent?.toFixed(2)).toBe('72.50');

    await request(http())
      .post(`/basic-price-imports/prices/${catalog.id}/catalog-kdn`)
      .set(hdr(verifyToken))
      .send({
        kdnPercent: '63.20',
        reason: 'overwrite',
        expectedKdnPercent: '72.50',
      })
      .expect(409);

    await request(http())
      .post(`/basic-price-imports/prices/${catalog.id}/catalog-kdn`)
      .set(hdr(verifyToken))
      .send({
        kdnPercent: '40.00',
        reason: 'stale',
        expectedKdnPercent: null,
      })
      .expect(409);

    const retry = await request(http())
      .post(`/basic-price-imports/prices/${catalog.id}/catalog-kdn`)
      .set(hdr(verifyToken))
      .send({
        kdnPercent: '72.50',
        reason: 'ulang',
        expectedKdnPercent: null,
      })
      .expect(201);
    expect(retry.body).toMatchObject({ unchanged: true });
    expect(
      await prisma.basicPriceProvenanceCorrection.count({
        where: { basicPriceId: catalog.id },
      }),
    ).toBe(1);

    const foreign = await prisma.basicPrice.create({
      data: {
        assetScope: 'SIMPROK_CATALOG',
        workspaceId: WORKSPACE_B,
        organizationId: '10000000-0000-4000-8000-000000000003',
        resourceId: RESOURCE_ID,
        regionId: REGION_ID,
        effectiveDate: MARCH,
        value: new Prisma.Decimal('88000.00'),
        status: 'PUBLISHED',
        verificationStatus: 'PUBLISHED',
        kdnPercent: null,
      },
    });
    await request(http())
      .post(`/basic-price-imports/prices/${foreign.id}/catalog-kdn`)
      .set(hdr(verifyToken, WORKSPACE_A))
      .send({
        kdnPercent: '72.50',
        reason: 'foreign',
        expectedKdnPercent: null,
      })
      .expect(404);
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════
   * OWNER LAW D — ORIGIN KDN = SHARED KDN, ON THE LIVE simprok_e2e DATABASE.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * WHY THESE EXIST. Every KDN law above is proved against a catalog row with
   * no promotion lineage, and `bpcat01b` proves promotion with no KDN. The two
   * had never met, so the one invariant that spans BOTH rows had never been
   * observed in PostgreSQL — only in unit tests over an in-memory store.
   *
   * Nothing new is built here. The lineage comes from the SAME governed
   * `promoteToSharedCatalog` bpcat01b drives, the enrichment from the SAME
   * `/catalog-kdn` route the tests above drive, and every assertion reads the
   * rows BACK OUT of the database rather than trusting a response body.
   */
  const makePromotedLineage = async (kdn?: {
    origin: string | null;
    descendant: string | null;
  }) => {
    const origin = await prisma.basicPrice.create({
      data: {
        assetScope: 'SIMPROK_CATALOG',
        workspaceId: WORKSPACE_A,
        organizationId: ORG_A,
        resourceId: RESOURCE_ID,
        regionId: REGION_ID,
        effectiveDate: MARCH,
        value: new Prisma.Decimal('99000.00'),
        status: 'PUBLISHED',
        verificationStatus: 'PUBLISHED',
        kdnPercent: null,
        kdnEstablishment: null,
      },
    });

    // THE EXISTING PROMOTION FLOW. Not a hand-written descendant: the lineage
    // pointer must be the one production writes, or this proves nothing.
    const promoted = await promotionService.promoteToSharedCatalog({
      workspaceId: WORKSPACE_A,
      basicPriceId: origin.id,
      actorAccountId: publisherAccountId,
    });
    const descendantId = promoted.shared.id;

    // Only AFTER promotion, and only when a case needs a pre-existing state:
    // promotion copies KDN verbatim, so seeding before it would not produce a
    // divergence at all.
    if (kdn) {
      await prisma.basicPrice.update({
        where: { id: origin.id },
        data: {
          kdnPercent:
            kdn.origin === null ? null : new Prisma.Decimal(kdn.origin),
          kdnEstablishment: kdn.origin === null ? null : 'MANUAL_ENRICHMENT',
        },
      });
      await prisma.basicPrice.update({
        where: { id: descendantId },
        data: {
          kdnPercent:
            kdn.descendant === null ? null : new Prisma.Decimal(kdn.descendant),
          kdnEstablishment:
            kdn.descendant === null ? null : 'MANUAL_ENRICHMENT',
        },
      });
    }

    return { originId: origin.id, descendantId };
  };

  /** Exact scale-2 text, or null. Never a float, never `0` for absent. */
  const kdn2 = (value: Prisma.Decimal | null): string | null =>
    value === null ? null : value.toFixed(2);

  /** Reads the pair straight out of PostgreSQL. Never a mutation result. */
  const readPair = async (originId: string, descendantId: string) => {
    const [origin, descendant] = await Promise.all([
      prisma.basicPrice.findUniqueOrThrow({ where: { id: originId } }),
      prisma.basicPrice.findUniqueOrThrow({ where: { id: descendantId } }),
    ]);
    const immutable = (row: typeof origin) => ({
      value: row.value.toFixed(2),
      status: row.status,
      verificationStatus: row.verificationStatus,
      assetScope: row.assetScope,
      workspaceId: row.workspaceId,
      organizationId: row.organizationId,
      resourceId: row.resourceId,
      regionId: row.regionId,
      effectiveDate: row.effectiveDate.toISOString(),
      validUntil: row.validUntil?.toISOString() ?? null,
      sourceType: row.sourceType,
      sourceOrigin: row.sourceOrigin,
      freshnessStatus: row.freshnessStatus,
      promotedFromBasicPriceId: row.promotedFromBasicPriceId,
      supersedesBasicPriceId: row.supersedesBasicPriceId,
    });
    return {
      originKdn: kdn2(origin.kdnPercent),
      descendantKdn: kdn2(descendant.kdnPercent),
      originEstablishment: origin.kdnEstablishment,
      descendantEstablishment: descendant.kdnEstablishment,
      lineage: descendant.promotedFromBasicPriceId,
      immutable: {
        origin: immutable(origin),
        descendant: immutable(descendant),
      },
    };
  };

  it('CAT-KDN-LIN-01..04 — origin fill reaches the promoted copy; money and publication do not move', async () => {
    const { originId, descendantId } = await makePromotedLineage();

    const before = await readPair(originId, descendantId);
    expect(before.lineage).toBe(originId); // the promotion flow really linked them
    expect(before.originKdn).toBeNull();
    expect(before.descendantKdn).toBeNull();

    const response = await request(http())
      .post(`/basic-price-imports/prices/${originId}/catalog-kdn`)
      .set(hdr(verifyToken, WORKSPACE_A))
      .send({
        kdnPercent: '72.50',
        reason: 'kurasi lineage',
        expectedKdnPercent: null,
      })
      .expect(201);
    expect(response.body).toMatchObject({
      basicPriceId: originId,
      kdnPercent: '72.50',
      unchanged: false,
    });

    // CASE 1 + CASE 2 — read BOTH rows back out of PostgreSQL.
    const after = await readPair(originId, descendantId);
    expect(after.originKdn).toBe('72.50');
    expect(after.descendantKdn).toBe('72.50');
    expect(after.descendantKdn).toBe(after.originKdn); // EXACT_MATCH
    expect(after.descendantEstablishment).toBe('MANUAL_ENRICHMENT');

    // CASE 3 — every other persisted fact on BOTH rows is byte-identical.
    expect(after.immutable).toEqual(before.immutable);

    // CASE 4 — one attribution row per row actually changed, no silent write.
    const provenance = await prisma.basicPriceProvenanceCorrection.findMany({
      where: { basicPriceId: { in: [originId, descendantId] } },
      select: { basicPriceId: true, actorAccountId: true, reason: true },
    });
    expect(provenance).toHaveLength(2);
    expect(provenance.map((r) => r.basicPriceId).sort()).toEqual(
      [originId, descendantId].sort(),
    );
    for (const row of provenance) {
      expect(row.reason).toBe('kurasi lineage');
      expect(typeof row.actorAccountId).toBe('string');
    }
  });

  it('CAT-KDN-LIN-05 — the promoted copy is refused as an independent KDN source', async () => {
    const { originId, descendantId } = await makePromotedLineage();
    const before = await readPair(originId, descendantId);

    // publishToken holds BASIC_PRICE_PROMOTE_SHARED, so the shared row is
    // REACHABLE — the refusal below is the lineage law, not a permission 404.
    const refused = await request(http())
      .post(`/basic-price-imports/prices/${descendantId}/catalog-kdn`)
      .set(hdr(publishToken, WORKSPACE_A))
      .send({
        kdnPercent: '65.00',
        reason: 'copy tries to decide',
        expectedKdnPercent: null,
      })
      .expect(409);
    expect(JSON.stringify(refused.body)).toContain(
      'KDN_PROMOTED_COPY_NOT_KDN_AUTHORITY',
    );

    const after = await readPair(originId, descendantId);
    expect(after.originKdn).toBeNull();
    expect(after.descendantKdn).toBeNull();
    expect(
      await prisma.basicPriceProvenanceCorrection.count({
        where: { basicPriceId: { in: [originId, descendantId] } },
      }),
    ).toBe(0);
    expect(after.immutable).toEqual(before.immutable);
  });

  it('CAT-KDN-LIN-06 — a pre-existing divergence is refused, and neither value is chosen', async () => {
    const { originId, descendantId } = await makePromotedLineage({
      origin: '72.50',
      descendant: '65.00',
    });
    const before = await readPair(originId, descendantId);
    expect(before.originKdn).toBe('72.50');
    expect(before.descendantKdn).toBe('65.00');

    const refused = await request(http())
      .post(`/basic-price-imports/prices/${originId}/catalog-kdn`)
      .set(hdr(verifyToken, WORKSPACE_A))
      .send({
        kdnPercent: '72.50',
        reason: 'resolve please',
        expectedKdnPercent: '72.50',
      })
      .expect(409);
    expect(JSON.stringify(refused.body)).toContain('KDN_LINEAGE_DIVERGENT');

    // NEITHER SIDE MOVED. Not A→B, not B→A, not null, not averaged.
    const after = await readPair(originId, descendantId);
    expect(after.originKdn).toBe('72.50');
    expect(after.descendantKdn).toBe('65.00');
    expect(after.immutable).toEqual(before.immutable);
  });

  it('CAT-KDN-LIN-07 — null origin against a stated copy is a disagreement, not a gap to fill', async () => {
    const { originId, descendantId } = await makePromotedLineage({
      origin: null,
      descendant: '65.00',
    });
    const before = await readPair(originId, descendantId);
    expect(before.originKdn).toBeNull();
    expect(before.descendantKdn).toBe('65.00');

    const refused = await request(http())
      .post(`/basic-price-imports/prices/${originId}/catalog-kdn`)
      .set(hdr(verifyToken, WORKSPACE_A))
      .send({
        kdnPercent: '72.50',
        reason: 'fill the null side',
        expectedKdnPercent: null,
      })
      .expect(409);
    expect(JSON.stringify(refused.body)).toContain('KDN_LINEAGE_DIVERGENT');

    const after = await readPair(originId, descendantId);
    expect(after.originKdn).toBeNull();
    expect(after.descendantKdn).toBe('65.00');
    expect(after.immutable).toEqual(before.immutable);
  });

  /**
   * REAL-DB ATOMICITY, using the fault-injection pattern this repository
   * already established for MON-03 (progress-security.e2e-spec.ts test 11):
   * a BEFORE INSERT trigger that RAISEs, dropped in `finally`.
   *
   * The provenance INSERT is the LAST statement in the enrichment transaction,
   * after the origin UPDATE and after the descendant UPDATE. Failing it is
   * therefore the honest way to ask: does PostgreSQL take BOTH updates back?
   */
  it('CAT-KDN-LIN-08 — a failure after propagation rolls BOTH rows back', async () => {
    const { originId, descendantId } = await makePromotedLineage();
    const before = await readPair(originId, descendantId);
    expect(before.originKdn).toBeNull();
    expect(before.descendantKdn).toBeNull();

    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION catkdn_reject_provenance() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'CATKDN_TEST_PROVENANCE_FAILURE';
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER catkdn_reject_provenance
      BEFORE INSERT ON basic_price_provenance_corrections
      FOR EACH ROW EXECUTE FUNCTION catkdn_reject_provenance();
    `);
    try {
      await request(http())
        .post(`/basic-price-imports/prices/${originId}/catalog-kdn`)
        .set(hdr(verifyToken, WORKSPACE_A))
        .send({
          kdnPercent: '72.50',
          reason: 'atomicity',
          expectedKdnPercent: null,
        })
        .expect(500);
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS catkdn_reject_provenance ON basic_price_provenance_corrections',
      );
      await prisma.$executeRawUnsafe(
        'DROP FUNCTION IF EXISTS catkdn_reject_provenance()',
      );
    }

    // NO PARTIAL PERSISTENCE. The origin does not keep the value it briefly
    // held, and the descendant does not keep the one propagated to it.
    const after = await readPair(originId, descendantId);
    expect(after.originKdn).toBeNull();
    expect(after.descendantKdn).toBeNull();
    expect(after.originEstablishment).toBeNull();
    expect(after.descendantEstablishment).toBeNull();
    expect(after.immutable).toEqual(before.immutable);
    expect(
      await prisma.basicPriceProvenanceCorrection.count({
        where: { basicPriceId: { in: [originId, descendantId] } },
      }),
    ).toBe(0);
  });

  it('CAT-KDN-LIN-09 — lineage enrichment never writes ResourceCatalog.tkdnValue', async () => {
    const { originId, descendantId } = await makePromotedLineage();
    await request(http())
      .post(`/basic-price-imports/prices/${originId}/catalog-kdn`)
      .set(hdr(verifyToken, WORKSPACE_A))
      .send({
        kdnPercent: '72.50',
        reason: 'tkdn boundary',
        expectedKdnPercent: null,
      })
      .expect(201);

    const after = await readPair(originId, descendantId);
    expect(after.originKdn).toBe('72.50');
    expect(after.descendantKdn).toBe('72.50');

    // KDN is a BasicPrice observation fact. TKDN is the RAB/Project aggregate
    // and lives on a different table entirely. Filling one may never fill the
    // other, on either half of the lineage.
    const catalog = await prisma.resourceCatalog.findUniqueOrThrow({
      where: { id: RESOURCE_ID },
      select: { tkdnValue: true },
    });
    expect(catalog.tkdnValue).toBeNull();
  });
});
