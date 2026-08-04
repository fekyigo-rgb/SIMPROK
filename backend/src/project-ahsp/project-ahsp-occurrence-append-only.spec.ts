import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const sourceRoot = join(__dirname, '..');

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

describe('E1A permanent append-only ProjectAhspOccurrence gate', () => {
  it('finds zero production update/updateMany calls on projectAhspOccurrence', () => {
    const calls = productionTypeScriptFiles(sourceRoot).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return [
        ...source.matchAll(
          /\bprojectAhspOccurrence\s*\.\s*(updateMany|update)\s*\(/g,
        ),
      ].map((match) => ({
        file: file.replace(/\\/g, '/').split('/src/')[1],
        method: match[1],
      }));
    });

    expect(calls).toEqual([]);
  });
});
