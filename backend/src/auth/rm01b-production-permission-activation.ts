import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';

export const RM01B_DATABASE = 'simprok_db';
export const RM01B_ROLE_CODE = 'DIRECTOR';
export const RM01B_CONFIRMATION = 'RM01B_APPLY';
export const RM01B_PERMISSION_METADATA = [
  {
    code: 'RAB_DRAFT_EDIT',
    name: 'Edit RAB Draft',
    description: 'Edit RAB drafts and approve bounded BOQ imports.',
  },
  {
    code: 'RAB_VIEW',
    name: 'View RAB',
    description: 'View RAB drafts and bounded import previews.',
  },
] as const;

export interface QueryResult<Row = Record<string, unknown>> {
  rows: Row[];
  rowCount: number;
}

export interface Rm01bSqlClient {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
}

export interface Rm01bTarget {
  workspaceId: string;
  organizationId: string;
  roleId: string;
  roleCode: typeof RM01B_ROLE_CODE;
}

export interface Rm01bPlanEntry {
  code: (typeof RM01B_PERMISSION_METADATA)[number]['code'];
  permissionId: string | null;
  permissionAction: 'NONE' | 'INSERT_PERMISSION';
  grantAction: 'NONE' | 'INSERT_ROLE_PERMISSION';
}

export interface Rm01bPlan {
  database: typeof RM01B_DATABASE;
  target: Rm01bTarget;
  entries: Rm01bPlanEntry[];
  expectedChanges: number;
  nonTargetGrantCount: number;
  nonTargetGrantFingerprint: string;
}

export interface Rm01bHashedPlan {
  plan: Rm01bPlan;
  canonicalJson: string;
  sha256: string;
}

export interface Rm01bApplyEnvironment {
  RM01B_TARGET_WORKSPACE_ID?: string;
  RM01B_EXPECTED_ORGANIZATION_ID?: string;
  RM01B_EXPECTED_ROLE_ID?: string;
  RM01B_EXPECTED_PLAN_SHA256?: string;
  RM01B_CONFIRM?: string;
  RM01B_BACKUP_FILE?: string;
  RM01B_BACKUP_SHA256?: string;
  RM01B_OWNER_AUTHORIZATION_ID?: string;
  DATABASE_URL?: string;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;

function required(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(`STOP_MISSING_${label}`);
  return value.trim();
}

export function assertUuid(value: string, label: string): void {
  if (!UUID.test(value)) throw new Error(`STOP_INVALID_${label}`);
}

export function targetFromEnvironment(env: Rm01bApplyEnvironment): Rm01bTarget {
  const workspaceId = required(
    env.RM01B_TARGET_WORKSPACE_ID,
    'TARGET_WORKSPACE_ID',
  );
  const organizationId = required(
    env.RM01B_EXPECTED_ORGANIZATION_ID,
    'EXPECTED_ORGANIZATION_ID',
  );
  const roleId = required(env.RM01B_EXPECTED_ROLE_ID, 'EXPECTED_ROLE_ID');
  assertUuid(workspaceId, 'TARGET_WORKSPACE_ID');
  assertUuid(organizationId, 'EXPECTED_ORGANIZATION_ID');
  assertUuid(roleId, 'EXPECTED_ROLE_ID');
  return { workspaceId, organizationId, roleId, roleCode: RM01B_ROLE_CODE };
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

async function assertProductionDatabase(client: Rm01bSqlClient): Promise<void> {
  const result = await client.query<{ current_database: string }>(
    'SELECT current_database() AS current_database',
  );
  if (result.rows[0]?.current_database !== RM01B_DATABASE) {
    throw new Error('STOP_DATABASE_IDENTITY_MISMATCH');
  }
}

async function computePlan(
  client: Rm01bSqlClient,
  target: Rm01bTarget,
  lockRole: boolean,
): Promise<Rm01bHashedPlan> {
  assertUuid(target.workspaceId, 'TARGET_WORKSPACE_ID');
  assertUuid(target.organizationId, 'EXPECTED_ORGANIZATION_ID');
  assertUuid(target.roleId, 'EXPECTED_ROLE_ID');
  if (target.roleCode !== RM01B_ROLE_CODE)
    throw new Error('STOP_ROLE_CODE_NOT_DIRECTOR');

  await assertProductionDatabase(client);
  const roleSql = `SELECT r.id, r."workspaceId", r.code, w."organizationId"
    FROM roles r JOIN workspaces w ON w.id = r."workspaceId"
    WHERE r."workspaceId" = $1 AND r.code = $2${lockRole ? ' FOR UPDATE OF r' : ''}`;
  const roles = await client.query<{
    id: string;
    workspaceId: string;
    code: string;
    organizationId: string;
  }>(roleSql, [target.workspaceId, RM01B_ROLE_CODE]);
  if (roles.rowCount === 0) throw new Error('STOP_TARGET_ROLE_NOT_FOUND');
  if (roles.rowCount !== 1) throw new Error('STOP_MULTIPLE_TARGET_ROLES');
  const role = roles.rows[0];
  if (
    role.id !== target.roleId ||
    role.workspaceId !== target.workspaceId ||
    role.organizationId !== target.organizationId ||
    role.code !== RM01B_ROLE_CODE
  ) {
    throw new Error('STOP_TARGET_WORKSPACE_ORGANIZATION_ROLE_DRIFT');
  }

  const codes = RM01B_PERMISSION_METADATA.map((entry) => entry.code);
  const permissions = await client.query<{
    id: string;
    code: string;
    name: string;
    description: string | null;
    granted: boolean;
  }>(
    `SELECT p.id, p.code, p.name, p.description,
      EXISTS (SELECT 1 FROM role_permissions rp WHERE rp."roleId" = $1 AND rp."permissionId" = p.id) AS granted
     FROM permissions p WHERE p.code = ANY($2::text[]) ORDER BY p.code`,
    [target.roleId, codes],
  );
  const byCode = new Map(permissions.rows.map((row) => [row.code, row]));
  const entries: Rm01bPlanEntry[] = RM01B_PERMISSION_METADATA.map(
    (metadata) => {
      const row = byCode.get(metadata.code);
      if (
        row &&
        (row.name !== metadata.name || row.description !== metadata.description)
      ) {
        throw new Error(`STOP_PERMISSION_METADATA_CONFLICT_${metadata.code}`);
      }
      return {
        code: metadata.code,
        permissionId: row?.id ?? null,
        permissionAction: row ? 'NONE' : 'INSERT_PERMISSION',
        grantAction: row?.granted ? 'NONE' : 'INSERT_ROLE_PERMISSION',
      };
    },
  );

  const nonTarget = await client.query<{ code: string; permissionId: string }>(
    `SELECT p.code, p.id AS "permissionId"
     FROM role_permissions rp JOIN permissions p ON p.id = rp."permissionId"
     WHERE rp."roleId" = $1 AND NOT (p.code = ANY($2::text[]))
     ORDER BY p.code, p.id`,
    [target.roleId, codes],
  );
  const nonTargetJson = canonicalJson(nonTarget.rows);
  const plan: Rm01bPlan = {
    database: RM01B_DATABASE,
    target,
    entries,
    expectedChanges: entries.reduce(
      (count, entry) =>
        count +
        (entry.permissionAction === 'INSERT_PERMISSION' ? 1 : 0) +
        (entry.grantAction === 'INSERT_ROLE_PERMISSION' ? 1 : 0),
      0,
    ),
    nonTargetGrantCount: nonTarget.rowCount,
    nonTargetGrantFingerprint: sha256(nonTargetJson),
  };
  const json = canonicalJson(plan);
  return { plan, canonicalJson: json, sha256: sha256(json) };
}

export async function planProductionActivation(
  client: Rm01bSqlClient,
  target: Rm01bTarget,
): Promise<Rm01bHashedPlan> {
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

export async function assertApplyPrerequisites(
  env: Rm01bApplyEnvironment,
): Promise<void> {
  if (env.RM01B_CONFIRM !== RM01B_CONFIRMATION)
    throw new Error('STOP_APPLY_CONFIRMATION_MISMATCH');
  required(env.RM01B_OWNER_AUTHORIZATION_ID, 'OWNER_AUTHORIZATION_ID');
  required(env.DATABASE_URL, 'DATABASE_URL');
  const expectedPlan = required(
    env.RM01B_EXPECTED_PLAN_SHA256,
    'EXPECTED_PLAN_SHA256',
  );
  const expectedBackup = required(env.RM01B_BACKUP_SHA256, 'BACKUP_SHA256');
  if (!SHA256.test(expectedPlan) || !SHA256.test(expectedBackup))
    throw new Error('STOP_INVALID_SHA256');
  const backup = required(env.RM01B_BACKUP_FILE, 'BACKUP_FILE');
  if (!existsSync(backup) || statSync(backup).size <= 0)
    throw new Error('STOP_BACKUP_MISSING_OR_EMPTY');
  if ((await hashFile(backup)) !== expectedBackup.toLowerCase())
    throw new Error('STOP_BACKUP_SHA256_MISMATCH');
}

export async function applyProductionActivation(
  client: Rm01bSqlClient,
  env: Rm01bApplyEnvironment,
): Promise<{ changesApplied: number; after: Rm01bHashedPlan }> {
  await assertApplyPrerequisites(env);
  const target = targetFromEnvironment(env);
  const expectedPlanSha = required(
    env.RM01B_EXPECTED_PLAN_SHA256,
    'EXPECTED_PLAN_SHA256',
  ).toLowerCase();
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
  try {
    const before = await computePlan(client, target, true);
    if (before.sha256 !== expectedPlanSha)
      throw new Error('STOP_PLAN_SHA256_DRIFT');
    let changesApplied = 0;
    for (const metadata of RM01B_PERMISSION_METADATA) {
      const entry = before.plan.entries.find(
        (item) => item.code === metadata.code,
      )!;
      let permissionId = entry.permissionId;
      if (entry.permissionAction === 'INSERT_PERMISSION') {
        permissionId = randomUUID();
        const inserted = await client.query(
          'INSERT INTO permissions (id, code, name, description) VALUES ($1, $2, $3, $4) ON CONFLICT (code) DO NOTHING',
          [permissionId, metadata.code, metadata.name, metadata.description],
        );
        changesApplied += inserted.rowCount;
      }
      if (!permissionId) throw new Error('STOP_PERMISSION_ID_UNRESOLVED');
      if (entry.grantAction === 'INSERT_ROLE_PERMISSION') {
        const inserted = await client.query(
          'INSERT INTO role_permissions (id, "roleId", "permissionId") VALUES ($1, $2, $3) ON CONFLICT ("roleId", "permissionId") DO NOTHING',
          [randomUUID(), target.roleId, permissionId],
        );
        changesApplied += inserted.rowCount;
      }
    }
    if (changesApplied !== before.plan.expectedChanges)
      throw new Error('STOP_EXPECTED_CHANGES_MISMATCH');
    const after = await computePlan(client, target, false);
    if (after.plan.expectedChanges !== 0)
      throw new Error('STOP_POSTCONDITION_TARGET_GRANTS_MISSING');
    if (
      after.plan.nonTargetGrantCount !== before.plan.nonTargetGrantCount ||
      after.plan.nonTargetGrantFingerprint !==
        before.plan.nonTargetGrantFingerprint
    )
      throw new Error('STOP_NON_TARGET_GRANT_DRIFT');
    await client.query('COMMIT');
    return { changesApplied, after };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export function sanitizedResult(value: unknown): string {
  return canonicalJson(value);
}
