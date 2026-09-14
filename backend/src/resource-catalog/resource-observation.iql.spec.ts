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
  /** The second holder: may judge (approve / reject), never curate or teach. */
  const VERIFIER = 'acct-bp-verifier';
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
  let observationUpdates: Array<Record<string, unknown>>;
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
    observationUpdates = [];
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
          observationUpdates.push(args.data);
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
  /** A curator (AHSP_RESOURCE_IDENTITY_DECIDE) unless told otherwise. */
  const question = async (actor: string, authority = { mayDecide: true }) =>
    (await service.listQuestions(WS, actor, authority))[0];

  it('offers learning on every open row of the question, with its own signed context', async () => {
    const rows = await openList(OWNER);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.identicalQuestion.state).toBe('NONE');
      expect(row.identicalQuestion.rememberable).toBe(true);
      expect(typeof row.identicalQuestion.decisionContextToken).toBe('string');
      // Offered, so there is no refusal to name.
      expect(row.identicalQuestion.notRememberableReason).toBeNull();
    }
    // No actor → nothing is offered (and the row list itself is unchanged).
    const anonymous = await openList();
    expect(
      anonymous.every((row) => row.identicalQuestion.rememberable === false),
    ).toBe(true);
    expect(
      anonymous.every(
        (row) => row.identicalQuestion.notRememberableReason === 'NO_ACTOR',
      ),
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
      notRememberableReason: 'CANDIDATE_PENDING',
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

  /**
   * ACG-01.1 — ONE official line, ONE chosen row, SEVERAL catalogues.
   *
   * "Pipa porous diameter 6"" is the source. The 4" pipe is the row a person
   * might choose for it; the generic "Pipa porous" is a row the kernel really
   * does nominate for that wording; the rest are ordinary unrelated rows.
   */
  const PIPA_4 = {
    ...KERIKIL,
    id: 'cat-pipa-4',
    name: 'Pipa porous diameter 4"',
    baseUnit: 'M1',
  };
  const PIPA_GENERIC = {
    ...KERIKIL,
    id: 'cat-pipa',
    name: 'Pipa porous',
    baseUnit: 'M1',
  };
  const UNRELATED = [
    {
      ...KERIKIL,
      id: 'cat-mandor',
      name: 'Mandor',
      type: 'LABOR',
      baseUnit: 'OH',
    },
    { ...KERIKIL, id: 'cat-semen', name: 'Semen Portland', baseUnit: 'KG' },
  ];
  const pipaObservation = () =>
    observation('obs-pipa', {
      rawName: 'Pipa porous diameter 6"',
      rawCode: 'M25a',
      rawUnit: "M'",
    });

  /**
   * ACG-01.1 — CANDIDATE REFUSED IS NOT RESOURCE REFUSED, through the REAL kernel.
   *
   * An official "Pipa porous diameter 6"" row meets a catalogue that holds only
   * the 4" pipe. The kernel examines the 4" row and rules it out on the stated
   * diameter. That row can never become this resource's identity — not even by
   * a direct request to the plain decision door — and the 6" resource itself is
   * untouched: still OBSERVED, still unbound, still in the queue.
   */
  it('ACG-01.1: a specification-conflicted row cannot be recorded, and the source resource stays open', async () => {
    catalogs = [KERIKIL, PIPA_4];
    observations.push(pipaObservation());

    const listed = (await openList(OWNER)).find((row) => row.id === 'obs-pipa');
    expect(listed?.identityVerdict).toEqual({
      status: 'UNRESOLVED',
      reasonCodes: ['SPECIFICATION_CONFLICT'],
      exhausted: false,
    });
    expect(listed?.candidates.map((c) => c.resourceCatalogId)).toEqual([
      PIPA_4.id,
    ]);

    await expect(
      service.curateExisting({
        workspaceId: WS,
        observationId: 'obs-pipa',
        selectedResourceCatalogId: PIPA_4.id,
        actorAccountId: OWNER,
      }),
    ).rejects.toThrow(new ConflictException('IDENTITY_CANDIDATE_RULED_OUT'));

    // No false binding was written, and the reality is still there.
    expect(observationUpdates).toHaveLength(0);
    expect(observations.find((o) => o.id === 'obs-pipa')).toMatchObject({
      status: 'OBSERVED',
      resolvedResourceCatalogId: null,
      decidedByAccountId: null,
    });
    expect((await openList(OWNER)).some((row) => row.id === 'obs-pipa')).toBe(
      true,
    );

    // The unrelated, nominated question on the same page is unaffected.
    const nominated = await service.curateExisting({
      workspaceId: WS,
      observationId: 'obs-1',
      selectedResourceCatalogId: KERIKIL.id,
      actorAccountId: OWNER,
    });
    expect(nominated.status).toBe('RESOLVED_EXISTING');
  });

  /**
   * ACG-01.1 R1 — A REFUSAL IS NOT UNDONE BY AN UNRELATED SIBLING ROW.
   *
   * The same official 6" line, the same chosen 4" pipe, three catalogues: the
   * ruled-out row alone; the ruled-out row beside a generic "Pipa porous" the
   * kernel DOES nominate; and both beside unrelated rows. What the machine says
   * OUTWARDLY differs — once a nomination exists the answer is NEEDS_REVIEW and
   * the 4" pipe is not mentioned at all — but the chosen row is ruled out on its
   * own stated diameter in every one of them, so the door refuses in every one
   * of them.
   *
   * ELIGIBILITY OF THE CHOSEN ROW MAY NOT DEPEND ON WHICH OTHER ROWS A
   * WORKSPACE HAPPENS TO OWN.
   */
  it('ACG-01.1: a ruled-out row stays refused when the kernel nominates a sibling', async () => {
    const shapes = [
      { label: 'A — the ruled-out row alone', rows: [PIPA_4], listed: true },
      {
        label: 'B — a nominated sibling beside it',
        rows: [PIPA_4, PIPA_GENERIC],
        listed: false,
      },
      {
        label: 'C — a nominated sibling and unrelated rows',
        rows: [PIPA_4, PIPA_GENERIC, ...UNRELATED],
        listed: false,
      },
    ];

    for (const shape of shapes) {
      observations.length = 0;
      observations.push(pipaObservation());
      catalogs = [...shape.rows];
      observationUpdates.length = 0;
      const catalogueSize = catalogs.length;

      const open = (await openList(OWNER)).find((row) => row.id === 'obs-pipa');
      expect([shape.label, open?.identityVerdict.status]).toEqual([
        shape.label,
        shape.listed ? 'UNRESOLVED' : 'NEEDS_REVIEW',
      ]);
      expect([
        shape.label,
        open?.candidates.some((c) => c.resourceCatalogId === PIPA_4.id) ??
          false,
      ]).toEqual([shape.label, shape.listed]);

      await expect(
        service.curateExisting({
          workspaceId: WS,
          observationId: 'obs-pipa',
          selectedResourceCatalogId: PIPA_4.id,
          actorAccountId: OWNER,
        }),
      ).rejects.toThrow(new ConflictException('IDENTITY_CANDIDATE_RULED_OUT'));

      // Refused BEFORE persistence: no update was even attempted.
      expect([shape.label, observationUpdates.length]).toEqual([
        shape.label,
        0,
      ]);
      expect(observations[0]).toMatchObject({
        status: 'OBSERVED',
        resolvedResourceCatalogId: null,
        decidedByAccountId: null,
        decidedAt: null,
      });
      // Nothing was minted, nothing was learned, and the reality is still here.
      expect([shape.label, catalogs.length]).toEqual([
        shape.label,
        catalogueSize,
      ]);
      expect([shape.label, ledger.length]).toEqual([shape.label, 0]);
      expect((await openList(OWNER)).some((row) => row.id === 'obs-pipa')).toBe(
        true,
      );
    }
  });

  /**
   * ACG-01.1 R1 — POSITIVE CONTROL: A NARROWER QUESTION IS NOT A STRICTER LAW.
   *
   * Same source, same catalogue that refuses the 4" pipe: the row the kernel
   * NOMINATES is still the human's to confirm, and so is an unrelated question
   * on the same page. Only the refused row is refused.
   */
  it('ACG-01.1: the nominated row is still recorded, ruled-out sibling and all', async () => {
    catalogs = [KERIKIL, PIPA_4, PIPA_GENERIC, ...UNRELATED];
    observations.push(pipaObservation());

    const saved = await service.curateExisting({
      workspaceId: WS,
      observationId: 'obs-pipa',
      selectedResourceCatalogId: PIPA_GENERIC.id,
      actorAccountId: OWNER,
    });
    expect(saved).toMatchObject({
      status: 'RESOLVED_EXISTING',
      resolvedResourceCatalogId: PIPA_GENERIC.id,
    });

    const other = await service.curateExisting({
      workspaceId: WS,
      observationId: 'obs-1',
      selectedResourceCatalogId: KERIKIL.id,
      actorAccountId: OWNER,
    });
    expect(other.status).toBe('RESOLVED_EXISTING');
    // A refusal is not learning, and neither is a plain confirmation.
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
    // Said as what it is: the machine proved it, so there is nothing to learn.
    expect(
      rows.every(
        (row) =>
          row.identicalQuestion.notRememberableReason === 'IDENTITY_PROVEN' &&
          row.identityVerdict.status === 'RESOLVED' &&
          row.identityVerdict.exhausted === false,
      ),
    ).toBe(true);
  });

  it('with no signing secret the curation list still works — learning is simply not offered', async () => {
    delete process.env.GHX_DECISION_CONTEXT_SECRET;
    const rows = await openList(OWNER);
    expect(rows).toHaveLength(3);
    expect(
      rows.every((row) => row.identicalQuestion.rememberable === false),
    ).toBe(true);
    expect(
      rows.every(
        (row) =>
          row.identicalQuestion.notRememberableReason ===
          'LEARNING_NOT_CONFIGURED',
      ),
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

  it('SUPERSEDE: a different answer is only a candidate — reuse stops until ANOTHER account approves it', async () => {
    // Two legitimate candidates, so a different answer exists to supersede to.
    const BATU_PECAH = {
      ...KERIKIL,
      id: 'cat-batu-pecah',
      name: 'Agregat Batu Pecah',
    };
    catalogs = [KERIKIL, BATU_PECAH];
    const offered = await openList(OWNER);
    await teach(
      'obs-1',
      offered.find((row) => row.id === 'obs-1')!.identicalQuestion
        .decisionContextToken,
    );
    const pending = await question(SECOND);
    await service.approveQuestion({
      workspaceId: WS,
      questionKey: pending.questionKey,
      actorAccountId: SECOND,
      decisionContextToken: pending.decisionContextToken,
    });
    expect(await openList(OWNER)).toHaveLength(0);

    // The effective answer offers a supersede door, listing only OTHER legitimate candidates.
    const effective = await question(OWNER);
    expect(effective).toMatchObject({ state: 'EFFECTIVE', canSupersede: true });
    expect(effective.supersedeCandidates).toEqual([
      { resourceCatalogId: BATU_PECAH.id, name: BATU_PECAH.name },
    ]);
    await expect(
      service.supersedeQuestion({
        workspaceId: WS,
        questionKey: effective.questionKey,
        actorAccountId: OWNER,
        decisionContextToken: effective.decisionContextToken,
        selectedResourceCatalogId: KERIKIL.id,
        reason: 'same answer',
      }),
    ).rejects.toThrow(new ConflictException('SUPERSEDE_SAME_ANSWER'));
    const superseded = await service.supersedeQuestion({
      workspaceId: WS,
      questionKey: effective.questionKey,
      actorAccountId: OWNER,
      decisionContextToken: effective.decisionContextToken,
      selectedResourceCatalogId: BATU_PECAH.id,
      reason: 'Padanan yang lebih tepat',
    });
    expect(superseded).toMatchObject({
      action: 'SUPERSEDE',
      generation: 3,
      state: 'PENDING',
    });

    // Reuse is SUSPENDED: the identical rows are questions again.
    const suspended = await openList(OWNER);
    expect(suspended.map((row) => row.id)).toEqual(['obs-2', 'obs-3']);
    expect(
      suspended.every((row) => row.identicalQuestion.state === 'PENDING'),
    ).toBe(true);

    // The superseder cannot approve their own answer; another account can.
    const ownView = await question(OWNER);
    await expect(
      service.approveQuestion({
        workspaceId: WS,
        questionKey: ownView.questionKey,
        actorAccountId: OWNER,
        decisionContextToken: ownView.decisionContextToken,
      }),
    ).rejects.toThrow(new ConflictException('TEACHER_CANNOT_APPROVE'));
    const secondView = await question(SECOND);
    const approved = await service.approveQuestion({
      workspaceId: WS,
      questionKey: secondView.questionKey,
      actorAccountId: SECOND,
      decisionContextToken: secondView.decisionContextToken,
    });
    expect(approved).toMatchObject({ generation: 4, state: 'EFFECTIVE' });
    expect(
      (approved as { identityAfterApproval: unknown }).identityAfterApproval,
    ).toEqual({
      status: 'RESOLVED',
      authority: 'VERIFIED_IDENTICAL_QUESTION_REUSED',
      resolvedResourceCatalogId: BATU_PECAH.id,
    });
    expect(await openList(OWNER)).toHaveLength(0);
    expect(ledger.map((row) => `${row.generation}:${row.action}`)).toEqual([
      '1:TEACH',
      '2:APPROVE',
      '3:SUPERSEDE',
      '4:APPROVE',
    ]);
  });

  it('the SECOND HOLDER (judging only) approves a pending candidate — and is never offered REVOKE or SUPERSEDE', async () => {
    const JUDGE_ONLY = { mayDecide: false };
    // Two legitimate candidates, so SUPERSEDE is a real door — for a curator.
    catalogs = [
      KERIKIL,
      { ...KERIKIL, id: 'cat-batu-pecah', name: 'Agregat Batu Pecah' },
    ];
    const offered = await openList(OWNER);
    await teach(
      'obs-1',
      offered.find((row) => row.id === 'obs-1')!.identicalQuestion
        .decisionContextToken,
    );

    const pending = await question(VERIFIER, JUDGE_ONLY);
    expect(pending).toMatchObject({
      state: 'PENDING',
      authoredByYou: false,
      canApprove: true,
      canReject: true,
      canRevoke: false,
      canSupersede: false,
    });
    expect(typeof pending.decisionContextToken).toBe('string');

    const approved = await service.approveQuestion({
      workspaceId: WS,
      questionKey: pending.questionKey,
      actorAccountId: VERIFIER,
      decisionContextToken: pending.decisionContextToken,
    });
    expect(approved).toMatchObject({
      action: 'APPROVE',
      generation: 2,
      state: 'EFFECTIVE',
    });
    expect(
      (approved as { identityAfterApproval: unknown }).identityAfterApproval,
    ).toEqual({
      status: 'RESOLVED',
      authority: 'VERIFIED_IDENTICAL_QUESTION_REUSED',
      resolvedResourceCatalogId: KERIKIL.id,
    });
    expect(
      ledger.map((row) => `${row.action}:${row.decidedByAccountId}`),
    ).toEqual([`TEACH:${OWNER}`, `APPROVE:${VERIFIER}`]);

    // Effective now: the judge has nothing left to judge — no door, no context.
    const judged = await question(VERIFIER, JUDGE_ONLY);
    expect(judged).toMatchObject({
      state: 'EFFECTIVE',
      canApprove: false,
      canReject: false,
      canRevoke: false,
      canSupersede: false,
      decisionContextToken: null,
      supersedeCandidates: [],
    });
    // A curator keeps every door the law gives it.
    expect(await question(OWNER)).toMatchObject({
      state: 'EFFECTIVE',
      canRevoke: true,
      canSupersede: true,
    });
  });

  it('the SECOND HOLDER can REJECT a pending candidate — it leaves no memory', async () => {
    await teach('obs-1', await tokenFor('obs-1'));
    const pending = await question(VERIFIER, { mayDecide: false });
    const rejected = await service.rejectQuestion({
      workspaceId: WS,
      questionKey: pending.questionKey,
      actorAccountId: VERIFIER,
      decisionContextToken: pending.decisionContextToken,
      reason: 'Padanan belum tepat',
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

  it('an observation’s raw question is never rewritten — only its decision fields change', async () => {
    const offered = await openList(OWNER);
    const contextOf = (id: string) =>
      offered.find((row) => row.id === id)!.identicalQuestion
        .decisionContextToken;
    await teach('obs-1', contextOf('obs-1'));
    await teach('obs-2', contextOf('obs-2'));
    await service.curateExisting({
      workspaceId: WS,
      observationId: 'obs-3',
      selectedResourceCatalogId: KERIKIL.id,
      actorAccountId: OWNER,
    });
    expect(observationUpdates).toHaveLength(3);
    for (const data of observationUpdates) {
      expect(Object.keys(data).sort()).toEqual([
        'decidedAt',
        'decidedByAccountId',
        'reason',
        'resolvedResourceCatalogId',
        'status',
      ]);
    }
    expect(
      observations.every(
        (o) =>
          o.rawName === 'Agregat kasar' &&
          o.rawCode === 'M03' &&
          o.rawUnit === 'M3' &&
          o.resourceType === 'MATERIAL',
      ),
    ).toBe(true);
  });
});
