import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient, ResourceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { findProvenanceCandidate } from './basic-price-source-provenance.service';

export interface MappingCandidate {
  resourceCatalogId: string;
  code: string | null;
  name: string;
  type: ResourceType;
  baseUnit: string;
}

export interface RowMappingCandidates {
  rowId: string;
  matchBasis: 'NORMALIZED_NAME';
  /** Normalized-name candidates — review signal only, never picked automatically. */
  candidates: MappingCandidate[];
  /**
   * SOURCE_ROW_PROVENANCE candidate — only ever non-null when a human has
   * recorded a BasicPriceSourceEquivalence for this row's batch source
   * hash. Fail-closed: no equivalence record means this is always null,
   * regardless of what `candidates` contains.
   */
  provenanceCandidate: MappingCandidate | null;
  /** True once a human has authorized cross-hash provenance for this batch's source, even if no candidate matched this particular row. */
  provenanceEquivalenceFound: boolean;
  /**
   * True when provenanceCandidate exists and disagrees with every entry in
   * `candidates` (or `candidates` is non-empty and none of them match it).
   * Both signals are always returned as-is above; this flag never causes
   * either one to be hidden or silently preferred.
   */
  conflict: boolean;
}

type QueryClient = PrismaClient | Prisma.TransactionClient;

export function normalizeResourceName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Exact match on normalized name (trim + collapse whitespace + lowercase)
 * within the workspace and resource type — never fuzzy/similarity scoring.
 * Returns every match, however many there are; the caller decides what
 * "unambiguous" means (exactly one candidate). Pure review signal: this
 * function never writes anything.
 *
 * Accepts either the top-level PrismaService or an open
 * Prisma.TransactionClient so the exact same matching logic can run inside
 * BasicPriceRowResolutionService's resolve transaction (to determine
 * suggestionSource at decision time) and outside it (the read-only
 * candidates endpoint) without duplicating the query.
 */
export async function findMappingCandidates(
  client: QueryClient,
  workspaceId: string,
  type: ResourceType,
  rawName: string,
): Promise<MappingCandidate[]> {
  const normalized = normalizeResourceName(rawName);
  return client.$queryRaw<MappingCandidate[]>(Prisma.sql`
    SELECT "id" AS "resourceCatalogId", "code", "name", "type", "baseUnit"
    FROM "resource_catalogs"
    WHERE "workspaceId" = ${workspaceId}::uuid
      AND "status" = 'ACTIVE'
      AND "type" = ${type}::"ResourceType"
      AND lower(regexp_replace(trim("name"), '\\s+', ' ', 'g')) = ${normalized}
    ORDER BY "name" ASC, "id" ASC
  `);
}

/**
 * RM-02D1 / RM-02D1-REMEDIATION-V3.1 — mapping-candidate signals for an
 * unresolved BasicPriceImportRow, exposed as a read-only lookup for the
 * review UI: normalized-name matches AND (fail-closed) source-row
 * provenance. This is a REVIEW SIGNAL ONLY: it never writes anything,
 * never resolves a row, and neither signal — nor their agreement or
 * disagreement — is ever auto-applied. The human reviewer still calls
 * resolveRow explicitly with an exact resourceCatalogId.
 */
@Injectable()
export class BasicPriceRowMappingCandidatesService {
  constructor(private readonly prisma: PrismaService) {}

  async findCandidatesForRow(workspaceId: string, batchId: string, rowId: string): Promise<RowMappingCandidates> {
    const row = await this.prisma.basicPriceImportRow.findFirst({
      where: { id: rowId, batchId },
      select: {
        id: true,
        sourceSection: true,
        sourceRowNumber: true,
        rawResourceCodeText: true,
        rawResourceNameText: true,
        rawUnitText: true,
        batch: { select: { workspaceId: true, sourceSha256: true, selectedSheetName: true, parserContractVersion: true } },
      },
    });
    if (!row || row.batch.workspaceId !== workspaceId) throw new NotFoundException('Row not found');

    const [candidates, provenance] = await Promise.all([
      findMappingCandidates(this.prisma, workspaceId, row.sourceSection as unknown as ResourceType, row.rawResourceNameText),
      findProvenanceCandidate(this.prisma, {
        workspaceId,
        batchSourceSha256: row.batch.sourceSha256,
        sheetName: row.batch.selectedSheetName,
        parserContractVersion: row.batch.parserContractVersion,
        sourceRowNumber: row.sourceRowNumber,
        rawResourceCodeText: row.rawResourceCodeText,
        rawResourceNameText: row.rawResourceNameText,
        rawUnitText: row.rawUnitText,
      }),
    ]);

    const conflict =
      provenance.candidate !== null && candidates.length > 0 && !candidates.some((c) => c.resourceCatalogId === provenance.candidate!.resourceCatalogId);

    return {
      rowId,
      matchBasis: 'NORMALIZED_NAME',
      candidates,
      provenanceCandidate: provenance.candidate,
      provenanceEquivalenceFound: provenance.equivalenceFound,
      conflict,
    };
  }
}
