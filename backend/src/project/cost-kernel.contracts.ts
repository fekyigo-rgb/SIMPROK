export const COST_CALCULATION_STATUS = {
  CALCULATED: 'CALCULATED',
  FAIL_CLOSED: 'FAIL_CLOSED',
} as const;

export const COST_CALCULATION_REASON = {
  BOQ_ITEM_NOT_FOUND: 'BOQ_ITEM_NOT_FOUND',
  BOQ_ITEM_NOT_WORK_ITEM: 'BOQ_ITEM_NOT_WORK_ITEM',
  INVALID_VOLUME: 'INVALID_VOLUME',
  MISSING_AHSP_VERSION: 'MISSING_AHSP_VERSION',
  MISSING_AHSP_OUTPUT_UNIT: 'MISSING_AHSP_OUTPUT_UNIT',
  BOQ_AHSP_UNIT_MISMATCH: 'BOQ_AHSP_UNIT_MISMATCH',
  OCCURRENCE_NOT_FOUND: 'OCCURRENCE_NOT_FOUND',
  AMBIGUOUS_OCCURRENCE: 'AMBIGUOUS_OCCURRENCE',
  OWNERSHIP_MISMATCH: 'OWNERSHIP_MISMATCH',
  EMPTY_RESOURCES: 'EMPTY_RESOURCES',
  UNRESOLVED_RESOURCE: 'UNRESOLVED_RESOURCE',
  MISSING_ADAPTED_PRICE: 'MISSING_ADAPTED_PRICE',
  INVALID_COEFFICIENT: 'INVALID_COEFFICIENT',
  RESOURCE_AHSP_VERSION_MISMATCH: 'RESOURCE_AHSP_VERSION_MISMATCH',
  INVALID_DECIMAL: 'INVALID_DECIMAL',
  INTERNAL_CALCULATION_ERROR: 'INTERNAL_CALCULATION_ERROR',
} as const;

export type CostCalculationReason =
  (typeof COST_CALCULATION_REASON)[keyof typeof COST_CALCULATION_REASON];

export const COST_CALCULATION_POLICY = 'COST_KERNEL_GRADE_A_V1' as const;

export interface CostKernelResourceInput {
  ahspResourceId: string;
  resolutionId: string;
  status: string;
  ahspVersionId: string;
  coefficient: string;
  adaptedPriceValue: string | null;
}

export interface CostKernelInput {
  boqItemId: string;
  ahspVersionId: string | null;
  occurrenceId: string | null;
  occurrenceCount: number;
  itemType: string;
  volume: string;
  boqUnit: string;
  outputUnit: string | null;
  ownershipMatches: boolean;
  resources: readonly CostKernelResourceInput[];
}

export interface CalculatedResource {
  ahspResourceId: string;
  resolutionId: string;
  coefficient: string;
  adaptedUnitPrice: string;
  resourceCost: string;
}

export interface CostCalculationSuccess {
  status: typeof COST_CALCULATION_STATUS.CALCULATED;
  boqItemId: string;
  ahspVersionId: string;
  occurrenceId: string;
  volume: string;
  outputUnit: string;
  resources: CalculatedResource[];
  ahspUnitPrice: string;
  lineTotal: string;
  currency: 'IDR';
  calculationPolicy: typeof COST_CALCULATION_POLICY;
}

export interface CostCalculationFailure {
  status: typeof COST_CALCULATION_STATUS.FAIL_CLOSED;
  boqItemId: string;
  reason: CostCalculationReason;
  currency: 'IDR';
  calculationPolicy: typeof COST_CALCULATION_POLICY;
}

export type CostCalculationResult =
  | CostCalculationSuccess
  | CostCalculationFailure;

/**
 * Single source of truth for a batch of eligible BOQ lines: per-item results
 * plus the exact decimal sum of CALCULATED lineTotal values. Frontend must
 * treat directCostTotal as authoritative for the kernel-covered portion of
 * Total/Biaya Langsung and must never recompute it from volume * unitPrice.
 */
export interface CostKernelBatchResult {
  items: CostCalculationResult[];
  directCostTotal: string;
}
