import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { BasicPricePrivateAssetService } from '../../src/basic-price/basic-price-private-asset.service';
import type { SmartSaveFailureBody } from '../../src/basic-price/basic-price-smart-save-failure.law';
import {
  GOVERNED_REHEARSAL_CONFIRMATION_TOKEN,
  applyBootstrapPlan,
  buildPlan,
  computePlanHash,
  loadCanonicalInventory,
} from '../../src/resource-catalog/resource-catalog-bootstrap-planner';
import {
  GOVERNED_REHEARSAL_REGION_CONFIRMATION_TOKEN,
  applyRegionPlan,
  buildRegionPlan,
  computeRegionPlanHash,
} from '../../src/canonical-reference/region-provisioner';

/**
 * REAL WORKFLOW — THE OWNER'S ACTUAL WORKBOOK, THROUGH THE ACTUAL ENDPOINTS.
 *
 * Every other Basic Price suite builds its workbook in code. That is right for
 * unit law, and it is exactly why it could not have caught what this one is for:
 * a fixture proves the shapes SIMPROK already expects, while the Owner's file
 * proves the shapes reality actually sends.
 *
 * So this suite reads the REAL file off disk, posts it to the REAL preview
 * endpoint with a REAL authenticated session and REAL permissions, and follows
 * it to the review room the way a human would. No adapter is called directly and
 * no row is inserted by hand — if the product cannot do it, this fails.
 *
 * SKIPS ITSELF, LOUDLY, when the workbook is absent: it is gitignored source
 * data, so CI without it must not report a pass it did not earn.
 */
const WORKBOOK_PATH = 'C:/SIMPROK/BASIC PRICE IKK - SIMPROK READY 2024.xlsx';
const EXPECTED_SOURCE_ROWS = 86;

const WORKSPACE_A = '10000000-0000-4000-8000-000000000004';
const ORG_A = '10000000-0000-4000-8000-000000000002';
const PASSWORD = 'Test1234!';
const ROLE_ID = '46000000-0000-4000-8000-000000000001';

/**
 * BP-REGION-TRUTH-07V — A SECOND WORKSPACE, BECAUSE IMPORT IDENTITY IS REAL.
 *
 * WHY THIS EXISTS. `workspaceId_importFingerprint` forbids two batches holding
 * one import identity, and BP-REGION-TRUTH-07S recomputes that identity from a
 * batch's FINAL facts. The closeout block finalizes the Owner's batch to the
 * only facts this workbook actually supports — Baguala, 2024-01-01 derived from
 * the stated year, field report, market survey — and from that moment those
 * facts, over this file, in this workspace, ARE that batch. Any later batch
 * patched to the same truth is the same import, and SIMPROK correctly refuses
 * it with 409 BATCH_IDENTITY_ALREADY_EXISTS.
 *
 * WHAT THAT COST THE SUITE. The three blocks below are not import-identity
 * tests. D proves a re-verification date is carried, X proves a human exclusion
 * is respected, P proves an interrupted save tells the truth — and every one of
 * them opens by asking for a FRESH batch. Sharing one workspace with the
 * closeout made that impossible: their PATCH collided with the closeout batch's
 * identity, and twelve assertions about three unrelated laws failed for a
 * reason none of them was about.
 *
 * WHY A WORKSPACE AND NOT A DIFFERENT FACT. The alternative was to give each
 * block its own region, date or source claim — every one of which this workbook
 * does not state, and inventing them is precisely what this suite refuses to do
 * everywhere else. A workspace is not a fact about the source. The same real
 * file, with the same real facts, imported by a different tenant is a genuinely
 * different import, and `workspaceId` is the fingerprint's first input for
 * exactly that reason. Nothing about the workbook is bent to make room.
 *
 * The closeout batch stays where it is and stays readable — D-5 and P-5 compare
 * against it — and identity-collision law keeps its own dedicated coverage in
 * `basic-price-region-truth-07s-identity.spec.ts` (IDENTITY-05, IDENTITY-07).
 */
const SCENARIO_WORKSPACE_ID = '10000000-0000-4000-8000-00000000004a';
const SCENARIO_ROLE_ID = '46000000-0000-4000-8000-000000000002';

/**
 * THE REFERENCE KNOWLEDGE THIS DATABASE MUST HOLD, AND WHERE IT COMES FROM.
 *
 * `simprok_e2e` carries no ResourceCatalog at all, so the Resource Identity
 * authority answered RESOURCE_NOT_FOUND for every row of the Owner's workbook —
 * a true answer about an empty database and a false picture of the Owner's. An
 * earlier version of this suite "fixed" that by creating a catalog row per
 * workbook row it wanted to pass, which proves the plumbing and nothing else:
 * it makes the test data smarter than the product and then credits the engine
 * with finding what the test just planted.
 *
 * So the reference knowledge is provisioned the way the Owner's own workspace
 * was provisioned — from the reviewed RM-02C0 inventory, pinned by SHA-256,
 * through the SAME planner, under its own named confirmation authority. That
 * inventory is a parse of a DIFFERENT workbook (`BASIC PRICE(1).xlsx`) authored
 * long before the IKK file existed, and it does not contain most of the IKK
 * file's names. What the engine finds here, it found.
 */
const INVENTORY_PATH = resolve(
  __dirname,
  '..',
  '..',
  '..',
  'docs',
  'implementation-gates',
  'rm02c0-discovery',
  '01-RM02C0-RESOURCE-INVENTORY.json',
);
const EXPECTED_INVENTORY_SHA256 =
  'CE2B3AEBC50179FB2DF46D5EB55ED39EF68347421C8F8DE043C6D3CA00E64C46';

/**
 * THE REGION THE WORKBOOK ITSELF NAMES — not a fixture standing in for one.
 *
 * Sheet `SOURCE_3_KECAMATAN`, row KEC-1, states `region_name` =
 * "Kecamatan Teluk Ambon Baguala, Kota Ambon" with `ready_for_region_import` =
 * YES. Rows KEC-2 and KEC-3 say "Nama kecamatan belum dibuktikan/ditetapkan;
 * jangan menebak" and are deliberately not used. `8171030` is that kecamatan's
 * real BPS code and is the code the canonical database already carries.
 */
const REGION_CODE = '8171030';
const REGION_NAME = 'Kecamatan Teluk Ambon Baguala, Kota Ambon';

const PERMISSION_CODES = [
  'BASIC_PRICE_IMPORT',
  'BASIC_PRICE_RESOLVE',
  'BASIC_PRICE_SUBMIT',
  'BASIC_PRICE_REVIEW_VIEW',
  // The Explorer's own permission. The closeout proves a kept price is
  // actually VISIBLE, and the Explorer is the room a person looks in.
  'BASIC_PRICE_VIEW',
];

/**
 * THE SHAPES THE WIRE ACTUALLY CARRIES.
 *
 * supertest types both `app.getHttpServer()` and every `response.body` as
 * `any`, so a field read straight off a response is a guess no compiler can
 * check — and a suite whose whole point is that reality's shapes differ from
 * the fixture's cannot afford an unchecked read of reality. Every payload this
 * file reads is therefore DECLARED once, here, and each read below goes through
 * one of these declarations. No assertion changes; what the assertions are
 * about is now a stated shape instead of `any`.
 */

/** What `/auth/login` answers with. Only the bearer token is used here. */
interface LoginResult {
  access_token: string;
}

/** One row of the batch, as the review room receives it. */
interface ReviewRow {
  id: string;
  status: string;
  name: string;
  unit: string | null;
  section: string | null;
  version: number;
  /** The bound identity, or null while the row is still a human decision. */
  resourceCatalogId: string | null;
  machineProposal: {
    identityPairProven: boolean;
    blockingFacts: string[];
    unit: { unitDefinitionId: string | null; status: string };
    resource: {
      status: string;
      authority: string | null;
      admissibleForResolve: boolean;
      resourceCatalogId: string | null;
      candidates: Array<{ resourceCatalogId: string; name: string }>;
      reasonCodes: string[];
    };
  } | null;
}

/**
 * The batch projection `summarize()` returns on EVERY path — preview included,
 * where `machineProposal` is null and `identityPairProvenRows` is 0 because no
 * authority was consulted, never because none found anything.
 */
interface BatchSummary {
  batchId: string;
  status: string;
  version: number;
  regionId: string | null;
  effectiveDate: string | null;
  sourceOrigin: string | null;
  sourceType: string | null;
  sourceOrganizationName: string | null;
  /** SOFT re-verification, stated by a human or absent. Never computed. */
  reviewDate: string | null;
  /** Finished rows already stored as private prices, or null if unmeasured. */
  alreadyPrivateRows: number | null;
  totalRows: number;
  needsReviewRows: number;
  readyForSubmissionRows: number;
  rejectedRows: number;
  identityPairProvenRows: number;
  actions: {
    privateUse: {
      offered: boolean;
      reasonCode: string | null;
      /** Rows one press would still store. Null when not measured. */
      actionableRows: number | null;
    };
  };
  rows: ReviewRow[];
}

/** The batch projection, as `summarize()` plus the read path shape it. */
interface BatchView extends BatchSummary {
  region: { id: string; code: string; name: string } | null;
}

/** What `keep-private` answers with. */
interface KeepPrivateResult {
  createdCount: number;
  alreadyPrivateCount: number;
  prices: Array<{ basicPriceId: string }>;
}

/**
 * What ONE `smart-save` command answers with — the whole of `Simpan & Gunakan`.
 *
 * Both halves are reported separately on purpose: binding an identity and
 * materializing a price are two governed acts with two permissions, and an
 * outcome that merged them could not say which one did what.
 */
interface SmartSaveResult {
  batchId: string;
  accepted: {
    acceptedRowIds: string[];
    acceptedCount: number;
    eligibleCount: number;
    skippedCount: number;
    excludedCount: number;
    remainingEligible: number;
    evidenceLoads: number;
    chunks: number;
  };
  kept: KeepPrivateResult;
}

/**
 * One column a clarification refusal offers. `samples` is the human's evidence
 * and is all the browser gets — `proofValues` is absent from this shape because
 * the server strips it before the body goes out, which is what C-0 pins.
 */
interface ColumnCandidate {
  columnNumber: number;
  samples: string[];
}

/** The body of a clarification refusal (409): the demand, and what it offers. */
interface ClarificationBody {
  message: string;
  nameCandidates: ColumnCandidate[];
  unitCandidates: ColumnCandidate[];
}

const describeReal = existsSync(WORKBOOK_PATH) ? describe : describe.skip;

describeReal(
  'REAL WORKFLOW — Basic Price from the Owner workbook (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaClient;
    let token: string;
    let workbook: Buffer;
    /** The real Region id, as the governed provisioner created or reused it. */
    let REGION_ID = '';
    /**
     * Whether THIS run created the Region. A reused one belongs to whoever
     * provisioned it and must survive teardown; only what this suite made is
     * removed, which is the same rule the residual fingerprint enforces.
     */
    let regionCreatedHere = false;

    /**
     * THE MACHINE-PROVEN BASELINE, measured once by N-4 before any human
     * decision and read by every seam after it.
     *
     * Hoisted out of the closeout block deliberately: the three closing proofs
     * each open a FRESH batch from the same workbook, and what they have to
     * show is that the number the authorities produce is a property of the
     * workbook and the reference knowledge — not of how many times this suite
     * has pressed the button. A per-block re-measurement could quietly drift
     * upward as earlier presses taught the identity authority new decisions,
     * and nothing would notice.
     */
    let pairProvenAtMeasurement = 0;

    /**
     * THE OWNER'S OWN BATCH — the one N-5 saved in a single uninterrupted
     * press. Named out here because SEAM 3 proves that a batch which failed
     * and recovered ends up indistinguishable from one that never failed, and
     * the only honest comparison for that is a real clean run rather than a
     * control built for the comparison.
     */
    let closeoutBatchId = '';

    /**
     * EVERYTHING THIS SUITE CREATED OR CHANGED, so `afterAll` can put the
     * database back exactly as it found it.
     *
     * The governed E2E lifecycle fingerprints every table before and after the
     * run and FAILS on any residual — which is how it caught this suite leaving
     * a role, a region, a unit definition and an alias behind. A test that
     * leaves rows behind is not only untidy: the previous run of this very file
     * left a duplicate active `m3` alias, and the NEXT run then read
     * AMBIGUOUS_UNIT_ALIAS and drew a false conclusion about the product.
     */
    const createdPermissionIds: string[] = [];
    /** Memberships this suite MADE — never the ones the seed already owned. */
    const createdMembershipIds: string[] = [];
    const createdUnitDefinitionIds: string[] = [];
    const createdUnitAliasIds: string[] = [];
    /** Aliases this suite deactivated, to be switched back on afterwards. */
    const deactivatedAliasIds: string[] = [];
    const IMPORTED_FILE_NAMES = [
      'BASIC PRICE IKK - SIMPROK READY 2024.xlsx',
      'RM-03D1_GOLDEN_DATA_PACK_v1.1.xlsx',
    ];

    /**
     * THE HTTP SERVER, NAMED FOR WHAT IT IS. `app.getHttpServer()` is typed
     * `any`, which would make every request below an unchecked call on an
     * unknown thing. It is the Node server it has always been, and saying so
     * once here is what lets supertest — and therefore every response read in
     * this file — be type-checked at all.
     */
    const server = (): Server => app.getHttpServer() as Server;

    beforeAll(async () => {
      workbook = readFileSync(WORKBOOK_PATH);
      app = (
        await Test.createTestingModule({ imports: [AppModule] }).compile()
      ).createNestApplication();
      await app.init();
      prisma = new PrismaClient();

      // Permission is a GLOBAL catalog row. Rows this suite has to CREATE are
      // recorded so `afterAll` removes exactly those and leaves any the seed
      // already owned untouched — the difference the residual fingerprint sees.
      const permissions = await Promise.all(
        PERMISSION_CODES.map(async (code) => {
          const existing = await prisma.permission.findUnique({
            where: { code },
          });
          if (existing) return existing;
          const created = await prisma.permission.create({
            data: { code, name: code },
          });
          createdPermissionIds.push(created.id);
          return created;
        }),
      );
      const account = await prisma.account.findUniqueOrThrow({
        where: { email: 'assigned@test.local' },
      });

      /**
       * THE GRANT CHAIN, SAID ONCE. Role is a WORKSPACE-scoped row and the
       * membership is per workspace, so a second workspace needs its own pair —
       * built by the same statements that already built the first, rather than
       * by a second, subtly different copy of them.
       *
       * `assigned@test.local` and its bearer token are unchanged: identity
       * belongs to the account, and which workspace it is acting in is the
       * header it sends. One person, two tenancies — exactly as the product
       * models it.
       */
      const grantWorkspaceAccess = async (
        workspaceId: string,
        roleId: string,
        code: string,
      ) => {
        await prisma.role.upsert({
          where: { id: roleId },
          create: {
            id: roleId,
            workspaceId,
            code,
            name: 'Real Workflow Basic Price',
          },
          update: {},
        });
        for (const permission of permissions) {
          await prisma.rolePermission.upsert({
            where: {
              roleId_permissionId: { roleId, permissionId: permission.id },
            },
            create: { roleId, permissionId: permission.id },
            update: {},
          });
        }
        // Recorded ONLY when this suite actually made it, so `afterAll` removes
        // exactly what it added and never the membership the seed owns.
        const existingMembership = await prisma.workspaceMembership.findUnique({
          where: {
            accountId_workspaceId: { accountId: account.id, workspaceId },
          },
        });
        const membership =
          existingMembership ??
          (await prisma.workspaceMembership.create({
            data: { accountId: account.id, workspaceId, status: 'ACTIVE' },
          }));
        if (!existingMembership) {
          createdMembershipIds.push(membership.id);
          /**
           * THE THIRD LINK OF THE IDENTITY CHAIN. Account → Membership → User
           * is the product's own law, and Basic Price walks all three: the
           * trusted-actor authority resolves the USER before it will let a
           * price be kept. A membership without one is an account that can hold
           * permissions and still not act.
           */
          await prisma.user.create({
            data: {
              workspaceMembershipId: membership.id,
              workspaceId,
              fullName: 'Assigned Acceptance User',
              status: 'ACTIVE',
            },
          });
        }
        await prisma.membershipRole.create({
          data: {
            workspaceMembershipId: membership.id,
            roleId,
            isActive: true,
          },
        });
      };

      // The Owner's own workspace keeps the membership the seed already gave
      // it; only the role grant is this suite's to make.
      await grantWorkspaceAccess(
        WORKSPACE_A,
        ROLE_ID,
        'REAL_WORKFLOW_BASIC_PRICE',
      );

      // BP-REGION-TRUTH-07V — the second tenancy the scenario blocks import
      // into. Created here so it is torn down by the same `afterAll` that
      // returns everything else.
      await prisma.workspace.upsert({
        where: { id: SCENARIO_WORKSPACE_ID },
        create: {
          id: SCENARIO_WORKSPACE_ID,
          name: 'Real Workflow Basic Price Scenarios',
          organizationId: ORG_A,
        },
        update: {},
      });
      await grantWorkspaceAccess(
        SCENARIO_WORKSPACE_ID,
        SCENARIO_ROLE_ID,
        'REAL_WORKFLOW_BASIC_PRICE_SCENARIOS',
      );

      // ── THE REFERENCE KNOWLEDGE, THROUGH THE GOVERNED PROVISIONERS ──────
      //
      // Not `prisma.region.create` and not `prisma.resourceCatalog.create`.
      // Both halves go through the same reviewed modules the canonical
      // workspace was provisioned with, under the governed-rehearsal
      // confirmation authority, against the plan hash each one computed. Every
      // identity, disposition and provenance rule they enforce is enforced
      // here too — which is what makes the measurement below a statement about
      // SIMPROK rather than about this file.
      //
      // Region is GLOBAL reference data — it carries no workspaceId, and that
      // is the schema's own law rather than an omission here.
      const regionPlan = await buildRegionPlan(prisma, {
        regionCode: REGION_CODE,
        regionName: REGION_NAME,
      });
      const region = await applyRegionPlan(prisma, {
        regionCode: REGION_CODE,
        regionName: REGION_NAME,
        expectedPlanSha256: computeRegionPlanHash(regionPlan),
        confirmationToken: GOVERNED_REHEARSAL_REGION_CONFIRMATION_TOKEN,
        expectedConfirmationToken: GOVERNED_REHEARSAL_REGION_CONFIRMATION_TOKEN,
      });
      REGION_ID = region.regionId;
      regionCreatedHere = region.regionCreatedDelta === 1;

      const { inventory, inventorySha256 } = loadCanonicalInventory(
        INVENTORY_PATH,
        EXPECTED_INVENTORY_SHA256,
      );
      /**
       * THE SAME REVIEWED INVENTORY INTO BOTH TENANCIES.
       *
       * ResourceCatalog is workspace-scoped, so the scenario workspace needs
       * the reference knowledge too — and it must be the SAME knowledge, from
       * the same pinned file through the same planner under the same
       * confirmation authority. That is what lets `pairProvenAtMeasurement`,
       * measured once in the Owner's workspace, stand as the expected number in
       * the scenario blocks: if it were a property of a workspace rather than
       * of the workbook and the reference knowledge, those assertions would now
       * fail — which is a stronger statement than the one they made before.
       */
      for (const workspaceId of [WORKSPACE_A, SCENARIO_WORKSPACE_ID]) {
        const catalogPlan = await buildPlan(prisma, {
          inventory,
          inventoryPath: INVENTORY_PATH,
          inventorySha256,
          workspaceId,
          generatedFromGitHead: 'REAL_WORKFLOW_E2E',
        });
        await applyBootstrapPlan(prisma, {
          expectedPlanSha256: computePlanHash(catalogPlan),
          confirmationToken: GOVERNED_REHEARSAL_CONFIRMATION_TOKEN,
          expectedConfirmationToken: GOVERNED_REHEARSAL_CONFIRMATION_TOKEN,
          workspaceId,
          inventory,
          inventoryPath: INVENTORY_PATH,
          inventorySha256,
          generatedFromGitHead: 'REAL_WORKFLOW_E2E',
        });
      }

      const login = await request(server())
        .post('/auth/login')
        .send({ email: 'assigned@test.local', password: PASSWORD });
      token = (login.body as LoginResult).access_token;
    });

    /**
     * EVERY BATCH OF THIS WORKBOOK IN ONE WORKSPACE, AND THE PRICES THAT HOLD
     * THEM DOWN — removed in the one order the schema permits.
     *
     * `BasicPrice.sourceImportRow` is `onDelete: Restrict`, deliberately, so a
     * materialized price can never lose its evidence. The prices therefore go
     * first or the batch delete fails outright.
     *
     * Used both by the scenario blocks, which each return the workspace they
     * borrowed, and by `afterAll` for the whole file.
     */
    const clearImportedBatches = async (workspaceId: string) => {
      await prisma.basicPrice.deleteMany({
        where: {
          workspaceId,
          sourceImportRow: {
            batch: { sourceFileName: { in: IMPORTED_FILE_NAMES } },
          },
        },
      });
      await prisma.basicPriceImportBatch.deleteMany({
        where: { workspaceId, sourceFileName: { in: IMPORTED_FILE_NAMES } },
      });
    };

    /**
     * BP-REGION-TRUTH-07V — THE SCENARIO WORKSPACE IS LENT TO ONE BLOCK AT A
     * TIME, AND HANDED BACK EMPTY.
     *
     * Import identity is per workspace, so two scenario blocks holding batches
     * of this workbook under the same final facts at the same time would
     * collide with each other exactly as they collided with the closeout batch.
     * Each block therefore takes the workspace clean and returns it clean.
     *
     * THE GUARD IS AN ASSERTION, NOT A CONVENIENCE. Every one of these blocks
     * opens by claiming a FRESH batch. That claim now has to be true of the
     * whole tenancy before the block starts, so a future block that forgets to
     * tidy up fails HERE — naming the reason — rather than three tests later
     * inside an assertion about a re-verification date.
     */
    const ownsScenarioWorkspaceAlone = () => {
      beforeAll(async () => {
        const leftBehind = await prisma.basicPriceImportBatch.count({
          where: {
            workspaceId: SCENARIO_WORKSPACE_ID,
            sourceFileName: { in: IMPORTED_FILE_NAMES },
          },
        });
        expect(leftBehind).toBe(0);
      });
      afterAll(() => clearImportedBatches(SCENARIO_WORKSPACE_ID));
    };

    afterAll(async () => {
      // REVERSE DEPENDENCY ORDER. Batches first (their rows cascade), then the
      // grant chain, then the reference data — each delete only ever names what
      // this file made.
      //
      // PRIVATE PRICES COME FIRST OF ALL. `BasicPrice.sourceImportRow` is
      // `onDelete: Restrict` — deliberately, so a materialized price can never
      // lose its evidence — which means deleting the batch while a price still
      // points at one of its rows fails outright rather than cascading.
      await clearImportedBatches(WORKSPACE_A);
      await clearImportedBatches(SCENARIO_WORKSPACE_ID);
      const roleIds = [ROLE_ID, SCENARIO_ROLE_ID];
      await prisma.membershipRole.deleteMany({
        where: { roleId: { in: roleIds } },
      });
      await prisma.rolePermission.deleteMany({
        where: { roleId: { in: roleIds } },
      });
      await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
      if (createdMembershipIds.length > 0) {
        await prisma.workspaceMembership.deleteMany({
          where: { id: { in: createdMembershipIds } },
        });
      }
      if (createdPermissionIds.length > 0) {
        await prisma.permission.deleteMany({
          where: { id: { in: createdPermissionIds } },
        });
      }

      if (createdUnitAliasIds.length > 0) {
        await prisma.unitAlias.deleteMany({
          where: { id: { in: createdUnitAliasIds } },
        });
      }
      if (createdUnitDefinitionIds.length > 0) {
        await prisma.unitDefinition.deleteMany({
          where: { id: { in: createdUnitDefinitionIds } },
        });
      }
      // Switching an alias off is a CHANGE, not a creation, and the fingerprint
      // sees it either way — so it is switched back on.
      if (deactivatedAliasIds.length > 0) {
        await prisma.unitAlias.updateMany({
          where: { id: { in: deactivatedAliasIds } },
          data: { isActive: true },
        });
      }
      // THE PROVISIONED REFERENCE KNOWLEDGE, RETURNED.
      //
      // After the batches, because a resolved row's mapping holds its catalog
      // row under `onDelete: Restrict`, and after the provenance sightings,
      // because those hold it too. Scoped to this workspace, which is the same
      // boundary the bootstrap wrote inside — the E2E database starts with no
      // ResourceCatalog at all, so this removes exactly what was provisioned.
      await prisma.resourceSourceIdentity.deleteMany({
        where: { workspaceId: { in: [WORKSPACE_A, SCENARIO_WORKSPACE_ID] } },
      });
      await prisma.resourceCatalog.deleteMany({
        where: { workspaceId: { in: [WORKSPACE_A, SCENARIO_WORKSPACE_ID] } },
      });
      // The second tenancy itself, last: everything that pointed into it is
      // gone by now, and it is a row this suite made rather than one it found.
      await prisma.workspace.deleteMany({
        where: { id: SCENARIO_WORKSPACE_ID },
      });
      // Only if THIS run created it. A reused Region is someone else's row.
      if (regionCreatedHere && REGION_ID) {
        await prisma.region.deleteMany({ where: { id: REGION_ID } });
      }

      await prisma?.$disconnect();
      await app?.close();
    });

    const preview = () =>
      request(server())
        .post('/basic-price-imports/preview')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', WORKSPACE_A)
        .attach('file', workbook, {
          filename: 'BASIC PRICE IKK - SIMPROK READY 2024.xlsx',
          contentType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        })
        // THE SOURCE FACTS THE WORKBOOK ITSELF STATES, and no others. An
        // earlier version of this helper sent GOVERNMENT / REGULATION /
        // "Pemerintah Kota Ambon" — three claims nothing in the file supports.
        // Sheet `SOURCE_3_KECAMATAN` says `intended_source_type` =
        // "MARKET_SURVEY (candidate mapping)" and `provenance_truth` = "Owner
        // menetapkan file ini sebagai sumber survey lapangan tahun 2024", so a
        // field survey it is. No publisher is named anywhere in the file, so
        // none is invented: the Explorer keeps saying the source is unavailable
        // rather than showing a name SIMPROK made up.
        .field('regionId', REGION_ID)
        .field('sourceType', 'MARKET_SURVEY')
        .field('sourceOrigin', 'FIELD_REPORT');

    /**
     * THE BROWSER PAYLOAD, EXACTLY. BasicPriceImportPage's first upload sends
     * `metadata` while it is still {} and `answers` while it is still {} — so
     * the request carries the FILE AND NOTHING ELSE. Every other suite in this
     * repository, including R-2 below, hands the endpoint metadata the browser
     * has no way to have collected yet, which is precisely how an API can pass
     * while the Owner's door fails.
     */
    const previewAsBrowser = () =>
      request(server())
        .post('/basic-price-imports/preview')
        .set('Authorization', 'Bearer ' + token)
        .set('x-workspace-id', WORKSPACE_A)
        .attach('file', workbook, {
          filename: 'BASIC PRICE IKK - SIMPROK READY 2024.xlsx',
          contentType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });

    /**
     * THE SAME WORKBOOK, UPLOADED BY SOMEONE WHO ALREADY KNEW SOMETHING.
     *
     * WHY THIS EXISTS AT ALL, said plainly: intake identity (REPLAY_POLICY
     * §12.1) makes a re-upload of identical bytes under an identical
     * declaration the SAME batch, deliberately — a retried upload must not mint
     * a second set of prices. `previewAsBrowser()` declares nothing, so calling
     * it twice returns one batch, which is correct product behaviour and makes
     * it useless for proving three independent scenarios.
     *
     * SO EACH SCENARIO STATES ONE TRUE FACT AT UPLOAD TIME. Every value passed
     * here is a fact the workbook genuinely supports and the batch genuinely
     * ends up holding — the region the file names, the origin it declares, the
     * type it declares — just stated a step earlier by a person who already
     * knew it. That is an ordinary use of the import form, not a trick played
     * on the fingerprint: the law itself says a different declaration is a
     * different fact, and each block below asserts that it really did receive
     * its own batch rather than trusting that it did.
     */
    const previewDeclaring = (
      declared: Record<string, string>,
      workspaceId: string = WORKSPACE_A,
    ) => {
      let pending = request(server())
        .post('/basic-price-imports/preview')
        .set('Authorization', 'Bearer ' + token)
        .set('x-workspace-id', workspaceId)
        .attach('file', workbook, {
          filename: 'BASIC PRICE IKK - SIMPROK READY 2024.xlsx',
          contentType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
      for (const [field, value] of Object.entries(declared)) {
        pending = pending.field(field, value);
      }
      return pending;
    };

    it('B-1. THE OWNER DOOR — file only, no metadata, exactly as the browser sends it', async () => {
      const response = await previewAsBrowser();
      expect({
        status: response.status,
        body: response.body as unknown,
      }).toMatchObject({
        status: 201,
      });
      const batch = response.body as BatchSummary;
      expect(batch.totalRows).toBe(EXPECTED_SOURCE_ROWS);
      expect(batch.rows).toHaveLength(EXPECTED_SOURCE_ROWS);
    });

    it('R-1. the workbook on disk is the one this suite claims to test', () => {
      expect(workbook.byteLength).toBe(22090);
      expect(createHash('sha256').update(workbook).digest('hex')).toBe(
        'a489b144423a1a6e7b34ddcab1956411f5db18a56973c785c79a5b29ba7ae5dc',
      );
    });

    it('R-2. THE MISSION GATE — the real file reaches a real batch with all 86 rows', async () => {
      const response = await preview();

      // A refusal here is the product failing, so it is reported as the product's
      // own words rather than as a bare status code.
      expect({
        status: response.status,
        body: response.body as unknown,
      }).toMatchObject({ status: 201 });

      const batch = response.body as BatchSummary;
      expect(batch.batchId).toEqual(expect.any(String));
      expect(batch.totalRows).toBe(EXPECTED_SOURCE_ROWS);
      expect(batch.rows).toHaveLength(EXPECTED_SOURCE_ROWS);
    });

    it('R-3. the review room opens on that batch and every row is present', async () => {
      const created = await preview();
      expect(created.status).toBe(201);

      const review = await request(server())
        .get(`/basic-price-imports/${(created.body as BatchSummary).batchId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', WORKSPACE_A);

      expect(review.status).toBe(200);
      const reviewed = review.body as BatchView;
      expect(reviewed.rows).toHaveLength(EXPECTED_SOURCE_ROWS);
      // The review read is the ONLY path that consults the authorities, so this
      // is also the proof that the machine proposal actually runs on real data.
      const asked = reviewed.rows.filter((row) => row.machineProposal !== null);
      expect(asked.length).toBeGreaterThan(0);
    });

    it('R-4. the source categories the file itself declares are carried, unknown ones honestly', async () => {
      const created = await preview();
      const batch = created.body as BatchSummary;
      const sections = new Map<string, number>();
      for (const row of batch.rows) {
        const key = String(row.section);
        sections.set(key, (sections.get(key) ?? 0) + 1);
      }
      // The file states four groupings; one of them SIMPROK cannot map, and that
      // is reported as null rather than guessed into a known family.
      expect(sections.get('MATERIAL')).toBeGreaterThan(0);
      expect(sections.get('LABOR')).toBeGreaterThan(0);
      expect(sections.get('EQUIPMENT')).toBeGreaterThan(0);
      expect([...sections.values()].reduce((a, b) => a + b, 0)).toBe(
        EXPECTED_SOURCE_ROWS,
      );
    });

    /**
     * COLUMN INTELLIGENCE — the second real workbook, and the defect it exposed.
     *
     * This file states its jurisdictions as columns and heads neither its name nor
     * its unit column, so SIMPROK lawfully asks which column holds the resource
     * name. What it must NOT do is offer columns it can disprove: the reviewer was
     * being shown a resource-CLASS column, a column repeating one location on
     * every row, and a UNIT column reading "Org/hr / m3" beside the real names.
     */
    describe('COLUMN INTELLIGENCE — disproven columns are never offered', () => {
      const MATRIX_PATH = 'C:/SIMPROK-WT/RM-03D1_GOLDEN_DATA_PACK_v1.1.xlsx';

      const askColumnRoles = async () => {
        const buffer = readFileSync(MATRIX_PATH);
        return request(server())
          .post('/basic-price-imports/preview')
          .set('Authorization', 'Bearer ' + token)
          .set('x-workspace-id', WORKSPACE_A)
          .attach('file', buffer, {
            filename: 'RM-03D1_GOLDEN_DATA_PACK_v1.1.xlsx',
            contentType:
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          })
          .field('regionId', REGION_ID)
          .field('selectedRegionLabel', 'Baguala Price (Rp)')
          .field('declaredSection', 'MATERIAL');
      };

      it('C-1. asks the column question, and never offers the class or constant column', async () => {
        const response = await askColumnRoles();
        expect(response.status).toBe(409);
        const asked = response.body as ClarificationBody;
        expect(asked.message).toBe('COLUMN_ROLE_SELECTION_REQUIRED');

        const offered = asked.nameCandidates;
        const samplesOf = (n: number) =>
          offered.find((c) => c.columnNumber === n)?.samples ?? null;

        // The genuine resource-name column is still there — elimination must never
        // remove the right answer.
        expect(samplesOf(2)).toEqual(['Pekerja', 'Mandor', 'Sirtu']);
        // The resource-CLASS column: EVERY distinct value it states names a
        // family through the one canonical vocabulary, so SIMPROK answers this
        // rather than asking. That is the only structural disqualifier there is —
        // C-3 below pins what is deliberately NOT eliminated.
        expect(samplesOf(3)).toBeNull();
      });

      it('C-0. the refusal never leaks server-side proof evidence to the browser', async () => {
        const response = await askColumnRoles();
        expect(response.status).toBe(409);
        // `proofValues` is how the server reasons about a column. It is bounded
        // but can still be hundreds of strings, and it is not the human's
        // evidence — `samples` is. It must never ride out on the wire.
        const asked = response.body as ClarificationBody;
        expect(JSON.stringify(asked)).not.toContain('proofValues');
        for (const candidate of asked.nameCandidates) {
          expect(candidate).not.toHaveProperty('proofValues');
          expect(candidate.samples.length).toBeGreaterThan(0);
        }
        for (const candidate of asked.unitCandidates) {
          expect(candidate).not.toHaveProperty('proofValues');
        }
      });

      it('C-3. a CONSTANT column is never eliminated — repeating one name is lawful', async () => {
        // The correction this pins. An earlier elimination rule removed any column
        // holding one distinct value across many rows, on the reasoning that
        // several resources cannot share a name. A price list recording the same
        // resource across several observations does exactly that, so the rule
        // could delete the RIGHT answer. Column 7 repeats one location on every
        // row and is offered again — unlikely is not disproven.
        const response = await askColumnRoles();
        const columns = (response.body as ClarificationBody).nameCandidates.map(
          (c) => c.columnNumber,
        );
        expect(columns).toContain(7);
      });

      it('C-2. the Unit authority removes the unit column once it can prove the spellings', async () => {
        // The dictionary is what makes this provable. Without it the column stays
        // on the list, which is the correct fail-open behaviour and is asserted by
        // C-1 having offered it before these aliases existed.
        /** Reuses a definition when the seed already has one; records what it
         *  creates so `afterAll` can remove exactly that and nothing else. */
        const ensureDefinition = async (
          code: string,
          displayName: string,
          symbol: string,
          dimension: 'VOLUME' | 'PERSON_TIME',
        ) => {
          const existing = await prisma.unitDefinition.findUnique({
            where: { code },
          });
          if (existing) return existing;
          const created = await prisma.unitDefinition.create({
            data: { code, displayName, symbol, dimension, kind: 'CANONICAL' },
          });
          createdUnitDefinitionIds.push(created.id);
          return created;
        };
        const unit = await ensureDefinition(
          'M3',
          'Meter kubik',
          'm3',
          'VOLUME',
        );
        const personHour = await ensureDefinition(
          'ORG_HR',
          'Orang jam',
          'org/hr',
          'PERSON_TIME',
        );
        // EXACTLY ONE ACTIVE ALIAS PER SPELLING, and the reason is the point of
        // the test rather than fixture hygiene: this database already carried a
        // second active "m3" row, so the Unit authority answered
        // AMBIGUOUS_UNIT_ALIAS — correctly. An ambiguous spelling proves nothing,
        // so the column stayed on the list, so nothing was eliminated. The
        // authority was right and the FIXTURE was wrong.
        //
        // UnitAlias carries no unique key on (normalizedAlias, context), so the
        // duplicates are deactivated first and one row is left proving each
        // spelling. Deactivating rather than deleting keeps the seed's own history
        // intact.
        // PURELY ADDITIVE, so the teardown can be exact: existing rows are only
        // ever switched OFF (restorable by id), and the one active alias per
        // spelling is a row this suite created and will delete. Editing a
        // seeded row's unitDefinitionId in place would have been unrestorable.
        for (const [alias, definitionId] of [
          ['m3', unit.id],
          ['org/hr', personHour.id],
        ] as const) {
          const existing = await prisma.unitAlias.findMany({
            where: { normalizedAlias: alias, isActive: true },
            select: { id: true },
          });
          if (existing.length > 0) {
            deactivatedAliasIds.push(...existing.map((row) => row.id));
            await prisma.unitAlias.updateMany({
              where: { id: { in: existing.map((row) => row.id) } },
              data: { isActive: false },
            });
          }
          const created = await prisma.unitAlias.create({
            data: {
              rawAlias: alias,
              normalizedAlias: alias,
              unitDefinitionId: definitionId,
            },
          });
          createdUnitAliasIds.push(created.id);
        }

        const response = await askColumnRoles();
        expect(response.status).toBe(409);
        const offered = (response.body as ClarificationBody).nameCandidates;
        const columns = offered.map((c) => c.columnNumber);

        expect(columns).toContain(2);
        expect(columns).not.toContain(4);
      });
    });

    /**
     * THE MULTI-CLARIFICATION JOURNEY, DRIVEN AS THE BROWSER DRIVES IT.
     *
     * BasicPriceImportPage keeps one `selection` object, adds each answer to it,
     * and re-posts the SAME File with the WHOLE accumulated selection every
     * round. This suite does exactly that and nothing more — same field names,
     * same accumulation, same file bytes — so a defect in that contract fails
     * here rather than only in front of the Owner.
     *
     * The 86-row workbook proves direct intake. This one proves the STATE
     * MACHINE: four questions, every answer retained, ending in a real batch.
     */
    describe('MULTI-CLARIFICATION — four questions, one batch', () => {
      const MATRIX_PATH = 'C:/SIMPROK-WT/RM-03D1_GOLDEN_DATA_PACK_v1.1.xlsx';

      /** The page's own selection shape. Values are strings, as FormData sends. */
      type Selection = Record<string, string>;

      /** One round of `readSource(file, answers)` — file plus accumulated answers. */
      const postAs = (matrix: Buffer, answers: Selection) => {
        let req = request(server())
          .post('/basic-price-imports/preview')
          .set('Authorization', 'Bearer ' + token)
          .set('x-workspace-id', WORKSPACE_A)
          .attach('file', matrix, {
            filename: 'RM-03D1_GOLDEN_DATA_PACK_v1.1.xlsx',
            contentType:
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          });
        // Exactly `appendMetadata`'s rule in api/basicPriceImport: every non-empty
        // answer is appended, and nothing else is invented.
        for (const [key, value] of Object.entries(answers)) {
          req = req.field(key, value);
        }
        return req;
      };

      it('M-1. every answer accumulates, no question repeats, and Review opens', async () => {
        const matrix = readFileSync(MATRIX_PATH);
        const digest = createHash('sha256').update(matrix).digest('hex');

        // Round 1 — nothing answered yet.
        const answers: Selection = {};
        const round1 = await postAs(matrix, answers);
        const asked1 = round1.body as ClarificationBody;
        expect(round1.status).toBe(409);
        expect(asked1.message).toBe('REGION_COLUMN_SELECTION_REQUIRED');

        // Round 2 — the region answer is added, never replacing the file.
        answers.selectedRegionLabel = 'Baguala Price (Rp)';
        const round2 = await postAs(matrix, answers);
        const asked2 = round2.body as ClarificationBody;
        expect(round2.status).toBe(409);
        expect(asked2.message).toBe('SECTION_DECLARATION_REQUIRED');
        // MONOTONIC: the question moved on, which is only possible if round 2
        // was read WITH round 1's answer still attached.
        expect(asked2.message).not.toBe(asked1.message);

        // Round 3 — section added on top.
        answers.declaredSection = 'MATERIAL';
        const round3 = await postAs(matrix, answers);
        const asked3 = round3.body as ClarificationBody;
        expect(round3.status).toBe(409);
        expect(asked3.message).toBe('COLUMN_ROLE_SELECTION_REQUIRED');

        // Round 4 — the name column. The backend asks again for the unit column,
        // which is progress, not repetition: the answered half is now fixed.
        answers.selectedNameColumn = '2';
        const round4 = await postAs(matrix, answers);
        const asked4 = round4.body as ClarificationBody;
        expect(round4.status).toBe(409);
        expect(asked4.message).toBe('COLUMN_ROLE_SELECTION_REQUIRED');

        // Round 5 — the unit column completes the set, and intake proceeds.
        answers.selectedUnitColumn = '4';
        const round5 = await postAs(matrix, answers);
        expect({
          status: round5.status,
          body: round5.body as unknown,
        }).toMatchObject({
          status: 201,
        });
        const built = round5.body as BatchSummary;
        expect(built.totalRows).toBe(3);
        expect(built.rows).toHaveLength(3);

        // The file never changed identity across five rounds.
        expect(createHash('sha256').update(matrix).digest('hex')).toBe(digest);

        // Every answer is visible in what was built, so none was silently lost:
        // the declared section reached the rows, and the chosen name and unit
        // columns are the ones that were read.
        const names = built.rows.map((row) => row.name);
        expect(names).toEqual(['Pekerja', 'Mandor', 'Sirtu']);
        expect(built.rows.every((row) => row.section === 'MATERIAL')).toBe(
          true,
        );
        expect(built.rows.map((row) => row.unit)).toEqual([
          'Org/hr',
          'Org/hr',
          'm3',
        ]);

        // REVIEW OPENS on the batch the journey produced.
        const review = await request(server())
          .get(`/basic-price-imports/${built.batchId}`)
          .set('Authorization', 'Bearer ' + token)
          .set('x-workspace-id', WORKSPACE_A);
        expect(review.status).toBe(200);
        expect((review.body as BatchView).rows).toHaveLength(3);
      });

      it('M-2. NO-PROGRESS GUARD — the same answers never produce a different demand', async () => {
        // The loop shape this rules out: identical file + identical accumulated
        // answers must be a FUNCTION, not a walk. If the same state ever yielded
        // a different question, a reviewer could answer forever without
        // converging — which is the defect, not the workbook's fault.
        const matrix = readFileSync(MATRIX_PATH);
        const answers: Selection = {
          selectedRegionLabel: 'Baguala Price (Rp)',
          declaredSection: 'MATERIAL',
        };
        const first = await postAs(matrix, answers);
        const second = await postAs(matrix, answers);
        const askedFirst = first.body as ClarificationBody;
        const askedSecond = second.body as ClarificationBody;

        expect(first.status).toBe(second.status);
        expect(askedFirst.message).toBe(askedSecond.message);
        expect(askedFirst.nameCandidates.map((c) => c.columnNumber)).toEqual(
          askedSecond.nameCandidates.map((c) => c.columnNumber),
        );
      });

      it('M-3. ONE COLUMN CANNOT HOLD TWO ROLES — refused at the HTTP boundary', async () => {
        /**
         * THE OWNER'S 934-ROW BATCH, AT THE DOOR THAT CREATED IT.
         *
         * The real Ambon import was accepted with the RESOURCE NAME column
         * answered as the SOURCE UNIT column. Pool membership was the only
         * thing checked, and a column legitimately sits in both pools, so the
         * contradiction went through. Every row then wore its own name as its
         * unit; `classifyPhysicalRow` reads `hasUnitEvidence` from the unit
         * column, so 40 category banners looked commercial and entered the
         * review room; and the Unit authority, asked whether a resource name is
         * a unit of measure, truthfully refused for all 934 rows, so not one
         * identity pair could close.
         *
         * Every previous test of this dialogue — M-1 included — supplied the
         * honest answer, which is exactly why the defect shipped. This one
         * supplies the contradictory answer over real HTTP, because the browser
         * is not the only caller: an API client, a supplier bridge and a replay
         * must all meet the same refusal.
         */
        const matrix = readFileSync(MATRIX_PATH);
        const answers: Selection = {
          selectedRegionLabel: 'Baguala Price (Rp)',
          declaredSection: 'MATERIAL',
          selectedNameColumn: '2',
        };

        // THE OPTION IS NOT EVEN OFFERED. With the name column fixed, the unit
        // question no longer lists it — a button that cannot lead anywhere.
        const asking = await postAs(matrix, answers);
        expect(asking.status).toBe(409);
        const asked = asking.body as ClarificationBody;
        expect(asked.message).toBe('COLUMN_ROLE_SELECTION_REQUIRED');
        const offered = asked.unitCandidates.map((c) => c.columnNumber);
        expect(offered).not.toContain(2);
        // ...and the real unit column is still there, so this is a narrowing,
        // never a silencing: the question remains answerable.
        expect(offered).toContain(4);

        const sourceFileName = 'RM-03D1_GOLDEN_DATA_PACK_v1.1.xlsx';
        const batchCount = () =>
          prisma.basicPriceImportBatch.count({
            where: { workspaceId: WORKSPACE_A, sourceFileName },
          });
        const before = await batchCount();

        // AND IF IT IS ANSWERED ANYWAY, IT IS REFUSED — not repaired. SIMPROK
        // does not move the unit role to another column, because which column
        // holds the unit is still the one question only a reader can answer.
        const collided = await postAs(matrix, {
          ...answers,
          selectedUnitColumn: '2',
        });
        const refusal = collided.body as ClarificationBody;
        expect(collided.status).toBe(409);
        expect(refusal.message).toBe('COLUMN_ROLE_SELECTION_REQUIRED');
        expect(refusal.unitCandidates.map((c) => c.columnNumber)).not.toContain(
          2,
        );

        // NO BATCH WAS BORN OF THE CONTRADICTION. This is the assertion that
        // would have spared the Owner 934 unresolvable rows.
        expect(await batchCount()).toBe(before);
      });
    });

    /**
     * NARROW CLOSEOUT — DOES THE KNOWLEDGE SIMPROK ALREADY OWNS ANSWER THIS
     * WORKBOOK, AND DOES THE ANSWER REACH A PERSON?
     *
     * Two different questions live here and they are kept apart on purpose,
     * because conflating them is how a green suite comes to mean nothing:
     *
     *   THE PRODUCT SEQUENCE — upload, describe, reload, resolve, keep, repeat,
     *   reload, look. That is plumbing, and plumbing is provable with any data.
     *
     *   THE INTELLIGENCE DIVIDEND — how much of this workbook the canonical
     *   Resource Identity and Unit authorities answer BY THEMSELVES, from
     *   reference knowledge that existed before the workbook did. That is only
     *   provable if nothing here plants the answer first.
     *
     * So no row of this workbook has a catalog row made for it. The reference
     * knowledge came from the reviewed RM-02C0 inventory in `beforeAll`, and the
     * measurement below is taken BEFORE a single human resolution.
     *
     * WHAT THIS SUITE IS NOT. `WORKSPACE_A` is the E2E workspace, not the
     * Owner's canonical workspace, and this batch is not the Owner's canonical
     * batch. What is genuinely the Owner's is the workbook (SHA-pinned in R-1),
     * the reference inventory, and the region the workbook names.
     */
    describe('NARROW CLOSEOUT — real reference knowledge, private use, Explorer', () => {
      /** Carried between the ordered steps below, exactly as one session would. */
      let batchId = '';
      let resolvedRowIds: string[] = [];
      let createdPriceIds: string[] = [];
      /** What the ONE governed command answered, kept for the steps after it. */
      let smartSaveOutcome: SmartSaveResult | null = null;

      const getBatch = () =>
        request(server())
          .get(`/basic-price-imports/${batchId}`)
          .set('Authorization', 'Bearer ' + token)
          .set('x-workspace-id', WORKSPACE_A);

      const readBatch = async (): Promise<BatchView> => {
        const response = await getBatch();
        expect(response.status).toBe(200);
        return response.body as BatchView;
      };

      it('N-1. the Owner batch exists, states no metadata, and the room says WHY it cannot act', async () => {
        const created = await previewAsBrowser();
        expect(created.status).toBe(201);
        batchId = (created.body as BatchSummary).batchId;
        closeoutBatchId = batchId;
        expect((created.body as BatchSummary).totalRows).toBe(
          EXPECTED_SOURCE_ROWS,
        );

        const batch = await readBatch();
        // A browser upload carries no metadata at all, so all four facts are
        // unstated and the batch has never been PATCHed — exactly the state the
        // Owner's own canonical batch was found in.
        expect(batch.regionId).toBeNull();
        expect(batch.version).toBe(0);
        // The room is not silent about it. Effective date is refused first by
        // the one policy both writers read, so THAT is the sentence a person
        // gets — not a dead button.
        expect(batch.actions.privateUse).toMatchObject({
          offered: false,
          reasonCode: 'EFFECTIVE_DATE_REQUIRED_BEFORE_PRIVATE_USE',
        });
      });

      /**
       * N-2 — THE SOURCE SAID A YEAR, SO SIMPROK MAY NOT CLAIM A DAY.
       *
       * The workbook states `source_year` = 2024 and prints no date anywhere. A
       * Basic Price needs a calendar day, so one is DERIVED — and the derivation
       * is stated rather than hidden: the source's own period wording, its
       * granularity, the fact that the day is SIMPROK's and not the source's,
       * and the named rule that produced it. `assertTemporalProvenanceCoherent`
       * then re-derives the day from those three facts and refuses the write if
       * it does not come back 2024-01-01, so this is a claim the server checks
       * rather than a label this test attached.
       */
      it('N-2. METADATA PERSISTENCE — only facts the workbook actually states', async () => {
        const before = await readBatch();

        const patched = await request(server())
          .patch(`/basic-price-imports/${batchId}`)
          .set('Authorization', 'Bearer ' + token)
          .set('x-workspace-id', WORKSPACE_A)
          .send({
            version: before.version,
            regionId: REGION_ID,
            effectiveDate: '2024-01-01',
            sourcePeriodLabel: '2024',
            sourcePeriodGranularity: 'YEAR',
            effectiveDateProvenance: 'DERIVED_FROM_SOURCE_PERIOD',
            effectiveDateDerivationRule: 'PERIOD_START',
            sourceOrigin: 'FIELD_REPORT',
            sourceType: 'MARKET_SURVEY',
          });

        expect({
          status: patched.status,
          body: patched.body as unknown,
        }).toMatchObject({
          status: 200,
        });
        const saved = patched.body as BatchView;
        expect(saved.regionId).toBe(REGION_ID);
        expect(saved.region).toMatchObject({
          id: REGION_ID,
          code: REGION_CODE,
          name: REGION_NAME,
        });
        // NOTHING WAS INVENTED. No publisher name was sent, because the file
        // names none, so the record stays honestly empty.
        expect(saved.sourceOrganizationName).toBeNull();
      });

      it('N-3. RELOAD — the region reads back as the PLACE the workbook named', async () => {
        const batch = await readBatch();
        expect(batch.regionId).toBe(REGION_ID);
        expect(batch.region).toMatchObject({
          id: REGION_ID,
          code: REGION_CODE,
          name: REGION_NAME,
        });
        expect(batch.effectiveDate).not.toBeNull();
        expect(batch.sourceOrigin).toBe('FIELD_REPORT');
        expect(batch.sourceType).toBe('MARKET_SURVEY');
        // No metadata blocker survives. What blocks now is a DIFFERENT fact —
        // nobody has finished a row yet — and it is named as such.
        expect(batch.actions.privateUse).toMatchObject({
          offered: false,
          reasonCode: 'NO_ROWS_READY_FOR_PRIVATE_USE',
        });

        // The Region row itself is the one the governed provisioner made, with
        // the designation copied verbatim — not trimmed, not case-folded.
        const stored = await prisma.region.findUniqueOrThrow({
          where: { id: REGION_ID },
          select: { code: true, name: true, isActive: true },
        });
        expect(stored).toEqual({
          code: REGION_CODE,
          name: REGION_NAME,
          isActive: true,
        });
      });

      /**
       * N-4 — THE DECISIVE MEASUREMENT, TAKEN BEFORE ANY HUMAN RESOLUTION.
       *
       * Nothing has been resolved, nothing has been admitted, and no catalog row
       * exists that was made for this workbook. Every number below is what the
       * canonical authorities said on their own.
       *
       * IT ASSERTS A FLOOR, NOT AN EXACT COUNT. The reference inventory and the
       * workbook are two independent real documents; how much they overlap is a
       * fact about the Owner's data, not a target this suite may pin. What it
       * DOES pin is the property that matters: the dividend is greater than
       * zero, it came from both authorities, and it came from reference rows
       * that existed before this batch did.
       */
      it('N-4. INTELLIGENCE DIVIDEND — measured before a single human decision', async () => {
        const batch = await readBatch();
        const rows = batch.rows;
        expect(rows).toHaveLength(EXPECTED_SOURCE_ROWS);

        const asked = rows.filter((r) => r.machineProposal !== null);
        const resourceProven = rows.filter(
          (r) => r.machineProposal?.resource.status === 'RESOLVED',
        );
        const resourceCandidates = rows.filter(
          (r) =>
            r.machineProposal?.resource.status !== 'RESOLVED' &&
            (r.machineProposal?.resource.candidates.length ?? 0) > 0,
        );
        const resourceNotFound = rows.filter((r) =>
          r.machineProposal?.resource.reasonCodes.includes(
            'RESOURCE_NOT_FOUND',
          ),
        );
        const sectionUnresolved = rows.filter((r) =>
          r.machineProposal?.resource.reasonCodes.includes(
            'ROW_SOURCE_SECTION_UNRESOLVED',
          ),
        );
        const unitProven = rows.filter(
          (r) => r.machineProposal?.unit.unitDefinitionId != null,
        );
        const unitNeedsReview = rows.filter(
          (r) =>
            r.machineProposal !== null &&
            r.machineProposal.unit.unitDefinitionId === null,
        );
        const pairProven = rows.filter(
          (r) => r.machineProposal?.identityPairProven === true,
        );
        pairProvenAtMeasurement = pairProven.length;

        // Printed so the exact dividend is a reported number, never a claim
        // reconstructed from a passing assertion.
        console.log(
          'REAL_86_INTELLIGENCE ' +
            JSON.stringify({
              TOTAL_ROWS: rows.length,
              PRICE_ROWS: rows.length,
              ASKED_AUTHORITIES: asked.length,
              RESOURCE_AUTO_PROVEN: resourceProven.length,
              RESOURCE_CANDIDATE_FOUND: resourceCandidates.length,
              RESOURCE_NOT_FOUND: resourceNotFound.length,
              ROW_SOURCE_SECTION_UNRESOLVED: sectionUnresolved.length,
              UNIT_AUTO_PROVEN: unitProven.length,
              UNIT_NEEDS_REVIEW: unitNeedsReview.length,
              IDENTITY_PAIR_PROVEN: pairProven.length,
              READY_WITHOUT_MANUAL_RESOURCE_RESELECTION: pairProven.length,
              /**
               * NOT "human exceptions". The remainder is a SUBTRACTION, and a
               * subtraction has not adjudicated anything: it silently merges a
               * row the authority narrowed to a shortlist with a row it has
               * never heard of, and calls both "work for a person". The four
               * factual categories above are what was actually measured, and
               * they already partition the workbook; this line only says how
               * many rows did not close BOTH legs by machine.
               */
              ROWS_NOT_FULLY_PAIR_PROVEN: rows.length - pairProven.length,
              proven: pairProven.map((r) => r.name),
            }),
        );

        // THE DIVIDEND IS REAL. Both legs answered, and the pair closed on rows
        // this suite never touched.
        expect(unitProven.length).toBeGreaterThan(0);
        expect(resourceProven.length).toBeGreaterThan(0);
        expect(pairProven.length).toBeGreaterThan(0);
        expect(batch.identityPairProvenRows).toBe(pairProven.length);

        // EVERY PROVEN RESOURCE IS A PRE-EXISTING REFERENCE ROW, never one made
        // for this workbook. Provenance is the proof: each catalog row the
        // authority chose carries a sighting from the RM-02C0 source workbook,
        // whose SHA is a different file entirely.
        for (const row of pairProven) {
          const catalogId = row.machineProposal!.resource.resourceCatalogId!;
          const sightings = await prisma.resourceSourceIdentity.findMany({
            where: { resourceCatalogId: catalogId, workspaceId: WORKSPACE_A },
            select: { sourceSha256: true },
          });
          expect(sightings.length).toBeGreaterThan(0);
          for (const sighting of sightings) {
            expect(sighting.sourceSha256).not.toBe(
              createHash('sha256').update(workbook).digest('hex').toUpperCase(),
            );
          }
          // And the authority — not this file — is what settled it.
          expect(row.machineProposal!.resource.authority).not.toBeNull();
          expect(row.machineProposal!.resource.admissibleForResolve).toBe(true);
        }

        // THE HONEST REMAINDER, AND IT IS NOT ONE LUMP. Every row lands in
        // exactly one of four states and the four exhaust the workbook:
        //
        //   PROVEN            the authority settled the identity by itself
        //   CANDIDATES FOUND  it could not settle it, but it narrowed it — the
        //                     reviewer gets a shortlist, not a blank box
        //   NOT FOUND         nothing in the reference knowledge resembles it
        //   NO SECTION        the source stated a family SIMPROK cannot map, so
        //                     the authority was never asked at all
        //
        // Asserting the partition rather than a lump is what keeps the middle
        // state visible: a workbook can be far from "resolved" and still have
        // had most of the reviewer's search done for it.
        expect(
          resourceProven.length +
            resourceCandidates.length +
            resourceNotFound.length +
            sectionUnresolved.length,
        ).toBe(rows.length);
        // NOTHING WAS GUESSED INTO PLACE. A candidate is evidence, never a
        // selection: none of those rows is offered as resolvable.
        for (const row of resourceCandidates) {
          expect(row.machineProposal!.resource.resourceCatalogId).toBeNull();
          expect(row.machineProposal!.resource.admissibleForResolve).toBe(
            false,
          );
          expect(row.machineProposal!.identityPairProven).toBe(false);
        }
      });

      /**
       * N-5. ONE GOVERNED COMMAND — the whole of `Simpan & Gunakan`.
       *
       * THIS TEST REPLACED A LOOP. It used to POST `/rows/:id/resolve` thirteen
       * times, which is exactly the transcription the product law forbids: a
       * human must not re-enter thirteen identities SIMPROK has already proven.
       * It then let the BROWSER sequence accept-then-keep, which made a client
       * the orchestrator of two business mutations.
       *
       * So this is now one request, and the assertions below are the permanent
       * proof of every claim that request makes.
       */
      it('N-5. ONE command binds every proven row and keeps them — zero individual clicks', async () => {
        const before = await readBatch();
        const proven = before.rows.filter(
          (r) => r.machineProposal?.identityPairProven === true,
        );
        expect(proven.length).toBe(pairProvenAtMeasurement);

        // NOTHING IS PERSISTED BEFORE THE HUMAN ACTS. Not one binding exists
        // yet, so whatever the command reports it genuinely did on this press.
        const bindingsBefore =
          await prisma.basicPriceImportRowResourceMapping.count({
            where: { workspaceId: WORKSPACE_A },
          });
        expect(bindingsBefore).toBe(0);
        expect(before.readyForSubmissionRows).toBe(0);

        const response = await request(server())
          .post(`/basic-price-imports/${batchId}/smart-save`)
          .set('Authorization', 'Bearer ' + token)
          .set('x-workspace-id', WORKSPACE_A)
          // THE BODY CARRIES NO IDENTITY — no catalog id, no unit id, no
          // bindings. Only intent, and here not even an exclusion.
          .send({});

        expect({
          status: response.status,
          body: response.body as unknown,
        }).toMatchObject({ status: 201 });

        const outcome = response.body as SmartSaveResult;
        smartSaveOutcome = outcome;
        resolvedRowIds = outcome.accepted.acceptedRowIds ?? [];

        // THE SERVER DERIVED THE SET. It found exactly the rows the authorities
        // could still prove — not a list this test supplied.
        expect(outcome.accepted.eligibleCount).toBe(pairProvenAtMeasurement);
        expect(outcome.accepted.acceptedCount).toBe(pairProvenAtMeasurement);
        expect(outcome.accepted.skippedCount).toBe(0);
        expect(outcome.accepted.excludedCount).toBe(0);
        // The Owner's workbook finishes in ONE command.
        expect(outcome.accepted.remainingEligible).toBe(0);
        // AND IT KEPT THEM, in the same command.
        expect(outcome.kept.createdCount).toBe(pairProvenAtMeasurement);
        expect(outcome.kept.alreadyPrivateCount).toBe(0);
        createdPriceIds = outcome.kept.prices.map((p) => p.basicPriceId);
      });

      it('N-5a. AUDIT SAYS WHO AND HOW — a batch acceptance is not a manual one', async () => {
        const mappings =
          await prisma.basicPriceImportRowResourceMapping.findMany({
            where: { workspaceId: WORKSPACE_A },
            select: { reviewerAccountId: true, reason: true, rowId: true },
          });

        // One append-only decision per bound row, every one naming a REAL human.
        expect(mappings).toHaveLength(pairProvenAtMeasurement);
        for (const mapping of mappings) {
          expect(mapping.reviewerAccountId).toBeTruthy();
          // HOW is recorded, not just WHO. A blank reason would make a governed
          // batch acceptance indistinguishable from a reviewer who confirmed one
          // row and typed no note.
          expect(mapping.reason).toBe('ACCEPTED_MACHINE_PROVEN_BATCH');
        }
        expect(new Set(mappings.map((m) => m.rowId)).size).toBe(
          pairProvenAtMeasurement,
        );
      });

      it('N-5b. THE AUTHORITY WAS ASKED ONCE, not once per row', () => {
        // Binding N rows must not re-run the identity authority's whole evidence
        // load N times inside the transaction. The command reports what it did,
        // and a future edit reintroducing the N+1 fails here.
        expect(smartSaveOutcome!.accepted.evidenceLoads).toBe(1);
        // Bounded work: deterministic chunks, never one giant transaction.
        expect(smartSaveOutcome!.accepted.chunks).toBeGreaterThan(0);
        expect(smartSaveOutcome!.accepted.chunks).toBeLessThanOrEqual(
          pairProvenAtMeasurement,
        );
      });

      it('N-6. THE HONEST REMAINDER — ambiguous, unknown and family-less rows are untouched', async () => {
        const batch = await readBatch();
        expect(batch.readyForSubmissionRows).toBe(resolvedRowIds.length);

        // INCREMENTAL, NOT ALL-OR-NOTHING: everything the machine could not
        // prove is still open, still editable, and still a human's to decide.
        expect(batch.status).toBe('NEEDS_REVIEW');
        expect(batch.needsReviewRows).toBe(
          EXPECTED_SOURCE_ROWS - resolvedRowIds.length,
        );

        // AND NOT ONE OF THEM WAS BOUND. A candidate shortlist is evidence, a
        // not-found name is silence, and an unmapped source family is a refusal
        // to guess — none of the three is a decision the machine may make.
        const untouched = batch.rows.filter(
          (r) => !resolvedRowIds.includes(r.id),
        );
        expect(untouched).toHaveLength(
          EXPECTED_SOURCE_ROWS - resolvedRowIds.length,
        );
        for (const row of untouched) {
          expect(row.resourceCatalogId).toBeNull();
          expect(row.machineProposal?.identityPairProven ?? false).toBe(false);
        }
      });

      it('N-7. THE KEPT PRICES ARE WORKSPACE-PRIVATE, and carry the source facts verbatim', async () => {
        // Read from the database rather than from the response that claimed it.
        const stored = await prisma.basicPrice.findMany({
          where: { id: { in: createdPriceIds } },
          select: {
            assetScope: true,
            regionId: true,
            workspaceId: true,
            status: true,
            verificationStatus: true,
            sourceOrigin: true,
            sourceType: true,
            effectiveDateProvenance: true,
            effectiveDateDerivationRule: true,
            sourcePeriodLabel: true,
            reviewDate: true,
            validUntil: true,
            freshnessStatus: true,
          },
        });
        expect(stored).toHaveLength(resolvedRowIds.length);
        for (const price of stored) {
          expect(price.assetScope).toBe('WORKSPACE_PRIVATE');
          expect(price.regionId).toBe(REGION_ID);
          expect(price.workspaceId).toBe(WORKSPACE_A);
          // Usable WITHOUT publication, and never wearing publication's clothes.
          expect(price.status).toBe('UNPUBLISHED');
          expect(price.verificationStatus).toBe('UNVERIFIED');
          // The source facts travel verbatim, including the admission that the
          // day is SIMPROK's and not the source's.
          expect(price.sourceOrigin).toBe('FIELD_REPORT');
          expect(price.sourceType).toBe('MARKET_SURVEY');
          expect(price.effectiveDateProvenance).toBe(
            'DERIVED_FROM_SOURCE_PERIOD',
          );
          expect(price.effectiveDateDerivationRule).toBe('PERIOD_START');
          expect(price.sourcePeriodLabel).toBe('2024');

          // SOFT RE-VERIFICATION IS NOT INVENTED. This batch's metadata states
          // no re-verification date, so the price carries none — SIMPROK does
          // not compute a freshness horizon. And it never becomes a HARD
          // boundary: `validUntil` stays null and freshness stays CURRENT, so
          // nothing here can remove the price from an AHSP candidate set.
          expect(price.reviewDate).toBeNull();
          expect(price.validUntil).toBeNull();
          expect(price.freshnessStatus).toBe('CURRENT');
        }
      });

      it('N-8. REPEAT IS IDEMPOTENT — the same command again changes nothing', async () => {
        const response = await request(server())
          .post(`/basic-price-imports/${batchId}/smart-save`)
          .set('Authorization', 'Bearer ' + token)
          .set('x-workspace-id', WORKSPACE_A)
          .send({});

        expect(response.status).toBe(201);
        const again = response.body as SmartSaveResult;

        // Nothing left to bind: a bound row is no longer NEEDS_REVIEW, so the
        // server derives an empty eligible set rather than re-binding.
        expect(again.accepted.eligibleCount).toBe(0);
        expect(again.accepted.acceptedCount).toBe(0);
        // Nothing left to keep, and the existing prices are named as existing
        // rather than reported as a second success.
        expect(again.kept.createdCount).toBe(0);
        expect(again.kept.alreadyPrivateCount).toBe(resolvedRowIds.length);

        // NO DUPLICATE BINDING, NO DUPLICATE PRICE.
        const mappings = await prisma.basicPriceImportRowResourceMapping.count({
          where: { workspaceId: WORKSPACE_A },
        });
        expect(mappings).toBe(resolvedRowIds.length);
        const total = await prisma.basicPrice.count({
          where: { sourceImportRowId: { in: resolvedRowIds } },
        });
        expect(total).toBe(resolvedRowIds.length);
      });

      it('N-8a. A HUMAN EXCLUSION IS RESPECTED — the machine never overrules a person', async () => {
        // A reviewer mid-correction on a row the machine happens to have proven
        // must not have their work overwritten. The client says "not that one";
        // it never says what the identity IS.
        const batch = await readBatch();
        const stillOpen = batch.rows.find(
          (r) => r.machineProposal?.identityPairProven === true,
        );
        // Every proven row was bound by N-5, so there is nothing left to prove
        // here on this batch — the exclusion path is asserted against the
        // command's own accounting instead, which is what the client controls.
        expect(stillOpen).toBeUndefined();

        const response = await request(server())
          .post(`/basic-price-imports/${batchId}/smart-save`)
          .set('Authorization', 'Bearer ' + token)
          .set('x-workspace-id', WORKSPACE_A)
          .send({ excludeRowIds: resolvedRowIds.slice(0, 2) });

        expect(response.status).toBe(201);
        const excluded = response.body as SmartSaveResult;
        expect(excluded.accepted.excludedCount).toBe(2);
        expect(excluded.accepted.acceptedCount).toBe(0);
        // And nothing was created or duplicated by asking.
        expect(excluded.kept.createdCount).toBe(0);
      });

      it('N-9. RELOAD PRESERVES THE RESULT — region, ready rows and the open remainder', async () => {
        const batch = await readBatch();
        expect(batch.regionId).toBe(REGION_ID);
        expect(batch.region).toMatchObject({
          id: REGION_ID,
          code: REGION_CODE,
        });
        expect(batch.readyForSubmissionRows).toBe(resolvedRowIds.length);

        /**
         * AND THE ROOM NO LONGER OFFERS TO DO WORK THAT IS DONE.
         *
         * THIS ASSERTION USED TO READ `offered: true`, and that was the defect
         * the Owner met in the browser: every one of these thirteen rows had
         * just become a price, and the primary action went on inviting them to
         * store thirteen rows — because a kept row never leaves
         * READY_FOR_SUBMISSION and nothing in the projection could see that a
         * price already existed for it.
         *
         * `readyForSubmissionRows` is unchanged above, deliberately: that count
         * is about the SEPARATE, optional curation door and is still true. What
         * changed is the ANSWER to "is there anything left for this press to
         * do", which is now measured rather than assumed.
         *
         * NOT A SAFETY BOUNDARY. `smart-save` remains idempotent for a stale
         * tab that presses anyway — N-8 proves exactly that, and still does.
         */
        expect(batch.alreadyPrivateRows).toBe(resolvedRowIds.length);
        expect(batch.actions.privateUse).toMatchObject({
          offered: false,
          reasonCode: 'ALL_READY_ROWS_ALREADY_PRIVATE',
          actionableRows: 0,
        });

        // UNRESOLVED ROWS REMAIN UNRESOLVED. Keeping the finished ones must
        // never quietly decide the others.
        expect(batch.needsReviewRows).toBe(
          EXPECTED_SOURCE_ROWS - resolvedRowIds.length,
        );
        expect(batch.rejectedRows).toBe(0);
      });

      it('N-10. EXPLORER — the created prices are visible through the canonical read path', async () => {
        const response = await request(server())
          .get('/basic-prices')
          // 50 is the Explorer's own maximum page size; asking for more is a
          // 400, which is the API refusing to be told how to paginate.
          .query({ regionId: REGION_ID, limit: 50 })
          .set('Authorization', 'Bearer ' + token)
          .set('x-workspace-id', WORKSPACE_A);

        expect({
          status: response.status,
          body: response.body as unknown,
        }).toMatchObject({
          status: 200,
        });
        const page = response.body as {
          data: Array<{
            basicPriceId: string;
            assetScope: string;
            region: { name: string } | null;
          }>;
        };
        const visible = page.data.filter((item) =>
          createdPriceIds.includes(item.basicPriceId),
        );
        expect(visible).toHaveLength(createdPriceIds.length);
        for (const item of visible) {
          expect(item.assetScope).toBe('WORKSPACE_PRIVATE');
          // The Explorer names the PLACE, never an id.
          expect(item.region?.name).toBe(REGION_NAME);
        }
      });
    });

    /**
     * ═══ SEAM 1 ═══ A RE-VERIFICATION DATE A HUMAN STATED, CARRIED THE WHOLE WAY.
     *
     * WHY A SECOND BATCH RATHER THAN A LINE ADDED TO THE FIRST. The closeout
     * above proves the ABSENCE law: the Owner's batch states no re-verification
     * date, so nothing anywhere invents one and every price it created carries
     * null (N-7). That proof is only worth having while it is real, so it is
     * left exactly as it is and the PRESENCE law is proven on its own batch.
     * Together they pin both halves — SIMPROK carries what a person stated, and
     * carries nothing when they stated nothing.
     *
     * AND IT TRAVELS THE ORDINARY CONTRACT. The date is sent on the SAME
     * metadata PATCH the browser sends, beside the facts the file itself
     * states. No fixture writes `reviewDate` onto a BasicPrice, no assertion is
     * reached by mutating the database after the import, and no diagnostic-only
     * path is used — a proof that needs a private door has proven nothing about
     * the door the Owner will actually use.
     */
    describe('RE-VERIFICATION DATE — stated by a human, carried, never invented', () => {
      ownsScenarioWorkspaceAlone();

      /**
       * A DATE NOTHING COULD HAVE DERIVED. The workbook states the year 2024
       * and this batch's effective date is 2024-01-01, so no horizon rule of
       * any shape — plus one year, plus two, end of period — lands on 30 June
       * 2027. If this value appears on a price, a human put it there.
       */
      const STATED_REVIEW_DATE = '2027-06-30';
      let batchId = '';
      let createdPriceIds: string[] = [];

      const readBatch = async (): Promise<BatchView> => {
        const response = await request(server())
          .get('/basic-price-imports/' + batchId)
          .set('Authorization', 'Bearer ' + token)
          .set('x-workspace-id', SCENARIO_WORKSPACE_ID);
        expect(response.status).toBe(200);
        return response.body as BatchView;
      };

      it('D-1. the date is stated on the ORDINARY metadata contract, and reads back', async () => {
        // Uploaded by someone who already knew the place. That one true fact,
        // stated at upload, is what makes this its own import rather than a
        // replay of the Owner's — asserted below, never assumed.
        const created = await previewDeclaring(
          { regionId: REGION_ID },
          SCENARIO_WORKSPACE_ID,
        );
        expect(created.status).toBe(201);
        batchId = (created.body as BatchSummary).batchId;
        expect(batchId).not.toBe(closeoutBatchId);
        expect((created.body as BatchSummary).totalRows).toBe(
          EXPECTED_SOURCE_ROWS,
        );

        // Nothing has been said about re-verification, and an unstated date is
        // null rather than a default.
        const fresh = await readBatch();
        expect(fresh.reviewDate).toBeNull();

        const patched = await request(server())
          .patch('/basic-price-imports/' + batchId)
          .set('Authorization', 'Bearer ' + token)
          .set('x-workspace-id', SCENARIO_WORKSPACE_ID)
          .send({
            version: fresh.version,
            regionId: REGION_ID,
            effectiveDate: '2024-01-01',
            sourcePeriodLabel: '2024',
            sourcePeriodGranularity: 'YEAR',
            effectiveDateProvenance: 'DERIVED_FROM_SOURCE_PERIOD',
            effectiveDateDerivationRule: 'PERIOD_START',
            sourceOrigin: 'FIELD_REPORT',
            sourceType: 'MARKET_SURVEY',
            // THE ONE NEW FACT — the same optional field the metadata form
            // offers as `Verifikasi ulang pada`, on the same PATCH.
            reviewDate: STATED_REVIEW_DATE,
          });
        expect({
          status: patched.status,
          body: patched.body as unknown,
        }).toMatchObject({ status: 200 });

        // RELOADED, not read off the response that claimed it.
        const saved = await readBatch();
        expect(saved.reviewDate?.slice(0, 10)).toBe(STATED_REVIEW_DATE);

        // AND THE STORED ROW ITSELF, so no projection can flatter the record.
        const stored = await prisma.basicPriceImportBatch.findUniqueOrThrow({
          where: { id: batchId },
          select: { reviewDate: true, effectiveDate: true },
        });
        expect(stored.reviewDate?.toISOString().slice(0, 10)).toBe(
          STATED_REVIEW_DATE,
        );
        // THE SOFT DATE MOVED NOTHING HARD. Effective date is still the day
        // the source's own period implies. `validUntil` is a BasicPrice fact,
        // not a batch one, and is proven untouched on the prices in D-3.
        expect(stored.effectiveDate?.toISOString().slice(0, 10)).toBe(
          '2024-01-01',
        );
      });

      it('D-2. ONE smart-save, and the machine-proven baseline is unchanged', async () => {
        const before = await readBatch();
        const proven = before.rows.filter(
          (r) => r.machineProposal?.identityPairProven === true,
        );
        // THE BASELINE IS A PROPERTY OF THE WORKBOOK AND THE REFERENCE
        // KNOWLEDGE, not of how many batches have been through this room. If an
        // earlier press had taught the identity authority to prove more, this
        // is where it would show.
        expect(proven).toHaveLength(pairProvenAtMeasurement);

        const response = await request(server())
          .post('/basic-price-imports/' + batchId + '/smart-save')
          .set('Authorization', 'Bearer ' + token)
          .set('x-workspace-id', SCENARIO_WORKSPACE_ID)
          .send({});
        expect({
          status: response.status,
          body: response.body as unknown,
        }).toMatchObject({ status: 201 });

        const outcome = response.body as SmartSaveResult;
        expect(outcome.accepted.acceptedCount).toBe(pairProvenAtMeasurement);
        expect(outcome.kept.createdCount).toBe(pairProvenAtMeasurement);
        createdPriceIds = outcome.kept.prices.map((p) => p.basicPriceId);
      });

      /**
       * D-3 — THE ONE ASSERTION THIS SEAM EXISTS FOR.
       *
       * The date a person typed on the import form is on the price, exactly as
       * typed, and it made nothing else move. `validUntil` is still null
       * because only a source that states a hard limit may set that, and
       * freshness is still CURRENT because re-verification is ADVICE: an
       * EXPIRED here would quietly remove the price from every AHSP candidate
       * set, which is the precise harm the soft/hard split exists to prevent.
       */
      it('D-3. every created price carries the stated date — and nothing else moved', async () => {
        const stored = await prisma.basicPrice.findMany({
          where: { id: { in: createdPriceIds } },
          select: {
            reviewDate: true,
            validUntil: true,
            effectiveDate: true,
            freshnessStatus: true,
          },
        });
        expect(stored).toHaveLength(pairProvenAtMeasurement);
        for (const price of stored) {
          expect(price.reviewDate?.toISOString().slice(0, 10)).toBe(
            STATED_REVIEW_DATE,
          );
          expect(price.validUntil).toBeNull();
          expect(price.effectiveDate?.toISOString().slice(0, 10)).toBe(
            '2024-01-01',
          );
          expect(price.freshnessStatus).toBe('CURRENT');
        }
      });

      /**
       * D-4 — THE EXPLORER, which is where a person actually meets the date.
       *
       * `reverification` is derived at READ time from the stated date and is
       * stored nowhere, so a price imported today reads CURRENT and the same
       * price reads DUE the morning after 30 June 2027 without a single row
       * being rewritten. The words the browser puts around it are pinned
       * separately, as pure functions, in `basicPriceSmartUx.test.ts`.
       */
      it('D-4. EXPLORER — the canonical read path carries the date and calls it re-verification', async () => {
        /**
         * THIS ASSERTION HAS A SHELF LIFE, AND SAYS SO. `CURRENT` is only the
         * right answer while the stated day is still ahead; after it, the very
         * same law answers `DUE`. Stated as its own check so a run in July 2027
         * fails with the reason rather than with a mystery.
         */
        expect(Date.now()).toBeLessThan(Date.parse(STATED_REVIEW_DATE));

        const response = await request(server())
          .get('/basic-prices')
          .query({ regionId: REGION_ID, limit: 50 })
          .set('Authorization', 'Bearer ' + token)
          .set('x-workspace-id', SCENARIO_WORKSPACE_ID);
        expect(response.status).toBe(200);

        const page = response.body as {
          data: Array<{
            basicPriceId: string;
            reviewDate: string | null;
            reverification: string;
            validUntil: string | null;
            freshnessStatus: string;
          }>;
        };
        const visible = page.data.filter((item) =>
          createdPriceIds.includes(item.basicPriceId),
        );
        expect(visible).toHaveLength(createdPriceIds.length);
        expect(visible.length).toBeGreaterThan(0);
        for (const item of visible) {
          expect(item.reviewDate?.slice(0, 10)).toBe(STATED_REVIEW_DATE);
          // A future date is a note, not a warning, and never a withdrawal.
          expect(item.reverification).toBe('CURRENT');
          expect(item.validUntil).toBeNull();
          expect(item.freshnessStatus).toBe('CURRENT');
        }
      });

      /**
       * D-5 — BLANK STILL MEANS BLANK, proven side by side rather than
       * remembered from an earlier block. Two batches of the SAME workbook
       * through the same door minutes apart: the one whose form carried a date
       * has it, and the one whose form did not has nothing. No horizon, no
       * channel rule, no two-year default.
       */
      it('D-5. NO HIDDEN HORIZON — the batch that stated no date still created none', async () => {
        const missing = await prisma.basicPrice.count({
          where: { id: { in: createdPriceIds }, reviewDate: null },
        });
        expect(missing).toBe(0);

        const closeoutPrices = await prisma.basicPrice.findMany({
          where: { sourceImportRow: { batchId: closeoutBatchId } },
          select: { reviewDate: true },
        });
        expect(closeoutPrices.length).toBeGreaterThan(0);
        for (const price of closeoutPrices) {
          expect(price.reviewDate).toBeNull();
        }
      });
    });

    /**
     * ═══ SEAM 2 ═══ AN EXPLICIT HUMAN EXCLUSION, BEFORE THE MACHINE EVER BINDS.
     *
     * WHAT THE EARLIER PROOF COULD NOT SHOW. N-8a asks for an exclusion on a
     * batch whose every proven row had ALREADY been bound by N-5, so the server
     * had nothing left to bind and "the excluded row was not bound" was true by
     * arithmetic rather than by obedience. A law that only holds when there is
     * no work to do is not a law.
     *
     * SO THIS OPENS ITS OWN BATCH AND EXCLUDES BEFORE THE FIRST BINDING EXISTS.
     * Zero mappings, zero ready rows, thirteen rows the authorities can prove —
     * and then ONE press that says "not that one" about a row SIMPROK is
     * certain of. Twelve bind; the thirteenth stays exactly where the human
     * left it.
     *
     * AUTOMATIC MEANS "YOU DO NOT HAVE TO REPEAT SIMPROK'S WORK". It has never
     * meant "SIMPROK overrules your correction". Certainty is not authority.
     */
    describe('PRE-BINDING HUMAN EXCLUSION — certainty is not authority', () => {
      ownsScenarioWorkspaceAlone();

      let batchId = '';
      /** The one proven row the human took back, and what it is called. */
      let excludedRowId = '';
      let excludedRowName = '';
      let acceptedRowIds: string[] = [];

      const readBatch = async (): Promise<BatchView> => {
        const response = await request(server())
          .get('/basic-price-imports/' + batchId)
          .set('Authorization', 'Bearer ' + token)
          .set('x-workspace-id', SCENARIO_WORKSPACE_ID);
        expect(response.status).toBe(200);
        return response.body as BatchView;
      };

      it('X-1. A FRESH BATCH — nothing bound, nothing ready, the rows proven', async () => {
        // Uploaded by someone who already knew this was a field report.
        const created = await previewDeclaring(
          { sourceOrigin: 'FIELD_REPORT' },
          SCENARIO_WORKSPACE_ID,
        );
        expect(created.status).toBe(201);
        batchId = (created.body as BatchSummary).batchId;
        expect(batchId).not.toBe(closeoutBatchId);

        const fresh = await readBatch();
        const patched = await request(server())
          .patch('/basic-price-imports/' + batchId)
          .set('Authorization', 'Bearer ' + token)
          .set('x-workspace-id', SCENARIO_WORKSPACE_ID)
          .send({
            version: fresh.version,
            regionId: REGION_ID,
            effectiveDate: '2024-01-01',
            sourcePeriodLabel: '2024',
            sourcePeriodGranularity: 'YEAR',
            effectiveDateProvenance: 'DERIVED_FROM_SOURCE_PERIOD',
            effectiveDateDerivationRule: 'PERIOD_START',
            sourceOrigin: 'FIELD_REPORT',
            sourceType: 'MARKET_SURVEY',
          });
        expect({
          status: patched.status,
          body: patched.body as unknown,
        }).toMatchObject({ status: 200 });

        const batch = await readBatch();
        // THE STARTING STATE, MEASURED RATHER THAN ASSUMED. Every number this
        // proof depends on is established here, before anything is pressed.
        expect(batch.readyForSubmissionRows).toBe(0);
        expect(
          await prisma.basicPriceImportRowResourceMapping.count({
            where: { row: { batchId } },
          }),
        ).toBe(0);

        const proven = batch.rows.filter(
          (r) => r.machineProposal?.identityPairProven === true,
        );
        expect(proven).toHaveLength(pairProvenAtMeasurement);

        /**
         * ONE DETERMINISTIC ROW, NAMED. `Air` is an exact-proven row of this
         * workbook, so choosing it makes the proof repeatable and legible in a
         * failure message. The fallback is the lowest-numbered proven row —
         * still deterministic — so a workbook edit that renames one line
         * degrades this into a weaker proof rather than into a false pass.
         */
        const chosen =
          proven.find((r) => r.name.trim().toLowerCase() === 'air') ??
          proven[0];
        expect(chosen).toBeDefined();
        excludedRowId = chosen.id;
        excludedRowName = chosen.name;
        expect(chosen.machineProposal?.identityPairProven).toBe(true);
        expect(chosen.machineProposal?.resource.admissibleForResolve).toBe(
          true,
        );
        expect(chosen.status).toBe('NEEDS_REVIEW');
        expect(chosen.resourceCatalogId).toBeNull();
      });

      /**
       * X-2 — THE PRESS ITSELF.
       *
       * This is exactly what the review room sends: `excludeRowIds` carries the
       * rows a person has touched on screen, and nothing else. It states SCOPE,
       * never an identity — the body still names no catalog id and no unit id,
       * so the server derives the eligible set at execution time as it always
       * did, and simply does not consider the row the human took back.
       */
      it('X-2. ONE smart-save leaves the human row alone and binds the rest', async () => {
        const response = await request(server())
          .post('/basic-price-imports/' + batchId + '/smart-save')
          .set('Authorization', 'Bearer ' + token)
          .set('x-workspace-id', SCENARIO_WORKSPACE_ID)
          .send({ excludeRowIds: [excludedRowId] });

        expect({
          status: response.status,
          body: response.body as unknown,
        }).toMatchObject({ status: 201 });
        const outcome = response.body as SmartSaveResult;
        acceptedRowIds = outcome.accepted.acceptedRowIds;

        // THE MACHINE STILL PROVED THIRTEEN. The human did not make SIMPROK
        // less certain; they removed one row from what SIMPROK may act on.
        expect(outcome.accepted.excludedCount).toBe(1);
        expect(outcome.accepted.eligibleCount).toBe(
          pairProvenAtMeasurement - 1,
        );
        expect(outcome.accepted.acceptedCount).toBe(
          pairProvenAtMeasurement - 1,
        );
        expect(outcome.accepted.skippedCount).toBe(0);
        expect(outcome.accepted.remainingEligible).toBe(0);
        expect(acceptedRowIds).not.toContain(excludedRowId);

        // The keeping half followed the binding half, on the same press.
        expect(outcome.kept.createdCount).toBe(pairProvenAtMeasurement - 1);
        expect(outcome.kept.alreadyPrivateCount).toBe(0);
      });

      /**
       * X-3 — WHAT HAPPENED TO THE EXCLUDED ROW, read from the database rather
       * than from the response that claimed it. Not bound, not priced, not
       * decided — and above all still OPEN, because the point of respecting an
       * exclusion is that the person can come back and finish their own work.
       */
      it('X-3. the excluded row is unbound, unpriced, and still a human decision', async () => {
        const row = await prisma.basicPriceImportRow.findUniqueOrThrow({
          where: { id: excludedRowId },
          select: {
            status: true,
            resourceCatalogId: true,
            unitDefinitionId: true,
          },
        });
        expect(row.status).toBe('NEEDS_REVIEW');
        expect(row.resourceCatalogId).toBeNull();
        expect(row.unitDefinitionId).toBeNull();

        // NO APPEND-ONLY DECISION WAS WRITTEN IN THE PERSON'S NAME. A mapping
        // here would be SIMPROK recording that a human decided something they
        // did not, which no later correction can erase.
        expect(
          await prisma.basicPriceImportRowResourceMapping.count({
            where: { rowId: excludedRowId },
          }),
        ).toBe(0);

        // AND NO PRICE. The row that was taken back produced nothing usable.
        expect(
          await prisma.basicPrice.count({
            where: { sourceImportRowId: excludedRowId },
          }),
        ).toBe(0);

        // The room still offers it as work, under the name the file gave it.
        const batch = await readBatch();
        const stillOpen = batch.rows.find((r) => r.id === excludedRowId);
        expect(stillOpen?.name).toBe(excludedRowName);
        expect(stillOpen?.status).toBe('NEEDS_REVIEW');
        expect(stillOpen?.machineProposal?.identityPairProven).toBe(true);
      });

      /**
       * X-4 — AND THE OTHER TWELVE WERE NOT PUNISHED FOR IT. Respecting one
       * exclusion must not turn the press into an all-or-nothing refusal: the
       * rows nobody objected to are bound, attributed and priced exactly as
       * they would have been.
       */
      it('X-4. the remaining rows bound normally, with truthful attribution', async () => {
        const mappings =
          await prisma.basicPriceImportRowResourceMapping.findMany({
            where: { rowId: { in: acceptedRowIds } },
            select: { reviewerAccountId: true, reason: true },
          });
        expect(mappings).toHaveLength(pairProvenAtMeasurement - 1);
        for (const mapping of mappings) {
          expect(mapping.reviewerAccountId).toBeTruthy();
          expect(mapping.reason).toBe('ACCEPTED_MACHINE_PROVEN_BATCH');
        }

        const prices = await prisma.basicPrice.findMany({
          where: { sourceImportRowId: { in: acceptedRowIds } },
          select: { assetScope: true },
        });
        expect(prices).toHaveLength(pairProvenAtMeasurement - 1);
        for (const price of prices) {
          expect(price.assetScope).toBe('WORKSPACE_PRIVATE');
        }

        const batch = await readBatch();
        expect(batch.readyForSubmissionRows).toBe(pairProvenAtMeasurement - 1);
      });

      /**
       * X-5 — THE EXCLUSION IS A SCOPE, NOT A VERDICT. When the person is done
       * and presses again without it, their row binds like any other. SIMPROK
       * never held it hostage, and never quietly decided it either.
       */
      it('X-5. pressing again WITHOUT the exclusion finishes the row the human kept', async () => {
        const response = await request(server())
          .post('/basic-price-imports/' + batchId + '/smart-save')
          .set('Authorization', 'Bearer ' + token)
          .set('x-workspace-id', SCENARIO_WORKSPACE_ID)
          .send({});
        expect({
          status: response.status,
          body: response.body as unknown,
        }).toMatchObject({ status: 201 });

        const outcome = response.body as SmartSaveResult;
        expect(outcome.accepted.excludedCount).toBe(0);
        expect(outcome.accepted.acceptedCount).toBe(1);
        expect(outcome.accepted.acceptedRowIds).toEqual([excludedRowId]);
        // One new price, and the twelve already kept are named as already kept
        // rather than reported as a second success.
        expect(outcome.kept.createdCount).toBe(1);
        expect(outcome.kept.alreadyPrivateCount).toBe(
          pairProvenAtMeasurement - 1,
        );

        expect(
          await prisma.basicPrice.count({
            where: { sourceImportRowId: excludedRowId },
          }),
        ).toBe(1);
      });
    });

    /**
     * ═══ SEAM 3 ═══ AN INTERRUPTED SMART-SAVE TELLS THE TRUTH, AND RESUMES.
     *
     * ONE COMMAND IS NOT ONE TRANSACTION, DELIBERATELY. `smart-save` binds
     * proven rows in bounded chunks that each commit on their own, then
     * materializes prices in a transaction of its own. That is the healthy
     * design — it is what makes a second press continue from committed truth
     * instead of redoing work — and it has one consequence nobody had faced:
     * a failure in the second half happens AFTER the first half is permanent.
     *
     * THE BROWSER USED TO DENY IT. Every smart-save failure was reported
     * through the private-use vocabulary, whose sentences end
     * `Tidak ada yang tersimpan.` Said about this command that is simply false,
     * and falsest exactly when it matters most: thirteen rows bound, and the
     * reviewer told their work does not exist. They would either re-review rows
     * SIMPROK had already decided, or abandon a batch one press from done.
     *
     * WHAT IS REPAIRED IS THE TRUTH CONTRACT, NOT THE ARCHITECTURE. No
     * transaction is widened, no chunk is resized, and the idempotence that
     * makes retrying safe is untouched. The command now counts the two facts it
     * can persist before it runs and counts them again if it fails, and reports
     * the difference — see `basic-price-smart-save-failure.law.ts`.
     *
     * THE INJECTION POINT IS THE ONLY PARTIAL STATE THAT CAN EXIST. Step 2 is a
     * single transaction, so a fault half way through it rolls its own prices
     * back; the maximal surviving partial state is therefore "bindings
     * committed, no price kept", which is exactly what failing at the start of
     * step 2 produces. Nothing about it is faked: the bindings below are real
     * chunk commits made by the real command on the real workbook.
     */
    describe('SMART-SAVE INTERRUPTION — the truth about what already happened', () => {
      ownsScenarioWorkspaceAlone();

      let batchId = '';
      /** The failure body the interrupted press actually answered with. */
      let failureBody: SmartSaveFailureBody | null = null;

      /**
       * READ AS THE TENANT THAT OWNS IT. This block's own batches live in the
       * scenario workspace; the Owner's clean closeout batch it compares itself
       * against in P-5 lives in the Owner's. A batch is only readable from
       * inside its own tenancy — that is the product's law, not a detail — so
       * the workspace travels with the id rather than being assumed.
       */
      const readBatchById = async (
        id: string,
        workspaceId: string = SCENARIO_WORKSPACE_ID,
      ): Promise<BatchView> => {
        const response = await request(server())
          .get('/basic-price-imports/' + id)
          .set('Authorization', 'Bearer ' + token)
          .set('x-workspace-id', workspaceId);
        expect(response.status).toBe(200);
        return response.body as BatchView;
      };

      const smartSave = (id: string) =>
        request(server())
          .post('/basic-price-imports/' + id + '/smart-save')
          .set('Authorization', 'Bearer ' + token)
          .set('x-workspace-id', SCENARIO_WORKSPACE_ID)
          .send({});

      /**
       * EVERYTHING A PERSON OR A LATER SUBSYSTEM CAN OBSERVE ABOUT A FINISHED
       * BATCH. Row NUMBERS rather than ids, so two batches of the same workbook
       * are genuinely comparable — the last assertion in this block is that a
       * batch which failed and recovered ends up indistinguishable from the
       * Owner's own uninterrupted run.
       */
      const endStateOf = async (
        id: string,
        workspaceId: string = SCENARIO_WORKSPACE_ID,
      ) => {
        const batch = await readBatchById(id, workspaceId);
        const rows = await prisma.basicPriceImportRow.findMany({
          where: { batchId: id },
          orderBy: { sourceRowNumber: 'asc' },
          select: { sourceRowNumber: true, resourceCatalogId: true },
        });
        const mappings =
          await prisma.basicPriceImportRowResourceMapping.findMany({
            where: { row: { batchId: id } },
            select: {
              reason: true,
              row: { select: { sourceRowNumber: true } },
            },
          });
        const prices = await prisma.basicPrice.findMany({
          where: { sourceImportRow: { batchId: id } },
          select: {
            assetScope: true,
            status: true,
            verificationStatus: true,
            freshnessStatus: true,
            reviewDate: true,
            validUntil: true,
            sourceImportRow: { select: { sourceRowNumber: true } },
          },
        });
        const ascending = (a: number, b: number) => a - b;
        return {
          batchStatus: batch.status,
          readyRows: batch.readyForSubmissionRows,
          needsReviewRows: batch.needsReviewRows,
          rejectedRows: batch.rejectedRows,
          boundRowNumbers: rows
            .filter((r) => r.resourceCatalogId !== null)
            .map((r) => r.sourceRowNumber)
            .sort(ascending),
          mappedRowNumbers: mappings
            .map((m) => m.row.sourceRowNumber)
            .sort(ascending),
          mappingReasons: [...new Set(mappings.map((m) => m.reason))].sort(),
          pricedRowNumbers: prices
            .map((p) => p.sourceImportRow?.sourceRowNumber ?? -1)
            .sort(ascending),
          priceShapes: [
            ...new Set(
              prices.map((p) =>
                [
                  p.assetScope,
                  p.status,
                  p.verificationStatus,
                  p.freshnessStatus,
                  p.reviewDate === null ? 'NO_REVIEW_DATE' : 'REVIEW_DATE',
                  p.validUntil === null ? 'NO_VALID_UNTIL' : 'VALID_UNTIL',
                ].join('|'),
              ),
            ),
          ].sort(),
        };
      };

      it('P-1. a FRESH batch — nothing bound, nothing kept, the rows proven', async () => {
        // Uploaded by someone who already knew this was a market survey.
        const created = await previewDeclaring(
          { sourceType: 'MARKET_SURVEY' },
          SCENARIO_WORKSPACE_ID,
        );
        expect(created.status).toBe(201);
        batchId = (created.body as BatchSummary).batchId;
        expect(batchId).not.toBe(closeoutBatchId);

        const fresh = await readBatchById(batchId);
        const patched = await request(server())
          .patch('/basic-price-imports/' + batchId)
          .set('Authorization', 'Bearer ' + token)
          .set('x-workspace-id', SCENARIO_WORKSPACE_ID)
          .send({
            version: fresh.version,
            regionId: REGION_ID,
            effectiveDate: '2024-01-01',
            sourcePeriodLabel: '2024',
            sourcePeriodGranularity: 'YEAR',
            effectiveDateProvenance: 'DERIVED_FROM_SOURCE_PERIOD',
            effectiveDateDerivationRule: 'PERIOD_START',
            sourceOrigin: 'FIELD_REPORT',
            sourceType: 'MARKET_SURVEY',
          });
        expect({
          status: patched.status,
          body: patched.body as unknown,
        }).toMatchObject({ status: 200 });

        const batch = await readBatchById(batchId);
        expect(batch.readyForSubmissionRows).toBe(0);
        expect(
          batch.rows.filter(
            (r) => r.machineProposal?.identityPairProven === true,
          ),
        ).toHaveLength(pairProvenAtMeasurement);
        expect(
          await prisma.basicPriceImportRowResourceMapping.count({
            where: { row: { batchId } },
          }),
        ).toBe(0);
        expect(
          await prisma.basicPrice.count({
            where: { sourceImportRow: { batchId } },
          }),
        ).toBe(0);
      });

      /**
       * P-2 — THE INTERRUPTION, AND WHAT SURVIVED IT.
       *
       * The fault is injected into the KEEPING half only. Everything before it
       * is the real command doing real work: the identity authority is asked,
       * the eligible set is derived server-side, and the chunks commit. What
       * the reviewer meets is a failure that arrives after their decisions are
       * already durable — the exact situation the old message denied.
       */
      it('P-2. an interrupted press reports the progress that really persisted', async () => {
        const privateAssets = app.get(BasicPricePrivateAssetService);
        const injected = jest
          .spyOn(privateAssets, 'keepBatchPrivate')
          .mockRejectedValueOnce(
            new Error('INJECTED_KEEP_FAILURE_FOR_ACCEPTANCE'),
          );

        let response: request.Response;
        try {
          response = await smartSave(batchId);
        } finally {
          injected.mockRestore();
        }

        // A FAILURE IS STILL A FAILURE. Nothing here dresses an interruption up
        // as a success — the press did not finish, and the status says so.
        expect(response.status).toBeGreaterThanOrEqual(400);
        failureBody = response.body as SmartSaveFailureBody;

        // THE SHAPE THE BROWSER PARSES, pinned end to end. `message` is where
        // every other Basic Price refusal puts its name, and `smartSave` is the
        // envelope `smartSaveFailureMessage` reads. The SENTENCES built from it
        // are pinned as pure functions in `basicPriceSmartUx.test.ts`; what
        // this proves is that the server really sends what they are given.
        expect(failureBody.message).toBe('SMART_SAVE_INTERRUPTED');
        expect(failureBody.smartSave).toEqual({
          persistence: 'PARTIAL',
          boundRowsDelta: pairProvenAtMeasurement,
          keptPricesDelta: 0,
        });

        // A. THE PERSISTED TRUTH IS REAL, read from the database rather than
        // from the answer that reported it.
        expect(
          await prisma.basicPriceImportRowResourceMapping.count({
            where: { row: { batchId } },
          }),
        ).toBe(pairProvenAtMeasurement);
        expect(
          await prisma.basicPrice.count({
            where: { sourceImportRow: { batchId } },
          }),
        ).toBe(0);
      });

      /**
       * P-3 — B. THE ANSWER MAY NOT LICENSE `nothing was saved`.
       *
       * `NONE` is the only verdict that permits that sentence, and it is a
       * MEASUREMENT — two equal readings — never a default. Here the readings
       * differ, so any consumer that still printed an empty database would be
       * contradicting the body it was handed.
       */
      it('P-3. the failure never licenses a claim of an empty database', () => {
        expect(failureBody!.smartSave.persistence).not.toBe('NONE');
        expect(failureBody!.smartSave.persistence).toBe('PARTIAL');
        expect(failureBody!.smartSave.boundRowsDelta).toBeGreaterThan(0);
        // AND NO INTERNALS TRAVEL. A reviewer is never shown the machinery that
        // broke — the injected error's own text stays on the server.
        expect(JSON.stringify(failureBody)).not.toContain('INJECTED_KEEP');
        expect(JSON.stringify(failureBody)).not.toMatch(
          /prisma|transaction|chunk|stack/i,
        );
      });

      /**
       * P-4 — C. THE RETRY. The SAME command, unchanged, with no special
       * recovery route and nothing for the person to understand: rows already
       * bound are no longer NEEDS_REVIEW so the server derives an empty
       * eligible set, and the keeping half — which never ran — now completes.
       */
      it('P-4. retrying the same command resumes from persisted truth', async () => {
        const response = await smartSave(batchId);
        expect({
          status: response.status,
          body: response.body as unknown,
        }).toMatchObject({ status: 201 });
        const outcome = response.body as SmartSaveResult;

        // NOTHING IS RE-BOUND, because nothing needs to be.
        expect(outcome.accepted.eligibleCount).toBe(0);
        expect(outcome.accepted.acceptedCount).toBe(0);
        // AND THE HALF THAT NEVER RAN, RUNS.
        expect(outcome.kept.createdCount).toBe(pairProvenAtMeasurement);
        expect(outcome.kept.alreadyPrivateCount).toBe(0);

        // NO DUPLICATE BINDING, NO DUPLICATE PRICE — counted, not assumed.
        expect(
          await prisma.basicPriceImportRowResourceMapping.count({
            where: { row: { batchId } },
          }),
        ).toBe(pairProvenAtMeasurement);
        expect(
          await prisma.basicPrice.count({
            where: { sourceImportRow: { batchId } },
          }),
        ).toBe(pairProvenAtMeasurement);
        // One price per bound row, never two for one.
        const perRow = await prisma.basicPrice.groupBy({
          by: ['sourceImportRowId'],
          where: { sourceImportRow: { batchId } },
          _count: { _all: true },
        });
        expect(perRow).toHaveLength(pairProvenAtMeasurement);
        for (const group of perRow) {
          expect(group._count._all).toBe(1);
        }
      });

      /**
       * P-5 — D. AND AFTERWARDS THE SCAR IS GONE.
       *
       * Compared field for field against the OWNER'S OWN BATCH — the one N-5
       * saved in a single uninterrupted press of the same command on the same
       * workbook under the same facts. That is a real clean run rather than a
       * control built to be compared with, and if interruption left ANY trace —
       * a row bound twice, a price missing, a different audit reason, a batch
       * left in a different status — the two end states differ and this fails.
       */
      it('P-5. the recovered batch is indistinguishable from one that never failed', async () => {
        const recovered = await endStateOf(batchId);
        const clean = await endStateOf(closeoutBatchId, WORKSPACE_A);
        // Both really did the work; comparing two empty shapes would prove
        // nothing at all.
        expect(recovered.readyRows).toBe(pairProvenAtMeasurement);
        expect(recovered).toEqual(clean);
      });
    });
  },
);
