import { BadRequestException } from '@nestjs/common';
import { ProgressController } from './progress.controller';
import type { ProgressService } from './progress.service';

describe('ProgressController Monitoring temporal lens contract', () => {
  const getMonitoring = jest.fn();
  const controller = new ProgressController({
    getMonitoring,
  } as unknown as ProgressService);

  beforeEach(() => {
    getMonitoring.mockReset();
    getMonitoring.mockResolvedValue({ project: { id: 'project-1' } });
  });

  it('preserves the existing Monitoring call when Temporal Lens is absent', async () => {
    await controller.getMonitoring('project-1', {});

    expect(getMonitoring).toHaveBeenCalledWith(
      'project-1',
      undefined,
      false,
      false,
      undefined,
      undefined,
    );
  });

  it('preserves the existing Monitoring call when Temporal Lens is explicitly false', async () => {
    await controller.getMonitoring('project-1', {
      includeTemporalLens: 'false',
    });

    expect(getMonitoring).toHaveBeenCalledWith(
      'project-1',
      undefined,
      false,
      false,
      undefined,
      undefined,
    );
  });

  it('passes one validated canonical Temporal Lens context to Monitoring', async () => {
    await controller.getMonitoring('project-1', {
      includeTemporalLens: 'true',
      temporalBasis: 'WORK_PERIOD',
      temporalGranularity: 'MONTH',
      temporalReferenceDate: '2026-07-20',
    });

    expect(getMonitoring).toHaveBeenCalledWith(
      'project-1',
      undefined,
      false,
      false,
      undefined,
      {
        basis: 'WORK_PERIOD',
        granularity: 'MONTH',
        referenceDate: '2026-07-20',
      },
    );
  });

  it.each([
    [
      'partial fields without opt-in',
      { temporalBasis: 'CALENDAR' },
      'TEMPORAL_LENS_FIELDS_REQUIRE_OPT_IN',
    ],
    [
      'missing required field',
      {
        includeTemporalLens: 'true',
        temporalBasis: 'CALENDAR',
        temporalGranularity: 'WEEK',
      },
      'TEMPORAL_LENS_REQUIRES_BASIS_GRANULARITY_REFERENCE',
    ],
    [
      'invalid runtime enum',
      {
        includeTemporalLens: 'true',
        temporalBasis: 'calendar',
        temporalGranularity: 'WEEK',
        temporalReferenceDate: '2026-09-17',
      },
      'INVALID_TEMPORAL_BASIS',
    ],
    [
      'ambiguous bracket input',
      {
        includeTemporalLens: 'true',
        temporalBasis: 'CALENDAR',
        temporalGranularity: 'WEEK',
        temporalReferenceDate: '2026-09-17',
        'temporalBasis[value]': 'WORK_PERIOD',
      },
      'AMBIGUOUS_TEMPORAL_LENS',
    ],
    [
      'explicit Period Window conflict',
      {
        includeTemporalLens: 'true',
        temporalBasis: 'CALENDAR',
        temporalGranularity: 'WEEK',
        temporalReferenceDate: '2026-09-17',
        includePeriodWindow: 'true',
        periodStartDate: '2026-09-14',
        periodEndDate: '2026-09-20',
      },
      'TEMPORAL_LENS_EXPLICIT_PERIOD_WINDOW_CONFLICT',
    ],
    [
      'independent cutoff conflict',
      {
        includeTemporalLens: 'true',
        temporalBasis: 'CALENDAR',
        temporalGranularity: 'WEEK',
        temporalReferenceDate: '2026-09-17',
        cutoffDate: '2026-09-17',
      },
      'TEMPORAL_LENS_CUTOFF_CONTEXT_CONFLICT',
    ],
  ])('rejects %s before calling Monitoring', async (_label, query, reason) => {
    await expect(controller.getMonitoring('project-1', query)).rejects.toEqual(
      new BadRequestException(reason),
    );
    expect(getMonitoring).not.toHaveBeenCalled();
  });
});
