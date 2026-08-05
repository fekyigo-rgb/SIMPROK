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
import {
  DIRECTOR_ALLOWED_PERMISSION_CODES,
  DIRECTOR_FORBIDDEN_PERMISSION_CODES,
} from '../prisma/seed-rbac-permissions';
import { PERMISSIONS } from '../src/common/constants/permissions';

const VALID_ARGS = [
  '--email=owner@example-org.test',
  '--display-name=Real Owner',
  '--organization-name=Real Organization',
  '--workspace-name=Real Workspace',
];

const ZERO_COUNTS = {
  account: 0,
  user: 0,
  organization: 0,
  workspace: 0,
  workspaceMembership: 0,
  role: 0,
  membershipRole: 0,
  permission: 0,
  rolePermission: 0,
};

function freshClient(overrides: Partial<Record<keyof typeof ZERO_COUNTS, number>> = {}): FreshStateClient {
  const counts = { ...ZERO_COUNTS, ...overrides };
  return {
    account: { count: async () => counts.account },
    user: { count: async () => counts.user },
    organization: { count: async () => counts.organization },
    workspace: { count: async () => counts.workspace },
    workspaceMembership: { count: async () => counts.workspaceMembership },
    role: { count: async () => counts.role },
    membershipRole: { count: async () => counts.membershipRole },
    permission: { count: async () => counts.permission },
    rolePermission: { count: async () => counts.rolePermission },
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

describe('bootstrap-production-owner: password capture is apply-only', () => {
  it('dry-run needs no password: parseArgs + the guard/fresh-state path never call readOwnerPasswordFromEnv', () => {
    // Structural proof: dry-run returns from main() before readOwnerPasswordFromEnv
    // is ever reached. See the "static source-safety invariants" block below for
    // the source-level assertion of call order.
    const { mode } = parseArgs([...VALID_ARGS, '--dry-run']);
    expect(mode).toBe('dry-run');
  });

  it('apply blocks when the password env var is absent', () => {
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

  it('removes the password from the env object immediately after capture', () => {
    const env: NodeJS.ProcessEnv = { [OWNER_PASSWORD_ENV_VAR]: 'x'.repeat(MIN_PASSWORD_LENGTH) };
    readOwnerPasswordFromEnv(env);
    expect(env[OWNER_PASSWORD_ENV_VAR]).toBeUndefined();
  });

  it('removes the password from the env object even when validation fails', () => {
    const env: NodeJS.ProcessEnv = { [OWNER_PASSWORD_ENV_VAR]: 'short' };
    expect(() => readOwnerPasswordFromEnv(env)).toThrow();
    expect(env[OWNER_PASSWORD_ENV_VAR]).toBeUndefined();
  });
});

describe('bootstrap-production-owner: fresh-state precondition', () => {
  it('accepts a genuinely fresh database (all counts, including RBAC counts, zero)', async () => {
    const counts = await assertFreshState(freshClient());
    expect(counts.accountCount).toBe(0);
    expect(counts.permissionCount).toBe(0);
    expect(counts.rolePermissionCount).toBe(0);
  });

  it('blocks when an Account already exists', async () => {
    await expect(
      assertFreshState(
        freshClient({
          account: 1,
          user: 1,
          organization: 1,
          workspace: 1,
          workspaceMembership: 1,
          role: 1,
          membershipRole: 1,
          permission: 18,
          rolePermission: 13,
        }),
      ),
    ).rejects.toThrow('STOP_EXISTING_ACCOUNT');
  });

  it('blocks on partial identity state rather than proceeding or silently repairing it', async () => {
    await expect(assertFreshState(freshClient({ organization: 1 }))).rejects.toThrow('STOP_PARTIAL_STATE');
    await expect(assertFreshState(freshClient({ workspace: 1, user: 1 }))).rejects.toThrow('STOP_PARTIAL_STATE');
  });

  it('blocks on partial RBAC state alone, even when identity tables are all empty', async () => {
    await expect(assertFreshState(freshClient({ role: 1 }))).rejects.toThrow('STOP_PARTIAL_STATE');
    await expect(assertFreshState(freshClient({ permission: 5 }))).rejects.toThrow('STOP_PARTIAL_STATE');
    await expect(assertFreshState(freshClient({ rolePermission: 2 }))).rejects.toThrow('STOP_PARTIAL_STATE');
    await expect(assertFreshState(freshClient({ membershipRole: 1 }))).rejects.toThrow('STOP_PARTIAL_STATE');
  });

  it('is safe to invoke twice in a row: second call after a successful first apply is blocked, not corrupted', async () => {
    const firstCallCounts = await assertFreshState(freshClient());
    expect(firstCallCounts.accountCount).toBe(0);

    // Simulates state after a prior successful apply: everything now exists.
    await expect(
      assertFreshState(
        freshClient({
          account: 1,
          user: 1,
          organization: 1,
          workspace: 1,
          workspaceMembership: 1,
          role: 1,
          membershipRole: 1,
          permission: 18,
          rolePermission: 13,
        }),
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

describe('bootstrap-production-owner: DIRECTOR RBAC grant set', () => {
  it('grants PROJECT_VIEW to DIRECTOR (was previously missing, blocking Director from viewing what it can create)', () => {
    expect(DIRECTOR_ALLOWED_PERMISSION_CODES).toContain(PERMISSIONS.PROJECT_VIEW);
  });

  it('grants PROJECT_CREATE, RAB_VIEW, and RAB_DRAFT_EDIT to DIRECTOR', () => {
    expect(DIRECTOR_ALLOWED_PERMISSION_CODES).toContain(PERMISSIONS.PROJECT_CREATE);
    expect(DIRECTOR_ALLOWED_PERMISSION_CODES).toContain(PERMISSIONS.RAB_VIEW);
    expect(DIRECTOR_ALLOWED_PERMISSION_CODES).toContain(PERMISSIONS.RAB_DRAFT_EDIT);
  });

  it('never allows a forbidden MANAGE/ASSIGN code to also appear in the allowed list', () => {
    for (const forbidden of DIRECTOR_FORBIDDEN_PERMISSION_CODES) {
      expect(DIRECTOR_ALLOWED_PERMISSION_CODES).not.toContain(forbidden);
    }
    expect(DIRECTOR_FORBIDDEN_PERMISSION_CODES.length).toBeGreaterThan(0);
  });
});

describe('bootstrap-production-owner: static source-safety invariants', () => {
  const source = fs.readFileSync(path.join(__dirname, 'bootstrap-production-owner.ts'), 'utf8');

  it('reads the Owner password only after the dry-run branch has already returned', () => {
    const dryRunReturnIndex = source.indexOf("mode === 'dry-run'");
    const passwordReadIndex = source.indexOf('readOwnerPasswordFromEnv(process.env)');
    expect(dryRunReturnIndex).toBeGreaterThan(-1);
    expect(passwordReadIndex).toBeGreaterThan(-1);
    expect(passwordReadIndex).toBeGreaterThan(dryRunReturnIndex);
  });

  it('grants RBAC permissions inside the same $transaction callback that creates the identity rows', () => {
    const transactionStart = source.indexOf('prisma.$transaction(async (tx)');
    const transactionEnd = source.indexOf('return {', transactionStart);
    const grantCallIndex = source.indexOf('grantPermissionsToRole(tx,');
    const accountCreateIndex = source.indexOf('tx.account.create(');

    expect(transactionStart).toBeGreaterThan(-1);
    expect(transactionEnd).toBeGreaterThan(transactionStart);
    expect(accountCreateIndex).toBeGreaterThan(transactionStart);
    expect(accountCreateIndex).toBeLessThan(transactionEnd);
    expect(grantCallIndex).toBeGreaterThan(transactionStart);
    expect(grantCallIndex).toBeLessThan(transactionEnd);
  });

  it('never prints a hardcoded RBAC seed as a required separate follow-up step', () => {
    expect(source).not.toMatch(/NEXT_STEP.*seed-rbac-permissions/);
  });

  it('contains no fixture identity literals from the forbidden acceptance-seed patterns', () => {
    expect(source).not.toMatch(/Test1234!/);
    expect(source).not.toMatch(/@test\.local/);
    expect(source).not.toMatch(/Workspace-A/);
    expect(source).not.toMatch(/ACC-X/i);
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

describe('seed-rbac-permissions: import-safe module', () => {
  it('does not execute main() as a side effect of being imported (no console output from the import itself)', () => {
    // If seed-rbac-permissions.ts executed main() at import time, this test file's
    // own import above would have already thrown (no DB available in this suite)
    // before any test ran. Reaching this point at all is the proof.
    expect(DIRECTOR_ALLOWED_PERMISSION_CODES.length).toBeGreaterThan(0);
  });

  it('retains a require.main === module guarded CLI entry point', () => {
    const seedSource = fs.readFileSync(
      path.join(__dirname, '..', 'prisma', 'seed-rbac-permissions.ts'),
      'utf8',
    );
    expect(seedSource).toMatch(/require\.main === module/);
  });
});
