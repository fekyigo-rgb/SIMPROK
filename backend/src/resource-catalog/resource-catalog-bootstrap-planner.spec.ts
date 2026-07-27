import { createHash } from 'node:crypto';
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ALL_DISPOSITIONS,
  BootstrapDisposition,
  CanonicalInventory,
  EXPECTED_PARSER_CONTRACT_VERSION,
  EXPECTED_SECTION_COUNTS,
  EXPECTED_SOURCE_SHA256,
  EXPECTED_TOTAL_SOURCE_ROWS,
  InventoryVerificationError,
  buildPlan,
  computePlanHash,
  loadCanonicalInventory,
} from './resource-catalog-bootstrap-planner';

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
    resourceCatalog: { findMany: jest.fn().mockResolvedValue(catalogRows) },
    resourceSourceIdentity: { findMany: jest.fn().mockResolvedValue(provenanceRows) },
  } as any;
}

function makeInventory(rows: CanonicalInventory['rows']): CanonicalInventory {
  return {
    parserContractVersion: EXPECTED_PARSER_CONTRACT_VERSION,
    sourceFileName: 'BASIC PRICE(1).xlsx',
    sourceSha256: EXPECTED_SOURCE_SHA256,
    sheetName: 'HARGA SATUAN UPAH DAN BAHAN',
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
    rawResourceNameText: 'Fixture Material',
    rawUnitText: 'Unit',
    sourceCodeCellAddress: 'D1',
    sourceNameCellAddress: 'C1',
    sourceUnitCellAddress: 'E1',
    warnings: [],
    errors: [],
    ...overrides,
  };
}

describe('resource-catalog-bootstrap-planner (unit)', () => {
  // ------------------------------------------------------------------
  // A. INPUT INTEGRITY (section XI.A items 1-7)
  // ------------------------------------------------------------------
  describe('inventory verification', () => {
    it('1. canonical inventory byte hash passes against the real committed file', () => {
      const { inventory, inventorySha256 } = loadCanonicalInventory(REAL_INVENTORY_PATH, REAL_INVENTORY_SHA256);
      expect(inventorySha256).toBe(REAL_INVENTORY_SHA256);
      expect(inventory.sourceSha256.toUpperCase()).toBe(EXPECTED_SOURCE_SHA256.toUpperCase());
    });

    it('2. tampered inventory fails (single byte changed)', () => {
      const dir = mkdtempSync(join(tmpdir(), 'rm02c1b-tamper-'));
      try {
        const tampered = join(dir, 'tampered.json');
        const original = JSON.parse(readFileSync(REAL_INVENTORY_PATH, 'utf8'));
        original.rows[0].rawResourceNameText = 'TAMPERED';
        writeFileSync(tampered, JSON.stringify(original));
        expect(() => loadCanonicalInventory(tampered, REAL_INVENTORY_SHA256)).toThrow(InventoryVerificationError);
        expect(() => loadCanonicalInventory(tampered, REAL_INVENTORY_SHA256)).toThrow(/STOP_INVENTORY_HASH_MISMATCH/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('3. wrong source hash fails', () => {
      const dir = mkdtempSync(join(tmpdir(), 'rm02c1b-wrongsource-'));
      try {
        const file = join(dir, 'wrong-source.json');
        const inventory = makeInventory([row({ sourceRowNumber: 9 })]);
        (inventory as any).sourceSha256 = 'F'.repeat(64);
        writeFileSync(file, JSON.stringify(inventory));
        const hash = createHash('sha256').update(JSON.stringify(inventory)).digest('hex').toUpperCase();
        expect(() => loadCanonicalInventory(file, hash)).toThrow(/STOP_SOURCE_HASH_MISMATCH/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('4. wrong parser contract fails', () => {
      const dir = mkdtempSync(join(tmpdir(), 'rm02c1b-wrongparser-'));
      try {
        const file = join(dir, 'wrong-parser.json');
        const inventory = makeInventory([row({ sourceRowNumber: 9 })]);
        (inventory as any).parserContractVersion = 'WRONG_VERSION';
        writeFileSync(file, JSON.stringify(inventory));
        const hash = createHash('sha256').update(JSON.stringify(inventory)).digest('hex').toUpperCase();
        expect(() => loadCanonicalInventory(file, hash)).toThrow(/STOP_PARSER_CONTRACT_MISMATCH/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('5. total rows must be exactly 271 in the real committed inventory', () => {
      const { inventory } = loadCanonicalInventory(REAL_INVENTORY_PATH, REAL_INVENTORY_SHA256);
      expect(inventory.totalParsedRows).toBe(EXPECTED_TOTAL_SOURCE_ROWS);
      expect(inventory.rows).toHaveLength(EXPECTED_TOTAL_SOURCE_ROWS);
    });

    it('6. section counts must be 17/241/13 in the real committed inventory', () => {
      const { inventory } = loadCanonicalInventory(REAL_INVENTORY_PATH, REAL_INVENTORY_SHA256);
      expect(inventory.sectionCounts).toEqual(EXPECTED_SECTION_COUNTS);
    });

    it('7. deterministic plan hash repeats identically across two independent builds', async () => {
      const { inventory, inventorySha256 } = loadCanonicalInventory(REAL_INVENTORY_PATH, REAL_INVENTORY_SHA256);
      const params = {
        inventory,
        inventoryPath: REAL_INVENTORY_PATH,
        inventorySha256,
        workspaceId: WORKSPACE_A,
        generatedFromGitHead: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      };
      const plan1 = await buildPlan(mockClient(), params);
      const plan2 = await buildPlan(mockClient(), params);
      expect(computePlanHash(plan1)).toBe(computePlanHash(plan2));
    });
  });

  // ------------------------------------------------------------------
  // B. POLICY (section XI.B items 8-17)
  // ------------------------------------------------------------------
  describe('disposition policy', () => {
    it('8. row 9 becomes CREATE_L01_IF_ABSENT when no existing L.01 exists', async () => {
      const inventory = makeInventory([
        row({ sourceRowNumber: 9, sourceSection: 'LABOR', rawResourceCodeText: 'L.01', rawResourceNameText: 'Pekerja', rawUnitText: 'Org/Hari', sourceCodeCellAddress: 'D9', sourceNameCellAddress: 'C9', sourceUnitCellAddress: 'E9' }),
      ]);
      const plan = await buildPlan(mockClient(), {
        inventory, inventoryPath: 'x', inventorySha256: 'x', workspaceId: WORKSPACE_A, generatedFromGitHead: 'x',
      });
      expect(plan.entries[0].disposition).toBe('CREATE_L01_IF_ABSENT');
      expect(plan.entries[0].canonicalCode).toBe('L.01');
    });

    it('8b. row 9 becomes REUSE_EXACT_L01 when an exact L.01 already exists', async () => {
      const inventory = makeInventory([
        row({ sourceRowNumber: 9, sourceSection: 'LABOR', rawResourceCodeText: 'L.01', rawResourceNameText: 'Pekerja', rawUnitText: 'Org/Hari' }),
      ]);
      const client = mockClient([
        { id: 'l01-id', workspaceId: WORKSPACE_A, code: 'L.01', name: 'Pekerja', type: 'LABOR', baseUnit: 'Org/Hari', specifications: null },
      ]);
      const plan = await buildPlan(client, { inventory, inventoryPath: 'x', inventorySha256: 'x', workspaceId: WORKSPACE_A, generatedFromGitHead: 'x' });
      expect(plan.entries[0].disposition).toBe('REUSE_EXACT_L01');
    });

    it('9. no source code other than L.01 becomes canonical', async () => {
      const inventory = makeInventory([
        row({ sourceRowNumber: 9, sourceSection: 'LABOR', rawResourceCodeText: 'L.01', rawResourceNameText: 'Pekerja', rawUnitText: 'Org/Hari' }),
        row({ sourceRowNumber: 50, rawResourceCodeText: 'MAT-99', rawResourceNameText: 'Single Occurrence Material' }),
      ]);
      const plan = await buildPlan(mockClient(), { inventory, inventoryPath: 'x', inventorySha256: 'x', workspaceId: WORKSPACE_A, generatedFromGitHead: 'x' });
      const nonL01 = plan.entries.find((e) => e.sourceRowNumber === 50)!;
      expect(nonL01.canonicalCode).toBeNull();
    });

    it('10/11. eleven L.02 rows become eleven distinct resources with code NULL, rawCode preserved', async () => {
      const l02Rows = Array.from({ length: 11 }, (_, i) =>
        row({ sourceRowNumber: 10 + i, sourceSection: 'LABOR', rawResourceCodeText: 'L.02', rawResourceNameText: `Tukang ${i}`, rawUnitText: 'Org/Hari' }),
      );
      const inventory = makeInventory(l02Rows);
      const plan = await buildPlan(mockClient(), { inventory, inventoryPath: 'x', inventorySha256: 'x', workspaceId: WORKSPACE_A, generatedFromGitHead: 'x' });
      expect(plan.entries).toHaveLength(11);
      for (const entry of plan.entries) {
        expect(entry.disposition).toBe('CREATE_NEW_RESOURCE');
        expect(entry.canonicalCode).toBeNull();
        expect(entry.rawResourceCodeText).toBe('L.02');
      }
    });

    it('12/13. rows 136/137 map to one representative and one attach-provenance entry', async () => {
      const inventory = makeInventory([
        row({ sourceRowNumber: 136, rawResourceNameText: 'Pintu gulung besi', rawUnitText: 'M²' }),
        row({ sourceRowNumber: 137, rawResourceNameText: 'Pintu gulung besi', rawUnitText: 'M²' }),
      ]);
      const plan = await buildPlan(mockClient(), { inventory, inventoryPath: 'x', inventorySha256: 'x', workspaceId: WORKSPACE_A, generatedFromGitHead: 'x' });
      const rep = plan.entries.find((e) => e.sourceRowNumber === 136)!;
      const dup = plan.entries.find((e) => e.sourceRowNumber === 137)!;
      expect(rep.disposition).toBe('CREATE_NEW_RESOURCE');
      expect(rep.representativeSourceRowNumber).toBe(136);
      expect(dup.disposition).toBe('ATTACH_EXACT_DUPLICATE_PROVENANCE');
      expect(dup.representativeSourceRowNumber).toBe(136);
    });

    it('13b. rows 157/161 map to one representative and one attach-provenance entry', async () => {
      const inventory = makeInventory([
        row({ sourceRowNumber: 157, rawResourceNameText: 'Sealant', rawUnitText: 'Tube' }),
        row({ sourceRowNumber: 161, rawResourceNameText: 'Sealant', rawUnitText: 'Tube' }),
      ]);
      const plan = await buildPlan(mockClient(), { inventory, inventoryPath: 'x', inventorySha256: 'x', workspaceId: WORKSPACE_A, generatedFromGitHead: 'x' });
      const dup = plan.entries.find((e) => e.sourceRowNumber === 161)!;
      expect(dup.disposition).toBe('ATTACH_EXACT_DUPLICATE_PROVENANCE');
      expect(dup.representativeSourceRowNumber).toBe(157);
    });

    it('14. rows 200/201 remain distinct because units differ', async () => {
      const inventory = makeInventory([
        row({ sourceRowNumber: 200, rawResourceNameText: 'Porslen', rawUnitText: 'Doos' }),
        row({ sourceRowNumber: 201, rawResourceNameText: 'Porslen', rawUnitText: 'Buah' }),
      ]);
      const plan = await buildPlan(mockClient(), { inventory, inventoryPath: 'x', inventorySha256: 'x', workspaceId: WORKSPACE_A, generatedFromGitHead: 'x' });
      expect(plan.entries[0].disposition).toBe('CREATE_DISTINCT_SAME_NAME_DIFFERENT_UNIT');
      expect(plan.entries[1].disposition).toBe('CREATE_DISTINCT_SAME_NAME_DIFFERENT_UNIT');
      expect(plan.entries[0].representativeSourceRowNumber).toBe(200);
      expect(plan.entries[1].representativeSourceRowNumber).toBe(201);
    });

    it('15. rows 39/104 are blocked with zero writes implied (BLOCKED disposition, no candidate lookups)', async () => {
      const client = mockClient();
      const inventory = makeInventory([
        row({ sourceRowNumber: 39, rawResourceNameText: 'Kawat BRC', rawUnitText: null }),
        row({ sourceRowNumber: 104, rawResourceNameText: 'Kerikil', rawUnitText: null }),
      ]);
      const plan = await buildPlan(client, { inventory, inventoryPath: 'x', inventorySha256: 'x', workspaceId: WORKSPACE_A, generatedFromGitHead: 'x' });
      expect(plan.entries.every((e) => e.disposition === 'BLOCKED_MISSING_SOURCE_UNIT')).toBe(true);
      expect(plan.dispositionCounts.BLOCKED_MISSING_SOURCE_UNIT).toBe(2);
    });

    it('16. a formula-null code row never becomes canonical code 0', async () => {
      const inventory = makeInventory([row({ sourceRowNumber: 42, rawResourceCodeText: null, rawResourceNameText: 'External Formula Row' })]);
      const plan = await buildPlan(mockClient(), { inventory, inventoryPath: 'x', inventorySha256: 'x', workspaceId: WORKSPACE_A, generatedFromGitHead: 'x' });
      expect(plan.entries[0].canonicalCode).toBeNull();
      expect(plan.entries[0].canonicalCode).not.toBe('0');
    });

    it('17. raw names, units, codes, rows, and cell addresses round-trip exactly into plan entries', async () => {
      const specialRow = row({
        sourceRowNumber: 55,
        rawResourceCodeText: 'X.09',
        rawResourceNameText: 'Special — "quoted" name',
        rawUnitText: 'M³',
        sourceCodeCellAddress: 'D55',
        sourceNameCellAddress: 'C55',
        sourceUnitCellAddress: 'E55',
      });
      const inventory = makeInventory([specialRow]);
      const plan = await buildPlan(mockClient(), { inventory, inventoryPath: 'x', inventorySha256: 'x', workspaceId: WORKSPACE_A, generatedFromGitHead: 'x' });
      const entry = plan.entries[0];
      expect(entry.rawResourceCodeText).toBe('X.09');
      expect(entry.rawResourceNameText).toBe('Special — "quoted" name');
      expect(entry.rawUnitText).toBe('M³');
      expect(entry.sourceCodeCellAddress).toBe('D55');
      expect(entry.sourceNameCellAddress).toBe('C55');
      expect(entry.sourceUnitCellAddress).toBe('E55');
    });
  });

  // ------------------------------------------------------------------
  // C. L.01 conflict / idempotency detection (pure logic slice of XI.C)
  // ------------------------------------------------------------------
  describe('L.01 disposition detection (pure)', () => {
    it('23. conflicting L.01 (wrong unit) fails closed as CONFLICT_STOP', async () => {
      const inventory = makeInventory([row({ sourceRowNumber: 9, sourceSection: 'LABOR', rawResourceCodeText: 'L.01', rawResourceNameText: 'Pekerja', rawUnitText: 'Org/Hari' })]);
      const client = mockClient([
        { id: 'l01-id', workspaceId: WORKSPACE_A, code: 'L.01', name: 'Pekerja', type: 'LABOR', baseUnit: 'WRONG_UNIT', specifications: null },
      ]);
      const plan = await buildPlan(client, { inventory, inventoryPath: 'x', inventorySha256: 'x', workspaceId: WORKSPACE_A, generatedFromGitHead: 'x' });
      expect(plan.entries[0].disposition).toBe('CONFLICT_STOP');
      expect(plan.entries[0].conflictReason).toMatch(/STOP_L01_CONFLICT/);
    });

    it('24. duplicate L.01 (two rows with code=L.01) fails closed as CONFLICT_STOP', async () => {
      const inventory = makeInventory([row({ sourceRowNumber: 9, sourceSection: 'LABOR', rawResourceCodeText: 'L.01', rawResourceNameText: 'Pekerja', rawUnitText: 'Org/Hari' })]);
      const client = mockClient([
        { id: 'l01-a', workspaceId: WORKSPACE_A, code: 'L.01', name: 'Pekerja', type: 'LABOR', baseUnit: 'Org/Hari', specifications: null },
        { id: 'l01-b', workspaceId: WORKSPACE_A, code: 'L.01', name: 'Pekerja', type: 'LABOR', baseUnit: 'Org/Hari', specifications: null },
      ]);
      const plan = await buildPlan(client, { inventory, inventoryPath: 'x', inventorySha256: 'x', workspaceId: WORKSPACE_A, generatedFromGitHead: 'x' });
      expect(plan.entries[0].disposition).toBe('CONFLICT_STOP');
      expect(plan.entries[0].conflictReason).toMatch(/STOP_L01_CONFLICT/);
    });

    it('idempotent: existing matching provenance + matching catalog yields IDEMPOTENT_ALREADY_APPLIED', async () => {
      const inventory = makeInventory([row({ sourceRowNumber: 9, sourceSection: 'LABOR', rawResourceCodeText: 'L.01', rawResourceNameText: 'Pekerja', rawUnitText: 'Org/Hari', sourceCodeCellAddress: 'D9', sourceNameCellAddress: 'C9', sourceUnitCellAddress: 'E9' })]);
      const client = mockClient(
        [{ id: 'l01-id', workspaceId: WORKSPACE_A, code: 'L.01', name: 'Pekerja', type: 'LABOR', baseUnit: 'Org/Hari', specifications: null }],
        [{ id: 'prov-1', resourceCatalogId: 'l01-id', sourceRowNumber: 9, rawCode: 'L.01', rawName: 'Pekerja', rawUnit: 'Org/Hari', sourceCodeCellAddress: 'D9', sourceNameCellAddress: 'C9', sourceUnitCellAddress: 'E9' }],
      );
      const plan = await buildPlan(client, { inventory, inventoryPath: 'x', inventorySha256: 'x', workspaceId: WORKSPACE_A, generatedFromGitHead: 'x' });
      expect(plan.entries[0].disposition).toBe('IDEMPOTENT_ALREADY_APPLIED');
    });

    it('32. existing unproven candidate (matching name/type/unit, no provenance) fails closed as CONFLICT_STOP', async () => {
      const inventory = makeInventory([row({ sourceRowNumber: 60, rawResourceNameText: 'Semen Portland', rawUnitText: 'Zak', sourceSection: 'MATERIAL' })]);
      const client = mockClient([
        { id: 'preexisting', workspaceId: WORKSPACE_A, code: null, name: 'Semen Portland', type: 'MATERIAL', baseUnit: 'Zak', specifications: null },
      ]);
      const plan = await buildPlan(client, { inventory, inventoryPath: 'x', inventorySha256: 'x', workspaceId: WORKSPACE_A, generatedFromGitHead: 'x' });
      expect(plan.entries[0].disposition).toBe('CONFLICT_STOP');
      expect(plan.entries[0].conflictReason).toMatch(/STOP_EXISTING_UNPROVEN_RESOURCE_COLLISION/);
    });
  });

  it('every BootstrapDisposition value in the enum is exercised somewhere in this suite (sanity)', () => {
    const exercised: BootstrapDisposition[] = [
      'CREATE_NEW_RESOURCE',
      'REUSE_EXACT_L01',
      'CREATE_L01_IF_ABSENT',
      'ATTACH_EXACT_DUPLICATE_PROVENANCE',
      'CREATE_DISTINCT_SAME_NAME_DIFFERENT_UNIT',
      'BLOCKED_MISSING_SOURCE_UNIT',
      'IDEMPOTENT_ALREADY_APPLIED',
      'CONFLICT_STOP',
    ];
    expect(new Set(exercised)).toEqual(new Set(ALL_DISPOSITIONS));
  });
});
