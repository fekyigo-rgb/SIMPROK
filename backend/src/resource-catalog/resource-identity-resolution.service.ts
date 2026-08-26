import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  RawResourceReference,
  ResourceIdentityResolution,
  IdentityCatalogCandidate,
  SourceSightingEvidence,
  ReviewedMappingEvidence,
  CanonicalUnitIdentityFact,
  VerifiedIdentityDecisionFact,
  isExactRepresentationTie,
  isHumanDecidable,
  resolveResourceIdentity,
} from './resource-identity-resolution.kernel';
import { candidateContextDigest } from './ghx-candidate-context';
import { UnitKernelService } from '../unit-kernel/unit-kernel.service';
import {
  UNIT_ALIAS_CONTEXT,
  UnitAliasContext,
} from '../unit-kernel/unit-kernel.contracts';

/**
 * Everything the identity kernel is allowed to see, loaded ONCE for a whole
 * AHSP version rather than per resource. Two reads instead of 2N.
 */
/** The newest governed decision for one subject, as preloaded. */
export interface GhxLatestDecision {
  readonly selectedResourceCatalogId: string;
  readonly candidateContextDigest: string;
  readonly decidedByAccountId: string;
  readonly decidedAt: Date;
  readonly generation: number;
  readonly reason: string | null;
  readonly resolutionPolicyVersion: string;
}

export interface ResourceIdentityEvidence {
  readonly catalogCandidates: ReadonlyArray<IdentityCatalogCandidate>;
  readonly sourceSightings: ReadonlyArray<SourceSightingEvidence>;
  readonly reviewedMappings: ReadonlyArray<ReviewedMappingEvidence>;
  /**
   * RM-03D2 — canonical unit facts already proved during THIS evidence set's
   * lifetime, keyed by the exact raw spelling.
   *
   * Its lifetime is deliberately the same as the evidence it rides on: one
   * `loadEvidence` call, which is one AHSP version inside one transaction. A
   * version whose resources tie on the same handful of unit spellings therefore
   * pays for them once, and a longer-lived cache — which could serve a stale
   * alias table across transactions — is unrepresentable.
   *
   * THE KEY INCLUDES THE TRUSTED CONTEXT, and must. One spelling legitimately
   * denotes different canonical units in different contexts — the shipped
   * catalogue has exactly that for "jam" (PERSON_HOUR on LABOR, EQUIPMENT_HOUR
   * on EQUIPMENT) — and a single AHSP version routinely mixes LABOR, MATERIAL
   * and EQUIPMENT lines. Keying on the spelling alone would let a meaning proved
   * for a labour line be served to an equipment line, which is precisely the
   * foreign-context alias UNIT_ALIAS_CONTEXT exists to forbid.
   *
   * Optional: evidence assembled by hand (tests, callers that build their own)
   * simply resolves every time, which is correct, just less economical.
   */
  readonly unitIdentityCache?: Map<string, CanonicalUnitIdentityFact>;
  /**
   * GHX-01 — the decision SUBJECT this resolution is about.
   *
   * Supplied by callers that resolve a real AHSP source fact (the occurrence
   * orchestrator). Absent for callers resolving something else entirely — Basic
   * Price import rows have no ahspResourceId — and absence simply means no
   * governed memory is consulted, which is correct rather than degraded.
   */
  readonly ghxSubject?: {
    readonly workspaceId: string;
    readonly ahspResourceId: string;
    /**
     * The policy the CURRENT resolution is being decided under. A decision
     * recorded under a different law is not silently reused — see
     * `applyGovernedHumanDecision`.
     */
    readonly resolutionPolicyVersion: string;
  };
  /**
   * GHX-01 — latest decision per subject, PRELOADED ONCE for the whole AHSP
   * version.
   *
   * The orchestrator loads evidence once and then resolves each resource in a
   * loop, so querying memory inside that loop would be a textbook N+1: a 50-row
   * RAB with several ambiguities would issue one decision query per ambiguous
   * row. One bounded `findMany` with `distinct: ['ahspResourceId']` returns the
   * newest generation for every subject in the version instead — one query,
   * whatever the row count.
   *
   * Absent (callers that build evidence by hand) simply means no memory is
   * consulted, which is correct rather than degraded.
   */
  readonly ghxLatestDecisions?: ReadonlyMap<string, GhxLatestDecision>;
}

export type EvidenceClient = Pick<
  Prisma.TransactionClient,
  'resourceCatalog' | 'resourceSourceIdentity' | 'basicPriceImportRowResourceMapping'
> &
  Partial<Pick<Prisma.TransactionClient, 'ahspResourceIdentityDecision'>>;

/**
 * The client the RM-03D2 canonical-unit read runs on. Kept separate from
 * `EvidenceClient` because it is a different read at a different moment — and
 * because the caller may legitimately hold one open transaction for both.
 */
type UnitEvidenceClient = Pick<Prisma.TransactionClient, 'unitAlias'>;

/**
 * The label for the evidence contract this service assembles. RM-03D2 advanced
 * it from V1 because the contract genuinely grew a fourth kind of evidence
 * (canonical unit identities) and the conditions for RESOLVED changed with it.
 *
 * HONEST SCOPE: this constant is currently exported and read by nothing — it is
 * persisted on no row and compared in no query. The version that actually
 * labels stored resolutions is E1A_RESOLUTION_POLICY_VERSION, on the
 * orchestrator. This one is a contract marker, not an audit-trail guarantee,
 * and is described as such rather than credited with a protection it does not
 * currently provide.
 */
export const RESOURCE_IDENTITY_POLICY_VERSION =
  'RM03D2_RESOURCE_IDENTITY_EVIDENCE_V2';

/**
 * The only unit context this service will ever supply: the resource's own
 * governed class. Never the raw name, never the candidate's name, never a
 * guess — UNIT_ALIAS_CONTEXT's own contract says context must come from a
 * classification the system already holds. An unrecognised class yields no
 * context at all, which is fail-closed: a context-scoped alias then stays
 * ineligible rather than defaulting to whichever row is found first.
 */
function trustedUnitContext(resourceType: string): UnitAliasContext | undefined {
  const upper = resourceType.trim().toUpperCase();
  return upper in UNIT_ALIAS_CONTEXT
    ? UNIT_ALIAS_CONTEXT[upper as keyof typeof UNIT_ALIAS_CONTEXT]
    : undefined;
}

/**
 * RM-03D1 — the ONE place that gathers resource-identity evidence and asks the
 * kernel to judge it. It is a loader and a delegator: every decision lives in
 * the pure kernel, and nothing here writes.
 *
 * TENANT SCOPE IS ESTABLISHED HERE, ONCE. The kernel is pure and trusts what it
 * is handed, so this loader is the boundary that must never widen: catalog rows
 * are the workspace's own plus genuinely global ones (the predicate
 * ProjectAhspService already used), while sightings and reviewed human
 * decisions are keyed on `workspaceId` with strict equality — never an OR with
 * null, which would make one tenant's evidence usable by every other.
 */
/**
 * THE canonical resource-identity authority. REUSE IT — DO NOT REPLICATE THE
 * MATCHING LOGIC. Every workflow that must answer "which catalog row is this raw
 * name?" calls this service, so one kernel and one evidence law decide it. A
 * second matcher can disagree with this one silently, which is exactly the
 * failure mode a canonical authority exists to prevent. See
 * docs/architecture/SIMPROK-INTELLIGENCE-CAPABILITY-MAP.md (CAP-RESID-01).
 */
@Injectable()
export class ResourceIdentityResolutionService {
  constructor(
    private readonly prisma: PrismaService,
    /**
     * RM-03D2. The Unit authority is CONSULTED here, never reimplemented: this
     * service asks it what a raw spelling denotes and hands the answer to the
     * kernel as a finished fact. Every module that provides this service already
     * imports UnitKernelModule.
     */
    private readonly units: UnitKernelService,
  ) {}

  async loadEvidence(
    client: EvidenceClient,
    workspaceId: string,
    /**
     * GHX-01 — the AHSP source facts this evidence set will be asked about.
     * Supplied by the occurrence orchestrator, which knows the whole version up
     * front. Omitted → no governed memory is preloaded and none is consulted.
     */
    ghxAhspResourceIds?: ReadonlyArray<string>,
  ): Promise<ResourceIdentityEvidence> {
    const [catalogRows, sightingRows, mappingRows] = await Promise.all([
      client.resourceCatalog.findMany({
        // Same tenant predicate the AHSP occurrence path already used: a
        // null-workspace row is genuinely global reference data.
        where: { OR: [{ workspaceId }, { workspaceId: null }] },
        select: {
          id: true,
          code: true,
          name: true,
          type: true,
          baseUnit: true,
          status: true,
          // Loaded because ignoring it was a false-certainty bug: a catalog row
          // could state a grade and a diameter and still be auto-resolved
          // against a source that stated neither. The kernel reads only the
          // VALUES here and never the key names.
          specifications: true,
        },
      }),
      client.resourceSourceIdentity.findMany({
        // Strict equality. A sighting belongs to the workspace that recorded it.
        where: { workspaceId },
        select: {
          resourceCatalogId: true,
          rawName: true,
          rawCode: true,
          rawUnit: true,
          sourceSection: true,
          sourceSha256: true,
          sheetName: true,
          sourceRowNumber: true,
        },
      }),
      client.basicPriceImportRowResourceMapping.findMany({
        where: { workspaceId },
        select: {
          // The decision's own stable identity. Selected purely so an
          // equal-`decidedAt` tie resolves the same way whatever order Postgres
          // returned the rows in — no extra query, no extra round trip.
          id: true,
          resourceCatalogId: true,
          reviewerAccountId: true,
          decidedAt: true,
          reason: true,
          row: {
            select: {
              rawResourceNameText: true,
              rawResourceCodeText: true,
              resolvedResourceType: true,
              sourceSection: true,
            },
          },
        },
      }),
    ]);

    // ONE bounded query for the whole version: newest generation per subject.
    // `distinct` after `orderBy generation desc` is what makes it latest-only —
    // no history is loaded, and no per-row query is ever issued.
    const wantedSubjects = [...new Set(ghxAhspResourceIds ?? [])];
    const decisionRows =
      wantedSubjects.length > 0 && client.ahspResourceIdentityDecision
        ? await client.ahspResourceIdentityDecision.findMany({
            where: { workspaceId, ahspResourceId: { in: wantedSubjects } },
            orderBy: [{ ahspResourceId: 'asc' }, { generation: 'desc' }],
            distinct: ['ahspResourceId'],
            select: {
              ahspResourceId: true,
              selectedResourceCatalogId: true,
              candidateContextDigest: true,
              decidedByAccountId: true,
              decidedAt: true,
              generation: true,
              reason: true,
              resolutionPolicyVersion: true,
            },
          })
        : [];

    return {
      ghxLatestDecisions: new Map(
        decisionRows.map((row) => [row.ahspResourceId, row]),
      ),
      catalogCandidates: catalogRows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        type: row.type,
        baseUnit: row.baseUnit,
        status: row.status,
        specifications: row.specifications,
      })),
      sourceSightings: sightingRows.map((row) => ({
        resourceCatalogId: row.resourceCatalogId,
        rawName: row.rawName,
        rawCode: row.rawCode,
        rawUnit: row.rawUnit,
        sourceSection: row.sourceSection,
        sourceSha256: row.sourceSha256,
        sheetName: row.sheetName,
        sourceRowNumber: row.sourceRowNumber,
      })),
      reviewedMappings: mappingRows.flatMap((row) => {
        // The type the human actually settled on, falling back to the section
        // the workbook itself declared. Never inferred from the catalog row —
        // that would make the mapping agree with itself by construction.
        const resourceType = row.row.resolvedResourceType ?? row.row.sourceSection;
        // USI-01R — a source may state a resource family SIMPROK cannot map, so
        // this can now genuinely be unknown. A past decision whose family cannot
        // be named is not evidence that can support a new one, and admitting it
        // as a null would let it match anything. It is dropped, not defaulted.
        if (resourceType === null) return [];
        return [
          {
            mappingId: row.id,
            resourceCatalogId: row.resourceCatalogId,
            rawName: row.row.rawResourceNameText,
            rawCode: row.row.rawResourceCodeText,
            resourceType,
            reviewerAccountId: row.reviewerAccountId,
            decidedAt: row.decidedAt.toISOString(),
            reason: row.reason,
          },
        ];
      }),
      unitIdentityCache: new Map<string, CanonicalUnitIdentityFact>(),
    };
  }

  /**
   * THE single entry point every caller uses, so occurrence resolution and RAB
   * pre-lock revalidation cannot possibly consult two different laws.
   *
   * Two phases, and at most two kernel calls — never a loop:
   *
   *   1. Ask the pure kernel with the evidence already in hand. Almost every
   *      reference is settled here and nothing further happens.
   *   2. ONLY if the verdict is an exact-name/type representation tie, resolve
   *      the canonical unit identities of the source spelling and of the tied
   *      rows' base units, and ask the same kernel again with those facts.
   *
   * Phase 2 is what makes the extra query rare and bounded: it touches only
   * ties, and it is one query for a handful of distinct spellings — never one
   * per candidate, and never anything at all for the common case.
   *
   * `client` keeps the phase-2 canonical-unit read inside the caller's
   * transaction, so the evidence an identity is ASSERTED on is read under the
   * same snapshot as the rest of the resolution — including the FOR UPDATE
   * window the RAB pre-lock gate freezes in.
   *
   * Scope, stated exactly: this covers the identity leg only. The pre-existing
   * `UnitKernelService.resolve()` the orchestrator calls afterwards for unit
   * EQUIVALENCE still reads through its own client, as it always has. Bringing
   * that older seam onto the caller's transaction is deliberately not part of
   * this slice.
   */
  async resolve(
    evidence: ResourceIdentityEvidence,
    reference: RawResourceReference,
    client?: UnitEvidenceClient,
  ): Promise<ResourceIdentityResolution> {
    const first = resolveResourceIdentity({
      reference,
      catalogCandidates: evidence.catalogCandidates,
      sourceSightings: evidence.sourceSightings,
      reviewedMappings: evidence.reviewedMappings,
    });
    // EVERY outcome routes through the one GHX seam, not just the unit-context
    // path: a genuine ambiguity is a genuine ambiguity whether it arose from an
    // exact-representation tie or from evidence candidates. Returning early here
    // would have made governed memory reachable from only one kind of question.
    if (!isExactRepresentationTie(first)) {
      return this.applyGovernedHumanDecision(
        first,
        { reference, canonicalUnitIdentities: [] },
        evidence,
      );
    }

    // A tie whose source states NO unit can never be settled by one, and the
    // kernel says so from the evidence it already has. Asking the database
    // anyway would be a round-trip that provably cannot change the verdict —
    // and on the RAB pre-lock path it would spend it inside the freeze window.
    if (reference.rawUnit === null || reference.rawUnit.trim() === '') {
      return this.applyGovernedHumanDecision(
        first,
        { reference, canonicalUnitIdentities: [] },
        evidence,
      );
    }

    // The tied rows are exactly the candidates the kernel just returned, so the
    // spellings asked about are bounded by the tie and by nothing else.
    const spellings = [
      reference.rawUnit,
      ...first.candidates.map((candidate) => candidate.baseUnit),
    ];

    // Only spellings this evidence set has not already proved UNDER THIS
    // CONTEXT reach the database, so a version whose resources tie on the same
    // units queries once rather than once per tie — while a different resource
    // class re-proves its own meaning rather than borrowing one.
    const context = trustedUnitContext(reference.resourceType);
    const cache = evidence.unitIdentityCache;
    const keyOf = (spelling: string) => `${context ?? ''}\u0000${spelling}`;
    const wanted = [...new Set(spellings)];
    const missing = wanted.filter((spelling) => !cache?.has(keyOf(spelling)));

    /**
     * The Unit authority's verdict, narrowed to what Resource Identity may
     * lawfully use — WITH the authority story attached.
     *
     * The narrowing is deliberate and stays narrow: no conversion rule, no
     * quantity factor, no equivalence. What is now carried alongside the
     * canonical id is provenance only — the unit's own code, whether a
     * context-scoped alias answered, which trusted class it depended on, and the
     * alias rows that decided it. None of that widens what may be asserted; it
     * makes the assertion checkable afterwards. Dropping it, as this seam did,
     * preserved the right answer while losing part of why the answer was valid,
     * so a meaning that held only for LABOR could later read as though the
     * spelling had been globally unambiguous.
     *
     * `trustedContext` is the authority's OWN `resolvedContext`, never the
     * context this service passed in: a context that was supplied and not needed
     * is not a dependency, and recording it as one would be false provenance.
     */
    const asFact = (identity: {
      rawUnit: string;
      status: 'RESOLVED' | 'NEEDS_REVIEW';
      unitDefinition: { id: string; code: string } | null;
      reasonCode: string;
      contextScoped: boolean;
      resolvedContext: string | null;
      matchedAliasIds: string[];
    }): CanonicalUnitIdentityFact => ({
      rawUnit: identity.rawUnit,
      status: identity.status,
      unitDefinitionId: identity.unitDefinition?.id ?? null,
      unitCode: identity.unitDefinition?.code ?? null,
      reasonCode: identity.reasonCode,
      contextScoped: identity.contextScoped,
      trustedContext: identity.resolvedContext ?? null,
      // Already canonically ordered by the Unit authority; copied so the fact
      // cannot be mutated through the array it was built from.
      matchedAliasIds: [...identity.matchedAliasIds],
    });

    const resolved = new Map<string, CanonicalUnitIdentityFact>();
    if (missing.length > 0) {
      const identities = await this.units.resolveCanonicalUnitIdentities(
        missing,
        context,
        client,
      );
      for (const identity of identities) {
        const fact = asFact(identity);
        resolved.set(fact.rawUnit, fact);
        cache?.set(keyOf(fact.rawUnit), fact);
      }
    }

    const canonicalUnitIdentities = wanted
      .map((spelling) => cache?.get(keyOf(spelling)) ?? resolved.get(spelling))
      .filter((fact): fact is CanonicalUnitIdentityFact => fact !== undefined);

    const withUnitContext = resolveResourceIdentity({
      reference,
      catalogCandidates: evidence.catalogCandidates,
      sourceSightings: evidence.sourceSightings,
      reviewedMappings: evidence.reviewedMappings,
      canonicalUnitIdentities,
    });

    return this.applyGovernedHumanDecision(
      withUnitContext,
      { reference, canonicalUnitIdentities },
      evidence,
    );
  }

  /**
   * GHX-01 — THE ONE PLACE governed human decision memory is fetched.
   *
   * MACHINE FIRST IS ENFORCED HERE TWICE OVER. The lookup only happens when the
   * machine has already failed AND the failure is one a human may lawfully
   * answer, so a resolved identity — including one RM-03D2 settled from the
   * source's own unit — never even causes a query, let alone gets overridden.
   *
   * The read is bounded and indexed: newest generation for ONE exact subject
   * (workspaceId + ahspResourceId). It never loads decision history, never scans,
   * and adds no query at all to the common case.
   *
   * Applicability is proven in two independent places: the digest comparison
   * below (is this still the same question?) and the kernel's own candidate
   * membership + specification guard (is this still a legitimate answer?).
   *
   * IT TAKES NO DATABASE CLIENT, DELIBERATELY. It cannot: the decision for this
   * subject was already fetched with the rest of the version's evidence, under
   * the caller's own snapshot. Accepting a client here would suggest this seam
   * may query — which is exactly the per-resource lookup the preload exists to
   * make impossible.
   */
  private applyGovernedHumanDecision(
    machine: ResourceIdentityResolution,
    kernelInput: {
      reference: RawResourceReference;
      canonicalUnitIdentities: ReadonlyArray<CanonicalUnitIdentityFact>;
    },
    evidence: ResourceIdentityEvidence,
  ): ResourceIdentityResolution {
    const subject = evidence.ghxSubject;
    // No subject supplied (every pre-GHX caller) → nothing changes, no query.
    if (!subject) return machine;
    // Machine proved it, or the refusal is not one a human may lawfully answer.
    if (!isHumanDecidable(machine)) return machine;

    // PRELOADED, NEVER QUERIED HERE. The decision for this subject was fetched
    // once with the rest of the version's evidence, under the SAME transaction
    // snapshot, so this seam adds no query and cannot mix snapshots.
    const latest = evidence.ghxLatestDecisions?.get(subject.ahspResourceId);
    // Only the newest generation is ever consulted. A superseded decision never
    // revives, even if the candidate context later resembles the state it was
    // made under — reviving one would be archaeology, not determinism.
    if (!latest) return machine;

    // POLICY APPLICABILITY, tested on the LATEST generation only.
    //
    // Deliberately NOT "latest decision whose policy matches": that query would
    // reach past a newer decision made under another law and resurrect an older
    // superseded generation hidden behind it. If the newest decision was made
    // under a different policy, the honest answer is that governed memory does
    // not apply here at all.
    if (latest.resolutionPolicyVersion !== subject.resolutionPolicyVersion) {
      return machine;
    }

    const liveDigest = candidateContextDigest(
      machine.candidates.map((candidate) => ({
        resourceCatalogId: candidate.resourceCatalogId,
        name: candidate.name,
        type: candidate.type,
        baseUnit: candidate.baseUnit,
        specifications: candidate.specifications,
      })),
    );
    if (liveDigest !== latest.candidateContextDigest) return machine;

    const fact: VerifiedIdentityDecisionFact = {
      resourceCatalogId: latest.selectedResourceCatalogId,
      decidedByAccountId: latest.decidedByAccountId,
      decidedAt: latest.decidedAt.toISOString(),
      generation: latest.generation,
      reason: latest.reason,
    };

    // Back through the SAME kernel — one resolver, one verdict shape. The kernel
    // re-applies candidate membership and specification safety before it will
    // assert anything.
    return resolveResourceIdentity({
      reference: kernelInput.reference,
      catalogCandidates: evidence.catalogCandidates,
      sourceSightings: evidence.sourceSightings,
      reviewedMappings: evidence.reviewedMappings,
      canonicalUnitIdentities: kernelInput.canonicalUnitIdentities,
      verifiedIdentityDecision: fact,
    });
  }

  /** Convenience for callers outside an open transaction. */
  async resolveForWorkspace(
    workspaceId: string,
    reference: RawResourceReference,
  ): Promise<ResourceIdentityResolution> {
    const evidence = await this.loadEvidence(this.prisma, workspaceId);
    return this.resolve(evidence, reference);
  }
}
