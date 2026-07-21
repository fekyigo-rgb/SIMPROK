import type { PrismaClient } from '@prisma/client';

// Intentionally not imported from scripts/test-database-guard.ts: src/ and
// scripts/ are separate compilation surfaces in this repo (nest build only
// compiles src/), and importing across that boundary pulls scripts/ into
// this build, surfacing an unrelated pre-existing scripts/ type error
// (UTANG-TSC-10 territory) that is out of scope for this slice. The two
// constants are duplicated here on purpose, in sync with the values in
// scripts/test-database-guard.ts.
const EXPECTED_TEST_DATABASE = 'simprok_test';
const FORBIDDEN_PRODUCTION_DATABASE = 'simprok_db';

/**
 * RM-01a-CODE §6.6 — a narrow, targeted, test-only activation planner for
 * UTANG-PERMISSION-08. This is NOT a general RBAC seed mechanism and must
 * never be confused with prisma/seed-rbac-permissions.ts, whose scope is
 * intentionally far broader than this RM-01 pilot (see §4 audit fact 7).
 *
 * Hard scope, enforced at runtime, not just by convention:
 *   - exactly one explicit workspaceId, never a wildcard or "all workspaces";
 *   - exactly roleCode "DIRECTOR" in that one workspace, never all DIRECTOR
 *     roles across workspaces;
 *   - permission codes are restricted to RM01_ALLOWLISTED_PERMISSION_CODES
 *     (RAB_VIEW, RAB_DRAFT_EDIT) — no AHSP/Basic Price/Field Progress/other
 *     domain can be planned or applied through this module;
 *   - never creates a new Role;
 *   - never revokes/deletes anything — additive only;
 *   - refuses to run against anything other than simprok_test.
 */

export const RM01_ALLOWLISTED_PERMISSION_CODES = [
  'RAB_VIEW',
  'RAB_DRAFT_EDIT',
] as const;
export type Rm01AllowlistedPermissionCode =
  (typeof RM01_ALLOWLISTED_PERMISSION_CODES)[number];

const PERMISSION_METADATA: Record<
  Rm01AllowlistedPermissionCode,
  { name: string; description: string }
> = {
  RAB_VIEW: {
    name: 'View RAB',
    description: 'View RAB drafts and bounded import previews.',
  },
  RAB_DRAFT_EDIT: {
    name: 'Edit RAB Draft',
    description: 'Edit RAB drafts and approve bounded BOQ imports.',
  },
};

export interface ActivationTarget {
  workspaceId: string;
  roleCode: string;
  permissionCodes: readonly string[];
}

export interface ActivationPlanEntry {
  permissionCode: string;
  permissionExists: boolean;
  permissionAction: 'NONE' | 'CREATE_PERMISSION';
  rolePermissionExists: boolean;
  rolePermissionAction: 'NONE' | 'GRANT';
}

export interface ActivationPlan {
  target: ActivationTarget;
  roleId: string | null;
  entries: ActivationPlanEntry[];
  ambiguous: boolean;
  ambiguityReason?: string;
}

export interface ActivationApplyResult {
  before: ActivationPlan;
  after: ActivationPlan;
  changesApplied: number;
}

function assertNarrowTarget(target: ActivationTarget): void {
  if (!target.workspaceId || target.workspaceId.trim() === '') {
    throw new Error(
      'ActivationTarget.workspaceId is required and must be one explicit workspace id — no wildcard.',
    );
  }
  if (target.roleCode !== 'DIRECTOR') {
    throw new Error(
      'This planner only targets roleCode=DIRECTOR by explicit RM-01a-CODE scope; refusing all other role codes.',
    );
  }
  if (target.permissionCodes.length === 0) {
    throw new Error('ActivationTarget.permissionCodes must not be empty.');
  }
  for (const code of target.permissionCodes) {
    if (
      !(RM01_ALLOWLISTED_PERMISSION_CODES as readonly string[]).includes(code)
    ) {
      throw new Error(
        `Permission code "${code}" is outside the RM-01a allowlist (${RM01_ALLOWLISTED_PERMISSION_CODES.join(', ')}). Refusing.`,
      );
    }
  }
}

export async function assertExpectedTestDatabase(
  prisma: PrismaClient,
): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<
    Array<{ current_database: string }>
  >('SELECT current_database()');
  const name = rows[0]?.current_database;
  if (name === FORBIDDEN_PRODUCTION_DATABASE) {
    throw new Error(
      `Refusing to run: connected database is the forbidden production database "${FORBIDDEN_PRODUCTION_DATABASE}". This planner never runs against simprok_db.`,
    );
  }
  if (name !== EXPECTED_TEST_DATABASE) {
    throw new Error(
      `Refusing to run: expected database "${EXPECTED_TEST_DATABASE}", found "${name}".`,
    );
  }
}

/** Read-only. Never writes. Safe to call against simprok_test freely. */
export async function planActivation(
  prisma: PrismaClient,
  target: ActivationTarget,
): Promise<ActivationPlan> {
  assertNarrowTarget(target);
  await assertExpectedTestDatabase(prisma);

  const roles = await prisma.role.findMany({
    where: { workspaceId: target.workspaceId, code: target.roleCode },
  });

  if (roles.length === 0) {
    return {
      target,
      roleId: null,
      entries: [],
      ambiguous: true,
      ambiguityReason: `No role with code "${target.roleCode}" exists in workspace "${target.workspaceId}".`,
    };
  }
  if (roles.length > 1) {
    return {
      target,
      roleId: null,
      entries: [],
      ambiguous: true,
      ambiguityReason: `Multiple roles with code "${target.roleCode}" exist in workspace "${target.workspaceId}"; refusing to guess.`,
    };
  }

  const role = roles[0];
  const entries: ActivationPlanEntry[] = [];

  for (const code of target.permissionCodes) {
    const permission = await prisma.permission.findUnique({ where: { code } });
    const permissionExists = permission !== null;
    let rolePermissionExists = false;
    if (permission) {
      const rolePermission = await prisma.rolePermission.findUnique({
        where: {
          roleId_permissionId: { roleId: role.id, permissionId: permission.id },
        },
      });
      rolePermissionExists = rolePermission !== null;
    }
    entries.push({
      permissionCode: code,
      permissionExists,
      permissionAction: permissionExists ? 'NONE' : 'CREATE_PERMISSION',
      rolePermissionExists,
      rolePermissionAction: rolePermissionExists ? 'NONE' : 'GRANT',
    });
  }

  return { target, roleId: role.id, entries, ambiguous: false };
}

/**
 * Writes. Requires an explicit { confirm: true } flag. Additive only:
 * creates a missing Permission row (allowlisted code only) and/or a missing
 * RolePermission grant. Never revokes, never deletes, never creates a Role.
 * Transaction-safe and idempotent — re-applying an already-applied plan
 * produces changesApplied === 0.
 */
export async function applyActivation(
  prisma: PrismaClient,
  target: ActivationTarget,
  options: { confirm: true },
): Promise<ActivationApplyResult> {
  if (options?.confirm !== true) {
    throw new Error(
      'applyActivation requires an explicit { confirm: true } option — refusing to write silently.',
    );
  }

  const before = await planActivation(prisma, target);
  if (before.ambiguous || !before.roleId) {
    throw new Error(
      before.ambiguityReason ??
        'Refusing to apply: activation target is ambiguous.',
    );
  }
  const roleId = before.roleId;

  let changesApplied = 0;

  await prisma.$transaction(async (tx) => {
    for (const entry of before.entries) {
      let permission = await tx.permission.findUnique({
        where: { code: entry.permissionCode },
      });
      if (!permission) {
        const metadata =
          PERMISSION_METADATA[
            entry.permissionCode as Rm01AllowlistedPermissionCode
          ];
        permission = await tx.permission.create({
          data: {
            code: entry.permissionCode,
            name: metadata.name,
            description: metadata.description,
          },
        });
        changesApplied += 1;
      }

      const existingGrant = await tx.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId, permissionId: permission.id } },
      });
      if (!existingGrant) {
        await tx.rolePermission.create({
          data: { roleId, permissionId: permission.id },
        });
        changesApplied += 1;
      }
    }
  });

  const after = await planActivation(prisma, target);
  return { before, after, changesApplied };
}
