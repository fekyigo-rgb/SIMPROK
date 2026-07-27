import { PrismaClient } from '@prisma/client';

import {
  MissingUnitApplyError,
  applyMissingUnitPlan,
  buildMissingUnitPlan,
  computeMissingUnitPlanHash,
  type CanonicalInventory,
} from '../../src/resource-catalog/resource-catalog-missing-unit-disposition';

/**
 * RM-02C1c — Missing-Unit Human Disposition.
 *
 * Exercises the guard-agnostic core functions directly against real
 * simprok_test, using a dedicated fixture workspace and a fixture-scoped
 * sourceSha256 (never the real committed inventory's hash) — this proves
 * the transactional/idempotency/conflict contract without touching or
 * depending on the real Workspace-A precondition state, which the actual
 * persistent apply (a separate, later step) requires to be exactly
 * 267 resources / 269 provenance rows beforehand.
 */

const TAG = 'RM02C1C';
const GIT_HEAD_FIXTURE = 'e2e-fixture-head-0000000000000000000000';
const FIXTURE_SOURCE_SHA256 = 'C'.repeat(64);

function fixtureInventory(): CanonicalInventory {
  return {
    parserContractVersion: 'RM02C1C_E2E_FIXTURE_V1',
    sourceFileName: 'rm02c1c-e2e-fixture.xlsx',
    sourceSha256: FIXTURE_SOURCE_SHA256,
    sheetName: 'RM02C1C E2E FIXTURE SHEET',
    totalParsedRows: 2,
    sectionCounts: { MATERIAL: 2 },
    rows: [
      {
        sourceRowNumber: 39,
        sourceSection: 'MATERIAL',
        rawResourceCodeText: null,
        rawResourceNameText: 'Kawat BRC',
        rawUnitText: null,
        sourceCodeCellAddress: 'D39',
        sourceNameCellAddress: 'C39',
        sourceUnitCellAddress: 'E39',
        warnings: [],
        errors: [],
      },
      {
        sourceRowNumber: 104,
        sourceSection: 'MATERIAL',
        rawResourceCodeText: null,
        rawResourceNameText: 'Kerikil',
        rawUnitText: null,
        sourceCodeCellAddress: 'D104',
        sourceNameCellAddress: 'C104',
        sourceUnitCellAddress: 'E104',
        warnings: [],
        errors: [],
      },
    ],
  };
}

describe('RM-02C1c Missing-Unit Human Disposition (e2e)', () => {
  let prisma: PrismaClient;
  let orgId: string;
  let workspaceId: string;
  let otherWorkspaceId: string;

  const createdCatalogIds: string[] = [];
  const createdProvenanceIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient();
    const org = await prisma.organization.create({ data: { name: `${TAG} Org`, type: 'COMPANY' } });
    orgId = org.id;
    const ws = await prisma.workspace.create({ data: { name: `${TAG} Workspace`, organizationId: orgId } });
    workspaceId = ws.id;
    const otherWs = await prisma.workspace.create({ data: { name: `${TAG} Other Workspace`, organizationId: orgId } });
    otherWorkspaceId = otherWs.id;
  });

  afterAll(async () => {
    await prisma.resourceSourceIdentity.deleteMany({ where: { workspaceId: { in: [workspaceId, otherWorkspaceId] } } });
    if (createdCatalogIds.length > 0) {
      await prisma.resourceCatalog.deleteMany({ where: { id: { in: createdCatalogIds } } });
    }
    await prisma.resourceCatalog.deleteMany({ where: { workspaceId: { in: [workspaceId, otherWorkspaceId] } } });
    await prisma.workspace.deleteMany({ where: { id: { in: [workspaceId, otherWorkspaceId] } } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  async function countSideEffectTables() {
    const [basicPrice, priceSubmission, publicationAudit, unitDefinition, unitAlias, ahsp, region, roles] = await Promise.all([
      prisma.basicPrice.count(),
      prisma.priceSubmission.count(),
      prisma.basicPricePublicationAudit.count(),
      prisma.unitDefinition.count(),
      prisma.unitAlias.count(),
      prisma.aHSP.count(),
      prisma.region.count(),
      prisma.role.count(),
    ]);
    return { basicPrice, priceSubmission, publicationAudit, unitDefinition, unitAlias, ahsp, region, roles };
  }

  it('12/13/14/15/16/17/18/33-40: fresh apply creates exactly two reviewed resources with zero side effects', async () => {
    const before = await countSideEffectTables();
    const inventory = fixtureInventory();
    const planParams = { inventory, inventoryPath: 'fixture', inventorySha256: 'fixture', workspaceId, generatedFromGitHead: GIT_HEAD_FIXTURE };

    const plan = await buildMissingUnitPlan(prisma, planParams);
    expect(plan.entries).toHaveLength(2);
    const planSha256 = computeMissingUnitPlanHash(plan);
    const result = await applyMissingUnitPlan(prisma, {
      ...planParams,
      expectedPlanSha256: planSha256,
      confirmationToken: 'APPLY_RM02C1C_TO_SIMPROK_TEST',
    });
    expect(result.resourceCatalogCreatedDelta).toBe(2);
    expect(result.provenanceCreatedDelta).toBe(2);

    const kawatBrc = await prisma.resourceCatalog.findFirstOrThrow({ where: { workspaceId, name: 'Kawat BRC' } });
    const kerikil = await prisma.resourceCatalog.findFirstOrThrow({ where: { workspaceId, name: 'Kerikil' } });
    createdCatalogIds.push(kawatBrc.id, kerikil.id);
    expect(kawatBrc.code).toBeNull();
    expect(kawatBrc.type).toBe('MATERIAL');
    expect(kawatBrc.baseUnit).toBe('Buah');
    expect(kerikil.code).toBeNull();
    expect(kerikil.type).toBe('MATERIAL');
    expect(kerikil.baseUnit).toBe('M3');

    const kawatBrcProv = await prisma.resourceSourceIdentity.findFirstOrThrow({ where: { resourceCatalogId: kawatBrc.id } });
    const kerikilProv = await prisma.resourceSourceIdentity.findFirstOrThrow({ where: { resourceCatalogId: kerikil.id } });
    createdProvenanceIds.push(kawatBrcProv.id, kerikilProv.id);
    expect(kawatBrcProv.rawUnit).toBeNull();
    expect(kerikilProv.rawUnit).toBeNull();
    expect(kawatBrcProv.sourceCodeCellAddress).toBe('D39');
    expect(kawatBrcProv.sourceNameCellAddress).toBe('C39');
    expect(kawatBrcProv.sourceUnitCellAddress).toBe('E39');
    expect(kerikilProv.sourceCodeCellAddress).toBe('D104');
    expect(kerikilProv.sourceNameCellAddress).toBe('C104');
    expect(kerikilProv.sourceUnitCellAddress).toBe('E104');

    const after = await countSideEffectTables();
    expect(after).toEqual(before);
  });

  it('19: second identical apply is fully idempotent — zero persistent delta', async () => {
    const inventory = fixtureInventory();
    const planParams = { inventory, inventoryPath: 'fixture', inventorySha256: 'fixture', workspaceId, generatedFromGitHead: GIT_HEAD_FIXTURE };
    const plan = await buildMissingUnitPlan(prisma, planParams);
    expect(plan.entries.every((e) => e.disposition === 'IDEMPOTENT_ALREADY_APPLIED')).toBe(true);
    const planSha256 = computeMissingUnitPlanHash(plan);
    const result = await applyMissingUnitPlan(prisma, {
      ...planParams,
      expectedPlanSha256: planSha256,
      confirmationToken: 'APPLY_RM02C1C_TO_SIMPROK_TEST',
    });
    expect(result.resourceCatalogCreatedDelta).toBe(0);
    expect(result.provenanceCreatedDelta).toBe(0);

    const catalogCount = await prisma.resourceCatalog.count({ where: { workspaceId } });
    const provenanceCount = await prisma.resourceSourceIdentity.count({ where: { workspaceId } });
    expect(catalogCount).toBe(2);
    expect(provenanceCount).toBe(2);
  });

  it('20: a stale plan hash fails before any write', async () => {
    const inventory = fixtureInventory();
    const planParams = { inventory, inventoryPath: 'fixture', inventorySha256: 'fixture', workspaceId, generatedFromGitHead: GIT_HEAD_FIXTURE };
    const plan = await buildMissingUnitPlan(prisma, planParams);
    const genuineHash = computeMissingUnitPlanHash(plan);
    await expect(
      applyMissingUnitPlan(prisma, {
        ...planParams,
        expectedPlanSha256: `${genuineHash.slice(0, -1)}0`,
        confirmationToken: 'APPLY_RM02C1C_TO_SIMPROK_TEST',
      }),
    ).rejects.toThrow(/STOP_STALE_PLAN_HASH/);
  });

  it('21: a missing/wrong confirmation token fails before any write', async () => {
    const inventory = fixtureInventory();
    const planParams = { inventory, inventoryPath: 'fixture', inventorySha256: 'fixture', workspaceId, generatedFromGitHead: GIT_HEAD_FIXTURE };
    const plan = await buildMissingUnitPlan(prisma, planParams);
    const planSha256 = computeMissingUnitPlanHash(plan);
    await expect(
      applyMissingUnitPlan(prisma, { ...planParams, expectedPlanSha256: planSha256, confirmationToken: 'WRONG_TOKEN' }),
    ).rejects.toThrow(/STOP_MISSING_CONFIRMATION_TOKEN/);
  });

  describe('conflict and collision cases (dedicated sub-workspace per case)', () => {
    let caseOrgId: string;
    let caseWorkspaceId: string;

    beforeEach(async () => {
      const org = await prisma.organization.create({ data: { name: `${TAG} Case Org`, type: 'COMPANY' } });
      caseOrgId = org.id;
      const ws = await prisma.workspace.create({ data: { name: `${TAG} Case Workspace`, organizationId: caseOrgId } });
      caseWorkspaceId = ws.id;
    });

    afterEach(async () => {
      await prisma.resourceSourceIdentity.deleteMany({ where: { workspaceId: caseWorkspaceId } });
      await prisma.resourceCatalog.deleteMany({ where: { workspaceId: caseWorkspaceId } });
      await prisma.workspace.delete({ where: { id: caseWorkspaceId } });
      await prisma.organization.delete({ where: { id: caseOrgId } });
    });

    it('22: existing provenance mismatch fails closed as CONFLICT_STOP', async () => {
      const inventory = fixtureInventory();
      const planParams = { inventory, inventoryPath: 'fixture', inventorySha256: 'fixture', workspaceId: caseWorkspaceId, generatedFromGitHead: GIT_HEAD_FIXTURE };
      const plan1 = await buildMissingUnitPlan(prisma, planParams);
      const hash1 = computeMissingUnitPlanHash(plan1);
      await applyMissingUnitPlan(prisma, { ...planParams, expectedPlanSha256: hash1, confirmationToken: 'APPLY_RM02C1C_TO_SIMPROK_TEST' });

      const kawatBrc = await prisma.resourceCatalog.findFirstOrThrow({ where: { workspaceId: caseWorkspaceId, name: 'Kawat BRC' } });
      const prov = await prisma.resourceSourceIdentity.findFirstOrThrow({ where: { resourceCatalogId: kawatBrc.id } });
      await prisma.resourceSourceIdentity.update({ where: { id: prov.id }, data: { rawName: 'TAMPERED' } });

      const plan2 = await buildMissingUnitPlan(prisma, planParams);
      const entry39 = plan2.entries.find((e) => e.sourceRowNumber === 39)!;
      expect(entry39.disposition).toBe('CONFLICT_STOP');
      const hash2 = computeMissingUnitPlanHash(plan2);
      await expect(
        applyMissingUnitPlan(prisma, { ...planParams, expectedPlanSha256: hash2, confirmationToken: 'APPLY_RM02C1C_TO_SIMPROK_TEST' }),
      ).rejects.toThrow(/STOP_CONFLICTS_PRESENT/);
    });

    it('23: an existing unproven exact candidate (same name/type/approved-unit, no provenance) fails closed', async () => {
      await prisma.resourceCatalog.create({
        data: { workspaceId: caseWorkspaceId, code: null, name: 'Kawat BRC', type: 'MATERIAL', baseUnit: 'Buah', status: 'ACTIVE' },
      });
      const inventory = fixtureInventory();
      const planParams = { inventory, inventoryPath: 'fixture', inventorySha256: 'fixture', workspaceId: caseWorkspaceId, generatedFromGitHead: GIT_HEAD_FIXTURE };
      const plan = await buildMissingUnitPlan(prisma, planParams);
      const entry39 = plan.entries.find((e) => e.sourceRowNumber === 39)!;
      expect(entry39.disposition).toBe('CONFLICT_STOP');
      expect(entry39.conflictReason).toMatch(/STOP_EXISTING_UNPROVEN_RESOURCE_COLLISION/);
      const hash = computeMissingUnitPlanHash(plan);
      await expect(
        applyMissingUnitPlan(prisma, { ...planParams, expectedPlanSha256: hash, confirmationToken: 'APPLY_RM02C1C_TO_SIMPROK_TEST' }),
      ).rejects.toThrow(/STOP_CONFLICTS_PRESENT/);
    });

    it('24: an existing same-name/different-unit candidate is never modified and never blocks', async () => {
      const differentUnitCandidate = await prisma.resourceCatalog.create({
        data: { workspaceId: caseWorkspaceId, code: null, name: 'Kerikil', type: 'MATERIAL', baseUnit: 'Kg', status: 'ACTIVE' },
      });
      const inventory = fixtureInventory();
      const planParams = { inventory, inventoryPath: 'fixture', inventorySha256: 'fixture', workspaceId: caseWorkspaceId, generatedFromGitHead: GIT_HEAD_FIXTURE };
      const plan = await buildMissingUnitPlan(prisma, planParams);
      const entry104 = plan.entries.find((e) => e.sourceRowNumber === 104)!;
      expect(entry104.disposition).toBe('CREATE_REVIEWED_RESOURCE');
      const hash = computeMissingUnitPlanHash(plan);
      const result = await applyMissingUnitPlan(prisma, { ...planParams, expectedPlanSha256: hash, confirmationToken: 'APPLY_RM02C1C_TO_SIMPROK_TEST' });
      expect(result.resourceCatalogCreatedDelta).toBe(2);

      const untouchedCandidate = await prisma.resourceCatalog.findUniqueOrThrow({ where: { id: differentUnitCandidate.id } });
      expect(untouchedCandidate).toEqual(differentUnitCandidate);
      const newKerikilM3 = await prisma.resourceCatalog.findFirstOrThrow({ where: { workspaceId: caseWorkspaceId, name: 'Kerikil', baseUnit: 'M3' } });
      expect(newKerikilM3.id).not.toBe(differentUnitCandidate.id);
    });

    it('25: concurrent apply attempts serialize via the advisory lock — no duplicate resources', async () => {
      const inventory = fixtureInventory();
      const planParams = { inventory, inventoryPath: 'fixture', inventorySha256: 'fixture', workspaceId: caseWorkspaceId, generatedFromGitHead: GIT_HEAD_FIXTURE };
      const plan = await buildMissingUnitPlan(prisma, planParams);
      const planSha256 = computeMissingUnitPlanHash(plan);
      const attempt = () =>
        applyMissingUnitPlan(prisma, { ...planParams, expectedPlanSha256: planSha256, confirmationToken: 'APPLY_RM02C1C_TO_SIMPROK_TEST' }).catch((e: unknown) => e);
      const [resultA, resultB] = await Promise.all([attempt(), attempt()]);
      const errors = [resultA, resultB].filter((r) => r instanceof Error);
      expect(errors.length).toBe(1);
      expect((errors[0] as Error).message).toMatch(/STOP_STALE_PLAN_HASH/);

      const catalogCount = await prisma.resourceCatalog.count({ where: { workspaceId: caseWorkspaceId } });
      expect(catalogCount).toBe(2);
    });

    it('26: injected failure between the two rows rolls back both', async () => {
      const inventory = fixtureInventory();
      const planParams = { inventory, inventoryPath: 'fixture', inventorySha256: 'fixture', workspaceId: caseWorkspaceId, generatedFromGitHead: GIT_HEAD_FIXTURE };
      const plan = await buildMissingUnitPlan(prisma, planParams);
      const planSha256 = computeMissingUnitPlanHash(plan);

      await expect(
        applyMissingUnitPlan(prisma, {
          ...planParams,
          expectedPlanSha256: planSha256,
          confirmationToken: 'APPLY_RM02C1C_TO_SIMPROK_TEST',
          injectFailureAfterSourceRowNumber: 39,
        }),
      ).rejects.toThrow(/INJECTED_TEST_FAILURE_AFTER_ROW_39/);

      const catalogCount = await prisma.resourceCatalog.count({ where: { workspaceId: caseWorkspaceId } });
      const provenanceCount = await prisma.resourceSourceIdentity.count({ where: { workspaceId: caseWorkspaceId } });
      expect(catalogCount).toBe(0);
      expect(provenanceCount).toBe(0);
    });
  });

  it('28/29/30: no ResourceCatalog or provenance row is ever created in an unrelated workspace', async () => {
    const otherWorkspaceCatalogCount = await prisma.resourceCatalog.count({ where: { workspaceId: otherWorkspaceId } });
    const otherWorkspaceProvenanceCount = await prisma.resourceSourceIdentity.count({ where: { workspaceId: otherWorkspaceId } });
    expect(otherWorkspaceCatalogCount).toBe(0);
    expect(otherWorkspaceProvenanceCount).toBe(0);
  });
});
