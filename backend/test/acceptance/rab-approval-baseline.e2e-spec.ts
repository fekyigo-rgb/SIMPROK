import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AuthorityGovernanceModule } from '../../src/authority-governance/authority-governance.module';
import { AuthorityGovernanceService } from '../../src/authority-governance/authority-governance.service';

/**
 * PAB-03 — LOCKED → APPROVED → ACTIVE ProjectBaseline, proven against a REAL
 * PostgreSQL database.
 *
 * The unit spec proves the decision logic over mocked clients. It cannot prove
 * the four things only a real database and a real HTTP stack can settle:
 *
 *   1. that the governance an organization configures THROUGH THE PRODUCT —
 *      Position, PositionAssignment, Authority, PositionAuthority, all created
 *      over real authority routes — is the same governance the approval
 *      command reads;
 *   2. that approval and baseline really are one transaction, so a refusal
 *      leaves no baseline and no APPROVED row behind;
 *   3. that the EXISTING Progress engine then consumes the resulting ACTIVE
 *      baseline with no change of its own;
 *   4. that the platform carries no hard-coded approver — the identical
 *      mechanism serves Positions named PPK, DIREKTUR, OWNER and KETUA.
 *
 * Nothing about the ceremony is simulated: the lock runs through POST
 * /rab/lock, the approval through POST /rab/approve, and the governance
 * through POST /authority/*. Runs against simprok_e2e only; every fixture row
 * is deleted in afterAll.
 */
describe('PAB-03 RAB approval → ACTIVE baseline (e2e)', () => {
  const prisma = new PrismaClient();
  const tag = `PAB03${Date.now()}`;
  const password = 'RabApprovalBridge!';
  const labels = 'TEST_FIXTURE_ONLY OWNER_SUPPLIED_EXAMPLE_NON_PRODUCTION';
  const asOf = '2026-07-31';
  const asOfDate = new Date('2026-07-31T00:00:00.000Z');

  let app: INestApplication;
  /**
   * THE ONE GOVERNED WRITER of position_authorities. Constructed exactly as
   * Nest would, which is the stated purpose of AuthorityGovernanceModule —
   * the grants below are therefore the real ceremony, not a fixture shortcut
   * around it.
   */
  let authorityGovernance: AuthorityGovernanceService;
  let orgId: string;
  let workspaceId: string;
  let regionId: string;

  let adminToken: string;
  let editorToken: string;
  let verifierToken: string;
  let publisherToken: string;
  /** Holds RAB_APPROVE permission AND the configured Position. The lawful approver. */
  let approverToken: string;
  /** Holds the RAB_APPROVE permission but NO Position authority. */
  let permissionOnlyToken: string;
  /** Holds the Position authority but NOT the RAB_APPROVE permission. */
  let authorityOnlyToken: string;

  const createdPermissionIds: string[] = [];
  const accountIds: string[] = [];
  const membershipIds: string[] = [];
  const projectIds: string[] = [];
  const membershipBySuffix = new Map<string, string>();
  const userIdBySuffix = new Map<string, string>();
  const createdPositionIds: string[] = [];
  const createdAuthorityCodes = new Set<string>();

  /** Second tenant, for the cross-workspace proof. */
  let otherOrgId: string;
  let otherWorkspaceId: string;
  let otherApproverToken: string;
  /** The hand that executes the governance ceremonies below. */
  let ownerAccountId: string;

  const login = async (email: string) => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    return response.body.access_token as string;
  };

  const ensurePermission = async (code: string) => {
    const permission =
      (await prisma.permission.findUnique({ where: { code } })) ??
      (await prisma.permission.create({
        data: { code, name: `${tag} ${code}`, description: labels },
      }));
    if (permission.name.startsWith(tag)) createdPermissionIds.push(permission.id);
    return permission;
  };

  const createActor = async (
    suffix: string,
    permissionCodes: string[],
    targetWorkspaceId?: string,
  ) => {
    const wsId = targetWorkspaceId ?? workspaceId;
    const permissions = await Promise.all(permissionCodes.map(ensurePermission));
    const email = `${tag}.${suffix}@simprok.test`.toLowerCase();
    const account = await prisma.account.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 10),
        displayName: suffix,
        status: 'ACTIVE',
      },
    });
    accountIds.push(account.id);
    const role = await prisma.role.create({
      data: {
        workspaceId: wsId,
        code: `${tag}_${suffix.toUpperCase()}`,
        name: `${tag} ${suffix}`,
        rolePermissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
      },
    });
    const membership = await prisma.workspaceMembership.create({
      data: {
        accountId: account.id,
        workspaceId: wsId,
        status: 'ACTIVE',
        membershipRoles: { create: [{ roleId: role.id }] },
      },
    });
    membershipIds.push(membership.id);
    const profile = await prisma.user.create({
      data: {
        workspaceMembershipId: membership.id,
        workspaceId: wsId,
        fullName: suffix,
        status: 'ACTIVE',
      },
    });
    membershipBySuffix.set(suffix, membership.id);
    userIdBySuffix.set(suffix, profile.id);
    return { account, email, membershipId: membership.id, userId: profile.id };
  };

  /**
   * Configure one organization's RAB approval governance through the EXISTING
   * mechanisms, each used for the half it actually owns:
   *
   *   Position + PositionAssignment -> AuthorityService over HTTP (these two
   *     were never dormant and remain the product's own seat administration)
   *   Authority (global vocabulary) -> seeded, exactly as seed-acceptance.ts
   *     seeds the FIELD_PROGRESS_* acts. Production never writes this table,
   *     and the census in bpcat01d asserts it stays that way.
   *   PositionAuthority          -> AuthorityGovernanceService.grant(), THE
   *     one governed writer, which appends immutable provenance and moves
   *     current state in a single transaction.
   *
   * Note what is NOT configured anywhere: the platform is never told that
   * `positionCode` means "the approver". It is told that this Position holds
   * the generic act RAB_APPROVE, and that this person currently holds that
   * Position. The name is the organization's business, not SIMPROK's.
   */
  const configureApprovalGovernance = async (params: {
    positionCode: string;
    positionName: string;
    holderSuffix: string;
    targetWorkspaceId?: string;
    token?: string;
  }) => {
    const wsId = params.targetWorkspaceId ?? workspaceId;
    const token = params.token ?? adminToken;

    const position = await request(app.getHttpServer())
      .post('/authority/positions')
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', wsId)
      .send({ code: params.positionCode, name: params.positionName })
      .expect(201);
    createdPositionIds.push(position.body.id);

    await request(app.getHttpServer())
      .post('/authority/assignments')
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', wsId)
      .send({
        positionId: position.body.id,
        userId: userIdBySuffix.get(params.holderSuffix),
      })
      .expect(201);

    // The GENERIC act — one global vocabulary row shared by every
    // organization. Seeded, never created by production code.
    const authority = await prisma.authority.upsert({
      where: { code: 'RAB_APPROVE' },
      update: {},
      create: {
        code: 'RAB_APPROVE',
        name: 'Approve RAB',
        description: 'Menyetujui RAB menjadi rencana resmi proyek.',
      },
    });
    createdAuthorityCodes.add('RAB_APPROVE');

    // THE GOVERNED GRANT. Owner authorization and idempotency key are
    // mandatory, and the decision is appended immutably beside the state it
    // moves — so "by whose authorization did this seat get this power" always
    // has an answer.
    await authorityGovernance.grant({
      positionId: position.body.id,
      authorityCode: 'RAB_APPROVE',
      executedByAccountId: ownerAccountId,
      ownerAuthorizationReference: `${tag}-OWNER-PAB03`,
      reason: 'PAB-03 acceptance fixture',
      idempotencyKey: `${tag}-grant-${params.positionCode}`,
    });

    return { positionId: position.body.id as string, authorityId: authority.id };
  };

  /** A published, traceable Basic Price — minted the way the product mints one. */
  const createPrice = async (params: {
    resourceCatalogId: string;
    value: string;
    effectiveDate: Date;
  }) => {
    const submission = await prisma.priceSubmission.create({
      data: {
        workspaceId,
        organizationId: orgId,
        resourceId: params.resourceCatalogId,
        regionId,
        sourceOrigin: 'SUPPLIER',
        sourceType: 'MARKET_SURVEY',
        status: 'UNDER_REVIEW',
      },
    });
    const revision = await prisma.priceSubmissionRevision.create({
      data: {
        submissionId: submission.id,
        revisionNumber: 1,
        value: params.value,
        effectiveDate: params.effectiveDate,
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
        workspaceId,
        organizationId: orgId,
        slaState: 'OPEN',
        openedAt: new Date(),
      },
    });
    const accepted = await request(app.getHttpServer())
      .post(`/basic-price-reviews/${review.id}/accept`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .set('x-workspace-id', workspaceId)
      .send({})
      .expect(201);
    const basicPriceId = accepted.body.basicPriceId as string;
    await request(app.getHttpServer())
      .post(`/basic-price-publications/${basicPriceId}/publish`)
      .set('Authorization', `Bearer ${publisherToken}`)
      .set('x-workspace-id', workspaceId)
      .expect(201);
    return prisma.basicPrice.findUniqueOrThrow({ where: { id: basicPriceId } });
  };

  /** One project holding one REALLY priced WORK_ITEM, ready to be locked. */
  const buildLockableProject = async (suffix: string) => {
    const project = await prisma.project.create({
      data: {
        workspaceId,
        organizationId: orgId,
        code: `${tag}-${suffix}`,
        name: `${tag} ${suffix}`,
        status: 'PLANNED',
      },
    });
    projectIds.push(project.id);
    for (const membershipId of membershipBySuffix.values()) {
      // Skip memberships that belong to the other tenant.
      const membership = await prisma.workspaceMembership.findUniqueOrThrow({
        where: { id: membershipId },
        select: { workspaceId: true },
      });
      if (membership.workspaceId !== workspaceId) continue;
      await prisma.projectAssignment.create({
        data: {
          workspaceMembershipId: membershipId,
          projectId: project.id,
          roleInProject: 'MEMBER',
          isPrimaryAssignment: true,
          status: 'ASSIGNED',
        },
      });
    }

    const catalog = await prisma.resourceCatalog.create({
      data: { workspaceId, name: `${tag} ${suffix} Besi`, type: 'MATERIAL', baseUnit: 'Kg' },
    });
    const price = await createPrice({
      resourceCatalogId: catalog.id,
      value: '100000.00',
      effectiveDate: new Date('2026-01-01T00:00:00.000Z'),
    });
    const ahsp = await prisma.aHSP.create({
      data: {
        workspaceId,
        workType: `${tag} ${suffix}`,
        methodType: 'MANUAL',
        locationType: 'GENERAL',
        methodName: `${tag} ${suffix} method`,
      },
    });
    const version = await prisma.aHSPVersion.create({
      data: {
        ahspId: ahsp.id,
        workspaceId,
        versionNumber: 1,
        outputUnit: 'Kg',
        effectiveDate: new Date('2026-01-01T00:00:00.000Z'),
        regulationReference: `${tag} ${labels}`,
      },
    });
    const resource = await prisma.aHSPResource.create({
      data: {
        ahspVersionId: version.id,
        resourceId: catalog.name,
        resourceType: 'MATERIAL',
        coefficient: '2.000000',
        baseUnit: 'Kg',
      },
    });
    const occurrence = await prisma.projectAhspOccurrence.create({
      data: {
        workspaceId,
        projectId: project.id,
        ahspVersionId: version.id,
        idempotencyKey: `${tag}-${suffix}-occ`,
        businessPricingAsOfDate: asOfDate,
        referenceRegionId: regionId,
        resolutionPolicyVersion: 'E1A_CONTEXTUAL_EXACT_REGION_V1',
        resourceResolutions: {
          create: [
            {
              ahspResourceId: resource.id,
              rawAhspResourceRef: resource.resourceId,
              rawAhspResourceType: 'MATERIAL',
              ahspCoefficient: '2.000000',
              ahspUnit: 'Kg',
              status: 'RESOLVED',
              selectionMode: 'AUTO_SELECTED',
              resourceCatalogId: catalog.id,
              selectedBasicPriceId: price.id,
              canonicalUnit: 'Kg',
              sourcePriceValue: price.value.toString(),
              sourceUnit: 'Kg',
              adaptedPriceValue: price.value.toString(),
              selectedSourceOrigin: 'SUPPLIER',
              selectedFreshnessStatus: 'CURRENT',
              selectedEffectiveDate: new Date('2026-01-01T00:00:00.000Z'),
              resolutionMethod: 'EXACT_DETERMINISTIC',
              reasonCodes: ['TEST_FIXTURE_ONLY'],
              explanation: labels,
              policyVersion: labels,
            },
          ],
        },
      },
    });
    const structure = await prisma.boqStructure.create({
      data: { projectId: project.id, name: 'Working Draft', version: 1, status: 'DRAFT' },
    });
    const item = await prisma.boqItem.create({
      data: {
        boqStructureId: structure.id,
        wbsCode: '1.1',
        name: `${tag} ${suffix} item`,
        itemType: 'WORK_ITEM',
        quantity: '5',
        unit: 'Kg',
        ahspVersionId: version.id,
        workingOccurrenceId: occurrence.id,
      },
    });
    // THE REAL Gate-2A persist command — the money is never written by hand.
    await request(app.getHttpServer())
      .post(`/projects/${project.id}/boq/items/${item.id}/cost-calculation/persist`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ calculationAsOfDate: asOf })
      .expect(201);

    return { projectId: project.id, structureId: structure.id, itemId: item.id };
  };

  const lock = (projectId: string) =>
    request(app.getHttpServer())
      .post(`/projects/${projectId}/rab/lock`)
      .set('Authorization', `Bearer ${editorToken}`);

  const approve = (projectId: string, token: string, body: any = {}) =>
    request(app.getHttpServer())
      .post(`/projects/${projectId}/rab/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const readGate = (projectId: string, token: string) =>
    request(app.getHttpServer())
      .get(`/projects/${projectId}/rab/approval`)
      .set('Authorization', `Bearer ${token}`);

  /** Build a project and take it all the way to a real LOCKED RAB. */
  const buildLockedProject = async (suffix: string) => {
    const fixture = await buildLockableProject(suffix);
    const locked = await lock(fixture.projectId).expect(201);
    expect(locked.body).toMatchObject({ status: 'LOCKED', changed: true });
    return fixture;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      // AuthorityGovernanceModule is deliberately absent from AppModule —
      // granting authority is a governed ceremony, not a route. It is added
      // here for the same reason its own docblock gives: so a test can
      // construct the one writer exactly as Nest would.
      imports: [AppModule, AuthorityGovernanceModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    authorityGovernance = moduleRef.get(AuthorityGovernanceService);

    const org = await prisma.organization.create({
      data: { name: `${tag} Org`, type: 'COMPANY' },
    });
    orgId = org.id;
    const workspace = await prisma.workspace.create({
      data: { name: `${tag} WS`, organizationId: org.id },
    });
    workspaceId = workspace.id;
    const region = await prisma.region.create({
      data: { code: `${tag}-REG`, name: `${tag} Region`, isActive: true },
    });
    regionId = region.id;

    const ownerActor = await createActor('owner', ['PROJECT_VIEW']);
    ownerAccountId = ownerActor.account.id;
    await createActor('admin', [
      'AUTHORITY_MANAGE',
      'AUTHORITY_ASSIGN',
      'AUTHORITY_VIEW',
      'APPROVAL_MATRIX_MANAGE',
      'APPROVAL_MATRIX_VIEW',
      'PROJECT_VIEW',
    ]);
    await createActor('editor', [
      'RAB_DRAFT_EDIT',
      'PROJECT_VIEW',
      'RAB_VIEW',
      'AHSP_VIEW',
    ]);
    await createActor('verifier', ['BASIC_PRICE_VERIFY']);
    await createActor('publisher', ['BASIC_PRICE_PUBLISH']);
    await createActor('approver', ['RAB_APPROVE', 'PROJECT_VIEW', 'RAB_VIEW']);
    await createActor('permonly', ['RAB_APPROVE', 'PROJECT_VIEW', 'RAB_VIEW']);
    await createActor('authonly', ['PROJECT_VIEW', 'RAB_VIEW']);
    // Four holders for the genericity proof — one per organization shape.
    await createActor('ppk', ['RAB_APPROVE', 'PROJECT_VIEW', 'RAB_VIEW']);
    await createActor('direktur', ['RAB_APPROVE', 'PROJECT_VIEW', 'RAB_VIEW']);
    await createActor('pemilik', ['RAB_APPROVE', 'PROJECT_VIEW', 'RAB_VIEW']);
    await createActor('ketua', ['RAB_APPROVE', 'PROJECT_VIEW', 'RAB_VIEW']);

    adminToken = await login(`${tag}.admin@simprok.test`.toLowerCase());
    editorToken = await login(`${tag}.editor@simprok.test`.toLowerCase());
    verifierToken = await login(`${tag}.verifier@simprok.test`.toLowerCase());
    publisherToken = await login(`${tag}.publisher@simprok.test`.toLowerCase());
    approverToken = await login(`${tag}.approver@simprok.test`.toLowerCase());
    permissionOnlyToken = await login(`${tag}.permonly@simprok.test`.toLowerCase());
    authorityOnlyToken = await login(`${tag}.authonly@simprok.test`.toLowerCase());

    // THE ORGANIZATION'S OWN CONFIGURATION, made through the product.
    await configureApprovalGovernance({
      positionCode: 'PPK',
      positionName: 'Pejabat Pembuat Komitmen',
      holderSuffix: 'approver',
    });
    // A second Position holding the same generic act, whose holder lacks the
    // application permission — so authority-without-permission is provable.
    await configureApprovalGovernance({
      positionCode: 'KABID',
      positionName: 'Kepala Bidang',
      holderSuffix: 'authonly',
    });

    // A SECOND TENANT, fully configured in its own right, for the isolation
    // proof: a legitimate approver over there must still be nobody here.
    const otherOrg = await prisma.organization.create({
      data: { name: `${tag} Org B`, type: 'COMPANY' },
    });
    otherOrgId = otherOrg.id;
    const otherWorkspace = await prisma.workspace.create({
      data: { name: `${tag} WS B`, organizationId: otherOrg.id },
    });
    otherWorkspaceId = otherWorkspace.id;
    await createActor(
      'otheradmin',
      ['AUTHORITY_MANAGE', 'AUTHORITY_ASSIGN', 'AUTHORITY_VIEW'],
      otherWorkspaceId,
    );
    await createActor(
      'otherapprover',
      ['RAB_APPROVE', 'PROJECT_VIEW', 'RAB_VIEW'],
      otherWorkspaceId,
    );
    const otherAdminToken = await login(`${tag}.otheradmin@simprok.test`.toLowerCase());
    otherApproverToken = await login(`${tag}.otherapprover@simprok.test`.toLowerCase());
    await configureApprovalGovernance({
      positionCode: 'DIREKTUR',
      positionName: 'Direktur Utama',
      holderSuffix: 'otherapprover',
      targetWorkspaceId: otherWorkspaceId,
      token: otherAdminToken,
    });
  }, 180_000);

  afterAll(async () => {
    for (const projectId of projectIds) {
      const structures = await prisma.boqStructure.findMany({ where: { projectId } });
      const structureIds = structures.map((s) => s.id);
      await prisma.progressEntry.deleteMany({
        where: { progressReport: { projectId } },
      });
      await prisma.progressReport.deleteMany({ where: { projectId } });
      await prisma.projectBaseline.deleteMany({ where: { projectId } });
      await prisma.boqItem.updateMany({
        where: { boqStructureId: { in: structureIds } },
        data: { parentId: null },
      });
      await prisma.boqItem.deleteMany({ where: { boqStructureId: { in: structureIds } } });
      await prisma.rabDocument.deleteMany({ where: { projectId } });
      await prisma.projectAhspResourceResolution.deleteMany({
        where: { occurrence: { projectId } },
      });
      await prisma.projectAhspOccurrence.deleteMany({ where: { projectId } });
      await prisma.boqStructure.deleteMany({ where: { projectId } });
    }
    await prisma.aHSPResource.deleteMany({ where: { ahspVersion: { workspaceId } } });
    await prisma.aHSPVersion.deleteMany({ where: { workspaceId } });
    await prisma.aHSPAuditLog.deleteMany({ where: { ahsp: { workspaceId } } });
    await prisma.aHSP.deleteMany({ where: { workspaceId } });
    await prisma.projectAssignment.deleteMany({
      where: { workspaceMembershipId: { in: membershipIds } },
    });
    await prisma.project.deleteMany({ where: { workspaceId } });

    await prisma.basicPricePublicationAudit.deleteMany({
      where: { basicPrice: { workspaceId } },
    });
    await prisma.basicPrice.deleteMany({ where: { workspaceId } });
    await prisma.priceSubmissionAudit.deleteMany({ where: { submission: { workspaceId } } });
    await prisma.priceSubmissionReviewDecision.deleteMany({
      where: { review: { workspaceId } },
    });
    await prisma.priceSubmissionReview.deleteMany({ where: { workspaceId } });
    await prisma.priceSubmission.updateMany({
      where: { workspaceId },
      data: { currentRevisionId: null },
    });
    await prisma.priceSubmissionRevision.deleteMany({
      where: { submission: { workspaceId } },
    });
    await prisma.priceSubmission.deleteMany({ where: { workspaceId } });
    await prisma.resourceCatalog.deleteMany({ where: { workspaceId } });

    // Governance fixtures. PositionAuthority and PositionAssignment cascade
    // from Position; the Authority vocabulary row is global and is removed
    // only if this run is the one that created it.
    await prisma.authorityGovernanceDecision.deleteMany({
      where: { positionId: { in: createdPositionIds } },
    });
    await prisma.positionAuthority.deleteMany({
      where: { positionId: { in: createdPositionIds } },
    });
    await prisma.positionAssignment.deleteMany({
      where: { positionId: { in: createdPositionIds } },
    });
    await prisma.approvalMatrix.deleteMany({
      where: { requiredPositionId: { in: createdPositionIds } },
    });
    await prisma.position.deleteMany({ where: { id: { in: createdPositionIds } } });
    for (const code of createdAuthorityCodes) {
      const stillReferenced = await prisma.positionAuthority.count({
        where: { authority: { code } },
      });
      if (stillReferenced === 0) {
        await prisma.approvalMatrix.deleteMany({ where: { authority: { code } } });
        await prisma.authority.deleteMany({ where: { code } });
      }
    }

    await prisma.membershipRole.deleteMany({
      where: { workspaceMembershipId: { in: membershipIds } },
    });
    await prisma.user.deleteMany({ where: { workspaceMembershipId: { in: membershipIds } } });
    await prisma.workspaceMembership.deleteMany({ where: { id: { in: membershipIds } } });
    await prisma.rolePermission.deleteMany({
      where: { role: { workspaceId: { in: [workspaceId, otherWorkspaceId] } } },
    });
    await prisma.role.deleteMany({
      where: { workspaceId: { in: [workspaceId, otherWorkspaceId] } },
    });
    await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.permission.deleteMany({ where: { id: { in: createdPermissionIds } } });
    await prisma.region.deleteMany({ where: { id: regionId } });
    await prisma.workspace.deleteMany({
      where: { id: { in: [workspaceId, otherWorkspaceId] } },
    });
    await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
    await app.close();
    await prisma.$disconnect();
  }, 180_000);

  // ── A + I + J: the whole bridge, end to end ──────────────────────────────
  it('A/I/J: a LOCKED RAB approved by the configured holder becomes APPROVED with one ACTIVE baseline that Progress consumes', async () => {
    const f = await buildLockedProject('happy');

    // The door, before the act: SIMPROK already knows who may approve.
    const gateBefore = await readGate(f.projectId, approverToken).expect(200);
    expect(gateBefore.body).toMatchObject({
      canApprove: true,
      blocker: null,
      rabStatus: 'LOCKED',
      activeBaselineCount: 0,
    });
    expect(gateBefore.body.authorizedPositions.map((p: any) => p.code).sort()).toEqual(
      ['KABID', 'PPK'],
    );

    // THE ONE HUMAN DECISION.
    const approved = await approve(f.projectId, approverToken, {
      justification: 'Disetujui oleh pemegang kewenangan.',
    }).expect(201);

    expect(approved.body).toMatchObject({
      status: 'APPROVED',
      changed: true,
      projectId: f.projectId,
      approvedByPositionCode: 'PPK',
      authorityCode: 'RAB_APPROVE',
    });

    // The RAB really moved, in the database.
    const rab = await prisma.rabDocument.findFirstOrThrow({
      where: { projectId: f.projectId },
    });
    expect(rab.status).toBe('APPROVED');
    // The lock fact SURVIVES approval — who froze it stays true afterwards.
    expect(rab.lockedAt).not.toBeNull();
    expect(rab.lockedByAccountId).not.toBeNull();
    expect(rab.lockedFromStatus).toBe('DRAFT');

    // I — LINEAGE. Exactly one ACTIVE baseline, naming the approved RAB and
    // the Position that approved it.
    const baselines = await prisma.projectBaseline.findMany({
      where: { projectId: f.projectId },
    });
    expect(baselines).toHaveLength(1);
    expect(baselines[0]).toMatchObject({
      rabDocumentId: rab.id,
      status: 'ACTIVE',
      versionNumber: 1,
      justification: 'Disetujui oleh pemegang kewenangan.',
    });
    expect(baselines[0].approvedByPositionId).toBeTruthy();
    const approverPosition = await prisma.position.findUniqueOrThrow({
      where: { id: baselines[0].approvedByPositionId as string },
    });
    expect(approverPosition.code).toBe('PPK');
    expect(approverPosition.workspaceId).toBe(workspaceId);

    // Idempotent: re-running the completed act writes nothing.
    const again = await approve(f.projectId, approverToken).expect(201);
    expect(again.body).toMatchObject({ status: 'APPROVED', changed: false });
    expect(again.body.baseline.id).toBe(baselines[0].id);
    expect(
      await prisma.projectBaseline.count({ where: { projectId: f.projectId } }),
    ).toBe(1);

    // J — the EXISTING Progress engine consumes the ACTIVE baseline, with no
    // change of its own. Before approval it had no baseline to read.
    const monitoring = await request(app.getHttpServer())
      .get(`/projects/${f.projectId}/progress/monitoring`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);
    expect(monitoring.body.baseline).toMatchObject({
      id: baselines[0].id,
      versionNumber: 1,
    });
    // And it reads the PLAN through the baseline's own RAB — the priced work
    // item, not an empty shell.
    expect(monitoring.body.items.length).toBeGreaterThan(0);

    // K/L — the existing lifecycle projection now reports the stronger fact,
    // and the existing lock command refuses to walk approval backwards.
    const relock = await lock(f.projectId).expect(201);
    expect(relock.body).toMatchObject({
      status: 'REFUSED',
      reason: 'RAB_ALREADY_APPROVED',
    });

    // The door closes behind the decision.
    const gateAfter = await readGate(f.projectId, approverToken).expect(200);
    expect(gateAfter.body).toMatchObject({
      canApprove: false,
      blocker: 'ACTIVE_BASELINE_EXISTS',
      rabStatus: 'APPROVED',
      activeBaselineCount: 1,
    });
  }, 180_000);

  // ── B: DRAFT is not approvable ───────────────────────────────────────────
  it('B: a DRAFT RAB is refused and stays DRAFT, with no baseline created', async () => {
    const f = await buildLockableProject('draft');

    const result = await approve(f.projectId, approverToken).expect(201);
    expect(result.body).toMatchObject({
      status: 'REFUSED',
      reason: 'RAB_NOT_LOCKED',
      rabStatus: 'DRAFT',
    });

    const rab = await prisma.rabDocument.findFirstOrThrow({
      where: { projectId: f.projectId },
    });
    expect(rab.status).toBe('DRAFT');
    expect(
      await prisma.projectBaseline.count({ where: { projectId: f.projectId } }),
    ).toBe(0);

    const gate = await readGate(f.projectId, approverToken).expect(200);
    expect(gate.body).toMatchObject({ canApprove: false, blocker: 'RAB_NOT_LOCKED' });
  }, 180_000);

  // ── C + D + E: neither gate alone can approve ────────────────────────────
  it('C/D/E: permission without authority, authority without permission, and a revoked grant all fail closed', async () => {
    const f = await buildLockedProject('gates');

    // D — holds RAB_APPROVE, holds NO Position. Fails on organizational
    // legitimacy, which permission can never substitute for.
    const noAuthority = await approve(f.projectId, permissionOnlyToken).expect(403);
    expect(noAuthority.body.message).toBe('DECISION_AUTHORITY_REQUIRED');

    // E — holds the configured Position (KABID), holds NO RAB_APPROVE
    // permission. Fails at the application gate, which authority can never
    // substitute for either.
    await approve(f.projectId, authorityOnlyToken).expect(403);

    // The editor who authored and locked the RAB cannot approve it: locking
    // and approving are deliberately different authorities.
    await approve(f.projectId, editorToken).expect(403);

    // Nothing moved.
    expect(
      (await prisma.rabDocument.findFirstOrThrow({ where: { projectId: f.projectId } }))
        .status,
    ).toBe('LOCKED');
    expect(
      await prisma.projectBaseline.count({ where: { projectId: f.projectId } }),
    ).toBe(0);

    // The door tells the permission-only reader the truth, and names WHO may
    // act — it never asks them to choose an approver.
    const gate = await readGate(f.projectId, permissionOnlyToken).expect(200);
    expect(gate.body).toMatchObject({
      canApprove: false,
      blocker: 'ACTOR_IS_NOT_HOLDER',
      holderPositionId: null,
    });
    expect(gate.body.authorizedPositions.map((p: any) => p.code).sort()).toEqual([
      'KABID',
      'PPK',
    ]);

    // C — a REVOKED grant is refused even though the Position still exists.
    const ppk = await prisma.position.findFirstOrThrow({
      where: { workspaceId, code: 'PPK' },
    });
    await authorityGovernance.revoke({
      positionId: ppk.id,
      authorityCode: 'RAB_APPROVE',
      executedByAccountId: ownerAccountId,
      ownerAuthorizationReference: `${tag}-OWNER-REVOKE`,
      reason: 'PAB-03 negative path',
      idempotencyKey: `${tag}-revoke-PPK`,
    });
    const revoked = await approve(f.projectId, approverToken).expect(403);
    expect(revoked.body.message).toBe('DECISION_AUTHORITY_REVOKED');
    expect(
      (await prisma.rabDocument.findFirstOrThrow({ where: { projectId: f.projectId } }))
        .status,
    ).toBe('LOCKED');

    // Restore, and the SAME holder may act again — governance is a live
    // relationship, not a one-way door.
    await authorityGovernance.grant({
      positionId: ppk.id,
      authorityCode: 'RAB_APPROVE',
      executedByAccountId: ownerAccountId,
      ownerAuthorizationReference: `${tag}-OWNER-REGRANT`,
      reason: 'PAB-03 restore',
      idempotencyKey: `${tag}-regrant-PPK`,
    });
    const restored = await approve(f.projectId, approverToken).expect(201);
    expect(restored.body).toMatchObject({ status: 'APPROVED', changed: true });
  }, 180_000);

  // ── F: tenant and project scope ──────────────────────────────────────────
  it('F: a lawful approver in another workspace is nobody here, and an unassigned actor is refused', async () => {
    const f = await buildLockedProject('scope');

    // A fully configured approver — in the OTHER tenant. Real Position, real
    // grant, real permission, all in workspace B.
    await approve(f.projectId, otherApproverToken).expect(404);

    expect(
      (await prisma.rabDocument.findFirstOrThrow({ where: { projectId: f.projectId } }))
        .status,
    ).toBe('LOCKED');
    expect(
      await prisma.projectBaseline.count({ where: { projectId: f.projectId } }),
    ).toBe(0);

    // Same tenant, but the project assignment is withdrawn: authority is only
    // ever exercised on a project the holder is actually on.
    const approverMembership = membershipBySuffix.get('approver') as string;
    await prisma.projectAssignment.updateMany({
      where: { workspaceMembershipId: approverMembership, projectId: f.projectId },
      data: { status: 'REMOVED', revokedAt: new Date() },
    });
    // A revoked assignment is a FORBIDDEN, not a not-found: the reader is a
    // known member of this workspace, they are simply no longer on this project.
    await approve(f.projectId, approverToken).expect(403);
    expect(
      await prisma.projectBaseline.count({ where: { projectId: f.projectId } }),
    ).toBe(0);

    await prisma.projectAssignment.updateMany({
      where: { workspaceMembershipId: approverMembership, projectId: f.projectId },
      data: { status: 'ASSIGNED', revokedAt: null },
    });
  }, 180_000);

  // ── G + H: atomicity and one active baseline ─────────────────────────────
  it('G/H: a conflicting ACTIVE baseline fails closed and the RAB remains LOCKED', async () => {
    const f = await buildLockedProject('conflict');
    const rab = await prisma.rabDocument.findFirstOrThrow({
      where: { projectId: f.projectId },
    });

    // An ACTIVE baseline already governs this project.
    await prisma.projectBaseline.create({
      data: {
        projectId: f.projectId,
        rabDocumentId: rab.id,
        versionNumber: 1,
        status: 'ACTIVE',
        approvedAt: new Date(),
        justification: labels,
      },
    });

    const refused = await approve(f.projectId, approverToken).expect(201);
    expect(refused.body).toMatchObject({
      status: 'REFUSED',
      reason: 'ACTIVE_BASELINE_EXISTS',
    });

    // G — nothing half-happened: still LOCKED, still exactly one baseline.
    expect(
      (await prisma.rabDocument.findFirstOrThrow({ where: { projectId: f.projectId } }))
        .status,
    ).toBe('LOCKED');
    expect(
      await prisma.projectBaseline.count({ where: { projectId: f.projectId } }),
    ).toBe(1);
  }, 180_000);

  it('G: two concurrent approvals of the same LOCKED RAB produce exactly one baseline', async () => {
    const f = await buildLockedProject('race');

    const [a, b] = await Promise.all([
      approve(f.projectId, approverToken),
      approve(f.projectId, approverToken),
    ]);

    const outcomes = [a.body, b.body];
    const approvedCount = outcomes.filter((o) => o.status === 'APPROVED').length;
    expect(approvedCount).toBeGreaterThanOrEqual(1);

    // Whatever the interleaving, the database ends with ONE approved RAB and
    // ONE active baseline — never two, never an approval without a baseline.
    const rab = await prisma.rabDocument.findFirstOrThrow({
      where: { projectId: f.projectId },
    });
    expect(rab.status).toBe('APPROVED');
    const baselines = await prisma.projectBaseline.findMany({
      where: { projectId: f.projectId, status: 'ACTIVE' },
    });
    expect(baselines).toHaveLength(1);
    expect(baselines[0].rabDocumentId).toBe(rab.id);
  }, 180_000);

  // ── M: organization genericity ───────────────────────────────────────────
  it('M: PPK, DIREKTUR, OWNER and KETUA all approve through the identical mechanism', async () => {
    const cases = [
      { code: 'PPK-B', name: 'Pejabat Pembuat Komitmen B', holder: 'ppk', token: '' },
      { code: 'DIREKTUR-B', name: 'Direktur', holder: 'direktur', token: '' },
      { code: 'OWNER-B', name: 'Pemilik', holder: 'pemilik', token: '' },
      { code: 'KETUA-B', name: 'Ketua Panitia', holder: 'ketua', token: '' },
    ];

    for (const c of cases) {
      c.token = await login(`${tag}.${c.holder}@simprok.test`.toLowerCase());
      await configureApprovalGovernance({
        positionCode: c.code,
        positionName: c.name,
        holderSuffix: c.holder,
      });
    }

    for (const c of cases) {
      const f = await buildLockedProject(`gen-${c.holder}`);
      const approved = await approve(f.projectId, c.token).expect(201);

      expect(approved.body).toMatchObject({
        status: 'APPROVED',
        changed: true,
        approvedByPositionCode: c.code,
        authorityCode: 'RAB_APPROVE',
      });

      const baseline = await prisma.projectBaseline.findFirstOrThrow({
        where: { projectId: f.projectId, status: 'ACTIVE' },
      });
      const position = await prisma.position.findUniqueOrThrow({
        where: { id: baseline.approvedByPositionId as string },
      });
      // The organization's own name for the role is recorded; the platform
      // branched on none of them.
      expect(position.code).toBe(c.code);
    }

    // All of them hold the SAME single global act — one vocabulary entry,
    // many organizational Positions.
    const authority = await prisma.authority.findUniqueOrThrow({
      where: { code: 'RAB_APPROVE' },
    });
    const grants = await prisma.positionAuthority.findMany({
      where: { authorityId: authority.id, isActive: true, position: { workspaceId } },
      include: { position: true },
    });
    expect(grants.map((g) => g.position.code).sort()).toEqual(
      ['DIREKTUR-B', 'KABID', 'KETUA-B', 'OWNER-B', 'PPK', 'PPK-B'].sort(),
    );
  }, 300_000);
});
