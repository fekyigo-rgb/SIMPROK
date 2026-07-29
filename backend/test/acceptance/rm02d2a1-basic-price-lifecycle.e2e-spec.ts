import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccountStatus, MembershipStatus, PrismaClient, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { buildBasicPriceXlsx } from '../fixtures/basic-price-xlsx.fixture';

// RM-02D2A-1 Backend Runtime Lifecycle Closure — dedicated safe E2E proof
// (Work Package F §11.3). Runs against simprok_e2e via `npm run test:e2e:safe`
// (reset + seeded fresh before every run) — never touches the Owner's real
// 271-row import batch. Proves the FULL backend chain with three genuinely
// distinct, least-privilege human actors (Owner Lock §2:
// VERIFIER_MUST_DIFFER_FROM_PUBLISHER=YES, AUTO_PUBLISH=FORBIDDEN):
//
//   Actor 1 (assigned@test.local):    IMPORT + REVIEW_VIEW + RESOLVE + SUBMIT
//   Actor 2 (nonassigned@test.local): REVIEW_VIEW + VERIFY
//   Actor 3 (foreman@test.local):     PUBLISH + VIEW
//
//   submit -> PriceSubmissionReview created in the same transaction
//   -> Actor 2 ACCEPT -> BasicPrice UNPUBLISHED+VERIFIED, not publicly visible
//   -> Actor 2 attempts publish -> 409 VERIFIER_CANNOT_PUBLISH, zero writes
//   -> Actor 3 publishes -> BasicPrice PUBLISHED+PUBLISHED, exactly one audit
//   -> public query (BASIC_PRICE_VIEW) now sees the exact BasicPrice
//   -> replay is idempotent, still exactly one audit row
const WORKSPACE_A = '10000000-0000-4000-8000-000000000004';
const WORKSPACE_B = '10000000-0000-4000-8000-000000000005';
const PASSWORD = 'Test1234!';

const REGION_ID = '42000000-0000-4000-8000-000000000001';
const RESOURCE_MATERIAL_ID = '42000000-0000-4000-8000-000000000002';
const RESOURCE_LABOR_ID = '42000000-0000-4000-8000-000000000003';
const UNIT_ID = '42000000-0000-4000-8000-000000000004';
const ROLE_ACTOR1_ID = '42000000-0000-4000-8000-000000000005';
const ROLE_ACTOR2_ID = '42000000-0000-4000-8000-000000000006';
const ROLE_ACTOR3_ID = '42000000-0000-4000-8000-000000000007';
const ROLE_CROSSTENANT_ID = '42000000-0000-4000-8000-000000000008';
// D-08 dedicated negative case: a human who genuinely holds BOTH
// BASIC_PRICE_VERIFY and BASIC_PRICE_PUBLISH must still be refused
// publishing a price they personally verified — the permission guard lets
// this call through (unlike Actor 2/Actor 1 above), so this is the only
// scenario that actually exercises BasicPricePublicationService's D-08
// service-level separation-of-duties check, not just PermissionsGuard.
const ROLE_ACTOR_BOTH_ID = '42000000-0000-4000-8000-000000000009';
const RESOURCE_BOTH_ID = '42000000-0000-4000-8000-00000000000a';

const ALL_BASIC_PRICE_PERMISSION_CODES = [
  'BASIC_PRICE_IMPORT',
  'BASIC_PRICE_RESOLVE',
  'BASIC_PRICE_SUBMIT',
  'BASIC_PRICE_VERIFY',
  'BASIC_PRICE_PUBLISH',
  'BASIC_PRICE_REVIEW_VIEW',
  'BASIC_PRICE_VIEW',
];

describe('RM-02D2A-1 Basic Price backend runtime lifecycle (e2e, three distinct actors)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let actor1Token: string; // importer/resolver/submitter
  let actor2Token: string; // verifier
  let actor3Token: string; // publisher
  let crosstenantToken: string;
  let actorBothToken: string;
  let actor2AccountId: string;
  let actor3AccountId: string;
  let actorBothAccountId: string;
  let actorBothUserId: string;
  const membershipRoleIds: string[] = [];
  const ACTOR_BOTH_EMAIL = 'rm02d2a1-actor-both@test.local';

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    await app.init();
    prisma = new PrismaClient();

    const permissions = await Promise.all(
      ALL_BASIC_PRICE_PERMISSION_CODES.map((code) =>
        prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} }),
      ),
    );
    const permByCode = (code: string) => permissions.find((p) => p.code === code)!;

    const grantRole = async (
      roleId: string,
      roleCode: string,
      codes: string[],
      accountEmail: string,
      workspaceId: string,
    ) => {
      await prisma.role.upsert({
        where: { id: roleId },
        create: { id: roleId, workspaceId, code: roleCode, name: roleCode },
        update: {},
      });
      await prisma.rolePermission.createMany({
        data: codes.map((code) => ({ roleId, permissionId: permByCode(code).id })),
        skipDuplicates: true,
      });
      const account = await prisma.account.findUniqueOrThrow({ where: { email: accountEmail } });
      const membership = await prisma.workspaceMembership.findUniqueOrThrow({
        where: { accountId_workspaceId: { accountId: account.id, workspaceId } },
      });
      const membershipRole = await prisma.membershipRole.create({
        data: { workspaceMembershipId: membership.id, roleId, isActive: true },
      });
      membershipRoleIds.push(membershipRole.id);
      return account.id;
    };

    await grantRole(ROLE_ACTOR1_ID, 'RM02D2A1_ACTOR1_IMPORTER', ['BASIC_PRICE_IMPORT', 'BASIC_PRICE_REVIEW_VIEW', 'BASIC_PRICE_RESOLVE', 'BASIC_PRICE_SUBMIT'], 'assigned@test.local', WORKSPACE_A);
    actor2AccountId = await grantRole(ROLE_ACTOR2_ID, 'RM02D2A1_ACTOR2_VERIFIER', ['BASIC_PRICE_REVIEW_VIEW', 'BASIC_PRICE_VERIFY'], 'nonassigned@test.local', WORKSPACE_A);
    actor3AccountId = await grantRole(ROLE_ACTOR3_ID, 'RM02D2A1_ACTOR3_PUBLISHER', ['BASIC_PRICE_PUBLISH', 'BASIC_PRICE_VIEW'], 'foreman@test.local', WORKSPACE_A);
    await grantRole(ROLE_CROSSTENANT_ID, 'RM02D2A1_CROSSTENANT_REVIEW_VIEW', ['BASIC_PRICE_REVIEW_VIEW'], 'crosstenant@test.local', WORKSPACE_B);

    // D-08 dedicated actor: a fresh Account/Membership/User created directly
    // (mirroring the established step26b-* raw-fixture pattern in
    // reality-intake-price-submission-review.e2e-spec.ts), holding BOTH
    // BASIC_PRICE_VERIFY and BASIC_PRICE_PUBLISH — the only actor in this
    // suite that can reach BasicPricePublicationService's D-08 check via a
    // real HTTP call (every other actor is stopped earlier by PermissionsGuard).
    const actorBothAccount = await prisma.account.upsert({
      where: { email: ACTOR_BOTH_EMAIL },
      update: { status: AccountStatus.ACTIVE, passwordHash: await bcrypt.hash(PASSWORD, 10) },
      create: { email: ACTOR_BOTH_EMAIL, passwordHash: await bcrypt.hash(PASSWORD, 10), displayName: 'RM-02D2A-1 Both Verify+Publish Actor', status: AccountStatus.ACTIVE },
    });
    actorBothAccountId = actorBothAccount.id;
    const actorBothMembership = await prisma.workspaceMembership.upsert({
      where: { accountId_workspaceId: { accountId: actorBothAccountId, workspaceId: WORKSPACE_A } },
      update: { status: MembershipStatus.ACTIVE },
      create: { accountId: actorBothAccountId, workspaceId: WORKSPACE_A, status: MembershipStatus.ACTIVE },
    });
    const actorBothUser = await prisma.user.upsert({
      where: { workspaceMembershipId: actorBothMembership.id },
      update: { status: UserStatus.ACTIVE },
      create: { workspaceMembershipId: actorBothMembership.id, workspaceId: WORKSPACE_A, fullName: 'RM-02D2A-1 Both Verify+Publish Actor', status: UserStatus.ACTIVE },
    });
    actorBothUserId = actorBothUser.id;
    await grantRole(ROLE_ACTOR_BOTH_ID, 'RM02D2A1_ACTOR_BOTH_VERIFY_PUBLISH', ['BASIC_PRICE_REVIEW_VIEW', 'BASIC_PRICE_VERIFY', 'BASIC_PRICE_PUBLISH'], ACTOR_BOTH_EMAIL, WORKSPACE_A);

    await prisma.resourceCatalog.upsert({
      where: { id: RESOURCE_BOTH_ID },
      create: { id: RESOURCE_BOTH_ID, workspaceId: WORKSPACE_A, code: 'RM02D2A1-BOTH-01', name: 'RM-02D2A-1 D-08 Resource', type: 'MATERIAL', baseUnit: 'Lbr' },
      update: {},
    });

    await prisma.region.upsert({ where: { id: REGION_ID }, create: { id: REGION_ID, code: 'RM02D2A1-REGION', name: 'RM-02D2A-1 Region' }, update: {} });
    await prisma.resourceCatalog.upsert({
      where: { id: RESOURCE_MATERIAL_ID },
      create: { id: RESOURCE_MATERIAL_ID, workspaceId: WORKSPACE_A, code: 'RM02D2A1-MAT-01', name: 'RM-02D2A-1 Material', type: 'MATERIAL', baseUnit: 'Lbr' },
      update: {},
    });
    await prisma.resourceCatalog.upsert({
      where: { id: RESOURCE_LABOR_ID },
      create: { id: RESOURCE_LABOR_ID, workspaceId: WORKSPACE_A, code: 'RM02D2A1-LAB-01', name: 'RM-02D2A-1 Labor', type: 'LABOR', baseUnit: 'Org/Hari' },
      update: {},
    });
    await prisma.unitDefinition.upsert({
      where: { id: UNIT_ID },
      create: { id: UNIT_ID, code: 'RM02D2A1-UNIT-ORGHARI', displayName: 'Orang per Hari', symbol: 'Org/Hari', dimension: 'PERSON_TIME', kind: 'CANONICAL' },
      update: {},
    });

    const login = async (email: string) =>
      (await request(app.getHttpServer()).post('/auth/login').send({ email, password: PASSWORD })).body.access_token;
    actor1Token = await login('assigned@test.local');
    actor2Token = await login('nonassigned@test.local');
    actor3Token = await login('foreman@test.local');
    crosstenantToken = await login('crosstenant@test.local');
    actorBothToken = await login(ACTOR_BOTH_EMAIL);
  });

  afterAll(async () => {
    await prisma.basicPriceImportBatch.deleteMany({ where: { workspaceId: WORKSPACE_A } });
    await prisma.basicPrice.deleteMany({ where: { resourceId: { in: [RESOURCE_MATERIAL_ID, RESOURCE_LABOR_ID, RESOURCE_BOTH_ID] } } });
    await prisma.priceSubmission.deleteMany({ where: { resourceId: { in: [RESOURCE_MATERIAL_ID, RESOURCE_LABOR_ID, RESOURCE_BOTH_ID] } } });
    await prisma.resourceCatalog.deleteMany({ where: { id: { in: [RESOURCE_MATERIAL_ID, RESOURCE_LABOR_ID, RESOURCE_BOTH_ID] } } });
    await prisma.unitDefinition.deleteMany({ where: { id: UNIT_ID } });
    await prisma.region.deleteMany({ where: { id: REGION_ID } });
    await prisma.membershipRole.deleteMany({ where: { id: { in: membershipRoleIds } } });
    await prisma.rolePermission.deleteMany({ where: { roleId: { in: [ROLE_ACTOR1_ID, ROLE_ACTOR2_ID, ROLE_ACTOR3_ID, ROLE_CROSSTENANT_ID, ROLE_ACTOR_BOTH_ID] } } });
    await prisma.role.deleteMany({ where: { id: { in: [ROLE_ACTOR1_ID, ROLE_ACTOR2_ID, ROLE_ACTOR3_ID, ROLE_CROSSTENANT_ID, ROLE_ACTOR_BOTH_ID] } } });
    await prisma.user.deleteMany({ where: { id: actorBothUserId } });
    await prisma.workspaceMembership.deleteMany({ where: { accountId: actorBothAccountId, workspaceId: WORKSPACE_A } });
    await prisma.account.deleteMany({ where: { id: actorBothAccountId } });
    await prisma.$disconnect();
    await app.close();
  });

  it('401s every basic-price-reviews/publications route with no Authorization header', async () => {
    await request(app.getHttpServer()).get('/basic-price-reviews').expect(401);
    await request(app.getHttpServer()).get('/basic-price-publications').expect(401);
  });

  it('closes the full lifecycle end-to-end with three distinct human actors', async () => {
    // --- Actor 1: import, resolve, reject the rest, submit ---
    const buffer = await buildBasicPriceXlsx();
    const preview = await request(app.getHttpServer())
      .post('/basic-price-imports/preview')
      .set('Authorization', `Bearer ${actor1Token}`).set('x-workspace-id', WORKSPACE_A)
      .attach('file', buffer, { filename: 'basic-price.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      .field('selectedSheet', 'HARGA SATUAN UPAH DAN BAHAN')
      .field('sourceVendorName', 'rm02d2a1-e2e')
      .field('effectiveDate', '2026-07-25')
      .field('regionId', REGION_ID)
      .field('sourceOrigin', 'SUPPLIER')
      .field('sourceType', 'MARKET_SURVEY')
      .expect(201);

    const row = preview.body.rows.find((r: { sourceRowNumber: number }) => r.sourceRowNumber === 9);
    const otherRows = preview.body.rows.filter((r: { sourceRowNumber: number }) => r.sourceRowNumber !== 9);

    await request(app.getHttpServer())
      .post(`/basic-price-imports/${preview.body.batchId}/rows/${row.id}/resolve`)
      .set('Authorization', `Bearer ${actor1Token}`).set('x-workspace-id', WORKSPACE_A)
      .send({ version: row.version, resourceCatalogId: RESOURCE_LABOR_ID, unitDefinitionId: UNIT_ID })
      .expect(201);
    for (const other of otherRows) {
      await request(app.getHttpServer())
        .post(`/basic-price-imports/${preview.body.batchId}/rows/${other.id}/reject`)
        .set('Authorization', `Bearer ${actor1Token}`).set('x-workspace-id', WORKSPACE_A)
        .send({ version: other.version, reason: 'out of scope for RM-02D2A-1 lifecycle e2e' })
        .expect(201);
    }

    await request(app.getHttpServer())
      .post(`/basic-price-imports/${preview.body.batchId}/submit`)
      .set('Authorization', `Bearer ${actor1Token}`).set('x-workspace-id', WORKSPACE_A)
      .expect(201);

    const submission = await prisma.priceSubmission.findFirstOrThrow({ where: { resourceId: RESOURCE_LABOR_ID } });
    // Work Package A: review exists in the SAME transaction as submit — no
    // separate worker/cron ever needs to run for this to be true.
    expect(submission.status).toBe('UNDER_REVIEW');
    const reviewRow = await prisma.priceSubmissionReview.findUniqueOrThrow({ where: { priceSubmissionId: submission.id } });
    expect(reviewRow.slaState).toBe('OPEN');
    const reviewId = reviewRow.id;

    // --- Actor 2 (verifier): sees the queue, accepts ---
    const queue = await request(app.getHttpServer()).get('/basic-price-reviews').set('Authorization', `Bearer ${actor2Token}`).set('x-workspace-id', WORKSPACE_A).expect(200);
    expect(queue.body.map((r: { id: string }) => r.id)).toContain(reviewId);

    // 404 cross-tenant: Workspace-B's crosstenant actor has REVIEW_VIEW in
    // ITS OWN workspace, but this reviewId belongs to Workspace-A.
    await request(app.getHttpServer())
      .get(`/basic-price-reviews/${reviewId}`)
      .set('Authorization', `Bearer ${crosstenantToken}`).set('x-workspace-id', WORKSPACE_B)
      .expect(404);

    // Actor 3 (publisher-only) cannot accept — 403.
    await request(app.getHttpServer())
      .post(`/basic-price-reviews/${reviewId}/accept`)
      .set('Authorization', `Bearer ${actor3Token}`).set('x-workspace-id', WORKSPACE_A)
      .expect(403);
    // Actor 1 (importer/resolver/submitter — no BASIC_PRICE_VERIFY) also
    // cannot accept, proving least-privilege separation on the mutating
    // route even though Actor 1 legitimately has read access (BASIC_PRICE_
    // REVIEW_VIEW ships seeded to assigned@test.local independently of this
    // fixture's role grants).
    await request(app.getHttpServer())
      .post(`/basic-price-reviews/${reviewId}/accept`)
      .set('Authorization', `Bearer ${actor1Token}`).set('x-workspace-id', WORKSPACE_A)
      .expect(403);

    const accept = await request(app.getHttpServer())
      .post(`/basic-price-reviews/${reviewId}/accept`)
      .set('Authorization', `Bearer ${actor2Token}`).set('x-workspace-id', WORKSPACE_A)
      .expect(201);
    expect(accept.body).toEqual(
      expect.objectContaining({
        priceSubmissionStatus: 'VERIFIED',
        basicPriceStatus: 'UNPUBLISHED',
        basicPriceVerificationStatus: 'VERIFIED',
        publiclyEligible: false,
      }),
    );
    const basicPriceId: string = accept.body.basicPriceId;

    // Not yet publicly visible.
    await request(app.getHttpServer()).get(`/basic-prices/${basicPriceId}`).set('Authorization', `Bearer ${actor3Token}`).set('x-workspace-id', WORKSPACE_A).expect(404);

    // Re-ACCEPT is idempotent: same BasicPrice, no duplicate decision.
    const acceptReplay = await request(app.getHttpServer())
      .post(`/basic-price-reviews/${reviewId}/accept`)
      .set('Authorization', `Bearer ${actor2Token}`).set('x-workspace-id', WORKSPACE_A)
      .expect(201);
    expect(acceptReplay.body.basicPriceId).toBe(basicPriceId);
    expect(await prisma.priceSubmissionReviewDecision.count({ where: { reviewId, action: 'ACCEPT' } })).toBe(1);

    // A REJECT on an already-RESOLVED review is an invalid lifecycle transition.
    await request(app.getHttpServer())
      .post(`/basic-price-reviews/${reviewId}/reject`)
      .set('Authorization', `Bearer ${actor2Token}`).set('x-workspace-id', WORKSPACE_A)
      .send({ note: 'too late, already resolved' })
      .expect(409);

    // Actor 2 (verifier) has no BASIC_PRICE_PUBLISH at all — the permission
    // guard refuses before the D-08 verifier/publisher separation check is
    // even reached. (The dedicated D-08 same-human-holds-both-permissions
    // case is proven separately below, where the guard DOES let the call
    // through and the service-level check is what has to catch it.)
    await request(app.getHttpServer())
      .post(`/basic-price-publications/${basicPriceId}/publish`)
      .set('Authorization', `Bearer ${actor2Token}`).set('x-workspace-id', WORKSPACE_A)
      .expect(403);
    expect((await prisma.basicPrice.findUniqueOrThrow({ where: { id: basicPriceId } })).status).toBe('UNPUBLISHED');
    expect(await prisma.basicPricePublicationAudit.count({ where: { basicPriceId } })).toBe(0);

    // Actor 1 (no PUBLISH permission) is also refused.
    await request(app.getHttpServer())
      .post(`/basic-price-publications/${basicPriceId}/publish`)
      .set('Authorization', `Bearer ${actor1Token}`).set('x-workspace-id', WORKSPACE_A)
      .expect(403);

    // --- Actor 3 (a genuinely different human): publish succeeds ---
    const publishQueue = await request(app.getHttpServer()).get('/basic-price-publications').set('Authorization', `Bearer ${actor3Token}`).set('x-workspace-id', WORKSPACE_A).expect(200);
    expect(publishQueue.body.map((bp: { id: string }) => bp.id)).toContain(basicPriceId);

    const publish = await request(app.getHttpServer())
      .post(`/basic-price-publications/${basicPriceId}/publish`)
      .set('Authorization', `Bearer ${actor3Token}`).set('x-workspace-id', WORKSPACE_A)
      .expect(201);
    expect(publish.body.status).toBe('PUBLISHED');
    expect(publish.body.verificationStatus).toBe('PUBLISHED');

    const audits = await prisma.basicPricePublicationAudit.findMany({ where: { basicPriceId } });
    expect(audits).toHaveLength(1);
    expect(audits[0].actorAccountId).toBe(actor3AccountId);
    expect(audits[0].actorAccountId).not.toBe(actor2AccountId);

    // Now publicly visible via the exact BasicPrice.
    const publicRead = await request(app.getHttpServer()).get(`/basic-prices/${basicPriceId}`).set('Authorization', `Bearer ${actor3Token}`).set('x-workspace-id', WORKSPACE_A).expect(200);
    expect(publicRead.body.id).toBe(basicPriceId);
    expect(publicRead.body.status).toBe('PUBLISHED');
    expect(publicRead.body.verificationStatus).toBe('PUBLISHED');

    // Idempotent replay: still exactly one audit row.
    const publishReplay = await request(app.getHttpServer())
      .post(`/basic-price-publications/${basicPriceId}/publish`)
      .set('Authorization', `Bearer ${actor3Token}`).set('x-workspace-id', WORKSPACE_A)
      .expect(201);
    expect(publishReplay.body.status).toBe('PUBLISHED');
    expect(await prisma.basicPricePublicationAudit.count({ where: { basicPriceId } })).toBe(1);
  });

  it('D-08: refuses publish even when the SAME human genuinely holds both BASIC_PRICE_VERIFY and BASIC_PRICE_PUBLISH', async () => {
    const { organizationId } = await prisma.workspace.findUniqueOrThrow({ where: { id: WORKSPACE_A }, select: { organizationId: true } });
    const submission = await prisma.priceSubmission.create({
      data: { workspaceId: WORKSPACE_A, organizationId, resourceId: RESOURCE_BOTH_ID, sourceOrigin: 'SUPPLIER', sourceType: 'MARKET_SURVEY', status: 'SUBMITTED' },
    });
    const revision = await prisma.priceSubmissionRevision.create({
      data: { submissionId: submission.id, revisionNumber: 1, value: '999999.00', effectiveDate: new Date('2026-07-25'), validationPassed: true },
    });
    await prisma.priceSubmission.update({ where: { id: submission.id }, data: { currentRevisionId: revision.id } });
    const review = await prisma.priceSubmissionReview.create({
      data: { priceSubmissionId: submission.id, workspaceId: WORKSPACE_A, organizationId, slaState: 'OPEN', openedAt: new Date() },
    });

    const accept = await request(app.getHttpServer())
      .post(`/basic-price-reviews/${review.id}/accept`)
      .set('Authorization', `Bearer ${actorBothToken}`).set('x-workspace-id', WORKSPACE_A)
      .expect(201);
    expect(accept.body.basicPriceStatus).toBe('UNPUBLISHED');
    expect(accept.body.basicPriceVerificationStatus).toBe('VERIFIED');
    const basicPriceId: string = accept.body.basicPriceId;

    const decision = await prisma.priceSubmissionReviewDecision.findFirstOrThrow({ where: { reviewId: review.id, action: 'ACCEPT' } });
    expect(decision.decidedByUserId).toBe(actorBothUserId);

    const selfPublish = await request(app.getHttpServer())
      .post(`/basic-price-publications/${basicPriceId}/publish`)
      .set('Authorization', `Bearer ${actorBothToken}`).set('x-workspace-id', WORKSPACE_A)
      .expect(409);
    expect(selfPublish.body.message).toBe('VERIFIER_CANNOT_PUBLISH');

    expect((await prisma.basicPrice.findUniqueOrThrow({ where: { id: basicPriceId } })).status).toBe('UNPUBLISHED');
    expect(await prisma.basicPricePublicationAudit.count({ where: { basicPriceId } })).toBe(0);
  });
});
