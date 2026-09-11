import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { GhxDecisionContextTokenService } from './ghx-decision-context-token.service';
import { IQL01_IDENTICAL_QUESTION_POLICY_VERSION } from './identical-question-key';
import { ResourceIdentityResolutionService } from './resource-identity-resolution.service';
import { ResourceObservationService } from './resource-observation.service';

/**
 * IQL-01 — the governed lifecycle through the REAL observation service, the REAL
 * resolver and kernel and the REAL signed-context machinery, over an in-memory
 * ledger that enforces the same (workspaceId, questionKey, generation)
 * uniqueness the database does.
 *
 *   TEACH (candidate, never effective) → APPROVE by another account (effective)
 *   → the exact question leaves the queue → REVOKE (history kept, question back)
 *   → only a NEW TEACH + APPROVE can make it effective again.
 */
describe('IQL-01 governed exact-question learning — service lifecycle', () => {
  const WS = 'ws-A';
  const OWNER = 'acct-owner';
  const SECOND = 'acct-second';
  const THIRD = 'acct-third';
  const ORIGINAL_SECRET = process.env.GHX_DECISION_CONTEXT_SECRET;

  const KERIKIL = {
    id: 'cat-kerikil',
    code: null,
    name: 'Kerikil / Agregat',
    type: 'MATERIAL',
    baseUnit: 'M3',
    status: 'ACTIVE',
    specifications: null,
    workspaceId: WS,
  };
  const observation = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    workspaceId: WS,
    origin: 'AHSP_IMPORT',
    rawName: 'Agregat kasar',
    rawCode: 'M03',
    rawUnit: 'M3',
    resourceType: 'MATERIAL',
    status: 'OBSERVED',
    resolvedResourceCatalogId: null as string | null,
    decidedByAccountId: null as string | null,
    decidedAt: null as Date | null,
    reason: null as string | null,
    createdAt: new Date(),
    ...over,
  });

  let observations: ReturnType<typeof observation>[];
  let catalogs: Array<typeof KERIKIL>;
  let ledger: Array<Record<string, any>>;
  let failNextCreateWithRace: (() => void) | null;
  let service: ResourceObservationService;
  let tokens: GhxDecisionContextTokenService;

  const questionFields = (obs: ReturnType<typeof observation>) => ({
    workspaceId: obs.workspaceId,
    resourceType: obs.resourceType,
    rawName: obs.rawName,
    rawCode: obs.rawCode,
    rawUnit: obs.rawUnit,
  });
  const byId = (id: string) => ledger.find((row) => row.id === id) ?? null;
  const withOrigin = (row: Record<string, any>) => ({
    ...row,
    originObservation: questionFields(
      observations.find((o) => o.id === row.originObservationId)!,
    ),
  });

  beforeEach(() => {
    process.env.GHX_DECISION_CONTEXT_SECRET =
      'iql01-service-spec-secret-'.padEnd(48, 'x');
    observations = [
      observation('obs-1'),
      observation('obs-2'),
      observation('obs-3'),
    ];
    catalogs = [KERIKIL];
    ledger = [];
    failNextCreateWithRace = null;
    let sequence = 0;

    const prisma: any = {
      $transaction: (fn: (tx: unknown) => unknown) => fn(prisma),
      $executeRaw: jest.fn(async () => 0),
      observedResource: {
        findMany: jest.fn(async (args: any) =>
          observations.filter(
            (o) =>
              o.workspaceId === args.where.workspaceId &&
              o.status === args.where.status,
          ),
        ),
        findFirst: jest.fn(
          async (args: any) =>
            observations.find(
              (o) =>
                o.id === args.where.id &&
                o.workspaceId === args.where.workspaceId,
            ) ?? null,
        ),
        update: jest.fn(async (args: any) => {
          const target = observations.find((o) => o.id === args.where.id)!;
          Object.assign(target, args.data);
          return { ...target };
        }),
      },
      resourceCatalog: {
        findMany: jest.fn(async () => catalogs),
        findFirst: jest.fn(async (args: any) =>
          catalogs.find((c) => c.id === args.where.id && c.status === 'ACTIVE')
            ? { id: args.where.id }
            : null,
        ),
      },
      resourceSourceIdentity: { findMany: jest.fn(async () => []) },
      basicPriceImportRowResourceMapping: { findMany: jest.fn(async () => []) },
      resourceIdentityQuestionDecision: {
        // The resolver preload (newest per key, with the answer it follows) and
        // the governance list (every event, with catalog + origin).
        findMany: jest.fn(async (args: any) => {
          if (args.where.questionKey) {
            const keys: string[] = args.where.questionKey.in;
            return keys
              .map(
                (key) =>
                  ledger
                    .filter(
                      (row) =>
                        row.workspaceId === args.where.workspaceId &&
                        row.questionKey === key,
                    )
                    .sort((a, b) => b.generation - a.generation)[0],
              )
              .filter(Boolean)
              .map((row) => ({
                ...row,
                previousDecision: row.previousDecisionId
                  ? withOrigin(byId(row.previousDecisionId)!)
                  : null,
              }));
          }
          return ledger
            .filter((row) => row.workspaceId === args.where.workspaceId)
            .sort(
              (a, b) =>
                a.questionKey.localeCompare(b.questionKey) ||
                a.generation - b.generation,
            )
            .map((row) => ({
              ...withOrigin(row),
              selectedResourceCatalog: row.selectedResourceCatalogId
                ? {
                    id: row.selectedResourceCatalogId,
                    name:
                      catalogs.find(
                        (c) => c.id === row.selectedResourceCatalogId,
                      )?.name ?? '?',
                  }
                : null,
            }));
        }),
        findFirst: jest.fn(async (args: any) => {
          const latest = ledger
            .filter(
              (row) =>
                row.workspaceId === args.where.workspaceId &&
                row.questionKey === args.where.questionKey,
            )
            .sort((a, b) => b.generation - a.generation)[0];
          if (!latest) return null;
          return {
            ...withOrigin(latest),
            previousDecision: latest.previousDecisionId
              ? { ...byId(latest.previousDecisionId)! }
              : null,
          };
        }),
        create: jest.fn(async (args: any) => {
          if (failNextCreateWithRace) {
            const winner = failNextCreateWithRace;
            failNextCreateWithRace = null;
            winner();
            throw new Prisma.PrismaClientKnownRequestError(
              'Unique constraint failed',
              {
                code: 'P2002',
                clientVersion: 'test',
                meta: {
                  target:
                    'resource_identity_question_decisions_workspaceId_questionKe_key',
                },
              },
            );
          }
          const clash = ledger.some(
            (row) =>
              row.workspaceId === args.data.workspaceId &&
              row.questionKey === args.data.questionKey &&
              row.generation === args.data.generation,
          );
          if (clash) throw new Error('unique violation not expected here');
          const row = {
            id: `event-${++sequence}`,
            selectedResourceCatalogId: null,
            candidateContextDigest: null,
            resolutionPolicyVersion: null,
            previousDecisionId: null,
            reason: null,
            decidedAt: new Date(),
            ...args.data,
          };
          ledger.push(row);
          return { ...row };
        }),
      },
    };

    const units = {
      resolveCanonicalUnitIdentities: jest.fn(async () => {
        throw new Error('no tie expected');
      }),
    };
    const identity = new ResourceIdentityResolutionService(
      prisma,
      units as never,
    );
    tokens = new GhxDecisionContextTokenService();
    const unitKernel = {
      resolve: jest.fn(async () => ({
        status: 'RESOLVED',
        sourceUnitDefinition: { id: 'unit-m3' },
      })),
    };
    service = new ResourceObservationService(
      prisma,
      {} as never,
      unitKernel as never,
      identity,
      tokens,
    );
  });

  afterAll(() => {
    if (ORIGINAL_SECRET === undefined)
      delete process.env.GHX_DECISION_CONTEXT_SECRET;
    else process.env.GHX_DECISION_CONTEXT_SECRET = ORIGINAL_SECRET;
  });

  const openList = (actor?: string) => service.listOpenForCuration(WS, actor);
  const tokenFor = async (observationId: string, actor = OWNER) =>
    (await openList(actor)).find((row) => row.id === observationId)
      ?.identicalQuestion.decisionContextToken ?? null;
  const teach = async (
    observationId: string,
    token: string | null,
    actor = OWNER,
  ) =>
    service.curateExisting({
      workspaceId: WS,
      observationId,
      selectedResourceCatalogId: KERIKIL.id,
      actorAccountId: actor,
      rememberForIdenticalQuestions: true,
      decisionContextToken: token,
    });
  const question = async (actor: string) =>
    (await service.listQuestions(WS, actor))[0];

  it('offers learning on every open row of the question, with its own signed context', async () => {
    const rows = await openList(OWNER);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.identicalQuestion.state).toBe('NONE');
      expect(row.identicalQuestion.rememberable).toBe(true);
      expect(typeof row.identicalQuestion.decisionContextToken).toBe('string');
    }
    // No actor → nothing is offered (and the row list itself is unchanged).
    const anonymous = await openList();
    expect(
      anonymous.every((row) => row.identicalQuestion.rememberable === false),
    ).toBe(true);
  });

  it('the full governed lifecycle — and B1 < B0 for the golden question', async () => {
    // B0: the exact question is open and needs a human.
    expect((await openList(OWNER)).length).toBe(3);

    // TEACH through the SAME row decision. Like the page, the contexts for the
    // grouped rows are read ONCE, before the click; the second row replays.
    const offered = await openList(OWNER);
    const contextOf = (id: string) =>
      offered.find((row) => row.id === id)?.identicalQuestion
        .decisionContextToken ?? null;
    const t1 = await teach('obs-1', contextOf('obs-1'));
    const t2 = await teach('obs-2', contextOf('obs-2'));
    expect(t1.status).toBe('RESOLVED_EXISTING');
    expect(t1.identicalQuestion).toMatchObject({
      state: 'PENDING',
      generation: 1,
      replayed: false,
    });
    expect(t2.identicalQuestion).toMatchObject({
      state: 'PENDING',
      generation: 1,
      replayed: true,
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      action: 'TEACH',
      generation: 1,
      previousDecisionId: null,
      selectedResourceCatalogId: KERIKIL.id,
      resolutionPolicyVersion: IQL01_IDENTICAL_QUESTION_POLICY_VERSION,
      originObservationId: 'obs-1',
      decidedByAccountId: OWNER,
    });

    // A TEACH is NOT effective: the remaining identical row is still a question.
    const pendingRows = await openList(OWNER);
    expect(pendingRows.map((row) => row.id)).toEqual(['obs-3']);
    expect(pendingRows[0].identicalQuestion).toMatchObject({
      state: 'PENDING',
      rememberable: false,
      pendingAnswerName: 'Kerikil / Agregat',
      pendingAuthoredByYou: true,
    });

    // The teacher sees no approve door, and cannot approve through the API.
    const asOwner = await question(OWNER);
    expect(asOwner).toMatchObject({
      state: 'PENDING',
      canApprove: false,
      canReject: true,
      authoredByYou: true,
    });
    await expect(
      service.approveQuestion({
        workspaceId: WS,
        questionKey: asOwner.questionKey,
        actorAccountId: OWNER,
        decisionContextToken: asOwner.decisionContextToken,
      }),
    ).rejects.toThrow(new ConflictException('TEACHER_CANNOT_APPROVE'));

    // A second authorized account approves.
    const asSecond = await question(SECOND);
    expect(asSecond).toMatchObject({ canApprove: true, authoredByYou: false });
    const approval = await service.approveQuestion({
      workspaceId: WS,
      questionKey: asSecond.questionKey,
      actorAccountId: SECOND,
      decisionContextToken: asSecond.decisionContextToken,
    });
    expect(approval).toMatchObject({
      action: 'APPROVE',
      generation: 2,
      state: 'EFFECTIVE',
      replayed: false,
    });
    expect((approval as any).identityAfterApproval).toEqual({
      status: 'RESOLVED',
      authority: 'VERIFIED_IDENTICAL_QUESTION_REUSED',
      resolvedResourceCatalogId: KERIKIL.id,
    });

    // B1: the identical question no longer asks a human.
    expect(await openList(OWNER)).toHaveLength(0);
    expect((await question(OWNER)).state).toBe('EFFECTIVE');

    // REVOKE needs a reason, keeps history, and brings the question back.
    const effective = await question(OWNER);
    await expect(
      service.revokeQuestion({
        workspaceId: WS,
        questionKey: effective.questionKey,
        actorAccountId: OWNER,
        decisionContextToken: effective.decisionContextToken,
      }),
    ).rejects.toThrow(new BadRequestException('REASON_REQUIRED'));
    const revoked = await service.revokeQuestion({
      workspaceId: WS,
      questionKey: effective.questionKey,
      actorAccountId: OWNER,
      decisionContextToken: effective.decisionContextToken,
      reason: 'Kandidat perlu ditinjau ulang',
    });
    expect(revoked).toMatchObject({
      action: 'REVOKE',
      generation: 3,
      state: 'REVOKED',
    });
    const back = await openList(OWNER);
    expect(back.map((row) => row.id)).toEqual(['obs-3']);
    expect(back[0].identicalQuestion).toMatchObject({
      state: 'REVOKED',
      rememberable: true,
    });

    // No revival: only a NEW TEACH (generation 4) and a NEW APPROVE (5).
    const t4 = await teach('obs-3', await tokenFor('obs-3'));
    expect(t4.identicalQuestion).toMatchObject({
      state: 'PENDING',
      generation: 4,
    });
    const again = await question(SECOND);
    const a5 = await service.approveQuestion({
      workspaceId: WS,
      questionKey: again.questionKey,
      actorAccountId: SECOND,
      decisionContextToken: again.decisionContextToken,
    });
    expect(a5).toMatchObject({ generation: 5, state: 'EFFECTIVE' });

    // Every governance event is still there, in order, never rewritten.
    expect(ledger.map((row) => `${row.generation}:${row.action}`)).toEqual([
      '1:TEACH',
      '2:APPROVE',
      '3:REVOKE',
      '4:TEACH',
      '5:APPROVE',
    ]);
    expect(ledger.every((row) => row.originObservationId)).toBe(true);
    expect((await question(OWNER)).history).toHaveLength(5);
  });

  it('REJECT leaves no memory: the question is asked again', async () => {
    await teach('obs-1', await tokenFor('obs-1'));
    const asSecond = await question(SECOND);
    const rejected = await service.rejectQuestion({
      workspaceId: WS,
      questionKey: asSecond.questionKey,
      actorAccountId: SECOND,
      decisionContextToken: asSecond.decisionContextToken,
      reason: 'Bukan padanan yang tepat',
    });
    expect(rejected).toMatchObject({
      action: 'REJECT',
      generation: 2,
      state: 'REJECTED',
    });
    const rows = await openList(OWNER);
    expect(rows.map((row) => row.id)).toEqual(['obs-2', 'obs-3']);
    expect(
      rows.every((row) => row.identicalQuestion.state === 'REJECTED'),
    ).toBe(true);
  });

  it('a context issued before another act is stale — never two current answers', async () => {
    await teach('obs-1', await tokenFor('obs-1'));
    const secondView = await question(SECOND);
    const thirdView = await question(THIRD);
    await service.approveQuestion({
      workspaceId: WS,
      questionKey: secondView.questionKey,
      actorAccountId: SECOND,
      decisionContextToken: secondView.decisionContextToken,
    });
    await expect(
      service.approveQuestion({
        workspaceId: WS,
        questionKey: thirdView.questionKey,
        actorAccountId: THIRD,
        decisionContextToken: thirdView.decisionContextToken,
      }),
    ).rejects.toThrow(new ConflictException('DECISION_GENERATION_STALE'));
    expect(ledger.filter((row) => row.action === 'APPROVE')).toHaveLength(1);
  });

  it('a lost generation race is retried once and answered from the winner — no duplicate current state', async () => {
    await teach('obs-1', await tokenFor('obs-1'));
    const thirdView = await question(THIRD);
    const secondView = await question(SECOND);
    // The third account's write collides with a concurrent winner (the second account).
    failNextCreateWithRace = () =>
      ledger.push({
        id: 'winner-approve',
        workspaceId: WS,
        questionKey: secondView.questionKey,
        generation: 2,
        previousDecisionId: ledger[0].id,
        action: 'APPROVE',
        selectedResourceCatalogId: null,
        candidateContextDigest: null,
        resolutionPolicyVersion: null,
        originObservationId: 'obs-1',
        decidedByAccountId: SECOND,
        decidedAt: new Date(),
        reason: null,
      });
    await expect(
      service.approveQuestion({
        workspaceId: WS,
        questionKey: thirdView.questionKey,
        actorAccountId: THIRD,
        decisionContextToken: thirdView.decisionContextToken,
      }),
    ).rejects.toThrow(new ConflictException('DECISION_GENERATION_STALE'));
    expect(
      ledger
        .filter((row) => row.action === 'APPROVE')
        .map((row) => row.decidedByAccountId),
    ).toEqual([SECOND]);
  });

  it('a changed candidate context between offer and decision is refused, never guessed', async () => {
    const token = await tokenFor('obs-1');
    catalogs = [
      KERIKIL,
      { ...KERIKIL, id: 'cat-agregat-halus', name: 'Agregat halus' },
    ];
    await expect(teach('obs-1', token)).rejects.toThrow(
      new ConflictException('DECISION_CONTEXT_STALE'),
    );
    expect(ledger).toHaveLength(0);
    expect(observations[0].status).toBe('OBSERVED');
  });

  it('remember without a signed context is refused; without remember the row decision is exactly the old one', async () => {
    await expect(teach('obs-1', null)).rejects.toThrow(
      new BadRequestException('DECISION_CONTEXT_TOKEN_REQUIRED'),
    );
    const plain = await service.curateExisting({
      workspaceId: WS,
      observationId: 'obs-1',
      selectedResourceCatalogId: KERIKIL.id,
      actorAccountId: OWNER,
    });
    expect(plain.status).toBe('RESOLVED_EXISTING');
    expect(plain).not.toHaveProperty('identicalQuestion');
    expect(ledger).toHaveLength(0);
  });

  it('another actor’s context, or another question’s, can never be spent', async () => {
    const ownersToken = await tokenFor('obs-1', OWNER);
    await expect(teach('obs-1', ownersToken, SECOND)).rejects.toThrow(
      UnauthorizedException,
    );
    observations.push(observation('obs-other', { rawName: 'Agregat halus' }));
    await expect(teach('obs-other', ownersToken)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('a question the machine already resolves is never offered as learning', async () => {
    catalogs = [{ ...KERIKIL, id: 'cat-exact', name: 'Agregat kasar' }];
    const rows = await openList(OWNER);
    expect(
      rows.every((row) => row.identicalQuestion.rememberable === false),
    ).toBe(true);
  });

  it('with no signing secret the curation list still works — learning is simply not offered', async () => {
    delete process.env.GHX_DECISION_CONTEXT_SECRET;
    const rows = await openList(OWNER);
    expect(rows).toHaveLength(3);
    expect(
      rows.every((row) => row.identicalQuestion.rememberable === false),
    ).toBe(true);
  });

  it('governance input is validated before anything is read', async () => {
    await expect(
      service.rejectQuestion({
        workspaceId: WS,
        questionKey: 'not-a-key',
        actorAccountId: OWNER,
        decisionContextToken: 'x',
        reason: 'r',
      }),
    ).rejects.toThrow('QUESTION_NOT_FOUND');
    await expect(
      service.supersedeQuestion({
        workspaceId: WS,
        questionKey: 'a'.repeat(64),
        actorAccountId: OWNER,
        decisionContextToken: 'x',
        reason: 'r',
      }),
    ).rejects.toThrow(
      new BadRequestException('SELECTED_RESOURCE_CATALOG_ID_REQUIRED'),
    );
  });
});
