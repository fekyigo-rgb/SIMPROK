import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BASIC_PRICE_APPLICABILITY_VERSION,
  basicPriceApplicabilityAnd,
} from './basic-price-applicability';

/**
 * BP-UX-FINAL-01C GAP-B — TEMPORAL APPLICABILITY.
 *
 * The Explorer offers candidates to two engines that will later REFUSE a price
 * failing this predicate. These tests pin the predicate itself, and — more
 * importantly — pin that it still says the same thing as the two engines. A
 * silent divergence here is not a cosmetic bug: it is the room promising a
 * price the Cost Kernel will not spend.
 */
describe('basicPriceApplicabilityAnd', () => {
  const asOf = new Date('2026-08-26T00:00:00.000Z');

  it('is versioned, so a change to the temporal law is a visible change', () => {
    expect(BASIC_PRICE_APPLICABILITY_VERSION).toBe(
      'BPUXFINAL01C_BASIC_PRICE_TEMPORAL_APPLICABILITY_V1',
    );
  });

  it('B1/B2 — a price must have STARTED: effectiveDate <= asOf', () => {
    const [started] = basicPriceApplicabilityAnd({ asOf });
    expect(started).toEqual({ effectiveDate: { lte: asOf } });
  });

  it('B3/B4/B5 — a price must not have ENDED, and null is not an ending', () => {
    const [, notEnded] = basicPriceApplicabilityAnd({ asOf });
    expect(notEnded).toEqual({
      OR: [{ validUntil: null }, { validUntil: { gte: asOf } }],
    });
  });

  it('C6 — the validUntil boundary is INCLUSIVE (gte), never exclusive', () => {
    // A source that says "valid until 30 June" means the price is still good ON
    // 30 June. `gt` here would silently shorten every price in the catalog by a
    // day, and would disagree with both engines.
    const [, notEnded] = basicPriceApplicabilityAnd({ asOf }) as [
      unknown,
      { OR: Array<{ validUntil: unknown }> },
    ];
    expect(notEnded.OR[1].validUntil).toEqual({ gte: asOf });
    expect(notEnded.OR[1].validUntil).not.toEqual({ gt: asOf });
  });

  /* ── The composition-safety property, asserted structurally ────────────── */

  it('returns AND MEMBERS, never an object that could clobber eligibility', () => {
    // `buildUsableBasicPriceWhere` owns the top-level `OR` key — that key IS
    // tenant isolation. If this helper ever returned a spreadable object with
    // an `OR`, a caller spreading it would DELETE eligibility rather than
    // narrow it. An array destined for `AND` makes that unrepresentable.
    const fragments = basicPriceApplicabilityAnd({ asOf });
    expect(Array.isArray(fragments)).toBe(true);
    expect(fragments).toHaveLength(2);
  });

  it('never emits a key the Explorer assigns for its own range filters', () => {
    // `where.effectiveDate` is assigned by year/dateFrom/dateTo. As an `AND`
    // member the applicability clause composes with that filter instead of
    // racing it — but only because it is never spread at the top level.
    const fragments = basicPriceApplicabilityAnd({ asOf });
    // Exactly one key per fragment: each reads as the single fact it is.
    for (const fragment of fragments) {
      expect(Object.keys(fragment)).toHaveLength(1);
    }
  });

  it('only ever REMOVES rows — no NOT, no nested widening', () => {
    const serialised = JSON.stringify(basicPriceApplicabilityAnd({ asOf }));
    expect(serialised).not.toContain('"NOT"');
    expect(serialised).not.toContain('"none"');
  });

  /* ── Drift guard against the two engines that spend the money ──────────── */

  it('says exactly what the AHSP resolver already enforces', () => {
    // A COPY OF A PREDICATE IS ONLY SAFE WHILE IT STAYS A COPY. §6 of this
    // mission forbids "improving" the existing consumers, so the orchestrator
    // keeps its inline clause — and this guard turns a future divergence
    // between the two into a failing test rather than into a room that offers
    // prices the resolver will refuse.
    const orchestrator = readFileSync(
      join(
        __dirname,
        '..',
        'project-ahsp',
        'ahsp-resource-resolution.orchestrator.ts',
      ),
      'utf8',
    );
    const normalised = orchestrator.replace(/\s+/g, '');
    expect(normalised).toContain('effectiveDate:{lte:asOf}');
    expect(normalised).toContain(
      'OR:[{validUntil:null},{validUntil:{gte:asOf}}]',
    );
    expect(normalised).toContain('mergeCurrentnessAnd');
  });

  it('says exactly what the Cost Kernel already enforces', () => {
    const kernel = readFileSync(
      join(__dirname, '..', 'project', 'rab-kernel-persistence.service.ts'),
      'utf8',
    );
    const normalised = kernel.replace(/\s+/g, '');
    // effectiveDate > asOf  -> not yet effective
    expect(normalised).toContain(
      'basicPrice.effectiveDate.getTime()>calculationAsOfDate.getTime()',
    );
    // validUntil !== null && validUntil < asOf -> expired
    expect(normalised).toContain('basicPrice.validUntil!==null');
    expect(normalised).toContain(
      'basicPrice.validUntil.getTime()<calculationAsOfDate.getTime()',
    );
  });

  it('never reads reviewDate — soft advice is not a hard gate', () => {
    // `reviewDate` carries no eligibility meaning whatsoever. A price past it
    // stays fully usable and stays in every candidate set; only `validUntil` is
    // a claim the SOURCE made about its own price.
    const source = readFileSync(
      join(__dirname, 'basic-price-applicability.ts'),
      'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toContain('reviewDate');
    expect(code).not.toContain('freshnessStatus');
  });
});
