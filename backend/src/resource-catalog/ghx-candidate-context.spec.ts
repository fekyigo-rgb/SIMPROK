/**
 * GHX-01 — the candidate-context digest, attacked.
 *
 * Its whole job is to notice when the question a human answered is no longer the
 * question in front of us. A digest that collides across materially different
 * candidate sets would silently reuse a stale decision, so the cases below are
 * the collisions that matter.
 */
import {
  GhxCandidateContextEntry,
  canonicalSpecificationSnapshot,
  candidateContextDigest,
} from './ghx-candidate-context';

const candidate = (
  over: Partial<GhxCandidateContextEntry> & { resourceCatalogId: string },
): GhxCandidateContextEntry => ({
  name: 'Mortar',
  type: 'MATERIAL',
  baseUnit: 'm3',
  specifications: null,
  ...over,
});

const A = candidate({ resourceCatalogId: 'cat-a' });
const B = candidate({ resourceCatalogId: 'cat-b', baseUnit: 'kg' });
const C = candidate({ resourceCatalogId: 'cat-c', baseUnit: 'Doos' });

describe('candidateContextDigest', () => {
  it('is stable across candidate ordering — the same set is the same question', () => {
    expect(candidateContextDigest([A, B])).toBe(candidateContextDigest([B, A]));
  });

  it('changes when a candidate is ADDED — {A,B} is not {A,B,C}', () => {
    expect(candidateContextDigest([A, B, C])).not.toBe(candidateContextDigest([A, B]));
  });

  it('changes when a candidate is SWAPPED — {A,B} is not {A,C}', () => {
    // The case a mere candidate COUNT cannot catch: still two candidates, but one
    // of them is a rival the human never saw.
    expect(candidateContextDigest([A, C])).not.toBe(candidateContextDigest([A, B]));
    expect([A, C]).toHaveLength([A, B].length);
  });

  it('changes when a candidate is REMOVED', () => {
    expect(candidateContextDigest([A])).not.toBe(candidateContextDigest([A, B]));
  });

  it('changes when a candidate is renamed, re-united or re-typed', () => {
    const base = candidateContextDigest([A]);

    expect(candidateContextDigest([{ ...A, name: 'Mortar Instan' }])).not.toBe(base);
    expect(candidateContextDigest([{ ...A, baseUnit: 'kg' }])).not.toBe(base);
    expect(candidateContextDigest([{ ...A, type: 'LABOR' }])).not.toBe(base);
  });

  it('ignores harmless normalization — case and padding are not facts', () => {
    expect(candidateContextDigest([{ ...A, name: '  MORTAR  ' }])).toBe(
      candidateContextDigest([A]),
    );
  });
});

describe('canonicalSpecificationSnapshot — structure is preserved', () => {
  it('THE collision a values-only extractor cannot see', () => {
    // The kernel's own structuredSpecificationFacts() flattens both of these to
    // {"16","420"} — correct for its job, fatal for this one.
    const left = canonicalSpecificationSnapshot({ diameter: 16, grade: 420 });
    const right = canonicalSpecificationSnapshot({ diameter: 420, grade: 16 });

    expect(left).not.toBe(right);
    expect(
      candidateContextDigest([{ ...A, specifications: { diameter: 16, grade: 420 } }]),
    ).not.toBe(
      candidateContextDigest([{ ...A, specifications: { diameter: 420, grade: 16 } }]),
    );
  });

  it('structured ARRAY members keep their own key/value association', () => {
    // Flattening into a shared bag of leaves would make these identical.
    const paired = canonicalSpecificationSnapshot([
      { d: 16, g: 420 },
      { d: 420, g: 16 },
    ]);
    const crossed = canonicalSpecificationSnapshot([
      { d: 16, g: 16 },
      { d: 420, g: 420 },
    ]);

    expect(paired).not.toBe(crossed);
  });

  it('object key order is not a fact — the same object is the same snapshot', () => {
    expect(canonicalSpecificationSnapshot({ a: 1, b: 2 })).toBe(
      canonicalSpecificationSnapshot({ b: 2, a: 1 }),
    );
  });

  it('array order is deliberately not material; array COMPOSITION is', () => {
    expect(canonicalSpecificationSnapshot(['x', 'y'])).toBe(
      canonicalSpecificationSnapshot(['y', 'x']),
    );
    expect(canonicalSpecificationSnapshot(['x', 'z'])).not.toBe(
      canonicalSpecificationSnapshot(['x', 'y']),
    );
  });

  it('booleans state no value — the existing law is reused, not restated', () => {
    // Exactly why {rm02bTestOnly: true} needs no ignore-list to stay harmless.
    expect(canonicalSpecificationSnapshot({ rm02bTestOnly: true })).toBe('');
    expect(candidateContextDigest([{ ...A, specifications: { rm02bTestOnly: true } }])).toBe(
      candidateContextDigest([A]),
    );
  });

  it('null, undefined and empty strings state nothing', () => {
    expect(canonicalSpecificationSnapshot({ a: null, b: undefined, c: '  ' })).toBe('');
  });

  it('a genuine claim IS material', () => {
    expect(candidateContextDigest([{ ...A, specifications: { diameter: 16 } }])).not.toBe(
      candidateContextDigest([A]),
    );
  });

  it('is deterministic — the same evidence hashes the same way every time', () => {
    const spec = { nested: { deep: [{ k: 'v' }, { k: 'w' }] }, top: 'x' };

    expect(candidateContextDigest([{ ...A, specifications: spec }])).toBe(
      candidateContextDigest([{ ...A, specifications: spec }]),
    );
  });
// ---------- ENCODING COLLISION (PM delta correction) ----------
  it('a value containing the old delimiters cannot impersonate structure', () => {
    // THE defect the first implementation had: delimiter-joined encoding made
    // {a:"b,c:d"} and {a:"b",c:"d"} produce the byte-identical snapshot, so a
    // materially different candidate looked untouched.
    const smuggled = canonicalSpecificationSnapshot({ a: 'b,c:d' });
    const genuine = canonicalSpecificationSnapshot({ a: 'b', c: 'd' });

    expect(smuggled).not.toBe(genuine);
    expect(candidateContextDigest([{ ...A, specifications: { a: 'b,c:d' } }])).not.toBe(
      candidateContextDigest([{ ...A, specifications: { a: 'b', c: 'd' } }]),
    );
  });

  it.each([
    ['braces', { a: '{x:1}' }, { a: { x: 1 } }],
    ['brackets', { a: '[x]' }, { a: ['x'] }],
    ['nested delimiter', { 'a:b': 'c' }, { a: { b: 'c' } }],
  ])('a scalar shaped like %s does not equal the real structure', (_l, flat, structured) => {
    expect(canonicalSpecificationSnapshot(flat)).not.toBe(
      canonicalSpecificationSnapshot(structured),
    );
  });

  it('candidate FIELDS cannot bleed across the field boundary', () => {
    // A joined encoding let a name absorb the next field. Tuples cannot.
    expect(
      candidateContextDigest([{ ...A, name: 'Mortar MATERIAL', baseUnit: 'm3' }]),
    ).not.toBe(candidateContextDigest([{ ...A, name: 'Mortar', baseUnit: 'MATERIAL m3' }]));
  });

  it('candidate ENTRIES cannot merge across the candidate boundary', () => {
    // Joining candidates end-to-end let one candidate's tail merge into the
    // next one's head. Two candidates are never one.
    const merged = candidateContextDigest([
      candidate({ resourceCatalogId: 'cat-a', name: 'X' }),
      candidate({ resourceCatalogId: 'cat-b', name: 'Y' }),
    ]);
    const single = candidateContextDigest([
      candidate({ resourceCatalogId: 'cat-acat-b', name: 'XY' }),
    ]);

    expect(merged).not.toBe(single);
  });
// ---------- LOCALE INDEPENDENCE (PM delta correction) ----------
  it('ordering does not consult the runtime locale', () => {
    // localeCompare would let two machines order the same evidence differently,
    // and a digest that depends on the host's collation is not a digest of the
    // evidence. Proven by making localeCompare hostile: if any ordering still
    // called it, these digests would diverge.
    const original = String.prototype.localeCompare;
    // eslint-disable-next-line no-extend-native
    String.prototype.localeCompare = function reversed(this: string, other: string) {
      return other < this ? -1 : other > this ? 1 : 0;
    } as typeof original;
    let sabotaged: string;
    try {
      sabotaged = candidateContextDigest([A, B, C]);
    } finally {
      // eslint-disable-next-line no-extend-native
      String.prototype.localeCompare = original;
    }

    expect(sabotaged).toBe(candidateContextDigest([A, B, C]));
  });

  it('specification key and array ordering are locale-independent too', () => {
    const original = String.prototype.localeCompare;
    const spec = { b: 'z', a: ['y', 'x'], c: { n: 1 } };
    const truth = canonicalSpecificationSnapshot(spec);
    // eslint-disable-next-line no-extend-native
    String.prototype.localeCompare = function reversed(this: string, other: string) {
      return other < this ? -1 : other > this ? 1 : 0;
    } as typeof original;
    let sabotaged: string;
    try {
      sabotaged = canonicalSpecificationSnapshot(spec);
    } finally {
      // eslint-disable-next-line no-extend-native
      String.prototype.localeCompare = original;
    }

    expect(sabotaged).toBe(truth);
  });
});
