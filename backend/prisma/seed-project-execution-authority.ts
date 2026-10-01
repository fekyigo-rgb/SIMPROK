import { PrismaClient } from '@prisma/client';
import { PROJECT_EXECUTION_START_AUTHORITY } from '../src/project/project-execution.contracts';

export const EXPECTED_PROJECT_EXECUTION_AUTHORITY_DATABASE = 'simprok_db';

export const PROJECT_EXECUTION_START_AUTHORITY_DEFINITION = {
  code: PROJECT_EXECUTION_START_AUTHORITY,
  name: 'Start Project Execution',
  description:
    'Authorize the governed transition from planned project to active execution.',
} as const;

export interface ProjectExecutionAuthorityProvisioningClient {
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
 * Provision only the Project lifecycle Authority vocabulary row. This command
 * never grants it to a Position; that remains a separate governed act.
 */
export async function provisionProjectExecutionStartAuthority(
  client: ProjectExecutionAuthorityProvisioningClient,
) {
  const rows = await client.$queryRawUnsafe<
    Array<{ current_database: string }>
  >('SELECT current_database()');
  const database = rows[0]?.current_database;
  if (database !== EXPECTED_PROJECT_EXECUTION_AUTHORITY_DATABASE) {
    throw new Error(
      `STOP: expected ${EXPECTED_PROJECT_EXECUTION_AUTHORITY_DATABASE}, got ${database ?? 'unknown'}. No Project execution Authority write allowed.`,
    );
  }

  const authority = await client.authority.upsert({
    where: { code: PROJECT_EXECUTION_START_AUTHORITY_DEFINITION.code },
    update: {
      name: PROJECT_EXECUTION_START_AUTHORITY_DEFINITION.name,
      description: PROJECT_EXECUTION_START_AUTHORITY_DEFINITION.description,
    },
    create: PROJECT_EXECUTION_START_AUTHORITY_DEFINITION,
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
    const result = await provisionProjectExecutionStartAuthority(prisma);
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
