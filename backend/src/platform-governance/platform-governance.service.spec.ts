// PLATFORM GOVERNANCE — the refusals, the replay rules, and the boundary.
//
// Everything that can be proved without a database is proved here. The facts
// that need a real one — concurrency, generation lineage, immutability of
// history — are proved against the guarded database in
// test/acceptance/platform-governance.e2e-spec.ts.
//
// The architecture block at the bottom is the load-bearing part: it reads the
// service's own source and proves that Workspace RBAC, Project Authority, the
// Position chain and AuthorityService are not on this path at all. Those are
// Owner-locked separations, and a test that only checked behaviour could not
// tell "does not currently consult a Role" from "cannot".

import { readFileSync } from 'fs';
import { join } from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  PLATFORM_GOVERNANCE_AUTHORITIES,
  PLATFORM_GOVERNANCE_REFUSAL,
  PlatformGovernanceService,
} from './platform-governance.service';

const HOLDER = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';
const AUTHORITY_ID = '33333333-3333-4333-8333-333333333333';

/** A complete, lawful ceremony. Every test below spoils exactly one thing. */
const ceremony = (over: Record<string, unknown> = {}) => ({
  holderAccountId: HOLDER,
  authorityCode: PLATFORM_GOVERNANCE_AUTHORITIES.PUBLISH,
  executedByAccountId: ACTOR,
  ownerAuthorizationReference: 'OWNER-AUTH-2026-0001',
  reason: 'Owner ceremony 2026-09-03',
  idempotencyKey: 'ceremony-1',
  ...over,
});

describe('PlatformGovernanceService', () => {
  let service: PlatformGovernanceService;
  let tx: {
    platformGovernanceDecision: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
    };
    account: { findUnique: jest.Mock };
    authority: { findUnique: jest.Mock };
  };
  let prisma: any;

  const activeAccount = { status: 'ACTIVE' };

  beforeEach(async () => {
    tx = {
      platformGovernanceDecision: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({
          id: 'decision-1',
          decidedAt: new Date('2026-09-03T00:00:00.000Z'),
          ...data,
        })),
      },
      account: { findUnique: jest.fn().mockResolvedValue(activeAccount) },
      authority: { findUnique: jest.fn().mockResolvedValue({ id: AUTHORITY_ID }) },
    };

    prisma = {
      $transaction: jest.fn((cb: (client: unknown) => unknown) => cb(tx)),
      platformGovernanceDecision: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      account: { findUnique: jest.fn().mockResolvedValue(activeAccount) },
      authority: { findUnique: jest.fn().mockResolvedValue({ id: AUTHORITY_ID }) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformGovernanceService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(PlatformGovernanceService);
  });

  // ── A / B — the ceremonies themselves ───────────────────────────────────

  it('A. GRANT appends generation 1 carrying every accountability fact', async () => {
    const result: any = await service.grant(ceremony());

    expect(tx.platformGovernanceDecision.create).toHaveBeenCalledTimes(1);
    const data = tx.platformGovernanceDecision.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      holderAccountId: HOLDER,
      authorityId: AUTHORITY_ID,
      decision: 'GRANT',
      generation: 1,
      previousDecisionId: null,
      executedByAccountId: ACTOR,
      // X — the Owner authorization is PERSISTED, not merely required.
      ownerAuthorizationReference: 'OWNER-AUTH-2026-0001',
      idempotencyKey: 'ceremony-1',
    });
    expect(data.commandFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(result.decision).toBe('GRANT');
  });

  it('B. REVOKE supersedes the held generation instead of rewriting it', async () => {
    tx.platformGovernanceDecision.findFirst.mockResolvedValue({
      id: 'decision-1',
      generation: 1,
      decision: 'GRANT',
    });

    await service.revoke(ceremony({ idempotencyKey: 'ceremony-2' }));

    const data = tx.platformGovernanceDecision.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      decision: 'REVOKE',
      generation: 2,
      previousDecisionId: 'decision-1',
    });
    // Nothing was updated and nothing was deleted. History is append-only.
    expect((tx.platformGovernanceDecision as any).update).toBeUndefined();
    expect((tx.platformGovernanceDecision as any).delete).toBeUndefined();
  });

  // ── D / E / X — the Owner authorization reference ───────────────────────

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['blank', '   '],
    ['non-string', 42],
  ])('D/E. %s Owner authorization DENIES before any read', async (_l, value) => {
    await expect(
      service.grant(ceremony({ ownerAuthorizationReference: value }) as never),
    ).rejects.toThrow(PLATFORM_GOVERNANCE_REFUSAL.OWNER_AUTHORIZATION_REQUIRED);
    // Checked FIRST: a ceremony that cannot name its authorization is refused
    // before the database is consulted at all.
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('D. the refusal is a BadRequest, not a silent no-op', async () => {
    await expect(
      service.grant(ceremony({ ownerAuthorizationReference: '' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // ── F / G / H / I — the subject, the actor, the power ───────────────────

  it('F. unknown Authority DENIES and creates nothing', async () => {
    tx.authority.findUnique.mockResolvedValue(null);
    await expect(service.grant(ceremony())).rejects.toThrow(
      PLATFORM_GOVERNANCE_REFUSAL.AUTHORITY_NOT_FOUND,
    );
    expect(tx.platformGovernanceDecision.create).not.toHaveBeenCalled();
  });

  it('F. an unknown Authority code is never created here', async () => {
    tx.authority.findUnique.mockResolvedValue(null);
    await service.grant(ceremony()).catch(() => undefined);
    // Looked up by code only. A `create` here would be a second vocabulary.
    expect((tx.authority as any).create).toBeUndefined();
  });

  it('G. unknown holder Account DENIES', async () => {
    tx.account.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === HOLDER ? null : activeAccount,
    );
    await expect(service.grant(ceremony())).rejects.toThrow(
      PLATFORM_GOVERNANCE_REFUSAL.HOLDER_NOT_FOUND,
    );
    expect(tx.platformGovernanceDecision.create).not.toHaveBeenCalled();
  });

  it.each(['PENDING', 'SUSPENDED', 'DEACTIVATED'])(
    'H. holder whose account is %s DENIES',
    async (status) => {
      tx.account.findUnique.mockImplementation(async ({ where }: any) =>
        where.id === HOLDER ? { status } : activeAccount,
      );
      await expect(service.grant(ceremony())).rejects.toThrow(
        PLATFORM_GOVERNANCE_REFUSAL.HOLDER_INACTIVE,
      );
    },
  );

  it.each([
    ['missing', undefined],
    ['blank', '  '],
  ])('I. %s executing actor DENIES', async (_l, value) => {
    await expect(
      service.grant(ceremony({ executedByAccountId: value }) as never),
    ).rejects.toThrow(PLATFORM_GOVERNANCE_REFUSAL.ACTOR_REQUIRED);
  });

  it('I. an actor whose account is not ACTIVE DENIES', async () => {
    tx.account.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === ACTOR ? { status: 'SUSPENDED' } : activeAccount,
    );
    await expect(service.grant(ceremony())).rejects.toThrow(
      PLATFORM_GOVERNANCE_REFUSAL.ACTOR_INACTIVE,
    );
  });

  // ── J — self-grant is not a shortcut past the ceremony ──────────────────

  it('J. an Account granting ITSELF still requires the Owner ceremony', async () => {
    await expect(
      service.grant(
        ceremony({
          executedByAccountId: HOLDER,
          ownerAuthorizationReference: '',
        }),
      ),
    ).rejects.toThrow(PLATFORM_GOVERNANCE_REFUSAL.OWNER_AUTHORIZATION_REQUIRED);
  });

  it('J. holding an authority is never consulted when granting one', async () => {
    // OWNER LAW 7: holding a platform authority confers NO power to grant one.
    // The write path must never read the actor's own holdings.
    await service.grant(ceremony({ executedByAccountId: HOLDER }));
    const subjectsRead = tx.platformGovernanceDecision.findFirst.mock.calls.map(
      (c: any[]) => c[0].where.holderAccountId,
    );
    // The ONLY lineage read is the SUBJECT's, to compute the next generation.
    expect(new Set(subjectsRead)).toEqual(new Set([HOLDER]));
    expect(tx.platformGovernanceDecision.findFirst).toHaveBeenCalledTimes(1);
  });

  // ── R / S — replay versus a different command wearing a used name ───────

  it('R. an exact replay returns the SAME generation and writes nothing', async () => {
    const first: any = await service.grant(ceremony());
    tx.platformGovernanceDecision.create.mockClear();
    tx.platformGovernanceDecision.findUnique.mockResolvedValue({
      ...first,
      commandFingerprint: first.commandFingerprint,
    });

    const replay: any = await service.grant(ceremony());
    expect(replay.generation).toBe(first.generation);
    expect(tx.platformGovernanceDecision.create).not.toHaveBeenCalled();
  });

  it('S. the same idempotency key carrying a DIFFERENT command is refused', async () => {
    const first: any = await service.grant(ceremony());
    tx.platformGovernanceDecision.findUnique.mockResolvedValue(first);

    await expect(
      // Same key, different holder — a different command wearing a used name.
      service.grant(ceremony({ holderAccountId: ACTOR })),
    ).rejects.toThrow(PLATFORM_GOVERNANCE_REFUSAL.COMMAND_FINGERPRINT_CONFLICT);
  });

  it('S. every element of the command is inside its fingerprint', async () => {
    const base: any = await service.grant(ceremony());
    const differing = [
      { holderAccountId: ACTOR },
      { authorityCode: PLATFORM_GOVERNANCE_AUTHORITIES.ADMIT },
      { executedByAccountId: HOLDER },
      { ownerAuthorizationReference: 'OWNER-AUTH-2026-0002' },
      { reason: 'a different reason' },
    ];
    for (const change of differing) {
      tx.platformGovernanceDecision.create.mockClear();
      const next: any = await service.grant(
        ceremony({ ...change, idempotencyKey: `k-${JSON.stringify(change)}` }),
      );
      expect(next.commandFingerprint).not.toBe(base.commandFingerprint);
    }
    // And the decision verb itself distinguishes GRANT from REVOKE.
    tx.platformGovernanceDecision.findFirst.mockResolvedValue({
      id: 'd', generation: 1, decision: 'GRANT',
    });
    const revoked: any = await service.revoke(ceremony({ idempotencyKey: 'rev' }));
    expect(revoked.commandFingerprint).not.toBe(base.commandFingerprint);
  });

  // ── the transition must mean something ──────────────────────────────────

  it('refuses a GRANT that would not change the state', async () => {
    tx.platformGovernanceDecision.findFirst.mockResolvedValue({
      id: 'd1', generation: 1, decision: 'GRANT',
    });
    await expect(
      service.grant(ceremony({ idempotencyKey: 'again' })),
    ).rejects.toThrow(
      PLATFORM_GOVERNANCE_REFUSAL.DECISION_WOULD_NOT_CHANGE_STATE,
    );
  });

  it('refuses a REVOKE of an authority that is not held', async () => {
    tx.platformGovernanceDecision.findFirst.mockResolvedValue(null);
    await expect(
      service.revoke(ceremony({ idempotencyKey: 'nothing-to-revoke' })),
    ).rejects.toThrow(
      PLATFORM_GOVERNANCE_REFUSAL.DECISION_WOULD_NOT_CHANGE_STATE,
    );
  });

  // ── THE STATE GATE AS A REPLAY BOUNDARY ─────────────────────────────────
  //
  // The window: the replay read and the state read take DIFFERENT snapshots
  // under READ COMMITTED, so a winner committing between them made a legitimate
  // replay look like a state-invalid transition and earned it a refusal.
  //
  // These model the interleaving deliberately, by SEQUENCING the two reads with
  // mockResolvedValueOnce. A mock that answers both reads with one fixed value
  // is structurally incapable of expressing this race — which is exactly why the
  // suite could not see it before.

  const midFlightWinner = (commandFingerprint: string) => ({
    id: 'winner',
    generation: 1,
    decision: 'GRANT',
    commandFingerprint,
  });

  it('a replay whose winner commits mid-transaction returns the winner row', async () => {
    const winner = midFlightWinner(
      (service as any).fingerprint(ceremony({ idempotencyKey: 'mid' }), 'GRANT'),
    );
    // Read 1 (replay): the winner has not committed yet.
    // Read 2 (state gate): it has.
    tx.platformGovernanceDecision.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);
    // ...so the state read sees a GRANT and the transition looks like a no-op.
    tx.platformGovernanceDecision.findFirst.mockResolvedValue(winner);

    const settled: any = await service.grant(ceremony({ idempotencyKey: 'mid' }));

    // THE CONTRACT: the winner's authoritative result, at the winner's
    // generation — NOT DECISION_WOULD_NOT_CHANGE_STATE.
    expect(settled.id).toBe('winner');
    expect(settled.generation).toBe(1);
    // And the replay was ANSWERED, not repeated.
    expect(tx.platformGovernanceDecision.create).not.toHaveBeenCalled();
  });

  it('a DIFFERENT command reaching the state gate is refused, never answered', async () => {
    tx.platformGovernanceDecision.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(midFlightWinner('an-entirely-different-command'));
    tx.platformGovernanceDecision.findFirst.mockResolvedValue(
      midFlightWinner('an-entirely-different-command'),
    );

    await expect(
      service.grant(ceremony({ idempotencyKey: 'mid-conflict' })),
    ).rejects.toThrow(
      PLATFORM_GOVERNANCE_REFUSAL.COMMAND_FINGERPRINT_CONFLICT,
    );
    expect(tx.platformGovernanceDecision.create).not.toHaveBeenCalled();
  });

  it('a genuinely state-invalid transition keeps its original refusal', async () => {
    // CASE E, unchanged: nothing landed under THIS key, so the gate is not a
    // replay boundary here — it is the state gate doing its original job.
    tx.platformGovernanceDecision.findUnique.mockResolvedValue(null);
    tx.platformGovernanceDecision.findFirst.mockResolvedValue(
      midFlightWinner('someone-elses-command'),
    );

    await expect(
      service.grant(ceremony({ idempotencyKey: 'genuinely-invalid' })),
    ).rejects.toThrow(
      PLATFORM_GOVERNANCE_REFUSAL.DECISION_WOULD_NOT_CHANGE_STATE,
    );
  });

  // ── P / Q — the race, resolved without overwriting ──────────────────────

  const raceError = () =>
    new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['holderAccountId', 'authorityId', 'generation'] },
    });

  it('P. a lost generation race whose command already landed resolves idempotently', async () => {
    tx.platformGovernanceDecision.create.mockRejectedValue(raceError());
    prisma.platformGovernanceDecision.findUnique.mockResolvedValue({
      id: 'winner',
      generation: 1,
      commandFingerprint: (await (service as any).fingerprint(ceremony(), 'GRANT')),
    });

    const settled: any = await service.grant(ceremony());
    expect(settled.id).toBe('winner');
  });

  it('Q. a lost race to a DIFFERENT ceremony returns a conflict, never an overwrite', async () => {
    tx.platformGovernanceDecision.create.mockRejectedValue(raceError());
    prisma.platformGovernanceDecision.findUnique.mockResolvedValue(null);

    await expect(service.grant(ceremony())).rejects.toThrow(
      PLATFORM_GOVERNANCE_REFUSAL.GENERATION_CONTENDED,
    );
  });

  // ── THE CONCURRENT REPLAY — a DIFFERENT constraint from the race above ───
  //
  // `idempotencyKey` is globally unique ON ITS OWN, so a same-key submission
  // that races past the in-transaction replay read is stopped by THAT index,
  // never the generation one. This suite previously asserted the opposite — that
  // such a violation escapes as a raw driver error — which encoded the defect as
  // if it were the contract. It is not: a known condition must reach a known
  // outcome.

  const replayError = () =>
    new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['idempotencyKey'] },
    });

  it('a concurrent replay of the SAME command resolves to the winner row', async () => {
    tx.platformGovernanceDecision.create.mockRejectedValue(replayError());
    prisma.platformGovernanceDecision.findUnique.mockResolvedValue({
      id: 'winner',
      generation: 1,
      commandFingerprint: (service as any).fingerprint(ceremony(), 'GRANT'),
    });

    const settled: any = await service.grant(ceremony());
    expect(settled.id).toBe('winner');
    expect(settled.generation).toBe(1);
  });

  it('a concurrent replay carrying a DIFFERENT command is refused BY NAME', async () => {
    // The second command must never be handed the first one's result.
    tx.platformGovernanceDecision.create.mockRejectedValue(replayError());
    prisma.platformGovernanceDecision.findUnique.mockResolvedValue({
      id: 'winner',
      generation: 1,
      commandFingerprint: 'a-different-command-entirely',
    });

    await expect(service.grant(ceremony())).rejects.toThrow(
      PLATFORM_GOVERNANCE_REFUSAL.COMMAND_FINGERPRINT_CONFLICT,
    );
  });

  it('a concurrent replay whose row is unreadable refuses rather than inventing one', async () => {
    tx.platformGovernanceDecision.create.mockRejectedValue(replayError());
    prisma.platformGovernanceDecision.findUnique.mockResolvedValue(null);

    await expect(service.grant(ceremony())).rejects.toThrow(
      PLATFORM_GOVERNANCE_REFUSAL.GENERATION_CONTENDED,
    );
  });

  it('an UNRELATED unique violation is still never swallowed', async () => {
    // Neither constraint this service knows about. That is a duplicate the code
    // should never have attempted — a defect, not contention — so it surfaces as
    // itself rather than being reported as a replay that resolved.
    tx.platformGovernanceDecision.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['someUnrelatedColumn'] },
      }),
    );
    await expect(service.grant(ceremony())).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
  });

  it('a composite constraint that merely CONTAINS idempotencyKey is not a replay', async () => {
    // The predicate is narrow on purpose: exactly one field. A composite is some
    // other constraint, and guessing at it would be the swallowing this suite
    // exists to forbid.
    tx.platformGovernanceDecision.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['idempotencyKey', 'authorityId'] },
      }),
    );
    await expect(service.grant(ceremony())).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
  });

  // ── U — the highest generation IS the current state ─────────────────────

  it('U. currentState reports the newest generation, held or not', async () => {
    prisma.platformGovernanceDecision.findFirst.mockResolvedValue({
      generation: 3,
      decision: 'REVOKE',
      decidedAt: new Date('2026-09-03T00:00:00.000Z'),
      ownerAuthorizationReference: 'OWNER-AUTH-2026-0003',
      executedByAccountId: ACTOR,
    });
    const state = await service.currentState(HOLDER, PLATFORM_GOVERNANCE_AUTHORITIES.PUBLISH);
    expect(state).toMatchObject({ held: false, generation: 3 });
    // Read newest-first, bounded. Never "load all history".
    expect(prisma.platformGovernanceDecision.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { generation: 'desc' } }),
    );
  });

  it.each([
    ['no lineage at all', null, false],
    ['newest generation is a REVOKE', { generation: 2, decision: 'REVOKE' }, false],
    ['newest generation is a GRANT', { generation: 2, decision: 'GRANT' }, true],
  ])('holds() is fail-closed when %s', async (_l, latest, expected) => {
    prisma.platformGovernanceDecision.findFirst.mockResolvedValue(
      latest ? { ...latest, decidedAt: new Date(), ownerAuthorizationReference: 'r', executedByAccountId: ACTOR } : null,
    );
    expect(await service.holds(HOLDER, PLATFORM_GOVERNANCE_AUTHORITIES.PUBLISH)).toBe(expected);
  });

  it('holds() is false for a PLATFORM authority whose row is missing', async () => {
    prisma.authority.findUnique.mockResolvedValue(null);
    expect(
      await service.holds(HOLDER, PLATFORM_GOVERNANCE_AUTHORITIES.WITHDRAW),
    ).toBe(false);
    // Absence is never authority: it does not even look at the lineage.
    expect(prisma.platformGovernanceDecision.findFirst).not.toHaveBeenCalled();
  });

  // ── the vocabulary gate, on the READ side ────────────────────────────────

  it.each([
    ['a PROJECT decision authority', 'FIELD_PROGRESS_VERIFY'],
    ['a Permission code', 'AUTHORITY_MANAGE'],
    ['a Role code', 'DIRECTOR'],
    ['a Role code', 'SUPER_ADMIN'],
    ['an invented generic code', 'PLATFORM_KNOWLEDGE_MANAGE'],
    ['a code SIMPROK has never heard of', 'NO_SUCH_CODE'],
  ])('holds() refuses %s (%s) without even reading the database', async (_l, code) => {
    // FIELD_PROGRESS_VERIFY is a REAL Authority — and a project one, held
    // through a workspace Position. Answering "yes" here would carry a project
    // power across the platform boundary. AUTHORITY_MANAGE and DIRECTOR are not
    // Authorities at all; they belong to other vocabularies.
    expect(await service.holds(HOLDER, code)).toBe(false);
    expect(await service.currentState(HOLDER, code)).toBeNull();
    expect(await service.history(HOLDER, code)).toEqual([]);
    expect(prisma.authority.findUnique).not.toHaveBeenCalled();
    expect(prisma.platformGovernanceDecision.findFirst).not.toHaveBeenCalled();
  });

  it('holds() is false once the holder account stops being ACTIVE', async () => {
    prisma.platformGovernanceDecision.findFirst.mockResolvedValue({
      generation: 1, decision: 'GRANT', decidedAt: new Date(),
      ownerAuthorizationReference: 'r', executedByAccountId: ACTOR,
    });
    prisma.account.findUnique.mockResolvedValue({ status: 'DEACTIVATED' });
    expect(await service.holds(HOLDER, PLATFORM_GOVERNANCE_AUTHORITIES.PUBLISH)).toBe(false);
  });
});

// ── the Owner-locked authority vocabulary ─────────────────────────────────

describe('Platform governance authority vocabulary', () => {
  const SEED = readFileSync(
    join(__dirname, '..', '..', 'prisma', 'seed-acceptance.ts'),
    'utf8',
  );
  /** Comments stripped: a rule about CODE must not be tripped by prose that
   *  explains the rule. Both files below discuss what they deliberately avoid. */
  const codeOnly = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  /** The seeded platform block, comments removed. */
  const seedBlock = () => {
    const start = SEED.indexOf('PLATFORM GOVERNANCE AUTHORITY VOCABULARY');
    const end = SEED.indexOf('for (const policy of [', start);
    return codeOnly(SEED.slice(start, end));
  };

  it('A/B/C. is exactly three distinct codes, and they are the Owner-locked ones', () => {
    expect(PLATFORM_GOVERNANCE_AUTHORITIES).toEqual({
      ADMIT: 'PLATFORM_KNOWLEDGE_ADMIT',
      PUBLISH: 'PLATFORM_KNOWLEDGE_PUBLISH',
      WITHDRAW: 'PLATFORM_KNOWLEDGE_WITHDRAW',
    });
    const codes = Object.values(PLATFORM_GOVERNANCE_AUTHORITIES);
    expect(codes).toHaveLength(3);
    expect(new Set(codes).size).toBe(3);
  });

  it('J. there is no generic PLATFORM_KNOWLEDGE_MANAGE anywhere', () => {
    // The three are separated because their acts and consequences differ. A
    // generic power would silently re-merge them.
    for (const source of [
      readFileSync(join(__dirname, "platform-governance.service.ts"), "utf8"),
      SEED,
    ]) {
      expect(codeOnly(source)).not.toContain("PLATFORM_KNOWLEDGE_MANAGE");
    }
  });

  it('C. all three are seeded, idempotently, on Authority.code', () => {
    for (const code of Object.values(PLATFORM_GOVERNANCE_AUTHORITIES)) {
      expect(SEED).toContain(`code: '${code}'`);
    }
    // Upsert keyed on the globally-unique code — re-seeding cannot duplicate.
    expect(SEED).toContain('where: { code: platformAuthority.code }');
  });

  it('F/G. they are seeded WITHOUT any Position, workspace or role binding', () => {
    // The block above them binds each field-progress authority to a workspace
    // Position. Adding these three there would have given every platform power
    // a workspace seat. This asserts the separation actually happened.
    const block = seedBlock();
    expect(block).toContain('prisma.authority.upsert');
    for (const forbidden of [
      'positionAuthority',
      'positionId',
      'workspaceId',
      'position',
      'role',
      'permission',
      'approvalMatrix',
    ]) {
      expect(block.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('I. the existing Field Progress authorities are untouched', () => {
    // Same file, same vocabulary — and their meanings must not shift.
    for (const code of [
      'FIELD_PROGRESS_VERIFY',
      'FIELD_PROGRESS_CORRECT',
      'FIELD_PROGRESS_ACCEPT',
    ]) {
      expect(SEED).toContain(`code: '${code}'`);
      // Still bound to the progress Position, exactly as before.
      expect(SEED).toContain('positionId: progressAuthorityPosition.id');
    }
    const progress = readFileSync(
      join(__dirname, '..', 'progress', 'progress-authority.service.ts'),
      'utf8',
    );
    expect(progress).toContain("VERIFY: 'FIELD_PROGRESS_VERIFY'");
    expect(progress).toContain("CORRECT: 'FIELD_PROGRESS_CORRECT'");
    expect(progress).toContain("ACCEPT: 'FIELD_PROGRESS_ACCEPT'");
  });

  it('D/E. the three codes are NOT Permissions and NOT Roles', () => {
    // Permission is a different vocabulary with its own canonical catalogue.
    const permissions = readFileSync(
      join(__dirname, '..', 'common', 'constants', 'permissions.ts'),
      'utf8',
    );
    for (const code of Object.values(PLATFORM_GOVERNANCE_AUTHORITIES)) {
      expect(permissions).not.toContain(code);
      // And not seeded as a Role either: no Role row carries these codes.
      expect(SEED).not.toContain(`code: '${code}', name: 'Role`);
    }
    // The seed writes them through the AUTHORITY writer, never the permission
    // or role writer.
    const block = seedBlock();
    expect(block).not.toContain('prisma.permission.');
    expect(block).not.toContain('prisma.role.');
  });

  it('K. seeding the vocabulary grants nobody anything', () => {
    const block = seedBlock();
    // No PlatformGovernanceDecision is written by the seed — a code existing is
    // not a person holding it. The only way to hold one is the ceremony.
    expect(block).not.toContain('platformGovernanceDecision');
    expect(SEED).not.toContain('platformGovernanceDecision');
  });
});

// ── the boundary, read from the source itself ─────────────────────────────

describe('Platform governance boundary', () => {
  const SRC = join(__dirname, 'platform-governance.service.ts');
  const source = readFileSync(SRC, 'utf8');
  /** Comments stripped: a rule about DEPENDENCIES must not be tripped by prose. */
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  it.each([
    ['Workspace RBAC — Role', /\brole\b/i],
    ['Workspace RBAC — Permission', /\bpermission\b/i],
    ['Workspace RBAC — RolePermission', /rolePermission/],
    ['membership', /membership/i],
    ['workspace', /workspace/i],
    ['Position', /\bposition\b/i],
    ['PositionAssignment', /positionAssignment/],
    ['PositionAuthority', /positionAuthority/],
    ['Project Authority', /project/i],
    ['AuthorityService', /AuthorityService/],
    ['ProgressAuthorityService', /ProgressAuthorityService/],
  ])('K–O. platform governance never touches %s', (_label, pattern) => {
    // These are Owner-locked separations. Behaviour alone could only show that
    // the service does not CURRENTLY consult them; reading the source shows it
    // cannot, because the identifiers are not there.
    expect(code).not.toMatch(pattern);
  });

  it('Z. no workspace is required anywhere to establish platform authority', () => {
    expect(code).not.toContain('workspaceId');
    // And NULL is never used as an identity. It appears only as the honest
    // "there was no previous generation" and "no reason was given".
    const nulls = [...code.matchAll(/null/g)].length;
    expect(nulls).toBeGreaterThan(0);
    expect(code).not.toMatch(/workspaceId:\s*null/);
  });

  it('Y. holder, actor and Owner authorization are three separate inputs', () => {
    expect(code).toContain('holderAccountId');
    expect(code).toContain('executedByAccountId');
    expect(code).toContain('ownerAuthorizationReference');
    // Never assigned from one another — no field is overloaded.
    expect(code).not.toMatch(/executedByAccountId:\s*ceremony\.holderAccountId/);
    expect(code).not.toMatch(/holderAccountId:\s*ceremony\.executedByAccountId/);
  });

  it('the Owner authorization is required, persisted, and NOT claimed as verified', () => {
    expect(code).toContain('OWNER_AUTHORIZATION_REQUIRED');
    expect(code).toContain('ownerAuthorizationReference: authorizationReference');
    // No signature, key registry or verification machinery — by Owner decision.
    for (const forbidden of ['verifySignature', 'createVerify', 'publicKey', 'jwt.verify', 'KeyObject']) {
      expect(code).not.toContain(forbidden);
    }
    // And the source says so in its own words, so a reader cannot infer otherwise.
    expect(source).toContain('NOT MACHINE-VERIFIED');
  });

  it('history is append-only: the service never updates or deletes a decision', () => {
    expect(code).not.toMatch(/platformGovernanceDecision\.(update|updateMany|delete|deleteMany|upsert)/);
    expect(code).toContain('platformGovernanceDecision.create');
  });

  it('no second Authority vocabulary is created — Authority is only read', () => {
    expect(code).not.toMatch(/authority\.(create|createMany|update|upsert|delete)/);
    expect(code).toContain('authority.findUnique');
  });

  it('the source is clean text — no stray control bytes', () => {
    // CEREMONY INTEGRATION AUDIT — this caught a real defect. The fingerprint
    // separator READ as `.join(' ')` and the byte on disk was a literal NUL, so
    // `file` reported the service as `data` rather than source and grep treated
    // it as binary. Every one of the 58 tests passed anyway, because NUL is a
    // perfectly deterministic separator — which is exactly why behaviour alone
    // could never have found it.
    //
    // A governance record whose fingerprint is computed from bytes the source
    // does not show is not auditable, whatever it computes.
    for (const file of [
      'platform-governance.service.ts',
      'platform-governance.service.spec.ts',
      'platform-governance.module.ts',
    ]) {
      const bytes = readFileSync(join(__dirname, file));
      const offenders = [...bytes].filter(
        (b) => b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d,
      );
      expect({ file, controlBytes: offenders.length }).toEqual({
        file,
        controlBytes: 0,
      });
    }
  });

  it('exposes no HTTP surface', () => {
    const module = readFileSync(
      join(__dirname, 'platform-governance.module.ts'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(module).not.toContain('controllers');
    expect(code).not.toMatch(/@(Get|Post|Patch|Put|Delete|Controller)\(/);
  });
});
