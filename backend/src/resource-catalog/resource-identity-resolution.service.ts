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
  isExactRepresentationTie,
  resolveResourceIdentity,
} from './resource-identity-resolution.kernel';
import { UnitKernelService } from '../unit-kernel/unit-kernel.service';
import {
  UNIT_ALIAS_CONTEXT,
  UnitAliasContext,
} from '../unit-kernel/unit-kernel.contracts';

/**
 * Everything the identity kernel is allowed to see, loaded ONCE for a whole
 * AHSP version rather than per resource. Two reads instead of 2N.
 */
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
}

type EvidenceClient = Pick<
  Prisma.TransactionClient,
  'resourceCatalog' | 'resourceSourceIdentity' | 'basicPriceImportRowResourceMapping'
>;

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

    return {
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
      reviewedMappings: mappingRows.map((row) => ({
        mappingId: row.id,
        resourceCatalogId: row.resourceCatalogId,
        rawName: row.row.rawResourceNameText,
        rawCode: row.row.rawResourceCodeText,
        // The type the human actually settled on, falling back to the section
        // the workbook itself declared. Never inferred from the catalog row —
        // that would make the mapping agree with itself by construction.
        resourceType: row.row.resolvedResourceType ?? row.row.sourceSection,
        reviewerAccountId: row.reviewerAccountId,
        decidedAt: row.decidedAt.toISOString(),
        reason: row.reason,
      })),
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
    if (!isExactRepresentationTie(first)) return first;

    // A tie whose source states NO unit can never be settled by one, and the
    // kernel says so from the evidence it already has. Asking the database
    // anyway would be a round-trip that provably cannot change the verdict —
    // and on the RAB pre-lock path it would spend it inside the freeze window.
    if (reference.rawUnit === null || reference.rawUnit.trim() === '') {
      return first;
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

    return resolveResourceIdentity({
      reference,
      catalogCandidates: evidence.catalogCandidates,
      sourceSightings: evidence.sourceSightings,
      reviewedMappings: evidence.reviewedMappings,
      canonicalUnitIdentities,
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
