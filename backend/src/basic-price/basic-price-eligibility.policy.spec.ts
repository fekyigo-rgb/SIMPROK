import { PriceVerificationStatus } from '@prisma/client';
import {
  BasicPriceEligibilityPolicy,
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
      expect(PUBLIC_BASIC_PRICE_VERIFICATION_STATUS).toBe(PriceVerificationStatus.PUBLISHED);
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
      expect(policy.evaluate(fullyEligible)).toEqual({ eligible: true, reasonCode: 'ELIGIBLE' });
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
      expect(policy.evaluate({ ...fullyEligible, status: 'UNPUBLISHED' })).toEqual({
        eligible: false,
        reasonCode: 'NOT_PUBLISHED',
      });
    });

    it('NOT_VERIFICATION_TERMINAL when verificationStatus is VERIFIED, not PUBLISHED', () => {
      expect(
        policy.evaluate({ ...fullyEligible, verificationStatus: PriceVerificationStatus.VERIFIED }),
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
      expect(policy.evaluate({ ...fullyEligible, effectiveDate: null })).toEqual({
        eligible: false,
        reasonCode: 'EFFECTIVE_DATE_MISSING',
      });
    });

    it('SOURCE_IDENTITY_MISSING when sourceOrigin is absent', () => {
      expect(policy.evaluate({ ...fullyEligible, sourceOrigin: null })).toEqual({
        eligible: false,
        reasonCode: 'SOURCE_IDENTITY_MISSING',
      });
    });

    it('FRESHNESS_EXPIRED when freshnessStatus is EXPIRED', () => {
      expect(policy.evaluate({ ...fullyEligible, freshnessStatus: 'EXPIRED' })).toEqual({
        eligible: false,
        reasonCode: 'FRESHNESS_EXPIRED',
      });
    });

    it('UNRESOLVED_COLLISION_PRESENT when a collision flag is set', () => {
      expect(policy.evaluate({ ...fullyEligible, hasUnresolvedCollision: true })).toEqual({
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
      expect(policy.evaluate({ ...fullyEligible, importProvenanceComplete: false })).toEqual({
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
