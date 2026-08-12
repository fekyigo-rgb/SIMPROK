import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import JSZip from 'jszip';

import { UnitKernelService } from './unit-kernel.service';
import { normalizeUnitAlias } from './unit-normalization';
import {
  UNIT_ALIAS_CONTEXT,
  UNIT_REASON,
  UNIT_RESOLUTION_STATUS,
  UnitAliasContext,
} from './unit-kernel.contracts';

/**
 * B1B12_UNIT_KERNEL_COVERAGE_01 — proof that the canonical unit catalogue can
 * carry the Golden Bina Marga / Drainase B1-B12 section truthfully.
 *
 * The catalogue is read out of the SHIPPED migrations rather than re-declared
 * here. A hand-written copy of the reference data would let the proof and the
 * product drift apart silently, and then this file would be testing itself.
 * Everything below therefore fails the moment the migration data changes.
 *
 * No database is opened: the resolver is driven through a structural client,
 * the same discipline the RM-03D0 provisioner specs use.
 */

const MIGRATIONS = resolvePath(__dirname, '..', '..', 'prisma', 'migrations');
const KAMUS_SQL = resolvePath(MIGRATIONS, '20260717010000_kamus_unit_kernel_01a', 'migration.sql');
const GOLDEN_SQL = resolvePath(MIGRATIONS, '20260812090000_b1b12_golden_unit_coverage', 'migration.sql');

/** Splits one SQL tuple body on top-level commas, honouring '' escapes. */
function splitTuple(body: string): string[] {
  const out: string[] = [];
  let current = '';
  let inString = false;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (inString) {
      if (ch === "'" && body[i + 1] === "'") {
        current += "'";
        i += 1;
        continue;
      }
      if (ch === "'") {
        inString = false;
        current += ch;
        continue;
      }
      current += ch;
      continue;
    }
    if (ch === "'") {
      inString = true;
      current += ch;
      continue;
    }
    if (ch === ',') {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((raw) => {
    const trimmed = raw.trim().replace(/::"?[A-Za-z_]+"?$/u, '');
    return trimmed.startsWith("'") && trimmed.endsWith("'")
      ? trimmed.slice(1, -1).replace(/''/gu, "'")
      : trimmed;
  });
}

/** Every `('…', …)` tuple that opens a line — exactly how both migrations write VALUES. */
function tuples(sql: string): string[][] {
  return sql
    .split(/\r?\n/u)
    .filter((line) => line.trimStart().startsWith("('"))
    .flatMap((line) => {
      const matches = line.match(/\((?:[^'()]|'(?:''|[^'])*')*\)/gu) ?? [];
      return matches.map((m) => splitTuple(m.slice(1, -1)));
    });
}

interface UnitDefinitionRow {
  id: string;
  code: string;
  displayName: string;
  symbol: string;
  dimension: string;
  kind: string;
  isActive: boolean;
}
interface UnitAliasRow {
  id: string;
  rawAlias: string;
  normalizedAlias: string;
  code: string;
  context: string | null;
  isActive: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function loadCatalogue(): { definitions: UnitDefinitionRow[]; aliases: UnitAliasRow[] } {
  const definitions: UnitDefinitionRow[] = [];
  const aliases: UnitAliasRow[] = [];
  const knownCodes = new Set<string>();

  for (const file of [KAMUS_SQL, GOLDEN_SQL]) {
    const sql = readFileSync(file, 'utf8');
    for (const t of tuples(sql).filter((x) => UUID.test(x[0]))) {
      if (t.length === 6) {
        definitions.push({
          id: t[0], code: t[1], displayName: t[2], symbol: t[3], dimension: t[4], kind: t[5], isActive: true,
        });
        knownCodes.add(t[1]);
      }
    }
  }
  for (const file of [KAMUS_SQL, GOLDEN_SQL]) {
    const sql = readFileSync(file, 'utf8');
    for (const t of tuples(sql).filter((x) => UUID.test(x[0]))) {
      if (t.length === 4 && knownCodes.has(t[3])) {
        aliases.push({ id: t[0], rawAlias: t[1], normalizedAlias: t[2], code: t[3], context: null, isActive: true });
      }
      if (t.length === 5 && knownCodes.has(t[3])) {
        aliases.push({ id: t[0], rawAlias: t[1], normalizedAlias: t[2], code: t[3], context: t[4], isActive: true });
      }
    }
  }
  return { definitions, aliases };
}

const { definitions, aliases } = loadCatalogue();
const byCode = new Map(definitions.map((d) => [d.code, d]));

/** Structural stand-in for PrismaService — no database, no network. */
function makeKernel(overrides?: {
  inactiveCodes?: string[];
  inactiveAliasIds?: string[];
  extraDefinitions?: UnitDefinitionRow[];
  extraAliases?: UnitAliasRow[];
}) {
  const inactiveCodes = new Set(overrides?.inactiveCodes ?? []);
  const inactiveAliasIds = new Set(overrides?.inactiveAliasIds ?? []);
  const definitions = new Map(byCode);
  for (const d of overrides?.extraDefinitions ?? []) definitions.set(d.code, d);
  const pool = [...aliases, ...(overrides?.extraAliases ?? [])];
  const prisma = {
    unitAlias: {
      findMany: async ({ where }: any) =>
        pool
          .filter((a) => a.normalizedAlias === where.normalizedAlias)
          .filter((a) => !inactiveAliasIds.has(a.id))
          .filter((a) => !inactiveCodes.has(a.code))
          .map((a) => ({
            id: a.id,
            context: a.context,
            unitDefinition: {
              id: definitions.get(a.code)!.id,
              code: a.code,
              dimension: definitions.get(a.code)!.dimension,
            },
          })),
    },
    unitConversionRule: { findMany: async () => [] },
  };
  return new UnitKernelService(prisma as never);
}

const kernel = makeKernel();

async function identity(raw: string, context?: UnitAliasContext) {
  return kernel.resolve(raw, raw, undefined, context);
}

describe('B1B12 Golden unit coverage — canonical catalogue', () => {
  it('every alias stores the normalisation the kernel actually computes', () => {
    for (const a of aliases) {
      expect({ raw: a.rawAlias, stored: a.normalizedAlias }).toEqual({
        raw: a.rawAlias,
        stored: normalizeUnitAlias(a.rawAlias),
      });
    }
  });

  it('no two context-free aliases collide on one normalised form', () => {
    const seen = new Map<string, string>();
    for (const a of aliases.filter((x) => x.context === null)) {
      expect(seen.has(a.normalizedAlias)).toBe(false);
      seen.set(a.normalizedAlias, a.code);
    }
  });

  it('carries the eight pre-existing canonical units unchanged', () => {
    for (const code of ['PERSON_DAY', 'KG', 'M1', 'M2', 'M3', 'SAK', 'ROLL', 'TRUCK']) {
      expect(byCode.get(code)).toBeDefined();
    }
    expect(byCode.get('M1')).toMatchObject({ displayName: 'Metre', dimension: 'LENGTH', kind: 'CANONICAL' });
    expect(byCode.get('M3')).toMatchObject({ dimension: 'VOLUME', kind: 'CANONICAL' });
    expect(byCode.get('KG')).toMatchObject({ dimension: 'MASS', kind: 'CANONICAL' });
  });

  it('adds exactly the seven units B1-B12 needs, with truthful dimensions', () => {
    expect(byCode.get('PERSON_HOUR')).toMatchObject({ dimension: 'PERSON_TIME', kind: 'CANONICAL' });
    expect(byCode.get('EQUIPMENT_HOUR')).toMatchObject({ dimension: 'EQUIPMENT_TIME', kind: 'CANONICAL' });
    expect(byCode.get('LITER')).toMatchObject({ dimension: 'VOLUME', kind: 'CANONICAL' });
    expect(byCode.get('LS')).toMatchObject({ dimension: 'COUNT', kind: 'CONTEXTUAL' });
    expect(byCode.get('UNIT')).toMatchObject({ dimension: 'COUNT', kind: 'CANONICAL' });
    expect(byCode.get('LBR')).toMatchObject({ dimension: 'COUNT', kind: 'COMMERCIAL_PACKAGE' });
    expect(byCode.get('BH_PER_M')).toMatchObject({ dimension: 'COUNT', kind: 'CONTEXTUAL' });
    expect(definitions).toHaveLength(15);
  });
});

describe('B1B12 Golden unit coverage — raw source variants', () => {
  const CONTEXT_FREE: Array<[string, string]> = [
    ['Kg', 'KG'], ['kg', 'KG'], ['KG', 'KG'],
    ['M3', 'M3'], ['m3', 'M3'],
    ['m', 'M1'], ["M'", 'M1'], ['M’', 'M1'],
    ['Ltr', 'LITER'], ['liter', 'LITER'], ['LITER', 'LITER'],
    ['Ls', 'LS'], ['ls', 'LS'],
    ['unit', 'UNIT'], ['Unit', 'UNIT'],
    ['Lbr', 'LBR'], ['lbr', 'LBR'],
    ['bh/m', 'BH_PER_M'], ["bh/M'", 'BH_PER_M'], ['bh/M’', 'BH_PER_M'],
  ];

  it.each(CONTEXT_FREE)('resolves raw %j to canonical %s', async (raw, code) => {
    const r = await identity(raw);
    expect(r.status).toBe(UNIT_RESOLUTION_STATUS.RESOLVED);
    expect(r.sourceUnitDefinition?.code).toBe(code);
  });

  it('resolves "jam" to PERSON_HOUR under LABOR context', async () => {
    const r = await identity('jam', UNIT_ALIAS_CONTEXT.LABOR);
    expect(r.status).toBe(UNIT_RESOLUTION_STATUS.RESOLVED);
    expect(r.sourceUnitDefinition?.code).toBe('PERSON_HOUR');
    expect(r.reasonCodes).toContain(UNIT_REASON.CONTEXT_SCOPED_UNIT_ALIAS);
  });

  it('resolves "jam" to EQUIPMENT_HOUR under EQUIPMENT context', async () => {
    const r = await identity('jam', UNIT_ALIAS_CONTEXT.EQUIPMENT);
    expect(r.status).toBe(UNIT_RESOLUTION_STATUS.RESOLVED);
    expect(r.sourceUnitDefinition?.code).toBe('EQUIPMENT_HOUR');
    expect(r.reasonCodes).toContain(UNIT_REASON.CONTEXT_SCOPED_UNIT_ALIAS);
  });
});

/**
 * REGRESSION ONLY — the aggregate unit contract.
 *
 * This block asserts the locked per-unit counts without opening the workbook,
 * so it keeps working on a machine that does not hold the Owner's file. It is
 * NOT the closure proof: the authoritative row-level proof is the exact-bytes
 * workbook suite at the end of this file, which derives every row — including
 * the real TENAGA/PERALATAN split of "jam" — from the workbook itself.
 */
const GOLDEN_ROW_CONTRACT: Array<{ raw: string; count: number; expect: string; context?: UnitAliasContext }> = [
  { raw: 'jam', count: 67, expect: 'PERSON_HOUR|EQUIPMENT_HOUR' },
  { raw: 'M3', count: 41, expect: 'M3', context: UNIT_ALIAS_CONTEXT.MATERIAL },
  { raw: 'Kg', count: 16, expect: 'KG', context: UNIT_ALIAS_CONTEXT.MATERIAL },
  { raw: 'Ls', count: 12, expect: 'LS', context: UNIT_ALIAS_CONTEXT.MATERIAL },
  { raw: "M'", count: 8, expect: 'M1', context: UNIT_ALIAS_CONTEXT.MATERIAL },
  { raw: 'Ltr', count: 7, expect: 'LITER', context: UNIT_ALIAS_CONTEXT.MATERIAL },
  { raw: "bh/M'", count: 4, expect: 'BH_PER_M', context: UNIT_ALIAS_CONTEXT.MATERIAL },
  { raw: 'unit', count: 2, expect: 'UNIT', context: UNIT_ALIAS_CONTEXT.MATERIAL },
  { raw: 'Lbr', count: 2, expect: 'LBR', context: UNIT_ALIAS_CONTEXT.MATERIAL },
];

describe('B1B12 Golden unit coverage — 159 resource rows', () => {
  it('the locked contract totals 159 rows', () => {
    expect(GOLDEN_ROW_CONTRACT.reduce((sum, r) => sum + r.count, 0)).toBe(159);
  });

  it('resolves all 159 rows with zero ambiguous and zero unsupported', async () => {
    let resolved = 0;
    let ambiguous = 0;
    let unsupported = 0;

    for (const spec of GOLDEN_ROW_CONTRACT) {
      for (let i = 0; i < spec.count; i += 1) {
        if (spec.expect.includes('|')) {
          const asLabor = await identity(spec.raw, UNIT_ALIAS_CONTEXT.LABOR);
          const asEquipment = await identity(spec.raw, UNIT_ALIAS_CONTEXT.EQUIPMENT);
          const ok =
            asLabor.status === UNIT_RESOLUTION_STATUS.RESOLVED &&
            asLabor.sourceUnitDefinition?.code === 'PERSON_HOUR' &&
            asEquipment.status === UNIT_RESOLUTION_STATUS.RESOLVED &&
            asEquipment.sourceUnitDefinition?.code === 'EQUIPMENT_HOUR';
          ok ? (resolved += 1) : (ambiguous += 1);
          continue;
        }
        const r = await identity(spec.raw, spec.context);
        if (r.status === UNIT_RESOLUTION_STATUS.RESOLVED && r.sourceUnitDefinition?.code === spec.expect) resolved += 1;
        else if (r.reasonCodes.includes(UNIT_REASON.AMBIGUOUS_UNIT_ALIAS)) ambiguous += 1;
        else unsupported += 1;
      }
    }

    expect({ resolved, ambiguous, unsupported }).toEqual({ resolved: 159, ambiguous: 0, unsupported: 0 });
  });

  it('resolves all 12 AHSP output units (B1-B2 m3, B3-B12 m)', async () => {
    const outputs = [
      ...Array.from({ length: 2 }, () => ({ raw: 'm3', code: 'M3' })),
      ...Array.from({ length: 10 }, () => ({ raw: 'm', code: 'M1' })),
    ];
    expect(outputs).toHaveLength(12);
    let ok = 0;
    for (const o of outputs) {
      const r = await identity(o.raw);
      if (r.status === UNIT_RESOLUTION_STATUS.RESOLVED && r.sourceUnitDefinition?.code === o.code) ok += 1;
    }
    expect(ok).toBe(12);
  });
});

describe('B1B12 Golden unit coverage — fail closed', () => {
  it('an unknown unit never silently resolves', async () => {
    const r = await identity('zzz-not-a-unit');
    expect(r.status).toBe(UNIT_RESOLUTION_STATUS.NEEDS_REVIEW);
    expect(r.reasonCodes).toContain(UNIT_REASON.UNKNOWN_UNIT_ALIAS);
    expect(r.sourceUnitDefinition).toBeNull();
  });

  it('"jam" without context stays ambiguous instead of picking the first row', async () => {
    const r = await identity('jam');
    expect(r.status).toBe(UNIT_RESOLUTION_STATUS.NEEDS_REVIEW);
    expect(r.reasonCodes).toEqual([UNIT_REASON.AMBIGUOUS_UNIT_ALIAS]);
    expect(r.sourceUnitDefinition).toBeNull();
  });

  it('"jam" under an unrelated context is unknown, never a fallback guess', async () => {
    const r = await identity('jam', UNIT_ALIAS_CONTEXT.MATERIAL);
    expect(r.status).toBe(UNIT_RESOLUTION_STATUS.NEEDS_REVIEW);
    expect(r.reasonCodes).toEqual([UNIT_REASON.UNKNOWN_UNIT_ALIAS]);
    expect(r.sourceUnitDefinition).toBeNull();
  });

  it('labour hours and equipment hours are not interchangeable', async () => {
    const r = await kernel.resolve('PERSON_HOUR', 'EQUIPMENT_HOUR');
    expect(r.status).toBe(UNIT_RESOLUTION_STATUS.NEEDS_REVIEW);
    expect(r.reasonCodes).toContain(UNIT_REASON.CONVERSION_RULE_NOT_FOUND);
    expect(r.quantityFactor).toBeNull();
  });

  it('bh/m cannot resolve as ordinary metre', async () => {
    const r = await kernel.resolve('bh/m', 'm');
    expect(r.sourceUnitDefinition?.code).toBe('BH_PER_M');
    expect(r.targetUnitDefinition?.code).toBe('M1');
    expect(r.status).toBe(UNIT_RESOLUTION_STATUS.NEEDS_REVIEW);
    expect(r.reasonCodes).toContain(UNIT_REASON.CONVERSION_RULE_NOT_FOUND);
    expect(r.quantityFactor).toBeNull();
  });

  it('lbr is not silently the same identity as unit', async () => {
    const r = await kernel.resolve('Lbr', 'unit');
    expect(r.sourceUnitDefinition?.code).toBe('LBR');
    expect(r.targetUnitDefinition?.code).toBe('UNIT');
    expect(r.status).toBe(UNIT_RESOLUTION_STATUS.NEEDS_REVIEW);
    expect(r.quantityFactor).toBeNull();
  });

  it('ls is not silently the same identity as unit', async () => {
    const r = await kernel.resolve('Ls', 'unit');
    expect(r.sourceUnitDefinition?.code).toBe('LS');
    expect(r.targetUnitDefinition?.code).toBe('UNIT');
    expect(r.status).toBe(UNIT_RESOLUTION_STATUS.NEEDS_REVIEW);
    expect(r.quantityFactor).toBeNull();
  });

  it('liter is not silently convertible to m3 without an evidence-bound rule', async () => {
    const r = await kernel.resolve('Ltr', 'M3');
    expect(r.status).toBe(UNIT_RESOLUTION_STATUS.NEEDS_REVIEW);
    expect(r.reasonCodes).toContain(UNIT_REASON.CONVERSION_RULE_NOT_FOUND);
  });

  it('an inactive definition is not treated as active', async () => {
    const r = await makeKernel({ inactiveCodes: ['LBR'] }).resolve('Lbr', 'Lbr');
    expect(r.status).toBe(UNIT_RESOLUTION_STATUS.NEEDS_REVIEW);
    expect(r.reasonCodes).toContain(UNIT_REASON.UNKNOWN_UNIT_ALIAS);
  });

  it('an inactive alias is not treated as active, and never leaks across context', async () => {
    const jamLabor = aliases.find((a) => a.normalizedAlias === 'jam' && a.context === 'LABOR')!;
    const withoutLabor = makeKernel({ inactiveAliasIds: [jamLabor.id] });

    const equipment = await withoutLabor.resolve('jam', 'jam', undefined, UNIT_ALIAS_CONTEXT.EQUIPMENT);
    expect(equipment.status).toBe(UNIT_RESOLUTION_STATUS.RESOLVED);
    expect(equipment.sourceUnitDefinition?.code).toBe('EQUIPMENT_HOUR');

    // The labour meaning is gone. The last row standing must NOT be handed to a
    // LABOR caller — that would be exactly the silent cross-mapping §7 forbids.
    const labor = await withoutLabor.resolve('jam', 'jam', undefined, UNIT_ALIAS_CONTEXT.LABOR);
    expect(labor.status).toBe(UNIT_RESOLUTION_STATUS.NEEDS_REVIEW);
    expect(labor.reasonCodes).toContain(UNIT_REASON.UNKNOWN_UNIT_ALIAS);
    expect(labor.sourceUnitDefinition).toBeNull();
  });

  it('context never changes an already-unambiguous unit', async () => {
    for (const ctx of [UNIT_ALIAS_CONTEXT.LABOR, UNIT_ALIAS_CONTEXT.EQUIPMENT, UNIT_ALIAS_CONTEXT.MATERIAL]) {
      const r = await identity('M3', ctx);
      expect(r.sourceUnitDefinition?.code).toBe('M3');
      expect(r.reasonCodes).not.toContain(UNIT_REASON.CONTEXT_SCOPED_UNIT_ALIAS);
    }
  });
});

/**
 * F12 — the context law must be GENERIC, not accidentally safe.
 *
 * "jam" is safe today because two contexts happen to be catalogued. The law
 * below is proven with a synthetic single-context alias that exists ONLY in
 * this test — it is deliberately NOT in the migration — because the first alias
 * ever catalogued in exactly one context is precisely where a row-counting
 * implementation would silently resolve without evidence.
 */
const SHIFT_DEFINITION: UnitDefinitionRow = {
  id: 'ffffffff-0000-4000-8000-000000000001',
  code: 'TEST_LABOR_SHIFT',
  displayName: 'Test labour shift',
  symbol: 'shift',
  dimension: 'PERSON_TIME',
  kind: 'CANONICAL',
  isActive: true,
};
const SHIFT_ALIAS: UnitAliasRow = {
  id: 'ffffffff-0000-4000-8000-000000000002',
  rawAlias: 'shift',
  normalizedAlias: 'shift',
  code: 'TEST_LABOR_SHIFT',
  context: 'LABOR',
  isActive: true,
};

describe('F12 generic context-scoped alias law', () => {
  const shiftKernel = makeKernel({
    extraDefinitions: [SHIFT_DEFINITION],
    extraAliases: [SHIFT_ALIAS],
  });
  const shift = (context?: UnitAliasContext) => shiftKernel.resolve('shift', 'shift', undefined, context);

  it('F12-T1 a single contextual-only alias does NOT resolve without context', async () => {
    const r = await shift();
    expect(r.status).toBe(UNIT_RESOLUTION_STATUS.NEEDS_REVIEW);
    expect(r.reasonCodes).toEqual([UNIT_REASON.CONTEXT_REQUIRED_UNIT_ALIAS]);
    expect(r.sourceUnitDefinition).toBeNull();
    expect(r.quantityFactor).toBeNull();
  });

  it('F12-T2 the same alias resolves under its own context, with provenance', async () => {
    const r = await shift(UNIT_ALIAS_CONTEXT.LABOR);
    expect(r.status).toBe(UNIT_RESOLUTION_STATUS.RESOLVED);
    expect(r.sourceUnitDefinition?.code).toBe('TEST_LABOR_SHIFT');
    // Provenance must not depend on the candidate set having shrunk: here it
    // never shrank, and the answer is still a context-scoped one.
    expect(r.reasonCodes).toContain(UNIT_REASON.CONTEXT_SCOPED_UNIT_ALIAS);
  });

  it('F12-T3 the same alias fails closed under a foreign context', async () => {
    for (const foreign of [UNIT_ALIAS_CONTEXT.EQUIPMENT, UNIT_ALIAS_CONTEXT.MATERIAL]) {
      const r = await shift(foreign);
      expect(r.status).toBe(UNIT_RESOLUTION_STATUS.NEEDS_REVIEW);
      expect(r.sourceUnitDefinition).toBeNull();
      expect(JSON.stringify(r)).not.toContain('TEST_LABOR_SHIFT');
    }
  });

  it('F12-T4 the Golden "jam" ambiguity law is preserved', async () => {
    const r = await identity('jam');
    expect(r.status).toBe(UNIT_RESOLUTION_STATUS.NEEDS_REVIEW);
    expect(r.reasonCodes).toEqual([UNIT_REASON.AMBIGUOUS_UNIT_ALIAS]);
  });

  it('F12-T5 the Golden "jam" contextual resolutions are preserved', async () => {
    const labor = await identity('jam', UNIT_ALIAS_CONTEXT.LABOR);
    expect(labor.sourceUnitDefinition?.code).toBe('PERSON_HOUR');
    expect(labor.reasonCodes).toContain(UNIT_REASON.CONTEXT_SCOPED_UNIT_ALIAS);
    const equipment = await identity('jam', UNIT_ALIAS_CONTEXT.EQUIPMENT);
    expect(equipment.sourceUnitDefinition?.code).toBe('EQUIPMENT_HOUR');
    expect(equipment.reasonCodes).toContain(UNIT_REASON.CONTEXT_SCOPED_UNIT_ALIAS);
  });

  it('F12-T6 an ordinary context-free alias is unaffected and claims no context provenance', async () => {
    for (const ctx of [UNIT_ALIAS_CONTEXT.MATERIAL, UNIT_ALIAS_CONTEXT.LABOR, UNIT_ALIAS_CONTEXT.EQUIPMENT]) {
      const r = await identity('M3', ctx);
      expect(r.status).toBe(UNIT_RESOLUTION_STATUS.RESOLVED);
      expect(r.sourceUnitDefinition?.code).toBe('M3');
      expect(r.reasonCodes).not.toContain(UNIT_REASON.CONTEXT_SCOPED_UNIT_ALIAS);
      expect(r.reasonCodes).not.toContain(UNIT_REASON.CONTEXT_REQUIRED_UNIT_ALIAS);
    }
  });

  it('a context-required alias is never mislabelled as unknown', async () => {
    const required = await shift();
    const unknown = await shiftKernel.resolve('zzz-not-a-unit', 'zzz-not-a-unit');
    expect(required.reasonCodes).toEqual([UNIT_REASON.CONTEXT_REQUIRED_UNIT_ALIAS]);
    expect(unknown.reasonCodes).toEqual([UNIT_REASON.UNKNOWN_UNIT_ALIAS]);
  });

  it('the shipped catalogue contains no single-context alias that would need this rescue', () => {
    const byNormalised = new Map<string, UnitAliasRow[]>();
    for (const a of aliases) {
      byNormalised.set(a.normalizedAlias, [...(byNormalised.get(a.normalizedAlias) ?? []), a]);
    }
    for (const [normalised, rows] of byNormalised) {
      const contextual = rows.filter((r) => r.context !== null);
      if (contextual.length === 0) continue;
      // Every contextual spelling shipped today offers a real choice.
      expect({ normalised, contextual: contextual.length }).toEqual({ normalised, contextual: 2 });
    }
  });
});

// ===========================================================================
// EXACT GOLDEN WORKBOOK PROOF — the authoritative row-level closure evidence.
//
// Every row below comes from the Owner's byte-verified workbook. Nothing is
// re-declared: the row count, the unit distribution and — critically — the
// LABOR/EQUIPMENT split of "jam" are all READ, never assumed.
//
// The workbook is Owner evidence, not source: it is never committed, and this
// file carries NO machine-specific path.
//
// ABSENT vs INVALID ARE NOT THE SAME THING.
//   B1B12_GOLDEN_WORKBOOK_PATH unset  → the operator never asked for exact-Golden
//                                       acceptance. The suite is SKIPPED, visibly
//                                       and by name. A skip is not a pass.
//   B1B12_GOLDEN_WORKBOOK_PATH set    → the operator DID ask. From that moment a
//                                       missing file, the wrong file, or the right
//                                       name with wrong bytes is a FAILURE. An
//                                       explicitly requested acceptance run is
//                                       never silently downgraded to a skip.
//
//   B1B12_GOLDEN_WORKBOOK_PATH=<dir>/GOLDEN_DATA_PACK_BINA_MARGA_DRAINASE_B1_B12_v1.2.xlsx
// ===========================================================================

const GOLDEN_SHA256 = '3e8393a7e9f730eb7aa7dc50c0fd50603c9912148d1dd6c566f662cf6e5023ff';
const GOLDEN_SIZE = 59451;
const GOLDEN_PATH = (process.env.B1B12_GOLDEN_WORKBOOK_PATH ?? '').trim();

interface GoldenByteIdentity {
  size: number;
  sha256: string;
}

/**
 * The single gate every byte must pass BEFORE it is interpreted as a workbook.
 *
 * Reading a spreadsheet is already an act of trust: sheet names, header
 * captions and cell values all become "facts" the moment they are parsed. So
 * identity is established first and parsing is downstream of it — never the
 * other way round, where a wrong file would be read, believed, and only later
 * caught by an assertion that runs after the damage.
 */
function assertExactGoldenBytes(bytes: Buffer, path: string): GoldenByteIdentity {
  const size = bytes.length;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (size !== GOLDEN_SIZE || sha256 !== GOLDEN_SHA256) {
    throw new Error(
      `GOLDEN_WORKBOOK_IDENTITY_MISMATCH: refusing to interpret this file. ` +
        `path=${path} size=${size} (expected ${GOLDEN_SIZE}) sha256=${sha256} (expected ${GOLDEN_SHA256})`,
    );
  }
  return { size, sha256 };
}

describe('exact-Golden byte identity guard', () => {
  // Ungated on purpose: this proves the guard itself, needs no Owner evidence,
  // and therefore runs on every machine including CI.
  it('rejects a file of the wrong size', () => {
    expect(() => assertExactGoldenBytes(Buffer.alloc(10), '<wrong-size>')).toThrow(
      /GOLDEN_WORKBOOK_IDENTITY_MISMATCH/u,
    );
  });

  it('rejects a file of the right size but the wrong bytes', () => {
    expect(() => assertExactGoldenBytes(Buffer.alloc(GOLDEN_SIZE), '<wrong-bytes>')).toThrow(
      /GOLDEN_WORKBOOK_IDENTITY_MISMATCH/u,
    );
  });

  it('names both the expected and the actual identity so a mismatch is diagnosable', () => {
    expect(() => assertExactGoldenBytes(Buffer.alloc(GOLDEN_SIZE), '/tmp/impostor.xlsx')).toThrow(
      /path=\/tmp\/impostor\.xlsx.*expected 59451.*expected 3e8393a7/su,
    );
  });
});

/**
 * A strict, namespace-agnostic reader for the two sheets this proof needs.
 *
 * ExcelJS — the parser this repository already owns — cannot read this
 * particular file: it writes OOXML with `x:`-prefixed elements, which ExcelJS v4
 * does not resolve. Rather than add a dependency or mutate Owner evidence, this
 * TEST-ONLY reader takes the cell values directly. It is not, and must never
 * become, a production parser.
 */
function decodeXmlText(raw: string): string {
  return raw
    .replace(/&#x([0-9a-fA-F]+);/gu, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/gu, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, '&');
}

function readSheetCells(xml: string): Map<number, Map<string, string>> {
  const rows = new Map<number, Map<string, string>>();
  const rowRe = /<(?:\w+:)?row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/gu;
  const cellRe = /<(?:\w+:)?c\b[^>]*\br="([A-Z]+)\d+"[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/gu;
  const valueRe = /<(?:\w+:)?(?:v|t)>([\s\S]*?)<\/(?:\w+:)?(?:v|t)>/u;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(xml)) !== null) {
    const cells = new Map<string, string>();
    let cellMatch: RegExpExecArray | null;
    cellRe.lastIndex = 0;
    while ((cellMatch = cellRe.exec(rowMatch[2])) !== null) {
      const value = valueRe.exec(cellMatch[2] ?? '');
      if (value) cells.set(cellMatch[1], decodeXmlText(value[1]).trim());
    }
    rows.set(Number(rowMatch[1]), cells);
  }
  return rows;
}

async function readGoldenSheet(zip: JSZip, sheetName: string) {
  const workbookXml = await zip.file('xl/workbook.xml')!.async('string');
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string');
  const targets = new Map<string, string>();
  for (const rel of relsXml.match(/<Relationship\b[^>]*\/>/gu) ?? []) {
    const id = /Id="([^"]+)"/u.exec(rel)?.[1];
    const target = /Target="([^"]+)"/u.exec(rel)?.[1];
    if (id && target) targets.set(id, target.replace(/^\//u, ''));
  }
  for (const sheet of workbookXml.match(/<(?:\w+:)?sheet\b[^>]*\/>/gu) ?? []) {
    const name = /name="([^"]+)"/u.exec(sheet)?.[1];
    const rid = /r:id="([^"]+)"/u.exec(sheet)?.[1];
    if (name === sheetName && rid && targets.has(rid)) {
      return readSheetCells(await zip.file(targets.get(rid)!)!.async('string'));
    }
  }
  throw new Error(`sheet not found: ${sheetName}`);
}

/** Column letter for a header caption, so the proof never hard-codes positions. */
function columnOf(header: Map<string, string>, caption: string): string {
  for (const [col, value] of header) if (value === caption) return col;
  throw new Error(`header not found: ${caption}`);
}

const GROUP_CONTEXT: Record<string, UnitAliasContext> = {
  TENAGA: UNIT_ALIAS_CONTEXT.LABOR,
  BAHAN: UNIT_ALIAS_CONTEXT.MATERIAL,
  PERALATAN: UNIT_ALIAS_CONTEXT.EQUIPMENT,
};

const CANONICAL_UNIT_CODE: Record<string, string> = {
  m3: 'M3', kg: 'KG', ls: 'LS', m: 'M1', liter: 'LITER',
  'bh/m': 'BH_PER_M', unit: 'UNIT', lbr: 'LBR',
};

function expectedCodeFor(canonicalUnit: string, context: UnitAliasContext): string {
  if (canonicalUnit === 'jam') {
    return context === UNIT_ALIAS_CONTEXT.LABOR ? 'PERSON_HOUR' : 'EQUIPMENT_HOUR';
  }
  return CANONICAL_UNIT_CODE[canonicalUnit];
}

interface GoldenResourceRow {
  sourceRow: number;
  item: string;
  group: string;
  rawUnit: string;
  canonicalUnit: string;
}

/**
 * Gated on the REQUEST, not on the file. Once an operator names a path, the
 * suite must run and reach a verdict — a missing or impostor file fails it.
 */
const goldenRequested = GOLDEN_PATH !== '';
const describeGolden = goldenRequested ? describe : describe.skip;

describeGolden('B1B12 EXACT GOLDEN WORKBOOK LOCAL ACCEPTANCE', () => {
  let resourceRows: GoldenResourceRow[] = [];
  let ahspOutputs: Array<{ item: string; code: string; officialUnit: string; canonicalUnit: string }> = [];
  let verifiedIdentity: GoldenByteIdentity | null = null;

  beforeAll(async () => {
    // 1. An explicitly requested workbook that is not there is a failure, never
    //    a skip. The message names the path the operator actually asked for.
    if (!existsSync(GOLDEN_PATH)) {
      throw new Error(
        `GOLDEN_WORKBOOK_NOT_FOUND: B1B12_GOLDEN_WORKBOOK_PATH was set to "${GOLDEN_PATH}", ` +
          `but no file exists there. An explicitly requested exact-Golden acceptance run is never skipped.`,
      );
    }

    // 2-3. Read the bytes and establish identity BEFORE anything interprets them.
    const bytes = readFileSync(GOLDEN_PATH);
    verifiedIdentity = assertExactGoldenBytes(bytes, GOLDEN_PATH);

    // 4. Only now may these bytes be treated as a workbook.
    const zip = await JSZip.loadAsync(bytes);

    const matrix = await readGoldenSheet(zip, '02_RESOURCE_MATRIX');
    const mHeader = matrix.get(1)!;
    const cItem = columnOf(mHeader, 'Item');
    const cGroup = columnOf(mHeader, 'Group');
    const cRawUnit = columnOf(mHeader, 'Raw Unit');
    const cCanonical = columnOf(mHeader, 'Canonical Unit');
    resourceRows = [...matrix.entries()]
      .filter(([rowNumber]) => rowNumber > 1)
      .map(([rowNumber, cells]) => ({
        sourceRow: rowNumber,
        item: cells.get(cItem) ?? '',
        group: cells.get(cGroup) ?? '',
        rawUnit: cells.get(cRawUnit) ?? '',
        canonicalUnit: cells.get(cCanonical) ?? '',
      }))
      .filter((r) => r.item !== '' && r.rawUnit !== '');

    const index = await readGoldenSheet(zip, '01_AHSP_INDEX');
    const iHeader = index.get(1)!;
    const iItem = columnOf(iHeader, 'Item');
    const iCode = columnOf(iHeader, 'AHSP Code');
    const iOfficial = columnOf(iHeader, 'Official Unit');
    const iCanonical = columnOf(iHeader, 'Canonical Unit');
    ahspOutputs = [...index.entries()]
      .filter(([rowNumber]) => rowNumber > 1)
      .map(([, cells]) => ({
        item: cells.get(iItem) ?? '',
        code: cells.get(iCode) ?? '',
        officialUnit: cells.get(iOfficial) ?? '',
        canonicalUnit: cells.get(iCanonical) ?? '',
      }))
      .filter((r) => r.item !== '');
  });

  it('the workbook bytes are exactly the locked Golden v1.2 identity', () => {
    // Asserts the proof the guard already produced in beforeAll. The file is not
    // re-read: if this expectation could fail, no row below would exist to test,
    // because parsing never happens on unverified bytes.
    expect(verifiedIdentity).toEqual({ size: GOLDEN_SIZE, sha256: GOLDEN_SHA256 });
  });

  it('02_RESOURCE_MATRIX holds exactly 159 resource rows', () => {
    expect(resourceRows).toHaveLength(159);
  });

  it('the canonical-unit distribution read from the workbook matches the locked contract', () => {
    const counts: Record<string, number> = {};
    for (const r of resourceRows) counts[r.canonicalUnit] = (counts[r.canonicalUnit] ?? 0) + 1;
    expect(counts).toEqual({ jam: 67, m3: 41, kg: 16, ls: 12, m: 8, liter: 7, 'bh/m': 4, unit: 2, lbr: 2 });
  });

  it('the "jam" split comes from Group truth: 35 TENAGA + 32 PERALATAN', () => {
    const jam = resourceRows.filter((r) => r.canonicalUnit === 'jam');
    expect(jam).toHaveLength(67);
    expect(jam.filter((r) => r.group === 'TENAGA')).toHaveLength(35);
    expect(jam.filter((r) => r.group === 'PERALATAN')).toHaveLength(32);
    expect(jam.filter((r) => r.group !== 'TENAGA' && r.group !== 'PERALATAN')).toHaveLength(0);
  });

  it('every Group is one of the three governed classifications', () => {
    for (const r of resourceRows) expect(Object.keys(GROUP_CONTEXT)).toContain(r.group);
  });

  it('resolves all 159 actual rows: 0 ambiguous, 0 unsupported, 0 guessed', async () => {
    let resolved = 0;
    let ambiguous = 0;
    let unsupported = 0;
    const failures: string[] = [];
    const jamLabor = { total: 0, personHour: 0 };
    const jamEquipment = { total: 0, equipmentHour: 0 };

    for (const row of resourceRows) {
      const context = GROUP_CONTEXT[row.group];
      const expected = expectedCodeFor(row.canonicalUnit, context);
      const result = await identity(row.rawUnit, context);
      const got = result.sourceUnitDefinition?.code ?? null;

      if (row.canonicalUnit === 'jam' && context === UNIT_ALIAS_CONTEXT.LABOR) {
        jamLabor.total += 1;
        if (got === 'PERSON_HOUR' && result.status === UNIT_RESOLUTION_STATUS.RESOLVED) jamLabor.personHour += 1;
      }
      if (row.canonicalUnit === 'jam' && context === UNIT_ALIAS_CONTEXT.EQUIPMENT) {
        jamEquipment.total += 1;
        if (got === 'EQUIPMENT_HOUR' && result.status === UNIT_RESOLUTION_STATUS.RESOLVED) jamEquipment.equipmentHour += 1;
      }

      if (result.status === UNIT_RESOLUTION_STATUS.RESOLVED && got === expected) resolved += 1;
      else if (result.reasonCodes.includes(UNIT_REASON.AMBIGUOUS_UNIT_ALIAS)) {
        ambiguous += 1;
        failures.push(`row ${row.sourceRow} ${row.item} ${row.group} ${row.rawUnit} -> AMBIGUOUS`);
      } else {
        unsupported += 1;
        failures.push(`row ${row.sourceRow} ${row.item} ${row.group} ${row.rawUnit} -> ${result.status}/${got}`);
      }
    }

    expect(failures).toEqual([]);
    expect({ total: resourceRows.length, resolved, ambiguous, unsupported }).toEqual({
      total: 159, resolved: 159, ambiguous: 0, unsupported: 0,
    });
    expect(jamLabor).toEqual({ total: 35, personHour: 35 });
    expect(jamEquipment).toEqual({ total: 32, equipmentHour: 32 });
  });

  it('01_AHSP_INDEX yields 12 output units that all resolve (B1-B2 m3, B3-B12 m)', async () => {
    expect(ahspOutputs).toHaveLength(12);
    const byUnit: Record<string, number> = {};
    let resolved = 0;
    let ambiguous = 0;
    for (const a of ahspOutputs) {
      byUnit[a.canonicalUnit] = (byUnit[a.canonicalUnit] ?? 0) + 1;
      // "Official Unit" is the regulation's PROSE ("Meter Kubik"/"Meter
      // Panjang"), which is a description and not unit notation. The unit token
      // an AHSP version actually carries is the workbook's Canonical Unit, and
      // that is what the kernel must resolve. Prose is deliberately NOT aliased.
      const r = await identity(a.canonicalUnit);
      const expected = CANONICAL_UNIT_CODE[a.canonicalUnit];
      if (r.status === UNIT_RESOLUTION_STATUS.RESOLVED && r.sourceUnitDefinition?.code === expected) resolved += 1;
      else if (r.reasonCodes.includes(UNIT_REASON.AMBIGUOUS_UNIT_ALIAS)) ambiguous += 1;
    }
    expect(byUnit).toEqual({ m3: 2, m: 10 });
    expect({ total: ahspOutputs.length, resolved, ambiguous }).toEqual({ total: 12, resolved: 12, ambiguous: 0 });
    expect(ahspOutputs.filter((a) => a.canonicalUnit === 'm3').map((a) => a.item).sort()).toEqual(['B1', 'B2']);
    expect([...new Set(ahspOutputs.map((a) => a.officialUnit))].sort()).toEqual(['Meter Kubik', 'Meter Panjang']);
  });
});
