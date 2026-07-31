import {
  PERMISSIONS,
  PERMISSION_CATALOG,
  PERMISSION_CATALOG_STATES,
  GOVERNED_ACTIVATION_PERMISSION_CODES,
  SEEDED_PERMISSION_CODES,
  ACTIVE_MEMBERSHIP_BASELINE_PERMISSION_CODES,
} from './permissions';

describe('Permissions Catalog', () => {
  it('should include all PERMISSIONS in the PERMISSION_CATALOG', () => {
    const catalogCodes = PERMISSION_CATALOG.map((entry) => entry.code);
    const allPermissions = Object.values(PERMISSIONS);

    allPermissions.forEach((permissionCode) => {
      expect(catalogCodes).toContain(permissionCode);
    });
  });

  // LEGACY_TEST_CHANGE_REGISTER: OLD_EXPECTATION was "every permission is
  // either seeded or governed_activation" (two categories). Owner Decision
  // ONE SIMPROK BASIC PRICE PRODUCT MODEL introduces a third, honest state —
  // ACTIVE_MEMBERSHIP_BASELINE — for capabilities granted structurally to
  // every ACTIVE membership. NEW_EXPECTATION below is a strict superset (an
  // additional valid category), not a relaxation: nothing that was
  // previously categorized stops being categorized, and no governed/internal
  // code moves into the union without also being asserted below to still be
  // GOVERNED_ACTIVATION. TEST_WEAKENING=NO.
  it('should categorize every permission as seeded, governed_activation, or active_membership_baseline', () => {
    const allPermissions = Object.values(PERMISSIONS);
    const categorized = [
      ...SEEDED_PERMISSION_CODES,
      ...GOVERNED_ACTIVATION_PERMISSION_CODES,
      ...ACTIVE_MEMBERSHIP_BASELINE_PERMISSION_CODES,
    ];

    allPermissions.forEach((permissionCode) => {
      expect(categorized).toContain(permissionCode);
    });
  });

  it('should include Golden Path v0 Slice A permissions in SEEDED_PERMISSION_CODES', () => {
    const expectedNewPermissions = [
      PERMISSIONS.AHSP_VIEW,
      PERMISSIONS.AHSP_MANAGE,
      PERMISSIONS.AHSP_APPROVE,
      PERMISSIONS.BASIC_PRICE_VIEW,
      PERMISSIONS.BASIC_PRICE_MANAGE,
    ];

    expectedNewPermissions.forEach((permissionCode) => {
      expect(SEEDED_PERMISSION_CODES).toContain(permissionCode);
    });
  });

  it('ACTIVE_MEMBERSHIP_BASELINE_PERMISSION_CODES is exactly the one-SIMPROK Basic Price baseline (VIEW/IMPORT/RESOLVE/SUBMIT)', () => {
    expect([...ACTIVE_MEMBERSHIP_BASELINE_PERMISSION_CODES].sort()).toEqual(
      [
        PERMISSIONS.BASIC_PRICE_VIEW,
        PERMISSIONS.BASIC_PRICE_IMPORT,
        PERMISSIONS.BASIC_PRICE_RESOLVE,
        PERMISSIONS.BASIC_PRICE_SUBMIT,
      ].sort(),
    );
  });

  it('internal curation codes (REVIEW_VIEW/VERIFY/PUBLISH) are never part of the active-membership baseline', () => {
    expect(ACTIVE_MEMBERSHIP_BASELINE_PERMISSION_CODES).not.toContain(
      PERMISSIONS.BASIC_PRICE_REVIEW_VIEW,
    );
    expect(ACTIVE_MEMBERSHIP_BASELINE_PERMISSION_CODES).not.toContain(
      PERMISSIONS.BASIC_PRICE_VERIFY,
    );
    expect(ACTIVE_MEMBERSHIP_BASELINE_PERMISSION_CODES).not.toContain(
      PERMISSIONS.BASIC_PRICE_PUBLISH,
    );
    expect(GOVERNED_ACTIVATION_PERMISSION_CODES).toEqual(
      expect.arrayContaining([
        PERMISSIONS.BASIC_PRICE_REVIEW_VIEW,
        PERMISSIONS.BASIC_PRICE_VERIFY,
        PERMISSIONS.BASIC_PRICE_PUBLISH,
      ]),
    );
  });

  it("every catalog entry's declared state matches its categorization list", () => {
    const stateByCode = new Map(
      PERMISSION_CATALOG.map((entry) => [entry.code, entry.state]),
    );
    ACTIVE_MEMBERSHIP_BASELINE_PERMISSION_CODES.forEach((code) => {
      expect(stateByCode.get(code)).toBe(
        PERMISSION_CATALOG_STATES.ACTIVE_MEMBERSHIP_BASELINE,
      );
    });
    [
      PERMISSIONS.BASIC_PRICE_REVIEW_VIEW,
      PERMISSIONS.BASIC_PRICE_VERIFY,
      PERMISSIONS.BASIC_PRICE_PUBLISH,
    ].forEach((code) => {
      expect(stateByCode.get(code)).toBe(
        PERMISSION_CATALOG_STATES.GOVERNED_ACTIVATION,
      );
    });
  });
});
