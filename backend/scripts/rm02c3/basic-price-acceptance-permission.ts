import { Client } from 'pg';
import {
  applyRm02c3Activation,
  planRm02c3Activation,
  RM02C3_ACCEPTANCE_TARGET,
  Rm02c3ActivationError,
  type Rm02c3SqlClient,
} from '../../src/auth/rm02c3-basic-price-acceptance-activation';
import {
  loadAcceptanceEnvironment,
  verifyAcceptanceDatabase,
} from '../database-role-guards';
import { captureDatabaseFingerprint } from '../e2e-database-lifecycle';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function pgAdapter(client: Client): Rm02c3SqlClient {
  return {
    query: async <T>(text: string, values?: readonly unknown[]) => {
      const result = await client.query(text, values ? [...values] : undefined);
      return {
        rows: result.rows as T[],
        rowCount: result.rowCount,
      };
    },
  };
}

async function main(): Promise<void> {
  loadAcceptanceEnvironment();
  await verifyAcceptanceDatabase();

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    if (process.argv.includes('--snapshot')) {
      const fingerprints = await captureDatabaseFingerprint(client);
      const counts = await client.query<{
        resourceCatalogCount: string;
        resourceSourceIdentityCount: string;
      }>(
        `SELECT
           (SELECT count(*) FROM resource_catalogs WHERE "workspaceId" = $1)::text
             AS "resourceCatalogCount",
           (SELECT count(*) FROM resource_source_identities WHERE "workspaceId" = $1)::text
             AS "resourceSourceIdentityCount"`,
        [RM02C3_ACCEPTANCE_TARGET.workspaceId],
      );
      const authority = await client.query<{
        effectivePermissions: string[];
        unexpectedRolePermissionCount: string;
        unauthorizedAccountGrantCount: string;
      }>(
        `WITH target_role AS (
           SELECT id
             FROM roles
            WHERE "workspaceId" = $1 AND code = $2
         ),
         allowed_codes AS (
           SELECT unnest($4::text[]) AS code
         )
         SELECT
           COALESCE((
             SELECT array_agg(DISTINCT p.code ORDER BY p.code)
               FROM target_role tr
               JOIN role_permissions rp ON rp."roleId" = tr.id
               JOIN permissions p ON p.id = rp."permissionId"
               JOIN membership_roles mr ON mr."roleId" = tr.id
               JOIN workspace_memberships wm
                 ON wm.id = mr."workspaceMembershipId"
               JOIN accounts a ON a.id = wm."accountId"
              WHERE lower(a.email) = lower($3)
                AND wm.status = 'ACTIVE'
                AND mr."isActive" = true
                AND (mr."endDate" IS NULL OR mr."endDate" > CURRENT_TIMESTAMP)
           ), ARRAY[]::text[]) AS "effectivePermissions",
           (
             SELECT count(*)::text
               FROM target_role tr
               JOIN role_permissions rp ON rp."roleId" = tr.id
               JOIN permissions p ON p.id = rp."permissionId"
              WHERE NOT EXISTS (
                SELECT 1 FROM allowed_codes ac WHERE ac.code = p.code
              )
           ) AS "unexpectedRolePermissionCount",
           (
             SELECT count(*)::text
               FROM target_role tr
               JOIN membership_roles mr ON mr."roleId" = tr.id
               JOIN workspace_memberships wm
                 ON wm.id = mr."workspaceMembershipId"
               JOIN accounts a ON a.id = wm."accountId"
              WHERE lower(a.email) <> lower($3)
           ) AS "unauthorizedAccountGrantCount"`,
        [
          RM02C3_ACCEPTANCE_TARGET.workspaceId,
          RM02C3_ACCEPTANCE_TARGET.roleCode,
          RM02C3_ACCEPTANCE_TARGET.accountEmail,
          ['BASIC_PRICE_IMPORT', 'BASIC_PRICE_REVIEW_VIEW'],
        ],
      );
      process.stdout.write(
        `${JSON.stringify({
          status: 'RM02C3_SNAPSHOT_PASS',
          databaseName: RM02C3_ACCEPTANCE_TARGET.databaseName,
          workspaceId: RM02C3_ACCEPTANCE_TARGET.workspaceId,
          resourceCatalogCount: Number(counts.rows[0].resourceCatalogCount),
          resourceSourceIdentityCount: Number(
            counts.rows[0].resourceSourceIdentityCount,
          ),
          effectivePermissions: authority.rows[0].effectivePermissions,
          unexpectedRolePermissionCount: Number(
            authority.rows[0].unexpectedRolePermissionCount,
          ),
          unauthorizedAccountGrantCount: Number(
            authority.rows[0].unauthorizedAccountGrantCount,
          ),
          fingerprints,
        })}\n`,
      );
      return;
    }

    if (process.argv.includes('--plan')) {
      const result = await planRm02c3Activation(pgAdapter(client));
      process.stdout.write(
        `${JSON.stringify({
          status: 'RM02C3_PLAN_PASS',
          planSha256: result.planSha256,
          plan: result.plan,
        })}\n`,
      );
      return;
    }

    if (process.argv.includes('--apply')) {
      const result = await applyRm02c3Activation(pgAdapter(client), {
        confirmationToken: argument('--confirm') ?? '',
        expectedPlanSha256: argument('--expected-plan-sha256') ?? '',
      });
      process.stdout.write(
        `${JSON.stringify({ status: 'RM02C3_APPLY_PASS', ...result })}\n`,
      );
      return;
    }

    throw new Rm02c3ActivationError('STOP_EXPLICIT_MODE_REQUIRED');
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  const code =
    error instanceof Rm02c3ActivationError
      ? error.code
      : 'STOP_UNEXPECTED_ACTIVATION_FAILURE';
  process.stderr.write(`RM02C3_FAIL=${code}\n`);
  process.exitCode = 1;
});
