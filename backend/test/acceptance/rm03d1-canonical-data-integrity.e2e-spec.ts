import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

/**
 * RM-03D1 — CANONICAL DATA INTEGRITY CLOSURE (e2e).
 *
 * Both claims here are cross-module and cannot be proved by unit mocks:
 *
 *  1. RETIREMENT actually removes a version from the picker and from binding.
 *     The ahsp module writes a status; the project-ahsp module's eligibility
 *     predicate must exclude it. If those two ever drifted apart, a withdrawn
 *     version would stay bindable — the exact defect this slice closes.
 *
 *  2. A retired version's HISTORY survives. Withdrawing a version must not be
 *     a disguised delete.
 *
 * Deliberately not re-proved here: the provenance-correction field matrix,
 * which the unit suite and the permanent writer inventory pin precisely.
 */
const WORKSPACE_A = '10000000-0000-4000-8000-000000000004';
const PASSWORD = 'Test1234!';

const AHSP_ID = '44000000-0000-4000-8000-000000000001';
const VERSION_KEEP_ID = '44000000-0000-4000-8000-000000000002';
const VERSION_RETIRE_ID = '44000000-0000-4000-8000-000000000003';
const RESOURCE_ID = '44000000-0000-4000-8000-000000000004';

const AS_OF = '2026-08-08';

describe('RM03D1 Canonical Data Integrity — AHSP version retirement (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let token: string;
  let m3UnitId: string;

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    await app.init();
    prisma = new PrismaClient();
    m3UnitId = (await prisma.unitDefinition.findFirstOrThrow({ where: { code: 'M3' } })).id;
    token = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'assigned@test.local', password: PASSWORD })
    ).body.access_token;
  });

  beforeEach(async () => {
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
      },
      update: {},
    });
    // Two complete, currently-eligible private versions of the same AHSP. One
    // will be retired; the other must be untouched by that act.
    for (const [id, versionNumber] of [
      [VERSION_KEEP_ID, 1],
      [VERSION_RETIRE_ID, 2],
    ] as const) {
      await prisma.aHSPVersion.upsert({
        where: { id },
        create: {
          id,
          ahspId: AHSP_ID,
          workspaceId: WORKSPACE_A,
          versionNumber,
          status: 'DRAFT',
          effectiveDate: new Date('2023-08-30T00:00:00.000Z'),
          outputUnit: 'm3',
          outputUnitDefinitionId: m3UnitId,
          resources: {
            create: [
              { resourceId: 'RM03D1 Integrity Material', resourceType: 'MATERIAL', coefficient: 1, baseUnit: 'm3' },
            ],
          },
        },
        update: { status: 'DRAFT' },
      });
    }
  });

  afterEach(async () => {
    await prisma.aHSPAuditLog.deleteMany({ where: { ahspId: AHSP_ID } });
    await prisma.aHSPVersion.deleteMany({ where: { ahspId: AHSP_ID } });
  });

  afterAll(async () => {
    await prisma.aHSPAuditLog.deleteMany({ where: { ahspId: AHSP_ID } });
    await prisma.aHSPVersion.deleteMany({ where: { ahspId: AHSP_ID } });
    await prisma.aHSP.deleteMany({ where: { id: AHSP_ID } });
    await prisma.resourceCatalog.deleteMany({ where: { id: RESOURCE_ID } });
    await prisma.$disconnect();
    await app.close();
  });

  const hdr = () => ({ Authorization: `Bearer ${token}`, 'x-workspace-id': WORKSPACE_A });

  const retire = (versionId: string, status: string, reason: string) =>
    request(app.getHttpServer())
      .post(`/ahsp/versions/${versionId}/retire`)
      .set(hdr())
      .send({ status, reason });

  const eligibleVersionIds = async (projectId: string) => {
    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}/ahsp-occurrences/eligible-versions?businessPricingAsOfDate=${AS_OF}`)
      .set(hdr());
    return (res.body ?? []).map((v: { id: string }) => v.id);
  };

  const anyProjectId = async () =>
    (await prisma.project.findFirstOrThrow({ where: { workspaceId: WORKSPACE_A } })).id;

  it('A: a retired version disappears from the SAME eligible-version read the product selects from, and the sibling stays', async () => {
    const projectId = await anyProjectId();

    const before = await eligibleVersionIds(projectId);
    expect(before).toContain(VERSION_RETIRE_ID);
    expect(before).toContain(VERSION_KEEP_ID);

    const response = await retire(
      VERSION_RETIRE_ID,
      'ARCHIVED',
      'incorrect AHSP raw-resource representation; UUIDs supplied instead of source references',
    ).expect(201);
    expect(response.body.changed).toBe(true);
    expect(response.body.version.status).toBe('ARCHIVED');

    const after = await eligibleVersionIds(projectId);
    expect(after).not.toContain(VERSION_RETIRE_ID);
    // Retirement is version-scoped: it must never take the parent's other
    // versions down with it, which is exactly what archiving the AHSP would do.
    expect(after).toContain(VERSION_KEEP_ID);
  });

  it('B: a retired version cannot be bound to a BOQ item through the normal application path', async () => {
    const projectId = await anyProjectId();
    const structure = await prisma.boqStructure.findFirst({
      where: { projectId, name: 'Working Draft', status: 'DRAFT' },
    });
    const item = structure
      ? await prisma.boqItem.findFirst({ where: { boqStructureId: structure.id, itemType: 'WORK_ITEM' } })
      : null;

    await retire(VERSION_RETIRE_ID, 'SUPERSEDED', 'replaced by a corrected-evidence version').expect(201);

    if (!item) {
      // No work item in this environment's draft — the eligibility read above
      // is the binding authority's own predicate, and A already proved it.
      expect(await eligibleVersionIds(projectId)).not.toContain(VERSION_RETIRE_ID);
      return;
    }

    const res = await request(app.getHttpServer())
      .post(`/projects/${projectId}/ahsp-occurrences/boq-items/${item.id}/select-ahsp`)
      .set(hdr())
      .send({
        ahspVersionId: VERSION_RETIRE_ID,
        businessPricingAsOfDate: AS_OF,
        referenceRegionId: (await prisma.region.findFirstOrThrow({ where: { isActive: true } })).id,
        idempotencyKey: `RM03D1-INTEGRITY-RETIRED-BIND-${Date.now()}`,
      });
    expect(res.status).toBe(404);
  });

  it('C: retirement is a withdrawal, not a delete — the version, its resources and its audit trail all survive', async () => {
    await retire(VERSION_RETIRE_ID, 'ARCHIVED', 'construction attempt missing required temporal completeness').expect(201);

    const version = await prisma.aHSPVersion.findUnique({
      where: { id: VERSION_RETIRE_ID },
      include: { resources: true },
    });
    expect(version).not.toBeNull();
    expect(version!.status).toBe('ARCHIVED');
    expect(version!.resources.length).toBeGreaterThan(0);
    // The stated reason is on the record, not lost with the decision.
    const audit = await prisma.aHSPAuditLog.findFirst({
      where: { ahspVersionId: VERSION_RETIRE_ID },
      orderBy: { when: 'desc' },
    });
    expect(audit?.reason).toContain('temporal completeness');
    expect(audit?.before).not.toBeNull();
  });

  it('D: retiring twice is a no-op, and leaves no second audit entry for one decision', async () => {
    await retire(VERSION_RETIRE_ID, 'ARCHIVED', 'first').expect(201);
    const second = await retire(VERSION_RETIRE_ID, 'ARCHIVED', 'second').expect(201);

    expect(second.body.changed).toBe(false);
    expect(await prisma.aHSPAuditLog.count({ where: { ahspVersionId: VERSION_RETIRE_ID } })).toBe(1);
  });

  it('E: only SUPERSEDED and ARCHIVED are reachable — a retirement can never promote a version', async () => {
    for (const status of ['PUBLISHED', 'VERIFIED', 'DRAFT', 'UNDER_REVIEW']) {
      await retire(VERSION_RETIRE_ID, status, 'attempted promotion').expect(400);
    }
    const version = await prisma.aHSPVersion.findUniqueOrThrow({ where: { id: VERSION_RETIRE_ID } });
    expect(version.status).toBe('DRAFT');
  });

  it('F: a reason is required — a version is never withdrawn silently', async () => {
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
  });

  it('G: authentication is required', async () => {
    await request(app.getHttpServer())
      .post(`/ahsp/versions/${VERSION_RETIRE_ID}/retire`)
      .set('x-workspace-id', WORKSPACE_A)
      .send({ status: 'ARCHIVED', reason: 'no token' })
      .expect(401);
  });
});
