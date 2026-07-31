import {
  applyRm02c3Activation,
  planRm02c3Activation,
  RM02C3_ACCEPTANCE_TARGET,
  RM02C3_CONFIRMATION_TOKEN,
  RM02C3_PERMISSION_ALLOWLIST,
  type Rm02c3SqlClient,
} from './rm02c3-basic-price-acceptance-activation';

type State = {
  databaseName: string;
  workspaceName: string;
  accountStatus: string;
  membershipIds: string[];
  permissions: Array<{ id: string; code: string }>;
  roles: Array<{
    id: string;
    workspaceId: string;
    code: string;
    isSystem: boolean;
  }>;
  rolePermissions: Array<{ roleId: string; permissionId: string }>;
  assignments: Array<{
    roleId: string;
    workspaceMembershipId: string;
    accountId: string;
    email: string;
    isActive: boolean;
    endDate: Date | null;
  }>;
};

const accountId = '20000000-0000-4000-8000-000000000001';
const membershipId = '30000000-0000-4000-8000-000000000001';

function initialState(): State {
  return {
    databaseName: 'simprok_test',
    workspaceName: 'Workspace-A',
    accountStatus: 'ACTIVE',
    membershipIds: [membershipId],
    permissions: [],
    roles: [],
    rolePermissions: [],
    assignments: [],
  };
}

class FakeClient implements Rm02c3SqlClient {
  readonly statements: string[] = [];
  writes = 0;
  private snapshot?: State;

  constructor(public state: State = initialState()) {}

  async query<T = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<{ rows: T[]; rowCount: number }> {
    this.statements.push(text);
    if (text.startsWith('BEGIN')) {
      this.snapshot = structuredClone(this.state);
      return { rows: [], rowCount: 0 };
    }
    if (text === 'ROLLBACK') {
      if (this.snapshot) this.state = this.snapshot;
      this.snapshot = undefined;
      return { rows: [], rowCount: 0 };
    }
    if (text === 'COMMIT') {
      this.snapshot = undefined;
      return { rows: [], rowCount: 0 };
    }
    if (text.includes('rm02c3:advisory-lock')) {
      return { rows: [{} as T], rowCount: 1 };
    }
    if (text.includes('rm02c3:database')) {
      return {
        rows: [{ databaseName: this.state.databaseName } as T],
        rowCount: 1,
      };
    }
    if (text.includes('rm02c3:workspace')) {
      const rows =
        values[0] === RM02C3_ACCEPTANCE_TARGET.workspaceId
          ? [
              {
                id: RM02C3_ACCEPTANCE_TARGET.workspaceId,
                name: this.state.workspaceName,
              } as T,
            ]
          : [];
      return { rows, rowCount: rows.length };
    }
    if (text.includes('rm02c3:account')) {
      return {
        rows: [{ id: accountId, status: this.state.accountStatus } as T],
        rowCount: 1,
      };
    }
    if (text.includes('rm02c3:membership')) {
      const rows = this.state.membershipIds.map((id) => ({ id }) as T);
      return { rows, rowCount: rows.length };
    }
    if (
      text.includes('rm02c3:permissions') &&
      !text.includes('insert-permission')
    ) {
      const requestedCodes = (values[0] ?? []) as string[];
      const rows = this.state.permissions.filter(({ code }) =>
        requestedCodes.includes(code),
      );
      return {
        rows: rows as T[],
        rowCount: rows.length,
      };
    }
    if (text.includes('rm02c3:role-permissions')) {
      const roleId = values[0] as string;
      const rows = this.state.rolePermissions
        .filter((row) => row.roleId === roleId)
        .map((row) => ({
          permissionId: row.permissionId,
          code: this.state.permissions.find(
            (permission) => permission.id === row.permissionId,
          )?.code,
        })) as T[];
      return { rows, rowCount: rows.length };
    }
    if (text.includes('rm02c3:role-assignments')) {
      const rows = this.state.assignments.filter(
        (row) => row.roleId === values[0],
      ) as T[];
      return { rows, rowCount: rows.length };
    }
    if (text.includes('rm02c3:role')) {
      const rows = this.state.roles
        .filter((role) => role.code === values[0])
        .map(({ id, workspaceId, isSystem }) => ({
          id,
          workspaceId,
          isSystem,
        })) as T[];
      return { rows, rowCount: rows.length };
    }
    if (text.includes('rm02c3:insert-permission')) {
      this.writes += 1;
      this.state.permissions.push({
        id: values[0] as string,
        code: values[1] as string,
      });
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('rm02c3:insert-role-permission')) {
      this.writes += 1;
      this.state.rolePermissions.push({
        roleId: values[1] as string,
        permissionId: values[2] as string,
      });
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('rm02c3:insert-membership-role')) {
      this.writes += 1;
      this.state.assignments.push({
        roleId: values[2] as string,
        workspaceMembershipId: values[1] as string,
        accountId,
        email: RM02C3_ACCEPTANCE_TARGET.accountEmail,
        isActive: true,
        endDate: null,
      });
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('rm02c3:insert-role')) {
      this.writes += 1;
      this.state.roles.push({
        id: values[0] as string,
        workspaceId: values[1] as string,
        code: values[2] as string,
        isSystem: false,
      });
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`UNHANDLED_SQL:${text}`);
  }
}

describe('RM-02C3 Basic Price acceptance permission activation', () => {
  it('plans exactly two permissions, deterministically, with zero writes', async () => {
    const client = new FakeClient();
    const first = await planRm02c3Activation(client);
    const second = await planRm02c3Activation(client);
    expect(first.planSha256).toBe(second.planSha256);
    expect(
      first.plan.actions.filter((action) =>
        action.identity.startsWith('BASIC_PRICE'),
      ),
    ).toHaveLength(2);
    expect(first.plan.expectedDelta.permissions).toBe(2);
    expect(client.writes).toBe(0);
    expect(
      client.statements.every((sql) => !/\b(INSERT|UPDATE|DELETE)\b/.test(sql)),
    ).toBe(true);
  });

  it.each([
    ['wrong database', (state: State) => (state.databaseName = 'simprok_db')],
    ['wrong workspace name', (state: State) => (state.workspaceName = 'Other')],
    ['inactive account', (state: State) => (state.accountStatus = 'SUSPENDED')],
    ['missing membership', (state: State) => (state.membershipIds = [])],
    [
      'ambiguous membership',
      (state: State) => (state.membershipIds = [membershipId, 'other']),
    ],
  ])('fails closed for %s', async (_name, mutate) => {
    const state = initialState();
    mutate(state);
    await expect(planRm02c3Activation(new FakeClient(state))).rejects.toThrow(
      /^STOP_/,
    );
  });

  it('rejects a role in another workspace', async () => {
    const state = initialState();
    state.roles.push({
      id: 'role',
      workspaceId: 'other-workspace',
      code: RM02C3_ACCEPTANCE_TARGET.roleCode,
      isSystem: false,
    });
    await expect(planRm02c3Activation(new FakeClient(state))).rejects.toThrow(
      'STOP_ROLE_EXISTS_OUTSIDE_TARGET_WORKSPACE',
    );
  });

  it('rejects a system role using the dedicated acceptance role code', async () => {
    const state = initialState();
    state.roles.push({
      id: 'system-role',
      workspaceId: RM02C3_ACCEPTANCE_TARGET.workspaceId,
      code: RM02C3_ACCEPTANCE_TARGET.roleCode,
      isSystem: true,
    });
    await expect(planRm02c3Activation(new FakeClient(state))).rejects.toThrow(
      'STOP_DEDICATED_ROLE_IS_SYSTEM_ROLE',
    );
  });

  it('rejects an unexpected third permission on the dedicated role', async () => {
    const state = initialState();
    state.permissions.push({ id: 'unexpected', code: 'BASIC_PRICE_RESOLVE' });
    state.roles.push({
      id: 'role',
      workspaceId: RM02C3_ACCEPTANCE_TARGET.workspaceId,
      code: RM02C3_ACCEPTANCE_TARGET.roleCode,
      isSystem: false,
    });
    state.rolePermissions.push({
      roleId: 'role',
      permissionId: 'unexpected',
    });
    await expect(planRm02c3Activation(new FakeClient(state))).rejects.toThrow(
      'STOP_ROLE_HAS_UNEXPECTED_PERMISSION',
    );
  });

  it('rejects the dedicated role when assigned to another account', async () => {
    const state = initialState();
    state.roles.push({
      id: 'role',
      workspaceId: RM02C3_ACCEPTANCE_TARGET.workspaceId,
      code: RM02C3_ACCEPTANCE_TARGET.roleCode,
      isSystem: false,
    });
    state.assignments.push({
      roleId: 'role',
      workspaceMembershipId: 'other-membership',
      accountId: 'other-account',
      email: 'other@test.local',
      isActive: true,
      endDate: null,
    });
    await expect(planRm02c3Activation(new FakeClient(state))).rejects.toThrow(
      'STOP_ROLE_ASSIGNED_TO_ANOTHER_ACCOUNT',
    );
  });

  it.each(['', 'WRONG'])(
    'rejects token %p before transaction or writes',
    async (token) => {
      const client = new FakeClient();
      await expect(
        applyRm02c3Activation(client, {
          confirmationToken: token,
          expectedPlanSha256: 'a'.repeat(64),
        }),
      ).rejects.toThrow('STOP_CONFIRMATION_TOKEN_INVALID');
      expect(client.statements).toHaveLength(0);
      expect(client.writes).toBe(0);
    },
  );

  it('rejects a stale plan before writes', async () => {
    const client = new FakeClient();
    const plan = await planRm02c3Activation(client);
    client.state.permissions.push({ id: 'new', code: 'BASIC_PRICE_IMPORT' });
    await expect(
      applyRm02c3Activation(client, {
        confirmationToken: RM02C3_CONFIRMATION_TOKEN,
        expectedPlanSha256: plan.planSha256,
      }),
    ).rejects.toThrow('STOP_PLAN_HASH_DRIFT');
    expect(client.writes).toBe(0);
  });

  it('applies additively and a fresh second apply has zero delta', async () => {
    const client = new FakeClient();
    const firstPlan = await planRm02c3Activation(client);
    const first = await applyRm02c3Activation(client, {
      confirmationToken: RM02C3_CONFIRMATION_TOKEN,
      expectedPlanSha256: firstPlan.planSha256,
    });
    expect(first).toMatchObject({
      permissionCreatedDelta: 2,
      roleCreatedDelta: 1,
      rolePermissionCreatedDelta: 2,
      membershipRoleCreatedDelta: 1,
    });
    expect(client.state.permissions.map(({ code }) => code).sort()).toEqual(
      RM02C3_PERMISSION_ALLOWLIST.map(({ code }) => code).sort(),
    );

    const secondPlan = await planRm02c3Activation(client);
    const second = await applyRm02c3Activation(client, {
      confirmationToken: RM02C3_CONFIRMATION_TOKEN,
      expectedPlanSha256: secondPlan.planSha256,
    });
    expect(second).toMatchObject({
      permissionCreatedDelta: 0,
      roleCreatedDelta: 0,
      rolePermissionCreatedDelta: 0,
      membershipRoleCreatedDelta: 0,
    });
  });

  it('rolls back all writes on an injected mid-apply failure', async () => {
    const client = new FakeClient();
    const before = structuredClone(client.state);
    const plan = await planRm02c3Activation(client);
    await expect(
      applyRm02c3Activation(client, {
        confirmationToken: RM02C3_CONFIRMATION_TOKEN,
        expectedPlanSha256: plan.planSha256,
        injectFailureAfter: 'ROLE_PERMISSIONS',
      }),
    ).rejects.toThrow('INJECTED_RM02C3_FAILURE');
    expect(client.state).toEqual(before);
  });
});
