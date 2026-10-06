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
export const NATIONAL_MASTER_READY_FOR_APPLY =
  'NATIONAL_MASTER_READY_FOR_APPLY';

export const NATIONAL_REGION_EXPECTED_COVERAGE = {
  COUNTRY: 1,
  PROVINCE: 38,
  REGENCY_CITY: 514,
  DISTRICT: 7285,
  VILLAGE: 83762,
} as const satisfies NationalRegionCoverage;

export const NATIONAL_REGION_SOURCE_SHA256 =
  'AC13B5A57358FCEC0503429BB06B2D6B4E5572F65FD0162979B87A79863B1DE6';
export const NATIONAL_REGION_AMENDMENT_SHA256 =
  '3EF2790683CCDDD8BDE7B048C6FCEF72E10B9189EAF7104C1D55188F51EBC5AB';

export const NATIONAL_REGION_COUNTRY_ROOT_PROVENANCE = {
  regionCode: 'ID',
  regionName: 'Indonesia',
  administrativeLevel: 'COUNTRY',
  authority: 'United Nations Statistics Division',
  sourceDocument: 'Standard country or area codes for statistical use (M49)',
  sourceUrl: 'https://unstats.un.org/unsd/methodology/m49/overview/',
  referenceStandard: 'UN M49 / ISO 3166-1 alpha-2',
  isoAlpha2: 'ID',
  isoAlpha3: 'IDN',
  m49Code: '360',
  provenanceClass: 'OFFICIAL_SECOND_AUTHORITY',
} as const;

export const NATIONAL_REGION_DUMP_CONTRACT = {
  source: 'KEMENDAGRI',
  sourceScope: 'ADMINISTRATIVE_ROWS_EXCLUDING_COUNTRY_ROOT',
  requiredFields: ['regionCode', 'regionName', 'administrativeLevel'] as const,
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

/**
 * Supporting source evidence for one official code. It explains a row.
 * It is not a second identity and it is not written onto Region.
 */
export interface NationalRegionSupportingProvenance {
  groupId: string;
  regionCode: string;
  regionName: string;
  parentRegionCode: string;
  administrativeLevel: RegionAdministrativeLevel;
  sourceReference: string;
  sourceAdminType: 'KELURAHAN' | 'DESA';
  sourceRemark: string | null;
  currentStatus: 'CURRENT';
  relationType: 'SPLIT_FORMATION' | null;
  transformationDecision: 'RETAIN_BOTH_CURRENT_DISTINCT_CODES' | null;
}

export interface NationalRegionHistoricalSuccession {
  groupId: 'IDENTITY16-07';
  codeA: '71.02.11.2003';
  codeB: '71.02.11.2018';
  relationType: 'SPLIT_FORMATION';
  effectiveSourceReference: string;
  currentStatusA: 'CURRENT';
  currentStatusB: 'CURRENT';
  transformationDecision: 'RETAIN_BOTH_CURRENT_DISTINCT_CODES';
}

export interface NationalRegionDump {
  source: 'KEMENDAGRI';
  sourceScope?: 'ADMINISTRATIVE_ROWS_EXCLUDING_COUNTRY_ROOT';
  sourceAuthority?: string;
  sourceDocument: string;
  sourceDate?: string;
  sourceUrl?: string;
  sourceSha256?: string;
  amendmentUrl?: string;
  amendmentSha256?: string;
  /** Official source may declare national coverage. This gate never invents it. */
  declaresNationalCoverage?: boolean;
  countryRootProvenance?: typeof NATIONAL_REGION_COUNTRY_ROOT_PROVENANCE;
  supportingProvenance?: NationalRegionSupportingProvenance[];
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
  sameNameSameScopeDistinctValidCodeCount: number;
  sourceTransformationLossCount: number;
  supportingProvenance: readonly NationalRegionSupportingProvenance[];
  historicalSuccession: NationalRegionHistoricalSuccession | null;
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
      sameNameSameScopeDistinctValidCodeCount: 0,
      sourceTransformationLossCount: 0,
      supportingProvenance: [],
      historicalSuccession: null,
    };
  }

  const integrityErrors: string[] = [];
  const coverage: NationalRegionCoverage = { ...EMPTY_COVERAGE };
  const byCode = new Map<string, NationalRegionDumpRow>();
  const byScopedName = new Map<string, NationalRegionDumpRow[]>();

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
    if (
      row.administrativeLevel === 'COUNTRY' &&
      (row.regionCode !== NATIONAL_REGION_COUNTRY_ROOT_PROVENANCE.regionCode ||
        row.regionName !== NATIONAL_REGION_COUNTRY_ROOT_PROVENANCE.regionName)
    ) {
      integrityErrors.push(`COUNTRY_ROOT_MISMATCH:${row.regionCode}`);
    }
    const scopedNameKey = JSON.stringify([
      row.administrativeLevel,
      row.parentRegionCode ?? null,
      row.regionName,
    ]);
    const scopedGroup = byScopedName.get(scopedNameKey) ?? [];
    scopedGroup.push(row);
    byScopedName.set(scopedNameKey, scopedGroup);
  }

  const provenanceByCode = new Map<
    string,
    NationalRegionSupportingProvenance
  >();
  for (const fact of dump.supportingProvenance ?? []) {
    if (provenanceByCode.has(fact.regionCode)) {
      integrityErrors.push(`SOURCE_PROVENANCE_DUPLICATE:${fact.regionCode}`);
      continue;
    }
    provenanceByCode.set(fact.regionCode, fact);
    const row = byCode.get(fact.regionCode);
    const typeDigit = fact.regionCode.split('.').at(-1)?.charAt(0) ?? '';
    const expectedDigit = fact.sourceAdminType === 'KELURAHAN' ? '1' : '2';
    const villageTypeAgrees =
      fact.administrativeLevel !== 'VILLAGE' || typeDigit === expectedDigit;
    if (
      !row ||
      row.regionName !== fact.regionName ||
      (row.parentRegionCode ?? null) !== fact.parentRegionCode ||
      row.administrativeLevel !== fact.administrativeLevel ||
      !villageTypeAgrees
    ) {
      integrityErrors.push(
        `SOURCE_PROVENANCE_CONTRADICTION:${fact.regionCode}`,
      );
    }
  }

  let sameNameSameScopeDistinctValidCodeCount = 0;
  let sourceTransformationLossCount = 0;
  for (const group of byScopedName.values()) {
    if (group.length < 2) continue;
    const missing = group.filter(
      (row) => !provenanceByCode.has(row.regionCode),
    );
    if (missing.length > 0) {
      sourceTransformationLossCount += missing.length;
      for (const row of missing) {
        integrityErrors.push(`SOURCE_PROVENANCE_MISSING:${row.regionCode}`);
      }
      continue;
    }
    const contradicted = group.some((row) =>
      integrityErrors.some(
        (error) =>
          error === `SOURCE_PROVENANCE_CONTRADICTION:${row.regionCode}`,
      ),
    );
    if (!contradicted) sameNameSameScopeDistinctValidCodeCount += 1;
  }

  const historicalSuccession = resolveHistoricalSuccession(
    provenanceByCode,
    integrityErrors,
  );

  for (const row of byCode.values()) {
    if (!hasCanonicalCodeShape(row)) {
      integrityErrors.push(`CANONICAL_CODE_SHAPE:${row.regionCode}`);
    }
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
    if (
      row.administrativeLevel !== 'PROVINCE' &&
      !row.regionCode.startsWith(`${row.parentRegionCode}.`)
    ) {
      integrityErrors.push(`PARENT_CODE_PREFIX_MISMATCH:${row.regionCode}`);
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
      sameNameSameScopeDistinctValidCodeCount,
      sourceTransformationLossCount,
      supportingProvenance: [...provenanceByCode.values()],
      historicalSuccession,
    };
  }

  const exactNationalCoverage = NATIONAL_REGION_DUMP_CONTRACT.levels.every(
    (level) => coverage[level] === NATIONAL_REGION_EXPECTED_COVERAGE[level],
  );
  const officialSourcePinned =
    dump.sourceSha256 === NATIONAL_REGION_SOURCE_SHA256 &&
    dump.amendmentSha256 === NATIONAL_REGION_AMENDMENT_SHA256;
  const countryRootProvenanceRecorded =
    dump.sourceScope === NATIONAL_REGION_DUMP_CONTRACT.sourceScope &&
    JSON.stringify(dump.countryRootProvenance) ===
      JSON.stringify(NATIONAL_REGION_COUNTRY_ROOT_PROVENANCE);
  const nationalMasterComplete =
    dump.declaresNationalCoverage === true &&
    exactNationalCoverage &&
    officialSourcePinned &&
    countryRootProvenanceRecorded;

  return {
    status: 'READY_FOR_APPLY',
    reasonCode: NATIONAL_MASTER_READY_FOR_APPLY,
    nationalMasterComplete,
    coverage,
    integrityErrors: [],
    designations,
    sameNameSameScopeDistinctValidCodeCount,
    sourceTransformationLossCount,
    supportingProvenance: [...provenanceByCode.values()],
    historicalSuccession,
  };
}

/**
 * The one historical pair is a split formation. Both official codes remain
 * current. Provenance records the split. It does not retire either code.
 */
function resolveHistoricalSuccession(
  provenanceByCode: ReadonlyMap<string, NationalRegionSupportingProvenance>,
  integrityErrors: string[],
): NationalRegionHistoricalSuccession | null {
  const codeA = '71.02.11.2003';
  const codeB = '71.02.11.2018';
  const factA = provenanceByCode.get(codeA);
  const factB = provenanceByCode.get(codeB);
  if (!factA && !factB) return null;
  const lawful =
    factA?.groupId === 'IDENTITY16-07' &&
    factB?.groupId === 'IDENTITY16-07' &&
    factA.currentStatus === 'CURRENT' &&
    factB.currentStatus === 'CURRENT' &&
    factA.relationType === null &&
    factB.relationType === 'SPLIT_FORMATION' &&
    factA.transformationDecision === 'RETAIN_BOTH_CURRENT_DISTINCT_CODES' &&
    factB.transformationDecision === 'RETAIN_BOTH_CURRENT_DISTINCT_CODES' &&
    factB.sourceRemark !== null;
  if (!lawful) {
    integrityErrors.push('HISTORICAL_TRUTH_UNRESOLVED:IDENTITY16-07');
    return null;
  }
  return {
    groupId: 'IDENTITY16-07',
    codeA,
    codeB,
    relationType: 'SPLIT_FORMATION',
    effectiveSourceReference: factB.sourceReference,
    currentStatusA: 'CURRENT',
    currentStatusB: 'CURRENT',
    transformationDecision: 'RETAIN_BOTH_CURRENT_DISTINCT_CODES',
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

function hasCanonicalCodeShape(row: NationalRegionDumpRow): boolean {
  const patterns: Record<RegionAdministrativeLevel, RegExp> = {
    COUNTRY: /^ID$/,
    PROVINCE: /^\d{2}$/,
    REGENCY_CITY: /^\d{2}\.\d{2}$/,
    DISTRICT: /^\d{2}\.\d{2}\.\d{2}$/,
    VILLAGE: /^\d{2}\.\d{2}\.\d{2}\.\d{4}$/,
  };
  return patterns[row.administrativeLevel].test(row.regionCode);
}

function isNationalRegionDump(value: unknown): value is NationalRegionDump {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    record.source === 'KEMENDAGRI' &&
    typeof record.sourceDocument === 'string' &&
    record.sourceDocument.length > 0 &&
    Array.isArray(record.rows) &&
    record.rows.every((row) => {
      if (row === null || typeof row !== 'object') return false;
      const candidate = row as Record<string, unknown>;
      return (
        typeof candidate.regionCode === 'string' &&
        typeof candidate.regionName === 'string' &&
        typeof candidate.administrativeLevel === 'string' &&
        (candidate.parentRegionCode === undefined ||
          typeof candidate.parentRegionCode === 'string')
      );
    })
  );
}
