import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import { HttpException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { BasicPricePromotionService } from '../../src/basic-price/basic-price-promotion.service';

/**
 * BP-CAT-01B/01E — SHARED SIMPROK CATALOG PROMOTION, end to end.
 *
 * What this suite proves:
 *
 *  1. AUTHORITY — AUTH-C. There is NO production promotion route at all, and
 *     these tests pin its absence for every actor, including one holding
 *     BASIC_PRICE_PROMOTE_SHARED. Lifting a tenant's fact into shared SIMPROK
 *     knowledge is a platform decision, and SIMPROK has no production-real
 *     platform authority primitive to express it yet. A 403 would have claimed
 *     a doorkeeper exists; 404 is the honest answer. The DOMAIN below is
 *     therefore exercised through the governed service directly.
 *  2. PRECONDITIONS. Only a SIMPROK_CATALOG price that has already finished
 *     the two-human ladder on BOTH axes can be admitted. Private, unpublished,
 *     verified-but-unpublished and half-published rows all fail closed.
 *  3. THE ORIGIN IS NEVER MOVED. Promotion creates a distinct shared artifact;
 *     the originating workspace row is byte-identical afterwards.
 *  4. MONEY IS NEVER TOUCHED. The shared price is the origin's price, exactly.
 *  5. IDEMPOTENCY IS A DATABASE FACT. A repeat promotion returns the same
 *     shared row, and concurrent identical promotions produce exactly one.
 *  6. REACH. A second tenant genuinely obtains the shared price through the
 *     ordinary product route and the one canonical eligibility law — while the
 *     first tenant's private and workspace-owned rows stay invisible to it.
 *
 * Runs against simprok_e2e only. Every fixture row is deleted in afterAll.
 * TEST_ONLY_SYNTHETIC_FIXTURE=YES  PRODUCTION_TRUTH=NO
 */
describe('BP-CAT-01B shared SIMPROK catalog promotion (e2e)', () => {
  const prisma = new PrismaClient();
  const tag = `BPCAT01B${Date.now()}`;
  const password = 'BpCat01bShared!';
  const labels = 'TEST_FIXTURE_ONLY OWNER_SUPPLIED_EXAMPLE_NON_PRODUCTION';

  let app: INestApplication;

  let orgAId: string;
  let workspaceAId: string;
  let orgBId: string;
  let workspaceBId: string;

  let promotionService: BasicPricePromotionService;
  let promoterAccountId: string;
  let foreignPromoterAccountId: string;

  let promoterToken: string;
  let ordinaryToken: string;
  let submitterToken: string;
  let verifierToken: string;
  let publisherToken: string;
  let consumerBToken: string;

  let regionId: string;
  let sharedResourceId: string;
  let privateResourceId: string;

  let originId: string;
  let batchId: string;

  const createdPermissionIds: string[] = [];
  const accountIds: string[] = [];
  const membershipIds: string[] = [];
  const roleIds: string[] = [];

  /**
   * THE HTTP SERVER, NAMED FOR WHAT IT IS. `app.getHttpServer()` is typed `any`,
   * and handing an `any` straight to supertest silently disables every type the
   * rest of this file relies on.
   */
  const server = (): Server => app.getHttpServer() as Server;

  const login = async (email: string) => {
    const response = await request(server())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    return (response.body as { access_token: string }).access_token;
  };

  const ensurePermission = async (code: string) => {
    const existing = await prisma.permission.findUnique({ where: { code } });
    if (existing) return existing;
    const created = await prisma.permission.create({
      data: { code, name: `${tag} ${code}`, description: labels },
    });
    createdPermissionIds.push(created.id);
    return created;
  };

  const createActor = async (params: {
    suffix: string;
    workspaceId: string;
    permissionCodes?: string[];
  }) => {
    const codes = params.permissionCodes ?? [];
    const permissions = await Promise.all(codes.map(ensurePermission));
    let roleCreate = {};
    if (codes.length) {
      const role = await prisma.role.create({
        data: {
          workspaceId: params.workspaceId,
          code: `${tag}_${params.suffix.toUpperCase()}`,
          name: `${tag} ${params.suffix}`,
          rolePermissions: {
            create: permissions.map((p) => ({ permissionId: p.id })),
          },
        },
      });
      roleIds.push(role.id);
      roleCreate = {
        membershipRoles: { create: [{ roleId: role.id, isActive: true }] },
      };
    }

    const email = `${tag}.${params.suffix}@test.local`.toLowerCase();
    const account = await prisma.account.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 10),
        displayName: params.suffix,
        status: 'ACTIVE',
      },
    });
    accountIds.push(account.id);
    const membership = await prisma.workspaceMembership.create({
      data: {
        accountId: account.id,
        workspaceId: params.workspaceId,
        status: 'ACTIVE',
        ...roleCreate,
      },
    });
    membershipIds.push(membership.id);
    await prisma.user.create({
      data: {
        workspaceMembershipId: membership.id,
        workspaceId: params.workspaceId,
        fullName: params.suffix,
        status: 'ACTIVE',
      },
    });
    return { accountId: account.id, email };
  };

  /** A published, lawful workspace CATALOG price — the only promotable shape. */
  const createCatalogPrice = async (overrides: Record<string, unknown> = {}) =>
    prisma.basicPrice.create({
      data: {
        resourceId: sharedResourceId,
        workspaceId: workspaceAId,
        organizationId: orgAId,
        regionId,
        effectiveDate: new Date('2026-08-01T00:00:00.000Z'),
        sourcePeriodLabel: 'TA 2026',
        sourcePeriodGranularity: 'YEAR',
        effectiveDateProvenance: 'DERIVED_FROM_SOURCE_PERIOD',
        effectiveDateDerivationRule: 'FIRST_DAY_OF_FISCAL_YEAR',
        value: '78000.00',
        sourceType: 'REGULATION',
        sourceOrigin: 'GOVERNMENT',
        freshnessStatus: 'CURRENT',
        validUntil: new Date('2027-08-01T00:00:00.000Z'),
        assetScope: 'SIMPROK_CATALOG',
        status: 'PUBLISHED',
        verificationStatus: 'PUBLISHED',
        ...overrides,
      },
    });

  /**
   * BP-CAT-01E — PROMOTION IS EXERCISED AS A DOMAIN ACT, NOT OVER HTTP.
   *
   * There is deliberately no production route (AUTH-C: no lawful platform
   * authority exists yet to guard one), so these proofs call the governed
   * service the way a future authorized route would. The status mapping below
   * is the SAME translation Nest's exception layer performs, so the refusals
   * asserted here are the refusals a caller would receive the day the Owner
   * settles the authority primitive and one route is wired.
   */
  const promote = async (
    actorAccountId: string,
    workspaceId: string,
    basicPriceId: string,
  ): Promise<{ status: number; body: unknown }> => {
    try {
      const result = await promotionService.promoteToSharedCatalog({
        workspaceId,
        basicPriceId,
        actorAccountId,
      });
      return { status: 201, body: result };
    } catch (error) {
      if (error instanceof HttpException) {
        return { status: error.getStatus(), body: error.getResponse() };
      }
      throw error;
    }
  };

  /**
   * The two response shapes this suite reads, named once. A supertest body is
   * `any`, and asserting straight through it would let a renamed field pass
   * silently as `undefined === undefined` — which is exactly the class of
   * false green these tests exist to avoid.
   */
  interface PromotionBody {
    created: boolean;
    shared: { id: string };
  }
  const promotionOf = (response: { body: unknown }) =>
    response.body as PromotionBody;
  const errorOf = (response: { body: unknown }) =>
    (response.body as { message?: string }).message;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const orgA = await prisma.organization.create({
      data: { name: `${tag} Org A`, type: 'COMPANY' },
    });
    const orgB = await prisma.organization.create({
      data: { name: `${tag} Org B`, type: 'COMPANY' },
    });
    orgAId = orgA.id;
    orgBId = orgB.id;
    workspaceAId = (
      await prisma.workspace.create({
        data: { name: `${tag} WS A`, organizationId: orgA.id },
      })
    ).id;
    workspaceBId = (
      await prisma.workspace.create({
        data: { name: `${tag} WS B`, organizationId: orgB.id },
      })
    ).id;

    regionId = (
      await prisma.region.create({
        data: { code: `${tag}-REG`, name: `${tag} Region`, isActive: true },
      })
    ).id;

    // GLOBAL reference resource, so Workspace B's reach test proves the price
    // boundary rather than tripping over a resource it could never see.
    sharedResourceId = (
      await prisma.resourceCatalog.create({
        data: {
          workspaceId: null,
          code: `${tag}-RES`,
          name: `${tag} Semen Portland`,
          type: 'MATERIAL',
          baseUnit: 'KG',
        },
      })
    ).id;
    privateResourceId = (
      await prisma.resourceCatalog.create({
        data: {
          workspaceId: workspaceAId,
          code: `${tag}-RESPRIV`,
          name: `${tag} Bahan Privat`,
          type: 'MATERIAL',
          baseUnit: 'KG',
        },
      })
    ).id;

    const promoter = await createActor({
      suffix: 'promoter',
      workspaceId: workspaceAId,
      permissionCodes: ['BASIC_PRICE_PROMOTE_SHARED'],
    });
    // No extra codes at all: proves the baseline alone never reaches promotion.
    const ordinary = await createActor({
      suffix: 'ordinary',
      workspaceId: workspaceAId,
    });
    const submitter = await createActor({
      suffix: 'submitter',
      workspaceId: workspaceAId,
      permissionCodes: ['BASIC_PRICE_SUBMIT'],
    });
    const verifier = await createActor({
      suffix: 'verifier',
      workspaceId: workspaceAId,
      permissionCodes: ['BASIC_PRICE_REVIEW_VIEW', 'BASIC_PRICE_VERIFY'],
    });
    const publisher = await createActor({
      suffix: 'publisher',
      workspaceId: workspaceAId,
      permissionCodes: ['BASIC_PRICE_PUBLISH'],
    });
    // Fully authorized to promote WHERE THEY LIVE, which is Workspace B. The
    // point is that this changes nothing about Workspace A's rows.
    const foreignPromoter = await createActor({
      suffix: 'foreignpromoter',
      workspaceId: workspaceBId,
      permissionCodes: ['BASIC_PRICE_PROMOTE_SHARED'],
    });
    const consumerB = await createActor({
      suffix: 'consumerb',
      workspaceId: workspaceBId,
    });

    promotionService = app.get(BasicPricePromotionService);
    promoterAccountId = promoter.accountId;
    foreignPromoterAccountId = foreignPromoter.accountId;

    promoterToken = await login(promoter.email);
    ordinaryToken = await login(ordinary.email);
    submitterToken = await login(submitter.email);
    verifierToken = await login(verifier.email);
    publisherToken = await login(publisher.email);
    consumerBToken = await login(consumerB.email);

    originId = (await createCatalogPrice()).id;

    // A WORKSPACE_PRIVATE price needs real import-row evidence to exist at all
    // (basic_prices_private_requires_import_row_provenance_check), so the
    // "private cannot be promoted" proof gets a genuine private row.
    batchId = (
      await prisma.basicPriceImportBatch.create({
        data: {
          workspaceId: workspaceAId,
          organizationId: orgAId,
          uploadedByAccountId: promoter.accountId,
          sourceFileName: `${tag}-harga.xlsx`,
          sourceSha256: 'd'.repeat(64),
          sourceByteLength: 2048,
          selectedSheetName: 'HARGA',
          parserContractVersion: 'RM02B-XLSX-V1',
          regionId,
          effectiveDate: new Date('2026-08-01T00:00:00.000Z'),
          sourceType: 'VENDOR_QUOTE',
          sourceOrigin: 'STORE',
          sourceVendorName: `${tag} Toko`,
          importFingerprint: `${tag}-fp`,
          status: 'READY_FOR_REVIEW',
        },
      })
    ).id;
  });

  afterAll(async () => {
    // PROMOTED ROWS FIRST. The lineage FK is ON DELETE RESTRICT — deleting an
    // origin while its shared result still stands is refused, which is the
    // whole point of the constraint and therefore also the teardown order.
    await prisma.basicPrice.deleteMany({
      where: {
        promotedFromBasicPriceId: { not: null },
        // Scoped to this suite's own resources: a promoted row inherits its
        // origin's resourceId, so the tag reaches every row this file made and
        // nothing anyone else made.
        resource: { code: { startsWith: tag } },
      },
    });
    await prisma.basicPrice.deleteMany({
      where: { resource: { code: { startsWith: tag } } },
    });
    await prisma.basicPriceImportRow.deleteMany({ where: { batchId } });
    await prisma.basicPriceImportBatch.deleteMany({ where: { id: batchId } });
    await prisma.resourceCatalog.deleteMany({
      where: { code: { startsWith: tag } },
    });
    // By tag, not by the one id: the one-truth tests own a second region, and a
    // cleanup that names only what beforeAll made would leave it behind.
    await prisma.region.deleteMany({ where: { code: { startsWith: tag } } });
    await prisma.membershipRole.deleteMany({
      where: { workspaceMembershipId: { in: membershipIds } },
    });
    await prisma.rolePermission.deleteMany({
      where: { roleId: { in: roleIds } },
    });
    await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
    await prisma.user.deleteMany({
      where: { workspaceMembershipId: { in: membershipIds } },
    });
    await prisma.workspaceMembership.deleteMany({
      where: { id: { in: membershipIds } },
    });
    await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.workspace.deleteMany({
      where: { id: { in: [workspaceAId, workspaceBId] } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [orgAId, orgBId] } },
    });
    if (createdPermissionIds.length > 0) {
      await prisma.permission.deleteMany({
        where: { id: { in: createdPermissionIds } },
      });
    }
    await prisma.$disconnect();
    await app.close();
  });

  // ── AUTHORITY ────────────────────────────────────────────────────────────

  /**
   * BP-CAT-01E AUTH-C. The census proved SIMPROK has no production-real platform
   * authority: the Authority / PositionAuthority chain is inert, and a
   * workspace-scoped permission is the wrong shape for an act that hands one
   * tenant's fact to every other tenant. So the route is GONE, not merely
   * guarded — and these tests pin its absence rather than a 403 that would
   * imply a doorkeeper exists.
   */
  it('AUTH-C-01: there is NO production promotion route — not for an ordinary member, and not for a holder of the promotion permission itself', async () => {
    for (const [who, bearer] of [
      ['ordinary ACTIVE member', ordinaryToken],
      ['submitter', submitterToken],
      ['verifier', verifierToken],
      ['workspace publisher', publisherToken],
      // THE ONE THAT MATTERS. Even the actor holding BASIC_PRICE_PROMOTE_SHARED
      // gets 404, because the endpoint does not exist. A 403 here would be a
      // lie: it would say "you lack authority" when the truth is "no lawful
      // authority has been decided yet".
      ['holder of BASIC_PRICE_PROMOTE_SHARED', promoterToken],
    ] as const) {
      const response = await request(server())
        .post(`/basic-price-publications/${originId}/promote-shared`)
        .set('Authorization', `Bearer ${bearer}`)
        .set('x-workspace-id', workspaceAId)
        .send({});
      expect([response.status, who]).toEqual([404, who]);
    }

    // Nothing was promoted by any of them, and the origin is untouched.
    const untouched = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: originId },
    });
    expect(untouched.workspaceId).toBe(workspaceAId);
    expect(
      await prisma.basicPrice.count({
        where: { promotedFromBasicPriceId: originId },
      }),
    ).toBe(0);
  });

  it('AUTH-C-02/05/06: no workspace permission creates promotion authority, no UI exposes it, and ordinary publication is unaffected', async () => {
    // AUTH-C-02 — the sibling route on the SAME controller still works for the
    // publisher, so the 404 above is the absence of one endpoint rather than a
    // broken controller.
    const queue = await request(server())
      .get('/basic-price-publications')
      .set('Authorization', `Bearer ${publisherToken}`)
      .set('x-workspace-id', workspaceAId);
    expect(queue.status).toBe(200);

    // AUTH-C-04/05 — no production source names promotion in a route or a
    // screen. Read from the built controller itself rather than asserted from
    // memory.
    const controller = readFileSync(
      resolve(
        __dirname,
        '../../src/basic-price/basic-price-publication.controller.ts',
      ),
      'utf8',
    );
    expect(controller).not.toContain('promote-shared');
    expect(controller).not.toContain('BASIC_PRICE_PROMOTE_SHARED');
  });

  it('SEC-05: a fully authorized promoter in ANOTHER workspace cannot promote this tenant’s price, and learns nothing about it', async () => {
    const response = await promote(
      foreignPromoterAccountId,
      workspaceBId,
      originId,
    );
    // 404, never 403: a foreign id must be indistinguishable from a missing one.
    expect(response.status).toBe(404);
    expect(
      await prisma.basicPrice.count({
        where: { promotedFromBasicPriceId: originId },
      }),
    ).toBe(0);
  });

  // ── PRECONDITIONS ────────────────────────────────────────────────────────

  it('SEC-06: a WORKSPACE_PRIVATE price can never be promoted', async () => {
    const row = await prisma.basicPriceImportRow.create({
      data: {
        batchId,
        sourceSection: 'MATERIAL',
        sourceSectionProvenance: 'SOURCE_SECTION_TITLE',
        sourceRowNumber: 4,
        sourceCodeCellAddress: 'D4',
        sourceNameCellAddress: 'C4',
        sourceUnitCellAddress: 'E4',
        sourcePriceCellAddress: 'F4',
        rawResourceCodeText: 'M.01',
        rawResourceNameText: `${tag} Bahan Privat`,
        rawUnitText: 'Kg',
        rawPriceCellType: 2,
        rawPriceNumericRoundTripString: '55000',
        proposedCanonicalPrice: '55000.00',
        canonicalRoundingMode: 'EXACT',
        resourceCatalogId: privateResourceId,
        resolvedResourceType: 'MATERIAL',
        resolutionStatus: 'RESOLVED',
        reasonCodes: ['TEST_FIXTURE_ONLY'],
        status: 'READY_FOR_SUBMISSION',
      },
    });
    const privatePrice = await prisma.basicPrice.create({
      data: {
        resourceId: privateResourceId,
        workspaceId: workspaceAId,
        organizationId: orgAId,
        regionId,
        effectiveDate: new Date('2026-08-01T00:00:00.000Z'),
        value: '55000.00',
        sourceType: 'VENDOR_QUOTE',
        sourceOrigin: 'STORE',
        assetScope: 'WORKSPACE_PRIVATE',
        sourceImportRowId: row.id,
      },
    });

    const response = await promote(
      promoterAccountId,
      workspaceAId,
      privatePrice.id,
    );
    expect(response.status).toBe(409);
    expect(errorOf(response)).toBe('PRIVATE_BASIC_PRICE_NOT_PROMOTABLE');
  });

  it('SEC-07/08/09: only a price PUBLISHED on BOTH axes is promotable — unpublished, verified-only and half-published all fail closed', async () => {
    const cases = [
      { status: 'UNPUBLISHED', verificationStatus: 'UNVERIFIED' },
      { status: 'UNPUBLISHED', verificationStatus: 'VERIFIED' },
      // Two-axis drift. Never silently completed by a promotion.
      { status: 'PUBLISHED', verificationStatus: 'VERIFIED' },
      { status: 'UNPUBLISHED', verificationStatus: 'PUBLISHED' },
    ] as const;

    for (const state of cases) {
      const row = await createCatalogPrice(state);
      const response = await promote(promoterAccountId, workspaceAId, row.id);
      expect([response.status, state]).toEqual([409, state]);
      expect(errorOf(response)).toBe('BASIC_PRICE_NOT_PUBLISHED');
      expect(
        await prisma.basicPrice.count({
          where: { promotedFromBasicPriceId: row.id },
        }),
      ).toBe(0);
    }
  });

  // ── THE LAWFUL ACT ───────────────────────────────────────────────────────

  it('SEC-10/11/12 + PROV-01..08: an authorized promoter creates one shared row that restates the origin exactly and leaves the origin untouched', async () => {
    const before = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: originId },
    });

    const response = await promote(promoterAccountId, workspaceAId, originId);
    expect(response.status).toBe(201);
    expect(promotionOf(response).created).toBe(true);

    const shared = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: promotionOf(response).shared.id },
    });

    // SEC-12 — shared scope, both ownership columns cleared.
    expect(shared.workspaceId).toBeNull();
    expect(shared.organizationId).toBeNull();
    expect(shared.assetScope).toBe('SIMPROK_CATALOG');
    expect(shared.status).toBe('PUBLISHED');
    expect(shared.verificationStatus).toBe('PUBLISHED');

    // PROV-01 — the lineage names the exact origin.
    expect(shared.promotedFromBasicPriceId).toBe(originId);
    // PROV-03 — MONEY IS NEVER TOUCHED. Compared as an exact decimal string,
    // so a silent 78000.00 -> 80000.00 or a re-rounding cannot pass.
    expect(shared.value.toFixed(2)).toBe('78000.00');
    expect(shared.value.toFixed(2)).toBe(before.value.toFixed(2));
    // PROV-04/05/06 — source facts restated, never invented.
    expect(shared.resourceId).toBe(before.resourceId);
    expect(shared.regionId).toBe(before.regionId);
    expect(shared.effectiveDate).toEqual(before.effectiveDate);
    expect(shared.sourcePeriodLabel).toBe('TA 2026');
    expect(shared.sourcePeriodGranularity).toBe('YEAR');
    expect(shared.effectiveDateProvenance).toBe('DERIVED_FROM_SOURCE_PERIOD');
    expect(shared.effectiveDateDerivationRule).toBe('FIRST_DAY_OF_FISCAL_YEAR');
    expect(shared.sourceType).toBe(before.sourceType);
    expect(shared.sourceOrigin).toBe(before.sourceOrigin);
    expect(shared.validUntil).toEqual(before.validUntil);
    // PROV-07/08 — the origin keeps its own provenance channels; the shared row
    // never borrows a UNIQUE relation or a private-only link.
    expect(shared.sourceSubmissionId).toBeNull();
    expect(shared.sourceImportRowId).toBeNull();

    // SEC-11 — THE ORIGIN IS BYTE-IDENTICAL. Compared as a whole object so a
    // future writer that quietly touches any column is caught here.
    const after = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: originId },
    });
    expect(after).toEqual(before);

    // PROV-02 — the reverse read answers "was this already promoted, and to what".
    const originWithLineage = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: originId },
      include: { promotedTo: true },
    });
    expect(originWithLineage.promotedTo?.id).toBe(shared.id);
  });

  it('BP-AUDIT: the act is recorded as PROMOTE_SHARED, naming actor and origin, and is never mistaken for a publication', async () => {
    const shared = await prisma.basicPrice.findFirstOrThrow({
      where: { promotedFromBasicPriceId: originId },
    });
    const audits = await prisma.basicPricePublicationAudit.findMany({
      where: { basicPriceId: shared.id },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe('PROMOTE_SHARED');
    expect(audits[0].reason).toContain(originId);
    expect(audits[0].actorAccountId).toBeTruthy();
    // The Cost Kernel's publisher-evidence lookup filters on action='PUBLISH'.
    // A promotion must never answer it.
    expect(
      await prisma.basicPricePublicationAudit.count({
        where: { basicPriceId: shared.id, action: 'PUBLISH' },
      }),
    ).toBe(0);
  });

  // ── IDEMPOTENCY ──────────────────────────────────────────────────────────

  it('SEC-15: promoting the same origin again returns the SAME shared row and creates no duplicate', async () => {
    const first = await prisma.basicPrice.findFirstOrThrow({
      where: { promotedFromBasicPriceId: originId },
    });

    const repeat = await promote(promoterAccountId, workspaceAId, originId);
    expect(repeat.status).toBe(201);
    expect(promotionOf(repeat).created).toBe(false);
    expect(promotionOf(repeat).shared.id).toBe(first.id);

    expect(
      await prisma.basicPrice.count({
        where: { promotedFromBasicPriceId: originId },
      }),
    ).toBe(1);
  });

  it('SEC-16: CONCURRENT identical promotions persist exactly one shared row and both resolve to it', async () => {
    const origin = await createCatalogPrice({ value: '91500.00' });

    const [a, b] = await Promise.all([
      promote(promoterAccountId, workspaceAId, origin.id),
      promote(promoterAccountId, workspaceAId, origin.id),
    ]);

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    // One winner, one bounded re-read of that winner — never two rows, never a
    // retry loop, and never a 500 leaking the raw constraint violation.
    expect(promotionOf(a).shared.id).toBe(promotionOf(b).shared.id);
    expect(
      [promotionOf(a).created, promotionOf(b).created].filter(Boolean),
    ).toHaveLength(1);
    expect(
      await prisma.basicPrice.count({
        where: { promotedFromBasicPriceId: origin.id },
      }),
    ).toBe(1);
  });

  // ── REACH AND ISOLATION ──────────────────────────────────────────────────

  it('SEC-13/14: a SECOND tenant reaches the shared price through the ordinary product route, while this tenant’s own rows stay invisible to it', async () => {
    const shared = await prisma.basicPrice.findFirstOrThrow({
      where: { promotedFromBasicPriceId: originId },
    });

    const response = await request(server())
      .get(`/basic-prices/by-resource/${sharedResourceId}`)
      .set('Authorization', `Bearer ${consumerBToken}`)
      .set('x-workspace-id', workspaceBId)
      .expect(200);

    const ids = (response.body as Array<{ id: string }>).map((r) => r.id);
    // SEC-13 — the shared row genuinely arrives, through the one canonical
    // eligibility law and no second predicate.
    expect(ids).toContain(shared.id);
    // SEC-14 — and Workspace A's own catalog row, published though it is,
    // does not. Publication reaches one workspace; promotion is what reaches
    // everyone, and the difference is visible right here.
    expect(ids).not.toContain(originId);
  });

  /**
   * BP-CAT-01D SEAM 4 — RICH INSIDE, SAFE OUTSIDE.
   *
   * Promotion copies truthful source facts onto the shared row, and it should:
   * the price, the region, the dates and the source descriptors are what make a
   * catalog entry usable. But some of what it copies are TENANT-PRIVATE
   * IDENTIFIERS — the origin workspace's reporting account, its submission and
   * import-row ids, and the lineage pointing at a BasicPrice the other tenant
   * may not read. Those must stay in persistence and out of the response.
   */
  it('PRIV-03/04/05: the shared row reaches the other tenant WITHOUT any tenant-private identifier', async () => {
    const shared = await prisma.basicPrice.findFirstOrThrow({
      where: { promotedFromBasicPriceId: originId },
    });

    const response = await request(server())
      .get(`/basic-prices/by-resource/${sharedResourceId}`)
      .set('Authorization', `Bearer ${consumerBToken}`)
      .set('x-workspace-id', workspaceBId)
      .expect(200);

    const row = (response.body as Array<Record<string, unknown>>).find(
      (r) => r.id === shared.id,
    );
    expect(row).toBeDefined();

    // The private governance identifiers, none of which Workspace B may hold.
    for (const leaked of [
      'reportedByAccountId',
      'sourceSubmissionId',
      'sourceImportRowId',
      // The origin's id is itself tenant-private: it names a row in Workspace A
      // that Workspace B is not allowed to read.
      'promotedFromBasicPriceId',
    ]) {
      expect(row).not.toHaveProperty(leaked);
    }
    // And nothing anywhere in the payload may carry the origin's id as a value.
    expect(JSON.stringify(response.body)).not.toContain(originId);

    // PRIV-07 — the lawful catalog facts DO survive. Stripping is not the goal;
    // a price nobody can evaluate is useless.
    expect(row).toHaveProperty('value');
    expect(row).toHaveProperty('effectiveDate');
    expect(row).toHaveProperty('sourceType');
    expect(row).toHaveProperty('sourceOrigin');
    expect(row).toHaveProperty('regionId');
  });

  it('PRIV-08/09: the source workspace keeps its own normal view, and persistence keeps every fact', async () => {
    // PRIV-08 — Workspace A's own rows are not degraded by the shared-response
    // repair; it still receives the catalog facts it always did.
    const response = await request(server())
      .get(`/basic-prices/by-resource/${sharedResourceId}`)
      .set('Authorization', `Bearer ${promoterToken}`)
      .set('x-workspace-id', workspaceAId)
      .expect(200);
    const rows = response.body as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty('value');

    // PRIV-09 — nothing was deleted. The governance facts are still in the
    // database, where the Cost Kernel and the internal trail still need them.
    const persisted = await prisma.basicPrice.findFirstOrThrow({
      where: { promotedFromBasicPriceId: originId },
    });
    expect(persisted.promotedFromBasicPriceId).toBe(originId);
  });

  it('SEC-14b: the tenant-private origin never leaks to the second tenant', async () => {
    const response = await request(server())
      .get(`/basic-prices/by-resource/${privateResourceId}`)
      .set('Authorization', `Bearer ${consumerBToken}`)
      .set('x-workspace-id', workspaceBId)
      .expect(200);
    expect(response.body).toHaveLength(0);
  });

  // ── HISTORY ──────────────────────────────────────────────────────────────

  it('PROV-09/10: legacy rows carry no lineage, and an origin holding up shared truth cannot be deleted', async () => {
    // PROV-09 — a row that was not produced by promotion says so honestly.
    const ordinaryRow = await createCatalogPrice({ value: '12345.00' });
    expect(ordinaryRow.promotedFromBasicPriceId).toBeNull();

    // PROV-10 — RESTRICT, so national truth can never be left without an origin.
    await expect(
      prisma.basicPrice.delete({ where: { id: originId } }),
    ).rejects.toThrow();
    await prisma.basicPrice.findUniqueOrThrow({ where: { id: originId } });
  });

  it('BP-CAT-01D §19: the database refuses an unpublished promoted row on BOTH axes', async () => {
    const shared = await prisma.basicPrice.findFirstOrThrow({
      where: { promotedFromBasicPriceId: originId },
    });

    // A shared descendant is a restatement of settled PUBLISHED truth. Neither
    // axis may drift, and it is the DATABASE that says so — not a convention a
    // future writer could forget.
    for (const drift of [
      { status: 'UNPUBLISHED' },
      { verificationStatus: 'VERIFIED' as const },
    ]) {
      await expect(
        prisma.basicPrice.update({ where: { id: shared.id }, data: drift }),
      ).rejects.toThrow();
    }

    // Untouched by the refusals.
    const after = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: shared.id },
    });
    expect(after.status).toBe('PUBLISHED');
    expect(after.verificationStatus).toBe('PUBLISHED');
  });

  // ── REAL COST KERNEL CONSUMPTION ─────────────────────────────────────────

  /**
   * BP-CAT-01D SEAM 3. Explorer visibility is not usability. This drives the
   * ACTUAL production chain — canonical eligibility, the persisted resolution,
   * and RabKernelPersistenceService over real HTTP — so a shared price that
   * looks selectable is proved to be spendable.
   *
   * The origin is given its GENUINE publication chain (submission -> review ->
   * one ACCEPT decision -> a PUBLISH audit by a different human), because that
   * chain is exactly what the promoted row has to borrow. Nothing here calls a
   * private helper; if the delegation were broken the persist call would 409.
   */
  describe('a promoted shared price is spendable in another tenant', () => {
    let ckResourceId: string;
    let ckOriginId: string;
    let ckSharedId: string;
    let ckProjectId: string;
    let ckItemId: string;
    let ckStructureId: string;
    let ckOccurrenceId: string;
    let ckAhspId: string;
    let ckToken: string;
    let ckSubmissionId: string;

    const persist = (itemId: string) =>
      request(server())
        .post(
          `/projects/${ckProjectId}/boq/items/${itemId}/cost-calculation/persist`,
        )
        .set('Authorization', `Bearer ${ckToken}`)
        .set('x-workspace-id', workspaceBId)
        .send({ calculationAsOfDate: '2026-08-10' });

    beforeAll(async () => {
      ckResourceId = (
        await prisma.resourceCatalog.create({
          data: {
            workspaceId: null,
            code: `${tag}-CKRES`,
            name: `${tag} Cost Kernel Material`,
            type: 'MATERIAL',
            baseUnit: 'Kg',
          },
        })
      ).id;

      // THE ORIGIN'S REAL PUBLICATION CHAIN, in Workspace A.
      const verifierAccount = await prisma.account.findUniqueOrThrow({
        where: { email: `${tag}.verifier@test.local`.toLowerCase() },
      });
      const publisherAccount = await prisma.account.findUniqueOrThrow({
        where: { email: `${tag}.publisher@test.local`.toLowerCase() },
      });
      const verifierUser = await prisma.user.findFirstOrThrow({
        where: {
          workspaceId: workspaceAId,
          membership: { accountId: verifierAccount.id },
        },
      });

      ckSubmissionId = (
        await prisma.priceSubmission.create({
          data: {
            workspaceId: workspaceAId,
            organizationId: orgAId,
            resourceId: ckResourceId,
            regionId,
            sourceOrigin: 'GOVERNMENT',
            sourceType: 'REGULATION',
            status: 'VERIFIED',
          },
        })
      ).id;
      const review = await prisma.priceSubmissionReview.create({
        data: {
          priceSubmissionId: ckSubmissionId,
          workspaceId: workspaceAId,
          organizationId: orgAId,
        },
      });
      await prisma.priceSubmissionReviewDecision.create({
        data: {
          reviewId: review.id,
          decidedByUserId: verifierUser.id,
          action: 'ACCEPT',
        },
      });

      ckOriginId = (
        await createCatalogPrice({
          resourceId: ckResourceId,
          value: '5000.00',
          sourceSubmissionId: ckSubmissionId,
        })
      ).id;
      // The publisher is a DIFFERENT human than the verifier — the two-human
      // ladder the Cost Kernel re-proves at consumption time.
      await prisma.basicPricePublicationAudit.create({
        data: {
          basicPriceId: ckOriginId,
          action: 'PUBLISH',
          actorAccountId: publisherAccount.id,
          reason: 'BP-CAT-01D fixture publication',
        },
      });

      const promoteResponse = await promote(
        promoterAccountId,
        workspaceAId,
        ckOriginId,
      );
      expect(promoteResponse.status).toBe(201);
      ckSharedId = promotionOf(promoteResponse).shared.id;

      // WORKSPACE B: a real project, a real assignment, a real Working Draft.
      ckProjectId = (
        await prisma.project.create({
          data: {
            workspaceId: workspaceBId,
            organizationId: orgBId,
            code: `${tag}-CKP`,
            name: `${tag} Cost Kernel Project`,
            status: 'PLANNED',
          },
        })
      ).id;
      const consumer = await createActor({
        suffix: 'ckconsumer',
        workspaceId: workspaceBId,
        permissionCodes: ['RAB_DRAFT_EDIT', 'PROJECT_VIEW'],
      });
      const consumerMembership =
        await prisma.workspaceMembership.findUniqueOrThrow({
          where: {
            accountId_workspaceId: {
              accountId: consumer.accountId,
              workspaceId: workspaceBId,
            },
          },
        });
      await prisma.projectAssignment.create({
        data: {
          workspaceMembershipId: consumerMembership.id,
          projectId: ckProjectId,
          roleInProject: 'BP-CAT-01D consumer',
          status: 'ASSIGNED',
        },
      });
      ckToken = await login(consumer.email);

      const ahsp = await prisma.aHSP.create({
        data: {
          workspaceId: workspaceBId,
          workType: `${tag} CK Work`,
          methodType: 'MANUAL',
          locationType: 'GENERAL',
          methodName: `${tag} CK method`,
        },
      });
      ckAhspId = ahsp.id;
      const version = await prisma.aHSPVersion.create({
        data: {
          ahspId: ahsp.id,
          workspaceId: workspaceBId,
          versionNumber: 1,
          outputUnit: 'Kg',
        },
      });
      const ahspResource = await prisma.aHSPResource.create({
        data: {
          ahspVersionId: version.id,
          resourceId: `${tag} CK Material`,
          resourceType: 'MATERIAL',
          coefficient: '2.000000',
          baseUnit: 'Kg',
        },
      });
      // THE SELECTION UNDER TEST: Workspace B's resolution points at the SHARED
      // descendant, which is the only row of this lineage it can lawfully see.
      ckOccurrenceId = (
        await prisma.projectAhspOccurrence.create({
          data: {
            workspaceId: workspaceBId,
            projectId: ckProjectId,
            ahspVersionId: version.id,
            idempotencyKey: `${tag}-ck-occurrence`,
            businessPricingAsOfDate: new Date('2026-08-10T00:00:00.000Z'),
            referenceRegionId: regionId,
            resolutionPolicyVersion: 'E1A_CONTEXTUAL_EXACT_REGION_V1',
            resourceResolutions: {
              create: [
                {
                  ahspResourceId: ahspResource.id,
                  rawAhspResourceRef: ahspResource.resourceId,
                  rawAhspResourceType: 'MATERIAL',
                  ahspCoefficient: '2.000000',
                  ahspUnit: 'Kg',
                  status: 'RESOLVED',
                  selectionMode: 'AUTO_SELECTED',
                  resourceCatalogId: ckResourceId,
                  selectedBasicPriceId: ckSharedId,
                  canonicalUnit: 'Kg',
                  sourcePriceValue: '5000.00',
                  sourceUnit: 'Kg',
                  adaptedPriceValue: '5000.00',
                  selectedSourceOrigin: 'GOVERNMENT',
                  selectedFreshnessStatus: 'CURRENT',
                  selectedEffectiveDate: new Date('2026-08-01T00:00:00.000Z'),
                  resolutionMethod: 'EXACT_DETERMINISTIC',
                  reasonCodes: ['TEST_FIXTURE_ONLY'],
                  explanation: labels,
                  policyVersion: labels,
                },
              ],
            },
          },
        })
      ).id;
      ckStructureId = (
        await prisma.boqStructure.create({
          data: {
            projectId: ckProjectId,
            name: 'Working Draft',
            version: 1,
            status: 'DRAFT',
          },
        })
      ).id;
      ckItemId = (
        await prisma.boqItem.create({
          data: {
            boqStructureId: ckStructureId,
            wbsCode: '1.1',
            name: `${tag} CK line`,
            itemType: 'WORK_ITEM',
            quantity: '5',
            unit: 'Kg',
            ahspVersionId: version.id,
            workingOccurrenceId: ckOccurrenceId,
          },
        })
      ).id;
    });

    afterAll(async () => {
      // The items are DELETED rather than blanked. A priced row cannot have its
      // occurrence pointers nulled while it still carries a unitPrice and a
      // priceOrigin — `boq_items_price_origin_truth_check` refuses exactly that
      // half-state, and rightly so. Deleting removes the FK references the
      // occurrence teardown below needs released, without ever writing a row
      // that claims a server-calculated price with nothing behind it.
      await prisma.rabDocument.deleteMany({
        where: { projectId: ckProjectId },
      });
      await prisma.boqItem.deleteMany({
        where: { boqStructureId: ckStructureId },
      });
      await prisma.boqStructure.deleteMany({ where: { id: ckStructureId } });
      await prisma.projectAhspResourceResolution.deleteMany({
        where: { occurrenceId: ckOccurrenceId },
      });
      await prisma.projectAhspOccurrence.deleteMany({
        where: { projectId: ckProjectId },
      });
      await prisma.aHSPResource.deleteMany({
        where: { ahspVersion: { ahspId: ckAhspId } },
      });
      await prisma.aHSPVersion.deleteMany({ where: { ahspId: ckAhspId } });
      await prisma.aHSP.deleteMany({ where: { id: ckAhspId } });
      await prisma.projectAssignment.deleteMany({
        where: { projectId: ckProjectId },
      });
      await prisma.project.deleteMany({ where: { id: ckProjectId } });
      // The shared descendant first — RESTRICT protects the origin behind it.
      await prisma.basicPrice.deleteMany({ where: { id: ckSharedId } });
      await prisma.basicPricePublicationAudit.deleteMany({
        where: { basicPriceId: ckOriginId },
      });
      await prisma.basicPrice.deleteMany({ where: { id: ckOriginId } });
      await prisma.priceSubmissionReviewDecision.deleteMany({
        where: { review: { priceSubmissionId: ckSubmissionId } },
      });
      await prisma.priceSubmissionReview.deleteMany({
        where: { priceSubmissionId: ckSubmissionId },
      });
      await prisma.priceSubmission.deleteMany({
        where: { id: ckSubmissionId },
      });
    });

    it('CK-01/02: if the ORIGIN’s publication evidence is broken, spending the shared price fails closed', async () => {
      // Remove the origin's ACCEPT decision — the shared row is untouched and
      // still looks perfectly valid on its own.
      const review = await prisma.priceSubmissionReview.findUniqueOrThrow({
        where: { priceSubmissionId: ckSubmissionId },
      });
      const decisions = await prisma.priceSubmissionReviewDecision.findMany({
        where: { reviewId: review.id },
      });
      await prisma.priceSubmissionReviewDecision.deleteMany({
        where: { reviewId: review.id },
      });

      const denied = await persist(ckItemId);
      expect(denied.status).toBe(409);
      expect(errorOf(denied)).toBe('BASIC_PRICE_PROVENANCE_INCOMPLETE');

      // Restore, so the fixture teardown and any later read see the real chain.
      for (const decision of decisions) {
        await prisma.priceSubmissionReviewDecision.create({
          data: {
            reviewId: decision.reviewId,
            decidedByUserId: decision.decidedByUserId,
            action: decision.action,
          },
        });
      }
    });
    it('CK: Workspace B SPENDS the shared price — persistence succeeds, and the money is the origin’s money', async () => {
      const response = await persist(ckItemId);
      expect([response.status, response.body]).toEqual([
        201,
        expect.objectContaining({ priceOrigin: 'SERVER_COST_KERNEL' }),
      ]);

      // coefficient 2 x 5000.00 = 10000.00 per unit, quantity 5 -> 50000.00.
      // The number the other tenant spends is the number Workspace A published.
      const body = response.body as { unitPrice: string; lineTotal: string };
      expect(body.unitPrice).toBe('10000.00');
      expect(body.lineTotal).toBe('50000.00');

      // PERSISTED_SELECTED_BASIC_PRICE_ID = B, and its provenance is A.
      const resolution =
        await prisma.projectAhspResourceResolution.findFirstOrThrow({
          where: { occurrenceId: ckOccurrenceId },
        });
      expect(resolution.selectedBasicPriceId).toBe(ckSharedId);
      const spent = await prisma.basicPrice.findUniqueOrThrow({
        where: { id: ckSharedId },
      });
      expect(spent.promotedFromBasicPriceId).toBe(ckOriginId);
      expect(spent.workspaceId).toBeNull();
    });

    it('CK-05/06: the shared row was spent WITHOUT any PUBLISH audit of its own — PROMOTE_SHARED is never publication evidence', async () => {
      expect(
        await prisma.basicPricePublicationAudit.count({
          where: { basicPriceId: ckSharedId, action: 'PUBLISH' },
        }),
      ).toBe(0);
      expect(
        await prisma.basicPricePublicationAudit.count({
          where: { basicPriceId: ckSharedId, action: 'PROMOTE_SHARED' },
        }),
      ).toBe(1);
      // The evidence it actually leaned on belongs to the origin.
      expect(
        await prisma.basicPricePublicationAudit.count({
          where: { basicPriceId: ckOriginId, action: 'PUBLISH' },
        }),
      ).toBe(1);
    });
  });

  // ── ONE TRUTH IN THE SOURCE WORKSPACE ────────────────────────────────────

  /**
   * BP-CAT-01D SEAM 2. History may hold TWO artifacts — the workspace origin and
   * its shared descendant — because that is what actually happened. But the
   * workspace that produced the price must not be shown its own fact twice, as
   * two competing candidates, merely because it also gave that fact away.
   *
   * These tests own an isolated resource so cardinality is a measurement rather
   * than a guess about what other tests in this file left behind.
   */
  describe('one logical truth in the source workspace', () => {
    let otResourceId: string;
    let otOriginId: string;

    const listAs = async (bearer: string, workspaceId: string) => {
      const response = await request(server())
        .get(`/basic-prices/by-resource/${otResourceId}`)
        .set('Authorization', `Bearer ${bearer}`)
        .set('x-workspace-id', workspaceId)
        .expect(200);
      return (response.body as Array<{ id: string }>).map((r) => r.id);
    };

    beforeAll(async () => {
      otResourceId = (
        await prisma.resourceCatalog.create({
          data: {
            workspaceId: null,
            code: `${tag}-OTRES`,
            name: `${tag} One Truth Material`,
            type: 'MATERIAL',
            baseUnit: 'KG',
          },
        })
      ).id;
      otOriginId = (
        await createCatalogPrice({
          resourceId: otResourceId,
          value: '64000.00',
        })
      ).id;
    });

    it('OT-01: before promotion the source workspace sees its origin exactly once', async () => {
      expect(await listAs(promoterToken, workspaceAId)).toEqual([otOriginId]);
    });

    it('OT-02: after promotion the source workspace still sees ONE logical truth — the origin it owns', async () => {
      const response = await promote(
        promoterAccountId,
        workspaceAId,
        otOriginId,
      );
      expect(response.status).toBe(201);
      const sharedId = promotionOf(response).shared.id;

      // BOTH artifacts persist. That is history, and it is correct.
      expect(
        await prisma.basicPrice.count({
          where: { OR: [{ id: otOriginId }, { id: sharedId }] },
        }),
      ).toBe(2);

      // THE PRODUCT TRUTH. Workspace A owns the origin and can already use it,
      // so the descendant it donated must not come back as a second competing
      // candidate for the same resource.
      const seenByA = await listAs(promoterToken, workspaceAId);
      expect(seenByA).toEqual([otOriginId]);
    });

    it('OT-03/04: the other workspace sees the shared descendant, and never the origin', async () => {
      const shared = await prisma.basicPrice.findFirstOrThrow({
        where: { promotedFromBasicPriceId: otOriginId },
      });
      const seenByB = await listAs(consumerBToken, workspaceBId);
      expect(seenByB).toEqual([shared.id]);
      expect(seenByB).not.toContain(otOriginId);
    });

    it('OT-05..08: suppression is LINEAGE ONLY — same value, same resource, different date or region are all still distinct truths', async () => {
      // An independent observation that merely happens to cost the same must
      // never be collapsed: identity is lineage, never money.
      const sameValue = await createCatalogPrice({
        resourceId: otResourceId,
        value: '64000.00',
        effectiveDate: new Date('2026-09-01T00:00:00.000Z'),
      });
      const otherRegion = await prisma.region.create({
        data: {
          code: `${tag}-OTREG2`,
          name: `${tag} Other Region`,
          isActive: true,
        },
      });
      const differentRegion = await createCatalogPrice({
        resourceId: otResourceId,
        value: '71000.00',
        regionId: otherRegion.id,
      });

      const seenByA = await listAs(promoterToken, workspaceAId);
      expect(seenByA).toContain(otOriginId);
      expect(seenByA).toContain(sameValue.id);
      expect(seenByA).toContain(differentRegion.id);
      // Still exactly one row per genuine truth, and still no descendant.
      expect(seenByA).toHaveLength(3);
    });

    it('OT-10: promoting again keeps the source workspace at one logical truth', async () => {
      expect(
        (await promote(promoterAccountId, workspaceAId, otOriginId)).status,
      ).toBe(201);
      const seenByA = await listAs(promoterToken, workspaceAId);
      expect(seenByA.filter((id) => id === otOriginId)).toHaveLength(1);
      expect(
        await prisma.basicPrice.count({
          where: { promotedFromBasicPriceId: otOriginId },
        }),
      ).toBe(1);
    });

    it('P-06: a descendant of SOMEONE ELSE’s origin is never suppressed — suppression is keyed on whose origin it is', async () => {
      // Workspace B promotes its own price. Workspace A has no claim on that
      // origin, so the resulting shared row must compete normally for A. A rule
      // keyed on "is a descendant" rather than "is MY descendant" would wrongly
      // hide it.
      const foreignOrigin = await createCatalogPrice({
        resourceId: otResourceId,
        workspaceId: workspaceBId,
        organizationId: orgBId,
        value: '33000.00',
      });
      const promoted = await promote(
        foreignPromoterAccountId,
        workspaceBId,
        foreignOrigin.id,
      );
      expect(promoted.status).toBe(201);
      const foreignShared = promotionOf(promoted).shared.id;

      const seenByA = await listAs(promoterToken, workspaceAId);
      // A receives the shared descendant of B's price...
      expect(seenByA).toContain(foreignShared);
      // ...and never B's own workspace-owned origin.
      expect(seenByA).not.toContain(foreignOrigin.id);
      // A's own lineage is still collapsed to one.
      expect(seenByA).toContain(otOriginId);
    });

    it('P-09: precedence is SELECTION only — the source workspace can still read its own descendant directly by id', async () => {
      const shared = await prisma.basicPrice.findFirstOrThrow({
        where: { promotedFromBasicPriceId: otOriginId },
      });

      // The descendant is shadowed from A's CANDIDATE LIST because A already
      // sees the origin. It is not unlawful for A, and a direct read must still
      // return it — otherwise precedence would have quietly become an
      // eligibility rule after all.
      const byId = await request(server())
        .get(`/basic-prices/${shared.id}`)
        .set('Authorization', `Bearer ${promoterToken}`)
        .set('x-workspace-id', workspaceAId);
      expect(byId.status).toBe(200);
      expect((byId.body as { id: string }).id).toBe(shared.id);

      // And it is genuinely absent from the candidate list, so the two answers
      // differ on purpose rather than by accident.
      expect(await listAs(promoterToken, workspaceAId)).not.toContain(
        shared.id,
      );
    });
  });
});
