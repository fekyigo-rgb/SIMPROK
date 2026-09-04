// PLATFORM GOVERNANCE — the facts that only a real database can prove.
//
// The unit suite proves every refusal and the boundary. These are the four
// things a mock cannot honestly show:
//
//   · that a person with NO WORKSPACE AT ALL can hold a platform authority —
//     the whole point of the Owner's Account-holder decision;
//   · that the generation lineage really is append-only and that earlier
//     generations are byte-identical after later ones are written;
//   · that two concurrent ceremonies cannot both create the same generation,
//     because the DATABASE forbids it rather than the application hoping so;
//   · that the highest generation really is the current truth after a full
//     grant -> revoke -> re-grant cycle.
//
// HARD GUARD: refuses to run unless connected to simprok_e2e, never the
// forbidden production database. Cleans up every row it creates.

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import {
  PLATFORM_GOVERNANCE_AUTHORITIES,
  PLATFORM_GOVERNANCE_REFUSAL,
  PlatformGovernanceService,
} from '../../src/platform-governance/platform-governance.service';
import {
  CEREMONY_CONFIRMATION,
  CEREMONY_REFUSAL,
  performCeremony,
} from '../../src/platform-governance/platform-governance-ceremony';

const FORBIDDEN_PRODUCTION_DATABASE = 'simprok_db';
const EXPECTED_DATABASE = 'simprok_e2e';

const tag = `PG-${Date.now()}`;
/**
 * A REAL, SEEDED, Owner-locked platform authority — no longer a fixture.
 *
 * The earlier version of this suite created a throwaway Authority because the
 * vocabulary was undecided. It is decided now, so the suite exercises the actual
 * seeded code: that is what proves the seeded vocabulary is usable by the
 * ceremony, rather than proving that some invented code would have been.
 *
 * The row therefore belongs to the SEED, not to this suite, and is never
 * deleted here — the residual check would rightly fail if it were.
 */
const AUTHORITY_CODE = PLATFORM_GOVERNANCE_AUTHORITIES.PUBLISH;

describe('Platform governance — Account holder, Owner ceremony (e2e)', () => {
  const db = new PrismaClient();
  let moduleRef: TestingModule | undefined;
  let governance: PlatformGovernanceService;

  let holderAccountId: string;
  let actorAccountId: string;
  let authorityId: string;
  const accountIds: string[] = [];

  const ceremony = (over: Record<string, unknown> = {}) => ({
    holderAccountId,
    authorityCode: AUTHORITY_CODE,
    executedByAccountId: actorAccountId,
    ownerAuthorizationReference: `${tag}-OWNER-AUTH-0001`,
    reason: 'e2e Owner ceremony',
    idempotencyKey: `${tag}-key-1`,
    ...over,
  });

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? '';
    if (url.includes(`/${FORBIDDEN_PRODUCTION_DATABASE}`)) {
      throw new Error(
        `REFUSING: DATABASE_URL targets ${FORBIDDEN_PRODUCTION_DATABASE}`,
      );
    }
    const row = await db.$queryRawUnsafe<{ current_database: string }[]>(
      'select current_database()',
    );
    if (row[0]?.current_database !== EXPECTED_DATABASE) {
      throw new Error(
        `REFUSING: connected DB is "${row[0]?.current_database}", expected "${EXPECTED_DATABASE}"`,
      );
    }

    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [PlatformGovernanceService],
    }).compile();
    governance = moduleRef.get(PlatformGovernanceService);

    // THE DECISIVE SETUP: two Accounts with NO Organization, NO Workspace, NO
    // WorkspaceMembership and NO User profile. Nothing tenant-shaped exists for
    // them. If a platform authority can be held here, it needs no workspace.
    const holder = await db.account.create({
      data: {
        email: `${tag.toLowerCase()}-holder@platform.local`,
        passwordHash: 'x',
        displayName: `${tag} Holder`,
        status: 'ACTIVE',
      },
    });
    const actor = await db.account.create({
      data: {
        email: `${tag.toLowerCase()}-actor@platform.local`,
        passwordHash: 'x',
        displayName: `${tag} Ceremony Executor`,
        status: 'ACTIVE',
      },
    });
    holderAccountId = holder.id;
    actorAccountId = actor.id;
    accountIds.push(holder.id, actor.id);

    // Read, never created. If the seed did not provide it, this suite must fail
    // loudly rather than manufacture the vocabulary it is meant to be proving.
    const authority = await db.authority.findUniqueOrThrow({
      where: { code: AUTHORITY_CODE },
    });
    authorityId = authority.id;
  }, 120000);

  afterAll(async () => {
    // Only this suite's own decisions. The Authority row is SEED DATA and is
    // deliberately left standing — deleting it would corrupt the baseline the
    // residual check compares against.
    await db.platformGovernanceDecision
      .deleteMany({ where: { holderAccountId: { in: accountIds } } })
      .catch(() => undefined);
    await db.account.deleteMany({ where: { id: { in: accountIds } } }).catch(() => undefined);
    await db.$disconnect();
    if (moduleRef) await moduleRef.close();
  }, 120000);

  // ── A/B/C — the Owner-locked vocabulary, against the real database ──────

  it('A/B/C. all three canonical authorities are seeded, distinct and globally unique', async () => {
    const codes = Object.values(PLATFORM_GOVERNANCE_AUTHORITIES);
    const rows = await db.authority.findMany({ where: { code: { in: codes } } });

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.code).sort()).toEqual([...codes].sort());
    // Three distinct rows, not one row seen three times.
    expect(new Set(rows.map((r) => r.id)).size).toBe(3);
    // Globally unique by construction: one row per code, no duplicates.
    for (const code of codes) {
      expect(await db.authority.count({ where: { code } })).toBe(1);
    }
  }, 120000);

  it('F/G. the three carry NO workspace, position or role binding of any kind', async () => {
    const codes = Object.values(PLATFORM_GOVERNANCE_AUTHORITIES);
    const rows = await db.authority.findMany({
      where: { code: { in: codes } },
      include: { positionAuthorities: true, approvalMatrices: true },
    });
    for (const row of rows) {
      // The field-progress authorities each have a PositionAuthority binding
      // them to a workspace seat. These have none, and that is the isolation.
      expect(row.positionAuthorities).toEqual([]);
      expect(row.approvalMatrices).toEqual([]);
    }
  }, 120000);

  it('I. the Field Progress authorities are untouched and still workspace-bound', async () => {
    const progress = await db.authority.findMany({
      where: { code: { in: ['FIELD_PROGRESS_VERIFY', 'FIELD_PROGRESS_CORRECT', 'FIELD_PROGRESS_ACCEPT'] } },
      include: { positionAuthorities: true },
    });
    expect(progress).toHaveLength(3);
    for (const row of progress) {
      // Still bound to their workspace Position — their meaning did not shift.
      expect(row.positionAuthorities.length).toBeGreaterThan(0);
    }
  }, 120000);

  it('J. no generic PLATFORM_KNOWLEDGE_MANAGE authority was seeded', async () => {
    expect(
      await db.authority.count({ where: { code: 'PLATFORM_KNOWLEDGE_MANAGE' } }),
    ).toBe(0);
  }, 120000);

  it('K. seeding the vocabulary granted nobody anything', async () => {
    const codes = Object.values(PLATFORM_GOVERNANCE_AUTHORITIES);
    const authorities = await db.authority.findMany({
      where: { code: { in: codes } },
      select: { id: true },
    });
    // A code existing is not a person holding it. Before this suite grants
    // anything, no decision exists for any of the three.
    expect(
      await db.platformGovernanceDecision.count({
        where: { authorityId: { in: authorities.map((a) => a.id) } },
      }),
    ).toBe(0);
  }, 120000);

  it('DENIES a real PROJECT authority presented as a platform authority', async () => {
    // FIELD_PROGRESS_VERIFY is a genuine Authority row that genuinely exists in
    // this database — and it is a project power. Binding it to an Account here
    // would carry it across the boundary Owner law puts between the two.
    await expect(
      governance.grant(
        ceremony({
          authorityCode: 'FIELD_PROGRESS_VERIFY',
          idempotencyKey: `${tag}-project-authority`,
        }),
      ),
    ).rejects.toThrow(PLATFORM_GOVERNANCE_REFUSAL.AUTHORITY_NOT_PLATFORM_SCOPED);

    expect(await governance.holds(holderAccountId, 'FIELD_PROGRESS_VERIFY')).toBe(false);
    // Refused on the vocabulary, before the row was even looked up — so the
    // project authority's own lineage is untouched.
    expect(
      await db.platformGovernanceDecision.count({
        where: { authority: { code: 'FIELD_PROGRESS_VERIFY' } },
      }),
    ).toBe(0);
  }, 120000);

  // ── Z — the Owner's decision, proved ────────────────────────────────────

  it('Z. an Account with NO workspace membership can hold a platform authority', async () => {
    // Proven, not assumed: these accounts have no membership rows at all.
    expect(
      await db.workspaceMembership.count({
        where: { accountId: { in: [holderAccountId, actorAccountId] } },
      }),
    ).toBe(0);

    const granted = await governance.grant(ceremony());

    expect(granted.decision).toBe('GRANT');
    expect(granted.generation).toBe(1);
    expect(granted.previousDecisionId).toBeNull();
    expect(await governance.holds(holderAccountId, AUTHORITY_CODE)).toBe(true);
  }, 120000);

  it('X. the Owner authorization reference is persisted, read back from the row', async () => {
    // Read with an INDEPENDENT client, so this is the database's answer and not
    // the service's own return value.
    const row = await db.platformGovernanceDecision.findFirstOrThrow({
      where: { holderAccountId, authorityId, generation: 1 },
    });
    expect(row.ownerAuthorizationReference).toBe(`${tag}-OWNER-AUTH-0001`);
    expect(row.executedByAccountId).toBe(actorAccountId);
    // Holder and actor are DIFFERENT rows here — the separation is real data.
    expect(row.holderAccountId).not.toBe(row.executedByAccountId);
    expect(row.commandFingerprint).toMatch(/^[0-9a-f]{64}$/);
  }, 120000);

  it('R. replaying the exact ceremony returns generation 1 and writes nothing', async () => {
    const before = await db.platformGovernanceDecision.count({ where: { authorityId } });
    const replay = await governance.grant(ceremony());
    expect(replay.generation).toBe(1);
    expect(
      await db.platformGovernanceDecision.count({ where: { authorityId } }),
    ).toBe(before);
  }, 120000);

  // ── B / V / W / C — the full cycle ──────────────────────────────────────

  it('B/V. REVOKE appends generation 2 and leaves generation 1 untouched', async () => {
    const original = await db.platformGovernanceDecision.findFirstOrThrow({
      where: { holderAccountId, authorityId, generation: 1 },
    });

    const revoked = await governance.revoke(
      ceremony({ idempotencyKey: `${tag}-key-2`, reason: 'withdrawn' }),
    );
    expect(revoked.generation).toBe(2);
    expect(revoked.previousDecisionId).toBe(original.id);
    expect(await governance.holds(holderAccountId, AUTHORITY_CODE)).toBe(false);

    // T — HISTORY IS IMMUTABLE. Generation 1 is byte-identical afterwards.
    const afterwards = await db.platformGovernanceDecision.findUniqueOrThrow({
      where: { id: original.id },
    });
    expect(afterwards).toEqual(original);
  }, 120000);

  it('C/W. re-GRANT after revoke appends generation 3 — not a resurrection', async () => {
    const granted = await governance.grant(
      ceremony({ idempotencyKey: `${tag}-key-3`, reason: 'restored' }),
    );
    expect(granted.generation).toBe(3);
    expect(await governance.holds(holderAccountId, AUTHORITY_CODE)).toBe(true);

    // U — the highest generation IS the current truth.
    const state = await governance.currentState(holderAccountId, AUTHORITY_CODE);
    expect(state).toMatchObject({ held: true, generation: 3 });

    // The whole lineage survives, in order, with every ceremony's own reason.
    const history = await governance.history(holderAccountId, AUTHORITY_CODE);
    expect(history.map((h) => [h.generation, h.decision])).toEqual([
      [1, 'GRANT'],
      [2, 'REVOKE'],
      [3, 'GRANT'],
    ]);
    expect(history.map((h) => h.reason)).toEqual([
      'e2e Owner ceremony',
      'withdrawn',
      'restored',
    ]);
  }, 120000);

  // ── P — the race, decided by the database ───────────────────────────────

  it('P. concurrent ceremonies cannot both create the same generation', async () => {
    // Four DIFFERENT ceremonies (different idempotency keys) racing to revoke
    // the authority currently held at generation 3. Exactly one may win.
    const settled = await Promise.allSettled(
      [1, 2, 3, 4].map((n) =>
        governance.revoke(
          ceremony({ idempotencyKey: `${tag}-race-${n}`, reason: `race ${n}` }),
        ),
      ),
    );

    const winners = settled.filter((s) => s.status === 'fulfilled');
    const losers = settled.filter(
      (s): s is PromiseRejectedResult => s.status === 'rejected',
    );
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(3);

    // Every loser is refused with a NAMED conflict — never silently dropped and
    // never allowed to overwrite the winner.
    for (const loser of losers) {
      expect(String(loser.reason?.message ?? loser.reason)).toMatch(
        new RegExp(
          `${PLATFORM_GOVERNANCE_REFUSAL.GENERATION_CONTENDED}|${PLATFORM_GOVERNANCE_REFUSAL.DECISION_WOULD_NOT_CHANGE_STATE}`,
        ),
      );
    }

    // The database holds exactly one generation 4 — duplicate authoritative
    // truth is unrepresentable, not merely avoided.
    expect(
      await db.platformGovernanceDecision.count({
        where: { holderAccountId, authorityId, generation: 4 },
      }),
    ).toBe(1);
    expect(await governance.holds(holderAccountId, AUTHORITY_CODE)).toBe(false);
  }, 300000);

  // ── P2/P3/P4 — the CONCURRENT REPLAY, which is a different race ──────────
  //
  // Test P races DIFFERENT ceremonies and is decided by the GENERATION index.
  // These race the SAME ceremony, which is decided by the IDEMPOTENCY index —
  // a different constraint, and one the recovery boundary formerly did not
  // recognise. A loser escaped as a raw driver error instead of resolving.

  it('P2. concurrent submissions of the SAME command all resolve to the SAME row', async () => {
    // Six identical submissions dispatched together. Under READ COMMITTED none
    // can see another's uncommitted row, so several reach the insert and all but
    // one violate the idempotency index.
    const key = `${tag}-replay-concurrent`;
    const command = ceremony({
      idempotencyKey: key,
      reason: 'concurrent replay',
    });

    const settled = await Promise.allSettled(
      [1, 2, 3, 4, 5, 6].map(() => governance.grant(command)),
    );

    // THE CONTRACT, IN FULL: every caller is ANSWERED — not merely refused by a
    // named refusal. A legitimate replay of a command that landed resolves to
    // that command's result, whichever of the three replay boundaries caught it:
    // the replay read, the state gate, or the insert. None of them may refuse.
    //
    // Rendered as messages so a regression reports WHICH refusal leaked, rather
    // than only that a count moved.
    const rejected = settled.filter(
      (s): s is PromiseRejectedResult => s.status === 'rejected',
    );
    expect(rejected.map((r) => String(r.reason?.message ?? r.reason))).toEqual([]);

    const results = settled
      .filter(
        (s): s is PromiseFulfilledResult<Awaited<ReturnType<typeof governance.grant>>> =>
          s.status === 'fulfilled',
      )
      .map((s) => s.value);
    expect(results).toHaveLength(6);

    // Indistinguishable from a sequential replay: one id, one generation.
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(new Set(results.map((r) => r.generation)).size).toBe(1);

    // And the database agrees — one authoritative row, not six.
    expect(
      await db.platformGovernanceDecision.count({
        where: { idempotencyKey: key },
      }),
    ).toBe(1);
    expect(await governance.holds(holderAccountId, AUTHORITY_CODE)).toBe(true);
  }, 300000);

  it('P3. a SHARED key carrying DIFFERENT commands is refused by name, never answered', async () => {
    // Four revocations sharing one key but differing in reason — four different
    // commands. Exactly one may become authoritative; the rest must be told so
    // by name, and must never be handed the winner's row as if it were theirs.
    const key = `${tag}-replay-conflict`;
    const settled = await Promise.allSettled(
      ['reason A', 'reason B', 'reason C', 'reason D'].map((reason) =>
        governance.revoke(ceremony({ idempotencyKey: key, reason })),
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
      expect(message).not.toMatch(/PrismaClientKnownRequestError|P2002/i);
      // Whichever boundary refused it — the replay read, the state gate or the
      // insert — a different command is told the KEY is already spoken for. It
      // is never handed the winner's row, and it is never told its transition
      // would not change the state: that refusal belongs to genuinely invalid
      // transitions, not to a key collision.
      expect(message).not.toContain(
        PLATFORM_GOVERNANCE_REFUSAL.DECISION_WOULD_NOT_CHANGE_STATE,
      );
      expect(message).toMatch(
        new RegExp(
          `${PLATFORM_GOVERNANCE_REFUSAL.COMMAND_FINGERPRINT_CONFLICT}|${PLATFORM_GOVERNANCE_REFUSAL.GENERATION_CONTENDED}`,
        ),
      );
    }

    expect(
      await db.platformGovernanceDecision.count({
        where: { idempotencyKey: key },
      }),
    ).toBe(1);
    // Restores the revoked state test H depends on.
    expect(await governance.holds(holderAccountId, AUTHORITY_CODE)).toBe(false);
  }, 300000);

  it('P4. sequential replay is unchanged by the repair', async () => {
    // Regression guard: the ordinary uncontended path already worked and must
    // keep working — the stored row comes back, and no generation is appended.
    const key = `${tag}-replay-concurrent`;
    const command = ceremony({
      idempotencyKey: key,
      reason: 'concurrent replay',
    });
    const before = await db.platformGovernanceDecision.count({
      where: { authorityId },
    });

    const first = await governance.grant(command);
    const second = await governance.grant(command);

    expect(second.id).toBe(first.id);
    expect(second.generation).toBe(first.generation);
    expect(
      await db.platformGovernanceDecision.count({ where: { authorityId } }),
    ).toBe(before);
  }, 120000);

  // ── fail-closed, against the real database ──────────────────────────────

  it('H. a holder whose Account is deactivated stops holding, without any revoke', async () => {
    await governance.grant(
      ceremony({ idempotencyKey: `${tag}-key-restore`, reason: 'restore for test' }),
    );
    expect(await governance.holds(holderAccountId, AUTHORITY_CODE)).toBe(true);

    await db.account.update({
      where: { id: holderAccountId },
      data: { status: 'DEACTIVATED' },
    });
    // The lineage still says GRANT — and the person still cannot act.
    expect(await governance.holds(holderAccountId, AUTHORITY_CODE)).toBe(false);
    const state = await governance.currentState(holderAccountId, AUTHORITY_CODE);
    expect(state?.held).toBe(true);

    await db.account.update({
      where: { id: holderAccountId },
      data: { status: 'ACTIVE' },
    });
  }, 120000);

  it('F. a code outside the vocabulary cannot be granted or held', async () => {
    // Refused on the VOCABULARY, which is checked before the row lookup: a code
    // that is not one of the three is not a platform power, whether or not an
    // Authority row happens to carry it. The missing-row case
    // (AUTHORITY_NOT_FOUND) is proven in the unit suite, where the lookup can be
    // made to return null without deleting seeded governance data.
    await expect(
      governance.grant(
        ceremony({ authorityCode: `${tag}_NO_SUCH_CODE`, idempotencyKey: `${tag}-nope` }),
      ),
    ).rejects.toThrow(PLATFORM_GOVERNANCE_REFUSAL.AUTHORITY_NOT_PLATFORM_SCOPED);
    expect(await governance.holds(holderAccountId, `${tag}_NO_SUCH_CODE`)).toBe(false);
  }, 120000);

  it('D. a ceremony with no Owner authorization writes nothing at all', async () => {
    const before = await db.platformGovernanceDecision.count({ where: { authorityId } });
    await expect(
      governance.grant(
        ceremony({ ownerAuthorizationReference: '  ', idempotencyKey: `${tag}-noauth` }),
      ),
    ).rejects.toThrow(PLATFORM_GOVERNANCE_REFUSAL.OWNER_AUTHORIZATION_REQUIRED);
    expect(
      await db.platformGovernanceDecision.count({ where: { authorityId } }),
    ).toBe(before);
  }, 120000);

  // ── THE CEREMONY, END TO END, THROUGH THE PRODUCTION CODE PATH ──────────
  //
  // Everything above drives PlatformGovernanceService directly. This block goes
  // through `performCeremony` — the same function the production npm script
  // calls, with the same inputs, the same validation and the same writer.
  //
  // The ONLY difference is the expected-database argument, which the production
  // entry point never passes (it takes the `simprok_db` default; a unit test
  // asserts that). Overriding it here is what lets the real code path be proven
  // against the guarded test database WITHOUT weakening production.
  //
  // Labelled honestly in the report: PRODUCTION_CODE_PATH_PROVEN,
  // PRODUCTION_DATABASE_EXECUTION_NOT_PROVEN.
  describe('ceremony entry point', () => {
    const ADMIT = PLATFORM_GOVERNANCE_AUTHORITIES.ADMIT;
    let admitAuthorityId: string;

    const ceremonyEnv = (over: Record<string, string | undefined> = {}) => ({
      PLATFORM_GOVERNANCE_CONFIRM: CEREMONY_CONFIRMATION,
      PLATFORM_GOVERNANCE_DECISION: 'GRANT',
      PLATFORM_GOVERNANCE_AUTHORITY_CODE: ADMIT,
      PLATFORM_GOVERNANCE_HOLDER_ACCOUNT_ID: holderAccountId,
      PLATFORM_GOVERNANCE_EXECUTED_BY_ACCOUNT_ID: actorAccountId,
      PLATFORM_GOVERNANCE_OWNER_AUTHORIZATION_ID: `${tag}-CEREMONY-AUTH`,
      PLATFORM_GOVERNANCE_REASON: 'e2e ceremony',
      PLATFORM_GOVERNANCE_IDEMPOTENCY_KEY: `${tag}-cer-1`,
      ...over,
    });

    const run = (over: Record<string, string | undefined> = {}) =>
      performCeremony(governance, db, ceremonyEnv(over), EXPECTED_DATABASE);

    beforeAll(async () => {
      const row = await db.authority.findUniqueOrThrow({ where: { code: ADMIT } });
      admitAuthorityId = row.id;
    });

    it('refuses this database under the PRODUCTION default — the guard is real', async () => {
      // No override: the ceremony demands simprok_db, exactly as in production.
      await expect(
        performCeremony(governance, db, ceremonyEnv({ PLATFORM_GOVERNANCE_IDEMPOTENCY_KEY: `${tag}-cer-guard` })),
      ).rejects.toThrow(CEREMONY_REFUSAL.DATABASE_MISMATCH);
      expect(
        await db.platformGovernanceDecision.count({ where: { authorityId: admitAuthorityId } }),
      ).toBe(0);
    }, 120000);

    it('provisioning granted nobody this authority before the ceremony ran', async () => {
      expect(
        await db.platformGovernanceDecision.count({ where: { authorityId: admitAuthorityId } }),
      ).toBe(0);
      expect(await governance.holds(holderAccountId, ADMIT)).toBe(false);
    }, 120000);

    it('A. explicit GRANT ceremony → generation 1, currentState GRANT, holds true', async () => {
      const result = await run();
      expect(result).toMatchObject({
        database: EXPECTED_DATABASE,
        decision: 'GRANT',
        authorityCode: ADMIT,
        holderAccountId,
        executedByAccountId: actorAccountId,
        generation: 1,
        previousDecisionId: null,
      });
      // Holder and actor are different people, and stayed that way.
      expect(result.holderAccountId).not.toBe(result.executedByAccountId);

      expect(await governance.currentState(holderAccountId, ADMIT)).toMatchObject({
        held: true,
        generation: 1,
      });
      expect(await governance.holds(holderAccountId, ADMIT)).toBe(true);

      // The Owner authorization reached the row, read back independently.
      const row = await db.platformGovernanceDecision.findFirstOrThrow({
        where: { holderAccountId, authorityId: admitAuthorityId, generation: 1 },
      });
      expect(row.ownerAuthorizationReference).toBe(`${tag}-CEREMONY-AUTH`);
    }, 120000);

    it('T. replaying the identical ceremony is idempotent', async () => {
      const before = await db.platformGovernanceDecision.count({
        where: { authorityId: admitAuthorityId },
      });
      const replay = await run();
      expect(replay.generation).toBe(1);
      expect(
        await db.platformGovernanceDecision.count({ where: { authorityId: admitAuthorityId } }),
      ).toBe(before);
    }, 120000);

    it('B/C/D/E. REVOKE then GRANT again — generations 2 and 3, lineage intact', async () => {
      const first = await db.platformGovernanceDecision.findFirstOrThrow({
        where: { holderAccountId, authorityId: admitAuthorityId, generation: 1 },
      });

      const revoked = await run({
        PLATFORM_GOVERNANCE_DECISION: 'REVOKE',
        PLATFORM_GOVERNANCE_IDEMPOTENCY_KEY: `${tag}-cer-2`,
        PLATFORM_GOVERNANCE_REASON: 'e2e ceremony withdraw',
      });
      expect(revoked).toMatchObject({ generation: 2, previousDecisionId: first.id });
      expect(await governance.holds(holderAccountId, ADMIT)).toBe(false);

      // F — generation 1 is byte-identical after generation 2 was written.
      expect(
        await db.platformGovernanceDecision.findUniqueOrThrow({ where: { id: first.id } }),
      ).toEqual(first);

      const regranted = await run({
        PLATFORM_GOVERNANCE_IDEMPOTENCY_KEY: `${tag}-cer-3`,
        PLATFORM_GOVERNANCE_REASON: 'e2e ceremony restore',
      });
      expect(regranted.generation).toBe(3);

      // G — the highest generation is the current truth.
      expect(await governance.currentState(holderAccountId, ADMIT)).toMatchObject({
        held: true,
        generation: 3,
      });
      const history = await governance.history(holderAccountId, ADMIT);
      expect(history.map((h) => [h.generation, h.decision])).toEqual([
        [1, 'GRANT'],
        [2, 'REVOKE'],
        [3, 'GRANT'],
      ]);
    }, 300000);

    it('I/J. deactivation blocks use; reactivation restores it without touching lineage', async () => {
      const before = await governance.history(holderAccountId, ADMIT);

      await db.account.update({
        where: { id: holderAccountId },
        data: { status: 'DEACTIVATED' },
      });
      // I — not operationally eligible...
      expect(await governance.holds(holderAccountId, ADMIT)).toBe(false);
      // ...while the governance lineage still says GRANT. The two are separate.
      expect(await governance.currentState(holderAccountId, ADMIT)).toMatchObject({
        held: true,
        generation: 3,
      });

      await db.account.update({
        where: { id: holderAccountId },
        data: { status: 'ACTIVE' },
      });
      // J — reactivation changed NO governance row, and restores use because the
      // latest generation is still a GRANT. A REVOKED authority would not return.
      expect(await governance.history(holderAccountId, ADMIT)).toEqual(before);
      expect(await governance.holds(holderAccountId, ADMIT)).toBe(true);
    }, 180000);

    it('K/L/M/N. the ceremony refuses every non-platform authority code', async () => {
      for (const code of [
        'FIELD_PROGRESS_VERIFY',
        'AUTHORITY_MANAGE',
        'DIRECTOR',
        'SUPER_ADMIN',
        'PLATFORM_KNOWLEDGE_MANAGE',
      ]) {
        await expect(
          run({
            PLATFORM_GOVERNANCE_AUTHORITY_CODE: code,
            PLATFORM_GOVERNANCE_IDEMPOTENCY_KEY: `${tag}-cer-${code}`,
          }),
        ).rejects.toThrow(CEREMONY_REFUSAL.AUTHORITY_NOT_PLATFORM_SCOPED);
      }
      // Not one of them left a trace anywhere.
      expect(
        await db.platformGovernanceDecision.count({
          where: { authority: { code: { in: ['FIELD_PROGRESS_VERIFY'] } } },
        }),
      ).toBe(0);
    }, 180000);

    it('O/P/Q/R. refuses a ceremony missing any required governance fact', async () => {
      for (const key of [
        'PLATFORM_GOVERNANCE_CONFIRM',
        'PLATFORM_GOVERNANCE_OWNER_AUTHORIZATION_ID',
        'PLATFORM_GOVERNANCE_HOLDER_ACCOUNT_ID',
        'PLATFORM_GOVERNANCE_EXECUTED_BY_ACCOUNT_ID',
        'PLATFORM_GOVERNANCE_REASON',
        'PLATFORM_GOVERNANCE_IDEMPOTENCY_KEY',
      ]) {
        const before = await db.platformGovernanceDecision.count({
          where: { authorityId: admitAuthorityId },
        });
        await expect(run({ [key]: undefined })).rejects.toThrow(/^STOP_CEREMONY_/);
        expect(
          await db.platformGovernanceDecision.count({ where: { authorityId: admitAuthorityId } }),
        ).toBe(before);
      }
    }, 180000);
  });
});
