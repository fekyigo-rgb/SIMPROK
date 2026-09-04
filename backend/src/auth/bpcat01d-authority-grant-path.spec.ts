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
    // other mechanism that could carry decision authority.
    //
    // PLATFORM-AUTHORITY RECONCILIATION — this comment used to say the chain was
    // "inert" and that "no guard or resolver anywhere reads PositionAuthority".
    // The second half was FALSE and mattered: ProgressAuthorityService reads and
    // ENFORCES on it (progress-authority.service.ts:165 raw SQL, :204
    // positionAuthority.findFirst, :245 approvalMatrix.count), the acceptance
    // seed writes both models (prisma/seed-acceptance.ts:999,1005), and the
    // models exist at schema.prisma:1097,1111. A reader who believed the old
    // wording would conclude the chain is dead and rebuild it — the exact
    // duplication this suite exists to prevent.
    //
    // What is TRUE, and is what these assertions actually protect: the chain is
    // READ in production but never WRITTEN there. Its four writers/readers in
    // AuthorityService throw unconditionally (authority.service.ts:103-117) —
    // and note their message, "Authority model is missing from Prisma Schema",
    // is itself false. So repairing AuthorityService would create production
    // writers and turn THIS TEST RED. That is by design: per the docblock above,
    // adding a grant path is a decision to be made deliberately, with the
    // authority re-adjudicated first. The red test is the adjudication trigger,
    // not an obstacle to route around.
    // THE ADJUDICATION HAPPENED, AND THIS IS ITS RECORD.
    //
    // The paragraph above says a grant path must be adjudicated before it
    // exists, and that the red test is the trigger. It was: the Owner ruled that
    // RAB approval requires an Authority (a Permission alone is not legitimacy),
    // that the canonical carrier is this exact chain, and that its one missing
    // piece was a governed writer coupled to provenance. O1 is that writer.
    //
    // So this is no longer "nobody writes it". It is the STRONGER claim: exactly
    // one production file may, and here is its name. A second writer — including
    // a repaired AuthorityService — still turns this red.
    expect(writersOf('positionAuthority')).toEqual([
      'authority-governance/authority-governance.service.ts',
    ]);
    // The VOCABULARY is still never written in production. O1 grants existing
    // authorities to seats; it never invents one.
    expect(writersOf('authority')).toEqual([]);
  });

  it('the ONE authority grant writer couples every grant to immutable provenance', () => {
    // A writer of position_authorities that did not also append provenance would
    // be a state-without-history bypass — the exact defect O1 exists to close.
    const grantWriters = writersOf('positionAuthority');
    expect(grantWriters).toHaveLength(1);

    const source = readFileSync(join(sourceRoot, grantWriters[0]), 'utf8');
    expect(source).toMatch(/authorityGovernanceDecision\.create\s*\(/);
    expect(source).toMatch(/\$transaction\s*\(/);
    // And it never rewrites what it has written.
    expect(source).not.toMatch(
      /authorityGovernanceDecision\.(update|updateMany|delete|deleteMany)/,
    );
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

  it('the only PlatformGovernanceDecision writer is the platform governance service', () => {
    // PLATFORM GOVERNANCE — this suite is a CENSUS of authority grant paths, and
    // platform governance created a new one. Leaving it uncensused would make
    // the census quietly incomplete, which is the one thing it cannot be.
    //
    // Platform authority binds an Account directly to an existing Authority,
    // deliberately bypassing the Position chain — so the assertions above about
    // `positionAuthority` say nothing about it. This is its equivalent: exactly
    // one production writer, and it is the narrow governance service. A second
    // writer appearing anywhere is a new grant path, and this is where that
    // decision surfaces.
    expect(writersOf('platformGovernanceDecision')).toEqual([
      'platform-governance/platform-governance.service.ts',
    ]);

    const service = readFileSync(
      join(sourceRoot, 'platform-governance', 'platform-governance.service.ts'),
      'utf8',
    );
    // It must not have quietly acquired an HTTP surface: a grant is an Owner
    // ceremony performed out of band, not a route anyone can call.
    expect(service).not.toMatch(/@(Controller|Post|Get|Patch|Put|Delete)\(/);
    const module = readFileSync(
      join(sourceRoot, 'platform-governance', 'platform-governance.module.ts'),
      'utf8',
    );
    expect(module).not.toContain('controllers');
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
