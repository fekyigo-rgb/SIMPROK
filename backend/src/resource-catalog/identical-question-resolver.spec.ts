/**
 * IQL-01 — the resolver hook. The EXISTING ResourceIdentityResolutionService,
 * run against a fake read-only client, proves:
 *   - zero-knowledge invariance: no opt-in → no query, no change; opt-in with an
 *     empty ledger → a byte-identical verdict;
 *   - only the LATEST event, and only an APPROVE, is ever reused;
 *   - every applicability guard refuses independently;
 *   - reading writes nothing.
 */
import { candidateContextDigest } from './ghx-candidate-context';
import {
  IQL01_IDENTICAL_QUESTION_POLICY_VERSION,
  identicalQuestionKey,
} from './identical-question-key';
import { ResourceIdentityResolutionService } from './resource-identity-resolution.service';

const WS = 'ws-A';
const KERIKIL = {
  id: 'cat-kerikil',
  code: null,
  name: 'Kerikil / Agregat',
  type: 'MATERIAL',
  baseUnit: 'M3',
  status: 'ACTIVE',
  specifications: null,
};
const QUESTION = {
  workspaceId: WS,
  resourceType: 'MATERIAL',
  rawName: 'Agregat kasar',
  rawCode: 'M03',
  rawUnit: 'M3',
};
const REFERENCE = {
  rawName: QUESTION.rawName,
  rawCode: QUESTION.rawCode,
  rawUnit: QUESTION.rawUnit,
  resourceType: QUESTION.resourceType,
};
const KEY = identicalQuestionKey(QUESTION);
const DIGEST = candidateContextDigest([
  {
    resourceCatalogId: KERIKIL.id,
    name: KERIKIL.name,
    type: KERIKIL.type,
    baseUnit: KERIKIL.baseUnit,
    specifications: null,
  },
]);

type Latest = {
  id: string;
  questionKey: string;
  generation: number;
  action: string;
  selectedResourceCatalogId: string | null;
  candidateContextDigest: string | null;
  resolutionPolicyVersion: string | null;
  decidedByAccountId: string;
  decidedAt: Date;
  previousDecision: null | {
    id: string;
    generation: number;
    action: string;
    selectedResourceCatalogId: string | null;
    candidateContextDigest: string | null;
    resolutionPolicyVersion: string | null;
    decidedByAccountId: string;
    reason: string | null;
    originObservation: typeof QUESTION;
  };
};

const TEACH_EVENT = {
  id: 'teach-1',
  generation: 1,
  action: 'TEACH',
  selectedResourceCatalogId: KERIKIL.id,
  candidateContextDigest: DIGEST,
  resolutionPolicyVersion: IQL01_IDENTICAL_QUESTION_POLICY_VERSION,
  decidedByAccountId: 'acct-owner',
  reason: null,
  originObservation: QUESTION,
};
const approved = (
  over: Partial<Latest['previousDecision'] & object> = {},
): Latest => ({
  id: 'approve-2',
  questionKey: KEY,
  generation: 2,
  action: 'APPROVE',
  selectedResourceCatalogId: null,
  candidateContextDigest: null,
  resolutionPolicyVersion: null,
  decidedByAccountId: 'acct-second',
  decidedAt: new Date('2026-09-11T09:00:00.000Z'),
  previousDecision: { ...TEACH_EVENT, ...over },
});

function fakeClient(ledger: Latest[], catalogs = [KERIKIL]) {
  return {
    resourceCatalog: { findMany: jest.fn(() => Promise.resolve(catalogs)) },
    resourceSourceIdentity: { findMany: jest.fn(() => Promise.resolve([])) },
    basicPriceImportRowResourceMapping: {
      findMany: jest.fn(() => Promise.resolve([])),
    },
    resourceIdentityQuestionDecision: {
      findMany: jest.fn(
        (args: {
          where: { workspaceId: string; questionKey: { in: string[] } };
        }) =>
          Promise.resolve(
            ledger.filter((row) =>
              args.where.questionKey.in.includes(row.questionKey),
            ),
          ),
      ),
    },
  };
}

const units = {
  resolveCanonicalUnitIdentities: jest.fn(() =>
    Promise.reject(
      new Error('no representation tie is expected in these fixtures'),
    ),
  ),
};
const service = new ResourceIdentityResolutionService(
  null as never,
  units as never,
);

async function resolveWith(
  ledger: Latest[] | undefined,
  reference = REFERENCE,
  catalogs = [KERIKIL],
  workspaceId = WS,
) {
  const client = fakeClient(ledger ?? [], catalogs);
  const evidence = await service.loadEvidence(
    client as never,
    workspaceId,
    undefined,
    ledger === undefined
      ? undefined
      : {
          identicalQuestionKeys: [
            identicalQuestionKey({
              ...QUESTION,
              workspaceId,
              rawName: reference.rawName,
              rawCode: reference.rawCode,
              rawUnit: reference.rawUnit,
              resourceType: reference.resourceType,
            }),
          ],
        },
  );
  return {
    client,
    evidence,
    result: await service.resolve(evidence, reference),
  };
}

describe('IQL-01 resolver hook', () => {
  // ---------------- zero-knowledge invariance ----------------
  it('without opt-in: no ledger query, no IQL fields, the verdict exactly as before', async () => {
    const { client, evidence, result } = await resolveWith(undefined);
    expect(
      client.resourceIdentityQuestionDecision.findMany,
    ).not.toHaveBeenCalled();
    expect(evidence).not.toHaveProperty('identicalQuestionScope');
    expect(evidence).not.toHaveProperty('identicalQuestionDecisions');
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.reasonCodes).toEqual(['STRONG_CANDIDATE_NEEDS_REVIEW']);
  });

  it('opt-in with an EMPTY ledger yields a byte-identical verdict', async () => {
    const before = await resolveWith(undefined);
    const after = await resolveWith([]);
    expect(JSON.stringify(after.result)).toBe(JSON.stringify(before.result));
  });

  it('the preload is ONE bounded, workspace-strict, newest-per-question query', async () => {
    const { client } = await resolveWith([approved()]);
    expect(
      client.resourceIdentityQuestionDecision.findMany,
    ).toHaveBeenCalledTimes(1);
    const args = (
      client.resourceIdentityQuestionDecision.findMany.mock
        .calls[0] as unknown[]
    )[0] as {
      where: unknown;
      distinct: unknown;
      orderBy: unknown;
    };
    expect(args.where).toEqual({ workspaceId: WS, questionKey: { in: [KEY] } });
    expect(args.distinct).toEqual(['questionKey']);
    expect(args.orderBy).toEqual([
      { questionKey: 'asc' },
      { generation: 'desc' },
    ]);
  });

  // ---------------- the one legitimate path ----------------
  it('an APPROVED answer for the identical question resolves it, as human-verified reuse', async () => {
    const { result } = await resolveWith([approved()]);
    expect(result.status).toBe('RESOLVED');
    expect(result.authority).toBe('VERIFIED_IDENTICAL_QUESTION_REUSED');
    expect(result.resolvedResourceCatalogId).toBe(KERIKIL.id);
    expect(result.explanation).toContain('generasi 2');
    expect(result.explanation).toContain('acct-second');
  });

  // ---------------- only APPROVE, only the latest ----------------
  it.each(['TEACH', 'REJECT', 'SUPERSEDE', 'REVOKE'])(
    'a latest %s is never reused',
    async (action) => {
      const latest: Latest = {
        ...approved(),
        action,
        selectedResourceCatalogId:
          action === 'TEACH' || action === 'SUPERSEDE' ? KERIKIL.id : null,
        candidateContextDigest:
          action === 'TEACH' || action === 'SUPERSEDE' ? DIGEST : null,
        resolutionPolicyVersion:
          action === 'TEACH' || action === 'SUPERSEDE'
            ? IQL01_IDENTICAL_QUESTION_POLICY_VERSION
            : null,
      };
      const { result } = await resolveWith([latest]);
      expect(result.status).toBe('NEEDS_REVIEW');
      expect(result.authority).not.toBe('VERIFIED_IDENTICAL_QUESTION_REUSED');
    },
  );

  // ---------------- every guard refuses on its own ----------------
  it('a changed candidate context (stale digest) refuses reuse', async () => {
    const { result } = await resolveWith([
      approved({ candidateContextDigest: 'another-context' }),
    ]);
    expect(result.status).toBe('NEEDS_REVIEW');
  });

  it('a new candidate appearing changes the context and refuses reuse', async () => {
    const extra = {
      ...KERIKIL,
      id: 'cat-agregat-halus',
      name: 'Agregat halus',
    };
    const { result } = await resolveWith([approved()], REFERENCE, [
      KERIKIL,
      extra,
    ]);
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.authority).not.toBe('VERIFIED_IDENTICAL_QUESTION_REUSED');
  });

  it('an answer recorded under another policy refuses reuse', async () => {
    const { result } = await resolveWith([
      approved({ resolutionPolicyVersion: 'IQL00_OLDER_POLICY' }),
    ]);
    expect(result.status).toBe('NEEDS_REVIEW');
  });

  it('a forged ledger entry whose origin states a DIFFERENT question refuses reuse (raw guard)', async () => {
    const { result } = await resolveWith([
      approved({
        originObservation: { ...QUESTION, rawName: 'Agregat Kasar' },
      }),
    ]);
    expect(result.status).toBe('NEEDS_REVIEW');
  });

  it('an inactive target is not a candidate, so it refuses reuse', async () => {
    const { result } = await resolveWith([approved()], REFERENCE, [
      { ...KERIKIL, status: 'INACTIVE' },
    ]);
    expect(result.status).not.toBe('RESOLVED');
  });

  it('machine RESOLVED beats memory: an exact catalog match is never overridden', async () => {
    const exact = { ...KERIKIL, id: 'cat-exact', name: 'Agregat kasar' };
    const { result } = await resolveWith([approved()], REFERENCE, [
      exact,
      KERIKIL,
    ]);
    expect(result.authority).toBe('EXACT_CANONICAL_MATCH');
    expect(result.resolvedResourceCatalogId).toBe('cat-exact');
  });

  // ---------------- exactness ----------------
  it.each([
    ['case', { rawName: 'Agregat Kasar' }],
    ['whitespace', { rawName: 'AGREGAT  KASAR' }],
    ['absent code', { rawCode: null }],
    ['another unit', { rawUnit: 'Kg' }],
    ['another class', { resourceType: 'EQUIPMENT' }],
  ])(
    'a near-miss (%s) is a different question and is never answered by memory',
    async (_label, change) => {
      const client = fakeClient([approved()]);
      const reference = { ...REFERENCE, ...change };
      const evidence = await service.loadEvidence(
        client as never,
        WS,
        undefined,
        {
          identicalQuestionKeys: [
            identicalQuestionKey({ ...QUESTION, ...change }),
          ],
        },
      );
      const result = await service.resolve(evidence, reference);
      expect(result.authority).not.toBe('VERIFIED_IDENTICAL_QUESTION_REUSED');
    },
  );

  it('another workspace never sees this workspace’s memory', async () => {
    const { result } = await resolveWith(
      [approved()],
      REFERENCE,
      [KERIKIL],
      'ws-B',
    );
    expect(result.authority).not.toBe('VERIFIED_IDENTICAL_QUESTION_REUSED');
  });

  // ---------------- reads write nothing ----------------
  it('a read resolves through findMany only — no create, no update, no sighting', async () => {
    const { client } = await resolveWith([approved()]);
    for (const model of Object.values(client)) {
      expect(Object.keys(model)).toEqual(['findMany']);
    }
  });
});
