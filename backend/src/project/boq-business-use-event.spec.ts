import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const sourceRoot = join(__dirname, '..');
const migration = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    'prisma',
    'migrations',
    '20261009120000_boq_business_use_event',
    'migration.sql',
  ),
  'utf8',
);

const productionTypeScriptFiles = (directory: string): string[] =>
  readdirSync(directory)
    .sort((left, right) => left.localeCompare(right))
    .flatMap((name) => {
      const path = join(directory, name);
      return statSync(path).isDirectory()
        ? productionTypeScriptFiles(path)
        : name.endsWith('.ts') && !name.endsWith('.spec.ts')
          ? [path]
          : [];
    });

describe('BOQ business-use permanent evidence contract', () => {
  it('is one additive table with restrictive history FKs and no historical backfill', () => {
    expect(
      migration.match(/CREATE TABLE "boq_business_use_events"/g),
    ).toHaveLength(1);
    expect(migration).not.toMatch(
      /(?:INSERT INTO|UPDATE|DELETE FROM) "(?:projects|boq_structures|boq_items|intake_requests|intake_jobs|source_documents)"/,
    );
    expect(
      migration.match(/ON DELETE RESTRICT ON UPDATE CASCADE/g),
    ).toHaveLength(9);
    expect(migration).toContain(
      'CREATE TRIGGER boq_business_use_events_immutable_trigger',
    );
    expect(migration).toContain(
      "RAISE EXCEPTION 'BOQ_BUSINESS_USE_APPEND_ONLY: % is forbidden'",
    );
  });

  it('has no production update or delete writer for successful-use history', () => {
    const calls = productionTypeScriptFiles(sourceRoot).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return [
        ...source.matchAll(
          /\bboqBusinessUseEvent\s*\.\s*(updateMany|update|deleteMany|delete)\s*\(/g,
        ),
      ].map((match) => ({ file, method: match[1] }));
    });

    expect(calls).toEqual([]);
  });
});
