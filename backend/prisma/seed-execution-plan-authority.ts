import { PrismaClient } from '@prisma/client';
import { EXECUTION_PLAN_AUTHORITY } from '../src/execution-plan/execution-plan.contracts';

export const EXPECTED_EXECUTION_PLAN_AUTHORITY_DATABASE = 'simprok_db';

export const EXECUTION_PLAN_AUTHORITY_DEFINITION = {
  code: EXECUTION_PLAN_AUTHORITY,
  name: 'Lock Execution Plan',
  description:
    'Authorize the final lock of an official Execution Plan for project execution.',
} as const;

export interface ExecutionPlanAuthorityProvisioningClient {
  $queryRawUnsafe<T>(query: string): Promise<T>;
  authority: {
    upsert(args: {
      where: { code: string };
      update: { name: string; description: string };
      create: { code: string; name: string; description: string };
    }): Promise<{ id: string; code: string }>;
  };
}

/**
 * Provision only the canonical Authority vocabulary row. This command never
 * grants the Authority to a Position; that separate act remains owned by
 * AuthorityGovernanceService and requires an Owner-authorized ceremony.
 */
export async function provisionExecutionPlanAuthority(
  client: ExecutionPlanAuthorityProvisioningClient,
) {
  const rows = await client.$queryRawUnsafe<Array<{ current_database: string }>>(
    'SELECT current_database()',
  );
  const database = rows[0]?.current_database;
  if (database !== EXPECTED_EXECUTION_PLAN_AUTHORITY_DATABASE) {
    throw new Error(
      `STOP: expected ${EXPECTED_EXECUTION_PLAN_AUTHORITY_DATABASE}, got ${database ?? 'unknown'}. No Authority write allowed.`,
    );
  }

  const authority = await client.authority.upsert({
    where: { code: EXECUTION_PLAN_AUTHORITY_DEFINITION.code },
    update: {
      name: EXECUTION_PLAN_AUTHORITY_DEFINITION.name,
      description: EXECUTION_PLAN_AUTHORITY_DEFINITION.description,
    },
    create: EXECUTION_PLAN_AUTHORITY_DEFINITION,
  });

  return {
    database,
    authorityId: authority.id,
    authorityCode: authority.code,
    grantsCreated: 0 as const,
  };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await provisionExecutionPlanAuthority(prisma);
    console.log(`DB guard PASS: current_database() = ${result.database}`);
    console.log(`Authority ensured: ${result.authorityCode}`);
    console.log('PositionAuthority grants created: 0');
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
