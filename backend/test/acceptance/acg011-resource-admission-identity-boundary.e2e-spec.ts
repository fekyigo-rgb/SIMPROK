import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';

import { AppModule } from '../../src/app.module';

/**
 * ACG-01.1 — RESOURCE ADMISSION & IDENTITY BOUNDARY, PROVEN END TO END.
 *
 * Nothing is stubbed: real HTTP, real guards, real PostgreSQL, the real Unit
 * Kernel and the real Resource Identity kernel. Each official source resource
 * below is stored the way an AHSP document import stores an unresolved line —
 * fully located — and then meets one verdict shape:
 *
 *   ruled out (stated specification) · ruled out (class) · weak · none found ·
 *   nominated · proven
 *
 * The law under test: CANDIDATE REFUSED IS NOT RESOURCE REFUSED. A row the
 * machine rules out for this wording can never be persisted as the identity —
 * not even by a direct request, and not when an unrelated sibling row keeps the
 * refusal off the outward candidate list — and the source resource it was
 * refused for stays accepted, stored and unresolved, byte for byte.
 *
 * Where the guarantee stops, stated plainly: a row the machine cannot connect
 * to this wording at all is not a row the machine refused, and choosing one
 * stays the human judgment it has always been.
 */

const PASSWORD = 'Acg011Acceptance123!';
const SOURCE_SHA = 'AC011'.padEnd(64, '0');

describe('ACG-01.1 resource admission & identity boundary (e2e)', () => {
  const prisma = new PrismaClient();
  const tag = `ACG011${Date.now()}`;

  let app: INestApplication;
  let orgId: string;
  let workspaceId: string;
  let bearer = '';
  const accountIds: string[] = [];
  const membershipIds: string[] = [];
  const createdPermissionIds: string[] = [];
  const catalog: Record<string, string> = {};
  const obs: Record<string, string> = {};

  const http = () => app.getHttpServer() as never;
  const get = (path: string) =>
    request(http())
      .get(path)
      .set('Authorization', `Bearer ${bearer}`)
      .set('x-workspace-id', workspaceId);
  const post = (path: string, body: Record<string, unknown> = {}) =>
    request(http())
      .post(path)
      .set('Authorization', `Bearer ${bearer}`)
      .set('x-workspace-id', workspaceId)
      .send(body);
  const listedRow = async (key: string) =>
    ((await get('/resource-observations').expect(200)).body as any[]).find(
      (row) => row.id === obs[key],
    );
  const stored = (key: string) =>
    prisma.observedResource.findUniqueOrThrow({ where: { id: obs[key] } });
  const workspaceCatalogCount = () =>
    prisma.resourceCatalog.count({ where: { workspaceId } });

  beforeAll(async () => {
    const [database] = await prisma.$queryRawUnsafe<Array<{ db: string }>>(
      'select current_database() as db',
    );
    if (database.db !== 'simprok_e2e') {
      throw new Error(`ACG-01.1 e2e refuses to run against ${database.db}`);
    }

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    orgId = (
      await prisma.organization.create({
        data: { name: `${tag} Org`, type: 'COMPANY' },
      })
    ).id;
    workspaceId = (
      await prisma.workspace.create({
        data: { name: `${tag} WS`, organizationId: orgId },
      })
    ).id;

    const ensurePermission = async (code: string) => {
      const existing = await prisma.permission.findUnique({ where: { code } });
      if (existing) return existing.id;
      const created = await prisma.permission.create({
        data: {
          code,
          name: `${tag} ${code}`,
          description: 'ACG-01.1 E2E fixture',
        },
      });
      createdPermissionIds.push(created.id);
      return created.id;
    };
    const decide = await ensurePermission('AHSP_RESOURCE_IDENTITY_DECIDE');
    const manage = await ensurePermission('AHSP_MANAGE');
    const role = await prisma.role.create({
      data: {
        workspaceId,
        code: `${tag}_CURATOR`,
        name: `${tag} curator`,
        rolePermissions: {
          create: [decide, manage].map((permissionId) => ({ permissionId })),
        },
      },
    });

    const email = `${tag}.curator@test.local`.toLowerCase();
    const account = await prisma.account.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(PASSWORD, 10),
        displayName: 'curator',
        status: 'ACTIVE',
      },
    });
    accountIds.push(account.id);
    const membership = await prisma.workspaceMembership.create({
      data: {
        accountId: account.id,
        workspaceId,
        status: 'ACTIVE',
        membershipRoles: { create: [{ roleId: role.id }] },
      },
    });
    membershipIds.push(membership.id);
    await prisma.user.create({
      data: {
        workspaceMembershipId: membership.id,
        workspaceId,
        fullName: 'curator',
        status: 'ACTIVE',
      },
    });
    bearer = (
      await request(http())
        .post('/auth/login')
        .send({ email, password: PASSWORD })
        .expect(201)
    ).body.access_token as string;

    const addCatalog = async (
      key: string,
      name: string,
      type: 'MATERIAL' | 'EQUIPMENT',
      baseUnit: string,
    ) => {
      catalog[key] = (
        await prisma.resourceCatalog.create({
          data: { workspaceId, name, type, baseUnit },
        })
      ).id;
    };
    await addCatalog('pipa4', 'Pipa porous diameter 4"', 'MATERIAL', 'M1');
    await addCatalog('semenPortland', 'Semen Portland', 'MATERIAL', 'KG');
    await addCatalog('kerikil', 'Kerikil / Agregat', 'MATERIAL', 'M3');
    await addCatalog('airEquipment', 'Air', 'EQUIPMENT', 'LITER');
    await addCatalog('dumpTruck', 'Dump Truck', 'EQUIPMENT', 'EQUIPMENT_HOUR');

    // Official source resources, stored exactly as the AHSP import stores an
    // unresolved line: every source fact and its locator.
    const observe = async (
      key: string,
      rawName: string,
      rawCode: string | null,
      rawUnit: string,
      resourceType: 'MATERIAL' | 'EQUIPMENT',
      row: number,
    ) => {
      obs[key] = (
        await prisma.observedResource.create({
          data: {
            workspaceId,
            origin: 'AHSP_IMPORT',
            rawName,
            rawCode,
            rawUnit,
            resourceType,
            sourceSha256: SOURCE_SHA,
            sourceFileName: 'AHSP BINA MARGA.xlsx',
            parserContractVersion: 'USI01_XLSX_V1',
            sheetName: 'ANALISA HARGA',
            sourceRowNumber: row,
            sourceNameCellAddress: `B${row}`,
            sourceCodeCellAddress: rawCode ? `E${row}` : null,
            sourceUnitCellAddress: `F${row}`,
          },
        })
      ).id;
    };
    await observe(
      'pipa',
      'Pipa porous diameter 6"',
      'M25a',
      "M'",
      'MATERIAL',
      38,
    );
    await observe('air', 'Air', 'M02', 'Liter', 'MATERIAL', 39);
    await observe('truck', 'Water Tank Truck', 'E23', 'Jam', 'EQUIPMENT', 43);
    await observe('plastizier', 'Plastizier', null, 'Kg', 'MATERIAL', 36);
    await observe('semen', 'Semen', 'M12', 'Kg', 'MATERIAL', 33);
    await observe('kerikil', 'Kerikil / Agregat', null, 'M3', 'MATERIAL', 40);
  }, 300_000);

  afterAll(async () => {
    if (workspaceId) {
      await prisma.observedResource.deleteMany({ where: { workspaceId } });
      await prisma.resourceSourceIdentity.deleteMany({
        where: { workspaceId },
      });
      await prisma.resourceCatalog.deleteMany({ where: { workspaceId } });
      await prisma.user.deleteMany({
        where: { workspaceMembershipId: { in: membershipIds } },
      });
      await prisma.workspaceMembership.deleteMany({
        where: { id: { in: membershipIds } },
      });
      await prisma.role.deleteMany({ where: { code: { startsWith: tag } } });
      await prisma.permission.deleteMany({
        where: { id: { in: createdPermissionIds } },
      });
      await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
      await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    }
    if (orgId) await prisma.organization.deleteMany({ where: { id: orgId } });
    await app?.close();
    await prisma.$disconnect();
  }, 180_000);

  // =====================================================================

  it('TEST 3 + 5 — a specification-refused candidate cannot be persisted by a direct request; the source resource stays accepted, stored and unresolved', async () => {
    const listed = await listedRow('pipa');
    expect(listed.status).toBe('OBSERVED');
    expect(listed.identityVerdict).toEqual({
      status: 'UNRESOLVED',
      reasonCodes: ['SPECIFICATION_CONFLICT'],
      exhausted: false,
    });
    expect(listed.candidates.map((c: any) => c.resourceCatalogId)).toEqual([
      catalog.pipa4,
    ]);

    const before = await stored('pipa');
    const refused = await post(
      `/resource-observations/${obs.pipa}/curate-existing`,
      {
        selectedResourceCatalogId: catalog.pipa4,
      },
    ).expect(409);
    expect(refused.body.message).toBe('IDENTITY_CANDIDATE_RULED_OUT');

    // SOURCE RESOURCE → STILL EXISTS → IDENTITY UNRESOLVED → NO FALSE BINDING.
    const after = await stored('pipa');
    expect(after).toEqual(before);
    expect(after).toMatchObject({
      status: 'OBSERVED',
      resolvedResourceCatalogId: null,
      decidedByAccountId: null,
      decidedAt: null,
      rawName: 'Pipa porous diameter 6"',
      rawCode: 'M25a',
      rawUnit: "M'",
      sourceSha256: SOURCE_SHA,
      sheetName: 'ANALISA HARGA',
      sourceRowNumber: 38,
    });
    expect((await listedRow('pipa'))?.status).toBe('OBSERVED');
  });

  /**
   * TEST 5 (sibling) — THE REFUSAL DOES NOT DEPEND ON WHAT ELSE THE CATALOGUE
   * HOLDS.
   *
   * A generic "Pipa porous" row is added, and the machine now nominates it: the
   * outward answer becomes NEEDS_REVIEW and stops mentioning the 4" pipe. The
   * 4" pipe is still ruled out on its own stated diameter, so the door still
   * refuses it — while the row the machine DOES nominate stays the human's to
   * confirm.
   */
  it('TEST 5 (sibling) — a nominated sibling does not open the ruled-out row', async () => {
    const sibling = await prisma.resourceCatalog.create({
      data: {
        workspaceId,
        name: 'Pipa porous',
        type: 'MATERIAL',
        baseUnit: 'M1',
      },
    });
    const learnedBefore = await prisma.resourceIdentityQuestionDecision.count({
      where: { workspaceId },
    });
    try {
      // The refused row is not even mentioned outwardly any more.
      const listed = await listedRow('pipa');
      expect(listed.identityVerdict.status).toBe('NEEDS_REVIEW');
      expect(listed.candidates.map((c: any) => c.resourceCatalogId)).toEqual([
        sibling.id,
      ]);

      const before = await stored('pipa');
      const catalogBefore = await workspaceCatalogCount();
      const refused = await post(
        `/resource-observations/${obs.pipa}/curate-existing`,
        { selectedResourceCatalogId: catalog.pipa4 },
      ).expect(409);
      expect(refused.body.message).toBe('IDENTITY_CANDIDATE_RULED_OUT');

      // Byte for byte: no binding, no state change, nothing minted, nothing learned.
      expect(await stored('pipa')).toEqual(before);
      expect(await workspaceCatalogCount()).toBe(catalogBefore);
      expect(
        await prisma.resourceIdentityQuestionDecision.count({
          where: { workspaceId },
        }),
      ).toBe(learnedBefore);

      // POSITIVE CONTROL — the nominated row is still the human's to confirm.
      const saved = await post(
        `/resource-observations/${obs.pipa}/curate-existing`,
        { selectedResourceCatalogId: sibling.id },
      ).expect(201);
      expect(saved.body).toMatchObject({
        status: 'RESOLVED_EXISTING',
        resolvedResourceCatalogId: sibling.id,
      });
    } finally {
      // Put the question back the way the rest of this file expects it.
      await prisma.observedResource.update({
        where: { id: obs.pipa },
        data: {
          status: 'OBSERVED',
          resolvedResourceCatalogId: null,
          decidedByAccountId: null,
          decidedAt: null,
          reason: null,
        },
      });
      await prisma.resourceCatalog.delete({ where: { id: sibling.id } });
    }
  });

  it('TEST 3 (class) — a class-refused candidate is refused the same way, and nothing is written', async () => {
    const listed = await listedRow('air');
    expect(listed.identityVerdict).toEqual({
      status: 'UNRESOLVED',
      reasonCodes: ['RESOURCE_TYPE_MISMATCH'],
      exhausted: false,
    });
    const before = await stored('air');
    const refused = await post(
      `/resource-observations/${obs.air}/curate-existing`,
      {
        selectedResourceCatalogId: catalog.airEquipment,
      },
    ).expect(409);
    expect(refused.body.message).toBe('IDENTITY_CANDIDATE_RULED_OUT');
    expect(await stored('air')).toEqual(before);
  });

  it('GAP C, not relaxed — the refused-candidate resource is not minted as new either: no false admission, no catalogue row', async () => {
    const listed = await listedRow('pipa');
    const catalogBefore = await workspaceCatalogCount();
    const before = await stored('pipa');
    const refused = await post(
      `/resource-observations/${obs.pipa}/curate-new`,
      {
        unitDefinitionId: listed.suggestedUnitDefinitionId,
      },
    ).expect(409);
    expect(refused.body.message).toBe('RESOURCE_IDENTITY_NOT_EXHAUSTED');
    expect(await workspaceCatalogCount()).toBe(catalogBefore);
    expect(await stored('pipa')).toEqual(before);
  });

  it('TEST 2 — a weak candidate is never a resolution by itself', async () => {
    const listed = await listedRow('truck');
    expect(listed.status).toBe('OBSERVED');
    expect(listed.identityVerdict.status).toBe('NEEDS_REVIEW');
    expect(listed.identityVerdict.exhausted).toBe(false);
    expect(listed.candidates).toEqual([
      expect.objectContaining({
        resourceCatalogId: catalog.dumpTruck,
        evidence: ['NAME_TOKEN_STEM_SHARED'],
      }),
    ]);
    expect(await stored('truck')).toMatchObject({
      status: 'OBSERVED',
      resolvedResourceCatalogId: null,
    });
  });

  it('TEST 4 — no candidate: accepted and unresolved, and the lawful continuation (admission) opens', async () => {
    const listed = await listedRow('plastizier');
    expect(listed.status).toBe('OBSERVED');
    expect(listed.identityVerdict).toEqual({
      status: 'UNRESOLVED',
      reasonCodes: ['RESOURCE_NOT_FOUND'],
      exhausted: true,
    });
    expect(listed.suggestedUnitDefinitionId).toEqual(expect.any(String));

    await post(`/resource-observations/${obs.plastizier}/curate-new`, {
      unitDefinitionId: listed.suggestedUnitDefinitionId,
    }).expect(201);
    const after = await stored('plastizier');
    expect(after.status).toBe('ADMITTED_NEW');
    const minted = await prisma.resourceCatalog.findUniqueOrThrow({
      where: { id: after.resolvedResourceCatalogId as string },
    });
    expect(minted).toMatchObject({
      name: 'Plastizier',
      type: 'MATERIAL',
      workspaceId,
    });
  });

  it('TEST 1 — a valid nominated candidate still resolves exactly as before', async () => {
    const listed = await listedRow('semen');
    expect(listed.identityVerdict.status).toBe('NEEDS_REVIEW');
    expect(listed.candidates.map((c: any) => c.resourceCatalogId)).toContain(
      catalog.semenPortland,
    );
    await post(`/resource-observations/${obs.semen}/curate-existing`, {
      selectedResourceCatalogId: catalog.semenPortland,
    }).expect(201);
    expect(await stored('semen')).toMatchObject({
      status: 'RESOLVED_EXISTING',
      resolvedResourceCatalogId: catalog.semenPortland,
    });
  });

  it('a machine-proven identity is not overwritten by a direct request, and can still be confirmed', async () => {
    const listed = await listedRow('kerikil');
    expect(listed.identityVerdict.status).toBe('RESOLVED');

    const before = await stored('kerikil');
    const refused = await post(
      `/resource-observations/${obs.kerikil}/curate-existing`,
      {
        selectedResourceCatalogId: catalog.semenPortland,
      },
    ).expect(409);
    expect(refused.body.message).toBe('IDENTITY_PROVEN_OTHERWISE');
    expect(await stored('kerikil')).toEqual(before);

    await post(`/resource-observations/${obs.kerikil}/curate-existing`, {
      selectedResourceCatalogId: catalog.kerikil,
    }).expect(201);
    expect(await stored('kerikil')).toMatchObject({
      status: 'RESOLVED_EXISTING',
      resolvedResourceCatalogId: catalog.kerikil,
    });
  });
});
