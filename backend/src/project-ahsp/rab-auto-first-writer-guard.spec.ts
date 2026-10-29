import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BasicPriceEligibilityPolicy } from '../basic-price/basic-price-eligibility.policy';
import { UnitKernelService } from '../unit-kernel/unit-kernel.service';
import { RabLifecyclePolicyService } from '../project/rab-lifecycle-policy.service';
import { ResourceIdentityResolutionService } from '../resource-catalog/resource-identity-resolution.service';
import { AhspResourceResolutionOrchestrator } from './ahsp-resource-resolution.orchestrator';
import { BoqUnitCompatibilityService } from '../unit-kernel/boq-unit-compatibility.service';
import { ProjectAhspService } from './project-ahsp.service';

describe('RAB-AUTO-05 ΓÇö source assertion revalidated within original AHSP writer', () => {
  const projectId = '10000000-0000-4000-8000-000000000001';
  const workspaceId = '20000000-0000-4000-8000-000000000001';
  const boqItemId = '30000000-0000-4000-8000-000000000001';
  const ahspVersionId = '40000000-0000-4000-8000-000000000001';
  const referenceRegionId = '50000000-0000-4000-8000-000000000001';
  const name = 'Saluran U Pracetak Tipe DS 10A (140 cm x 140 cm dengan tutup)';
  const input = {
    projectId,
    workspaceId,
    boqItemId,
    ahspVersionId,
    referenceRegionId,
    accountId: '60000000-0000-4000-8000-000000000001',
    businessPricingAsOfDate: '2026-10-29',
    idempotencyKey: 'rab-auto-05-protected-fixture',
    firstSourceAhspCode: 'B.64',
  };
  let tx: {
    $queryRaw: jest.Mock;
    projectAhspOccurrence: { findFirst: jest.Mock };
    boqStructure: { findFirst: jest.Mock };
    boqItem: { findFirst: jest.Mock };
    boqBusinessUseEvent: { findFirst: jest.Mock };
    projectRegionSelection: { findMany: jest.Mock };
    region: { findFirst: jest.Mock };
    aHSPVersion: { findFirst: jest.Mock };
  };
  let service: ProjectAhspService;
  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: projectId,
          workspaceId,
          status: 'PLANNED',
        },
      ]),
      projectAhspOccurrence: { findFirst: jest.fn().mockResolvedValue(null) },
      boqStructure: {
        findFirst: jest.fn().mockResolvedValue({
          id: '70000000-0000-4000-8000-000000000001',
          projectId,
          name: 'Working Draft',
          status: 'DRAFT',
        }),
      },
      boqItem: {
        findFirst: jest.fn().mockResolvedValue({
          id: boqItemId,
          itemType: 'WORK_ITEM',
          name,
          unit: 'm',
          sourceAhspCode: 'B.64',
          updatedAt: new Date('2026-10-28T11:00:00Z'),
          ahspVersionId: null,
          workingOccurrenceId: null,
          calculationOccurrenceId: null,
          priceOrigin: null,
        }),
      },
      boqBusinessUseEvent: {
        findFirst: jest.fn().mockResolvedValue({
          usedAt: new Date('2026-10-28T12:00:00Z'),
        }),
      },
      projectRegionSelection: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ regionId: referenceRegionId }]),
      },
      region: { findFirst: jest.fn().mockResolvedValue(null) },
      aHSPVersion: { findFirst: jest.fn() },
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementation((fn: (transaction: unknown) => unknown) =>
          Promise.resolve(fn(tx)),
        ),
    };
    const lifecycle = {
      evaluateInTransaction: jest.fn().mockResolvedValue({
        canEditDraft: true,
        reasonCode: null,
      }),
    };
    service = new ProjectAhspService(
      prisma as unknown as PrismaService,
      {} as BasicPriceEligibilityPolicy,
      {} as UnitKernelService,
      lifecycle as unknown as RabLifecyclePolicyService,
      {} as ResourceIdentityResolutionService,
      {} as AhspResourceResolutionOrchestrator,
      {} as BoqUnitCompatibilityService,
    );
  });

  it('refuses source AHSP code changed after early analysis', async () => {
    tx.boqItem.findFirst.mockResolvedValue({
      id: boqItemId,
      itemType: 'WORK_ITEM',
      name,
      unit: 'm',
      sourceAhspCode: 'B.63',
      updatedAt: new Date('2026-10-28T11:00:00Z'),
      ahspVersionId: null,
      workingOccurrenceId: null,
      calculationOccurrenceId: null,
      priceOrigin: null,
    });
    await expect(service.selectForBoqItem(input)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.region.findFirst).not.toHaveBeenCalled();
  });

  it('refuses stale BOQ source approval and existing target prices', async () => {
    tx.boqBusinessUseEvent.findFirst.mockResolvedValue(null);
    await expect(service.selectForBoqItem(input)).rejects.toBeInstanceOf(
      ConflictException,
    );
    tx.boqItem.findFirst.mockResolvedValue({
      id: boqItemId,
      itemType: 'WORK_ITEM',
      name,
      unit: 'm',
      sourceAhspCode: 'B.64',
      updatedAt: new Date('2026-10-28T11:00:00Z'),
      ahspVersionId: null,
      workingOccurrenceId: null,
      calculationOccurrenceId: null,
      priceOrigin: 'MANUAL_CLIENT',
    });
    await expect(service.selectForBoqItem(input)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refuses region ambiguity discovered inside transaction', async () => {
    tx.projectRegionSelection.findMany.mockResolvedValue([
      { regionId: referenceRegionId },
      { regionId: 'other' },
    ]);
    await expect(service.selectForBoqItem(input)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.region.findFirst).not.toHaveBeenCalled();
  });

  it('does not skip the original active-region gate after source proof', async () => {
    await expect(service.selectForBoqItem(input)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.region.findFirst).toHaveBeenCalled();
    expect(tx.aHSPVersion.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a formula whose canonical AHSP code or complete label conflicts with BOQ', async () => {
    tx.region.findFirst.mockResolvedValue({
      id: referenceRegionId,
      isActive: true,
    });
    tx.aHSPVersion.findFirst.mockResolvedValue({
      id: ahspVersionId,
      ahspId: 'parent',
      versionNumber: 1,
      resources: [{ id: 'resource' }],
      outputUnit: 'm',
      ahsp: { code: 'B.63', workType: 'Saluran U Pracetak', methodName: name },
    });
    await expect(service.selectForBoqItem(input)).rejects.toBeInstanceOf(
      ConflictException,
    );
    tx.aHSPVersion.findFirst.mockResolvedValue({
      id: ahspVersionId,
      ahspId: 'parent',
      versionNumber: 1,
      resources: [{ id: 'resource' }],
      outputUnit: 'm',
      ahsp: {
        code: 'B.64',
        workType: 'Saluran U Pracetak',
        methodName: name.replace('10A', '10B'),
      },
    });
    await expect(service.selectForBoqItem(input)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
