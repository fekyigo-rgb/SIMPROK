import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BasicPriceEligibilityPolicy } from '../basic-price/basic-price-eligibility.policy';
import { UnitKernelService } from '../unit-kernel/unit-kernel.service';
import { RabLifecyclePolicyService } from '../project/rab-lifecycle-policy.service';
import { ResourceIdentityResolutionService } from '../resource-catalog/resource-identity-resolution.service';
import { AhspResourceResolutionOrchestrator } from './ahsp-resource-resolution.orchestrator';
import { BoqUnitCompatibilityService } from '../unit-kernel/boq-unit-compatibility.service';
import { ProjectAhspService } from './project-ahsp.service';

describe('RAB-AUTO-04 — SOURCE FACT IS RECHECKED IN THE CANONICAL WRITER TRANSACTION', () => {
  const projectId = '10000000-0000-4000-8000-000000000001';
  const workspaceId = '20000000-0000-4000-8000-000000000001';
  const accountId = '30000000-0000-4000-8000-000000000001';
  const boqItemId = '40000000-0000-4000-8000-000000000001';
  const sourceId = '50000000-0000-4000-8000-000000000001';
  const versionId = '60000000-0000-4000-8000-000000000001';
  const regionId = '70000000-0000-4000-8000-000000000001';
  const input = {
    projectId,
    workspaceId,
    accountId,
    boqItemId,
    ahspVersionId: versionId,
    businessPricingAsOfDate: '2026-10-29',
    referenceRegionId: regionId,
    idempotencyKey: 'rab-auto-04-validation-fixture',
    reuseSourceBoqItemId: sourceId,
  };
  const sameSource = {
    itemType: 'WORK_ITEM',
    wbsNodeId: '80000000-0000-4000-8000-000000000001',
    wbsCode: '2.1',
    name: 'Saluran U Pracetak Tipe DS 10A 140 x 140 cm dengan tutup',
    unit: 'm',
  };
  const row = (patch: Record<string, unknown> = {}) => ({
    ...sameSource,
    id: boqItemId,
    ahspVersionId: null,
    workingOccurrenceId: null,
    calculationOccurrenceId: null,
    priceOrigin: null,
    ...patch,
  });
  const occurrence = (patch: Record<string, unknown> = {}) => ({
    id: 'a0000000-0000-4000-8000-000000000001',
    projectId,
    workspaceId,
    ahspVersionId: versionId,
    referenceRegionId: regionId,
    businessPricingAsOfDate: new Date('2026-10-29T00:00:00.000Z'),
    createdByAccountId: accountId,
    idempotencyKey: 'manual-governed-selection',
    ...patch,
  });
  const oldDecision = (patch: Record<string, unknown> = {}) => ({
    ...sameSource,
    id: sourceId,
    ahspVersionId: versionId,
    priceOrigin: null,
    workingOccurrence: occurrence(),
    calculationOccurrence: null,
    ...patch,
  });
  let tx: {
    $queryRaw: jest.Mock;
    projectAhspOccurrence: { findFirst: jest.Mock };
    boqStructure: { findFirst: jest.Mock };
    boqItem: { findFirst: jest.Mock };
    projectRegionSelection: { findFirst: jest.Mock };
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
          id: 'b0000000-0000-4000-8000-000000000001',
          projectId,
          name: 'Working Draft',
          status: 'DRAFT',
        }),
      },
      boqItem: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(row())
          .mockResolvedValueOnce(oldDecision()),
      },
      projectRegionSelection: {
        findFirst: jest.fn().mockResolvedValue({ id: 'selected-region' }),
      },
      region: { findFirst: jest.fn().mockResolvedValue(null) },
      aHSPVersion: { findFirst: jest.fn() },
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementation((fn: (tx: unknown) => unknown) =>
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

  it('refuses a changed source specification and never touches price region', async () => {
    tx.boqItem.findFirst
      .mockReset()
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce(
        oldDecision({ name: sameSource.name.replace('10A', '10B') }),
      );
    await expect(service.selectForBoqItem(input)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.region.findFirst).not.toHaveBeenCalled();
  });

  it('refuses an already-priced target at transaction time (TOCTOU protection)', async () => {
    tx.boqItem.findFirst
      .mockReset()
      .mockResolvedValueOnce(row({ priceOrigin: 'SERVER_COST_KERNEL' }));
    await expect(service.selectForBoqItem(input)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.boqItem.findFirst).toHaveBeenCalledTimes(1);
    expect(tx.region.findFirst).not.toHaveBeenCalled();
  });

  it('refuses price region not selected by project at transaction time', async () => {
    tx.projectRegionSelection.findFirst.mockResolvedValue(null);
    await expect(service.selectForBoqItem(input)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.region.findFirst).not.toHaveBeenCalled();
  });

  it('refuses a source with auto-derived idempotency (no evidence recursion)', async () => {
    tx.boqItem.findFirst
      .mockReset()
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce(
        oldDecision({
          workingOccurrence: occurrence({
            idempotencyKey: 'rab-auto-04-chain',
          }),
        }),
      );
    await expect(service.selectForBoqItem(input)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.region.findFirst).not.toHaveBeenCalled();
  });

  it('passes source proof, then still invokes existing region eligibility gate', async () => {
    await expect(service.selectForBoqItem(input)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.projectRegionSelection.findFirst).toHaveBeenCalled();
    expect(tx.region.findFirst).toHaveBeenCalledWith({
      where: { id: regionId, isActive: true },
    });
    expect(tx.aHSPVersion.findFirst).not.toHaveBeenCalled();
  });
});
