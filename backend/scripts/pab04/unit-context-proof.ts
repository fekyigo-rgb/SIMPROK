// PAB-04 — DOES PASSING THE CLASS ACTUALLY CHANGE THE ANSWER?
//
// Doktrin Cermin: reasoning about the alias table is not proof. This asks the
// REAL UnitKernelService, against the REAL migrated unit vocabulary, the exact
// question the Resource Observation path asks — once without the resource's
// class and once with it — and prints both verdicts side by side.
//
// Read-only: it opens a Prisma client, runs SELECTs through the kernel, and
// writes nothing.
import { config as loadEnv } from 'dotenv';
import { resolve as resolvePath } from 'path';
import { PrismaClient } from '@prisma/client';

// The e2e database, named explicitly — this script never touches canonical.
loadEnv({ path: resolvePath(__dirname, '..', '..', '.env.e2e') });
import { UnitKernelService } from '../../src/unit-kernel/unit-kernel.service';
import {
  UNIT_ALIAS_CONTEXT,
  trustedUnitContext,
} from '../../src/unit-kernel/unit-kernel.contracts';

/** The spellings the Owner's real AHSP workbooks actually use. */
const REAL_UNITS = ['jam', 'Jam', 'OH', 'OJ', 'm3', 'M3', 'Kg', 'Ls', 'Hari', 'Liter'];

async function main() {
  const prisma = new PrismaClient();
  const kernel = new UnitKernelService(prisma as any);

  const aliases = await prisma.unitAlias.findMany({
    where: { normalizedAlias: { in: ['jam', 'oh', 'oj'] }, isActive: true },
    include: { unitDefinition: { select: { code: true } } },
    orderBy: [{ normalizedAlias: 'asc' }, { context: 'asc' }],
  });
  console.log('=== REAL ALIAS ROWS FOR THE HOUR/DAY SPELLINGS ===');
  for (const a of aliases) {
    console.log(
      `  raw="${a.rawAlias}" normalized="${a.normalizedAlias}" -> ${a.unitDefinition.code}  context=${a.context ?? '(context-free)'}`,
    );
  }

  console.log('\n=== THE SAME QUESTION, WITHOUT AND WITH THE RESOURCE CLASS ===');
  const header = ['unit', 'no context', 'LABOR', 'MATERIAL', 'EQUIPMENT'];
  console.log(
    `  ${header[0].padEnd(7)} ${header[1].padEnd(26)} ${header[2].padEnd(26)} ${header[3].padEnd(26)} ${header[4]}`,
  );

  const verdict = async (unit: string, ctx?: string) => {
    const r = await kernel.resolve(unit, unit, undefined, trustedUnitContext(ctx));
    const code = r.sourceUnitDefinition?.code ?? '-';
    return `${r.status}/${code}`;
  };

  const rows: Array<Record<string, string>> = [];
  for (const unit of REAL_UNITS) {
    const none = await verdict(unit);
    const labor = await verdict(unit, UNIT_ALIAS_CONTEXT.LABOR);
    const material = await verdict(unit, UNIT_ALIAS_CONTEXT.MATERIAL);
    const equipment = await verdict(unit, UNIT_ALIAS_CONTEXT.EQUIPMENT);
    rows.push({ unit, none, labor, material, equipment });
    console.log(
      `  ${unit.padEnd(7)} ${none.padEnd(26)} ${labor.padEnd(26)} ${material.padEnd(26)} ${equipment}`,
    );
  }

  console.log('\n=== WHAT CHANGED ===');
  const changed = rows.filter(
    (r) =>
      !r.none.startsWith('RESOLVED') &&
      (r.labor.startsWith('RESOLVED') ||
        r.material.startsWith('RESOLVED') ||
        r.equipment.startsWith('RESOLVED')),
  );
  if (changed.length === 0) {
    console.log('  (none — passing the class changed no verdict in this vocabulary)');
  }
  for (const r of changed) {
    console.log(
      `  "${r.unit}": unanswerable without the class (${r.none}); answered with it ` +
        `-> LABOR=${r.labor}  EQUIPMENT=${r.equipment}  MATERIAL=${r.material}`,
    );
  }

  // Fail-closed check: a class must never CREATE an answer where the spelling
  // is genuinely unknown.
  const unknown = await verdict('zzz-not-a-unit', UNIT_ALIAS_CONTEXT.EQUIPMENT);
  console.log(`\n=== FAIL-CLOSED: unknown spelling with a class -> ${unknown}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
