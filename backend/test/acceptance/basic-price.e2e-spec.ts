import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import * as bcrypt from 'bcrypt';

const PASSWORD = 'Test1234!';
const SALT_ROUNDS = 10;

// Unique search token so meta.total is deterministic regardless of other test data.
const TAG = 'BPHLK';

const GLOBAL_CODES = ['MAT-GLOBAL-CUR', 'MAT-GLOBAL-EXP'];

/**
 * Basic Price — PUBLIC ELIGIBILITY HARD LOCK (Owner-locked).
 *
 * Public-eligible ONLY when: status='PUBLISHED' AND verificationStatus=PUBLISHED.
 * VERIFIED is internal/curation and MUST NOT be visible.
 * Freshness (CURRENT/EXPIRING/EXPIRED) is a separate axis and does not affect eligibility.
 */
describe('Basic Price Public Eligibility (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;

  let workspaceAId: string;
  let workspaceBId: string;

  const userAEmail = 'bphlk.usera@test.local';
  const userBEmail = 'bphlk.userb@test.local';
  const userNoRoleEmail = 'bphlk.usernorole@test.local';

  let tokenA: string;
  let tokenB: string;
  let tokenNoRole: string;

  // IDs needed for detail / by-resource assertions.
  let eligibleGlobalPriceId: string;
  let verifiedHiddenPriceId: string; // tenant A, verificationStatus=VERIFIED (internal)
  let tenantBEligiblePriceId: string; // tenant B, PUBLISHED/PUBLISHED (cross-tenant to A)
  let resTenantAValidId: string; // by-resource → eligible
  let resTenantAVerifiedId: string; // by-resource → empty (internal)

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = new PrismaClient();

    const passwordHash = await bcrypt.hash(PASSWORD, SALT_ROUNDS);

    const orgA = await prisma.organization.create({
      data: { name: 'Org BPHLK A', type: 'COMPANY' },
    });
    const wsA = await prisma.workspace.create({
      data: { name: 'WS BPHLK A', organizationId: orgA.id },
    });
    workspaceAId = wsA.id;

    const orgB = await prisma.organization.create({
      data: { name: 'Org BPHLK B', type: 'COMPANY' },
    });
    const wsB = await prisma.workspace.create({
      data: { name: 'WS BPHLK B', organizationId: orgB.id },
    });
    workspaceBId = wsB.id;

    const permView = await prisma.permission.findUniqueOrThrow({
      where: { code: 'BASIC_PRICE_VIEW' },
    });

    const viewerRole = await prisma.role.create({
      data: {
        workspaceId: workspaceAId,
        name: 'BPHLK Viewer A',
        code: 'BPHLK_VIEWER_A',
        rolePermissions: { create: [{ permissionId: permView.id }] },
      },
    });
    const viewerRoleB = await prisma.role.create({
      data: {
        workspaceId: workspaceBId,
        name: 'BPHLK Viewer B',
        code: 'BPHLK_VIEWER_B',
        rolePermissions: { create: [{ permissionId: permView.id }] },
      },
    });

    const accountA = await prisma.account.create({
      data: {
        email: userAEmail,
        passwordHash,
        displayName: 'BPHLK A',
        status: 'ACTIVE',
      },
    });
    const memberA = await prisma.workspaceMembership.create({
      data: {
        accountId: accountA.id,
        workspaceId: workspaceAId,
        status: 'ACTIVE',
        membershipRoles: { create: [{ roleId: viewerRole.id }] },
      },
    });
    await prisma.user.create({
      data: {
        workspaceMembershipId: memberA.id,
        workspaceId: workspaceAId,
        fullName: 'BPHLK A',
        status: 'ACTIVE',
      },
    });

    const accountB = await prisma.account.create({
      data: {
        email: userBEmail,
        passwordHash,
        displayName: 'BPHLK B',
        status: 'ACTIVE',
      },
    });
    const memberB = await prisma.workspaceMembership.create({
      data: {
        accountId: accountB.id,
        workspaceId: workspaceBId,
        status: 'ACTIVE',
        membershipRoles: { create: [{ roleId: viewerRoleB.id }] },
      },
    });
    await prisma.user.create({
      data: {
        workspaceMembershipId: memberB.id,
        workspaceId: workspaceBId,
        fullName: 'BPHLK B',
        status: 'ACTIVE',
      },
    });

    const accountNoRole = await prisma.account.create({
      data: {
        email: userNoRoleEmail,
        passwordHash,
        displayName: 'BPHLK No Role',
        status: 'ACTIVE',
      },
    });
    const memberNoRole = await prisma.workspaceMembership.create({
      data: {
        accountId: accountNoRole.id,
        workspaceId: workspaceAId,
        status: 'ACTIVE',
      },
    });
    await prisma.user.create({
      data: {
        workspaceMembershipId: memberNoRole.id,
        workspaceId: workspaceAId,
        fullName: 'BPHLK No Role',
        status: 'ACTIVE',
      },
    });

    const resA = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: userAEmail, password: PASSWORD });
    tokenA = resA.body.access_token;
    const resB = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: userBEmail, password: PASSWORD });
    tokenB = resB.body.access_token;
    const resNoRole = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: userNoRoleEmail, password: PASSWORD });
    tokenNoRole = resNoRole.body.access_token;

    // ---- Seed fixtures (all status='PUBLISHED'; only verificationStatus=PUBLISHED is eligible) ----

    // Global eligible: PUBLISHED/CURRENT
    const resGlobalCur = await prisma.resourceCatalog.create({
      data: {
        workspaceId: null,
        code: 'MAT-GLOBAL-CUR',
        name: `${TAG} Global Current`,
        type: 'MATERIAL',
        baseUnit: 'Zak',
      },
    });
    const globalCur = await prisma.basicPrice.create({
      data: {
        workspaceId: null,
        resourceId: resGlobalCur.id,
        status: 'PUBLISHED',
        value: 120000,
        effectiveDate: new Date('2026-05-01'),
        sourceOrigin: 'GOVERNMENT',
        sourceType: 'MARKET_SURVEY',
        verificationStatus: 'PUBLISHED',
        freshnessStatus: 'CURRENT',
      },
    });
    eligibleGlobalPriceId = globalCur.id;

    // Global eligible: PUBLISHED/EXPIRING
    const resGlobalExp = await prisma.resourceCatalog.create({
      data: {
        workspaceId: null,
        code: 'MAT-GLOBAL-EXP',
        name: `${TAG} Global Expiring`,
        type: 'MATERIAL',
        baseUnit: 'Zak',
      },
    });
    await prisma.basicPrice.create({
      data: {
        workspaceId: null,
        resourceId: resGlobalExp.id,
        status: 'PUBLISHED',
        value: 121000,
        effectiveDate: new Date('2026-04-01'),
        sourceOrigin: 'GOVERNMENT',
        sourceType: 'MARKET_SURVEY',
        verificationStatus: 'PUBLISHED',
        freshnessStatus: 'EXPIRING',
      },
    });

    // Tenant A eligible: PUBLISHED/EXPIRED (proves EXPIRED still visible)
    const resAValid = await prisma.resourceCatalog.create({
      data: {
        workspaceId: workspaceAId,
        code: 'MAT-A-VALID',
        name: `${TAG} Tenant A Valid Expired`,
        type: 'MATERIAL',
        baseUnit: 'Zak',
      },
    });
    resTenantAValidId = resAValid.id;
    await prisma.basicPrice.create({
      data: {
        workspaceId: workspaceAId,
        resourceId: resAValid.id,
        status: 'PUBLISHED',
        value: 150000,
        effectiveDate: new Date('2026-06-01'),
        sourceOrigin: 'SUPPLIER',
        sourceType: 'SYSTEM_ESTIMATE',
        verificationStatus: 'PUBLISHED',
        freshnessStatus: 'EXPIRED',
      },
    });

    // Tenant A internal (all HIDDEN):
    const resAVerified = await prisma.resourceCatalog.create({
      data: {
        workspaceId: workspaceAId,
        code: 'MAT-A-VERIFIED',
        name: `${TAG} Tenant A Verified Internal`,
        type: 'MATERIAL',
        baseUnit: 'Zak',
      },
    });
    resTenantAVerifiedId = resAVerified.id;
    const aVerified = await prisma.basicPrice.create({
      data: {
        workspaceId: workspaceAId,
        resourceId: resAVerified.id,
        status: 'PUBLISHED',
        value: 151000,
        effectiveDate: new Date('2026-06-02'),
        sourceOrigin: 'SUPPLIER',
        sourceType: 'SYSTEM_ESTIMATE',
        verificationStatus: 'VERIFIED',
        freshnessStatus: 'CURRENT',
      },
    });
    verifiedHiddenPriceId = aVerified.id;

    const resAUnverified = await prisma.resourceCatalog.create({
      data: {
        workspaceId: workspaceAId,
        code: 'MAT-A-UNVERIFIED',
        name: `${TAG} Tenant A Unverified Internal`,
        type: 'MATERIAL',
        baseUnit: 'Zak',
      },
    });
    await prisma.basicPrice.create({
      data: {
        workspaceId: workspaceAId,
        resourceId: resAUnverified.id,
        status: 'PUBLISHED',
        value: 152000,
        effectiveDate: new Date('2026-06-03'),
        sourceOrigin: 'SUPPLIER',
        sourceType: 'SYSTEM_ESTIMATE',
        verificationStatus: 'UNVERIFIED',
        freshnessStatus: 'CURRENT',
      },
    });

    const resASubmitted = await prisma.resourceCatalog.create({
      data: {
        workspaceId: workspaceAId,
        code: 'MAT-A-SUBMITTED',
        name: `${TAG} Tenant A Submitted Internal`,
        type: 'MATERIAL',
        baseUnit: 'Zak',
      },
    });
    await prisma.basicPrice.create({
      data: {
        workspaceId: workspaceAId,
        resourceId: resASubmitted.id,
        status: 'PUBLISHED',
        value: 153000,
        effectiveDate: new Date('2026-06-04'),
        sourceOrigin: 'SUPPLIER',
        sourceType: 'SYSTEM_ESTIMATE',
        verificationStatus: 'SUBMITTED',
        freshnessStatus: 'CURRENT',
      },
    });

    const resAReview = await prisma.resourceCatalog.create({
      data: {
        workspaceId: workspaceAId,
        code: 'MAT-A-REVIEW',
        name: `${TAG} Tenant A Review Internal`,
        type: 'MATERIAL',
        baseUnit: 'Zak',
      },
    });
    await prisma.basicPrice.create({
      data: {
        workspaceId: workspaceAId,
        resourceId: resAReview.id,
        status: 'PUBLISHED',
        value: 154000,
        effectiveDate: new Date('2026-06-05'),
        sourceOrigin: 'SUPPLIER',
        sourceType: 'SYSTEM_ESTIMATE',
        verificationStatus: 'UNDER_REVIEW',
        freshnessStatus: 'EXPIRING',
      },
    });

    const resARejected = await prisma.resourceCatalog.create({
      data: {
        workspaceId: workspaceAId,
        code: 'MAT-A-REJECTED',
        name: `${TAG} Tenant A Rejected Internal`,
        type: 'MATERIAL',
        baseUnit: 'Zak',
      },
    });
    await prisma.basicPrice.create({
      data: {
        workspaceId: workspaceAId,
        resourceId: resARejected.id,
        status: 'PUBLISHED',
        value: 155000,
        effectiveDate: new Date('2026-06-06'),
        sourceOrigin: 'SUPPLIER',
        sourceType: 'SYSTEM_ESTIMATE',
        verificationStatus: 'REJECTED',
        freshnessStatus: 'EXPIRED',
      },
    });

    // Tenant B eligible: PUBLISHED/PUBLISHED (visible to B, hidden from A)
    const resBValid = await prisma.resourceCatalog.create({
      data: {
        workspaceId: workspaceBId,
        code: 'MAT-B-VALID',
        name: `${TAG} Tenant B Valid`,
        type: 'MATERIAL',
        baseUnit: 'Zak',
      },
    });
    const bValid = await prisma.basicPrice.create({
      data: {
        workspaceId: workspaceBId,
        resourceId: resBValid.id,
        status: 'PUBLISHED',
        value: 160000,
        effectiveDate: new Date('2026-07-01'),
        sourceOrigin: 'STORE',
        sourceType: 'VENDOR_QUOTE',
        verificationStatus: 'PUBLISHED',
        freshnessStatus: 'CURRENT',
      },
    });
    tenantBEligiblePriceId = bValid.id;
  });

  afterAll(async () => {
    await prisma.basicPrice.deleteMany({
      where: {
        OR: [
          { workspaceId: workspaceAId },
          { workspaceId: workspaceBId },
          { workspaceId: null, resource: { code: { in: GLOBAL_CODES } } },
        ],
      },
    });
    await prisma.resourceCatalog.deleteMany({
      where: {
        OR: [
          { workspaceId: workspaceAId },
          { workspaceId: workspaceBId },
          { workspaceId: null, code: { in: GLOBAL_CODES } },
        ],
      },
    });
    const accountIds = await prisma.account
      .findMany({
        where: { email: { in: [userAEmail, userBEmail, userNoRoleEmail] } },
      })
      .then((a) => a.map((x) => x.id));
    const memberships = await prisma.workspaceMembership.findMany({
      where: { accountId: { in: accountIds } },
    });
    const membershipIds = memberships.map((m) => m.id);

    await prisma.user.deleteMany({
      where: { workspaceMembershipId: { in: membershipIds } },
    });
    await prisma.role.deleteMany({
      where: { workspaceId: { in: [workspaceAId, workspaceBId] } },
    });
    await prisma.workspaceMembership.deleteMany({
      where: { id: { in: membershipIds } },
    });
    await prisma.workspaceMembership.deleteMany({
      where: { workspaceId: { in: [workspaceAId, workspaceBId] } },
    });
    await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.workspace.deleteMany({
      where: { id: { in: [workspaceAId, workspaceBId] } },
    });

    const orgA = await prisma.organization.findFirst({
      where: { name: 'Org BPHLK A' },
    });
    const orgB = await prisma.organization.findFirst({
      where: { name: 'Org BPHLK B' },
    });
    const orgIds: string[] = [];
    if (orgA) orgIds.push(orgA.id);
    if (orgB) orgIds.push(orgB.id);
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });

    await prisma.$disconnect();
    await app.close();
  });

  const listAsA = (qs = '') =>
    request(app.getHttpServer())
      .get(`/basic-prices${qs}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Workspace-ID', workspaceAId);

  it('rejects 401 without token', () => {
    return request(app.getHttpServer()).get('/basic-prices').expect(401);
  });

  it('rejects 403 without BASIC_PRICE_VIEW', () => {
    return request(app.getHttpServer())
      .get('/basic-prices')
      .set('Authorization', `Bearer ${tokenNoRole}`)
      .set('X-Workspace-ID', workspaceAId)
      .expect(403);
  });

  it('list: only eligible (PUBLISHED/PUBLISHED) global + own tenant; no internal, no cross-tenant', async () => {
    const res = await listAsA(`?search=${TAG}`).expect(200);

    const codes = res.body.data.map((p: any) => p.resource.code);
    // eligible
    expect(codes).toContain('MAT-GLOBAL-CUR');
    expect(codes).toContain('MAT-GLOBAL-EXP');
    expect(codes).toContain('MAT-A-VALID');
    // internal-curation must be hidden
    expect(codes).not.toContain('MAT-A-VERIFIED');
    expect(codes).not.toContain('MAT-A-UNVERIFIED');
    expect(codes).not.toContain('MAT-A-SUBMITTED');
    expect(codes).not.toContain('MAT-A-REVIEW');
    expect(codes).not.toContain('MAT-A-REJECTED');
    // cross-tenant hidden
    expect(codes).not.toContain('MAT-B-VALID');

    // Explorer projection: never the raw entity — no internal-curation
    // vocabulary (status/verificationStatus) leaks into the public contract.
    for (const p of res.body.data) {
      expect(p).not.toHaveProperty('status');
      expect(p).not.toHaveProperty('verificationStatus');
    }
    // deterministic total for the tagged eligible set
    expect(res.body.meta.total).toBe(3);
  });

  it('meta.total counts only eligible records', async () => {
    const res = await listAsA(`?search=${TAG}`).expect(200);
    expect(res.body.data.length).toBe(res.body.meta.total);
    expect(res.body.meta.total).toBe(3);
  });

  it('search cannot open an internal-curation record', async () => {
    const res = await listAsA(`?search=Verified%20Internal`).expect(200);
    expect(res.body.data.length).toBe(0);
  });

  it('freshnessStatus=EXPIRED still returns the eligible published expired price', async () => {
    const res = await listAsA(`?search=${TAG}&freshnessStatus=EXPIRED`).expect(
      200,
    );
    const codes = res.body.data.map((p: any) => p.resource.code);
    expect(codes).toEqual(['MAT-A-VALID']);
    expect(res.body.data[0].freshnessStatus).toBe('EXPIRED');
  });

  it('verificationStatus=PUBLISHED query is accepted (200)', async () => {
    await listAsA(`?search=${TAG}&verificationStatus=PUBLISHED`).expect(200);
  });

  it.each(['VERIFIED', 'UNVERIFIED', 'SUBMITTED', 'UNDER_REVIEW', 'REJECTED'])(
    'verificationStatus=%s query is rejected (400)',
    async (status) => {
      await listAsA(`?verificationStatus=${status}`).expect(400);
    },
  );

  it('detail: eligible record returns 200', async () => {
    const res = await listAsA(`?search=${TAG}`).expect(200);
    // fetch a known eligible id directly
    await request(app.getHttpServer())
      .get(`/basic-prices/${eligibleGlobalPriceId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Workspace-ID', workspaceAId)
      .expect(200)
      .expect((r) => {
        expect(r.body.id).toBe(eligibleGlobalPriceId);
        expect(r.body.verificationStatus).toBe('PUBLISHED');
      });
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('detail: internal-curation (VERIFIED) record returns 404 (no existence leak)', async () => {
    await request(app.getHttpServer())
      .get(`/basic-prices/${verifiedHiddenPriceId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Workspace-ID', workspaceAId)
      .expect(404);
  });

  it('detail: cross-tenant record returns 404', async () => {
    await request(app.getHttpServer())
      .get(`/basic-prices/${tenantBEligiblePriceId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Workspace-ID', workspaceAId)
      .expect(404);
  });

  it('by-resource: eligible resource returns only PUBLISHED/PUBLISHED', async () => {
    const res = await request(app.getHttpServer())
      .get(`/basic-prices/by-resource/${resTenantAValidId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Workspace-ID', workspaceAId)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
    expect(res.body[0].verificationStatus).toBe('PUBLISHED');
  });

  it('by-resource: internal-curation resource returns empty array', async () => {
    const res = await request(app.getHttpServer())
      .get(`/basic-prices/by-resource/${resTenantAVerifiedId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Workspace-ID', workspaceAId)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(0);
  });

  it('response contract stays {data, meta} and deterministic (default paging)', async () => {
    const res = await listAsA(`?search=${TAG}`).expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(3);
    expect(res.body.meta).toEqual({
      total: 3,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
    expect(typeof res.body.meta.page).toBe('number');
    expect(typeof res.body.meta.limit).toBe('number');
  });

  it('transforms pagination query strings and returns deterministic non-overlapping pages', async () => {
    const firstPage = await listAsA(
      `?search=${TAG}&sortBy=effectiveDate&sortOrder=desc&page=1&limit=1`,
    ).expect(200);
    const secondPage = await listAsA(
      `?search=${TAG}&sortBy=effectiveDate&sortOrder=desc&page=2&limit=1`,
    ).expect(200);

    expect(firstPage.body.meta).toEqual({
      total: 3,
      page: 1,
      limit: 1,
      totalPages: 3,
    });
    expect(secondPage.body.meta).toEqual({
      total: 3,
      page: 2,
      limit: 1,
      totalPages: 3,
    });
    expect(firstPage.body.data).toHaveLength(1);
    expect(secondPage.body.data).toHaveLength(1);
    expect(firstPage.body.data[0].resource.code).toBe('MAT-A-VALID');
    expect(secondPage.body.data[0].resource.code).toBe('MAT-GLOBAL-CUR');
    expect(secondPage.body.data[0].basicPriceId).not.toBe(
      firstPage.body.data[0].basicPriceId,
    );
    expect(typeof firstPage.body.meta.page).toBe('number');
    expect(typeof firstPage.body.meta.limit).toBe('number');
  });

  it.each([
    ['page=abc', 'page=abc'],
    ['page=0', 'page=0'],
    ['limit=abc', 'limit=abc'],
    ['limit=0', 'limit=0'],
    ['limit=51', 'limit=51'],
    ['year=abc', 'year=abc'],
    ['year=1999', 'year=1999'],
    ['year=2101', 'year=2101'],
  ])('rejects invalid numeric query %s with 400', async (_label, query) => {
    await listAsA(`?${query}`).expect(400);
  });

  describe('Explorer projection & filters (RM02D2A2 remediation)', () => {
    it('projects workspaceScope=WORKSPACE for own-tenant rows and GLOBAL for global rows', async () => {
      const res = await listAsA(`?search=${TAG}`).expect(200);
      const byCode = Object.fromEntries(
        res.body.data.map((p: any) => [p.resource.code, p]),
      );
      expect(byCode['MAT-GLOBAL-CUR'].workspaceScope).toBe('GLOBAL');
      expect(byCode['MAT-A-VALID'].workspaceScope).toBe('WORKSPACE');
    });

    it('price is always an exact two-digit decimal string, never a JS number', async () => {
      const res = await listAsA(`?search=${TAG}`).expect(200);
      for (const p of res.body.data) {
        expect(typeof p.price).toBe('string');
        expect(p.price).toMatch(/^\d+\.\d{2}$/);
      }
      const globalCur = res.body.data.find(
        (p: any) => p.resource.code === 'MAT-GLOBAL-CUR',
      );
      expect(globalCur.price).toBe('120000.00');
    });

    it('resource projection carries baseUnit; region is null for these fixtures (no region set)', async () => {
      const res = await listAsA(`?search=${TAG}`).expect(200);
      for (const p of res.body.data) {
        expect(p.resource.baseUnit).toBe('Zak');
        expect(p.region).toBeNull();
      }
    });

    it('SOURCE_RELATION_NULL -> sourceName=null (never fabricated) for rows with no import provenance', async () => {
      const res = await listAsA(`?search=${TAG}`).expect(200);
      for (const p of res.body.data) {
        expect(p.sourceName).toBeNull();
      }
    });

    it('dateFrom/dateTo filters effectiveDate to the requested range', async () => {
      // Fixture effectiveDates for the TAG set span 2026-04-01..2026-07-01;
      // MAT-A-VALID is the only eligible row at 2026-06-01.
      const res = await listAsA(
        `?search=${TAG}&dateFrom=2026-06-01&dateTo=2026-06-30`,
      ).expect(200);
      const codes = res.body.data.map((p: any) => p.resource.code);
      expect(codes).toEqual(['MAT-A-VALID']);
    });

    it("dateTo is the final day fully included (dateFrom=dateTo=the row's own day still matches it)", async () => {
      // MAT-A-VALID's effectiveDate is exactly 2026-06-01 — a same-day range
      // proves dateTo is not excluding its own day (the exact bug this
      // remediation closes: an `lte` on a midnight instant would have
      // silently excluded any later time-of-day on the same calendar day).
      const res = await listAsA(
        `?search=${TAG}&dateFrom=2026-06-01&dateTo=2026-06-01`,
      ).expect(200);
      const codes = res.body.data.map((p: any) => p.resource.code);
      expect(codes).toEqual(['MAT-A-VALID']);
    });

    it('rejects dateFrom after dateTo with 400 (no silent correction)', async () => {
      await listAsA(`?dateFrom=2026-06-30&dateTo=2026-01-01`).expect(400);
    });

    it('rejects year combined with dateFrom/dateTo as an ambiguous time filter (400)', async () => {
      await listAsA(`?year=2026&dateFrom=2026-01-01`).expect(400);
    });

    it('rejects a malformed dateFrom with 400', async () => {
      await listAsA(`?dateFrom=not-a-date`).expect(400);
    });

    it('rejects an ISO8601 "basic format" dateFrom (no separators) with 400', async () => {
      await listAsA(`?dateFrom=20260601`).expect(400);
    });

    it('rejects a timestamp in the date-only dateFrom field with 400', async () => {
      await listAsA(`?dateFrom=2026-06-01T10:00:00Z`).expect(400);
    });

    it('rejects a calendar-invalid dateTo with 400 (never silently rolled forward)', async () => {
      await listAsA(`?dateTo=2026-02-30`).expect(400);
    });

    it('rejects a non-leap-year Feb 29 dateTo with 400', async () => {
      await listAsA(`?dateTo=2026-02-29`).expect(400);
    });
  });

  describe('GET /basic-prices/lookups/regions (Explorer-scoped, BASIC_PRICE_VIEW)', () => {
    it('rejects 401 without token', () => {
      return request(app.getHttpServer())
        .get('/basic-prices/lookups/regions')
        .expect(401);
    });

    it('rejects 403 without BASIC_PRICE_VIEW', () => {
      return request(app.getHttpServer())
        .get('/basic-prices/lookups/regions')
        .set('Authorization', `Bearer ${tokenNoRole}`)
        .set('X-Workspace-ID', workspaceAId)
        .expect(403);
    });

    it('a BASIC_PRICE_VIEW-only actor (no BASIC_PRICE_IMPORT) can list active regions', async () => {
      const res = await request(app.getHttpServer())
        .get('/basic-prices/lookups/regions')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Workspace-ID', workspaceAId)
        .expect(200);
      expect(Array.isArray(res.body.items)).toBe(true);
      for (const region of res.body.items) {
        expect(region).toHaveProperty('id');
        expect(region).toHaveProperty('code');
        expect(region).toHaveProperty('name');
      }
    });
  });
});
