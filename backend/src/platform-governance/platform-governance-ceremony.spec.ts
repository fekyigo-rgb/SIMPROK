// PLATFORM GOVERNANCE CEREMONY — the entry boundary.
//
// The ceremony's own job is narrow: refuse anything that is not an explicit,
// complete, Owner-authorized act against the right database, then hand the
// decision to the ONE existing writer. These tests prove exactly that, and prove
// that it adds no governance logic of its own.
//
// Generation, lineage, replay, contention and account liveness are the SERVICE's
// responsibilities and are proven in platform-governance.service.spec.ts and
// against the real database in the acceptance suite. Re-proving them here would
// only be testing the service twice through a thinner wrapper.

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  CEREMONY_CONFIRMATION,
  CEREMONY_DATABASE,
  CEREMONY_REFUSAL,
  assertCeremonyDatabase,
  commandFromEnvironment,
  performCeremony,
  sanitizedCeremonyResult,
} from './platform-governance-ceremony';
import { PLATFORM_GOVERNANCE_AUTHORITIES } from './platform-governance.service';

const HOLDER = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';

/** A complete, lawful ceremony environment. Each test spoils exactly one thing. */
const env = (over: Record<string, string | undefined> = {}) => ({
  PLATFORM_GOVERNANCE_CONFIRM: CEREMONY_CONFIRMATION,
  PLATFORM_GOVERNANCE_DECISION: 'GRANT',
  PLATFORM_GOVERNANCE_AUTHORITY_CODE: PLATFORM_GOVERNANCE_AUTHORITIES.PUBLISH,
  PLATFORM_GOVERNANCE_HOLDER_ACCOUNT_ID: HOLDER,
  PLATFORM_GOVERNANCE_EXECUTED_BY_ACCOUNT_ID: ACTOR,
  PLATFORM_GOVERNANCE_OWNER_AUTHORIZATION_ID: 'OWNER-AUTH-2026-0007',
  PLATFORM_GOVERNANCE_REASON: 'Owner ceremony',
  PLATFORM_GOVERNANCE_IDEMPOTENCY_KEY: 'ceremony-key-1',
  ...over,
});

const dbClient = (name: string = CEREMONY_DATABASE) => ({
  $queryRaw: jest.fn(async () => [{ current_database: name }]),
});

describe('Platform governance ceremony — input gates', () => {
  it('accepts a complete, lawful ceremony', () => {
    const command = commandFromEnvironment(env());
    expect(command).toEqual({
      decision: 'GRANT',
      authorityCode: 'PLATFORM_KNOWLEDGE_PUBLISH',
      holderAccountId: HOLDER,
      executedByAccountId: ACTOR,
      ownerAuthorizationReference: 'OWNER-AUTH-2026-0007',
      reason: 'Owner ceremony',
      idempotencyKey: 'ceremony-key-1',
    });
  });

  // ── the confirmation token: a governance act must be said out loud ──────

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['a near miss', 'PLATFORM_GOVERNANCE_APPLY '],
    ["someone else's token", 'RM01B_APPLY'],
  ])('refuses %s confirmation', (_l, value) => {
    expect(() =>
      commandFromEnvironment(env({ PLATFORM_GOVERNANCE_CONFIRM: value })),
    ).toThrow(CEREMONY_REFUSAL.CONFIRMATION_MISMATCH);
  });

  // ── every fact is required; nothing is defaulted or inferred ────────────

  it.each([
    ['decision', 'PLATFORM_GOVERNANCE_DECISION', CEREMONY_REFUSAL.DECISION_REQUIRED],
    ['authority code', 'PLATFORM_GOVERNANCE_AUTHORITY_CODE', CEREMONY_REFUSAL.AUTHORITY_REQUIRED],
    ['holder', 'PLATFORM_GOVERNANCE_HOLDER_ACCOUNT_ID', CEREMONY_REFUSAL.HOLDER_REQUIRED],
    ['executing actor', 'PLATFORM_GOVERNANCE_EXECUTED_BY_ACCOUNT_ID', CEREMONY_REFUSAL.ACTOR_REQUIRED],
    ['Owner authorization', 'PLATFORM_GOVERNANCE_OWNER_AUTHORIZATION_ID', CEREMONY_REFUSAL.OWNER_AUTHORIZATION_REQUIRED],
    ['reason', 'PLATFORM_GOVERNANCE_REASON', CEREMONY_REFUSAL.REASON_REQUIRED],
    ['idempotency key', 'PLATFORM_GOVERNANCE_IDEMPOTENCY_KEY', CEREMONY_REFUSAL.IDEMPOTENCY_KEY_REQUIRED],
  ])('Q/R/S/O/P. refuses a missing %s', (_l, key, refusal) => {
    expect(() => commandFromEnvironment(env({ [key]: undefined }))).toThrow(refusal);
    expect(() => commandFromEnvironment(env({ [key]: '   ' }))).toThrow(refusal);
  });

  it('refuses a decision verb that is neither GRANT nor REVOKE', () => {
    for (const verb of ['grant', 'ADMIT', 'DELETE', 'PUBLISH', 'YES']) {
      expect(() =>
        commandFromEnvironment(env({ PLATFORM_GOVERNANCE_DECISION: verb })),
      ).toThrow(CEREMONY_REFUSAL.DECISION_REQUIRED);
    }
  });

  it('accepts REVOKE as the other lawful verb', () => {
    expect(
      commandFromEnvironment(env({ PLATFORM_GOVERNANCE_DECISION: 'REVOKE' })).decision,
    ).toBe('REVOKE');
  });

  // ── K/L/M/N — the vocabulary gate, at the door ──────────────────────────

  it.each([
    ['a project Authority', 'FIELD_PROGRESS_VERIFY'],
    ['a project Authority', 'FIELD_PROGRESS_CORRECT'],
    ['a project Authority', 'FIELD_PROGRESS_ACCEPT'],
    ['a Permission', 'AUTHORITY_MANAGE'],
    ['a Permission', 'AUTHORITY_ASSIGN'],
    ['a Role', 'DIRECTOR'],
    ['a Role', 'SUPER_ADMIN'],
    ['a Role', 'ADMIN'],
    ['an invented generic power', 'PLATFORM_KNOWLEDGE_MANAGE'],
  ])('K/L/M/N. refuses %s (%s)', (_l, code) => {
    expect(() =>
      commandFromEnvironment(env({ PLATFORM_GOVERNANCE_AUTHORITY_CODE: code })),
    ).toThrow(CEREMONY_REFUSAL.AUTHORITY_NOT_PLATFORM_SCOPED);
  });

  it('accepts all three canonical codes and nothing else', () => {
    for (const code of Object.values(PLATFORM_GOVERNANCE_AUTHORITIES)) {
      expect(
        commandFromEnvironment(env({ PLATFORM_GOVERNANCE_AUTHORITY_CODE: code }))
          .authorityCode,
      ).toBe(code);
    }
  });

  // ── holder / actor / Owner authorization stay three separate facts ──────

  it('never fills the holder in from the actor, or the reverse', () => {
    const command = commandFromEnvironment(env());
    expect(command.holderAccountId).toBe(HOLDER);
    expect(command.executedByAccountId).toBe(ACTOR);
    expect(command.holderAccountId).not.toBe(command.executedByAccountId);
    // Neither may be omitted "because the other is present".
    expect(() =>
      commandFromEnvironment(env({ PLATFORM_GOVERNANCE_HOLDER_ACCOUNT_ID: undefined })),
    ).toThrow(CEREMONY_REFUSAL.HOLDER_REQUIRED);
  });

  it('permits holder == actor when the Owner ceremony genuinely says so', () => {
    // Not required to differ — but never inferred either. The Owner
    // authorization is still mandatory, so this is not a self-grant shortcut.
    const command = commandFromEnvironment(
      env({ PLATFORM_GOVERNANCE_EXECUTED_BY_ACCOUNT_ID: HOLDER }),
    );
    expect(command.holderAccountId).toBe(command.executedByAccountId);
    expect(command.ownerAuthorizationReference).toBe('OWNER-AUTH-2026-0007');
  });
});

describe('Platform governance ceremony — database identity', () => {
  it('accepts only the named production database', async () => {
    await expect(assertCeremonyDatabase(dbClient() as never)).resolves.toBe(
      CEREMONY_DATABASE,
    );
  });

  it.each(['simprok_e2e', 'simprok_monitoring_audit', 'postgres', 'unknown_db'])(
    'refuses %s',
    async (name) => {
      await expect(
        assertCeremonyDatabase(dbClient(name) as never),
      ).rejects.toThrow(CEREMONY_REFUSAL.DATABASE_MISMATCH);
    },
  );

  it('the production default is never weakened by the test override', () => {
    const script = readFileSync(
      join(__dirname, '..', '..', 'scripts', 'platform-governance', 'ceremony.ts'),
      'utf8',
    );
    // The entry point calls performCeremony/assertCeremonyDatabase WITHOUT an
    // expected-database argument, so production always means simprok_db. Only a
    // test may pass one, and only to a guarded test database.
    expect(script).toContain('performCeremony(service, prisma, process.env)');
    expect(script).not.toContain('simprok_e2e');
    expect(script).not.toContain('CEREMONY_DATABASE =');
  });
});

describe('Platform governance ceremony — call chain and boundaries', () => {
  const source = readFileSync(
    join(__dirname, 'platform-governance-ceremony.ts'),
    'utf8',
  );
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  it('invokes ONLY the existing governance writer', async () => {
    const service = {
      grant: jest.fn(async () => ({
        holderAccountId: HOLDER,
        executedByAccountId: ACTOR,
        generation: 1,
        previousDecisionId: null,
        decidedAt: new Date('2026-09-03T00:00:00.000Z'),
      })),
      revoke: jest.fn(),
    };

    const result = await performCeremony(service as never, dbClient() as never, env());

    expect(service.grant).toHaveBeenCalledTimes(1);
    expect(service.revoke).not.toHaveBeenCalled();
    // Every fact is passed through untouched — the ceremony rewrites nothing.
    expect(service.grant.mock.calls[0][0]).toEqual({
      holderAccountId: HOLDER,
      authorityCode: 'PLATFORM_KNOWLEDGE_PUBLISH',
      executedByAccountId: ACTOR,
      ownerAuthorizationReference: 'OWNER-AUTH-2026-0007',
      reason: 'Owner ceremony',
      idempotencyKey: 'ceremony-key-1',
    });
    expect(result.generation).toBe(1);
  });

  it('routes REVOKE to revoke(), never to grant()', async () => {
    const service = {
      grant: jest.fn(),
      revoke: jest.fn(async () => ({
        holderAccountId: HOLDER,
        executedByAccountId: ACTOR,
        generation: 2,
        previousDecisionId: 'decision-1',
        decidedAt: new Date(),
      })),
    };
    await performCeremony(
      service as never,
      dbClient() as never,
      env({ PLATFORM_GOVERNANCE_DECISION: 'REVOKE' }),
    );
    expect(service.revoke).toHaveBeenCalledTimes(1);
    expect(service.grant).not.toHaveBeenCalled();
  });

  it('refuses before touching the database when an input is missing', async () => {
    const client = dbClient();
    const service = { grant: jest.fn(), revoke: jest.fn() };
    await expect(
      performCeremony(
        service as never,
        client as never,
        env({ PLATFORM_GOVERNANCE_OWNER_AUTHORIZATION_ID: '' }),
      ),
    ).rejects.toThrow(CEREMONY_REFUSAL.OWNER_AUTHORIZATION_REQUIRED);
    expect(client.$queryRaw).not.toHaveBeenCalled();
    expect(service.grant).not.toHaveBeenCalled();
  });

  it('writes no governance row of its own, and computes no lineage', () => {
    // The ceremony is an entry point. It may READ the decision it was handed
    // back in order to report it — `generation: decided.generation` — but it
    // must never COMPUTE one, and must never write.
    expect(code).not.toContain('platformGovernanceDecision');
    expect(code).not.toMatch(/\.(create|update|delete|upsert)\(/);
    // No arithmetic on generations, and no "next generation" reasoning.
    expect(code).not.toMatch(/generation[^\n]*\+\s*1/);
    expect(code).not.toMatch(/generation:\s*\(/);
    // Every lineage field it reports is copied straight off the service's answer.
    expect(code).toContain('generation: decided.generation');
    expect(code).toContain('previousDecisionId: decided.previousDecisionId');
  });

  it('W. never imports or calls AuthorityService', () => {
    expect(code).not.toContain('AuthorityService');
    expect(code).not.toContain('authority.service');
    const script = readFileSync(
      join(__dirname, '..', '..', 'scripts', 'platform-governance', 'ceremony.ts'),
      'utf8',
    );
    expect(script).not.toContain('AuthorityService');
  });

  it('derives authority from no workspace, role, permission or position', () => {
    for (const forbidden of [
      'workspace',
      'membership',
      'role',
      'permission',
      'position',
      'approvalMatrix',
      'project',
    ]) {
      expect(code.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('never claims the Owner authorization was verified', () => {
    expect(code).not.toContain('verifySignature');
    expect(code).not.toContain('createVerify');
    expect(code).not.toContain('publicKey');
    expect(code).not.toContain('jwt');
    expect(source).toContain('does NOT claim to have verified who issued it');
  });

  it('keeps the Owner authorization out of logs', () => {
    const printed = sanitizedCeremonyResult({
      database: CEREMONY_DATABASE,
      decision: 'GRANT',
      authorityCode: PLATFORM_GOVERNANCE_AUTHORITIES.ADMIT,
      holderAccountId: HOLDER,
      executedByAccountId: ACTOR,
      generation: 1,
      previousDecisionId: null,
      decidedAt: new Date('2026-09-03T00:00:00.000Z'),
    });
    expect(printed).toContain('<redacted>');
    // The accountability fact belongs in the database, not in a CI log.
    expect(printed).not.toContain('OWNER-AUTH');
  });

  it('activates no business workflow', () => {
    for (const domain of ['ahsp', 'basicPrice', 'basic-price', 'rab', 'monitoring', 'kdn', 'unitKernel', 'costKernel']) {
      expect(code.toLowerCase()).not.toContain(domain.toLowerCase());
    }
  });

  it('exposes no HTTP surface, cron, event listener or startup hook', () => {
    const script = readFileSync(
      join(__dirname, '..', '..', 'scripts', 'platform-governance', 'ceremony.ts'),
      'utf8',
    );
    for (const forbidden of ['@Controller', '@Post', '@Get', '@Cron', '@OnEvent', 'setInterval', 'OnModuleInit']) {
      expect(code).not.toContain(forbidden);
      expect(script).not.toContain(forbidden);
    }
    // And it requires an explicit mode.
    expect(script).toContain("['--plan', '--apply']");
  });

  // ── IMPORT SAFETY, PROVEN BY BEHAVIOUR ──────────────────────────────────
  //
  // This used to be asserted by the line above, which only showed that a string
  // appeared in the source. It could not have detected what was actually true:
  // `main()` was called at top level, so importing the module RAN it. The two
  // tests below prove the property instead of describing it.

  it('the CLI entry point is guarded — main() runs only on direct execution', () => {
    const script = readFileSync(
      join(__dirname, '..', '..', 'scripts', 'platform-governance', 'ceremony.ts'),
      'utf8',
    );
    // The guard exists, and main() is called INSIDE it — not merely nearby.
    expect(script).toContain('require.main === module');
    const guard = script.slice(script.indexOf('require.main === module'));
    expect(guard).toContain('main()');
    // Direct execution is unchanged: both modes still reach the same entry.
    expect(script).toContain("['--plan', '--apply']");
  });

  it('importing the ceremony script does not execute the ceremony', async () => {
    // Under Jest, process.argv is Jest's own, so an UNGUARDED main() would reach
    // its mode check, throw, and be caught by the script's own .catch — which
    // sets process.exitCode = 1. That is the observable harm of import-time
    // execution: an imported module silently poisoning its host's exit status.
    const before = process.exitCode;
    jest.isolateModules(() => {
      require('../../scripts/platform-governance/ceremony');
    });
    // Let any floating rejection handler settle before judging.
    await new Promise((resolve) => setImmediate(resolve));
    expect(process.exitCode).toBe(before);
  });
});
