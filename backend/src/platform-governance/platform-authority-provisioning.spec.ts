// PLATFORM GOVERNANCE — PRODUCTION AUTHORITY PROVISIONING.
//
// The provisioner writes the VOCABULARY and nothing else. These prove the two
// halves of that sentence: that the three authorities are created idempotently
// and correctly, and that provisioning them grants nobody anything.
//
// The production database does not exist in this environment, so what is proven
// here is the CODE PATH — including that it refuses every database that is not
// production. The report says so plainly rather than calling this a production
// execution proof.

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  EXPECTED_DATABASE,
  PLATFORM_AUTHORITY_DEFINITIONS,
  assertProductionDatabase,
  provisionPlatformAuthorities,
} from '../../prisma/seed-platform-authorities';
import { PLATFORM_GOVERNANCE_AUTHORITIES } from './platform-governance.service';

/** A database that answers whatever name the test gives it. */
const clientFor = (
  databaseName: string,
  over: Record<string, unknown> = {},
) => {
  const rows: Array<{ id: string; code: string }> = [];
  return {
    $queryRaw: jest.fn(async () => [{ current_database: databaseName }]),
    authority: {
      upsert: jest.fn(async ({ where, create }: any) => {
        const existing = rows.find((r) => r.code === where.code);
        if (existing) return existing;
        // The real column is globally unique, so a second row for one code is
        // unrepresentable. The fake honours that rather than pretending.
        const row = { id: `auth-${rows.length + 1}`, code: create.code };
        rows.push(row);
        return row;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        rows.filter((r) => where.code.in.includes(r.code)),
      ),
    },
    positionAuthority: { count: jest.fn(async () => 0) },
    approvalMatrix: { count: jest.fn(async () => 0) },
    platformGovernanceDecision: { count: jest.fn(async () => 0) },
    ...over,
  };
};

describe('Platform authority production provisioning', () => {
  // ── A / C — exactly the three canonical codes ───────────────────────────

  it('A/C. provisions exactly the three Owner-locked codes, once each', async () => {
    const client = clientFor(EXPECTED_DATABASE);
    const result = await provisionPlatformAuthorities(client as never);

    expect(result.provisioned).toEqual([
      'PLATFORM_KNOWLEDGE_ADMIT',
      'PLATFORM_KNOWLEDGE_PUBLISH',
      'PLATFORM_KNOWLEDGE_WITHDRAW',
    ]);
    expect(result.authorityRowCount).toBe(3);
    expect(client.authority.upsert).toHaveBeenCalledTimes(3);
  });

  it('the definitions come from the ONE place the vocabulary is defined', () => {
    // Not a retyped literal list: a second list is a second vocabulary the day
    // someone edits one and forgets the other.
    expect(PLATFORM_AUTHORITY_DEFINITIONS.map((d) => d.code)).toEqual(
      Object.values(PLATFORM_GOVERNANCE_AUTHORITIES),
    );
    const source = readFileSync(
      join(__dirname, '..', '..', 'prisma', 'seed-platform-authorities.ts'),
      'utf8',
    );
    expect(source).toContain(
      "import { PLATFORM_GOVERNANCE_AUTHORITIES } from '../src/platform-governance/platform-governance.service'",
    );
  });

  // ── B — idempotent ──────────────────────────────────────────────────────

  it('B/C. re-running provisions no duplicate and stays at three', async () => {
    const client = clientFor(EXPECTED_DATABASE);
    const first = await provisionPlatformAuthorities(client as never);
    const second = await provisionPlatformAuthorities(client as never);
    const third = await provisionPlatformAuthorities(client as never);

    for (const run of [first, second, third]) {
      expect(run.authorityRowCount).toBe(3);
    }
    // Upsert keyed on the globally-unique code — nine calls, three rows.
    expect(client.authority.upsert).toHaveBeenCalledTimes(9);
    for (const call of client.authority.upsert.mock.calls) {
      expect(call[0].where).toHaveProperty('code');
    }
  });

  // ── D / E / F / G / H — what provisioning must NOT do ───────────────────

  it('D/E/F. creates no Position, ApprovalMatrix, workspace, Role or Permission', async () => {
    const client = clientFor(EXPECTED_DATABASE);
    await provisionPlatformAuthorities(client as never);

    const source = readFileSync(
      join(__dirname, '..', '..', 'prisma', 'seed-platform-authorities.ts'),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');

    // The ONLY write in the whole file.
    expect(source).toContain('authority.upsert');
    for (const forbidden of [
      'positionAuthority.create',
      'positionAuthority.upsert',
      'approvalMatrix.create',
      'approvalMatrix.upsert',
      'role.create',
      'role.upsert',
      'permission.create',
      'permission.upsert',
      'workspaceId',
      'positionId',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('G/H. creates no PlatformGovernanceDecision — nobody is granted anything', async () => {
    const client = clientFor(EXPECTED_DATABASE);
    const result = await provisionPlatformAuthorities(client as never);

    // The file may READ the decision count to report it; it must never write one.
    const source = readFileSync(
      join(__dirname, '..', '..', 'prisma', 'seed-platform-authorities.ts'),
      'utf8',
    );
    expect(source).not.toMatch(
      /platformGovernanceDecision\.(create|createMany|update|upsert|delete)/,
    );
    expect(result.governanceDecisionCount).toBe(0);
    // And no Account is touched at all: the word does not appear as a writer.
    expect(source).not.toMatch(/account\.(create|update|upsert)/);
  });

  it('H. no Owner, DIRECTOR, first or system account is named anywhere', async () => {
    const source = readFileSync(
      join(__dirname, '..', '..', 'prisma', 'seed-platform-authorities.ts'),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    for (const forbidden of ['DIRECTOR', 'SUPER_ADMIN', 'holderAccountId', 'findFirst']) {
      expect(source).not.toContain(forbidden);
    }
  });

  // ── I / J — the database identity guard ─────────────────────────────────

  it('I. refuses any database that is not production', async () => {
    for (const wrong of ['simprok_monitoring_audit', 'postgres', 'simprok_dev', '']) {
      const client = clientFor(wrong);
      await expect(provisionPlatformAuthorities(client as never)).rejects.toThrow(
        `STOP: expected ${EXPECTED_DATABASE}, got`,
      );
      // Refused BEFORE any write.
      expect(client.authority.upsert).not.toHaveBeenCalled();
    }
  });

  it('J. the E2E database can never be mistaken for production', async () => {
    const client = clientFor('simprok_e2e');
    await expect(provisionPlatformAuthorities(client as never)).rejects.toThrow(
      'STOP: expected simprok_db, got simprok_e2e',
    );
    expect(client.authority.upsert).not.toHaveBeenCalled();
  });

  it('asks the SERVER which database it is in, not the connection string', async () => {
    // A URL can be edited; `current_database()` is the answer the writes would
    // actually land in.
    const client = clientFor(EXPECTED_DATABASE);
    await assertProductionDatabase(client as never);
    expect(client.$queryRaw).toHaveBeenCalled();
    const source = readFileSync(
      join(__dirname, '..', '..', 'prisma', 'seed-platform-authorities.ts'),
      'utf8',
    );
    expect(source).toContain('SELECT current_database()');
    expect(source).not.toContain('parse(process.env.DATABASE_URL');
  });

  // ── fail closed on unexpected state ─────────────────────────────────────

  it('fails closed when a platform authority has acquired a Position binding', async () => {
    const client = clientFor(EXPECTED_DATABASE, {
      positionAuthority: { count: jest.fn(async () => 1) },
    });
    await expect(provisionPlatformAuthorities(client as never)).rejects.toThrow(
      'STOP_UNEXPECTED_POSITION_BINDING',
    );
  });

  it('fails closed when a platform authority has acquired an ApprovalMatrix', async () => {
    const client = clientFor(EXPECTED_DATABASE, {
      approvalMatrix: { count: jest.fn(async () => 2) },
    });
    await expect(provisionPlatformAuthorities(client as never)).rejects.toThrow(
      'STOP_UNEXPECTED_APPROVAL_BINDING',
    );
  });

  it('does NOT fail merely because a lawful ceremony already granted something', async () => {
    // Re-running the provisioner on a live system must not break because a
    // governance grant exists. It reports the count; it does not police it.
    const client = clientFor(EXPECTED_DATABASE, {
      platformGovernanceDecision: { count: jest.fn(async () => 4) },
    });
    const result = await provisionPlatformAuthorities(client as never);
    expect(result.governanceDecisionCount).toBe(4);
  });

  it('is not executed merely by importing it', () => {
    const source = readFileSync(
      join(__dirname, '..', '..', 'prisma', 'seed-platform-authorities.ts'),
      'utf8',
    );
    // Guarded by require.main, so this very spec's import provisions nothing.
    expect(source).toContain('if (require.main === module)');
  });
});
