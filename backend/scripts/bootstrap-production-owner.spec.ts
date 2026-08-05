import * as fs from 'fs';
import * as path from 'path';
import {
  parseArgs,
  readOwnerPasswordFromEnv,
  assertFreshState,
  assertDatabaseGuard,
  EXPECTED_DATABASE,
  MIN_PASSWORD_LENGTH,
  OWNER_PASSWORD_ENV_VAR,
  type FreshStateClient,
  type DatabaseGuardClient,
} from './bootstrap-production-owner';

const VALID_ARGS = [
  '--email=owner@example-org.test',
  '--display-name=Real Owner',
  '--organization-name=Real Organization',
  '--workspace-name=Real Workspace',
];

function freshClient(overrides: Partial<Record<keyof FreshStateClient, number>> = {}): FreshStateClient {
  const counts = {
    account: overrides.account ?? 0,
    user: overrides.user ?? 0,
    organization: overrides.organization ?? 0,
    workspace: overrides.workspace ?? 0,
    workspaceMembership: overrides.workspaceMembership ?? 0,
  };
  return {
    account: { count: async () => counts.account },
    user: { count: async () => counts.user },
    organization: { count: async () => counts.organization },
    workspace: { count: async () => counts.workspace },
    workspaceMembership: { count: async () => counts.workspaceMembership },
  };
}

describe('bootstrap-production-owner: argument parsing', () => {
  it('accepts a fresh --dry-run plan with all required fields', () => {
    const { mode, input } = parseArgs([...VALID_ARGS, '--dry-run']);
    expect(mode).toBe('dry-run');
    expect(input.email).toBe('owner@example-org.test');
    expect(input.fullName).toBe('Real Owner');
  });

  it('accepts --apply as a distinct mode', () => {
    const { mode } = parseArgs([...VALID_ARGS, '--apply']);
    expect(mode).toBe('apply');
  });

  it('rejects when neither --dry-run nor --apply is given', () => {
    expect(() => parseArgs(VALID_ARGS)).toThrow('STOP_INVALID_MODE');
  });

  it('rejects when both --dry-run and --apply are given', () => {
    expect(() => parseArgs([...VALID_ARGS, '--dry-run', '--apply'])).toThrow('STOP_INVALID_MODE');
  });

  it('rejects when required fields are missing rather than defaulting to a fixture identity', () => {
    expect(() => parseArgs(['--dry-run'])).toThrow('STOP_MISSING_INPUT');
    expect(() => parseArgs(['--dry-run', '--email=owner@example-org.test'])).toThrow('STOP_MISSING_INPUT');
  });
});

describe('bootstrap-production-owner: password capture', () => {
  it('blocks when the password env var is absent', () => {
    expect(() => readOwnerPasswordFromEnv({})).toThrow('STOP_PASSWORD_ABSENT');
  });

  it('blocks when the password is shorter than the minimum length', () => {
    const shortEnv = { [OWNER_PASSWORD_ENV_VAR]: 'x'.repeat(MIN_PASSWORD_LENGTH - 1) };
    expect(() => readOwnerPasswordFromEnv(shortEnv)).toThrow('STOP_PASSWORD_TOO_SHORT');
  });

  it('accepts a password at or above the minimum length', () => {
    const validEnv = { [OWNER_PASSWORD_ENV_VAR]: 'x'.repeat(MIN_PASSWORD_LENGTH) };
    expect(readOwnerPasswordFromEnv(validEnv)).toBe('x'.repeat(MIN_PASSWORD_LENGTH));
  });
});

describe('bootstrap-production-owner: fresh-state precondition', () => {
  it('accepts a genuinely fresh database (all counts zero)', async () => {
    const counts = await assertFreshState(freshClient());
    expect(counts.accountCount).toBe(0);
  });

  it('blocks when an Account already exists', async () => {
    await expect(
      assertFreshState(
        freshClient({ account: 1, user: 1, organization: 1, workspace: 1, workspaceMembership: 1 }),
      ),
    ).rejects.toThrow('STOP_EXISTING_ACCOUNT');
  });

  it('blocks on partial/inconsistent state rather than proceeding or silently repairing it', async () => {
    await expect(assertFreshState(freshClient({ organization: 1 }))).rejects.toThrow('STOP_PARTIAL_STATE');
    await expect(assertFreshState(freshClient({ workspace: 1, user: 1 }))).rejects.toThrow('STOP_PARTIAL_STATE');
  });

  it('is safe to invoke twice in a row: second call after a successful first apply is blocked, not corrupted', async () => {
    const firstCallCounts = await assertFreshState(freshClient());
    expect(firstCallCounts.accountCount).toBe(0);

    // Simulates state after a prior successful apply: everything now exists.
    await expect(
      assertFreshState(
        freshClient({ account: 1, user: 1, organization: 1, workspace: 1, workspaceMembership: 1 }),
      ),
    ).rejects.toThrow('STOP_EXISTING_ACCOUNT');
  });
});

describe('bootstrap-production-owner: database identity guard', () => {
  function guardClient(currentDatabase: string): DatabaseGuardClient {
    return {
      $queryRaw: async () => [{ current_database: currentDatabase }] as never,
    };
  }

  it('passes when connected to the expected production database', async () => {
    await expect(assertDatabaseGuard(guardClient(EXPECTED_DATABASE))).resolves.toBeUndefined();
  });

  it('blocks when connected to any other database', async () => {
    await expect(assertDatabaseGuard(guardClient('simprok_test'))).rejects.toThrow('STOP_WRONG_DATABASE');
  });
});

describe('bootstrap-production-owner: static source-safety invariants', () => {
  const source = fs.readFileSync(path.join(__dirname, 'bootstrap-production-owner.ts'), 'utf8');

  it('contains no fixture identity literals from the forbidden acceptance-seed patterns', () => {
    expect(source).not.toMatch(/Test1234!/);
    expect(source).not.toMatch(/@test\.local/);
    expect(source).not.toMatch(/Workspace-A/);
    expect(source).not.toMatch(/ACC-X/i);
  });

  it('never creates a Permission or RolePermission row (permissions are granted only by the existing canonical seed)', () => {
    expect(source).not.toMatch(/\.permission\.create/);
    expect(source).not.toMatch(/\.rolePermission\.create/);
  });

  it('never creates a Project, BasicPrice, AHSP, or RAB row', () => {
    expect(source).not.toMatch(/\.project\.create/i);
    expect(source).not.toMatch(/\.basicPrice\.create/i);
    expect(source).not.toMatch(/\.aHSP\.create|\.ahsp\.create/i);
    expect(source).not.toMatch(/\.rab(Document)?\.create/i);
  });

  it('never prints the plaintext password or password hash', () => {
    expect(source).not.toMatch(/console\.log\([^)]*passwordHash[^)]*\)/);
    expect(source).not.toMatch(/console\.log\([^)]*\bpassword\b[^)]*\$\{password\}/);
  });

  it('does not depend on any superuser/cluster-admin role name', () => {
    expect(source).not.toMatch(/cluster_admin|superuser/i);
  });
});
