import { createHash, randomUUID } from 'node:crypto';

export const RM02C3_ACCEPTANCE_DATABASE = 'simprok_test';
export const RM02C3_E2E_DATABASE = 'simprok_e2e';
export const RM02C3_FORBIDDEN_DATABASE = 'simprok_db';
export const RM02C3_CONFIRMATION_TOKEN =
  'APPLY_RM02C3_BROWSER_ACCEPTANCE_TO_SIMPROK_TEST';
export const RM02C3_ADVISORY_LOCK_KEY = 2_003_020_003;

export const RM02C3_PERMISSION_ALLOWLIST = [
  {
    code: 'BASIC_PRICE_IMPORT',
    name: 'Basic Price Import',
    description:
      'Upload a Basic Price workbook and create/preview a BasicPriceImportBatch.',
  },
  {
    code: 'BASIC_PRICE_REVIEW_VIEW',
    name: 'Basic Price Review View',
    description:
      'View internal (pre-publication) Basic Price batches, rows, and submissions.',
  },
] as const;

export interface Rm02c3Target {
  databaseName: string;
  workspaceId: string;
  workspaceName: string;
  accountEmail: string;
  roleCode: string;
}

export const RM02C3_ACCEPTANCE_TARGET: Rm02c3Target = {
  databaseName: RM02C3_ACCEPTANCE_DATABASE,
  workspaceId: '10000000-0000-4000-8000-000000000004',
  workspaceName: 'Workspace-A',
  accountEmail: 'assigned@test.local',
  roleCode: 'RM02C3_BROWSER_ACCEPTANCE',
};

export interface SqlQueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount?: number | null;
}

export interface Rm02c3SqlClient {
  query<T = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<SqlQueryResult<T>>;
}

type Disposition =
  | 'CREATE_PERMISSION'
  | 'REUSE_PERMISSION'
  | 'CREATE_ROLE'
  | 'REUSE_ROLE'
  | 'CREATE_ROLE_PERMISSION'
  | 'REUSE_ROLE_PERMISSION'
  | 'CREATE_MEMBERSHIP_ROLE'
  | 'REUSE_MEMBERSHIP_ROLE';

export interface Rm02c3Plan {
  version: 1;
  target: Rm02c3Target;
  accountId: string;
  membershipId: string;
  roleId: string | null;
  actions: Array<{
    disposition: Disposition;
    identity: string;
  }>;
  expectedDelta: {
    permissions: number;
    roles: number;
    rolePermissions: number;
    membershipRoles: number;
  };
}

export interface Rm02c3PlanEnvelope {
  plan: Rm02c3Plan;
  canonicalPlan: string;
  planSha256: string;
}

export interface Rm02c3ApplyResult {
  planSha256: string;
  permissionCreatedDelta: number;
  roleCreatedDelta: number;
  rolePermissionCreatedDelta: number;
  membershipRoleCreatedDelta: number;
}

export class Rm02c3ActivationError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'Rm02c3ActivationError';
  }
}

function stop(code: string): never {
  throw new Rm02c3ActivationError(code);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function envelope(plan: Rm02c3Plan): Rm02c3PlanEnvelope {
  const canonicalPlan = canonicalJson(plan);
  return { plan, canonicalPlan, planSha256: sha256(canonicalPlan) };
}

interface WorkspaceRow {
  id: string;
  name: string;
}
interface AccountRow {
  id: string;
  status: string;
}
interface MembershipRow {
  id: string;
}
interface PermissionRow {
  id: string;
  code: string;
}
interface RoleRow {
  id: string;
  workspaceId: string;
  isSystem: boolean;
}
interface RolePermissionRow {
  permissionId: string;
  code: string;
}
interface RoleAssignmentRow {
  workspaceMembershipId: string;
  accountId: string;
  email: string;
  isActive: boolean;
  endDate: Date | null;
}

async function buildPlan(
  client: Rm02c3SqlClient,
  target: Rm02c3Target,
): Promise<Rm02c3Plan> {
  if (
    target.databaseName === RM02C3_FORBIDDEN_DATABASE ||
    ![RM02C3_ACCEPTANCE_DATABASE, RM02C3_E2E_DATABASE].includes(
      target.databaseName,
    )
  ) {
    stop('STOP_DATABASE_NOT_AUTHORIZED');
  }

  const database = await client.query<{ databaseName: string }>(
    '/* rm02c3:database */ SELECT current_database() AS "databaseName"',
  );
  if (
    database.rows.length !== 1 ||
    database.rows[0].databaseName !== target.databaseName
  ) {
    stop('STOP_DATABASE_IDENTITY_MISMATCH');
  }

  const workspace = await client.query<WorkspaceRow>(
    '/* rm02c3:workspace */ SELECT id, name FROM workspaces WHERE id = $1',
    [target.workspaceId],
  );
  if (
    workspace.rows.length !== 1 ||
    workspace.rows[0].name !== target.workspaceName
  ) {
    stop('STOP_WORKSPACE_IDENTITY_MISMATCH');
  }

  const account = await client.query<AccountRow>(
    '/* rm02c3:account */ SELECT id, status FROM accounts WHERE lower(email) = lower($1)',
    [target.accountEmail],
  );
  if (account.rows.length !== 1 || account.rows[0].status !== 'ACTIVE') {
    stop('STOP_ACCOUNT_ABSENT_INACTIVE_OR_AMBIGUOUS');
  }

  const memberships = await client.query<MembershipRow>(
    `/* rm02c3:membership */
     SELECT id
       FROM workspace_memberships
      WHERE "accountId" = $1
        AND "workspaceId" = $2
        AND status = 'ACTIVE'`,
    [account.rows[0].id, target.workspaceId],
  );
  if (memberships.rows.length !== 1) {
    stop('STOP_MEMBERSHIP_ABSENT_INACTIVE_OR_AMBIGUOUS');
  }

  const permissionCodes = RM02C3_PERMISSION_ALLOWLIST.map(({ code }) => code);
  const permissions = await client.query<PermissionRow>(
    `/* rm02c3:permissions */
     SELECT id, code FROM permissions WHERE code = ANY($1::text[]) ORDER BY code`,
    [permissionCodes],
  );
  if (
    permissions.rows.some(
      ({ code }) =>
        !permissionCodes.includes(code as (typeof permissionCodes)[number]),
    )
  ) {
    stop('STOP_PERMISSION_IDENTITY_AMBIGUOUS');
  }

  const roles = await client.query<RoleRow>(
    `/* rm02c3:role */
     SELECT id, "workspaceId", "isSystem"
       FROM roles
      WHERE code = $1
      ORDER BY "workspaceId", id`,
    [target.roleCode],
  );
  if (
    roles.rows.length > 1 ||
    (roles.rows.length === 1 &&
      roles.rows[0].workspaceId !== target.workspaceId)
  ) {
    stop('STOP_ROLE_EXISTS_OUTSIDE_TARGET_WORKSPACE');
  }
  if (roles.rows[0]?.isSystem) {
    stop('STOP_DEDICATED_ROLE_IS_SYSTEM_ROLE');
  }

  const role = roles.rows[0] ?? null;
  let rolePermissions: RolePermissionRow[] = [];
  let assignments: RoleAssignmentRow[] = [];
  if (role) {
    rolePermissions = (
      await client.query<RolePermissionRow>(
        `/* rm02c3:role-permissions */
         SELECT rp."permissionId", p.code
           FROM role_permissions rp
           JOIN permissions p ON p.id = rp."permissionId"
          WHERE rp."roleId" = $1
          ORDER BY p.code, rp.id`,
        [role.id],
      )
    ).rows;
    if (
      rolePermissions.some(
        ({ code }) => !permissionCodes.includes(code as never),
      )
    ) {
      stop('STOP_ROLE_HAS_UNEXPECTED_PERMISSION');
    }

    assignments = (
      await client.query<RoleAssignmentRow>(
        `/* rm02c3:role-assignments */
         SELECT mr."workspaceMembershipId", wm."accountId", a.email,
                mr."isActive", mr."endDate"
           FROM membership_roles mr
           JOIN workspace_memberships wm ON wm.id = mr."workspaceMembershipId"
           JOIN accounts a ON a.id = wm."accountId"
          WHERE mr."roleId" = $1
          ORDER BY mr.id`,
        [role.id],
      )
    ).rows;
    if (
      assignments.some(
        ({ workspaceMembershipId, accountId }) =>
          workspaceMembershipId !== memberships.rows[0].id ||
          accountId !== account.rows[0].id,
      )
    ) {
      stop('STOP_ROLE_ASSIGNED_TO_ANOTHER_ACCOUNT');
    }
    const activeTargetAssignments = assignments.filter(
      ({ isActive, endDate }) =>
        isActive && (endDate === null || new Date(endDate) > new Date()),
    );
    if (activeTargetAssignments.length > 1) {
      stop('STOP_ROLE_ASSIGNMENT_AMBIGUOUS');
    }
  }

  const actions: Rm02c3Plan['actions'] = [];
  for (const permission of RM02C3_PERMISSION_ALLOWLIST) {
    actions.push({
      disposition: permissions.rows.some(({ code }) => code === permission.code)
        ? 'REUSE_PERMISSION'
        : 'CREATE_PERMISSION',
      identity: permission.code,
    });
  }
  actions.push({
    disposition: role ? 'REUSE_ROLE' : 'CREATE_ROLE',
    identity: `${target.workspaceId}:${target.roleCode}`,
  });
  for (const permission of RM02C3_PERMISSION_ALLOWLIST) {
    actions.push({
      disposition: rolePermissions.some(({ code }) => code === permission.code)
        ? 'REUSE_ROLE_PERMISSION'
        : 'CREATE_ROLE_PERMISSION',
      identity: `${target.roleCode}:${permission.code}`,
    });
  }
  actions.push({
    disposition:
      role &&
      assignments.some(
        ({ workspaceMembershipId, isActive, endDate }) =>
          workspaceMembershipId === memberships.rows[0].id &&
          isActive &&
          (endDate === null || new Date(endDate) > new Date()),
      )
        ? 'REUSE_MEMBERSHIP_ROLE'
        : 'CREATE_MEMBERSHIP_ROLE',
    identity: `${memberships.rows[0].id}:${target.roleCode}`,
  });

  return {
    version: 1,
    target,
    accountId: account.rows[0].id,
    membershipId: memberships.rows[0].id,
    roleId: role?.id ?? null,
    actions,
    expectedDelta: {
      permissions: actions.filter(
        ({ disposition }) => disposition === 'CREATE_PERMISSION',
      ).length,
      roles: actions.filter(({ disposition }) => disposition === 'CREATE_ROLE')
        .length,
      rolePermissions: actions.filter(
        ({ disposition }) => disposition === 'CREATE_ROLE_PERMISSION',
      ).length,
      membershipRoles: actions.filter(
        ({ disposition }) => disposition === 'CREATE_MEMBERSHIP_ROLE',
      ).length,
    },
  };
}

export async function planRm02c3Activation(
  client: Rm02c3SqlClient,
  target: Rm02c3Target = RM02C3_ACCEPTANCE_TARGET,
): Promise<Rm02c3PlanEnvelope> {
  await client.query(
    'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
  );
  try {
    const result = envelope(await buildPlan(client, target));
    await client.query('ROLLBACK');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function applyRm02c3Activation(
  client: Rm02c3SqlClient,
  options: {
    confirmationToken: string;
    expectedPlanSha256: string;
    target?: Rm02c3Target;
    injectFailureAfter?: 'PERMISSIONS' | 'ROLE' | 'ROLE_PERMISSIONS';
  },
): Promise<Rm02c3ApplyResult> {
  if (options.confirmationToken !== RM02C3_CONFIRMATION_TOKEN) {
    stop('STOP_CONFIRMATION_TOKEN_INVALID');
  }
  if (!/^[a-f0-9]{64}$/.test(options.expectedPlanSha256)) {
    stop('STOP_EXPECTED_PLAN_HASH_INVALID');
  }

  const target = options.target ?? RM02C3_ACCEPTANCE_TARGET;
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
  try {
    await client.query(
      '/* rm02c3:advisory-lock */ SELECT pg_advisory_xact_lock($1)',
      [RM02C3_ADVISORY_LOCK_KEY],
    );
    const fresh = envelope(await buildPlan(client, target));
    if (fresh.planSha256 !== options.expectedPlanSha256) {
      stop('STOP_PLAN_HASH_DRIFT');
    }

    let permissionCreatedDelta = 0;
    for (const permission of RM02C3_PERMISSION_ALLOWLIST) {
      const action = fresh.plan.actions.find(
        ({ identity }) => identity === permission.code,
      );
      if (action?.disposition === 'CREATE_PERMISSION') {
        await client.query(
          `/* rm02c3:insert-permission */
           INSERT INTO permissions (id, code, name, description, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [
            randomUUID(),
            permission.code,
            permission.name,
            permission.description,
          ],
        );
        permissionCreatedDelta += 1;
      }
    }
    if (options.injectFailureAfter === 'PERMISSIONS') {
      throw new Error('INJECTED_RM02C3_FAILURE');
    }

    let roleId = fresh.plan.roleId;
    let roleCreatedDelta = 0;
    if (!roleId) {
      roleId = randomUUID();
      await client.query(
        `/* rm02c3:insert-role */
         INSERT INTO roles
           (id, "workspaceId", code, name, description, "isSystem", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          roleId,
          target.workspaceId,
          target.roleCode,
          'RM-02C3 Browser Acceptance',
          'Acceptance-only least-privilege role for Basic Price browser proof.',
        ],
      );
      roleCreatedDelta = 1;
    }
    if (options.injectFailureAfter === 'ROLE') {
      throw new Error('INJECTED_RM02C3_FAILURE');
    }

    const permissionRows = await client.query<PermissionRow>(
      `/* rm02c3:permissions-after-insert */
       SELECT id, code FROM permissions WHERE code = ANY($1::text[]) ORDER BY code`,
      [RM02C3_PERMISSION_ALLOWLIST.map(({ code }) => code)],
    );
    if (permissionRows.rows.length !== RM02C3_PERMISSION_ALLOWLIST.length) {
      stop('STOP_PERMISSION_INSERT_POSTCONDITION');
    }

    let rolePermissionCreatedDelta = 0;
    for (const permission of permissionRows.rows) {
      const action = fresh.plan.actions.find(
        ({ identity }) => identity === `${target.roleCode}:${permission.code}`,
      );
      if (action?.disposition === 'CREATE_ROLE_PERMISSION') {
        await client.query(
          `/* rm02c3:insert-role-permission */
           INSERT INTO role_permissions (id, "roleId", "permissionId", "createdAt")
           VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
          [randomUUID(), roleId, permission.id],
        );
        rolePermissionCreatedDelta += 1;
      }
    }
    if (options.injectFailureAfter === 'ROLE_PERMISSIONS') {
      throw new Error('INJECTED_RM02C3_FAILURE');
    }

    let membershipRoleCreatedDelta = 0;
    if (
      fresh.plan.actions.some(
        ({ disposition }) => disposition === 'CREATE_MEMBERSHIP_ROLE',
      )
    ) {
      await client.query(
        `/* rm02c3:insert-membership-role */
         INSERT INTO membership_roles
           (id, "workspaceMembershipId", "roleId", "startDate", "endDate",
            "isActive", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP, NULL, true,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [randomUUID(), fresh.plan.membershipId, roleId],
      );
      membershipRoleCreatedDelta = 1;
    }

    const postPlan = await buildPlan(client, target);
    if (
      postPlan.expectedDelta.permissions !== 0 ||
      postPlan.expectedDelta.roles !== 0 ||
      postPlan.expectedDelta.rolePermissions !== 0 ||
      postPlan.expectedDelta.membershipRoles !== 0
    ) {
      stop('STOP_APPLY_POSTCONDITION');
    }

    await client.query('COMMIT');
    return {
      planSha256: fresh.planSha256,
      permissionCreatedDelta,
      roleCreatedDelta,
      rolePermissionCreatedDelta,
      membershipRoleCreatedDelta,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
