import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ObservedResourceStatus, Prisma, ResourceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UnitKernelService } from '../unit-kernel/unit-kernel.service';
import {
  UNIT_KERNEL_POLICY_VERSION,
  UNIT_PRICE_OPERATION,
  UNIT_RESOLUTION_STATUS,
  trustedUnitContext,
} from '../unit-kernel/unit-kernel.contracts';
import {
  AdmitObservedResourceInput,
  ResourceAdmissionNotExhaustedError,
  ResourceAdmissionProvenanceIncompleteError,
  ResourceAdmissionService,
  ResourceProvenanceAlreadyBoundError,
  resourceAdmissionLockKey,
} from './resource-admission.service';
import {
  IdenticalQuestionLatestEvent,
  ResourceIdentityResolutionService,
} from './resource-identity-resolution.service';
import {
  RawResourceReference,
  ResourceIdentityResolution,
  SelectionRefusal,
  isAdmissibleAfterExamination,
  isConfirmableCandidate,
  isIdenticalQuestionDecidable,
  selectionRefusal,
} from './resource-identity-resolution.kernel';
import { candidateContextDigest } from './ghx-candidate-context';
import {
  GhxDecisionContextConfigurationError,
  GhxDecisionContextTokenService,
} from './ghx-decision-context-token.service';
import {
  IQL01_IDENTICAL_QUESTION_POLICY_VERSION,
  IdenticalQuestion,
  identicalQuestionKey,
} from './identical-question-key';
import {
  GovernancePlan,
  IdenticalQuestionAction,
  IdenticalQuestionEvent,
  IdenticalQuestionState,
  identicalQuestionState,
  isAnswerApplicable,
  planApprove,
  planReject,
  planRevoke,
  planSupersede,
  planTeach,
} from './identical-question-governance';

/**
 * IQL-01 — the lock that serializes governance of ONE exact question. The same
 * FNV-1a helper and the same two-int advisory-lock form as resource admission,
 * under its own namespace so the two never contend.
 */
const IQL01_LOCK_NAMESPACE = resourceAdmissionLockKey(
  'IQL01_EXACT_QUESTION_GOVERNANCE',
);

/** The subject/generation unique index, by name — the concurrency backstop. */
const QUESTION_GENERATION_CONSTRAINT =
  'resource_identity_question_decisions_workspaceId_questionKe_key';

/** Bounded retry for a serialization failure or a lost generation race. Never a spin. */
const QUESTION_RETRY_LIMIT = 1;

const QUESTION_KEY_SHAPE = /^[0-9a-f]{64}$/;

/** The reader-facing state of an exact question. Account ids never leave the server. */
export type IdenticalQuestionStateLabel =
  | 'NONE'
  | 'PENDING'
  | 'EFFECTIVE'
  | 'INAPPLICABLE'
  | 'REJECTED'
  | 'REVOKED';

/** Why an open row's decision may not also be offered as learning — one per refusal branch. */
export type NotRememberableReason =
  | 'NO_ACTOR'
  | 'CANDIDATE_PENDING'
  | 'IDENTITY_PROVEN'
  | 'NOT_DECIDABLE'
  | 'LEARNING_NOT_CONFIGURED';

/** The two ways the identity kernel's own verdict refuses a chosen catalogue row. */
export type KernelIdentityRefusal =
  | 'IDENTITY_CANDIDATE_RULED_OUT'
  | 'IDENTITY_PROVEN_OTHERWISE';

/**
 * ACG-01.1 — A KERNEL REFUSAL IS NOT BYPASSED AT THE WRITE.
 *
 * CANDIDATE REFUSED IS NOT RESOURCE REFUSED. This judges the CHOSEN ROW, never
 * the source resource: whatever it answers, the observation stays accepted.
 *
 * Two answer shapes mean the machine REFUSED the chosen row, and both are read
 * from its OWN answer — nothing is re-derived or re-scored here:
 *  - UNRESOLVED with that row listed: the row was RULED OUT (a stated
 *    specification conflict, a class mismatch). The kernel lists such rows so a
 *    person can see what was examined — "these were ruled out", never "choose
 *    one of these".
 *  - RESOLVED on another row: the machine proved ONE identity, and a proven
 *    identity is never reconsidered; any other row contradicts it.
 *
 * WHICH ANSWER IS ASKED MATTERS, AND ONE ANSWER IS NOT ENOUGH. The kernel lists
 * the rows it ruled out only when nothing else survived: as soon as any other
 * row is nominated, the answer is NEEDS_REVIEW listing the survivors and the
 * refused row is simply absent from it. Read against that answer alone, a row
 * the kernel ruled out would pass this door whenever an unrelated sibling row
 * happened to be nominated — eligibility of the chosen row would depend on
 * which OTHER rows the catalogue holds. So the caller asks the SAME machinery a
 * second question — this wording against the CHOSEN ROW ALONE — and applies
 * this same predicate to that answer too (see refusalOfSelection).
 *
 * SCOPE, SINCE THE WRITE-ELIGIBILITY LAW: this predicate now answers ONLY the
 * second, chosen-row-alone question. The whole-catalogue answer is judged by the
 * kernel's `selectionRefusal`, which additionally refuses a row nominated on name
 * similarity only and a row the machine never nominated — a human confirming a
 * guess, or a row with no evidence at all, is not an identity.
 */
export function kernelRefusalOfSelection(
  verdict: Pick<
    ResourceIdentityResolution,
    'status' | 'resolvedResourceCatalogId' | 'candidates'
  >,
  selectedResourceCatalogId: string,
): KernelIdentityRefusal | null {
  if (verdict.status === 'RESOLVED') {
    return verdict.resolvedResourceCatalogId === selectedResourceCatalogId
      ? null
      : 'IDENTITY_PROVEN_OTHERWISE';
  }
  if (
    verdict.status === 'UNRESOLVED' &&
    verdict.candidates.some(
      (candidate) => candidate.resourceCatalogId === selectedResourceCatalogId,
    )
  ) {
    return 'IDENTITY_CANDIDATE_RULED_OUT';
  }
  return null;
}

function isRetryableQuestionWrite(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === '40001' || error.code === 'P2034') return true;
  if (error.code !== 'P2002') return false;
  // ONLY the exact subject/generation race is retried; any other unique
  // violation is a different defect and surfaces as itself.
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  const named = Array.isArray(target)
    ? target.join(',')
    : typeof target === 'string'
      ? target
      : '';
  return (
    named.includes(QUESTION_GENERATION_CONSTRAINT) ||
    (named.includes('workspaceId') &&
      named.includes('questionKey') &&
      named.includes('generation'))
  );
}

/** A ledger row (or preloaded event) as the pure governance law reads it. */
function asQuestionEvent(row: {
  id: string;
  generation: number;
  action: string;
  selectedResourceCatalogId: string | null;
  candidateContextDigest: string | null;
  resolutionPolicyVersion: string | null;
  decidedByAccountId: string;
}): IdenticalQuestionEvent {
  return {
    id: row.id,
    generation: row.generation,
    action: row.action as IdenticalQuestionAction,
    selectedResourceCatalogId: row.selectedResourceCatalogId,
    candidateContextDigest: row.candidateContextDigest,
    resolutionPolicyVersion: row.resolutionPolicyVersion,
    decidedByAccountId: row.decidedByAccountId,
  };
}

/** The digest of the machine's own candidate set — the existing GHX shape, unchanged. */
function candidateDigestOf(verdict: ResourceIdentityResolution): string {
  return candidateContextDigest(
    verdict.candidates.map((candidate) => ({
      resourceCatalogId: candidate.resourceCatalogId,
      name: candidate.name,
      type: candidate.type,
      baseUnit: candidate.baseUnit,
      specifications: candidate.specifications,
    })),
  );
}

const LIVE_POLICY = IQL01_IDENTICAL_QUESTION_POLICY_VERSION;

/** The state a question is in right after a governance act of this kind. */
const LABEL_AFTER: Record<
  IdenticalQuestionAction,
  IdenticalQuestionStateLabel
> = {
  TEACH: 'PENDING',
  APPROVE: 'EFFECTIVE',
  REJECT: 'REJECTED',
  SUPERSEDE: 'PENDING',
  REVOKE: 'REVOKED',
};

/**
 * THE shared, domain-neutral lifecycle for a resource an import SAW but could
 * not yet prove: OBSERVED → (human) → RESOLVED_EXISTING | ADMITTED_NEW.
 *
 * AHSP, Basic Price and BOQ all persist observations through `observeMany` and
 * curate through the same two commands here. Nothing is auto-promoted: a
 * candidate stays a candidate until a human decides, and a genuinely-new
 * resource is minted only through the ONE admission authority
 * (ResourceAdmissionService), which writes ResourceCatalog + ResourceSourceIdentity.
 * `origin` is a provenance tag, never a behavioural branch.
 */

export interface ObserveResourceProvenance {
  sourceSha256?: string | null;
  sourceFileName?: string | null;
  parserContractVersion?: string | null;
  sheetName?: string | null;
  sourceRowNumber?: number | null;
  sourceNameCellAddress?: string | null;
  sourceCodeCellAddress?: string | null;
  sourceUnitCellAddress?: string | null;
}

export interface ObserveResourceInput {
  workspaceId: string;
  origin: string;
  rawName: string;
  rawCode?: string | null;
  rawUnit?: string | null;
  resourceType: ResourceType;
  candidates?: readonly string[];
  provenance?: ObserveResourceProvenance;
}

/**
 * THE LOCATOR BOTH SIDES ALREADY CARRY — the six facts `observed_resources` is
 * unique on. Used to ask "has a human already decided THIS source row?" without
 * inventing any new identity: it is the row's own place in its own document.
 */
/**
 * F1 — IS THIS CANDIDATE STANDING ONLY ON SIGHTINGS?
 *
 * An exact catalogue-name match carries no evidence list at all and is never
 * "sighting only". Among the recorded facts a nomination can rest on, a source
 * SIGHTING is the one the kernel itself refuses to let assert anything — so a
 * nomination whose recorded facts are all sightings is strong enough for a
 * person to look at, and not strong enough to replay a decision unattended.
 */
export function sightingOnlyNomination(candidate: {
  identityBasis?: string | null;
  evidence?: ReadonlyArray<string> | null;
}): boolean {
  if (candidate.identityBasis === 'EXACT_NAME') return false;
  const recorded = (candidate.evidence ?? []).filter((kind) =>
    [
      'SOURCE_CODE_MATCH',
      'SOURCE_SIGHTING_NAME_MATCH',
      'REVIEWED_MAPPING_CODE_MATCH',
      'REVIEWED_MAPPING_NAME_MATCH',
    ].includes(kind),
  );
  return (
    recorded.length > 0 &&
    recorded.every((kind) => kind === 'SOURCE_SIGHTING_NAME_MATCH')
  );
}

export function observedSourceRowKey(row: {
  sourceSha256: string | null;
  sheetName: string | null;
  sourceRowNumber: number | null;
  rawName: string;
  resourceType: string;
}): string {
  return JSON.stringify([
    (row.sourceSha256 ?? '').toLowerCase(),
    row.sheetName ?? '',
    row.sourceRowNumber ?? -1,
    row.rawName,
    row.resourceType,
  ]);
}

@Injectable()
export class ResourceObservationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admission: ResourceAdmissionService,
    private readonly unitKernel: UnitKernelService,
    private readonly identity: ResourceIdentityResolutionService,
    /** IQL-01 — the existing signed decision-context machinery, second purpose. */
    private readonly tokens: GhxDecisionContextTokenService,
  ) {}

  /**
   * Persist observations, additively and idempotently. A resource with no name
   * cannot be searched for, so it is never observed. Re-importing the same
   * located source row does not duplicate (unique on workspace + provenance +
   * name + type); a hand-built row with null provenance always inserts, which is
   * the honest behaviour. Never touches a resource that already resolved.
   */
  async observeMany(
    inputs: readonly ObserveResourceInput[],
  ): Promise<{ persisted: number }> {
    const rows = inputs
      .filter((input) => input.rawName.trim().length > 0)
      .map((input) => ({
        workspaceId: input.workspaceId,
        origin: input.origin,
        rawName: input.rawName,
        rawCode: input.rawCode ?? null,
        rawUnit: input.rawUnit ?? null,
        resourceType: input.resourceType,
        sourceSha256: input.provenance?.sourceSha256 ?? null,
        sourceFileName: input.provenance?.sourceFileName ?? null,
        parserContractVersion: input.provenance?.parserContractVersion ?? null,
        sheetName: input.provenance?.sheetName ?? null,
        sourceRowNumber: input.provenance?.sourceRowNumber ?? null,
        sourceCodeCellAddress: input.provenance?.sourceCodeCellAddress ?? null,
        sourceNameCellAddress: input.provenance?.sourceNameCellAddress ?? null,
        sourceUnitCellAddress: input.provenance?.sourceUnitCellAddress ?? null,
        candidatesJson:
          input.candidates && input.candidates.length > 0
            ? [...new Set(input.candidates)]
            : Prisma.JsonNull,
      }));
    if (rows.length === 0) return { persisted: 0 };
    const result = await this.prisma.observedResource.createMany({
      data: rows,
      skipDuplicates: true,
    });
    return { persisted: result.count };
  }

  /** The observations still awaiting a human decision, newest first. */
  async listOpen(workspaceId: string) {
    return this.prisma.observedResource.findMany({
      where: { workspaceId, status: ObservedResourceStatus.OBSERVED },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * The open observations, each enriched for a human curator with what the
   * shared authorities say RIGHT NOW: the live identity candidates (name +
   * catalog id, so "this is an existing resource" can carry the id the mint
   * safety needs) and the unit the Unit Kernel can currently prove for the
   * observed spelling (so "genuinely new" can name a canonical unit).
   *
   * This is a READ. It resolves through the ONE identity kernel and the ONE
   * Unit Kernel — never a second matcher — and it changes nothing: candidates
   * are suggestions, not identity, and no catalog is written here. Evidence is
   * loaded ONCE for the workspace and every observation resolved against it.
   *
   * A row whose identity the machine PROVES today is not a question any more,
   * so it is not listed: an exact catalogue match, a representation tie settled
   * by the source's own unit, or (IQL-01) an APPROVED, still-applicable
   * exact-question answer. Nothing is written — OBSERVED means "seen", and the
   * decision columns stay reserved for a human decision — so a REVOKE, a retired
   * catalogue row or a changed candidate context brings it straight back. Every
   * other row carries the state of its exact question, and — only for a known
   * actor — the signed context that lets the human offer this decision as a
   * learning candidate.
   */
  async listOpenForCuration(workspaceId: string, actorAccountId?: string) {
    const observations = await this.listOpen(workspaceId);
    if (observations.length === 0) return [];
    const questionKeys = new Map(
      observations.map((observation) => [
        observation.id,
        identicalQuestionKey(this.questionOf(observation)),
      ]),
    );
    const evidence = await this.identity.loadEvidence(
      this.prisma,
      workspaceId,
      undefined,
      { identicalQuestionKeys: [...new Set(questionKeys.values())] },
    );
    const rows = await Promise.all(
      observations.map(async (observation) => {
        const resolution = await this.identity.resolve(
          evidence,
          this.referenceOf(observation),
        );
        // IMPORT-SEAM-06 — MACHINE WORK IS NOT RETURNED TO THE HUMAN. Asking a
        // person to "confirm" an identity the kernel already proved is the
        // machine's own repetition handed back as labour; once one admission
        // makes every identical observation provable, the rest leave the list.
        if (this.machineProves(resolution)) {
          return null;
        }
        const questionKey = questionKeys.get(observation.id) as string;
        const identicalQuestion = this.describeOpenQuestion({
          workspaceId,
          questionKey,
          resolution,
          latest: evidence.identicalQuestionDecisions?.get(questionKey) ?? null,
          actorAccountId,
        });
        // ACG-01 CLOSURE 4 — WHY, NOT JUST WHICH.
        //
        // The identity kernel already describes every candidate it nominates:
        // the class it holds, the unit it is measured in, the code SIMPROK has
        // seen for it, WHICH evidence nominated it, and which of its own claims
        // the source never stated. Two of those nine facts used to reach the
        // curator, so a row nominated only because it shares one five-letter
        // token with the source name ("Tanah Biasa" / "Klem biasa") arrived
        // looking exactly like a row a human had already bound to that code.
        //
        // Nothing is recomputed and nothing is re-ranked here: this is the
        // kernel's own description, carried instead of discarded. The decision
        // about what is strong enough to act on is made from these facts in the
        // reader's own view-model, never by inventing a score in this seam.
        //
        // `identityBasis` / `confirmable` are the kernel's OWN statement of what
        // each nomination rests on, so the screen projects eligibility instead of
        // keeping a second opinion about which evidence is strong enough.
        const candidates = resolution.candidates.map((candidate) => ({
          resourceCatalogId: candidate.resourceCatalogId,
          name: candidate.name,
          code: candidate.code,
          type: candidate.type,
          baseUnit: candidate.baseUnit,
          evidence: candidate.evidence,
          identityBasis: candidate.identityBasis,
          confirmable:
            resolution.status !== 'UNRESOLVED' &&
            isConfirmableCandidate(candidate),
          specificationUnproved: candidate.specificationUnproved,
          unprovedSpecificationFacts: candidate.unprovedSpecificationFacts,
        }));
        const candidateContextDigest = candidateDigestOf(resolution);
        let suggestedUnitDefinitionId: string | null = null;
        if (observation.rawUnit) {
          // THE CLASS IS ALREADY ON THE ROW, so ask the kernel the whole
          // question. Without it, a spelling whose every meaning is
          // context-scoped — "jam", catalogued as PERSON_HOUR under LABOR and
          // EQUIPMENT_HOUR under EQUIPMENT — has no eligible alias at all and
          // comes back ambiguous. The kernel was right to refuse: it was asked
          // "what is an hour?" when the caller already knew whose hour it was.
          //
          // This suggestion is a SUGGESTION. It never admits a resource and
          // never asserts identity; it only stops the curation screen
          // dead-ending on rows the kernel could always have answered.
          const unit = await this.unitKernel.resolve(
            observation.rawUnit,
            observation.rawUnit,
            undefined,
            trustedUnitContext(observation.resourceType),
          );
          if (
            unit.status === UNIT_RESOLUTION_STATUS.RESOLVED &&
            unit.sourceUnitDefinition
          ) {
            suggestedUnitDefinitionId = unit.sourceUnitDefinition.id;
          }
        }
        // ACG-01 OWNER BROWSER GAP — THE VERDICT, NOT ONLY ITS LIST.
        //
        // A candidate list means "these were nominated" under NEEDS_REVIEW and
        // "these were ruled out" under UNRESOLVED (a stated specification
        // conflict, a class mismatch). Without the verdict the reader could not
        // tell the two apart, so a row the kernel had RULED OUT was offered as
        // "Benar, ini sama dengan…". And "genuinely new" is admitted only when
        // identity is exhausted — the SAME predicate curateNew re-proves below —
        // so without it every row that still had a candidate offered a door that
        // could only be refused. Carried, never recomputed: nothing here decides.
        return {
          id: observation.id,
          rawName: observation.rawName,
          rawCode: observation.rawCode,
          rawUnit: observation.rawUnit,
          resourceType: observation.resourceType,
          origin: observation.origin,
          status: observation.status,
          // The locator this row already carries, carried on. Provenance is not
          // one domain's idea — every origin records where a row was read from —
          // so naming it here keeps this lifecycle domain-neutral while letting
          // a caller that DOES know its own documents join back to them.
          sourceSha256: observation.sourceSha256,
          parserContractVersion: observation.parserContractVersion,
          sheetName: observation.sheetName,
          sourceRowNumber: observation.sourceRowNumber,
          candidates,
          identityVerdict: {
            status: resolution.status,
            reasonCodes: [...resolution.reasonCodes],
            exhausted: ResourceAdmissionService.isIdentityExhausted(resolution),
            // Branch (c) — "genuinely new" becomes lawful once a person refuses
            // EXACTLY these nominations, all of which rest on name similarity or
            // were ruled out by the machine. Carried, never recomputed: the same
            // kernel predicate is re-proved under the admission lock.
            admissibleAfterExamination: isAdmissibleAfterExamination(
              resolution,
              {
                refusedCandidateIds: resolution.candidates.map(
                  (candidate) => candidate.resourceCatalogId,
                ),
                candidateContextDigest,
              },
              candidateContextDigest,
            ),
            candidateContextDigest,
          },
          suggestedUnitDefinitionId,
          identicalQuestion,
        };
      }),
    );
    return rows.filter((row): row is NonNullable<typeof row> => row !== null);
  }

  /** IMPORT-SEAM-06 — the one definition of "no longer a question": the kernel proves it today. */
  private machineProves(resolution: ResourceIdentityResolution): boolean {
    return resolution.status === 'RESOLVED';
  }

  /**
   * AHSP COMPLETION — which exact questions each document's observations still
   * ask, for the import completion view.
   *
   * The SAME projection the curation queue applies above — an observation the
   * kernel proves today is not a question — asked ONCE per exact question rather
   * than once per row: the kernel is asked about the question (name, code, unit,
   * class), never about the row, so every row of one question has one answer.
   * A read. Nothing is decided, and no candidate, catalogue id or decision token
   * leaves this method: only which questions are open, and how often each
   * document asks them.
   */
  async openQuestionsBySource(
    workspaceId: string,
    sourceSha256s: readonly string[],
  ): Promise<Map<string, { keys: Set<string>; uses: number }>> {
    const bySource = new Map<string, { keys: Set<string>; uses: number }>();
    if (sourceSha256s.length === 0) return bySource;
    const rows = await this.prisma.observedResource.findMany({
      where: {
        workspaceId,
        status: ObservedResourceStatus.OBSERVED,
        sourceSha256: { in: [...sourceSha256s] },
      },
      select: {
        workspaceId: true,
        sourceSha256: true,
        rawName: true,
        rawCode: true,
        rawUnit: true,
        resourceType: true,
      },
    });
    if (rows.length === 0) return bySource;
    /**
     * THE GOVERNANCE KEY — which exact question this is. It is what a stored
     * answer is filed under, and what the caller counts as "distinct questions".
     * Unchanged, and deliberately so: nothing here alters what an IQL answer
     * means or which question it may be reused for.
     */
    const questionKeyOf = (row: (typeof rows)[number]) =>
      identicalQuestionKey(this.questionOf(row));
    /**
     * THE EVALUATION KEY — which distinct QUESTION-AND-DOCUMENT the kernel is
     * being asked about. A different thing from the governance key, and it has
     * to be.
     *
     * The kernel's answer is no longer a function of the exact-question tuple
     * alone: `referenceOf` carries the document digest, and the document-code
     * law reads it — the same wording and code can be settled in one document
     * and withheld in another, because only one of them records that catalogue
     * row under a different code of its own. Memoizing that answer under the
     * five-field question key alone was unsound: one document's row won the map
     * and its verdict was then attributed to every document asking the same
     * wording, so the result depended on the order the rows arrived in.
     *
     * The key therefore carries the question AND the digest — the complete input
     * `referenceOf` builds. An absent digest is its own group, which is right:
     * a row that cannot name its document has nothing to disagree with, and it
     * is attributed to no document below either.
     */
    const evaluationKeyOf = (row: (typeof rows)[number]) =>
      JSON.stringify([questionKeyOf(row), row.sourceSha256 ?? '']);

    const evaluations = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const key = evaluationKeyOf(row);
      if (!evaluations.has(key)) evaluations.set(key, row);
    }
    const evidence = await this.identity.loadEvidence(
      this.prisma,
      workspaceId,
      undefined,
      // The IQL preload still asks by GOVERNANCE key: a stored answer belongs to
      // a question, not to a document.
      { identicalQuestionKeys: [...new Set(rows.map(questionKeyOf))] },
    );
    const open = new Set<string>();
    for (const [key, row] of evaluations) {
      const resolution = await this.identity.resolve(
        evidence,
        this.referenceOf(row),
      );
      if (!this.machineProves(resolution)) open.add(key);
    }
    for (const row of rows) {
      if (!row.sourceSha256) continue;
      if (!open.has(evaluationKeyOf(row))) continue;
      const entry = bySource.get(row.sourceSha256) ?? {
        keys: new Set<string>(),
        uses: 0,
      };
      // Counted as the QUESTION it is — so "3 questions" still means three
      // distinct questions, not three question-document pairs.
      entry.keys.add(questionKeyOf(row));
      entry.uses += 1;
      bySource.set(row.sourceSha256, entry);
    }
    return bySource;
  }

  /**
   * F1 — THE DECISIONS A HUMAN ALREADY MADE ABOUT THESE EXACT SOURCE ROWS.
   *
   * A confirmation was lawful, was written, and then nothing could ever read it:
   * `resolvedResourceCatalogId` was a write-only column, so re-reading the same
   * document asked the same question again and got the same refusal. The person
   * had answered; SIMPROK had not listened.
   *
   * This is the listening, and it is deliberately NARROW. It answers only about
   * the SAME source row — the six facts `observed_resources` is unique on — so a
   * decision never travels to another document, another wording, or another
   * occurrence. It is not a memory and not a generalisation: it is the same
   * question, asked again, about the same row.
   *
   * EVERY DECISION IS RE-PROVED UNDER TODAY'S LAW before it is handed back.
   * observed_resources records no policy version and no candidate context, so a
   * row cannot say which law it was decided under — and rows decided under the
   * older law could be confirmed on a name alone. Rather than trust a timestamp,
   * the chosen row is put back through the SAME write-eligibility predicate
   * `curateExisting` applies at the moment of writing: if today's law would
   * still let a person confirm it, the decision stands; if it would refuse it —
   * a name-similarity nomination, a row the machine no longer nominates, a row
   * that is gone — the decision is simply not handed back. Nothing is revived by
   * this wiring that today's law would not accept on its own.
   *
   * TWO THINGS THAT LOOK LIKE RE-PROVING AND ARE NOT, BOTH REFUSED HERE:
   *
   *   A NEW SIGHTING MAY NOT VALIDATE AN OLD DECISION. Today's law lets a person
   *   confirm a candidate nominated by a recorded fact, and a source sighting is
   *   a recorded fact — so a decision made when the evidence was thin becomes
   *   replayable the moment some LATER import sights the same spelling, with
   *   nobody having looked again. The kernel's own contract is that a sighting
   *   "can nominate a candidate, it can never assert one". Confirming on a
   *   sighting is lawful for a PERSON, who sees it; it is not lawful as the
   *   thing that revives a decision nobody re-examined. So a replay whose chosen
   *   row is held up by sightings alone is withheld, and the question is asked.
   *
   *   THE SAME PLACE IS NOT THE SAME FACT. The locator key does not carry the
   *   stated code, unit or parser contract, so an answer about `M144` at a row
   *   would otherwise answer a question about `M999` at that same row — a
   *   different source fact wearing the same address. Every stated fact of the
   *   row must match the stored one, or it is not the question that was answered.
   *
   * It asserts identity and nothing else. No unit becomes proven, no coefficient
   * and no price: those are other questions, asked elsewhere, as before.
   */
  async decidedIdentityForSourceRows(
    workspaceId: string,
    rows: readonly {
      sourceSha256: string | null;
      sheetName: string | null;
      sourceRowNumber: number | null;
      rawName: string;
      resourceType: string;
      /**
       * The stated facts of the row. Required, not optional: a caller that does
       * not know what the source said cannot be asking about the same fact, and
       * a silently-skipped comparison is exactly how M999 gets M144's answer.
       */
      rawCode: string | null;
      rawUnit: string | null;
      parserContractVersion: string | null;
    }[],
  ): Promise<Map<string, string>> {
    const decided = new Map<string, string>();
    if (rows.length === 0) return decided;

    /**
     * THE SAME OCCURRENCE MEANS THE WHOLE LOCATOR, OR NOTHING.
     *
     * `observedSourceRowKey` folds a missing sheet to '' and a missing row
     * number to -1, so two rows that cannot say where they are collapse onto one
     * key and become "the same occurrence" by accident. A decision must never
     * travel on a locator that names nowhere, so an incomplete one is not asked
     * about at all — it is not an answer withheld, it is a question that cannot
     * be posed.
     */
    const locatable = rows.filter(
      (row) =>
        typeof row.sourceSha256 === 'string' &&
        row.sourceSha256.length > 0 &&
        typeof row.sheetName === 'string' &&
        row.sheetName.length > 0 &&
        typeof row.sourceRowNumber === 'number',
    );
    if (locatable.length === 0) return decided;

    /**
     * A DIGEST IS A NUMBER WRITTEN IN LETTERS.
     *
     * The key case-folds it; SQL equality does not, and `in` has no
     * case-insensitive form. Narrowing to the caller's spelling alone would
     * return NOTHING whenever the stored rows use the other case — an empty
     * result indistinguishable from "nobody ever decided this". Both spellings
     * are offered to the query, and the folded key below stays the authority.
     */
    const digests = [
      ...new Set(
        locatable.flatMap((row) => {
          const sha = row.sourceSha256 as string;
          return [sha.toLowerCase(), sha.toUpperCase()];
        }),
      ),
    ];

    /**
     * THE STATED FACTS OF THE ROW, beside its address.
     *
     * The locator key answers WHERE; these answer WHAT THE SOURCE SAID there.
     * Both must match, or the stored answer is about a different fact.
     */
    const statedFacts = (row: {
      rawCode: string | null;
      rawUnit: string | null;
      parserContractVersion: string | null;
    }) =>
      JSON.stringify([
        row.rawCode ?? null,
        row.rawUnit ?? null,
        row.parserContractVersion ?? null,
      ]);

    const wanted = new Map(
      locatable.map((row) => [observedSourceRowKey(row), statedFacts(row)]),
    );
    const settled = await this.prisma.observedResource.findMany({
      where: {
        workspaceId,
        sourceSha256: { in: digests },
        resolvedResourceCatalogId: { not: null },
        status: {
          in: [
            ObservedResourceStatus.RESOLVED_EXISTING,
            ObservedResourceStatus.ADMITTED_NEW,
          ],
        },
      },
      select: {
        sourceSha256: true,
        sheetName: true,
        sourceRowNumber: true,
        rawName: true,
        rawCode: true,
        rawUnit: true,
        parserContractVersion: true,
        resourceType: true,
        resolvedResourceCatalogId: true,
      },
    });
    if (settled.length === 0) return decided;

    const relevant = settled.filter((row) => {
      const key = observedSourceRowKey(row);
      if (!wanted.has(key)) return false;
      // Same address AND same stated facts, or it is not the same question.
      return wanted.get(key) === statedFacts(row);
    });
    if (relevant.length === 0) return decided;

    /**
     * ONE OCCURRENCE, ONE ANSWER — AND DISAGREEMENT IS NOT AN ANSWER.
     *
     * This looped straight into `decided.set(...)`, so when two settled rows
     * described the SAME source occurrence and named DIFFERENT catalogue rows,
     * whichever the database happened to return last silently won. Two people
     * contradicting each other would have been resolved by query order, and the
     * result would flip between runs with no record that anything was in doubt.
     *
     * So the rows are gathered per occurrence FIRST. One distinct choice is an
     * answer; more than one is a conflict this reader has no authority to
     * settle, and it hands back nothing for that occurrence — leaving the
     * machine's own verdict to stand and the question open, which is what a
     * disagreement should cost. Not last-row-wins, and not first-row-wins.
     */
    const chosenByOccurrence = new Map<
      string,
      { choices: Set<string>; row: (typeof relevant)[number] }
    >();
    for (const row of relevant) {
      const chosen = row.resolvedResourceCatalogId;
      if (!chosen) continue;
      const key = observedSourceRowKey(row);
      const entry = chosenByOccurrence.get(key);
      if (entry) entry.choices.add(chosen);
      else chosenByOccurrence.set(key, { choices: new Set([chosen]), row });
    }

    const evidence = await this.identity.loadEvidence(this.prisma, workspaceId);
    for (const [key, entry] of chosenByOccurrence) {
      if (entry.choices.size !== 1) continue;
      const chosen = [...entry.choices][0];
      const verdict = await this.identity.resolve(
        evidence,
        this.referenceOf(entry.row),
      );
      // The machine may have come to prove it by itself since; that is its own
      // answer and this method has nothing to add to it.
      if (verdict.status === 'RESOLVED') {
        if (verdict.resolvedResourceCatalogId === chosen) decided.set(key, chosen);
        continue;
      }
      // Today's write-eligibility law, asked exactly as the write asks it.
      if (selectionRefusal(verdict, chosen) !== null) continue;
      /**
       * …AND THE REPLAY MAY NOT BE PROPPED UP BY A SIGHTING.
       *
       * `selectionRefusal` is the law for a PERSON making a decision, and it
       * lets them confirm a candidate nominated by a recorded fact — a source
       * sighting among them. That is right for a person: they see the sighting
       * and weigh it. It is wrong as the thing that revives a decision nobody
       * re-examined, because then a LATER import sighting the same spelling
       * quietly turns a thin old choice into an asserted identity.
       *
       * The kernel's own contract on a sighting: it "can nominate a candidate,
       * it can never assert one". So when the chosen row is held up by sightings
       * ALONE, the replay is withheld and the question is put to a person again.
       * An exact catalogue-name match, a source CODE match, or a reviewed human
       * mapping all still stand on their own.
       */
      const nominated = verdict.candidates.find(
        (candidate) => candidate.resourceCatalogId === chosen,
      );
      if (nominated && sightingOnlyNomination(nominated)) continue;
      decided.set(key, chosen);
    }
    return decided;
  }

  /**
   * HUMAN DECISION — this observation is one SIMPROK already has. Record the
   * chosen existing ResourceCatalog identity on the observation. Mints nothing.
   * The chosen id must be a real, ACTIVE catalog row the workspace may see
   * (its own or a global one), and — ACG-01.1 — never a row the identity kernel
   * refused for this wording (see kernelRefusalOfSelection). A refusal leaves
   * the observation exactly as it was: the source resource stays OBSERVED.
   *
   * IQL-01: with `rememberForIdenticalQuestions === true` the SAME row decision
   * is also offered as an exact-question learning CANDIDATE (a TEACH). That is
   * the only way learning begins, and it is never effective by itself.
   */
  async curateExisting(params: {
    workspaceId: string;
    observationId: string;
    selectedResourceCatalogId: string;
    actorAccountId: string;
    reason?: string | null;
    rememberForIdenticalQuestions?: boolean;
    decisionContextToken?: string | null;
  }) {
    if (params.rememberForIdenticalQuestions === true) {
      return this.curateExistingAndTeach(params);
    }
    return this.prisma.$transaction(
      async (txc) => {
        const tx = txc as Prisma.TransactionClient;
        const observation = await this.loadOpen(
          tx,
          params.workspaceId,
          params.observationId,
        );
        const catalog = await tx.resourceCatalog.findFirst({
          where: {
            id: params.selectedResourceCatalogId,
            status: 'ACTIVE',
            OR: [{ workspaceId: params.workspaceId }, { workspaceId: null }],
          },
          select: { id: true },
        });
        if (!catalog)
          throw new ConflictException('SELECTED_RESOURCE_NOT_VISIBLE');
        // ACG-01.1 — the machine's own answer for THIS wording, read inside the
        // same transaction as the write. The screen no longer offers a refused
        // row, but a direct request must not be able to persist one either —
        // and not when an unrelated sibling row keeps the refusal off the list.
        const refusal = await this.refusalOfSelection(
          tx,
          params.workspaceId,
          this.referenceOf(observation),
          catalog.id,
        );
        if (refusal) throw new ConflictException(refusal);
        return tx.observedResource.update({
          where: { id: observation.id },
          data: {
            status: ObservedResourceStatus.RESOLVED_EXISTING,
            resolvedResourceCatalogId: catalog.id,
            decidedByAccountId: params.actorAccountId,
            decidedAt: new Date(),
            reason: params.reason ?? null,
          },
        });
      },
      // Loading the workspace's evidence is the same read the TEACH path does
      // under this same budget; the default 5s would time it out on a large catalogue.
      { timeout: 20_000, maxWait: 20_000 },
    );
  }

  /**
   * HUMAN DECISION — this observation is genuinely new. The reviewer names a
   * canonical unit (never invented here), and the ONE admission authority mints
   * exactly one ResourceCatalog + one ResourceSourceIdentity. Fails closed if the
   * identity turns out to still be known, if the chosen unit is not representable
   * by the Unit Kernel, if the Unit Kernel cannot reach that unit FROM the one the
   * source document itself stated (including when the source stated none), or if
   * the observation lacks the provenance a sighting requires.
   */
  async curateNew(params: {
    workspaceId: string;
    observationId: string;
    unitDefinitionId: string;
    actorAccountId: string;
    reason?: string | null;
    /**
     * Branch (c): the nominations this person examined and refused, and the
     * candidate context they were shown. Re-proved by the admission authority
     * under its lock; absent means the machine-exhaustion law alone.
     */
    examination?: {
      refusedCandidateIds: readonly string[];
      candidateContextDigest: string;
    } | null;
  }) {
    return this.prisma.$transaction(
      async (tx) => {
        const observation = await this.loadOpen(
          tx,
          params.workspaceId,
          params.observationId,
        );

        const unitDefinition = await tx.unitDefinition.findFirst({
          where: { id: params.unitDefinitionId, isActive: true },
        });
        if (!unitDefinition)
          throw new ConflictException('UNIT_UNKNOWN_OR_INACTIVE');

        // The Unit Kernel is the authority; a definition existing is not the
        // same fact as its code being resolvable. No new alias, no new rule.
        const unitProof = await this.unitKernel.resolve(
          unitDefinition.code,
          unitDefinition.code,
          undefined,
          // Behaviour-neutral against today's vocabulary — every canonical code
          // carries a context-free self-alias — but asked the same way as every
          // other proof on this path, so a future canonical unit catalogued
          // only under a context cannot silently fail this admission gate.
          trustedUnitContext(observation.resourceType),
        );
        if (unitProof.status !== UNIT_RESOLUTION_STATUS.RESOLVED) {
          throw new ConflictException(
            'UNIT_NOT_REPRESENTABLE_BY_UNIT_AUTHORITY',
          );
        }

        // …AND THE UNIT THE SOURCE ITSELF STATED MUST REACH THE CHOSEN ONE.
        //
        // The proof above answers "is this canonical code vocabulary the kernel
        // can see" — true of every catalogued unit, and therefore silent about
        // THIS row. It was the only unit question asked here, so a human could
        // observe "Formworks [bh/M']" and admit it under any known canonical
        // unit: the selection was checked against itself and passed.
        //
        // The proposition admission actually needs is the one the Basic Price
        // admission already asks through this same authority — can the Unit
        // Kernel get from the unit the SOURCE stated to the unit a human chose.
        // The kernel is the ONE unit law (see its own standing instruction:
        // reuse it, never replicate the domain logic), so nothing is compared,
        // normalized or aliased here; a lawful equivalence or an existing
        // conversion rule still passes exactly as before.
        //
        // A source that states no unit is not a WEAKER proof — it is NO proof,
        // and it is the dangerous case rather than the mild one: an
        // incompatible spelling fails loudly, an absent one would pass in
        // silence. Refused here without consulting the kernel, so safety never
        // depends on the catalogue happening to hold no empty alias.
        const rawSourceUnit = observation.rawUnit?.trim() ?? '';
        const sourceUnitRefusal = (
          status: string,
          reasonCodes: readonly string[],
          explanation: string,
        ) =>
          new ConflictException({
            statusCode: 409,
            error: 'Conflict',
            message: 'UNIT_SELECTION_INCOMPATIBLE_WITH_SOURCE',
            unitResolution: {
              status,
              reasonCodes,
              explanation,
              policyVersion: UNIT_KERNEL_POLICY_VERSION,
              // The source cell, unaltered — null stays null, blank stays blank.
              rawSourceUnit: observation.rawUnit,
              selectedUnitCode: unitDefinition.code,
              resourceContext: observation.resourceType,
            },
          });

        if (rawSourceUnit === '') {
          throw sourceUnitRefusal(
            UNIT_RESOLUTION_STATUS.NEEDS_REVIEW,
            ['UNIT_REQUIRED'],
            'Dokumen sumber tidak mencantumkan satuan pada baris ini, sehingga ' +
              'tidak ada bukti yang dapat membuktikan satuan pilihan manusia.',
          );
        }

        const sourceUnitProof = await this.unitKernel.resolve(
          rawSourceUnit,
          unitDefinition.code,
          undefined,
          trustedUnitContext(observation.resourceType),
        );
        if (sourceUnitProof.status !== UNIT_RESOLUTION_STATUS.RESOLVED) {
          throw sourceUnitRefusal(
            sourceUnitProof.status,
            sourceUnitProof.reasonCodes,
            sourceUnitProof.explanation,
          );
        }

        // RESOLVED IS NOT THE SAME FACT AS "THE SAME UNIT".
        //
        // The kernel also answers RESOLVED when it found a real, evidence-bound
        // CONVERSION — the measures are relatable, with a factor. Admission is
        // where a resource's canonical measure is fixed for good: baseUnit goes
        // onto the new ResourceCatalog row while the source's own spelling goes
        // onto its ResourceSourceIdentity beside it. Accepting a conversion here
        // would bake in an equivalence whose arithmetic nobody performed — every
        // later coefficient and price would read as if the two measures were the
        // same, and nothing downstream would know a factor was owed.
        //
        // So the mint requires IDENTITY and says exactly why, rather than
        // inventing the missing arithmetic. It is the same refusal the Basic
        // Price admission already makes (UNIT_SELECTION_REQUIRES_PRICE_CONVERSION),
        // and the same half of the law: SIMPROK menghitung, manusia memutuskan —
        // it will not quietly decide that one measure is another.
        if (sourceUnitProof.priceOperation !== UNIT_PRICE_OPERATION.IDENTITY) {
          throw new ConflictException({
            statusCode: 409,
            error: 'Conflict',
            message: 'UNIT_SELECTION_REQUIRES_PRICE_CONVERSION',
            unitResolution: {
              status: sourceUnitProof.status,
              reasonCodes: sourceUnitProof.reasonCodes,
              explanation: sourceUnitProof.explanation,
              policyVersion: UNIT_KERNEL_POLICY_VERSION,
              rawSourceUnit: observation.rawUnit,
              selectedUnitCode: unitDefinition.code,
              resourceContext: observation.resourceType,
              quantityFactor: sourceUnitProof.quantityFactor,
              priceOperation: sourceUnitProof.priceOperation,
            },
          });
        }

        const admissionInput: AdmitObservedResourceInput = {
          workspaceId: params.workspaceId,
          rawName: observation.rawName,
          rawCode: observation.rawCode,
          rawUnit: observation.rawUnit,
          resourceType: observation.resourceType,
          baseUnit: unitDefinition.code,
          provenance: {
            sourceSha256: observation.sourceSha256 ?? '',
            sourceFileName: observation.sourceFileName ?? '',
            parserContractVersion: observation.parserContractVersion ?? '',
            sheetName: observation.sheetName ?? '',
            sourceRowNumber: observation.sourceRowNumber ?? 0,
            sourceNameCellAddress: observation.sourceNameCellAddress ?? '',
            sourceCodeCellAddress: observation.sourceCodeCellAddress,
            sourceUnitCellAddress: observation.sourceUnitCellAddress,
          },
          ...(params.examination ? { examination: params.examination } : {}),
        };

        const catalog = await this.admission
          .admitObservedResource(tx, admissionInput)
          .catch((error: unknown) => {
            if (error instanceof ResourceAdmissionNotExhaustedError) {
              throw new ConflictException('RESOURCE_IDENTITY_NOT_EXHAUSTED');
            }
            if (error instanceof ResourceProvenanceAlreadyBoundError) {
              throw new ConflictException('RESOURCE_PROVENANCE_ALREADY_BOUND');
            }
            if (error instanceof ResourceAdmissionProvenanceIncompleteError) {
              throw new ConflictException({
                statusCode: 409,
                error: 'Conflict',
                message: 'OBSERVATION_PROVENANCE_INCOMPLETE',
                missing: error.missing,
              });
            }
            throw error;
          });

        const updated = await tx.observedResource.update({
          where: { id: observation.id },
          data: {
            status: ObservedResourceStatus.ADMITTED_NEW,
            resolvedResourceCatalogId: catalog.id,
            decidedByAccountId: params.actorAccountId,
            decidedAt: new Date(),
            // The decision record keeps WHAT was refused on the way to "new",
            // in the existing reason column and in plain words — the refused
            // candidate ids are the audit trail of branch (c).
            reason: this.admissionReason(params.reason, params.examination),
          },
        });
        return { admittedResource: catalog, observation: updated };
      },
      // The admission advisory lock can make a genuine-race loser wait for the
      // winner's whole admission to commit; the default 5s would time that out.
      { timeout: 20_000, maxWait: 20_000 },
    );
  }

  // ===========================================================================
  // IQL-01 — GOVERNED EXACT-QUESTION LEARNING MEMORY
  //
  // One human decision on one row may be OFFERED as learning (TEACH). It
  // becomes reusable only through an APPROVE by a different authorized
  // account, only for a byte-identical question, and only through the existing
  // Resource Identity kernel. Every governance act is the next generation of an
  // append-only ledger; nothing here resolves, prices, or mints anything.
  // ===========================================================================

  /** APPROVE — the only act that makes an exact-question answer effective. */
  async approveQuestion(params: {
    workspaceId: string;
    questionKey: string;
    actorAccountId: string;
    decisionContextToken?: string | null;
    reason?: string | null;
  }) {
    return this.governQuestion('APPROVE', params);
  }

  /** REJECT — a pending candidate leaves no memory. */
  async rejectQuestion(params: {
    workspaceId: string;
    questionKey: string;
    actorAccountId: string;
    decisionContextToken?: string | null;
    reason?: string | null;
  }) {
    return this.governQuestion('REJECT', params);
  }

  /** SUPERSEDE — a different answer for an effective question; reuse stops until it is approved. */
  async supersedeQuestion(params: {
    workspaceId: string;
    questionKey: string;
    actorAccountId: string;
    selectedResourceCatalogId?: string | null;
    decisionContextToken?: string | null;
    reason?: string | null;
  }) {
    return this.governQuestion('SUPERSEDE', params);
  }

  /** REVOKE — an approved answer stops being reused; its history stays. */
  async revokeQuestion(params: {
    workspaceId: string;
    questionKey: string;
    actorAccountId: string;
    decisionContextToken?: string | null;
    reason?: string | null;
  }) {
    return this.governQuestion('REVOKE', params);
  }

  /**
   * Every exact question this workspace has governed: its current state, its
   * full history, and — for THIS actor — the doors governance allows. A READ:
   * nothing is written, and account ids never leave the server.
   *
   * `authority.mayDecide` is whether the actor holds full identity curation.
   * A second holder who may only judge sees APPROVE / REJECT for a pending
   * candidate, and never a REVOKE or SUPERSEDE door its routes would refuse.
   */
  async listQuestions(
    workspaceId: string,
    actorAccountId: string,
    authority: { mayDecide: boolean },
  ) {
    const rows = await this.prisma.resourceIdentityQuestionDecision.findMany({
      where: { workspaceId },
      orderBy: [{ questionKey: 'asc' }, { generation: 'asc' }],
      include: {
        selectedResourceCatalog: { select: { id: true, name: true } },
        originObservation: {
          select: {
            workspaceId: true,
            resourceType: true,
            rawName: true,
            rawCode: true,
            rawUnit: true,
            sourceSha256: true,
          },
        },
      },
    });
    if (rows.length === 0) return [];

    const byQuestion = new Map<string, typeof rows>();
    for (const row of rows) {
      const events = byQuestion.get(row.questionKey) ?? [];
      events.push(row);
      byQuestion.set(row.questionKey, events);
    }
    // The machine's own verdicts, against ONE evidence load for the workspace.
    const evidence = await this.identity.loadEvidence(this.prisma, workspaceId);

    const views = await Promise.all(
      [...byQuestion.entries()].map(async ([questionKey, events]) => {
        const latestRow = events[events.length - 1];
        const byId = new Map(events.map((event) => [event.id, event]));
        const previousRow = latestRow.previousDecisionId
          ? (byId.get(latestRow.previousDecisionId) ?? null)
          : null;
        const latest = asQuestionEvent(latestRow);
        const state = identicalQuestionState(
          latest,
          previousRow ? asQuestionEvent(previousRow) : null,
        );
        // The answer this state is ABOUT: the pending candidate, the approved or
        // rejected answer, or the answer a revocation withdrew.
        const answerRow =
          state.kind === 'PENDING'
            ? latestRow
            : state.kind === 'APPROVED' || state.kind === 'REJECTED'
              ? previousRow
              : state.kind === 'REVOKED' && previousRow?.previousDecisionId
                ? (byId.get(previousRow.previousDecisionId) ?? null)
                : null;
        const origin = latestRow.originObservation;
        const verdict = await this.identity.resolve(
          evidence,
          this.referenceOf(origin),
        );
        const liveDigest = candidateDigestOf(verdict);
        const label = this.stateLabel(state, () => liveDigest, verdict);
        const authoredBy = answerRow?.decidedByAccountId ?? null;

        // A PENDING candidate taught under a policy no longer in force can never
        // become effective, so APPROVE is not offered for it — the same
        // principle this projection already applies to REVOKE and SUPERSEDE:
        // never a door its own route would refuse. REJECT stays open, because
        // that is the lawful way out, and the reason is carried so the door is
        // seen to be shut and explained rather than silently missing.
        const candidatePolicySuperseded =
          state.kind === 'PENDING' &&
          state.candidate.resolutionPolicyVersion !== LIVE_POLICY;
        const mayApprove =
          state.kind === 'PENDING' &&
          !candidatePolicySuperseded &&
          authoredBy !== actorAccountId;
        const mayReject = state.kind === 'PENDING';
        const mayRevoke = authority.mayDecide && state.kind === 'APPROVED';
        const maySupersede =
          authority.mayDecide &&
          label === 'EFFECTIVE' &&
          verdict.status !== 'RESOLVED' &&
          isIdenticalQuestionDecidable(verdict);
        const token =
          mayApprove || mayReject || mayRevoke || maySupersede
            ? this.issueQuestionContext({
                workspaceId,
                questionKey,
                actorAccountId,
                expectedGeneration: latest.generation,
                candidateContextDigest: liveDigest,
              })
            : null;
        const open = token !== null;

        return {
          questionKey,
          rawName: origin.rawName,
          rawCode: origin.rawCode,
          rawUnit: origin.rawUnit,
          resourceType: origin.resourceType,
          state: label,
          answer: answerRow?.selectedResourceCatalog
            ? {
                resourceCatalogId: answerRow.selectedResourceCatalog.id,
                name: answerRow.selectedResourceCatalog.name,
              }
            : null,
          authoredByYou: authoredBy !== null && authoredBy === actorAccountId,
          generation: latest.generation,
          decidedAt: latestRow.decidedAt,
          canApprove: open && mayApprove,
          /**
           * Why APPROVE is shut, when it is shut for a reason the reader cannot
           * otherwise see. `authoredByYou` already explains the other case, so
           * only this one needs saying. Null whenever approval is offered or the
           * question is not pending at all.
           */
          approvalBlockedReason: candidatePolicySuperseded
            ? ('CANDIDATE_POLICY_SUPERSEDED' as const)
            : null,
          canReject: open && mayReject,
          canRevoke: open && mayRevoke,
          canSupersede: open && maySupersede,
          supersedeCandidates:
            open && maySupersede
              ? verdict.candidates
                  .filter(
                    (candidate) =>
                      candidate.resourceCatalogId !==
                        answerRow?.selectedResourceCatalogId &&
                      !candidate.specificationUnproved &&
                      isConfirmableCandidate(candidate),
                  )
                  .map((candidate) => ({
                    resourceCatalogId: candidate.resourceCatalogId,
                    name: candidate.name,
                  }))
              : [],
          decisionContextToken: token,
          history: events.map((event) => ({
            generation: event.generation,
            action: event.action,
            byYou: event.decidedByAccountId === actorAccountId,
            decidedAt: event.decidedAt,
            reason: event.reason,
          })),
        };
      }),
    );
    // What still needs a human first; then what is in force; then history.
    const order: Record<IdenticalQuestionStateLabel, number> = {
      PENDING: 0,
      EFFECTIVE: 1,
      INAPPLICABLE: 2,
      REJECTED: 3,
      REVOKED: 4,
      NONE: 5,
    };
    return views.sort((left, right) => order[left.state] - order[right.state]);
  }

  /**
   * TEACH — the row decision exactly as `curateExisting` records it, plus ONE
   * exact-question learning candidate. The signed context proves the human was
   * shown THIS question with THIS candidate set; the lock serializes the
   * question; the pure law decides append, replay or refusal.
   */
  private async curateExistingAndTeach(params: {
    workspaceId: string;
    observationId: string;
    selectedResourceCatalogId: string;
    actorAccountId: string;
    reason?: string | null;
    decisionContextToken?: string | null;
  }) {
    const token = params.decisionContextToken;
    if (typeof token !== 'string' || token.length === 0) {
      throw new BadRequestException('DECISION_CONTEXT_TOKEN_REQUIRED');
    }
    // The question is derived from raw fields no code path rewrites, so it can
    // be read before the lock; it is proven again inside it.
    const located = await this.prisma.observedResource.findFirst({
      where: { id: params.observationId, workspaceId: params.workspaceId },
    });
    if (!located) throw new NotFoundException('OBSERVATION_NOT_FOUND');
    const questionKey = identicalQuestionKey(this.questionOf(located));
    const claims = this.tokens.verifyIdenticalQuestionContext(token, {
      workspaceId: params.workspaceId,
      questionKey,
      actorAccountId: params.actorAccountId,
      resolutionPolicyVersion: LIVE_POLICY,
    });

    return this.withQuestionRetry(() =>
      this.prisma.$transaction(
        async (txc) => {
          const tx = txc as Prisma.TransactionClient;
          await this.lockQuestion(tx, params.workspaceId, questionKey);
          const observation = await this.loadOpen(
            tx,
            params.workspaceId,
            params.observationId,
          );
          if (
            identicalQuestionKey(this.questionOf(observation)) !== questionKey
          ) {
            throw new ConflictException('QUESTION_PROVENANCE_MISMATCH');
          }
          const catalog = await tx.resourceCatalog.findFirst({
            where: {
              id: params.selectedResourceCatalogId,
              status: 'ACTIVE',
              OR: [{ workspaceId: params.workspaceId }, { workspaceId: null }],
            },
            select: { id: true },
          });
          if (!catalog)
            throw new ConflictException('SELECTED_RESOURCE_NOT_VISIBLE');

          const verdict = await this.machineVerdict(
            tx,
            params.workspaceId,
            this.referenceOf(observation),
          );
          const liveDigest = this.assertAnswerable(
            verdict,
            claims.candidateContextDigest,
            catalog.id,
          );
          const { latest, state } = this.readState(
            await this.latestQuestionRow(tx, params.workspaceId, questionKey),
          );
          const plan = planTeach({
            state,
            latest,
            expectedGeneration: claims.expectedGeneration,
            selectedResourceCatalogId: catalog.id,
            live: {
              candidateContextDigest: liveDigest,
              resolutionPolicyVersion: LIVE_POLICY,
            },
          });
          if (plan.outcome === 'CONFLICT') {
            throw new ConflictException(plan.code);
          }

          // The row decision itself — identical to the existing command.
          const decided = await tx.observedResource.update({
            where: { id: observation.id },
            data: {
              status: ObservedResourceStatus.RESOLVED_EXISTING,
              resolvedResourceCatalogId: catalog.id,
              decidedByAccountId: params.actorAccountId,
              decidedAt: new Date(),
              reason: params.reason ?? null,
            },
          });
          const event =
            plan.outcome === 'APPEND'
              ? await tx.resourceIdentityQuestionDecision.create({
                  data: {
                    workspaceId: params.workspaceId,
                    questionKey,
                    generation: plan.generation,
                    previousDecisionId: plan.previousDecisionId,
                    action: 'TEACH',
                    selectedResourceCatalogId: catalog.id,
                    candidateContextDigest: liveDigest,
                    resolutionPolicyVersion: LIVE_POLICY,
                    originObservationId: observation.id,
                    decidedByAccountId: params.actorAccountId,
                    reason: params.reason ?? null,
                  },
                })
              : plan.event;
          return {
            ...decided,
            identicalQuestion: {
              questionKey,
              decisionId: event.id,
              generation: event.generation,
              state:
                LABEL_AFTER[event.action === 'APPROVE' ? 'APPROVE' : 'TEACH'],
              replayed: plan.outcome === 'REPLAY',
            },
          };
        },
        { timeout: 20_000, maxWait: 20_000 },
      ),
    );
  }

  /** APPROVE / REJECT / SUPERSEDE / REVOKE — one path, one lock, one law. */
  private async governQuestion(
    action: Exclude<IdenticalQuestionAction, 'TEACH'>,
    params: {
      workspaceId: string;
      questionKey: string;
      actorAccountId: string;
      decisionContextToken?: string | null;
      reason?: string | null;
      selectedResourceCatalogId?: string | null;
    },
  ) {
    if (!QUESTION_KEY_SHAPE.test(params.questionKey)) {
      throw new NotFoundException('QUESTION_NOT_FOUND');
    }
    const reasonGiven =
      typeof params.reason === 'string' && params.reason.trim().length > 0;
    if (action !== 'APPROVE' && !reasonGiven) {
      throw new BadRequestException('REASON_REQUIRED');
    }
    const selected = params.selectedResourceCatalogId ?? null;
    if (action === 'SUPERSEDE' && !selected) {
      throw new BadRequestException('SELECTED_RESOURCE_CATALOG_ID_REQUIRED');
    }
    const token = params.decisionContextToken;
    if (typeof token !== 'string' || token.length === 0) {
      throw new BadRequestException('DECISION_CONTEXT_TOKEN_REQUIRED');
    }
    const claims = this.tokens.verifyIdenticalQuestionContext(token, {
      workspaceId: params.workspaceId,
      questionKey: params.questionKey,
      actorAccountId: params.actorAccountId,
      resolutionPolicyVersion: LIVE_POLICY,
    });

    return this.withQuestionRetry(() =>
      this.prisma.$transaction(
        async (txc) => {
          const tx = txc as Prisma.TransactionClient;
          await this.lockQuestion(tx, params.workspaceId, params.questionKey);
          const row = await this.latestQuestionRow(
            tx,
            params.workspaceId,
            params.questionKey,
          );
          if (!row) throw new NotFoundException('QUESTION_NOT_FOUND');
          // Every event carries its question's provenance; the raw question is
          // re-proven from it, never taken from the request.
          const origin = row.originObservation;
          if (
            identicalQuestionKey(this.questionOf(origin)) !== params.questionKey
          ) {
            throw new ConflictException('QUESTION_PROVENANCE_MISMATCH');
          }
          const reference = this.referenceOf(origin);
          const { latest, state } = this.readState(row);
          const base = {
            state,
            latest,
            expectedGeneration: claims.expectedGeneration,
            actorAccountId: params.actorAccountId,
          };

          let answer: {
            selectedResourceCatalogId: string;
            candidateContextDigest: string;
            resolutionPolicyVersion: string;
          } | null = null;
          let plan: GovernancePlan;
          if (action === 'APPROVE') {
            plan = planApprove({ ...base, livePolicyVersion: LIVE_POLICY });
            if (plan.outcome === 'APPEND' && state.kind === 'PENDING') {
              // The candidate must STILL answer the live question: machine
              // first, same candidate context, same policy, still a legitimate
              // spec-safe candidate.
              const verdict = await this.machineVerdict(
                tx,
                params.workspaceId,
                reference,
              );
              const liveDigest = this.assertAnswerable(
                verdict,
                claims.candidateContextDigest,
                state.candidate.selectedResourceCatalogId ?? '',
              );
              if (
                !isAnswerApplicable(state.candidate, {
                  candidateContextDigest: liveDigest,
                  resolutionPolicyVersion: LIVE_POLICY,
                })
              ) {
                throw new ConflictException('DECISION_CONTEXT_STALE');
              }
            }
          } else if (action === 'SUPERSEDE') {
            const verdict = await this.machineVerdict(
              tx,
              params.workspaceId,
              reference,
            );
            const liveDigest = this.assertAnswerable(
              verdict,
              claims.candidateContextDigest,
              selected as string,
            );
            plan = planSupersede({
              ...base,
              selectedResourceCatalogId: selected as string,
              live: {
                candidateContextDigest: liveDigest,
                resolutionPolicyVersion: LIVE_POLICY,
              },
            });
            answer = {
              selectedResourceCatalogId: selected as string,
              candidateContextDigest: liveDigest,
              resolutionPolicyVersion: LIVE_POLICY,
            };
          } else if (action === 'REJECT') {
            plan = planReject(base);
          } else {
            plan = planRevoke(base);
          }
          if (plan.outcome === 'CONFLICT') {
            throw new ConflictException(plan.code);
          }

          const event =
            plan.outcome === 'APPEND'
              ? await tx.resourceIdentityQuestionDecision.create({
                  data: {
                    workspaceId: params.workspaceId,
                    questionKey: params.questionKey,
                    generation: plan.generation,
                    previousDecisionId: plan.previousDecisionId,
                    action,
                    ...(answer ?? {}),
                    // A judging act keeps its question's provenance.
                    originObservationId: row.originObservationId,
                    decidedByAccountId: params.actorAccountId,
                    reason: reasonGiven ? (params.reason as string) : null,
                  },
                })
              : plan.event;

          const result = {
            questionKey: params.questionKey,
            decisionId: event.id,
            generation: event.generation,
            action: event.action,
            state: LABEL_AFTER[event.action],
            replayed: plan.outcome === 'REPLAY',
          };
          if (event.action !== 'APPROVE') return result;
          // Reported by re-running the SAME pipeline with the memory in place —
          // never asserted from the approval itself.
          const evidence = await this.identity.loadEvidence(
            tx,
            params.workspaceId,
            undefined,
            { identicalQuestionKeys: [params.questionKey] },
          );
          const after = await this.identity.resolve(evidence, reference, tx);
          return {
            ...result,
            identityAfterApproval: {
              status: after.status,
              authority: after.authority,
              resolvedResourceCatalogId: after.resolvedResourceCatalogId,
            },
          };
        },
        { timeout: 20_000, maxWait: 20_000 },
      ),
    );
  }

  /**
   * The exact-question state for ONE open row. Learning is offered only to a
   * known actor, only for a verdict an exact-question answer may settle, and
   * never while a candidate for the same question awaits judgement.
   */
  private describeOpenQuestion(params: {
    workspaceId: string;
    questionKey: string;
    resolution: ResourceIdentityResolution;
    latest: IdenticalQuestionLatestEvent | null;
    actorAccountId?: string;
  }) {
    const { questionKey, resolution, actorAccountId } = params;
    const latest = params.latest ? asQuestionEvent(params.latest) : null;
    const previous = params.latest?.previousDecision
      ? asQuestionEvent(params.latest.previousDecision)
      : null;
    const state = identicalQuestionState(latest, previous);
    const pending = state.kind === 'PENDING' ? state.candidate : null;
    const view = {
      questionKey,
      state: this.stateLabel(
        state,
        () => candidateDigestOf(resolution),
        resolution,
      ),
      rememberable: false,
      // WHY learning is not offered — each early return below, said out loud
      // instead of left for the reader to guess. Describes; decides nothing.
      notRememberableReason: null as NotRememberableReason | null,
      decisionContextToken: null as string | null,
      pendingAnswerName: pending
        ? (resolution.candidates.find(
            (candidate) =>
              candidate.resourceCatalogId === pending.selectedResourceCatalogId,
          )?.name ?? null)
        : null,
      pendingAuthoredByYou:
        pending !== null &&
        actorAccountId !== undefined &&
        pending.decidedByAccountId === actorAccountId,
    };
    if (!actorAccountId) return { ...view, notRememberableReason: 'NO_ACTOR' };
    if (state.kind === 'PENDING') {
      return { ...view, notRememberableReason: 'CANDIDATE_PENDING' };
    }
    if (resolution.status === 'RESOLVED') {
      return { ...view, notRememberableReason: 'IDENTITY_PROVEN' };
    }
    if (!isIdenticalQuestionDecidable(resolution)) {
      return { ...view, notRememberableReason: 'NOT_DECIDABLE' };
    }
    const token = this.issueQuestionContext({
      workspaceId: params.workspaceId,
      questionKey,
      actorAccountId,
      expectedGeneration: latest?.generation ?? 0,
      candidateContextDigest: candidateDigestOf(resolution),
    });
    return token === null
      ? { ...view, notRememberableReason: 'LEARNING_NOT_CONFIGURED' }
      : { ...view, rememberable: true, decisionContextToken: token };
  }

  private stateLabel(
    state: IdenticalQuestionState,
    liveDigest: () => string,
    verdict: ResourceIdentityResolution,
  ): IdenticalQuestionStateLabel {
    switch (state.kind) {
      case 'NONE':
        return 'NONE';
      case 'PENDING':
        return 'PENDING';
      case 'REJECTED':
        return 'REJECTED';
      case 'REVOKED':
        return 'REVOKED';
      case 'APPROVED':
        // EFFECTIVE only while it is actually reused: same candidate context
        // and policy, AND still a legitimate answer to the live verdict.
        return isAnswerApplicable(state.answer, {
          candidateContextDigest: liveDigest(),
          resolutionPolicyVersion: LIVE_POLICY,
        }) &&
          this.answerStillLegitimate(
            verdict,
            state.answer.selectedResourceCatalogId,
          )
          ? 'EFFECTIVE'
          : 'INAPPLICABLE';
    }
  }

  /**
   * The signed context, or null when the capability is not configured. A
   * missing secret disables learning only — never the curation list itself.
   */
  private issueQuestionContext(input: {
    workspaceId: string;
    questionKey: string;
    actorAccountId: string;
    expectedGeneration: number;
    candidateContextDigest: string;
  }): string | null {
    try {
      return this.tokens.issueIdenticalQuestionContext({
        ...input,
        resolutionPolicyVersion: LIVE_POLICY,
      });
    } catch (error) {
      if (error instanceof GhxDecisionContextConfigurationError) return null;
      throw error;
    }
  }

  /**
   * An answer must still answer the question its signed context described:
   * the machine did not resolve it, it is a question an exact-question answer
   * may settle, the candidate context is unchanged, and the chosen row is one
   * the machine itself nominated with its specification proven.
   */
  private assertAnswerable(
    verdict: ResourceIdentityResolution,
    signedDigest: string,
    selectedResourceCatalogId: string,
  ): string {
    if (verdict.status === 'RESOLVED') {
      throw new ConflictException(
        'NOT_HUMAN_DECIDABLE_IDENTITY_ALREADY_PROVEN',
      );
    }
    if (!isIdenticalQuestionDecidable(verdict)) {
      throw new ConflictException('NOT_IDENTICAL_QUESTION_DECIDABLE');
    }
    const liveDigest = candidateDigestOf(verdict);
    if (liveDigest !== signedDigest) {
      throw new ConflictException('DECISION_CONTEXT_STALE');
    }
    const chosen = verdict.candidates.find(
      (candidate) => candidate.resourceCatalogId === selectedResourceCatalogId,
    );
    if (
      !chosen ||
      chosen.specificationUnproved ||
      !isConfirmableCandidate(chosen)
    ) {
      throw new ConflictException('CANDIDATE_NOT_LEGITIMATE_FOR_LEARNING');
    }
    return liveDigest;
  }

  /**
   * Is a stored exact-question answer still a LEGITIMATE answer to the live
   * question — not only the same candidate context and policy, but still a
   * verdict an answer may settle, naming a row that rests on more than a name?
   * An answer failing this is shown INAPPLICABLE, because it is not reused.
   */
  private answerStillLegitimate(
    verdict: ResourceIdentityResolution,
    selectedResourceCatalogId: string | null,
  ): boolean {
    if (verdict.status === 'RESOLVED') return true;
    if (!isIdenticalQuestionDecidable(verdict)) return false;
    const chosen = verdict.candidates.find(
      (candidate) => candidate.resourceCatalogId === selectedResourceCatalogId,
    );
    return Boolean(
      chosen && !chosen.specificationUnproved && isConfirmableCandidate(chosen),
    );
  }

  /**
   * ACG-01.1 — IS THE CHOSEN ROW REFUSED BY THE MACHINE'S OWN ANSWER?
   *
   * ONE evidence set, ONE canonical machine, ONE predicate, two questions:
   *   1. this wording against the WHOLE catalogue — the answer the queue shows;
   *   2. this wording against the CHOSEN ROW ALONE — the answer no unrelated
   *      row can change.
   * The second question exists because the first one hides refusals: the kernel
   * reports the rows it ruled out only when nothing else survived. Asking it
   * about the chosen row by itself puts that row's own evidence back in front of
   * the same kernel, with the same sightings, the same reviewed mappings and the
   * same proven unit facts. Nothing is re-derived, re-scored or re-matched here;
   * the catalogue is simply narrowed to the row the human actually chose.
   *
   * A row ruled out on its own evidence stays ruled out however many siblings
   * the catalogue holds. A row the machine nominates, proves, or cannot connect
   * to this wording is left exactly as answerable as it was.
   */
  private async refusalOfSelection(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    reference: RawResourceReference,
    selectedResourceCatalogId: string,
  ): Promise<SelectionRefusal | null> {
    const evidence = await this.identity.loadEvidence(tx, workspaceId);
    const whole = await this.identity.resolve(evidence, reference, tx);
    // THE KERNEL'S WRITE-ELIGIBILITY LAW on the whole-catalogue answer: a row the
    // machine proved otherwise, ruled out, nominated on name similarity only, or
    // never nominated is not recorded as this resource. Nothing is re-scored here.
    const refusedByWhole = selectionRefusal(whole, selectedResourceCatalogId);
    if (
      refusedByWhole &&
      refusedByWhole !== 'IDENTITY_CANDIDATE_NOT_NOMINATED'
    ) {
      return refusedByWhole;
    }
    if (refusedByWhole) {
      // Absent from the whole answer. Say the PRECISE reason when the row alone
      // was examined and ruled out; otherwise it was simply never nominated.
      const alone = await this.identity.resolve(
        {
          ...evidence,
          catalogCandidates: evidence.catalogCandidates.filter(
            (candidate) => candidate.id === selectedResourceCatalogId,
          ),
        },
        reference,
        tx,
      );
      return (
        kernelRefusalOfSelection(alone, selectedResourceCatalogId) ??
        refusedByWhole
      );
    }
    // MACHINE FIRST — a proven identity is never reconsidered. If the machine
    // PROVED this very row for this wording, no narrower question may unprove
    // it; the whole-catalogue answer above already refused every other row.
    if (whole.status === 'RESOLVED') return null;
    const alone = await this.identity.resolve(
      {
        ...evidence,
        catalogCandidates: evidence.catalogCandidates.filter(
          (candidate) => candidate.id === selectedResourceCatalogId,
        ),
      },
      reference,
      tx,
    );
    return kernelRefusalOfSelection(alone, selectedResourceCatalogId);
  }

  private admissionReason(
    reason: string | null | undefined,
    examination:
      | {
          refusedCandidateIds: readonly string[];
          candidateContextDigest: string;
        }
      | null
      | undefined,
  ): string | null {
    const given =
      typeof reason === 'string' && reason.trim() !== '' ? reason : null;
    if (!examination) return given;
    const note =
      'Kandidat yang diperiksa dan dinyatakan bukan sumber daya ini: ' +
      [...examination.refusedCandidateIds].sort().join(', ') +
      ' (konteks kandidat ' +
      examination.candidateContextDigest +
      ').';
    return given ? `${given}\n${note}` : note;
  }

  /** The machine's own verdict for a question — no governed memory applied. */
  private async machineVerdict(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    reference: RawResourceReference,
  ): Promise<ResourceIdentityResolution> {
    const evidence = await this.identity.loadEvidence(tx, workspaceId);
    return this.identity.resolve(evidence, reference, tx);
  }

  /** Serialize governance of ONE exact question — the first statement of its transaction. */
  private async lockQuestion(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    questionKey: string,
  ): Promise<void> {
    const key = resourceAdmissionLockKey(`${workspaceId}|${questionKey}`);
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(${IQL01_LOCK_NAMESPACE}::int4, ${key}::int4)`,
    );
  }

  private latestQuestionRow(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    questionKey: string,
  ) {
    const questionFields = {
      select: {
        workspaceId: true,
        resourceType: true,
        rawName: true,
        rawCode: true,
        rawUnit: true,
        sourceSha256: true,
      },
    } as const;
    return tx.resourceIdentityQuestionDecision.findFirst({
      where: { workspaceId, questionKey },
      orderBy: { generation: 'desc' },
      include: {
        originObservation: questionFields,
        previousDecision: true,
      },
    });
  }

  private readState(
    row:
      | (Parameters<typeof asQuestionEvent>[0] & {
          previousDecision: Parameters<typeof asQuestionEvent>[0] | null;
        })
      | null,
  ): { latest: IdenticalQuestionEvent | null; state: IdenticalQuestionState } {
    const latest = row ? asQuestionEvent(row) : null;
    const previous = row?.previousDecision
      ? asQuestionEvent(row.previousDecision)
      : null;
    return { latest, state: identicalQuestionState(latest, previous) };
  }

  /** Bounded retry for a serialization failure or a lost generation race only. */
  private async withQuestionRetry<T>(run: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await run();
      } catch (error) {
        if (attempt < QUESTION_RETRY_LIMIT && isRetryableQuestionWrite(error)) {
          continue;
        }
        throw error;
      }
    }
  }

  /** The exact question an observation asks, verbatim from its raw fields. */
  private questionOf(observation: {
    workspaceId: string;
    resourceType: string;
    rawName: string;
    rawCode: string | null;
    rawUnit: string | null;
  }): IdenticalQuestion {
    return {
      workspaceId: observation.workspaceId,
      resourceType: observation.resourceType,
      rawName: observation.rawName,
      rawCode: observation.rawCode,
      rawUnit: observation.rawUnit,
    };
  }

  private referenceOf(observation: {
    rawName: string;
    rawCode: string | null;
    rawUnit: string | null;
    resourceType: string;
    /**
     * The document this row was read from, when the caller selected it. The
     * kernel uses it for ONE comparison — a code the same workbook already
     * recorded for the matched row — and an absent digest leaves every verdict
     * exactly as it was.
     */
    sourceSha256?: string | null;
  }): RawResourceReference {
    return {
      rawName: observation.rawName,
      rawCode: observation.rawCode,
      rawUnit: observation.rawUnit,
      resourceType: observation.resourceType,
      sourceSha256: observation.sourceSha256 ?? null,
    };
  }

  private async loadOpen(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    observationId: string,
  ) {
    const observation = await tx.observedResource.findFirst({
      where: { id: observationId, workspaceId },
    });
    if (!observation) throw new NotFoundException('OBSERVATION_NOT_FOUND');
    if (observation.status !== ObservedResourceStatus.OBSERVED) {
      throw new ConflictException('OBSERVATION_ALREADY_DECIDED');
    }
    return observation;
  }
}
