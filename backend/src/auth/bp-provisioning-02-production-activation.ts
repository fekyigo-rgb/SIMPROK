/**
 * BP-PROVISIONING-02 — Governed Permanent Verifier / Publisher activation.
 *
 * Closes the proven PROVISIONING GAP without inventing a second RBAC system,
 * without DIRECTOR self-escalation, and without making Owner both verifier and
 * publisher. Pattern mirrors RM-01B (plan SHA + Owner confirm + backup hash),
 * but targets TWO disjoint roles and TWO distinct human Accounts in one
 * workspace on Permanent `simprok_db`.
 *
 * THIS MODULE HAS NO Nest @Injectable and no HTTP route. It is an operational
 * activation plan only — the same discipline BP-CAT-01D requires for
 * RolePermission writers outside product self-grant.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

import * as bcrypt from 'bcrypt';

export const BP02_DATABASE = 'simprok_db';
export const BP02_HOST = '127.0.0.1';
export const BP02_PORT = 55432;
export const BP02_ROLE = 'simprok_app';
export const BP02_CONFIRMATION = 'BP_PROVISIONING_02_APPLY';

export const BP02_VERIFIER_ROLE_CODE = 'BASIC_PRICE_VERIFIER';
export const BP02_PUBLISHER_ROLE_CODE = 'BASIC_PRICE_PUBLISHER';

export const BP02_PERMISSION_METADATA = [
  {
    code: 'BASIC_PRICE_REVIEW_VIEW',
    name: 'Basic Price Review View',
    description:
      'View internal (pre-publication) Basic Price submissions and curation reviews.',
  },
  {
    code: 'BASIC_PRICE_VERIFY',
    name: 'Basic Price Verify',
    description:
      'Accept, reject, request correction, or reassign a submitted Basic Price review.',
  },
  {
    code: 'BASIC_PRICE_PUBLISH',
    name: 'Basic Price Publish',
    description: 'Publish a verified BasicPrice, making it publicly eligible.',
  },
] as const;

export const BP02_VERIFIER_PERMISSION_CODES = [
  'BASIC_PRICE_REVIEW_VIEW',
  'BASIC_PRICE_VERIFY',
] as const;

export const BP02_PUBLISHER_PERMISSION_CODES = ['BASIC_PRICE_PUBLISH'] as const;

export interface QueryResult<Row = Record<string, unknown>> {
  rows: Row[];
  rowCount: number;
}

export interface Bp02SqlClient {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
}

export interface Bp02Target {
  workspaceId: string;
  organizationId: string;
  verifierEmail: string;
  publisherEmail: string;
  verifierDisplayName: string;
  publisherDisplayName: string;
  /** Safe audit identity only — never receives curation grants from this plan. */
  ownerEmail: string;
}

export interface Bp02Plan {
  database: typeof BP02_DATABASE;
  host: typeof BP02_HOST;
  port: typeof BP02_PORT;
  role: typeof BP02_ROLE;
  target: Bp02Target;
  permissionActions: Array<{
    code: (typeof BP02_PERMISSION_METADATA)[number]['code'];
    permissionId: string | null;
    action: 'NONE' | 'INSERT_PERMISSION';
  }>;
  roleActions: Array<{
    code: typeof BP02_VERIFIER_ROLE_CODE | typeof BP02_PUBLISHER_ROLE_CODE;
    roleId: string | null;
    action: 'NONE' | 'INSERT_ROLE';
  }>;
  grantActions: Array<{
    roleCode: typeof BP02_VERIFIER_ROLE_CODE | typeof BP02_PUBLISHER_ROLE_CODE;
    permissionCode: string;
    action: 'NONE' | 'INSERT_ROLE_PERMISSION';
  }>;
  actorActions: Array<{
    kind: 'VERIFIER' | 'PUBLISHER';
    email: string;
    accountId: string | null;
    membershipId: string | null;
    userId: string | null;
    membershipRoleId: string | null;
    accountAction: 'NONE' | 'INSERT_ACCOUNT';
    membershipAction: 'NONE' | 'INSERT_MEMBERSHIP';
    userAction: 'NONE' | 'INSERT_USER';
    membershipRoleAction: 'NONE' | 'INSERT_MEMBERSHIP_ROLE';
  }>;
  expectedChanges: number;
  directorHasCurationGrant: boolean;
  ownerAccountHasCurationViaRole: boolean;
}

export interface Bp02HashedPlan {
  plan: Bp02Plan;
  canonicalJson: string;
  sha256: string;
}

export interface Bp02ApplyEnvironment {
  BP02_TARGET_WORKSPACE_ID?: string;
  BP02_EXPECTED_ORGANIZATION_ID?: string;
  BP02_VERIFIER_EMAIL?: string;
  BP02_PUBLISHER_EMAIL?: string;
  BP02_VERIFIER_DISPLAY_NAME?: string;
  BP02_PUBLISHER_DISPLAY_NAME?: string;
  BP02_OWNER_EMAIL?: string;
  BP02_EXPECTED_PLAN_SHA256?: string;
  BP02_CONFIRM?: string;
  BP02_BACKUP_FILE?: string;
  BP02_BACKUP_SHA256?: string;
  BP02_OWNER_AUTHORIZATION_ID?: string;
  BP02_SECRETS_OUT_DIR?: string;
  DATABASE_URL?: string;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const SALT_ROUNDS = 10;

function required(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(`STOP_MISSING_${label}`);
  return value.trim();
}

export function assertUuid(value: string, label: string): void {
  if (!UUID.test(value)) throw new Error(`STOP_INVALID_${label}`);
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

export function parsePermanentAppUrl(databaseUrl: string | undefined): {
  host: string;
  port: number;
  database: string;
  role: string;
} {
  if (!databaseUrl) throw new Error('STOP_MISSING_DATABASE_URL');
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('STOP_DATABASE_URL_INVALID');
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error('STOP_DATABASE_URL_PROTOCOL');
  }
  if (parsed.port === '') throw new Error('STOP_DATABASE_PORT_UNSPECIFIED');
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  const role = decodeURIComponent(parsed.username);
  return {
    host: parsed.hostname,
    port: Number(parsed.port),
    database,
    role,
  };
}

export function assertPermanentAppTarget(coords: {
  host: string;
  port: number;
  database: string;
  role: string;
}): void {
  if (coords.host !== BP02_HOST) throw new Error('STOP_HOST_MISMATCH');
  if (coords.port !== BP02_PORT) throw new Error('STOP_PORT_MISMATCH');
  if (coords.database !== BP02_DATABASE) throw new Error('STOP_DATABASE_MISMATCH');
  if (coords.role !== BP02_ROLE) throw new Error('STOP_ROLE_MISMATCH');
}

export function targetFromEnvironment(env: Bp02ApplyEnvironment): Bp02Target {
  const workspaceId = required(env.BP02_TARGET_WORKSPACE_ID, 'TARGET_WORKSPACE_ID');
  const organizationId = required(
    env.BP02_EXPECTED_ORGANIZATION_ID,
    'EXPECTED_ORGANIZATION_ID',
  );
  assertUuid(workspaceId, 'TARGET_WORKSPACE_ID');
  assertUuid(organizationId, 'EXPECTED_ORGANIZATION_ID');
  const verifierEmail = required(env.BP02_VERIFIER_EMAIL, 'VERIFIER_EMAIL').toLowerCase();
  const publisherEmail = required(
    env.BP02_PUBLISHER_EMAIL,
    'PUBLISHER_EMAIL',
  ).toLowerCase();
  if (verifierEmail === publisherEmail) {
    throw new Error('STOP_VERIFIER_PUBLISHER_EMAIL_COLLISION');
  }
  const ownerEmail = (
    env.BP02_OWNER_EMAIL?.trim() || 'fekyigo@gmail.com'
  ).toLowerCase();
  if (verifierEmail === ownerEmail || publisherEmail === ownerEmail) {
    throw new Error('STOP_OWNER_MUST_NOT_BE_VERIFIER_OR_PUBLISHER');
  }
  return {
    workspaceId,
    organizationId,
    verifierEmail,
    publisherEmail,
    verifierDisplayName:
      env.BP02_VERIFIER_DISPLAY_NAME?.trim() || 'Basic Price Verifier',
    publisherDisplayName:
      env.BP02_PUBLISHER_DISPLAY_NAME?.trim() || 'Basic Price Publisher',
    ownerEmail,
  };
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
  if (row.session_role !== BP02_ROLE) throw new Error('STOP_LIVE_ROLE_MISMATCH');
}

async function computePlan(
  client: Bp02SqlClient,
  target: Bp02Target,
  lock: boolean,
): Promise<Bp02HashedPlan> {
  await assertLiveDatabase(client);

  const ws = await client.query<{
    id: string;
    organizationId: string;
  }>(
    `SELECT id, "organizationId" FROM workspaces WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [target.workspaceId],
  );
  if (ws.rowCount !== 1) throw new Error('STOP_WORKSPACE_NOT_FOUND');
  if (ws.rows[0].organizationId !== target.organizationId) {
    throw new Error('STOP_ORGANIZATION_WORKSPACE_DRIFT');
  }

  const permissionRows = await client.query<{
    id: string;
    code: string;
    name: string;
    description: string | null;
  }>(
    `SELECT id, code, name, description FROM permissions
     WHERE code = ANY($1::text[]) ORDER BY code`,
    [BP02_PERMISSION_METADATA.map((p) => p.code)],
  );
  const permissionByCode = new Map(
    permissionRows.rows.map((row) => [row.code, row]),
  );
  const permissionActions = BP02_PERMISSION_METADATA.map((meta) => {
    const row = permissionByCode.get(meta.code);
    if (
      row &&
      (row.name !== meta.name || (row.description ?? null) !== meta.description)
    ) {
      // Existing row with different prose is reusable by code; do not rewrite.
      // Only refuse empty/conflicting code collisions that are not our codes.
    }
    return {
      code: meta.code,
      permissionId: row?.id ?? null,
      action: row ? ('NONE' as const) : ('INSERT_PERMISSION' as const),
    };
  });

  const roleCodes = [BP02_VERIFIER_ROLE_CODE, BP02_PUBLISHER_ROLE_CODE];
  const roles = await client.query<{ id: string; code: string }>(
    `SELECT id, code FROM roles
     WHERE "workspaceId" = $1 AND code = ANY($2::text[])
     ${lock ? 'FOR UPDATE' : ''}`,
    [target.workspaceId, roleCodes],
  );
  const roleByCode = new Map(roles.rows.map((r) => [r.code, r]));
  const roleActions = roleCodes.map((code) => ({
    code: code as typeof BP02_VERIFIER_ROLE_CODE | typeof BP02_PUBLISHER_ROLE_CODE,
    roleId: roleByCode.get(code)?.id ?? null,
    action: roleByCode.get(code) ? ('NONE' as const) : ('INSERT_ROLE' as const),
  }));

  const desiredGrants: Array<{
    roleCode: typeof BP02_VERIFIER_ROLE_CODE | typeof BP02_PUBLISHER_ROLE_CODE;
    permissionCode: string;
  }> = [
    ...BP02_VERIFIER_PERMISSION_CODES.map((permissionCode) => ({
      roleCode: BP02_VERIFIER_ROLE_CODE as typeof BP02_VERIFIER_ROLE_CODE,
      permissionCode,
    })),
    ...BP02_PUBLISHER_PERMISSION_CODES.map((permissionCode) => ({
      roleCode: BP02_PUBLISHER_ROLE_CODE as typeof BP02_PUBLISHER_ROLE_CODE,
      permissionCode,
    })),
  ];

  const grantActions: Bp02Plan['grantActions'] = [];
  for (const grant of desiredGrants) {
    const roleId = roleByCode.get(grant.roleCode)?.id;
    const permissionId = permissionByCode.get(grant.permissionCode)?.id;
    let action: 'NONE' | 'INSERT_ROLE_PERMISSION' = 'INSERT_ROLE_PERMISSION';
    if (roleId && permissionId) {
      const existing = await client.query(
        `SELECT 1 FROM role_permissions WHERE "roleId" = $1 AND "permissionId" = $2`,
        [roleId, permissionId],
      );
      if (existing.rowCount > 0) action = 'NONE';
    }
    grantActions.push({ ...grant, action });
  }

  // Refuse SoD poison: verifier role must never hold PUBLISH; publisher never VERIFY.
  for (const roleCode of roleCodes) {
    const roleId = roleByCode.get(roleCode)?.id;
    if (!roleId) continue;
    const held = await client.query<{ code: string }>(
      `SELECT p.code FROM role_permissions rp
       JOIN permissions p ON p.id = rp."permissionId"
       WHERE rp."roleId" = $1`,
      [roleId],
    );
    const codes = new Set(held.rows.map((r) => r.code));
    if (roleCode === BP02_VERIFIER_ROLE_CODE && codes.has('BASIC_PRICE_PUBLISH')) {
      throw new Error('STOP_VERIFIER_ROLE_HAS_PUBLISH');
    }
    if (roleCode === BP02_PUBLISHER_ROLE_CODE && codes.has('BASIC_PRICE_VERIFY')) {
      throw new Error('STOP_PUBLISHER_ROLE_HAS_VERIFY');
    }
  }

  async function actorPlan(
    kind: 'VERIFIER' | 'PUBLISHER',
    email: string,
  ): Promise<Bp02Plan['actorActions'][number]> {
    const account = await client.query<{ id: string }>(
      `SELECT id FROM accounts WHERE lower(email) = lower($1)`,
      [email],
    );
    const accountId = account.rows[0]?.id ?? null;
    let membershipId: string | null = null;
    let userId: string | null = null;
    let membershipRoleId: string | null = null;
    if (accountId) {
      const membership = await client.query<{ id: string; status: string }>(
        `SELECT id, status::text AS status FROM workspace_memberships
         WHERE "accountId" = $1 AND "workspaceId" = $2`,
        [accountId, target.workspaceId],
      );
      membershipId = membership.rows[0]?.id ?? null;
      if (membershipId) {
        const user = await client.query<{ id: string }>(
          `SELECT id FROM users WHERE "workspaceMembershipId" = $1`,
          [membershipId],
        );
        userId = user.rows[0]?.id ?? null;
        const roleCode =
          kind === 'VERIFIER' ? BP02_VERIFIER_ROLE_CODE : BP02_PUBLISHER_ROLE_CODE;
        const roleId = roleByCode.get(roleCode)?.id;
        if (roleId) {
          const mr = await client.query<{ id: string }>(
            `SELECT id FROM membership_roles
             WHERE "workspaceMembershipId" = $1 AND "roleId" = $2 AND "isActive" = true`,
            [membershipId, roleId],
          );
          membershipRoleId = mr.rows[0]?.id ?? null;
        }
      }
    }
    return {
      kind,
      email,
      accountId,
      membershipId,
      userId,
      membershipRoleId,
      accountAction: accountId ? 'NONE' : 'INSERT_ACCOUNT',
      membershipAction: membershipId ? 'NONE' : 'INSERT_MEMBERSHIP',
      userAction: userId ? 'NONE' : 'INSERT_USER',
      membershipRoleAction: membershipRoleId ? 'NONE' : 'INSERT_MEMBERSHIP_ROLE',
    };
  }

  const actorActions = [
    await actorPlan('VERIFIER', target.verifierEmail),
    await actorPlan('PUBLISHER', target.publisherEmail),
  ];

  if (
    actorActions[0].accountId &&
    actorActions[1].accountId &&
    actorActions[0].accountId === actorActions[1].accountId
  ) {
    throw new Error('STOP_VERIFIER_PUBLISHER_ACCOUNT_COLLISION');
  }

  const directorCuration = await client.query<{ cnt: string }>(
    `SELECT count(*)::text AS cnt
     FROM roles r
     JOIN role_permissions rp ON rp."roleId" = r.id
     JOIN permissions p ON p.id = rp."permissionId"
     WHERE r."workspaceId" = $1 AND r.code = 'DIRECTOR'
       AND p.code = ANY($2::text[])`,
    [target.workspaceId, BP02_PERMISSION_METADATA.map((p) => p.code)],
  );
  const directorHasCurationGrant = Number(directorCuration.rows[0]?.cnt ?? 0) > 0;

  const ownerCuration = await client.query<{ cnt: string }>(
    `SELECT count(*)::text AS cnt
     FROM accounts a
     JOIN workspace_memberships wm ON wm."accountId" = a.id
     JOIN membership_roles mr ON mr."workspaceMembershipId" = wm.id AND mr."isActive" = true
     JOIN roles r ON r.id = mr."roleId"
     JOIN role_permissions rp ON rp."roleId" = r.id
     JOIN permissions p ON p.id = rp."permissionId"
     WHERE wm."workspaceId" = $1
       AND lower(a.email) = lower($2)
       AND p.code = ANY($3::text[])
       AND r.code = ANY($4::text[])`,
    [
      target.workspaceId,
      target.ownerEmail,
      BP02_PERMISSION_METADATA.map((p) => p.code),
      roleCodes,
    ],
  );
  const ownerAccountHasCurationViaRole =
    Number(ownerCuration.rows[0]?.cnt ?? 0) > 0;

  const expectedChanges =
    permissionActions.filter((a) => a.action !== 'NONE').length +
    roleActions.filter((a) => a.action !== 'NONE').length +
    grantActions.filter((a) => a.action !== 'NONE').length +
    actorActions.reduce(
      (n, a) =>
        n +
        (a.accountAction !== 'NONE' ? 1 : 0) +
        (a.membershipAction !== 'NONE' ? 1 : 0) +
        (a.userAction !== 'NONE' ? 1 : 0) +
        (a.membershipRoleAction !== 'NONE' ? 1 : 0),
      0,
    );

  const plan: Bp02Plan = {
    database: BP02_DATABASE,
    host: BP02_HOST,
    port: BP02_PORT,
    role: BP02_ROLE,
    target,
    permissionActions,
    roleActions,
    grantActions,
    actorActions,
    expectedChanges,
    directorHasCurationGrant,
    ownerAccountHasCurationViaRole,
  };
  const json = canonicalJson(plan);
  return { plan, canonicalJson: json, sha256: sha256(json) };
}

export async function planBp02Activation(
  client: Bp02SqlClient,
  target: Bp02Target,
): Promise<Bp02HashedPlan> {
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
  env: Bp02ApplyEnvironment,
): Promise<void> {
  if (env.BP02_CONFIRM !== BP02_CONFIRMATION) {
    throw new Error('STOP_APPLY_CONFIRMATION_MISMATCH');
  }
  required(env.BP02_OWNER_AUTHORIZATION_ID, 'OWNER_AUTHORIZATION_ID');
  const databaseUrl = required(env.DATABASE_URL, 'DATABASE_URL');
  assertPermanentAppTarget(parsePermanentAppUrl(databaseUrl));
  const expectedPlan = required(
    env.BP02_EXPECTED_PLAN_SHA256,
    'EXPECTED_PLAN_SHA256',
  );
  const expectedBackup = required(env.BP02_BACKUP_SHA256, 'BACKUP_SHA256');
  if (!SHA256.test(expectedPlan) || !SHA256.test(expectedBackup)) {
    throw new Error('STOP_INVALID_SHA256');
  }
  const backup = required(env.BP02_BACKUP_FILE, 'BACKUP_FILE');
  if (!existsSync(backup) || statSync(backup).size <= 0) {
    throw new Error('STOP_BACKUP_MISSING_OR_EMPTY');
  }
  if ((await hashFile(backup)) !== expectedBackup.toLowerCase()) {
    throw new Error('STOP_BACKUP_SHA256_MISMATCH');
  }
  required(env.BP02_SECRETS_OUT_DIR, 'SECRETS_OUT_DIR');
}

function generatePassword(): string {
  return `Bp${randomBytes(18).toString('base64url')}!7A`;
}

export async function applyBp02Activation(
  client: Bp02SqlClient,
  env: Bp02ApplyEnvironment,
): Promise<{
  changesApplied: number;
  after: Bp02HashedPlan;
  verifierAccountId: string;
  publisherAccountId: string;
  secretsWritten: string;
}> {
  await assertApplyPrerequisites(env);
  const target = targetFromEnvironment(env);
  const expectedPlanSha = required(
    env.BP02_EXPECTED_PLAN_SHA256,
    'EXPECTED_PLAN_SHA256',
  ).toLowerCase();
  const secretsOut = required(env.BP02_SECRETS_OUT_DIR, 'SECRETS_OUT_DIR');

  const verifierPassword = generatePassword();
  const publisherPassword = generatePassword();
  const verifierHash = await bcrypt.hash(verifierPassword, SALT_ROUNDS);
  const publisherHash = await bcrypt.hash(publisherPassword, SALT_ROUNDS);

  await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
  try {
    const before = await computePlan(client, target, true);
    if (before.sha256 !== expectedPlanSha) {
      throw new Error('STOP_PLAN_SHA256_DRIFT');
    }
    if (before.plan.directorHasCurationGrant) {
      throw new Error('STOP_DIRECTOR_ALREADY_HAS_CURATION_GRANT');
    }
    if (before.plan.ownerAccountHasCurationViaRole) {
      throw new Error('STOP_OWNER_ALREADY_HAS_CURATION_VIA_ROLE');
    }

    let changesApplied = 0;
    const permissionIdByCode = new Map<string, string>();

    for (const meta of BP02_PERMISSION_METADATA) {
      const entry = before.plan.permissionActions.find((e) => e.code === meta.code)!;
      let permissionId = entry.permissionId;
      if (entry.action === 'INSERT_PERMISSION') {
        permissionId = randomUUID();
        const inserted = await client.query(
          `INSERT INTO permissions (id, code, name, description, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, NOW(), NOW())
           ON CONFLICT (code) DO NOTHING`,
          [permissionId, meta.code, meta.name, meta.description],
        );
        changesApplied += inserted.rowCount;
        if (inserted.rowCount === 0) {
          const existing = await client.query<{ id: string }>(
            `SELECT id FROM permissions WHERE code = $1`,
            [meta.code],
          );
          permissionId = existing.rows[0]?.id ?? null;
        }
      } else if (!permissionId) {
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM permissions WHERE code = $1`,
          [meta.code],
        );
        permissionId = existing.rows[0]?.id ?? null;
      }
      if (!permissionId) throw new Error(`STOP_PERMISSION_UNRESOLVED_${meta.code}`);
      permissionIdByCode.set(meta.code, permissionId);
    }

    const roleIdByCode = new Map<string, string>();
    const roleDefs = [
      {
        code: BP02_VERIFIER_ROLE_CODE,
        name: 'Basic Price Verifier',
        description: 'Governed curation verifier — REVIEW_VIEW + VERIFY only.',
      },
      {
        code: BP02_PUBLISHER_ROLE_CODE,
        name: 'Basic Price Publisher',
        description: 'Governed curation publisher — PUBLISH only.',
      },
    ] as const;
    for (const def of roleDefs) {
      const entry = before.plan.roleActions.find((e) => e.code === def.code)!;
      let roleId = entry.roleId;
      if (entry.action === 'INSERT_ROLE') {
        roleId = randomUUID();
        const inserted = await client.query(
          `INSERT INTO roles (id, "workspaceId", code, name, description, "isSystem", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, true, NOW(), NOW())
           ON CONFLICT ("workspaceId", code) DO NOTHING`,
          [roleId, target.workspaceId, def.code, def.name, def.description],
        );
        changesApplied += inserted.rowCount;
        if (inserted.rowCount === 0) {
          const existing = await client.query<{ id: string }>(
            `SELECT id FROM roles WHERE "workspaceId" = $1 AND code = $2`,
            [target.workspaceId, def.code],
          );
          roleId = existing.rows[0]?.id ?? null;
        }
      } else if (!roleId) {
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM roles WHERE "workspaceId" = $1 AND code = $2`,
          [target.workspaceId, def.code],
        );
        roleId = existing.rows[0]?.id ?? null;
      }
      if (!roleId) throw new Error(`STOP_ROLE_UNRESOLVED_${def.code}`);
      roleIdByCode.set(def.code, roleId);
    }

    for (const grant of before.plan.grantActions) {
      if (grant.action === 'NONE') continue;
      const roleId = roleIdByCode.get(grant.roleCode);
      const permissionId = permissionIdByCode.get(grant.permissionCode);
      if (!roleId || !permissionId) throw new Error('STOP_GRANT_IDS_UNRESOLVED');
      const inserted = await client.query(
        `INSERT INTO role_permissions (id, "roleId", "permissionId", "createdAt")
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT ("roleId", "permissionId") DO NOTHING`,
        [randomUUID(), roleId, permissionId],
      );
      changesApplied += inserted.rowCount;
    }

    async function ensureActor(
      kind: 'VERIFIER' | 'PUBLISHER',
      email: string,
      displayName: string,
      passwordHash: string,
      roleCode: string,
      prior: Bp02Plan['actorActions'][number],
    ): Promise<string> {
      let accountId = prior.accountId;
      if (prior.accountAction === 'INSERT_ACCOUNT') {
        accountId = randomUUID();
        const inserted = await client.query(
          `INSERT INTO accounts (id, email, "passwordHash", "displayName", status, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW())
           ON CONFLICT (email) DO NOTHING`,
          [accountId, email, passwordHash, displayName],
        );
        changesApplied += inserted.rowCount;
        if (inserted.rowCount === 0) {
          const existing = await client.query<{ id: string }>(
            `SELECT id FROM accounts WHERE lower(email) = lower($1)`,
            [email],
          );
          accountId = existing.rows[0]?.id ?? null;
        }
      }
      if (!accountId) throw new Error(`STOP_ACCOUNT_UNRESOLVED_${kind}`);

      let membershipId = prior.membershipId;
      if (prior.membershipAction === 'INSERT_MEMBERSHIP') {
        membershipId = randomUUID();
        const inserted = await client.query(
          `INSERT INTO workspace_memberships (id, "accountId", "workspaceId", status, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, 'ACTIVE', NOW(), NOW())
           ON CONFLICT ("accountId", "workspaceId") DO NOTHING`,
          [membershipId, accountId, target.workspaceId],
        );
        changesApplied += inserted.rowCount;
        if (inserted.rowCount === 0) {
          const existing = await client.query<{ id: string }>(
            `SELECT id FROM workspace_memberships WHERE "accountId" = $1 AND "workspaceId" = $2`,
            [accountId, target.workspaceId],
          );
          membershipId = existing.rows[0]?.id ?? null;
        } else {
          // ensure ACTIVE if conflict path not taken — already ACTIVE
        }
      }
      if (!membershipId) throw new Error(`STOP_MEMBERSHIP_UNRESOLVED_${kind}`);
      await client.query(
        `UPDATE workspace_memberships SET status = 'ACTIVE', "updatedAt" = NOW() WHERE id = $1`,
        [membershipId],
      );

      let userId = prior.userId;
      if (prior.userAction === 'INSERT_USER') {
        userId = randomUUID();
        const inserted = await client.query(
          `INSERT INTO users (id, "workspaceMembershipId", "workspaceId", "fullName", status, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW())
           ON CONFLICT ("workspaceMembershipId") DO NOTHING`,
          [userId, membershipId, target.workspaceId, displayName],
        );
        changesApplied += inserted.rowCount;
      }

      const roleId = roleIdByCode.get(roleCode);
      if (!roleId) throw new Error(`STOP_ROLE_MISSING_${roleCode}`);
      if (prior.membershipRoleAction === 'INSERT_MEMBERSHIP_ROLE') {
        const inserted = await client.query(
          `INSERT INTO membership_roles (id, "workspaceMembershipId", "roleId", "startDate", "isActive", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, NOW(), true, NOW(), NOW())`,
          [randomUUID(), membershipId, roleId],
        );
        changesApplied += inserted.rowCount;
      }
      return accountId;
    }

    const verifierAccountId = await ensureActor(
      'VERIFIER',
      target.verifierEmail,
      target.verifierDisplayName,
      verifierHash,
      BP02_VERIFIER_ROLE_CODE,
      before.plan.actorActions.find((a) => a.kind === 'VERIFIER')!,
    );
    const publisherAccountId = await ensureActor(
      'PUBLISHER',
      target.publisherEmail,
      target.publisherDisplayName,
      publisherHash,
      BP02_PUBLISHER_ROLE_CODE,
      before.plan.actorActions.find((a) => a.kind === 'PUBLISHER')!,
    );

    if (verifierAccountId === publisherAccountId) {
      throw new Error('STOP_VERIFIER_PUBLISHER_ACCOUNT_COLLISION');
    }

    // SoD proof inside the same transaction
    await assertSoD(client, target.workspaceId, verifierAccountId, publisherAccountId);

    const after = await computePlan(client, target, false);
    if (after.plan.expectedChanges !== 0) {
      // Idempotent leftovers that are NONE-only are ok; any remaining INSERT means incomplete.
      const leftover =
        after.plan.permissionActions.some((a) => a.action !== 'NONE') ||
        after.plan.roleActions.some((a) => a.action !== 'NONE') ||
        after.plan.grantActions.some((a) => a.action !== 'NONE') ||
        after.plan.actorActions.some(
          (a) =>
            a.accountAction !== 'NONE' ||
            a.membershipAction !== 'NONE' ||
            a.userAction !== 'NONE' ||
            a.membershipRoleAction !== 'NONE',
        );
      if (leftover) throw new Error('STOP_POSTCONDITION_INCOMPLETE');
    }
    if (after.plan.directorHasCurationGrant) {
      throw new Error('STOP_DIRECTOR_RECEIVED_CURATION_GRANT');
    }
    if (after.plan.ownerAccountHasCurationViaRole) {
      throw new Error('STOP_OWNER_RECEIVED_CURATION_VIA_ROLE');
    }

    await client.query('COMMIT');

    mkdirSync(secretsOut, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const secretsPath = `${secretsOut}/bp-provisioning-02.${stamp}.env`;
    writeFileSync(
      secretsPath,
      [
        `WORKSPACE_ID=${target.workspaceId}`,
        `ORGANIZATION_ID=${target.organizationId}`,
        `VERIFIER_EMAIL=${target.verifierEmail}`,
        `VERIFIER_ACCOUNT_ID=${verifierAccountId}`,
        `VERIFIER_PASSWORD=${verifierPassword}`,
        `PUBLISHER_EMAIL=${target.publisherEmail}`,
        `PUBLISHER_ACCOUNT_ID=${publisherAccountId}`,
        `PUBLISHER_PASSWORD=${publisherPassword}`,
        `OWNER_AUTHORIZATION_ID=${env.BP02_OWNER_AUTHORIZATION_ID}`,
        `PLAN_SHA256=${expectedPlanSha}`,
        `ACTIVATED_AT=${new Date().toISOString()}`,
        '',
      ].join('\n'),
      { encoding: 'utf8', mode: 0o600 },
    );

    return {
      changesApplied,
      after,
      verifierAccountId,
      publisherAccountId,
      secretsWritten: secretsPath,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function assertSoD(
  client: Bp02SqlClient,
  workspaceId: string,
  verifierAccountId: string,
  publisherAccountId: string,
): Promise<void> {
  if (verifierAccountId === publisherAccountId) {
    throw new Error('STOP_SOD_SAME_ACCOUNT');
  }
  const codesFor = async (accountId: string) => {
    const rows = await client.query<{ code: string }>(
      `SELECT DISTINCT p.code
       FROM workspace_memberships wm
       JOIN membership_roles mr ON mr."workspaceMembershipId" = wm.id AND mr."isActive" = true
       JOIN role_permissions rp ON rp."roleId" = mr."roleId"
       JOIN permissions p ON p.id = rp."permissionId"
       WHERE wm."accountId" = $1 AND wm."workspaceId" = $2 AND wm.status = 'ACTIVE'`,
      [accountId, workspaceId],
    );
    return new Set(rows.rows.map((r) => r.code));
  };
  const v = await codesFor(verifierAccountId);
  const p = await codesFor(publisherAccountId);
  if (!v.has('BASIC_PRICE_REVIEW_VIEW') || !v.has('BASIC_PRICE_VERIFY')) {
    throw new Error('STOP_SOD_VERIFIER_MISSING_REQUIRED');
  }
  if (v.has('BASIC_PRICE_PUBLISH')) throw new Error('STOP_SOD_VERIFIER_HAS_PUBLISH');
  if (!p.has('BASIC_PRICE_PUBLISH')) {
    throw new Error('STOP_SOD_PUBLISHER_MISSING_PUBLISH');
  }
  if (p.has('BASIC_PRICE_VERIFY')) throw new Error('STOP_SOD_PUBLISHER_HAS_VERIFY');
}

export function sanitizedResult(value: unknown): string {
  return canonicalJson(value);
}

export function redactSecretsPathMessage(path: string): string {
  return `SECRETS_WRITTEN=${dirname(path)}/<redacted-filename>`;
}
