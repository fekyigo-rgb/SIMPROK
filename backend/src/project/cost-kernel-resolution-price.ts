/**
 * Select the frozen unit price that the one Cost Kernel must consume.
 * Basic Price rows keep their adapted scale-2 value. A temporary estimate
 * uses its exact frozen derivation; adaptedPriceValue is only its legacy
 * scale-2 display snapshot. Incomplete estimate provenance fails closed by
 * returning null, which the kernel rejects as MISSING_ADAPTED_PRICE.
 */
export function frozenKernelAdaptedPrice(resolution: {
  priceMode?: string | null;
  adaptedPriceValue: { toString(): string } | string | number | null;
  selectedBasicPriceId?: string | null;
  sourcePriceValue?: unknown | null;
  estimatePolicyId?: string | null;
  estimatePolicyVersion?: number | null;
  estimatePercent?: unknown | null;
  estimateBasisAmount?: unknown | null;
  estimateDerivedAmount?: { toString(): string } | string | number | null;
  estimateApprovalReference?: string | null;
  estimateApprovedByAccountId?: string | null;
  estimateApprovedByPositionId?: string | null;
  estimateAuthorityCode?: string | null;
  estimateApprovedAt?: Date | null;
}): string | null {
  if (resolution.priceMode !== 'TEMPORARY_ESTIMATE') {
    return resolution.adaptedPriceValue?.toString() ?? null;
  }
  if (
    resolution.adaptedPriceValue === null ||
    resolution.selectedBasicPriceId !== null ||
    resolution.sourcePriceValue !== null ||
    !resolution.estimatePolicyId ||
    resolution.estimatePolicyVersion === null ||
    resolution.estimatePolicyVersion === undefined ||
    resolution.estimatePercent === null ||
    resolution.estimatePercent === undefined ||
    resolution.estimateBasisAmount === null ||
    resolution.estimateBasisAmount === undefined ||
    resolution.estimateDerivedAmount === null ||
    resolution.estimateDerivedAmount === undefined ||
    !resolution.estimateApprovalReference ||
    !resolution.estimateApprovedByAccountId ||
    !resolution.estimateApprovedByPositionId ||
    !resolution.estimateAuthorityCode ||
    !(resolution.estimateApprovedAt instanceof Date)
  ) {
    return null;
  }
  return resolution.estimateDerivedAmount.toString();
}
