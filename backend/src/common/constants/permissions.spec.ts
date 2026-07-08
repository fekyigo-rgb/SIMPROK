import {
  PERMISSIONS,
  PERMISSION_CATALOG,
  DECLARED_NOT_SEEDED_PERMISSION_CODES,
  SEEDED_PERMISSION_CODES,
} from './permissions';

describe('Permissions Catalog', () => {
  it('should include all PERMISSIONS in the PERMISSION_CATALOG', () => {
    const catalogCodes = PERMISSION_CATALOG.map((entry) => entry.code);
    const allPermissions = Object.values(PERMISSIONS);
    
    allPermissions.forEach((permissionCode) => {
      expect(catalogCodes).toContain(permissionCode);
    });
  });

  it('should categorize every permission as either seeded or declared_not_seeded', () => {
    const allPermissions = Object.values(PERMISSIONS);
    const categorized = [...SEEDED_PERMISSION_CODES, ...DECLARED_NOT_SEEDED_PERMISSION_CODES];
    
    allPermissions.forEach((permissionCode) => {
      expect(categorized).toContain(permissionCode);
    });
  });

  it('should include Golden Path v0 Slice A permissions in DECLARED_NOT_SEEDED_PERMISSION_CODES', () => {
    const expectedNewPermissions = [
      PERMISSIONS.AHSP_VIEW,
      PERMISSIONS.AHSP_MANAGE,
      PERMISSIONS.AHSP_APPROVE,
      PERMISSIONS.BASIC_PRICE_VIEW,
      PERMISSIONS.BASIC_PRICE_MANAGE,
    ];

    expectedNewPermissions.forEach((permissionCode) => {
      expect(DECLARED_NOT_SEEDED_PERMISSION_CODES).toContain(permissionCode);
    });
  });
});
