import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { buildAhspAnalisaXlsx } from '../../src/ahsp/document/ahsp-analisa-xlsx.fixture';
import { identicalQuestionKey } from '../../src/resource-catalog/identical-question-key';

/**
 * IQL-01 SECOND HOLDER — the Owner's governed lifecycle, end to end.
 *
 *   OWNER (curator) TEACH → PENDING → a DIFFERENT, existing Basic Price
 *   VERIFIER (who holds only the narrow judging code) APPROVES → EFFECTIVE →
 *   the exact same question "Agregat kasar" · M03 · M3 · MATERIAL asks no
 *   human again (VERIFIED_IDENTICAL_QUESTION_REUSED → "Kerikil / Agregat").
 *
 * The verifier role here carries exactly what canonical carries after the
 * governed activation: BASIC_PRICE_REVIEW_VIEW + BASIC_PRICE_VERIFY +
 * AHSP_RESOURCE_IDENTITY_QUESTION_APPROVE. The publisher carries only
 * BASIC_PRICE_PUBLISH. Nothing is stubbed: real HTTP, guards, PostgreSQL.
 */

const PASSWORD = 'Iql01SecondHolder123!';
const DECIDE = 'AHSP_RESOURCE_IDENTITY_DECIDE';
const JUDGE = 'AHSP_RESOURCE_IDENTITY_QUESTION_APPROVE';

describe('IQL-01 second holder: Basic Price verifier approves (e2e)', () => {
  const prisma = new PrismaClient();
  const tag = `IQLSH${Date.now()}`;

  let app: INestApplication;
  let orgId: string;
  let orgBId: string;
  let workspaceId: string;
  let workspaceBId: string;
  const accountIds: string[] = [];
  const membershipIds: string[] = [];
  const createdPermissionIds: string[] = [];
  const createdCatalogIds: string[] = [];

  const bearer: Record<
    'owner' | 'verifier' | 'publisher' | 'stranger' | 'foreign',
    string
  > = { owner: '', verifier: '', publisher: '', stranger: '', foreign: '' };
  const accountOf: Record<string, string> = {};
  let kerikilId: string;
  const obs: Record<string, string> = {};
  let questionKey: string;

  const http = () => app.getHttpServer() as never;
  const as = (who: keyof typeof bearer, ws: string = workspaceId) => ({
    get: (path: string) =>
      request(http())
        .get(path)
        .set('Authorization', `Bearer ${bearer[who]}`)
        .set('x-workspace-id', ws),
    post: (path: string, body: Record<string, unknown> = {}) =>
      request(http())
        .post(path)
        .set('Authorization', `Bearer ${bearer[who]}`)
        .set('x-workspace-id', ws)
        .send(body),
  });
  const openRows = async () =>
    (await as('owner').get('/resource-observations').expect(200)).body as any[];
  const questionsAs = async (who: keyof typeof bearer) =>
    (await as(who).get('/resource-observations/questions').expect(200))
      .body as any[];
  const ledger = () =>
    prisma.resourceIdentityQuestionDecision.findMany({
      where: { workspaceId },
      orderBy: [{ questionKey: 'asc' }, { generation: 'asc' }],
    });

  /** One analysis line inside a real AHSP workbook, previewed through the real route. */
  const previewLine = async (rawName: string, code: string, unit: string) => {
    const bytes = await buildAhspAnalisaXlsx((sheet) => {
      sheet.getCell('A14').value = 1;
      sheet.getCell('B14').value = rawName;
      sheet.getCell('E14').value = code;
      sheet.getCell('F14').value = unit;
      sheet.getCell('G14').value = 0.5;
    });
    const response = await request(http())
      .post('/ahsp/document/preview')
      .set('Authorization', `Bearer ${bearer.owner}`)
      .set('x-workspace-id', workspaceId)
      .attach('file', bytes, `${tag}.xlsx`)
      .expect(201);
    const resource = (response.body.workItems as any[])
      .flatMap((item) => item.resources as any[])
      .find((candidate) => candidate.rawName === rawName);
    if (!resource) throw new Error(`line "${rawName}" not read`);
    return resource;
  };
  const golden = () => previewLine('Agregat kasar', 'M03', 'M3');
  /** Human decisions an exposure still needs: 0 when SIMPROK settled it. */
  const humanWorkAtImport = (resource: any) =>
    resource.resolvedResourceCatalogId ? 0 : 1;
  const humanWorkAtQueue = (rows: any[]) =>
    rows.some(
      (row) =>
        row.rawName === 'Agregat kasar' &&
        row.rawCode === 'M03' &&
        row.rawUnit === 'M3',
    )
      ? 1
      : 0;

  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.init();

    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    orgId = (
      await prisma.organization.create({
        data: { name: `${tag} Org`, type: 'COMPANY' },
      })
    ).id;
    orgBId = (
      await prisma.organization.create({
        data: { name: `${tag} Org B`, type: 'COMPANY' },
      })
    ).id;
    workspaceId = (
      await prisma.workspace.create({
        data: { name: `${tag} WS`, organizationId: orgId },
      })
    ).id;
    workspaceBId = (
      await prisma.workspace.create({
        data: { name: `${tag} WS B`, organizationId: orgBId },
      })
    ).id;

    const ensurePermission = async (code: string) => {
      const existing = await prisma.permission.findUnique({ where: { code } });
      if (existing) return existing.id;
      const created = await prisma.permission.create({
        data: { code, name: `${tag} ${code}`, description: 'IQL-01 SH e2e' },
      });
      createdPermissionIds.push(created.id);
      return created.id;
    };
    const ids = async (...codes: string[]) =>
      Promise.all(codes.map((code) => ensurePermission(code)));
    const makeRole = async (suffix: string, ws: string, codes: string[]) =>
      prisma.role.create({
        data: {
          workspaceId: ws,
          code: `${tag}_${suffix}`,
          name: `${tag} ${suffix}`,
          rolePermissions: {
            create: (await ids(...codes)).map((permissionId) => ({
              permissionId,
            })),
          },
        },
      });
    const director = await makeRole('DIRECTOR', workspaceId, [
      DECIDE,
      'AHSP_MANAGE',
    ]);
    const verifierRole = await makeRole('BASIC_PRICE_VERIFIER', workspaceId, [
      'BASIC_PRICE_REVIEW_VIEW',
      'BASIC_PRICE_VERIFY',
      JUDGE,
    ]);
    const publisherRole = await makeRole('BASIC_PRICE_PUBLISHER', workspaceId, [
      'BASIC_PRICE_PUBLISH',
    ]);
    const foreignVerifier = await makeRole(
      'FOREIGN_BASIC_PRICE_VERIFIER',
      workspaceBId,
      ['BASIC_PRICE_VERIFY', JUDGE],
    );

    const createActor = async (
      who: keyof typeof bearer,
      ws: string,
      roleId: string | null,
    ) => {
      const email = `${tag}.${who}@test.local`.toLowerCase();
      const account = await prisma.account.create({
        data: { email, passwordHash, displayName: who, status: 'ACTIVE' },
      });
      accountIds.push(account.id);
      accountOf[who] = account.id;
      const membership = await prisma.workspaceMembership.create({
        data: {
          accountId: account.id,
          workspaceId: ws,
          status: 'ACTIVE',
          ...(roleId ? { membershipRoles: { create: [{ roleId }] } } : {}),
        },
      });
      membershipIds.push(membership.id);
      await prisma.user.create({
        data: {
          workspaceMembershipId: membership.id,
          workspaceId: ws,
          fullName: who,
          status: 'ACTIVE',
        },
      });
      bearer[who] = (
        await request(http())
          .post('/auth/login')
          .send({ email, password: PASSWORD })
          .expect(201)
      ).body.access_token as string;
    };
    await createActor('owner', workspaceId, director.id);
    await createActor('verifier', workspaceId, verifierRole.id);
    await createActor('publisher', workspaceId, publisherRole.id);
    await createActor('stranger', workspaceId, null);
    await createActor('foreign', workspaceBId, foreignVerifier.id);

    const catalog = async (ws: string, name: string) => {
      const created = await prisma.resourceCatalog.create({
        data: { workspaceId: ws, name, type: 'MATERIAL', baseUnit: 'M3' },
      });
      createdCatalogIds.push(created.id);
      return created.id;
    };
    kerikilId = await catalog(workspaceId, 'Kerikil / Agregat');
    await catalog(workspaceBId, 'Kerikil / Agregat');

    const observe = async (
      key: string,
      ws: string,
      rawName: string,
      rawCode: string,
      rawUnit: string,
      row: number,
    ) => {
      obs[key] = (
        await prisma.observedResource.create({
          data: {
            workspaceId: ws,
            origin: 'AHSP_IMPORT',
            rawName,
            rawCode,
            rawUnit,
            resourceType: 'MATERIAL',
            sourceSha256: 'E2E5'.padEnd(64, '0'),
            sourceFileName: 'AHSP BINA MARGA.xlsx',
            parserContractVersion: 'USI01_XLSX_V1',
            sheetName: 'Sheet1',
            sourceRowNumber: row,
            sourceNameCellAddress: `C${row}`,
            candidatesJson: ['Kerikil / Agregat'],
          },
        })
      ).id;
    };
    await observe('ak1', workspaceId, 'Agregat kasar', 'M03', 'M3', 2278);
    await observe('ak2', workspaceId, 'Agregat kasar', 'M03', 'M3', 2344);
    await observe('variant', workspaceId, 'Agregat Kasar', 'M03', 'M3', 961);
    await observe('m04', workspaceId, 'Agregat kasar', 'M04', 'M3', 300);
    await observe(
      'foreignAk',
      workspaceBId,
      'Agregat kasar',
      'M03',
      'M3',
      2278,
    );

    questionKey = identicalQuestionKey({
      workspaceId,
      resourceType: 'MATERIAL',
      rawName: 'Agregat kasar',
      rawCode: 'M03',
      rawUnit: 'M3',
    });
  }, 300_000);

  afterAll(async () => {
    const workspaces = [workspaceId, workspaceBId].filter(Boolean);
    // Append-only at the PostgreSQL boundary: the fixture removes its own
    // history the way the IQL-01 and MON-03 suites do — trigger off, newest
    // generation first (RESTRICT self-reference), trigger on.
    await prisma.$executeRawUnsafe(
      'ALTER TABLE resource_identity_question_decisions DISABLE TRIGGER resource_identity_question_decisions_immutable_trigger',
    );
    const events = await prisma.resourceIdentityQuestionDecision.findMany({
      where: { workspaceId: { in: workspaces } },
      orderBy: { generation: 'desc' },
      select: { id: true },
    });
    for (const event of events) {
      await prisma.resourceIdentityQuestionDecision.delete({
        where: { id: event.id },
      });
    }
    await prisma.$executeRawUnsafe(
      'ALTER TABLE resource_identity_question_decisions ENABLE TRIGGER resource_identity_question_decisions_immutable_trigger',
    );
    await prisma.observedResource.deleteMany({
      where: { workspaceId: { in: workspaces } },
    });
    await prisma.resourceCatalog.deleteMany({
      where: { workspaceId: { in: workspaces } },
    });
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
    await prisma.workspace.deleteMany({ where: { id: { in: workspaces } } });
    await prisma.organization.deleteMany({
      where: { id: { in: [orgId, orgBId].filter(Boolean) } },
    });
    await app.close();
    await prisma.$disconnect();
  }, 180_000);

  // =====================================================================

  it('the second holder is exactly the verifier: narrow code, no curation, no AHSP reach; the publisher holds none of it', async () => {
    const caps = async (who: keyof typeof bearer) =>
      (await as(who).get('/auth/capabilities').expect(200)).body
        .permissions as string[];
    const verifier = await caps('verifier');
    expect(verifier).toEqual(
      expect.arrayContaining([
        'BASIC_PRICE_REVIEW_VIEW',
        'BASIC_PRICE_VERIFY',
        JUDGE,
      ]),
    );
    expect(verifier).not.toContain(DECIDE);
    expect(verifier).not.toContain('AHSP_VIEW');
    expect(verifier).not.toContain('BASIC_PRICE_PUBLISH');
    const publisher = await caps('publisher');
    expect(publisher).not.toContain(JUDGE);
    expect(publisher).not.toContain(DECIDE);
    expect(await caps('owner')).not.toContain(JUDGE);
  });

  it('zero-IQL + B0: every exact question is NONE and the golden question needs a human at queue and import', async () => {
    expect(await ledger()).toHaveLength(0);
    const rows = await openRows();
    expect(rows.map((row) => row.id).sort()).toEqual(
      [obs.ak1, obs.ak2, obs.variant, obs.m04].sort(),
    );
    expect(rows.every((row) => row.identicalQuestion.state === 'NONE')).toBe(
      true,
    );
    expect(humanWorkAtQueue(rows)).toBe(1);
    expect(humanWorkAtImport(await golden())).toBe(1);
  });

  it('A — the OWNER teaches through the existing row decision: PENDING, never effective', async () => {
    const rows = await openRows();
    const ak1 = rows.find((row) => row.id === obs.ak1);
    const taught = await as('owner')
      .post(`/resource-observations/${obs.ak1}/curate-existing`, {
        selectedResourceCatalogId: kerikilId,
        rememberForIdenticalQuestions: true,
        decisionContextToken: ak1.identicalQuestion.decisionContextToken,
      })
      .expect(201);
    expect(taught.body.identicalQuestion).toMatchObject({
      state: 'PENDING',
      generation: 1,
    });
    const [teach] = await ledger();
    expect(teach).toMatchObject({
      questionKey,
      generation: 1,
      action: 'TEACH',
      selectedResourceCatalogId: kerikilId,
      originObservationId: obs.ak1,
      decidedByAccountId: accountOf.owner,
    });
    // Not effective: the identical open row still asks, and so does the import.
    const pending = (await openRows()).find((row) => row.id === obs.ak2);
    expect(pending.identicalQuestion.state).toBe('PENDING');
    expect(humanWorkAtImport(await golden())).toBe(1);
  });

  it('B — the OWNER can never approve its own TEACH: 409 TEACHER_CANNOT_APPROVE', async () => {
    const [own] = await questionsAs('owner');
    expect(own).toMatchObject({
      state: 'PENDING',
      authoredByYou: true,
      canApprove: false,
    });
    const refused = await as('owner')
      .post(`/resource-observations/questions/${questionKey}/approve`, {
        decisionContextToken: own.decisionContextToken,
      })
      .expect(409);
    expect(refused.body.message).toBe('TEACHER_CANNOT_APPROVE');
    expect(await ledger()).toHaveLength(1);
  });

  it('E, F — the publisher and an account without authority can neither look nor judge (403)', async () => {
    const [own] = await questionsAs('owner');
    for (const who of ['publisher', 'stranger'] as const) {
      await as(who).get('/resource-observations/questions').expect(403);
      await as(who)
        .post(`/resource-observations/questions/${questionKey}/approve`, {
          decisionContextToken: own.decisionContextToken,
        })
        .expect(403);
      await as(who)
        .post(`/resource-observations/questions/${questionKey}/reject`, {
          decisionContextToken: own.decisionContextToken,
          reason: 'bukan kewenangan',
        })
        .expect(403);
    }
    expect(await ledger()).toHaveLength(1);
  });

  it('the verifier sees the pending candidate with APPROVE / REJECT only — and can never curate, teach, revoke or supersede', async () => {
    const [view] = await questionsAs('verifier');
    expect(view).toMatchObject({
      questionKey,
      state: 'PENDING',
      rawName: 'Agregat kasar',
      rawCode: 'M03',
      rawUnit: 'M3',
      answer: { resourceCatalogId: kerikilId, name: 'Kerikil / Agregat' },
      authoredByYou: false,
      canApprove: true,
      canReject: true,
      canRevoke: false,
      canSupersede: false,
    });
    expect(typeof view.decisionContextToken).toBe('string');
    await as('verifier').get('/resource-observations').expect(403);
    await as('verifier')
      .post(`/resource-observations/${obs.ak2}/curate-existing`, {
        selectedResourceCatalogId: kerikilId,
      })
      .expect(403);
    for (const verb of ['revoke', 'supersede'] as const) {
      await as('verifier')
        .post(`/resource-observations/questions/${questionKey}/${verb}`, {
          decisionContextToken: view.decisionContextToken,
          selectedResourceCatalogId: kerikilId,
          reason: 'bukan kewenangan',
        })
        .expect(403);
    }
    expect(await ledger()).toHaveLength(1);
  });

  it('C, P — the verifier APPROVES; a concurrent double submit still yields exactly ONE approval', async () => {
    const [view] = await questionsAs('verifier');
    const responses = await Promise.all([
      as('verifier').post(
        `/resource-observations/questions/${questionKey}/approve`,
        { decisionContextToken: view.decisionContextToken },
      ),
      as('verifier').post(
        `/resource-observations/questions/${questionKey}/approve`,
        { decisionContextToken: view.decisionContextToken },
      ),
    ]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    expect(responses.map((response) => response.body.replayed).sort()).toEqual([
      false,
      true,
    ]);
    const first = responses.find((response) => !response.body.replayed)!;
    expect(first.body).toMatchObject({
      action: 'APPROVE',
      generation: 2,
      state: 'EFFECTIVE',
    });
    expect(first.body.identityAfterApproval).toEqual({
      status: 'RESOLVED',
      authority: 'VERIFIED_IDENTICAL_QUESTION_REUSED',
      resolvedResourceCatalogId: kerikilId,
    });
    const events = await ledger();
    expect(
      events.map((event) => `${event.action}:${event.decidedByAccountId}`),
    ).toEqual([`TEACH:${accountOf.owner}`, `APPROVE:${accountOf.verifier}`]);
  });

  it('G + B1 — the exact same question asks NO human again, at the queue and at import', async () => {
    const rows = await openRows();
    expect(humanWorkAtQueue(rows)).toBe(0);
    expect(rows.find((row) => row.id === obs.ak2)).toBeUndefined();
    const reuse = await golden();
    expect(reuse.resolvedResourceCatalogId).toBe(kerikilId);
    const [, approval] = await ledger();
    expect(reuse.identicalQuestionDecisionId).toBe(approval.id);
    expect(humanWorkAtImport(reuse)).toBe(0);
    // The reused row was not rewritten: reuse is a READ.
    const ak2 = await prisma.observedResource.findUniqueOrThrow({
      where: { id: obs.ak2 },
    });
    expect(ak2).toMatchObject({
      status: 'OBSERVED',
      rawName: 'Agregat kasar',
      rawCode: 'M03',
      rawUnit: 'M3',
      resolvedResourceCatalogId: null,
    });
    expect((await questionsAs('owner'))[0]).toMatchObject({
      state: 'EFFECTIVE',
      answer: { resourceCatalogId: kerikilId, name: 'Kerikil / Agregat' },
    });
  });

  it('H, I, J — another spelling, code or unit is another question: never answered by memory', async () => {
    const rows = await openRows();
    for (const id of [obs.variant, obs.m04]) {
      expect(rows.find((row) => row.id === id).identicalQuestion.state).toBe(
        'NONE',
      );
    }
    for (const [rawName, code, unit] of [
      ['Agregat Kasar', 'M03', 'M3'],
      ['Agregat kasar', 'M04', 'M3'],
      ['Agregat kasar', 'M03', 'm3'],
    ]) {
      const exposure = await previewLine(rawName, code, unit);
      expect(exposure.identicalQuestionDecisionId).toBeUndefined();
      expect(humanWorkAtImport(exposure)).toBe(1);
    }
  });

  it('K, M, N — a changed candidate set, an inactive target, or a machine match all stop reuse; restoring them restores it', async () => {
    const ws = workspaceId;
    // K — a new legitimate candidate changes the candidate context.
    const halus = await prisma.resourceCatalog.create({
      data: {
        workspaceId: ws,
        name: 'Agregat halus',
        type: 'MATERIAL',
        baseUnit: 'M3',
      },
    });
    expect(humanWorkAtImport(await golden())).toBe(1);
    expect((await questionsAs('owner'))[0].state).toBe('INAPPLICABLE');
    await prisma.resourceCatalog.delete({ where: { id: halus.id } });

    // M — an inactive target is no candidate at all.
    await prisma.resourceCatalog.update({
      where: { id: kerikilId },
      data: { status: 'INACTIVE' },
    });
    expect(humanWorkAtImport(await golden())).toBe(1);
    await prisma.resourceCatalog.update({
      where: { id: kerikilId },
      data: { status: 'ACTIVE' },
    });

    // N — a machine-proven exact match wins; memory is never consulted over it.
    const exact = await prisma.resourceCatalog.create({
      data: {
        workspaceId: ws,
        name: 'Agregat kasar',
        type: 'MATERIAL',
        baseUnit: 'M3',
      },
    });
    const machine = await golden();
    expect(machine.resolvedResourceCatalogId).toBe(exact.id);
    expect(machine.identicalQuestionDecisionId).toBeUndefined();
    await prisma.resourceCatalog.delete({ where: { id: exact.id } });

    // Everything restored → the exact answer applies again.
    const back = await golden();
    expect(back.resolvedResourceCatalogId).toBe(kerikilId);
    expect(humanWorkAtImport(back)).toBe(0);
  });

  it('O — another workspace’s verifier neither sees nor can spend this memory', async () => {
    const foreign = (
      await as('foreign', workspaceBId)
        .get('/resource-observations/questions')
        .expect(200)
    ).body;
    expect(foreign).toEqual([]);
    // A real, signed context from this workspace cannot be spent in another one.
    const [ownerView] = await questionsAs('owner');
    expect(typeof ownerView.decisionContextToken).toBe('string');
    await as('foreign', workspaceBId)
      .post(`/resource-observations/questions/${questionKey}/reject`, {
        decisionContextToken: ownerView.decisionContextToken,
        reason: 'lintas tenant',
      })
      .expect(401);
    const foreignRow = await prisma.observedResource.findUniqueOrThrow({
      where: { id: obs.foreignAk },
    });
    expect(foreignRow.status).toBe('OBSERVED');
    expect(await ledger()).toHaveLength(2);
  });

  it('D — the verifier REJECTS another pending candidate: no memory, the question asks again', async () => {
    const variant = (await openRows()).find((row) => row.id === obs.variant);
    await as('owner')
      .post(`/resource-observations/${obs.variant}/curate-existing`, {
        selectedResourceCatalogId: kerikilId,
        rememberForIdenticalQuestions: true,
        decisionContextToken: variant.identicalQuestion.decisionContextToken,
      })
      .expect(201);
    const variantKey = identicalQuestionKey({
      workspaceId,
      resourceType: 'MATERIAL',
      rawName: 'Agregat Kasar',
      rawCode: 'M03',
      rawUnit: 'M3',
    });
    const pending = (await questionsAs('verifier')).find(
      (question) => question.questionKey === variantKey,
    );
    expect(pending).toMatchObject({ state: 'PENDING', canReject: true });
    await as('verifier')
      .post(`/resource-observations/questions/${variantKey}/reject`, {
        decisionContextToken: pending.decisionContextToken,
      })
      .expect(400);
    const rejected = await as('verifier')
      .post(`/resource-observations/questions/${variantKey}/reject`, {
        decisionContextToken: pending.decisionContextToken,
        reason: 'Ejaan ini perlu ditinjau terpisah',
      })
      .expect(201);
    expect(rejected.body).toMatchObject({
      action: 'REJECT',
      state: 'REJECTED',
    });
    const exposure = await previewLine('Agregat Kasar', 'M03', 'M3');
    expect(humanWorkAtImport(exposure)).toBe(1);
    // The golden answer is untouched by the variant's fate.
    expect(humanWorkAtImport(await golden())).toBe(0);
  });

  it('Q, R, S — append-only history, raw fields verbatim, provenance to the source cell', async () => {
    const events = await ledger();
    expect(
      events
        .map(
          (event) =>
            `${event.questionKey === questionKey ? 'golden' : 'variant'}:${event.generation}:${event.action}`,
        )
        .sort(),
    ).toEqual([
      'golden:1:TEACH',
      'golden:2:APPROVE',
      'variant:1:TEACH',
      'variant:2:REJECT',
    ]);
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE resource_identity_question_decisions SET reason = 'tampered' WHERE id = '${events[0].id}'::uuid`,
      ),
    ).rejects.toThrow(/IQL01_APPEND_ONLY/);
    await expect(
      prisma.$executeRawUnsafe(
        `DELETE FROM resource_identity_question_decisions WHERE id = '${events[0].id}'::uuid`,
      ),
    ).rejects.toThrow(/IQL01_APPEND_ONLY/);
    const all = await prisma.observedResource.findMany({
      where: { workspaceId },
    });
    expect(
      all
        .map((o) => `${o.rawName}|${o.rawCode}|${o.rawUnit}|${o.resourceType}`)
        .sort(),
    ).toEqual(
      [
        'Agregat Kasar|M03|M3|MATERIAL',
        'Agregat kasar|M03|M3|MATERIAL',
        'Agregat kasar|M03|M3|MATERIAL',
        'Agregat kasar|M04|M3|MATERIAL',
      ].sort(),
    );
    for (const event of events) {
      const origin = all.find((o) => o.id === event.originObservationId)!;
      expect(origin.sourceSha256).toHaveLength(64);
      expect(origin.sourceNameCellAddress).toMatch(/^C\d+$/);
      expect(
        identicalQuestionKey({
          workspaceId: origin.workspaceId,
          resourceType: origin.resourceType,
          rawName: origin.rawName,
          rawCode: origin.rawCode,
          rawUnit: origin.rawUnit,
        }),
      ).toBe(event.questionKey);
    }
  });

  it('U, V — the verifier and the publisher keep exactly their Basic Price doors', async () => {
    await as('verifier').get('/basic-price-reviews').expect(200);
    await as('verifier')
      .get('/basic-price-reviews/reviewer-candidates')
      .expect(200);
    await as('verifier').get('/basic-price-publications').expect(403);
    await as('publisher').get('/basic-price-publications').expect(200);
    await as('publisher').get('/basic-price-reviews').expect(403);
  });
});
