import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SQL = readFileSync(
  resolve(__dirname, '../../prisma/migrations/20261030210000_bp_import_price_conversion_proof/migration.sql'),
  'utf8',
);

describe('SCOPE-03B1 additive immutable price-evidence SQL contract', () => {
  it('extends only the existing append-only reviewer mapping', () => {
    expect(SQL).toContain('ALTER TABLE "basic_price_import_row_resource_mappings"');
    expect(SQL).not.toMatch(/CREATE TABLE\s/u);
    expect(SQL).not.toMatch(/UPDATE\s+"?(?:basic_prices|basic_price_import_rows)"?/u);
    expect(SQL).toContain('ADD COLUMN "conversionSourcePriceValue" DECIMAL(18,2)');
    expect(SQL).toContain('ADD COLUMN "conversionAdaptedPriceValue" DECIMAL(18,2)');
    expect(SQL).toContain('ADD COLUMN "conversionQuantityFactor" DECIMAL(24,12)');
  });

  it('makes partial evidence unrepresentable and retains rule lineage', () => {
    expect(SQL).toContain('bp_mapping_conversion_atomic_evidence_check');
    expect(SQL).toContain('"conversionSourcePriceValue" IS NULL');
    expect(SQL).toContain('"conversionSourcePriceValue" IS NOT NULL');
    expect(SQL).toContain('"conversionQuantityFactor" > 0');
    expect(SQL).toContain('"conversionRuleVersion" > 0');
    expect(SQL).toContain('FOREIGN KEY ("conversionRuleId") REFERENCES "unit_conversion_rules"("id")');
    expect(SQL).toContain('ON DELETE RESTRICT');
  });

  it('rejects updates of a previously frozen reviewer conversion', () => {
    expect(SQL).toContain('CREATE TRIGGER "bp_mapping_conversion_evidence_immutable_trigger"');
    expect(SQL).toContain('BEFORE UPDATE');
    expect(SQL).toContain("RAISE EXCEPTION 'BASIC_PRICE_CONVERSION_EVIDENCE_IMMUTABLE'");
    expect(SQL).toContain('IS DISTINCT FROM ROW(');
  });
});
