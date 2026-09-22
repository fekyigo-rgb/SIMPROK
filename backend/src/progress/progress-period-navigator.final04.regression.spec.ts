import { ProjectStatus } from '@prisma/client';
import { ProgressService } from './progress.service';
import { resolveEarliestGovernedActualWorkDate } from './progress-period-navigator.policy';

describe('MON04 FINAL-04 exact regression closure', () => {
  describe('D1 — canonical Actual workDate integrity', () => {
    it('fails closed instead of silently normalizing a non-midnight governed workDate', () => {
      const governed = {
        state: 'COMPLETE',
        eligibleCurrentFacts: [
          {
            entry: {
              workDate: new Date('2026-08-05T13:30:00.000Z'),
            },
            quantity: null,
          },
        ],
      };

      expect(resolveEarliestGovernedActualWorkDate([governed] as any)).toEqual({
        state: 'UNAVAILABLE',
        reason: 'ACTUAL_WORK_DATE_MISSING',
      });
    });

    it('still accepts the same business date at exact midnight UTC', () => {
      const governed = {
        state: 'COMPLETE',
        eligibleCurrentFacts: [
          {
            entry: {
              workDate: new Date('2026-08-05T00:00:00.000Z'),
            },
            quantity: null,
          },
        ],
      };

      expect(resolveEarliestGovernedActualWorkDate([governed] as any)).toEqual({
        state: 'RESOLVED',
        workDate: '2026-08-05',
      });
    });
  });

  describe('D3 — lifecycle reason precedes missing Active Baseline', () => {
    const projectId = '00000000-0000-4000-8000-000000000001';

    const navigator = {
      basis: 'CALENDAR',
      granularity: 'WEEK',
    } as const;

    const serviceFor = (status: ProjectStatus | null) => {
      const db = {
        project: {
          findUnique: jest.fn().mockResolvedValue(
            status === null
              ? null
              : {
                  status,
                  timeZone: 'Asia/Jakarta',
                  startDate: null,
                },
          ),
        },
        projectBaseline: {
          findMany: jest.fn().mockResolvedValue([]),
        },
      };

      const prisma = {
        $transaction: jest.fn(
          async (callback: (client: typeof db) => unknown) => callback(db),
        ),
      };

      const service = new ProgressService(prisma as any, {} as any, {} as any);

      return {
        service,
        db,
      };
    };

    const reasonFor = async (
      status: ProjectStatus | null,
    ): Promise<string | undefined> => {
      const { service } = serviceFor(status);

      const response = (await service.getMonitoring(
        projectId,
        undefined,
        false,
        false,
        undefined,
        undefined,
        navigator as any,
      )) as any;

      return response.periodNavigator?.reason;
    };

    it.each([
      [ProjectStatus.PLANNED, 'REPORTING_NOT_STARTED_FOR_PLANNED_PROJECT'],
      [ProjectStatus.ACTIVE, 'NO_ACTIVE_BASELINE_CONTEXT'],
      [ProjectStatus.ON_HOLD, 'NO_ACTIVE_BASELINE_CONTEXT'],
      [ProjectStatus.COMPLETED, 'TERMINAL_PROJECT_BUSINESS_DATE_NOT_AVAILABLE'],
      [ProjectStatus.CANCELLED, 'TERMINAL_PROJECT_BUSINESS_DATE_NOT_AVAILABLE'],
      [
        ProjectStatus.ARCHIVED,
        'ARCHIVED_PROJECT_TERMINAL_SEMANTICS_NOT_RATIFIED',
      ],
    ])('%s + no Active Baseline -> %s', async (status, expectedReason) => {
      await expect(reasonFor(status)).resolves.toBe(expectedReason);
    });

    it('project not found keeps PROJECT_NOT_FOUND ahead of Baseline context', async () => {
      await expect(reasonFor(null)).resolves.toBe('PROJECT_NOT_FOUND');
    });
  });
});
