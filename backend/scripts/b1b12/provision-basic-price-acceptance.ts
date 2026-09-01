import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { parseGovernedEnvFile } from '../../src/rehearsal/b1b12-rehearsal-environment';
import {
  assertB1B12RehearsalTarget,
  assertLiveB1B12RehearsalTarget,
  parseRehearsalTargetFromUrl,
} from '../../src/rehearsal/b1b12-rehearsal-target';
import { resolveB1B12RuntimePaths } from '../../src/rehearsal/b1b12-runtime-paths';

/**
 * B1B12 — an EMPTY, ISOLATED workspace for Basic Price acceptance.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT A SECOND PROVISIONER.
 *
 * A Basic Price acceptance run has to answer one question honestly: what does
 * SIMPROK's proven intelligence do on a clean 86-row import? The rehearsal
 * database could not answer it. Its workspaces were built by
 * `provisionB1B12Section`, which — correctly, for the job IT does — also plants
 * 45 drainage `ResourceCatalog` rows and a `Jakarta Selatan` Region fixture in
 * every workspace it creates. Measuring Resource Identity against those rows
 * credits the engine with finding what a fixture put there, and measuring
 * Region search against a fixture Region proves nothing about the real place
 * the Owner's workbook names.
 *
 * The obvious repair — delete the old rows — is forbidden and rightly so: their
 * author was never proven, and deleting state you did not create is how real
 * work disappears. So nothing is deleted. A NEW workspace is created instead,
 * and every contaminating entity is workspace-scoped, which is what makes this
 * work:
 *
 *   ResourceCatalog.workspaceId       nullable, and there are ZERO global rows
 *   BasicPriceImportBatch.workspaceId NOT NULL — no batch can leak in
 *   mappings                          reachable only through a batch's rows
 *
 * A brand-new workspace therefore starts with zero catalog rows, zero import
 * batches and zero historical row mappings, by construction rather than by
 * cleanup.
 *
 * IT CREATES NO REFERENCE FACT — NOT ONE.
 *
 * No Region. No ResourceCatalog row. No UnitDefinition. No BasicPrice. No
 * project, AHSP or price submission. It creates exactly the environment a human
 * needs in order to log in and be measured: an organization, a workspace, the
 * Basic Price permissions, and one actor holding them.
 *
 * Reference knowledge is provisioned AFTERWARDS, by the existing governed
 * wrapper and nothing else:
 *
 *   npm run b1b12:references:rehearsal -- --apply \
 *     --region-code=... --region-name=... --workspace-id=<this workspace>
 *
 * which applies the reviewed RM-02C0 inventory through the same planner, SHA
 * pin, identity law and plan-hash review the canonical and acceptance wrappers
 * use. That separation is the whole point: this file owns the EMPTY ROOM, the
 * governed wrapper owns the KNOWLEDGE, and neither can quietly become the other.
 *
 * THE PERMISSIONS ARE NOT INVENTED EITHER. Every code below is one the Basic
 * Price controllers already declare with `@Permissions(...)`; this grants the
 * five that the import → review → resolve → keep-private → Explorer journey
 * actually passes through, and no sixth. `BASIC_PRICE_SUBMIT` and
 * `BASIC_PRICE_VIEW` did not exist in the rehearsal database at all, so the
 * Owner's `Simpan & Gunakan` and Explorer doors were closed by
 * PermissionsGuard before either feature was ever reached — the same class of
 * defect `reprovision-b1b12-rehearsal.ts` was written to repair for
 * BASIC_PRICE_IMPORT.
 *
 * TARGET LAW IS BORROWED, NEVER RESTATED. Declared DSN and live server are both
 * judged by `b1b12-rehearsal-target.ts` — one host, one port, one database-name
 * shape, no override — so this cannot open the Permanent or legacy cluster.
 *
 * NO SECRET IS PRINTED. The password is generated here and written to the
 * runtime secrets directory; the report names the file, never the value.
 *
 *   npm run b1b12:acceptance:workspace
 */

const { backendEnvFile: GOVERNED_ENV_FILE, secretsDirectory: SECRETS_DIR } =
  resolveB1B12RuntimePaths();

/**
 * TWO FILES, AND THE PER-TAG ONE IS THE RECORD.
 *
 * A single fixed filename meant the second acceptance room silently overwrote
 * the first room's password, stranding a workspace nobody could log into any
 * more — and stranding it is the best case, because the data-safety law forbids
 * deleting it to tidy up. The per-tag file is therefore the durable record, one
 * per room, never overwritten; the `.latest` file is a convenience pointer at
 * the most recently provisioned room and is the only one that is rewritten.
 */
const loginFileForTag = (tag: string): string =>
  `${SECRETS_DIR}/b1b12.basic-price-acceptance.${tag}.env`;
const LATEST_LOGIN_FILE = `${SECRETS_DIR}/b1b12.basic-price-acceptance.env`;

/**
 * Exactly the doors the acceptance journey opens, each one already declared by
 * a Basic Price controller:
 *
 *   BASIC_PRICE_IMPORT       upload, PATCH metadata, GET batch
 *   BASIC_PRICE_REVIEW_VIEW  the review room
 *   BASIC_PRICE_RESOLVE      bind a row's resource/unit identity
 *   BASIC_PRICE_SUBMIT       keep-private  ("Simpan & Gunakan")
 *   BASIC_PRICE_VIEW         the Explorer read path
 */
const ACCEPTANCE_PERMISSIONS = [
  'BASIC_PRICE_IMPORT',
  'BASIC_PRICE_REVIEW_VIEW',
  'BASIC_PRICE_RESOLVE',
  'BASIC_PRICE_SUBMIT',
  'BASIC_PRICE_VIEW',
] as const;

function getArg(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  // Stamped, so a second acceptance run is a different room rather than a
  // reused one. Overridable because an operator may need two on one day.
  const tag =
    getArg(argv, 'tag') ??
    `BPACC${new Date().toISOString().slice(0, 10).replace(/-/gu, '')}`;

  const governed = parseGovernedEnvFile(
    readFileSync(GOVERNED_ENV_FILE, 'utf8'),
  );
  const databaseUrl = governed.get('DATABASE_URL');
  const declared = parseRehearsalTargetFromUrl(databaseUrl);
  assertB1B12RehearsalTarget(declared);

  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });
  try {
    const target = await assertLiveB1B12RehearsalTarget({
      query: async <Row extends Record<string, unknown>>(sql: string) => ({
        rows: await prisma.$queryRawUnsafe<Row[]>(sql),
      }),
    });
    process.stderr.write(
      `B1B12_TARGET_GUARD=PASS host=${target.host} port=${target.port} db=${target.databaseName}\n`,
    );

    const workspaceName = `${tag} WS`;
    const existing = await prisma.workspace.findFirst({
      where: { name: workspaceName },
      select: { id: true },
    });
    if (existing) {
      // NOTHING IS DELETED OR OVERWRITTEN. A tag that already names a workspace
      // is reported as the fact it is; the operator picks a new --tag if they
      // wanted a fresh room. Reusing silently would let a "clean" acceptance run
      // inherit a previous run's batches.
      throw new Error(
        `STOP_ACCEPTANCE_WORKSPACE_EXISTS: "${workspaceName}" already exists (${existing.id}). ` +
          'Pass a different --tag; this tool never reuses or clears an existing workspace.',
      );
    }

    const password = `Bp${randomBytes(18).toString('base64url')}!7`;
    const passwordHash = await bcrypt.hash(password, 10);

    const organization = await prisma.organization.create({
      data: { name: `${tag} Org`, type: 'COMPANY' },
    });
    const workspace = await prisma.workspace.create({
      data: { name: workspaceName, organizationId: organization.id },
    });

    // Found-or-created BY CODE, never renamed. A permission code is a contract
    // the controllers already state; this may add a missing row, and may not
    // redefine an existing one.
    const permissions: { id: string }[] = [];
    for (const code of ACCEPTANCE_PERMISSIONS) {
      const found = await prisma.permission.findUnique({ where: { code } });
      permissions.push(
        found ??
          (await prisma.permission.create({
            data: {
              code,
              name: code,
              description:
                'BASIC_PRICE acceptance — created by provision-basic-price-acceptance',
            },
          })),
      );
    }

    const email = `${tag}.editor@simprok.test`.toLowerCase();
    const account = await prisma.account.create({
      data: {
        email,
        passwordHash,
        displayName: 'Basic Price acceptance editor',
        status: 'ACTIVE',
      },
    });
    const role = await prisma.role.create({
      data: {
        workspaceId: workspace.id,
        code: `${tag}_EDITOR`,
        name: `${tag} editor`,
        rolePermissions: {
          create: permissions.map((p) => ({ permissionId: p.id })),
        },
      },
    });
    const membership = await prisma.workspaceMembership.create({
      data: {
        accountId: account.id,
        workspaceId: workspace.id,
        status: 'ACTIVE',
        membershipRoles: { create: [{ roleId: role.id }] },
      },
    });
    await prisma.user.create({
      data: {
        workspaceMembershipId: membership.id,
        workspaceId: workspace.id,
        fullName: 'Basic Price acceptance editor',
        status: 'ACTIVE',
      },
    });

    const loginFile = loginFileForTag(tag);
    const credentials = [
      '# BASIC PRICE ACCEPTANCE — rehearsal only. Not a production account.',
      '# Created by scripts/b1b12/provision-basic-price-acceptance.ts',
      `BP_ACCEPTANCE_TAG=${tag}`,
      `BP_ACCEPTANCE_WORKSPACE_ID=${workspace.id}`,
      `BP_ACCEPTANCE_ORGANIZATION_ID=${organization.id}`,
      `BP_ACCEPTANCE_EMAIL=${email}`,
      `BP_ACCEPTANCE_PASSWORD=${password}`,
      '',
    ].join('\n');
    // The durable per-room record first, so a crash between the two writes can
    // never leave a room whose password exists nowhere.
    writeFileSync(loginFile, credentials, 'utf8');
    writeFileSync(LATEST_LOGIN_FILE, credentials, 'utf8');

    // Proven, not assumed: the room must be empty of exactly the three things
    // that would corrupt the measurement.
    const [catalogRows, batches, mappings, globalCatalog] = await Promise.all([
      prisma.resourceCatalog.count({ where: { workspaceId: workspace.id } }),
      prisma.basicPriceImportBatch.count({
        where: { workspaceId: workspace.id },
      }),
      prisma.basicPriceImportRowResourceMapping.count({
        where: { workspaceId: workspace.id },
      }),
      prisma.resourceCatalog.count({ where: { workspaceId: null } }),
    ]);

    process.stdout.write(
      [
        '============ BASIC PRICE ACCEPTANCE WORKSPACE ============',
        `DB                    ${target.host}:${target.port}/${target.databaseName}`,
        `TAG                   ${tag}`,
        `ORGANIZATION_ID       ${organization.id}`,
        `WORKSPACE_ID          ${workspace.id}`,
        `EMAIL                 ${email}`,
        `PERMISSIONS           ${ACCEPTANCE_PERMISSIONS.join(', ')}`,
        `LOGIN_FILE            ${loginFile}   (password inside; NOT printed)`,
        `LATEST_POINTER        ${LATEST_LOGIN_FILE}`,
        '--------- EMPTINESS PROOF (before any reference provisioning) ---------',
        `RESOURCE_CATALOG_ROWS ${catalogRows}`,
        `GLOBAL_CATALOG_ROWS   ${globalCatalog}`,
        `IMPORT_BATCHES        ${batches}`,
        `ROW_MAPPINGS          ${mappings}`,
        'NOTHING WAS DELETED. No Region, catalog row or unit was created here.',
        '=========================================================',
        '',
      ].join('\n'),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`BASIC PRICE ACCEPTANCE PROVISION FAIL: ${message}\n`);
  process.exitCode = 1;
});
