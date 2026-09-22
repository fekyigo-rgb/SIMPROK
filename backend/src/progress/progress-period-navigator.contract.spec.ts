import { BadRequestException } from '@nestjs/common';
import { ProgressController } from './progress.controller';
import type { ProgressService } from './progress.service';

/**
 * PERIOD NAVIGATOR — request contract at the existing Monitoring route.
 *
 * The navigator is opt-in and adds no route of its own. The first case here is
 * the important one: with the navigator absent, Monitoring must be called with
 * exactly the arguments it was always called with — no trailing placeholder.
 */
describe('ProgressController Period Navigator contract', () => {
  const getMonitoring = jest.fn();
  const controller = new ProgressController({
    getMonitoring,
  } as unknown as ProgressService);

  beforeEach(() => {
    getMonitoring.mockReset();
    getMonitoring.mockResolvedValue({ projectId: 'project-1' });
  });

  it('adds no argument at all when the navigator is absent', async () => {
    await controller.getMonitoring('project-1', {});

    const call = getMonitoring.mock.calls[0] as unknown[];
    expect(call).toHaveLength(6);
  });

  it('adds no argument when the navigator is explicitly false', async () => {
    await controller.getMonitoring('project-1', {
      includePeriodNavigator: 'false',
    });

    const call = getMonitoring.mock.calls[0] as unknown[];
    expect(call).toHaveLength(6);
  });

  it.each([
    ['WEEK', 'WORK_PERIOD'],
    ['WEEK', 'CALENDAR'],
    ['MONTH', 'WORK_PERIOD'],
    ['MONTH', 'CALENDAR'],
  ])('passes one validated %s / %s navigator context to Monitoring', async (granularity, basis) => {
    await controller.getMonitoring('project-1', {
      includePeriodNavigator: 'true',
      periodNavigatorGranularity: granularity,
      periodNavigatorBasis: basis,
    });

    expect(getMonitoring).toHaveBeenCalledWith(
      'project-1',
      undefined,
      false,
      false,
      undefined,
      undefined,
      { basis, granularity },
    );
  });

  it('passes a server-issued cursor through verbatim', async () => {
    await controller.getMonitoring('project-1', {
      includePeriodNavigator: 'true',
      periodNavigatorGranularity: 'WEEK',
      periodNavigatorBasis: 'WORK_PERIOD',
      periodNavigatorCursor: '2026-08-07',
    });

    expect(getMonitoring).toHaveBeenCalledWith(
      'project-1',
      undefined,
      false,
      false,
      undefined,
      undefined,
      { basis: 'WORK_PERIOD', granularity: 'WEEK', cursor: '2026-08-07' },
    );
  });

  it('accepts the navigator alongside an existing Temporal Lens request', async () => {
    await controller.getMonitoring('project-1', {
      includeTemporalLens: 'true',
      temporalBasis: 'WORK_PERIOD',
      temporalGranularity: 'WEEK',
      temporalReferenceDate: '2026-08-18',
      includePeriodNavigator: 'true',
      periodNavigatorGranularity: 'WEEK',
      periodNavigatorBasis: 'CALENDAR',
    });

    expect(getMonitoring).toHaveBeenCalledWith(
      'project-1',
      undefined,
      false,
      false,
      undefined,
      {
        basis: 'WORK_PERIOD',
        granularity: 'WEEK',
        referenceDate: '2026-08-18',
      },
      { basis: 'CALENDAR', granularity: 'WEEK' },
    );
  });

  it.each([
    [
      'granularity without opt-in',
      { periodNavigatorGranularity: 'WEEK' },
      'PERIOD_NAVIGATOR_FIELDS_REQUIRE_OPT_IN',
    ],
    [
      'opt-in without granularity',
      { includePeriodNavigator: 'true' },
      'PERIOD_NAVIGATOR_REQUIRES_GRANULARITY',
    ],
    [
      'opt-in without basis',
      {
        includePeriodNavigator: 'true',
        periodNavigatorGranularity: 'WEEK',
      },
      'PERIOD_NAVIGATOR_REQUIRES_BASIS',
    ],
    [
      'basis outside the canonical vocabulary',
      {
        includePeriodNavigator: 'true',
        periodNavigatorGranularity: 'WEEK',
        periodNavigatorBasis: 'calendar',
      },
      'INVALID_PERIOD_NAVIGATOR_BASIS',
    ],
    [
      'malformed cursor',
      {
        includePeriodNavigator: 'true',
        periodNavigatorGranularity: 'WEEK',
        periodNavigatorBasis: 'WORK_PERIOD',
        periodNavigatorCursor: '20260807',
      },
      'INVALID_PERIOD_NAVIGATOR_CURSOR',
    ],
    [
      'granularity outside the canonical vocabulary',
      {
        includePeriodNavigator: 'true',
        periodNavigatorGranularity: 'DAY',
      },
      'INVALID_PERIOD_NAVIGATOR_GRANULARITY',
    ],
    [
      'malformed opt-in value',
      { includePeriodNavigator: 'yes' },
      'INVALID_INCLUDE_PERIOD_NAVIGATOR',
    ],
    [
      'ambiguous bracket input',
      {
        includePeriodNavigator: 'true',
        periodNavigatorGranularity: 'WEEK',
        periodNavigatorBasis: 'WORK_PERIOD',
        'periodNavigatorGranularity[value]': 'MONTH',
      },
      'AMBIGUOUS_PERIOD_NAVIGATOR',
    ],
  ])('rejects %s before calling Monitoring', async (_label, query, reason) => {
    await expect(controller.getMonitoring('project-1', query)).rejects.toEqual(
      new BadRequestException(reason),
    );
    expect(getMonitoring).not.toHaveBeenCalled();
  });
});
