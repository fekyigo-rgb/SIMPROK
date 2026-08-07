import { Prisma, PriceVerificationStatus } from '@prisma/client';
import {
  BASIC_PRICE_ELIGIBILITY_POLICY_VERSION,
  BasicPriceEligibilityPolicy,
  buildUsableBasicPriceWhere,
  PUBLIC_BASIC_PRICE_STATUS,
  PUBLIC_BASIC_PRICE_VERIFICATION_STATUS,
  EligibilityCandidate,
} from './basic-price-eligibility.policy';

describe('BasicPriceEligibilityPolicy', () => {
  let policy: BasicPriceEligibilityPolicy;

  beforeEach(() => {
    policy = new BasicPriceEligibilityPolicy();
  });

  describe('publicEligibilityWhere', () => {
    it('returns exactly the two-axis predicate, nothing wider', () => {
      expect(policy.publicEligibilityWhere()).toEqual({
        status: 'PUBLISHED',
        verificationStatus: PriceVerificationStatus.PUBLISHED,
      });
    });

    it('exposes the same constants used to build the where-fragment', () => {
      expect(PUBLIC_BASIC_PRICE_STATUS).toBe('PUBLISHED');
      expect(PUBLIC_BASIC_PRICE_VERIFICATION_STATUS).toBe(
        PriceVerificationStatus.PUBLISHED,
      );
    });

    /**
     * RM-03C REGRESSION LOCK. `publicEligibilityWhere` is the answer to "is
     * this row PUBLICLY eligible" — a question about PUBLICATION. RM-03C adds
     * a second, separate question ("may THIS workspace use this row") and must
     * not have changed the first one by so much as a key.
     */
    it('is untouched by RM-03C: no ownership condition leaked into publication', () => {
      const where = policy.publicEligibilityWhere();
      expect(Object.keys(where).sort()).toEqual([
        'status',
        'verificationStatus',
      ]);
      expect(where).not.toHaveProperty('assetScope');
      expect(where).not.toHaveProperty('workspaceId');
      expect(where).not.toHaveProperty('OR');
    });
  });

  /**
   * RM-03C — usable-by-this-workspace: catalog OR own private, two additive
   * branches, never one widened predicate.
   */
  describe('usableWhere / buildUsableBasicPriceWhere', () => {
    const workspaceId = '20000000-0000-4000-8000-000000000001';
    const branches = () => {
      const where = policy.usableWhere(workspaceId);
      expect(Object.keys(where)).toEqual(['OR']);
      const or = where.OR as Prisma.BasicPriceWhereInput[];
      expect(or).toHaveLength(2);
      return { catalog: or[0] as any, priv: or[1] as any };
    };

    it('is the same predicate whether built via the class or the pure function', () => {
      expect(policy.usableWhere(workspaceId)).toEqual(
        buildUsableBasicPriceWhere(workspaceId),
      );
    });

    it('catalog branch preserves the publication predicate and the tenant/global clause exactly', () => {
      const { catalog } = branches();
      expect(catalog.status).toBe(PUBLIC_BASIC_PRICE_STATUS);
      expect(catalog.verificationStatus).toBe(
        PUBLIC_BASIC_PRICE_VERIFICATION_STATUS,
      );
      expect(catalog.OR).toEqual([{ workspaceId }, { workspaceId: null }]);
      // Publication must not acquire an ownership condition. Narrowing the
      // catalog by assetScope would change what "published" means.
      expect(catalog).not.toHaveProperty('assetScope');
      expect(Object.keys(catalog).sort()).toEqual([
        'OR',
        'status',
        'verificationStatus',
      ]);
    });

    it('private branch requires WORKSPACE_PRIVATE and STRICT workspace equality', () => {
      const { priv } = branches();
      expect(priv.assetScope).toBe('WORKSPACE_PRIVATE');
      expect(priv.workspaceId).toBe(workspaceId);
    });

    it('private branch never matches a null workspace — the cross-tenant leak shape', () => {
      const { priv } = branches();
      // Not `OR: [{workspaceId}, {workspaceId: null}]`, which would have made
      // every null-workspace row eligible for every tenant at once.
      expect(priv).not.toHaveProperty('OR');
      expect(JSON.stringify(priv)).not.toContain('"workspaceId":null');
      expect(priv.workspaceId).not.toBeNull();
      expect(typeof priv.workspaceId).toBe('string');
    });

    it('private branch never requires — and never grants — publication', () => {
      const { priv } = branches();
      // A private price is usable WITHOUT publication...
      expect(priv).not.toHaveProperty('status');
      // ...and a REJECTED verification is still terminal for it.
      expect(priv.verificationStatus).toEqual({
        not: PriceVerificationStatus.REJECTED,
      });
    });

    it('introduces NO private-vs-catalog precedence', () => {
      const where = policy.usableWhere(workspaceId);
      // An OR of two branches states eligibility only. There is no orderBy,
      // no ranking key, no priority field, and no tie-breaker anywhere in the
      // predicate — deciding which of two eligible prices wins is an OPEN
      // OWNER DECISION and is deliberately not answered here.
      const serialized = JSON.stringify(where);
      expect(serialized).not.toContain('orderBy');
      expect(serialized).not.toContain('priority');
      expect(serialized).not.toContain('rank');
      expect(Object.keys(where)).toEqual(['OR']);
    });

    it('the two branches are scoped to the SAME workspace and nothing else', () => {
      const { catalog, priv } = branches();
      const other = '20000000-0000-4000-8000-0000000000ff';
      expect(JSON.stringify({ catalog, priv })).not.toContain(other);
    });

    it('is deterministic and free of hidden state', () => {
      expect(policy.usableWhere(workspaceId)).toEqual(
        policy.usableWhere(workspaceId),
      );
    });

    it('carries a stated policy version', () => {
      expect(BASIC_PRICE_ELIGIBILITY_POLICY_VERSION).toBe(
        'RM03C_PRIVATE_BASIC_PRICE_ELIGIBILITY_V1',
      );
    });
  });

  describe('evaluate', () => {
    const fullyEligible: EligibilityCandidate = {
      status: 'PUBLISHED',
      verificationStatus: PriceVerificationStatus.PUBLISHED,
      resourceId: 'rc-01',
      unit: 'Zak',
      regionId: 'reg-01',
      effectiveDate: new Date('2026-01-01'),
      sourceOrigin: 'GOVERNMENT',
      freshnessStatus: 'CURRENT',
      hasUnresolvedCollision: false,
      rejected: false,
      importProvenanceComplete: true,
    };

    it('passes a fully-evidenced candidate as ELIGIBLE', () => {
      expect(policy.evaluate(fullyEligible)).toEqual({
        eligible: true,
        reasonCode: 'ELIGIBLE',
      });
    });

    it('unit/region/collision/rejected/import-provenance are optional dimensions — omitting them never blocks a candidate that has the mandatory fields', () => {
      expect(
        policy.evaluate({
          status: 'PUBLISHED',
          verificationStatus: PriceVerificationStatus.PUBLISHED,
          resourceId: 'rc-01',
          effectiveDate: new Date('2026-01-01'),
          sourceOrigin: 'GOVERNMENT',
          // unit, regionId, freshnessStatus, hasUnresolvedCollision, rejected,
          // importProvenanceComplete all omitted on purpose.
        }),
      ).toEqual({ eligible: true, reasonCode: 'ELIGIBLE' });
    });

    it('NOT_PUBLISHED when status is not PUBLISHED', () => {
      expect(
        policy.evaluate({ ...fullyEligible, status: 'UNPUBLISHED' }),
      ).toEqual({
        eligible: false,
        reasonCode: 'NOT_PUBLISHED',
      });
    });

    it('NOT_VERIFICATION_TERMINAL when verificationStatus is VERIFIED, not PUBLISHED', () => {
      expect(
        policy.evaluate({
          ...fullyEligible,
          verificationStatus: PriceVerificationStatus.VERIFIED,
        }),
      ).toEqual({ eligible: false, reasonCode: 'NOT_VERIFICATION_TERMINAL' });
    });

    it('RESOURCE_IDENTITY_MISSING when resourceId is absent', () => {
      expect(policy.evaluate({ ...fullyEligible, resourceId: null })).toEqual({
        eligible: false,
        reasonCode: 'RESOURCE_IDENTITY_MISSING',
      });
    });

    it('UNIT_IDENTITY_MISSING when unit is explicitly empty', () => {
      expect(policy.evaluate({ ...fullyEligible, unit: '' })).toEqual({
        eligible: false,
        reasonCode: 'UNIT_IDENTITY_MISSING',
      });
    });

    it('REGION_IDENTITY_MISSING when regionId is explicitly null — never treated as global', () => {
      expect(policy.evaluate({ ...fullyEligible, regionId: null })).toEqual({
        eligible: false,
        reasonCode: 'REGION_IDENTITY_MISSING',
      });
    });

    it('EFFECTIVE_DATE_MISSING when effectiveDate is absent', () => {
      expect(
        policy.evaluate({ ...fullyEligible, effectiveDate: null }),
      ).toEqual({
        eligible: false,
        reasonCode: 'EFFECTIVE_DATE_MISSING',
      });
    });

    it('SOURCE_IDENTITY_MISSING when sourceOrigin is absent', () => {
      expect(policy.evaluate({ ...fullyEligible, sourceOrigin: null })).toEqual(
        {
          eligible: false,
          reasonCode: 'SOURCE_IDENTITY_MISSING',
        },
      );
    });

    it('treats EXPIRED as evidence only when every eligibility requirement is satisfied', () => {
      expect(
        policy.evaluate({ ...fullyEligible, freshnessStatus: 'EXPIRED' }),
      ).toEqual({
        eligible: true,
        reasonCode: 'ELIGIBLE',
      });
    });

    it('freshness evidence never masks a higher-priority eligibility blocker', () => {
      expect(
        policy.evaluate({
          ...fullyEligible,
          freshnessStatus: 'EXPIRED',
          regionId: null,
        }),
      ).toEqual({ eligible: false, reasonCode: 'REGION_IDENTITY_MISSING' });
    });

    it('UNRESOLVED_COLLISION_PRESENT when a collision flag is set', () => {
      expect(
        policy.evaluate({ ...fullyEligible, hasUnresolvedCollision: true }),
      ).toEqual({
        eligible: false,
        reasonCode: 'UNRESOLVED_COLLISION_PRESENT',
      });
    });

    it('REJECTED when the rejected flag is set', () => {
      expect(policy.evaluate({ ...fullyEligible, rejected: true })).toEqual({
        eligible: false,
        reasonCode: 'REJECTED',
      });
    });

    it('INCOMPLETE_NEW_IMPORT_PROVENANCE when an RM-02-imported price is missing its row/batch evidence', () => {
      expect(
        policy.evaluate({ ...fullyEligible, importProvenanceComplete: false }),
      ).toEqual({
        eligible: false,
        reasonCode: 'INCOMPLETE_NEW_IMPORT_PROVENANCE',
      });
    });

    it('checks status before verification (priority order)', () => {
      expect(
        policy.evaluate({
          ...fullyEligible,
          status: 'UNPUBLISHED',
          verificationStatus: PriceVerificationStatus.VERIFIED,
        }),
      ).toEqual({ eligible: false, reasonCode: 'NOT_PUBLISHED' });
    });
  });
});
