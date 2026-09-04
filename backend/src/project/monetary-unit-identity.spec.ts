import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { COST_CALCULATION_REASON } from './cost-kernel.contracts';
import { monetaryUnitIdentity } from './monetary-unit-identity';

describe('monetary unit identity', () => {
  const admits = (boqUnit: string, outputUnit: string | null) =>
    monetaryUnitIdentity(boqUnit, outputUnit).admissible;

  it.each([
    ['M1', 'M1'],
    ['M1', 'm1'],
    ['M1', 'M¹'],
    ['  M1 ', 'M1'],
    ['Kg', 'KG'],
  ])('admits monetarily identical %s vs %s', (boqUnit, outputUnit) => {
    expect(admits(boqUnit, outputUnit)).toBe(true);
  });

  it.each([
    ['M', 'M1'],
    ['M1', 'M2'],
    ['Kg', 'Liter'],
    // The 26 seeded alias pairs the Unit Kernel calls ONE canonical unit and
    // the calculation chain refuses. Binding on these is the false door.
    ['OH', 'Orang/Hari'],
    ['jam', 'person_hour'],
    ['liter', 'ltr'],
  ])('refuses %s vs %s as a monetary mismatch', (boqUnit, outputUnit) => {
    expect(monetaryUnitIdentity(boqUnit, outputUnit)).toEqual({
      admissible: false,
      refusal: COST_CALCULATION_REASON.BOQ_AHSP_UNIT_MISMATCH,
    });
  });

  it.each([[null], [''], ['   ']])(
    'refuses a missing output unit (%s) as its own distinct fact',
    (outputUnit) => {
      // Distinct from a mismatch, and distinct on purpose: a unit nobody stated
      // is not a unit that disagrees. Collapsing the two would let a blank BOQ
      // unit and a blank output unit compare "identical" and bind.
      expect(monetaryUnitIdentity('', outputUnit)).toEqual({
        admissible: false,
        refusal: COST_CALCULATION_REASON.MISSING_AHSP_OUTPUT_UNIT,
      });
    },
  );

  it('hands the proven output unit back verbatim, never normalized', () => {
    // The Cost Kernel puts this on a CALCULATED result. Returning the
    // normalized form would silently rewrite what the AHSP version says.
    expect(monetaryUnitIdentity('  M1 ', 'M¹')).toEqual({
      admissible: true,
      outputUnit: 'M¹',
    });
  });

  /**
   * ONE FACT → ONE AUTHORITY. Two implementations of "these units are
   * monetarily identical" cannot drift apart if only one exists. The bind
   * boundary and the calculation chain must ask THIS function, not their own
   * copy of it — a second copy is how a bind starts admitting what the
   * calculation refuses.
   */
  describe('one implementation only', () => {
    const sourceRoot = join(__dirname, '..');
    const SEP = String.fromCharCode(92);
    const collect = (dir: string): string[] =>
      readdirSync(dir)
        .sort()
        .flatMap((name) => {
          const path = join(dir, name);
          return statSync(path).isDirectory()
            ? collect(path)
            : name.endsWith('.ts') && !name.endsWith('.spec.ts')
              ? [path]
              : [];
        });
    const production = () =>
      collect(sourceRoot).map((file) => ({
        relative: file.split(SEP).join('/').split('/src/')[1],
        code: readFileSync(file, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\/\/[^\n]*/g, ''),
      }));

    it('the unit-kernel normalizer has exactly one monetary consumer', () => {
      // unit-kernel.service.ts is the Unit Kernel using its OWN primitive for
      // alias lookup — a different question, lawfully asked. Anything else
      // appearing here is a second monetary identity.
      expect(
        production()
          .filter(({ code }) => code.includes('normalizeUnitAlias'))
          .map(({ relative }) => relative)
          .sort(),
      ).toEqual([
        'project/monetary-unit-identity.ts',
        'unit-kernel/unit-kernel.service.ts',
        'unit-kernel/unit-normalization.ts',
      ]);
    });

    it('the bind seam calls the fact and never re-derives it', () => {
      const seam = production().find(
        ({ relative }) => relative === 'project-ahsp/project-ahsp.service.ts',
      );
      expect(seam?.code).toContain('monetaryUnitIdentity(');
      expect(seam?.code).not.toContain('normalizeUnitAlias');
      // No hand-rolled unit comparison of any shape.
      expect(seam?.code).not.toMatch(/\.unit\s*[!=]==?\s*/);
      expect(seam?.code).not.toMatch(/outputUnit\s*[!=]==?\s*/);
    });

    it('the Cost Kernel asks the same fact and keeps no private copy', () => {
      const kernel = production().find(
        ({ relative }) => relative === 'project/cost-kernel.kernel.ts',
      );
      expect(kernel?.code).toContain('monetaryUnitIdentity(');
      expect(kernel?.code).not.toContain('exactUnit');
      expect(kernel?.code).not.toContain('normalizeUnitAlias');
    });

    it('the fact stays pure — no resolver, no alias table, no database', () => {
      const fact = readFileSync(
        join(sourceRoot, 'project', 'monetary-unit-identity.ts'),
        'utf8',
      );
      for (const forbidden of [
        'UnitKernelService',
        'BoqUnitCompatibilityService',
        'unitAlias',
        'unitDefinition',
        'conversionRule',
        'quantityFactor',
        'prisma',
        'Prisma',
        'BasicPrice',
        'async',
      ]) {
        expect(fact).not.toContain(forbidden);
      }
    });
  });
});
