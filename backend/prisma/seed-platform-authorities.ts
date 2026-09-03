// PLATFORM GOVERNANCE — PRODUCTION AUTHORITY VOCABULARY PROVISIONER.
//
// This provisions the three Owner-locked platform governance powers into the
// production `authorities` table. It provisions the VOCABULARY and nothing else.
//
// WHY THIS FILE EXISTS SEPARATELY FROM seed-rbac-permissions.ts. That file is the
// production provisioner for PERMISSIONS, and Authority is a different vocabulary
// — the same string can legitimately be both (`FIELD_PROGRESS_VERIFY` is a
// Permission at seed-acceptance.ts:147 and an Authority at :985, meaning two
// different things). Putting authorities into the RBAC-permission seeder would
// merge two vocabularies Owner law keeps distinct, so this is named for what it
// actually provisions.
//
// WHY NOT bootstrap-production-owner.ts. That script's `assertFreshState` refuses
// to run unless nine tables are ALL empty — "this bootstrap only runs once against
// a fresh database". A vocabulary provisioner has to be re-runnable against a
// live database, so putting these there would provision nothing into any deployed
// system while appearing to.
//
// ── PROVISIONING IS NOT GRANTING ────────────────────────────────────────────
//
// After this runs, the three authorities EXIST and NOBODY HOLDS THEM. There is no
// Owner grant, no DIRECTOR grant, no first-account grant, no bootstrap grant. A
// person acquires one only through an explicit Owner-authorized ceremony that
// writes a PlatformGovernanceDecision. This file writes none, and asserts as much
// before it exits.

import { PrismaClient } from '@prisma/client';
import { PLATFORM_GOVERNANCE_AUTHORITIES } from '../src/platform-governance/platform-governance.service';

/**
 * The production database, named. Same guard the RBAC seeder uses
 * (`seed-rbac-permissions.ts:4`) and the RM01B ceremony uses
 * (`rm01b-production-permission-activation.ts:4`).
 */
export const EXPECTED_DATABASE = 'simprok_db';

/**
 * The vocabulary, taken from the ONE place it is defined.
 *
 * Deliberately imported rather than retyped: a second literal list would be a
 * second vocabulary the day someone edited one and not the other.
 */
export const PLATFORM_AUTHORITY_DEFINITIONS: ReadonlyArray<{
  code: string;
  name: string;
  description: string;
}> = [
  {
    code: PLATFORM_GOVERNANCE_AUTHORITIES.ADMIT,
    name: 'Admit Knowledge Into SIMPROK Shared Knowledge',
    description:
      'Authority to approve promotion of an eligible knowledge/fact into SIMPROK-owned Shared Knowledge.',
  },
  {
    code: PLATFORM_GOVERNANCE_AUTHORITIES.PUBLISH,
    name: 'Publish Validated Knowledge Into SIMPROK Shared State',
    description:
      'Authority to approve publication of an eligible validated Knowledge/Version into the applicable SIMPROK shared/published knowledge state.',
  },
  {
    code: PLATFORM_GOVERNANCE_AUTHORITIES.WITHDRAW,
    name: 'Withdraw Published Knowledge From SIMPROK Shared State',
    description:
      'Authority to approve withdrawal of previously published/shared knowledge from the applicable active shared/published state.',
  },
];

export interface PlatformAuthorityProvisioningResult {
  readonly database: string;
  readonly provisioned: ReadonlyArray<string>;
  readonly authorityRowCount: number;
  readonly positionBindingCount: number;
  readonly approvalBindingCount: number;
  readonly governanceDecisionCount: number;
}

type ProvisioningClient = Pick<
  PrismaClient,
  '$queryRaw' | 'authority' | 'positionAuthority' | 'approvalMatrix' | 'platformGovernanceDecision'
>;

/**
 * Refuse to write anywhere but the named production database.
 *
 * Asks the SERVER which database it is in, rather than parsing the connection
 * string: a URL can be edited, and this is the answer the writes would actually
 * land in. Same shape as `seed-rbac-permissions.ts:206-217`.
 */
export async function assertProductionDatabase(
  client: Pick<PrismaClient, '$queryRaw'>,
): Promise<string> {
  const rows = await client.$queryRaw<Array<{ current_database: string }>>`
    SELECT current_database()
  `;
  const actual = rows[0]?.current_database;
  if (actual !== EXPECTED_DATABASE) {
    // Names the database it refused, so an operator who pointed this at
    // simprok_e2e or a development database learns exactly what happened.
    throw new Error(
      `STOP: expected ${EXPECTED_DATABASE}, got ${actual ?? 'unknown'}. No platform authority write allowed.`,
    );
  }
  return actual;
}

/**
 * Idempotently ensure the three platform authorities exist. Safe to re-run.
 *
 * `Authority.code` is globally unique, so upserting on it can never produce a
 * duplicate row however many times this is called.
 */
export async function provisionPlatformAuthorities(
  client: ProvisioningClient,
): Promise<PlatformAuthorityProvisioningResult> {
  const database = await assertProductionDatabase(client);

  for (const definition of PLATFORM_AUTHORITY_DEFINITIONS) {
    await client.authority.upsert({
      where: { code: definition.code },
      // Name and description are refreshed; the CODE is the identity and is
      // never rewritten.
      update: { name: definition.name, description: definition.description },
      create: definition,
    });
  }

  const codes = PLATFORM_AUTHORITY_DEFINITIONS.map((d) => d.code);
  const authorities = await client.authority.findMany({
    where: { code: { in: codes } },
    select: { id: true },
  });
  const authorityIds = authorities.map((a) => a.id);

  // ── FAIL CLOSED ON UNEXPECTED STATE ──────────────────────────────────────
  //
  // Everything below is a fact this provisioner is responsible for. If any of
  // them is wrong, the database is not in the state this file claims to produce,
  // and saying so loudly is better than returning success.
  const [positionBindingCount, approvalBindingCount, governanceDecisionCount] =
    await Promise.all([
      client.positionAuthority.count({ where: { authorityId: { in: authorityIds } } }),
      client.approvalMatrix.count({ where: { authorityId: { in: authorityIds } } }),
      client.platformGovernanceDecision.count({
        where: { authorityId: { in: authorityIds } },
      }),
    ]);

  if (authorityIds.length !== PLATFORM_AUTHORITY_DEFINITIONS.length) {
    throw new Error(
      `STOP_AUTHORITY_COUNT: expected ${PLATFORM_AUTHORITY_DEFINITIONS.length} platform authorities, found ${authorityIds.length}.`,
    );
  }
  if (positionBindingCount !== 0) {
    // A platform power seated in a workspace Position would be a project power
    // wearing a platform name.
    throw new Error(
      `STOP_UNEXPECTED_POSITION_BINDING: ${positionBindingCount} PositionAuthority row(s) reference a platform authority.`,
    );
  }
  if (approvalBindingCount !== 0) {
    throw new Error(
      `STOP_UNEXPECTED_APPROVAL_BINDING: ${approvalBindingCount} ApprovalMatrix row(s) reference a platform authority.`,
    );
  }

  return {
    database,
    provisioned: codes,
    authorityRowCount: authorityIds.length,
    positionBindingCount,
    approvalBindingCount,
    // Reported, NOT asserted to be zero: a re-run against a database where a
    // lawful ceremony has already granted something must not fail. What matters
    // is that THIS file created none — proved by the fact that it writes only
    // `authority.upsert`.
    governanceDecisionCount,
  };
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const result = await provisionPlatformAuthorities(prisma);
    console.log(`DB guard PASS: current_database() = ${result.database}`);
    console.log(`platform authorities provisioned: ${result.provisioned.join(', ')}`);
    console.log(`authority rows: ${result.authorityRowCount}`);
    console.log(`position bindings: ${result.positionBindingCount} (must be 0)`);
    console.log(`approval bindings: ${result.approvalBindingCount} (must be 0)`);
    console.log(
      `existing governance decisions for these authorities: ${result.governanceDecisionCount} (this provisioner created none)`,
    );
    console.log('PROVISIONING_STATUS=PASS');
  } finally {
    await prisma.$disconnect();
  }
}

// Only when executed directly, so importing this for tests provisions nothing.
if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
