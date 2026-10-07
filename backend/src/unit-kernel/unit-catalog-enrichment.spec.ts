import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import { UnitKernelService } from './unit-kernel.service';
import { normalizeUnitAlias } from './unit-normalization';
import { UNIT_ALIAS_CONTEXT, UNIT_REASON, UNIT_RESOLUTION_STATUS, UnitAliasContext } from './unit-kernel.contracts';

/**
 * The enriched catalogue is read from the shipped migrations, including the
 * additive enrichment. The Golden census file is not rewritten.
 */

const MIGRATIONS = resolvePath(__dirname, '..', '..', 'prisma', 'migrations');
const FILES = [
  '20260717010000_kamus_unit_kernel_01a/migration.sql',
  '20260812090000_b1b12_golden_unit_coverage/migration.sql',
  '20260813090000_equipment_hour_source_vocabulary/migration.sql',
  '20260908120000_person_hour_orang_jam_vocabulary/migration.sql',
  '20261002140000_unit_catalog_enrichment_01/migration.sql',
];
const ENRICHMENT = readFileSync(resolvePath(MIGRATIONS, FILES[4]), 'utf8');

function splitTuple(body: string): string[] {
  const out: string[] = [];
  let current = '';
  let inString = false;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (inString) {
      if (ch === "'" && body[i + 1] === "'") { current += "'"; i += 1; continue; }
      if (ch === "'") { inString = false; current += ch; continue; }
      current += ch;
      continue;
    }
    if (ch === "'") { inString = true; current += ch; continue; }
    if (ch === ',') { out.push(current); current = ''; continue; }
    current += ch;
  }
  out.push(current);
  return out.map((raw) => {
    const trimmed = raw.trim().replace(/::"?[A-Za-z_]+"?$/u, '');
    return trimmed.startsWith("'") && trimmed.endsWith("'") ? trimmed.slice(1, -1).replace(/''/gu, "'") : trimmed;
  });
}

function tuples(sql: string): string[][] {
  return sql.split(/\r?\n/u).filter((line) => line.trimStart().startsWith("('")).flatMap((line) => {
    const matches = line.match(/\((?:[^'()]|'(?:''|[^'])*')*\)/gu) ?? [];
    return matches.map((m) => splitTuple(m.slice(1, -1)));
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

interface Def { id: string; code: string; dimension: string }
interface Alias { id: string; rawAlias: string; normalizedAlias: string; code: string; context: string | null }
interface Rule { source: string; target: string; factor: string }

function load() {
  const definitions: Def[] = [];
  const aliases: Alias[] = [];
  const rules: Rule[] = [];
  const codes = new Set<string>();
  for (const file of FILES) {
    const sql = readFileSync(resolvePath(MIGRATIONS, file), 'utf8');
    for (const t of tuples(sql).filter((x) => UUID.test(x[0]))) {
      if (t.length === 6) {
        definitions.push({ id: t[0], code: t[1], dimension: t[4] });
        codes.add(t[1]);
      }
    }
  }
  for (const file of FILES) {
    const sql = readFileSync(resolvePath(MIGRATIONS, file), 'utf8');
    for (const t of tuples(sql).filter((x) => UUID.test(x[0]))) {
      if (t.length === 4 && codes.has(t[3])) aliases.push({ id: t[0], rawAlias: t[1], normalizedAlias: t[2], code: t[3], context: null });
      if (t.length === 5 && codes.has(t[3])) aliases.push({ id: t[0], rawAlias: t[1], normalizedAlias: t[2], code: t[3], context: t[4] });
      if (t.length === 4 && codes.has(t[1]) && codes.has(t[2]) && /^\d+(\.\d+)?$/u.test(t[3])) rules.push({ source: t[1], target: t[2], factor: t[3] });
    }
  }
  return { definitions, aliases, rules };
}

const { definitions, aliases, rules } = load();
const byCode = new Map(definitions.map((d) => [d.code, d]));

function makeKernel() {
  const prisma = {
    unitAlias: {
      findMany: async ({ where }: { where: { normalizedAlias: string | { in: string[] } } }) => {
        const wanted = typeof where.normalizedAlias === 'string' ? [where.normalizedAlias] : where.normalizedAlias.in;
        return aliases
          .filter((a) => wanted.includes(a.normalizedAlias))
          .map((a) => ({
            id: a.id,
            normalizedAlias: a.normalizedAlias,
            context: a.context,
            unitDefinition: { id: byCode.get(a.code)!.id, code: a.code, dimension: byCode.get(a.code)!.dimension },
          }));
      },
    },
    unitConversionRule: {
      findMany: async ({ where }: { where: { sourceUnitId: string; targetUnitId: string } }) =>
        rules
          .filter((rule) => byCode.get(rule.source)!.id === where.sourceUnitId && byCode.get(rule.target)!.id === where.targetUnitId)
          .map((rule) => ({
            id: 'rule-' + rule.source + '-' + rule.target,
            quantityFactor: rule.factor,
            conversionType: 'EXACT_GLOBAL',
            version: 1,
            evidenceReference: 'SI/international exact factor',
            evidenceHash: null,
            evidencePayload: null,
          })),
    },
  };
  return new UnitKernelService(prisma as never);
}

const kernel = makeKernel();
async function identity(raw: string, context?: UnitAliasContext) {
  return kernel.resolve(raw, raw, undefined, context);
}

describe('unit catalog enrichment — preservation', () => {
  it('does not delete, drop, truncate, or alter the schema', () => {
    expect(ENRICHMENT).not.toMatch(/DELETE\s+FROM/iu);
    expect(ENRICHMENT).not.toMatch(/\bDROP\b/iu);
    expect(ENRICHMENT).not.toMatch(/\bTRUNCATE\b/iu);
    expect(ENRICHMENT).not.toMatch(/ALTER\s+TABLE/iu);
    expect(ENRICHMENT).not.toMatch(/CREATE\s+TABLE/iu);
    expect(ENRICHMENT).not.toMatch(/CREATE\s+TYPE/iu);
  });

  it('keeps the shipped canonical codes and does not add a second each', () => {
    for (const code of ['PERSON_DAY', 'PERSON_HOUR', 'EQUIPMENT_HOUR', 'KG', 'M1', 'M2', 'M3', 'LITER', 'SAK', 'ROLL', 'LBR', 'UNIT', 'LS', 'TRUCK', 'BH_PER_M']) {
      expect(byCode.get(code)).toBeDefined();
    }
    expect(byCode.get('PIECE')).toBeUndefined();
    expect(byCode.get('SACK')).toBeUndefined();
    expect(byCode.get('SHEET')).toBeUndefined();
  });

  it('stores the normalisation the kernel computes, aliases bare ton to TONNE, and does not alias pact', () => {
    for (const alias of aliases) expect(alias.normalizedAlias).toBe(normalizeUnitAlias(alias.rawAlias));
    expect(aliases.find((alias) => alias.normalizedAlias === 'ton' && alias.context === null)?.code).toBe('TONNE');
    expect(aliases.some((alias) => alias.normalizedAlias === 'pact')).toBe(false);
  });
});

describe('unit catalog enrichment — context', () => {
  it.each([
    ['jam', 'LABOR', 'PERSON_HOUR'],
    ['hari', 'LABOR', 'PERSON_DAY'],
    ['minggu', 'LABOR', 'PERSON_WEEK'],
    ['bulan', 'LABOR', 'PERSON_MONTH'],
    ['jam', 'EQUIPMENT', 'EQUIPMENT_HOUR'],
    ['hari', 'EQUIPMENT', 'EQUIPMENT_DAY'],
    ['minggu', 'EQUIPMENT', 'EQUIPMENT_WEEK'],
    ['bulan', 'EQUIPMENT', 'EQUIPMENT_MONTH'],
  ] as const)('%s + %s → %s', async (raw, context, code) => {
    const result = await identity(raw, UNIT_ALIAS_CONTEXT[context]);
    expect(result.status).toBe(UNIT_RESOLUTION_STATUS.RESOLVED);
    expect(result.sourceUnitDefinition?.code).toBe(code);
  });

  it('leaves bare hari ambiguous until a resource context is supplied', async () => {
    const result = await identity('hari');
    expect(result.status).toBe(UNIT_RESOLUTION_STATUS.NEEDS_REVIEW);
    expect(result.reasonCodes).toContain(UNIT_REASON.AMBIGUOUS_UNIT_ALIAS);
  });

  it.each([
    ['orang-jam', 'PERSON_HOUR'],
    ['orang-hari', 'PERSON_DAY'],
    ['orang-minggu', 'PERSON_WEEK'],
    ['orang-bulan', 'PERSON_MONTH'],
  ] as const)('LABOR %s stays %s', async (raw, code) => {
    const result = await identity(raw, UNIT_ALIAS_CONTEXT.LABOR);
    expect(result.status).toBe(UNIT_RESOLUTION_STATUS.RESOLVED);
    expect(result.sourceUnitDefinition?.code).toBe(code);
  });

  it('accepts orang-bulan for LABOR as the existing PERSON_MONTH definition', async () => {
    const result = await identity('orang-bulan', UNIT_ALIAS_CONTEXT.LABOR);
    expect(result.status).toBe(UNIT_RESOLUTION_STATUS.RESOLVED);
    expect(result.sourceUnitDefinition?.code).toBe('PERSON_MONTH');
  });

  it('accepts the existing LS definition for EQUIPMENT as LS', async () => {
    const result = await identity('ls', UNIT_ALIAS_CONTEXT.EQUIPMENT);
    expect(result.status).toBe(UNIT_RESOLUTION_STATUS.RESOLVED);
    expect(result.sourceUnitDefinition?.code).toBe('LS');
    expect(result.sourceUnitDefinition?.dimension).toBe('COUNT');
  });

  it.each([
    ['orang-jam', 'EQUIPMENT'],
    ['OH', 'EQUIPMENT'],
    ['orang-bulan', 'EQUIPMENT'],
    ['orang-bulan', 'MATERIAL'],
    ['hari alat', 'LABOR'],
    ['EQUIPMENT_HOUR', 'LABOR'],
  ] as const)('refuses %s for %s', async (raw, context) => {
    const result = await identity(raw, UNIT_ALIAS_CONTEXT[context]);
    expect(result.status).toBe(UNIT_RESOLUTION_STATUS.NEEDS_REVIEW);
    expect(result.reasonCodes).toContain(UNIT_REASON.RESOURCE_TYPE_UNIT_INCOMPATIBLE);
    expect(result.sourceUnitDefinition).toBeNull();
  });
});

describe('unit catalog enrichment — material one truth', () => {
  it.each(['buah', 'Bh', 'bh', 'pcs', 'pc', 'piece', 'pieces', 'each', 'ea'])('%s → UNIT', async (raw) => {
    const result = await identity(raw);
    expect(result.status).toBe(UNIT_RESOLUTION_STATUS.RESOLVED);
    expect(result.sourceUnitDefinition?.code).toBe('UNIT');
    expect(result.sourceUnitDefinition?.id).toBe(byCode.get('UNIT')!.id);
  });

  it('keeps bh/m on BH_PER_M', async () => {
    const result = await identity('bh/m');
    expect(result.sourceUnitDefinition?.code).toBe('BH_PER_M');
  });

  it.each([
    ['sak', 'SAK'],
    ['karung', 'SAK'],
    ['roll', 'ROLL'],
    ['gulung', 'ROLL'],
    ['lembar', 'LBR'],
    ['sheet', 'LBR'],
    ['pak', 'PACK'],
    ['pack', 'PACK'],
    ['box', 'BOX'],
    ['kotak', 'BOX'],
    ['carton', 'CARTON'],
    ['karton', 'CARTON'],
    ['bottle', 'BOTTLE'],
    ['botol', 'BOTTLE'],
    ['drum', 'DRUM'],
    ['jerrican', 'JERRICAN'],
    ['jerigen', 'JERRICAN'],
    ['bundle', 'BUNDLE'],
    ['ikat', 'BUNDLE'],
    ['pallet', 'PALLET'],
    ['ream', 'REAM'],
    ['rim', 'REAM'],
  ] as const)('%s → %s', async (raw, code) => {
    const result = await identity(raw);
    expect(result.sourceUnitDefinition?.code).toBe(code);
  });

  it('does not convert a package into a count', async () => {
    const result = await kernel.resolve('pak', 'buah');
    expect(result.status).toBe(UNIT_RESOLUTION_STATUS.NEEDS_REVIEW);
    expect(result.reasonCodes).toContain(UNIT_REASON.CONVERSION_RULE_NOT_FOUND);
    expect(result.quantityFactor).toBeNull();
  });

  it('does not convert a person-day into a person-hour', async () => {
    const result = await kernel.resolve('orang-hari', 'orang-jam', undefined, UNIT_ALIAS_CONTEXT.LABOR);
    expect(result.reasonCodes).toContain(UNIT_REASON.CONVERSION_RULE_NOT_FOUND);
  });
});

describe('unit catalog enrichment — physical units and tonne', () => {
  it.each([
    ['mm', 'MILLIMETRE'],
    ['cm', 'CENTIMETRE'],
    ['m', 'M1'],
    ['meter', 'M1'],
    ['km', 'KILOMETRE'],
    ['m2', 'M2'],
    ['m²', 'M2'],
    ['ha', 'HECTARE'],
    ['ml', 'MILLILITRE'],
    ['L', 'LITER'],
    ['m3', 'M3'],
    ['m³', 'M3'],
    ['mg', 'MILLIGRAM'],
    ['g', 'GRAM'],
    ['kg', 'KG'],
    ['tonne', 'TONNE'],
    ['ton metrik', 'TONNE'],
    ['ton', 'TONNE'],
    ['Ton', 'TONNE'],
    ['metric ton', 'TONNE'],
    ['short ton', 'SHORT_TON'],
    ['US ton', 'SHORT_TON'],
    ['long ton', 'LONG_TON'],
    ['imperial ton', 'LONG_TON'],
  ] as const)('%s → %s', async (raw, code) => {
    const result = await identity(raw);
    expect(result.status).toBe(UNIT_RESOLUTION_STATUS.RESOLVED);
    expect(result.sourceUnitDefinition?.code).toBe(code);
    expect(result.reasonCodes).not.toContain(UNIT_REASON.UNKNOWN_UNIT_ALIAS);
  });

  it('resolves bare ton for material as the existing tonne, not a labour or equipment unit', async () => {
    const result = await identity('Ton', UNIT_ALIAS_CONTEXT.MATERIAL);
    expect(result.status).toBe(UNIT_RESOLUTION_STATUS.RESOLVED);
    expect(result.sourceUnitDefinition?.code).toBe('TONNE');
    expect(result.sourceUnitDefinition?.dimension).toBe('MASS');
    expect(result.sourceUnitDefinition?.dimension).not.toBe('PERSON_TIME');
    expect(result.sourceUnitDefinition?.dimension).not.toBe('EQUIPMENT_TIME');
  });

  it('keeps an explicit short or long ton on its own canonical unit', async () => {
    const shortTon = await identity('short ton', UNIT_ALIAS_CONTEXT.MATERIAL);
    const longTon = await identity('long ton', UNIT_ALIAS_CONTEXT.MATERIAL);
    expect(shortTon.sourceUnitDefinition?.code).toBe('SHORT_TON');
    expect(longTon.sourceUnitDefinition?.code).toBe('LONG_TON');
    expect(shortTon.sourceUnitDefinition?.id).not.toBe(byCode.get('TONNE')!.id);
    expect(longTon.sourceUnitDefinition?.id).not.toBe(byCode.get('TONNE')!.id);
  });

  it('converts the existing tonne to kilogram and back', async () => {
    const forward = await kernel.resolve('ton', 'kg');
    const inverse = await kernel.resolve('kg', 'ton');
    expect(forward.status).toBe(UNIT_RESOLUTION_STATUS.RESOLVED);
    expect(forward.sourceUnitDefinition?.code).toBe('TONNE');
    expect(forward.targetUnitDefinition?.code).toBe('KG');
    expect(forward.quantityFactor).toBe('1000');
    expect(inverse.status).toBe(UNIT_RESOLUTION_STATUS.RESOLVED);
    expect(inverse.quantityFactor).toBe('0.001');
  });

  it('converts millimetre to metre through the existing conversion rule', async () => {
    const result = await kernel.resolve('mm', 'm');
    expect(result.status).toBe(UNIT_RESOLUTION_STATUS.RESOLVED);
    expect(result.conversionType).toBe('EXACT_GLOBAL');
    expect(result.quantityFactor).toBe('0.001');
  });
});
