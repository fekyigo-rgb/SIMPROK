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
      // Every listed row was ruled out by the machine: refusing exactly these is
      // the lawful road to "new" (proven at the end of this file). The binding
      // itself stays refused below.
      admissibleAfterExamination: true,
      candidateContextDigest: expect.any(String),
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

      // DECISION SAFETY — nominated on the shared words "pipa porous" ONLY, the
      // sibling is a reason to look, not an identity: a direct request is refused.
      const nameOnly = await post(
        `/resource-observations/${obs.pipa}/curate-existing`,
        { selectedResourceCatalogId: sibling.id },
      ).expect(409);
      expect(nameOnly.body.message).toBe(
        'IDENTITY_CANDIDATE_NAME_SIMILARITY_ONLY',
      );
      expect(await stored('pipa')).toEqual(before);

      // LEGACY_TEST_CHANGE_REGISTER: OLD positive control confirmed the sibling on
      // name tokens alone. NEW: once a recorded fact binds it (source code M25a
      // seen for that row), it is the human's to confirm. TEST_WEAKENING=NO.
      await prisma.resourceSourceIdentity.create({
        data: {
          resourceCatalogId: sibling.id,
          workspaceId,
          sourceSha256: 'ACC5'.padEnd(64, '0'),
          sourceFileName: 'AHSP earlier.xlsx',
          parserContractVersion: 'USI01_XLSX_V1',
          sheetName: 'Sheet1',
          sourceRowNumber: 5,
          sourceSection: 'MATERIAL',
          sourceNameCellAddress: 'B5',
          rawCode: 'M25a',
          rawName: 'Pipa porous',
          rawUnit: 'M1',
        },
      });
      // POSITIVE CONTROL — the recorded-fact nomination is still the human's to confirm.
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
      await prisma.resourceSourceIdentity.deleteMany({
        where: { resourceCatalogId: sibling.id },
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
      admissibleAfterExamination: true,
      candidateContextDigest: expect.any(String),
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
      admissibleAfterExamination: false,
      candidateContextDigest: expect.any(String),
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

  // LEGACY_TEST_CHANGE_REGISTER: OLD fixture confirmed "Semen" → "Semen Portland"
  // on token containment alone. DECISION SAFETY refuses that; the valid
  // nomination now rests on a recorded fact (code M12 seen for Semen Portland),
  // and the name-only attempt is asserted refused first. TEST_WEAKENING=NO.
  it('TEST 1 — a valid nominated candidate still resolves exactly as before', async () => {
    const guess = await listedRow('semen');
    expect(
      guess.candidates.find((c: any) => c.resourceCatalogId === catalog.semenPortland),
    ).toMatchObject({ identityBasis: 'NAME_SIMILARITY_ONLY', confirmable: false });
    const refusedGuess = await post(
      `/resource-observations/${obs.semen}/curate-existing`,
      { selectedResourceCatalogId: catalog.semenPortland },
    ).expect(409);
    expect(refusedGuess.body.message).toBe('IDENTITY_CANDIDATE_NAME_SIMILARITY_ONLY');
    expect(await stored('semen')).toMatchObject({ status: 'OBSERVED', resolvedResourceCatalogId: null });

    await prisma.resourceSourceIdentity.create({
      data: {
        resourceCatalogId: catalog.semenPortland,
        workspaceId,
        sourceSha256: 'ACC6'.padEnd(64, '0'),
        sourceFileName: 'AHSP earlier.xlsx',
        parserContractVersion: 'USI01_XLSX_V1',
        sheetName: 'Sheet1',
        sourceRowNumber: 6,
        sourceSection: 'MATERIAL',
        sourceNameCellAddress: 'B6',
        rawCode: 'M12',
        rawName: 'Semen Portland',
        rawUnit: 'KG',
      },
    });
    const listed = await listedRow('semen');
    expect(listed.identityVerdict.status).toBe('NEEDS_REVIEW');
    expect(listed.candidates.map((c: any) => c.resourceCatalogId)).toContain(
      catalog.semenPortland,
    );
    expect(
      listed.candidates.find((c: any) => c.resourceCatalogId === catalog.semenPortland),
    ).toMatchObject({ identityBasis: 'RECORDED_FACT', confirmable: true });
    await post(`/resource-observations/${obs.semen}/curate-existing`, {
      selectedResourceCatalogId: catalog.semenPortland,
    }).expect(201);
    expect(await stored('semen')).toMatchObject({
      status: 'RESOLVED_EXISTING',
      resolvedResourceCatalogId: catalog.semenPortland,
    });
  });

  // LEGACY_TEST_CHANGE_REGISTER: OLD_EXPECTATION was that the machine-proven row
  // is still LISTED for curation, carrying identityVerdict.status 'RESOLVED'.
  // AHSP IMPORT ACCEPTANCE BOUNDARY — IMPORT-SEAM-06 (B6): a person is never asked
  // to reconfirm an identity the machine already proves, so the curation list
  // omits it. Nothing is written in its place: the row stays OBSERVED, exactly as
  // stored. NEW_EXPECTATION: not listed, still OBSERVED — and every direct-request
  // protection below is asserted unchanged. TEST_WEAKENING=NO.
  it('a machine-proven identity is not asked again, is not overwritten by a direct request, and can still be confirmed', async () => {
    expect(await listedRow('kerikil')).toBeUndefined();
    expect(await stored('kerikil')).toMatchObject({
      status: 'OBSERVED',
      resolvedResourceCatalogId: null,
    });

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

  /**
   * LAWFUL ADMISSION PATH (branch c), through the real API and database.
   *
   * "Water Tank Truck" meets only "Dump Truck" by a shared stem. Refusing EXACTLY
   * that nomination, under the candidate context the list showed, lets the ONE
   * admission authority mint exactly one resource with full provenance. A stale
   * or partial refusal is refused; a repeated or concurrent request never mints
   * a second identity; and the other question of the page is untouched.
   */
  it('LAWFUL ADMISSION — refusing exactly the name-guess nominations mints ONE resource, once, with provenance', async () => {
    const listed = await listedRow('truck');
    expect(listed.identityVerdict).toMatchObject({
      status: 'NEEDS_REVIEW',
      exhausted: false,
      admissibleAfterExamination: true,
    });
    const digest = listed.identityVerdict.candidateContextDigest as string;
    const refusedIds = listed.candidates.map((c: any) => c.resourceCatalogId);
    expect(refusedIds).toEqual([catalog.dumpTruck]);
    const catalogBefore = await workspaceCatalogCount();
    const before = await stored('truck');

    // (b) is not (c): a partial or stale refusal is not an examination.
    const partial = await post(`/resource-observations/${obs.truck}/curate-new`, {
      unitDefinitionId: listed.suggestedUnitDefinitionId,
      refusedCandidateIds: ['00000000-0000-4000-8000-000000000000'],
      candidateContextDigest: digest,
    }).expect(409);
    expect(partial.body.message).toBe('RESOURCE_IDENTITY_NOT_EXHAUSTED');
    const stale = await post(`/resource-observations/${obs.truck}/curate-new`, {
      unitDefinitionId: listed.suggestedUnitDefinitionId,
      refusedCandidateIds: refusedIds,
      candidateContextDigest: 'f'.repeat(64),
    }).expect(409);
    expect(stale.body.message).toBe('RESOURCE_IDENTITY_NOT_EXHAUSTED');
    const incomplete = await post(`/resource-observations/${obs.truck}/curate-new`, {
      unitDefinitionId: listed.suggestedUnitDefinitionId,
      refusedCandidateIds: refusedIds,
    }).expect(400);
    expect(incomplete.body.message).toBe('EXAMINATION_INCOMPLETE');
    expect(await stored('truck')).toEqual(before);
    expect(await workspaceCatalogCount()).toBe(catalogBefore);

    // Two identical requests at once: exactly one admission.
    const body = {
      unitDefinitionId: listed.suggestedUnitDefinitionId,
      refusedCandidateIds: refusedIds,
      candidateContextDigest: digest,
    };
    const results = await Promise.all([
      post(`/resource-observations/${obs.truck}/curate-new`, body),
      post(`/resource-observations/${obs.truck}/curate-new`, body),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
    expect(await workspaceCatalogCount()).toBe(catalogBefore + 1);

    const after = await stored('truck');
    expect(after).toMatchObject({
      status: 'ADMITTED_NEW',
      rawName: 'Water Tank Truck',
      rawCode: 'E23',
      rawUnit: 'Jam',
      sourceSha256: SOURCE_SHA,
      sourceRowNumber: 43,
    });
    expect(after.reason).toContain(catalog.dumpTruck);
    const minted = await prisma.resourceCatalog.findUniqueOrThrow({
      where: { id: after.resolvedResourceCatalogId as string },
    });
    expect(minted).toMatchObject({ name: 'Water Tank Truck', type: 'EQUIPMENT', workspaceId });
    const sightings = await prisma.resourceSourceIdentity.findMany({
      where: { resourceCatalogId: minted.id },
    });
    expect(sightings).toHaveLength(1);
    expect(sightings[0]).toMatchObject({ sourceSha256: SOURCE_SHA, sourceRowNumber: 43, rawName: 'Water Tank Truck' });

    // A repeat after the fact: already decided, still one identity.
    const repeat = await post(`/resource-observations/${obs.truck}/curate-new`, body).expect(409);
    expect(repeat.body.message).toBe('OBSERVATION_ALREADY_DECIDED');
    expect(await workspaceCatalogCount()).toBe(catalogBefore + 1);
  });

  it('LAWFUL ADMISSION — a machine-ruled-out-only question (Pipa porous 6" vs 4") is admissible after refusing exactly that row', async () => {
    const listed = await listedRow('pipa');
    expect(listed.identityVerdict).toMatchObject({ status: 'UNRESOLVED', admissibleAfterExamination: true });
    const catalogBefore = await workspaceCatalogCount();
    await post(`/resource-observations/${obs.pipa}/curate-new`, {
      unitDefinitionId: listed.suggestedUnitDefinitionId,
      refusedCandidateIds: listed.candidates.map((c: any) => c.resourceCatalogId),
      candidateContextDigest: listed.identityVerdict.candidateContextDigest,
    }).expect(201);
    expect(await workspaceCatalogCount()).toBe(catalogBefore + 1);
    expect(await stored('pipa')).toMatchObject({ status: 'ADMITTED_NEW', rawName: 'Pipa porous diameter 6"' });
  });
});
