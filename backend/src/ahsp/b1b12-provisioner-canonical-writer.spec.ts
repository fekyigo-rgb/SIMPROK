import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * B1B12 used to Prisma-inject AHSP parents so the 12-row RAB thread could
 * run. The recovered proof must now call the same production writer the AHSP
 * Room uses. This is a source law, not a second importer.
 */
describe('B1B12 provisioner canonical AHSP writer', () => {
  const src = readFileSync(
    join(__dirname, '..', '..', 'test', 'fixtures', 'b1b12-section-provisioner.ts'),
    'utf8',
  );

  it('creates the parent through POST /ahsp, not prisma.aHSP.create', () => {
    expect(src).toContain(".post('/ahsp')");
    expect(src).not.toMatch(/prisma\.aHSP\.create\(/);
    expect(src).not.toMatch(/prisma\.aHSPVersion\.create\(/);
    expect(src).not.toMatch(/prisma\.aHSPResource\.create\(/);
  });

  it('appends the recipe through the existing version route and AHSP_MANAGE', () => {
    expect(src).toContain('/versions');
    expect(src).toContain("'AHSP_MANAGE'");
  });

  it('does not treat methodType or locationType as official source facts', () => {
    expect(src).toContain("methodType: 'OTHER'");
    expect(src).toContain("locationType: 'OTHER'");
    expect(src).not.toMatch(/methodType: 'MANUAL'/);
  });
});
