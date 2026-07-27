import { join } from 'node:path';

import {
  CanonicalEvidenceMismatchError,
  EXPECTED_SOURCE_SHA256,
  buildMissingUnitPlan,
  computeMissingUnitPlanHash,
  loadCanonicalInventory,
  verifyOwnerDispositionAgainstEvidence,
} from './resource-catalog-missing-unit-disposition';

const REAL_INVENTORY_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  'docs',
  'implementation-gates',
  'rm02c0-discovery',
  '01-RM02C0-RESOURCE-INVENTORY.json',
);
const REAL_INVENTORY_SHA256 = 'CE2B3AEBC50179FB2DF46D5EB55ED39EF68347421C8F8DE043C6D3CA00E64C46';
const WORKSPACE_A = 'ws-a-fixture';

function mockClient(catalogRows: any[] = [], provenanceRows: any[] = []) {
  return {
    resourceCatalog: {
      findFirst: jest.fn().mockResolvedValue(catalogRows[0] ?? null),
      findUnique: jest.fn().mockImplementation(({ where: { id } }: any) => catalogRows.find((c) => c.id === id) ?? null),
    },
    resourceSourceIdentity: {
      findFirst: jest.fn().mockImplementation(({ where: { sourceRowNumber } }: any) =>
        provenanceRows.find((p) => p.sourceRowNumber === sourceRowNumber) ?? null,
      ),
    },
  } as any;
}

describe('resource-catalog-missing-unit-disposition (unit)', () => {
  describe('evidence verification', () => {
    it('1/2. loads and verifies the real committed inventory (hash + source hash)', () => {
      const { inventory, inventorySha256 } = loadCanonicalInventory(REAL_INVENTORY_PATH, REAL_INVENTORY_SHA256);
      expect(inventorySha256).toBe(REAL_INVENTORY_SHA256);
      expect(inventory.sourceSha256.toUpperCase()).toBe(EXPECTED_SOURCE_SHA256.toUpperCase());
    });

    it('3/4. row 39 and row 104 exact source identity matches the committed inventory', () => {
      const { inventory } = loadCanonicalInventory(REAL_INVENTORY_PATH, REAL_INVENTORY_SHA256);
      expect(() => verifyOwnerDispositionAgainstEvidence(inventory)).not.toThrow();
    });

    it('5/6. throws CanonicalEvidenceMismatchError if row 39/104 rawUnitText is not NULL in the evidence', () => {
      const { inventory } = loadCanonicalInventory(REAL_INVENTORY_PATH, REAL_INVENTORY_SHA256);
      const tampered = {
        ...inventory,
        rows: inventory.rows.map((r) => (r.sourceRowNumber === 39 ? { ...r, rawUnitText: 'Kg' } : r)),
      };
      expect(() => verifyOwnerDispositionAgainstEvidence(tampered)).toThrow(CanonicalEvidenceMismatchError);
      expect(() => verifyOwnerDispositionAgainstEvidence(tampered)).toThrow(/STOP_CANONICAL_EVIDENCE_MISMATCH/);
    });

    it('throws if row 39/104 rawResourceNameText no longer matches (evidence drift)', () => {
      const { inventory } = loadCanonicalInventory(REAL_INVENTORY_PATH, REAL_INVENTORY_SHA256);
      const tampered = {
        ...inventory,
        rows: inventory.rows.map((r) => (r.sourceRowNumber === 104 ? { ...r, rawResourceNameText: 'Batu' } : r)),
      };
      expect(() => verifyOwnerDispositionAgainstEvidence(tampered)).toThrow(/STOP_CANONICAL_EVIDENCE_MISMATCH/);
    });

    it('throws if the expected row is missing from the inventory entirely', () => {
      const { inventory } = loadCanonicalInventory(REAL_INVENTORY_PATH, REAL_INVENTORY_SHA256);
      const tampered = { ...inventory, rows: inventory.rows.filter((r) => r.sourceRowNumber !== 39) };
      expect(() => verifyOwnerDispositionAgainstEvidence(tampered)).toThrow(/STOP_CANONICAL_EVIDENCE_MISMATCH/);
    });
  });

  describe('plan construction', () => {
    it('7/8. row 39 accepted unit is exactly Buah, row 104 exactly M3', async () => {
      const { inventory, inventorySha256 } = loadCanonicalInventory(REAL_INVENTORY_PATH, REAL_INVENTORY_SHA256);
      const plan = await buildMissingUnitPlan(mockClient(), {
        inventory, inventoryPath: REAL_INVENTORY_PATH, inventorySha256, workspaceId: WORKSPACE_A, generatedFromGitHead: 'x',
      });
      const row39 = plan.entries.find((e) => e.sourceRowNumber === 39)!;
      const row104 = plan.entries.find((e) => e.sourceRowNumber === 104)!;
      expect(row39.acceptedBaseUnit).toBe('Buah');
      expect(row104.acceptedBaseUnit).toBe('M3');
    });

    it('10. plan contains exactly two entries, both sourceRawUnit=NULL, canonicalCode=NULL', async () => {
      const { inventory, inventorySha256 } = loadCanonicalInventory(REAL_INVENTORY_PATH, REAL_INVENTORY_SHA256);
      const plan = await buildMissingUnitPlan(mockClient(), {
        inventory, inventoryPath: REAL_INVENTORY_PATH, inventorySha256, workspaceId: WORKSPACE_A, generatedFromGitHead: 'x',
      });
      expect(plan.entries).toHaveLength(2);
      for (const entry of plan.entries) {
        expect(entry.sourceRawUnit).toBeNull();
        expect(entry.canonicalCode).toBeNull();
      }
    });

    it('CREATE_REVIEWED_RESOURCE disposition on a fresh workspace (no existing state)', async () => {
      const { inventory, inventorySha256 } = loadCanonicalInventory(REAL_INVENTORY_PATH, REAL_INVENTORY_SHA256);
      const plan = await buildMissingUnitPlan(mockClient(), {
        inventory, inventoryPath: REAL_INVENTORY_PATH, inventorySha256, workspaceId: WORKSPACE_A, generatedFromGitHead: 'x',
      });
      expect(plan.entries.every((e) => e.disposition === 'CREATE_REVIEWED_RESOURCE')).toBe(true);
    });

    it('9. deterministic plan hash repeats identically across two independent builds', async () => {
      const { inventory, inventorySha256 } = loadCanonicalInventory(REAL_INVENTORY_PATH, REAL_INVENTORY_SHA256);
      const params = { inventory, inventoryPath: REAL_INVENTORY_PATH, inventorySha256, workspaceId: WORKSPACE_A, generatedFromGitHead: 'deadbeef' };
      const plan1 = await buildMissingUnitPlan(mockClient(), params);
      const plan2 = await buildMissingUnitPlan(mockClient(), params);
      expect(computeMissingUnitPlanHash(plan1)).toBe(computeMissingUnitPlanHash(plan2));
    });

    it('11. plan JSON contains no UUID-shaped value or Date object', async () => {
      const { inventory, inventorySha256 } = loadCanonicalInventory(REAL_INVENTORY_PATH, REAL_INVENTORY_SHA256);
      const plan = await buildMissingUnitPlan(mockClient(), {
        inventory, inventoryPath: REAL_INVENTORY_PATH, inventorySha256, workspaceId: WORKSPACE_A, generatedFromGitHead: 'x',
      });
      const json = JSON.stringify(plan);
      const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
      expect(uuidPattern.test(json)).toBe(false);
      const isoDatePattern = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
      expect(isoDatePattern.test(json)).toBe(false);
    });

    it('decisionRecord explicitly labels this as acceptance-only, not a global/production standard', async () => {
      const { inventory, inventorySha256 } = loadCanonicalInventory(REAL_INVENTORY_PATH, REAL_INVENTORY_SHA256);
      const plan = await buildMissingUnitPlan(mockClient(), {
        inventory, inventoryPath: REAL_INVENTORY_PATH, inventorySha256, workspaceId: WORKSPACE_A, generatedFromGitHead: 'x',
      });
      expect(plan.decisionAuthority).toBe('OWNER');
      expect(plan.decisionRecord).toMatch(/ACCEPTANCE-ONLY HUMAN DISPOSITION/);
      expect(plan.decisionRecord).toMatch(/NOT A GLOBAL OR PRODUCTION UNIT STANDARD/);
    });
  });

  describe('idempotency and conflict detection (pure logic)', () => {
    it('IDEMPOTENT_ALREADY_APPLIED when existing provenance and catalog match exactly', async () => {
      const { inventory, inventorySha256 } = loadCanonicalInventory(REAL_INVENTORY_PATH, REAL_INVENTORY_SHA256);
      const row39 = inventory.rows.find((r) => r.sourceRowNumber === 39)!;
      const catalogRows = [
        { id: 'cat-39', workspaceId: WORKSPACE_A, code: null, name: 'Kawat BRC', type: 'MATERIAL', baseUnit: 'Buah', status: 'ACTIVE' },
      ];
      const provenanceRows = [
        {
          id: 'prov-39',
          resourceCatalogId: 'cat-39',
          sourceRowNumber: 39,
          rawCode: null,
          rawName: 'Kawat BRC',
          rawUnit: null,
          sourceCodeCellAddress: row39.sourceCodeCellAddress,
          sourceNameCellAddress: row39.sourceNameCellAddress,
          sourceUnitCellAddress: row39.sourceUnitCellAddress,
        },
      ];
      const plan = await buildMissingUnitPlan(mockClient(catalogRows, provenanceRows), {
        inventory, inventoryPath: REAL_INVENTORY_PATH, inventorySha256, workspaceId: WORKSPACE_A, generatedFromGitHead: 'x',
      });
      const entry39 = plan.entries.find((e) => e.sourceRowNumber === 39)!;
      expect(entry39.disposition).toBe('IDEMPOTENT_ALREADY_APPLIED');
    });

    it('22. CONFLICT_STOP when existing provenance rawName mismatches', async () => {
      const { inventory, inventorySha256 } = loadCanonicalInventory(REAL_INVENTORY_PATH, REAL_INVENTORY_SHA256);
      const catalogRows = [
        { id: 'cat-39', workspaceId: WORKSPACE_A, code: null, name: 'Kawat BRC', type: 'MATERIAL', baseUnit: 'Buah', status: 'ACTIVE' },
      ];
      const provenanceRows = [
        { id: 'prov-39', resourceCatalogId: 'cat-39', sourceRowNumber: 39, rawCode: null, rawName: 'WRONG NAME', rawUnit: null, sourceCodeCellAddress: 'D39', sourceNameCellAddress: 'C39', sourceUnitCellAddress: 'E39' },
      ];
      const plan = await buildMissingUnitPlan(mockClient(catalogRows, provenanceRows), {
        inventory, inventoryPath: REAL_INVENTORY_PATH, inventorySha256, workspaceId: WORKSPACE_A, generatedFromGitHead: 'x',
      });
      const entry39 = plan.entries.find((e) => e.sourceRowNumber === 39)!;
      expect(entry39.disposition).toBe('CONFLICT_STOP');
      expect(entry39.conflictReason).toMatch(/STOP_EXISTING_PROVENANCE_CONFLICT/);
    });

    it('23. CONFLICT_STOP when an exact unproven candidate exists at the approved unit', async () => {
      const { inventory, inventorySha256 } = loadCanonicalInventory(REAL_INVENTORY_PATH, REAL_INVENTORY_SHA256);
      const catalogRows = [
        { id: 'preexisting', workspaceId: WORKSPACE_A, code: null, name: 'Kawat BRC', type: 'MATERIAL', baseUnit: 'Buah', status: 'ACTIVE' },
      ];
      const client = mockClient(catalogRows, []);
      // findFirst for resourceCatalog should return the unproven candidate
      // when queried by name/type/baseUnit (no provenance exists yet).
      client.resourceCatalog.findFirst = jest.fn().mockResolvedValue(catalogRows[0]);
      const plan = await buildMissingUnitPlan(client, {
        inventory, inventoryPath: REAL_INVENTORY_PATH, inventorySha256, workspaceId: WORKSPACE_A, generatedFromGitHead: 'x',
      });
      const entry39 = plan.entries.find((e) => e.sourceRowNumber === 39)!;
      expect(entry39.disposition).toBe('CONFLICT_STOP');
      expect(entry39.conflictReason).toMatch(/STOP_EXISTING_UNPROVEN_RESOURCE_COLLISION/);
    });

    it('24. a same-name/different-unit candidate does NOT block — CASE E is structurally distinct from CASE D', async () => {
      const { inventory, inventorySha256 } = loadCanonicalInventory(REAL_INVENTORY_PATH, REAL_INVENTORY_SHA256);
      // A pre-existing "Kawat BRC" at a DIFFERENT unit than the approved
      // "Buah" must never be matched by the CASE D lookup (which filters by
      // the approved unit specifically), so it must never block creation.
      const client = mockClient();
      client.resourceCatalog.findFirst = jest.fn().mockResolvedValue(null); // no match at the approved unit
      const plan = await buildMissingUnitPlan(client, {
        inventory, inventoryPath: REAL_INVENTORY_PATH, inventorySha256, workspaceId: WORKSPACE_A, generatedFromGitHead: 'x',
      });
      const entry39 = plan.entries.find((e) => e.sourceRowNumber === 39)!;
      expect(entry39.disposition).toBe('CREATE_REVIEWED_RESOURCE');
    });
  });
});
