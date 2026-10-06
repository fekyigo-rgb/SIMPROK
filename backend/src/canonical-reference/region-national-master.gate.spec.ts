import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  NATIONAL_MASTER_INCOMPLETE,
  NATIONAL_MASTER_INTEGRITY,
  NATIONAL_MASTER_READY_FOR_APPLY,
  NATIONAL_REGION_AMENDMENT_SHA256,
  NATIONAL_REGION_COUNTRY_ROOT_PROVENANCE,
  NATIONAL_REGION_DUMP_CONTRACT,
  NATIONAL_REGION_DUMP_RELATIVE_PATH,
  NATIONAL_REGION_EXPECTED_COVERAGE,
  NATIONAL_REGION_SOURCE_SHA256,
  assessNationalRegionMaster,
  orderDesignationsForApply,
  tryLoadNationalRegionDump,
  type NationalRegionDump,
} from './region-national-master.gate';
import { applyRegionPlan } from './region-provisioner';

/**
 * TEST-ONLY TREE. Five rows that prove hierarchy law. They are NOT a national
 * master and MUST NOT be written into a live Region table.
 */
const tinyTree = (): NationalRegionDump => ({
  source: 'KEMENDAGRI',
  sourceDocument: 'TEST-ONLY — not an official Kemendagri dump',
  rows: [
    {
      regionCode: 'ID',
      regionName: 'Indonesia',
      administrativeLevel: 'COUNTRY',
    },
    {
      regionCode: '31',
      regionName: 'DKI Jakarta',
      parentRegionCode: 'ID',
      administrativeLevel: 'PROVINCE',
    },
    {
      regionCode: '31.74',
      regionName: 'Jakarta Selatan',
      parentRegionCode: '31',
      administrativeLevel: 'REGENCY_CITY',
    },
    {
      regionCode: '31.74.10',
      regionName: 'Kebayoran Baru',
      parentRegionCode: '31.74',
      administrativeLevel: 'DISTRICT',
    },
    {
      regionCode: '31.74.10.1001',
      regionName: 'Selong',
      parentRegionCode: '31.74.10',
      administrativeLevel: 'VILLAGE',
    },
  ],
});

describe('National Region master gate', () => {
  it('BLOCKED when the official dump is absent — never invents villages', () => {
    const assessment = assessNationalRegionMaster(null);
    expect(assessment.status).toBe('BLOCKED');
    expect(assessment.reasonCode).toBe(NATIONAL_MASTER_INCOMPLETE);
    expect(assessment.nationalMasterComplete).toBe(false);
    expect(assessment.coverage).toEqual({
      COUNTRY: 0,
      PROVINCE: 0,
      REGENCY_CITY: 0,
      DISTRICT: 0,
      VILLAGE: 0,
    });
    expect(assessment.designations).toHaveLength(0);
  });

  it('does not treat a 5-row test tree as national coverage', () => {
    const assessment = assessNationalRegionMaster(tinyTree());
    expect(assessment.status).toBe('READY_FOR_APPLY');
    expect(assessment.reasonCode).toBe(NATIONAL_MASTER_READY_FOR_APPLY);
    expect(assessment.nationalMasterComplete).toBe(false);
    expect(assessment.coverage).toEqual({
      COUNTRY: 1,
      PROVINCE: 1,
      REGENCY_CITY: 1,
      DISTRICT: 1,
      VILLAGE: 1,
    });
  });

  it('orders designations parent-first for the existing applyRegionPlan writer', () => {
    const shuffled = [...tinyTree().rows].reverse();
    const ordered = orderDesignationsForApply(shuffled);
    expect(ordered.map((row) => row.administrativeLevel)).toEqual([
      'COUNTRY',
      'PROVINCE',
      'REGENCY_CITY',
      'DISTRICT',
      'VILLAGE',
    ]);
  });

  it('refuses duplicate canonical codes and orphans', () => {
    const dump = tinyTree();
    dump.rows.push({
      regionCode: '31.74',
      regionName: 'Kota lain',
      parentRegionCode: '31',
      administrativeLevel: 'REGENCY_CITY',
    });
    dump.rows.push({
      regionCode: '99',
      regionName: 'Yatim',
      administrativeLevel: 'PROVINCE',
    });
    const assessment = assessNationalRegionMaster(dump);
    expect(assessment.status).toBe('BLOCKED');
    expect(assessment.reasonCode).toBe(NATIONAL_MASTER_INTEGRITY);
    expect(
      assessment.integrityErrors.some((error) =>
        error.startsWith('DUPLICATE_CANONICAL_CODE'),
      ),
    ).toBe(true);
    expect(assessment.integrityErrors).toContain('ORPHAN:99');
    expect(assessment.designations).toHaveLength(0);
  });

  it('refuses a parent at the wrong administrative level', () => {
    const dump = tinyTree();
    dump.rows[3] = {
      ...dump.rows[3],
      parentRegionCode: '31',
    };
    const assessment = assessNationalRegionMaster(dump);
    expect(assessment.status).toBe('BLOCKED');
    expect(assessment.integrityErrors).toContain(
      'PARENT_LEVEL_MISMATCH:31.74.10',
    );
  });

  it('allows the same name in different lawful parents', () => {
    const dump = tinyTree();
    dump.rows.push(
      {
        regionCode: '32',
        regionName: 'Jawa Barat',
        parentRegionCode: 'ID',
        administrativeLevel: 'PROVINCE',
      },
      {
        regionCode: '32.01',
        regionName: 'Jakarta Selatan',
        parentRegionCode: '32',
        administrativeLevel: 'REGENCY_CITY',
      },
    );
    const assessment = assessNationalRegionMaster(dump);
    expect(assessment.integrityErrors).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^SAME_SCOPE_NAME_CONFLICT/),
      ]),
    );
  });

  it('keeps a same-scope different-code pair only when source provenance backs both codes', () => {
    const dump = tinyTree();
    dump.rows.push({
      regionCode: '31.75',
      regionName: 'Jakarta Selatan',
      parentRegionCode: '31',
      administrativeLevel: 'REGENCY_CITY',
    });
    const missing = assessNationalRegionMaster(dump);
    expect(missing.status).toBe('BLOCKED');
    expect(missing.integrityErrors).toEqual(
      expect.arrayContaining([
        'SOURCE_PROVENANCE_MISSING:31.74',
        'SOURCE_PROVENANCE_MISSING:31.75',
      ]),
    );
    expect(missing.sourceTransformationLossCount).toBe(2);
    expect(
      missing.integrityErrors.some((error) =>
        error.startsWith('SAME_SCOPE_NAME_CONFLICT'),
      ),
    ).toBe(false);

    dump.supportingProvenance = [
      {
        groupId: 'TEST-SAME-SCOPE',
        regionCode: '31.74',
        regionName: 'Jakarta Selatan',
        parentRegionCode: '31',
        administrativeLevel: 'REGENCY_CITY',
        sourceReference: 'TEST-ONLY source for 31.74',
        sourceAdminType: 'KELURAHAN',
        sourceRemark: null,
        currentStatus: 'CURRENT',
        relationType: null,
        transformationDecision: null,
      },
      {
        groupId: 'TEST-SAME-SCOPE',
        regionCode: '31.75',
        regionName: 'Jakarta Selatan',
        parentRegionCode: '31',
        administrativeLevel: 'REGENCY_CITY',
        sourceReference: 'TEST-ONLY source for 31.75',
        sourceAdminType: 'DESA',
        sourceRemark: null,
        currentStatus: 'CURRENT',
        relationType: null,
        transformationDecision: null,
      },
    ];
    const backed = assessNationalRegionMaster(dump);
    expect(backed.status).toBe('READY_FOR_APPLY');
    expect(backed.sameNameSameScopeDistinctValidCodeCount).toBe(1);
    expect(backed.sourceTransformationLossCount).toBe(0);
    expect(backed.designations.map((row) => row.regionCode)).toEqual(
      expect.arrayContaining(['31.74', '31.75']),
    );
    expect(backed.designations.every((row) => !('sourceRemark' in row))).toBe(
      true,
    );
  });

  it('loads the official repository dump, keeps country provenance truthful, and retains all 16 supporting facts', () => {
    const loaded = tryLoadNationalRegionDump(join(__dirname, '..', '..', '..'));
    expect(loaded).not.toBeNull();
    expect(loaded?.sourceSha256).toBe(NATIONAL_REGION_SOURCE_SHA256);
    expect(loaded?.amendmentSha256).toBe(NATIONAL_REGION_AMENDMENT_SHA256);
    expect(loaded?.sourceScope).toBe(
      'ADMINISTRATIVE_ROWS_EXCLUDING_COUNTRY_ROOT',
    );
    expect(loaded?.countryRootProvenance).toEqual(
      NATIONAL_REGION_COUNTRY_ROOT_PROVENANCE,
    );
    expect(loaded?.countryRootProvenance?.provenanceClass).toBe(
      'OFFICIAL_SECOND_AUTHORITY',
    );
    const assessment = assessNationalRegionMaster(loaded);
    expect(assessment.status).toBe('READY_FOR_APPLY');
    expect(assessment.reasonCode).toBe(NATIONAL_MASTER_READY_FOR_APPLY);
    expect(assessment.coverage).toEqual(NATIONAL_REGION_EXPECTED_COVERAGE);
    expect(assessment.integrityErrors).toEqual([]);
    expect(assessment.nationalMasterComplete).toBe(true);
    expect(assessment.sameNameSameScopeDistinctValidCodeCount).toBe(16);
    expect(assessment.sourceTransformationLossCount).toBe(0);
    expect(assessment.supportingProvenance).toHaveLength(32);
    expect(
      new Set(assessment.supportingProvenance.map((fact) => fact.groupId)).size,
    ).toBe(16);
    expect(
      assessment.designations.some((row) => row.regionCode === '71.02.11.2003'),
    ).toBe(true);
    expect(
      assessment.designations.some((row) => row.regionCode === '71.02.11.2018'),
    ).toBe(true);
    expect(assessment.historicalSuccession).toEqual({
      groupId: 'IDENTITY16-07',
      codeA: '71.02.11.2003',
      codeB: '71.02.11.2018',
      relationType: 'SPLIT_FORMATION',
      effectiveSourceReference:
        assessment.historicalSuccession?.effectiveSourceReference,
      currentStatusA: 'CURRENT',
      currentStatusB: 'CURRENT',
      transformationDecision: 'RETAIN_BOTH_CURRENT_DISTINCT_CODES',
    });
    expect(assessment.historicalSuccession?.effectiveSourceReference).toContain(
      'Perda No. 13/2011',
    );
    const predecessor = assessment.supportingProvenance.find(
      (fact) => fact.regionCode === '71.02.11.2003',
    );
    expect(predecessor?.currentStatus).toBe('CURRENT');
    expect(predecessor?.relationType).toBeNull();
  });

  it('reads a present dump file and still does not write Regions', () => {
    const root = mkdtempSync(join(tmpdir(), 'bp-region-dump-'));
    const dumpDir = join(root, 'docs', 'reference-data');
    mkdirSync(dumpDir, { recursive: true });
    writeFileSync(
      join(root, NATIONAL_REGION_DUMP_RELATIVE_PATH),
      JSON.stringify(tinyTree()),
      'utf8',
    );
    const loaded = tryLoadNationalRegionDump(root);
    expect(loaded?.source).toBe('KEMENDAGRI');
    expect(applyRegionPlan.length).toBe(2);
    expect(NATIONAL_REGION_DUMP_CONTRACT.source).toBe('KEMENDAGRI');
  });

  it('does not accept a declared five-row tree as national coverage', () => {
    const dump = tinyTree();
    dump.declaresNationalCoverage = true;
    dump.sourceSha256 = NATIONAL_REGION_SOURCE_SHA256;
    dump.amendmentSha256 = NATIONAL_REGION_AMENDMENT_SHA256;
    expect(assessNationalRegionMaster(dump).nationalMasterComplete).toBe(false);
  });
});
