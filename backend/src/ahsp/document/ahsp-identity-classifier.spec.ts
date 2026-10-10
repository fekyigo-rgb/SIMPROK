import {
  classifyAhspIdentity,
  type AhspIdentityCandidate,
  type AhspIdentityContextFact,
  type AhspIdentityNormalizers,
  type AhspIdentityRow,
} from './ahsp-identity-classifier';

// The REAL normalization behaviour (mirrors RealityNormalizationEngine), passed
// in so the classifier stays a pure function under test.
const norm: AhspIdentityNormalizers = {
  name: (raw: string) => (raw ?? '').trim().replace(/\s+/g, ' ').toLowerCase(),
  code: (raw: string) => (raw ?? '').trim().toUpperCase(),
};

const row = (
  over: Partial<AhspIdentityRow> & {
    ahspId: string;
    workType: string;
    methodName: string;
  },
): AhspIdentityRow => ({
  workspaceId: 'ws-1',
  code: null,
  deletedAt: null,
  ...over,
});

const candidate = (
  over: Partial<AhspIdentityCandidate> & {
    workType: string;
    methodName: string;
  },
): AhspIdentityCandidate => ({
  workspaceId: 'ws-1',
  ...over,
});

const context = (
  over: Partial<AhspIdentityContextFact> = {},
): AhspIdentityContextFact => ({
  classificationLeafNodeIds: ['leaf-1'],
  outputUnitCode: 'M3',
  resources: [
    {
      resourceId: 'resource-a',
      resourceType: 'LABOR',
      baseUnit: 'PERSON_DAY',
      coefficient: '1.000000',
    },
    {
      resourceId: 'resource-b',
      resourceType: 'MATERIAL',
      baseUnit: 'KG',
      coefficient: 2,
    },
  ],
  versionId: 'version-1',
  ...over,
});

describe('classifyAhspIdentity — AHSP-whole identity, not resource identity', () => {
  it('A: a byte-exact same-workspace identity is IDENTICAL', () => {
    const existing = [
      row({
        ahspId: 'a1',
        workType: 'Galian Tanah',
        methodName: 'Galian biasa sedalam 1 m',
      }),
    ];
    const result = classifyAhspIdentity(
      candidate({
        workType: 'Galian Tanah',
        methodName: 'Galian biasa sedalam 1 m',
      }),
      existing,
      norm,
    );
    expect(result.verdict).toBe('IDENTICAL');
    expect(result.exactMatch?.ahspId).toBe('a1');
    expect(result.exactMatch?.deleted).toBe(false);
    expect(result.possibleMatches).toHaveLength(0);
  });

  it('B: same work, only spelling/case/whitespace differs -> POSSIBLY (normalized name)', () => {
    const existing = [
      row({
        ahspId: 'a1',
        workType: 'Galian Tanah',
        methodName: 'Galian Biasa sedalam 1 m',
      }),
    ];
    const result = classifyAhspIdentity(
      candidate({
        workType: '  galian   tanah ',
        methodName: 'galian biasa sedalam 1 m',
      }),
      existing,
      norm,
    );
    expect(result.verdict).toBe('POSSIBLY_IDENTICAL');
    expect(result.exactMatch).toBeNull();
    expect(result.possibleMatches[0]?.signal).toBe('NORMALIZED_NAME');
    expect(result.possibleMatches[0]?.ahspId).toBe('a1');
  });

  it('C: similar words but a different execution method stays out of IDENTICAL (manual vs mechanical)', () => {
    const existing = [
      row({
        ahspId: 'a1',
        workType: 'Galian Tanah',
        methodName: 'Galian tanah manual',
      }),
    ];
    const result = classifyAhspIdentity(
      candidate({
        workType: 'Galian Tanah',
        methodName: 'Galian tanah mekanis',
      }),
      existing,
      norm,
    );
    expect(result.verdict).toBe('DISTINCT');
  });

  it('C2: same base work but a different dimension stays distinct (10 cm vs 20 cm)', () => {
    const existing = [
      row({
        ahspId: 'a1',
        workType: 'Lapis Pondasi',
        methodName: 'Agregat kelas A tebal 10 cm',
      }),
    ];
    const result = classifyAhspIdentity(
      candidate({
        workType: 'Lapis Pondasi',
        methodName: 'Agregat kelas A tebal 20 cm',
      }),
      existing,
      norm,
    );
    expect(result.verdict).toBe('DISTINCT');
  });

  it('C3: a different material stays distinct (beton bertulang vs beton)', () => {
    const existing = [
      row({
        ahspId: 'a1',
        workType: 'Struktur',
        methodName: 'Beton bertulang',
      }),
    ];
    const result = classifyAhspIdentity(
      candidate({ workType: 'Struktur', methodName: 'Beton' }),
      existing,
      norm,
    );
    expect(result.verdict).toBe('DISTINCT');
  });

  it('D: a shared code with a different name is at most POSSIBLY (code) — never auto-IDENTICAL', () => {
    const existing = [
      row({
        ahspId: 'a1',
        workType: 'Beton',
        methodName: 'Beton mutu K-250',
        code: 'B.7.2',
      }),
    ];
    const result = classifyAhspIdentity(
      candidate({
        workType: 'Beton Struktur',
        methodName: 'Beton fc 20 MPa',
        code: 'b.7.2',
      }),
      existing,
      norm,
    );
    expect(result.verdict).toBe('POSSIBLY_IDENTICAL');
    expect(result.possibleMatches[0]?.signal).toBe('CODE');
  });

  it('E: no plausible candidate -> DISTINCT (absence of evidence, not proof of difference)', () => {
    const existing = [
      row({ ahspId: 'a1', workType: 'Beton', methodName: 'Beton K-250' }),
    ];
    const result = classifyAhspIdentity(
      candidate({ workType: 'Pengecatan', methodName: 'Cat tembok interior' }),
      existing,
      norm,
    );
    expect(result.verdict).toBe('DISTINCT');
    expect(result.possibleMatches).toHaveLength(0);
    expect(result.exactMatch).toBeNull();
  });

  it('F: a soft-deleted exact twin is still IDENTICAL, flagged deleted (no revive, no false DISTINCT)', () => {
    const existing = [
      row({
        ahspId: 'a1',
        workType: 'Galian',
        methodName: 'Galian biasa',
        deletedAt: new Date('2020-01-01T00:00:00.000Z'),
      }),
    ];
    const result = classifyAhspIdentity(
      candidate({ workType: 'Galian', methodName: 'Galian biasa' }),
      existing,
      norm,
    );
    expect(result.verdict).toBe('IDENTICAL');
    expect(result.exactMatch?.deleted).toBe(true);
  });

  it('F2: a soft-deleted NON-exact look-alike is never offered as a POSSIBLY candidate', () => {
    const existing = [
      row({
        ahspId: 'a1',
        workType: 'Galian',
        methodName: 'galian biasa',
        deletedAt: new Date('2020-01-01T00:00:00.000Z'),
      }),
    ];
    const result = classifyAhspIdentity(
      candidate({ workType: 'GALIAN', methodName: 'GALIAN BIASA' }),
      existing,
      norm,
    );
    expect(result.verdict).toBe('DISTINCT');
  });

  it('J: the same names in a DIFFERENT workspace are never IDENTICAL (workspace isolation)', () => {
    const existing = [
      row({
        ahspId: 'a1',
        workspaceId: 'ws-2',
        workType: 'Galian',
        methodName: 'Galian biasa',
      }),
    ];
    const result = classifyAhspIdentity(
      candidate({ workType: 'Galian', methodName: 'Galian biasa' }),
      existing,
      norm,
    );
    expect(result.verdict).not.toBe('IDENTICAL');
  });

  it('J2: an OFFICIAL (null-workspace) exact-name row is POSSIBLY for a workspace, never IDENTICAL', () => {
    const existing = [
      row({
        ahspId: 'off-1',
        workspaceId: null,
        workType: 'Galian',
        methodName: 'Galian biasa',
      }),
    ];
    const result = classifyAhspIdentity(
      candidate({
        workspaceId: 'ws-1',
        workType: 'Galian',
        methodName: 'Galian biasa',
      }),
      existing,
      norm,
    );
    expect(result.verdict).toBe('POSSIBLY_IDENTICAL');
    expect(result.possibleMatches[0]?.ahspId).toBe('off-1');
  });

  it('I: deterministic and order-independent — a repeated import is stable', () => {
    const rows = [
      row({ ahspId: 'a2', workType: 'Galian', methodName: 'galian biasa' }),
      row({ ahspId: 'a1', workType: 'GALIAN', methodName: 'GALIAN BIASA' }),
    ];
    const cand = candidate({ workType: 'Galian', methodName: 'Galian Biasa' });
    const first = classifyAhspIdentity(cand, rows, norm);
    const second = classifyAhspIdentity(cand, [...rows].reverse(), norm);
    expect(first).toEqual(second);
    expect(first.possibleMatches.map((match) => match.ahspId)).toEqual([
      'a1',
      'a2',
    ]);
  });

  it('a workType-only coincidence is NOT enough for POSSIBLY (avoids flooding same-workType items)', () => {
    const existing = [
      row({ ahspId: 'a1', workType: 'Beton', methodName: 'Beton K-250' }),
    ];
    const result = classifyAhspIdentity(
      candidate({ workType: 'Beton', methodName: 'Beton K-350 kedap air' }),
      existing,
      norm,
    );
    expect(result.verdict).toBe('DISTINCT');
  });

  it('B2: names are compared FIELD BY FIELD — a different (workType, methodName) split that space-joins to the same string is NOT POSSIBLY', () => {
    // "Pekerjaan Beton" + "Bertulang" vs "Pekerjaan" + "Beton Bertulang" join to
    // the same "pekerjaan beton bertulang" — a concatenated key would false-flag
    // them POSSIBLY. Field-by-field keeps them DISTINCT (they are distinct keys).
    const existing = [
      row({
        ahspId: 'a1',
        workType: 'Pekerjaan Beton',
        methodName: 'Bertulang',
      }),
    ];
    const result = classifyAhspIdentity(
      candidate({ workType: 'Pekerjaan', methodName: 'Beton Bertulang' }),
      existing,
      norm,
    );
    expect(result.verdict).toBe('DISTINCT');
    expect(result.possibleMatches).toHaveLength(0);
  });

  it('K: exact parent + same canonical classification and formula is IDENTICAL', () => {
    const existing = [
      row({
        ahspId: 'a1',
        workType: 'Galian Tanah',
        methodName: 'Galian Tanah',
        context: context({
          classificationLeafNodeIds: ['leaf-2', 'leaf-1'],
        }),
      }),
    ];
    const result = classifyAhspIdentity(
      candidate({
        workType: 'Galian Tanah',
        methodName: 'Galian Tanah',
        context: context({
          classificationLeafNodeIds: ['leaf-1', 'leaf-2'],
          resources: [...context().resources].reverse(),
        }),
      }),
      existing,
      norm,
    );
    expect(result.verdict).toBe('IDENTICAL');
    expect(result.exactMatch).toMatchObject({
      ahspId: 'a1',
      signal: 'EXACT',
      formulaSame: true,
      classificationSame: true,
      currentVersionId: 'version-1',
    });
  });

  it('K2: exact parent + same formula but different classification is POSSIBLY, never a second parent', () => {
    const existing = [
      row({
        ahspId: 'a1',
        workType: 'Galian Tanah',
        methodName: 'Galian Tanah',
        context: context({ classificationLeafNodeIds: ['leaf-1'] }),
      }),
    ];
    const result = classifyAhspIdentity(
      candidate({
        workType: 'Galian Tanah',
        methodName: 'Galian Tanah',
        context: context({ classificationLeafNodeIds: ['leaf-2'] }),
      }),
      existing,
      norm,
    );
    expect(result.verdict).toBe('POSSIBLY_IDENTICAL');
    expect(result.possibleMatches[0]).toMatchObject({
      ahspId: 'a1',
      signal: 'EXACT_PARENT',
      formulaSame: true,
      classificationSame: false,
    });
  });

  it('K3: exact parent + changed coefficient is POSSIBLY revision evidence', () => {
    const existing = [
      row({
        ahspId: 'a1',
        workType: 'Galian Tanah',
        methodName: 'Galian Tanah',
        context: context(),
      }),
    ];
    const result = classifyAhspIdentity(
      candidate({
        workType: 'Galian Tanah',
        methodName: 'Galian Tanah',
        context: context({
          resources: [
            {
              resourceId: 'resource-a',
              resourceType: 'LABOR',
              baseUnit: 'PERSON_DAY',
              coefficient: 1.1,
            },
            context().resources[1],
          ],
        }),
      }),
      existing,
      norm,
    );
    expect(result.verdict).toBe('POSSIBLY_IDENTICAL');
    expect(result.possibleMatches[0]).toMatchObject({
      signal: 'EXACT_PARENT',
      formulaSame: false,
      classificationSame: true,
    });
  });

  it('K4: coefficient formatting and row order do not create a false revision', () => {
    const existingContext = context({
      resources: [
        {
          resourceId: 'resource-a',
          resourceType: 'LABOR',
          baseUnit: 'PERSON_DAY',
          coefficient: '01.500000',
        },
        {
          resourceId: 'resource-b',
          resourceType: 'MATERIAL',
          baseUnit: 'kg',
          coefficient: '2.000',
        },
      ],
    });
    const candidateContext = context({
      resources: [
        {
          resourceId: 'resource-b',
          resourceType: 'material',
          baseUnit: 'KG',
          coefficient: 2,
        },
        {
          resourceId: 'resource-a',
          resourceType: 'labor',
          baseUnit: 'person_day',
          coefficient: '1.5',
        },
      ],
    });
    const result = classifyAhspIdentity(
      candidate({
        workType: 'Galian Tanah',
        methodName: 'Galian Tanah',
        context: candidateContext,
      }),
      [
        row({
          ahspId: 'a1',
          workType: 'Galian Tanah',
          methodName: 'Galian Tanah',
          context: existingContext,
        }),
      ],
      norm,
    );
    expect(result.verdict).toBe('IDENTICAL');
  });

  it('K5: multiplicity is formula truth — removing one repeated component is a revision', () => {
    const repeated = {
      resourceId: 'resource-a',
      resourceType: 'LABOR',
      baseUnit: 'PERSON_DAY',
      coefficient: 1,
    };
    const result = classifyAhspIdentity(
      candidate({
        workType: 'Galian Tanah',
        methodName: 'Galian Tanah',
        context: context({ resources: [repeated] }),
      }),
      [
        row({
          ahspId: 'a1',
          workType: 'Galian Tanah',
          methodName: 'Galian Tanah',
          context: context({ resources: [repeated, repeated] }),
        }),
      ],
      norm,
    );
    expect(result.verdict).toBe('POSSIBLY_IDENTICAL');
    expect(result.possibleMatches[0]?.formulaSame).toBe(false);
  });
});
