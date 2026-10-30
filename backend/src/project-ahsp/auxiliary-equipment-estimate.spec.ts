import { Prisma } from '@prisma/client';
import { AhspResourceResolutionOrchestrator } from './ahsp-resource-resolution.orchestrator';
import { approvedAuxiliaryPolicyIsGoverned } from './auxiliary-equipment-estimate.policy';
import { calculateCostKernel } from '../project/cost-kernel.kernel';
import { frozenKernelAdaptedPrice } from '../project/cost-kernel-resolution-price';

const asOf = new Date('2026-10-30T00:00:00.000Z');
const approvedAt = new Date('2026-10-01T00:00:00.000Z');

const catalog = (id: string, name: string, type = 'EQUIPMENT', baseUnit = 'LS') => ({
  id, code: id, name, type, baseUnit, status: 'ACTIVE', specifications: null,
});
const auxCatalog = catalog('catalog-aux', 'Alat Bantu');
const materialCatalog = catalog('catalog-material', 'Semen', 'MATERIAL', 'kg');

const governedPolicy = (version = 1, percent = '2.500000') => ({
  id: `policy-${version}`,
  workspaceId: 'workspace-1',
  ahspVersionId: 'version-1',
  version,
  decision: 'APPROVED',
  percent: new Prisma.Decimal(percent),
  evidenceReference: 'EVIDENCE-ABLS-SYNTHETIC',
  approvalReference: 'OWNER-APPROVAL-SYNTHETIC',
  approvedByAccountId: 'account-1',
  approvedByPositionId: 'position-1',
  approvedByPositionAssignmentId: 'assignment-1',
  approvedByPositionAuthorityId: 'position-authority-1',
  approvalAuthorityCode: 'AHSP_AUXILIARY_EQUIPMENT_ESTIMATE_APPROVE',
  approvedAt,
  effectiveFrom: new Date('2026-10-01T00:00:00.000Z'),
  effectiveUntil: null,
  approvedByPosition: { id: 'position-1', workspaceId: 'workspace-1' },
  approvedByPositionAssignment: {
    id: 'assignment-1', positionId: 'position-1', assignedAt: new Date('2026-01-01'),
    removedAt: null, user: { workspaceId: 'workspace-1', membership: { accountId: 'account-1', workspaceId: 'workspace-1' } },
  },
  approvedByPositionAuthority: {
    id: 'position-authority-1', positionId: 'position-1', assignedAt: new Date('2026-01-01'),
    revokedAt: null, authority: { code: 'AHSP_AUXILIARY_EQUIPMENT_ESTIMATE_APPROVE' },
  },
});

const resource = (
  id: string,
  name: string,
  type: string,
  coefficient = '1',
  baseUnit = type === 'MATERIAL' ? 'kg' : 'LS',
) => ({ id, resourceId: name, resourceType: type, coefficient, baseUnit });

function makeHarness(options: {
  policy?: any | null;
  auxPrice?: string | null;
  materialPrice?: string | null;
  catalogs?: any[];
} = {}) {
  const catalogs = options.catalogs ?? [auxCatalog, materialCatalog];
  const prices = [
    options.materialPrice === null ? null : {
      id: 'price-material', resourceId: materialCatalog.id,
      value: new Prisma.Decimal(options.materialPrice ?? '100.00'),
      sourceOrigin: 'FIELD_REPORTED', freshnessStatus: 'CURRENT', effectiveDate: asOf,
      resource: { baseUnit: 'kg' },
    },
    options.auxPrice == null ? null : {
      id: 'price-aux', resourceId: auxCatalog.id, value: new Prisma.Decimal(options.auxPrice),
      sourceOrigin: 'FIELD_REPORTED', freshnessStatus: 'CURRENT', effectiveDate: asOf,
      resource: { baseUnit: 'LS' },
    },
  ].filter(Boolean) as any[];
  const identity = {
    loadEvidence: async () => ({ catalogCandidates: catalogs, sourceSightings: [], reviewedMappings: [] }),
    resolve: async (evidence: any, input: any) => {
      const found = evidence.catalogCandidates.find((row: any) =>
        row.name.toLowerCase() === input.rawName.toLowerCase() && row.type === input.resourceType);
      return found
        ? { status: 'RESOLVED', authority: 'EXACT_CANONICAL_MATCH', resolvedResourceCatalogId: found.id,
            reasonCodes: ['EXACT_CANONICAL_MATCH'], explanation: 'Identitas terbukti.' }
        : { status: 'UNRESOLVED', authority: null, resolvedResourceCatalogId: null,
            reasonCodes: ['RESOURCE_NOT_FOUND'], explanation: 'Identitas tidak terbukti.' };
    },
  };
  const units = {
    resolve: async (source: string, target: string) => source === target
      ? { status: 'RESOLVED', targetUnitDefinition: { id: `unit-${target}`, code: target },
          sourceUnitDefinition: { id: `unit-${source}`, code: source }, quantityFactor: '1',
          priceOperation: 'IDENTITY', rawSourceUnit: source, rawTargetUnit: target }
      : { status: 'NEEDS_REVIEW' },
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    basicPrice: {
      findMany: jest.fn().mockResolvedValue(prices),
      findFirst: jest.fn(async ({ where }: any) => prices.find((row) => row.id === where.id) ?? null),
    },
    auxiliaryEquipmentEstimatePolicy: {
      findFirst: jest.fn().mockResolvedValue(options.policy === undefined ? governedPolicy() : options.policy),
    },
  };
  const orchestrator = new AhspResourceResolutionOrchestrator(
    { usableWhere: () => ({}) } as any, units as any, identity as any,
  );
  return { tx, orchestrator };
}

async function run(resources: any[], options: Parameters<typeof makeHarness>[0] = {}) {
  const { tx, orchestrator } = makeHarness(options);
  return orchestrator.resolveVersionResources(tx, {
    workspaceId: 'workspace-1', projectId: 'project-1', referenceRegionId: 'region-1', asOf,
    version: { id: 'version-1', resources, ahsp: { workType: 'J.75', methodName: 'Synthetic proof' } },
  });
}

describe('ABLS-01 governed Alat Bantu LS temporary estimate', () => {
  const normal = [resource('aux', 'Alat Bantu', 'EQUIPMENT'), resource('material', 'Semen', 'MATERIAL', '2')];

  it('fails closed instead of falling back to the scale-2 snapshot when exact metadata is missing', () => {
    expect(frozenKernelAdaptedPrice({
      priceMode: 'TEMPORARY_ESTIMATE',
      adaptedPriceValue: new Prisma.Decimal('7.25'),
      selectedBasicPriceId: null,
      sourcePriceValue: null,
    })).toBeNull();
    expect(frozenKernelAdaptedPrice({
      priceMode: 'BASIC_PRICE',
      adaptedPriceValue: new Prisma.Decimal('7.25'),
    })).toBe('7.25');
  });

  it('derives once from the exact complete non-auxiliary basis with frozen provenance', async () => {
    const rows = await run(normal);
    const aux = rows[0];
    expect(aux.priceMode).toBe('TEMPORARY_ESTIMATE');
    expect(aux.estimateBasisAmount?.toString()).toBe('200');
    expect(aux.estimateDerivedAmount?.toString()).toBe('5');
    expect(aux.adaptedPriceValue?.toString()).toBe('5');
    expect(aux.selectedBasicPriceId).toBeNull();
  });

  it('does not round the basis or percentage multiplication early', async () => {
    const rows = await run(
      [normal[0], resource('material', 'Semen', 'MATERIAL', '3.333333')],
      { policy: governedPolicy(2, '1.234567') },
    );
    const exactBasis = new Prisma.Decimal('3.333333').mul('100.00');
    const exactDerived = exactBasis.mul('1.234567').div(100);
    expect(rows[0].estimateBasisAmount?.toString()).toBe(exactBasis.toString());
    expect(rows[0].estimateDerivedAmount?.toString()).toBe(exactDerived.toString());
    expect(rows[0].adaptedPriceValue?.toString()).toBe(
      exactDerived.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toString(),
    );
  });

  it('changes the final rounded money at a half-cent boundary when exact derivation is used', async () => {
    const rows = await run(
      [normal[0], resource('material', 'Semen', 'MATERIAL', '1.000040')],
      { policy: governedPolicy(3, '0.001100') },
    );
    expect(rows[0].adaptedPriceValue?.toString()).toBe('0');
    expect(rows[0].estimateDerivedAmount?.toString()).toBe('0.001100044');

    const kernelInput = (useExactEstimate: boolean) => ({
      boqItemId: 'boq-half-cent',
      ahspVersionId: 'version-1',
      occurrenceId: 'occurrence-1',
      occurrenceCount: 1,
      itemType: 'WORK_ITEM',
      volume: '1',
      boqUnit: 'm3',
      outputUnit: 'm3',
      ownershipMatches: true,
      resources: rows.map((row) => ({
        ahspResourceId: String(row.ahspResourceId),
        resolutionId: String(row.ahspResourceId),
        status: String(row.status),
        ahspVersionId: 'version-1',
        coefficient: new Prisma.Decimal(String(row.ahspCoefficient)).toString(),
        adaptedPriceValue:
          useExactEstimate && row.priceMode === 'TEMPORARY_ESTIMATE'
            ? frozenKernelAdaptedPrice(row as any)
            : row.adaptedPriceValue?.toString() ?? null,
      })),
    });
    const exact = calculateCostKernel(kernelInput(true));
    const premature = calculateCostKernel(kernelInput(false));
    expect(exact.status).toBe('CALCULATED');
    expect(premature.status).toBe('CALCULATED');
    if (exact.status !== 'CALCULATED' || premature.status !== 'CALCULATED') return;
    expect(new Prisma.Decimal(exact.lineTotal).toDecimalPlaces(2).toString()).toBe('100.01');
    expect(new Prisma.Decimal(premature.lineTotal).toDecimalPlaces(2).toString()).toBe('100');
  });

  it.each([
    ['missing policy', null, 'AUXILIARY_ESTIMATE_POLICY_MISSING'],
    ['unauthorized policy', { ...governedPolicy(), approvalAuthorityCode: 'OTHER' }, 'AUXILIARY_ESTIMATE_POLICY_UNAUTHORIZED'],
  ])('holds for %s', async (_label, policy, reason) => {
    const rows = await run(normal, { policy });
    expect(rows[0].status).toBe('NEEDS_REVIEW');
    expect(rows[0].reasonCodes).toContain(reason);
    expect(rows[0].adaptedPriceValue).toBeNull();
  });

  it('rejects coefficient other than one', async () => {
    const rows = await run([resource('aux', 'Alat Bantu', 'EQUIPMENT', '0.5'), normal[1]]);
    expect(rows[0].reasonCodes).toContain('AUXILIARY_ESTIMATE_COEFFICIENT_NOT_ONE');
  });

  it('holds duplicate generic auxiliary rows', async () => {
    const rows = await run([normal[0], { ...normal[0], id: 'aux-2' }, normal[1]]);
    expect(rows[0].reasonCodes).toContain('AUXILIARY_ESTIMATE_MULTIPLE_ROWS');
    expect(rows[1].reasonCodes).toContain('AUXILIARY_ESTIMATE_MULTIPLE_ROWS');
  });

  it('holds when any other resource is unresolved (J.75 five-other-resource condition)', async () => {
    const others = Array.from({ length: 5 }, (_, index) =>
      resource(`missing-${index}`, `Missing ${index}`, 'MATERIAL'));
    const rows = await run([normal[0], ...others], { materialPrice: null });
    expect(rows[0].reasonCodes).toContain('AUXILIARY_ESTIMATE_BASIS_UNRESOLVED');
    expect(rows[0].adaptedPriceValue).toBeNull();
  });

  it('prefers a lawful explicit zero Basic Price over estimation', async () => {
    const rows = await run(normal, { auxPrice: '0' });
    expect(rows[0].priceMode).toBe('BASIC_PRICE');
    expect(rows[0].adaptedPriceValue?.toString()).toBe('0');
    expect(rows[0].estimatePolicyId).toBeUndefined();
  });

  it('does not treat LABOR/LS or another EQUIPMENT/LS as Alat Bantu', async () => {
    const laborAux = catalog('catalog-labor-aux', 'Alat Bantu', 'LABOR');
    const otherEquipment = catalog('catalog-other-equipment', 'Pompa', 'EQUIPMENT');
    const rows = await run([
      resource('labor', 'Alat Bantu', 'LABOR'), resource('pump', 'Pompa', 'EQUIPMENT'), normal[1],
    ], { catalogs: [laborAux, otherEquipment, materialCatalog] });
    expect(rows[0].priceMode).not.toBe('TEMPORARY_ESTIMATE');
    expect(rows[1].priceMode).not.toBe('TEMPORARY_ESTIMATE');
  });

  it('requires assignment and authority to be valid at approval time', () => {
    const revoked = governedPolicy();
    revoked.approvedByPositionAuthority.revokedAt = new Date('2026-09-01');
    expect(approvedAuxiliaryPolicyIsGoverned(revoked, {
      workspaceId: 'workspace-1', ahspVersionId: 'version-1', asOf,
    })).toBe(false);
  });

  it('resolves real account ownership through the canonical User membership relation', () => {
    const approved = governedPolicy();
    const scope = { workspaceId: 'workspace-1', ahspVersionId: 'version-1', asOf };
    expect(approvedAuxiliaryPolicyIsGoverned(approved, scope)).toBe(true);
    approved.approvedByPositionAssignment.user.membership.accountId = 'different-account';
    expect(approvedAuxiliaryPolicyIsGoverned(approved, scope)).toBe(false);
  });

  it('rejects approval performed AFTER the AHSP calculation as-of date', () => {
    const late = governedPolicy();
    late.approvedAt = new Date('2026-11-01T00:00:00.000Z');
    late.approvedByPositionAssignment.removedAt = null;
    expect(approvedAuxiliaryPolicyIsGoverned(late, { workspaceId: 'workspace-1', ahspVersionId: 'version-1', asOf })).toBe(false);
  });

  it('rejects missing membership evidence and cross-workspace actor membership', () => {
    const scope = { workspaceId: 'workspace-1', ahspVersionId: 'version-1', asOf };
    const missingMembership = governedPolicy();
    missingMembership.approvedByPositionAssignment.user.membership = null;
    expect(approvedAuxiliaryPolicyIsGoverned(missingMembership, scope)).toBe(false);
    const foreignMembership = governedPolicy();
    foreignMembership.approvedByPositionAssignment.user.membership.workspaceId = 'other-workspace';
    expect(approvedAuxiliaryPolicyIsGoverned(foreignMembership, scope)).toBe(false);
  });
});
