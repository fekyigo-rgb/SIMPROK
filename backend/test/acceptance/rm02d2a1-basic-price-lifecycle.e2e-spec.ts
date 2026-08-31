import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AccountStatus,
  MembershipStatus,
  PrismaClient,
  UserStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { BasicPricePublicationService } from '../../src/basic-price/basic-price-publication.service';
import { BasicPricePromotionService } from '../../src/basic-price/basic-price-promotion.service';
import { basicPriceCurrentnessWhere } from '../../src/basic-price/basic-price-currentness';
// C-ASOF-07 — the PRODUCTION resolver, called directly. The propagation proof
// is worthless if it re-implements the candidate query instead of running it.
import { AhspResourceResolutionOrchestrator } from '../../src/project-ahsp/ahsp-resource-resolution.orchestrator';
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
/**
 * C-ASOF-07 — DEDICATED REGIONS, SO THE RESOLVER'S ANSWER IS ABOUT TIME ONLY.
 *
 * The AHSP candidate offer is scoped by (resource, region). Dozens of earlier
 * tests in this suite publish prices for RESOURCE_BOTH_ID in REGION_ID, so a
 * resolution run there is legitimately AMBIGUOUS — and an ambiguous answer
 * proves nothing about whether a future correction rewrote the past. Giving
 * these two proofs their own region makes the candidate set exactly the prices
 * they create, so the only variable left is the `asOf` instant.
 */
const CASOF07_REGION_ID = '42000000-0000-4000-8000-0000000000c7';
const CASOF07_OBSERVATION_REGION_ID = '42000000-0000-4000-8000-0000000000c8';
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
  /**
   * `getHttpServer()` is declared `any`, so handing it straight to supertest
   * passes an unchecked value. Named once with the type it actually returns,
   * matching the idiom the newer suites in this directory already use.
   */
  const server = (): Server => app.getHttpServer() as Server;
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
  /**
   * C-ASOF-07 — the AHSP rows this suite creates to drive the real resolver.
   *
   * Tracked BY ID rather than torn down by workspace: the residual fingerprint
   * gate compares the final database against the seeded baseline, so deleting
   * every AHSP in the workspace would remove seeded rows this suite never owned
   * and turn a clean run into a residual failure. Versions and resources
   * cascade from the AHSP, so these ids are the whole graph.
   */
  const createdAhspIds: string[] = [];
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
      [
        'BASIC_PRICE_REVIEW_VIEW',
        // SMART-SAVE, IN ITS OWN WORKSPACE ONLY. Without both of these the
        // cross-tenant smart-save proof below would be stopped by
        // PermissionsGuard and would prove the guard rather than the batch
        // ownership boundary the command itself must hold. Granting them here
        // widens nothing in Workspace A, which is the whole point: this actor
        // is fully authorized where it lives and still may not touch a batch
        // that lives somewhere else.
        'BASIC_PRICE_RESOLVE',
        'BASIC_PRICE_SUBMIT',
        // BP-CORR-01B: the same reasoning, for the stale-shared-restatement
        // proof. A shared catalog row is national truth, so proving it stops
        // being OFFERED requires a reader in a DIFFERENT tenant than the one
        // that produced it — Workspace A's own actors have the descendant
        // shadowed by promotion precedence and would prove nothing. Granting
        // VIEW here widens nothing in Workspace A.
        'BASIC_PRICE_VIEW',
      ],
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
        sourceOrigin: 'FIELD_REPORT',
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
        sourceOrigin: 'FIELD_REPORT',
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
    // C-ASOF-07 — the resolver fixture, removed before the prices it read.
    // AHSPVersion and AHSPResource cascade from the AHSP, so this one delete
    // takes the whole graph and leaves every seeded row untouched.
    if (createdAhspIds.length > 0) {
      await prisma.aHSP.deleteMany({ where: { id: { in: createdAhspIds } } });
    }
    const suiteResourceIds = [
      RESOURCE_MATERIAL_ID,
      RESOURCE_LABOR_ID,
      RESOURCE_BOTH_ID,
    ];
    // BP-CORR-01 / BP-CORR-01B: DEPENDENTS BEFORE THE ROWS THEY POINT AT.
    //
    // BOTH self-relations are ON DELETE RESTRICT — deliberately, so neither a
    // superseded predecessor nor a promoted origin can be deleted out from
    // under the row that depends on it. That guarantee applies to teardown too:
    // a single deleteMany covering both ends is refused by the database, so the
    // graph is peeled from its leaves inwards. Bounded rather than recursive;
    // the loop simply stops when nothing is left pointing at anything.
    for (let depth = 0; depth < 5; depth += 1) {
      const removed = await prisma.basicPrice.deleteMany({
        where: {
          OR: [
            {
              resourceId: { in: suiteResourceIds },
              supersedesBasicPriceId: { not: null },
            },
            // Shared descendants have a NULL workspaceId, so they are reached
            // by resource and lineage rather than by tenant.
            {
              resourceId: { in: suiteResourceIds },
              promotedFromBasicPriceId: { not: null },
            },
          ],
        },
      });
      if (removed.count === 0) break;
    }
    // PRICES BEFORE BATCHES. A workspace-private BasicPrice carries
    // `sourceImportRowId` — its evidence — so deleting the batch first would
    // orphan that reference and the FK refuses. This suite only began keeping
    // private prices when the rejection-survival proof was added below.
    await prisma.basicPrice.deleteMany({
      where: {
        resourceId: {
          in: [RESOURCE_MATERIAL_ID, RESOURCE_LABOR_ID, RESOURCE_BOTH_ID],
        },
      },
    });
    await prisma.basicPriceImportBatch.deleteMany({
      where: { workspaceId: WORKSPACE_A },
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
    await prisma.region.deleteMany({
      where: {
        id: {
          in: [REGION_ID, CASOF07_REGION_ID, CASOF07_OBSERVATION_REGION_ID],
        },
      },
    });
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
      .field('sourceOrigin', 'FIELD_REPORT')
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
        sourceOrigin: 'FIELD_REPORT',
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
  /**
   * OWNER LAW — A REJECTED PROPOSAL MUST NOT REVOKE A LAWFUL PRIVATE PRICE.
   *
   * The two acts are independent by design: keeping your own imported rows is
   * a workspace-private governed asset, and proposing them to SIMPROK is an
   * optional, separate offer. Until now that separation was proven only
   * STRUCTURALLY — by reading `resolveWithoutBasicPrice` and observing it
   * touches no BasicPrice. Structure is a strong argument and it is not a
   * proof: it says the current code does not do it, not that the running
   * system does not.
   *
   * This runs the whole thing against the real database, through the real
   * routes, with the real distinct actors:
   *
   *   keep-private  →  submit  →  a human REJECTS the proposal  →  is the
   *   private price still there, still private, still readable?
   */
  it('a REJECTED public proposal leaves the workspace-private price intact and usable', async () => {
    /** The shapes this proof reads, declared rather than inferred from `any`. */
    interface PreviewBody {
      batchId: string;
      rows: { id: string; sourceRowNumber: number; version: number }[];
    }
    interface KeptBody {
      createdCount: number;
      prices: { basicPriceId: string }[];
    }
    interface ExplorerBody {
      data: { basicPriceId: string }[];
    }

    // A DISTINCT vendor name, so this is genuinely a second batch rather than
    // a fingerprint replay of the lifecycle batch above.
    const preview = await request(server())
      .post('/basic-price-imports/preview')
      .set('Authorization', `Bearer ${actor1Token}`)
      .set('x-workspace-id', WORKSPACE_A)
      .attach('file', await buildBasicPriceXlsx(), {
        filename: 'basic-price.xlsx',
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .field('selectedSheet', 'HARGA SATUAN UPAH DAN BAHAN')
      .field('sourceVendorName', 'rm02d2a1-private-survives-rejection')
      .field('effectiveDate', '2026-07-25')
      .field('regionId', REGION_ID)
      // FIELD_REPORT: the community-curation door serves this family, which is
      // the only family for which "proposal rejected" is even reachable.
      .field('sourceOrigin', 'FIELD_REPORT')
      .field('sourceType', 'MARKET_SURVEY')
      .expect(201);

    const previewBody = preview.body as PreviewBody;
    const batchId = previewBody.batchId;
    const row = previewBody.rows.find((r) => r.sourceRowNumber === 9)!;

    await request(server())
      .post(`/basic-price-imports/${batchId}/rows/${row.id}/resolve`)
      .set('Authorization', `Bearer ${actor1Token}`)
      .set('x-workspace-id', WORKSPACE_A)
      .send({
        version: row.version,
        resourceCatalogId: RESOURCE_LABOR_ID,
        unitDefinitionId: personDayUnitId,
      })
      .expect(201);
    for (const other of previewBody.rows.filter((r) => r.id !== row.id)) {
      await request(server())
        .post(`/basic-price-imports/${batchId}/rows/${other.id}/reject`)
        .set('Authorization', `Bearer ${actor1Token}`)
        .set('x-workspace-id', WORKSPACE_A)
        .send({ version: other.version, reason: 'out of scope for this proof' })
        .expect(201);
    }

    // 1. KEEP IT. The private asset exists before any proposal is made — which
    //    is the product order too: use your own price first, share second.
    const kept = await request(server())
      .post(`/basic-price-imports/${batchId}/keep-private`)
      .set('Authorization', `Bearer ${actor1Token}`)
      .set('x-workspace-id', WORKSPACE_A)
      .expect(201);
    const keptBody = kept.body as KeptBody;
    expect(keptBody.createdCount).toBe(1);
    const privateBasicPriceId = keptBody.prices[0].basicPriceId;

    // 2. PROPOSE IT. A separate, optional act on the same batch.
    await request(server())
      .post(`/basic-price-imports/${batchId}/submit`)
      .set('Authorization', `Bearer ${actor1Token}`)
      .set('x-workspace-id', WORKSPACE_A)
      .expect(201);

    const submission = await prisma.priceSubmission.findFirstOrThrow({
      where: { importRow: { batchId } },
    });
    const review = await prisma.priceSubmissionReview.findUniqueOrThrow({
      where: { priceSubmissionId: submission.id },
    });

    // 3. REJECT IT — a real second human, through the real review route.
    await request(server())
      .post(`/basic-price-reviews/${review.id}/reject`)
      .set('Authorization', `Bearer ${actor2Token}`)
      .set('x-workspace-id', WORKSPACE_A)
      .send({ note: 'not enough evidence for the shared catalog' })
      .expect(201);

    expect(
      (
        await prisma.priceSubmission.findUniqueOrThrow({
          where: { id: submission.id },
        })
      ).status,
    ).toBe('REJECTED');

    // 4. THE PRIVATE PRICE IS UNTOUCHED — the whole point.
    const surviving = await prisma.basicPrice.findUniqueOrThrow({
      where: { id: privateBasicPriceId },
    });
    expect(surviving.assetScope).toBe('WORKSPACE_PRIVATE');
    expect(surviving.workspaceId).toBe(WORKSPACE_A);
    // Not deleted, not revoked, not demoted, and not quietly re-scoped.
    expect(surviving.status).toBe('UNPUBLISHED');
    expect(surviving.verificationStatus).toBe('UNVERIFIED');

    // 5. AND STILL USABLE, through the normal read a person actually uses —
    //    the rejection changed what SIMPROK will share, not what this
    //    workspace may do with its own price.
    const explorer = await request(server())
      .get('/basic-prices')
      .set('Authorization', `Bearer ${actor1Token}`)
      .set('x-workspace-id', WORKSPACE_A)
      .query({ resourceId: RESOURCE_LABOR_ID })
      .expect(200);
    const ids = (explorer.body as ExplorerBody).data.map(
      (item) => item.basicPriceId,
    );
    expect(ids).toContain(privateBasicPriceId);

    // 6. AND THE REJECTION IS ON THE RECORD. Private survival is not achieved
    //    by forgetting that a curator said no.
    expect(
      await prisma.priceSubmissionReviewDecision.count({
        where: { reviewId: review.id, action: 'REJECT' },
      }),
    ).toBe(1);
  });

  /**
   * ═══ SMART-SAVE, WITHOUT THE OWNER'S WORKBOOK ═══
   *
   * WHY HERE. The only e2e that exercises `smart-save` today is the real 86-row
   * acceptance suite, and that suite skips itself when the gitignored workbook
   * is absent — correctly, because it exists to measure SIMPROK's intelligence
   * against a real document. But the COMMAND's own laws are not about that
   * document at all, and a law proven only on the machine that happens to hold
   * a spreadsheet is not proven. These use the in-repo fixture workbook, so
   * they run wherever this suite runs.
   *
   * WHAT IS DELIBERATELY NOT DUPLICATED. The 13/35/30/8 identity baseline stays
   * where it belongs. Nothing below asks the fixture to be smart: exactly one
   * row is finished BY HAND, which is all these laws need and all they claim.
   */
  describe('SMART-SAVE — the command laws, on the in-repo fixture', () => {
    interface PreviewBody {
      batchId: string;
      rows: { id: string; sourceRowNumber: number; version: number }[];
    }
    interface SmartSaveBody {
      accepted: { acceptedCount: number; excludedCount: number };
      kept: {
        createdCount: number;
        alreadyPrivateCount: number;
        prices: { basicPriceId: string }[];
      };
    }
    interface BatchBody {
      readyForSubmissionRows: number;
      alreadyPrivateRows: number | null;
      actions: {
        privateUse: {
          offered: boolean;
          reasonCode: string | null;
          actionableRows: number | null;
        };
      };
      temporal: { effectiveDateQuestion: string; reverification: string };
      rows: { id: string; status: string; savedAsPrivatePrice: boolean }[];
    }

    /**
     * THE HTTP SERVER, NAMED FOR WHAT IT IS. `app.getHttpServer()` is typed
     * `any`, so every request built from it is an unchecked call on an unknown
     * thing. It is the Node server it has always been, and saying so once here
     * is what lets supertest type-check the requests below. The rest of this
     * file predates the helper and is left exactly as it is.
     */
    const server = (): Server => app.getHttpServer() as Server;

    let batchId = '';
    let finishedRowId = '';
    let openRowId = '';

    const readBatch = async (): Promise<BatchBody> => {
      const response = await request(server())
        .get(`/basic-price-imports/${batchId}`)
        .set('Authorization', `Bearer ${actor1Token}`)
        .set('x-workspace-id', WORKSPACE_A)
        .expect(200);
      return response.body as BatchBody;
    };

    const smartSave = (body: Record<string, unknown> = {}) =>
      request(server())
        .post(`/basic-price-imports/${batchId}/smart-save`)
        .set('Authorization', `Bearer ${actor1Token}`)
        .set('x-workspace-id', WORKSPACE_A)
        .send(body);

    it('G-1. one row finished by hand, the rest left open', async () => {
      // A distinct vendor name, so intake identity treats this as its own
      // import rather than replaying a batch an earlier proof already made.
      const preview = await request(server())
        .post('/basic-price-imports/preview')
        .set('Authorization', `Bearer ${actor1Token}`)
        .set('x-workspace-id', WORKSPACE_A)
        .attach('file', await buildBasicPriceXlsx(), {
          filename: 'basic-price.xlsx',
          contentType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        })
        .field('selectedSheet', 'HARGA SATUAN UPAH DAN BAHAN')
        .field('sourceVendorName', 'rm02d2a1-smart-save-command-laws')
        .field('effectiveDate', '2026-07-25')
        .field('regionId', REGION_ID)
        .field('sourceOrigin', 'FIELD_REPORT')
        .field('sourceType', 'MARKET_SURVEY')
        .expect(201);

      const body = preview.body as PreviewBody;
      batchId = body.batchId;
      const row = body.rows.find((r) => r.sourceRowNumber === 9)!;
      finishedRowId = row.id;
      openRowId = body.rows.find((r) => r.id !== row.id)!.id;

      await request(server())
        .post(`/basic-price-imports/${batchId}/rows/${row.id}/resolve`)
        .set('Authorization', `Bearer ${actor1Token}`)
        .set('x-workspace-id', WORKSPACE_A)
        .send({
          version: row.version,
          resourceCatalogId: RESOURCE_LABOR_ID,
          unitDefinitionId: personDayUnitId,
        })
        .expect(201);

      const batch = await readBatch();
      expect(batch.readyForSubmissionRows).toBe(1);
      // NOTHING STORED YET, and the projection says so as a measured number
      // rather than by omission.
      expect(batch.alreadyPrivateRows).toBe(0);
      expect(batch.actions.privateUse).toMatchObject({
        offered: true,
        reasonCode: null,
        actionableRows: 1,
      });
    });

    /**
     * G-2 — THE BOUNDARY NO GUARD CAN HOLD.
     *
     * `PermissionsAll(RESOLVE, SUBMIT)` proves this account is a member of the
     * workspace it named and holds both capabilities IN it. It has never seen
     * the batch id in the URL. So a fully-authorized member of Workspace B,
     * naming a Workspace A batch, reaches the handler — and the command's own
     * first act must refuse before it reads anything.
     *
     * The ORDER of that refusal (zero measurement queries) cannot be observed
     * over HTTP and is pinned as a call-counter in
     * `basic-price-smart-save-authority.spec.ts`. What this proves is the part
     * a person could actually exploit: the answer, and what it discloses.
     */
    it('G-2. CROSS-WORKSPACE — refused as plain non-existence, disclosing nothing', async () => {
      const response = await request(server())
        .post(`/basic-price-imports/${batchId}/smart-save`)
        .set('Authorization', `Bearer ${crosstenantToken}`)
        .set('x-workspace-id', WORKSPACE_B)
        .send({});

      // 404, never 403: a distinguishable "you may not see this" is itself an
      // existence oracle for another tenant's data.
      expect(response.status).toBe(404);

      const serialized = JSON.stringify(response.body);
      // NOT ONE FACT ABOUT THE FOREIGN BATCH TRAVELS — no progress envelope, no
      // counts, no persistence verdict.
      expect(serialized).not.toContain('smartSave');
      expect(serialized).not.toContain('boundRowsDelta');
      expect(serialized).not.toContain('PARTIAL');

      // AND NOTHING WAS TOUCHED. The batch is exactly as G-1 left it.
      const batch = await readBatch();
      expect(batch.readyForSubmissionRows).toBe(1);
      expect(batch.alreadyPrivateRows).toBe(0);
      expect(
        await prisma.basicPrice.count({
          where: { sourceImportRow: { batchId } },
        }),
      ).toBe(0);
    });

    it('G-3. ONE press stores the finished row', async () => {
      const response = await smartSave().expect(201);
      const outcome = response.body as SmartSaveBody;
      // Nothing was machine-proven in this fixture, and nothing pretends to be:
      // the press stored the row a HUMAN finished.
      expect(outcome.accepted.acceptedCount).toBe(0);
      expect(outcome.kept.createdCount).toBe(1);
      expect(outcome.kept.alreadyPrivateCount).toBe(0);
    });

    /**
     * G-4 — THE DEFECT THE OWNER SAW IN THE BROWSER.
     *
     * A kept row never leaves READY_FOR_SUBMISSION, so the room went on
     * offering to store prices it had just created. The projection now measures
     * what is already stored and answers with the work that is actually left.
     */
    it('G-4. POST-SAVE PROJECTION — nothing is offered as new work', async () => {
      const batch = await readBatch();
      // The row is still ready — that fact is about the SEPARATE curation door
      // and is untouched.
      expect(batch.readyForSubmissionRows).toBe(1);
      // And it is already stored, so one press would achieve nothing.
      expect(batch.alreadyPrivateRows).toBe(1);

      /**
       * AND THE ROW ITSELF KNOWS. A count can correct a button; only a per-row
       * fact can correct the sentence printed beside the row. Without it the
       * room had nothing to render but the internal status, which stays
       * READY_FOR_SUBMISSION forever — so a stored row announced it was
       * `Siap diajukan`, a curation word, about a price already sitting usable
       * in the workspace.
       */
      const stored = batch.rows.find((r) => r.id === finishedRowId);
      expect(stored?.savedAsPrivatePrice).toBe(true);
      // Every other row is untouched by the save and says so.
      for (const row of batch.rows.filter((r) => r.id !== finishedRowId)) {
        expect(row.savedAsPrivatePrice).toBe(false);
      }
      expect(batch.actions.privateUse).toMatchObject({
        offered: false,
        reasonCode: 'ALL_READY_ROWS_ALREADY_PRIVATE',
        actionableRows: 0,
      });
    });

    /**
     * G-5 — AND THE CLARITY IS NOT THE SAFETY BOUNDARY. Withholding the
     * invitation must never be what prevents a duplicate; the command stays
     * idempotent for the stale tab that presses anyway.
     */
    it('G-5. IDEMPOTENT — a press the room no longer offers still duplicates nothing', async () => {
      const response = await smartSave().expect(201);
      const outcome = response.body as SmartSaveBody;
      expect(outcome.kept.createdCount).toBe(0);
      expect(outcome.kept.alreadyPrivateCount).toBe(1);

      expect(
        await prisma.basicPrice.count({
          where: { sourceImportRow: { batchId } },
        }),
      ).toBe(1);
      const perRow = await prisma.basicPrice.groupBy({
        by: ['sourceImportRowId'],
        where: { sourceImportRow: { batchId } },
        _count: { _all: true },
      });
      expect(perRow).toHaveLength(1);
      expect(perRow[0]._count._all).toBe(1);
    });

    /**
     * G-6 — A HUMAN EXCLUSION IS CARRIED AS SCOPE, AND CHANGES NOTHING ELSE.
     *
     * This fixture proves no identities, so there is nothing here the machine
     * WOULD have bound — the full "SIMPROK was certain and the human still
     * won" proof needs machine-proven rows and lives in the real-workbook
     * suite. What this pins is the contract every press depends on: the body
     * may name rows to leave alone, that intent is counted and returned, the
     * named row is untouched, and the keep half runs regardless.
     */
    it('G-6. an excluded row is counted, left open, and blocks nothing else', async () => {
      const response = await smartSave({ excludeRowIds: [openRowId] }).expect(
        201,
      );
      const outcome = response.body as SmartSaveBody;
      expect(outcome.accepted.excludedCount).toBe(1);

      const excluded = await prisma.basicPriceImportRow.findUniqueOrThrow({
        where: { id: openRowId },
        select: { status: true, resourceCatalogId: true },
      });
      expect(excluded.status).toBe('NEEDS_REVIEW');
      expect(excluded.resourceCatalogId).toBeNull();
      expect(
        await prisma.basicPriceImportRowResourceMapping.count({
          where: { rowId: openRowId },
        }),
      ).toBe(0);

      // The row a human DID finish is still stored, and still exactly once.
      expect(
        await prisma.basicPrice.count({
          where: { sourceImportRowId: finishedRowId },
        }),
      ).toBe(1);
    });

    /**
     * G-7 — THE TEMPORAL QUESTION TRAVELS WITH THE BATCH.
     *
     * This batch declares MARKET_SURVEY, so the room must ask when the price
     * was OBSERVED rather than when it "becomes" effective — and the answer is
     * a code the browser turns into words, never prose from the server.
     */
    it('G-7. a survey batch is asked the observation question, not a decree question', async () => {
      const batch = await readBatch();
      expect(batch.temporal).toEqual({
        effectiveDateQuestion: 'OBSERVED_PRICE_DATE',
        // Uploaded by hand, so it ages in silence and the soft date is offered.
        reverification: 'RECOMMENDED',
      });
    });
  });

  /**
   * BP-CORR-01 — PUBLISHED PRICE CORRECTION AND SUPERSESSION, PROVED AGAINST
   * THE REAL DATABASE AND THE REAL HTTP ROUTE.
   *
   * The unit suite pins the writer's contract and the shape of the currentness
   * predicate. What it cannot prove is the part that only a real PostgreSQL can
   * answer: that the migration's constraints actually hold, that the candidate
   * query really stops offering a replaced price, and that the predecessor is
   * still there afterwards with its money untouched. That is this suite's job.
   *
   * It runs on the SAME governed ladder as every other publication here — the
   * price is accepted by Actor 2 and published by Actor 3, and correcting it
   * buys no exemption from either.
   */
  describe('BP-CORR-01 published price correction and supersession', () => {
    const publishAs = (
      basicPriceId: string,
      body: Record<string, unknown> = {},
    ) =>
      request(getTypedHttpServer())
        .post(`/basic-price-publications/${basicPriceId}/publish`)
        .set('Authorization', `Bearer ${actor3Token}`)
        .set('x-workspace-id', WORKSPACE_A)
        .send(body);

    const candidatesForResource = async (): Promise<
      Array<{ id: string; value: string }>
    > => {
      const response = await request(getTypedHttpServer())
        .get(`/basic-prices/by-resource/${RESOURCE_BOTH_ID}`)
        .set('Authorization', `Bearer ${actor3Token}`)
        .set('x-workspace-id', WORKSPACE_A)
        .expect(200);
      return response.body as Array<{ id: string; value: string }>;
    };

    /** An accepted price carrying a distinct value, ready for publication. */
    const acceptedWorth = async (value: string) => {
      const accepted = await createAcceptedPrice();
      await prisma.basicPrice.update({
        where: { id: accepted.basicPrice.id },
        data: { value },
      });
      return accepted;
    };

    it('CUR-01 → CUR-03 — a published correction becomes the current truth and the predecessor stops being offered', async () => {
      const original = await acceptedWorth('78000.00');
      await publishAs(original.basicPrice.id).expect(201);

      // CUR-01 — before any correction, the published price IS the candidate.
      const before = await candidatesForResource();
      expect(before.map((row) => row.id)).toContain(original.basicPrice.id);

      const corrected = await acceptedWorth('80000.00');

      // CUR-02 — the successor exists and is VERIFIED, but is NOT yet
      // published. The predecessor must still be the current truth: a merely
      // PROPOSED correction may never move money.
      const midway = await candidatesForResource();
      expect(midway.map((row) => row.id)).toContain(original.basicPrice.id);
      expect(midway.map((row) => row.id)).not.toContain(
        corrected.basicPrice.id,
      );

      await publishAs(corrected.basicPrice.id, {
        supersedesBasicPriceId: original.basicPrice.id,
      }).expect(201);

      // CUR-03 / CUR-04 — exactly ONE current truth for this context, and it is
      // the correction. The predecessor is not merely deprioritised; it is no
      // longer offered at all, so it cannot compete as a second answer.
      const after = await candidatesForResource();
      const ids = after.map((row) => row.id);
      expect(ids).toContain(corrected.basicPrice.id);
      expect(ids).not.toContain(original.basicPrice.id);
    });

    it('HIST-01/HIST-02 — the superseded predecessor survives, readable by id, with its money and identity untouched', async () => {
      const original = await acceptedWorth('78000.00');
      await publishAs(original.basicPrice.id).expect(201);
      const before = await prisma.basicPrice.findUniqueOrThrow({
        where: { id: original.basicPrice.id },
      });

      const corrected = await acceptedWorth('80000.00');
      await publishAs(corrected.basicPrice.id, {
        supersedesBasicPriceId: original.basicPrice.id,
      }).expect(201);

      // HIST-02 — BYTE-IDENTICAL. Not "still published", not "mostly the same":
      // every column the predecessor had before the correction is exactly what
      // it has after. This is the whole gate in one assertion.
      const after = await prisma.basicPrice.findUniqueOrThrow({
        where: { id: original.basicPrice.id },
      });
      expect(after).toEqual(before);
      expect(after.value.toString()).toBe('78000');
      expect(after.status).toBe('PUBLISHED');
      expect(after.supersedesBasicPriceId).toBeNull();

      // HIST-01 — and it is still REACHABLE. The by-id read is a lawfulness
      // question, not a selection one, so history stays rich even though the
      // candidate list has moved on.
      const detail = await request(getTypedHttpServer())
        .get(`/basic-prices/${original.basicPrice.id}`)
        .set('Authorization', `Bearer ${actor3Token}`)
        .set('x-workspace-id', WORKSPACE_A)
        .expect(200);
      expect((detail.body as { id: string }).id).toBe(original.basicPrice.id);

      // HIST-03 — the successor names its exact predecessor.
      const successor = await prisma.basicPrice.findUniqueOrThrow({
        where: { id: corrected.basicPrice.id },
      });
      expect(successor.supersedesBasicPriceId).toBe(original.basicPrice.id);

      // HIST-04 — the predecessor's history GAINED a line and lost none, and
      // the correction did not forge a PUBLISH audit on it. The Cost Kernel
      // proves a publisher with exactly that lookup, so a forged row here would
      // let a correction answer the two-human ladder on its behalf.
      const audits = await prisma.basicPricePublicationAudit.findMany({
        where: { basicPriceId: original.basicPrice.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(audits.map((audit) => audit.action)).toEqual([
        'PUBLISH',
        'SUPERSEDED',
      ]);
      expect(audits.filter((audit) => audit.action === 'PUBLISH')).toHaveLength(
        1,
      );
    });

    it('CUR-04 — a predecessor may be replaced ONCE; a second successor is refused and nothing is published', async () => {
      const original = await acceptedWorth('78000.00');
      await publishAs(original.basicPrice.id).expect(201);
      const first = await acceptedWorth('80000.00');
      await publishAs(first.basicPrice.id, {
        supersedesBasicPriceId: original.basicPrice.id,
      }).expect(201);

      const second = await acceptedWorth('81000.00');
      const response = await publishAs(second.basicPrice.id, {
        supersedesBasicPriceId: original.basicPrice.id,
      }).expect(409);
      expect((response.body as { message: string }).message).toBe(
        'PREDECESSOR_ALREADY_SUPERSEDED',
      );

      // FAIL CLOSED — the rejected successor is not half-published.
      const rejected = await prisma.basicPrice.findUniqueOrThrow({
        where: { id: second.basicPrice.id },
      });
      expect(rejected.status).toBe('UNPUBLISHED');
      expect(rejected.supersedesBasicPriceId).toBeNull();
      expect(
        await prisma.basicPricePublicationAudit.count({
          where: { basicPriceId: second.basicPrice.id },
        }),
      ).toBe(0);
    });

    it('CUR-02 — an UNPUBLISHED price was never current, so nothing may claim to replace it', async () => {
      const neverPublished = await acceptedWorth('78000.00');
      const successor = await acceptedWorth('80000.00');
      const response = await publishAs(successor.basicPrice.id, {
        supersedesBasicPriceId: neverPublished.basicPrice.id,
      }).expect(409);
      expect((response.body as { message: string }).message).toBe(
        'SUPERSEDED_BASIC_PRICE_NOT_PUBLISHED',
      );
      expect(
        (
          await prisma.basicPrice.findUniqueOrThrow({
            where: { id: successor.basicPrice.id },
          })
        ).status,
      ).toBe('UNPUBLISHED');
    });

    it('HIST-08 — a price cannot supersede itself', async () => {
      const accepted = await acceptedWorth('78000.00');
      const response = await publishAs(accepted.basicPrice.id, {
        supersedesBasicPriceId: accepted.basicPrice.id,
      }).expect(409);
      expect((response.body as { message: string }).message).toBe(
        'SUPERSESSION_SELF_REFERENCE',
      );
    });

    it('§13 — a predecessor in ANOTHER tenant is plain non-existence, never a leak', async () => {
      const original = await acceptedWorth('78000.00');
      await publishAs(original.basicPrice.id).expect(201);
      // Move the published predecessor out of the caller's workspace. The
      // caller still knows its id, which is precisely the attack: naming a row
      // they may not see and having the server confirm it exists.
      await prisma.basicPrice.update({
        where: { id: original.basicPrice.id },
        data: { workspaceId: WORKSPACE_B },
      });
      try {
        const successor = await acceptedWorth('80000.00');
        await publishAs(successor.basicPrice.id, {
          supersedesBasicPriceId: original.basicPrice.id,
        }).expect(404);
      } finally {
        await prisma.basicPrice.update({
          where: { id: original.basicPrice.id },
          data: { workspaceId: WORKSPACE_A },
        });
      }
    });

    it('CUR-08 — a genuinely later observation is NOT a correction: both prices remain lawful and compete', async () => {
      const january = await acceptedWorth('78000.00');
      await prisma.basicPrice.update({
        where: { id: january.basicPrice.id },
        data: { effectiveDate: new Date('2026-01-15T00:00:00.000Z') },
      });
      await publishAs(january.basicPrice.id).expect(201);

      const march = await acceptedWorth('82000.00');
      await prisma.basicPrice.update({
        where: { id: march.basicPrice.id },
        data: { effectiveDate: new Date('2026-03-15T00:00:00.000Z') },
      });
      // Published with NO predecessor named — because March being dearer than
      // January does not mean January was WRONG. SIMPROK must not infer a
      // correction from a date, and the human did not declare one.
      await publishAs(march.basicPrice.id).expect(201);

      const ids = (await candidatesForResource()).map((row) => row.id);
      expect(ids).toContain(january.basicPrice.id);
      expect(ids).toContain(march.basicPrice.id);

      // Neither row was touched by the other's publication.
      for (const id of [january.basicPrice.id, march.basicPrice.id]) {
        const row = await prisma.basicPrice.findUniqueOrThrow({
          where: { id },
        });
        expect(row.supersedesBasicPriceId).toBeNull();
        expect(
          await prisma.basicPricePublicationAudit.count({
            where: { basicPriceId: id, action: 'SUPERSEDED' },
          }),
        ).toBe(0);
      }
    });

    it('IDEM-01/IDEM-04 — an exact repeat is idempotent; a repeat naming a different predecessor is refused', async () => {
      const original = await acceptedWorth('78000.00');
      await publishAs(original.basicPrice.id).expect(201);
      const corrected = await acceptedWorth('80000.00');
      await publishAs(corrected.basicPrice.id, {
        supersedesBasicPriceId: original.basicPrice.id,
      }).expect(201);

      // IDEM-01/02 — the same act again changes nothing and duplicates nothing.
      await publishAs(corrected.basicPrice.id, {
        supersedesBasicPriceId: original.basicPrice.id,
      }).expect(201);
      expect(
        await prisma.basicPricePublicationAudit.count({
          where: { basicPriceId: corrected.basicPrice.id },
        }),
      ).toBe(1);
      expect(
        await prisma.basicPricePublicationAudit.count({
          where: { basicPriceId: original.basicPrice.id, action: 'SUPERSEDED' },
        }),
      ).toBe(1);

      // IDEM-04 — a settled correction may not be quietly re-pointed, and it
      // may not be retracted to "corrects nothing" either.
      const other = await acceptedWorth('79000.00');
      await publishAs(other.basicPrice.id).expect(201);
      const repointed = await publishAs(corrected.basicPrice.id, {
        supersedesBasicPriceId: other.basicPrice.id,
      }).expect(409);
      expect((repointed.body as { message: string }).message).toBe(
        'SUPERSESSION_ALREADY_SETTLED',
      );
      const retracted = await publishAs(corrected.basicPrice.id).expect(409);
      expect((retracted.body as { message: string }).message).toBe(
        'SUPERSESSION_ALREADY_SETTLED',
      );
      expect(
        (
          await prisma.basicPrice.findUniqueOrThrow({
            where: { id: corrected.basicPrice.id },
          })
        ).supersedesBasicPriceId,
      ).toBe(original.basicPrice.id);
    });

    /**
     * BP-CORR-01B GAP A — A SHARED RESTATEMENT IS NOT AN INDEPENDENT
     * OBSERVATION.
     *
     * `S.promotedFromBasicPriceId = A.id` says, in the database, that S is a
     * COPY of A admitted into the shared catalog. It carries A's money and
     * decided nothing of its own. So the moment A stops being current — because
     * a human published a correction of it — S is restating a truth SIMPROK has
     * already replaced, and continuing to offer it to other tenants would spread
     * exactly the number that was corrected away.
     *
     * S is still perfectly LAWFUL, and still readable. It has simply stopped
     * being an answer to "what does this cost now".
     */
    const promoteToShared = async (basicPriceId: string) => {
      const promotion = app.get(BasicPricePromotionService);
      const result = await promotion.promoteToSharedCatalog({
        workspaceId: WORKSPACE_A,
        basicPriceId,
        actorAccountId: actor3AccountId,
      });
      return result.shared;
    };

    /** What Workspace B — a genuinely different tenant — is offered. */
    const sharedCandidatesForOtherTenant = async (): Promise<string[]> => {
      const response = await request(getTypedHttpServer())
        .get(`/basic-prices/by-resource/${RESOURCE_BOTH_ID}`)
        .set('Authorization', `Bearer ${crosstenantToken}`)
        .set('x-workspace-id', WORKSPACE_B)
        .expect(200);
      return (response.body as Array<{ id: string }>).map((row) => row.id);
    };

    it('A-02 → A-04 — a shared descendant stops being offered once its exact origin is superseded', async () => {
      const origin = await acceptedWorth('78000.00');
      await publishAs(origin.basicPrice.id).expect(201);
      const shared = await promoteToShared(origin.basicPrice.id);

      // A-02 — while the origin is current, the other tenant is offered the
      // shared restatement. This is the whole point of promoting it.
      expect(await sharedCandidatesForOtherTenant()).toContain(shared.id);

      const corrected = await acceptedWorth('80000.00');
      await publishAs(corrected.basicPrice.id, {
        supersedesBasicPriceId: origin.basicPrice.id,
      }).expect(201);

      // A-04 — THE GAP. S was never itself superseded, so a currentness rule
      // that only asks "was I replaced" leaves it standing. It must instead ask
      // the question its lineage makes unavoidable: is the thing I am a copy of
      // still current?
      const afterIds = await sharedCandidatesForOtherTenant();
      expect(afterIds).not.toContain(shared.id);

      // A-07 / A-08 — and the correction is NOT handed to them in its place.
      // Sharing is an explicit governed act, never a side effect of correcting.
      expect(afterIds).not.toContain(corrected.basicPrice.id);
    });

    it('A-05 / A-06 — the stale shared descendant survives, stays readable, and keeps pointing at its original origin', async () => {
      const origin = await acceptedWorth('78000.00');
      await publishAs(origin.basicPrice.id).expect(201);
      const shared = await promoteToShared(origin.basicPrice.id);
      const before = await prisma.basicPrice.findUniqueOrThrow({
        where: { id: shared.id },
      });

      const corrected = await acceptedWorth('80000.00');
      await publishAs(corrected.basicPrice.id, {
        supersedesBasicPriceId: origin.basicPrice.id,
      }).expect(201);

      // A-06 — BYTE-IDENTICAL. The lineage is historical truth: S was promoted
      // from A and always will have been. It is never retargeted at B.
      const after = await prisma.basicPrice.findUniqueOrThrow({
        where: { id: shared.id },
      });
      expect(after).toEqual(before);
      expect(after.promotedFromBasicPriceId).toBe(origin.basicPrice.id);
      expect(after.status).toBe('PUBLISHED');
      expect(after.value.toString()).toBe('78000');

      // A-05 — still lawful, still readable by id. Suppression is a SELECTION
      // rule; it never reaches the lawfulness question.
      const detail = await request(getTypedHttpServer())
        .get(`/basic-prices/${shared.id}`)
        .set('Authorization', `Bearer ${crosstenantToken}`)
        .set('x-workspace-id', WORKSPACE_B)
        .expect(200);
      expect((detail.body as { id: string }).id).toBe(shared.id);
    });

    it('A-09 / A-10 — an unrelated shared row of the same resource and the same value is untouched', async () => {
      // Two independently observed prices that happen to cost the same are two
      // different truths. Suppression is exact-lineage only, so correcting one
      // origin must not silently take the other off the shelf.
      const unrelated = await acceptedWorth('78000.00');
      await publishAs(unrelated.basicPrice.id).expect(201);
      const unrelatedShared = await promoteToShared(unrelated.basicPrice.id);

      const origin = await acceptedWorth('78000.00');
      await publishAs(origin.basicPrice.id).expect(201);
      const originShared = await promoteToShared(origin.basicPrice.id);

      const corrected = await acceptedWorth('80000.00');
      await publishAs(corrected.basicPrice.id, {
        supersedesBasicPriceId: origin.basicPrice.id,
      }).expect(201);

      const ids = await sharedCandidatesForOtherTenant();
      expect(ids).not.toContain(originShared.id);
      // Same resource, same money, no lineage to the superseded origin — so it
      // is still current, and must be.
      expect(ids).toContain(unrelatedShared.id);
    });

    /**
     * BP-CORR-01B GAP B — WITHDRAWAL WITHOUT REPLACEMENT.
     *
     * A source can retract a price without anyone knowing the right number
     * instead. SIMPROK must be able to say "this is no longer offered" without
     * inventing a successor to say it with.
     */
    const withdraw = async (
      basicPriceId: string,
      reason = 'Source retracted',
      effectiveAt?: Date,
    ) => {
      const publication = app.get(BasicPricePublicationService);
      return publication.withdraw({
        workspaceId: WORKSPACE_A,
        basicPriceId,
        actorAccountId: actor3AccountId,
        reason,
        effectiveAt,
      });
    };

    /**
     * BP-CORR-01B TEMPORAL — the PRODUCTION currentness predicate, executed
     * against real PostgreSQL for an arbitrary business `asOf`.
     *
     * This is the same exported function every consumer composes, not a
     * re-implementation: the AHSP candidate offer builds its query from exactly
     * this. It is exercised directly because the two HTTP read routes both
     * project the PRESENT — they have no business date to pass — so the one
     * case that actually distinguishes "when we learned it" from "when it
     * became true" (an as-of that falls BETWEEN the two) is unreachable through
     * them by construction.
     */
    const isCurrentAsOf = async (basicPriceId: string, asOf: Date) => {
      const row = await prisma.basicPrice.findFirst({
        where: { id: basicPriceId, ...basicPriceCurrentnessWhere({ asOf }) },
        select: { id: true },
      });
      return row !== null;
    };

    it('W-01 → W-06 — a withdrawn price stops being offered while staying published, stored and readable', async () => {
      const price = await acceptedWorth('78000.00');
      await publishAs(price.basicPrice.id).expect(201);

      // W-01 — current before withdrawal.
      expect((await candidatesForResource()).map((row) => row.id)).toContain(
        price.basicPrice.id,
      );
      const before = await prisma.basicPrice.findUniqueOrThrow({
        where: { id: price.basicPrice.id },
      });

      // W-02 — withdrawn, with NO successor created.
      const result = await withdraw(price.basicPrice.id);
      expect(result.created).toBe(true);

      // W-11 — nothing was invented to represent the absence.
      expect(
        await prisma.basicPrice.count({
          where: { supersedesBasicPriceId: price.basicPrice.id },
        }),
      ).toBe(0);

      // W-03 / W-04 — the row survives, byte-identical. It is still PUBLISHED:
      // withdrawal is not un-publishing and not rejection.
      const after = await prisma.basicPrice.findUniqueOrThrow({
        where: { id: price.basicPrice.id },
      });
      expect(after).toEqual(before);
      expect(after.status).toBe('PUBLISHED');
      expect(after.verificationStatus).toBe('PUBLISHED');
      expect(after.value.toString()).toBe('78000');

      // W-06 — but it is no longer offered.
      expect(
        (await candidatesForResource()).map((row) => row.id),
      ).not.toContain(price.basicPrice.id);

      // W-05 — and it is still readable by id, for every lawful historical use.
      const detail = await request(getTypedHttpServer())
        .get(`/basic-prices/${price.basicPrice.id}`)
        .set('Authorization', `Bearer ${actor3Token}`)
        .set('x-workspace-id', WORKSPACE_A)
        .expect(200);
      expect((detail.body as { id: string }).id).toBe(price.basicPrice.id);
    });

    it('W-08 — withdrawal replay is idempotent and leaves exactly one governance record', async () => {
      const price = await acceptedWorth('78000.00');
      await publishAs(price.basicPrice.id).expect(201);
      expect((await withdraw(price.basicPrice.id)).created).toBe(true);
      expect((await withdraw(price.basicPrice.id)).created).toBe(false);
      expect(
        await prisma.basicPricePublicationAudit.count({
          where: { basicPriceId: price.basicPrice.id, action: 'WITHDRAWN' },
        }),
      ).toBe(1);
      // The PUBLISH audit is untouched — history gained a line and lost none.
      expect(
        await prisma.basicPricePublicationAudit.count({
          where: { basicPriceId: price.basicPrice.id, action: 'PUBLISH' },
        }),
      ).toBe(1);
    });

    it('GAP A + GAP B compose — a shared descendant of a WITHDRAWN origin also stops being offered, and stays readable', async () => {
      const origin = await acceptedWorth('78000.00');
      await publishAs(origin.basicPrice.id).expect(201);
      const shared = await promoteToShared(origin.basicPrice.id);
      expect(await sharedCandidatesForOtherTenant()).toContain(shared.id);

      await withdraw(origin.basicPrice.id);

      // The restatement follows its origin out of candidacy — the SAME rule as
      // supersession, in the SAME composition, not a second shadow engine.
      expect(await sharedCandidatesForOtherTenant()).not.toContain(shared.id);

      // Still lawful, still readable, lineage untouched.
      const after = await prisma.basicPrice.findUniqueOrThrow({
        where: { id: shared.id },
      });
      expect(after.promotedFromBasicPriceId).toBe(origin.basicPrice.id);
      await request(getTypedHttpServer())
        .get(`/basic-prices/${shared.id}`)
        .set('Authorization', `Bearer ${crosstenantToken}`)
        .set('x-workspace-id', WORKSPACE_B)
        .expect(200);
    });

    /**
     * BP-CORR-01B TEMPORAL — WHEN WE LEARNED IT vs WHEN IT BECAME TRUE.
     *
     * The source states a retraction effective 1 August. SIMPROK is told on
     * 5 August (the real recording instant — these tests do not fake the
     * clock). The decisive question is 3 August: after the withdrawal took
     * effect, but before SIMPROK knew about it.
     */
    const AUG_01 = new Date('2026-08-01T00:00:00.000Z');
    const JUL_31 = new Date('2026-07-31T00:00:00.000Z');
    const AUG_03 = new Date('2026-08-03T00:00:00.000Z');
    const AUG_06 = new Date('2026-08-06T00:00:00.000Z');

    it('T-01 → T-04 — a backdated withdrawal takes effect from the date the SOURCE stated, not the date SIMPROK was told', async () => {
      const price = await acceptedWorth('78000.00');
      await publishAs(price.basicPrice.id).expect(201);
      const id = price.basicPrice.id;

      const result = await withdraw(
        id,
        'Source retracted its July list',
        AUG_01,
      );
      const audit = await prisma.basicPricePublicationAudit.findFirstOrThrow({
        where: { basicPriceId: id, action: 'WITHDRAWN' },
      });
      // The two facts are genuinely different rows-worth of truth: the stated
      // effective date is in the past, the recording instant is now.
      expect(audit.effectiveAt).toEqual(AUG_01);
      expect(audit.createdAt.getTime()).toBeGreaterThan(AUG_01.getTime());
      expect(result.created).toBe(true);

      // T-01 — before the effective point, the price was legitimately current.
      expect(await isCurrentAsOf(id, JUL_31)).toBe(true);
      // T-02 — the effective instant itself is already in force.
      expect(await isCurrentAsOf(id, AUG_01)).toBe(false);
      // T-03 — THE DECISIVE CASE. After it became true, before we were told.
      // The old `createdAt` comparison offered this price here; that was the
      // defect, and four days of withdrawn money is what it cost.
      expect(await isCurrentAsOf(id, AUG_03)).toBe(false);
      // T-04 — and after the recording instant, unchanged.
      expect(await isCurrentAsOf(id, AUG_06)).toBe(false);
    });

    it('T-05 — a FUTURE-dated withdrawal does not suppress too early, including in the present-tense HTTP read', async () => {
      const price = await acceptedWorth('78000.00');
      await publishAs(price.basicPrice.id).expect(201);
      const id = price.basicPrice.id;

      const nextYear = new Date('2099-01-04T00:00:00.000Z');
      await withdraw(id, 'Retraction announced ahead of time', nextYear);

      // Recorded now, effective far in the future. Suppressing on the mere
      // EXISTENCE of the record — which is what the first implementation did
      // when no as-of was supplied — would remove the price today.
      expect(await isCurrentAsOf(id, new Date())).toBe(true);
      // The effective instant itself, and everything after it, is in force.
      expect(await isCurrentAsOf(id, nextYear)).toBe(false);
      expect(
        await isCurrentAsOf(id, new Date('2099-06-01T00:00:00.000Z')),
      ).toBe(false);

      // And the real present-tense HTTP route agrees: still offered today.
      expect((await candidatesForResource()).map((row) => row.id)).toContain(
        id,
      );
    });

    it('T-06 — with no stated effective time, the governed decision instant is recorded and the price stops being offered now', async () => {
      const price = await acceptedWorth('78000.00');
      await publishAs(price.basicPrice.id).expect(201);
      const id = price.basicPrice.id;
      const before = new Date();

      await withdraw(id);

      const audit = await prisma.basicPricePublicationAudit.findFirstOrThrow({
        where: { basicPriceId: id, action: 'WITHDRAWN' },
      });
      // Never null — a null would fail OPEN in the projection and the
      // withdrawal would govern nothing.
      expect(audit.effectiveAt).not.toBeNull();
      expect(audit.effectiveAt!.getTime()).toBeGreaterThanOrEqual(
        before.getTime() - 1000,
      );
      expect(
        (await candidatesForResource()).map((row) => row.id),
      ).not.toContain(id);
    });

    it('T-07 — a shared descendant follows its origin on the ORIGIN’s effective clock', async () => {
      const origin = await acceptedWorth('78000.00');
      await publishAs(origin.basicPrice.id).expect(201);
      const shared = await promoteToShared(origin.basicPrice.id);

      await withdraw(origin.basicPrice.id, 'Source retracted', AUG_01);

      // Before the origin's effective point the restatement was still lawful
      // truth for other tenants; from that point it is not.
      expect(await isCurrentAsOf(shared.id, JUL_31)).toBe(true);
      expect(await isCurrentAsOf(shared.id, AUG_03)).toBe(false);

      // T-08 — and the descendant survives, readable, lineage intact.
      const after = await prisma.basicPrice.findUniqueOrThrow({
        where: { id: shared.id },
      });
      expect(after.promotedFromBasicPriceId).toBe(origin.basicPrice.id);
      await request(getTypedHttpServer())
        .get(`/basic-prices/${shared.id}`)
        .set('Authorization', `Bearer ${crosstenantToken}`)
        .set('x-workspace-id', WORKSPACE_B)
        .expect(200);
    });

    it('T-10 — a withdrawal at any effective time mutates no published economic fact', async () => {
      const price = await acceptedWorth('78000.00');
      await publishAs(price.basicPrice.id).expect(201);
      const before = await prisma.basicPrice.findUniqueOrThrow({
        where: { id: price.basicPrice.id },
      });

      await withdraw(price.basicPrice.id, 'Source retracted', AUG_01);

      const after = await prisma.basicPrice.findUniqueOrThrow({
        where: { id: price.basicPrice.id },
      });
      expect(after).toEqual(before);
    });

    it('T-11 — a replay naming a DIFFERENT effective time is refused; the first governed decision stands', async () => {
      const price = await acceptedWorth('78000.00');
      await publishAs(price.basicPrice.id).expect(201);
      const id = price.basicPrice.id;
      await withdraw(id, 'Source retracted', AUG_01);

      await expect(withdraw(id, 'Source retracted', AUG_06)).rejects.toThrow(
        'WITHDRAWAL_ALREADY_SETTLED',
      );

      const audits = await prisma.basicPricePublicationAudit.findMany({
        where: { basicPriceId: id, action: 'WITHDRAWN' },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0].effectiveAt).toEqual(AUG_01);
    });

    it('the database itself refuses a WITHDRAWN governance record with no effective time', async () => {
      const price = await acceptedWorth('78000.00');
      await publishAs(price.basicPrice.id).expect(201);
      // Straight at the table, bypassing the writer: the constraint must hold
      // even against a future writer that forgets.
      await expect(
        prisma.basicPricePublicationAudit.create({
          data: {
            basicPriceId: price.basicPrice.id,
            action: 'WITHDRAWN',
            actorAccountId: actor3AccountId,
            reason: 'no effective time',
          },
        }),
      ).rejects.toThrow();
    });

    it('W-09 — a price belonging to another tenant cannot be withdrawn, and learns nothing about itself', async () => {
      const price = await acceptedWorth('78000.00');
      await publishAs(price.basicPrice.id).expect(201);
      await prisma.basicPrice.update({
        where: { id: price.basicPrice.id },
        data: { workspaceId: WORKSPACE_B },
      });
      try {
        await expect(withdraw(price.basicPrice.id)).rejects.toThrow(
          'BasicPrice not found',
        );
        expect(
          await prisma.basicPricePublicationAudit.count({
            where: { basicPriceId: price.basicPrice.id, action: 'WITHDRAWN' },
          }),
        ).toBe(0);
      } finally {
        await prisma.basicPrice.update({
          where: { id: price.basicPrice.id },
          data: { workspaceId: WORKSPACE_A },
        });
      }
    });

    it('A-12 — no production route reaches shared promotion; AUTH-C stays locked', async () => {
      await request(getTypedHttpServer())
        .post(`/basic-prices/${RESOURCE_BOTH_ID}/promote-shared`)
        .set('Authorization', `Bearer ${actor3Token}`)
        .set('x-workspace-id', WORKSPACE_A)
        .expect(404);
    });

    /**
     * ═══════════════════════════════════════════════════════════════════════
     * BP-UX-FINAL-01D — A CORRECTION MADE TODAY MUST NOT REWRITE YESTERDAY.
     * ═══════════════════════════════════════════════════════════════════════
     *
     * THE DEFECT THESE KILL. Reason 1 of the currentness predicate used to read
     * `supersededBy: { is: null }` — absolute, with no date beside it. Reasons 2
     * and 3 already took an `asOf`. So publishing a correction TODAY silently
     * deleted the predecessor from every HISTORICAL answer, right back to the
     * day it was first published. A lens that borrows tomorrow's knowledge is
     * not a historical lens.
     *
     * THE ANCHOR, AND WHY IT IS NOT FAKED. The governance instant is the
     * PREDECESSOR's own SUPERSEDED audit `createdAt`, written by the publication
     * transaction. These tests never move the clock: they publish for real, READ
     * the instant PostgreSQL recorded, and then ask the production predicate
     * about the moments either side of it. That is the only way to prove the
     * boundary rather than to assert it.
     *
     * The predicate is exercised through `isCurrentAsOf`, which composes the
     * exact exported function the AHSP candidate offer composes — not a
     * re-implementation. It also exercises a Prisma shape no unit test can
     * prove: a to-one `isNot` that travels through the successor and back to
     * the predecessor. Only real PostgreSQL can say whether that resolves.
     */
    const supersessionInstantOf = async (predecessorId: string) => {
      const audit = await prisma.basicPricePublicationAudit.findFirstOrThrow({
        where: { basicPriceId: predecessorId, action: 'SUPERSEDED' },
      });
      // The one action whose currentness is timed by when it was RECORDED.
      // Schema law refuses it an `effectiveAt`, so this asserts the absence
      // rather than trusting it.
      expect(audit.effectiveAt).toBeNull();
      return audit.createdAt;
    };

    /** A published price, corrected by a second published price. */
    const publishThenCorrect = async () => {
      const original = await acceptedWorth('78000.00');
      await publishAs(original.basicPrice.id).expect(201);
      const corrected = await acceptedWorth('80000.00');
      await publishAs(corrected.basicPrice.id, {
        supersedesBasicPriceId: original.basicPrice.id,
      }).expect(201);
      return {
        predecessorId: original.basicPrice.id,
        successorId: corrected.basicPrice.id,
        transitionAt: await supersessionInstantOf(original.basicPrice.id),
      };
    };

    const ONE_SECOND = 1_000;

    /**
     * A resolved money value as its exact decimal TEXT.
     *
     * `sourcePriceValue` is a Prisma `Decimal` at runtime behind a loosely
     * typed create-input field, so it is narrowed to something that provably
     * has a `toString` before being read — never coerced through `Number`,
     * which is the one thing money may not survive.
     */
    const decimalText = (value: unknown): string | null =>
      value === null || value === undefined
        ? null
        : (value as { toString(): string }).toString();

    it('C-ASOF-01 — a published price with no correction is current at every instant', async () => {
      const price = await acceptedWorth('78000.00');
      await publishAs(price.basicPrice.id).expect(201);
      const id = price.basicPrice.id;

      expect(await isCurrentAsOf(id, JUL_31)).toBe(true);
      expect(await isCurrentAsOf(id, new Date())).toBe(true);
      expect(
        await isCurrentAsOf(id, new Date('2099-01-01T00:00:00.000Z')),
      ).toBe(true);
    });

    it('C-ASOF-02 — BEFORE the governed instant, the predecessor was genuinely current', async () => {
      const { predecessorId, transitionAt } = await publishThenCorrect();

      // THE DECISIVE CASE. On this date SIMPROK really did offer this price:
      // the correction had not been made, let alone recorded. Answering "not
      // current" here would be reconstructing the past out of knowledge that
      // did not exist in it.
      const justBefore = new Date(transitionAt.getTime() - ONE_SECOND);
      expect(await isCurrentAsOf(predecessorId, justBefore)).toBe(true);
      // And far earlier, for good measure — the price's own history is intact.
      expect(await isCurrentAsOf(predecessorId, JUL_31)).toBe(true);
    });

    it('C-ASOF-03 — the governed instant ITSELF is already in force', async () => {
      const { predecessorId, transitionAt } = await publishThenCorrect();
      // `lte`, the same boundary the withdrawal clause uses (T-02). One rule,
      // one direction, no off-by-one between the two verbs.
      expect(await isCurrentAsOf(predecessorId, transitionAt)).toBe(false);
    });

    it('C-ASOF-04 — after the governed instant the predecessor stays suppressed', async () => {
      const { predecessorId, transitionAt } = await publishThenCorrect();

      expect(
        await isCurrentAsOf(
          predecessorId,
          new Date(transitionAt.getTime() + ONE_SECOND),
        ),
      ).toBe(false);
      expect(await isCurrentAsOf(predecessorId, new Date())).toBe(false);
      expect(
        await isCurrentAsOf(
          predecessorId,
          new Date('2099-01-01T00:00:00.000Z'),
        ),
      ).toBe(false);

      // C-ASOF-06 — and the PRESENT-tense HTTP read agrees: the correction is
      // in force today, so the room offers the successor and not the original.
      const ids = (await candidatesForResource()).map((row) => row.id);
      expect(ids).not.toContain(predecessorId);
    });

    it('C-ASOF-06 — a correction never rewrites the historical Explorer answer', async () => {
      // The Explorer's own composition, not a hand-rolled where clause: the
      // same eligibility + precedence + currentness the room actually runs.
      const { predecessorId, successorId, transitionAt } =
        await publishThenCorrect();

      const explorerAsOf = async (asOf: Date) => {
        const rows = await prisma.basicPrice.findMany({
          where: {
            id: { in: [predecessorId, successorId] },
            ...basicPriceCurrentnessWhere({ asOf }),
          },
          select: { id: true },
        });
        return rows.map((row) => row.id);
      };

      const before = await explorerAsOf(
        new Date(transitionAt.getTime() - ONE_SECOND),
      );
      expect(before).toContain(predecessorId);

      const after = await explorerAsOf(new Date());
      expect(after).not.toContain(predecessorId);
      expect(after).toContain(successorId);
    });

    it('C-ASOF-05 — an ordinary LATER observation suppresses nothing, at any instant', async () => {
      // No pointer, so no correction. A March observation never proves the
      // January one was wrong, and both stay lawfully current side by side.
      const first = await acceptedWorth('78000.00');
      await publishAs(first.basicPrice.id).expect(201);
      const later = await acceptedWorth('81000.00');
      await publishAs(later.basicPrice.id).expect(201);

      expect(
        await prisma.basicPricePublicationAudit.count({
          where: { basicPriceId: first.basicPrice.id, action: 'SUPERSEDED' },
        }),
      ).toBe(0);
      expect(await isCurrentAsOf(first.basicPrice.id, new Date())).toBe(true);
      expect(await isCurrentAsOf(first.basicPrice.id, JUL_31)).toBe(true);
      expect(await isCurrentAsOf(later.basicPrice.id, new Date())).toBe(true);
    });

    it('C-ASOF-08 / C-ASOF-09 — a promoted descendant follows its origin on the ORIGIN’s governed clock', async () => {
      const origin = await acceptedWorth('78000.00');
      await publishAs(origin.basicPrice.id).expect(201);
      const shared = await promoteToShared(origin.basicPrice.id);

      const corrected = await acceptedWorth('80000.00');
      await publishAs(corrected.basicPrice.id, {
        supersedesBasicPriceId: origin.basicPrice.id,
      }).expect(201);
      const transitionAt = await supersessionInstantOf(origin.basicPrice.id);

      // C-ASOF-08 — before the origin's governance instant the restatement was
      // lawful truth for other tenants, and a historical answer must say so.
      expect(
        await isCurrentAsOf(
          shared.id,
          new Date(transitionAt.getTime() - ONE_SECOND),
        ),
      ).toBe(true);
      // C-ASOF-09 — from that instant it is restating corrected-away money.
      expect(await isCurrentAsOf(shared.id, transitionAt)).toBe(false);
      expect(await isCurrentAsOf(shared.id, new Date())).toBe(false);
      expect(await sharedCandidatesForOtherTenant()).not.toContain(shared.id);
    });

    /**
     * C-ASOF-07 — A CORRECTION PUBLISHED TODAY MUST NOT REWRITE THE CANDIDATE
     * OFFER A RESOLUTION WAS LAWFULLY GIVEN FOR AN EARLIER BUSINESS DATE.
     *
     * WHY THIS IS THE ONE PROOF THE OTHERS DO NOT GIVE. C-ASOF-01…12 exercise
     * the currentness predicate itself. This one proves it PROPAGATES: that the
     * AHSP resource-price decision — the seam where Basic Price money actually
     * enters a calculation — inherits the temporal law rather than quietly
     * answering with today's knowledge.
     *
     * NOTHING IS MOCKED. It calls the production
     * `AhspResourceResolutionOrchestrator.resolveVersionResources`, the same
     * method the occurrence path and the RAB pre-lock gate both call, against
     * real PostgreSQL. The candidate offer is built by that method's own
     * composition of eligibility + precedence + currentness + applicability; a
     * hand-rolled where clause here would prove only that the test agrees with
     * itself.
     *
     * THE FIXTURE IS SHAPED SO THE ANSWER IS UNAMBIGUOUS. The correction B
     * carries a LATER effective date than the historical business date D, so on
     * D exactly one price was ever applicable — A. If the future correction
     * leaked backwards, D would resolve to nothing (A suppressed, B not yet
     * applicable) rather than to A, and the failure would be loud.
     */
    it('C-ASOF-07 — a future correction never rewrites an earlier AHSP candidate offer', async () => {
      const orchestrator = app.get(AhspResourceResolutionOrchestrator);

      // A real AHSP version whose resource identifies the very catalog row the
      // lifecycle prices sit on — same name, type and unit, so identity
      // RESOLVES by its own authority rather than by anything this test asserts.
      const ahsp = await prisma.aHSP.create({
        data: {
          workspaceId: WORKSPACE_A,
          workType: `${'C-ASOF-07'} work`,
          methodType: 'MANUAL',
          locationType: 'GENERAL',
          methodName: 'C-ASOF-07 method',
        },
      });
      createdAhspIds.push(ahsp.id);
      const version = await prisma.aHSPVersion.create({
        data: {
          ahspId: ahsp.id,
          workspaceId: WORKSPACE_A,
          versionNumber: 1,
          outputUnit: 'Lbr',
        },
      });
      const ahspResource = await prisma.aHSPResource.create({
        data: {
          ahspVersionId: version.id,
          resourceId: 'RM-02D2A-1 D-08 Resource',
          resourceType: 'MATERIAL',
          coefficient: '1.000000',
          baseUnit: 'Lbr',
        },
      });

      await prisma.region.upsert({
        where: { id: CASOF07_REGION_ID },
        create: {
          id: CASOF07_REGION_ID,
          code: 'RM02D2A1-CASOF07',
          name: 'C-ASOF-07 Region',
        },
        update: {},
      });

      const JAN = new Date('2026-01-05T00:00:00.000Z');
      const BUSINESS_DATE = new Date('2026-03-01T00:00:00.000Z');
      const CORRECTION_EFFECTIVE = new Date('2026-06-01T00:00:00.000Z');

      // A — the price that WAS the truth on the business date.
      const original = await acceptedWorth('78000.00');
      await prisma.basicPrice.update({
        where: { id: original.basicPrice.id },
        data: { effectiveDate: JAN, regionId: CASOF07_REGION_ID },
      });
      await publishAs(original.basicPrice.id).expect(201);

      const resolveAt = async (asOf: Date) =>
        orchestrator.resolveVersionResources(prisma, {
          workspaceId: WORKSPACE_A,
          // Feeds the pure price kernel only; no row is written by this read.
          projectId: '42000000-0000-4000-8000-0000000000cf',
          referenceRegionId: CASOF07_REGION_ID,
          asOf,
          version: { id: version.id, resources: [ahspResource] },
        });

      // BEFORE the correction exists at all: the offer for D is A.
      const beforeCorrection = await resolveAt(BUSINESS_DATE);
      expect(beforeCorrection).toHaveLength(1);
      expect(beforeCorrection[0].status).toBe('RESOLVED');
      expect(beforeCorrection[0].selectedBasicPriceId).toBe(
        original.basicPrice.id,
      );

      // B — an explicit CORRECTION of A, published NOW, effective from June.
      const corrected = await acceptedWorth('80000.00');
      await prisma.basicPrice.update({
        where: { id: corrected.basicPrice.id },
        data: {
          effectiveDate: CORRECTION_EFFECTIVE,
          regionId: CASOF07_REGION_ID,
        },
      });
      await publishAs(corrected.basicPrice.id, {
        supersedesBasicPriceId: original.basicPrice.id,
      }).expect(201);

      // The governance instant really is AFTER the business date being asked
      // about — otherwise this test would prove nothing about the past.
      const transitionAt = await supersessionInstantOf(original.basicPrice.id);
      expect(transitionAt.getTime()).toBeGreaterThan(BUSINESS_DATE.getTime());

      // THE CLAIM. The SAME historical question, asked after the correction
      // landed, still answers with the price that was lawfully offered then —
      // and answers it IDENTICALLY, not merely with the same id.
      const afterCorrection = await resolveAt(BUSINESS_DATE);
      expect(afterCorrection).toEqual(beforeCorrection);
      expect(afterCorrection[0].selectedBasicPriceId).toBe(
        original.basicPrice.id,
      );
      expect(decimalText(afterCorrection[0].sourcePriceValue)).toBe('78000');

      // ...and the PRESENT question moves, because the correction is in force
      // now. A predicate that ignored `asOf` could not produce both answers.
      const present = await resolveAt(new Date());
      expect(present[0].status).toBe('RESOLVED');
      expect(present[0].selectedBasicPriceId).toBe(corrected.basicPrice.id);
      expect(decimalText(present[0].sourcePriceValue)).toBe('80000');
    });

    it('C-ASOF-07 — an ordinary LATER observation never triggers correction semantics in the resolver', async () => {
      // The negative half. A price published later with NO supersedes pointer
      // asserts nothing about the earlier one, so the earlier one must stay
      // offerable — and the resolver must see TWO lawful candidates rather than
      // silently treating the newer as a replacement.
      const orchestrator = app.get(AhspResourceResolutionOrchestrator);

      const ahsp = await prisma.aHSP.create({
        data: {
          workspaceId: WORKSPACE_A,
          workType: 'C-ASOF-07 observation work',
          methodType: 'MANUAL',
          locationType: 'GENERAL',
          methodName: 'C-ASOF-07 observation method',
        },
      });
      createdAhspIds.push(ahsp.id);
      const version = await prisma.aHSPVersion.create({
        data: {
          ahspId: ahsp.id,
          workspaceId: WORKSPACE_A,
          versionNumber: 1,
          outputUnit: 'Lbr',
        },
      });
      const ahspResource = await prisma.aHSPResource.create({
        data: {
          ahspVersionId: version.id,
          resourceId: 'RM-02D2A-1 D-08 Resource',
          resourceType: 'MATERIAL',
          coefficient: '1.000000',
          baseUnit: 'Lbr',
        },
      });

      await prisma.region.upsert({
        where: { id: CASOF07_OBSERVATION_REGION_ID },
        create: {
          id: CASOF07_OBSERVATION_REGION_ID,
          code: 'RM02D2A1-CASOF07-OBS',
          name: 'C-ASOF-07 Observation Region',
        },
        update: {},
      });

      const first = await acceptedWorth('78000.00');
      await prisma.basicPrice.update({
        where: { id: first.basicPrice.id },
        data: {
          effectiveDate: new Date('2026-01-05T00:00:00.000Z'),
          regionId: CASOF07_OBSERVATION_REGION_ID,
        },
      });
      await publishAs(first.basicPrice.id).expect(201);

      const later = await acceptedWorth('81000.00');
      await prisma.basicPrice.update({
        where: { id: later.basicPrice.id },
        data: {
          effectiveDate: new Date('2026-02-05T00:00:00.000Z'),
          regionId: CASOF07_OBSERVATION_REGION_ID,
        },
      });
      // NO supersedesBasicPriceId — an ordinary publish, stating a new fact.
      await publishAs(later.basicPrice.id).expect(201);

      expect(
        await prisma.basicPricePublicationAudit.count({
          where: { basicPriceId: first.basicPrice.id, action: 'SUPERSEDED' },
        }),
      ).toBe(0);

      const resolution = await orchestrator.resolveVersionResources(prisma, {
        workspaceId: WORKSPACE_A,
        projectId: '42000000-0000-4000-8000-0000000000cf',
        referenceRegionId: CASOF07_OBSERVATION_REGION_ID,
        asOf: new Date('2026-03-01T00:00:00.000Z'),
        version: { id: version.id, resources: [ahspResource] },
      });

      // Both remain lawful candidates, so the kernel hands the ambiguity to a
      // human instead of inventing a winner. The decisive part is WHY there are
      // two: the earlier price was NOT suppressed as though it had been
      // corrected, because nothing corrected it.
      expect(resolution).toHaveLength(1);
      expect(resolution[0].status).not.toBe('RESOLVED');
      expect(await isCurrentAsOf(first.basicPrice.id, new Date())).toBe(true);
      expect(await isCurrentAsOf(later.basicPrice.id, new Date())).toBe(true);
    });

    it('C-ASOF-11 — a successor pointer with NO governance record fails CLOSED', async () => {
      // The writer makes this state unreachable, so it is forged here directly
      // against the table. The question is not whether it can happen; it is
      // what SIMPROK answers if it ever does. "No record dated at or before D"
      // would otherwise read as "not yet corrected" at EVERY instant, and the
      // predecessor would be offered forever.
      const { predecessorId } = await publishThenCorrect();

      await prisma.basicPricePublicationAudit.deleteMany({
        where: { basicPriceId: predecessorId, action: 'SUPERSEDED' },
      });

      // The pointer still stands; only the record that times it is gone.
      expect(
        await prisma.basicPrice.count({
          where: { supersedesBasicPriceId: predecessorId },
        }),
      ).toBe(1);

      // Suppressed at every instant, including ones long before the correction.
      expect(await isCurrentAsOf(predecessorId, JUL_31)).toBe(false);
      expect(await isCurrentAsOf(predecessorId, new Date())).toBe(false);
      expect(
        await isCurrentAsOf(
          predecessorId,
          new Date('2099-01-01T00:00:00.000Z'),
        ),
      ).toBe(false);
      // And it is still LAWFUL and still readable — suppression is a selection
      // rule, never a permission one.
      await request(getTypedHttpServer())
        .get(`/basic-prices/${predecessorId}`)
        .set('Authorization', `Bearer ${actor3Token}`)
        .set('x-workspace-id', WORKSPACE_A)
        .expect(200);
    });

    it('C-ASOF-11 — a promoted descendant of an UNTIMEABLE origin also fails closed', async () => {
      const origin = await acceptedWorth('78000.00');
      await publishAs(origin.basicPrice.id).expect(201);
      const shared = await promoteToShared(origin.basicPrice.id);
      const corrected = await acceptedWorth('80000.00');
      await publishAs(corrected.basicPrice.id, {
        supersedesBasicPriceId: origin.basicPrice.id,
      }).expect(201);

      await prisma.basicPricePublicationAudit.deleteMany({
        where: { basicPriceId: origin.basicPrice.id, action: 'SUPERSEDED' },
      });

      // The same law, asked about the descendant: an origin whose correction
      // cannot be timed must not have its money restated to other tenants.
      expect(await isCurrentAsOf(shared.id, JUL_31)).toBe(false);
      expect(await isCurrentAsOf(shared.id, new Date())).toBe(false);
    });

    it('C-ASOF-10 — withdrawal keeps its OWN effective clock, unchanged', async () => {
      // The two verbs must not have been merged into one rule. A withdrawal is
      // a claim the SOURCE dates; a correction is a transition SIMPROK records.
      const price = await acceptedWorth('78000.00');
      await publishAs(price.basicPrice.id).expect(201);
      const id = price.basicPrice.id;

      await withdraw(id, 'Source retracted its July list', AUG_01);

      expect(await isCurrentAsOf(id, JUL_31)).toBe(true);
      // AUG_03 is BEFORE the recording instant and AFTER the stated effective
      // one. A createdAt comparison would answer `true` here; the source's own
      // date is what governs, and it says otherwise.
      expect(await isCurrentAsOf(id, AUG_03)).toBe(false);
      expect(
        await prisma.basicPricePublicationAudit.count({
          where: { basicPriceId: id, action: 'SUPERSEDED' },
        }),
      ).toBe(0);
    });

    it('C-ASOF-12 — a historical as-of never widens what another tenant may read', async () => {
      // Time-travel is a SELECTION lens, never a permission one. Asking about a
      // day before a correction must not turn a foreign private lineage into
      // something Workspace B can enumerate.
      const { predecessorId, transitionAt } = await publishThenCorrect();
      const justBefore = new Date(transitionAt.getTime() - ONE_SECOND);

      // The predecessor is Workspace A's, and it was current at `justBefore` —
      // yet B still cannot read it by id.
      expect(await isCurrentAsOf(predecessorId, justBefore)).toBe(true);
      await request(getTypedHttpServer())
        .get(`/basic-prices/${predecessorId}`)
        .set('Authorization', `Bearer ${crosstenantToken}`)
        .set('x-workspace-id', WORKSPACE_B)
        .expect(404);
      await request(getTypedHttpServer())
        .get(`/basic-prices/${predecessorId}/detail`)
        .set('Authorization', `Bearer ${crosstenantToken}`)
        .set('x-workspace-id', WORKSPACE_B)
        .expect(404);
    });

    it('HIST-05 — the database itself refuses to delete a predecessor a correction still stands on', async () => {
      const original = await acceptedWorth('78000.00');
      await publishAs(original.basicPrice.id).expect(201);
      const corrected = await acceptedWorth('80000.00');
      await publishAs(corrected.basicPrice.id, {
        supersedesBasicPriceId: original.basicPrice.id,
      }).expect(201);

      // ON DELETE RESTRICT, proved by PostgreSQL rather than by intent. History
      // cannot be erased to tidy up the present.
      await expect(
        prisma.basicPrice.delete({ where: { id: original.basicPrice.id } }),
      ).rejects.toThrow();
      await expect(
        prisma.basicPrice.findUniqueOrThrow({
          where: { id: original.basicPrice.id },
        }),
      ).resolves.toBeDefined();
    });
  });
});
