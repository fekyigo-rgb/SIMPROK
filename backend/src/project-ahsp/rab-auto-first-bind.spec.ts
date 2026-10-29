import 'reflect-metadata';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectAhspService } from './project-ahsp.service';
import { explicitAhspSourceProof } from './rab-auto-first-source-reference';
import { RabAutoFirstBindService } from './rab-auto-first-bind.service';
import { RabAutoFirstBindController } from './rab-auto-first-bind.controller';
import { PERMISSIONS } from '../common/constants/permissions';
import { PERMISSIONS_ALL_KEY } from '../common/decorators/permissions.decorator';

describe('RAB-AUTO-05 ΓÇö explicit approved first AHSP source reference', () => {
  const input = {
    workspaceId: '20000000-0000-4000-8000-000000000001',
    projectId: '10000000-0000-4000-8000-000000000001',
    accountId: '30000000-0000-4000-8000-000000000001',
    businessPricingAsOfDate: '2026-10-29',
  };
  const line = (extra: Record<string, unknown> = {}) => ({
    id: '40000000-0000-4000-8000-000000000001',
    sourceAhspCode: 'B.64',
    name: 'Saluran U Pracetak Tipe DS 10A (140 cm x 140 cm dengan tutup)',
    updatedAt: new Date('2026-10-28T11:00:00Z'),
    ahspVersionId: null,
    workingOccurrenceId: null,
    calculationOccurrenceId: null,
    priceOrigin: null,
    ...extra,
  });
  const candidate = (extra: Record<string, unknown> = {}) => ({
    id: '50000000-0000-4000-8000-000000000001',
    ahsp: {
      code: 'B.64',
      workType: 'Saluran U Pracetak',
      methodName:
        'Saluran U Pracetak Tipe DS 10A (140 cm x 140 cm dengan tutup)',
    },
    preference: { recommended: true },
    ...extra,
  });
  let prisma: {
    boqStructure: { findMany: jest.Mock };
    boqBusinessUseEvent: { findFirst: jest.Mock };
    projectRegionSelection: { findMany: jest.Mock };
    boqItem: { findMany: jest.Mock };
  };
  let ahsp: { searchEligibleVersions: jest.Mock; selectForBoqItem: jest.Mock };
  let service: RabAutoFirstBindService;
  beforeEach(() => {
    prisma = {
      boqStructure: {
        findMany: jest.fn().mockResolvedValue([{ id: 'structure' }]),
      },
      boqBusinessUseEvent: {
        findFirst: jest.fn().mockResolvedValue({
          usedAt: new Date('2026-10-28T12:00:00Z'),
        }),
      },
      projectRegionSelection: {
        findMany: jest.fn().mockResolvedValue([
          {
            regionId: '60000000-0000-4000-8000-000000000001',
          },
        ]),
      },
      boqItem: { findMany: jest.fn().mockResolvedValue([line()]) },
    };
    ahsp = {
      searchEligibleVersions: jest.fn().mockResolvedValue({
        items: [candidate()],
        hasNext: false,
      }),
      selectForBoqItem: jest.fn().mockResolvedValue({ id: 'persisted' }),
    };
    service = new RabAutoFirstBindService(
      prisma as unknown as PrismaService,
      ahsp as unknown as ProjectAhspService,
    );
  });

  it('exact provenance code AND complete specification text are required', () => {
    const b = line();
    const c = candidate().ahsp;
    expect(explicitAhspSourceProof(b, c)).toBe(true);
    expect(explicitAhspSourceProof({ ...b, sourceAhspCode: null }, c)).toBe(
      false,
    );
    expect(explicitAhspSourceProof(b, { ...c, code: 'B.63' })).toBe(false);
    expect(
      explicitAhspSourceProof({ ...b, name: b.name.replace('10A', '10B') }, c),
    ).toBe(false);
    expect(
      explicitAhspSourceProof({ ...b, name: b.name.replace('140', '160') }, c),
    ).toBe(false);
  });

  it('uses canonical AHSP eligibility/search and official select writer only on strict proof', async () => {
    const result = await service.execute(input);
    expect(result.summary).toEqual({ FIRST_ASSOCIATION_PROVEN_AND_LINKED: 1 });
    expect(ahsp.searchEligibleVersions).toHaveBeenCalledWith(
      input.workspaceId,
      input.businessPricingAsOfDate,
      { projectId: input.projectId, boqItemId: line().id },
      { q: 'B.64', page: '1', limit: '50' },
    );
    const calls = ahsp.selectForBoqItem.mock.calls as unknown as ReadonlyArray<
      readonly [Record<string, unknown>]
    >;
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toMatchObject({
      ...input,
      boqItemId: line().id,
      firstSourceAhspCode: 'B.64',
      ahspVersionId: candidate().id,
      referenceRegionId: '60000000-0000-4000-8000-000000000001',
    });
    expect(String(calls[0]?.[0].idempotencyKey)).toMatch(
      /^rab-auto-05-[0-9a-f]{64}$/,
    );
    expect(result.rabApproved).toBe(false);
  });

  it('does not treat an ordinary BOQ row as an AHSP reference', async () => {
    prisma.boqItem.findMany.mockResolvedValue([line({ sourceAhspCode: null })]);
    expect((await service.execute(input)).summary).toEqual({
      EXPLICIT_SOURCE_REFERENCE_MISSING: 1,
    });
    expect(ahsp.searchEligibleVersions).not.toHaveBeenCalled();
  });

  it('does not select a region when project settings contain multiple regions', async () => {
    prisma.projectRegionSelection.findMany.mockResolvedValue([
      { regionId: 'city' },
      { regionId: 'district' },
    ]);
    expect((await service.execute(input)).summary).toEqual({
      PRICE_REGION_NOT_UNIQUE: 1,
    });
    expect(ahsp.selectForBoqItem).not.toHaveBeenCalled();
  });

  it('rejects stale/unapproved source, unproven category, and nonexact descriptions', async () => {
    prisma.boqBusinessUseEvent.findFirst.mockResolvedValue(null);
    expect((await service.execute(input)).summary).toEqual({
      SOURCE_APPROVAL_NOT_CURRENT: 1,
    });
    prisma.boqBusinessUseEvent.findFirst.mockResolvedValue({
      usedAt: new Date('2026-10-28T12:00:00Z'),
    });
    ahsp.searchEligibleVersions.mockResolvedValue({
      items: [candidate({ preference: { recommended: false } })],
      hasNext: false,
    });
    expect((await service.execute(input)).summary).toEqual({
      CLASSIFICATION_OR_UNIT_NOT_PROVEN: 1,
    });
    ahsp.searchEligibleVersions.mockResolvedValue({
      items: [candidate({ ahsp: { ...candidate().ahsp, methodName: '10B' } })],
      hasNext: false,
    });
    expect((await service.execute(input)).summary).toEqual({
      REFERENCE_NOT_PROVEN: 1,
    });
    expect(ahsp.selectForBoqItem).not.toHaveBeenCalled();
  });

  it('preserves an already priced BOQ and refuses incomplete or ambiguous catalog', async () => {
    prisma.boqItem.findMany.mockResolvedValue([
      line({ priceOrigin: 'MANUAL_CLIENT' }),
    ]);
    expect((await service.execute(input)).summary).toEqual({
      ALREADY_DECIDED: 1,
    });
    prisma.boqItem.findMany.mockResolvedValue([line()]);
    ahsp.searchEligibleVersions.mockResolvedValue({
      items: [candidate()],
      hasNext: true,
    });
    expect((await service.execute(input)).summary).toEqual({
      CANDIDATE_UNIVERSE_INCOMPLETE: 1,
    });
    expect(ahsp.selectForBoqItem).not.toHaveBeenCalled();
  });

  it('never reports success after the transaction writer refuses', async () => {
    ahsp.selectForBoqItem.mockRejectedValue(new Error('SOURCE_CHANGED'));
    expect((await service.execute(input)).summary).toEqual({
      BIND_REVALIDATION_REQUIRED: 1,
    });
    expect((await service.execute(input)).automaticBindingPerformed).toBe(
      false,
    );
  });

  it('is behind both RAB_DRAFT_EDIT and AHSP_VIEW permissions', () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      RabAutoFirstBindController.prototype,
      'execute',
    );
    const method = (descriptor?.value as object | undefined) ?? {};
    expect(Reflect.getMetadata(PERMISSIONS_ALL_KEY, method)).toEqual([
      PERMISSIONS.AHSP_VIEW,
      PERMISSIONS.RAB_DRAFT_EDIT,
    ]);
  });
});
