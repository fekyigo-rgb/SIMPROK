/**
 * IQL-01 SECOND HOLDER — governed Permanent activation.
 *
 * Grants the ONE narrow judging authority AHSP_RESOURCE_IDENTITY_QUESTION_APPROVE
 * to the EXISTING Basic Price verifier role of one workspace on Permanent
 * `simprok_db`, so an exact-question candidate the Owner TEACHES can be
 * approved or rejected by a DIFFERENT, already-provisioned human
 * (TEACHER ≠ APPROVER). Pattern and target guards are BP-PROVISIONING-02's
 * (plan SHA + Owner confirmation + backup hash), reused rather than rewritten.
 *
 * Strictly additive and idempotent:
 *   - never creates an Account, Membership, User or Role;
 *   - writes at most ONE Permission row and ONE RolePermission row;
 *   - never grants to the publisher role, DIRECTOR, or any other role;
 *   - refuses when the verifier role has no active holder, or when a holder
 *     could also TEACH (AHSP_RESOURCE_IDENTITY_DECIDE) — a second holder must
 *     be second.
 *
 * THIS MODULE HAS NO Nest @Injectable and no HTTP route. It is an operational
 * activation plan only, like BP-PROVISIONING-02.
 */

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';

import {
  BP02_DATABASE,
  BP02_HOST,
  BP02_PORT,
  BP02_ROLE,
  BP02_VERIFIER_ROLE_CODE,
  assertPermanentAppTarget,
  assertUuid,
  canonicalJson,
  parsePermanentAppUrl,
  sha256,
  type Bp02SqlClient,
} from './bp-provisioning-02-production-activation';
import {
  PERMISSIONS,
  PERMISSION_CATALOG,
} from '../common/constants/permissions';

export const IQL01_SECOND_HOLDER_CONFIRMATION = 'IQL01_SECOND_HOLDER_APPLY';
export const IQL01_SECOND_HOLDER_PERMISSION_CODE =
  PERMISSIONS.AHSP_RESOURCE_IDENTITY_QUESTION_APPROVE;
/** The EXISTING role that receives the grant. Never created here. */
export const IQL01_SECOND_HOLDER_ROLE_CODE = BP02_VERIFIER_ROLE_CODE;
const TEACHER_PERMISSION_CODE = PERMISSIONS.AHSP_RESOURCE_IDENTITY_DECIDE;

const PERMISSION_NAME = 'AHSP Resource Identity Question Approve';
const PERMISSION_DESCRIPTION =
  PERMISSION_CATALOG.find(
    (entry) => entry.code === IQL01_SECOND_HOLDER_PERMISSION_CODE,
  )?.description ?? '';

export interface Iql01SecondHolderTarget {
  workspaceId: string;
  organizationId: string;
}

export interface Iql01SecondHolderPlan {
  database: typeof BP02_DATABASE;
  host: typeof BP02_HOST;
  port: typeof BP02_PORT;
  role: typeof BP02_ROLE;
  target: Iql01SecondHolderTarget;
  permissionCode: typeof IQL01_SECOND_HOLDER_PERMISSION_CODE;
  permissionId: string | null;
  permissionAction: 'NONE' | 'INSERT_PERMISSION';
  roleCode: typeof IQL01_SECOND_HOLDER_ROLE_CODE;
  roleId: string;
  grantAction: 'NONE' | 'INSERT_ROLE_PERMISSION';
  /** Active holders of the verifier role — who will be able to judge. */
  holders: Array<{ accountId: string; email: string }>;
  expectedChanges: number;
}

export interface Iql01SecondHolderHashedPlan {
  plan: Iql01SecondHolderPlan;
  canonicalJson: string;
  sha256: string;
}

export interface Iql01SecondHolderApplyEnvironment {
  IQL01SH_TARGET_WORKSPACE_ID?: string;
  IQL01SH_EXPECTED_ORGANIZATION_ID?: string;
  IQL01SH_EXPECTED_PLAN_SHA256?: string;
  IQL01SH_CONFIRM?: string;
  IQL01SH_BACKUP_FILE?: string;
  IQL01SH_BACKUP_SHA256?: string;
  IQL01SH_OWNER_AUTHORIZATION_ID?: string;
  DATABASE_URL?: string;
}

const SHA256 = /^[0-9a-f]{64}$/i;

function required(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(`STOP_MISSING_${label}`);
  return value.trim();
}

export function iql01SecondHolderTargetFromEnvironment(
  env: Iql01SecondHolderApplyEnvironment,
): Iql01SecondHolderTarget {
  const workspaceId = required(
    env.IQL01SH_TARGET_WORKSPACE_ID,
    'TARGET_WORKSPACE_ID',
  );
  const organizationId = required(
    env.IQL01SH_EXPECTED_ORGANIZATION_ID,
    'EXPECTED_ORGANIZATION_ID',
  );
  assertUuid(workspaceId, 'TARGET_WORKSPACE_ID');
  assertUuid(organizationId, 'EXPECTED_ORGANIZATION_ID');
  return { workspaceId, organizationId };
}

async function assertLiveDatabase(client: Bp02SqlClient): Promise<void> {
  const result = await client.query<{
    current_database: string;
    server_host: string | null;
    server_port: number | string | null;
    session_role: string | null;
  }>(
    `select current_database() as current_database,
            host(inet_server_addr()) as server_host,
            inet_server_port() as server_port,
            session_user as session_role`,
  );
  const row = result.rows[0];
  if (!row) throw new Error('STOP_LIVE_PROBE_EMPTY');
  if (row.current_database !== BP02_DATABASE)
    throw new Error('STOP_DATABASE_IDENTITY_MISMATCH');
  if (String(row.server_host) !== BP02_HOST)
    throw new Error('STOP_LIVE_HOST_MISMATCH');
  if (Number(row.server_port) !== BP02_PORT)
    throw new Error('STOP_LIVE_PORT_MISMATCH');
  if (row.session_role !== BP02_ROLE)
    throw new Error('STOP_LIVE_ROLE_MISMATCH');
}

async function computePlan(
  client: Bp02SqlClient,
  target: Iql01SecondHolderTarget,
  lock: boolean,
): Promise<Iql01SecondHolderHashedPlan> {
  await assertLiveDatabase(client);

  const ws = await client.query<{ id: string; organizationId: string }>(
    `SELECT id, "organizationId" FROM workspaces WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [target.workspaceId],
  );
  if (ws.rowCount !== 1) throw new Error('STOP_WORKSPACE_NOT_FOUND');
  if (ws.rows[0].organizationId !== target.organizationId) {
    throw new Error('STOP_ORGANIZATION_WORKSPACE_DRIFT');
  }

  // The EXISTING verifier role — exactly one, never created here.
  const roles = await client.query<{ id: string }>(
    `SELECT id FROM roles WHERE "workspaceId" = $1 AND code = $2${lock ? ' FOR UPDATE' : ''}`,
    [target.workspaceId, IQL01_SECOND_HOLDER_ROLE_CODE],
  );
  if (roles.rowCount === 0)
    throw new Error('STOP_SECOND_HOLDER_ROLE_NOT_FOUND');
  if (roles.rowCount > 1) throw new Error('STOP_SECOND_HOLDER_ROLE_AMBIGUOUS');
  const roleId = roles.rows[0].id;

  // The role must stay a pure verifier: never a publisher, never a teacher.
  const held = await client.query<{ code: string }>(
    `SELECT p.code FROM role_permissions rp
     JOIN permissions p ON p.id = rp."permissionId"
     WHERE rp."roleId" = $1`,
    [roleId],
  );
  const heldCodes = new Set(held.rows.map((row) => row.code));
  if (heldCodes.has('BASIC_PRICE_PUBLISH'))
    throw new Error('STOP_VERIFIER_ROLE_HAS_PUBLISH');
  if (heldCodes.has(TEACHER_PERMISSION_CODE))
    throw new Error('STOP_VERIFIER_ROLE_CAN_TEACH');

  const permission = await client.query<{ id: string }>(
    `SELECT id FROM permissions WHERE code = $1`,
    [IQL01_SECOND_HOLDER_PERMISSION_CODE],
  );
  const permissionId = permission.rows[0]?.id ?? null;

  let grantAction: Iql01SecondHolderPlan['grantAction'] =
    'INSERT_ROLE_PERMISSION';
  if (permissionId) {
    const grant = await client.query(
      `SELECT 1 FROM role_permissions WHERE "roleId" = $1 AND "permissionId" = $2`,
      [roleId, permissionId],
    );
    if (grant.rowCount > 0) grantAction = 'NONE';

    // Nobody else in this workspace may already judge — least of all the
    // publisher role or DIRECTOR.
    const elsewhere = await client.query<{ code: string }>(
      `SELECT r.code FROM role_permissions rp
       JOIN roles r ON r.id = rp."roleId"
       WHERE rp."permissionId" = $1 AND r."workspaceId" = $2 AND r.id <> $3
       ORDER BY r.code`,
      [permissionId, target.workspaceId, roleId],
    );
    if (elsewhere.rowCount > 0) {
      throw new Error(
        `STOP_CODE_ALREADY_GRANTED_TO_OTHER_ROLE:${elsewhere.rows.map((row) => row.code).join(',')}`,
      );
    }
  }

  // Who holds the verifier role right now, by the SAME rules the permission
  // resolver applies (active membership, active membership role, not ended).
  const holders = await client.query<{ accountId: string; email: string }>(
    `SELECT DISTINCT a.id AS "accountId", lower(a.email) AS email
     FROM membership_roles mr
     JOIN workspace_memberships wm ON wm.id = mr."workspaceMembershipId"
     JOIN accounts a ON a.id = wm."accountId"
     WHERE mr."roleId" = $1
       AND mr."isActive" = true
       AND (mr."endDate" IS NULL OR mr."endDate" >= NOW())
       AND wm."workspaceId" = $2
       AND wm.status = 'ACTIVE'
     ORDER BY email`,
    [roleId, target.workspaceId],
  );
  if (holders.rowCount === 0) {
    throw new Error('STOP_SECOND_HOLDER_HAS_NO_ACTIVE_HOLDER');
  }

  // TEACHER ≠ APPROVER at the role level too: no holder may also teach.
  const teachers = await client.query<{ cnt: string }>(
    `SELECT count(*)::text AS cnt
     FROM membership_roles mr
     JOIN workspace_memberships wm ON wm.id = mr."workspaceMembershipId"
     JOIN role_permissions rp ON rp."roleId" = mr."roleId"
     JOIN permissions p ON p.id = rp."permissionId"
     WHERE wm."workspaceId" = $1
       AND wm."accountId" = ANY($2::uuid[])
       AND mr."isActive" = true
       AND (mr."endDate" IS NULL OR mr."endDate" >= NOW())
       AND p.code = $3`,
    [
      target.workspaceId,
      holders.rows.map((row) => row.accountId),
      TEACHER_PERMISSION_CODE,
    ],
  );
  if (Number(teachers.rows[0]?.cnt ?? 0) > 0) {
    throw new Error('STOP_SECOND_HOLDER_CAN_ALSO_TEACH');
  }

  const permissionAction: Iql01SecondHolderPlan['permissionAction'] =
    permissionId ? 'NONE' : 'INSERT_PERMISSION';
  const plan: Iql01SecondHolderPlan = {
    database: BP02_DATABASE,
    host: BP02_HOST,
    port: BP02_PORT,
    role: BP02_ROLE,
    target,
    permissionCode: IQL01_SECOND_HOLDER_PERMISSION_CODE,
    permissionId,
    permissionAction,
    roleCode: IQL01_SECOND_HOLDER_ROLE_CODE,
    roleId,
    grantAction,
    holders: holders.rows,
    expectedChanges:
      (permissionAction === 'NONE' ? 0 : 1) + (grantAction === 'NONE' ? 0 : 1),
  };
  const json = canonicalJson(plan);
  return { plan, canonicalJson: json, sha256: sha256(json) };
}

/** Read-only: always rolled back. */
export async function planIql01SecondHolderActivation(
  client: Bp02SqlClient,
  target: Iql01SecondHolderTarget,
): Promise<Iql01SecondHolderHashedPlan> {
  await client.query(
    'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
  );
  try {
    return await computePlan(client, target, false);
  } finally {
    await client.query('ROLLBACK');
  }
}

async function hashFile(path: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

export async function assertIql01SecondHolderApplyPrerequisites(
  env: Iql01SecondHolderApplyEnvironment,
): Promise<void> {
  if (env.IQL01SH_CONFIRM !== IQL01_SECOND_HOLDER_CONFIRMATION) {
    throw new Error('STOP_APPLY_CONFIRMATION_MISMATCH');
  }
  required(env.IQL01SH_OWNER_AUTHORIZATION_ID, 'OWNER_AUTHORIZATION_ID');
  assertPermanentAppTarget(
    parsePermanentAppUrl(required(env.DATABASE_URL, 'DATABASE_URL')),
  );
  const expectedPlan = required(
    env.IQL01SH_EXPECTED_PLAN_SHA256,
    'EXPECTED_PLAN_SHA256',
  );
  const expectedBackup = required(env.IQL01SH_BACKUP_SHA256, 'BACKUP_SHA256');
  if (!SHA256.test(expectedPlan) || !SHA256.test(expectedBackup)) {
    throw new Error('STOP_INVALID_SHA256');
  }
  const backup = required(env.IQL01SH_BACKUP_FILE, 'BACKUP_FILE');
  if (!existsSync(backup) || statSync(backup).size <= 0) {
    throw new Error('STOP_BACKUP_MISSING_OR_EMPTY');
  }
  if ((await hashFile(backup)) !== expectedBackup.toLowerCase()) {
    throw new Error('STOP_BACKUP_SHA256_MISMATCH');
  }
}

/**
 * Writes, in ONE serializable transaction, only after every prerequisite holds
 * and the freshly recomputed plan is byte-identical to the one the Owner
 * reviewed. Re-applying an applied plan changes nothing.
 */
export async function applyIql01SecondHolderActivation(
  client: Bp02SqlClient,
  env: Iql01SecondHolderApplyEnvironment,
): Promise<{
  changesApplied: number;
  planSha256: string;
  after: Iql01SecondHolderHashedPlan;
}> {
  await assertIql01SecondHolderApplyPrerequisites(env);
  const target = iql01SecondHolderTargetFromEnvironment(env);
  const expectedPlanSha = required(
    env.IQL01SH_EXPECTED_PLAN_SHA256,
    'EXPECTED_PLAN_SHA256',
  ).toLowerCase();

  await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
  try {
    const before = await computePlan(client, target, true);
    if (before.sha256 !== expectedPlanSha) {
      throw new Error('STOP_PLAN_SHA256_DRIFT');
    }

    let changesApplied = 0;
    let permissionId = before.plan.permissionId;
    if (!permissionId) {
      permissionId = randomUUID();
      const inserted = await client.query(
        `INSERT INTO permissions (id, code, name, description, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         ON CONFLICT (code) DO NOTHING`,
        [
          permissionId,
          IQL01_SECOND_HOLDER_PERMISSION_CODE,
          PERMISSION_NAME,
          PERMISSION_DESCRIPTION,
        ],
      );
      if (inserted.rowCount !== 1) throw new Error('STOP_PERMISSION_RACE');
      changesApplied += 1;
    }
    if (before.plan.grantAction !== 'NONE') {
      const inserted = await client.query(
        `INSERT INTO role_permissions (id, "roleId", "permissionId", "createdAt")
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT ("roleId", "permissionId") DO NOTHING`,
        [randomUUID(), before.plan.roleId, permissionId],
      );
      if (inserted.rowCount !== 1) throw new Error('STOP_GRANT_RACE');
      changesApplied += 1;
    }

    const after = await computePlan(client, target, true);
    if (
      after.plan.permissionAction !== 'NONE' ||
      after.plan.grantAction !== 'NONE' ||
      after.plan.roleId !== before.plan.roleId
    ) {
      throw new Error('STOP_POST_APPLY_STATE_UNPROVEN');
    }
    await client.query('COMMIT');
    return { changesApplied, planSha256: before.sha256, after };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
