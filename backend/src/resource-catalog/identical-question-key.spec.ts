import { createHash } from 'node:crypto';

import {
  IQL01_IDENTICAL_QUESTION_POLICY_VERSION,
  IQL01_QUESTION_KEY_TAG,
  IdenticalQuestion,
  identicalQuestionKey,
  isSameIdenticalQuestion,
} from './identical-question-key';
import { isAnswerApplicable } from './identical-question-governance';

/**
 * IQL-01 — the exact question fingerprint. Exact means exact: every near-miss
 * is a DIFFERENT question, because a near-miss costs one human decision while a
 * false match costs a wrong identity.
 */
describe('IQL-01 identicalQuestionKey', () => {
  const AGREGAT_KASAR: IdenticalQuestion = {
    workspaceId: 'a9978fab-d1fc-4bb3-9beb-5d8b89d973e3',
    resourceType: 'MATERIAL',
    rawName: 'Agregat kasar',
    rawCode: 'M03',
    rawUnit: 'M3',
  };
  const key = identicalQuestionKey(AGREGAT_KASAR);

  it('is the sha256 of the locked tuple, serialized once as JSON (lock §2)', () => {
    const expected = createHash('sha256')
      .update(
        JSON.stringify([
          'IQL01',
          AGREGAT_KASAR.workspaceId,
          'MATERIAL',
          'Agregat kasar',
          'M03',
          'M3',
        ]),
        'utf8',
      )
      .digest('hex');
    expect(IQL01_QUESTION_KEY_TAG).toBe('IQL01');
    expect(key).toBe(expected);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    expect(identicalQuestionKey({ ...AGREGAT_KASAR })).toBe(key);
  });

  it.each<[string, Partial<IdenticalQuestion>]>([
    ['case', { rawName: 'Agregat Kasar' }],
    ['upper case', { rawName: 'AGREGAT KASAR' }],
    ['inner whitespace', { rawName: 'Agregat  kasar' }],
    ['leading whitespace', { rawName: ' Agregat kasar' }],
    ['trailing whitespace', { rawName: 'Agregat kasar ' }],
    ['a different word', { rawName: 'Agregat halus' }],
    ['code case', { rawCode: 'm03' }],
    ['code absent', { rawCode: null }],
    ['code empty', { rawCode: '' }],
    ['unit case', { rawUnit: 'm3' }],
    ['unit spelling', { rawUnit: 'M³' }],
    ['unit absent', { rawUnit: null }],
    ['resource class', { resourceType: 'EQUIPMENT' }],
    ['workspace', { workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }],
  ])('a change in %s is a different question', (_label, change) => {
    expect(identicalQuestionKey({ ...AGREGAT_KASAR, ...change })).not.toBe(key);
  });

  it('never folds Unicode: NFC and NFD spellings are different questions', () => {
    const nfc = 'Semen Pozzolan Bijih é';
    const nfd = 'Semen Pozzolan Bijih é';
    expect(nfc.normalize('NFC')).toBe(nfd.normalize('NFC'));
    expect(identicalQuestionKey({ ...AGREGAT_KASAR, rawName: nfc })).not.toBe(
      identicalQuestionKey({ ...AGREGAT_KASAR, rawName: nfd }),
    );
  });

  it('null and "" are different questions, for code and for unit', () => {
    expect(identicalQuestionKey({ ...AGREGAT_KASAR, rawCode: null })).not.toBe(
      identicalQuestionKey({ ...AGREGAT_KASAR, rawCode: '' }),
    );
    expect(identicalQuestionKey({ ...AGREGAT_KASAR, rawUnit: null })).not.toBe(
      identicalQuestionKey({ ...AGREGAT_KASAR, rawUnit: '' }),
    );
  });

  it('a variant wording is never the same question ("Sewa Dump Truck" ≠ "Dump Truck")', () => {
    const base = {
      ...AGREGAT_KASAR,
      resourceType: 'EQUIPMENT',
      rawCode: null,
      rawUnit: 'Jam',
    };
    expect(
      identicalQuestionKey({ ...base, rawName: 'Sewa Dump Truck' }),
    ).not.toBe(identicalQuestionKey({ ...base, rawName: 'Dump Truck' }));
  });

  it('a value containing the framing characters cannot impersonate a field boundary', () => {
    const smuggled = identicalQuestionKey({
      ...AGREGAT_KASAR,
      rawName: 'Agregat kasar","M03',
      rawCode: null,
    });
    const honest = identicalQuestionKey({
      ...AGREGAT_KASAR,
      rawName: 'Agregat kasar',
      rawCode: 'M03',
    });
    expect(smuggled).not.toBe(honest);
  });

  it('isSameIdenticalQuestion compares the raw fields exactly', () => {
    expect(isSameIdenticalQuestion(AGREGAT_KASAR, { ...AGREGAT_KASAR })).toBe(
      true,
    );
    expect(
      isSameIdenticalQuestion(AGREGAT_KASAR, {
        ...AGREGAT_KASAR,
        rawName: 'Agregat Kasar',
      }),
    ).toBe(false);
    expect(
      isSameIdenticalQuestion(AGREGAT_KASAR, { ...AGREGAT_KASAR, rawCode: '' }),
    ).toBe(false);
  });

  it('carries its own policy version, never another domain’s', () => {
    expect(IQL01_IDENTICAL_QUESTION_POLICY_VERSION).toBe(
      'IQL01_IDENTICAL_QUESTION_V2',
    );
  });

  /**
   * The version records WHICH LAW an answer was approved under. V1 permitted an
   * answer to be taught for a row nominated on name similarity alone; V2 does
   * not. So an answer stored under V1 must not settle anything by itself — not
   * because its candidate set changed (it need not have), but because the
   * approval was given under a law this workspace no longer applies.
   *
   * This asserts the MECHANISM, not the literal: the applicability law refuses
   * the superseded policy and admits the current one, with the candidate context
   * held identical so the policy is the only thing under test.
   */
  it('an answer recorded under the superseded policy is NOT applicable', () => {
    const live = {
      candidateContextDigest: 'digest-unchanged',
      resolutionPolicyVersion: IQL01_IDENTICAL_QUESTION_POLICY_VERSION,
    };
    const answerUnder = (resolutionPolicyVersion: string) =>
      ({
        candidateContextDigest: 'digest-unchanged',
        resolutionPolicyVersion,
      }) as never;

    expect(
      isAnswerApplicable(answerUnder('IQL01_IDENTICAL_QUESTION_V1'), live),
    ).toBe(false);
    expect(
      isAnswerApplicable(
        answerUnder(IQL01_IDENTICAL_QUESTION_POLICY_VERSION),
        live,
      ),
    ).toBe(true);
  });
});
