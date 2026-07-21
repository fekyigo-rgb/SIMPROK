export type CostCalculationResponse =
  | {
      status: "CALCULATED";
      boqItemId: string;
      volume: string;
      outputUnit: string;
      ahspUnitPrice: string;
      lineTotal: string;
      calculationPolicy: "COST_KERNEL_GRADE_A_V1";
    }
  | {
      status: "FAIL_CLOSED";
      boqItemId: string;
      reason: string;
      calculationPolicy: "COST_KERNEL_GRADE_A_V1";
    };

export interface CostBatchResponse {
  items: CostCalculationResponse[];
  directCostTotal: string;
}

/**
 * Per-row lifecycle for a Cost Kernel eligible line. A row only ever reaches
 * "calculated" immediately after a fetch resolves against still-unedited
 * data; any volume/unit/AHSP edit moves it straight to "invalidated" so a
 * stale price can never be displayed or summed as authoritative.
 */
export type CostRowStatus =
  | { kind: "loading" }
  | { kind: "calculated"; response: Extract<CostCalculationResponse, { status: "CALCULATED" }> }
  | { kind: "fail_closed"; reason: string }
  | { kind: "invalidated" }
  | { kind: "request_failed" };

export const formatBackendRupiah = (value: string) => {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return "Nilai tidak valid";
  const grouped = match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const fraction = match[3] ? `,${match[3]}` : "";
  return `Rp ${match[1]}${grouped}${fraction}`;
};

export const toRabCostDisplay = (status: CostRowStatus) => {
  switch (status.kind) {
    case "calculated":
      return {
        badge: "Dihitung SIMPROK",
        unitPrice: formatBackendRupiah(status.response.ahspUnitPrice),
        lineTotal: formatBackendRupiah(status.response.lineTotal),
      };
    case "fail_closed":
      return { badge: status.reason, unitPrice: "—", lineTotal: "—" };
    case "invalidated":
      return { badge: "Perlu dihitung ulang", unitPrice: "—", lineTotal: "—" };
    case "loading":
      return { badge: "Menghitung SIMPROK...", unitPrice: "—", lineTotal: "—" };
    case "request_failed":
      return { badge: "Gagal memuat kalkulasi", unitPrice: "—", lineTotal: "—" };
  }
};

/**
 * Exact base-10 decimal string addition (BigInt-scaled). Used to combine
 * Cost Kernel exact decimal values without ever passing them through a
 * JavaScript `Number`, which would risk float precision drift.
 */
export const addDecimalStrings = (a: string, b: string): string => {
  const parse = (value: string) => {
    const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
    if (!match) throw new Error(`Invalid decimal string: ${value}`);
    return { negative: match[1] === "-", intPart: match[2], fracPart: match[3] ?? "" };
  };
  const pa = parse(a);
  const pb = parse(b);
  const scale = Math.max(pa.fracPart.length, pb.fracPart.length);
  const toScaledBigInt = (p: ReturnType<typeof parse>) => {
    const digits = BigInt(p.intPart + p.fracPart.padEnd(scale, "0"));
    return p.negative ? -digits : digits;
  };
  const sum = toScaledBigInt(pa) + toScaledBigInt(pb);
  const negative = sum < 0n;
  const digits = (negative ? -sum : sum).toString().padStart(scale + 1, "0");
  const intDigits = digits.slice(0, digits.length - scale) || "0";
  const fracDigits = scale > 0 ? digits.slice(digits.length - scale) : "";
  const magnitude = fracDigits ? `${intDigits}.${fracDigits}` : intDigits;
  return negative && sum !== 0n ? `-${magnitude}` : magnitude;
};

export const sumDecimalStrings = (values: readonly string[]): string =>
  values.reduce((total, value) => addDecimalStrings(total, value), "0");

/**
 * Builds a fresh status map with the given row ids marked in-flight. Every
 * load cycle (initial load, baseline seed, post-save refresh) starts a new
 * map rather than merging into the old one: saving fully replaces every
 * BoqItem with a new id, so carrying old entries forward would only leak
 * stale, unreachable state.
 */
export const beginLoadingRows = (rowIds: readonly string[]): Record<string, CostRowStatus> => {
  const next: Record<string, CostRowStatus> = {};
  for (const id of rowIds) next[id] = { kind: "loading" };
  return next;
};

/**
 * Applies a batch response to row status. A result is only applied if the
 * row is still "loading" — if the user edited that row while the request
 * was in flight, invalidateRow() already moved it to "invalidated", and a
 * late-arriving response for the old data must not resurrect it.
 */
export const applyBatchResults = (
  current: Record<string, CostRowStatus>,
  results: readonly CostCalculationResponse[],
): Record<string, CostRowStatus> => {
  const next = { ...current };
  for (const result of results) {
    if (next[result.boqItemId]?.kind !== "loading") continue;
    next[result.boqItemId] =
      result.status === "CALCULATED"
        ? { kind: "calculated", response: result }
        : { kind: "fail_closed", reason: result.reason };
  }
  return next;
};

/** Fail-closed for a failed fetch: only rows still "loading" are affected. */
export const markRequestFailed = (
  current: Record<string, CostRowStatus>,
  rowIds: readonly string[],
): Record<string, CostRowStatus> => {
  const next = { ...current };
  for (const id of rowIds) {
    if (next[id]?.kind === "loading") next[id] = { kind: "request_failed" };
  }
  return next;
};

/**
 * Invalidates a row's Cost Kernel result after a volume/unit/AHSP edit.
 * A no-op for rows that never had a kernel entry (manual rows), so this is
 * safe to call unconditionally from every relevant input's onChange.
 */
export const invalidateRow = (
  current: Record<string, CostRowStatus>,
  rowId: string,
): Record<string, CostRowStatus> => {
  if (!(rowId in current)) return current;
  if (current[rowId].kind === "invalidated") return current;
  return { ...current, [rowId]: { kind: "invalidated" } };
};

/**
 * Direct-cost total across mixed kernel/manual rows. Kernel-eligible rows
 * contribute their exact backend lineTotal only while "calculated"; any
 * other kernel state (loading/invalidated/fail_closed/request_failed)
 * honestly contributes zero rather than falling back to a manual number.
 * Manual rows keep the existing volume * unitPrice(JS number) path.
 */
export const computeDirectCostTotal = (
  rows: readonly {
    id: string;
    isKernelEligible: boolean;
    manualAmount: number;
  }[],
  costRowStatuses: Record<string, CostRowStatus>,
): string => {
  const kernelLineTotals: string[] = [];
  let manualTotal = 0;
  for (const row of rows) {
    if (row.isKernelEligible) {
      const status = costRowStatuses[row.id];
      if (status?.kind === "calculated") {
        kernelLineTotals.push(status.response.lineTotal);
      }
    } else {
      manualTotal += row.manualAmount;
    }
  }
  return addDecimalStrings(sumDecimalStrings(kernelLineTotals), manualTotal.toString());
};

export const formatBoqImportMeasurement = (
  itemType: string,
  quantity: string | null,
  unit: string | null,
): string => itemType === 'WORK_ITEM' ? ` — ${quantity ?? '—'} ${unit ?? ''}` : '';
