import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * RAB-TRUTH-01H — WHERE the historical authority is captured, and that nothing
 * may ever rewrite it.
 *
 * The behavioural half (what a reader gets back) is proven in
 * persisted-calculation.service.spec.ts. This file pins the two structural
 * guarantees that make that behaviour durable:
 *
 *   1. the ownership is captured at the SAME boundary that freezes the rest of
 *      the calculation context — occurrence creation — so a new calculation
 *      after a lawful transfer truthfully records the new authority;
 *   2. no production code ever writes it again.
 *
 * (2) is already guaranteed structurally: project-ahsp-occurrence-append-only
 * .spec.ts proves there is not a single production `projectAhspOccurrence
 * .update`/`updateMany` anywhere. This file asserts the field is not smuggled
 * into a write by some other route.
 */

const serviceSource = readFileSync(
  join(__dirname, 'project-ahsp.service.ts'),
  'utf8',
);
const schemaSource = readFileSync(
  join(__dirname, '..', '..', 'prisma', 'schema.prisma'),
  'utf8',
);

describe('RAB-TRUTH-01H price-origin authority freeze', () => {
  it('captures the AHSP ownership on the occurrence it creates', () => {
    const createCall = serviceSource.slice(
      serviceSource.indexOf('tx.projectAhspOccurrence.create('),
      serviceSource.indexOf('resourceResolutions: { create: resolutions }'),
    );
    expect(createCall).toContain('ahspOwnershipAtCalculation');
    // From the version this transaction already loaded and validated — never a
    // second read that could disagree with the one that formed the resolutions.
    expect(createCall).toMatch(
      /ahspOwnershipAtCalculation: version\.ahsp\?\.ownershipType \?\? null/,
    );
  });

  it('reads that ownership on the same transaction that freezes the context', () => {
    // The eligible-version load is the trusted, revalidated read; the ownership
    // rides along with it rather than arriving from an unguarded lookup.
    const versionLoad = serviceSource.slice(
      serviceSource.indexOf('tx.aHSPVersion.findFirst('),
      serviceSource.indexOf('ELIGIBLE_AHSP_VERSION_NOT_FOUND'),
    );
    expect(versionLoad).toMatch(/ahsp: \{ select: \{ ownershipType: true \} \}/);
  });

  it('is the domain enum and nullable, so an unproven history can stay unproven', () => {
    const occurrence = schemaSource.slice(
      schemaSource.indexOf('model ProjectAhspOccurrence'),
      schemaSource.indexOf('model ProjectAhspResourceResolution'),
    );
    // The domain's own type: the database refuses an ownership that does not
    // exist, and the column compares directly against `ahsps.ownershipType`.
    expect(occurrence).toMatch(/ahspOwnershipAtCalculation\s+OwnershipType\?/);
    expect(occurrence).not.toMatch(/ahspOwnershipAtCalculation\s+String/);
    // Nullable on purpose — unknown history must be representable.
    expect(occurrence).toMatch(/ahspOwnershipAtCalculation\s+OwnershipType\?\s*$/m);
  });

  it('is never rewritten by any production path', () => {
    // Belt to the append-only brace: no assignment to this field outside the
    // single create above.
    const assignments = [
      ...serviceSource.matchAll(/ahspOwnershipAtCalculation\s*:/g),
    ];
    expect(assignments).toHaveLength(1);
  });

  it('does not duplicate the immutable Basic Price scope', () => {
    // BasicPrice.assetScope has no production writer that updates it, so
    // selectedBasicPriceId already points at stable evidence. Copying it would
    // create a second truth to keep in step.
    const resolution = schemaSource.slice(
      schemaSource.indexOf('model ProjectAhspResourceResolution'),
      schemaSource.indexOf('model ProjectAhspResourceResolution') + 2600,
    );
    expect(resolution).not.toMatch(/assetScopeAtCalculation|frozenAssetScope/);
  });
});
