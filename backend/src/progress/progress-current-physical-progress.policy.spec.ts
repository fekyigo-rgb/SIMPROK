import { Prisma } from '@prisma/client';
import type { CurrentOfficialQuantityResult } from './progress-current-official-quantity.policy';
import {
  calculateWorkItemCurrentPhysicalProgress,
  type WorkItemCurrentPhysicalProgressInput,
} from './progress-current-physical-progress.policy';

const complete = (value: string): CurrentOfficialQuantityResult => ({
  state: 'COMPLETE',
  currentOfficialQuantity: new Prisma.Decimal(value),
});

const incomplete = (value: string): CurrentOfficialQuantityResult => ({
  state: 'INCOMPLETE',
  knownEligibleQuantitySubtotal: new Prisma.Decimal(value),
});

const calculate = (
  currentOfficialQuantity: CurrentOfficialQuantityResult,
  plannedQuantity: WorkItemCurrentPhysicalProgressInput['plannedQuantity'] = new Prisma.Decimal(
    '8',
  ),
  plannedUnit: WorkItemCurrentPhysicalProgressInput['plannedUnit'] = 'm3',
) =>
  calculateWorkItemCurrentPhysicalProgress({
    currentOfficialQuantity,
    plannedQuantity,
    plannedUnit,
  });

describe('MON-04 LAW 2: WORK_ITEM Current Physical Progress', () => {
  it('T1: NOT_YET_RECORDED remains non-numeric regardless of downstream inputs', () => {
    expect(calculate({ state: 'NOT_YET_RECORDED' }, null, '')).toEqual({
      state: 'NOT_YET_RECORDED',
    });
  });

  it('T2: NO_ELIGIBLE_CURRENT_FACT remains non-numeric', () => {
    expect(calculate({ state: 'NO_ELIGIBLE_CURRENT_FACT' })).toEqual({
      state: 'NO_ELIGIBLE_CURRENT_FACT',
    });
  });

  it('T3: INVALID_LINEAGE reason is preserved', () => {
    expect(
      calculate({
        state: 'INVALID_LINEAGE',
        reason: 'CYCLE',
      }),
    ).toEqual({
      state: 'INVALID_LINEAGE',
      reason: 'CYCLE',
    });
  });

  it('T4: INVALID_NUMERIC_FACT remains non-numeric', () => {
    expect(calculate({ state: 'INVALID_NUMERIC_FACT' })).toEqual({
      state: 'INVALID_NUMERIC_FACT',
    });
  });

  it('T5: SEMANTICS_UNPROVEN remains non-numeric', () => {
    expect(calculate({ state: 'SEMANTICS_UNPROVEN' })).toEqual({
      state: 'SEMANTICS_UNPROVEN',
    });
  });

  it('T6: INCOMPLETE quantity is never mislabeled as official progress', () => {
    const result = calculate(incomplete('4'));

    expect(result.state).toBe('INCOMPLETE');

    if (result.state !== 'INCOMPLETE') {
      throw new Error('Expected INCOMPLETE');
    }

    expect(result.knownProgressSubtotalPercent?.toString()).toBe('50');
  });

  it('T7: INCOMPLETE quantity keeps its upstream state when denominator is unusable', () => {
    expect(calculate(incomplete('4'), '0', 'm3')).toEqual({
      state: 'INCOMPLETE',
    });
  });

  it('T8: INCOMPLETE quantity keeps its upstream state when unit context is unavailable', () => {
    expect(calculate(incomplete('4'), '8', '   ')).toEqual({
      state: 'INCOMPLETE',
    });
  });

  it('T9: COMPLETE zero with valid denominator produces true numeric zero', () => {
    const result = calculate(complete('0'));

    expect(result.state).toBe('COMPLETE');

    if (result.state !== 'COMPLETE') {
      throw new Error('Expected COMPLETE');
    }

    expect(result.rawPhysicalProgressPercent.toString()).toBe('0');
    expect(result.boundedContributionProgressPercent.toString()).toBe('0');
  });

  it('T10: COMPLETE 4 / planned 8 produces raw 50 and bounded 50', () => {
    const result = calculate(complete('4'), '8', 'm3');

    expect(result.state).toBe('COMPLETE');

    if (result.state !== 'COMPLETE') {
      throw new Error('Expected COMPLETE');
    }

    expect(result.rawPhysicalProgressPercent.toString()).toBe('50');
    expect(result.boundedContributionProgressPercent.toString()).toBe('50');
  });

  it('T11: raw progress may exceed 100 while bounded contribution is capped at 100', () => {
    const result = calculate(complete('12'), '8', 'm3');

    expect(result.state).toBe('COMPLETE');

    if (result.state !== 'COMPLETE') {
      throw new Error('Expected COMPLETE');
    }

    expect(result.rawPhysicalProgressPercent.toString()).toBe('150');
    expect(result.boundedContributionProgressPercent.toString()).toBe('100');
  });

  it('T12: zero planned quantity performs no official division', () => {
    expect(calculate(complete('4'), '0', 'm3')).toEqual({
      state: 'UNAVAILABLE',
      reason: 'PLANNED_QUANTITY_ZERO',
    });
  });

  it('T13: unavailable planned quantity fails closed', () => {
    expect(calculate(complete('4'), null, 'm3')).toEqual({
      state: 'UNAVAILABLE',
      reason: 'PLANNED_QUANTITY_UNAVAILABLE',
    });
  });

  it.each(['-1', 'NaN', 'Infinity', '-Infinity', 'not-a-decimal'])(
    'T14: invalid planned quantity %s fails closed',
    (plannedQuantity) => {
      expect(calculate(complete('4'), plannedQuantity, 'm3')).toEqual({
        state: 'UNAVAILABLE',
        reason: 'PLANNED_QUANTITY_INVALID',
      });
    },
  );

  it.each(['', '   ', '\t'])(
    'T15: blank same-WORK_ITEM unit context %p blocks official numeric progress',
    (plannedUnit) => {
      expect(calculate(complete('4'), '8', plannedUnit)).toEqual({
        state: 'UNAVAILABLE',
        reason: 'SAME_WORK_ITEM_UNIT_CONTEXT_UNAVAILABLE',
      });
    },
  );

  it('T16: no unit conversion is required for a nonblank contextual WORK_ITEM unit', () => {
    const result = calculate(complete('4'), '8', 'existing-contextual-unit');

    expect(result.state).toBe('COMPLETE');

    if (result.state !== 'COMPLETE') {
      throw new Error('Expected COMPLETE');
    }

    expect(result.rawPhysicalProgressPercent.toString()).toBe('50');
  });

  it('T17: Decimal arithmetic remains exact without JavaScript Number accumulation', () => {
    const result = calculate(complete('0.1'), new Prisma.Decimal('0.2'), 'm3');

    expect(result.state).toBe('COMPLETE');

    if (result.state !== 'COMPLETE') {
      throw new Error('Expected COMPLETE');
    }

    expect(result.rawPhysicalProgressPercent.toString()).toBe('50');
    expect(result.boundedContributionProgressPercent.toString()).toBe('50');
  });

  it('T18: downstream denominator failure does not mutate or erase upstream COMPLETE quantity', () => {
    const upstream = complete('4');

    const before =
      upstream.state === 'COMPLETE'
        ? upstream.currentOfficialQuantity.toString()
        : null;

    const result = calculate(upstream, '0', 'm3');

    expect(result).toEqual({
      state: 'UNAVAILABLE',
      reason: 'PLANNED_QUANTITY_ZERO',
    });

    expect(upstream.state).toBe('COMPLETE');

    if (upstream.state !== 'COMPLETE') {
      throw new Error('Expected upstream COMPLETE');
    }

    expect(upstream.currentOfficialQuantity.toString()).toBe(before);
  });

  it('T19: policy does not mutate its input object', () => {
    const input = Object.freeze({
      currentOfficialQuantity: complete('4'),
      plannedQuantity: new Prisma.Decimal('8'),
      plannedUnit: 'm3',
    });

    const plannedBefore = input.plannedQuantity.toString();

    calculateWorkItemCurrentPhysicalProgress(input);

    expect(input.plannedQuantity.toString()).toBe(plannedBefore);
    expect(input.plannedUnit).toBe('m3');
    expect(input.currentOfficialQuantity.state).toBe('COMPLETE');
  });

  it('T20: identical inputs produce deterministic results', () => {
    const input: WorkItemCurrentPhysicalProgressInput = {
      currentOfficialQuantity: complete('12'),
      plannedQuantity: new Prisma.Decimal('8'),
      plannedUnit: 'm3',
    };

    const first = calculateWorkItemCurrentPhysicalProgress(input);

    const second = calculateWorkItemCurrentPhysicalProgress(input);

    expect(first.state).toBe('COMPLETE');
    expect(second.state).toBe('COMPLETE');

    if (first.state !== 'COMPLETE' || second.state !== 'COMPLETE') {
      throw new Error('Expected COMPLETE');
    }

    expect(first.rawPhysicalProgressPercent.toString()).toBe(
      second.rawPhysicalProgressPercent.toString(),
    );

    expect(first.boundedContributionProgressPercent.toString()).toBe(
      second.boundedContributionProgressPercent.toString(),
    );
  });
});
