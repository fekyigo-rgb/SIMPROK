import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { PERMISSIONS } from '../common/constants/permissions';
import { PERMISSIONS_ALL_KEY } from '../common/decorators/permissions.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectAhspService } from './project-ahsp.service';
import { RabAutoReadinessService } from './rab-auto-readiness.service';
import { RabAutoReadinessController } from './rab-auto-readiness.controller';

describe('RAB-AUTO-02 canonical orchestration readiness — no new matcher or DB write', () => {
  const input = {
    workspaceId: '20000000-0000-4000-8000-000000000001',
    projectId: '10000000-0000-4000-8000-000000000001',
    boqItemId: '30000000-0000-4000-8000-000000000001',
    businessPricingAsOfDate: '2026-10-29',
  };
  let prisma: { boqItem: { findFirst: jest.Mock; findMany: jest.Mock } };
  let ahsp: { searchEligibleVersions: jest.Mock; selectForBoqItem: jest.Mock };
  let service: RabAutoReadinessService;

  const boq = (extra: Record<string, unknown> = {}) => ({
    id: input.boqItemId,
    name: 'Saluran U Pracetak Tipe DS 10A (140 cm x 140 cm dengan tutup)',
    unit: 'm',
    ahspVersionId: null,
    workingOccurrenceId: null,
    ...extra,
  });
  const candidate = (id: string, recommended = false) => ({
    id,
    outputUnit: 'm',
    ahsp: {
      code: 'B.64',
      workType: 'Pekerjaan Drainase',
      methodName: 'Saluran U Pracetak Tipe DS 10A (140 cm x 140 cm dengan tutup)',
    },
    preference: { recommended },
  });

  beforeEach(() => {
    prisma = {
      boqItem: {
        findFirst: jest.fn().mockResolvedValue(boq()),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    ahsp = {
      searchEligibleVersions: jest.fn().mockResolvedValue({
        items: [candidate('B64-v1', true)],
        page: 1,
        limit: 50,
        hasNext: false,
        query: '',
      }),
      selectForBoqItem: jest.fn(),
    };
    service = new RabAutoReadinessService(
      prisma as unknown as PrismaService,
      ahsp as unknown as ProjectAhspService,
    );
  });

  it('uses exact guarded project/workspace WORK_ITEM and full eligible unfiltered projection', async () => {
    const result = await service.assess(input);
    expect(result.kind).toBe('CANDIDATE_REQUIRES_IDENTITY_PROOF');
    expect(result.mutationPerformed).toBe(false);
    expect(result.priceStatus).toBe('UNPRICED');
    expect(result.recommendedCount).toBe(1);
    expect(result.candidatePreview).toEqual({
      ahspVersionId: 'B64-v1',
      code: 'B.64',
      workType: 'Pekerjaan Drainase',
      methodName: 'Saluran U Pracetak Tipe DS 10A (140 cm x 140 cm dengan tutup)',
      outputUnit: 'm',
      bindingAuthorized: false,
    });
    expect(result.requiredBeforeAutomaticBind).toContain(
      'AUTHORIZED_PRICE_REGION',
    );
    const calls = prisma.boqItem.findFirst.mock
      .calls as unknown as ReadonlyArray<readonly [unknown]>;
    const queried: unknown = calls[0]?.[0];
    expect(queried).toMatchObject({
      where: {
        id: input.boqItemId,
        itemType: 'WORK_ITEM',
        boqStructure: {
          projectId: input.projectId,
          project: { workspaceId: input.workspaceId },
        },
      },
    });
    expect(ahsp.searchEligibleVersions).toHaveBeenCalledWith(
      input.workspaceId,
      input.businessPricingAsOfDate,
      { projectId: input.projectId, boqItemId: input.boqItemId },
      { q: '', page: '1', limit: '50' },
    );
    expect(ahsp.selectForBoqItem).not.toHaveBeenCalled();
  });

  it('preserves an already-persisted version and occurrence without re-ranking', async () => {
    prisma.boqItem.findFirst.mockResolvedValue(
      boq({
        ahspVersionId: 'existing-version',
        workingOccurrenceId: 'existing-occurrence',
      }),
    );
    const result = await service.assess(input);
    expect(result).toMatchObject({
      kind: 'ALREADY_LINKED',
      ahspVersionId: 'existing-version',
      occurrenceId: 'existing-occurrence',
      mutationPerformed: false,
    });
    expect(ahsp.searchEligibleVersions).not.toHaveBeenCalled();
  });

  it('never silently repairs an incomplete canonical relationship', async () => {
    prisma.boqItem.findFirst.mockResolvedValue(
      boq({ ahspVersionId: 'dangling-version' }),
    );
    const result = await service.assess(input);
    expect(result.kind).toBe('INCOMPLETE_LINK_REQUIRES_REVIEW');
    expect(ahsp.searchEligibleVersions).not.toHaveBeenCalled();
  });

  it('recognizes lawful stored price as persisted, not a broken working occurrence', async () => {
    prisma.boqItem.findFirst.mockResolvedValue(
      boq({
        ahspVersionId: 'source-version',
        workingOccurrenceId: null,
        priceOrigin: 'SERVER_COST_KERNEL',
        calculationOccurrenceId: 'calculation-occurrence',
        unitPrice: '100',
        lineTotal: '150',
      }),
    );
    const result = await service.assess(input);
    expect(result.kind).toBe('PERSISTED_CALCULATION_REPROOF_REQUIRED');
    expect(result.mutationPerformed).toBe(false);
    expect(ahsp.searchEligibleVersions).not.toHaveBeenCalled();
    expect(ahsp.selectForBoqItem).not.toHaveBeenCalled();
  });

  it('never overwrites manual pricing or mistakes damaged frozen money for proof', async () => {
    prisma.boqItem.findFirst.mockResolvedValue(
      boq({
        priceOrigin: 'MANUAL_CLIENT',
        unitPrice: '500',
      }),
    );
    expect((await service.assess(input)).kind).toBe('MANUAL_PRICE_PRESERVED');
    prisma.boqItem.findFirst.mockResolvedValue(
      boq({
        ahspVersionId: 'source-version',
        workingOccurrenceId: null,
        priceOrigin: 'SERVER_COST_KERNEL',
        calculationOccurrenceId: null,
        unitPrice: null,
        lineTotal: null,
      }),
    );
    expect((await service.assess(input)).kind).toBe(
      'INCONSISTENT_PERSISTENCE_REQUIRES_REVIEW',
    );
    expect(ahsp.searchEligibleVersions).not.toHaveBeenCalled();
  });

  it('fails closed for foreign or nonexistent BOQ', async () => {
    prisma.boqItem.findFirst.mockResolvedValue(null);
    await expect(service.assess(input)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(ahsp.searchEligibleVersions).not.toHaveBeenCalled();
  });

  it('distinguishes no eligible AHSP from zero recommendations', async () => {
    ahsp.searchEligibleVersions.mockResolvedValueOnce({
      items: [],
      hasNext: false,
      page: 1,
      limit: 50,
      query: '',
    });
    expect((await service.assess(input)).kind).toBe('NO_ELIGIBLE_AHSP');
    ahsp.searchEligibleVersions.mockResolvedValueOnce({
      items: [candidate('B64-v1', false)],
      hasNext: false,
      page: 1,
      limit: 50,
      query: '',
    });
    const unproven = await service.assess(input);
    expect(unproven.kind).toBe('NO_PROVEN_MATCH');
    expect(unproven.candidatePreview).toBeNull();
  });

  it('does not auto-approve ambiguous or paginated candidate sets', async () => {
    ahsp.searchEligibleVersions.mockResolvedValueOnce({
      items: [candidate('a', true), candidate('b', true)],
      hasNext: false,
      page: 1,
      limit: 50,
      query: '',
    });
    expect((await service.assess(input)).kind).toBe('MULTIPLE_RECOMMENDATIONS');
    ahsp.searchEligibleVersions.mockResolvedValueOnce({
      items: [candidate('a', true)],
      hasNext: true,
      page: 1,
      limit: 50,
      query: '',
    });
    const truncated = await service.assess(input);
    expect(truncated.kind).toBe('CANDIDATE_UNIVERSE_INCOMPLETE');
    expect(truncated.candidatePreview).toBeNull();
    expect(ahsp.selectForBoqItem).not.toHaveBeenCalled();
  });

  it('read-only controller has existing authentication, project and AHSP_VIEW guards', async () => {
    const controller = new RabAutoReadinessController(service);
    const output = await controller.assess(
      {
        projectAccess: { workspaceId: input.workspaceId },
      },
      input.projectId,
      input.boqItemId,
      input.businessPricingAsOfDate,
    );
    expect(output.kind).toBe('CANDIDATE_REQUIRES_IDENTITY_PROOF');
    const descriptor = Object.getOwnPropertyDescriptor(
      RabAutoReadinessController.prototype,
      'assess',
    );
    const method: object = (descriptor?.value as object | undefined) ?? {};
    expect(Reflect.getMetadata(PERMISSIONS_ALL_KEY, method)).toEqual([
      PERMISSIONS.AHSP_VIEW,
      PERMISSIONS.RAB_VIEW,
    ]);
  });
});
