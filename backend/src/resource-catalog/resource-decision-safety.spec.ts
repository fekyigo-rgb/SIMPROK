import { candidateContextDigest } from './ghx-candidate-context';
import {
  IdentityCatalogCandidate,
  ResourceIdentityResolution,
  SourceSightingEvidence,
  VerifiedIdentityDecisionFact,
  isAdmissibleAfterExamination,
  isHumanDecidable,
  isIdenticalQuestionDecidable,
  isSingleStrongCandidate,
  resolveResourceIdentity,
  selectionRefusal,
} from './resource-identity-resolution.kernel';
import {
  ResourceAdmissionNotExhaustedError,
  ResourceAdmissionService,
} from './resource-admission.service';
import { ResourceObservationController } from './resource-observation.controller';
import { ahspSourceRowKey } from '../ahsp/services/ahsp-import.service';
import { ResourceObservationService } from './resource-observation.service';
import {
  UNIT_PRICE_OPERATION,
  UNIT_RESOLUTION_STATUS,
  UnitResolutionResult,
} from '../unit-kernel/unit-kernel.contracts';

/**
 * RESOURCE DECISION SAFETY — the write-eligibility law, through the REAL kernel,
 * on shapes taken verbatim from the Owner's canonical census (2026-09-17):
 *
 *   "Tripleks [Lbr] M130"            → "Paku tripleks"         token containment only
 *   "Semen [Kg]"                     → "Serat semen gel 92x250" shared stem only
 *   "CRANE ON TRACK 10-15 TON [Jam]" → "Sewa crane"            shared stem only
 *   "Stamper [jam] E25"              → "Stemper"               source code seen (recorded fact)
 *   "PC : Portland Cement [Kg] M.23" → "Semen Portlan" (code) + "Semen Portland / Tonasa" (stem)
 *   "Pipa porous diameter 6\" [M'] M25a" → "Besi angker diameter 8" ruled out
 *
 * A nomination resting on name similarity is a reason to look and never an
 * identity: not offered as a confirmation, not written, not taught, not reused.
 * A single candidate is not strong because it is alone.
 */

const row = (
  id: string,
  name: string,
  type = 'MATERIAL',
  baseUnit = 'Kg',
): IdentityCatalogCandidate => ({
  id,
  code: null,
  name,
  type,
  baseUnit,
  status: 'ACTIVE',
  specifications: null,
});
const sightingOf = (
  resourceCatalogId: string,
  rawCode: string,
  sourceSection = 'MATERIAL',
  sourceSha256 = 'S'.repeat(64),
): SourceSightingEvidence => ({
  resourceCatalogId,
  rawName: 'seen before',
  rawCode,
  rawUnit: null,
  sourceSection,
  sourceSha256,
  sheetName: 'Sheet1',
  sourceRowNumber: 3,
});
const resolve = (
  reference: {
    rawName: string;
    rawCode: string | null;
    rawUnit: string | null;
    resourceType: string;
    sourceSha256?: string | null;
  },
  catalogCandidates: IdentityCatalogCandidate[],
  sourceSightings: SourceSightingEvidence[] = [],
  verifiedIdentityDecision?: VerifiedIdentityDecisionFact,
) =>
  resolveResourceIdentity({
    reference,
    catalogCandidates,
    sourceSightings,
    reviewedMappings: [],
    verifiedIdentityDecision,
  });
const digestOf = (verdict: ResourceIdentityResolution) =>
  candidateContextDigest(
    verdict.candidates.map((c) => ({
      resourceCatalogId: c.resourceCatalogId,
      name: c.name,
      type: c.type,
      baseUnit: c.baseUnit,
      specifications: c.specifications,
    })),
  );

const PAKU_TRIPLEKS = row('cat-paku-tripleks', 'Paku tripleks');
const SERAT_SEMEN = row('cat-serat-semen', 'Serat semen gel 92x250', 'MATERIAL', 'Lbr');
const SEWA_CRANE = row('cat-sewa-crane', 'Sewa crane', 'EQUIPMENT', 'Jam');
const STEMPER = row('cat-stemper', 'Stemper', 'EQUIPMENT', 'Jam');
const SEMEN_PORTLAN = row('cat-semen-portlan', 'Semen Portlan');
const SEMEN_TONASA = row('cat-semen-tonasa', 'Semen Portland / Tonasa');
const BESI_ANGKER_8 = row('cat-besi-angker-8', 'Besi angker diameter 8', 'MATERIAL', 'Kg');

const TRIPLEKS = { rawName: 'Tripleks', rawCode: 'M130', rawUnit: 'Lbr', resourceType: 'MATERIAL' };
const SEMEN = { rawName: 'Semen', rawCode: null, rawUnit: 'Kg', resourceType: 'MATERIAL' };
const CRANE = { rawName: 'CRANE ON TRACK 10-15 TON', rawCode: 'E07', rawUnit: 'Jam', resourceType: 'EQUIPMENT' };
const STAMPER = { rawName: 'Stamper', rawCode: 'E25', rawUnit: 'jam', resourceType: 'EQUIPMENT' };
const PORTLAND = { rawName: 'PC : Portland Cement', rawCode: 'M.23', rawUnit: 'Kg', resourceType: 'MATERIAL' };
const PIPA_6 = { rawName: 'Pipa porous diameter 6"', rawCode: 'M25a', rawUnit: "M'", resourceType: 'MATERIAL' };

const iqlFact = (resourceCatalogId: string): VerifiedIdentityDecisionFact => ({
  resourceCatalogId,
  decidedByAccountId: 'acct-second',
  decidedAt: '2026-09-17T07:10:00.000Z',
  generation: 2,
  reason: null,
  scope: 'IDENTICAL_QUESTION',
});
const ghxFact = (resourceCatalogId: string): VerifiedIdentityDecisionFact => ({
  ...iqlFact(resourceCatalogId),
  scope: 'SOURCE_FACT',
});

describe('RESOURCE DECISION SAFETY — the kernel states what a nomination rests on', () => {
  it('Tripleks → Paku tripleks: one candidate, token containment only — NAME_SIMILARITY_ONLY, not strong, not decidable', () => {
    const verdict = resolve(TRIPLEKS, [PAKU_TRIPLEKS]);
    expect(verdict.status).toBe('NEEDS_REVIEW');
    expect(verdict.reasonCodes).toEqual(['STRONG_CANDIDATE_NEEDS_REVIEW']);
    expect(verdict.candidates).toHaveLength(1);
    expect(verdict.candidates[0].evidence).toContain('NAME_TOKEN_CONTAINMENT');
    expect(verdict.candidates[0].identityBasis).toBe('NAME_SIMILARITY_ONLY');
    expect(isSingleStrongCandidate(verdict)).toBe(false);
    expect(isIdenticalQuestionDecidable(verdict)).toBe(false);
    expect(selectionRefusal(verdict, PAKU_TRIPLEKS.id)).toBe(
      'IDENTITY_CANDIDATE_NAME_SIMILARITY_ONLY',
    );
  });

  it.each([
    ['Semen → Serat semen gel 92x250', SEMEN, SERAT_SEMEN],
    ['CRANE ON TRACK → Sewa crane', CRANE, SEWA_CRANE],
  ])('%s: a shared stem is refused at the write', (_label, reference, candidate) => {
    const verdict = resolve(reference, [candidate]);
    expect(verdict.candidates.map((c) => c.identityBasis)).toEqual([
      'NAME_SIMILARITY_ONLY',
    ]);
    expect(selectionRefusal(verdict, candidate.id)).toBe(
      'IDENTITY_CANDIDATE_NAME_SIMILARITY_ONLY',
    );
  });

  it('POSITIVE CONTROL — Stamper → Stemper on a recorded source code stays a confirmable, teachable human decision', () => {
    const verdict = resolve(STAMPER, [STEMPER], [sightingOf(STEMPER.id, 'E25', 'EQUIPMENT')]);
    expect(verdict.candidates[0].identityBasis).toBe('RECORDED_FACT');
    expect(isSingleStrongCandidate(verdict)).toBe(true);
    expect(isIdenticalQuestionDecidable(verdict)).toBe(true);
    expect(selectionRefusal(verdict, STEMPER.id)).toBeNull();
    // An approved exact-question answer for it IS reused.
    const reused = resolve(STAMPER, [STEMPER], [sightingOf(STEMPER.id, 'E25', 'EQUIPMENT')], iqlFact(STEMPER.id));
    expect(reused).toMatchObject({
      status: 'RESOLVED',
      authority: 'VERIFIED_IDENTICAL_QUESTION_REUSED',
      resolvedResourceCatalogId: STEMPER.id,
    });
  });

  it('Portland Cement: the recorded-fact candidate is confirmable, the stem-only sibling is not — within ONE verdict', () => {
    const verdict = resolve(PORTLAND, [SEMEN_PORTLAN, SEMEN_TONASA], [sightingOf(SEMEN_PORTLAN.id, 'M.23')]);
    expect(verdict.reasonCodes).toContain('MULTIPLE_CANDIDATES_NEEDS_REVIEW');
    const basis = Object.fromEntries(verdict.candidates.map((c) => [c.resourceCatalogId, c.identityBasis]));
    expect(basis).toEqual({
      [SEMEN_PORTLAN.id]: 'RECORDED_FACT',
      [SEMEN_TONASA.id]: 'NAME_SIMILARITY_ONLY',
    });
    expect(isHumanDecidable(verdict)).toBe(true);
    expect(selectionRefusal(verdict, SEMEN_PORTLAN.id)).toBeNull();
    expect(selectionRefusal(verdict, SEMEN_TONASA.id)).toBe('IDENTITY_CANDIDATE_NAME_SIMILARITY_ONLY');
    // A governed decision naming the stem-only sibling is never reused; naming the recorded one is.
    expect(resolve(PORTLAND, [SEMEN_PORTLAN, SEMEN_TONASA], [sightingOf(SEMEN_PORTLAN.id, 'M.23')], ghxFact(SEMEN_TONASA.id)).status).toBe('NEEDS_REVIEW');
    expect(resolve(PORTLAND, [SEMEN_PORTLAN, SEMEN_TONASA], [sightingOf(SEMEN_PORTLAN.id, 'M.23')], ghxFact(SEMEN_PORTLAN.id))).toMatchObject({
      status: 'RESOLVED',
      authority: 'VERIFIED_MAPPING_REUSED',
    });
  });

  it('several name-similarity guesses are not a choice between legitimate alternatives', () => {
    const KAWAT = row('cat-kawat', 'Kawat');
    const KAWAT_JARING = row('cat-kawat-jaring', 'Kawat jaring');
    const verdict = resolve({ rawName: 'Kawat Beton', rawCode: 'M14', rawUnit: 'Kg', resourceType: 'MATERIAL' }, [KAWAT, KAWAT_JARING]);
    expect(verdict.reasonCodes).toContain('MULTIPLE_CANDIDATES_NEEDS_REVIEW');
    expect(verdict.candidates.every((c) => c.identityBasis === 'NAME_SIMILARITY_ONLY')).toBe(true);
    expect(isHumanDecidable(verdict)).toBe(false);
    expect(isIdenticalQuestionDecidable(verdict)).toBe(false);
  });

  it('every refusal is named, and a row never nominated carries no evidence at all', () => {
    const exact = row('cat-exact', 'Tripleks', 'MATERIAL', 'Lbr');
    const proven = resolve(TRIPLEKS, [exact, PAKU_TRIPLEKS]);
    expect(proven.status).toBe('RESOLVED');
    expect(proven.candidates.map((c) => c.identityBasis)).toEqual(['EXACT_NAME']);
    expect(selectionRefusal(proven, exact.id)).toBeNull();
    expect(selectionRefusal(proven, PAKU_TRIPLEKS.id)).toBe('IDENTITY_PROVEN_OTHERWISE');

    const ruledOut = resolve(PIPA_6, [BESI_ANGKER_8]);
    expect(ruledOut.status).toBe('UNRESOLVED');
    expect(ruledOut.candidates.map((c) => c.identityBasis)).toEqual(['RULED_OUT']);
    expect(selectionRefusal(ruledOut, BESI_ANGKER_8.id)).toBe('IDENTITY_CANDIDATE_RULED_OUT');

    const nothing = resolve(TRIPLEKS, []);
    expect(selectionRefusal(nothing, 'cat-anything')).toBe('IDENTITY_CANDIDATE_NOT_NOMINATED');
    expect(selectionRefusal(resolve(TRIPLEKS, [PAKU_TRIPLEKS]), 'cat-unrelated')).toBe('IDENTITY_CANDIDATE_NOT_NOMINATED');
  });
});

/**
 * B-1 — IDENTITY EXPANSION AFTER ADMISSION.
 *
 * The audit's counterexample, and the live population behind it (Owner census,
 * 2026-09-17, workspace a9978fab):
 *
 *   "Pasir [M3]"          14 rows in ONE document under FOUR codes: M010, M01b, M10a, M10b
 *   "Timbunan Porus [M3]" 19 rows in ONE document under TWO codes: M44 and M144 —
 *                         and "Timbunan Porus" was admitted from M44, after which
 *                         the 18 rows stating M144 resolved AUTOMATICALLY on the name.
 *
 * One workbook uses ONE code system, so a code difference inside it is the
 * DOCUMENT distinguishing two things. A name does not overrule that.
 *
 * Deliberately one-directional. Code agreement proves nothing extra — in this
 * very population code "E07" covers three different names and "M25a" covers four
 * pipe diameters — so agreement only leaves the branch as it was. And the refusal
 * lands on a question a human can still settle: the row stays an EXACT_NAME
 * candidate, which the write-eligibility law already accepts.
 */
describe('B-1 — a code the SAME document states differently is not an identity', () => {
  const AHSP_DOC = 'A'.repeat(64);
  const OTHER_DOC = 'B'.repeat(64);
  const TIMBUNAN = row('cat-timbunan-porus', 'Timbunan Porus', 'MATERIAL', 'M3');
  const PASIR = row('cat-pasir', 'Pasir', 'MATERIAL', 'M3');
  const line = (rawCode: string | null, sourceSha256?: string | null) => ({
    rawName: 'Timbunan Porus',
    rawCode,
    rawUnit: 'M3',
    resourceType: 'MATERIAL',
    sourceSha256,
  });
  /** The admission that minted the row recorded the code it was minted from. */
  const admittedUnder = (code: string, doc = AHSP_DOC) => [
    sightingOf('cat-timbunan-porus', code, 'MATERIAL', doc),
  ];

  it('THE LIVE DEFECT: M144 no longer resolves onto a row this document recorded as M44', () => {
    const verdict = resolve(line('M144', AHSP_DOC), [TIMBUNAN], admittedUnder('M44'));
    expect(verdict.status).toBe('NEEDS_REVIEW');
    expect(verdict.resolvedResourceCatalogId).toBeNull();
    expect(verdict.reasonCodes).toContain('SOURCE_CODE_DISAGREES_WITHIN_DOCUMENT');
    expect(verdict.explanation).toContain('M144');
    expect(verdict.explanation).toContain('m44');
  });

  it('the refusal is a question, not a dead end: the row stays confirmable by a human', () => {
    const verdict = resolve(line('M144', AHSP_DOC), [TIMBUNAN], admittedUnder('M44'));
    expect(verdict.candidates[0]?.identityBasis).toBe('EXACT_NAME');
    expect(selectionRefusal(verdict, 'cat-timbunan-porus')).toBeNull();
  });

  it('it does NOT silently widen IQL: a code-disagreement question is not teachable on its own', () => {
    const verdict = resolve(line('M144', AHSP_DOC), [TIMBUNAN], admittedUnder('M44'));
    expect(isSingleStrongCandidate(verdict)).toBe(false);
    expect(isIdenticalQuestionDecidable(verdict)).toBe(false);
    expect(isHumanDecidable(verdict)).toBe(false);
  });

  it('POSITIVE CONTROL — same-document repetition under the SAME code still resolves by itself', () => {
    const verdict = resolve(line('M44', AHSP_DOC), [TIMBUNAN], admittedUnder('M44'));
    expect(verdict.status).toBe('RESOLVED');
    expect(verdict.reasonCodes).toEqual(['EXACT_CANONICAL_MATCH']);
    expect(verdict.resolvedResourceCatalogId).toBe('cat-timbunan-porus');
  });

  it('a source that states NO code disagrees with nothing — unchanged', () => {
    expect(resolve(line(null, AHSP_DOC), [TIMBUNAN], admittedUnder('M44')).status).toBe('RESOLVED');
  });

  it('ACROSS documents a code difference says nothing: two workbooks number independently', () => {
    const verdict = resolve(line('M144', AHSP_DOC), [TIMBUNAN], admittedUnder('M44', OTHER_DOC));
    expect(verdict.status).toBe('RESOLVED');
  });

  it('a caller that names no document is byte-identical to before', () => {
    expect(resolve(line('M144'), [TIMBUNAN], admittedUnder('M44')).status).toBe('RESOLVED');
    expect(resolve(line('M144', null), [TIMBUNAN], admittedUnder('M44')).status).toBe('RESOLVED');
  });

  it('a sighting belonging to ANOTHER catalogue row proves nothing about this one', () => {
    const elsewhere = [sightingOf('cat-someone-else', 'M44', 'MATERIAL', AHSP_DOC)];
    expect(resolve(line('M144', AHSP_DOC), [TIMBUNAN], elsewhere).status).toBe('RESOLVED');
  });

  it("THE AUDIT'S COUNTEREXAMPLE: admitting one generic \"Pasir\" no longer settles the other codes", () => {
    const admittedPasir = [sightingOf('cat-pasir', 'M10b', 'MATERIAL', AHSP_DOC)];
    const pasir = (rawCode: string) => ({
      rawName: 'Pasir',
      rawCode,
      rawUnit: 'M3',
      resourceType: 'MATERIAL',
      sourceSha256: AHSP_DOC,
    });
    // The five rows the admission was actually made from still resolve.
    expect(resolve(pasir('M10b'), [PASIR], admittedPasir).status).toBe('RESOLVED');
    // The other three codes the same document states stay questions.
    for (const code of ['M010', 'M01b', 'M10a']) {
      const verdict = resolve(pasir(code), [PASIR], admittedPasir);
      expect(verdict.status).toBe('NEEDS_REVIEW');
      expect(verdict.reasonCodes).toContain('SOURCE_CODE_DISAGREES_WITHIN_DOCUMENT');
    }
  });
});

describe('LAWFUL ADMISSION PATH — branch (c) after human examination', () => {
  const examined = (verdict: ResourceIdentityResolution, ids = verdict.candidates.map((c) => c.resourceCatalogId)) =>
    isAdmissibleAfterExamination(verdict, { refusedCandidateIds: ids, candidateContextDigest: digestOf(verdict) }, digestOf(verdict));

  it('(c) holds when EXACTLY the live name-similarity nominations were refused, under the live context', () => {
    expect(examined(resolve(TRIPLEKS, [PAKU_TRIPLEKS]))).toBe(true);
    expect(examined(resolve(CRANE, [SEWA_CRANE]))).toBe(true);
  });

  it('(c) holds when every listed row was ruled out by the machine (Pipa porous 6" vs a stated diameter 8)', () => {
    expect(examined(resolve(PIPA_6, [BESI_ANGKER_8]))).toBe(true);
  });

  it('(b) is not (c): refusing a SUBSET, or a remembered older set, is not an examination of the live search', () => {
    const KAWAT = row('cat-kawat', 'Kawat');
    const KAWAT_JARING = row('cat-kawat-jaring', 'Kawat jaring');
    const verdict = resolve({ rawName: 'Kawat Beton', rawCode: 'M14', rawUnit: 'Kg', resourceType: 'MATERIAL' }, [KAWAT, KAWAT_JARING]);
    expect(examined(verdict, [KAWAT.id])).toBe(false);
    expect(examined(verdict, [KAWAT.id, KAWAT_JARING.id, 'cat-gone'])).toBe(false);
    // A candidate that appeared after the screen loaded changes the context: (a) again.
    const stale = digestOf(resolve({ rawName: 'Kawat Beton', rawCode: 'M14', rawUnit: 'Kg', resourceType: 'MATERIAL' }, [KAWAT]));
    expect(
      isAdmissibleAfterExamination(verdict, { refusedCandidateIds: [KAWAT.id, KAWAT_JARING.id], candidateContextDigest: stale }, digestOf(verdict)),
    ).toBe(false);
  });

  it('a real possibility is never waved away: a recorded-fact or exact candidate blocks (c)', () => {
    expect(examined(resolve(STAMPER, [STEMPER], [sightingOf(STEMPER.id, 'E25', 'EQUIPMENT')]))).toBe(false);
    expect(examined(resolve(PORTLAND, [SEMEN_PORTLAN, SEMEN_TONASA], [sightingOf(SEMEN_PORTLAN.id, 'M.23')]))).toBe(false);
    const tie = resolve(TRIPLEKS, [row('a', 'Tripleks', 'MATERIAL', 'Lbr'), row('b', 'Tripleks', 'MATERIAL', 'M2')]);
    expect(examined(tie)).toBe(false);
  });

  it('no candidate at all is not this road — machine exhaustion alone governs it, unchanged', () => {
    const nothing = resolve(TRIPLEKS, []);
    expect(examined(nothing, [])).toBe(false);
    expect(ResourceAdmissionService.isIdentityExhausted(nothing)).toBe(true);
  });
});

describe('ResourceAdmissionService — examination is re-proved under the lock', () => {
  const provenance = {
    sourceSha256: 'A'.repeat(64),
    sourceFileName: 'AHSP BINA MARGA.xlsx',
    parserContractVersion: 'USI01_XLSX_V1',
    sheetName: 'Sheet1',
    sourceRowNumber: 40,
    sourceNameCellAddress: 'B40',
  };
  const build = (verdicts: ResourceIdentityResolution[]) => {
    const tx: any = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      resourceCatalog: { create: jest.fn().mockResolvedValue({ id: 'cat-tripleks-new' }) },
      resourceSourceIdentity: { create: jest.fn().mockResolvedValue({ id: 's' }) },
    };
    const identity: any = {
      loadEvidence: jest.fn().mockResolvedValue({}),
      resolve: jest.fn(),
    };
    for (const v of verdicts) identity.resolve.mockResolvedValueOnce(v);
    return { tx, service: new ResourceAdmissionService(identity) };
  };
  const input = (examination?: { refusedCandidateIds: string[]; candidateContextDigest: string }) => ({
    workspaceId: 'ws-1',
    rawName: 'Tripleks',
    rawCode: 'M130',
    rawUnit: 'Lbr',
    resourceType: 'MATERIAL' as const,
    baseUnit: 'LBR',
    provenance,
    ...(examination ? { examination } : {}),
  });

  it('mints ONE resource when the live nominations are exactly the refused ones', async () => {
    const verdict = resolve(TRIPLEKS, [PAKU_TRIPLEKS]);
    const { tx, service } = build([verdict]);
    await expect(
      service.admitObservedResource(tx, input({ refusedCandidateIds: [PAKU_TRIPLEKS.id], candidateContextDigest: digestOf(verdict) })),
    ).resolves.toEqual({ id: 'cat-tripleks-new' });
    expect(tx.resourceCatalog.create).toHaveBeenCalledTimes(1);
    expect(tx.resourceSourceIdentity.create).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('without an examination the machine-exhaustion law is unchanged: a candidate still refuses (Basic Price path)', async () => {
    const { tx, service } = build([resolve(TRIPLEKS, [PAKU_TRIPLEKS])]);
    await expect(service.admitObservedResource(tx, input())).rejects.toBeInstanceOf(ResourceAdmissionNotExhaustedError);
    expect(tx.resourceCatalog.create).not.toHaveBeenCalled();
  });

  it('a concurrent admission that already created it makes it an exact match under the lock: no duplicate', async () => {
    const stale = resolve(TRIPLEKS, [PAKU_TRIPLEKS]);
    const nowExact = resolve(TRIPLEKS, [PAKU_TRIPLEKS, row('cat-tripleks-new', 'Tripleks', 'MATERIAL', 'LBR')]);
    const { tx, service } = build([nowExact]);
    await expect(
      service.admitObservedResource(tx, input({ refusedCandidateIds: [PAKU_TRIPLEKS.id], candidateContextDigest: digestOf(stale) })),
    ).rejects.toBeInstanceOf(ResourceAdmissionNotExhaustedError);
    expect(tx.resourceCatalog.create).not.toHaveBeenCalled();
  });

  it('a recorded-fact candidate cannot be refused into a new resource', async () => {
    const verdict = resolve(STAMPER, [STEMPER], [sightingOf(STEMPER.id, 'E25', 'EQUIPMENT')]);
    const { tx, service } = build([verdict]);
    await expect(
      service.admitObservedResource(tx, { ...input({ refusedCandidateIds: [STEMPER.id], candidateContextDigest: digestOf(verdict) }), rawName: 'Stamper', resourceType: 'EQUIPMENT' as never }),
    ).rejects.toBeInstanceOf(ResourceAdmissionNotExhaustedError);
    expect(tx.resourceCatalog.create).not.toHaveBeenCalled();
  });
});

describe('ResourceObservationController — curate-new examination body', () => {
  const request = { user: { id: 'acct-owner' }, workspaceContext: { workspaceId: 'ws-1' } };
  const make = () => {
    const curateNew = jest.fn().mockResolvedValue({ ok: true });
    return { curateNew, controller: new ResourceObservationController({ curateNew } as never, {} as never) };
  };

  it('passes both halves of an examination, and nothing when there is none', async () => {
    const { curateNew, controller } = make();
    await controller.curateNew(request, 'obs-1', { unitDefinitionId: 'u', refusedCandidateIds: ['a'], candidateContextDigest: 'd' });
    expect(curateNew.mock.calls[0][0].examination).toEqual({ refusedCandidateIds: ['a'], candidateContextDigest: 'd' });
    await controller.curateNew(request, 'obs-1', { unitDefinitionId: 'u' });
    expect(curateNew.mock.calls[1][0].examination).toBeNull();
  });

  it.each([
    [{ refusedCandidateIds: ['a'] }, 'EXAMINATION_INCOMPLETE'],
    [{ candidateContextDigest: 'd' }, 'EXAMINATION_INCOMPLETE'],
    [{ refusedCandidateIds: [], candidateContextDigest: 'd' }, 'EXAMINATION_INVALID'],
    [{ refusedCandidateIds: 'a', candidateContextDigest: 'd' }, 'EXAMINATION_INVALID'],
    [{ refusedCandidateIds: [1], candidateContextDigest: 'd' }, 'EXAMINATION_INVALID'],
    [{ refusedCandidateIds: ['a'], candidateContextDigest: 7 }, 'EXAMINATION_INVALID'],
  ])('refuses a malformed examination %j before the service is reached', async (extra, code) => {
    const { curateNew, controller } = make();
    await expect(controller.curateNew(request, 'obs-1', { unitDefinitionId: 'u', ...extra } as never)).rejects.toThrow(code);
    expect(curateNew).not.toHaveBeenCalled();
  });
});

/**
 * P-2 — THE UNIT A HUMAN CHOOSES MUST BE PROVEN BY THE UNIT THE SOURCE STATED.
 *
 * `curateNew` asked the Unit Kernel resolve(code, code): the chosen canonical
 * unit against ITSELF. That is true of every catalogued unit, so it proved the
 * vocabulary and said nothing about the row — a human could admit
 * "Formworks [bh/M']" under any known canonical unit and the gate would pass.
 *
 * The law added here is the one the Basic Price admission already applies
 * through the SAME authority (assertSelectedUnitProvenBySourceUnit): can the
 * Unit Kernel get from the SOURCE's unit to the chosen one. Nothing is compared
 * or normalized locally — the kernel stays the one unit law.
 *
 * The two checks are LAYERED, not swapped. The self-proof still guards the
 * catalogue against an unprovable baseUnit; the source-proof guards this row.
 */
describe('P-2 — admission proves the chosen unit against the source unit', () => {
  const RESOLVED = (
    reasonCodes: string[] = ['EXACT_UNIT_IDENTITY'],
    priceOperation: string | null = UNIT_PRICE_OPERATION.IDENTITY,
    quantityFactor: string | null = '1',
  ) =>
    ({
      status: UNIT_RESOLUTION_STATUS.RESOLVED,
      reasonCodes,
      explanation: 'ok',
      policyVersion: 'UNIT_KERNEL_V1',
      priceOperation,
      quantityFactor,
    }) as unknown as UnitResolutionResult;
  const REFUSED = (reasonCodes: string[]) =>
    ({
      status: UNIT_RESOLUTION_STATUS.NEEDS_REVIEW,
      reasonCodes,
      explanation: 'refused',
      policyVersion: 'UNIT_KERNEL_V1',
    }) as unknown as UnitResolutionResult;

  const FORMWORKS_UNIT = "bh/M'";

  const observationRow = (over: Record<string, unknown> = {}) => ({
    id: 'obs-1',
    workspaceId: 'ws-1',
    status: 'OBSERVED',
    rawName: 'Formworks',
    rawCode: 'M195',
    rawUnit: FORMWORKS_UNIT,
    resourceType: 'MATERIAL',
    sourceSha256: 'A'.repeat(64),
    sourceFileName: 'AHSP BINA MARGA.xlsx',
    parserContractVersion: 'USI01_XLSX_V1',
    sheetName: 'Sheet1',
    sourceRowNumber: 40,
    sourceNameCellAddress: 'C40',
    sourceCodeCellAddress: 'D40',
    sourceUnitCellAddress: 'E40',
    ...over,
  });

  /**
   * Every prerequisite BUT the unit is satisfied: the observation is open, its
   * provenance is complete, the chosen definition is active, and the admission
   * authority is mocked to succeed. A refusal here can therefore only be the unit.
   */
  const build = (over: Record<string, unknown> = {}) => {
    const admit = jest.fn().mockResolvedValue({ id: 'cat-new' });
    const resolve = jest.fn();
    const tx: any = {
      observedResource: {
        findFirst: jest.fn().mockResolvedValue(observationRow(over)),
        update: jest.fn().mockResolvedValue({ id: 'obs-1', status: 'ADMITTED_NEW' }),
      },
      unitDefinition: {
        findFirst: jest.fn().mockResolvedValue({ id: 'unit-kg', code: 'KG' }),
      },
    };
    const prisma: any = { $transaction: (fn: any) => fn(tx) };
    const service = new ResourceObservationService(
      prisma,
      { admitObservedResource: admit } as never,
      { resolve } as never,
      {} as never,
      {} as never,
    );
    const call = () =>
      service.curateNew({
        workspaceId: 'ws-1',
        observationId: 'obs-1',
        unitDefinitionId: 'unit-kg',
        actorAccountId: 'acct-1',
      });
    return { admit, resolve, tx, call };
  };

  it('POSITIVE CONTROL — a source unit the kernel can reach still admits', async () => {
    const { resolve, admit, call } = build();
    resolve.mockResolvedValueOnce(RESOLVED()).mockResolvedValueOnce(RESOLVED());
    await expect(call()).resolves.toMatchObject({
      admittedResource: { id: 'cat-new' },
    });
    expect(admit).toHaveBeenCalledTimes(1);
    // The SECOND proof asks about the SOURCE's unit — not the chosen code twice.
    expect(resolve.mock.calls[1][0]).toBe(FORMWORKS_UNIT);
    expect(resolve.mock.calls[1][1]).toBe('KG');
  });

  it('a lawful ALIAS of the same measure is still a proof — the kernel decides, not a string compare', async () => {
    const { resolve, admit, call } = build({ rawUnit: 'm3' });
    resolve
      .mockResolvedValueOnce(RESOLVED())
      // Same canonical unit, spelled differently: IDENTITY, factor 1.
      .mockResolvedValueOnce(RESOLVED(['EXACT_UNIT_ALIAS_EQUIVALENCE']));
    await expect(call()).resolves.toMatchObject({
      admittedResource: { id: 'cat-new' },
    });
    expect(admit).toHaveBeenCalledTimes(1);
  });

  /**
   * RESOLVED is not the same fact as "the same unit". A conversion means the
   * measures are relatable BY A FACTOR, and admission is where a resource's
   * canonical measure is fixed for good — accepting one here would bake in an
   * equivalence whose arithmetic nobody performed. The Basic Price admission
   * refuses exactly this, under exactly this code.
   */
  it('a RESOLVED CONVERSION is refused at the mint — the factor nobody applied is not an identity', async () => {
    const { resolve, admit, tx, call } = build({ rawUnit: 'Zak' });
    resolve
      .mockResolvedValueOnce(RESOLVED())
      .mockResolvedValueOnce(
        RESOLVED(
          ['UNIQUE_EVIDENCE_BOUND_RULE'],
          'DIVIDE_SOURCE_UNIT_PRICE_BY_QUANTITY_FACTOR',
          '40',
        ),
      );
    await expect(call()).rejects.toMatchObject({
      response: {
        message: 'UNIT_SELECTION_REQUIRES_PRICE_CONVERSION',
        unitResolution: { quantityFactor: '40' },
      },
    });
    expect(admit).not.toHaveBeenCalled();
    expect(tx.observedResource.update).not.toHaveBeenCalled();
  });

  it('THE HOLE: a KNOWN canonical unit the source unit cannot reach is refused, and nothing is admitted', async () => {
    const { resolve, admit, tx, call } = build();
    // The chosen unit IS representable, so the old gate passed — this is exactly
    // the request that used to succeed.
    resolve
      .mockResolvedValueOnce(RESOLVED())
      .mockResolvedValueOnce(REFUSED(['CONVERSION_RULE_NOT_FOUND']));
    await expect(call()).rejects.toMatchObject({
      response: {
        message: 'UNIT_SELECTION_INCOMPATIBLE_WITH_SOURCE',
        unitResolution: { reasonCodes: ['CONVERSION_RULE_NOT_FOUND'] },
      },
    });
    // The refusal is the UNIT guard and no other: admission was never reached and
    // the observation was not written.
    expect(admit).not.toHaveBeenCalled();
    expect(tx.observedResource.update).not.toHaveBeenCalled();
  });

  it.each([
    ['UNKNOWN_UNIT_ALIAS'],
    ['CONTEXT_REQUIRED_UNIT_ALIAS'],
    ['FOREIGN_CONTEXT_UNIT_ALIAS'],
    ['AMBIGUOUS_UNIT_ALIAS'],
  ])('an unproven source unit (%s) is refused rather than assumed', async (reason) => {
    const { resolve, admit, call } = build({ rawUnit: 'Bh' });
    resolve.mockResolvedValueOnce(RESOLVED()).mockResolvedValueOnce(REFUSED([reason]));
    await expect(call()).rejects.toMatchObject({
      response: { message: 'UNIT_SELECTION_INCOMPATIBLE_WITH_SOURCE' },
    });
    expect(admit).not.toHaveBeenCalled();
  });

  it.each([[null], [''], ['   ']])(
    'a source that states NO unit (%p) is NO proof — refused without consulting the kernel',
    async (rawUnit) => {
      const { resolve, admit, call } = build({ rawUnit });
      resolve.mockResolvedValueOnce(RESOLVED());
      await expect(call()).rejects.toMatchObject({
        response: {
          message: 'UNIT_SELECTION_INCOMPATIBLE_WITH_SOURCE',
          unitResolution: { reasonCodes: ['UNIT_REQUIRED'] },
        },
      });
      // Asked ONCE (the self-proof) and never for the empty spelling, so safety
      // never depends on the catalogue happening to hold no blank alias.
      expect(resolve).toHaveBeenCalledTimes(1);
      expect(admit).not.toHaveBeenCalled();
    },
  );

  it('the older guard is KEPT, not replaced: an unrepresentable chosen unit still fails first', async () => {
    const { resolve, admit, call } = build();
    resolve.mockResolvedValueOnce(REFUSED(['UNKNOWN_UNIT_ALIAS']));
    await expect(call()).rejects.toThrow('UNIT_NOT_REPRESENTABLE_BY_UNIT_AUTHORITY');
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(admit).not.toHaveBeenCalled();
  });

  it('the refusal carries the source spelling verbatim — blank stays blank', async () => {
    const { resolve, call } = build({ rawUnit: '   ' });
    resolve.mockResolvedValueOnce(RESOLVED());
    await expect(call()).rejects.toMatchObject({
      response: {
        unitResolution: { rawSourceUnit: '   ', selectedUnitCode: 'KG' },
      },
    });
  });
});

/**
 * B-1 — THE BOUNDARIES AROUND THE DOCUMENT-CODE LAW.
 *
 * The law itself is proven above. These pin the seams a reviewer would otherwise
 * have to take on trust, and they mark — rather than hide — the one road the law
 * is NOT installed on.
 */
describe('B-1 — seams and the road still open', () => {
  const AHSP_DOC = 'A'.repeat(64);
  /** A settled canonical unit fact, in the Unit authority's own shape. */
  const unitFact = (rawUnit: string, unitDefinitionId: string) => ({
    rawUnit,
    status: 'RESOLVED' as const,
    unitDefinitionId,
    unitCode: rawUnit,
    reasonCode: 'EXACT_UNIT_IDENTITY',
    contextScoped: false,
    trustedContext: null,
    matchedAliasIds: [],
  });
  const TIMBUNAN = row('cat-timbunan-porus', 'Timbunan Porus', 'MATERIAL', 'M3');
  const line = (rawCode: string | null, sourceSha256?: string | null) => ({
    rawName: 'Timbunan Porus',
    rawCode,
    rawUnit: 'M3',
    resourceType: 'MATERIAL',
    sourceSha256,
  });

  it('a digest written in another case is the SAME document — the law cannot be switched off by spelling', () => {
    // The two sides are written by different writers; a hex digest means the same
    // document whatever case it carries.
    const lowerSighting = [
      sightingOf('cat-timbunan-porus', 'M44', 'MATERIAL', AHSP_DOC.toLowerCase()),
    ];
    const verdict = resolve(line('M144', AHSP_DOC.toUpperCase()), [TIMBUNAN], lowerSighting);
    expect(verdict.status).toBe('NEEDS_REVIEW');
    expect(verdict.reasonCodes).toContain('SOURCE_CODE_DISAGREES_WITHIN_DOCUMENT');
  });

  it('a sighting that records NO code cannot disagree with anything', () => {
    const noCode: SourceSightingEvidence = {
      ...sightingOf('cat-timbunan-porus', 'M44', 'MATERIAL', AHSP_DOC),
      rawCode: null,
    };
    expect(resolve(line('M144', AHSP_DOC), [TIMBUNAN], [noCode]).status).toBe('RESOLVED');
  });

  it('a sighting of a different CLASS is not this row’s code evidence', () => {
    const otherClass = sightingOf('cat-timbunan-porus', 'M44', 'EQUIPMENT', AHSP_DOC);
    expect(resolve(line('M144', AHSP_DOC), [TIMBUNAN], [otherClass]).status).toBe('RESOLVED');
  });

  /**
   * GAP A — THE SAME LAW ON THE SECOND AUTOMATIC ROAD.
   *
   * Level 1b is the RM-03D2 exact-name REPRESENTATION TIE: several same-name
   * rows told apart by the source's own canonical unit, which RM-02C1c
   * deliberately permits. The census shape "Pasir [M3], four codes" reaches it
   * as soon as a same-name row with a different baseUnit exists — so a conflict
   * held at Level 1 could walk straight through here.
   *
   * The rule is applied at the LAST moment, after the unit has narrowed the tie
   * to one surviving representation — the point at which Level 1b holds exactly
   * what Level 1 holds. Every tieRefused path above it is untouched, so a tie is
   * never turned into a refusal by this rule and the unit-context road keeps
   * deciding which representation was meant.
   */
  describe('Gap A — the tie road obeys the same document-code law', () => {
    const tieM3 = row('cat-pasir-m3', 'Pasir', 'MATERIAL', 'M3');
    const tieKg = row('cat-pasir-kg', 'Pasir', 'MATERIAL', 'KG');
    const tie = (
      rawCode: string | null,
      sightings: SourceSightingEvidence[],
      rawUnit = 'M3',
    ) =>
      resolveResourceIdentity({
        reference: {
          rawName: 'Pasir',
          rawCode,
          rawUnit,
          resourceType: 'MATERIAL',
          sourceSha256: AHSP_DOC,
        },
        catalogCandidates: [tieM3, tieKg],
        sourceSightings: sightings,
        reviewedMappings: [],
        canonicalUnitIdentities: [unitFact('M3', 'u-m3'), unitFact('KG', 'u-kg')],
      });
    /** The document recorded the M3 representation under M10b. */
    const seenAsM10b = [sightingOf('cat-pasir-m3', 'M10b', 'MATERIAL', AHSP_DOC)];

    it('THE BYPASS IS CLOSED: the unit picks the representation, but a differing document code withholds certainty', () => {
      const verdict = tie('M010', seenAsM10b);
      expect(verdict.status).toBe('NEEDS_REVIEW');
      expect(verdict.resolvedResourceCatalogId).toBeNull();
      expect(verdict.reasonCodes).toContain('SOURCE_CODE_DISAGREES_WITHIN_DOCUMENT');
      // The unit's own work is still stated — the tie was not simply refused.
      expect(verdict.explanation).toContain('M3');
      expect(verdict.explanation).toContain('M010');
    });

    it.each([['M01b'], ['M10a'], ['M010']])(
      'every other code the same document states for Pasir is withheld too (%s)',
      (code) => {
        expect(tie(code, seenAsM10b).reasonCodes).toContain(
          'SOURCE_CODE_DISAGREES_WITHIN_DOCUMENT',
        );
      },
    );

    it('POSITIVE CONTROL — RM-03D2 is intact: the same code still resolves through the unit context', () => {
      const verdict = tie('M10b', seenAsM10b);
      expect(verdict.status).toBe('RESOLVED');
      expect(verdict.authority).toBe('EXACT_CANONICAL_MATCH_WITH_UNIT_CONTEXT');
      expect(verdict.resolvedResourceCatalogId).toBe('cat-pasir-m3');
    });

    it('POSITIVE CONTROL — a source that states no code still resolves through the unit context', () => {
      expect(tie(null, seenAsM10b).status).toBe('RESOLVED');
    });

    it('POSITIVE CONTROL — with nothing recorded for the surviving row, the unit decides as before', () => {
      expect(tie('M010', []).status).toBe('RESOLVED');
    });

    it('a code recorded for the OTHER representation says nothing about the surviving one', () => {
      const seenOnKg = [sightingOf('cat-pasir-kg', 'M99', 'MATERIAL', AHSP_DOC)];
      expect(tie('M010', seenOnKg).status).toBe('RESOLVED');
    });

    it('ACROSS documents a code difference still says nothing — two workbooks number independently', () => {
      const otherDoc = [sightingOf('cat-pasir-m3', 'M10b', 'MATERIAL', 'B'.repeat(64))];
      expect(tie('M010', otherDoc).status).toBe('RESOLVED');
    });

    it('the tie REFUSALS are untouched: an unprovable source unit still refuses as a tie, not as a code conflict', () => {
      const verdict = resolveResourceIdentity({
        reference: {
          rawName: 'Pasir',
          rawCode: 'M010',
          rawUnit: 'Zak',
          resourceType: 'MATERIAL',
          sourceSha256: AHSP_DOC,
        },
        catalogCandidates: [tieM3, tieKg],
        sourceSightings: seenAsM10b,
        reviewedMappings: [],
        canonicalUnitIdentities: [unitFact('M3', 'u-m3'), unitFact('KG', 'u-kg')],
      });
      expect(verdict.authority).toBe('HUMAN_REVIEW_REQUIRED');
      expect(verdict.reasonCodes).toContain('MULTIPLE_CANDIDATES_NEEDS_REVIEW');
      expect(verdict.reasonCodes).not.toContain('SOURCE_CODE_DISAGREES_WITHIN_DOCUMENT');
      // A tie still asks a human to choose BETWEEN the representations.
      expect(isHumanDecidable(verdict)).toBe(true);
      expect(verdict.candidates).toHaveLength(2);
    });

    it('a withheld tie is a question, not a dead end — and it cannot mint a duplicate', () => {
      const verdict = tie('M010', seenAsM10b);
      // Confirmable: the row stays an EXACT_NAME candidate.
      expect(verdict.candidates[0]?.identityBasis).toBe('EXACT_NAME');
      expect(selectionRefusal(verdict, 'cat-pasir-m3')).toBeNull();
      // But "admit as new" stays shut: an EXACT_NAME candidate is never waved away.
      expect(
        isAdmissibleAfterExamination(
          verdict,
          {
            refusedCandidateIds: verdict.candidates.map((c) => c.resourceCatalogId),
            candidateContextDigest: digestOf(verdict),
          },
          digestOf(verdict),
        ),
      ).toBe(false);
      // And it is not silently teachable.
      expect(isSingleStrongCandidate(verdict)).toBe(false);
      expect(isIdenticalQuestionDecidable(verdict)).toBe(false);
    });

    it('the canonical-ID channel is untouched by this law', () => {
      const verdict = resolveResourceIdentity({
        reference: {
          rawName: 'ignored-by-the-id-channel',
          rawCode: 'M010',
          rawUnit: 'M3',
          resourceType: 'MATERIAL',
          sourceSha256: AHSP_DOC,
          resourceCatalogId: 'cat-pasir-m3',
        },
        catalogCandidates: [tieM3, tieKg],
        sourceSightings: seenAsM10b,
        reviewedMappings: [],
        canonicalUnitIdentities: [unitFact('M3', 'u-m3'), unitFact('KG', 'u-kg')],
      });
      expect(verdict.status).toBe('RESOLVED');
      expect(verdict.reasonCodes).toContain('RESOURCE_CATALOG_ID_ACTIVE_AND_SCOPED');
      expect(verdict.reasonCodes).not.toContain('SOURCE_CODE_DISAGREES_WITHIN_DOCUMENT');
    });

    it('the document digest and the candidate-context digest stay different fields', () => {
      // Same candidate set, so the candidate-context digest is equal on both…
      const sameDoc = tie('M010', seenAsM10b);
      const crossDoc = tie('M010', [
        sightingOf('cat-pasir-m3', 'M10b', 'MATERIAL', 'B'.repeat(64)),
      ]);
      // …yet the document digest changed the verdict. One is not the other.
      expect(sameDoc.status).toBe('NEEDS_REVIEW');
      expect(crossDoc.status).toBe('RESOLVED');
    });
  });
});

/**
 * B-1 — ADMISSION RE-PROVES THE QUESTION THE QUEUE ASKED.
 *
 * The admission authority re-resolves under its advisory lock. It must be handed
 * the SAME facts the queue was, digest included — otherwise the two computations
 * agree only while the document-code law happens to be one-directional, and the
 * file's own claim ("the re-proof sees it as a real candidate and refuses")
 * would be a coincidence rather than an invariant.
 */
describe('B-1 — the admission re-proof is asked the same question', () => {
  it('carries the source digest into the under-lock re-resolution', async () => {
    const tx: any = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      resourceCatalog: { create: jest.fn().mockResolvedValue({ id: 'cat-new' }) },
      resourceSourceIdentity: { create: jest.fn().mockResolvedValue({ id: 's' }) },
    };
    const identity: any = {
      loadEvidence: jest.fn().mockResolvedValue({}),
      resolve: jest.fn().mockResolvedValue({
        status: 'UNRESOLVED',
        authority: null,
        resolvedResourceCatalogId: null,
        candidates: [],
        reasonCodes: ['RESOURCE_NOT_FOUND'],
        explanation: '',
      }),
    };
    const service = new ResourceAdmissionService(identity);
    await service.admitObservedResource(tx, {
      workspaceId: 'ws-1',
      rawName: 'Timbunan Porus',
      rawCode: 'M144',
      rawUnit: 'M3',
      resourceType: 'MATERIAL' as never,
      baseUnit: 'M3',
      provenance: {
        sourceSha256: 'A'.repeat(64),
        sourceFileName: 'AHSP BINA MARGA.xlsx',
        parserContractVersion: 'USI01_XLSX_V1',
        sheetName: 'Sheet1',
        sourceRowNumber: 41,
        sourceNameCellAddress: 'C41',
      },
    });
    expect(identity.resolve.mock.calls[0][1]).toMatchObject({
      rawName: 'Timbunan Porus',
      rawCode: 'M144',
      sourceSha256: 'A'.repeat(64),
    });
  });
});

/**
 * GAP C2 — THE JOIN REACHES A CONSUMER.
 *
 * The reader is proved in ahsp-import-work-context.spec.ts. This proves the
 * other half the mandate asks for: that its result is actually consumed, at the
 * edge, WITHOUT teaching the shared observed-resource lifecycle about AHSP.
 */
describe('ResourceObservationController — the curation list carries its work context', () => {
  const WORKSPACE = 'ws-1';
  const request = {
    workspaceContext: { workspaceId: WORKSPACE },
    user: { id: 'acct-1' },
  };
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'obs-1',
    rawName: 'Timbunan Porus',
    rawCode: 'M144',
    rawUnit: 'M3',
    resourceType: 'MATERIAL',
    origin: 'AHSP_IMPORT',
    status: 'OBSERVED',
    sourceSha256: 'A'.repeat(64),
    parserContractVersion: 'USI01_XLSX_V1',
    sheetName: 'Sheet1',
    sourceRowNumber: 41,
    candidates: [],
    ...over,
  });

  const build = (rows: unknown[], context: Map<string, unknown>) => {
    const listOpenForCuration = jest.fn().mockResolvedValue(rows);
    const workContextForSourceRows = jest.fn().mockResolvedValue(context);
    const controller = new ResourceObservationController(
      { listOpenForCuration } as never,
      {} as never,
      { workContextForSourceRows } as never,
    );
    return { controller, listOpenForCuration, workContextForSourceRows };
  };

  it('attaches the work item that quoted each row', async () => {
    const found = {
      kind: 'FOUND',
      importJobId: 'job-1',
      lineNumber: 7,
      workType: 'Timbunan pilihan',
      methodName: 'Manual',
      sheetName: 'Sheet1',
    };
    const { controller } = build(
      [row()],
      new Map([[ahspSourceRowKey(row() as never), found]]),
    );
    const listed = (await controller.list(request)) as Array<Record<string, unknown>>;
    expect(listed[0].workContext).toEqual(found);
    // The row itself is untouched — this is additive.
    expect(listed[0].rawName).toBe('Timbunan Porus');
  });

  it('a row whose document left no journal is ABSENT, not silently dropped', async () => {
    const { controller } = build([row()], new Map());
    const listed = (await controller.list(request)) as Array<Record<string, unknown>>;
    expect(listed[0].workContext).toEqual({ kind: 'ABSENT' });
    expect(listed).toHaveLength(1);
  });

  it('the journal is asked in the SAME workspace the guard verified, and only for rows that exist', async () => {
    const { controller, workContextForSourceRows } = build([row()], new Map());
    await controller.list(request);
    expect(workContextForSourceRows).toHaveBeenCalledWith(WORKSPACE, [row()]);
  });

  it('an empty list asks the journal nothing at all', async () => {
    const { controller, workContextForSourceRows } = build([], new Map());
    await expect(controller.list(request)).resolves.toEqual([]);
    expect(workContextForSourceRows).not.toHaveBeenCalled();
  });
});
