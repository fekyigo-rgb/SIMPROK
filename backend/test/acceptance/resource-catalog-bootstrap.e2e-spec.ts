import { PrismaClient } from '@prisma/client';

import {
  BootstrapApplyError,
  CanonicalInventory,
  applyBootstrapPlan,
  buildPlan,
  computePlanHash,
} from '../../src/resource-catalog/resource-catalog-bootstrap-planner';

/**
 * RM-02C1b — Reviewed Resource Catalog Bootstrap.
 *
 * Exercises the guard-agnostic core planner/apply functions directly against
 * real simprok_test (never through the CLI wrapper, which adds the database
 * guard — see the planner module's header comment for why). Uses a small,
 * synthetic, dedicated test workspace and inventory covering every
 * disposition, not the real 271-row Workspace-A inventory — the real
 * inventory's exact dispositions are proven separately by unit tests
 * (resource-catalog-bootstrap-planner.spec.ts) and by the real dry-run
 * evidence committed to docs/implementation-gates/rm02c1b-reviewed-bootstrap/.
 */

const TAG = 'RM02C1B';
const GIT_HEAD_FIXTURE = 'e2e-fixture-head-0000000000000000000000';

function makeInventory(rows: CanonicalInventory['rows']): CanonicalInventory {
  return {
    parserContractVersion: 'RM02C1B_E2E_FIXTURE_V1',
    sourceFileName: 'rm02c1b-e2e-fixture.xlsx',
    sourceSha256: 'B'.repeat(64),
    sheetName: 'RM02C1B E2E FIXTURE SHEET',
    totalParsedRows: rows.length,
    sectionCounts: rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.sourceSection] = (acc[r.sourceSection] ?? 0) + 1;
      return acc;
    }, {}),
    rows,
  };
}

function row(overrides: Partial<CanonicalInventory['rows'][number]>): CanonicalInventory['rows'][number] {
  return {
    sourceRowNumber: 1,
    sourceSection: 'MATERIAL',
    rawResourceCodeText: null,
    rawResourceNameText: `${TAG} Fixture Material`,
    rawUnitText: 'Unit',
    sourceCodeCellAddress: 'D1',
    sourceNameCellAddress: 'C1',
    sourceUnitCellAddress: 'E1',
    warnings: [],
    errors: [],
    ...overrides,
  };
}

describe('RM-02C1b Resource Catalog Bootstrap (e2e)', () => {
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
    if (createdProvenanceIds.length > 0) {
      await prisma.resourceSourceIdentity.deleteMany({ where: { id: { in: createdProvenanceIds } } });
    }
    // Also sweep any provenance/catalog rows this suite created that weren't
    // individually tracked (defensive: every apply is scoped to our own
    // dedicated workspaces, so a name-prefix sweep is safe and exhaustive).
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
    const [basicPrice, priceSubmission, publicationAudit, unitDefinition, unitAlias, ahsp, region] = await Promise.all([
      prisma.basicPrice.count(),
      prisma.priceSubmission.count(),
      prisma.basicPricePublicationAudit.count(),
      prisma.unitDefinition.count(),
      prisma.unitAlias.count(),
      prisma.aHSP.count(),
      prisma.region.count(),
    ]);
    return { basicPrice, priceSubmission, publicationAudit, unitDefinition, unitAlias, ahsp, region };
  }

  it('37-43: a full apply across every disposition type causes zero side-effect-table deltas', async () => {
    const before = await countSideEffectTables();

    // Row numbers 136/137 are used deliberately (not arbitrary numbers like
    // 2/3) because ATTACH_EXACT_DUPLICATE_PROVENANCE is only ever assigned
    // to the two explicitly hardcoded row pairs (136/137, 157/161) — there
    // is no generic duplicate-name-and-unit auto-merge algorithm. Using an
    // arbitrary pair here would (correctly) create two independent
    // resources instead of one representative + one attach-provenance.
    const inventory = makeInventory([
      row({ sourceRowNumber: 1, sourceSection: 'LABOR', rawResourceCodeText: 'X.01', rawResourceNameText: `${TAG} Plain Labor`, rawUnitText: 'Org/Hari' }),
      row({ sourceRowNumber: 136, sourceSection: 'MATERIAL', rawResourceNameText: `${TAG} Dup A`, rawUnitText: 'Zak' }),
      row({ sourceRowNumber: 137, sourceSection: 'MATERIAL', rawResourceNameText: `${TAG} Dup A`, rawUnitText: 'Zak' }),
    ]);

    const plan = await buildPlan(prisma, { inventory, inventoryPath: 'fixture', inventorySha256: 'fixture', workspaceId, generatedFromGitHead: GIT_HEAD_FIXTURE });
    const planSha256 = computePlanHash(plan);
    const result = await applyBootstrapPlan(prisma, {
      expectedPlanSha256: planSha256,
      confirmationToken: 'APPLY_RM02C1B_TO_SIMPROK_TEST',
      workspaceId,
      inventory,
      inventoryPath: 'fixture',
      inventorySha256: 'fixture',
      generatedFromGitHead: GIT_HEAD_FIXTURE,
    });
    expect(result.resourceCatalogCreatedDelta).toBe(2);
    expect(result.provenanceCreatedDelta).toBe(3);

    const created = await prisma.resourceCatalog.findMany({ where: { workspaceId } });
    for (const c of created) createdCatalogIds.push(c.id);
    const provenance = await prisma.resourceSourceIdentity.findMany({ where: { workspaceId } });
    for (const p of provenance) createdProvenanceIds.push(p.id);

    const after = await countSideEffectTables();
    expect(after).toEqual(before);
  });

  it('27: second identical apply is fully idempotent — zero persistent delta', async () => {
    const inventory = makeInventory([row({ sourceRowNumber: 10, rawResourceNameText: `${TAG} Idempotent Row` })]);
    const planParams = { inventory, inventoryPath: 'fixture', inventorySha256: 'fixture', workspaceId, generatedFromGitHead: GIT_HEAD_FIXTURE };

    const plan1 = await buildPlan(prisma, planParams);
    const hash1 = computePlanHash(plan1);
    const first = await applyBootstrapPlan(prisma, { ...planParams, expectedPlanSha256: hash1, confirmationToken: 'APPLY_RM02C1B_TO_SIMPROK_TEST' });
    expect(first.resourceCatalogCreatedDelta).toBe(1);
    const created = await prisma.resourceCatalog.findFirstOrThrow({ where: { workspaceId, name: `${TAG} Idempotent Row` } });
    createdCatalogIds.push(created.id);
    const prov = await prisma.resourceSourceIdentity.findFirstOrThrow({ where: { resourceCatalogId: created.id } });
    createdProvenanceIds.push(prov.id);

    const catalogCountBefore = await prisma.resourceCatalog.count({ where: { workspaceId } });
    const provenanceCountBefore = await prisma.resourceSourceIdentity.count({ where: { workspaceId } });

    const plan2 = await buildPlan(prisma, planParams);
    const hash2 = computePlanHash(plan2);
    const second = await applyBootstrapPlan(prisma, { ...planParams, expectedPlanSha256: hash2, confirmationToken: 'APPLY_RM02C1B_TO_SIMPROK_TEST' });
    expect(second.resourceCatalogCreatedDelta).toBe(0);
    expect(second.resourceCatalogReusedDelta).toBe(0);
    expect(second.provenanceCreatedDelta).toBe(0);

    const catalogCountAfter = await prisma.resourceCatalog.count({ where: { workspaceId } });
    const provenanceCountAfter = await prisma.resourceSourceIdentity.count({ where: { workspaceId } });
    expect(catalogCountAfter).toBe(catalogCountBefore);
    expect(provenanceCountAfter).toBe(provenanceCountBefore);
  });

  it('25: injected mid-apply failure rolls back everything (zero persistent delta)', async () => {
    const inventory = makeInventory([
      row({ sourceRowNumber: 20, rawResourceNameText: `${TAG} Rollback Row 1` }),
      row({ sourceRowNumber: 21, rawResourceNameText: `${TAG} Rollback Row 2` }),
    ]);
    const planParams = { inventory, inventoryPath: 'fixture', inventorySha256: 'fixture', workspaceId, generatedFromGitHead: GIT_HEAD_FIXTURE };
    const plan = await buildPlan(prisma, planParams);
    const planSha256 = computePlanHash(plan);

    const catalogCountBefore = await prisma.resourceCatalog.count({ where: { workspaceId } });
    const provenanceCountBefore = await prisma.resourceSourceIdentity.count({ where: { workspaceId } });

    await expect(
      applyBootstrapPlan(prisma, {
        ...planParams,
        expectedPlanSha256: planSha256,
        confirmationToken: 'APPLY_RM02C1B_TO_SIMPROK_TEST',
        injectFailureAfterSourceRowNumber: 21,
      }),
    ).rejects.toThrow(/INJECTED_TEST_FAILURE_AFTER_ROW_21/);

    const catalogCountAfter = await prisma.resourceCatalog.count({ where: { workspaceId } });
    const provenanceCountAfter = await prisma.resourceSourceIdentity.count({ where: { workspaceId } });
    expect(catalogCountAfter).toBe(catalogCountBefore);
    expect(provenanceCountAfter).toBe(provenanceCountBefore);
  });

  it('28: a stale plan hash fails (live state changed since the plan was computed)', async () => {
    const inventory = makeInventory([row({ sourceRowNumber: 30, rawResourceNameText: `${TAG} Stale Hash Row` })]);
    const planParams = { inventory, inventoryPath: 'fixture', inventorySha256: 'fixture', workspaceId, generatedFromGitHead: GIT_HEAD_FIXTURE };
    const plan = await buildPlan(prisma, planParams);
    const genuineHash = computePlanHash(plan);

    await expect(
      applyBootstrapPlan(prisma, {
        ...planParams,
        expectedPlanSha256: `${genuineHash.slice(0, -1)}${genuineHash.endsWith('0') ? '1' : '0'}`,
        confirmationToken: 'APPLY_RM02C1B_TO_SIMPROK_TEST',
      }),
    ).rejects.toThrow(BootstrapApplyError);
    await expect(
      applyBootstrapPlan(prisma, {
        ...planParams,
        expectedPlanSha256: `${genuineHash.slice(0, -1)}${genuineHash.endsWith('0') ? '1' : '0'}`,
        confirmationToken: 'APPLY_RM02C1B_TO_SIMPROK_TEST',
      }),
    ).rejects.toThrow(/STOP_STALE_PLAN_HASH/);

    const survivingRows = await prisma.resourceCatalog.count({ where: { workspaceId, name: `${TAG} Stale Hash Row` } });
    expect(survivingRows).toBe(0);
  });

  it('29: a missing/wrong confirmation token fails before any write', async () => {
    const inventory = makeInventory([row({ sourceRowNumber: 31, rawResourceNameText: `${TAG} No Token Row` })]);
    const planParams = { inventory, inventoryPath: 'fixture', inventorySha256: 'fixture', workspaceId, generatedFromGitHead: GIT_HEAD_FIXTURE };
    const plan = await buildPlan(prisma, planParams);
    const planSha256 = computePlanHash(plan);

    await expect(
      applyBootstrapPlan(prisma, { ...planParams, expectedPlanSha256: planSha256, confirmationToken: 'WRONG_TOKEN' }),
    ).rejects.toThrow(/STOP_MISSING_CONFIRMATION_TOKEN/);

    const survivingRows = await prisma.resourceCatalog.count({ where: { workspaceId, name: `${TAG} No Token Row` } });
    expect(survivingRows).toBe(0);
  });

  it('31: an existing provenance mismatch fails closed as CONFLICT_STOP and refuses to apply', async () => {
    const inventory = makeInventory([row({ sourceRowNumber: 40, rawResourceNameText: `${TAG} Mismatch Row`, rawUnitText: 'Zak' })]);
    const planParams = { inventory, inventoryPath: 'fixture', inventorySha256: 'fixture', workspaceId, generatedFromGitHead: GIT_HEAD_FIXTURE };
    const plan1 = await buildPlan(prisma, planParams);
    const hash1 = computePlanHash(plan1);
    await applyBootstrapPlan(prisma, { ...planParams, expectedPlanSha256: hash1, confirmationToken: 'APPLY_RM02C1B_TO_SIMPROK_TEST' });
    const catalog = await prisma.resourceCatalog.findFirstOrThrow({ where: { workspaceId, name: `${TAG} Mismatch Row` } });
    createdCatalogIds.push(catalog.id);
    const prov = await prisma.resourceSourceIdentity.findFirstOrThrow({ where: { resourceCatalogId: catalog.id } });
    createdProvenanceIds.push(prov.id);

    // Tamper the committed raw evidence directly (never done by the apply
    // logic itself) to simulate a real-world mismatch between a later plan
    // run and what was actually recorded.
    await prisma.resourceSourceIdentity.update({ where: { id: prov.id }, data: { rawUnit: 'TAMPERED_UNIT' } });

    const plan2 = await buildPlan(prisma, planParams);
    const conflictEntry = plan2.entries.find((e) => e.sourceRowNumber === 40)!;
    expect(conflictEntry.disposition).toBe('CONFLICT_STOP');

    const hash2 = computePlanHash(plan2);
    await expect(
      applyBootstrapPlan(prisma, { ...planParams, expectedPlanSha256: hash2, confirmationToken: 'APPLY_RM02C1B_TO_SIMPROK_TEST' }),
    ).rejects.toThrow(/STOP_CONFLICTS_PRESENT/);
  });

  it('26: concurrent apply attempts serialize via the advisory lock — no duplicate resources', async () => {
    const inventory = makeInventory([row({ sourceRowNumber: 50, rawResourceNameText: `${TAG} Concurrency Row` })]);
    const planParams = { inventory, inventoryPath: 'fixture', inventorySha256: 'fixture', workspaceId, generatedFromGitHead: GIT_HEAD_FIXTURE };
    const plan = await buildPlan(prisma, planParams);
    const planSha256 = computePlanHash(plan);

    const attempt = () =>
      applyBootstrapPlan(prisma, { ...planParams, expectedPlanSha256: planSha256, confirmationToken: 'APPLY_RM02C1B_TO_SIMPROK_TEST' }).catch((e: unknown) => e);

    const [resultA, resultB] = await Promise.all([attempt(), attempt()]);
    const errors = [resultA, resultB].filter((r) => r instanceof Error);
    // The lock-then-rebuild-then-hash design makes exactly one outcome
    // reachable for a fresh row: whichever attempt commits first serializes
    // the second behind the advisory lock, and when the second finally
    // rebuilds its plan inside the transaction it sees the row as already
    // applied — a hash mismatch against the pre-computed expectedPlanSha256
    // — so it must fail with STOP_STALE_PLAN_HASH. Both succeeding is not a
    // reachable outcome for this fixture; assert the exact count so this
    // line itself catches a regression rather than only the row-count
    // checks below.
    expect(errors.length).toBe(1);
    expect((errors[0] as Error).message).toMatch(/STOP_STALE_PLAN_HASH/);

    const matching = await prisma.resourceCatalog.findMany({ where: { workspaceId, name: `${TAG} Concurrency Row` } });
    expect(matching).toHaveLength(1);
    createdCatalogIds.push(matching[0].id);
    const provRows = await prisma.resourceSourceIdentity.findMany({ where: { resourceCatalogId: matching[0].id } });
    expect(provRows).toHaveLength(1);
    createdProvenanceIds.push(provRows[0].id);
  });

  it('36: an identical name/type/unit resource in a different workspace never blocks or is touched by this apply', async () => {
    // Seed a colliding resource in the OTHER workspace first — same
    // name/type/unit as the row we are about to bootstrap into `workspaceId`.
    // If tenancy scoping had a gap, this pre-existing row could either (a)
    // wrongly trigger STOP_EXISTING_UNPROVEN_RESOURCE_COLLISION even though
    // it belongs to a different tenant, or (b) get silently reused/mutated
    // by an apply targeting a different workspace. Neither may happen.
    const collidingRowName = `${TAG} Cross Tenant Collision Row`;
    const preexistingInOtherWorkspace = await prisma.resourceCatalog.create({
      data: { workspaceId: otherWorkspaceId, name: collidingRowName, type: 'MATERIAL', baseUnit: 'Zak' },
    });

    const inventory = makeInventory([row({ sourceRowNumber: 60, sourceSection: 'MATERIAL', rawResourceNameText: collidingRowName, rawUnitText: 'Zak' })]);
    const planParams = { inventory, inventoryPath: 'fixture', inventorySha256: 'fixture', workspaceId, generatedFromGitHead: GIT_HEAD_FIXTURE };
    const plan = await buildPlan(prisma, planParams);
    expect(plan.entries[0].disposition).toBe('CREATE_NEW_RESOURCE');
    const planSha256 = computePlanHash(plan);
    const result = await applyBootstrapPlan(prisma, { ...planParams, expectedPlanSha256: planSha256, confirmationToken: 'APPLY_RM02C1B_TO_SIMPROK_TEST' });
    expect(result.resourceCatalogCreatedDelta).toBe(1);

    const createdInWorkspace = await prisma.resourceCatalog.findFirstOrThrow({ where: { workspaceId, name: collidingRowName } });
    createdCatalogIds.push(createdInWorkspace.id);
    const prov = await prisma.resourceSourceIdentity.findFirstOrThrow({ where: { resourceCatalogId: createdInWorkspace.id } });
    createdProvenanceIds.push(prov.id);
    expect(createdInWorkspace.id).not.toBe(preexistingInOtherWorkspace.id);

    // The other workspace's row must be completely untouched.
    const otherWorkspaceRowAfter = await prisma.resourceCatalog.findUniqueOrThrow({ where: { id: preexistingInOtherWorkspace.id } });
    expect(otherWorkspaceRowAfter).toEqual(preexistingInOtherWorkspace);
    const otherWorkspaceProvenanceCount = await prisma.resourceSourceIdentity.count({ where: { resourceCatalogId: preexistingInOtherWorkspace.id } });
    expect(otherWorkspaceProvenanceCount).toBe(0);

    await prisma.resourceCatalog.delete({ where: { id: preexistingInOtherWorkspace.id } });
  });

  // ------------------------------------------------------------------
  // L.01 special disposition — CASE 1/2/3 (section V of the contract)
  //
  // Each case gets its own dedicated, disposable workspace: the three
  // cases (absent / exact-match / conflicting) are mutually exclusive
  // L.01 states and cannot coexist in one workspace.
  // ------------------------------------------------------------------
  describe('L.01 disposition cases', () => {
    let l01OrgId: string;
    let l01WorkspaceId: string;

    beforeEach(async () => {
      const org = await prisma.organization.create({ data: { name: `${TAG} L01 Case Org`, type: 'COMPANY' } });
      l01OrgId = org.id;
      const ws = await prisma.workspace.create({ data: { name: `${TAG} L01 Case Workspace`, organizationId: l01OrgId } });
      l01WorkspaceId = ws.id;
    });

    afterEach(async () => {
      await prisma.resourceSourceIdentity.deleteMany({ where: { workspaceId: l01WorkspaceId } });
      await prisma.resourceCatalog.deleteMany({ where: { workspaceId: l01WorkspaceId } });
      await prisma.workspace.delete({ where: { id: l01WorkspaceId } });
      await prisma.organization.delete({ where: { id: l01OrgId } });
    });

    it('22 (CASE 2): absent L.01-shaped resource is created exactly once', async () => {
      const inventory = makeInventory([
        row({ sourceRowNumber: 9, sourceSection: 'LABOR', rawResourceCodeText: 'L.01', rawResourceNameText: 'Pekerja', rawUnitText: 'Org/Hari', sourceCodeCellAddress: 'D9', sourceNameCellAddress: 'C9', sourceUnitCellAddress: 'E9' }),
      ]);
      const planParams = { inventory, inventoryPath: 'fixture', inventorySha256: 'fixture', workspaceId: l01WorkspaceId, generatedFromGitHead: GIT_HEAD_FIXTURE };
      const plan = await buildPlan(prisma, planParams);
      expect(plan.entries[0].disposition).toBe('CREATE_L01_IF_ABSENT');
      const planSha256 = computePlanHash(plan);
      const result = await applyBootstrapPlan(prisma, { ...planParams, expectedPlanSha256: planSha256, confirmationToken: 'APPLY_RM02C1B_TO_SIMPROK_TEST' });
      expect(result.resourceCatalogCreatedDelta).toBe(1);

      const l01 = await prisma.resourceCatalog.findFirstOrThrow({ where: { workspaceId: l01WorkspaceId, code: 'L.01' } });
      expect(l01.name).toBe('Pekerja');
      expect(l01.type).toBe('LABOR');
      expect(l01.baseUnit).toBe('Org/Hari');
    });

    it('18/19/20/21 (CASE 1): pre-existing exact L.01 is reused, UUID and unrelated specification keys preserved, rm02bTestOnly stripped', async () => {
      const preexisting = await prisma.resourceCatalog.create({
        data: {
          workspaceId: l01WorkspaceId,
          code: 'L.01',
          name: 'Pekerja',
          type: 'LABOR',
          baseUnit: 'Org/Hari',
          specifications: { rm02bTestOnly: true, keepMe: 'unrelated-value' },
        },
      });
      // Preexisting.id is the FK-survival proof: it must be byte-identical
      // before/after the apply (see assertion below), never recreated.

      const inventory = makeInventory([
        row({ sourceRowNumber: 9, sourceSection: 'LABOR', rawResourceCodeText: 'L.01', rawResourceNameText: 'Pekerja', rawUnitText: 'Org/Hari', sourceCodeCellAddress: 'D9', sourceNameCellAddress: 'C9', sourceUnitCellAddress: 'E9' }),
      ]);
      const planParams = { inventory, inventoryPath: 'fixture', inventorySha256: 'fixture', workspaceId: l01WorkspaceId, generatedFromGitHead: GIT_HEAD_FIXTURE };
      const plan = await buildPlan(prisma, planParams);
      expect(plan.entries[0].disposition).toBe('REUSE_EXACT_L01');
      const planSha256 = computePlanHash(plan);
      const result = await applyBootstrapPlan(prisma, { ...planParams, expectedPlanSha256: planSha256, confirmationToken: 'APPLY_RM02C1B_TO_SIMPROK_TEST' });
      expect(result.resourceCatalogCreatedDelta).toBe(0);
      expect(result.resourceCatalogReusedDelta).toBe(1);

      const after = await prisma.resourceCatalog.findUniqueOrThrow({ where: { id: preexisting.id } });
      expect(after.id).toBe(preexisting.id);
      expect(after.specifications).toEqual({ keepMe: 'unrelated-value' });

      const prov = await prisma.resourceSourceIdentity.findFirstOrThrow({ where: { resourceCatalogId: preexisting.id } });
      expect(prov.sourceRowNumber).toBe(9);
    });

    it('23/24 (CASE 3): a conflicting L.01 (wrong unit) fails closed and applies nothing', async () => {
      const conflicting = await prisma.resourceCatalog.create({
        data: { workspaceId: l01WorkspaceId, code: 'L.01', name: 'Pekerja', type: 'LABOR', baseUnit: 'WRONG_UNIT' },
      });

      const inventory = makeInventory([
        row({ sourceRowNumber: 9, sourceSection: 'LABOR', rawResourceCodeText: 'L.01', rawResourceNameText: 'Pekerja', rawUnitText: 'Org/Hari' }),
      ]);
      const planParams = { inventory, inventoryPath: 'fixture', inventorySha256: 'fixture', workspaceId: l01WorkspaceId, generatedFromGitHead: GIT_HEAD_FIXTURE };
      const plan = await buildPlan(prisma, planParams);
      expect(plan.entries[0].disposition).toBe('CONFLICT_STOP');
      const planSha256 = computePlanHash(plan);

      await expect(
        applyBootstrapPlan(prisma, { ...planParams, expectedPlanSha256: planSha256, confirmationToken: 'APPLY_RM02C1B_TO_SIMPROK_TEST' }),
      ).rejects.toThrow(/STOP_CONFLICTS_PRESENT/);

      const provCount = await prisma.resourceSourceIdentity.count({ where: { resourceCatalogId: conflicting.id } });
      expect(provCount).toBe(0);
    });
  });
});
