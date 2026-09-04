// AUTHORITY GOVERNANCE PROVENANCE — AGAINST REAL POSTGRESQL.
//
// Two carriers, one transaction:
//   authority_governance_decisions  IMMUTABLE HISTORY  (append-only lineage)
//   position_authorities            CURRENT STATE      (the resolver's only input)
//
// Concurrency here is decided by the database, not by a mock. Every race below
// runs real overlapping transactions against real Postgres and asserts the
// settled truth afterwards.

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import {
  AUTHORITY_GOVERNANCE_REFUSAL,
  AuthorityGovernanceService,
} from '../../src/authority-governance/authority-governance.service';

const FORBIDDEN_PRODUCTION_DATABASE = 'simprok_db';
const EXPECTED_DATABASE = 'simprok_e2e';

const tag = `AG-${Date.now()}`;
const AUTHORITY_CODE = `${tag}_GOVERNED_POWER`;

describe('Authority governance provenance — Position holder, Owner ceremony (e2e)', () => {
  const db = new PrismaClient();
  let moduleRef: TestingModule | undefined;
  let governance: AuthorityGovernanceService;

  let positionId: string;
  let actorAccountId: string;
  let inactiveActorAccountId: string;
  let authorityId: string;
  const accountIds: string[] = [];

  const ceremony = (over: Record<string, unknown> = {}) => ({
    positionId,
    authorityCode: AUTHORITY_CODE,
    executedByAccountId: actorAccountId,
    ownerAuthorizationReference: `${tag}-OWNER-AUTH-0001`,
    reason: 'e2e governed ceremony',
    idempotencyKey: `${tag}-key-1`,
    ...over,
  });

  const currentState = () =>
    db.positionAuthority.findUnique({
      where: { positionId_authorityId: { positionId, authorityId } },
    });

  const lineage = () =>
    db.authorityGovernanceDecision.findMany({
      where: { positionId, authorityId },
      orderBy: { generation: 'asc' },
    });

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? '';
    if (url.includes(`/${FORBIDDEN_PRODUCTION_DATABASE}`)) {
      throw new Error(
        `REFUSING: DATABASE_URL targets ${FORBIDDEN_PRODUCTION_DATABASE}`,
      );
    }
    const row = await db.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    if (row[0]?.current_database !== EXPECTED_DATABASE) {
      throw new Error(
        `REFUSING: expected ${EXPECTED_DATABASE}, got ${row[0]?.current_database}`,
      );
    }

    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [AuthorityGovernanceService],
    }).compile();
    governance = moduleRef.get(AuthorityGovernanceService);

    // A seeded Position tells us which workspace to build in — we never guess a
    // tenant id and never touch the seeded Position itself.
    const seeded = await db.position.findFirstOrThrow({
      where: { code: 'FIELD_PROGRESS_AUTHORITY' },
      select: { workspaceId: true },
    });

    const position = await db.position.create({
      data: {
        workspaceId: seeded.workspaceId,
        code: `${tag}_SEAT`,
        name: 'Authority governance e2e seat',
      },
    });
    positionId = position.id;

    // A NEUTRAL authority: not a field-progress code, not a platform code. The
    // ceremony must work for any canonical Authority — that is the reusability
    // this capability exists for.
    const authority = await db.authority.create({
      data: { code: AUTHORITY_CODE, name: 'Authority governance e2e power' },
    });
    authorityId = authority.id;

    const actor = await db.account.create({
      data: {
        email: `${tag}-actor@simprok.test`,
        passwordHash: 'x',
        displayName: 'AG actor',
        status: 'ACTIVE',
      },
    });
    actorAccountId = actor.id;
    accountIds.push(actor.id);

    const inactive = await db.account.create({
      data: {
        email: `${tag}-inactive@simprok.test`,
        passwordHash: 'x',
        displayName: 'AG inactive actor',
        status: 'SUSPENDED',
      },
    });
    inactiveActorAccountId = inactive.id;
    accountIds.push(inactive.id);
  }, 120000);

  afterAll(async () => {
    // Deleting the Position cascades both its decisions and its
    // PositionAuthority rows, so the order below leaves no residue.
    await db.position.delete({ where: { id: positionId } }).catch(() => undefined);
    await db.authority.delete({ where: { id: authorityId } }).catch(() => undefined);
    await db.account
      .deleteMany({ where: { id: { in: accountIds } } })
      .catch(() => undefined);
    await db.$disconnect();
    if (moduleRef) await moduleRef.close();
  }, 120000);

  // ── TEST 01 — FIRST GRANT ───────────────────────────────────────────────

  it('01. first GRANT writes generation 1 and activates the current state', async () => {
    const decision: any = await governance.grant(
      ceremony({ idempotencyKey: `${tag}-k1` }),
    );

    expect(decision.generation).toBe(1);
    expect(decision.action).toBe('GRANT');
    expect(decision.previousDecisionId).toBeNull();
    expect(decision.ownerAuthorizationReference).toBe(`${tag}-OWNER-AUTH-0001`);

    const state = await currentState();
    expect(state?.isActive).toBe(true);
    expect(state?.revokedAt).toBeNull();
    expect(await lineage()).toHaveLength(1);
  }, 120000);

  // ── TEST 02 — REVOKE ────────────────────────────────────────────────────

  it('02. REVOKE appends generation 2 and leaves generation 1 untouched', async () => {
    const before = (await lineage())[0];

    const decision: any = await governance.revoke(
      ceremony({ idempotencyKey: `${tag}-k2`, reason: 'stood down' }),
    );

    expect(decision.generation).toBe(2);
    expect(decision.action).toBe('REVOKE');
    expect(decision.previousDecisionId).toBe(before.id);

    const state = await currentState();
    expect(state?.isActive).toBe(false);
    expect(state?.revokedAt).not.toBeNull();

    // The grant was not edited, not deleted, not turned into a revoke.
    const first = (await lineage())[0];
    expect(first.id).toBe(before.id);
    expect(first.action).toBe('GRANT');
    expect(first.decidedAt).toEqual(before.decidedAt);
  }, 120000);

  // ── TEST 03 — RE-GRANT ──────────────────────────────────────────────────

  it('03. GRANT after REVOKE appends generation 3 — the history stays whole', async () => {
    const decision: any = await governance.grant(
      ceremony({ idempotencyKey: `${tag}-k3`, reason: 'restored' }),
    );

    expect(decision.generation).toBe(3);
    expect(decision.action).toBe('GRANT');

    const state = await currentState();
    expect(state?.isActive).toBe(true);
    expect(state?.revokedAt).toBeNull();

    // GRANT -> REVOKE -> GRANT, deterministically reconstructible.
    const rows = await lineage();
    expect(rows.map((r) => `${r.generation}:${r.action}`)).toEqual([
      '1:GRANT',
      '2:REVOKE',
      '3:GRANT',
    ]);
    expect(rows[1].previousDecisionId).toBe(rows[0].id);
    expect(rows[2].previousDecisionId).toBe(rows[1].id);
  }, 120000);

  // ── TEST 04 — REPLAY ────────────────────────────────────────────────────

  it('04. the SAME key and command replays — one ceremony, one transition', async () => {
    const command = ceremony({ idempotencyKey: `${tag}-k4`, reason: 'replayed' });
    await governance.revoke(command); // generation 4

    const before = await lineage();
    const again: any = await governance.revoke(command);

    expect(again.generation).toBe(4);
    expect(await lineage()).toHaveLength(before.length);
    const state = await currentState();
    expect(state?.isActive).toBe(false);
  }, 120000);

  // ── TEST 05 — SAME KEY, DIFFERENT COMMAND ───────────────────────────────

  it('05. the SAME key carrying a DIFFERENT command is refused, state untouched', async () => {
    const before = await lineage();
    const stateBefore = await currentState();

    await expect(
      governance.grant(
        ceremony({ idempotencyKey: `${tag}-k4`, reason: 'a different command' }),
      ),
    ).rejects.toThrow(AUTHORITY_GOVERNANCE_REFUSAL.COMMAND_FINGERPRINT_CONFLICT);

    expect(await lineage()).toHaveLength(before.length);
    const stateAfter = await currentState();
    expect(stateAfter?.isActive).toBe(stateBefore?.isActive);
  }, 120000);

  // ── TEST 06 — ROLLBACK / NO HALF-WRITES ─────────────────────────────────

  it('06a. a refused ceremony writes NEITHER provenance NOR current state', async () => {
    const before = await lineage();
    const stateBefore = await currentState();

    await expect(
      governance.grant(
        ceremony({
          idempotencyKey: `${tag}-k6`,
          authorityCode: `${tag}_NO_SUCH_POWER`,
        }),
      ),
    ).rejects.toThrow(AUTHORITY_GOVERNANCE_REFUSAL.AUTHORITY_NOT_FOUND);

    expect(await lineage()).toHaveLength(before.length);
    expect((await currentState())?.isActive).toBe(stateBefore?.isActive);
    // And nothing landed under that key at all.
    expect(
      await db.authorityGovernanceDecision.findUnique({
        where: { idempotencyKey: `${tag}-k6` },
      }),
    ).toBeNull();
  }, 120000);

  it('06b. every provenance generation agrees with the current state it produced', async () => {
    // THE CONSISTENCY INVARIANT, checked against the real rows: the latest
    // governance act and the current-state row must never disagree. This is what
    // "no state without provenance, no provenance without state" means once the
    // lineage is several generations long.
    const rows = await lineage();
    const latest = rows[rows.length - 1];
    const state = await currentState();

    expect(state).not.toBeNull();
    expect(state?.isActive).toBe(latest.action === 'GRANT');
    if (latest.action === 'GRANT') {
      expect(state?.revokedAt).toBeNull();
    } else {
      expect(state?.revokedAt).not.toBeNull();
    }
    // Generations are contiguous from 1 — no gap, so no rolled-back write left
    // a hole in the lineage.
    expect(rows.map((r) => r.generation)).toEqual(
      rows.map((_, index) => index + 1),
    );
  }, 120000);

  // ── TEST 07 — CONCURRENT DIFFERENT KEYS, SAME TRANSITION ────────────────

  it('07. concurrent GRANTs with DIFFERENT keys settle to one transition', async () => {
    // Precondition, asserted rather than assumed: tests 04-06 leave the seat
    // REVOKED, so a GRANT here is a real transition. No reset ceremony is
    // performed — issuing one would itself be refused, correctly, as a no-op.
    expect((await currentState())?.isActive).toBe(false);
    const before = (await lineage()).length;

    const settled = await Promise.allSettled(
      [1, 2, 3, 4].map((n) =>
        governance.grant(
          ceremony({ idempotencyKey: `${tag}-k7-${n}`, reason: `race ${n}` }),
        ),
      ),
    );

    const winners = settled.filter((s) => s.status === 'fulfilled');
    const losers = settled.filter(
      (s): s is PromiseRejectedResult => s.status === 'rejected',
    );
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(3);

    for (const loser of losers) {
      const message = String(loser.reason?.message ?? loser.reason);
      // No raw driver error is ever the semantic outcome.
      expect(message).not.toMatch(/PrismaClientKnownRequestError|P2002/i);
      expect(message).toMatch(
        new RegExp(
          `${AUTHORITY_GOVERNANCE_REFUSAL.GENERATION_CONTENDED}|${AUTHORITY_GOVERNANCE_REFUSAL.DECISION_WOULD_NOT_CHANGE_STATE}`,
        ),
      );
    }

    // Exactly one new generation, and the state agrees with it.
    expect((await lineage()).length).toBe(before + 1);
    expect((await currentState())?.isActive).toBe(true);
  }, 300000);

  // ── TEST 08 — CONCURRENT SAME KEY, SAME COMMAND ─────────────────────────

  it('08. concurrent submissions of the SAME command all resolve to one row', async () => {
    const command = ceremony({
      idempotencyKey: `${tag}-k8`,
      reason: 'concurrent replay',
    });
    const before = (await lineage()).length;

    const settled = await Promise.allSettled(
      [1, 2, 3, 4, 5, 6].map(() => governance.revoke(command)),
    );

    const rejected = settled.filter(
      (s): s is PromiseRejectedResult => s.status === 'rejected',
    );
    expect(rejected.map((r) => String(r.reason?.message ?? r.reason))).toEqual([]);

    const results = settled
      .filter((s): s is PromiseFulfilledResult<any> => s.status === 'fulfilled')
      .map((s) => s.value);
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(new Set(results.map((r) => r.generation)).size).toBe(1);

    expect((await lineage()).length).toBe(before + 1);
    expect(
      await db.authorityGovernanceDecision.count({
        where: { idempotencyKey: `${tag}-k8` },
      }),
    ).toBe(1);
  }, 300000);

  // ── TEST 09 — CONCURRENT SAME KEY, DIFFERENT COMMANDS ───────────────────

  it('09. concurrent submissions sharing a key but not a command: one wins', async () => {
    const key = `${tag}-k9`;
    const before = (await lineage()).length;

    const settled = await Promise.allSettled(
      ['reason A', 'reason B', 'reason C', 'reason D'].map((reason) =>
        governance.grant(ceremony({ idempotencyKey: key, reason })),
      ),
    );

    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
    for (const loser of settled.filter(
      (s): s is PromiseRejectedResult => s.status === 'rejected',
    )) {
      const message = String(loser.reason?.message ?? loser.reason);
      expect(message).not.toMatch(/PrismaClientKnownRequestError|P2002/i);
      expect(message).toMatch(
        new RegExp(
          `${AUTHORITY_GOVERNANCE_REFUSAL.COMMAND_FINGERPRINT_CONFLICT}|${AUTHORITY_GOVERNANCE_REFUSAL.GENERATION_CONTENDED}`,
        ),
      );
    }

    expect((await lineage()).length).toBe(before + 1);
    expect(
      await db.authorityGovernanceDecision.count({ where: { idempotencyKey: key } }),
    ).toBe(1);
  }, 300000);

  // ── TEST 10 / 11 — GRANT / REVOKE RACES ─────────────────────────────────

  it('10/11. GRANT and REVOKE racing settle deterministically, never split-brain', async () => {
    for (const order of [
      ['grant', 'revoke'],
      ['revoke', 'grant'],
    ] as const) {
      const before = (await lineage()).length;
      const settled = await Promise.allSettled(
        order.map((verb, index) =>
          verb === 'grant'
            ? governance.grant(
                ceremony({ idempotencyKey: `${tag}-k10-${order[0]}-g${index}` }),
              )
            : governance.revoke(
                ceremony({ idempotencyKey: `${tag}-k10-${order[0]}-r${index}` }),
              ),
        ),
      );

      for (const loser of settled.filter(
        (s): s is PromiseRejectedResult => s.status === 'rejected',
      )) {
        expect(
          String(loser.reason?.message ?? loser.reason),
        ).not.toMatch(/PrismaClientKnownRequestError|P2002/i);
      }

      // Whatever the serialization, the current state MUST equal the latest
      // committed governance act. That is the no-split-brain guarantee.
      const rows = await lineage();
      const latest = rows[rows.length - 1];
      const state = await currentState();
      expect(state?.isActive).toBe(latest.action === 'GRANT');
      expect(rows.length).toBeGreaterThanOrEqual(before);
      expect(rows.map((r) => r.generation)).toEqual(
        rows.map((_, index) => index + 1),
      );
    }
  }, 300000);

  // ── TEST 12 — HISTORY IMMUTABILITY ──────────────────────────────────────

  it('12. the canonical boundary can never rewrite history', async () => {
    const rows = await lineage();
    const first = rows[0];

    // The service exposes no update or delete of a decision at all: the only
    // write it performs is an append. Proven from its own source.
    const source = require('fs').readFileSync(
      require('path').join(
        __dirname,
        '..',
        '..',
        'src',
        'authority-governance',
        'authority-governance.service.ts',
      ),
      'utf8',
    );
    expect(source).not.toMatch(
      /authorityGovernanceDecision\.(update|updateMany|delete|deleteMany|upsert)/,
    );

    // And generation 1 is still exactly what it was.
    const unchanged = await db.authorityGovernanceDecision.findUnique({
      where: { id: first.id },
    });
    expect(unchanged?.action).toBe(first.action);
    expect(unchanged?.generation).toBe(1);
    expect(unchanged?.decidedAt).toEqual(first.decidedAt);
  }, 120000);

  // ── TEST 13 — THE EXISTING DB CHECK IS INTACT ───────────────────────────

  it('13. the database still refuses an impossible current state', async () => {
    await expect(
      db.$executeRawUnsafe(
        `UPDATE "position_authorities" SET "isActive" = TRUE, "revokedAt" = NOW()
           WHERE "positionId" = $1::uuid AND "authorityId" = $2::uuid`,
        positionId,
        authorityId,
      ),
    ).rejects.toThrow();

    await expect(
      db.$executeRawUnsafe(
        `UPDATE "position_authorities" SET "isActive" = FALSE, "revokedAt" = NULL
           WHERE "positionId" = $1::uuid AND "authorityId" = $2::uuid`,
        positionId,
        authorityId,
      ),
    ).rejects.toThrow();
  }, 120000);

  // ── GOVERNANCE LAW ──────────────────────────────────────────────────────

  it('G1. a ceremony with no Owner authorization writes nothing at all', async () => {
    const before = (await lineage()).length;
    await expect(
      governance.grant(
        ceremony({
          idempotencyKey: `${tag}-kG1`,
          ownerAuthorizationReference: '   ',
        }),
      ),
    ).rejects.toThrow(
      AUTHORITY_GOVERNANCE_REFUSAL.OWNER_AUTHORIZATION_REQUIRED,
    );
    expect((await lineage()).length).toBe(before);
  }, 120000);

  it('G2. an inactive actor cannot execute a ceremony', async () => {
    const before = (await lineage()).length;
    await expect(
      governance.grant(
        ceremony({
          idempotencyKey: `${tag}-kG2`,
          executedByAccountId: inactiveActorAccountId,
        }),
      ),
    ).rejects.toThrow(AUTHORITY_GOVERNANCE_REFUSAL.ACTOR_INACTIVE);
    expect((await lineage()).length).toBe(before);
  }, 120000);

  it('G3. granting confers nothing on the actor — only on the seat', async () => {
    // The actor Account holds no PositionAuthority of its own, and the service
    // has no path that would give it one. Authority belongs to the Position.
    const rows = await lineage();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.executedByAccountId).toBe(actorAccountId);
      expect(row.positionId).toBe(positionId);
    }
    // Exactly one current-state row exists for this pair — never one per act.
    expect(
      await db.positionAuthority.count({ where: { positionId, authorityId } }),
    ).toBe(1);
  }, 120000);
});
