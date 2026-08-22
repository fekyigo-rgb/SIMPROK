import { Prisma } from '@prisma/client';
import {
  MONITORING_WEIGHT_REASON,
  projectMonitoringWeights,
  type MonitoringWeightSourceRow,
} from './monitoring-weight';

const work = (
  id: string,
  lineTotal: string | null,
  sortOrder: number,
  parentId: string | null = null,
): MonitoringWeightSourceRow => ({
  id,
  parentId,
  itemType: 'WORK_ITEM',
  sortOrder,
  lineTotal: lineTotal === null ? null : new Prisma.Decimal(lineTotal),
});

const folder = (
  id: string,
  sortOrder: number,
  parentId: string | null = null,
): MonitoringWeightSourceRow => ({
  id,
  parentId,
  itemType: 'FOLDER',
  sortOrder,
  lineTotal: null,
});

describe('H2-A1 canonical Monitoring weight projection', () => {
  it('A: derives 60/30/10 and exact 100 cumulative from canonical money', () => {
    const result = projectMonitoringWeights(
      [work('a', '600', 0), work('b', '300', 1), work('c', '100', 2)],
      new Prisma.Decimal('1000'),
    );

    expect(result.project).toMatchObject({
      completeness: 'COMPLETE',
      reason: null,
      denominator: { state: 'AVAILABLE', value: '1000.00' },
      eligibleWorkItemCount: 3,
      weightedWorkItemCount: 3,
      unavailableWorkItemCount: 0,
    });
    expect(result.rows.get('a')?.own.percentage).toBe('60');
    expect(result.rows.get('b')?.own.percentage).toBe('30');
    expect(result.rows.get('c')?.own.percentage).toBe('10');
    expect(result.rows.get('a')?.cumulative.percentage).toBe('60');
    expect(result.rows.get('b')?.cumulative.percentage).toBe('90');
    expect(result.rows.get('c')?.cumulative.percentage).toBe('100');
  });

  it('B: an authoritative zero item is weight zero, not unavailable', () => {
    const result = projectMonitoringWeights(
      [work('a', '600', 0), work('b', '400', 1), work('zero', '0', 2)],
      new Prisma.Decimal('1000'),
    );

    expect(result.project.completeness).toBe('COMPLETE');
    expect(result.rows.get('zero')?.own).toEqual({
      state: 'AVAILABLE',
      percentage: '0',
      reason: null,
    });
    expect(result.rows.get('zero')?.cumulative.percentage).toBe('100');
  });

  it('C: missing item money stays unavailable and known rows are never renormalized', () => {
    const result = projectMonitoringWeights(
      [work('a', '600', 0), work('missing', null, 1), work('c', '100', 2)],
      new Prisma.Decimal('1000'),
    );

    expect(result.project).toMatchObject({
      completeness: 'INCOMPLETE',
      reason: MONITORING_WEIGHT_REASON.INCOMPLETE_BASELINE_VALUE_COVERAGE,
      eligibleWorkItemCount: 3,
      weightedWorkItemCount: 2,
      unavailableWorkItemCount: 1,
    });
    expect(result.rows.get('a')?.own.percentage).toBe('60');
    expect(result.rows.get('c')?.own.percentage).toBe('10');
    expect(result.rows.get('missing')?.own.reason).toBe(
      MONITORING_WEIGHT_REASON.ITEM_VALUE_UNAVAILABLE,
    );
    expect(result.rows.get('c')?.cumulative).toMatchObject({
      state: 'UNAVAILABLE',
      reason: MONITORING_WEIGHT_REASON.INCOMPLETE_BASELINE_VALUE_COVERAGE,
    });
  });

  it('D: a zero denominator performs no division and fabricates no percentage', () => {
    const result = projectMonitoringWeights(
      [work('a', '0', 0)],
      new Prisma.Decimal('0'),
    );

    expect(result.project).toMatchObject({
      completeness: 'UNAVAILABLE',
      reason: MONITORING_WEIGHT_REASON.ZERO_BASELINE_DENOMINATOR,
      denominator: { state: 'UNAVAILABLE', value: null },
      weightedWorkItemCount: 0,
      unavailableWorkItemCount: 1,
    });
    expect(result.rows.get('a')?.own).toMatchObject({
      state: 'UNAVAILABLE',
      percentage: null,
    });
  });

  it('E: a folder aggregates descendants without creating denominator money', () => {
    const result = projectMonitoringWeights(
      [
        folder('section', 0),
        work('a', '200', 0, 'section'),
        work('b', '300', 1, 'section'),
        work('c', '500', 1),
      ],
      new Prisma.Decimal('1000'),
    );

    expect(result.rows.get('section')?.own.state).toBe('NOT_APPLICABLE');
    expect(result.rows.get('section')?.subtree.percentage).toBe('50');
    expect(result.rows.get('section')?.cumulative.percentage).toBe('50');
    expect(result.project.completeness).toBe('COMPLETE');
  });

  it('F/G: nested folders aggregate once and cumulative follows canonical depth-first order', () => {
    const result = projectMonitoringWeights(
      [
        work('c', '500', 1),
        folder('root', 0),
        folder('nested', 0, 'root'),
        work('a', '200', 0, 'nested'),
        work('b', '300', 1, 'root'),
      ],
      new Prisma.Decimal('1000'),
    );

    expect(result.rows.get('nested')?.subtree.percentage).toBe('20');
    expect(result.rows.get('root')?.subtree.percentage).toBe('50');
    expect(result.rows.get('a')?.cumulative.percentage).toBe('20');
    expect(result.rows.get('b')?.cumulative.percentage).toBe('50');
    expect(result.rows.get('c')?.cumulative.percentage).toBe('100');
  });

  it('H: repeating display ratios never drive cumulative arithmetic', () => {
    const result = projectMonitoringWeights(
      [work('a', '1', 0), work('b', '1', 1), work('c', '1', 2)],
      new Prisma.Decimal('3'),
    );

    expect(result.rows.get('a')?.own.percentage).toBe('33.333333333333333333');
    expect(result.rows.get('b')?.cumulative.percentage).toBe(
      '66.666666666666666667',
    );
    // Derived from exact cumulative value 3 / denominator 3, not from three
    // already-rounded 33.33 display values.
    expect(result.rows.get('c')?.cumulative.percentage).toBe('100');
  });

  it('keeps a very small legitimate weight in fixed-point wire notation', () => {
    const result = projectMonitoringWeights(
      [work('small', '0.01', 0)],
      new Prisma.Decimal('9999999999999999.99'),
    );

    expect(result.rows.get('small')?.own).toEqual({
      state: 'AVAILABLE',
      percentage: '0.0000000000000001',
      reason: null,
    });
  });

  it('reports denominator/item-sum mismatch as incomplete instead of forcing 100', () => {
    const result = projectMonitoringWeights(
      [work('a', '600', 0), work('b', '300', 1)],
      new Prisma.Decimal('1000'),
    );

    expect(result.project.completeness).toBe('INCOMPLETE');
    expect(result.project.reason).toBe(
      MONITORING_WEIGHT_REASON.INCOMPLETE_BASELINE_VALUE_COVERAGE,
    );
    expect(result.rows.get('b')?.cumulative.percentage).toBe('90');
  });
});
