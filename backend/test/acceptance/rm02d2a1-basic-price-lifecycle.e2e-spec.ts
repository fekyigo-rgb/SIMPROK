import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AccountStatus,
  MembershipStatus,
  PrismaClient,
  UserStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { BasicPricePublicationService } from '../../src/basic-price/basic-price-publication.service';
import { PrismaService } from '../../src/prisma/prisma.service';
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
// RM02D2A2 remediation — dedicated negative-permission actor: holds ONLY
// BASIC_PRICE_VERIFY, deliberately WITHOUT BASIC_PRICE_REVIEW_VIEW. Proves
// read access (list/detail) and decide access (accept/reject/verify) are
// genuinely separate permissions — no existing actor in this suite has VERIFY
// without REVIEW_VIEW (Actor 2 and Actor-Both both carry REVIEW_VIEW too).
const ROLE_ACTOR_VERIFY_ONLY_ID = '42000000-0000-4000-8000-00000000000b';
const ACTOR_VERIFY_ONLY_EMAIL = 'rm02d2a2-actor-verify-only@test.local';

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
  let appPrisma: PrismaService;
  let actor1Token: string; // importer/resolver/submitter
  let actor2Token: string; // verifier
  let actor3Token: string; // publisher
  let crosstenantToken: string;
  let actorBothToken: string;
  let actorVerifyOnlyToken: string; // RM02D2A2: VERIFY without REVIEW_VIEW
  let actor2AccountId: string;
  let actor3AccountId: string;
  let actorBothAccountId: string;
  let actorVerifyOnlyAccountId: string;
  let actorVerifyOnlyUserId: string;
  /**
   * The REAL canonical unit for this fixture's own source spelling: row 9 of
   * the fixture workbook writes "Org/Hari", which the Unit Kernel already
   * knows as PERSON_DAY. An acceptance-only UnitDefinition would be a unit no
   * alias can reach, so nothing would prove the stored price is a price per
   * person-day — and the trusted unit context seam refuses exactly that.
   */
  let personDayUnitId: string;
  let actor2UserId: string;
  let actor3UserId: string;
  let actorBothUserId: string;
  const membershipRoleIds: string[] = [];
  const createdPermissionIds: string[] = [];
  const ACTOR_BOTH_EMAIL = 'rm02d2a1-actor-both@test.local';

  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.init();
    prisma = new PrismaClient();
    appPrisma = app.get(PrismaService);

    const permissionsBefore = await prisma.permission.findMany({
      where: { code: { in: ALL_BASIC_PRICE_PERMISSION_CODES } },
      select: { id: true, code: true },
    });
    const preexistingPermissionCodes = new Set(
      permissionsBefore.map((permission) => permission.code),
    );
    const permissions = await Promise.all(
      ALL_BASIC_PRICE_PERMISSION_CODES.map((code) =>
        prisma.permission.upsert({
          where: { code },
          create: { code, name: code },
          update: {},
        }),
      ),
    );
    createdPermissionIds.push(
      ...permissions
        .filter(
          (permission) => !preexistingPermissionCodes.has(permission.code),
        )
        .map((permission) => permission.id),
    );
    const permByCode = (code: string) =>
      permissions.find((p) => p.code === code)!;

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
        data: codes.map((code) => ({
          roleId,
          permissionId: permByCode(code).id,
        })),
        skipDuplicates: true,
      });
      const account = await prisma.account.findUniqueOrThrow({
        where: { email: accountEmail },
      });
      const membership = await prisma.workspaceMembership.findUniqueOrThrow({
        where: {
          accountId_workspaceId: { accountId: account.id, workspaceId },
        },
      });
      const membershipRole = await prisma.membershipRole.create({
        data: { workspaceMembershipId: membership.id, roleId, isActive: true },
      });
      membershipRoleIds.push(membershipRole.id);
      return account.id;
    };

    await grantRole(
      ROLE_ACTOR1_ID,
      'RM02D2A1_ACTOR1_IMPORTER',
      [
        'BASIC_PRICE_IMPORT',
        'BASIC_PRICE_REVIEW_VIEW',
        'BASIC_PRICE_RESOLVE',
        'BASIC_PRICE_SUBMIT',
      ],
      'assigned@test.local',
      WORKSPACE_A,
    );
    actor2AccountId = await grantRole(
      ROLE_ACTOR2_ID,
      'RM02D2A1_ACTOR2_VERIFIER',
      ['BASIC_PRICE_REVIEW_VIEW', 'BASIC_PRICE_VERIFY'],
      'nonassigned@test.local',
      WORKSPACE_A,
    );
    const actor2Membership = await prisma.workspaceMembership.findUniqueOrThrow(
      {
        where: {
          accountId_workspaceId: {
            accountId: actor2AccountId,
            workspaceId: WORKSPACE_A,
          },
        },
      },
    );
    actor2UserId = (
      await prisma.user.findUniqueOrThrow({
        where: { workspaceMembershipId: actor2Membership.id },
      })
    ).id;
    actor3AccountId = await grantRole(
      ROLE_ACTOR3_ID,
      'RM02D2A1_ACTOR3_PUBLISHER',
      ['BASIC_PRICE_PUBLISH', 'BASIC_PRICE_VIEW'],
      'foreman@test.local',
      WORKSPACE_A,
    );
    const actor3Membership = await prisma.workspaceMembership.findUniqueOrThrow(
      {
        where: {
          accountId_workspaceId: {
            accountId: actor3AccountId,
            workspaceId: WORKSPACE_A,
          },
        },
      },
    );
    actor3UserId = (
      await prisma.user.findUniqueOrThrow({
        where: { workspaceMembershipId: actor3Membership.id },
      })
    ).id;
    await grantRole(
      ROLE_CROSSTENANT_ID,
      'RM02D2A1_CROSSTENANT_REVIEW_VIEW',
      ['BASIC_PRICE_REVIEW_VIEW'],
      'crosstenant@test.local',
      WORKSPACE_B,
    );

    // D-08 dedicated actor: a fresh Account/Membership/User created directly
    // (mirroring the established step26b-* raw-fixture pattern in
    // reality-intake-price-submission-review.e2e-spec.ts), holding BOTH
    // BASIC_PRICE_VERIFY and BASIC_PRICE_PUBLISH — the only actor in this
    // suite that can reach BasicPricePublicationService's D-08 check via a
    // real HTTP call (every other actor is stopped earlier by PermissionsGuard).
    const actorBothAccount = await prisma.account.upsert({
      where: { email: ACTOR_BOTH_EMAIL },
      update: {
        status: AccountStatus.ACTIVE,
        passwordHash: await bcrypt.hash(PASSWORD, 10),
      },
      create: {
        email: ACTOR_BOTH_EMAIL,
        passwordHash: await bcrypt.hash(PASSWORD, 10),
        displayName: 'RM-02D2A-1 Both Verify+Publish Actor',
        status: AccountStatus.ACTIVE,
      },
    });
    actorBothAccountId = actorBothAccount.id;
    const actorBothMembership = await prisma.workspaceMembership.upsert({
      where: {
        accountId_workspaceId: {
          accountId: actorBothAccountId,
          workspaceId: WORKSPACE_A,
        },
      },
      update: { status: MembershipStatus.ACTIVE },
      create: {
        accountId: actorBothAccountId,
        workspaceId: WORKSPACE_A,
        status: MembershipStatus.ACTIVE,
      },
    });
    const actorBothUser = await prisma.user.upsert({
      where: { workspaceMembershipId: actorBothMembership.id },
      update: { status: UserStatus.ACTIVE },
      create: {
        workspaceMembershipId: actorBothMembership.id,
        workspaceId: WORKSPACE_A,
        fullName: 'RM-02D2A-1 Both Verify+Publish Actor',
        status: UserStatus.ACTIVE,
      },
    });
    actorBothUserId = actorBothUser.id;
    await grantRole(
      ROLE_ACTOR_BOTH_ID,
      'RM02D2A1_ACTOR_BOTH_VERIFY_PUBLISH',
      ['BASIC_PRICE_REVIEW_VIEW', 'BASIC_PRICE_VERIFY', 'BASIC_PRICE_PUBLISH'],
      ACTOR_BOTH_EMAIL,
      WORKSPACE_A,
    );

    // RM02D2A2 remediation — a fresh Account/Membership/User holding ONLY
    // BASIC_PRICE_VERIFY (no BASIC_PRICE_REVIEW_VIEW), mirroring the
    // established ACTOR_BOTH raw-fixture pattern above.
    const actorVerifyOnlyAccount = await prisma.account.upsert({
      where: { email: ACTOR_VERIFY_ONLY_EMAIL },
      update: {
        status: AccountStatus.ACTIVE,
        passwordHash: await bcrypt.hash(PASSWORD, 10),
      },
      create: {
        email: ACTOR_VERIFY_ONLY_EMAIL,
        passwordHash: await bcrypt.hash(PASSWORD, 10),
        displayName: 'RM-02D2A-2 Verify-Only Actor',
        status: AccountStatus.ACTIVE,
      },
    });
    actorVerifyOnlyAccountId = actorVerifyOnlyAccount.id;
    const actorVerifyOnlyMembership = await prisma.workspaceMembership.upsert({
      where: {
        accountId_workspaceId: {
          accountId: actorVerifyOnlyAccountId,
          workspaceId: WORKSPACE_A,
        },
      },
      update: { status: MembershipStatus.ACTIVE },
      create: {
        accountId: actorVerifyOnlyAccountId,
        workspaceId: WORKSPACE_A,
        status: MembershipStatus.ACTIVE,
      },
    });
    const actorVerifyOnlyUser = await prisma.user.upsert({
      where: { workspaceMembershipId: actorVerifyOnlyMembership.id },
      update: { status: UserStatus.ACTIVE },
      create: {
        workspaceMembershipId: actorVerifyOnlyMembership.id,
        workspaceId: WORKSPACE_A,
        fullName: 'RM-02D2A-2 Verify-Only Actor',
        status: UserStatus.ACTIVE,
      },
    });
    actorVerifyOnlyUserId = actorVerifyOnlyUser.id;
    await grantRole(
      ROLE_ACTOR_VERIFY_ONLY_ID,
      'RM02D2A2_ACTOR_VERIFY_ONLY',
      ['BASIC_PRICE_VERIFY'],
      ACTOR_VERIFY_ONLY_EMAIL,
      WORKSPACE_A,
    );

    await prisma.resourceCatalog.upsert({
      where: { id: RESOURCE_BOTH_ID },
      create: {
        id: RESOURCE_BOTH_ID,
        workspaceId: WORKSPACE_A,
        code: 'RM02D2A1-BOTH-01',
        name: 'RM-02D2A-1 D-08 Resource',
        type: 'MATERIAL',
        baseUnit: 'Lbr',
      },
      update: {},
    });

    await prisma.region.upsert({
      where: { id: REGION_ID },
      create: {
        id: REGION_ID,
        code: 'RM02D2A1-REGION',
        name: 'RM-02D2A-1 Region',
      },
      update: {},
    });
    await prisma.resourceCatalog.upsert({
      where: { id: RESOURCE_MATERIAL_ID },
      create: {
        id: RESOURCE_MATERIAL_ID,
        workspaceId: WORKSPACE_A,
        code: 'RM02D2A1-MAT-01',
        name: 'RM-02D2A-1 Material',
        type: 'MATERIAL',
        baseUnit: 'Lbr',
      },
      update: {},
    });
    await prisma.resourceCatalog.upsert({
      where: { id: RESOURCE_LABOR_ID },
      create: {
        id: RESOURCE_LABOR_ID,
        workspaceId: WORKSPACE_A,
        code: 'RM02D2A1-LAB-01',
        name: 'RM-02D2A-1 Labor',
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

    const login = async (email: string) =>
      (
        await request(app.getHttpServer())
          .post('/auth/login')
          .send({ email, password: PASSWORD })
      ).body.access_token;
    actor1Token = await login('assigned@test.local');
    actor2Token = await login('nonassigned@test.local');
    actor3Token = await login('foreman@test.local');
    crosstenantToken = await login('crosstenant@test.local');
    actorBothToken = await login(ACTOR_BOTH_EMAIL);
    actorVerifyOnlyToken = await login(ACTOR_VERIFY_ONLY_EMAIL);
  });

  const createOpenReview = async (
    options: {
      status?: 'UNDER_REVIEW' | 'NEEDS_CORRECTION';
      regionId?: string | null;
      effectiveDate?: Date | null;
    } = {},
  ) => {
    const { organizationId } = await prisma.workspace.findUniqueOrThrow({
      where: { id: WORKSPACE_A },
      select: { organizationId: true },
    });
    const submission = await prisma.priceSubmission.create({
      data: {
        workspaceId: WORKSPACE_A,
        organizationId,
        resourceId: RESOURCE_BOTH_ID,
        regionId: options.regionId === undefined ? REGION_ID : options.regionId,
        sourceOrigin: 'SUPPLIER',
        sourceType: 'MARKET_SURVEY',
        status: options.status ?? 'UNDER_REVIEW',
      },
    });
    const revision = await prisma.priceSubmissionRevision.create({
      data: {
        submissionId: submission.id,
        revisionNumber: 1,
        value: '999999.00',
        effectiveDate:
          options.effectiveDate === undefined
            ? new Date('2026-07-25T00:00:00.000Z')
            : options.effectiveDate,
        validationPassed: true,
      },
    });
    await prisma.priceSubmission.update({
      where: { id: submission.id },
      data: { currentRevisionId: revision.id },
    });
    const review = await prisma.priceSubmissionReview.create({
      data: {
        priceSubmissionId: submission.id,
        workspaceId: WORKSPACE_A,
        organizationId,
        slaState: 'OPEN',
        openedAt: new Date(),
      },
    });
    return { organizationId, submission, revision, review };
  };

  const createAcceptedPrice = async () => {
    const fixture = await createOpenReview();
    const decision = await prisma.priceSubmissionReviewDecision.create({
      data: {
        reviewId: fixture.review.id,
        decidedByUserId: actor2UserId,
        action: 'ACCEPT',
      },
    });
    await prisma.priceSubmissionReview.update({
      where: { id: fixture.review.id },
      data: { slaState: 'RESOLVED', resolvedAt: new Date() },
    });
    await prisma.priceSubmission.update({
      where: { id: fixture.submission.id },
      data: { status: 'VERIFIED' },
    });
    const basicPrice = await prisma.basicPrice.create({
      data: {
        sourceSubmissionId: fixture.submission.id,
        resourceId: RESOURCE_BOTH_ID,
        workspaceId: WORKSPACE_A,
        organizationId: fixture.organizationId,
        regionId: REGION_ID,
        effectiveDate: fixture.revision.effectiveDate!,
        value: fixture.revision.value,
        sourceType: 'MARKET_SURVEY',
        sourceOrigin: 'SUPPLIER',
        verificationStatus: 'VERIFIED',
        freshnessStatus: 'CURRENT',
      },
    });
    return { ...fixture, decision, basicPrice };
  };

  const getTypedHttpServer = (): Parameters<typeof request>[0] => {
    const server: unknown = app.getHttpServer();
    return server as Parameters<typeof request>[0];
  };

  afterAll(async () => {
    await prisma.basicPriceImportBatch.deleteMany({
      where: { workspaceId: WORKSPACE_A },
    });
    await prisma.basicPrice.deleteMany({
      where: {
        resourceId: {
          in: [RESOURCE_MATERIAL_ID, RESOURCE_LABOR_ID, RESOURCE_BOTH_ID],
        },
      },
    });
    await prisma.priceSubmission.deleteMany({
      where: {
        resourceId: {
          in: [RESOURCE_MATERIAL_ID, RESOURCE_LABOR_ID, RESOURCE_BOTH_ID],
        },
      },
    });
    await prisma.resourceCatalog.deleteMany({
      where: {
        id: { in: [RESOURCE_MATERIAL_ID, RESOURCE_LABOR_ID, RESOURCE_BOTH_ID] },
      },
    });
    await prisma.region.deleteMany({ where: { id: REGION_ID } });
    await prisma.membershipRole.deleteMany({
      where: { id: { in: membershipRoleIds } },
    });
    await prisma.rolePermission.deleteMany({
      where: {
        roleId: {
          in: [
            ROLE_ACTOR1_ID,
            ROLE_ACTOR2_ID,
            ROLE_ACTOR3_ID,
            ROLE_CROSSTENANT_ID,
            ROLE_ACTOR_BOTH_ID,
            ROLE_ACTOR_VERIFY_ONLY_ID,
          ],
        },
      },
    });
    await prisma.role.deleteMany({
      where: {
        id: {
          in: [
            ROLE_ACTOR1_ID,
            ROLE_ACTOR2_ID,
            ROLE_ACTOR3_ID,
            ROLE_CROSSTENANT_ID,
            ROLE_ACTOR_BOTH_ID,
            ROLE_ACTOR_VERIFY_ONLY_ID,
          ],
        },
      },
    });
    await prisma.permission.deleteMany({
      where: { id: { in: createdPermissionIds } },
    });
    await prisma.user.deleteMany({ where: { id: actorBothUserId } });
    await prisma.workspaceMembership.deleteMany({
      where: { accountId: actorBothAccountId, workspaceId: WORKSPACE_A },
    });
    await prisma.account.deleteMany({ where: { id: actorBothAccountId } });
    await prisma.user.deleteMany({ where: { id: actorVerifyOnlyUserId } });
    await prisma.workspaceMembership.deleteMany({
      where: { accountId: actorVerifyOnlyAccountId, workspaceId: WORKSPACE_A },
    });
    await prisma.account.deleteMany({
      where: { id: actorVerifyOnlyAccountId },
    });
    await prisma.$disconnect();
    await app.close();
  });

  it('401s every basic-price-reviews/publications route with no Authorization header', async () => {
    await request(app.getHttpServer()).get('/basic-price-reviews').expect(401);
    await request(app.getHttpServer())
      .get('/basic-price-publications')
      .expect(401);
  });

  it('closes the full lifecycle end-to-end with three distinct human actors', async () => {
    // --- Actor 1: import, resolve, reject the rest, submit ---
    const buffer = await buildBasicPriceXlsx();
    const preview = await request(app.getHttpServer())
      .post('/basic-price-imports/preview')
      .set('Authorization', `Bearer ${actor1Token}`)
      .set('x-workspace-id', WORKSPACE_A)
      .attach('file', buffer, {
        filename: 'basic-price.xlsx',
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .field('selectedSheet', 'HARGA SATUAN UPAH DAN BAHAN')
      .field('sourceVendorName', 'rm02d2a1-e2e')
      .field('effectiveDate', '2026-07-25')
      .field('regionId', REGION_ID)
      .field('sourceOrigin', 'SUPPLIER')
      .field('sourceType', 'MARKET_SURVEY')
      .expect(201);

    const row = preview.body.rows.find(
      (r: { sourceRowNumber: number }) => r.sourceRowNumber === 9,
    );
    const otherRows = preview.body.rows.filter(
      (r: { sourceRowNumber: number }) => r.sourceRowNumber !== 9,
    );

    await request(app.getHttpServer())
      .post(
        `/basic-price-imports/${preview.body.batchId}/rows/${row.id}/resolve`,
      )
      .set('Authorization', `Bearer ${actor1Token}`)
      .set('x-workspace-id', WORKSPACE_A)
      .send({
        version: row.version,
        resourceCatalogId: RESOURCE_LABOR_ID,
        unitDefinitionId: personDayUnitId,
      })
      .expect(201);
    for (const other of otherRows) {
      await request(app.getHttpServer())
        .post(
          `/basic-price-imports/${preview.body.batchId}/rows/${other.id}/reject`,
        )
        .set('Authorization', `Bearer ${actor1Token}`)
        .set('x-workspace-id', WORKSPACE_A)
        .send({
          version: other.version,
          reason: 'out of scope for RM-02D2A-1 lifecycle e2e',
        })
        .expect(201);
    }

    await request(app.getHttpServer())
      .post(`/basic-price-imports/${preview.body.batchId}/submit`)
      .set('Authorization', `Bearer ${actor1Token}`)
      .set('x-workspace-id', WORKSPACE_A)
      .expect(201);

    const submission = await prisma.priceSubmission.findFirstOrThrow({
      where: { resourceId: RESOURCE_LABOR_ID },
    });
    // Work Package A: review exists in the SAME transaction as submit — no
    // separate worker/cron ever needs to run for this to be true.
    expect(submission.status).toBe('UNDER_REVIEW');
    const reviewRow = await prisma.priceSubmissionReview.findUniqueOrThrow({
      where: { priceSubmissionId: submission.id },
    });
    expect(reviewRow.slaState).toBe('OPEN');
    const reviewId = reviewRow.id;

    // --- Actor 2 (verifier): sees the queue, accepts ---
    const queue = await request(app.getHttpServer())
      .get('/basic-price-reviews')
      .set('Authorization', `Bearer ${actor2Token}`)
      .set('x-workspace-id', WORKSPACE_A)
      .expect(200);
    // RM-02D2A2: the queue is now a projection keyed by reviewId (not a raw
    // PriceSubmissionReview.id), and each row carries a human-readable resource
    // identity plus an exact two-digit price string.
    const queued = queue.body.find(
      (r: { reviewId: string }) => r.reviewId === reviewId,
    );
    expect(queued).toBeDefined();
    expect(queued.resource).toEqual(
      expect.objectContaining({ name: expect.any(String) }),
    );
    expect(queued.currentPrice).toMatch(/^\d+\.\d{2}$/);

    // 404 cross-tenant: Workspace-B's crosstenant actor has REVIEW_VIEW in
    // ITS OWN workspace, but this reviewId belongs to Workspace-A.
    await request(app.getHttpServer())
      .get(`/basic-price-reviews/${reviewId}`)
      .set('Authorization', `Bearer ${crosstenantToken}`)
      .set('x-workspace-id', WORKSPACE_B)
      .expect(404);

    // RM02D2A2 remediation — permission-honest UI direct-URL negative matrix:

    // B. VERIFY without REVIEW_VIEW: read access (list/detail) is a genuinely
    // separate permission from decide access. A human who can only act on a
    // review must never be able to browse the queue or open a detail by URL.
    await request(app.getHttpServer())
      .get('/basic-price-reviews')
      .set('Authorization', `Bearer ${actorVerifyOnlyToken}`)
      .set('x-workspace-id', WORKSPACE_A)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/basic-price-reviews/${reviewId}`)
      .set('Authorization', `Bearer ${actorVerifyOnlyToken}`)
      .set('x-workspace-id', WORKSPACE_A)
      .expect(403);

    // C. REVIEW_VIEW without VERIFY: Actor 1 can read the queue/detail but
    // must never reach the reassign reviewer-candidates selector — a
    // view-only human has no decide authority, so the frontend must not call
    // this endpoint for them, and the backend must refuse it even if it did.
    await request(app.getHttpServer())
      .get('/basic-price-reviews/reviewer-candidates')
      .set('Authorization', `Bearer ${actor1Token}`)
      .set('x-workspace-id', WORKSPACE_A)
      .expect(403);

    // Actor 3 (publisher-only) cannot accept — 403.
    await request(app.getHttpServer())
      .post(`/basic-price-reviews/${reviewId}/accept`)
      .set('Authorization', `Bearer ${actor3Token}`)
      .set('x-workspace-id', WORKSPACE_A)
      .expect(403);
    // Actor 1 (importer/resolver/submitter — no BASIC_PRICE_VERIFY) also
    // cannot accept, proving least-privilege separation on the mutating
    // route even though Actor 1 legitimately has read access (BASIC_PRICE_
    // REVIEW_VIEW ships seeded to assigned@test.local independently of this
    // fixture's role grants).
    await request(app.getHttpServer())
      .post(`/basic-price-reviews/${reviewId}/accept`)
      .set('Authorization', `Bearer ${actor1Token}`)
      .set('x-workspace-id', WORKSPACE_A)
      .expect(403);

    const accept = await request(app.getHttpServer())
      .post(`/basic-price-reviews/${reviewId}/accept`)
      .set('Authorization', `Bearer ${actor2Token}`)
      .set('x-workspace-id', WORKSPACE_A)
      .send({
        decidedByUserId: actorBothUserId,
        regionId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      })
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
    const persistedAccept =
      await prisma.priceSubmissionReviewDecision.findFirstOrThrow({
        where: { reviewId, action: 'ACCEPT' },
      });
    expect(persistedAccept.decidedByUserId).toBe(actor2UserId);
    const acceptedPrice = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: basicPriceId },
    });
    expect(acceptedPrice.regionId).toBe(REGION_ID);
    expect(acceptedPrice.effectiveDate.toISOString()).toBe(
      '2026-07-25T00:00:00.000Z',
    );

    // Not yet publicly visible.
    await request(app.getHttpServer())
      .get(`/basic-prices/${basicPriceId}`)
      .set('Authorization', `Bearer ${actor3Token}`)
      .set('x-workspace-id', WORKSPACE_A)
      .expect(404);

    // Re-ACCEPT is idempotent: same BasicPrice, no duplicate decision.
    const acceptReplay = await request(app.getHttpServer())
      .post(`/basic-price-reviews/${reviewId}/accept`)
      .set('Authorization', `Bearer ${actor2Token}`)
      .set('x-workspace-id', WORKSPACE_A)
      .expect(201);
    expect(acceptReplay.body.basicPriceId).toBe(basicPriceId);
    expect(
      await prisma.priceSubmissionReviewDecision.count({
        where: { reviewId, action: 'ACCEPT' },
      }),
    ).toBe(1);

    // A REJECT on an already-RESOLVED review is an invalid lifecycle transition.
    await request(app.getHttpServer())
      .post(`/basic-price-reviews/${reviewId}/reject`)
      .set('Authorization', `Bearer ${actor2Token}`)
      .set('x-workspace-id', WORKSPACE_A)
      .send({ note: 'too late, already resolved' })
      .expect(409);

    // Actor 2 (verifier) has no BASIC_PRICE_PUBLISH at all — the permission
    // guard refuses before the D-08 verifier/publisher separation check is
    // even reached. (The dedicated D-08 same-human-holds-both-permissions
    // case is proven separately below, where the guard DOES let the call
    // through and the service-level check is what has to catch it.)
    await request(app.getHttpServer())
      .post(`/basic-price-publications/${basicPriceId}/publish`)
      .set('Authorization', `Bearer ${actor2Token}`)
      .set('x-workspace-id', WORKSPACE_A)
      .expect(403);
    expect(
      (
        await prisma.basicPrice.findUniqueOrThrow({
          where: { id: basicPriceId },
        })
      ).status,
    ).toBe('UNPUBLISHED');
    expect(
      await prisma.basicPricePublicationAudit.count({
        where: { basicPriceId },
      }),
    ).toBe(0);

    // Actor 1 (no PUBLISH permission) is also refused.
    await request(app.getHttpServer())
      .post(`/basic-price-publications/${basicPriceId}/publish`)
      .set('Authorization', `Bearer ${actor1Token}`)
      .set('x-workspace-id', WORKSPACE_A)
      .expect(403);

    // --- Actor 3 (a genuinely different human): publish succeeds ---
    const publishQueue = await request(app.getHttpServer())
      .get('/basic-price-publications')
      .set('Authorization', `Bearer ${actor3Token}`)
      .set('x-workspace-id', WORKSPACE_A)
      .expect(200);
    // RM-02D2A2: the publication queue is now a projection keyed by
    // basicPriceId, carrying human-readable identity + a two-digit price string.
    const queuedForPublish = publishQueue.body.find(
      (bp: { basicPriceId: string }) => bp.basicPriceId === basicPriceId,
    );
    expect(queuedForPublish).toBeDefined();
    expect(queuedForPublish.price).toMatch(/^\d+\.\d{2}$/);

    const publish = await request(app.getHttpServer())
      .post(`/basic-price-publications/${basicPriceId}/publish`)
      .set('Authorization', `Bearer ${actor3Token}`)
      .set('x-workspace-id', WORKSPACE_A)
      .expect(201);
    expect(publish.body.status).toBe('PUBLISHED');
    expect(publish.body.verificationStatus).toBe('PUBLISHED');

    const audits = await prisma.basicPricePublicationAudit.findMany({
      where: { basicPriceId },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].actorAccountId).toBe(actor3AccountId);
    expect(audits[0].actorAccountId).not.toBe(actor2AccountId);

    // Now publicly visible via the exact BasicPrice.
    const publicRead = await request(app.getHttpServer())
      .get(`/basic-prices/${basicPriceId}`)
      .set('Authorization', `Bearer ${actor3Token}`)
      .set('x-workspace-id', WORKSPACE_A)
      .expect(200);
    expect(publicRead.body.id).toBe(basicPriceId);
    expect(publicRead.body.status).toBe('PUBLISHED');
    expect(publicRead.body.verificationStatus).toBe('PUBLISHED');

    // Idempotent replay: still exactly one audit row.
    const publishReplay = await request(app.getHttpServer())
      .post(`/basic-price-publications/${basicPriceId}/publish`)
      .set('Authorization', `Bearer ${actor3Token}`)
      .set('x-workspace-id', WORKSPACE_A)
      .expect(201);
    expect(publishReplay.body.status).toBe('PUBLISHED');
    expect(
      await prisma.basicPricePublicationAudit.count({
        where: { basicPriceId },
      }),
    ).toBe(1);
  });

  it('D-08: refuses publish even when the SAME human genuinely holds both BASIC_PRICE_VERIFY and BASIC_PRICE_PUBLISH', async () => {
    const { organizationId } = await prisma.workspace.findUniqueOrThrow({
      where: { id: WORKSPACE_A },
      select: { organizationId: true },
    });
    const submission = await prisma.priceSubmission.create({
      data: {
        workspaceId: WORKSPACE_A,
        organizationId,
        resourceId: RESOURCE_BOTH_ID,
        regionId: REGION_ID,
        sourceOrigin: 'SUPPLIER',
        sourceType: 'MARKET_SURVEY',
        status: 'UNDER_REVIEW',
      },
    });
    const revision = await prisma.priceSubmissionRevision.create({
      data: {
        submissionId: submission.id,
        revisionNumber: 1,
        value: '999999.00',
        effectiveDate: new Date('2026-07-25'),
        validationPassed: true,
      },
    });
    await prisma.priceSubmission.update({
      where: { id: submission.id },
      data: { currentRevisionId: revision.id },
    });
    const review = await prisma.priceSubmissionReview.create({
      data: {
        priceSubmissionId: submission.id,
        workspaceId: WORKSPACE_A,
        organizationId,
        slaState: 'OPEN',
        openedAt: new Date(),
      },
    });

    const accept = await request(app.getHttpServer())
      .post(`/basic-price-reviews/${review.id}/accept`)
      .set('Authorization', `Bearer ${actorBothToken}`)
      .set('x-workspace-id', WORKSPACE_A)
      .expect(201);
    expect(accept.body.basicPriceStatus).toBe('UNPUBLISHED');
    expect(accept.body.basicPriceVerificationStatus).toBe('VERIFIED');
    const basicPriceId: string = accept.body.basicPriceId;

    const decision =
      await prisma.priceSubmissionReviewDecision.findFirstOrThrow({
        where: { reviewId: review.id, action: 'ACCEPT' },
      });
    expect(decision.decidedByUserId).toBe(actorBothUserId);

    const selfPublish = await request(app.getHttpServer())
      .post(`/basic-price-publications/${basicPriceId}/publish`)
      .set('Authorization', `Bearer ${actorBothToken}`)
      .set('x-workspace-id', WORKSPACE_A)
      .expect(409);
    expect(selfPublish.body.message).toBe('VERIFIER_CANNOT_PUBLISH');

    expect(
      (
        await prisma.basicPrice.findUniqueOrThrow({
          where: { id: basicPriceId },
        })
      ).status,
    ).toBe('UNPUBLISHED');
    expect(
      await prisma.basicPricePublicationAudit.count({
        where: { basicPriceId },
      }),
    ).toBe(0);
  });

  it('concurrent ACCEPT serializes to one success, one deterministic conflict, and exactly one side-effect chain', async () => {
    const { submission, review } = await createOpenReview();
    const originalFindUnique = appPrisma.basicPrice.findUnique.bind(
      appPrisma.basicPrice,
    );
    let arrivals = 0;
    let release!: () => void;
    const bothAtPreLockRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    const preLockSpy = jest
      .spyOn(appPrisma.basicPrice, 'findUnique')
      .mockImplementation((async (args: {
        where: { sourceSubmissionId?: string };
      }) => {
        if (args.where.sourceSubmissionId === submission.id) {
          arrivals += 1;
          if (arrivals === 2) release();
          await bothAtPreLockRead;
        }
        return originalFindUnique(args);
      }) as never);
    const calls = await Promise.all([
      request(app.getHttpServer())
        .post(`/basic-price-reviews/${review.id}/accept`)
        .set('Authorization', `Bearer ${actor2Token}`)
        .set('x-workspace-id', WORKSPACE_A),
      request(app.getHttpServer())
        .post(`/basic-price-reviews/${review.id}/accept`)
        .set('Authorization', `Bearer ${actor2Token}`)
        .set('x-workspace-id', WORKSPACE_A),
    ]).finally(() => preLockSpy.mockRestore());
    expect(calls.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(calls.find((result) => result.status === 409)!.body.message).toBe(
      'ACCEPT_CONCURRENTLY_COMPLETED',
    );
    expect(
      await prisma.priceSubmissionReviewDecision.count({
        where: { reviewId: review.id, action: 'ACCEPT' },
      }),
    ).toBe(1);
    expect(
      await prisma.basicPrice.count({
        where: { sourceSubmissionId: submission.id },
      }),
    ).toBe(1);
    expect(
      await prisma.priceSubmissionAudit.count({
        where: {
          submissionId: submission.id,
          reason: { contains: 'STEP-2.6b_HUMAN_ACCEPT' },
        },
      }),
    ).toBe(1);
    expect(
      (
        await prisma.priceSubmission.findUniqueOrThrow({
          where: { id: submission.id },
        })
      ).status,
    ).toBe('VERIFIED');
  });

  it('concurrent publish serializes to one success, one deterministic conflict, and exactly one audit', async () => {
    const { basicPrice } = await createAcceptedPrice();
    const originalFindFirst = appPrisma.basicPrice.findFirst.bind(
      appPrisma.basicPrice,
    );
    let arrivals = 0;
    let release!: () => void;
    const bothAtPreLockRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    const preLockSpy = jest
      .spyOn(appPrisma.basicPrice, 'findFirst')
      .mockImplementation((async (args: { where?: { id?: string } }) => {
        if (args.where?.id === basicPrice.id) {
          arrivals += 1;
          if (arrivals === 2) release();
          await bothAtPreLockRead;
        }
        return originalFindFirst(args);
      }) as never);
    const calls = await Promise.all([
      request(app.getHttpServer())
        .post(`/basic-price-publications/${basicPrice.id}/publish`)
        .set('Authorization', `Bearer ${actor3Token}`)
        .set('x-workspace-id', WORKSPACE_A),
      request(app.getHttpServer())
        .post(`/basic-price-publications/${basicPrice.id}/publish`)
        .set('Authorization', `Bearer ${actor3Token}`)
        .set('x-workspace-id', WORKSPACE_A),
    ]).finally(() => preLockSpy.mockRestore());
    expect(calls.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(calls.find((result) => result.status === 409)!.body.message).toBe(
      'PUBLICATION_CONCURRENTLY_COMPLETED',
    );
    const finalPrice = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: basicPrice.id },
    });
    expect(finalPrice.status).toBe('PUBLISHED');
    expect(finalPrice.verificationStatus).toBe('PUBLISHED');
    expect(
      await prisma.basicPricePublicationAudit.count({
        where: { basicPriceId: basicPrice.id },
      }),
    ).toBe(1);
  });

  it('rolls back both publication axes when publication-audit persistence fails', async () => {
    const { basicPrice } = await createAcceptedPrice();
    const faultingPrisma = {
      workspaceMembership: prisma.workspaceMembership,
      workspace: prisma.workspace,
      basicPrice: prisma.basicPrice,
      $transaction: (callback: (tx: unknown) => unknown) =>
        prisma.$transaction((realTx) =>
          callback(
            new Proxy(realTx as object, {
              get(target, property, receiver) {
                if (property === 'basicPricePublicationAudit') {
                  return {
                    create: async () => {
                      throw new Error('FORCED_PUBLICATION_AUDIT_FAILURE');
                    },
                  };
                }
                return Reflect.get(target, property, receiver);
              },
            }),
          ),
        ),
    };
    const service = new BasicPricePublicationService(faultingPrisma as never);
    await expect(
      service.publish({
        workspaceId: WORKSPACE_A,
        basicPriceId: basicPrice.id,
        publisherAccountId: actor3AccountId,
      }),
    ).rejects.toThrow('FORCED_PUBLICATION_AUDIT_FAILURE');
    const finalPrice = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: basicPrice.id },
    });
    expect(finalPrice.status).toBe('UNPUBLISHED');
    expect(finalPrice.verificationStatus).toBe('VERIFIED');
    expect(
      await prisma.basicPricePublicationAudit.count({
        where: { basicPriceId: basicPrice.id },
      }),
    ).toBe(0);
  });

  it('REQUEST_CORRECTION blocks direct ACCEPT and preserves NEEDS_CORRECTION with zero ACCEPT side effects', async () => {
    const { submission, review } = await createOpenReview();
    await request(app.getHttpServer())
      .post(`/basic-price-reviews/${review.id}/request-correction`)
      .set('Authorization', `Bearer ${actor2Token}`)
      .set('x-workspace-id', WORKSPACE_A)
      .send({ note: 'correct the source evidence' })
      .expect(201);
    const rejected = await request(app.getHttpServer())
      .post(`/basic-price-reviews/${review.id}/accept`)
      .set('Authorization', `Bearer ${actor2Token}`)
      .set('x-workspace-id', WORKSPACE_A)
      .expect(409);
    expect(rejected.body.message).toBe('CORRECTION_RESUBMISSION_REQUIRED');
    expect(
      (
        await prisma.priceSubmission.findUniqueOrThrow({
          where: { id: submission.id },
        })
      ).status,
    ).toBe('NEEDS_CORRECTION');
    expect(
      await prisma.priceSubmissionReviewDecision.count({
        where: { reviewId: review.id, action: 'ACCEPT' },
      }),
    ).toBe(0);
    expect(
      await prisma.basicPrice.count({
        where: { sourceSubmissionId: submission.id },
      }),
    ).toBe(0);
  });

  it('missing authoritative region or effective date fails closed with zero ACCEPT writes', async () => {
    const noRegion = await createOpenReview({ regionId: null });
    const noRegionResponse = await request(app.getHttpServer())
      .post(`/basic-price-reviews/${noRegion.review.id}/accept`)
      .set('Authorization', `Bearer ${actor2Token}`)
      .set('x-workspace-id', WORKSPACE_A)
      .expect(409);
    expect(noRegionResponse.body.message).toBe(
      'REGION_REQUIRED_OR_EXPLICIT_GENERAL_REGION',
    );
    expect(
      await prisma.basicPrice.count({
        where: { sourceSubmissionId: noRegion.submission.id },
      }),
    ).toBe(0);
    expect(
      await prisma.priceSubmissionReviewDecision.count({
        where: { reviewId: noRegion.review.id },
      }),
    ).toBe(0);

    const noDate = await createOpenReview({ effectiveDate: null });
    const noDateResponse = await request(app.getHttpServer())
      .post(`/basic-price-reviews/${noDate.review.id}/accept`)
      .set('Authorization', `Bearer ${actor2Token}`)
      .set('x-workspace-id', WORKSPACE_A)
      .expect(409);
    expect(noDateResponse.body.message).toBe(
      'EFFECTIVE_DATE_REQUIRED_BEFORE_ACCEPT',
    );
    expect(
      await prisma.basicPrice.count({
        where: { sourceSubmissionId: noDate.submission.id },
      }),
    ).toBe(0);
    expect(
      await prisma.priceSubmissionReviewDecision.count({
        where: { reviewId: noDate.review.id },
      }),
    ).toBe(0);
  });

  it('rejects deterministic cross-tenant verifier evidence without changing publication state', async () => {
    const accepted = await createAcceptedPrice();
    await prisma.priceSubmission.update({
      where: { id: accepted.submission.id },
      data: { workspaceId: WORKSPACE_B },
    });
    const response = await request(app.getHttpServer())
      .post(`/basic-price-publications/${accepted.basicPrice.id}/publish`)
      .set('Authorization', `Bearer ${actor3Token}`)
      .set('x-workspace-id', WORKSPACE_A)
      .expect(409);
    expect(response.body.message).toBe('VERIFIER_EVIDENCE_MISSING');
    const finalPrice = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: accepted.basicPrice.id },
    });
    expect(finalPrice.status).toBe('UNPUBLISHED');
    expect(finalPrice.verificationStatus).toBe('VERIFIED');
    expect(
      await prisma.basicPricePublicationAudit.count({
        where: { basicPriceId: accepted.basicPrice.id },
      }),
    ).toBe(0);
  });

  it('rejects inactive verifier User evidence and preserves both publication axes with zero audit', async () => {
    const accepted = await createAcceptedPrice();
    await prisma.user.update({
      where: { id: actor2UserId },
      data: { status: UserStatus.INACTIVE },
    });
    try {
      const response = await request(getTypedHttpServer())
        .post(`/basic-price-publications/${accepted.basicPrice.id}/publish`)
        .set('Authorization', `Bearer ${actor3Token}`)
        .set('x-workspace-id', WORKSPACE_A)
        .expect(409);
      expect((response.body as unknown as { message: string }).message).toBe(
        'VERIFIER_EVIDENCE_MISSING',
      );
      const finalPrice = await prisma.basicPrice.findUniqueOrThrow({
        where: { id: accepted.basicPrice.id },
      });
      expect(finalPrice.status).toBe('UNPUBLISHED');
      expect(finalPrice.verificationStatus).toBe('VERIFIED');
      expect(
        await prisma.basicPricePublicationAudit.count({
          where: { basicPriceId: accepted.basicPrice.id },
        }),
      ).toBe(0);
    } finally {
      await prisma.user.update({
        where: { id: actor2UserId },
        data: { status: UserStatus.ACTIVE },
      });
    }
  });

  it('rejects inactive publisher User and preserves both publication axes with zero audit', async () => {
    const accepted = await createAcceptedPrice();
    await prisma.user.update({
      where: { id: actor3UserId },
      data: { status: UserStatus.INACTIVE },
    });
    try {
      const response = await request(getTypedHttpServer())
        .post(`/basic-price-publications/${accepted.basicPrice.id}/publish`)
        .set('Authorization', `Bearer ${actor3Token}`)
        .set('x-workspace-id', WORKSPACE_A)
        .expect(403);
      expect((response.body as unknown as { message: string }).message).toBe(
        'PUBLISHER_NOT_ACTIVE_IN_WORKSPACE',
      );
      const finalPrice = await prisma.basicPrice.findUniqueOrThrow({
        where: { id: accepted.basicPrice.id },
      });
      expect(finalPrice.status).toBe('UNPUBLISHED');
      expect(finalPrice.verificationStatus).toBe('VERIFIED');
      expect(
        await prisma.basicPricePublicationAudit.count({
          where: { basicPriceId: accepted.basicPrice.id },
        }),
      ).toBe(0);
    } finally {
      await prisma.user.update({
        where: { id: actor3UserId },
        data: { status: UserStatus.ACTIVE },
      });
    }
  });
});
