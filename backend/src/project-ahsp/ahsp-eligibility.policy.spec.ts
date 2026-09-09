import { readFileSync } from 'fs';
import { join } from 'path';
import { AhspVersionStatus } from '@prisma/client';
import {
  AHSP_ORIGIN,
  buildEligibleAhspVersionWhere,
  classifyAhspOrigin,
  pickCurrentApplicableAhspVersions,
} from './ahsp-eligibility.policy';

/**
 * RM-03B — AHSP eligibility policy.
 *
 * The Owner law recognises two legitimate origins for a bindable AHSP: the
 * curated SIMPROK catalog (which requires national publication) and a
 * workspace's OWN private AHSP (which does not). These tests prove that the
 * private route was added WITHOUT weakening the catalog route, and that the
 * private route cannot be used to reach another tenant's data.
 */

const WS = 'workspace-a';
const OTHER_WS = 'workspace-b';
const AS_OF = new Date('2026-08-04T00:00:00.000Z');

/** Find a clause in the AND list by what it CONTAINS, never by where it sits. */
const clauseWith = (where: any, key: string) =>
  (where.AND as any[]).find(
    (clause) =>
      Array.isArray(clause.OR) && clause.OR.some((branch: any) => key in branch),
  );

const branches = (workspaceId = WS) => {
  const where = buildEligibleAhspVersionWhere(workspaceId, AS_OF);
  // Located by structure, not by index: only the origin clause's branches carry
  // a `status`. Position was never part of the contract, so the tests no longer
  // bind to it — adding a date clause must not silently unhook them.
  const originBranch = clauseWith(where, 'status');
  const [catalog, priv] = originBranch.OR;
  return { where, catalog, priv };
};

/**
 * CATALOG_ELIGIBILITY_SEMANTICS_PRESERVED: the catalog predicate was moved into
 * a builder and now sits inside an OR, so its text is not byte-identical to the
 * pre-RM-03B version. Each condition is therefore asserted individually below,
 * rather than the shape being trusted.
 */
describe('buildEligibleAhspVersionWhere — catalog route semantics are unchanged', () => {
  it('still requires the exact PUBLISHED status for a catalog version', () => {
    expect(branches().catalog.status).toBe(AhspVersionStatus.PUBLISHED);
  });

  it('keeps the catalog tenant clause admitting both this workspace and the null-workspace repository', () => {
    const { catalog } = branches();
    expect(catalog.OR).toEqual([{ workspaceId: WS }, { workspaceId: null }]);
    expect((catalog.ahsp as any).is.OR).toEqual([
      { workspaceId: WS },
      { workspaceId: null },
    ]);
    expect((catalog.ahsp as any).is.deletedAt).toBeNull();
  });

  it('keeps the shared completeness and date scope, both origins alike', () => {
    const { where } = branches();
    // Completeness is what cannot be priced at all: no unit, or no components.
    expect(where.outputUnit).toEqual({ not: null });
    expect(where.resources).toEqual({ some: {} });
    // Both dates are scoped the same way: a NULL is an unknown bound, never a
    // disqualifying one. A PROVEN date outside the window still disqualifies.
    expect(clauseWith(where, 'effectiveDate')).toEqual({
      OR: [{ effectiveDate: null }, { effectiveDate: { lte: AS_OF } }],
    });
    expect(clauseWith(where, 'expiredDate')).toEqual({
      OR: [{ expiredDate: null }, { expiredDate: { gte: AS_OF } }],
    });
    // effectiveDate is no longer a bare top-level equality condition.
    expect(where.effectiveDate).toBeUndefined();
  });
});

describe('buildEligibleAhspVersionWhere — private route is strictly tenant-bound', () => {
  it('requires the version itself to belong to this exact workspace', () => {
    expect(branches().priv.workspaceId).toBe(WS);
  });

  it('requires the owning AHSP to belong to this exact workspace and be a USER_ASSET', () => {
    const owner = (branches().priv.ahsp as any).is;
    expect(owner.workspaceId).toBe(WS);
    expect(owner.ownershipType).toBe('USER_ASSET');
  });

  /**
   * The single most important property in this file. ownershipType defaults to
   * USER_ASSET and is hardcoded to USER_ASSET even on the null-workspace
   * "Official Repository" create branch. If the private route had reused the
   * catalog route's `OR: [{workspaceId}, {workspaceId: null}]` tenant clause,
   * every null-workspace row would have become eligible for every tenant.
   */
  it('never admits a null workspaceId — not on the version, not on the AHSP', () => {
    const { priv } = branches();
    expect(priv.workspaceId).not.toBeNull();
    expect((priv.ahsp as any).is.workspaceId).not.toBeNull();
    // No `{ workspaceId: null }` alternative may appear anywhere in the branch.
    expect(JSON.stringify(priv)).not.toContain('"workspaceId":null');
  });

  it('excludes retired versions but does not demand national publication', () => {
    const { priv } = branches();
    expect((priv.status as any).notIn).toEqual([
      AhspVersionStatus.SUPERSEDED,
      AhspVersionStatus.ARCHIVED,
    ]);
    // Crucially: a private version is NOT required to be PUBLISHED.
    expect(JSON.stringify(priv.status)).not.toContain('PUBLISHED');
  });

  it('excludes an archived or deleted owning AHSP', () => {
    const owner = (branches().priv.ahsp as any).is;
    expect(owner.deletedAt).toBeNull();
    expect(owner.archivedAt).toBeNull();
  });

  it('binds to the caller workspace it is given, not to a captured one', () => {
    const { priv } = branches(OTHER_WS);
    expect(priv.workspaceId).toBe(OTHER_WS);
    expect((priv.ahsp as any).is.workspaceId).toBe(OTHER_WS);
    expect(JSON.stringify(priv)).not.toContain(WS);
  });
});

describe('classifyAhspOrigin — honest labelling', () => {
  const ownAsset = {
    status: AhspVersionStatus.DRAFT,
    ahsp: { workspaceId: WS, ownershipType: 'USER_ASSET' },
  };

  it('labels this workspace own unpublished USER_ASSET as private', () => {
    expect(classifyAhspOrigin(ownAsset, WS)).toBe(AHSP_ORIGIN.WORKSPACE_PRIVATE);
  });

  it('labels another workspace asset as catalog, never as this workspace private', () => {
    expect(
      classifyAhspOrigin(
        { ...ownAsset, ahsp: { workspaceId: OTHER_WS, ownershipType: 'USER_ASSET' } },
        WS,
      ),
    ).toBe(AHSP_ORIGIN.SIMPROK_CATALOG);
  });

  it('labels a null-workspace asset as catalog even though it is a USER_ASSET by default', () => {
    expect(
      classifyAhspOrigin(
        { ...ownAsset, ahsp: { workspaceId: null, ownershipType: 'USER_ASSET' } },
        WS,
      ),
    ).toBe(AHSP_ORIGIN.SIMPROK_CATALOG);
  });

  it('labels a PUBLISHED version as catalog even when this workspace owns it', () => {
    expect(
      classifyAhspOrigin({ ...ownAsset, status: AhspVersionStatus.PUBLISHED }, WS),
    ).toBe(AHSP_ORIGIN.SIMPROK_CATALOG);
  });

  it('labels a SIMPROK_ASSET as catalog', () => {
    expect(
      classifyAhspOrigin(
        { ...ownAsset, ahsp: { workspaceId: WS, ownershipType: 'SIMPROK_ASSET' } },
        WS,
      ),
    ).toBe(AHSP_ORIGIN.SIMPROK_CATALOG);
  });

  it('never calls a private asset published', () => {
    expect(classifyAhspOrigin(ownAsset, WS)).not.toContain('PUBLISH');
  });
});

describe('pickCurrentApplicableAhspVersions — one current snapshot per parent', () => {
  const row = (
    id: string,
    parentId: string,
    versionNumber: number,
  ) => ({ id, versionNumber, ahsp: { id: parentId } });

  it('keeps only the highest versionNumber of one parent', () => {
    expect(
      pickCurrentApplicableAhspVersions([
        row('v4', 'ahsp-a', 4),
        row('v5', 'ahsp-a', 5),
      ]).map((version) => version.id),
    ).toEqual(['v5']);
  });

  it('does not collapse snapshots that belong to different parents', () => {
    expect(
      pickCurrentApplicableAhspVersions([
        row('a1', 'ahsp-a', 1),
        row('b1', 'ahsp-b', 1),
      ]).map((version) => version.id),
    ).toEqual(['a1', 'b1']);
  });

  it('does not mutate the input rows', () => {
    const versions = [row('v1', 'ahsp-a', 1), row('v2', 'ahsp-a', 2)];
    pickCurrentApplicableAhspVersions(versions);
    expect(versions.map((version) => version.id)).toEqual(['v1', 'v2']);
  });

  it('has no date or regulation fields — those belong to the WHERE, not this projection', () => {
    const src = readFileSync(join(__dirname, 'ahsp-eligibility.policy.ts'), 'utf8');
    const picker = src.slice(
      src.indexOf('export const pickCurrentApplicableAhspVersions'),
      src.indexOf('export const classifyAhspOrigin'),
    );
    expect(picker).not.toContain('effectiveDate');
    expect(picker).not.toContain('expiredDate');
    expect(picker).not.toContain('regulationReference');
    expect(picker).toContain('versionNumber');
  });
});

describe('RAB lock stays on lawful-formula eligibility, not current-applicable projection', () => {
  it('does not import pickCurrentApplicableAhspVersions', () => {
    const src = readFileSync(
      join(__dirname, '../project/rab-lock.service.ts'),
      'utf8',
    );
    expect(src).toContain('buildEligibleAhspVersionWhere');
    expect(src).not.toContain('pickCurrentApplicableAhspVersions');
  });
});

describe('AHSP identity unique is schema filler, not user-facing currentness', () => {
  it('still uniquely keys parent rows on methodType and locationType', () => {
    const schema = readFileSync(
      join(__dirname, '../../prisma/schema.prisma'),
      'utf8',
    );
    expect(schema).toContain(
      '@@unique([workspaceId, workType, methodType, locationType, methodName])',
    );
    expect(schema).toContain('@@unique([ahspId, versionNumber])');
  });

  it('application create identity does not include methodType or locationType', () => {
    const src = readFileSync(
      join(__dirname, '../ahsp/services/ahsp.service.ts'),
      'utf8',
    );
    expect(src).toContain('AHSP_PARENT_IDENTITY_FILLER');
    expect(src).toContain('AHSP_SOURCE_IDENTITY_EXISTS');
    expect(src).toContain('methodType: MethodType.OTHER');
    expect(src).toContain('locationType: LocationType.OTHER');
  });
});

/**
 * AN UNPROVEN DATE IS UNKNOWN, NEVER EXPIRED.
 *
 * An AHSP is a formula born of a regulation, not a dated price. A source that
 * never stated when its analysis began to apply has not thereby stated that the
 * analysis stopped applying — so a NULL effectiveDate must not remove a version
 * from selection. What still removes it is a date that IS proven and has not
 * arrived. Each test below fails if that distinction is lost.
 */
describe('buildEligibleAhspVersionWhere — an unknown effective date does not disqualify', () => {
  const dateClause = (field: string) =>
    clauseWith(buildEligibleAhspVersionWhere(WS, AS_OF), field);

  it('1+2. admits an unknown start AND a proven start already reached', () => {
    expect(dateClause('effectiveDate')).toEqual({
      OR: [{ effectiveDate: null }, { effectiveDate: { lte: AS_OF } }],
    });
  });

  it('3. still refuses a start that is proven and has NOT arrived', () => {
    const clause = dateClause('effectiveDate');
    const proven = clause.OR.find((b: any) => b.effectiveDate !== null);
    // `lte` is what keeps a future-dated version out; `lt`/absence would not.
    expect(proven).toEqual({ effectiveDate: { lte: AS_OF } });
    expect(JSON.stringify(clause)).not.toContain('gte');
  });

  it('4+5. the end of the window is scoped exactly as before — unknown end admitted, proven past end refused', () => {
    expect(dateClause('expiredDate')).toEqual({
      OR: [{ expiredDate: null }, { expiredDate: { gte: AS_OF } }],
    });
  });

  it('6+7. SUPERSEDED and ARCHIVED remain refused, whatever the dates say', () => {
    // The refusal is a status exclusion on the private branch, independent of
    // either date clause — relaxing a date can never reach it.
    expect((branches().priv.status as any).notIn).toEqual([
      AhspVersionStatus.SUPERSEDED,
      AhspVersionStatus.ARCHIVED,
    ]);
    expect(JSON.stringify(branches().priv.status)).not.toContain('null');
  });

  it('8. Official/Public semantics are untouched — the catalog branch still demands PUBLISHED and its own tenant clause', () => {
    const { catalog } = branches();
    expect(catalog.status).toBe(AhspVersionStatus.PUBLISHED);
    expect(catalog.OR).toEqual([{ workspaceId: WS }, { workspaceId: null }]);
    expect((catalog.ahsp as any).is.OR).toEqual([
      { workspaceId: WS },
      { workspaceId: null },
    ]);
    expect((catalog.ahsp as any).is.deletedAt).toBeNull();
  });

  it('9. completeness still means unit + components, and nothing was widened besides the one date', () => {
    const where = buildEligibleAhspVersionWhere(WS, AS_OF);
    expect(where.outputUnit).toEqual({ not: null });
    expect(where.resources).toEqual({ some: {} });
    // Exactly three AND clauses: the two date windows and the origin choice.
    expect((where.AND as any[]).length).toBe(3);
  });

  it('9b. binding history is not re-judged: lock does not apply new-use currentness', () => {
    // A pinned occurrence must not move when a newer sibling appears, so the
    // lock path deliberately uses the predicate WITHOUT the currentness pick.
    const lock = readFileSync(
      join(__dirname, '../project/rab-lock.service.ts'),
      'utf8',
    );
    expect(lock).toContain('buildEligibleAhspVersionWhere');
    expect(lock).not.toContain('pickCurrentApplicableAhspVersions');
  });
});
