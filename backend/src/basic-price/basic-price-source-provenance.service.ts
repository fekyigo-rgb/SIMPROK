import { Prisma, PrismaClient } from '@prisma/client';
import { MappingCandidate } from './basic-price-row-mapping-candidates.service';

type QueryClient = PrismaClient | Prisma.TransactionClient;

export interface ProvenanceLookupResult {
  candidate: MappingCandidate | null;
  equivalenceFound: boolean;
  canonicalSourceSha256: string | null;
}

/**
 * RM-02D1-REMEDIATION-V3.1 — SOURCE_ROW_PROVENANCE lookup.
 *
 * Fail-closed by construction: this NEVER looks at ResourceSourceIdentity
 * rows recorded under a different sourceSha256 than the one a
 * BasicPriceSourceEquivalence record explicitly authorizes for this exact
 * (workspaceId, batchSourceSha256) pair. Zero equivalence records for this
 * batch hash means this function returns `candidate: null` unconditionally
 * — it never falls back to guessing, never compares hashes itself, never
 * treats "looks similar" as authorization. A human comparing the two
 * workbooks and recording a BasicPriceSourceEquivalence row is the only
 * thing that can ever make this function return a non-null candidate.
 *
 * Even once an equivalence record exists, the match against
 * ResourceSourceIdentity is exact on every raw field (code/name/unit) plus
 * sourceRowNumber/sheetName/parserContractVersion — never fuzzy, never
 * name-only. If the row's own raw fields don't exactly match what was
 * recorded under the canonical hash at that row number, this returns
 * `candidate: null` (falls through to normalized-name/manual signals),
 * never a best-effort guess.
 */
export async function findProvenanceCandidate(
  client: QueryClient,
  params: {
    workspaceId: string;
    batchSourceSha256: string;
    sheetName: string;
    parserContractVersion: string;
    sourceRowNumber: number;
    rawResourceCodeText: string | null;
    rawResourceNameText: string;
    rawUnitText: string | null;
  },
): Promise<ProvenanceLookupResult> {
  const equivalence = await client.basicPriceSourceEquivalence.findUnique({
    where: { workspaceId_batchSourceSha256: { workspaceId: params.workspaceId, batchSourceSha256: params.batchSourceSha256 } },
  });
  if (!equivalence) {
    return { candidate: null, equivalenceFound: false, canonicalSourceSha256: null };
  }

  const identity = await client.resourceSourceIdentity.findFirst({
    where: {
      workspaceId: params.workspaceId,
      sourceSha256: equivalence.canonicalSourceSha256,
      sheetName: params.sheetName,
      parserContractVersion: params.parserContractVersion,
      sourceRowNumber: params.sourceRowNumber,
      rawCode: params.rawResourceCodeText,
      rawName: params.rawResourceNameText,
      rawUnit: params.rawUnitText,
    },
    select: { resourceCatalogId: true },
  });
  if (!identity) {
    return { candidate: null, equivalenceFound: true, canonicalSourceSha256: equivalence.canonicalSourceSha256 };
  }

  const catalog = await client.resourceCatalog.findFirst({
    where: { id: identity.resourceCatalogId, workspaceId: params.workspaceId, status: 'ACTIVE' },
    select: { id: true, code: true, name: true, type: true, baseUnit: true },
  });
  if (!catalog) {
    return { candidate: null, equivalenceFound: true, canonicalSourceSha256: equivalence.canonicalSourceSha256 };
  }

  return {
    candidate: { resourceCatalogId: catalog.id, code: catalog.code, name: catalog.name, type: catalog.type, baseUnit: catalog.baseUnit },
    equivalenceFound: true,
    canonicalSourceSha256: equivalence.canonicalSourceSha256,
  };
}
