import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  NATIONAL_MASTER_INCOMPLETE,
  NATIONAL_MASTER_INTEGRITY,
  NATIONAL_MASTER_READY_FOR_APPLY,
  NATIONAL_REGION_DUMP_CONTRACT,
  NATIONAL_REGION_DUMP_RELATIVE_PATH,
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
      regionCode: '3174',
      regionName: 'Jakarta Selatan',
      parentRegionCode: '31',
      administrativeLevel: 'REGENCY_CITY',
    },
    {
      regionCode: '317410',
      regionName: 'Kebayoran Baru',
      parentRegionCode: '3174',
      administrativeLevel: 'DISTRICT',
    },
    {
      regionCode: '3174101001',
      regionName: 'Selong',
      parentRegionCode: '317410',
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
      regionCode: '3174',
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
    expect(assessment.integrityErrors.some((error) => error.startsWith('DUPLICATE_CANONICAL_CODE'))).toBe(true);
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
    expect(assessment.integrityErrors).toContain('PARENT_LEVEL_MISMATCH:317410');
  });

  it('loads nothing from this repository because the official dump file is absent', () => {
    expect(tryLoadNationalRegionDump(join(__dirname, '..', '..', '..'))).toBeNull();
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

  it('nationalMasterComplete is true only when the official dump itself declares coverage', () => {
    const dump = tinyTree();
    dump.declaresNationalCoverage = true;
    expect(assessNationalRegionMaster(dump).nationalMasterComplete).toBe(true);
  });
});
