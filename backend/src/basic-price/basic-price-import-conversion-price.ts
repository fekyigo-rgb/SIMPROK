import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UnitKernelService } from '../unit-kernel/unit-kernel.service';
import { trustedUnitContext } from '../unit-kernel/unit-kernel.contracts';
import { adaptPriceWithProvenUnitVerdict } from '../ahsp/price-resolution/proven-unit-price-adaptation';

/**
 * SCOPE-03B: one price boundary for BOTH existing Basic Price import writers.
 *
 * The source row is immutable money evidence, not the normalized per-catalog
 * price. A converted decision's immutable reviewed mapping contains the
 * source rate, target rate, directional rule id/version, factor and policy.
 * Re-prove all of it INSIDE the writer transaction. A historical exact-unit
 * decision continues to use its original source rate without a new engine.
 */
export async function certifiedImportedBasicPrice(
  tx: Prisma.TransactionClient,
  row: {
    id: string;
    resourceCatalogId: string | null;
    unitDefinitionId: string | null;
    rawUnitText: string | null;
    proposedCanonicalPrice: Prisma.Decimal | null;
  },
): Promise<Prisma.Decimal> {
  const INVALID = 'BASIC_PRICE_IMPORT_CONVERSION_PROVENANCE_INVALID';
  if (!row.resourceCatalogId || row.proposedCanonicalPrice === null) {
    throw new ConflictException('ROW_NOT_RESOLVED');
  }
  const records = await tx.basicPriceImportRowResourceMapping.findMany({
    where: { rowId: row.id },
    orderBy: [{ decidedAt: 'desc' }, { id: 'desc' }],
    include: { compensation: true },
  });
  // Historic READY rows predate the UnitDefinition FK. Keep their ORIGINAL
  // exact-money behaviour (already PASS), but never let missing identity
  // conceal a newly recorded directional conversion decision.
  if (!row.unitDefinitionId) {
    if (records.some((r) => r.conversionRuleId !== null)) {
      throw new ConflictException(INVALID);
    }
    return new Prisma.Decimal(row.proposedCanonicalPrice);
  }
  const current = records.filter(
    (r) =>
      r.resourceCatalogId === row.resourceCatalogId &&
      r.unitDefinitionId === row.unitDefinitionId &&
      !r.compensation,
  );
  // If a row has conversion proof, no other active decision may overrule it.
  if (current.length > 1) throw new ConflictException(INVALID);
  const mapping = current[0];
  if (!mapping) {
    // A previously accepted historic import may have no reviewer mapping;
    // never invent conversion for it. Existing paths remain unchanged.
    if (records.some((r) => r.conversionRuleId !== null)) {
      throw new ConflictException(INVALID);
    }
    return new Prisma.Decimal(row.proposedCanonicalPrice);
  }
  if (mapping.conversionRuleId === null) {
    // Partial proof must never be interpreted as the old exact-unit case.
    if (
      mapping.conversionSourcePriceValue !== null ||
      mapping.conversionAdaptedPriceValue !== null ||
      mapping.conversionQuantityFactor !== null ||
      mapping.conversionRuleVersion !== null ||
      mapping.conversionPolicyVersion !== null
    ) throw new ConflictException(INVALID);
    return new Prisma.Decimal(row.proposedCanonicalPrice);
  }
  if (
    !row.rawUnitText?.trim() ||
    mapping.conversionSourcePriceValue === null ||
    mapping.conversionAdaptedPriceValue === null ||
    mapping.conversionQuantityFactor === null ||
    mapping.conversionRuleVersion === null ||
    !mapping.conversionPolicyVersion ||
    !mapping.conversionSourcePriceValue.equals(row.proposedCanonicalPrice)
  ) throw new ConflictException(INVALID);

  const [catalog, unit] = await Promise.all([
    tx.resourceCatalog.findUnique({
      where: { id: row.resourceCatalogId },
      select: { id: true, baseUnit: true, type: true },
    }),
    tx.unitDefinition.findUnique({
      where: { id: row.unitDefinitionId },
      select: { id: true, code: true, isActive: true },
    }),
  ]);
  if (
    !catalog ||
    !unit?.isActive ||
    catalog.baseUnit !== unit.code ||
    !trustedUnitContext(catalog.type)
  ) throw new ConflictException(INVALID);

  const proof = await new UnitKernelService(tx as unknown as PrismaService).resolve(
    row.rawUnitText.trim(),
    unit.code,
    catalog.id,
    trustedUnitContext(catalog.type),
  );
  if (
    proof.status !== 'RESOLVED' ||
    proof.targetUnitDefinition?.id !== unit.id ||
    proof.priceOperation !== 'DIVIDE_SOURCE_UNIT_PRICE_BY_QUANTITY_FACTOR' ||
    proof.conversionRuleId !== mapping.conversionRuleId ||
    proof.conversionRuleVersion !== mapping.conversionRuleVersion ||
    proof.policyVersion !== mapping.conversionPolicyVersion ||
    proof.quantityFactor === null ||
    !new Prisma.Decimal(proof.quantityFactor).equals(mapping.conversionQuantityFactor)
  ) throw new ConflictException(INVALID);

  const adapted = adaptPriceWithProvenUnitVerdict(
    row.proposedCanonicalPrice.toString(),
    row.rawUnitText.trim(),
    unit.code,
    proof,
  );
  if (
    adapted.status !== 'RESOLVED' ||
    !new Prisma.Decimal(adapted.adaptedPrice).equals(mapping.conversionAdaptedPriceValue)
  ) throw new ConflictException(INVALID);
  return new Prisma.Decimal(adapted.adaptedPrice);
}
