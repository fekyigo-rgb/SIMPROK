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

/**
 * The one shared shape/parse/grouping rule for every exact-decimal string
 * formatter in this codebase (money and quantity alike) — extracted so a
 * second adapter (rabPersistedDraftDisplay.ts) can group thousands for a
 * quantity without a "Rp" prefix, without re-implementing the regex or the
 * grouping rule. Rejects anything that isn't plain fixed-point notation, so
 * scientific notation ("1e5") is refused rather than silently formatted.
 */
export interface ParsedDecimalString {
  negative: boolean;
  intPart: string;
  fracPart: string;
}

export const DECIMAL_STRING_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * GATE2A-AB-RUNTIME-WIRE-TYPE-01: `value` is typed `unknown`, not `string`,
 * because the canonical wire contract (exact decimal string) is a runtime
 * promise the JSON payload can violate even though TypeScript's static types
 * say otherwise. RegExp.prototype.exec coerces any non-string argument to a
 * string first — a JSON number like 9007199254740993.01 would already have
 * lost precision as a JS double (and re-stringify to a different digit
 * string) before the regex ever saw it. The explicit `typeof` check rejects
 * every non-string runtime value up front, so that silent coercion path
 * never executes.
 */
export const parseCanonicalDecimalString = (value: unknown): ParsedDecimalString | null => {
  if (typeof value !== "string") return null;
  const match = DECIMAL_STRING_PATTERN.exec(value);
  if (!match) return null;
  return { negative: match[1] === "-", intPart: match[2], fracPart: match[3] ?? "" };
};

/** Thousands-grouping on a digit-only integer string — never touches the fraction. */
export const groupThousands = (intPart: string): string =>
  intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

export const formatBackendRupiah = (value: string) => {
  const parsed = parseCanonicalDecimalString(value);
  if (!parsed) return "Nilai tidak valid";
  const fraction = parsed.fracPart ? `,${parsed.fracPart}` : "";
  return `Rp ${parsed.negative ? "-" : ""}${groupThousands(parsed.intPart)}${fraction}`;
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

export interface PricingCompletenessRow {
  id: string;
  isKernelEligible: boolean;
  manualUnitPrice: boolean;
}

/**
 * A draft's recap (subtotal, margin, PPN, grand total) is only authoritative
 * once every WORK_ITEM row has a real price — a calculated Cost Kernel
 * price, or an explicitly manually-entered one. An unpriced row (e.g. a
 * freshly BOQ-imported item nobody has priced yet) must never silently
 * contribute Rp0 to a total that's displayed as if it were complete
 * (RM-01a-CODE null-integrity law).
 */
export const isDraftPricingComplete = (
  rows: readonly PricingCompletenessRow[],
  costRowStatuses: Record<string, CostRowStatus>,
): boolean =>
  rows.every((row) =>
    row.isKernelEligible ? costRowStatuses[row.id]?.kind === "calculated" : row.manualUnitPrice,
  );

export const formatBoqImportMeasurement = (
  itemType: string,
  quantity: string | null,
  unit: string | null,
): string => itemType === 'WORK_ITEM' ? ` — ${quantity ?? '—'} ${unit ?? ''}` : '';

/**
 * GATE2A-PRODUCTIZATION-C: pure UX reachability for the "Hitung & Simpan
 * Harga SIMPROK" persist action in RabWorkspacePage. NOT_BACKEND_ELIGIBILITY_
 * AUTHORITY=YES — this never decides whether a calculation is actually
 * allowed to persist. RabKernelPersistenceService remains the sole authority
 * for AHSP presence, occurrence uniqueness, Basic Price eligibility, and
 * every other business rule; this function only decides whether the button
 * is reachable from state already visible on screen.
 */
export type PersistActionReachability =
  | 'READY'
  | 'NO_PROJECT'
  | 'DRAFT_NOT_EDITABLE'
  | 'NO_SELECTED_WORK_ITEM'
  | 'AHSP_NOT_SELECTED'
  | 'COST_RESULT_LOADING'
  | 'COST_RESULT_INVALIDATED'
  | 'COST_RESULT_FAIL_CLOSED'
  | 'COST_REQUEST_FAILED'
  | 'COST_RESULT_MISSING'
  | 'INVALID_CALCULATION_DATE'
  | 'UNSAVED_DRAFT_CHANGES'
  | 'PERSIST_IN_FLIGHT';

export interface PersistActionSelectedItem {
  id: string;
  ahspVersionId: string | null;
}

export interface PersistActionReachabilityInput {
  projectId: string | null;
  canEditDraft: boolean;
  selectedItem: PersistActionSelectedItem | null;
  costRowStatus: CostRowStatus | undefined;
  calculationAsOfDate: string;
  draftDirty: boolean;
  persistInFlight: boolean;
}

const CALCULATION_DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

export const evaluatePersistActionReachability = (
  input: PersistActionReachabilityInput,
): PersistActionReachability => {
  if (!input.projectId) return 'NO_PROJECT';
  if (!input.canEditDraft) return 'DRAFT_NOT_EDITABLE';
  if (!input.selectedItem) return 'NO_SELECTED_WORK_ITEM';
  if (!input.selectedItem.ahspVersionId) return 'AHSP_NOT_SELECTED';
  const status = input.costRowStatus;
  if (!status) return 'COST_RESULT_MISSING';
  if (status.kind === 'loading') return 'COST_RESULT_LOADING';
  if (status.kind === 'invalidated') return 'COST_RESULT_INVALIDATED';
  if (status.kind === 'fail_closed') return 'COST_RESULT_FAIL_CLOSED';
  if (status.kind === 'request_failed') return 'COST_REQUEST_FAILED';
  // Only "calculated" remains here — a real calendar check (e.g. rejecting
  // 2026-02-30) is intentionally NOT duplicated here; it stays
  // backend-authoritative. This is a UI-format gate only.
  if (!CALCULATION_DATE_SHAPE.test(input.calculationAsOfDate)) return 'INVALID_CALCULATION_DATE';
  if (input.draftDirty) return 'UNSAVED_DRAFT_CHANGES';
  if (input.persistInFlight) return 'PERSIST_IN_FLIGHT';
  return 'READY';
};

/**
 * Gate-2A locked contract (see backend PersistBoqItemCalculationDto): the
 * persist request body may carry calculationAsOfDate and nothing else.
 */
export interface PersistCalculationRequestBody {
  calculationAsOfDate: string;
}

export const buildPersistCalculationRequestBody = (
  calculationAsOfDate: string,
): PersistCalculationRequestBody => ({ calculationAsOfDate });

/**
 * Local calendar YYYY-MM-DD — deliberately NOT `date.toISOString().slice(0, 10)`,
 * which reads UTC fields and can silently shift to the wrong calendar day for
 * a user whose local time zone sits far enough from UTC (e.g. 00:30 local in
 * UTC+9 is still the previous day in UTC).
 */
export const toLocalDateOnlyString = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export type PersistOutcomeState =
  | 'IDLE'
  | 'PERSISTING'
  | 'RELOADING'
  | 'SUCCESS'
  | 'FAILED_CONFIRMED'
  | 'OUTCOME_UNKNOWN';

export type PersistPostOutcome = { kind: 'network_error' } | { kind: 'response'; ok: boolean };

export type PersistReloadOutcome =
  | { kind: 'not_attempted' }
  | { kind: 'success' }
  | { kind: 'error' };

/**
 * A response is only ever reported SUCCESS once the persist POST returned
 * 2xx AND the follow-up reloadDraft() confirmed it. A network failure (the
 * response may have been lost after the server already committed) or a
 * post-2xx reload failure both resolve to OUTCOME_UNKNOWN — never silently
 * downgraded to "not saved", and never auto-retried by the caller.
 */
export const classifyPersistOutcome = (
  post: PersistPostOutcome,
  reload: PersistReloadOutcome,
): Extract<PersistOutcomeState, 'SUCCESS' | 'FAILED_CONFIRMED' | 'OUTCOME_UNKNOWN'> => {
  if (post.kind === 'network_error') return 'OUTCOME_UNKNOWN';
  if (!post.ok) return 'FAILED_CONFIRMED';
  if (reload.kind === 'success') return 'SUCCESS';
  return 'OUTCOME_UNKNOWN';
};

export const GENERIC_PERSIST_FAILURE_REASON = 'Gagal memproses permintaan. Coba lagi.';

/**
 * Defensively reads a NestJS error body's `message` (string | string[] |
 * anything else) into one honest, bounded display string. Never fabricates
 * a specific reason when the body doesn't have one.
 */
export const derivePersistFailureReason = (body: unknown): string => {
  const message =
    body && typeof body === 'object' ? (body as { message?: unknown }).message : undefined;
  if (typeof message === 'string' && message.trim().length > 0) return message;
  if (Array.isArray(message)) {
    const safeEntries = message.filter(
      (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
    );
    if (safeEntries.length > 0) return safeEntries.join('; ');
  }
  return GENERIC_PERSIST_FAILURE_REASON;
};

export type BoqRowsSource = 'WORKING_DRAFT' | 'BASELINE_SEED';

/**
 * C-BLOCKER-03: a baseline seed (rows shown only as a starting point before
 * any Save Draft) must never be treated as an already-persisted Working
 * Draft — it stays dirty, and the persist action stays blocked through the
 * existing UNSAVED_DRAFT_CHANGES reachability state, until the user
 * explicitly saves it.
 */
export const isDraftDirtyForSource = (source: BoqRowsSource): boolean => source === 'BASELINE_SEED';

/**
 * C-BLOCKER-02: exact equality only — no truthy/falsy coercion. A caller
 * must never skip this comparison just because a revision number happens
 * to be 0.
 */
export const isDraftRevisionCurrent = (capturedRevision: number, currentRevision: number): boolean =>
  capturedRevision === currentRevision;

export interface PersistedRowConfirmationTarget {
  boqItemId: string;
  calculationAsOfDate: string;
}

export interface ConfirmedPersistedRow {
  unitPrice: string;
  lineTotal: string;
  calculationOccurrenceId: string;
}

/**
 * C-BLOCKER-01: the reloaded Working Draft read model — never the raw POST
 * response body — is the sole authority for whether a persist attempt
 * really succeeded. Reuses the existing canonical decimal parser rather
 * than a second regex/formatter; fails closed on a malformed value, a
 * wrong item, a wrong date, a non-SERVER_COST_KERNEL origin, a JSON-number
 * money field, or an empty occurrence id.
 */
export const confirmPersistedRow = (
  value: unknown,
  target: PersistedRowConfirmationTarget,
): ConfirmedPersistedRow | null => {
  if (!value || typeof value !== 'object') return null;
  const row = value as {
    id?: unknown;
    priceOrigin?: unknown;
    calculationAsOfDate?: unknown;
    unitPrice?: unknown;
    lineTotal?: unknown;
    calculationOccurrenceId?: unknown;
  };
  if (row.id !== target.boqItemId) return null;
  if (row.priceOrigin !== 'SERVER_COST_KERNEL') return null;
  if (row.calculationAsOfDate !== target.calculationAsOfDate) return null;
  if (!parseCanonicalDecimalString(row.unitPrice)) return null;
  if (!parseCanonicalDecimalString(row.lineTotal)) return null;
  if (typeof row.calculationOccurrenceId !== 'string' || row.calculationOccurrenceId.length === 0) return null;
  return {
    unitPrice: row.unitPrice as string,
    lineTotal: row.lineTotal as string,
    calculationOccurrenceId: row.calculationOccurrenceId,
  };
};

export interface PersistResultIdentity {
  projectId: string;
  boqItemId: string;
  calculationAsOfDate: string;
  draftRevision: number;
  /**
   * FINAL-TERMINAL-STATE-INVALIDATION: monotonic, never decremented, never
   * reset — the permanent tiebreaker. projectId/boqItemId/calculationAsOfDate/
   * draftRevision are all reversible (a date can be changed back, an item
   * re-selected, a project re-visited) — persistContextRevision is the one
   * field that can never coincidentally return to an old value once it has
   * moved past it, so a stale terminal result can never reappear merely
   * because every *other* value happened to round-trip back to what it was.
   */
  persistContextRevision: number;
}

/**
 * C-BLOCKER-04 / FINAL-TERMINAL-STATE-INVALIDATION: a terminal SUCCESS/
 * FAILED_CONFIRMED result stays displayable only while the current UI
 * identity still matches exactly the identity it was produced against. Any
 * drift — a different project, a different selected item, an edited
 * calculation date, a newer draft revision, or a newer persist-context
 * revision — makes the result stale; it must not resurface even if every
 * reversible value later returns to what it was. OUTCOME_UNKNOWN is
 * intentionally exempt from this check (see RabWorkspacePage) — it must
 * remain visible as a warning for the affected item regardless of the very
 * revision change that produced it.
 */
export const isPersistResultFresh = (
  target: PersistResultIdentity,
  current: PersistResultIdentity,
): boolean =>
  target.projectId === current.projectId &&
  target.boqItemId === current.boqItemId &&
  target.calculationAsOfDate === current.calculationAsOfDate &&
  target.draftRevision === current.draftRevision &&
  target.persistContextRevision === current.persistContextRevision;

/**
 * FINAL-TERMINAL-STATE-INVALIDATION: the one and only definition of which
 * terminal persist states must be invalidated on a context change
 * (item/date/project) vs preserved. success/failed_confirmed are confirmed
 * claims tied to the old context and must be dropped; idle/persisting/
 * reloading have nothing confirmed to lose; outcome_unknown is an honest
 * warning that must survive a same-project context drift (see
 * RabWorkspacePage's markPersistContextChanged / project-change handling).
 */
export const shouldInvalidateTerminalPersistResult = (
  kind: 'idle' | 'persisting' | 'reloading' | 'success' | 'failed_confirmed' | 'outcome_unknown',
): boolean => kind === 'success' || kind === 'failed_confirmed';

/**
 * SELECTED-ITEM-RELOAD-STABILITY: a post-reload selection must prefer the
 * row the user already had selected, if it still exists — never
 * unconditionally jump to the first WORK_ITEM (that would move the drawer
 * away from a just-persisted, non-first item right when its success result
 * becomes visible). Falls back to the first WORK_ITEM only when the current
 * selection is gone, and to an empty selection only when there is no
 * WORK_ITEM at all. Never depends on array index and never fabricates an id.
 */
export const resolveSelectedRowIdAfterReload = (
  currentSelectedRowId: string,
  availableRows: readonly { id: string; type: string }[],
): string => {
  if (currentSelectedRowId && availableRows.some((row) => row.id === currentSelectedRowId)) {
    return currentSelectedRowId;
  }
  return availableRows.find((row) => row.type === 'item')?.id ?? '';
};

export interface CostEngineCopy {
  statusLabel: string;
  sourceLabel: string;
  frameBadge: string;
  frameMessage: string;
}

const AHSP_ENGINE_INACTIVE_FRAME_MESSAGE =
  'Komponen tenaga, bahan, alat, koefisien, dan Basic Price akan tampil setelah engine AHSP tersambung. Angka detail tidak dibuat palsu.';

/**
 * Drawer copy coherence: reuses toRabCostDisplay (the existing display
 * adapter) rather than inventing a second status vocabulary. The drawer
 * must never say "Engine belum aktif" / "Belum tersambung" while a real
 * Cost Kernel result is available for an AHSP-linked item — those two
 * honest placeholders are reserved strictly for "no AHSP associated yet".
 */
export const describeCostEngineStatus = (
  ahspCodePresent: boolean,
  costRowStatus: CostRowStatus | undefined,
): CostEngineCopy => {
  if (!ahspCodePresent) {
    return {
      statusLabel: 'Engine belum aktif',
      sourceLabel: 'Belum tersambung',
      frameBadge: 'Engine belum aktif',
      frameMessage: AHSP_ENGINE_INACTIVE_FRAME_MESSAGE,
    };
  }
  if (!costRowStatus) {
    return {
      statusLabel: 'Standby',
      sourceLabel: 'Belum tersambung',
      frameBadge: 'Standby',
      frameMessage: AHSP_ENGINE_INACTIVE_FRAME_MESSAGE,
    };
  }
  const display = toRabCostDisplay(costRowStatus);
  const frameMessage =
    costRowStatus.kind === 'calculated'
      ? 'Harga satuan dan jumlah dihitung oleh Cost Kernel SIMPROK. Komponen tenaga, bahan, alat, koefisien, dan Basic Price akan tampil setelah engine analisa AHSP tersambung.'
      : AHSP_ENGINE_INACTIVE_FRAME_MESSAGE;
  return {
    statusLabel: display.badge,
    sourceLabel: 'Cost Kernel SIMPROK',
    frameBadge: display.badge,
    frameMessage,
  };
};
