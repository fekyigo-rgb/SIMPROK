import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertRegionDesignation,
  type RegionAdministrativeLevel,
  type RegionDesignation,
} from './region-provisioner';

/**
 * NATIONAL REGION MASTER GATE — not a second Region engine.
 *
 * `applyRegionPlan` remains the only writer. This module does four things and
 * none of them insert a village:
 *
 *   1. Names the official dump contract the existing writer can consume.
 *   2. FAIL-CLOSED when that dump is absent — never invents Kemendagri rows.
 *   3. Checks hierarchy integrity of a dump that DID arrive.
 *   4. Orders designations parent-first so `applyRegionPlan` can be called
 *      one row at a time when an official dump is supplied.
 *
 * Two live fixture Regions (Jakarta Selatan, Teluk Ambon Baguala) are not
 * national coverage. A living selector is not a complete master.
 */

export const NATIONAL_REGION_DUMP_RELATIVE_PATH =
  'docs/reference-data/kemendagri-wilayah-indonesia.json';

export const NATIONAL_MASTER_INCOMPLETE = 'NATIONAL_MASTER_INCOMPLETE';
export const NATIONAL_MASTER_INTEGRITY = 'NATIONAL_MASTER_INTEGRITY';
export const NATIONAL_MASTER_READY_FOR_APPLY = 'NATIONAL_MASTER_READY_FOR_APPLY';

export const NATIONAL_REGION_DUMP_CONTRACT = {
  source: 'KEMENDAGRI',
  requiredFields: [
    'regionCode',
    'regionName',
    'administrativeLevel',
  ] as const,
  optionalFields: ['parentRegionCode'] as const,
  levels: [
    'COUNTRY',
    'PROVINCE',
    'REGENCY_CITY',
    'DISTRICT',
    'VILLAGE',
  ] as const satisfies readonly RegionAdministrativeLevel[],
  parentOf: {
    COUNTRY: null,
    PROVINCE: 'COUNTRY',
    REGENCY_CITY: 'PROVINCE',
    DISTRICT: 'REGENCY_CITY',
    VILLAGE: 'DISTRICT',
  } as const satisfies Record<
    RegionAdministrativeLevel,
    RegionAdministrativeLevel | null
  >,
} as const;

export interface NationalRegionDumpRow {
  regionCode: string;
  regionName: string;
  parentRegionCode?: string;
  administrativeLevel: RegionAdministrativeLevel;
}

export interface NationalRegionDump {
  source: 'KEMENDAGRI';
  sourceDocument: string;
  /** Official source may declare national coverage. This gate never invents it. */
  declaresNationalCoverage?: boolean;
  rows: NationalRegionDumpRow[];
}

export interface NationalRegionCoverage {
  COUNTRY: number;
  PROVINCE: number;
  REGENCY_CITY: number;
  DISTRICT: number;
  VILLAGE: number;
}

export interface NationalRegionMasterAssessment {
  status: 'BLOCKED' | 'READY_FOR_APPLY';
  reasonCode: string;
  nationalMasterComplete: boolean;
  coverage: NationalRegionCoverage;
  integrityErrors: string[];
  designations: RegionDesignation[];
}

const EMPTY_COVERAGE: NationalRegionCoverage = {
  COUNTRY: 0,
  PROVINCE: 0,
  REGENCY_CITY: 0,
  DISTRICT: 0,
  VILLAGE: 0,
};

const LEVEL_ORDER: Record<RegionAdministrativeLevel, number> = {
  COUNTRY: 0,
  PROVINCE: 1,
  REGENCY_CITY: 2,
  DISTRICT: 3,
  VILLAGE: 4,
};

export function tryLoadNationalRegionDump(
  repoRoot: string,
): NationalRegionDump | null {
  const dumpPath = join(repoRoot, NATIONAL_REGION_DUMP_RELATIVE_PATH);
  if (!existsSync(dumpPath)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(dumpPath, 'utf8')) as unknown;
  } catch {
    return null;
  }
  if (!isNationalRegionDump(parsed)) return null;
  return parsed;
}

export function assessNationalRegionMaster(
  dump: NationalRegionDump | null,
): NationalRegionMasterAssessment {
  if (dump === null) {
    return {
      status: 'BLOCKED',
      reasonCode: NATIONAL_MASTER_INCOMPLETE,
      nationalMasterComplete: false,
      coverage: { ...EMPTY_COVERAGE },
      integrityErrors: [],
      designations: [],
    };
  }

  const integrityErrors: string[] = [];
  const coverage: NationalRegionCoverage = { ...EMPTY_COVERAGE };
  const byCode = new Map<string, NationalRegionDumpRow>();

  for (const row of dump.rows) {
    try {
      assertRegionDesignation({
        regionCode: row.regionCode,
        regionName: row.regionName,
      });
    } catch (error) {
      integrityErrors.push(
        error instanceof Error ? error.message : 'STOP_REGION_DESIGNATION',
      );
      continue;
    }
    if (byCode.has(row.regionCode)) {
      integrityErrors.push(`DUPLICATE_CANONICAL_CODE:${row.regionCode}`);
      continue;
    }
    if (!isAdministrativeLevel(row.administrativeLevel)) {
      integrityErrors.push(`UNKNOWN_ADMINISTRATIVE_LEVEL:${row.regionCode}`);
      continue;
    }
    byCode.set(row.regionCode, row);
    coverage[row.administrativeLevel] += 1;
  }

  for (const row of byCode.values()) {
    const expectedParentLevel =
      NATIONAL_REGION_DUMP_CONTRACT.parentOf[row.administrativeLevel];
    if (expectedParentLevel === null) {
      if (row.parentRegionCode) {
        integrityErrors.push(`COUNTRY_HAS_PARENT:${row.regionCode}`);
      }
      continue;
    }
    if (!row.parentRegionCode) {
      integrityErrors.push(`ORPHAN:${row.regionCode}`);
      continue;
    }
    const parent = byCode.get(row.parentRegionCode);
    if (!parent) {
      integrityErrors.push(`PARENT_NOT_IN_DUMP:${row.regionCode}`);
      continue;
    }
    if (parent.administrativeLevel !== expectedParentLevel) {
      integrityErrors.push(`PARENT_LEVEL_MISMATCH:${row.regionCode}`);
    }
  }

  const designations = orderDesignationsForApply(
    [...byCode.values()].map((row) => ({
      regionCode: row.regionCode,
      regionName: row.regionName,
      parentRegionCode: row.parentRegionCode,
      administrativeLevel: row.administrativeLevel,
    })),
  );

  if (integrityErrors.length > 0) {
    return {
      status: 'BLOCKED',
      reasonCode: NATIONAL_MASTER_INTEGRITY,
      nationalMasterComplete: false,
      coverage,
      integrityErrors,
      designations: [],
    };
  }

  const allLevelsPresent = NATIONAL_REGION_DUMP_CONTRACT.levels.every(
    (level) => coverage[level] > 0,
  );
  const nationalMasterComplete =
    dump.declaresNationalCoverage === true && allLevelsPresent;

  return {
    status: 'READY_FOR_APPLY',
    reasonCode: NATIONAL_MASTER_READY_FOR_APPLY,
    nationalMasterComplete,
    coverage,
    integrityErrors: [],
    designations,
  };
}

/**
 * Parent first, then children. `applyRegionPlan` refuses a parent that does
 * not yet exist; this order is the only extra the dump needs, and it does not
 * write.
 */
export function orderDesignationsForApply(
  rows: readonly RegionDesignation[],
): RegionDesignation[] {
  return [...rows].sort((a, b) => {
    const left = a.administrativeLevel
      ? LEVEL_ORDER[a.administrativeLevel]
      : 99;
    const right = b.administrativeLevel
      ? LEVEL_ORDER[b.administrativeLevel]
      : 99;
    if (left !== right) return left - right;
    return a.regionCode.localeCompare(b.regionCode);
  });
}

function isAdministrativeLevel(
  value: string,
): value is RegionAdministrativeLevel {
  return (NATIONAL_REGION_DUMP_CONTRACT.levels as readonly string[]).includes(
    value,
  );
}

function isNationalRegionDump(value: unknown): value is NationalRegionDump {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    record.source === 'KEMENDAGRI' &&
    typeof record.sourceDocument === 'string' &&
    record.sourceDocument.length > 0 &&
    Array.isArray(record.rows)
  );
}
