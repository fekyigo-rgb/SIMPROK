import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  RawResourceReference,
  ResourceIdentityResolution,
  IdentityCatalogCandidate,
  SourceSightingEvidence,
  ReviewedMappingEvidence,
  resolveResourceIdentity,
} from './resource-identity-resolution.kernel';

/**
 * Everything the identity kernel is allowed to see, loaded ONCE for a whole
 * AHSP version rather than per resource. Two reads instead of 2N.
 */
export interface ResourceIdentityEvidence {
  readonly catalogCandidates: ReadonlyArray<IdentityCatalogCandidate>;
  readonly sourceSightings: ReadonlyArray<SourceSightingEvidence>;
  readonly reviewedMappings: ReadonlyArray<ReviewedMappingEvidence>;
}

type EvidenceClient = Pick<
  Prisma.TransactionClient,
  'resourceCatalog' | 'resourceSourceIdentity' | 'basicPriceImportRowResourceMapping'
>;

export const RESOURCE_IDENTITY_POLICY_VERSION =
  'RM03D1_RESOURCE_IDENTITY_EVIDENCE_V1';

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
  constructor(private readonly prisma: PrismaService) {}

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
    };
  }

  /** Pure delegation — kept on the service so callers have one entry point. */
  resolve(
    evidence: ResourceIdentityEvidence,
    reference: RawResourceReference,
  ): ResourceIdentityResolution {
    return resolveResourceIdentity({
      reference,
      catalogCandidates: evidence.catalogCandidates,
      sourceSightings: evidence.sourceSightings,
      reviewedMappings: evidence.reviewedMappings,
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
