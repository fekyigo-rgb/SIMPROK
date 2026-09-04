/**
 * RBAC-table backup for BP-PROVISIONING-02 (read-only dump).
 * DATABASE_URL + BP02_BACKUP_OUT required. Never prints secrets.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Client } from 'pg';
import {
  assertPermanentAppTarget,
  parsePermanentAppUrl,
} from '../../src/auth/bp-provisioning-02-production-activation';

const TABLES = [
  'permissions',
  'roles',
  'role_permissions',
  'accounts',
  'workspace_memberships',
  'users',
  'membership_roles',
] as const;

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  const out = process.env.BP02_BACKUP_OUT?.trim();
  if (!connectionString) throw new Error('STOP_MISSING_DATABASE_URL');
  if (!out) throw new Error('STOP_MISSING_BP02_BACKUP_OUT');
  assertPermanentAppTarget(parsePermanentAppUrl(connectionString));

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const payload: Record<string, unknown> = {
      capturedAt: new Date().toISOString(),
      target: (() => {
        const u = new URL(connectionString);
        return {
          role: u.username,
          host: u.hostname,
          port: Number(u.port),
          database: u.pathname.replace(/^\//, '').split('?')[0],
        };
      })(),
      tables: {} as Record<string, unknown[]>,
    };
    for (const table of TABLES) {
      const result = await client.query(`SELECT * FROM "${table}" ORDER BY 1`);
      (payload.tables as Record<string, unknown[]>)[table] = result.rows.map(
        (row) => {
          const copy: Record<string, unknown> = { ...row };
          if ('passwordHash' in copy) copy.passwordHash = '<redacted>';
          return copy;
        },
      );
    }
    const json = `${JSON.stringify(payload, null, 2)}\n`;
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, json, { encoding: 'utf8', mode: 0o600 });
    const sha = createHash('sha256').update(json, 'utf8').digest('hex');
    process.stdout.write(`BACKUP_FILE=${out}\nBACKUP_SHA256=${sha}\n`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'STOP_UNKNOWN_ERROR'}\n`,
  );
  process.exitCode = 1;
});
