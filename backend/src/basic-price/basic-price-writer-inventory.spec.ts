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

describe('W-01 permanent BasicPrice writer inventory', () => {
  it('keeps exactly the two approved writers and no other Prisma writer method', () => {
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
