import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { Bp02SqlClient } from './bp-provisioning-02-production-activation';
import {
  IQL01_SECOND_HOLDER_CONFIRMATION,
  IQL01_SECOND_HOLDER_PERMISSION_CODE,
  IQL01_SECOND_HOLDER_ROLE_CODE,
  applyIql01SecondHolderActivation,
  assertIql01SecondHolderApplyPrerequisites,
  iql01SecondHolderTargetFromEnvironment,
  planIql01SecondHolderActivation,
} from './iql01-second-holder-activation';

const target = {
  workspaceId: '10000000-0000-4000-8000-000000000004',
  organizationId: '10000000-0000-4000-8000-000000000002',
};
const PERMANENT_URL =
  'postgresql://simprok_app:secret@127.0.0.1:55432/simprok_db?schema=public';

interface MockState {
  role?: string;
  roles?: Array<{ id: string }>;
  heldCodes?: string[];
  permissionId?: string | null;
  granted?: boolean;
  grantedElsewhere?: string[];
  holders?: Array<{ accountId: string; email: string }>;
  holdersCanTeach?: number;
}

/** A stateful stand-in for pg: it remembers what the activation inserted. */
function mockClient(options: MockState = {}) {
  const state = {
    permissionId:
      options.permissionId === undefined ? null : options.permissionId,
    granted: options.granted ?? false,
  };
  const statements: string[] = [];
  const route = (sql: string, values?: readonly unknown[]) => {
    const text = String(sql).replace(/\s+/g, ' ');
    statements.push(text);
    const rows = <T>(r: T[]) => ({ rows: r, rowCount: r.length });
    if (/^(BEGIN|ROLLBACK|COMMIT)/.test(text)) return rows([]);
    if (text.includes('current_database'))
      return rows([
        {
          current_database: 'simprok_db',
          server_host: '127.0.0.1',
          server_port: 55432,
          session_role: options.role ?? 'simprok_app',
        },
      ]);
    if (text.includes('FROM workspaces'))
      return rows([
        { id: target.workspaceId, organizationId: target.organizationId },
      ]);
    if (text.includes('FROM roles WHERE'))
      return rows(options.roles ?? [{ id: 'role-verifier' }]);
    if (text.includes('SELECT p.code FROM role_permissions'))
      return rows(
        (
          options.heldCodes ?? ['BASIC_PRICE_REVIEW_VIEW', 'BASIC_PRICE_VERIFY']
        ).map((code) => ({ code })),
      );
    if (text.includes('FROM permissions WHERE code'))
      return rows(state.permissionId ? [{ id: state.permissionId }] : []);
    if (text.includes('SELECT 1 FROM role_permissions'))
      return rows(state.granted ? [{ '?column?': 1 }] : []);
    if (text.includes('SELECT r.code FROM role_permissions'))
      return rows((options.grantedElsewhere ?? []).map((code) => ({ code })));
    if (text.includes('DISTINCT a.id'))
      return rows(
        options.holders ?? [
          { accountId: 'acct-verifier', email: 'bp.verifier@example.local' },
        ],
      );
    if (text.includes('count(*)::text AS cnt'))
      return rows([{ cnt: String(options.holdersCanTeach ?? 0) }]);
    if (text.startsWith('INSERT INTO permissions')) {
      expect(values?.[1]).toBe(IQL01_SECOND_HOLDER_PERMISSION_CODE);
      state.permissionId = String(values?.[0]);
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith('INSERT INTO role_permissions')) {
      expect(values?.[1]).toBe('role-verifier');
      state.granted = true;
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`unexpected SQL in mock: ${text}`);
  };
  const query = jest.fn((sql: string, values?: readonly unknown[]) =>
    Promise.resolve(route(sql, values)),
  );
  return {
    client: { query } as unknown as Bp02SqlClient,
    query,
    statements,
    state,
  };
}

function backupFile(): { file: string; sha: string } {
  const file = path.join(os.tmpdir(), `iql01sh-backup-${process.pid}.dump`);
  fs.writeFileSync(file, 'pre-activation backup bytes');
  return {
    file,
    sha: createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
  };
}

function applyEnv(planSha: string) {
  const backup = backupFile();
  return {
    IQL01SH_TARGET_WORKSPACE_ID: target.workspaceId,
    IQL01SH_EXPECTED_ORGANIZATION_ID: target.organizationId,
    IQL01SH_EXPECTED_PLAN_SHA256: planSha,
    IQL01SH_CONFIRM: IQL01_SECOND_HOLDER_CONFIRMATION,
    IQL01SH_BACKUP_FILE: backup.file,
    IQL01SH_BACKUP_SHA256: backup.sha,
    IQL01SH_OWNER_AUTHORIZATION_ID: 'OWNER-IQL01-SECOND-HOLDER',
    DATABASE_URL: PERMANENT_URL,
  };
}

describe('IQL-01 second-holder activation (mock-only)', () => {
  it('targets exactly the EXISTING verifier role and the one judging code', () => {
    expect(IQL01_SECOND_HOLDER_ROLE_CODE).toBe('BASIC_PRICE_VERIFIER');
    expect(IQL01_SECOND_HOLDER_PERMISSION_CODE).toBe(
      'AHSP_RESOURCE_IDENTITY_QUESTION_APPROVE',
    );
  });

  it('plans read-only: one permission + one grant, the verifier holders named, rolled back', async () => {
    const { client, statements } = mockClient();
    const hashed = await planIql01SecondHolderActivation(client, target);
    expect(hashed.plan).toMatchObject({
      permissionAction: 'INSERT_PERMISSION',
      grantAction: 'INSERT_ROLE_PERMISSION',
      roleCode: 'BASIC_PRICE_VERIFIER',
      roleId: 'role-verifier',
      holders: [
        { accountId: 'acct-verifier', email: 'bp.verifier@example.local' },
      ],
      expectedChanges: 2,
    });
    expect(hashed.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(statements[0]).toMatch(/READ ONLY/);
    expect(statements.at(-1)).toBe('ROLLBACK');
    expect(statements.some((s) => s.startsWith('INSERT'))).toBe(false);
  });

  it.each([
    [
      'the verifier role does not exist (a role is never created)',
      { roles: [] },
      'STOP_SECOND_HOLDER_ROLE_NOT_FOUND',
    ],
    [
      'the verifier role is ambiguous',
      { roles: [{ id: 'a' }, { id: 'b' }] },
      'STOP_SECOND_HOLDER_ROLE_AMBIGUOUS',
    ],
    [
      'the verifier role could publish',
      { heldCodes: ['BASIC_PRICE_VERIFY', 'BASIC_PRICE_PUBLISH'] },
      'STOP_VERIFIER_ROLE_HAS_PUBLISH',
    ],
    [
      'the verifier role could teach',
      { heldCodes: ['BASIC_PRICE_VERIFY', 'AHSP_RESOURCE_IDENTITY_DECIDE'] },
      'STOP_VERIFIER_ROLE_CAN_TEACH',
    ],
    [
      'nobody holds the verifier role (an account is never created)',
      { holders: [] },
      'STOP_SECOND_HOLDER_HAS_NO_ACTIVE_HOLDER',
    ],
    [
      'a verifier could also teach through another role',
      { holdersCanTeach: 1 },
      'STOP_SECOND_HOLDER_CAN_ALSO_TEACH',
    ],
    [
      'the code already reached the publisher or DIRECTOR',
      {
        permissionId: 'perm-judge',
        grantedElsewhere: ['BASIC_PRICE_PUBLISHER', 'DIRECTOR'],
      },
      'STOP_CODE_ALREADY_GRANTED_TO_OTHER_ROLE:BASIC_PRICE_PUBLISHER,DIRECTOR',
    ],
  ])('refuses to plan when %s', async (_label, options, code) => {
    const { client, statements } = mockClient(options);
    await expect(
      planIql01SecondHolderActivation(client, target),
    ).rejects.toThrow(code);
    expect(statements.at(-1)).toBe('ROLLBACK');
  });

  it('refuses a live connection that is not the permanent app role', async () => {
    const { client } = mockClient({ role: 'simprok_migrator' });
    await expect(
      planIql01SecondHolderActivation(client, target),
    ).rejects.toThrow('STOP_LIVE_ROLE_MISMATCH');
  });

  it('refuses to apply without confirmation, authorization, a permanent target or a matching backup', async () => {
    const env = applyEnv('a'.repeat(64));
    await expect(
      assertIql01SecondHolderApplyPrerequisites({
        ...env,
        IQL01SH_CONFIRM: 'yes',
      }),
    ).rejects.toThrow('STOP_APPLY_CONFIRMATION_MISMATCH');
    await expect(
      assertIql01SecondHolderApplyPrerequisites({
        ...env,
        IQL01SH_OWNER_AUTHORIZATION_ID: '',
      }),
    ).rejects.toThrow('STOP_MISSING_OWNER_AUTHORIZATION_ID');
    await expect(
      assertIql01SecondHolderApplyPrerequisites({
        ...env,
        DATABASE_URL: PERMANENT_URL.replace('55432', '5432'),
      }),
    ).rejects.toThrow('STOP_PORT_MISMATCH');
    await expect(
      assertIql01SecondHolderApplyPrerequisites({
        ...env,
        IQL01SH_BACKUP_SHA256: 'b'.repeat(64),
      }),
    ).rejects.toThrow('STOP_BACKUP_SHA256_MISMATCH');
    expect(() =>
      iql01SecondHolderTargetFromEnvironment({
        IQL01SH_TARGET_WORKSPACE_ID: 'not-a-uuid',
        IQL01SH_EXPECTED_ORGANIZATION_ID: target.organizationId,
      }),
    ).toThrow('STOP_INVALID_TARGET_WORKSPACE_ID');
  });

  it('rolls back before any write when the plan drifted from the reviewed one', async () => {
    const { client, statements } = mockClient();
    await expect(
      applyIql01SecondHolderActivation(client, applyEnv('c'.repeat(64))),
    ).rejects.toThrow('STOP_PLAN_SHA256_DRIFT');
    expect(statements.some((s) => s.startsWith('INSERT'))).toBe(false);
    expect(statements.at(-1)).toBe('ROLLBACK');
  });

  it('applies exactly ONE permission and ONE grant, proves the result, commits', async () => {
    const reviewed = await planIql01SecondHolderActivation(
      mockClient().client,
      target,
    );
    const { client, statements, state } = mockClient();
    const result = await applyIql01SecondHolderActivation(
      client,
      applyEnv(reviewed.sha256),
    );
    expect(result.changesApplied).toBe(2);
    expect(result.planSha256).toBe(reviewed.sha256);
    expect(result.after.plan).toMatchObject({
      permissionAction: 'NONE',
      grantAction: 'NONE',
      expectedChanges: 0,
    });
    expect(state).toMatchObject({ granted: true });
    const writes = statements.filter((s) => /^(INSERT|UPDATE|DELETE)/.test(s));
    expect(writes.map((s) => s.split(' (')[0])).toEqual([
      'INSERT INTO permissions',
      'INSERT INTO role_permissions',
    ]);
    expect(statements[0]).toMatch(/SERIALIZABLE/);
    expect(statements.at(-1)).toBe('COMMIT');
  });

  it('is idempotent: an applied activation plans no change and writes nothing', async () => {
    const applied = { permissionId: 'perm-judge', granted: true };
    const reviewed = await planIql01SecondHolderActivation(
      mockClient(applied).client,
      target,
    );
    expect(reviewed.plan.expectedChanges).toBe(0);
    const { client, statements } = mockClient(applied);
    const result = await applyIql01SecondHolderActivation(
      client,
      applyEnv(reviewed.sha256),
    );
    expect(result.changesApplied).toBe(0);
    expect(statements.some((s) => s.startsWith('INSERT'))).toBe(false);
    expect(statements.at(-1)).toBe('COMMIT');
  });
});
