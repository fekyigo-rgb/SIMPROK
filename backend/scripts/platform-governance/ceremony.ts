// PLATFORM GOVERNANCE CEREMONY — the production entry point.
//
// Mirrors `scripts/rm01b/permission-activation.ts`: an npm-script-invoked module,
// explicit mode, every input supplied externally, nothing defaulted.
//
//   npm run platform-governance:ceremony -- --apply
//
// with the environment naming EVERY fact of the act:
//
//   PLATFORM_GOVERNANCE_CONFIRM=PLATFORM_GOVERNANCE_APPLY
//   PLATFORM_GOVERNANCE_DECISION=GRANT | REVOKE
//   PLATFORM_GOVERNANCE_AUTHORITY_CODE=PLATFORM_KNOWLEDGE_ADMIT | _PUBLISH | _WITHDRAW
//   PLATFORM_GOVERNANCE_HOLDER_ACCOUNT_ID=<account uuid>
//   PLATFORM_GOVERNANCE_EXECUTED_BY_ACCOUNT_ID=<account uuid>
//   PLATFORM_GOVERNANCE_OWNER_AUTHORIZATION_ID=<opaque Owner reference>
//   PLATFORM_GOVERNANCE_REASON=<why>
//   PLATFORM_GOVERNANCE_IDEMPOTENCY_KEY=<unique per command>
//   DATABASE_URL=<must resolve to simprok_db>
//
// `--plan` reports exactly what would be done and writes nothing.

import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PlatformGovernanceService } from '../../src/platform-governance/platform-governance.service';
import {
  assertCeremonyDatabase,
  commandFromEnvironment,
  performCeremony,
  sanitizedCeremonyResult,
} from '../../src/platform-governance/platform-governance-ceremony';

async function main(): Promise<void> {
  const mode = process.argv.slice(2);
  if (mode.length !== 1 || !['--plan', '--apply'].includes(mode[0])) {
    throw new Error('Use exactly one explicit mode: --plan or --apply.');
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be supplied externally.');
  }

  const prisma = new PrismaClient();
  try {
    if (mode[0] === '--plan') {
      // Validates every input and the database identity, and writes NOTHING.
      const command = commandFromEnvironment(process.env);
      const database = await assertCeremonyDatabase(prisma);
      console.log(
        JSON.stringify(
          {
            database,
            decision: command.decision,
            authorityCode: command.authorityCode,
            holderAccountId: command.holderAccountId,
            executedByAccountId: command.executedByAccountId,
            idempotencyKey: command.idempotencyKey,
            ownerAuthorizationReference: '<redacted>',
          },
          null,
          2,
        ),
      );
      console.log('DRY_RUN_STATUS=PASS');
      console.log('NO_MUTATION_PERFORMED=YES');
      return;
    }

    // PrismaService extends PrismaClient and takes no constructor arguments, so
    // the governance service runs here exactly as it does inside Nest — the same
    // class, the same decide() path, no test double and no second writer.
    const service = new PlatformGovernanceService(prisma as unknown as PrismaService);
    const result = await performCeremony(service, prisma, process.env);
    console.log(sanitizedCeremonyResult(result));
    console.log('CEREMONY_STATUS=PASS');
  } finally {
    await prisma.$disconnect();
  }
}

// Only when executed directly. A governance ceremony must never begin merely
// because some other module imported this file — an unguarded call would open a
// PrismaClient and query database identity on import, and with a matching argv
// would run the ceremony itself. Same guard, same reason, as the provisioner.
if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
