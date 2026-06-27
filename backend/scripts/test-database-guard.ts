import { PrismaClient } from '@prisma/client';

import { loadTestEnv } from '../test/load-test-env';

const EXPECTED_DATABASE = 'simprok_test';
const FORBIDDEN_DATABASE = 'simprok_db';

export async function verifyTestDatabase(): Promise<void> {
  loadTestEnv();

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is missing after loading .env.test');
  }

  if (databaseUrl.includes(`/${FORBIDDEN_DATABASE}`)) {
    throw new Error(`DATABASE_URL points to forbidden database ${FORBIDDEN_DATABASE}`);
  }

  const prisma = new PrismaClient();

  try {
    const result = await prisma.$queryRaw<Array<{ current_database: string }>>`
      select current_database()
    `;
    const currentDatabase = result[0]?.current_database;

    if (currentDatabase !== EXPECTED_DATABASE) {
      throw new Error(
        `expected current_database() = ${EXPECTED_DATABASE}, got ${currentDatabase}`,
      );
    }

    console.log(`Database guard PASS: current_database() = ${currentDatabase}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  verifyTestDatabase().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Database guard FAIL: ${message}`);
    process.exitCode = 1;
  });
}
