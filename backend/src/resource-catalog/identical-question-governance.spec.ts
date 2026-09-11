import {
  IdenticalQuestionEvent,
  identicalQuestionState,
  isAnswerApplicable,
  planApprove,
  planReject,
  planRevoke,
  planSupersede,
  planTeach,
} from './identical-question-governance';

/**
 * IQL-01 — the governance state machine. TEACH is never effective; APPROVE needs
 * a different account; REJECT and REVOKE leave nothing; only the latest
 * generation is read; nothing ever revives.
 */
describe('IQL-01 governance law', () => {
  const POLICY = 'IQL01_IDENTICAL_QUESTION_V1';
  const LIVE = {
    candidateContextDigest: 'digest-A',
    resolutionPolicyVersion: POLICY,
  };
  const TEACHER = 'acct-owner';
  const APPROVER = 'acct-second';

  const event = (
    over: Partial<IdenticalQuestionEvent> &
      Pick<IdenticalQuestionEvent, 'id' | 'generation' | 'action'>,
  ): IdenticalQuestionEvent => ({
    selectedResourceCatalogId: null,
    candidateContextDigest: null,
    resolutionPolicyVersion: null,
    decidedByAccountId: TEACHER,
    ...over,
  });
  const teach = (generation = 1, over: Partial<IdenticalQuestionEvent> = {}) =>
    event({
      id: `teach-${generation}`,
      generation,
      action: 'TEACH',
      selectedResourceCatalogId: 'cat-kerikil',
      candidateContextDigest: 'digest-A',
      resolutionPolicyVersion: POLICY,
      ...over,
    });
  const approve = (generation = 2, by = APPROVER) =>
    event({
      id: `approve-${generation}`,
      generation,
      action: 'APPROVE',
      decidedByAccountId: by,
    });

  // ---------------- state ----------------
  it('no event is NONE; a TEACH is PENDING, never effective', () => {
    expect(identicalQuestionState(null, null).kind).toBe('NONE');
    expect(identicalQuestionState(teach(), null).kind).toBe('PENDING');
  });

  it('an APPROVE of an answer is APPROVED; an APPROVE of a non-answer is a broken lineage → NONE', () => {
    expect(identicalQuestionState(approve(), teach()).kind).toBe('APPROVED');
    expect(
      identicalQuestionState(
        approve(3),
        event({ id: 'r', generation: 2, action: 'REJECT' }),
      ).kind,
    ).toBe('NONE');
    expect(identicalQuestionState(approve(), null).kind).toBe('NONE');
  });

  it('a changed candidate context makes an approved answer inapplicable — and creates no event', () => {
    const answer = teach();
    expect(isAnswerApplicable(answer, LIVE)).toBe(true);
    expect(
      isAnswerApplicable(answer, {
        ...LIVE,
        candidateContextDigest: 'digest-B',
      }),
    ).toBe(false);
    expect(
      isAnswerApplicable(answer, {
        ...LIVE,
        resolutionPolicyVersion: 'OTHER_V1',
      }),
    ).toBe(false);
    // Still the same latest event: inapplicability is read, never written.
    expect(identicalQuestionState(approve(), answer).kind).toBe('APPROVED');
  });

  // ---------------- TEACH ----------------
  it('TEACH on a fresh question appends generation 1 with no predecessor', () => {
    expect(
      planTeach({
        state: identicalQuestionState(null, null),
        latest: null,
        expectedGeneration: 0,
        selectedResourceCatalogId: 'cat-kerikil',
        live: LIVE,
      }),
    ).toEqual({ outcome: 'APPEND', generation: 1, previousDecisionId: null });
  });

  it('TEACH against a stale generation is refused', () => {
    expect(
      planTeach({
        state: identicalQuestionState(null, null),
        latest: null,
        expectedGeneration: 3,
        selectedResourceCatalogId: 'cat-kerikil',
        live: LIVE,
      }),
    ).toEqual({ outcome: 'CONFLICT', code: 'DECISION_GENERATION_STALE' });
  });

  it('the SAME answer while pending is a replay (a grouped decision spends one context); a different one is CANDIDATE_PENDING', () => {
    const latest = teach();
    const state = identicalQuestionState(latest, null);
    expect(
      planTeach({
        state,
        latest,
        expectedGeneration: 0,
        selectedResourceCatalogId: 'cat-kerikil',
        live: LIVE,
      }),
    ).toEqual({ outcome: 'REPLAY', event: latest });
    expect(
      planTeach({
        state,
        latest,
        expectedGeneration: 1,
        selectedResourceCatalogId: 'cat-other',
        live: LIVE,
      }),
    ).toEqual({ outcome: 'CONFLICT', code: 'CANDIDATE_PENDING' });
    expect(
      planTeach({
        state,
        latest,
        expectedGeneration: 1,
        selectedResourceCatalogId: 'cat-kerikil',
        live: { ...LIVE, candidateContextDigest: 'digest-B' },
      }),
    ).toEqual({ outcome: 'CONFLICT', code: 'CANDIDATE_PENDING' });
  });

  it('while an applicable answer is effective: the same answer replays, a different one must SUPERSEDE', () => {
    const answer = teach();
    const latest = approve();
    const state = identicalQuestionState(latest, answer);
    expect(
      planTeach({
        state,
        latest,
        expectedGeneration: 0,
        selectedResourceCatalogId: 'cat-kerikil',
        live: LIVE,
      }),
    ).toEqual({ outcome: 'REPLAY', event: latest });
    expect(
      planTeach({
        state,
        latest,
        expectedGeneration: 2,
        selectedResourceCatalogId: 'cat-other',
        live: LIVE,
      }),
    ).toEqual({ outcome: 'CONFLICT', code: 'USE_SUPERSEDE' });
  });

  it('an approved answer that no longer applies can be taught again — as the NEXT generation', () => {
    const latest = approve();
    const state = identicalQuestionState(latest, teach());
    expect(
      planTeach({
        state,
        latest,
        expectedGeneration: 2,
        selectedResourceCatalogId: 'cat-other',
        live: { ...LIVE, candidateContextDigest: 'digest-B' },
      }),
    ).toEqual({
      outcome: 'APPEND',
      generation: 3,
      previousDecisionId: 'approve-2',
    });
  });

  it('after REJECT or REVOKE, only a NEW TEACH can begin again — nothing revives', () => {
    const rejected = event({
      id: 'reject-2',
      generation: 2,
      action: 'REJECT',
      decidedByAccountId: APPROVER,
    });
    const revoked = event({
      id: 'revoke-3',
      generation: 3,
      action: 'REVOKE',
      decidedByAccountId: APPROVER,
    });
    expect(
      planTeach({
        state: identicalQuestionState(rejected, teach()),
        latest: rejected,
        expectedGeneration: 2,
        selectedResourceCatalogId: 'cat-kerikil',
        live: LIVE,
      }),
    ).toEqual({
      outcome: 'APPEND',
      generation: 3,
      previousDecisionId: 'reject-2',
    });
    expect(
      planTeach({
        state: identicalQuestionState(revoked, approve()),
        latest: revoked,
        expectedGeneration: 3,
        selectedResourceCatalogId: 'cat-kerikil',
        live: LIVE,
      }),
    ).toEqual({
      outcome: 'APPEND',
      generation: 4,
      previousDecisionId: 'revoke-3',
    });
  });

  // ---------------- APPROVE ----------------
  it('the teacher can NEVER approve their own candidate', () => {
    const latest = teach();
    expect(
      planApprove({
        state: identicalQuestionState(latest, null),
        latest,
        expectedGeneration: 1,
        actorAccountId: TEACHER,
      }),
    ).toEqual({ outcome: 'CONFLICT', code: 'TEACHER_CANNOT_APPROVE' });
  });

  it('a different authorized account approves as the next generation', () => {
    const latest = teach();
    expect(
      planApprove({
        state: identicalQuestionState(latest, null),
        latest,
        expectedGeneration: 1,
        actorAccountId: APPROVER,
      }),
    ).toEqual({
      outcome: 'APPEND',
      generation: 2,
      previousDecisionId: 'teach-1',
    });
  });

  it('there is nothing to approve unless a candidate is pending', () => {
    const rejected = event({ id: 'reject-2', generation: 2, action: 'REJECT' });
    expect(
      planApprove({
        state: identicalQuestionState(null, null),
        latest: null,
        expectedGeneration: 0,
        actorAccountId: APPROVER,
      }),
    ).toEqual({ outcome: 'CONFLICT', code: 'NO_PENDING_CANDIDATE' });
    expect(
      planApprove({
        state: identicalQuestionState(rejected, teach()),
        latest: rejected,
        expectedGeneration: 2,
        actorAccountId: APPROVER,
      }),
    ).toEqual({ outcome: 'CONFLICT', code: 'NO_PENDING_CANDIDATE' });
  });

  it('concurrent approvals: the approver replays, the loser is stale — never two current answers', () => {
    const latest = approve(2, APPROVER);
    const state = identicalQuestionState(latest, teach());
    expect(
      planApprove({
        state,
        latest,
        expectedGeneration: 1,
        actorAccountId: APPROVER,
      }),
    ).toEqual({ outcome: 'REPLAY', event: latest });
    expect(
      planApprove({
        state,
        latest,
        expectedGeneration: 1,
        actorAccountId: 'acct-third',
      }),
    ).toEqual({ outcome: 'CONFLICT', code: 'DECISION_GENERATION_STALE' });
  });

  // ---------------- REJECT / REVOKE / SUPERSEDE ----------------
  it('REJECT judges only a pending candidate', () => {
    const latest = teach();
    expect(
      planReject({
        state: identicalQuestionState(latest, null),
        latest,
        expectedGeneration: 1,
        actorAccountId: APPROVER,
      }),
    ).toEqual({
      outcome: 'APPEND',
      generation: 2,
      previousDecisionId: 'teach-1',
    });
    const approved = approve();
    expect(
      planReject({
        state: identicalQuestionState(approved, teach()),
        latest: approved,
        expectedGeneration: 2,
        actorAccountId: APPROVER,
      }),
    ).toEqual({ outcome: 'CONFLICT', code: 'NO_PENDING_CANDIDATE' });
  });

  it('REVOKE withdraws an approved answer — applicable or not — and nothing else', () => {
    const approved = approve();
    expect(
      planRevoke({
        state: identicalQuestionState(approved, teach()),
        latest: approved,
        expectedGeneration: 2,
        actorAccountId: TEACHER,
      }),
    ).toEqual({
      outcome: 'APPEND',
      generation: 3,
      previousDecisionId: 'approve-2',
    });
    const pending = teach();
    expect(
      planRevoke({
        state: identicalQuestionState(pending, null),
        latest: pending,
        expectedGeneration: 1,
        actorAccountId: TEACHER,
      }),
    ).toEqual({ outcome: 'CONFLICT', code: 'NO_EFFECTIVE_ANSWER' });
  });

  it('SUPERSEDE needs an effective, still-applicable answer and a DIFFERENT selection', () => {
    const approved = approve();
    const state = identicalQuestionState(approved, teach());
    expect(
      planSupersede({
        state,
        latest: approved,
        expectedGeneration: 2,
        actorAccountId: TEACHER,
        selectedResourceCatalogId: 'cat-other',
        live: LIVE,
      }),
    ).toEqual({
      outcome: 'APPEND',
      generation: 3,
      previousDecisionId: 'approve-2',
    });
    expect(
      planSupersede({
        state,
        latest: approved,
        expectedGeneration: 2,
        actorAccountId: TEACHER,
        selectedResourceCatalogId: 'cat-kerikil',
        live: LIVE,
      }),
    ).toEqual({ outcome: 'CONFLICT', code: 'SUPERSEDE_SAME_ANSWER' });
    expect(
      planSupersede({
        state,
        latest: approved,
        expectedGeneration: 2,
        actorAccountId: TEACHER,
        selectedResourceCatalogId: 'cat-other',
        live: { ...LIVE, candidateContextDigest: 'digest-B' },
      }),
    ).toEqual({ outcome: 'CONFLICT', code: 'NO_EFFECTIVE_ANSWER' });
  });

  it('a SUPERSEDE is itself only a candidate: reuse stops until someone else approves it', () => {
    const superseding = teach(3, {
      id: 'supersede-3',
      action: 'SUPERSEDE',
      selectedResourceCatalogId: 'cat-other',
    });
    const state = identicalQuestionState(superseding, approve());
    expect(state.kind).toBe('PENDING');
    expect(
      planApprove({
        state,
        latest: superseding,
        expectedGeneration: 3,
        actorAccountId: TEACHER,
      }),
    ).toEqual({ outcome: 'CONFLICT', code: 'TEACHER_CANNOT_APPROVE' });
    expect(
      planApprove({
        state,
        latest: superseding,
        expectedGeneration: 3,
        actorAccountId: APPROVER,
      }),
    ).toEqual({
      outcome: 'APPEND',
      generation: 4,
      previousDecisionId: 'supersede-3',
    });
  });

  it('the generation sequence is total: TEACH 1 → APPROVE 2 → REVOKE 3 → TEACH 4 → APPROVE 5', () => {
    const g1 = planTeach({
      state: identicalQuestionState(null, null),
      latest: null,
      expectedGeneration: 0,
      selectedResourceCatalogId: 'cat-kerikil',
      live: LIVE,
    });
    const t1 = teach(1);
    const g2 = planApprove({
      state: identicalQuestionState(t1, null),
      latest: t1,
      expectedGeneration: 1,
      actorAccountId: APPROVER,
    });
    const a2 = approve(2);
    const g3 = planRevoke({
      state: identicalQuestionState(a2, t1),
      latest: a2,
      expectedGeneration: 2,
      actorAccountId: TEACHER,
    });
    const r3 = event({ id: 'revoke-3', generation: 3, action: 'REVOKE' });
    const g4 = planTeach({
      state: identicalQuestionState(r3, a2),
      latest: r3,
      expectedGeneration: 3,
      selectedResourceCatalogId: 'cat-kerikil',
      live: LIVE,
    });
    const t4 = teach(4);
    const g5 = planApprove({
      state: identicalQuestionState(t4, r3),
      latest: t4,
      expectedGeneration: 4,
      actorAccountId: APPROVER,
    });
    expect(
      [g1, g2, g3, g4, g5].map((plan) =>
        plan.outcome === 'APPEND' ? plan.generation : plan.outcome,
      ),
    ).toEqual([1, 2, 3, 4, 5]);
  });
});
