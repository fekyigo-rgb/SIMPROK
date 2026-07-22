import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  applyProductionActivation,
  assertApplyPrerequisites,
  planProductionActivation,
  RM01B_PERMISSION_METADATA,
  targetFromEnvironment,
  type Rm01bSqlClient,
} from './rm01b-production-permission-activation';

const target = {
  workspaceId: '10000000-0000-4000-8000-000000000004',
  organizationId: '10000000-0000-4000-8000-000000000002',
  roleId: '20000000-0000-4000-8000-000000000001',
  roleCode: 'DIRECTOR' as const,
};

function mockClient(
  options: {
    database?: string;
    roles?: unknown[];
    permissions?: unknown[];
    nonTarget?: unknown[];
  } = {},
): Rm01bSqlClient & { query: jest.Mock } {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('current_database'))
      return {
        rows: [{ current_database: options.database ?? 'simprok_db' }],
        rowCount: 1,
      };
    if (sql.includes('FROM roles r')) {
      const rows = options.roles ?? [
        {
          id: target.roleId,
          workspaceId: target.workspaceId,
          organizationId: target.organizationId,
          code: 'DIRECTOR',
        },
      ];
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('FROM permissions p WHERE')) {
      const rows = options.permissions ?? [];
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('NOT (p.code')) {
      const rows = options.nonTarget ?? [];
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith('INSERT INTO')) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  return { query };
}

describe('RM01B production permission activation (mock-only)', () => {
  it('rejects non-simprok_db and rolls back', async () => {
    const db = mockClient({ database: 'simprok_test' });
    await expect(planProductionActivation(db, target)).rejects.toThrow(
      'STOP_DATABASE_IDENTITY_MISMATCH',
    );
    expect(db.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it.each(['', 'not-a-uuid'])(
    'rejects empty or malformed workspaceId %p',
    async (workspaceId) => {
      await expect(
        planProductionActivation(mockClient(), { ...target, workspaceId }),
      ).rejects.toThrow(/TARGET_WORKSPACE_ID/);
    },
  );

  it('has fixed DIRECTOR target and exact permission set without an arbitrary array', () => {
    expect(() =>
      targetFromEnvironment({
        RM01B_TARGET_WORKSPACE_ID: target.workspaceId,
        RM01B_EXPECTED_ORGANIZATION_ID: target.organizationId,
        RM01B_EXPECTED_ROLE_ID: target.roleId,
      }),
    ).not.toThrow();
    expect(RM01B_PERMISSION_METADATA.map((item) => item.code).sort()).toEqual([
      'RAB_DRAFT_EDIT',
      'RAB_VIEW',
    ]);
    expect(Object.keys(target)).not.toContain('permissionCodes');
  });

  it('stops with zero writes for no role or multiple roles', async () => {
    for (const roles of [[], [{}, {}]]) {
      const db = mockClient({ roles });
      await expect(planProductionActivation(db, target)).rejects.toThrow(
        /STOP_(TARGET_ROLE_NOT_FOUND|MULTIPLE_TARGET_ROLES)/,
      );
      expect(
        db.query.mock.calls.some(([sql]) => String(sql).startsWith('INSERT')),
      ).toBe(false);
    }
  });

  it('stops on workspace or organization mismatch', async () => {
    const db = mockClient({
      roles: [
        {
          id: target.roleId,
          workspaceId: target.workspaceId,
          organizationId: '30000000-0000-4000-8000-000000000001',
          code: 'DIRECTOR',
        },
      ],
    });
    await expect(planProductionActivation(db, target)).rejects.toThrow(
      'STOP_TARGET_WORKSPACE_ORGANIZATION_ROLE_DRIFT',
    );
  });

  it('stops on canonical metadata conflict without UPDATE', async () => {
    const db = mockClient({
      permissions: [
        {
          id: 'p',
          code: 'RAB_VIEW',
          name: 'Wrong',
          description: 'Wrong',
          granted: false,
        },
      ],
    });
    await expect(planProductionActivation(db, target)).rejects.toThrow(
      'STOP_PERMISSION_METADATA_CONFLICT_RAB_VIEW',
    );
    expect(
      db.query.mock.calls.some(([sql]) => /UPDATE/i.test(String(sql))),
    ).toBe(false);
  });

  it('requires exact confirmation and backup proof before a write transaction', async () => {
    await expect(
      assertApplyPrerequisites({ RM01B_CONFIRM: 'yes' }),
    ).rejects.toThrow('STOP_APPLY_CONFIRMATION_MISMATCH');
    await expect(
      assertApplyPrerequisites({
        RM01B_CONFIRM: 'RM01B_APPLY',
        RM01B_OWNER_AUTHORIZATION_ID: 'owner',
        DATABASE_URL: 'redacted',
        RM01B_EXPECTED_PLAN_SHA256: 'a'.repeat(64),
        RM01B_BACKUP_SHA256: 'b'.repeat(64),
        RM01B_BACKUP_FILE: path.join(os.tmpdir(), 'absent-rm01b'),
      }),
    ).rejects.toThrow('STOP_BACKUP_MISSING_OR_EMPTY');
  });

  it('rejects backup hash mismatch', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm01b-'));
    const backup = path.join(dir, 'backup.bin');
    fs.writeFileSync(backup, 'safe-test-backup');
    await expect(
      assertApplyPrerequisites({
        RM01B_CONFIRM: 'RM01B_APPLY',
        RM01B_OWNER_AUTHORIZATION_ID: 'owner',
        DATABASE_URL: 'redacted',
        RM01B_EXPECTED_PLAN_SHA256: 'a'.repeat(64),
        RM01B_BACKUP_SHA256: 'b'.repeat(64),
        RM01B_BACKUP_FILE: backup,
      }),
    ).rejects.toThrow('STOP_BACKUP_SHA256_MISMATCH');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rolls back on reviewed plan hash drift before writes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm01b-'));
    const backup = path.join(dir, 'backup.bin');
    fs.writeFileSync(backup, 'backup');
    const db = mockClient();
    await expect(
      applyProductionActivation(db, {
        RM01B_TARGET_WORKSPACE_ID: target.workspaceId,
        RM01B_EXPECTED_ORGANIZATION_ID: target.organizationId,
        RM01B_EXPECTED_ROLE_ID: target.roleId,
        RM01B_EXPECTED_PLAN_SHA256: 'a'.repeat(64),
        RM01B_CONFIRM: 'RM01B_APPLY',
        RM01B_BACKUP_FILE: backup,
        RM01B_BACKUP_SHA256: createHash('sha256')
          .update('backup')
          .digest('hex'),
        RM01B_OWNER_AUTHORIZATION_ID: 'owner-auth',
        DATABASE_URL: 'redacted',
      }),
    ).rejects.toThrow('STOP_PLAN_SHA256_DRIFT');
    expect(db.query).toHaveBeenCalledWith('ROLLBACK');
    expect(
      db.query.mock.calls.some(([sql]) => String(sql).startsWith('INSERT')),
    ).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes only permissions and role_permissions and never role mutations', async () => {
    const result = await planProductionActivation(mockClient(), target);
    expect(result.plan.expectedChanges).toBe(4);
    const source = fs.readFileSync(
      __filename.replace('.spec.ts', '.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/\b(DELETE|REVOKE)\b/);
    expect(source).not.toMatch(
      /\bUPDATE\s+(roles|permissions|role_permissions)\b/i,
    );
    expect(source).not.toMatch(/INSERT INTO roles/i);
  });

  it('re-plan is zero-change and non-target fingerprint is stable', async () => {
    const permissions = RM01B_PERMISSION_METADATA.map((item, index) => ({
      id: `p-${index}`,
      ...item,
      granted: true,
    }));
    const db = mockClient({
      permissions,
      nonTarget: [{ code: 'PROJECT_VIEW', permissionId: 'p-other' }],
    });
    const first = await planProductionActivation(db, target);
    const second = await planProductionActivation(db, target);
    expect(first.plan.expectedChanges).toBe(0);
    expect(second.plan.nonTargetGrantFingerprint).toBe(
      first.plan.nonTargetGrantFingerprint,
    );
  });

  it('canonical output is sanitized', async () => {
    expect(
      JSON.stringify(await planProductionActivation(mockClient(), target)),
    ).not.toMatch(/DATABASE_URL|password|token|postgresql:\/\//i);
  });
});
