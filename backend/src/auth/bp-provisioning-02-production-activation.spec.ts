import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  applyBp02Activation,
  assertApplyPrerequisites,
  assertPermanentAppTarget,
  BP02_CONFIRMATION,
  BP02_PERMISSION_METADATA,
  BP02_PUBLISHER_PERMISSION_CODES,
  BP02_PUBLISHER_ROLE_CODE,
  BP02_VERIFIER_PERMISSION_CODES,
  BP02_VERIFIER_ROLE_CODE,
  parsePermanentAppUrl,
  planBp02Activation,
  targetFromEnvironment,
  type Bp02SqlClient,
} from './bp-provisioning-02-production-activation';

const target = {
  workspaceId: '10000000-0000-4000-8000-000000000004',
  organizationId: '10000000-0000-4000-8000-000000000002',
  verifierEmail: 'bp.verifier@example.local',
  publisherEmail: 'bp.publisher@example.local',
  verifierDisplayName: 'Verifier',
  publisherDisplayName: 'Publisher',
  ownerEmail: 'owner@example.local',
};

function mockClient(
  options: {
    database?: string;
    host?: string;
    port?: number | string;
    role?: string;
    workspace?: unknown[];
    permissions?: unknown[];
    roles?: unknown[];
    grants?: Record<string, string[]>;
    accounts?: Record<string, string>;
    memberships?: Record<string, { id: string; status: string }>;
    users?: Record<string, string>;
    membershipRoles?: Record<string, string>;
    directorCnt?: string;
    ownerCnt?: string;
  } = {},
): Bp02SqlClient & { query: jest.Mock } {
  const query = jest.fn(async (sql: string, values?: readonly unknown[]) => {
    const text = String(sql);
    if (text.includes('current_database')) {
      return {
        rows: [
          {
            current_database: options.database ?? 'simprok_db',
            server_host: options.host ?? '127.0.0.1',
            server_port: options.port ?? 55432,
            session_role: options.role ?? 'simprok_app',
          },
        ],
        rowCount: 1,
      };
    }
    if (text.includes('FROM workspaces')) {
      const rows =
        options.workspace ??
        [{ id: target.workspaceId, organizationId: target.organizationId }];
      return { rows, rowCount: rows.length };
    }
    if (text.includes('FROM permissions') && text.includes('ANY')) {
      const rows = options.permissions ?? [];
      return { rows, rowCount: rows.length };
    }
    if (text.includes('FROM roles') && text.includes('ANY')) {
      const rows = options.roles ?? [];
      return { rows, rowCount: rows.length };
    }
    if (text.includes('FROM role_permissions WHERE "roleId"')) {
      return { rows: [], rowCount: 0 };
    }
    if (text.includes('SELECT p.code FROM role_permissions')) {
      const roleId = String(values?.[0] ?? '');
      const codes = options.grants?.[roleId] ?? [];
      return { rows: codes.map((code) => ({ code })), rowCount: codes.length };
    }
    if (text.includes('FROM accounts WHERE lower(email)')) {
      const email = String(values?.[0] ?? '').toLowerCase();
      const id = options.accounts?.[email];
      return id ? { rows: [{ id }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (text.includes('FROM workspace_memberships')) {
      const accountId = String(values?.[0] ?? '');
      const m = options.memberships?.[accountId];
      return m
        ? { rows: [{ id: m.id, status: m.status }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (text.includes('FROM users WHERE')) {
      const membershipId = String(values?.[0] ?? '');
      const id = options.users?.[membershipId];
      return id ? { rows: [{ id }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (text.includes('FROM membership_roles')) {
      const key = `${values?.[0]}:${values?.[1]}`;
      const id = options.membershipRoles?.[key];
      return id ? { rows: [{ id }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (text.includes("r.code = 'DIRECTOR'")) {
      return {
        rows: [{ cnt: options.directorCnt ?? '0' }],
        rowCount: 1,
      };
    }
    if (text.includes('lower(a.email) = lower($2)')) {
      return {
        rows: [{ cnt: options.ownerCnt ?? '0' }],
        rowCount: 1,
      };
    }
    if (text.startsWith('BEGIN') || text === 'ROLLBACK' || text === 'COMMIT') {
      return { rows: [], rowCount: 0 };
    }
    if (text.startsWith('INSERT INTO')) return { rows: [], rowCount: 1 };
    if (text.startsWith('UPDATE ')) return { rows: [], rowCount: 1 };
    if (text.includes('SELECT DISTINCT p.code')) {
      const accountId = String(values?.[0] ?? '');
      if (accountId === 'acc-v') {
        return {
          rows: [
            { code: 'BASIC_PRICE_REVIEW_VIEW' },
            { code: 'BASIC_PRICE_VERIFY' },
          ],
          rowCount: 2,
        };
      }
      if (accountId === 'acc-p') {
        return {
          rows: [{ code: 'BASIC_PRICE_PUBLISH' }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  });
  return { query };
}

describe('BP-PROVISIONING-02 production activation (mock-only)', () => {
  it('rejects non-permanent database coordinates', () => {
    expect(() =>
      assertPermanentAppTarget(
        parsePermanentAppUrl(
          'postgresql://simprok_app:x@127.0.0.1:55433/simprok_db',
        ),
      ),
    ).toThrow('STOP_PORT_MISMATCH');
    expect(() =>
      assertPermanentAppTarget(
        parsePermanentAppUrl(
          'postgresql://simprok_app:x@127.0.0.1:55432/simprok_test',
        ),
      ),
    ).toThrow('STOP_DATABASE_MISMATCH');
  });

  it('rejects verifier/publisher email collision', () => {
    expect(() =>
      targetFromEnvironment({
        BP02_TARGET_WORKSPACE_ID: target.workspaceId,
        BP02_EXPECTED_ORGANIZATION_ID: target.organizationId,
        BP02_VERIFIER_EMAIL: 'same@example.local',
        BP02_PUBLISHER_EMAIL: 'same@example.local',
      }),
    ).toThrow('STOP_VERIFIER_PUBLISHER_EMAIL_COLLISION');
  });

  it('uses fixed role and permission sets only', () => {
    expect(BP02_VERIFIER_ROLE_CODE).toBe('BASIC_PRICE_VERIFIER');
    expect(BP02_PUBLISHER_ROLE_CODE).toBe('BASIC_PRICE_PUBLISHER');
    expect([...BP02_VERIFIER_PERMISSION_CODES].sort()).toEqual([
      'BASIC_PRICE_REVIEW_VIEW',
      'BASIC_PRICE_VERIFY',
    ]);
    expect([...BP02_PUBLISHER_PERMISSION_CODES]).toEqual([
      'BASIC_PRICE_PUBLISH',
    ]);
    expect(BP02_PERMISSION_METADATA.map((p) => p.code).sort()).toEqual([
      'BASIC_PRICE_PUBLISH',
      'BASIC_PRICE_REVIEW_VIEW',
      'BASIC_PRICE_VERIFY',
    ]);
  });

  it('rejects wrong live database identity and rolls back plan', async () => {
    const db = mockClient({ database: 'simprok_test' });
    await expect(planBp02Activation(db, target)).rejects.toThrow(
      'STOP_DATABASE_IDENTITY_MISMATCH',
    );
    expect(db.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('stops when verifier role already holds PUBLISH', async () => {
    const db = mockClient({
      roles: [{ id: 'role-v', code: BP02_VERIFIER_ROLE_CODE }],
      grants: { 'role-v': ['BASIC_PRICE_PUBLISH'] },
    });
    await expect(planBp02Activation(db, target)).rejects.toThrow(
      'STOP_VERIFIER_ROLE_HAS_PUBLISH',
    );
  });

  it('requires confirmation and backup before apply writes', async () => {
    await expect(
      assertApplyPrerequisites({ BP02_CONFIRM: 'yes' }),
    ).rejects.toThrow('STOP_APPLY_CONFIRMATION_MISMATCH');
    await expect(
      assertApplyPrerequisites({
        BP02_CONFIRM: BP02_CONFIRMATION,
        BP02_OWNER_AUTHORIZATION_ID: 'owner',
        DATABASE_URL: 'postgresql://simprok_app:x@127.0.0.1:55432/simprok_db',
        BP02_EXPECTED_PLAN_SHA256: 'a'.repeat(64),
        BP02_BACKUP_SHA256: 'b'.repeat(64),
        BP02_BACKUP_FILE: path.join(os.tmpdir(), 'absent-bp02'),
        BP02_SECRETS_OUT_DIR: os.tmpdir(),
      }),
    ).rejects.toThrow('STOP_BACKUP_MISSING_OR_EMPTY');
  });

  it('rolls back on plan hash drift before inserts', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp02-'));
    const backup = path.join(dir, 'backup.bin');
    fs.writeFileSync(backup, 'backup');
    const db = mockClient();
    await expect(
      applyBp02Activation(db, {
        BP02_TARGET_WORKSPACE_ID: target.workspaceId,
        BP02_EXPECTED_ORGANIZATION_ID: target.organizationId,
        BP02_VERIFIER_EMAIL: target.verifierEmail,
        BP02_PUBLISHER_EMAIL: target.publisherEmail,
        BP02_EXPECTED_PLAN_SHA256: 'a'.repeat(64),
        BP02_CONFIRM: BP02_CONFIRMATION,
        BP02_BACKUP_FILE: backup,
        BP02_BACKUP_SHA256: createHash('sha256').update('backup').digest('hex'),
        BP02_OWNER_AUTHORIZATION_ID: 'owner-auth',
        BP02_SECRETS_OUT_DIR: dir,
        DATABASE_URL: 'postgresql://simprok_app:x@127.0.0.1:55432/simprok_db',
      }),
    ).rejects.toThrow('STOP_PLAN_SHA256_DRIFT');
    expect(db.query).toHaveBeenCalledWith('ROLLBACK');
    expect(
      db.query.mock.calls.some(([sql]) => String(sql).startsWith('INSERT')),
    ).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
