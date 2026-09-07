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

const branches = (workspaceId = WS) => {
  const where = buildEligibleAhspVersionWhere(workspaceId, AS_OF);
  const originBranch = (where.AND as any[])[1];
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

  it('keeps the shared completeness and date scope at the top level', () => {
    const { where } = branches();
    expect(where.effectiveDate).toEqual({ lte: AS_OF });
    expect(where.outputUnit).toEqual({ not: null });
    expect(where.resources).toEqual({ some: {} });
    expect((where.AND as any[])[0]).toEqual({
      OR: [{ expiredDate: null }, { expiredDate: { gte: AS_OF } }],
    });
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
