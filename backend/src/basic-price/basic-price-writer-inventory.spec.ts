import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const sourceRoot = join(__dirname, '..');
const collectTs = (dir: string): string[] =>
  readdirSync(dir)
    .sort((left, right) => left.localeCompare(right))
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory()
        ? collectTs(path)
        : name.endsWith('.ts') && !name.endsWith('.spec.ts')
          ? [path]
          : [];
    });

/**
 * RM-03C: the inventory grew from two writers to three, and the third is the
 * only one that may ever produce a WORKSPACE_PRIVATE row. The array stays
 * order-dependent and exact by design — a fourth writer appearing anywhere in
 * src/ fails this test rather than quietly joining the set.
 *
 * Migration SQL is NOT a runtime writer and is deliberately out of scope here:
 * this test scans src/ only.
 */
describe('W-01 permanent BasicPrice writer inventory', () => {
  it('keeps exactly the three approved writers and no other Prisma writer method', () => {
    const matches = collectTs(sourceRoot).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return [
        ...source.matchAll(
          /(?:tx|prisma)\.basicPrice\.(create|update|updateMany|delete|deleteMany|upsert)\s*\(/g,
        ),
      ].map((match) => ({ file, method: match[1] }));
    });

    expect(
      matches.map(({ file, method }) => ({
        file: file.replace(/\\/g, '/').split('/src/')[1],
        method,
      })),
    ).toEqual([
      // RM-03C — the ONE workspace-private writer. Creates only; it never
      // updates, and it never touches a row it did not create.
      {
        file: 'basic-price/basic-price-private-asset.service.ts',
        method: 'create',
      },
      {
        file: 'basic-price/basic-price-publication.service.ts',
        method: 'update',
      },
      {
        file: 'reality-intake/price-submission-review.service.ts',
        method: 'create',
      },
    ]);
  });

  it('the private writer never sets a publication axis, and never fakes an asset scope', () => {
    const source = readFileSync(
      join(sourceRoot, 'basic-price', 'basic-price-private-asset.service.ts'),
      'utf8',
    );
    // Sliced by markers rather than by a nested-brace regex: the assertion is
    // about what the create's `data` literal contains, and a brittle regex
    // would fail for reasons unrelated to that.
    const start = source.indexOf('await tx.basicPrice.create({');
    const end = source.indexOf('select: PRIVATE_PRICE_SELECT,', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const data = source.slice(start, end);

    // The two publication axes are OMITTED so the row takes the schema's
    // honest defaults (UNPUBLISHED / UNVERIFIED). A private price never claims
    // publication in order to become usable.
    expect(/^\s*status\s*:/m.test(data)).toBe(false);
    expect(/^\s*verificationStatus\s*:/m.test(data)).toBe(false);

    // Ownership is stated explicitly, never left to a default.
    expect(data).toContain(
      'assetScope: BasicPriceAssetScope.WORKSPACE_PRIVATE',
    );
    // Provenance is mandatory and comes from the import row, not from thin air.
    expect(data).toContain('sourceImportRowId: row.id');
    // Source stays orthogonal to ownership — copied from the batch verbatim.
    expect(data).toContain('sourceOrigin: batch.sourceOrigin');
  });

  it('no writer anywhere creates a publication audit for a private price', () => {
    const source = readFileSync(
      join(sourceRoot, 'basic-price', 'basic-price-private-asset.service.ts'),
      'utf8',
    );
    expect(source).not.toContain('basicPricePublicationAudit');
    expect(source).not.toContain('priceSubmission');
    expect(source).not.toContain('priceSubmissionReview');
  });

  it('publication update writes exactly status and verificationStatus', () => {
    const source = readFileSync(
      join(sourceRoot, 'basic-price', 'basic-price-publication.service.ts'),
      'utf8',
    );
    const update = source.match(
      /basicPrice\.update\s*\(\{[\s\S]*?data:\s*\{([\s\S]*?)\}\s*,?\s*\}\)/,
    );
    expect(update).not.toBeNull();
    const fields = [
      ...update![1].matchAll(/\b(status|verificationStatus)\s*:/g),
    ].map((match) => match[1]);
    expect(fields).toEqual(['status', 'verificationStatus']);
    expect(update![1]).toContain("status: 'PUBLISHED'");
    expect(update![1]).toContain("verificationStatus: 'PUBLISHED'");
  });
});
