import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * RM-02C1a — Resource Identity & Provenance Schema Foundation.
 *
 * No new endpoint exists in this slice, so these tests exercise the schema,
 * migration, and database-level tenancy triggers directly (Prisma Client for
 * ORM-path assertions, raw `pg` for exact trigger/constraint error text).
 *
 * Items 1-2 of the RM-02C1a test contract ("Prisma schema validates",
 * "Prisma Client generates") are covered by the permanent quality gates
 * (`prisma validate`, `prisma generate`), not duplicated here.
 */

const TAG = 'RM02C1A';
const MIGRATION_SQL_PATH = join(
  __dirname,
  '..',
  '..',
  'prisma',
  'migrations',
  '20260727025308_rm02c1a_resource_identity_schema_foundation',
  'migration.sql',
);
// Genuine 64-char uppercase hex digest (sha256 of a fixture-only string) — a
// clearly synthetic value, not a real workbook hash, but shaped exactly like
// the canonical storage convention this constraint enforces.
const CANONICAL_SHA = '35EB54B582B917AC983A0FA4EA7474602DA1E979734DF2CB5F853CD17013001D';

describe('RM-02C1a Resource Identity Schema Foundation (e2e)', () => {
  let prisma: PrismaClient;
  let pg: Client;

  let orgId: string;
  let workspaceAId: string;
  let workspaceBId: string;

  const createdCatalogIds: string[] = [];
  const createdProvenanceIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient();
    pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();

    const org = await prisma.organization.create({ data: { name: `${TAG} Org`, type: 'COMPANY' } });
    orgId = org.id;
    const wsA = await prisma.workspace.create({ data: { name: `${TAG} Workspace A`, organizationId: orgId } });
    workspaceAId = wsA.id;
    const wsB = await prisma.workspace.create({ data: { name: `${TAG} Workspace B`, organizationId: orgId } });
    workspaceBId = wsB.id;
  });

  afterAll(async () => {
    // Provenance rows first (FK RESTRICT prevents deleting a referenced catalog).
    if (createdProvenanceIds.length > 0) {
      await prisma.resourceSourceIdentity.deleteMany({ where: { id: { in: createdProvenanceIds } } });
    }
    if (createdCatalogIds.length > 0) {
      await prisma.resourceCatalog.deleteMany({ where: { id: { in: createdCatalogIds } } });
    }
    await prisma.workspace.deleteMany({ where: { id: { in: [workspaceAId, workspaceBId] } } });
    await prisma.organization.delete({ where: { id: orgId } });

    await pg.end();
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------
  // Migration content — static checks
  // ---------------------------------------------------------------------

  describe('migration.sql content', () => {
    const sql = readFileSync(MIGRATION_SQL_PATH, 'utf8');

    it('contains zero business-data DML (item 3, H8)', () => {
      const dmlPattern = /\b(INSERT\s+INTO|UPDATE\s+"|DELETE\s+FROM)\b/i;
      expect(dmlPattern.test(sql)).toBe(false);
    });

    it('drops the exact old compound unique index by name (no IF EXISTS)', () => {
      expect(sql).toContain('DROP INDEX "resource_catalogs_workspaceId_code_key";');
      expect(sql).not.toContain('DROP INDEX IF EXISTS "resource_catalogs_workspaceId_code_key"');
    });

    it('creates the manual partial unique index with the exact predicate', () => {
      expect(sql).toContain('CREATE UNIQUE INDEX "resource_catalogs_workspace_code_nonnull_key"');
      expect(sql).toContain('WHERE "workspaceId" IS NOT NULL');
      expect(sql).toContain('AND "code" IS NOT NULL;');
    });

    it('adds the sourceSha256 CHECK constraint with the exact 64-uppercase-hex predicate', () => {
      expect(sql).toContain("CHECK (\"sourceSha256\" ~ '^[0-9A-F]{64}$');");
    });
  });

  // ---------------------------------------------------------------------
  // Structural facts (items 4, 5, 6, H1)
  // ---------------------------------------------------------------------

  describe('structural facts', () => {
    it('4: ResourceCatalog.code is nullable', async () => {
      const result = await pg.query<{ is_nullable: string }>(
        `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'resource_catalogs' AND column_name = 'code'`,
      );
      expect(result.rows[0]?.is_nullable).toBe('YES');
    });

    it('5: partial unique index exists with the exact predicate', async () => {
      const result = await pg.query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes WHERE indexname = 'resource_catalogs_workspace_code_nonnull_key'`,
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].indexdef).toContain('WHERE (("workspaceId" IS NOT NULL) AND (code IS NOT NULL))');
    });

    it('6: old compound unique index is absent', async () => {
      const result = await pg.query(
        `SELECT indexname FROM pg_indexes WHERE indexname = 'resource_catalogs_workspaceId_code_key'`,
      );
      expect(result.rows).toHaveLength(0);
    });

    it('H1: both trigger functions and both triggers exist with exact expected names', async () => {
      const functions = await pg.query<{ proname: string }>(
        `SELECT proname FROM pg_proc WHERE proname IN ('check_resource_source_identity_workspace_match', 'check_resource_catalog_workspace_immutable_with_provenance') ORDER BY proname`,
      );
      expect(functions.rows.map((r) => r.proname)).toEqual([
        'check_resource_catalog_workspace_immutable_with_provenance',
        'check_resource_source_identity_workspace_match',
      ]);

      const triggers = await pg.query<{ tgname: string }>(
        `SELECT tgname FROM pg_trigger WHERE tgname IN ('resource_source_identity_workspace_match_trigger', 'resource_catalog_workspace_immutable_with_provenance_trigger') ORDER BY tgname`,
      );
      expect(triggers.rows.map((r) => r.tgname)).toEqual([
        'resource_catalog_workspace_immutable_with_provenance_trigger',
        'resource_source_identity_workspace_match_trigger',
      ]);
    });
  });

  // ---------------------------------------------------------------------
  // ResourceCatalog.code nullability behavior (items 7, 8, 9, 16, 17)
  // ---------------------------------------------------------------------

  describe('ResourceCatalog.code nullability', () => {
    it('7: duplicate non-null code in the same workspace fails', async () => {
      const first = await prisma.resourceCatalog.create({
        data: { workspaceId: workspaceAId, code: `${TAG}-DUP`, name: `${TAG} First`, type: 'MATERIAL', baseUnit: 'Unit' },
      });
      createdCatalogIds.push(first.id);

      const error = await prisma.resourceCatalog
        .create({
          data: { workspaceId: workspaceAId, code: `${TAG}-DUP`, name: `${TAG} Second`, type: 'MATERIAL', baseUnit: 'Unit' },
        })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      expect((error as Prisma.PrismaClientKnownRequestError).code).toBe('P2002');
      expect((error as Prisma.PrismaClientKnownRequestError).meta?.target).toEqual(['workspaceId', 'code']);
    });

    it('8: same non-null code in different workspaces passes', async () => {
      const a = await prisma.resourceCatalog.create({
        data: { workspaceId: workspaceAId, code: `${TAG}-CROSS`, name: `${TAG} Cross A`, type: 'MATERIAL', baseUnit: 'Unit' },
      });
      const b = await prisma.resourceCatalog.create({
        data: { workspaceId: workspaceBId, code: `${TAG}-CROSS`, name: `${TAG} Cross B`, type: 'MATERIAL', baseUnit: 'Unit' },
      });
      createdCatalogIds.push(a.id, b.id);
      expect(a.code).toBe(`${TAG}-CROSS`);
      expect(b.code).toBe(`${TAG}-CROSS`);
    });

    it('9: multiple NULL-code rows in one workspace pass; 16/17: no code is auto-generated', async () => {
      const first = await prisma.resourceCatalog.create({
        data: { workspaceId: workspaceAId, name: `${TAG} Null 1`, type: 'MATERIAL', baseUnit: 'Unit' },
      });
      const second = await prisma.resourceCatalog.create({
        data: { workspaceId: workspaceAId, name: `${TAG} Null 2`, type: 'MATERIAL', baseUnit: 'Unit' },
      });
      createdCatalogIds.push(first.id, second.id);
      expect(first.code).toBeNull();
      expect(second.code).toBeNull();
      expect(first.code).not.toBe('0');
      expect(second.code).not.toBe('0');
    });

    it('15: deleting a resource with provenance fails closed', async () => {
      const catalog = await prisma.resourceCatalog.create({
        data: { workspaceId: workspaceAId, code: `${TAG}-DEL`, name: `${TAG} Delete Guard`, type: 'LABOR', baseUnit: 'Org/Hari' },
      });
      createdCatalogIds.push(catalog.id);
      const provenance = await prisma.resourceSourceIdentity.create({
        data: {
          resourceCatalogId: catalog.id,
          workspaceId: workspaceAId,
          sourceSha256: CANONICAL_SHA,
          sourceFileName: 'x.xlsx',
          parserContractVersion: 'v1',
          sheetName: 'sheet',
          sourceRowNumber: 1,
          sourceSection: 'LABOR',
          sourceNameCellAddress: 'C1',
          rawName: 'x',
        },
      });
      createdProvenanceIds.push(provenance.id);

      const error = await prisma.resourceCatalog
        .delete({ where: { id: catalog.id } })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      expect((error as Prisma.PrismaClientKnownRequestError).code).toBe('P2003');
    });
  });

  // ---------------------------------------------------------------------
  // ResourceSourceIdentity provenance behavior (items 10, 11, 12, 13, 14)
  // ---------------------------------------------------------------------

  describe('ResourceSourceIdentity provenance', () => {
    it('10/12/13/14: accepts rawCode NULL, rawUnit NULL, and round-trips raw text exactly', async () => {
      const catalog = await prisma.resourceCatalog.create({
        data: { workspaceId: workspaceAId, code: 'L.01', name: `${TAG} Pekerja`, type: 'LABOR', baseUnit: 'Org/Hari' },
      });
      createdCatalogIds.push(catalog.id);

      const rawName = 'Pekerja — "spesial" ‘quote’ 100%';
      const provenance = await prisma.resourceSourceIdentity.create({
        data: {
          resourceCatalogId: catalog.id,
          workspaceId: workspaceAId,
          sourceSha256: CANONICAL_SHA,
          sourceFileName: 'BASIC PRICE(1).xlsx',
          parserContractVersion: 'RM02_BASIC_PRICE_01_V1',
          sheetName: 'HARGA SATUAN UPAH DAN BAHAN',
          sourceRowNumber: 9,
          sourceSection: 'LABOR',
          sourceCodeCellAddress: 'D9',
          sourceNameCellAddress: 'C9',
          sourceUnitCellAddress: 'E9',
          rawCode: null,
          rawName,
          rawUnit: null,
        },
      });
      createdProvenanceIds.push(provenance.id);

      expect(provenance.rawCode).toBeNull();
      expect(provenance.rawUnit).toBeNull();
      expect(provenance.rawName).toBe(rawName);

      const reread = await prisma.resourceSourceIdentity.findUniqueOrThrow({ where: { id: provenance.id } });
      expect(reread.rawName).toBe(rawName);
    });

    it('11: duplicate provenance locator in the same workspace fails', async () => {
      const catalog = await prisma.resourceCatalog.create({
        data: { workspaceId: workspaceAId, name: `${TAG} Dup Locator`, type: 'MATERIAL', baseUnit: 'Zak' },
      });
      createdCatalogIds.push(catalog.id);

      const locator = {
        workspaceId: workspaceAId,
        sourceSha256: CANONICAL_SHA,
        sourceFileName: 'x.xlsx',
        parserContractVersion: 'v1',
        sheetName: 'DupSheet',
        sourceRowNumber: 42,
        sourceSection: 'MATERIAL' as const,
        sourceNameCellAddress: 'C42',
        rawName: 'x',
      };
      const first = await prisma.resourceSourceIdentity.create({
        data: { resourceCatalogId: catalog.id, ...locator },
      });
      createdProvenanceIds.push(first.id);

      const error = await prisma.resourceSourceIdentity
        .create({ data: { resourceCatalogId: catalog.id, ...locator } })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      expect((error as Prisma.PrismaClientKnownRequestError).code).toBe('P2002');
      expect((error as Prisma.PrismaClientKnownRequestError).meta?.target).toEqual([
        'workspaceId',
        'sourceSha256',
        'sheetName',
        'sourceRowNumber',
        'parserContractVersion',
      ]);
    });
  });

  // ---------------------------------------------------------------------
  // Tenancy enforcement (H2, H3, H4, H7 — cannot be bypassed by Prisma Client)
  // ---------------------------------------------------------------------

  describe('tenancy enforcement triggers', () => {
    it('H2/H7: cross-workspace provenance insert is rejected even via Prisma Client', async () => {
      const catalog = await prisma.resourceCatalog.create({
        data: { workspaceId: workspaceAId, name: `${TAG} Cross Tenant Guard`, type: 'MATERIAL', baseUnit: 'Unit' },
      });
      createdCatalogIds.push(catalog.id);

      await expect(
        prisma.resourceSourceIdentity.create({
          data: {
            resourceCatalogId: catalog.id,
            workspaceId: workspaceBId, // mismatch: catalog belongs to Workspace A
            sourceSha256: CANONICAL_SHA,
            sourceFileName: 'x.xlsx',
            parserContractVersion: 'v1',
            sheetName: 'CrossTenant',
            sourceRowNumber: 1,
            sourceSection: 'MATERIAL',
            sourceNameCellAddress: 'C1',
            rawName: 'x',
          },
        }),
      ).rejects.toThrow(/RESOURCE_SOURCE_IDENTITY_WORKSPACE_MISMATCH/);
    });

    it('H2b: trigger 1 also fires on UPDATE of an existing provenance row, not just INSERT', async () => {
      const catalogA = await prisma.resourceCatalog.create({
        data: { workspaceId: workspaceAId, name: `${TAG} Update Trigger Guard A`, type: 'MATERIAL', baseUnit: 'Unit' },
      });
      createdCatalogIds.push(catalogA.id);
      const provenance = await prisma.resourceSourceIdentity.create({
        data: {
          resourceCatalogId: catalogA.id,
          workspaceId: workspaceAId,
          sourceSha256: CANONICAL_SHA,
          sourceFileName: 'x.xlsx',
          parserContractVersion: 'v1',
          sheetName: 'UpdateTriggerGuard',
          sourceRowNumber: 1,
          sourceSection: 'MATERIAL',
          sourceNameCellAddress: 'C1',
          rawName: 'x',
        },
      });
      createdProvenanceIds.push(provenance.id);

      // A no-op update (same workspaceId) must still succeed.
      const noop = await prisma.resourceSourceIdentity.update({
        where: { id: provenance.id },
        data: { workspaceId: workspaceAId },
      });
      expect(noop.workspaceId).toBe(workspaceAId);

      // Updating an existing provenance row to point at a mismatched
      // workspace must be rejected by the same trigger that guards INSERT.
      await expect(
        prisma.resourceSourceIdentity.update({
          where: { id: provenance.id },
          data: { workspaceId: workspaceBId },
        }),
      ).rejects.toThrow(/RESOURCE_SOURCE_IDENTITY_WORKSPACE_MISMATCH/);
    });

    it('H3: global-resource (workspaceId NULL) provenance insert is rejected', async () => {
      const globalCatalog = await prisma.resourceCatalog.create({
        data: { workspaceId: null, name: `${TAG} Global Guard`, type: 'MATERIAL', baseUnit: 'Unit' },
      });
      createdCatalogIds.push(globalCatalog.id);

      await expect(
        prisma.resourceSourceIdentity.create({
          data: {
            resourceCatalogId: globalCatalog.id,
            workspaceId: workspaceAId,
            sourceSha256: CANONICAL_SHA,
            sourceFileName: 'x.xlsx',
            parserContractVersion: 'v1',
            sheetName: 'GlobalGuard',
            sourceRowNumber: 1,
            sourceSection: 'MATERIAL',
            sourceNameCellAddress: 'C1',
            rawName: 'x',
          },
        }),
      ).rejects.toThrow(/RESOURCE_SOURCE_IDENTITY_WORKSPACE_MISMATCH/);
    });

    it('H4: resource workspace mutation is rejected once provenance exists (including to NULL)', async () => {
      const catalog = await prisma.resourceCatalog.create({
        data: { workspaceId: workspaceAId, name: `${TAG} Immutability Guard`, type: 'MATERIAL', baseUnit: 'Unit' },
      });
      createdCatalogIds.push(catalog.id);
      const provenance = await prisma.resourceSourceIdentity.create({
        data: {
          resourceCatalogId: catalog.id,
          workspaceId: workspaceAId,
          sourceSha256: CANONICAL_SHA,
          sourceFileName: 'x.xlsx',
          parserContractVersion: 'v1',
          sheetName: 'ImmutabilityGuard',
          sourceRowNumber: 1,
          sourceSection: 'MATERIAL',
          sourceNameCellAddress: 'C1',
          rawName: 'x',
        },
      });
      createdProvenanceIds.push(provenance.id);

      await expect(
        prisma.resourceCatalog.update({ where: { id: catalog.id }, data: { workspaceId: workspaceBId } }),
      ).rejects.toThrow(/RESOURCE_CATALOG_WORKSPACE_IMMUTABLE_WITH_PROVENANCE/);

      await expect(
        prisma.resourceCatalog.update({ where: { id: catalog.id }, data: { workspaceId: null } }),
      ).rejects.toThrow(/RESOURCE_CATALOG_WORKSPACE_IMMUTABLE_WITH_PROVENANCE/);
    });

    it('workspace mutation remains allowed for a resource with no provenance', async () => {
      const catalog = await prisma.resourceCatalog.create({
        data: { workspaceId: workspaceAId, name: `${TAG} No Provenance Mutable`, type: 'MATERIAL', baseUnit: 'Unit' },
      });
      createdCatalogIds.push(catalog.id);
      const moved = await prisma.resourceCatalog.update({ where: { id: catalog.id }, data: { workspaceId: workspaceBId } });
      expect(moved.workspaceId).toBe(workspaceBId);
    });
  });

  // ---------------------------------------------------------------------
  // Hash format CHECK constraint (H5)
  // ---------------------------------------------------------------------

  describe('sourceSha256 format CHECK constraint', () => {
    it('H5a: canonical uppercase 64-hex value passes', async () => {
      const catalog = await prisma.resourceCatalog.create({
        data: { workspaceId: workspaceAId, name: `${TAG} Sha Positive`, type: 'MATERIAL', baseUnit: 'Unit' },
      });
      createdCatalogIds.push(catalog.id);
      const provenance = await prisma.resourceSourceIdentity.create({
        data: {
          resourceCatalogId: catalog.id,
          workspaceId: workspaceAId,
          sourceSha256: CANONICAL_SHA,
          sourceFileName: 'x.xlsx',
          parserContractVersion: 'v1',
          sheetName: 'ShaPositive',
          sourceRowNumber: 1,
          sourceSection: 'MATERIAL',
          sourceNameCellAddress: 'C1',
          rawName: 'x',
        },
      });
      createdProvenanceIds.push(provenance.id);
      expect(provenance.sourceSha256).toBe(CANONICAL_SHA);
    });

    // Two distinct, exact rejection shapes depending on the bad value:
    // exceeding the VARCHAR(64) column width surfaces as known Prisma error
    // P2000 ("too long"); everything that fits in 64 chars but fails the
    // regex surfaces as Postgres CHECK violation 23514 naming the exact
    // constraint (Prisma has no P-code for CHECK violations in 6.4.1, so it
    // arrives as PrismaClientUnknownRequestError — asserted on message
    // content instead of error subclass).
    const negativeCases: Array<[string, string, 'TOO_LONG' | 'CHECK_VIOLATION']> = [
      ['length 63', 'A'.repeat(63), 'CHECK_VIOLATION'],
      ['length 65', 'A'.repeat(65), 'TOO_LONG'],
      ['non-hex character', 'G'.repeat(64), 'CHECK_VIOLATION'],
      ['lowercase', 'a'.repeat(64), 'CHECK_VIOLATION'],
      ['trailing whitespace', `${'A'.repeat(63)} `, 'CHECK_VIOLATION'],
    ];

    it.each(negativeCases)('H5b-f: rejects %s', async (_label, badSha, expectedShape) => {
      const catalog = await prisma.resourceCatalog.create({
        data: { workspaceId: workspaceAId, name: `${TAG} Sha Negative ${_label}`, type: 'MATERIAL', baseUnit: 'Unit' },
      });
      createdCatalogIds.push(catalog.id);

      const error = await prisma.resourceSourceIdentity
        .create({
          data: {
            resourceCatalogId: catalog.id,
            workspaceId: workspaceAId,
            sourceSha256: badSha,
            sourceFileName: 'x.xlsx',
            parserContractVersion: 'v1',
            sheetName: `ShaNegative-${_label}`,
            sourceRowNumber: 1,
            sourceSection: 'MATERIAL',
            sourceNameCellAddress: 'C1',
            rawName: 'x',
          },
        })
        .catch((e: unknown) => e as Prisma.PrismaClientKnownRequestError | Error);

      if (expectedShape === 'TOO_LONG') {
        expect((error as Prisma.PrismaClientKnownRequestError).code).toBe('P2000');
        expect((error as Error).message).toContain('too long');
      } else {
        expect((error as Error).message).toContain('resource_source_identities_source_sha256_format_check');
        expect((error as Error).message).toContain('23514');
      }
    });
  });

  // ---------------------------------------------------------------------
  // No unrelated business-data side effects (items 18, 19, 20)
  // ---------------------------------------------------------------------

  describe('no unrelated business-data creation', () => {
    it('18/19/20: this suite creates zero BasicPrice, PriceSubmission, or publication audit rows', async () => {
      const [basicPriceCount, priceSubmissionCount, publicationAuditCount] = await Promise.all([
        prisma.basicPrice.count({ where: { resource: { name: { startsWith: TAG } } } }),
        prisma.priceSubmission.count({ where: { resource: { name: { startsWith: TAG } } } }),
        prisma.basicPricePublicationAudit.count({ where: { basicPrice: { resource: { name: { startsWith: TAG } } } } }),
      ]);
      expect(basicPriceCount).toBe(0);
      expect(priceSubmissionCount).toBe(0);
      expect(publicationAuditCount).toBe(0);
    });
  });
});
