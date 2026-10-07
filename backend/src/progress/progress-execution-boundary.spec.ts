import { ProgressService } from './progress.service';

describe('SR-01 Monitoring execution boundary regression', () => {
  const projectId = '10000000-0000-4000-8000-000000000001';
  const baselineId = '10000000-0000-4000-8000-000000000002';

  const service = () =>
    new ProgressService({} as any, {} as any, {} as any) as any;

  it('reports execution-not-started when Actual is blocked by PLANNED plus LOCKED', async () => {
    const candidate = service();
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: 'locked-plan-1' }])
        .mockResolvedValueOnce([{ status: 'PLANNED' }]),
    };

    await expect(
      candidate.requireLockedExecutionPlanForWrite(tx, projectId, baselineId),
    ).resolves.toBeUndefined();
    await expect(
      candidate.requireExecutionProjectActive(tx, projectId),
    ).rejects.toMatchObject({ message: 'PROJECT_EXECUTION_NOT_STARTED' });
  });

  it('keeps ACTIVE plus exactly one same-baseline LOCKED plan eligible at the existing boundary', async () => {
    const candidate = service();
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ status: 'ACTIVE' }])
        .mockResolvedValueOnce([{ id: 'locked-plan-1' }]),
    };

    await expect(
      candidate.requireExecutionProjectActive(tx, projectId),
    ).resolves.toBeUndefined();
    await expect(
      candidate.requireLockedExecutionPlanForWrite(tx, projectId, baselineId),
    ).resolves.toBeUndefined();
  });

  it('keeps missing or ambiguous locked-plan truth distinct after ACTIVE', async () => {
    const candidate = service();
    for (const rows of [[], [{ id: 'plan-1' }, { id: 'plan-2' }]]) {
      const tx = {
        $queryRaw: jest
          .fn()
          .mockResolvedValueOnce([{ status: 'ACTIVE' }])
          .mockResolvedValueOnce(rows),
      };
      await expect(
        candidate.requireExecutionProjectActive(tx, projectId),
      ).resolves.toBeUndefined();
      await expect(
        candidate.requireLockedExecutionPlanForWrite(tx, projectId, baselineId),
      ).rejects.toMatchObject({ message: 'EXECUTION_PLAN_NOT_LOCKED' });
    }
  });
});
