import { PrismaClient, AccountStatus, UserStatus, MembershipStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

export const EXPECTED_DATABASE = 'simprok_db';
export const DIRECTOR_ROLE_CODE = 'DIRECTOR';
export const SALT_ROUNDS = 10;
export const MIN_PASSWORD_LENGTH = 12;
export const OWNER_PASSWORD_ENV_VAR = 'SIMPROK_OWNER_BOOTSTRAP_PASSWORD';

export interface BootstrapInput {
  email: string;
  displayName: string;
  organizationName: string;
  workspaceName: string;
  fullName: string;
}

export type BootstrapMode = 'dry-run' | 'apply';

export function parseArgs(argv: string[]): { mode: BootstrapMode; input: BootstrapInput } {
  const getArg = (name: string): string | undefined => {
    const prefix = `--${name}=`;
    const found = argv.find((a) => a.startsWith(prefix));
    return found ? found.slice(prefix.length) : undefined;
  };

  const hasDryRun = argv.includes('--dry-run');
  const hasApply = argv.includes('--apply');
  if (hasDryRun === hasApply) {
    throw new Error('STOP_INVALID_MODE: pass exactly one of --dry-run or --apply');
  }
  const mode: BootstrapMode = hasApply ? 'apply' : 'dry-run';

  const email = getArg('email');
  const displayName = getArg('display-name');
  const organizationName = getArg('organization-name');
  const workspaceName = getArg('workspace-name');
  const fullName = getArg('full-name') ?? displayName;

  if (!email || !displayName || !organizationName || !workspaceName || !fullName) {
    throw new Error(
      'STOP_MISSING_INPUT: --email, --display-name, --organization-name, --workspace-name are required',
    );
  }

  return { mode, input: { email, displayName, organizationName, workspaceName, fullName } };
}

export function readOwnerPasswordFromEnv(env: NodeJS.ProcessEnv): string {
  const password = env[OWNER_PASSWORD_ENV_VAR];
  if (!password) {
    throw new Error(
      `STOP_PASSWORD_ABSENT: ${OWNER_PASSWORD_ENV_VAR} must be set in the child process environment. It is never accepted via CLI argument.`,
    );
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `STOP_PASSWORD_TOO_SHORT: ${OWNER_PASSWORD_ENV_VAR} must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }
  return password;
}

export interface FreshStateCounts {
  accountCount: number;
  userCount: number;
  organizationCount: number;
  workspaceCount: number;
  membershipCount: number;
}

export interface FreshStateClient {
  account: { count(): Promise<number> };
  user: { count(): Promise<number> };
  organization: { count(): Promise<number> };
  workspace: { count(): Promise<number> };
  workspaceMembership: { count(): Promise<number> };
}

export async function assertFreshState(client: FreshStateClient): Promise<FreshStateCounts> {
  const [accountCount, userCount, organizationCount, workspaceCount, membershipCount] = await Promise.all([
    client.account.count(),
    client.user.count(),
    client.organization.count(),
    client.workspace.count(),
    client.workspaceMembership.count(),
  ]);

  const counts: FreshStateCounts = { accountCount, userCount, organizationCount, workspaceCount, membershipCount };
  const allZero = Object.values(counts).every((c) => c === 0);

  if (allZero) {
    return counts;
  }

  if (accountCount > 0) {
    throw new Error(
      `STOP_EXISTING_ACCOUNT: database already has an Owner baseline: ${JSON.stringify(counts)}. This bootstrap only runs once against a fresh database.`,
    );
  }

  throw new Error(
    `STOP_PARTIAL_STATE: inconsistent existing rows detected: ${JSON.stringify(counts)}. Refusing to proceed without a separate remediation decision.`,
  );
}

export interface DatabaseGuardClient {
  $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

export async function assertDatabaseGuard(client: DatabaseGuardClient): Promise<void> {
  const rows = await client.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
  const actual = rows[0]?.current_database;
  if (actual !== EXPECTED_DATABASE) {
    throw new Error(
      `STOP_WRONG_DATABASE: expected database ${EXPECTED_DATABASE}, got ${actual ?? 'unknown'}. Refusing to proceed.`,
    );
  }
}

async function main() {
  const { mode, input } = parseArgs(process.argv.slice(2));
  const password = readOwnerPasswordFromEnv(process.env);

  const prisma = new PrismaClient();

  try {
    await assertDatabaseGuard(prisma);
    const counts = await assertFreshState(prisma);

    console.log('PLAN:');
    console.log(`  organization: ${input.organizationName}`);
    console.log(`  workspace: ${input.workspaceName}`);
    console.log(`  account email: ${input.email}`);
    console.log(`  account displayName: ${input.displayName}`);
    console.log(`  user fullName: ${input.fullName}`);
    console.log(`  role: ${DIRECTOR_ROLE_CODE} (workspace-scoped, isSystem=true)`);
    console.log('  password: [REDACTED]');
    console.log(`  preconditionCounts: ${JSON.stringify(counts)}`);

    if (mode === 'dry-run') {
      console.log('DRY_RUN_STATUS=PASS');
      console.log('NO_MUTATION_PERFORMED=YES');
      return;
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const result = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: { name: input.organizationName, type: 'COMPANY' },
      });

      const workspace = await tx.workspace.create({
        data: { organizationId: organization.id, name: input.workspaceName },
      });

      const directorRole = await tx.role.create({
        data: {
          workspaceId: workspace.id,
          code: DIRECTOR_ROLE_CODE,
          name: 'Director',
          isSystem: true,
        },
      });

      const account = await tx.account.create({
        data: {
          email: input.email,
          passwordHash,
          displayName: input.displayName,
          status: AccountStatus.ACTIVE,
        },
      });

      const membership = await tx.workspaceMembership.create({
        data: {
          accountId: account.id,
          workspaceId: workspace.id,
          status: MembershipStatus.ACTIVE,
        },
      });

      await tx.user.create({
        data: {
          workspaceMembershipId: membership.id,
          workspaceId: workspace.id,
          fullName: input.fullName,
          status: UserStatus.ACTIVE,
        },
      });

      await tx.membershipRole.create({
        data: {
          workspaceMembershipId: membership.id,
          roleId: directorRole.id,
          isActive: true,
        },
      });

      return {
        organizationId: organization.id,
        workspaceId: workspace.id,
        accountId: account.id,
        roleId: directorRole.id,
      };
    });

    console.log('APPLY_STATUS=PASS');
    console.log(`ORGANIZATION_ID=${result.organizationId}`);
    console.log(`WORKSPACE_ID=${result.workspaceId}`);
    console.log(`ACCOUNT_ID=${result.accountId}`);
    console.log(`ROLE_ID=${result.roleId}`);
    console.log('PASSWORD_PRINTED=NO');
    console.log(
      'NEXT_STEP: run prisma/seed-rbac-permissions.ts against this database to grant DIRECTOR its canonical permissions.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
