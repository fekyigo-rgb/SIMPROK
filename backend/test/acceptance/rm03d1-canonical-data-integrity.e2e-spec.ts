import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

/**
 * RM-03D1 — AHSP VERSION RETIREMENT (e2e).
 *
 * Every claim here is cross-module or concurrent, and none can be proved by
 * unit mocks:
 *
 *  1. Retirement actually removes a version from the picker AND from binding.
 *     The ahsp module writes a status; the project-ahsp module's eligibility
 *     predicate must exclude it. Drift between those two would leave a
 *     withdrawn version bindable — the defect this slice closes.
 *  2. Concurrency: two requests racing for the same version must produce one
 *     transition and one audit row, and two CONFLICTING classifications must
 *     not last-write-win.
 *  3. Withdrawal is not a disguised delete.
 *
 * The fixture is fully self-owned — its own project, Working Draft structure and
 * WORK_ITEM — so the direct `select-ahsp` rejection is ALWAYS exercised. An
 * earlier version skipped that proof when the environment happened to have no
 * work item, which is exactly the ambiguity this suite must not have.
 */
const WORKSPACE_A = '10000000-0000-4000-8000-000000000004';
const PASSWORD = 'Test1234!';

const AHSP_ID = '44000000-0000-4000-8000-000000000001';
const VERSION_KEEP_ID = '44000000-0000-4000-8000-000000000002';
const VERSION_RETIRE_ID = '44000000-0000-4000-8000-000000000003';
const RESOURCE_ID = '44000000-0000-4000-8000-000000000004';
const ROLE_ID = '44000000-0000-4000-8000-000000000005';
const PROJECT_ID = '44000000-0000-4000-8000-000000000006';
const STRUCTURE_ID = '44000000-0000-4000-8000-000000000007';
const BOQ_ITEM_ID = '44000000-0000-4000-8000-000000000008';
const PUBLISHED_VERSION_ID = '44000000-0000-4000-8000-000000000009';

// AHSP_VIEW/AHSP_MANAGE are deliberately NOT active-membership baseline codes,
// so this suite grants them through a real role — the same pattern
// rm02d1-resource-identity-mapping uses. Testing against a real grant rather
// than a widened baseline is the point: retirement must require the same
// authority as creating a version.
const PERMISSION_CODES = ['AHSP_VIEW', 'AHSP_MANAGE', 'RAB_DRAFT_EDIT', 'PROJECT_VIEW'];

const AS_OF = '2026-08-08';

describe('RM03D1 Canonical Data Integrity — AHSP version retirement (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let token: string;
  let m3UnitId: string;
  let regionId: string;
  let membershipRoleId: string;
  let organizationId: string;

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    await app.init();
    prisma = new PrismaClient();
    m3UnitId = (await prisma.unitDefinition.findFirstOrThrow({ where: { code: 'M3' } })).id;
    regionId = (await prisma.region.findFirstOrThrow({ where: { isActive: true } })).id;
    organizationId = (
      await prisma.workspace.findUniqueOrThrow({ where: { id: WORKSPACE_A } })
    ).organizationId;

    const permissions = await Promise.all(
      PERMISSION_CODES.map((code) =>
        prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} }),
      ),
    );
    await prisma.role.upsert({
      where: { id: ROLE_ID },
      create: {
        id: ROLE_ID,
        workspaceId: WORKSPACE_A,
        code: 'ACCEPTANCE_RM03D1_INTEGRITY',
        name: 'Acceptance RM-03D1 Integrity',
      },
      update: {},
    });
    await prisma.rolePermission.createMany({
      data: permissions.map((permission) => ({ roleId: ROLE_ID, permissionId: permission.id })),
      skipDuplicates: true,
    });
    const account = await prisma.account.findUniqueOrThrow({ where: { email: 'assigned@test.local' } });
    const membership = await prisma.workspaceMembership.findUniqueOrThrow({
      where: { accountId_workspaceId: { accountId: account.id, workspaceId: WORKSPACE_A } },
    });
    membershipRoleId = (
      await prisma.membershipRole.create({
        data: { workspaceMembershipId: membership.id, roleId: ROLE_ID, isActive: true },
      })
    ).id;

    token = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'assigned@test.local', password: PASSWORD })
    ).body.access_token;
  });

  /** Deterministic project + Working Draft + WORK_ITEM. No environment luck. */
  const seedProjectFixture = async () => {
    await prisma.project.upsert({
      where: { id: PROJECT_ID },
      create: {
        id: PROJECT_ID,
        workspaceId: WORKSPACE_A,
        organizationId,
        code: 'RM03D1-INTEGRITY',
        name: 'RM03D1 Integrity Fixture',
        status: 'PLANNED',
      },
      update: {},
    });
    await prisma.boqStructure.upsert({
      where: { id: STRUCTURE_ID },
      create: {
        id: STRUCTURE_ID,
        projectId: PROJECT_ID,
        name: 'Working Draft',
        version: 1,
        status: 'DRAFT',
      },
      update: {},
    });
    await prisma.boqItem.upsert({
      where: { id: BOQ_ITEM_ID },
      create: {
        id: BOQ_ITEM_ID,
        boqStructureId: STRUCTURE_ID,
        wbsCode: 'RM03D1-1',
        name: 'RM03D1 integrity work item',
        itemType: 'WORK_ITEM',
        quantity: 1,
        unit: 'm3',
        sortOrder: 1,
      },
      update: {},
    });
  };

  const seedVersions = async () => {
    await prisma.resourceCatalog.upsert({
      where: { id: RESOURCE_ID },
      create: {
        id: RESOURCE_ID,
        workspaceId: WORKSPACE_A,
        name: 'RM03D1 Integrity Material',
        type: 'MATERIAL',
        baseUnit: 'M3',
      },
      update: {},
    });
    await prisma.aHSP.upsert({
      where: { id: AHSP_ID },
      create: {
        id: AHSP_ID,
        workspaceId: WORKSPACE_A,
        workType: 'RM03D1 Integrity Work',
        methodType: 'MANUAL',
        locationType: 'GENERAL',
        methodName: 'Integrity closure fixture',
        ownershipType: 'USER_ASSET',
      },
      update: {},
    });
    // Two complete, currently-eligible private versions of the same AHSP: one to
    // retire, one that must be untouched by that act. Plus a PUBLISHED version,
    // which this route must refuse outright.
    for (const [id, versionNumber, status] of [
      [VERSION_KEEP_ID, 1, 'DRAFT'],
      [VERSION_RETIRE_ID, 2, 'DRAFT'],
      [PUBLISHED_VERSION_ID, 3, 'PUBLISHED'],
    ] as const) {
      await prisma.aHSPVersion.upsert({
        where: { id },
        create: {
          id,
          ahspId: AHSP_ID,
          workspaceId: WORKSPACE_A,
          versionNumber,
          status,
          effectiveDate: new Date('2023-08-30T00:00:00.000Z'),
          outputUnit: 'm3',
          outputUnitDefinitionId: m3UnitId,
          resources: {
            create: [
              {
                resourceId: 'RM03D1 Integrity Material',
                resourceType: 'MATERIAL',
                coefficient: 1,
                baseUnit: 'm3',
              },
            ],
          },
        },
        update: { status },
      });
    }
  };

  beforeEach(async () => {
    await seedProjectFixture();
    await seedVersions();
  });

  afterEach(async () => {
    await prisma.aHSPAuditLog.deleteMany({ where: { ahspId: AHSP_ID } });
    await prisma.aHSPVersion.deleteMany({ where: { ahspId: AHSP_ID } });
  });

  afterAll(async () => {
    await prisma.aHSPAuditLog.deleteMany({ where: { ahspId: AHSP_ID } });
    await prisma.projectAhspOccurrence.deleteMany({ where: { projectId: PROJECT_ID } });
    await prisma.aHSPVersion.deleteMany({ where: { ahspId: AHSP_ID } });
    await prisma.aHSP.deleteMany({ where: { id: AHSP_ID } });
    await prisma.boqItem.deleteMany({ where: { boqStructureId: STRUCTURE_ID } });
    await prisma.boqStructure.deleteMany({ where: { id: STRUCTURE_ID } });
    await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
    await prisma.resourceCatalog.deleteMany({ where: { id: RESOURCE_ID } });
    await prisma.membershipRole.deleteMany({ where: { id: membershipRoleId } });
    await prisma.rolePermission.deleteMany({ where: { roleId: ROLE_ID } });
    await prisma.role.deleteMany({ where: { id: ROLE_ID } });
    await prisma.permission.deleteMany({ where: { code: { in: PERMISSION_CODES } } });
    await prisma.$disconnect();
    await app.close();
  });

  const hdr = () => ({ Authorization: `Bearer ${token}`, 'x-workspace-id': WORKSPACE_A });

  const retire = (versionId: string, status: string, reason: string) =>
    request(app.getHttpServer())
      .post(`/ahsp/versions/${versionId}/retire`)
      .set(hdr())
      .send({ status, reason });

  const eligibleVersionIds = async () => {
    const res = await request(app.getHttpServer())
      .get(
        `/projects/${PROJECT_ID}/ahsp-occurrences/eligible-versions?businessPricingAsOfDate=${AS_OF}`,
      )
      .set(hdr());
    // Assert the shape rather than coercing it: a 403 body silently becoming an
    // empty list would make every "not eligible" assertion pass for the wrong
    // reason.
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    return (res.body as Array<{ id: string }>).map((v) => v.id);
  };

  const bind = (versionId: string, key: string) =>
    request(app.getHttpServer())
      .post(`/projects/${PROJECT_ID}/ahsp-occurrences/boq-items/${BOQ_ITEM_ID}/select-ahsp`)
      .set(hdr())
      .send({
        ahspVersionId: versionId,
        businessPricingAsOfDate: AS_OF,
        referenceRegionId: regionId,
        idempotencyKey: key,
      });

  const auditCount = () =>
    prisma.aHSPAuditLog.count({ where: { ahspVersionId: VERSION_RETIRE_ID } });

  it('A: a retired version leaves the SAME eligible-version read the product selects from, and the sibling stays', async () => {
    const before = await eligibleVersionIds();
    expect(before).toContain(VERSION_RETIRE_ID);
    expect(before).toContain(VERSION_KEEP_ID);

    const response = await retire(
      VERSION_RETIRE_ID,
      'ARCHIVED',
      'incorrect AHSP raw-resource representation; UUIDs supplied instead of source references',
    ).expect(201);
    expect(response.body.changed).toBe(true);
    expect(response.body.version.status).toBe('ARCHIVED');

    const after = await eligibleVersionIds();
    expect(after).not.toContain(VERSION_RETIRE_ID);
    // Retirement is version-scoped: it must never take the parent's other
    // versions down with it, which is what archiving the AHSP would do.
    expect(after).toContain(VERSION_KEEP_ID);
  });

  it('B: binding a retired version through the normal path ALWAYS fails closed — no conditional skip', async () => {
    // The fixture guarantees a real WORK_ITEM, so this proof is unconditional.
    await bind(VERSION_KEEP_ID, `RM03D1-BIND-OK-${Date.now()}`).expect(201);

    await retire(VERSION_RETIRE_ID, 'SUPERSEDED', 'replaced by a corrected-evidence version').expect(201);

    const denied = await bind(VERSION_RETIRE_ID, `RM03D1-BIND-RETIRED-${Date.now()}`);
    expect(denied.status).toBe(404);

    // And the retirement did not make the whole AHSP unbindable.
    expect(await eligibleVersionIds()).toContain(VERSION_KEEP_ID);
  });

  it('C: retirement is a withdrawal, not a delete — version, resources and audit trail all survive', async () => {
    await retire(
      VERSION_RETIRE_ID,
      'ARCHIVED',
      'construction attempt missing required temporal completeness',
    ).expect(201);

    const version = await prisma.aHSPVersion.findUnique({
      where: { id: VERSION_RETIRE_ID },
      include: { resources: true },
    });
    expect(version).not.toBeNull();
    expect(version!.status).toBe('ARCHIVED');
    expect(version!.resources.length).toBeGreaterThan(0);

    const audit = await prisma.aHSPAuditLog.findFirst({
      where: { ahspVersionId: VERSION_RETIRE_ID },
      orderBy: { when: 'desc' },
    });
    expect(audit?.reason).toContain('temporal completeness');
    expect(audit?.before).not.toBeNull();
  });

  it('D: retiring twice is a no-op, and one decision leaves exactly one audit entry', async () => {
    await retire(VERSION_RETIRE_ID, 'ARCHIVED', 'first').expect(201);
    const second = await retire(VERSION_RETIRE_ID, 'ARCHIVED', 'second').expect(201);

    expect(second.body.changed).toBe(false);
    expect(await auditCount()).toBe(1);
  });

  it('E: CONCURRENT identical retirements — exactly one transition, exactly one audit row', async () => {
    const [a, b] = await Promise.all([
      retire(VERSION_RETIRE_ID, 'ARCHIVED', 'concurrent A'),
      retire(VERSION_RETIRE_ID, 'ARCHIVED', 'concurrent B'),
    ]);

    expect([a.status, b.status]).toEqual([201, 201]);
    // One request transitioned; the other found it already settled.
    expect([a.body.changed, b.body.changed].sort()).toEqual([false, true]);
    expect(await auditCount()).toBe(1);

    const version = await prisma.aHSPVersion.findUniqueOrThrow({ where: { id: VERSION_RETIRE_ID } });
    expect(version.status).toBe('ARCHIVED');
  });

  it('F: CONCURRENT CONFLICTING retirements — the first terminal decision wins, the loser fails closed', async () => {
    const [a, b] = await Promise.all([
      retire(VERSION_RETIRE_ID, 'ARCHIVED', 'concurrent ARCHIVED'),
      retire(VERSION_RETIRE_ID, 'SUPERSEDED', 'concurrent SUPERSEDED'),
    ]);

    // Exactly one succeeded; the other was refused rather than overwriting it.
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const winner = a.status === 201 ? a : b;
    const loser = a.status === 201 ? b : a;
    expect(winner.body.changed).toBe(true);
    expect(loser.body.message).toBe('AHSP_VERSION_ALREADY_RETIRED_DIFFERENTLY');

    // One decision, one audit row, and the state never oscillated.
    expect(await auditCount()).toBe(1);
    const version = await prisma.aHSPVersion.findUniqueOrThrow({ where: { id: VERSION_RETIRE_ID } });
    expect(version.status).toBe(winner.body.version.status);
    expect(['ARCHIVED', 'SUPERSEDED']).toContain(version.status);
  });

  it('G: a PUBLISHED version cannot be retired through this AHSP_MANAGE private route', async () => {
    const response = await retire(
      PUBLISHED_VERSION_ID,
      'ARCHIVED',
      'attempted catalog withdrawal',
    ).expect(409);
    expect(response.body.message).toBe('PUBLISHED_AHSP_VERSION_NOT_RETIRABLE_HERE');

    const version = await prisma.aHSPVersion.findUniqueOrThrow({ where: { id: PUBLISHED_VERSION_ID } });
    expect(version.status).toBe('PUBLISHED');
    expect(await prisma.aHSPAuditLog.count({ where: { ahspVersionId: PUBLISHED_VERSION_ID } })).toBe(0);
  });

  it('H: only SUPERSEDED and ARCHIVED are reachable — a retirement can never promote a version', async () => {
    for (const status of ['PUBLISHED', 'VERIFIED', 'DRAFT', 'UNDER_REVIEW']) {
      await retire(VERSION_RETIRE_ID, status, 'attempted promotion').expect(400);
    }
    const version = await prisma.aHSPVersion.findUniqueOrThrow({ where: { id: VERSION_RETIRE_ID } });
    expect(version.status).toBe('DRAFT');
  });

  it('I: a reason is required, and authentication is required', async () => {
    await request(app.getHttpServer())
      .post(`/ahsp/versions/${VERSION_RETIRE_ID}/retire`)
      .set(hdr())
      .send({ status: 'ARCHIVED' })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/ahsp/versions/${VERSION_RETIRE_ID}/retire`)
      .set(hdr())
      .send({ status: 'ARCHIVED', reason: '' })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/ahsp/versions/${VERSION_RETIRE_ID}/retire`)
      .set('x-workspace-id', WORKSPACE_A)
      .send({ status: 'ARCHIVED', reason: 'no token' })
      .expect(401);
  });
});
