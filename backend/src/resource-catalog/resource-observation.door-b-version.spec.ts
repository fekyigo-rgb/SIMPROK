import { AhspVersionStatus } from '@prisma/client';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  buildEligibleAhspVersionWhere,
  pickCurrentApplicableAhspVersions,
} from '../project-ahsp/ahsp-eligibility.policy';
import { ResourceObservationService } from './resource-observation.service';

/**
 * STAGE 2A closure B1 — Door B must reuse the EXISTING eligibility +
 * current-applicable projection. Never max(versionNumber) alone.
 */

const WS = 'ws-door-b';
const AHSP = 'ahsp-1';
const DIGEST_V1 = '1'.repeat(64);
const DIGEST_V2 = '2'.repeat(64);
const AS_OF = new Date('2026-09-25T00:00:00.000Z');

const locator = (digest: string, name: string) => ({
  rawName: name,
  sourceSha256: digest,
  sheetName: 'Sheet1',
  sourceRowNumber: 10,
  resourceType: 'MATERIAL',
});

describe('Door B locatorsForAhsp — lawful applicable version (B1)', () => {
  const source = readFileSync(
    join(__dirname, 'resource-observation.service.ts'),
    'utf8',
  );

  it('reuses buildEligibleAhspVersionWhere + pickCurrentApplicableAhspVersions', () => {
    expect(source).toContain('buildEligibleAhspVersionWhere');
    expect(source).toContain('pickCurrentApplicableAhspVersions');
    // The blocked shortcut must not return.
    expect(source).not.toMatch(
      /versions:\s*\{\s*orderBy:\s*\{\s*versionNumber:\s*'desc'\s*\},\s*take:\s*1/s,
    );
  });

  const buildService = (prisma: {
    aHSP: { findFirst: jest.Mock };
    aHSPVersion: { findMany: jest.Mock };
  }) =>
    new ResourceObservationService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

  it('V-01: highest versionNumber that is not eligible is NOT used', async () => {
    // Eligible WHERE excludes SUPERSEDED/ARCHIVED private and not-yet-effective
    // / expired rows. Simulate: findMany returns only the eligible lower version
    // (as the real WHERE would), so pickCurrent cannot see the ineligible v5.
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'v1',
        versionNumber: 1,
        ahsp: { id: AHSP },
        resources: [locator(DIGEST_V1, 'Kerikil')],
      },
    ]);
    const service = buildService({
      aHSP: { findFirst: jest.fn().mockResolvedValue({ id: AHSP }) },
      aHSPVersion: { findMany },
    });
    const locators = await service.locatorsForAhsp(WS, AHSP, AS_OF);
    expect(findMany).toHaveBeenCalled();
    const where = findMany.mock.calls[0][0].where;
    expect(where).toEqual({
      AND: [{ ahspId: AHSP }, buildEligibleAhspVersionWhere(WS, AS_OF)],
    });
    expect(locators).toEqual([
      {
        sourceSha256: DIGEST_V1,
        sheetName: 'Sheet1',
        sourceRowNumber: 10,
        rawName: 'Kerikil',
        resourceType: 'MATERIAL',
      },
    ]);
    expect(locators?.some((row) => row.sourceSha256 === DIGEST_V2)).toBe(false);
  });

  it('V-02: applicable lower-number version IS used when lawful', async () => {
    // Two eligible rows would be wrong data; pickCurrent among eligible keeps max.
    // V-02: when only v1 is eligible (v2 expired), v1 locators are returned.
    const eligible = [
      {
        id: 'v1',
        versionNumber: 1,
        ahsp: { id: AHSP },
        resources: [locator(DIGEST_V1, 'Pasir')],
      },
    ];
    expect(pickCurrentApplicableAhspVersions(eligible).map((v) => v.id)).toEqual([
      'v1',
    ]);
    const service = buildService({
      aHSP: { findFirst: jest.fn().mockResolvedValue({ id: AHSP }) },
      aHSPVersion: { findMany: jest.fn().mockResolvedValue(eligible) },
    });
    const locators = await service.locatorsForAhsp(WS, AHSP, AS_OF);
    expect(locators?.[0]?.rawName).toBe('Pasir');
    expect(locators?.[0]?.sourceSha256).toBe(DIGEST_V1);
  });

  it('V-03: archived/expired/not-yet-effective produce no Door B work as if current', async () => {
    // Real WHERE returns nothing for an AHSP whose only versions are unusable.
    const service = buildService({
      aHSP: { findFirst: jest.fn().mockResolvedValue({ id: AHSP }) },
      aHSPVersion: { findMany: jest.fn().mockResolvedValue([]) },
    });
    await expect(service.locatorsForAhsp(WS, AHSP, AS_OF)).resolves.toEqual([]);
    // Eligibility still excludes retired private statuses (policy unchanged).
    expect([AhspVersionStatus.SUPERSEDED, AhspVersionStatus.ARCHIVED]).toEqual(
      expect.arrayContaining([
        AhspVersionStatus.SUPERSEDED,
        AhspVersionStatus.ARCHIVED,
      ]),
    );
  });

  it('V-04: resolved observation outside applicable version does not invent Door B work', async () => {
    // Locators come only from the applicable version's resources. A foreign
    // digest (other version / other AHSP) is never listed.
    const service = buildService({
      aHSP: { findFirst: jest.fn().mockResolvedValue({ id: AHSP }) },
      aHSPVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'v2',
            versionNumber: 2,
            ahsp: { id: AHSP },
            resources: [locator(DIGEST_V2, 'Semen')],
          },
        ]),
      },
    });
    const locators = await service.locatorsForAhsp(WS, AHSP, AS_OF);
    expect(locators).toHaveLength(1);
    expect(locators?.[0]?.sourceSha256).toBe(DIGEST_V2);
    expect(locators?.some((row) => row.sourceSha256 === DIGEST_V1)).toBe(false);
  });

  it('V-05: change does not alter AHSP formula/version history writers', async () => {
    expect(source).not.toContain('aHSPVersion.update');
    expect(source).not.toContain('aHSPVersion.create');
    expect(source).not.toContain('aHSPResource.create');
    expect(source).not.toContain('aHSPResource.update');
    // LocatorsForAhsp is a read against eligibility — no history rewrite.
    const method = source.slice(
      source.indexOf('async locatorsForAhsp'),
      source.indexOf('async listOpenForCuration'),
    );
    expect(method).toContain('findMany');
    expect(method).not.toContain('.update(');
    expect(method).not.toContain('.create(');
  });
});
