import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

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
 * RM-03C: the inventory grew from two writers to three, and the third is the
 * only one that may ever produce a WORKSPACE_PRIVATE row. The array stays
 * order-dependent and exact by design — a new writer appearing anywhere in
 * src/ fails this test rather than quietly joining the set.
 *
 * RM-03D1: it now stands at four. The fourth is an UPDATE inside the same
 * private-asset service, and it exists because a private price could otherwise
 * never be corrected: `keepBatchPrivate` copies the batch's metadata at write
 * time and is idempotent, so a later batch correction reached the batch and
 * nothing else, while the only other update in this inventory is the
 * publication ladder — which would stamp a private asset PUBLISHED. The choice
 * was a permanently mis-described price or an unlawful write.
 *
 * It is registered here rather than exempted, and the test below pins exactly
 * what it may touch: description, never money, never publication.
 *
 * BP-CAT-01B: it now stands at five. The fifth is the shared-catalog promotion
 * CREATE, and it is the only writer in SIMPROK that may produce a BasicPrice
 * belonging to no workspace at all. It was added rather than reused because the
 * alternative — letting publication set `workspaceId` to NULL — would turn a
 * workspace's row into a national one by erasing the tenant that made it.
 *
 * It is registered here rather than exempted, and the test below pins exactly
 * what it may do: copy an already-published origin, clear both ownership
 * columns, and never update the origin it came from.
 *
 * BP-KDN-01: it now stands at six. The sixth is a second UPDATE inside the
 * private-asset service, and it exists so a previously unknown %KDN can be
 * filled later without minting a fake Basic Price. It is forbidden money and
 * both publication axes; see the dedicated assertion below.
 *
 * BP-DETAIL-MAINT-02: it now stands at eight. The seventh is a second
 * updateMany in the same private-asset service, filling missing %KDN on a
 * catalog observation under VERIFY / PROMOTE_SHARED. The eighth is a second
 * CREATE in that service: a private money successor. It writes `value` and
 * `supersedesBasicPriceId` on the NEW row and never updates the predecessor's
 * `value`.
 *
 * BP-CHANGE-SEM-03: it now stands at ten. The ninth is a third CREATE in the
 * private-asset service: a Detail-born NEW observation (`recordsNewObservation`,
 * no supersession, no borrowed import-row evidence). The tenth is a fourth
 * CREATE: a private KDN correction successor (money copied, KDN restated,
 * supersession pointer). Neither PATCHes the predecessor.
 *
 * OWNER LAW D: it now stands at eleven. The eleventh is a third updateMany in
 * the private-asset service, and it is the ONLY writer that reaches a row the
 * caller did not name. It exists because `promotedFromBasicPriceId` makes a
 * shared row a COPY of an origin, and a copy holding a different %KDN from its
 * origin is a second source of truth — the one thing catalog enrichment was
 * forbidden to create.
 *
 * It writes the SAME two KDN columns as the writer above it, under the same
 * `kdnPercent: null` fill-missing guard, in the SAME transaction, and only
 * after that writer has already succeeded on the origin. It cannot originate a
 * value: the number it writes is the one the origin just accepted. A short
 * count throws, so the origin's own update is rolled back with it.
 *
 * It is registered here rather than exempted, and the test below pins exactly
 * what it may touch: the two KDN columns, never money, never publication.
 *
 * Migration SQL is NOT a runtime writer and is deliberately out of scope here:
 * this test scans src/ only.
 */
describe('W-01 permanent BasicPrice writer inventory', () => {
  it('keeps exactly the eleven approved writers and no other Prisma writer method', () => {
    const matches = collectTs(sourceRoot).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return [
        ...source.matchAll(
          /(?:tx|prisma)\.basicPrice\.(create|update|updateMany|delete|deleteMany|upsert)\s*\(/g,
        ),
      ].map((match) => ({ file, method: match[1] }));
    });

    expect(
      matches.map(({ file, method }) => ({
        file: file.replace(/\\/g, '/').split('/src/')[1],
        method,
      })),
    ).toEqual([
      // RM-03C — the ONE workspace-private writer. Creates only; it never
      // updates, and it never touches a row it did not create.
      {
        file: 'basic-price/basic-price-private-asset.service.ts',
        method: 'create',
      },
      // RM-03D1 — the ONE provenance-correction writer. Restates how a private
      // price is DESCRIBED (source classification and temporal provenance) and
      // is forbidden the value and both publication axes; see the dedicated
      // assertion below.
      {
        file: 'basic-price/basic-price-private-asset.service.ts',
        method: 'update',
      },
      // BP-KDN-01 — the ONE %KDN enrichment writer. Fills a previously unknown
      // observation fact on an existing private price. updateMany keeps the
      // fill atomic against a concurrent identical retry. Forbidden money and
      // both publication axes; see the dedicated assertion below.
      {
        file: 'basic-price/basic-price-private-asset.service.ts',
        method: 'updateMany',
      },
      // BP-DETAIL-MAINT-02 — catalog missing-%KDN fill. Same two KDN columns,
      // different ownership WHERE. Forbidden money.
      {
        file: 'basic-price/basic-price-private-asset.service.ts',
        method: 'updateMany',
      },
      // OWNER LAW D — the ONE lineage-propagation writer, and the only writer
      // in SIMPROK that touches a row the caller did not name. It carries the
      // origin's just-accepted %KDN onto that origin's promoted descendants,
      // in the same transaction and under the same fill-missing guard, so
      // ORIGIN KDN = SHARED KDN can never be false after a successful write.
      // It originates nothing: remove the writer above it and this one has no
      // value to carry.
      {
        file: 'basic-price/basic-price-private-asset.service.ts',
        method: 'updateMany',
      },
      // BP-DETAIL-MAINT-02 — the ONE private money-correction writer. Creates
      // a successor; it never updates the predecessor's `value`.
      {
        file: 'basic-price/basic-price-private-asset.service.ts',
        method: 'create',
      },
      // BP-CHANGE-SEM-03 — private KDN correction successor. Copies money,
      // restates KDN, names the predecessor. Never PATCHes.
      {
        file: 'basic-price/basic-price-private-asset.service.ts',
        method: 'create',
      },
      // BP-CHANGE-SEM-03 — the ONE private new-observation writer. Creates a
      // later lawful fact without supersession and without borrowed import-row
      // evidence.
      {
        file: 'basic-price/basic-price-private-asset.service.ts',
        method: 'create',
      },
      // BP-CAT-01B — the ONE shared-catalog writer. Creates only. It is the
      // only writer that may produce a row belonging to NO workspace, and it
      // reaches that row by copying an already-published origin rather than by
      // moving one; see the dedicated assertion below.
      {
        file: 'basic-price/basic-price-promotion.service.ts',
        method: 'create',
      },
      {
        file: 'basic-price/basic-price-publication.service.ts',
        method: 'update',
      },
      {
        file: 'reality-intake/price-submission-review.service.ts',
        method: 'create',
      },
    ]);
  });

  it('BP-CAT-01B: the shared-catalog writer copies money rather than restating it, clears both ownership columns, and never moves the origin', () => {
    const source = readFileSync(
      join(sourceRoot, 'basic-price', 'basic-price-promotion.service.ts'),
      'utf8',
    );
    const start = source.indexOf('await tx.basicPrice.create({');
    const end = source.indexOf(
      'await tx.basicPricePublicationAudit.create({',
      start,
    );
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const data = source.slice(start, end);

    // MONEY IS COPIED, NEVER RESTATED. The origin's facts arrive by spread, so
    // there is no literal `value:` anywhere in this writer's data — a repricing
    // would have to be written in, and writing it in fails here.
    expect(data).toContain('...source');
    expect(/^\s*value\s*:/m.test(data)).toBe(false);

    // SHARED SCOPE, stated explicitly rather than left to a default.
    expect(data).toContain('workspaceId: null');
    expect(data).toContain('organizationId: null');
    expect(data).toContain("assetScope: 'SIMPROK_CATALOG'");
    // The lineage is what makes the row traceable and what makes a second
    // promotion of the same origin impossible.
    expect(data).toContain('promotedFromBasicPriceId: basicPriceId');
    // The origin's own provenance channels are never borrowed: both are UNIQUE
    // or catalog-forbidden and still belong to the row this one came from.
    expect(/^\s*sourceSubmissionId\s*:/m.test(data)).toBe(false);
    expect(/^\s*sourceImportRowId\s*:/m.test(data)).toBe(false);

    // THE ORIGIN IS NEVER MOVED. Not an assertion about intent — there is no
    // BasicPrice update anywhere in this file, so promotion cannot rewrite the
    // workspace row it came from even by accident.
    expect(source).not.toMatch(/\.basicPrice\.update\s*\(/);
    expect(source).not.toMatch(/\.basicPrice\.updateMany\s*\(/);
  });

  /**
   * BP-CAT-01D §18 — THE PUBLISHED-TRUTH CENSUS, as ratified by the Owner.
   *
   * The old law said one code path may WRITE PUBLISHED+PUBLISHED. That absolute
   * stopped being literally true when shared promotion landed, so the Owner
   * refined it into two named roles rather than letting the wording rot:
   *
   *   PUBLICATION_TRANSITION — moves an unpublished workspace row into
   *     published state. The decision. Exactly one.
   *   SHARED_RESTATEMENT — copies an already-published truth onto one shared
   *     descendant. Decides nothing. Exactly one.
   *
   * This test classifies by WHAT EACH WRITER ACTUALLY WRITES rather than by
   * filename, so a third writer of these two values cannot pass by being called
   * something innocent. `update` is the transition shape (it moves an existing
   * row); `create` is the restatement shape (it mints a new one).
   */
  it('BP-CAT-01D: exactly ONE publication-transition writer and ONE shared-restatement writer of PUBLISHED+PUBLISHED', () => {
    const transition: string[] = [];
    const restatement: string[] = [];

    // COMMENTS ARE STRIPPED FIRST. Several files discuss publication in prose —
    // price-submission-review.service.ts explains at length that it must NOT
    // advance status to PUBLISHED — and a census that counted an explanation as
    // a write would be worse than no census. Only real code is classified.
    //
    // Classified per FILE rather than by carving the `data` literal out with a
    // bounded regex: the first version of this test did the latter and silently
    // missed the promotion writer, whose data block is longer than the window
    // the pattern allowed. A census that fails OPEN is not a lock. The exact
    // per-writer file/method list is already pinned by the test above, so
    // file-level classification here is precise without being brittle.
    const stripComments = (source: string) =>
      source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

    for (const file of collectTs(sourceRoot)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      const relative = file.replace(/\\/g, '/').split('/src/')[1];

      // BOTH axes. A single-axis write is not published truth, and the
      // two-column redundancy is deliberate.
      const writesPublished =
        /status:\s*'PUBLISHED'/.test(code) &&
        /verificationStatus:\s*'PUBLISHED'/.test(code);
      if (!writesPublished) continue;

      // `update` moves an existing row — that is the transition, the decision.
      // `create` mints a new one — that is the restatement, and it decides
      // nothing.
      if (/(?:tx|prisma)\.basicPrice\.update\s*\(/.test(code)) {
        transition.push(relative);
      }
      if (/(?:tx|prisma)\.basicPrice\.create\s*\(/.test(code)) {
        restatement.push(relative);
      }
    }

    expect(transition).toEqual([
      'basic-price/basic-price-publication.service.ts',
    ]);
    expect(restatement).toEqual([
      'basic-price/basic-price-promotion.service.ts',
    ]);
    // PUBLICATION_TRANSITION_WRITER_COUNT = 1
    // SHARED_RESTATEMENT_WRITER_COUNT   = 1
    // ILLEGAL_PUBLISHED_WRITER_COUNT    = 0
    expect(transition).toHaveLength(1);
    expect(restatement).toHaveLength(1);
  });

  /**
   * BP-CAT-01D — the restatement writer must never forge publication evidence.
   *
   * The Cost Kernel proves a publisher by looking for an audit row with
   * action = 'PUBLISH' on that exact BasicPrice. If promotion wrote one on the
   * shared descendant, a row that was never published would answer that lookup
   * and the two-human ladder would be satisfied by a copy of itself.
   */
  it('BP-CAT-01D: promotion writes PROMOTE_SHARED and never fabricates a PUBLISH audit', () => {
    const source = readFileSync(
      join(sourceRoot, 'basic-price', 'basic-price-promotion.service.ts'),
      'utf8',
    );
    expect(source).toContain("action: 'PROMOTE_SHARED'");
    expect(source).not.toContain("action: 'PUBLISH'");
  });

  it('the private writer never sets a publication axis, and never fakes an asset scope', () => {
    const source = readFileSync(
      join(sourceRoot, 'basic-price', 'basic-price-private-asset.service.ts'),
      'utf8',
    );
    // Sliced by markers rather than by a nested-brace regex: the assertion is
    // about what the create's `data` literal contains, and a brittle regex
    // would fail for reasons unrelated to that.
    const start = source.indexOf('await tx.basicPrice.create({');
    const end = source.indexOf('select: PRIVATE_PRICE_SELECT,', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const data = source.slice(start, end);

    // The two publication axes are OMITTED so the row takes the schema's
    // honest defaults (UNPUBLISHED / UNVERIFIED). A private price never claims
    // publication in order to become usable.
    expect(/^\s*status\s*:/m.test(data)).toBe(false);
    expect(/^\s*verificationStatus\s*:/m.test(data)).toBe(false);

    // Ownership is stated explicitly, never left to a default.
    expect(data).toContain(
      'assetScope: BasicPriceAssetScope.WORKSPACE_PRIVATE',
    );
    // Provenance is mandatory and comes from the import row, not from thin air.
    expect(data).toContain('sourceImportRowId: row.id');
    // Source stays orthogonal to ownership — copied from the batch verbatim.
    expect(data).toContain('sourceOrigin: batch.sourceOrigin');
  });

  it('RM-03D1: the provenance-correction update may restate description, never money and never publication', () => {
    const source = readFileSync(
      join(sourceRoot, 'basic-price', 'basic-price-private-asset.service.ts'),
      'utf8',
    );
    const start = source.indexOf('await tx.basicPrice.update({');
    const end = source.indexOf('select: PRIVATE_PRICE_SELECT,', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const data = source.slice(start, end);

    // Correctable: what the price CLAIMS about its source and its date.
    for (const field of [
      'sourceType',
      'sourceOrigin',
      'effectiveDate',
      'sourcePeriodLabel',
      'sourcePeriodGranularity',
      'effectiveDateProvenance',
      'effectiveDateDerivationRule',
    ]) {
      expect(new RegExp(`^\\s*${field}\\s*:`, 'm').test(data)).toBe(true);
    }

    // Never correctable. `value` is the load-bearing one: a correction that
    // could move money would be a repricing wearing a provenance costume.
    for (const forbidden of [
      'value',
      'status',
      'verificationStatus',
      'assetScope',
      'regionId',
      'resourceId',
      'sourceImportRowId',
    ]) {
      expect(new RegExp(`^\\s*${forbidden}\\s*:`, 'm').test(data)).toBe(false);
    }
  });

  it('BP-KDN-01: the KDN enrichment update may write only kdnPercent and kdnEstablishment', () => {
    const source = readFileSync(
      join(sourceRoot, 'basic-price', 'basic-price-private-asset.service.ts'),
      'utf8',
    );
    const enrichStart = source.indexOf('async enrichKdn(');
    expect(enrichStart).toBeGreaterThan(-1);
    const start = source.indexOf(
      'await tx.basicPrice.updateMany({',
      enrichStart,
    );
    const end = source.indexOf(
      'await tx.basicPriceProvenanceCorrection.create({',
      start,
    );
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const slice = source.slice(start, end);
    const dataStart = slice.indexOf('data: {');
    const dataEnd = slice.indexOf('});', dataStart);
    expect(dataStart).toBeGreaterThan(-1);
    expect(dataEnd).toBeGreaterThan(dataStart);
    const data = slice.slice(dataStart, dataEnd);
    const where = slice.slice(0, dataStart);

    // Tenant lock stays in WHERE so a concurrent catalog/foreign row cannot
    // be filled. DATA itself must never restated ownership or money.
    expect(where).toContain(
      'assetScope: BasicPriceAssetScope.WORKSPACE_PRIVATE',
    );
    expect(where).toContain('kdnPercent: null');

    expect(/^\s*kdnPercent\s*:/m.test(data)).toBe(true);
    expect(/^\s*kdnEstablishment\s*:/m.test(data)).toBe(true);

    for (const forbidden of [
      'value',
      'status',
      'verificationStatus',
      'assetScope',
      'regionId',
      'resourceId',
      'sourceImportRowId',
      'tkdnValue',
    ]) {
      expect(new RegExp(`^\\s*${forbidden}\\s*:`, 'm').test(data)).toBe(false);
    }
  });

  it('BP-DETAIL-MAINT-02: catalog KDN enrichment writes only kdnPercent and kdnEstablishment', () => {
    const source = readFileSync(
      join(sourceRoot, 'basic-price', 'basic-price-private-asset.service.ts'),
      'utf8',
    );
    const enrichStart = source.indexOf('async enrichCatalogKdn(');
    expect(enrichStart).toBeGreaterThan(-1);
    const start = source.indexOf(
      'await tx.basicPrice.updateMany({',
      enrichStart,
    );
    const end = source.indexOf(
      'await tx.basicPriceProvenanceCorrection.create({',
      start,
    );
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const slice = source.slice(start, end);
    const dataStart = slice.indexOf('data: {');
    const dataEnd = slice.indexOf('});', dataStart);
    expect(dataStart).toBeGreaterThan(-1);
    expect(dataEnd).toBeGreaterThan(dataStart);
    const data = slice.slice(dataStart, dataEnd);
    const where = slice.slice(0, dataStart);

    expect(where).toContain('assetScope: BasicPriceAssetScope.SIMPROK_CATALOG');
    expect(where).toContain('kdnPercent: null');
    expect(/^\s*kdnPercent\s*:/m.test(data)).toBe(true);
    expect(/^\s*kdnEstablishment\s*:/m.test(data)).toBe(true);
    for (const forbidden of [
      'value',
      'status',
      'verificationStatus',
      'assetScope',
      'regionId',
      'resourceId',
      'sourceImportRowId',
      'tkdnValue',
    ]) {
      expect(new RegExp(`^\\s*${forbidden}\\s*:`, 'm').test(data)).toBe(false);
    }
  });

  it('OWNER LAW D: lineage propagation writes the same two KDN columns and nothing else', () => {
    const source = readFileSync(
      join(sourceRoot, 'basic-price', 'basic-price-private-asset.service.ts'),
      'utf8',
    );
    const enrichStart = source.indexOf('async enrichCatalogKdn(');
    expect(enrichStart).toBeGreaterThan(-1);
    // The SECOND updateMany inside this method: the origin's own fill is
    // pinned by the test above, this one carries it onto the descendants.
    const originUpdate = source.indexOf(
      'await tx.basicPrice.updateMany({',
      enrichStart,
    );
    const start = source.indexOf(
      'await tx.basicPrice.updateMany({',
      originUpdate + 1,
    );
    const end = source.indexOf('KDN_LINEAGE_PROPAGATION_INCOMPLETE', start);
    expect(start).toBeGreaterThan(originUpdate);
    expect(end).toBeGreaterThan(start);
    const slice = source.slice(start, end);
    const dataStart = slice.indexOf('data: {');
    const dataEnd = slice.indexOf('});', dataStart);
    expect(dataStart).toBeGreaterThan(-1);
    const data = slice.slice(dataStart, dataEnd);
    const where = slice.slice(0, dataStart);

    // REACHES DESCENDANTS BY LINEAGE ID ONLY — never by resource, region,
    // value or name. A fuzzy match here would be an invented lineage.
    expect(where).toContain('promotedFromBasicPriceId: price.id');
    expect(where).toContain('assetScope: BasicPriceAssetScope.SIMPROK_CATALOG');
    // The same fill-missing guard, so it can never overwrite a stated value.
    expect(where).toContain('kdnPercent: null');
    expect(/^\s*kdnPercent\s*:/m.test(data)).toBe(true);
    expect(/^\s*kdnEstablishment\s*:/m.test(data)).toBe(true);
    for (const forbidden of [
      'value',
      'status',
      'verificationStatus',
      'assetScope',
      'regionId',
      'resourceId',
      'sourceImportRowId',
      'promotedFromBasicPriceId',
      'tkdnValue',
    ]) {
      expect(new RegExp(`^\\s*${forbidden}\\s*:`, 'm').test(data)).toBe(false);
    }
  });

  it('BP-DETAIL-MAINT-02: private money correction creates a successor and never patches predecessor value', () => {
    const source = readFileSync(
      join(sourceRoot, 'basic-price', 'basic-price-private-asset.service.ts'),
      'utf8',
    );
    const methodStart = source.indexOf('async correctPrivatePrice(');
    expect(methodStart).toBeGreaterThan(-1);
    const method = source.slice(methodStart);
    const start = method.indexOf('await tx.basicPrice.create({');
    const end = method.indexOf(
      'await tx.basicPriceProvenanceCorrection.create({',
      start,
    );
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const data = method.slice(start, end);

    expect(/^\s*value\s*:/m.test(data)).toBe(true);
    expect(data).toContain('supersedesBasicPriceId: predecessor.id');
    expect(/^\s*sourceImportRowId\s*:/m.test(data)).toBe(false);
    expect(/^\s*status\s*:/m.test(data)).toBe(false);
    expect(/^\s*verificationStatus\s*:/m.test(data)).toBe(false);
    expect(method).not.toMatch(/\.basicPrice\.update(Many)?\s*\(/);
    expect(method).not.toMatch(/predecessor\.value\s*=/);
  });

  it('BP-CHANGE-SEM-03: new observation creates without supersession or borrowed import evidence', () => {
    const source = readFileSync(
      join(sourceRoot, 'basic-price', 'basic-price-private-asset.service.ts'),
      'utf8',
    );
    const methodStart = source.indexOf(
      'private async insertPrivateNewObservation(',
    );
    expect(methodStart).toBeGreaterThan(-1);
    const method = source.slice(methodStart);
    const start = method.indexOf('await tx.basicPrice.create({');
    const end = method.indexOf(
      'await tx.basicPriceProvenanceCorrection.create({',
      start,
    );
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const data = method.slice(start, end);

    expect(data).toContain('recordsNewObservation: true');
    expect(data).toContain("effectiveDateProvenance: 'SOURCE_STATED'");
    expect(/^\s*supersedesBasicPriceId\s*:/m.test(data)).toBe(false);
    expect(/^\s*sourceImportRowId\s*:/m.test(data)).toBe(false);
    expect(/^\s*sourcePeriodLabel\s*:/m.test(data)).toBe(false);
    expect(data).toContain('effectiveDate: observationDate');
    expect(/^\s*value\s*:/m.test(data)).toBe(true);
    expect(data).toContain('params.kdnEstablishment');
    expect(method).not.toMatch(/\.basicPrice\.update(Many)?\s*\(/);
  });

  it('BP-CHANGE-SEM-03: private KDN correction copies money and never uses enrich', () => {
    const source = readFileSync(
      join(sourceRoot, 'basic-price', 'basic-price-private-asset.service.ts'),
      'utf8',
    );
    const methodStart = source.indexOf('async correctPrivateKdn(');
    expect(methodStart).toBeGreaterThan(-1);
    const method = source.slice(
      methodStart,
      source.indexOf('private async lockPrivatePredecessor(', methodStart),
    );
    const start = method.indexOf('await tx.basicPrice.create({');
    const end = method.indexOf(
      'await tx.basicPriceProvenanceCorrection.create({',
      start,
    );
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const data = method.slice(start, end);

    expect(data).toContain('supersedesBasicPriceId: predecessor.id');
    expect(data).toContain('value: predecessor.value');
    expect(data).toContain('effectiveDate: predecessor.effectiveDate');
    expect(/^\s*sourceImportRowId\s*:/m.test(data)).toBe(false);
    expect(method).toContain("semantic: 'CORRECTION'");
    expect(method).not.toMatch(/kdnPercent: null/);
    expect(method).not.toMatch(/\.basicPrice\.update(Many)?\s*\(/);
    expect(method).not.toContain('MANUAL_ENRICHMENT');
    expect(data).toContain('MANUAL_CORRECTION');
  });

  it('BP-CHANGE-SEM-03: private KDN new observation uses MANUAL_NEW_OBSERVATION not enrich', () => {
    const source = readFileSync(
      join(sourceRoot, 'basic-price', 'basic-price-private-asset.service.ts'),
      'utf8',
    );
    const methodStart = source.indexOf('async observePrivateKdn(');
    expect(methodStart).toBeGreaterThan(-1);
    const method = source.slice(
      methodStart,
      source.indexOf('async correctPrivateKdn(', methodStart),
    );
    expect(method).toContain('MANUAL_NEW_OBSERVATION');
    expect(method).not.toContain('MANUAL_ENRICHMENT');
    expect(method).not.toContain('kdnEstablishment: null');
    expect(method).not.toMatch(/\.basicPrice\.update(Many)?\s*\(/);
  });

  it('no writer anywhere creates a publication audit for a private price', () => {
    const source = readFileSync(
      join(sourceRoot, 'basic-price', 'basic-price-private-asset.service.ts'),
      'utf8',
    );
    expect(source).not.toContain('basicPricePublicationAudit');
    expect(source).not.toContain('priceSubmission');
    expect(source).not.toContain('priceSubmissionReview');
  });

  /**
   * BP-CORR-01 — NARROWED, NOT LOOSENED.
   *
   * This assertion previously read "exactly status and verificationStatus". It
   * now reads "exactly those two, plus the supersession pointer", and the list
   * is still EXACT and still order-dependent — a fourth field appearing here
   * fails just as the third would have.
   *
   * WHY THE THIRD FIELD BELONGS TO THIS WRITER AND NOT A NEW ONE. Publication
   * IS the moment currentness changes: before it, a corrected successor is a
   * proposal that must move nothing; after it, the successor is the answer.
   * Writing the pointer anywhere else would mean either a second writer of
   * published truth (which the census above forbids) or a window in which a
   * published successor exists whose correction has not landed — a moment with
   * two current truths. It joins the same atomic update so that window cannot
   * exist.
   *
   * WHAT IS STILL FORBIDDEN IS UNCHANGED AND IS ASSERTED BELOW: a correction
   * still cannot move money, identity, region, dates or scope. The one thing
   * this writer gained is the ability to say WHAT IT REPLACED — never the
   * ability to change what anything COSTS.
   */
  it('BP-CORR-01: publication update writes exactly status, verificationStatus and the supersession pointer', () => {
    const source = readFileSync(
      join(sourceRoot, 'basic-price', 'basic-price-publication.service.ts'),
      'utf8',
    );
    const start = source.indexOf('await tx.basicPrice.update({');
    const end = source.indexOf(
      'await tx.basicPricePublicationAudit.create({',
      start,
    );
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const data = source.slice(start, end);

    const fields = [
      ...data.matchAll(
        /^\s*(status|verificationStatus|supersedesBasicPriceId)\s*[:,]/gm,
      ),
    ].map((match) => match[1]);
    expect(fields).toEqual([
      'status',
      'verificationStatus',
      'supersedesBasicPriceId',
    ]);
    expect(data).toContain("status: 'PUBLISHED'");
    expect(data).toContain("verificationStatus: 'PUBLISHED'");

    // MONEY, IDENTITY, PLACE, TIME AND SCOPE REMAIN OUT OF REACH. A correction
    // that could move any of these would be a repricing wearing a correction
    // costume — the same law RM-03D1 pinned for provenance corrections.
    for (const forbidden of [
      'value',
      'resourceId',
      'regionId',
      'effectiveDate',
      'validUntil',
      'assetScope',
      'workspaceId',
      'organizationId',
      'sourceOrigin',
      'sourceType',
      'promotedFromBasicPriceId',
    ]) {
      expect(new RegExp(`^\\s*${forbidden}\\s*:`, 'm').test(data)).toBe(false);
    }
  });

  /**
   * BP-CORR-01 — THE PREDECESSOR IS NEVER WRITTEN TO.
   *
   * The whole gate rests on one sentence: correcting a published price does not
   * edit it. That is only true if the correction path has no way to write the
   * predecessor row, so this asserts the structural fact rather than the intent
   * — there is exactly ONE BasicPrice update in this service, and it is keyed
   * to the successor's own id.
   */
  it('BP-CORR-01: the correction path can only ever write the SUCCESSOR row', () => {
    const source = readFileSync(
      join(sourceRoot, 'basic-price', 'basic-price-publication.service.ts'),
      'utf8',
    );
    const updates = [
      ...source.matchAll(/(?:tx|prisma)\.basicPrice\.update\s*\(/g),
    ];
    expect(updates).toHaveLength(1);
    expect(source).toContain('where: { id: basicPriceId }');
    // No second write shape can reach the predecessor either.
    expect(source).not.toMatch(/\.basicPrice\.updateMany\s*\(/);
    expect(source).not.toMatch(/\.basicPrice\.delete(Many)?\s*\(/);
    expect(source).not.toMatch(/\.basicPrice\.upsert\s*\(/);
    // The predecessor is READ under lock and never written: its only trace is
    // an append to the append-only audit table.
    expect(source).toContain("action: 'SUPERSEDED'");
  });
});
