import { readFileSync } from 'fs';
import { join } from 'path';
import { PERMISSIONS } from '../common/constants/permissions';

/**
 * Source contract for the acceptance DIRECTOR AHSP grant.
 * The seed file executes on import, so this suite reads it as text.
 */
describe('acceptance DIRECTOR AHSP fixture', () => {
  const seed = readFileSync(
    join(__dirname, '..', '..', 'prisma', 'seed-acceptance.ts'),
    'utf8',
  );
  const productionBootstrap = readFileSync(
    join(__dirname, '..', '..', 'prisma', 'seed-rbac-permissions.ts'),
    'utf8',
  );
  const schema = readFileSync(
    join(__dirname, '..', '..', 'prisma', 'schema.prisma'),
    'utf8',
  );

  const grantBlock = () => {
    const start = seed.indexOf('const ACCEPTANCE_DIRECTOR_AHSP_CODES');
    const end = seed.indexOf('async function main()');
    return seed.slice(start, end);
  };

  it('reuses the two canonical AHSP codes and no new code', () => {
    const block = grantBlock();
    expect(block).toContain('PERMISSIONS.AHSP_VIEW');
    expect(block).toContain('PERMISSIONS.AHSP_MANAGE');
    expect(block).not.toContain('AHSP_APPROVE');
    expect(PERMISSIONS.AHSP_VIEW).toBe('AHSP_VIEW');
    expect(PERMISSIONS.AHSP_MANAGE).toBe('AHSP_MANAGE');
    expect(block.match(/PERMISSIONS\.AHSP_[A-Z_]+/g)).toEqual([
      'PERMISSIONS.AHSP_VIEW',
      'PERMISSIONS.AHSP_MANAGE',
    ]);
  });

  it('binds those codes to the existing DIRECTOR role and no new role', () => {
    expect(seed).toContain("code: 'DIRECTOR'");
    expect(seed).toContain('id: ids.roleAcceptanceFrontendDoorDirector');
    expect(seed).toContain('await grantAcceptanceDirectorAhsp(workspaceA.id)');
    expect(grantBlock()).toContain("code: 'DIRECTOR'");
    expect(grantBlock()).toContain('grantPermissionsToRole');
    expect(grantBlock()).not.toContain('role.create');
    expect(grantBlock()).not.toContain('membershipRole.create');
  });

  it('upserts permission and role-permission rows so a rerun cannot duplicate them', () => {
    expect(grantBlock()).toContain('tx.permission.upsert');
    expect(grantBlock()).toContain('where: { code: permission.code }');
    expect(productionBootstrap).toContain('tx.rolePermission.upsert');
    expect(productionBootstrap).toContain('roleId_permissionId: { roleId, permissionId }');
    expect(schema).toContain('code        String   @unique');
    expect(schema).toContain('@@unique([workspaceId, code])');
    expect(schema).toContain('@@unique([roleId, permissionId])');
  });

  it('leaves the production simprok_db guard intact and refuses that database itself', () => {
    expect(productionBootstrap).toContain("const EXPECTED_DATABASE = 'simprok_db'");
    expect(productionBootstrap).toContain('if (actualDatabase !== EXPECTED_DATABASE)');
    expect(seed).toContain("database.name === 'simprok_db'");
    expect(seed).toContain('Number(database.port) === 55432');
    expect(seed).not.toContain('ensureCanonicalPermissions');
  });
});
