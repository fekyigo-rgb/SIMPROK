/**
 * TEST_FIXTURE_ONLY — put the B1-B12 Golden section in front of the Owner's
 * browser, in an isolated rehearsal database.
 *
 * OWNER_BROWSER_FIXTURE_B1B12_20260813_v1
 * TEST_FIXTURE_ONLY · OWNER_BROWSER_VERIFICATION · NON_PRODUCTION_PROJECT_QUANTITY
 *
 * It runs `provisionB1B12Section` — the SAME function the acceptance proof
 * runs, not a copy — against whatever DATABASE_URL it is given, then prints the
 * Owner acceptance package. What the Owner opens is therefore exactly what
 * b1b12-owner-browser-section.e2e-spec.ts asserted, row for row.
 *
 * IT CANNOT TOUCH THE PERMANENT DATABASE. Every target decision belongs to
 * src/rehearsal/b1b12-rehearsal-target.ts, which admits exactly one host, one
 * port and one database-name shape and refuses the entire rest of the universe
 * — checked against the DSN *and* re-checked against the live connection,
 * before this script writes anything. There is no flag to override it. This
 * file states no target law of its own; law that guards the Permanent database
 * belongs where the standard `npm test` gate covers it.
 *
 * NO SECRET IS EVER PRINTED. The fixture login password is generated here and
 * written to the runtime secrets directory (outside the repository, where the
 * DB credentials already live); the report names the file, never the value.
 *
 * HOW TO RUN IT — one way, and it works:
 *
 *   npm run b1b12:provision:rehearsal
 *
 * with DATABASE_URL, JWT_SECRET and B1B12_GOLDEN_WORKBOOK_PATH already in the
 * process environment from a secrets file.
 *
 * NOT `tsx`. Every other script in this repository runs under tsx and is right
 * to; this one is the first to boot the Nest AppModule. tsx transpiles with
 * esbuild, which does not implement `emitDecoratorMetadata`, so the
 * `design:paramtypes` that Nest's DI reads to resolve constructor parameters is
 * never emitted and the container fails to build the module graph. The npm
 * script above runs ts-node, which honours the tsconfig flag this repository
 * already sets. The fix is the runner, not the architecture: nothing about
 * Nest, the module graph or this script was bent to make a transpiler happy.
 */
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';

import { AppModule } from '../../src/app.module';
import {
  parseRehearsalTargetFromUrl,
  assertB1B12RehearsalTarget,
  assertLiveB1B12RehearsalTarget,
} from '../../src/rehearsal/b1b12-rehearsal-target';
import {
  GOLDEN_FIXTURE_ID,
  GOLDEN_FIXTURE_LABELS,
  OWNER_FIXTURE_QUANTITY,
  isGoldenRequested,
  loadGoldenEvidence,
} from '../../test/fixtures/b1b12-golden-workbook.fixture';
import {
  describeSection,
  provisionB1B12Section,
} from '../../test/fixtures/b1b12-section-provisioner';

const SECRETS_DIR = 'C:/Users/asus/SIMPROK-RUNTIME/secrets';
const LOGIN_FILE = `${SECRETS_DIR}/b1b12.owner-login.env`;

async function main(): Promise<void> {
  if (!isGoldenRequested()) {
    throw new Error(
      'B1B12_GOLDEN_WORKBOOK_PATH is unset. The Owner Golden workbook is the ' +
        'source of this section and is never committed; name it explicitly.',
    );
  }

  // The DSN is judged before a socket is opened.
  const declared = parseRehearsalTargetFromUrl(process.env.DATABASE_URL);
  assertB1B12RehearsalTarget(declared);
  console.log(
    `REHEARSAL TARGET (declared) host=${declared.host} port=${declared.port} db=${declared.databaseName}`,
  );

  const golden = await loadGoldenEvidence();
  console.log(
    `GOLDEN EVIDENCE ${golden.fileName} size=${golden.size} sha256=${golden.sha256}`,
  );

  // …and the SERVER is judged again, by the same law, before anything is
  // written. A DSN can be right while the connection is not.
  const prisma = new PrismaClient();
  const live = await assertLiveB1B12RehearsalTarget({
    query: async <Row extends Record<string, unknown>>(sql: string) => ({
      rows: await prisma.$queryRawUnsafe<Row[]>(sql),
    }),
  });
  console.log(
    `REHEARSAL TARGET (live)     host=${live.host} port=${live.port} db=${live.databaseName}`,
  );

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();

  // Human-readable and stable: the Owner types this into the project search.
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/gu, '');
  const tag = `B1B12OWNER${stamp}`;
  const password = `Ob${randomBytes(18).toString('base64url')}!9`;

  const section = await provisionB1B12Section({
    app,
    prisma,
    golden,
    tag,
    password,
    asOf: '2026-08-13',
    projectName: 'OWNER BROWSER — B1B12 GOLDEN SECTION',
  });

  writeFileSync(
    LOGIN_FILE,
    [
      `# ${GOLDEN_FIXTURE_ID}`,
      `# ${GOLDEN_FIXTURE_LABELS}`,
      '# Rehearsal-only login. Not a production account. Delete with the fixture.',
      `B1B12_VIEWER_EMAIL=${section.viewerEmail}`,
      `B1B12_EDITOR_EMAIL=${section.editorEmail}`,
      `B1B12_PASSWORD=${password}`,
      '',
    ].join('\n'),
    'utf8',
  );

  const priced = section.rows.filter((row) => row.persistStatus === 201);
  const withheld = section.rows.filter((row) => row.persistStatus !== 201);

  console.log('\n' + describeSection(section));
  console.log(
    [
      '',
      '================ OWNER BROWSER ACCEPTANCE PACKAGE ================',
      `fixture           ${GOLDEN_FIXTURE_ID}`,
      `classification    ${GOLDEN_FIXTURE_LABELS}`,
      `project name      ${section.projectName}`,
      `projectId         ${section.projectId}`,
      `expected rows     12  (priced ${priced.length}, attention ${withheld.length})`,
      `priced rows       ${priced.map((r) => r.item).join(', ') || '(none)'}`,
      `attention rows    ${withheld.map((r) => r.item).join(', ') || '(none)'}`,
      `login file        ${LOGIN_FILE}   (email + password inside; NOT printed here)`,
      'quantities        ' +
        Object.entries(OWNER_FIXTURE_QUANTITY)
          .map(([item, qty]) => `${item}=${qty}`)
          .join(' '),
      '==================================================================',
    ].join('\n'),
  );

  await app.close();
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`PROVISION FAIL: ${message}`);
  if (error instanceof Error && error.stack) console.error(error.stack);
  process.exitCode = 1;
});
