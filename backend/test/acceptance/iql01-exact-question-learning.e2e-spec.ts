import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { buildAhspAnalisaXlsx } from '../../src/ahsp/document/ahsp-analisa-xlsx.fixture';
import { GhxDecisionContextTokenService } from '../../src/resource-catalog/ghx-decision-context-token.service';
import {
  IQL01_IDENTICAL_QUESTION_POLICY_VERSION,
  identicalQuestionKey,
} from '../../src/resource-catalog/identical-question-key';

/**
 * IQL-01 — GOVERNED EXACT-QUESTION LEARNING MEMORY, PROVEN END TO END.
 *
 * Nothing is stubbed: real HTTP, real guards, real PostgreSQL with the real
 * migration chain, real Unit Kernel, real Resource Identity kernel, real signed
 * contexts. The spine is the golden question from the canonical workspace —
 *
 *     "Agregat kasar" · code M03 · unit M3 · MATERIAL  →  "Kerikil / Agregat" [M3]
 *
 * — asked, taught (never effective by itself), approved by a DIFFERENT account,
 * reused for the identical question only, revoked, and re-established only by a
 * new TEACH and a new APPROVE. B0 and B1 are measured on the SAME two surfaces a
 * human works on: the curation queue and a real document preview.
 */

const PASSWORD = 'Iql01Acceptance123!';

describe('IQL-01 governed exact-question learning (e2e)', () => {
  const prisma = new PrismaClient();
  const tag = `IQL${Date.now()}`;

  let app: INestApplication;
  let tokens: GhxDecisionContextTokenService;

  let orgId: string;
  let orgBId: string;
  let workspaceId: string;
  let workspaceBId: string;
  const accountIds: string[] = [];
  const membershipIds: string[] = [];
  const createdPermissionIds: string[] = [];

  const bearer: Record<
    'owner' | 'second' | 'third' | 'noDecide' | 'foreign',
    string
  > = {
    owner: '',
    second: '',
    third: '',
    noDecide: '',
    foreign: '',
  };
  let ownerAccountId: string;
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

  const openRows = async (
    who: keyof typeof bearer = 'owner',
    ws: string = workspaceId,
  ) =>
    (await as(who, ws).get('/resource-observations').expect(200)).body as any[];
  const governedQuestions = async (who: keyof typeof bearer = 'owner') =>
    (await as(who).get('/resource-observations/questions').expect(200))
      .body as any[];
  const ledger = () =>
    prisma.resourceIdentityQuestionDecision.findMany({
      where: { workspaceId },
      orderBy: { generation: 'asc' },
    });

  /** The golden line inside a real AHSP analysis workbook, previewed through the real route. */
  const previewGolden = async () => {
    const bytes = await buildAhspAnalisaXlsx((sheet) => {
      sheet.getCell('A14').value = 1;
      sheet.getCell('B14').value = 'Agregat kasar';
      sheet.getCell('E14').value = 'M03';
      sheet.getCell('F14').value = 'M3';
      sheet.getCell('G14').value = 0.5;
    });
    const response = await request(http())
      .post('/ahsp/document/preview')
      .set('Authorization', `Bearer ${bearer.owner}`)
      .set('x-workspace-id', workspaceId)
      .attach('file', bytes, 'iql01-golden.xlsx')
      .expect(201);
    const resource = (response.body.workItems as any[])
      .flatMap((item) => item.resources as any[])
      .find((candidate) => candidate.rawName === 'Agregat kasar');
    if (!resource) throw new Error('golden line not read from the workbook');
    return resource;
  };
  /** Human decisions this exposure still needs for the golden question: 0 or 1. */
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
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tokens = app.get(GhxDecisionContextTokenService);

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
        data: {
          code,
          name: `${tag} ${code}`,
          description: 'IQL-01 E2E fixture',
        },
      });
      createdPermissionIds.push(created.id);
      return created.id;
    };
    const decide = await ensurePermission('AHSP_RESOURCE_IDENTITY_DECIDE');
    const manage = await ensurePermission('AHSP_MANAGE');
    const makeRole = (suffix: string, ws: string, permissionIds: string[]) =>
      prisma.role.create({
        data: {
          workspaceId: ws,
          code: `${tag}_${suffix}`,
          name: `${tag} ${suffix}`,
          rolePermissions: {
            create: permissionIds.map((permissionId) => ({ permissionId })),
          },
        },
      });
    const curator = await makeRole('CURATOR', workspaceId, [decide, manage]);
    const managerOnly = await makeRole('MANAGER', workspaceId, [manage]);
    const foreignCurator = await makeRole('FOREIGN', workspaceBId, [
      decide,
      manage,
    ]);

    const createActor = async (suffix: string, ws: string, roleId: string) => {
      const email = `${tag}.${suffix}@test.local`.toLowerCase();
      const account = await prisma.account.create({
        data: { email, passwordHash, displayName: suffix, status: 'ACTIVE' },
      });
      accountIds.push(account.id);
      const membership = await prisma.workspaceMembership.create({
        data: {
          accountId: account.id,
          workspaceId: ws,
          status: 'ACTIVE',
          membershipRoles: { create: [{ roleId }] },
        },
      });
      membershipIds.push(membership.id);
      await prisma.user.create({
        data: {
          workspaceMembershipId: membership.id,
          workspaceId: ws,
          fullName: suffix,
          status: 'ACTIVE',
        },
      });
      const login = await request(http())
        .post('/auth/login')
        .send({ email, password: PASSWORD })
        .expect(201);
      return {
        accountId: account.id,
        token: login.body.access_token as string,
      };
    };
    const owner = await createActor('owner', workspaceId, curator.id);
    ownerAccountId = owner.accountId;
    bearer.owner = owner.token;
    bearer.second = (
      await createActor('second', workspaceId, curator.id)
    ).token;
    bearer.third = (await createActor('third', workspaceId, curator.id)).token;
    bearer.noDecide = (
      await createActor('no-decide', workspaceId, managerOnly.id)
    ).token;
    bearer.foreign = (
      await createActor('foreign', workspaceBId, foreignCurator.id)
    ).token;

    // The one catalog row the golden question nominates — in both tenants.
    kerikilId = (
      await prisma.resourceCatalog.create({
        data: {
          workspaceId,
          name: 'Kerikil / Agregat',
          type: 'MATERIAL',
          baseUnit: 'M3',
        },
      })
    ).id;
    await prisma.resourceCatalog.create({
      data: {
        workspaceId: workspaceBId,
        name: 'Kerikil / Agregat',
        type: 'MATERIAL',
        baseUnit: 'M3',
      },
    });

    // Real, fully-located observations, as the AHSP import records them.
    const observe = async (
      key: string,
      ws: string,
      rawName: string,
      row: number,
    ) => {
      const created = await prisma.observedResource.create({
        data: {
          workspaceId: ws,
          origin: 'AHSP_IMPORT',
          rawName,
          rawCode: 'M03',
          rawUnit: 'M3',
          resourceType: 'MATERIAL',
          sourceSha256: 'E2E1'.padEnd(64, '0'),
          sourceFileName: 'AHSP BINA MARGA.xlsx',
          parserContractVersion: 'USI01_XLSX_V1',
          sheetName: 'Sheet1',
          sourceRowNumber: row,
          sourceNameCellAddress: `C${row}`,
          candidatesJson: ['Kerikil / Agregat'],
        },
      });
      obs[key] = created.id;
    };
    await observe('ak1', workspaceId, 'Agregat kasar', 2278);
    await observe('ak2', workspaceId, 'Agregat kasar', 2344);
    await observe('ak3', workspaceId, 'Agregat kasar', 922);
    await observe('variant', workspaceId, 'Agregat Kasar', 961);
    await observe('foreignAk', workspaceBId, 'Agregat kasar', 2278);

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
    // history exactly the way the MON-03 suite does — trigger off, newest
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

  let offered: any[];

  it('zero knowledge: the queue is the ordinary queue, every exact question in state NONE', async () => {
    expect(await ledger()).toHaveLength(0);
    offered = await openRows('owner');
    expect(offered.map((row) => row.id).sort()).toEqual(
      [obs.ak1, obs.ak2, obs.ak3, obs.variant].sort(),
    );
    for (const row of offered) {
      expect(row.identicalQuestion.state).toBe('NONE');
      expect(row.candidates.map((candidate: any) => candidate.name)).toContain(
        'Kerikil / Agregat',
      );
    }
    // The golden rows are offered as learning, each with its own signed context.
    for (const id of [obs.ak1, obs.ak2, obs.ak3]) {
      const row = offered.find((candidate) => candidate.id === id);
      expect(row.identicalQuestion.rememberable).toBe(true);
      expect(typeof row.identicalQuestion.decisionContextToken).toBe('string');
    }
  });

  it('B0: the golden question needs a human at the queue AND at import', async () => {
    expect(humanWorkAtQueue(await openRows('owner'))).toBe(1);
    const golden = await previewGolden();
    expect(golden.identityCandidates).toContain('Kerikil / Agregat');
    expect(humanWorkAtImport(golden)).toBe(1);
  });

  it('TEACH: one grouped human decision records one candidate — and nothing becomes effective', async () => {
    const contextOf = (id: string) =>
      offered.find((row) => row.id === id).identicalQuestion
        .decisionContextToken;
    for (const id of [obs.ak1, obs.ak2]) {
      await as('owner')
        .post(`/resource-observations/${id}/curate-existing`, {
          selectedResourceCatalogId: kerikilId,
          rememberForIdenticalQuestions: true,
          decisionContextToken: contextOf(id),
        })
        .expect(201);
    }
    const events = await ledger();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      questionKey,
      generation: 1,
      previousDecisionId: null,
      action: 'TEACH',
      selectedResourceCatalogId: kerikilId,
      resolutionPolicyVersion: IQL01_IDENTICAL_QUESTION_POLICY_VERSION,
      originObservationId: obs.ak1,
      decidedByAccountId: ownerAccountId,
    });
    // The rows themselves are decided exactly as before.
    const decided = await prisma.observedResource.findMany({
      where: { id: { in: [obs.ak1, obs.ak2] } },
    });
    expect(
      decided.every(
        (row) =>
          row.status === 'RESOLVED_EXISTING' &&
          row.resolvedResourceCatalogId === kerikilId,
      ),
    ).toBe(true);

    // NOT effective: the remaining identical row still asks, and so does the import.
    const rows = await openRows('owner');
    const ak3 = rows.find((row) => row.id === obs.ak3);
    expect(ak3.identicalQuestion).toMatchObject({
      state: 'PENDING',
      rememberable: false,
      pendingAuthoredByYou: true,
    });
    expect(humanWorkAtImport(await previewGolden())).toBe(1);
  });

  it('the teacher can never approve; an account without the authority cannot even look', async () => {
    const [mine] = await governedQuestions('owner');
    expect(mine).toMatchObject({
      questionKey,
      state: 'PENDING',
      canApprove: false,
      canReject: true,
      authoredByYou: true,
    });
    const refused = await as('owner')
      .post(`/resource-observations/questions/${questionKey}/approve`, {
        decisionContextToken: mine.decisionContextToken,
      })
      .expect(409);
    expect(refused.body.message).toBe('TEACHER_CANNOT_APPROVE');
    await as('noDecide').get('/resource-observations/questions').expect(403);
    await as('noDecide')
      .post(`/resource-observations/questions/${questionKey}/approve`, {
        decisionContextToken: mine.decisionContextToken,
      })
      .expect(403);
    expect(await ledger()).toHaveLength(1);
  });

  it('two DIFFERENT accounts approve concurrently — exactly one APPROVE, never two current answers', async () => {
    const [second] = await governedQuestions('second');
    const [third] = await governedQuestions('third');
    expect(second.canApprove).toBe(true);
    const responses = await Promise.all([
      as('second').post(
        `/resource-observations/questions/${questionKey}/approve`,
        { decisionContextToken: second.decisionContextToken },
      ),
      as('third').post(
        `/resource-observations/questions/${questionKey}/approve`,
        { decisionContextToken: third.decisionContextToken },
      ),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    const winner = responses.find((response) => response.status === 201)!;
    expect(winner.body).toMatchObject({
      action: 'APPROVE',
      generation: 2,
      state: 'EFFECTIVE',
    });
    expect(winner.body.identityAfterApproval).toEqual({
      status: 'RESOLVED',
      authority: 'VERIFIED_IDENTICAL_QUESTION_REUSED',
      resolvedResourceCatalogId: kerikilId,
    });
    const events = await ledger();
    expect(events.map((event) => event.action)).toEqual(['TEACH', 'APPROVE']);
  });

  it('B1: the identical future question asks NO human — at the queue and at import; the variant still asks', async () => {
    const rows = await openRows('owner');
    expect(humanWorkAtQueue(rows)).toBe(0);
    // "Agregat Kasar" is a DIFFERENT exact question: never answered by memory.
    const variant = rows.find((row) => row.id === obs.variant);
    expect(variant).toBeDefined();
    expect(variant.identicalQuestion.state).toBe('NONE');

    const golden = await previewGolden();
    expect(golden.resolvedResourceCatalogId).toBe(kerikilId);
    expect(golden.identicalQuestionDecisionId).toBe((await ledger())[1].id);
    expect(humanWorkAtImport(golden)).toBe(0);
    const [effective] = await governedQuestions('owner');
    expect(effective).toMatchObject({
      state: 'EFFECTIVE',
      answer: { resourceCatalogId: kerikilId, name: 'Kerikil / Agregat' },
    });
  });

  it('tenant isolation: another workspace neither sees nor can spend this memory', async () => {
    const foreignRows = await openRows('foreign', workspaceBId);
    expect(foreignRows.map((row) => row.id)).toEqual([obs.foreignAk]);
    expect(foreignRows[0].identicalQuestion.state).toBe('NONE');
    expect(
      (
        await as('foreign', workspaceBId)
          .get('/resource-observations/questions')
          .expect(200)
      ).body,
    ).toEqual([]);
    const [ownerView] = await governedQuestions('owner');
    await as('foreign', workspaceBId)
      .post(`/resource-observations/questions/${questionKey}/revoke`, {
        decisionContextToken: ownerView.decisionContextToken,
        reason: 'lintas tenant',
      })
      .expect(401);
    expect(await ledger()).toHaveLength(2);
  });

  it('a GHX decision context can never be spent on an IQL question', async () => {
    const ghx = tokens.issue({
      workspaceId,
      ahspResourceId: questionKey,
      originResolutionId: obs.ak1,
      actorAccountId: ownerAccountId,
      resolutionPolicyVersion: IQL01_IDENTICAL_QUESTION_POLICY_VERSION,
      expectedGeneration: 2,
      candidateContextDigest: 'x',
    });
    await as('owner')
      .post(`/resource-observations/questions/${questionKey}/revoke`, {
        decisionContextToken: ghx,
        reason: 'salah jalur',
      })
      .expect(401);
    expect(await ledger()).toHaveLength(2);
  });

  it('append-only and the governance rules hold at the PostgreSQL boundary itself', async () => {
    const [teach] = await ledger();
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE resource_identity_question_decisions SET reason = 'tampered' WHERE id = '${teach.id}'::uuid`,
      ),
    ).rejects.toThrow(/IQL01_APPEND_ONLY/);
    await expect(
      prisma.$executeRawUnsafe(
        `DELETE FROM resource_identity_question_decisions WHERE id = '${teach.id}'::uuid`,
      ),
    ).rejects.toThrow(/IQL01_APPEND_ONLY/);
    // An APPROVE may not carry an answer of its own; a REVOKE must say why.
    await expect(
      prisma.resourceIdentityQuestionDecision.create({
        data: {
          workspaceId,
          questionKey,
          generation: 90,
          previousDecisionId: teach.id,
          action: 'APPROVE',
          selectedResourceCatalogId: kerikilId,
          originObservationId: obs.ak1,
          decidedByAccountId: ownerAccountId,
        },
      }),
    ).rejects.toThrow(/iql01_selected_catalog_iff_answer/);
    await expect(
      prisma.resourceIdentityQuestionDecision.create({
        data: {
          workspaceId,
          questionKey,
          generation: 91,
          previousDecisionId: teach.id,
          action: 'REVOKE',
          originObservationId: obs.ak1,
          decidedByAccountId: ownerAccountId,
        },
      }),
    ).rejects.toThrow(/iql01_reason_required/);
    // Provenance cannot be pulled out from under a governance event.
    await expect(
      prisma.observedResource.delete({ where: { id: obs.ak1 } }),
    ).rejects.toThrow();
    expect(await ledger()).toHaveLength(2);
  });

  it('REVOKE stops reuse at once, keeps history, and brings the question back', async () => {
    const before = await ledger();
    const [effective] = await governedQuestions('owner');
    await as('owner')
      .post(`/resource-observations/questions/${questionKey}/revoke`, {
        decisionContextToken: effective.decisionContextToken,
      })
      .expect(400);
    const revoked = await as('owner')
      .post(`/resource-observations/questions/${questionKey}/revoke`, {
        decisionContextToken: effective.decisionContextToken,
        reason: 'Perlu ditinjau ulang',
      })
      .expect(201);
    expect(revoked.body).toMatchObject({
      action: 'REVOKE',
      generation: 3,
      state: 'REVOKED',
    });

    const after = await ledger();
    expect(after.map((event) => event.action)).toEqual([
      'TEACH',
      'APPROVE',
      'REVOKE',
    ]);
    // History is untouched, byte for byte.
    expect(JSON.stringify(after.slice(0, 2))).toBe(JSON.stringify(before));

    const rows = await openRows('owner');
    expect(humanWorkAtQueue(rows)).toBe(1);
    expect(rows.find((row) => row.id === obs.ak3).identicalQuestion.state).toBe(
      'REVOKED',
    );
    expect(humanWorkAtImport(await previewGolden())).toBe(1);
  });

  it('no revival: only a NEW TEACH and a NEW APPROVE make it effective again', async () => {
    const rows = await openRows('owner');
    const ak3 = rows.find((row) => row.id === obs.ak3);
    const taught = await as('owner')
      .post(`/resource-observations/${obs.ak3}/curate-existing`, {
        selectedResourceCatalogId: kerikilId,
        rememberForIdenticalQuestions: true,
        decisionContextToken: ak3.identicalQuestion.decisionContextToken,
      })
      .expect(201);
    expect(taught.body.identicalQuestion).toMatchObject({
      state: 'PENDING',
      generation: 4,
    });
    const [pending] = await governedQuestions('second');
    await as('second')
      .post(`/resource-observations/questions/${questionKey}/approve`, {
        decisionContextToken: pending.decisionContextToken,
      })
      .expect(201);
    expect(
      (await ledger()).map((event) => `${event.generation}:${event.action}`),
    ).toEqual(['1:TEACH', '2:APPROVE', '3:REVOKE', '4:TEACH', '5:APPROVE']);
    expect(humanWorkAtImport(await previewGolden())).toBe(0);
  });

  it('every governance event stays traceable to its source cell', async () => {
    for (const event of await ledger()) {
      const origin = await prisma.observedResource.findUniqueOrThrow({
        where: { id: event.originObservationId },
      });
      expect(origin.workspaceId).toBe(workspaceId);
      expect(origin.sourceSha256).toHaveLength(64);
      expect(origin.sheetName).toBe('Sheet1');
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
});
