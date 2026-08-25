import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  ACTIVE_MEMBERSHIP_BASELINE_PERMISSION_CODES,
  GOVERNED_ACTIVATION_PERMISSION_CODES,
  PERMISSIONS,
  SEEDED_PERMISSION_CODES,
} from '../common/constants/permissions';

const sourceRoot = join(__dirname, '..');
const collectTs = (dir: string): string[] =>
  readdirSync(dir)
    .sort((left, right) => left.localeCompare(right))
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory()
        ? collectTs(path)
        : name.endsWith('.ts') && !name.endsWith('.spec.ts')
          ? [path]
          : [];
    });

/**
 * BP-CAT-01D SEAM 1 — WHO MAY GRANT SHARED-KNOWLEDGE AUTHORITY.
 *
 * A workspace may own a fact. Only SIMPROK governance may lift that fact into
 * shared knowledge. BASIC_PRICE_PROMOTE_SHARED is what performs that lift, so
 * the load-bearing question is not "is the code rare" but "can a tenant obtain
 * it from inside its own workspace".
 *
 * Today it cannot, and the reason is structural rather than a policy anyone
 * wrote down: SIMPROK has NO production code path that creates a Role, attaches
 * a RolePermission, or assigns a MembershipRole. Effective permissions are
 * BASELINE ∪ role-granted (WorkspacePermissionResolverService), and with no
 * writer for the role side, the only way any non-baseline code reaches an actor
 * is a governed operator acting on the database directly.
 *
 * THAT PROPERTY IS AN ACCIDENT UNTIL SOMETHING ENFORCES IT. The day a role
 * management screen lands, a workspace admin could mint a role, attach this
 * code, assign it to themselves, and quietly acquire platform authority — with
 * no test going red. This spec is the thing that goes red.
 *
 * It is a GRANT-PATH census, not a style rule: it says nothing about how roles
 * should be managed, only that adding an in-product grant path is a decision
 * that must be made deliberately, with this authority re-adjudicated first.
 */
describe('BP-CAT-01D authority grant path', () => {
  const productionSources = () =>
    collectTs(sourceRoot).map((file) => ({
      relative: file.replace(/\\/g, '/').split('/src/')[1],
      // Comments stripped: several files discuss roles and permissions in prose,
      // and an explanation is not a writer.
      code: readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, ''),
    }));

  const writersOf = (model: string) =>
    productionSources()
      .filter(({ code }) =>
        new RegExp(
          `(?:tx|prisma)\\.${model}\\.(create|createMany|update|updateMany|upsert)\\s*\\(`,
        ).test(code),
      )
      .map(({ relative }) => relative);

  it('NO production code path can create a Role or assign a MembershipRole', () => {
    // Without BOTH of these a tenant cannot route any non-baseline permission to
    // an actor, whatever else it may administer. This is the invariant that
    // makes TENANT_SELF_ELEVATION = NO true rather than merely intended.
    expect(writersOf('role')).toEqual([]);
    expect(writersOf('membershipRole')).toEqual([]);
  });

  it('NO production code path can attach an Authority to a Position', () => {
    // The Authority chain (Position -> PositionAuthority -> Authority) is the
    // other mechanism that could carry decision authority. It is currently
    // inert: AuthorityService.createAuthority and assignAuthority both throw
    // unconditionally, and no guard or resolver anywhere reads PositionAuthority.
    expect(writersOf('positionAuthority')).toEqual([]);
    expect(writersOf('authority')).toEqual([]);
  });

  it('the only RolePermission writer is the unwired activation planner', () => {
    // Registered rather than exempted. It has no HTTP route and no caller; it is
    // a governed activation plan, not a product feature. If it ever gains a
    // caller, this test is where that decision surfaces.
    expect(writersOf('rolePermission')).toEqual([
      'auth/rm01-permission-activation-planner.ts',
    ]);
    const planner = readFileSync(
      join(sourceRoot, 'auth', 'rm01-permission-activation-planner.ts'),
      'utf8',
    );
    // It must not have quietly become a Nest provider that a controller can inject.
    expect(planner).not.toContain('@Injectable');
  });

  it('BASIC_PRICE_PROMOTE_SHARED is governed-activation only — never baseline, never seeded', () => {
    expect(GOVERNED_ACTIVATION_PERMISSION_CODES).toContain(
      PERMISSIONS.BASIC_PRICE_PROMOTE_SHARED,
    );
    // The two lists that would hand it out automatically.
    expect(ACTIVE_MEMBERSHIP_BASELINE_PERMISSION_CODES).not.toContain(
      PERMISSIONS.BASIC_PRICE_PROMOTE_SHARED,
    );
    expect(SEEDED_PERMISSION_CODES).not.toContain(
      PERMISSIONS.BASIC_PRICE_PROMOTE_SHARED,
    );
    // And the baseline stays exactly the four codes the Owner decision names —
    // a fifth appearing here is a privilege widening, whatever it is called.
    expect([...ACTIVE_MEMBERSHIP_BASELINE_PERMISSION_CODES].sort()).toEqual([
      'BASIC_PRICE_IMPORT',
      'BASIC_PRICE_RESOLVE',
      'BASIC_PRICE_SUBMIT',
      'BASIC_PRICE_VIEW',
    ]);
  });

  it('no canonical seed grants the promotion authority to any role', () => {
    const seed = readFileSync(
      join(sourceRoot, '..', 'prisma', 'seed-rbac-permissions.ts'),
      'utf8',
    );
    expect(seed).not.toContain('BASIC_PRICE_PROMOTE_SHARED');
  });
});
