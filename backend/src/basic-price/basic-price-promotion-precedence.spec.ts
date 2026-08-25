import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import {
  PROMOTION_LINEAGE_PRECEDENCE_VERSION,
  promotionLineagePrecedenceWhere,
} from './basic-price-promotion-precedence';
import { buildUsableBasicPriceWhere } from './basic-price-eligibility.policy';

/**
 * BP-CAT-01E — the SELECTION layer, kept honestly separate from the LAWFULNESS
 * layer.
 *
 * These two questions were briefly one function, and the tests below exist to
 * keep them apart: eligibility may never learn about lineage, and precedence may
 * never learn about publication.
 */
describe('promotion lineage precedence', () => {
  const workspaceId = '30000000-0000-4000-8000-000000000001';

  it('shadows a descendant from the workspace that owns its ORIGIN, and from nobody else', () => {
    expect(promotionLineagePrecedenceWhere(workspaceId)).toEqual({
      NOT: { promotedFrom: { is: { workspaceId } } },
    });

    // Keyed on the origin's workspace, never on the descendant's own (always
    // null), so another tenant's view is untouched.
    const other = '30000000-0000-4000-8000-0000000000ff';
    expect(promotionLineagePrecedenceWhere(other)).toEqual({
      NOT: { promotedFrom: { is: { workspaceId: other } } },
    });
    expect(
      JSON.stringify(promotionLineagePrecedenceWhere(workspaceId)),
    ).not.toContain(other);
  });

  it('IDENTITY IS LINEAGE — never money, resource, date, region or source name', () => {
    const serialized = JSON.stringify(
      promotionLineagePrecedenceWhere(workspaceId),
    );
    for (const forbidden of [
      'value',
      'resourceId',
      'effectiveDate',
      'regionId',
      'sourceOrigin',
      'sourceType',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('owns NO eligibility law — it can only remove, never admit', () => {
    const precedence = promotionLineagePrecedenceWhere(workspaceId);
    // A negation cannot widen a result set. Whatever eligibility refused stays
    // refused, so this can never become a second route to a price.
    expect(Object.keys(precedence)).toEqual(['NOT']);
    const serialized = JSON.stringify(precedence);
    expect(serialized).not.toContain('status');
    expect(serialized).not.toContain('verificationStatus');
    expect(serialized).not.toContain('assetScope');
    expect(serialized).not.toContain('OR');
  });

  it('composes BESIDE canonical eligibility without either clobbering the other', () => {
    const composed = {
      ...buildUsableBasicPriceWhere(workspaceId),
      ...promotionLineagePrecedenceWhere(workspaceId),
    };
    // Disjoint keys, so a spread is lossless in either order — the property the
    // consumers rely on.
    expect(Object.keys(composed).sort()).toEqual(['NOT', 'OR']);
    expect(composed.OR).toEqual(buildUsableBasicPriceWhere(workspaceId).OR);
  });

  it('carries a stated version distinct from the eligibility policy version', () => {
    expect(PROMOTION_LINEAGE_PRECEDENCE_VERSION).toBe(
      'BPCAT01E_PROMOTION_LINEAGE_PRECEDENCE_V1',
    );
  });

  /**
   * THE LAYERING LOCK. This is the test that would have caught the original
   * mistake, so it is stated as a rule about WHERE the clause may live rather
   * than about what it says.
   */
  it('the eligibility policy never mentions lineage, and precedence never mentions publication', () => {
    const policy = readFileSync(
      join(__dirname, 'basic-price-eligibility.policy.ts'),
      'utf8',
    );
    // Strip comments: this file's own docblocks discuss promotion at length,
    // and prose is not a predicate.
    const code = (source: string) =>
      source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

    expect(code(policy)).not.toContain('promotedFrom');
    expect(code(policy)).not.toContain('promotionLineagePrecedence');

    const precedence = code(
      readFileSync(
        join(__dirname, 'basic-price-promotion-precedence.ts'),
        'utf8',
      ),
    );
    expect(precedence).not.toContain('PUBLISHED');
    expect(precedence).not.toContain('assetScope');
  });

  /**
   * BP-CAT-01F — WHY THE SIMPLE CONDITION IS EXACT, LOCKED AS AN INVARIANT.
   *
   * The clause shadows a descendant whenever its ORIGIN belongs to the caller.
   * That is only correct if it is impossible for the descendant to be an
   * effective candidate while its origin is not — otherwise a lawful shared
   * price would vanish for the workspace that produced it and nothing would
   * replace it.
   *
   * Today that implication holds STRUCTURALLY, for two independent reasons, and
   * these tests pin both. They are written as rules about what the codebase may
   * contain, not about what the clause looks like, so the day someone makes
   * divergence reachable — a correction that can move a catalog row's date, a
   * retirement flag, a third mutating writer — one of them goes red and
   * promotion precedence gets re-adjudicated before the feature ships.
   *
   * THIS IS THE FUTURE CONTRACT the Owner asked for, expressed as a test rather
   * than a comment nobody runs.
   */
  describe('BP-CAT-01F exactness invariant', () => {
    const read = (relative: string) =>
      readFileSync(join(__dirname, '..', relative), 'utf8');
    const code = (source: string) =>
      source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

    const MUTATING_WRITERS = [
      'basic-price/basic-price-private-asset.service.ts',
      'basic-price/basic-price-publication.service.ts',
    ];

    it('REASON 1 — a promoted descendant is born agreeing with its origin on every candidate axis', () => {
      // Promotion copies these verbatim, so A and B can never disagree at birth
      // about anything a candidate query filters on. The only fields it sets
      // itself are ownership and publication state, and for the SOURCE
      // workspace both rows satisfy the catalog clause either way.
      const promotion = code(
        read('basic-price/basic-price-promotion.service.ts'),
      );
      for (const axis of [
        'resourceId',
        'regionId',
        'effectiveDate',
        'validUntil',
        'sourceOrigin',
        'sourceType',
        'freshnessStatus',
      ]) {
        expect(promotion).toContain(`${axis}: true`);
      }
    });

    it('REASON 2 — only TWO production writers can mutate an existing BasicPrice, and neither can reach a published catalog row', () => {
      const writers = new Set<string>();
      const walk = (dir: string): string[] =>
        readdirSync(dir)
          .sort()
          .flatMap((name) => {
            const path = join(dir, name);
            return statSync(path).isDirectory()
              ? walk(path)
              : name.endsWith('.ts') && !name.endsWith('.spec.ts')
                ? [path]
                : [];
          });

      for (const file of walk(join(__dirname, '..'))) {
        const source = code(readFileSync(file, 'utf8'));
        if (
          /(?:tx|prisma)\.basicPrice\.(update|updateMany|upsert|delete|deleteMany)\s*\(/.test(
            source,
          )
        ) {
          writers.add(file.replace(/\\/g, '/').split('/src/')[1]);
        }
      }
      // A THIRD mutating writer appearing anywhere fails here, because it could
      // move an origin out of candidacy while its descendant stayed in.
      expect([...writers].sort()).toEqual(MUTATING_WRITERS);

      // Writer 1 — the provenance correction. Hard-scoped to WORKSPACE_PRIVATE,
      // so it cannot touch a promoted origin (which must be SIMPROK_CATALOG).
      expect(code(read(MUTATING_WRITERS[0]))).toContain(
        'assetScope: BasicPriceAssetScope.WORKSPACE_PRIVATE',
      );

      // Writer 2 — the publication transition. It refuses any source that is
      // not exactly UNPUBLISHED+VERIFIED, and a promoted origin is already
      // PUBLISHED+PUBLISHED, so it reaches the idempotent branch and writes
      // nothing. Even if it did write, it would write the values A already has.
      const publication = code(read(MUTATING_WRITERS[1]));
      expect(publication).toContain("!== 'UNPUBLISHED'");
      expect(publication).toContain("!== 'VERIFIED'");
    });

    it('REASON 3 — BasicPrice has no retirement, soft-delete or active flag that could drop an origin out of candidacy', () => {
      const model =
        readFileSync(
          join(__dirname, '..', '..', 'prisma', 'schema.prisma'),
          'utf8',
        )
          .split('model BasicPrice {')[1]
          ?.split('\n}')[0] ?? '';
      expect(model).not.toMatch(/^\s*deletedAt\s/m);
      expect(model).not.toMatch(/^\s*archivedAt\s/m);
      expect(model).not.toMatch(/^\s*retiredAt\s/m);
      expect(model).not.toMatch(/^\s*isActive\s/m);
      // And the origin cannot simply be deleted while a descendant stands on
      // it — the lineage FK is RESTRICT.
      expect(model).toContain('onDelete: Restrict');
    });

    /**
     * BP-CORR-01 — REASON 3 RE-ADJUDICATED, EXACTLY AS THE CONTRACT ABOVE
     * ASKED FOR.
     *
     * The tests above were written so that "the day someone makes divergence
     * reachable — a correction that can move a catalog row's date, a retirement
     * flag, a third mutating writer — one of them goes red and promotion
     * precedence gets re-adjudicated before the feature ships." BP-CORR-01 is
     * that day, and this is that re-adjudication. It is a NARROWING of one
     * stated reason, not a reopening of the clause.
     *
     * WHAT CHANGED. Supersession introduces the first lawful way for an origin
     * A to stop being an effective candidate while its shared descendant D
     * stays lawful. So the old mechanical implication —
     *
     *     D effective  ⇒  A effective
     *
     * — is no longer literally true, and pretending otherwise would be exactly
     * the rotting comment the Owner refused to keep in BP-CAT-01D.
     *
     * WHAT DID NOT CHANGE — the clause itself is still exact, for a reason that
     * was always the real one underneath the mechanical test. Shadowing D for
     * the origin's workspace is correct if that workspace is never left staring
     * at a context SIMPROK silently emptied. It is not:
     *
     *   1. A supersession successor is validated into the SAME workspace, the
     *      SAME resource and the SAME region as its predecessor, so a
     *      correction always lands in the very context it emptied — it can
     *      never move the truth to a context the caller was not asking about.
     *   2. The successor must already be PUBLISHED on both axes (database
     *      CHECK), so a predecessor is never dropped for a correction that is
     *      merely proposed.
     *   3. Nothing points at the newest link of a chain, so the chain always
     *      terminates in a current, lawful, workspace-owned catalog row.
     *
     * A superseded origin therefore never vanishes SILENTLY. It disappears from
     * the offer only because a named human published a named successor in the
     * same context, and that act is recorded on both rows. Where the successor's
     * own effective window does not cover the date being asked about, the
     * honest result is that SIMPROK reports no price rather than quietly
     * spending money a human has declared wrong — which is the same fail-closed
     * direction every other rule in this file takes.
     *
     * D IS STILL THE RIGHT ROW TO SHADOW, and more obviously so than before: it
     * restates A's SUPERSEDED money. Offering it back to the workspace that
     * corrected it would hand them the exact number they replaced.
     */
    it('REASON 3 (BP-CORR-01) — the one lawful way an origin leaves candidacy is an explicit published successor, never a flag on the origin', () => {
      const model =
        readFileSync(
          join(__dirname, '..', '..', 'prisma', 'schema.prisma'),
          'utf8',
        )
          .split('model BasicPrice {')[1]
          ?.split('\n}')[0] ?? '';

      // The mechanism is a RELATION TO A REAL SUCCESSOR ARTIFACT, not a mutable
      // column on the predecessor. That distinction is the whole reason history
      // stays immutable: there is no field on A for a correction to write.
      expect(model).toContain('supersedesBasicPriceId');
      expect(model).not.toMatch(/^\s*supersededAt\s/m);
      expect(model).not.toMatch(/^\s*isCurrent\s/m);
      expect(model).not.toMatch(/^\s*isSuperseded\s/m);

      // ONE successor per predecessor — a chain, never a fork, so "which row
      // replaced A" always has exactly one answer.
      expect(model).toMatch(/supersedesBasicPriceId\s+String\?\s+@unique/);

      // The successor must be in the SAME context it replaces. These are the
      // checks that make claim (1) above true rather than merely hoped for.
      const publication = code(
        read('basic-price/basic-price-publication.service.ts'),
      );
      expect(publication).toContain('SUPERSESSION_RESOURCE_MISMATCH');
      expect(publication).toContain('SUPERSESSION_REGION_MISMATCH');
      expect(publication).toContain('SUPERSEDED_BASIC_PRICE_NOT_PUBLISHED');

      // Claim (2), as a database fact rather than an application convention.
      const sql = readFileSync(
        join(
          __dirname,
          '..',
          '..',
          'prisma',
          'migrations',
          '20260826120000_bpcorr01_published_price_supersession',
          'migration.sql',
        ),
        'utf8',
      );
      expect(sql).toContain(
        'basic_prices_supersession_successor_is_published_check',
      );
    });

    /**
     * BP-CORR-01 — AND THE TWO LINEAGES NEVER TOUCH.
     *
     * The cleanest guarantee that correction cannot rewrite promotion history
     * is that a shared row can be neither end of a correction. It cannot be a
     * successor (database CHECK), and it cannot be a predecessor (the
     * publication path refuses it, and a shared row's NULL workspaceId already
     * puts it outside the workspace-scoped lookup). Promotion lineage is
     * therefore untouchable by this feature by construction, not by care.
     */
    /**
     * BP-CORR-01B — REASON 3 RE-ADJUDICATED A SECOND TIME, AND THIS TIME THE
     * CLAUSE ITSELF IS STRENGTHENED RATHER THAN ONLY RE-EXPLAINED.
     *
     * BP-CORR-01 established that an origin can leave candidacy via a published
     * successor. BP-CORR-01B proves TWO further things:
     *
     *   1. an origin can also leave candidacy by being WITHDRAWN, with no
     *      successor at all; and
     *   2. — the real defect — a promoted shared descendant did NOT follow its
     *      origin out of candidacy in either case, because it is never itself
     *      superseded or withdrawn. It simply stood there, still offering the
     *      corrected-away money to every other tenant. That was proved by an
     *      executable acceptance test before it was fixed.
     *
     * The fix is not a new engine and not a flag: currentness now asks the
     * question the lineage column already made answerable — "is the thing I am
     * a copy of still current?" — in the same single composed fragment.
     *
     * WHAT REMAINS EXACTLY AS LOCKED: the predecessor is still never written to,
     * the descendant is still never written to, the lineage is still never
     * retargeted, and suppression is still exact-id only.
     */
    it('REASON 3 (BP-CORR-01B) — a restatement follows its origin out of candidacy, and it does so by asking, never by being flagged', () => {
      const model =
        readFileSync(
          join(__dirname, '..', '..', 'prisma', 'schema.prisma'),
          'utf8',
        )
          .split('model BasicPrice {')[1]
          ?.split('\n}')[0] ?? '';

      // STILL NO FLAG ANYWHERE. Neither of the two new ways to leave candidacy
      // added a mutable column to the row that leaves it — which is the whole
      // reason published history stays byte-identical through both.
      for (const flag of [
        'deletedAt',
        'archivedAt',
        'retiredAt',
        'isActive',
        'supersededAt',
        'withdrawnAt',
        'isCurrent',
        'isWithdrawn',
      ]) {
        expect(model).not.toMatch(new RegExp(`^\\s*${flag}\\s`, 'm'));
      }

      const currentness = code(read('basic-price/basic-price-currentness.ts'));

      // The lineage clause exists and is keyed on the ORIGIN, not on the copy.
      expect(currentness).toContain('promotedFrom');
      expect(currentness).toContain('isNot');

      // Withdrawal is expressed as an append-only audit fact, never as a
      // column on the price. No new schema was added for it at all.
      expect(currentness).toContain('WITHDRAWN');
      expect(currentness).toContain('publicationAudits');

      // ONE composition. If a second currentness helper ever appears, a
      // consumer can compose one and forget the other — which is exactly the
      // defect BP-CORR-01B found.
      const exportedWheres =
        currentness.match(/export const \w*[Ww]here\w* =/g) ?? [];
      expect(exportedWheres).toHaveLength(1);
    });

    it('REASON 4 (BP-CORR-01) — a shared descendant can be neither successor nor predecessor of a correction', () => {
      const sql = readFileSync(
        join(
          __dirname,
          '..',
          '..',
          'prisma',
          'migrations',
          '20260826120000_bpcorr01_published_price_supersession',
          'migration.sql',
        ),
        'utf8',
      );
      // Cannot be a SUCCESSOR: one row may not carry both pointers.
      expect(sql).toContain('basic_prices_supersession_not_promoted_row_check');

      // Cannot be a PREDECESSOR.
      const publication = code(
        read('basic-price/basic-price-publication.service.ts'),
      );
      expect(publication).toContain('SUPERSEDED_BASIC_PRICE_IS_SHARED');

      // And promotion refuses to lift a corrected-away truth into the shared
      // catalog at all, so the old money cannot spread after its replacement.
      expect(
        code(read('basic-price/basic-price-promotion.service.ts')),
      ).toContain('BASIC_PRICE_SUPERSEDED');
    });

    it('the consumers that apply precedence filter ONLY on axes promotion copies', () => {
      // If a consumer ever filtered candidates on an axis the descendant does
      // NOT inherit, the two rows could diverge in that consumer's context and
      // the simple condition would stop being exact.
      const orchestrator = code(
        read('project-ahsp/ahsp-resource-resolution.orchestrator.ts'),
      );
      // The AHSP candidate offer filters on region, as-of date and validity —
      // all three inherited.
      expect(orchestrator).toContain('regionId: input.referenceRegionId');
      expect(orchestrator).toContain('effectiveDate: { lte: asOf }');
      expect(orchestrator).toContain('validUntil');
    });
  });

  /**
   * WHICH CONSUMERS GET IT, pinned deliberately. A candidate list must show one
   * logical truth; a by-id read and a re-read of an already-selected row must
   * answer lawfulness only, or a price legitimately selected by another tenant
   * would stop being spendable.
   */
  it('is composed by the candidate-producing consumers and by no one else', () => {
    const roots = join(__dirname, '..');
    const uses = (relative: string) =>
      readFileSync(join(roots, relative), 'utf8').match(
        /promotionLineagePrecedenceWhere\(/g,
      )?.length ?? 0;

    // Explorer list + by-resource list.
    expect(uses('basic-price/basic-price.service.ts')).toBe(2);
    // The AHSP candidate OFFER — exactly one site; the re-read beneath it is
    // deliberately raw-lawful.
    expect(uses('project-ahsp/ahsp-resource-resolution.orchestrator.ts')).toBe(
      1,
    );

    // Raw-lawful consumers: a per-id validation and the Cost Kernel re-read of
    // a row that was already lawfully selected.
    expect(uses('intelligence/constitutional-ai-boundary.service.ts')).toBe(0);
    expect(uses('project/rab-kernel-persistence.service.ts')).toBe(0);
  });
});
