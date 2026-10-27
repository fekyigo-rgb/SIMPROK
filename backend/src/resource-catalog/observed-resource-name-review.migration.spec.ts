import { readFileSync } from 'fs';
import { join } from 'path';

describe('observed resource name review migration contract', () => {
  const sql = readFileSync(
    join(
      __dirname,
      '../../prisma/migrations/20261026120000_observed_resource_name_review/migration.sql',
    ),
    'utf8',
  );

  it('is additive, tenant-bound and versioned per observation', () => {
    expect(sql).toContain('CREATE TABLE "observed_resource_name_reviews"');
    expect(sql).toContain(
      'UNIQUE ("id", "workspaceId")',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("observationId", "workspaceId")',
    );
    expect(sql).toContain(
      '"observed_resource_name_reviews_observation_version_key"',
    );
    expect(sql).toContain('CHECK ("version" > 0)');
  });

  it('makes review events append-only and source facts immutable in PostgreSQL', () => {
    expect(sql).toContain(
      'BEFORE UPDATE OR DELETE ON "observed_resource_name_reviews"',
    );
    expect(sql).toContain(
      'BEFORE UPDATE ON "observed_resources"',
    );
    for (const field of [
      'rawName',
      'rawCode',
      'rawUnit',
      'resourceType',
      'sourceSha256',
      'sheetName',
      'sourceRowNumber',
      'parserContractVersion',
    ]) {
      expect(sql).toContain(`OLD."${field}" IS DISTINCT FROM NEW."${field}"`);
    }
  });
});
