import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectAhspService } from './project-ahsp.service';
import { RabAutoReadinessService } from './rab-auto-readiness.service';
import { RabAutoReadinessController } from './rab-auto-readiness.controller';
import { PERMISSIONS } from '../common/constants/permissions';
import { PERMISSIONS_ALL_KEY } from '../common/decorators/permissions.decorator';

describe('RAB-AUTO-02 project-wide read-only readiness', () => {
  const context = {
    workspaceId: '20000000-0000-4000-8000-000000000001',
    projectId: '10000000-0000-4000-8000-000000000001',
    businessPricingAsOfDate: '2026-10-29',
  };
  let prisma: { boqItem: { findMany: jest.Mock; findFirst: jest.Mock } };
  let ahsp: { searchEligibleVersions: jest.Mock };
  let service: RabAutoReadinessService;
  beforeEach(() => {
    prisma = {
      boqItem: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest
          .fn()
          .mockImplementation((query: { where: { id: string } }) =>
            Promise.resolve({
              id: query.where.id,
              name: 'Pekerjaan Pembersihan',
              unit: 'Ls',
              ahspVersionId: null,
              workingOccurrenceId: null,
            }),
          ),
      },
    };
    ahsp = {
      searchEligibleVersions: jest.fn().mockResolvedValue({
        items: [],
        hasNext: false,
        page: 1,
        limit: 50,
        query: '',
      }),
    };
    service = new RabAutoReadinessService(
      prisma as unknown as PrismaService,
      ahsp as unknown as ProjectAhspService,
    );
  });

  it('checks only first 2 of 3 safely, preserving page evidence and no write', async () => {
    prisma.boqItem.findMany.mockResolvedValue([
      { id: 'A' },
      { id: 'B' },
      { id: 'C' },
    ]);
    const result = await service.assessDraft({
      ...context,
      page: '1',
      limit: '2',
    });
    expect(result).toMatchObject({
      rowsChecked: 2,
      hasNext: true,
      page: 1,
      limit: 2,
      mutationPerformed: false,
      automaticBindingPerformed: false,
      summary: { NO_ELIGIBLE_AHSP: 2 },
    });
    expect(result.results).toHaveLength(2);
    expect(result.results.map((v) => v.boqItemId)).toEqual(['A', 'B']);
    const callArgs = prisma.boqItem.findMany.mock.calls as unknown as Array<
      readonly [
        {
          where: {
            boqStructure: {
              projectId: string;
              project: { workspaceId: string };
            };
          };
          take: number;
          skip: number;
        },
      ]
    >;
    expect(callArgs[0]?.[0]).toMatchObject({
      where: {
        boqStructure: {
          projectId: context.projectId,
          project: { workspaceId: context.workspaceId },
        },
      },
      take: 3,
      skip: 0,
    });
  });

  it('isolates one failed line, does not discard two successful lines or invent zero', async () => {
    prisma.boqItem.findMany.mockResolvedValue([
      { id: 'A' },
      { id: 'B' },
      { id: 'C' },
    ]);
    prisma.boqItem.findFirst.mockImplementation(
      (query: { where: { id: string } }) => {
        if (query.where.id === 'B')
          return Promise.reject(new Error('upstream down'));
        return Promise.resolve({
          id: query.where.id,
          name: 'Pekerjaan Pembersihan',
          unit: 'Ls',
          ahspVersionId: null,
          workingOccurrenceId: null,
        });
      },
    );
    const result = await service.assessDraft({ ...context, limit: '3' });
    expect(result.summary).toMatchObject({
      NO_ELIGIBLE_AHSP: 2,
      READINESS_UNAVAILABLE_REQUIRES_REVIEW: 1,
    });
    expect(result.results[1].kind).toBe(
      'READINESS_UNAVAILABLE_REQUIRES_REVIEW',
    );
    expect(result.automaticBindingPerformed).toBe(false);
  });

  it('rejects unbounded or malformed pages before querying', async () => {
    for (const example of [
      { page: '0' },
      { page: 'NaN' },
      { page: '1.2' },
      { limit: '26' },
      { limit: '-1' },
      { limit: 'Infinity' },
    ]) {
      await expect(
        service.assessDraft({ ...context, ...example }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(prisma.boqItem.findMany).not.toHaveBeenCalled();
  });

  it('keeps the batch route behind existing AHSP_VIEW permission', async () => {
    const controller = new RabAutoReadinessController(service);
    const output = await controller.assessDraft(
      { projectAccess: { workspaceId: context.workspaceId } },
      context.projectId,
      context.businessPricingAsOfDate,
      '1',
      '2',
    );
    expect(output.results).toEqual([]);
    const descriptor = Object.getOwnPropertyDescriptor(
      RabAutoReadinessController.prototype,
      'assessDraft',
    );
    const method = (descriptor?.value as object | undefined) ?? {};
    expect(Reflect.getMetadata(PERMISSIONS_ALL_KEY, method)).toEqual([
      PERMISSIONS.AHSP_VIEW,
      PERMISSIONS.RAB_VIEW,
    ]);
  });
});
