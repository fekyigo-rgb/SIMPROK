import { Prisma } from '@prisma/client';
import {
  MONITORING_WEIGHT_BASIS,
  MONITORING_WEIGHT_REASON,
  type MonitoringProjectWeight,
  type MonitoringWeightFact,
} from './monitoring-weight';
import type { WorkItemCurrentPhysicalProgressResult } from './progress-current-physical-progress.policy';
import {
  calculateCurrentOfficialRabWeightedPhysicalProgress,
  type CurrentRabWeightedPhysicalProgressInput,
  type CurrentRabWeightedPhysicalProgressWorkItemInput,
} from './progress-current-rab-weighted-physical-progress.policy';

const projectWeight = (
  completeness: MonitoringProjectWeight['completeness'] = 'COMPLETE',
): MonitoringProjectWeight => ({
  basis: MONITORING_WEIGHT_BASIS,
  completeness,
  reason:
    completeness === 'COMPLETE'
      ? null
      : completeness === 'INCOMPLETE'
        ? MONITORING_WEIGHT_REASON.INCOMPLETE_BASELINE_VALUE_COVERAGE
        : MONITORING_WEIGHT_REASON.BASELINE_VALUE_UNAVAILABLE,
  denominator:
    completeness === 'UNAVAILABLE'
      ? { state: 'UNAVAILABLE', value: null }
      : { state: 'AVAILABLE', value: '100.00' },
  eligibleWorkItemCount: 0,
  weightedWorkItemCount: 0,
  unavailableWorkItemCount: 0,
});

const availableWeight = (percentage: string): MonitoringWeightFact => ({
  state: 'AVAILABLE',
  percentage,
  reason: null,
});

const unavailableWeight = (): MonitoringWeightFact => ({
  state: 'UNAVAILABLE',
  percentage: null,
  reason: MONITORING_WEIGHT_REASON.ITEM_VALUE_UNAVAILABLE,
});

const completeProgress = (
  bounded: string,
  raw: string = bounded,
): WorkItemCurrentPhysicalProgressResult => ({
  state: 'COMPLETE',
  rawPhysicalProgressPercent: new Prisma.Decimal(raw),
  boundedContributionProgressPercent: new Prisma.Decimal(bounded),
});

const workItem = (
  boqItemId: string,
  weight: MonitoringWeightFact,
  progress: WorkItemCurrentPhysicalProgressResult,
): CurrentRabWeightedPhysicalProgressWorkItemInput => ({
  boqItemId,
  rabWeight: weight,
  currentOfficialItemProgress: progress,
});

const calculate = (
  workItems: readonly CurrentRabWeightedPhysicalProgressWorkItemInput[],
  weight: MonitoringProjectWeight = projectWeight(),
) =>
  calculateCurrentOfficialRabWeightedPhysicalProgress({
    projectWeight: weight,
    workItems,
  });

const expectComplete = (
  result: ReturnType<
    typeof calculateCurrentOfficialRabWeightedPhysicalProgress
  >,
  expected: string,
) => {
  expect(result.state).toBe('COMPLETE');

  if (result.state !== 'COMPLETE') {
    throw new Error('Expected COMPLETE');
  }

  expect(
    result.currentOfficialRabWeightedPhysicalProgressPercent.toString(),
  ).toBe(expected);
};

const expectIncomplete = (
  result: ReturnType<
    typeof calculateCurrentOfficialRabWeightedPhysicalProgress
  >,
  expectedSubtotal: string,
) => {
  expect(result.state).toBe('INCOMPLETE');

  if (result.state !== 'INCOMPLETE') {
    throw new Error('Expected INCOMPLETE');
  }

  expect(result.knownWeightedContributionSubtotalPercent.toString()).toBe(
    expectedSubtotal,
  );
};

describe('MON-04 LAW 3: Current Official RAB-Weighted Physical Progress', () => {
  it('CASE A: weight 20 and bounded progress 50 contribute 10 percentage points', () => {
    expectComplete(
      calculate([
        workItem('item-a', availableWeight('20'), completeProgress('50')),
      ]),
      '10',
    );
  });

  it('CASE B: a 100% complete item contributes its full 20% weight', () => {
    expectComplete(
      calculate([
        workItem('item-b', availableWeight('20'), completeProgress('100')),
      ]),
      '20',
    );
  });

  it('CASE C: consumes LAW2 bounded 100 while preserving raw over-progress 150', () => {
    const law2 = completeProgress('100', '150');

    expectComplete(
      calculate([workItem('item-c', availableWeight('20'), law2)]),
      '20',
    );

    expect(law2.state).toBe('COMPLETE');
    if (law2.state !== 'COMPLETE') throw new Error('Expected COMPLETE');
    expect(law2.rawPhysicalProgressPercent.toString()).toBe('150');
    expect(law2.boundedContributionProgressPercent.toString()).toBe('100');
  });

  it('CASE D: proven zero progress on positive weight contributes numeric zero', () => {
    expectComplete(
      calculate([
        workItem('item-d', availableWeight('20'), completeProgress('0')),
      ]),
      '0',
    );
  });

  it('CASE E: NOT_YET_RECORDED on positive weight remains non-numeric and incomplete', () => {
    expectIncomplete(
      calculate([
        workItem('item-e', availableWeight('20'), {
          state: 'NOT_YET_RECORDED',
        }),
      ]),
      '0',
    );
  });

  it('CASE F: an incomplete positive-weight item leaves safe contributions diagnostic only', () => {
    expectIncomplete(
      calculate([
        workItem('item-f-safe', availableWeight('20'), completeProgress('50')),
        workItem('item-f-open', availableWeight('80'), { state: 'INCOMPLETE' }),
      ]),
      '10',
    );
  });

  it('CASE G: exact AVAILABLE zero weight exempts unresolved physical truth without erasing it', () => {
    const unresolved: WorkItemCurrentPhysicalProgressResult = {
      state: 'INVALID_NUMERIC_FACT',
    };

    expectComplete(
      calculate([
        workItem('item-g-zero', availableWeight('0'), unresolved),
        workItem(
          'item-g-positive',
          availableWeight('100'),
          completeProgress('50'),
        ),
      ]),
      '50',
    );

    expect(unresolved).toEqual({ state: 'INVALID_NUMERIC_FACT' });
  });

  it('CASE H: unavailable weight never receives the zero-weight exemption', () => {
    expectIncomplete(
      calculate(
        [
          workItem(
            'item-h-safe',
            availableWeight('70'),
            completeProgress('60'),
          ),
          workItem('item-h-open', unavailableWeight(), completeProgress('100')),
        ],
        projectWeight('INCOMPLETE'),
      ),
      '42',
    );
  });

  it('CASE I: unavailable global H2-A1 basis yields no official project percentage', () => {
    expect(
      calculate(
        [workItem('item-i', unavailableWeight(), completeProgress('50'))],
        projectWeight('UNAVAILABLE'),
      ),
    ).toEqual({
      state: 'UNAVAILABLE',
      reason: MONITORING_WEIGHT_REASON.BASELINE_VALUE_UNAVAILABLE,
    });
  });

  it('CASE J: incomplete H2-A1 coverage keeps the known subtotal diagnostic only', () => {
    expectIncomplete(
      calculate(
        [
          workItem(
            'item-j-safe',
            availableWeight('60'),
            completeProgress('50'),
          ),
          workItem('item-j-open', unavailableWeight(), completeProgress('100')),
        ],
        projectWeight('INCOMPLETE'),
      ),
      '30',
    );
  });

  it('CASE K: invalid numeric physical truth contributes nothing while safe items continue', () => {
    expectIncomplete(
      calculate([
        workItem('item-k-safe', availableWeight('25'), completeProgress('40')),
        workItem('item-k-invalid', availableWeight('75'), {
          state: 'INVALID_NUMERIC_FACT',
        }),
      ]),
      '10',
    );
  });

  it('CASE L: two WORK_ITEM contributions sum to 75%, not an average', () => {
    expectComplete(
      calculate([
        workItem('item-l-a', availableWeight('50'), completeProgress('100')),
        workItem('item-l-b', availableWeight('50'), completeProgress('50')),
      ]),
      '75',
    );
  });

  it('CASE M: downstream incompleteness preserves the upstream LAW2 result and input', () => {
    const law2 = completeProgress('50');
    const input: CurrentRabWeightedPhysicalProgressInput = Object.freeze({
      projectWeight: projectWeight('INCOMPLETE'),
      workItems: Object.freeze([
        Object.freeze(workItem('item-m', availableWeight('100'), law2)),
      ]),
    });

    expectIncomplete(
      calculateCurrentOfficialRabWeightedPhysicalProgress(input),
      '50',
    );

    expect(law2.state).toBe('COMPLETE');
    if (law2.state !== 'COMPLETE') throw new Error('Expected COMPLETE');
    expect(law2.rawPhysicalProgressPercent.toString()).toBe('50');
    expect(law2.boundedContributionProgressPercent.toString()).toBe('50');
  });

  it('CASE N: known 42 percentage points are not renormalized over 70% known weight', () => {
    expectIncomplete(
      calculate([
        workItem('item-n-known', availableWeight('70'), completeProgress('60')),
        workItem('item-n-open', availableWeight('30'), {
          state: 'NOT_YET_RECORDED',
        }),
      ]),
      '42',
    );
  });

  it('CASE P: long non-integer Decimal inputs retain the exact unrounded result', () => {
    expectComplete(
      calculate([
        workItem(
          'item-p',
          availableWeight('33.333333333333333333'),
          completeProgress('12.34567890123456789'),
        ),
      ]),
      '4.11522630041152263',
    );
  });
});
