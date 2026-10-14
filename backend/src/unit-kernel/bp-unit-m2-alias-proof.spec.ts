import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { UnitKernelService } from './unit-kernel.service';
import { normalizeUnitAlias } from './unit-normalization';
import { UNIT_RESOLUTION_STATUS, UNIT_REASON } from './unit-kernel.contracts';

const MIGRATION = readFileSync(
  resolvePath(__dirname, '..', '..', 'prisma', 'migrations',
    '20261014203000_bp_m2_spacing_alias', 'migration.sql'), 'utf8',
);

const M2 = {
  id: '10000000-0000-4000-8000-000000000005',
  code: 'M2',
  dimension: 'AREA',
};
const alias = (raw: string) => ({
  normalizedAlias: normalizeUnitAlias(raw),
  context: null,
  unitDefinition: M2,
});
const sourceAliases = [alias('M2')];
const additionalAlias = alias('M 2');

function authority(withM2Spacing: boolean) {
  const aliases = withM2Spacing
    ? [...sourceAliases, additionalAlias]
    : [...sourceAliases];
  const client = {
    unitAlias: {
      findMany: jest.fn(async ({ where }: {
        where: { normalizedAlias: { in: string[] } };
      }) => aliases.filter(a => where.normalizedAlias.in.includes(a.normalizedAlias))),
    },
  };
  return new UnitKernelService(client as never);
}

describe('BP-UNIT-M2-ALIAS-01 — canonical evidence reuse, no second matcher', () => {
  it('only adds an existing canonical unit alias, with no new schema or unit definition', () => {
    expect(normalizeUnitAlias('M 2')).toBe('m 2');
    expect(MIGRATION).toMatch(/"normalizedAlias"\s*=\s*'m2'/u);
    expect(MIGRATION).toMatch(/"dimension"\s*=\s*'AREA'/u);
    expect(MIGRATION).toMatch(/"normalizedAlias"\s*=\s*'m 2'/u);
    expect(MIGRATION).toContain("gen_random_uuid(), 'M 2', 'm 2', canonical_m2");
    expect(MIGRATION).toContain('IF NOT EXISTS');
    expect(MIGRATION).toContain('IF EXISTS');
    expect(MIGRATION).toContain('RAISE EXCEPTION');
    expect(MIGRATION).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE|UPDATE|ALTER|CREATE)\s+(?:TABLE|TYPE|FROM|")/iu);
    expect(MIGRATION).not.toContain('INSERT INTO "unit_definitions"');
    expect(MIGRATION).not.toContain('INSERT INTO "unit_conversion_rules"');
  });

  it('reuses M2 for source spelling M 2, preserving the canonical M2 answer', async () => {
    const existing = await authority(false).resolveCanonicalUnitIdentities(['M 2','M2'], 'MATERIAL');
    expect(existing[0].status).toBe(UNIT_RESOLUTION_STATUS.NEEDS_REVIEW);
    expect(existing[0].reasonCode).toBe(UNIT_REASON.UNKNOWN_UNIT_ALIAS);
    expect(existing[1].status).toBe(UNIT_RESOLUTION_STATUS.RESOLVED);

    const connected = await authority(true).resolveCanonicalUnitIdentities(['M 2','M2'], 'MATERIAL');
    expect(connected[0].status).toBe(UNIT_RESOLUTION_STATUS.RESOLVED);
    expect(connected[0].unitDefinition?.code).toBe('M2');
    expect(connected[1].status).toBe(UNIT_RESOLUTION_STATUS.RESOLVED);
    expect(connected[1].unitDefinition?.id).toBe(connected[0].unitDefinition?.id);
    expect(connected[0].rawUnit).toBe('M 2');
  });

  it.each(['M5','V2','Staf','Dos','Zak','Gallon','Psng','Btg'])(
    'does not infer the unproven unit %s',
    async (raw) => {
      const verdict = (await authority(true).resolveCanonicalUnitIdentities([raw], 'MATERIAL'))[0];
      expect(verdict.status).toBe(UNIT_RESOLUTION_STATUS.NEEDS_REVIEW);
      expect(verdict.reasonCode).toBe(UNIT_REASON.UNKNOWN_UNIT_ALIAS);
    },
  );
});
