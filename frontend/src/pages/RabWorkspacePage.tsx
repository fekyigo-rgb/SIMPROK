import { type MouseEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronsLeft,
  ChevronsRight,
  FileDown,
  FileInput,
  FolderOpen,
  ListChecks,
  LockKeyhole,
  Printer,
  Save,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import {
  toPersistedCalculationDisplay,
  type PersistedCalculationWire,
} from '../utils/rabPersistedCalculationDisplay';
import {
  formatExactMoney,
  getPriceOriginBadge,
} from '../utils/rabPersistedDraftDisplay';
import {
  RAB_LOCK_COPY,
  resolveRabWorkspacePresentation,
  toPrelockFindingLines,
  type PrelockFindingLine,
} from '../utils/rabLockDisplay';
import { assignStructuralNumbers } from '../utils/rabRowNumbering';
import {
  buildPriceTrace,
  resolveAhspIdentity,
  PRICE_TRACE_ROW_ACTION,
  PRICE_TRACE_TITLE,
  TECHNICAL_DETAIL_TITLE,
  type AhspIdentityWire,
} from '../utils/rabTraceDisplay';

/** Which question the side panel is answering. */
type DrawerMode = 'AHSP_ANALYSIS' | 'PRICE_TRACE';
import {
  formatAhspVersionOption,
  isWorkspacePrivateAhsp,
  type AhspOrigin,
} from '../utils/ahspOriginDisplay';
import {
  applyBatchResults,
  applyReloadIfCurrent,
  beginLoadingRows,
  buildPersistCalculationRequestBody,
  classifyPersistOutcome,
  computeDirectCostTotal,
  confirmPersistedRow,
  derivePersistFailureReason,
  describeCostEngineStatus,
  evaluatePersistActionReachability,
  formatBackendRupiah,
  formatBoqImportMeasurement,
  GENERIC_PERSIST_FAILURE_REASON,
  invalidateRow,
  isDraftDirtyForSource,
  isDraftPricingComplete,
  isDraftRevisionCurrent,
  isPersistResultFresh,
  markRequestFailed,
  resolveCostRowStatus,
  resolveSelectedRowIdAfterReload,
  shouldInvalidateTerminalPersistResult,
  toLocalDateOnlyString,
  toRabCostDisplay,
  type BoqRowsSource,
  type CostBatchResponse,
  type CostRowStatus,
  type PersistActionReachability,
  type PersistReloadOutcome,
  type PersistResultIdentity,
  type ReloadRequestIdentity,
} from '../utils/rabCostDisplay';
import type { DashboardOutletContext } from '../components/layout/DashboardLayout';
import {
  buildE1aIdempotencyKey,
  describeE1aOccurrence,
  type E1aOccurrenceResponse,
} from '../utils/e1aAhspSelection';

type RabRowType = 'folder' | 'item' | 'note';

interface RabRow {
  id: string;
  parentId: string | null;
  type: RabRowType;
  name: string;
  /** RAB-TRACE-01: the row's own WBS code. Never an AHSP identity. */
  wbsCode: string;
  /** Canonical AHSP identity, or null when no analysis is linked. */
  ahsp: AhspIdentityWire | null;
  /** Non-null only for WORK_ITEM rows with an AHSP association — the Cost Kernel eligibility flag. */
  ahspVersionId: string | null;
  workingOccurrenceId: string | null;
  calculationOccurrenceId: string | null;
  category: string;
  unit: string;
  unitPrice: number;
  manualUnitPrice: boolean;
  manualAhsp: boolean;
  sortOrder: number;
  /**
   * RM-03 — persisted truth, carried straight from GET /boq/draft so a hard
   * reload can render the stored line without waiting on (or depending on) a
   * fresh recalculation. These are the exact server strings; they are never
   * parsed into a number for display.
   */
  priceOrigin: 'MANUAL_CLIENT' | 'SERVER_COST_KERNEL' | null;
  persistedUnitPrice: string | null;
  persistedLineTotal: string | null;
  calculationAsOfDate: string | null;
}

/**
 * GATE2A-PRODUCTIZATION-C-ASYNC-INTEGRITY: lineTotal/priceOrigin/
 * calculationOccurrenceId/calculationAsOfDate/calculatedAt/
 * calculationPolicyVersion are fields the existing GET
 * /projects/:projectId/boq/draft read model already returns per item (see
 * rabPersistedDraftDisplay.ts's PersistedBoqItem, used by the canonical
 * ProjectRabDoorPage against this exact same endpoint) — declared here only
 * so this page can read them back for post-persist confirmation, not a new
 * contract.
 */
interface BoqItemResponse {
  /** RAB-TRACE-01 read projection: canonical AHSP identity, null when unlinked. */
  ahsp?: AhspIdentityWire | null;
  id: string;
  parentId?: string | null;
  itemType: 'FOLDER' | 'WORK_ITEM' | 'NOTE';
  wbsCode: string;
  name: string;
  quantity?: string | number | null;
  unit?: string | null;
  unitPrice?: string | number | null;
  sortOrder?: number | null;
  ahspVersionId?: string | null;
  ahspSnapshotId?: string | null;
  workingOccurrenceId?: string | null;
  lineTotal?: string | null;
  priceOrigin?: 'MANUAL_CLIENT' | 'SERVER_COST_KERNEL' | null;
  calculationOccurrenceId?: string | null;
  calculationAsOfDate?: string | null;
  calculatedAt?: string | null;
  calculationPolicyVersion?: string | null;
}

/**
 * UTANG-API-MONEY-05: the backend recap serializer (rab-draft-recap.ts) now
 * emits exact decimal strings, never a JSON number, for every recap money/
 * percent field — narrowed here to match the true wire contract. Type-only;
 * this page's still-recomputes-locally behavior (UTANG-UI-MONEY-01) is
 * unchanged and untouched by this slice.
 */
interface DraftRecapResponse {
  subtotal?: string | null;
  marginPercent?: string | null;
  marginAmount?: string | null;
  ppnPercent?: string | null;
  taxPercent?: string | null;
  taxAmount?: string | null;
  grandTotal?: string | null;
}

interface RabLifecycleCapability {
  canEnterEditableDraftWorkspace: boolean;
  canEditDraft: boolean;
  reasonCode: string | null;
}

interface DraftBoqResponse {
  structureId: string | null;
  items: BoqItemResponse[];
  recap?: DraftRecapResponse | null;
  capability?: RabLifecycleCapability | null;
}

type CapabilityState =
  | { kind: 'no-project' }
  | { kind: 'loading' }
  | { kind: 'ready'; canEditDraft: boolean }
  | { kind: 'lifecycle-denied'; reasonCode: string | null }
  | { kind: 'not-found' }
  | { kind: 'error' };

interface BoqImportPreview {
  importFingerprint: string; fileName: string; sheetName: string; totalSourceRows: number;
  acceptedRows: number; warningRows: number; rejectedRows: number; displayedRowCount: number;
  folderRows: number; workItemRows: number; noteRows: number;
  previewTruncated: boolean; sourceQuantityMaxScale: number; sourceQuantityRowsExceedingScale2: number;
  canApprove: boolean; displayedRows: Array<{ sourceRowNumber: number; description: string; quantityDecimalString: string | null; unitRaw: string | null; itemType: string; warnings: string[]; errors: string[] }>;
}

interface NumberedRabRow extends RabRow {
  number: string;
  depth: number;
}

const formatRupiah = (value: number) => `Rp ${Math.round(value).toLocaleString('id-ID')}`;

const formatDraftNumber = (value: number) => Number(value || 0).toLocaleString('id-ID');

const parseDraftNumber = (value: string) => {
  const normalized = value
    .replace(/\./g, '')
    .replace(/,/g, '.')
    .replace(/[^\d.-]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toNumber = (value: string | number | null | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * RAB-TRACE-01 — the numbering rule moved to utils/rabRowNumbering so Ruang
 * Hidup can show the same NO for the same row. This is the same walk it
 * always was; it simply no longer lives only in this page.
 */
const buildNumberedRows = (rows: RabRow[]): NumberedRabRow[] => {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return assignStructuralNumbers(
    rows.map((row) => ({
      id: row.id,
      parentId: row.parentId,
      sortOrder: row.sortOrder,
      isNote: row.type === 'note',
    })),
  ).map((numbered) => ({
    ...(byId.get(numbered.id) as RabRow),
    number: numbered.number,
    depth: numbered.depth,
  }));
};

const mapBoqToRows = (items: BoqItemResponse[]) => items
  .map((item, index): RabRow => ({
    id: item.id,
    parentId: item.parentId || null,
    type: item.itemType === 'FOLDER' ? 'folder' : item.itemType === 'NOTE' ? 'note' : 'item',
    name: item.name,
    wbsCode: item.wbsCode.trim(),
    ahsp: item.ahsp ?? null,
    ahspVersionId: item.itemType === 'WORK_ITEM' ? (item.ahspVersionId ?? null) : null,
    workingOccurrenceId: item.itemType === 'WORK_ITEM' ? (item.workingOccurrenceId ?? null) : null,
    calculationOccurrenceId: item.itemType === 'WORK_ITEM' ? (item.calculationOccurrenceId ?? null) : null,
    category: item.itemType === 'FOLDER' ? 'Subjudul' : item.itemType === 'NOTE' ? 'Catatan' : 'Standby',
    unit: item.unit || '',
    unitPrice: toNumber(item.unitPrice),
    /**
     * RM-03: a row is "manual" only when the server says its price origin is
     * MANUAL_CLIENT. Inferring it from "unitPrice is present" also caught
     * every SERVER_COST_KERNEL row, which then emitted a unitPrice key on
     * save and was rejected with SERVER_ROW_UNIT_PRICE_OVERWRITE_FORBIDDEN —
     * so a persisted line could not be edited again after it was calculated.
     */
    manualUnitPrice: item.priceOrigin === 'MANUAL_CLIENT',
    manualAhsp: false,
    sortOrder: item.sortOrder ?? index,
    priceOrigin: item.itemType === 'WORK_ITEM' ? (item.priceOrigin ?? null) : null,
    persistedUnitPrice:
      item.itemType === 'WORK_ITEM' && typeof item.unitPrice === 'string'
        ? item.unitPrice
        : null,
    persistedLineTotal: item.itemType === 'WORK_ITEM' ? (item.lineTotal ?? null) : null,
    calculationAsOfDate:
      item.itemType === 'WORK_ITEM' ? (item.calculationAsOfDate ?? null) : null,
  }));

const moveWithinSiblings = (rows: RabRow[], rowId: string, direction: 'up' | 'down') => {
  const row = rows.find((item) => item.id === rowId);
  if (!row) return rows;

  const siblings = rows
    .filter((item) => item.parentId === row.parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const index = siblings.findIndex((item) => item.id === rowId);
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || targetIndex < 0 || targetIndex >= siblings.length) return rows;

  const current = siblings[index];
  const target = siblings[targetIndex];
  return rows.map((item) => {
    if (item.id === current.id) return { ...item, sortOrder: target.sortOrder };
    if (item.id === target.id) return { ...item, sortOrder: current.sortOrder };
    return item;
  });
};

const normalizeSortOrders = (rows: RabRow[]): RabRow[] => {
  const byParent = new Map<string | null, RabRow[]>();
  for (const row of rows) {
    const key = row.parentId;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(row);
  }
  const updated: RabRow[] = [];
  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.sortOrder - b.sortOrder);
    siblings.forEach((row, i) => updated.push({ ...row, sortOrder: i }));
  }
  return updated;
};

const indentRow = (rows: RabRow[], rowId: string): RabRow[] => {
  const row = rows.find((r) => r.id === rowId);
  if (!row) return rows;
  const siblings = rows
    .filter((r) => r.parentId === row.parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const rowIndex = siblings.findIndex((r) => r.id === rowId);
  if (rowIndex <= 0) return rows;
  const newParent = siblings[rowIndex - 1];
  if (newParent.type !== 'folder') return rows;
  const newSiblings = rows.filter((r) => r.parentId === newParent.id);
  const maxSort = newSiblings.length > 0 ? Math.max(...newSiblings.map((r) => r.sortOrder)) + 1 : 0;
  return normalizeSortOrders(
    rows.map((r) => (r.id === rowId ? { ...r, parentId: newParent.id, sortOrder: maxSort } : r)),
  );
};

const outdentRow = (rows: RabRow[], rowId: string): RabRow[] => {
  const row = rows.find((r) => r.id === rowId);
  if (!row || row.parentId === null) return rows;
  const parent = rows.find((r) => r.id === row.parentId);
  if (!parent) return rows;
  return normalizeSortOrders(
    rows.map((r) =>
      r.id === rowId ? { ...r, parentId: parent.parentId, sortOrder: parent.sortOrder + 0.5 } : r,
    ),
  );
};

const createRow = (type: RabRowType, parentId: string | null, sortOrder: number): RabRow => ({
  id: `local-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  parentId,
  type,
  name: type === 'folder' ? 'Sub Judul Baru' : type === 'note' ? 'Catatan baru' : 'Item pekerjaan baru',
  wbsCode: '',
  ahsp: null,
  ahspVersionId: null,
  workingOccurrenceId: null,
  calculationOccurrenceId: null,
  category: type === 'folder' ? 'Subjudul' : type === 'note' ? 'Catatan' : 'Standby',
  unit: type === 'item' ? 'ls' : '',
  unitPrice: 0,
  manualUnitPrice: type === 'item',
  manualAhsp: false,
  sortOrder,
  // A brand-new local row has never been persisted, so it carries no
  // persisted price and no provenance — the honest unpriced state.
  priceOrigin: null,
  persistedUnitPrice: null,
  persistedLineTotal: null,
  calculationAsOfDate: null,
});

interface PersistTarget {
  projectId: string;
  boqItemId: string;
  itemLabel: string;
  calculationAsOfDate: string;
  /** C-BLOCKER-02/04: the draft revision captured at request start — see draftRevisionRef. */
  draftRevision: number;
  /** FINAL-TERMINAL-STATE-INVALIDATION: the persist-context revision captured at request start — see persistContextRevisionRef. */
  persistContextRevision: number;
  /** C-20-CROSS-PROJECT-RELOAD-ISOLATION: the persist attempt id captured at request start — see persistGenerationRef. */
  generation: number;
}

/**
 * C-BLOCKER-02 / C-20-CROSS-PROJECT-RELOAD-ISOLATION: the outcome of a
 * reloadDraft() attempt. 'superseded' means the project, the persist
 * attempt, or the local draft changed while the request was in flight — the
 * fetched server draft is intentionally discarded rather than silently
 * overwriting whatever project/attempt/edit is now current.
 */
type ReloadDraftOutcome =
  | { kind: 'applied'; items: BoqItemResponse[] }
  | { kind: 'superseded' }
  | { kind: 'no_project' };

type PersistUiState =
  | { kind: 'idle' }
  | { kind: 'persisting'; target: PersistTarget }
  | { kind: 'reloading'; target: PersistTarget }
  | { kind: 'success'; target: PersistTarget; unitPriceDisplay: string; lineTotalDisplay: string }
  | { kind: 'failed_confirmed'; target: PersistTarget; reason: string }
  | { kind: 'outcome_unknown'; target: PersistTarget };

const PERSIST_REACHABILITY_TITLE: Record<PersistActionReachability, string> = {
  READY: 'Hitung & Simpan Harga SIMPROK',
  NO_PROJECT: 'Tidak ada project aktif',
  DRAFT_NOT_EDITABLE: 'Ruang kerja ini belum siap diedit',
  NO_SELECTED_WORK_ITEM: 'Pilih item pekerjaan terlebih dahulu',
  AHSP_NOT_SELECTED: 'Item ini belum memiliki AHSP',
  COST_RESULT_LOADING: 'Sedang menghitung harga SIMPROK...',
  COST_RESULT_INVALIDATED: 'Perlu dihitung ulang setelah perubahan data',
  COST_RESULT_FAIL_CLOSED: 'Perhitungan SIMPROK belum berhasil',
  COST_REQUEST_FAILED: 'Gagal memuat perhitungan SIMPROK',
  COST_RESULT_MISSING: 'Belum ada hasil perhitungan SIMPROK',
  INVALID_CALCULATION_DATE: 'Tanggal perhitungan belum valid',
  UNSAVED_DRAFT_CHANGES: 'Simpan perubahan draft terlebih dahulu',
  PERSIST_IN_FLIGHT: 'Menghitung & menyimpan...',
};

export function RabWorkspacePage() {
  const navigate = useNavigate();
  const { projectId: routeProjectId } = useParams();
  const [searchParams] = useSearchParams();
  const layoutContext = useOutletContext<DashboardOutletContext | null>();
  const projectId = routeProjectId || searchParams.get('projectId');
  const [rows, setRows] = useState<RabRow[]>([]);
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const [unitPrices, setUnitPrices] = useState<Record<string, number>>({});
  const [costRowStatuses, setCostRowStatuses] = useState<Record<string, CostRowStatus>>({});
  const costLoadGenerationRef = useRef(0);
  /**
   * RM-03 — the read-only re-proof of the selected persisted line. Null means
   * "not loaded", which the display adapter renders as an honest not-yet
   * state rather than as an absence of provenance.
   */
  const [persistedProof, setPersistedProof] = useState<PersistedCalculationWire | null>(null);
  const persistedProofGenerationRef = useRef(0);
  const [selectedRowId, setSelectedRowId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [marginPercent, setMarginPercent] = useState(10);
  const [ppnPercent, setPpnPercent] = useState(11);
  const [statusMessage, setStatusMessage] = useState(projectId ? 'Memuat draft...' : 'Tidak ada project aktif.');
  const [capabilityState, setCapabilityState] = useState<CapabilityState>(projectId ? { kind: 'loading' } : { kind: 'no-project' });
  const [retryToken, setRetryToken] = useState(0);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<BoqImportPreview | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [draftDirty, setDraftDirty] = useState(false);
  const [calculationAsOfDate, setCalculationAsOfDate] = useState(() => toLocalDateOnlyString(new Date()));
  const [persistState, setPersistState] = useState<PersistUiState>({ kind: 'idle' });
  /**
   * RM-03B: `origin` distinguishes a workspace's OWN AHSP from the curated
   * SIMPROK catalog. The backend serves it — the frontend must not re-derive
   * tenancy rules it does not own. Optional on the type so a stale payload
   * degrades to the honest catalog label rather than crashing.
   */
  const [eligibleAhspVersions, setEligibleAhspVersions] = useState<Array<{ id: string; versionNumber: number; outputUnit: string; origin?: AhspOrigin; ahsp: { workType: string; methodName: string } }>>([]);
  const [activeRegions, setActiveRegions] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [selectedAhspVersionId, setSelectedAhspVersionId] = useState('');
  const [selectedRegionId, setSelectedRegionId] = useState('');
  const [isSelectingAhsp, setIsSelectingAhsp] = useState(false);
  const [selectionStatusByRow, setSelectionStatusByRow] = useState<Record<string, string>>({});
  const persistGenerationRef = useRef(0);
  /**
   * C-BLOCKER-02: monotonic, synchronous — never coerced, never reset
   * backward. This ref (not state) is the sole authority reloadDraft
   * compares against once a fetch resolves, so an in-flight request always
   * sees the true current value, never a value captured by a stale closure.
   * draftRevisionSnapshot below is a same-tick mirror kept only so a render
   * can read the current revision safely (reading a ref during render is
   * disallowed) — every write to the ref is paired with a write here.
   */
  const draftRevisionRef = useRef(0);
  const [draftRevisionSnapshot, setDraftRevisionSnapshot] = useState(0);
  /**
   * FINAL-TERMINAL-STATE-INVALIDATION: monotonic, synchronous, never
   * decremented or reset — the permanent tiebreaker for terminal-result
   * freshness (see isPersistResultFresh). Unlike draftRevisionRef (which
   * only tracks Working Draft edits), this ref also advances on an item
   * selection change, a calculation-date change, or a project change, so a
   * stale SUCCESS/FAILED_CONFIRMED can never reappear merely because every
   * *other* reversible value later returns to what it was. persistContext
   * RevisionSnapshot is the same-tick render-safe mirror — every write to
   * the ref is paired with a write here; the ref itself is never read
   * during render.
   */
  const persistContextRevisionRef = useRef(0);
  const [persistContextRevisionSnapshot, setPersistContextRevisionSnapshot] = useState(0);
  /** FINAL-TERMINAL-STATE-INVALIDATION: distinguishes an actual project change from a same-project retryToken-driven re-run of the load effect. */
  const previousProjectIdRef = useRef<string | null>(null);
  /**
   * C-20-CROSS-PROJECT-RELOAD-ISOLATION / C-20-R2: mirrors the current
   * projectId. reloadDraft() is a plain closure re-created each render, so a
   * long-lived call still in flight from an older render only ever sees
   * that older render's projectId — this ref is the one place such a call
   * can read the true, live project id once its response resolves.
   *
   * Synced via useLayoutEffect, not a passive useEffect: a passive effect is
   * scheduled asynchronously and gives no ordering guarantee relative to a
   * pending fetch continuation, so a claim that it "runs before any network
   * response resolves" would not actually be enforced by React — only
   * observed to usually hold. useLayoutEffect runs synchronously within the
   * same commit, before the browser can yield to any queued microtask or
   * timer, so a project switch is guaranteed to be visible here (and in
   * persistGenerationRef below) before any in-flight request's continuation
   * — including one that resolves near-instantly — can run.
   *
   * persistGenerationRef.current is bumped in this same effect, not in the
   * passive project-load effect below, so there is exactly one authority for
   * "did the project change" generation invalidation — see that effect's
   * comment for why it no longer touches persistGenerationRef itself.
   */
  const currentProjectIdRef = useRef<string | null>(projectId);
  useLayoutEffect(() => {
    currentProjectIdRef.current = projectId;
    persistGenerationRef.current += 1;
  }, [projectId]);

  /**
   * FINAL-TERMINAL-STATE-INVALIDATION: the one path that advances the
   * persist-context revision for an item/date change. success/
   * failed_confirmed are dropped (shouldInvalidateTerminalPersistResult is
   * the one and only definition of that rule); idle/persisting/reloading/
   * outcome_unknown are left alone — an in-flight request must not be
   * silently erased, and an honest OUTCOME_UNKNOWN warning must survive a
   * same-project context drift.
   */
  const markPersistContextChanged = () => {
    persistContextRevisionRef.current += 1;
    setPersistContextRevisionSnapshot(persistContextRevisionRef.current);
    setPersistState((current) =>
      shouldInvalidateTerminalPersistResult(current.kind) ? { kind: 'idle' } : current,
    );
  };

  const applyRecap = (recap?: DraftRecapResponse | null) => {
    if (!recap) return;
    if (recap.marginPercent !== null && recap.marginPercent !== undefined) {
      setMarginPercent(toNumber(recap.marginPercent));
    }
    const persistedPpnPercent = recap.taxPercent ?? recap.ppnPercent;
    if (persistedPpnPercent !== null && persistedPpnPercent !== undefined) {
      setPpnPercent(toNumber(persistedPpnPercent));
    }
  };

  /**
   * C-BLOCKER-03: `source` distinguishes a persisted Working Draft from a
   * baseline seed shown only as a starting point. A baseline seed is never
   * marked clean — it stays dirty (persist blocked, Save Draft required)
   * until the user explicitly saves it, exactly like any other unsaved
   * local edit.
   */
  const applyRows = (items: BoqItemResponse[], source: BoqRowsSource) => {
    const mappedRows = mapBoqToRows(items);
    const nextVolumes = items.reduce<Record<string, number>>((acc, item) => {
      if (item.itemType === 'WORK_ITEM') acc[item.id] = toNumber(item.quantity);
      return acc;
    }, {});
    const nextUnitPrices = mappedRows.reduce<Record<string, number>>((acc, row) => {
      if (row.type === 'item') acc[row.id] = row.unitPrice;
      return acc;
    }, {});
    setRows(mappedRows);
    setVolumes(nextVolumes);
    setUnitPrices(nextUnitPrices);
    // SELECTED-ITEM-RELOAD-STABILITY: functional update so the decision uses
    // the actual selectedRowId at the moment this update is applied, not a
    // value possibly captured by a stale async closure — if the user
    // selected a different item while this reload was in flight, that
    // newer selection must win, never be forced back to an older target.
    setSelectedRowId((currentSelectedRowId) => resolveSelectedRowIdAfterReload(currentSelectedRowId, mappedRows));
    const dirty = isDraftDirtyForSource(source);
    if (dirty) {
      draftRevisionRef.current += 1;
      setDraftRevisionSnapshot(draftRevisionRef.current);
    }
    setDraftDirty(dirty);
  };

  const loadCostCalculations = (items: BoqItemResponse[]) => {
    if (!projectId) return;
    const eligibleIds = items.filter((item) => item.itemType === 'WORK_ITEM' && item.ahspVersionId).map((item) => item.id);
    const generation = ++costLoadGenerationRef.current;

    if (eligibleIds.length === 0) {
      setCostRowStatuses({});
      return;
    }

    setCostRowStatuses(beginLoadingRows(eligibleIds));

    const query = eligibleIds.map(encodeURIComponent).join(',');
    apiFetch(`/projects/${projectId}/boq/cost-calculations?boqItemIds=${query}`)
      .then((response) => {
        if (!response.ok) throw new Error('cost-calculation-load-failed');
        return response.json() as Promise<CostBatchResponse>;
      })
      .then((batch) => {
        if (generation !== costLoadGenerationRef.current) return;
        setCostRowStatuses((current) => applyBatchResults(current, batch.items));
      })
      .catch(() => {
        if (generation !== costLoadGenerationRef.current) return;
        setCostRowStatuses((current) => markRequestFailed(current, eligibleIds));
      });
  };

  useEffect(() => {
    // FINAL-TERMINAL-STATE-INVALIDATION §7C: previousProjectIdRef
    // distinguishes an actual project change from a same-project
    // retryToken-driven re-run of this same effect. On a real project
    // change: advance the persist-context revision, and unconditionally
    // reset persistState to idle — including OUTCOME_UNKNOWN, which must
    // never follow the user from one project into another. No new request
    // is made to perform this invalidation.
    // C-20-R2: persistGenerationRef is NOT bumped here. This is a passive
    // effect with no ordering guarantee against an in-flight request's
    // continuation; the currentProjectIdRef useLayoutEffect above is the one
    // and only authority that retires an in-flight persist response from the
    // old project, and it runs synchronously, strictly before this effect.
    const projectChanged = previousProjectIdRef.current !== projectId;
    previousProjectIdRef.current = projectId;
    if (projectChanged) {
      markPersistContextChanged();
      setPersistState({ kind: 'idle' });
    }

    if (!projectId) {
      costLoadGenerationRef.current += 1;
      setRows([]);
      setVolumes({});
      setUnitPrices({});
      setCostRowStatuses({});
      setSelectedRowId('');
      setDraftDirty(false);
      setPersistState({ kind: 'idle' });
      setStatusMessage('Tidak ada project aktif. Navigasi dari Proyek Saya untuk membuka ruang kerja.');
      setCapabilityState({ kind: 'no-project' });
      return;
    }

    let cancelled = false;
    setCapabilityState({ kind: 'loading' });
    setStatusMessage('Memuat draft...');

    const run = async () => {
      let response: Response;
      try {
        response = await apiFetch(`/projects/${projectId}/boq/draft`);
      } catch (error) {
        if (cancelled) return;
        console.error('Failed to load RAB draft:', error);
        setCapabilityState({ kind: 'error' });
        setStatusMessage('Gagal memuat draft. Periksa koneksi backend dan coba lagi.');
        return;
      }
      if (cancelled) return;

      // GET boq/draft's contract is intentionally always 200 for an accessible
      // project — it only describes reality and never expresses lifecycle
      // state as an HTTP error. capability.canEditDraft is the sole signal.
      if (response.status === 404) {
        setCapabilityState({ kind: 'not-found' });
        return;
      }
      if (!response.ok) {
        setCapabilityState({ kind: 'error' });
        setStatusMessage('Gagal memuat draft. Periksa koneksi backend dan coba lagi.');
        return;
      }

      const data: DraftBoqResponse = await response.json();
      if (cancelled) return;

      // RM-03D1 — LOCKED is frozen, not hidden. A locked RAB stays fully
      // readable: same rows, same breakdown, same recap, every control
      // read-only. Only a genuine denial still takes the denial screen.
      const presentation = resolveRabWorkspacePresentation(data.capability);
      if (presentation.mode === 'denied') {
        setCapabilityState({ kind: 'lifecycle-denied', reasonCode: presentation.reasonCode });
        return;
      }

      const frozen = presentation.mode === 'frozen';
      setRabLocked(frozen);
      // `canEditDraft: false` is what every existing editing control already
      // reads, so the whole workspace turns read-only without a second
      // read-only code path to keep in step.
      setCapabilityState({ kind: 'ready', canEditDraft: !frozen });

      applyRecap(data.recap);
      if (data.items.length > 0) {
        applyRows(data.items, 'WORKING_DRAFT');
        loadCostCalculations(data.items);
        setStatusMessage(frozen ? 'RAB terkunci dimuat. Mode baca.' : 'Draft tersimpan dimuat. Ruang kerja siap.');
        return;
      }

      // No saved draft — seed from baseline if available, else empty
      const baselineResponse = await apiFetch(`/projects/${projectId}/boq`).catch(() => null);
      if (cancelled) return;
      const baseline = baselineResponse && baselineResponse.ok ? await baselineResponse.json() : [];
      const baselineItems = Array.isArray(baseline) ? (baseline as BoqItemResponse[]) : [];
      if (baselineItems.length > 0) {
        applyRows(baselineItems, 'BASELINE_SEED');
        loadCostCalculations(baselineItems);
        setStatusMessage(frozen ? 'RAB terkunci dimuat. Mode baca.' : 'Draft kosong. Data baseline dimuat sebagai titik awal — klik Simpan Draft untuk menyimpan perubahan.');
      } else {
        costLoadGenerationRef.current += 1;
        setRows([]);
        setVolumes({});
        setUnitPrices({});
        setCostRowStatuses({});
        setSelectedRowId('');
        setStatusMessage(frozen ? 'RAB terkunci dimuat. Mode baca.' : 'Draft kosong. Tambahkan item pekerjaan, lalu klik Simpan Draft.');
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, retryToken]);

  useEffect(() => {
    if (!projectId || !calculationAsOfDate) {
      setEligibleAhspVersions([]);
      setActiveRegions([]);
      return;
    }
    let cancelled = false;
    Promise.all([
      apiFetch(`/projects/${projectId}/ahsp-occurrences/eligible-versions?businessPricingAsOfDate=${encodeURIComponent(calculationAsOfDate)}`),
      apiFetch(`/projects/${projectId}/ahsp-occurrences/regions`),
    ])
      .then(async ([versionsResponse, regionsResponse]) => {
        if (!versionsResponse.ok || !regionsResponse.ok) throw new Error('selector-load-failed');
        const [versions, regions] = await Promise.all([versionsResponse.json(), regionsResponse.json()]);
        if (cancelled) return;
        setEligibleAhspVersions(Array.isArray(versions) ? versions : []);
        setActiveRegions(Array.isArray(regions) ? regions : []);
      })
      .catch(() => {
        if (cancelled) return;
        setEligibleAhspVersions([]);
        setActiveRegions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, calculationAsOfDate]);

  const numberedRows = useMemo(() => buildNumberedRows(rows), [rows]);
  const selectedItem = useMemo(() => {
    const row = numberedRows.find((item) => item.id === selectedRowId);
    return row?.type === 'item' ? row : null;
  }, [numberedRows, selectedRowId]);
  /**
   * RAW live status — what the LIVE batch answered, nothing else. Persist
   * reachability reads this one, because persisting stores a live result and
   * an already-persisted row has none to store.
   */
  const selectedCostStatus = selectedItem ? costRowStatuses[selectedItem.id] : undefined;
  /**
   * RM-03D1 — what the drawer DESCRIBES. An already-persisted row is described
   * by its stored server price, not by the LIVE read's OCCURRENCE_NOT_FOUND,
   * which is the correct answer to a question this panel is not asking.
   */
  const selectedResolvedCostStatus = selectedItem
    ? resolveCostRowStatus(selectedItem, selectedCostStatus)
    : undefined;
  const selectedCostDisplay = selectedResolvedCostStatus ? toRabCostDisplay(selectedResolvedCostStatus) : null;
  /** Drawer copy coherence: never says "Engine belum aktif" while selectedCostDisplay shows a real Cost Kernel result. */
  const costEngineStatus = describeCostEngineStatus(Boolean(selectedItem?.ahsp), selectedResolvedCostStatus);

  /**
   * RM-03 — load the read-only re-proof for a persisted line.
   *
   * Keyed on the persisted unit price as well as the row id, so a fresh
   * persist (which reloads the draft and changes that value) re-fetches the
   * proof instead of showing the previous line's breakdown. A generation
   * counter retires stale responses, matching the discipline the cost-batch
   * loader already uses.
   */
  useEffect(() => {
    if (!projectId || !selectedItem || selectedItem.priceOrigin !== 'SERVER_COST_KERNEL') {
      setPersistedProof(null);
      return;
    }
    const generation = ++persistedProofGenerationRef.current;
    const boqItemId = selectedItem.id;
    setPersistedProof(null);
    apiFetch(`/projects/${projectId}/boq/items/${boqItemId}/persisted-calculation`)
      .then((response) => {
        if (!response.ok) throw new Error('persisted-calculation-load-failed');
        return response.json() as Promise<PersistedCalculationWire>;
      })
      .then((payload) => {
        if (generation !== persistedProofGenerationRef.current) return;
        setPersistedProof(payload);
      })
      .catch(() => {
        if (generation !== persistedProofGenerationRef.current) return;
        // Left null: the adapter renders "belum dimuat", never a fabricated
        // or partially-populated proof.
        setPersistedProof(null);
      });
  }, [projectId, selectedItem?.id, selectedItem?.priceOrigin, selectedItem?.persistedUnitPrice]);

  const persistedProofDisplay = useMemo(
    () =>
      selectedItem?.priceOrigin === 'SERVER_COST_KERNEL'
        ? toPersistedCalculationDisplay(persistedProof)
        : null,
    [selectedItem?.priceOrigin, persistedProof],
  );
  const negativeRows = useMemo(() => new Set(rows
    .filter((row) => row.type === 'item' && ((volumes[row.id] || 0) < 0 || (unitPrices[row.id] ?? row.unitPrice) < 0))
    .map((row) => row.id)), [rows, unitPrices, volumes]);
  const hasNegativeValue = negativeRows.size > 0;

  const siblingsByParent = useMemo(() => {
    const map = new Map<string | null, RabRow[]>();
    for (const row of rows) {
      const key = row.parentId;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    for (const siblings of map.values()) {
      siblings.sort((a, b) => a.sortOrder - b.sortOrder);
    }
    return map;
  }, [rows]);

  /**
   * RM-03D1 — the one place that decides which price truth DESCRIBES each row.
   *
   * `costRowStatuses` holds only what the LIVE batch answered. That read asks
   * "what would this row cost right now?" and follows workingOccurrenceId,
   * which Gate-2A's persist deliberately clears — so for an already-persisted
   * SERVER_COST_KERNEL row it correctly reports OCCURRENCE_NOT_FOUND. Every
   * DISPLAY and AGGREGATION below reads this resolved map instead, so the
   * recap, the row cells and the drawer all describe the same row the same
   * way the main table and the persisted-calculation proof already do.
   *
   * The raw `costRowStatuses` is still what the loader writes and what
   * persist-reachability consults: persisting requires a live result, and
   * "already persisted" is not "ready to persist".
   */
  const resolvedCostRowStatuses = useMemo(() => {
    const resolved: Record<string, CostRowStatus> = {};
    for (const row of rows) {
      if (row.type !== 'item') continue;
      const status = resolveCostRowStatus(row, costRowStatuses[row.id]);
      if (status) resolved[row.id] = status;
    }
    return resolved;
  }, [rows, costRowStatuses]);

  // Cost Kernel calculated lines contribute their exact backend lineTotal (decimal-string
  // addition, never re-multiplied from volume * unitPrice); manual/non-kernel lines keep the
  // existing volume * unitPrice path. See computeDirectCostTotal for the single aggregation rule.
  const directCostTotalExact = useMemo(
    () =>
      computeDirectCostTotal(
        rows
          .filter((row): row is RabRow & { type: 'item' } => row.type === 'item')
          .map((row) => ({
            id: row.id,
            isKernelEligible: row.ahspVersionId !== null,
            manualAmount: (volumes[row.id] || 0) * (unitPrices[row.id] ?? row.unitPrice),
          })),
        resolvedCostRowStatuses,
      ),
    [rows, unitPrices, volumes, resolvedCostRowStatuses],
  );
  const subtotal = Number(directCostTotalExact) || 0;

  const margin = subtotal * (marginPercent / 100);
  const ppn = (subtotal + margin) * (ppnPercent / 100);
  const grandTotal = subtotal + margin + ppn;

  // A recap total must never present an unpriced row's contribution as if it
  // were a real Rp0 — null-integrity law (RM-01a-CODE §5D). While any item
  // row lacks an authoritative price, the recap footer shows "—" instead of
  // a computed-but-partial rupiah figure.
  const pricingComplete = useMemo(
    () =>
      isDraftPricingComplete(
        rows
          .filter((row): row is RabRow & { type: 'item' } => row.type === 'item')
          .map((row) => ({ id: row.id, isKernelEligible: row.ahspVersionId !== null, manualUnitPrice: row.manualUnitPrice })),
        resolvedCostRowStatuses,
      ),
    [rows, resolvedCostRowStatuses],
  );

  const [showBackflowWarning, setShowBackflowWarning] = useState(false);

  /**
   * RM-03D1 LOCK. `rabLocked` mirrors the server's lifecycle, never a local
   * guess: it is set from the capability projection on every draft read, so a
   * hard reload shows the true state and a refused lock leaves it untouched.
   */
  const [rabLocked, setRabLocked] = useState(false);
  /** Disclosure only. Never a lifecycle state, never sent anywhere. */
  const [lockNoteOpen, setLockNoteOpen] = useState(false);
  /** RAB-TRACE-01 — which of the two questions the drawer is open for. */
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('AHSP_ANALYSIS');
  const [isLocking, setIsLocking] = useState(false);
  const [lockConfirmOpen, setLockConfirmOpen] = useState(false);
  const [lockFindings, setLockFindings] = useState<PrelockFindingLine[]>([]);

  const handleLockRab = async () => {
    if (!projectId || isLocking) return;
    setLockConfirmOpen(false);
    setIsLocking(true);
    setLockFindings([]);
    try {
      const response = await apiFetch(`/projects/${projectId}/rab/lock`, { method: 'POST' });
      const payload = await response.json().catch(() => null);

      if (response.ok && payload?.status === 'LOCKED') {
        setRabLocked(true);
        setCapabilityState({ kind: 'ready', canEditDraft: false });
        setStatusMessage(RAB_LOCK_COPY.lockedNote);
        return;
      }

      // A refusal is information, not an error to swallow: the RAB stays a
      // live draft and the Owner is told which rows moved.
      if (payload?.reason === 'PRELOCK_REVALIDATION_REQUIRED') {
        setLockFindings(toPrelockFindingLines(payload.findings));
        setStatusMessage(RAB_LOCK_COPY.revalidationRequired);
        return;
      }
      setStatusMessage(RAB_LOCK_COPY.failed);
    } catch {
      setStatusMessage(RAB_LOCK_COPY.failed);
    } finally {
      setIsLocking(false);
    }
  };

  const openPlaceholder = (action: string) => {
    setStatusMessage(`${action}: fitur disiapkan, belum aktif.`);
  };

  const handlePickAhsp = () => {
    // The control is disabled while frozen; the command refuses as well, so a
    // frozen RAB is protected by the code and not only by the screen.
    if (!canEditDraft) return;
    if (!projectId || !selectedItem || !selectedAhspVersionId || !selectedRegionId) {
      setStatusMessage('Pilih AHSP Version dan Region terlebih dahulu.');
      return;
    }
    setIsSelectingAhsp(true);
    apiFetch(`/projects/${projectId}/ahsp-occurrences/boq-items/${selectedItem.id}/select-ahsp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ahspVersionId: selectedAhspVersionId,
        businessPricingAsOfDate: calculationAsOfDate,
        referenceRegionId: selectedRegionId,
        idempotencyKey: buildE1aIdempotencyKey(selectedItem.id),
      }),
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
      .then((occurrence: E1aOccurrenceResponse) => {
        const view = describeE1aOccurrence(occurrence);
        setSelectionStatusByRow((current) => ({ ...current, [selectedItem.id]: view.label }));
        setStatusMessage(`AHSP dipilih. ${view.label}.`);
        setRetryToken((value) => value + 1);
      })
      .catch(() => setStatusMessage('Pemilihan AHSP gagal dan tidak mengubah baris.'))
      .finally(() => setIsSelectingAhsp(false));
  };

  /**
   * FINAL-TERMINAL-STATE-INVALIDATION §7A: the one choke point for every
   * selectedRowId change. Re-selecting the row already selected is not a
   * context change (no invalidation); switching to a different row — or to
   * no row at all — advances the persist-context revision exactly once.
   */
  /**
   * RAB-TRACE-01 — the drawer has two purposes and they are different
   * questions. The AHSP door answers "what analysis is used for one unit of
   * this work?"; Rincian Harga answers "why does this project row cost this?".
   * Both used to open the identical AHSP panel, so the second door was not a
   * door at all. Same panel, declared mode.
   */
  const activateRow = (rowId: string, mode: DrawerMode = 'AHSP_ANALYSIS') => {
    if (rowId !== selectedRowId) markPersistContextChanged();
    setSelectedRowId(rowId);
    setDrawerMode(mode);
  };

  const handleRowClick = (rowId: string, event: MouseEvent<HTMLTableRowElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('button, input, textarea, a')) return;
    activateRow(rowId);
  };

  /** FINAL-TERMINAL-STATE-INVALIDATION §7B: mirrors activateRow's same-value/different-value distinction for the calculation date. */
  const handleCalculationAsOfDateChange = (value: string) => {
    if (value !== calculationAsOfDate) markPersistContextChanged();
    setCalculationAsOfDate(value);
  };

  const canEditDraft = capabilityState.kind === 'ready' && capabilityState.canEditDraft;

  const isPersistBusy = persistState.kind === 'persisting' || persistState.kind === 'reloading';
  const persistReachability: PersistActionReachability = evaluatePersistActionReachability({
    projectId,
    canEditDraft,
    selectedItem: selectedItem ? { id: selectedItem.id, ahspVersionId: selectedItem.ahspVersionId } : null,
    costRowStatus: selectedCostStatus,
    calculationAsOfDate,
    draftDirty,
    persistInFlight: isPersistBusy,
  });
  /** C-BLOCKER-04: current identity a terminal success/failed_confirmed result is compared against — see isPersistResultFresh below. Uses draftRevisionSnapshot/persistContextRevisionSnapshot, never the refs, since this runs during render. */
  const currentPersistIdentity: PersistResultIdentity = {
    projectId: projectId ?? '',
    boqItemId: selectedItem?.id ?? '',
    calculationAsOfDate,
    draftRevision: draftRevisionSnapshot,
    persistContextRevision: persistContextRevisionSnapshot,
  };

  const handleSaveDraft = () => {
    if (!canEditDraft) {
      setStatusMessage('Simpan diblokir: ruang kerja ini belum siap diedit.');
      return;
    }
    if (hasNegativeValue) {
      setStatusMessage('Simpan diblokir: volume dan harga satuan tidak boleh minus.');
      return;
    }
    if (!projectId) {
      setStatusMessage('Tidak ada project aktif — tidak bisa menyimpan.');
      return;
    }
    if (isSaving) return;

    setIsSaving(true);
    setStatusMessage('Menyimpan draft...');

    const payload = {
      marginPercent,
      ppnPercent,
      taxPercent: ppnPercent,
      rows: rows.map((row, index) => ({
        tempId: row.id,
        parentTempId: row.parentId,
        itemType: row.type === 'folder' ? 'FOLDER' : row.type === 'note' ? 'NOTE' : 'WORK_ITEM',
        name: row.name,
        wbsCode: row.wbsCode || '',
        quantity: row.type === 'item' ? volumes[row.id] : undefined,
        unit: row.type === 'item' ? row.unit : undefined,
        unitPrice: row.manualUnitPrice ? (unitPrices[row.id] ?? row.unitPrice) : undefined,
        sortOrder: row.sortOrder ?? index,
      })),
    };

    apiFetch(`/projects/${projectId}/boq/draft`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((fresh: DraftBoqResponse) => {
        applyRecap(fresh.recap);
        loadCostCalculations(fresh.items);
        const mappedRows = mapBoqToRows(fresh.items);
        const nextVolumes = fresh.items.reduce<Record<string, number>>((acc, item) => {
          acc[item.id] = toNumber(item.quantity);
          return acc;
        }, {});
        const nextUnitPrices = mappedRows.reduce<Record<string, number>>((acc, row) => {
          if (row.type === 'item' && row.manualUnitPrice) acc[row.id] = row.unitPrice;
          return acc;
        }, {});
        const currentSelected = selectedRowId;
        setRows(mappedRows);
        setVolumes(nextVolumes);
        setUnitPrices(nextUnitPrices);
        setDraftDirty(false);
        setSelectedRowId(
          mappedRows.find((r) => r.id === currentSelected)?.id ||
          mappedRows.find((r) => r.type === 'item')?.id ||
          '',
        );
        setStatusMessage(`Draft tersimpan — ${new Date().toLocaleTimeString('id-ID')}.`);
      })
      .catch(() => {
        setStatusMessage('Gagal menyimpan draft. Coba lagi.');
      })
      .finally(() => {
        setIsSaving(false);
      });
  };

  /**
   * C-BLOCKER-02: the one bounded mutation marker for every local-only
   * persisted-draft edit. Bumps draftRevisionRef synchronously (so an
   * in-flight reload can detect the draft moved under it), keeps draftDirty
   * a single honest flag (cleared only by applyRows — a real server sync),
   * and drops a now-stale terminal success/failure result rather than
   * leaving it displayed against data that has since changed. A request
   * already in flight is left alone here — the revision guard, not this
   * marker, is what protects it (see reloadDraft/handlePersistCalculation).
   */
  const markDraftMutated = () => {
    draftRevisionRef.current += 1;
    setDraftRevisionSnapshot(draftRevisionRef.current);
    setDraftDirty(true);
    setPersistState((current) => {
      const busy = current.kind === 'persisting' || current.kind === 'reloading';
      if (busy) return current;
      return shouldInvalidateTerminalPersistResult(current.kind) ? { kind: 'idle' } : current;
    });
  };

  /**
   * Every local-only row edit funnels through here so markDraftMutated always
   * runs alongside it — and so the freeze is enforced in one place rather than
   * at each of the twelve call sites. A frozen RAB used to be protected only
   * by disabled controls: true of the screen, but not of the code behind it,
   * and those paths then announced saving a draft that could not be saved.
   *
   * Returns whether the edit was allowed, so callers stay silent rather than
   * reporting work that did not happen.
   */
  /**
   * Volume, manual unit price, margin and PPN are not row mutations, so they
   * never passed through mutateRows and a frozen RAB could still have its
   * displayed truth changed underneath the lock. They go through here now, for
   * the same reason and with the same contract.
   */
  const applyLocalEdit = (apply: () => void): boolean => {
    if (!canEditDraft) return false;
    markDraftMutated();
    apply();
    return true;
  };

  const mutateRows = (updater: (current: RabRow[]) => RabRow[]): boolean => {
    if (!canEditDraft) return false;
    markDraftMutated();
    setRows(updater);
    return true;
  };

  const addChild = (parentId: string | null, type: RabRowType) => {
    const newRow = createRow(type, parentId, Math.max(0, ...rows.map((row) => row.sortOrder)) + 1);
    if (!mutateRows((current) => [...current, newRow])) return;
    if (type === 'item') setUnitPrices((current) => ({ ...current, [newRow.id]: 0 }));
    setStatusMessage(`${type === 'folder' ? 'Sub Judul' : type === 'note' ? 'Catatan' : 'Item'} ditambahkan. Klik Simpan Draft untuk menyimpan.`);
  };

  const removeRow = (rowId: string) => {
    const removed = mutateRows((current) => {
      const idsToRemove = new Set<string>([rowId]);
      let changed = true;
      while (changed) {
        changed = false;
        current.forEach((row) => {
          if (row.parentId && idsToRemove.has(row.parentId) && !idsToRemove.has(row.id)) {
            idsToRemove.add(row.id);
            changed = true;
          }
        });
      }
      return current.filter((row) => !idsToRemove.has(row.id));
    });
    if (!removed) return;
    setUnitPrices((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== rowId)));
    setStatusMessage('Baris dihapus. Klik Simpan Draft untuk menyimpan perubahan.');
  };

  const updateRowName = (rowId: string, name: string) => {
    mutateRows((current) => current.map((row) => (row.id === rowId ? { ...row, name } : row)));
  };

  const updateRowUnit = (rowId: string, unit: string) => {
    mutateRows((current) => current.map((row) => (row.id === rowId ? { ...row, unit } : row)));
    setCostRowStatuses((current) => invalidateRow(current, rowId));
  };

  /**
   * C-BLOCKER-02 / C-20-CROSS-PROJECT-RELOAD-ISOLATION / C-20-R2: `expected`,
   * when passed, is the persist generation and draft revision captured at
   * the moment the persist attempt started. The project-identity check runs
   * unconditionally, even for `approveImport`'s argument-less call, because
   * a project switch invalidates any in-flight reloadDraft response no
   * matter which caller made it — this request's own projectId is captured
   * once at call start (requestProjectId) so it can be compared to the live
   * currentProjectIdRef once the response comes back, never to a stale
   * closure value.
   *
   * The three-part state application (recap, rows, cost-calculation load)
   * is never inlined here — it is always routed through
   * applyReloadIfCurrent, the one orchestration point that gates all three
   * callbacks behind isReloadContextCurrent, so there is exactly one place
   * in this codebase where "is this response still safe to apply" is
   * decided and exactly one place where the three callbacks fire together
   * or not at all.
   */
  const reloadDraft = async (
    expected?: { generation: number; draftRevision: number },
  ): Promise<ReloadDraftOutcome> => {
    if (!projectId) return { kind: 'no_project' };
    const requestProjectId = projectId;
    const response = await apiFetch(`/projects/${requestProjectId}/boq/draft`);
    if (!response.ok) throw new Error('draft-reload-failed');
    const draft = await response.json() as DraftBoqResponse;

    const current: ReloadRequestIdentity = {
      projectId: currentProjectIdRef.current,
      generation: persistGenerationRef.current,
      draftRevision: draftRevisionRef.current,
    };
    const captured: ReloadRequestIdentity = {
      projectId: requestProjectId,
      generation: expected?.generation ?? current.generation,
      draftRevision: expected?.draftRevision ?? current.draftRevision,
    };

    const applied = applyReloadIfCurrent(captured, current, {
      applyRecap: () => applyRecap(draft.recap),
      applyRows: () => applyRows(draft.items, 'WORKING_DRAFT'),
      loadCostCalculations: () => loadCostCalculations(draft.items),
    });
    if (!applied) return { kind: 'superseded' };
    return { kind: 'applied', items: draft.items };
  };

  /**
   * GATE2A-PRODUCTIZATION-C — the one minimal persist action. Sends only
   * calculationAsOfDate to the existing Gate-2A persist route; the backend
   * (RabKernelPersistenceService) remains sole authority for eligibility,
   * calculation, persistence, provenance, and the whole-RAB total. The
   * request target (project/item/date/draftRevision) is captured once at
   * click time so a later selection, date, or draft change can never cause
   * this response to be displayed against different data — combined with
   * persistGenerationRef, a stale response for a superseded attempt is
   * dropped outright.
   *
   * C-BLOCKER-01: the POST response body is never read as success
   * authority — only reloadDraft's freshly re-fetched Working Draft row is,
   * confirmed field-by-field via confirmPersistedRow before SUCCESS is ever
   * declared.
   */
  const handlePersistCalculation = () => {
    if (!projectId || !selectedItem || persistReachability !== 'READY') return;
    const generation = ++persistGenerationRef.current;
    const target: PersistTarget = {
      projectId,
      boqItemId: selectedItem.id,
      itemLabel: selectedItem.name,
      calculationAsOfDate,
      draftRevision: draftRevisionRef.current,
      persistContextRevision: persistContextRevisionRef.current,
      generation,
    };
    setPersistState({ kind: 'persisting', target });

    void (async () => {
      let response: Response;
      try {
        response = await apiFetch(
          `/projects/${target.projectId}/boq/items/${target.boqItemId}/cost-calculation/persist`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildPersistCalculationRequestBody(target.calculationAsOfDate)),
          },
        );
      } catch {
        if (generation === persistGenerationRef.current) {
          setPersistState({ kind: 'outcome_unknown', target });
        }
        return;
      }

      if (generation !== persistGenerationRef.current) return;

      if (!response.ok) {
        let reason = GENERIC_PERSIST_FAILURE_REASON;
        try {
          reason = derivePersistFailureReason(await response.json());
        } catch {
          // Non-JSON error body — keep the generic honest reason.
        }
        if (generation === persistGenerationRef.current) {
          // FINAL-TERMINAL-STATE-INVALIDATION §7D: never commit a confirmed
          // failure against a context (item/date/project) the user has
          // already left — resolve as idle instead, never as a hidden
          // terminal result that could later reappear.
          setPersistState(
            isDraftRevisionCurrent(target.persistContextRevision, persistContextRevisionRef.current)
              ? { kind: 'failed_confirmed', target, reason }
              : { kind: 'idle' },
          );
        }
        return;
      }

      setPersistState({ kind: 'reloading', target });
      let reloadOutcome: PersistReloadOutcome;
      let reloadResult: ReloadDraftOutcome | undefined;
      try {
        reloadResult = await reloadDraft({ generation: target.generation, draftRevision: target.draftRevision });
        // A superseded project/generation/revision is not a mechanical
        // error, but from this classifier's narrow "did reload cleanly
        // apply" question it is treated the same way — both funnel to
        // OUTCOME_UNKNOWN below, which is the exact required resolution.
        reloadOutcome = reloadResult.kind === 'applied' ? { kind: 'success' } : { kind: 'error' };
      } catch {
        reloadOutcome = { kind: 'error' };
      }

      if (generation !== persistGenerationRef.current) return;

      const outcome = classifyPersistOutcome({ kind: 'response', ok: true }, reloadOutcome);
      if (outcome === 'SUCCESS' && reloadResult?.kind === 'applied') {
        const reloadedRow = reloadResult.items.find((item) => item.id === target.boqItemId);
        const confirmed = confirmPersistedRow(reloadedRow, {
          boqItemId: target.boqItemId,
          calculationAsOfDate: target.calculationAsOfDate,
        });
        // FINAL-TERMINAL-STATE-INVALIDATION §7D: a confirmed row is only
        // ever committed as SUCCESS if the persist context (item/date/
        // project) the user is currently looking at is still the exact one
        // this request was made for — otherwise resolve as idle, never as a
        // hidden terminal result that could later reappear.
        const contextStillCurrent = isDraftRevisionCurrent(
          target.persistContextRevision,
          persistContextRevisionRef.current,
        );
        setPersistState(
          confirmed
            ? contextStillCurrent
              ? {
                  kind: 'success',
                  target,
                  unitPriceDisplay: formatBackendRupiah(confirmed.unitPrice),
                  lineTotalDisplay: formatBackendRupiah(confirmed.lineTotal),
                }
              : { kind: 'idle' }
            : { kind: 'outcome_unknown', target },
        );
      } else {
        // Covers a malformed/absent reloaded row, a revision change, and a
        // reload failure after a confirmed 2xx — never a false SUCCESS,
        // never claimed "not saved".
        setPersistState({ kind: 'outcome_unknown', target });
      }
    })();
  };

  const previewImport = async (file: File) => {
    if (!projectId || !canEditDraft) return;
    setImportFile(file); setImportPreview(null); setIsImporting(true); setStatusMessage('Membaca BOQ...');
    try {
      const body = new FormData(); body.append('file', file); body.append('selectedSheet', 'RAB');
      const response = await apiFetch(`/projects/${projectId}/boq/import/preview`, { method: 'POST', body });
      if (!response.ok) throw new Error(await response.text());
      const preview = await response.json() as BoqImportPreview;
      setImportPreview(preview); setStatusMessage(`Preview BOQ siap: ${preview.acceptedRows} baris valid.`);
    } catch { setStatusMessage('Preview BOQ gagal. Periksa file dan coba lagi.'); }
    finally { setIsImporting(false); }
  };

  const approveImport = async () => {
    if (!projectId || !canEditDraft || !importFile || !importPreview || isImporting) return;
    setIsImporting(true); setStatusMessage('Sedang mengimpor BOQ');
    try {
      const body = new FormData(); body.append('file', importFile); body.append('selectedSheet', importPreview.sheetName); body.append('importFingerprint', importPreview.importFingerprint);
      const response = await apiFetch(`/projects/${projectId}/boq/import/approve`, { method: 'POST', body });
      if (!response.ok) throw new Error(await response.text());
      await reloadDraft(); setImportPreview(null); setImportFile(null); setStatusMessage('BOQ berhasil diimpor ke Working Draft.');
    } catch { setStatusMessage('Import gagal. Preview tetap tersedia untuk dicoba kembali.'); }
    finally { setIsImporting(false); }
  };

  if (capabilityState.kind === 'loading') {
    return (
      <div className="simprok-rab-workspace">
        <header className="simprok-rab-workspace__header">
          <div>
            <div className="simprok-rab-workspace__eyebrow">SIMPROK / Buat RAB / Ruang Kerja RAB</div>
            <h1>Ruang Kerja RAB</h1>
            <p>Memuat kapabilitas ruang kerja...</p>
          </div>
        </header>
        <div className="simprok-rab-empty-state" role="status">
          <p>Memuat draft...</p>
        </div>
      </div>
    );
  }

  if (capabilityState.kind === 'lifecycle-denied') {
    return (
      <div className="simprok-rab-workspace">
        <header className="simprok-rab-workspace__header">
          <div>
            <div className="simprok-rab-workspace__eyebrow">SIMPROK / Buat RAB / Ruang Kerja RAB</div>
            <h1>Ruang Kerja RAB</h1>
          </div>
        </header>
        <div className="simprok-rab-validation-alert" role="alert">
          <p>
            RAB proyek ini sudah menjadi baseline atau telah disetujui.
            Perubahan harus melalui mekanisme resmi.
          </p>
          <button
            className="simprok-rab-action simprok-rab-action--secondary"
            onClick={() => navigate(`/project/${projectId}/rab`)}
          >
            Kembali ke Ruang Hidup RAB
          </button>
        </div>
      </div>
    );
  }

  if (capabilityState.kind === 'not-found') {
    return (
      <div className="simprok-rab-workspace">
        <header className="simprok-rab-workspace__header">
          <div>
            <div className="simprok-rab-workspace__eyebrow">SIMPROK / Buat RAB / Ruang Kerja RAB</div>
            <h1>Ruang Kerja RAB</h1>
          </div>
        </header>
        <div className="simprok-rab-validation-alert" role="alert">
          <p>Proyek atau Draft tidak dapat ditemukan.</p>
          <button
            className="simprok-rab-action simprok-rab-action--secondary"
            onClick={() => navigate('/proyek')}
          >
            Kembali ke Proyek Saya
          </button>
        </div>
      </div>
    );
  }

  if (capabilityState.kind === 'error') {
    return (
      <div className="simprok-rab-workspace">
        <header className="simprok-rab-workspace__header">
          <div>
            <div className="simprok-rab-workspace__eyebrow">SIMPROK / Buat RAB / Ruang Kerja RAB</div>
            <h1>Ruang Kerja RAB</h1>
          </div>
        </header>
        <div className="simprok-rab-validation-alert" role="alert">
          <p>Gagal memuat ruang kerja. Periksa koneksi dan coba lagi.</p>
          <button
            className="simprok-rab-action simprok-rab-action--secondary"
            onClick={() => setRetryToken((token) => token + 1)}
          >
            Coba lagi
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="simprok-rab-workspace">
      <div className="simprok-rab-focus-nav" aria-label="Navigasi Ruang Kerja RAB">
        <button onClick={() => navigate('/')} title="Kembali ke Beranda" aria-label="Kembali ke Beranda" data-route="/">
          <ArrowLeft size={17} /> Kembali
        </button>
        <button onClick={() => setShowBackflowWarning(!showBackflowWarning)} title="Ubah Data Pekerjaan" aria-label="Ubah Data Pekerjaan" className="simprok-rab-nav-secondary">
          Ubah Data Pekerjaan
        </button>
        <button onClick={() => layoutContext?.toggleSidebar()} title="Tampilkan atau sembunyikan menu" aria-label="Tampilkan atau sembunyikan menu" data-route="/?ruang=ruang-kerja-rab">
          {layoutContext?.isSidebarVisible ? <ChevronsLeft size={17} /> : <ChevronsRight size={17} />} Menu
        </button>
      </div>

      <header className="simprok-rab-workspace__header">
        <div>
          <div className="simprok-rab-workspace__eyebrow">SIMPROK / Buat RAB / Ruang Kerja RAB</div>
          <h1>Ruang Kerja RAB</h1>
          {/* The room is the same room; what may be done in it is not. */}
          <p>
            {!projectId
              ? 'Tidak ada project aktif. Navigasi dari Proyek Saya untuk membuka ruang kerja.'
              : rabLocked
              ? `Project: ${projectId}. Ruang kerja RAB terkunci — baca dan telusuri hasil RAB.`
              : `Project: ${projectId}. Ruang kerja draft RAB — edit dan simpan sebelum baseline resmi.`}
          </p>
        </div>
        <span className="simprok-rab-workspace__status">{statusMessage}</span>
      </header>

      <section className="simprok-rab-toolbar" aria-label="Aksi Ruang Kerja RAB">
        <input ref={importInputRef} hidden type="file" accept=".xlsx" onChange={(event) => { const file = event.target.files?.[0]; if (file) void previewImport(file); }} />
        <button onClick={() => importInputRef.current?.click()} disabled={!projectId || !canEditDraft || isImporting} title="Import BOQ XLSX" aria-label="Import BOQ">
          <FileInput size={17} /> Import BOQ
        </button>
        <button onClick={() => navigate('/first-real-input-preview?tab=ahsp')} title="Preview Cari AHSP (Data Contoh)" aria-label="Preview Cari AHSP" data-route="/?ruang=cari-ahsp">
          <Search size={17} /> Cari AHSP (Preview)
        </button>
        <button onClick={() => openPlaceholder('Export')} title="Export - belum tersambung" aria-label="Export - belum tersambung" data-route="/?ruang=export-rab">
          <FileDown size={17} /> Export
        </button>
        <button onClick={() => openPlaceholder('Print')} title="Print - belum tersambung" aria-label="Print - belum tersambung" data-route="/?ruang=print-rab">
          <Printer size={17} /> Print
        </button>
        {/*
          A frozen RAB has nothing to save, so the command is not offered. It
          used to carry aria-disabled alone: focusable, clickable, still saying
          "Simpan Draft", and refused only once handleSaveDraft ran. Leaving it
          visible would also have the locked screen speaking of drafts again.
          Saving is genuinely outside what a locked RAB permits, so the control
          is absent rather than dressed up as disabled.

          While the draft is editable this is exactly the control it always
          was — same handler, same aria-disabled conditions for the states
          that are momentary rather than lifecycle.
        */}
        {canEditDraft ? (
          <button className="simprok-rab-toolbar__save" onClick={handleSaveDraft} title={isSaving ? 'Menyimpan...' : 'Simpan Draft ke server'} aria-label="Simpan Draft" data-route="/?ruang=simpan-draft" aria-disabled={hasNegativeValue || isSaving || !projectId}>
            <Save size={17} /> {isSaving ? 'Menyimpan...' : 'Simpan Draft'}
          </button>
        ) : null}
        {/*
          RM-03D1 — the lock door is live. It is offered only while the draft
          is still editable and its pricing is complete: locking an incomplete
          RAB would freeze a total nobody can stand behind, and the server
          refuses it anyway, so the door tells the truth before it is pushed.
        */}
        {/*
          Once the RAB is frozen this same control stops being a lock command
          and becomes the one place the freeze explains itself. It is not an
          unlock: toggling it moves nothing but a paragraph. A second TERKUNCI
          control elsewhere on the screen would have the Owner asking which of
          the two is the real one.
        */}
        <button
          className="simprok-rab-toolbar__lock"
          onClick={() => (rabLocked ? setLockNoteOpen((open) => !open) : setLockConfirmOpen(true))}
          title={rabLocked ? RAB_LOCK_COPY.lockedNote : isLocking ? 'Mengunci RAB...' : RAB_LOCK_COPY.action}
          aria-label={rabLocked ? RAB_LOCK_COPY.lockedBadge : RAB_LOCK_COPY.action}
          aria-expanded={rabLocked ? lockNoteOpen : undefined}
          aria-controls={rabLocked ? 'simprok-rab-lock-note' : undefined}
          data-route="/?ruang=kunci-rab"
          disabled={rabLocked ? false : isLocking || !projectId || !canEditDraft || !pricingComplete}
        >
          <LockKeyhole size={17} /> {rabLocked ? RAB_LOCK_COPY.lockedBadge : isLocking ? 'Mengunci...' : RAB_LOCK_COPY.action}
        </button>
        {rabLocked && lockNoteOpen ? (
          <p
            id="simprok-rab-lock-note"
            role="status"
            style={{
              flexBasis: '100%',
              margin: '0.375rem 0 0',
              padding: '0.375rem 0.75rem',
              borderRadius: '8px',
              border: '1px solid #C7D5EC',
              background: '#EAF0FB',
              color: '#16294B',
              fontSize: 'var(--text-sm)',
            }}
          >
            {RAB_LOCK_COPY.lockedNote}
          </p>
        ) : null}
      </section>
      {importPreview ? (
        <section className="simprok-rab-validation-alert simprok-rab-validation-alert--info" aria-label="Preview Import BOQ">
          <strong>{importPreview.fileName} — sheet {importPreview.sheetName}</strong>
          <p>Valid {importPreview.acceptedRows}; peringatan {importPreview.warningRows}; error {importPreview.rejectedRows}. Skala quantity maksimum {importPreview.sourceQuantityMaxScale}.</p>
          <p>{importPreview.folderRows} bagian; {importPreview.workItemRows} item pekerjaan; {importPreview.noteRows} catatan.</p>
          <p>Menampilkan {importPreview.displayedRowCount} dari {importPreview.acceptedRows + importPreview.rejectedRows} baris{importPreview.previewTruncated ? ' (preview dibatasi)' : ''}.</p>
          <div style={{ maxHeight: 240, overflow: 'auto' }}>
            {importPreview.displayedRows.map((row) => <div key={row.sourceRowNumber}>Baris {row.sourceRowNumber}: {row.description}{formatBoqImportMeasurement(row.itemType, row.quantityDecimalString, row.unitRaw)}{row.errors.length ? ` [${row.errors.join(', ')}]` : ''}</div>)}
          </div>
          <button onClick={() => void approveImport()} disabled={!importPreview.canApprove || !canEditDraft || isImporting}>{isImporting ? 'Sedang mengimpor BOQ' : 'Setujui dan Import'}</button>
        </section>
      ) : null}
      {hasNegativeValue ? (
        <div className="simprok-rab-validation-alert" role="alert">
          Ada nilai minus pada Volume atau Harga Satuan. Perbaiki sebelum menyimpan draft.
        </div>
      ) : null}

      {showBackflowWarning ? (
        <div className="simprok-rab-validation-alert simprok-rab-validation-alert--info" role="alert">
          <strong>Peringatan Navigasi (Draft Lokal)</strong>
          <p>Perubahan data pekerjaan dapat memengaruhi rekomendasi AHSP, Basic Price, Execution Factor, dan total RAB. Item RAB yang sudah dibuat tetap dipertahankan.</p>
          <p>
            <em>Navigasi kembali ke Persiapan RAB ditahan sementara agar isi RAB lokal tidak hilang. Backflow penuh menunggu penyimpanan draft/persistence siap.</em>
          </p>
          <button onClick={() => setShowBackflowWarning(false)} className="simprok-rab-action simprok-rab-action--secondary" style={{ marginTop: '10px' }}>
            Tutup Peringatan
          </button>
        </div>
      ) : null}

      {/*
        RM-03D1 — the pre-lock check is announced before it runs, so the Owner
        is never surprised by a RAB that refuses to freeze.
      */}
      {lockConfirmOpen ? (
        <div className="simprok-rab-validation-alert simprok-rab-validation-alert--info" role="alertdialog" aria-label={RAB_LOCK_COPY.action}>
          <strong>{RAB_LOCK_COPY.action}</strong>
          <p>{RAB_LOCK_COPY.confirm}</p>
          <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
            <button onClick={() => void handleLockRab()} className="simprok-rab-action" disabled={isLocking}>
              {RAB_LOCK_COPY.confirmAccept}
            </button>
            <button onClick={() => setLockConfirmOpen(false)} className="simprok-rab-action simprok-rab-action--secondary">
              {RAB_LOCK_COPY.confirmCancel}
            </button>
          </div>
        </div>
      ) : null}

      {/* A refused lock says which rows moved, in the Owner's language. */}
      {lockFindings.length > 0 ? (
        <div className="simprok-rab-validation-alert" role="alert">
          <strong>{RAB_LOCK_COPY.revalidationRequired}</strong>
          <ul>
            {lockFindings.map((line) => (
              <li key={`${line.label}-${line.message}`}>
                <strong>{line.label}</strong> — {line.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <main className="simprok-rab-workspace__body">
        <section className="simprok-rab-sheet" aria-label="Tabel RAB">
          <div className="simprok-rab-sheet__label">
            {/* Storage is the same either way; freedom to edit is not. */}
            <strong>{rabLocked ? 'RAB Terkunci' : 'Draft RAB'}</strong>
            <span>
              {!projectId
                ? 'Tidak ada project aktif'
                : rabLocked
                ? 'Tersimpan di server — dapat dibaca dan ditelusuri, tidak dapat diubah'
                : 'Draft tersimpan di server — edit bebas, simpan kapan saja'}
            </span>
          </div>

          <div className="simprok-rab-table-wrap">
            <table className="simprok-rab-table simprok-rab-draft-table">
              <thead>
                <tr>
                  <th className="simprok-rab-col-atur">Atur</th>
                  <th className="simprok-rab-col-no">No</th>
                  <th>AHSP / Kategori</th>
                  <th>Uraian Pekerjaan</th>
                  <th>Volume</th>
                  <th>Satuan</th>
                  <th>Harga Satuan</th>
                  <th>Jumlah</th>
                  <th className="simprok-rab-col-aksi">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {numberedRows.length === 0 ? (
                  <tr>
                    <td colSpan={9}>
                      <div className="simprok-rab-empty-state" role="status">
                        <p>
                          <strong>{rabLocked ? 'RAB terkunci tidak memuat item pekerjaan.' : 'Draft RAB masih kosong.'}</strong>
                        </p>
                        {rabLocked ? null : <p>Tambahkan Sub Judul atau Item pekerjaan untuk mulai menyusun RAB.</p>}
                        <div className="simprok-rab-empty-state__actions">
                          <button className="simprok-rab-add-sub" onClick={() => addChild(null, 'folder')} disabled={!canEditDraft} aria-label="Tambah Sub Judul ke draft">
                            + Sub Judul
                          </button>
                          <button className="simprok-rab-add-item" onClick={() => addChild(null, 'item')} disabled={!canEditDraft} aria-label="Tambah Item pekerjaan ke draft">
                            + Item
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null}
                {numberedRows.map((row) => {
                  const unitPrice = unitPrices[row.id] ?? row.unitPrice;
                  const isKernelEligible = row.ahspVersionId !== null;
                  // RM-03D1: the row cell describes the row, so it reads the
                  // resolved status — a persisted row shows its stored price,
                  // not the LIVE read's OCCURRENCE_NOT_FOUND.
                  const costStatus = resolvedCostRowStatuses[row.id];
                  const costDisplay = costStatus ? toRabCostDisplay(costStatus) : null;
                  const amount = row.type === 'item' ? (volumes[row.id] || 0) * unitPrice : 0;
                  const selected = row.id === selectedRowId;
                  const hasNegativeRowValue = negativeRows.has(row.id);
                  const siblings = siblingsByParent.get(row.parentId) ?? [];
                  const siblingIndex = siblings.findIndex((r) => r.id === row.id);
                  const prevSibling = siblingIndex > 0 ? siblings[siblingIndex - 1] : null;
                  const canIndent = prevSibling !== null && prevSibling.type === 'folder';
                  const canOutdent = row.parentId !== null;

                  if (row.type === 'note') {
                    return (
                      <tr key={row.id} className="simprok-rab-row simprok-rab-row--note">
                        <td>
                          <div className="simprok-rab-row-move">
                            <button onClick={() => mutateRows((current) => moveWithinSiblings(current, row.id, 'up'))} disabled={!canEditDraft} title="Pindah baris ke atas" aria-label="Pindah baris ke atas">
                              <ArrowUp size={14} />
                            </button>
                            <button onClick={() => mutateRows((current) => indentRow(current, row.id))} disabled={!canEditDraft || !canIndent} title="Jadikan sub-bagian" aria-label="Jadikan sub-bagian">
                              <ArrowRight size={14} />
                            </button>
                            <button onClick={() => mutateRows((current) => moveWithinSiblings(current, row.id, 'down'))} disabled={!canEditDraft} title="Pindah baris ke bawah" aria-label="Pindah baris ke bawah">
                              <ArrowDown size={14} />
                            </button>
                            <button onClick={() => mutateRows((current) => outdentRow(current, row.id))} disabled={!canEditDraft || !canOutdent} title="Naikkan tingkat" aria-label="Naikkan tingkat">
                              <ArrowLeft size={14} />
                            </button>
                          </div>
                        </td>
                        <td></td>
                        <td></td>
                        <td colSpan={5} style={{ paddingLeft: `${row.depth * 18 + 12}px` }}>
                          <input className="simprok-rab-description-input" value={row.name} readOnly={!canEditDraft} aria-readonly={!canEditDraft} onChange={(event) => updateRowName(row.id, event.target.value)} aria-label="Uraian catatan" />
                        </td>
                        <td>
                          <button className="simprok-rab-delete" onClick={() => removeRow(row.id)} disabled={!canEditDraft} title="Hapus catatan" aria-label="Hapus catatan">
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={row.id} className={['simprok-rab-row', row.type === 'folder' ? 'simprok-rab-row--folder' : '', selected ? 'simprok-rab-row--selected' : '', hasNegativeRowValue ? 'simprok-rab-row--invalid' : ''].filter(Boolean).join(' ')} onClick={(event) => handleRowClick(row.id, event)}>
                      <td>
                        <div className="simprok-rab-row-move">
                          <button onClick={() => mutateRows((current) => moveWithinSiblings(current, row.id, 'up'))} disabled={!canEditDraft} title="Pindah baris ke atas" aria-label="Pindah baris ke atas">
                            <ArrowUp size={14} />
                          </button>
                          <button onClick={() => mutateRows((current) => indentRow(current, row.id))} disabled={!canEditDraft || !canIndent} title="Jadikan sub-bagian" aria-label="Jadikan sub-bagian">
                            <ArrowRight size={14} />
                          </button>
                          <button onClick={() => mutateRows((current) => moveWithinSiblings(current, row.id, 'down'))} disabled={!canEditDraft} title="Pindah baris ke bawah" aria-label="Pindah baris ke bawah">
                            <ArrowDown size={14} />
                          </button>
                          <button onClick={() => mutateRows((current) => outdentRow(current, row.id))} disabled={!canEditDraft || !canOutdent} title="Naikkan tingkat" aria-label="Naikkan tingkat">
                            <ArrowLeft size={14} />
                          </button>
                        </div>
                      </td>
                      <td className="simprok-rab-row__number">{row.number}</td>
                      <td>
                        {row.type === 'item' ? (
                          <div className="simprok-rab-ahsp-cell">
                            {row.ahsp ? (
                              /* The AHSP door: what analysis is used for one
                                 unit of this work. It shows the AHSP's own
                                 identity — there is no AHSP code in this
                                 domain, and the row's wbsCode is not one. */
                              <button className="simprok-rab-ahsp-code" onClick={() => activateRow(row.id, 'AHSP_ANALYSIS')} title={resolveAhspIdentity(row.ahsp).fullLabel} aria-label={`Buka analisa AHSP: ${resolveAhspIdentity(row.ahsp).fullLabel}`} data-route={`/?ruang=detail-ahsp-${row.id}`}>
                                {resolveAhspIdentity(row.ahsp).shortLabel}
                              </button>
                            ) : (
                              canEditDraft ? (
                                <button className="simprok-rab-ahsp-pick" onClick={() => activateRow(row.id)} title="Pilih AHSP" aria-label="Pilih AHSP" data-route={`/?ruang=pilih-ahsp-${row.id}`}>
                                  Pilih AHSP
                                </button>
                              ) : (
                                /* Choosing is a write. On a frozen row there is
                                   also nothing behind it to read — a row with no
                                   AHSP has no analysis to trace — so the invitation
                                   becomes the plain fact instead. The Detail control
                                   in the Aksi column still opens this row. */
                                <span className="simprok-rab-ahsp-badge" aria-label="Tanpa AHSP">Tanpa AHSP</span>
                              )
                            )}
                            {row.manualAhsp ? <span className="simprok-rab-ahsp-badge simprok-rab-ahsp-badge--manual">MANUAL</span> : null}
                            <span
                              className="simprok-rab-ahsp-badge"
                              title={
                                row.priceOrigin === 'SERVER_COST_KERNEL' && row.calculationAsOfDate
                                  ? `Harga per tanggal ${row.calculationAsOfDate}`
                                  : undefined
                              }
                            >
                              {selectionStatusByRow[row.id] ??
                                (row.workingOccurrenceId && row.calculationOccurrenceId
                                  ? 'Perhitungan ulang tertunda'
                                  : // RM-03: a persisted line states its own stored
                                    // origin, which survives a reload, in preference
                                    // to the transient recalculation badge.
                                    row.priceOrigin === 'SERVER_COST_KERNEL'
                                    ? getPriceOriginBadge(row.priceOrigin)
                                    : costDisplay
                                      ? costDisplay.badge
                                      : row.ahsp
                                        ? 'Standby'
                                        : 'Menunggu rekomendasi')}
                            </span>
                          </div>
                        ) : row.type === 'folder' ? (
                          <small>{row.category}</small>
                        ) : null}
                      </td>
                      <td style={{ paddingLeft: `${row.depth * 18 + 12}px` }}>
                        <span className="simprok-rab-row__name">
                          {row.type === 'folder' ? <FolderOpen size={16} /> : null}
                          <input className="simprok-rab-description-input" value={row.name} readOnly={!canEditDraft} aria-readonly={!canEditDraft} onChange={(event) => updateRowName(row.id, event.target.value)} aria-label={`Uraian ${row.type === 'folder' ? 'sub judul' : 'item pekerjaan'}`} />
                        </span>
                      </td>
                      <td>
                        {row.type === 'item' ? (
                          <input
                            className={(volumes[row.id] || 0) < 0 ? 'simprok-rab-number-invalid' : ''}
                            type="number"
                            step="0.01"
                            value={volumes[row.id] || 0}
                            readOnly={!canEditDraft}
                            aria-readonly={!canEditDraft}
                            onChange={(event) => {
                              const volume = Number(event.target.value);
                              applyLocalEdit(() => {
                                setVolumes((current) => ({ ...current, [row.id]: volume }));
                                setCostRowStatuses((current) => invalidateRow(current, row.id));
                              });
                            }}
                            aria-label={`Volume ${row.name}`}
                          />
                        ) : null}
                      </td>
                      <td>{row.type === 'item' ? <input className="simprok-rab-description-input" value={row.unit} readOnly={!canEditDraft} aria-readonly={!canEditDraft} onChange={(event) => updateRowUnit(row.id, event.target.value)} aria-label={`Satuan ${row.name}`} /> : null}</td>
                      <td className="simprok-rab-unit-price-column">
                        {row.type === 'item' ? (
                          <span className="simprok-rab-price-cell">
                            {isKernelEligible ? (
                              costStatus?.kind === 'calculated' ? (
                                <strong aria-label={`Harga satuan ${row.name}`}>{costDisplay?.unitPrice}</strong>
                              ) : row.persistedUnitPrice !== null &&
                                row.priceOrigin === 'SERVER_COST_KERNEL' ? (
                                /**
                                 * RM-03 hard-reload truth. The transient batch
                                 * recalculation follows workingOccurrenceId,
                                 * which a successful persist clears — so after
                                 * a reload it answers OCCURRENCE_NOT_FOUND and
                                 * this cell used to fall back to "—", making a
                                 * saved price look lost. The persisted value is
                                 * the authority for a persisted row; it is
                                 * rendered as the exact server string, never
                                 * re-derived here.
                                 */
                                <strong aria-label={`Harga satuan ${row.name}`}>
                                  {formatExactMoney(row.persistedUnitPrice)}
                                </strong>
                              ) : (
                                <span aria-label={`Harga satuan ${row.name}`} title={costDisplay?.badge}>—</span>
                              )
                            ) : row.manualUnitPrice ? (
                              <>
                                <input
                                  className={(unitPrices[row.id] ?? row.unitPrice) < 0 ? 'simprok-rab-number-invalid' : ''}
                                  type="text"
                                  inputMode="numeric"
                                  value={formatDraftNumber(unitPrices[row.id] ?? row.unitPrice)}
                                  readOnly={!canEditDraft}
                                  aria-readonly={!canEditDraft}
                                  onChange={(event) => {
                                    const unitPrice = parseDraftNumber(event.target.value);
                                    applyLocalEdit(() => {
                                      setUnitPrices((current) => ({ ...current, [row.id]: unitPrice }));
                                    });
                                  }}
                                  aria-label={`Harga satuan ${row.name}`}
                                />
                                <span className="simprok-rab-manual-chip">MANUAL</span>
                              </>
                            ) : <span aria-label={`Harga satuan ${row.name}`}>—</span>}
                          </span>
                        ) : null}
                      </td>
                      <td className="simprok-rab-amount-column">
                        {row.type === 'item'
                          ? isKernelEligible
                            ? costStatus?.kind === 'calculated'
                              ? costDisplay?.lineTotal
                              : row.persistedLineTotal !== null &&
                                  row.priceOrigin === 'SERVER_COST_KERNEL'
                                ? formatExactMoney(row.persistedLineTotal)
                                : '—'
                            : row.manualUnitPrice ? formatRupiah(amount) : '—'
                          : ''}
                      </td>
                      <td>
                        <div className="simprok-rab-row-actions">
                          {row.type === 'folder' ? (
                            <>
                              <button className="simprok-rab-add-sub" onClick={() => addChild(row.id, 'folder')} disabled={!canEditDraft} title="Tambah Sub Judul" aria-label="Tambah Sub Judul">
                                + Sub Judul
                              </button>
                              <button className="simprok-rab-add-item" onClick={() => addChild(row.id, 'item')} disabled={!canEditDraft} title="Tambah Item" aria-label="Tambah Item">
                                + Item
                              </button>
                            </>
                          ) : row.type === 'item' ? (
                            /* A generic "Detail" that opened the same AHSP
                               panel as the AHSP code was not a second door.
                               This one answers the other question: why does
                               THIS project row cost THIS much. */
                            <button className="simprok-rab-table-action" onClick={() => activateRow(row.id, 'PRICE_TRACE')} title={PRICE_TRACE_TITLE} aria-label={`${PRICE_TRACE_ROW_ACTION}: ${row.name}`} data-route={`/?ruang=rincian-harga-${row.id}`}>
                              {PRICE_TRACE_ROW_ACTION}
                            </button>
                          ) : null}
                          <button className="simprok-rab-delete" onClick={() => removeRow(row.id)} disabled={!canEditDraft} title="Hapus baris" aria-label="Hapus baris">
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <footer className="simprok-rab-recap-zone" aria-label="Rekapitulasi Biaya RAB">
            <button className="simprok-rab-recap__ef" onClick={() => openPlaceholder('Atur Execution Factor')} title="Atur Execution Factor - engine belum aktif" aria-label="Atur Execution Factor - engine belum aktif" data-route="/?ruang=execution-factor">
              <Sparkles size={16} />
              <strong>Rekomendasi — Execution Factor</strong>
              <span>menunggu mesin, ruang sudah disiapkan</span>
            </button>
            <div className="simprok-rab-recap">
              <h3 className="simprok-rab-recap__title">Rekapitulasi Biaya</h3>
              {!pricingComplete ? (
                <p className="simprok-rab-recap__incomplete-note" role="status">
                  Belum dihitung — satu atau lebih item pekerjaan belum mempunyai harga.
                </p>
              ) : null}
              <div className="simprok-rab-recap__rows">
                <div className="simprok-rab-recap__row simprok-rab-recap__row--plain">
                  <span className="simprok-rab-recap__label">Total / Biaya Langsung</span>
                  <strong className="simprok-rab-recap__value">{pricingComplete ? formatBackendRupiah(directCostTotalExact) : 'Belum dihitung'}</strong>
                </div>
                <div className="simprok-rab-recap__row">
                  <span className="simprok-rab-recap__label">Margin / Profit</span>
                  <span className="simprok-rab-recap__input-wrap">
                    <input type="number" min="0" value={marginPercent} readOnly={!canEditDraft} aria-readonly={!canEditDraft} onChange={(event) => { const margin = Number(event.target.value); applyLocalEdit(() => setMarginPercent(margin)); }} aria-label="Persentase margin" />
                    <span>%</span>
                  </span>
                  <strong className="simprok-rab-recap__value">{pricingComplete ? formatRupiah(margin) : '—'}</strong>
                </div>
                <div className="simprok-rab-recap__row">
                  <span className="simprok-rab-recap__label">Pajak / PPN</span>
                  <span className="simprok-rab-recap__input-wrap">
                    <input type="number" min="0" value={ppnPercent} readOnly={!canEditDraft} aria-readonly={!canEditDraft} onChange={(event) => { const ppn = Number(event.target.value); applyLocalEdit(() => setPpnPercent(ppn)); }} aria-label="Persentase PPN" />
                    <span>%</span>
                  </span>
                  <strong className="simprok-rab-recap__value">{pricingComplete ? formatRupiah(ppn) : '—'}</strong>
                </div>
                <div className="simprok-rab-recap__divider" role="presentation" />
                <div className="simprok-rab-recap__row simprok-rab-recap__row--grand">
                  <span className="simprok-rab-recap__label">Grand Total Estimasi</span>
                  <strong className="simprok-rab-recap__value">{pricingComplete ? formatRupiah(grandTotal) : 'Belum dihitung'}</strong>
                </div>
              </div>
            </div>
          </footer>
        </section>

        {selectedItem ? (
          <aside className="simprok-ahsp-drawer" aria-label="Detail Analisa AHSP">
            <div className="simprok-ahsp-drawer__header">
              <div>
                <h2>{drawerMode === 'PRICE_TRACE' ? PRICE_TRACE_TITLE : 'Detail Analisa AHSP'}</h2>
              </div>
              <button onClick={() => activateRow('')} title="Tutup panel" aria-label="Tutup panel">
                <X size={17} />
              </button>
            </div>
            <div className="simprok-ahsp-drawer__selected">
              <strong>{selectedItem.name}</strong>
              <small>
                {selectedItem.number} - {selectedItem.unit || 'satuan menunggu data'}
              </small>
            </div>
            {drawerMode === 'PRICE_TRACE' ? (
              /* Why THIS project row costs THIS much. Every value is the
                 string already persisted for this row — nothing is computed
                 here, and opening this panel writes nothing. */
              <div className="simprok-ahsp-meta" aria-label={PRICE_TRACE_TITLE}>
                {(() => {
                  const trace = buildPriceTrace({
                    description: selectedItem.name,
                    unit: selectedItem.unit,
                    quantityDisplay: formatDraftNumber(volumes[selectedItem.id] ?? 0),
                    unitPriceDisplay: selectedCostDisplay?.unitPrice ?? '',
                    lineTotalDisplay: selectedCostDisplay?.lineTotal ?? '',
                    priceOrigin: selectedItem.priceOrigin ?? null,
                    isWorkItem: selectedItem.type === 'item',
                    ahsp: selectedItem.ahsp,
                    provenance: {
                      calculationAsOfDate: selectedItem.calculationAsOfDate ?? null,
                      calculationOccurrenceId: selectedItem.calculationOccurrenceId ?? null,
                    },
                  });
                  return (
                    <>
                      {trace.facts.map((fact) => (
                        <div key={fact.label}>
                          <span>{fact.label}</span>
                          <strong>{fact.value}</strong>
                        </div>
                      ))}
                      {trace.unavailable.map((message) => (
                        <div key={message}>
                          <span>Belum tersedia</span>
                          <strong style={{ color: '#98A2B3', fontWeight: 400 }}>{message}</strong>
                        </div>
                      ))}
                      {trace.technicalFacts.length > 0 ? (
                        <details>
                          <summary style={{ cursor: 'pointer' }}>{TECHNICAL_DETAIL_TITLE}</summary>
                          {trace.technicalFacts.map((fact) => (
                            <div key={fact.label}>
                              <span>{fact.label}</span>
                              <strong style={{ wordBreak: 'break-all' }}>{fact.value}</strong>
                            </div>
                          ))}
                        </details>
                      ) : null}
                    </>
                  );
                })()}
              </div>
            ) : null}
            <div className="simprok-ahsp-meta">
              <div>
                {/* There is no AHSP code in this domain — an AHSP is its work
                    type, its method and a version. This used to show the row's
                    wbsCode under an "AHSP" label, which named the wrong thing. */}
                <span>Analisa AHSP</span>
                <strong>{resolveAhspIdentity(selectedItem.ahsp).fullLabel}</strong>
              </div>
              <div>
                <span>Status AHSP</span>
                <strong>{costEngineStatus.statusLabel}</strong>
              </div>
              <div>
                <span>Sumber Harga</span>
                <strong>{costEngineStatus.sourceLabel}</strong>
              </div>
              <div>
                <span>Persistensi</span>
                <strong>{!projectId ? 'Belum ada project aktif' : rabLocked ? 'Terkunci, tersimpan di server' : 'Draft tersimpan di server'}</strong>
              </div>
            </div>
            <div className="simprok-ahsp-drawer__frame">
              <span className="simprok-honest-frame__badge">{costEngineStatus.frameBadge}</span>
              <p>{costEngineStatus.frameMessage}</p>
            </div>
            <button className="simprok-execution-factor" onClick={() => openPlaceholder('Atur Execution Factor')} title="Atur Execution Factor - engine belum aktif" aria-label="Atur Execution Factor - engine belum aktif" data-route="/?ruang=execution-factor">
              <Sparkles size={18} />
              <span>
                <strong>Atur Execution Factor</strong>
                <small>Rekomendasi kondisi lapangan menunggu mesin.</small>
              </span>
            </button>
            <div className="simprok-ahsp-total">
              <span>Total Harga Satuan</span>
              <strong>{selectedCostDisplay?.unitPrice ?? formatRupiah(unitPrices[selectedItem.id] ?? selectedItem.unitPrice)}</strong>
            </div>
            <div className="simprok-persist-action" aria-label="Hitung dan Simpan Harga SIMPROK">
              <label htmlFor="simprok-calculation-as-of-date">Tanggal perhitungan harga</label>
              <input
                id="simprok-calculation-as-of-date"
                type="date"
                value={calculationAsOfDate}
                readOnly={!canEditDraft}
                aria-readonly={!canEditDraft}
                onChange={(event) => canEditDraft && handleCalculationAsOfDateChange(event.target.value)}
                disabled={isPersistBusy}
                aria-label="Tanggal perhitungan harga"
              />
              {draftDirty ? (
                <p className="simprok-rab-recap__incomplete-note" role="status">
                  Simpan perubahan draft terlebih dahulu bila Anda baru mengubah data item.
                </p>
              ) : null}
              <button
                className="simprok-ahsp-drawer__primary"
                onClick={handlePersistCalculation}
                disabled={persistReachability !== 'READY'}
                title={PERSIST_REACHABILITY_TITLE[persistReachability]}
                aria-label="Hitung & Simpan Harga SIMPROK"
              >
                <Save size={17} /> {isPersistBusy ? 'Menghitung & menyimpan...' : 'Hitung & Simpan Harga SIMPROK'}
              </button>
              {persistState.kind === 'success' && isPersistResultFresh(persistState.target, currentPersistIdentity) ? (
                <div className="simprok-rab-validation-alert simprok-rab-validation-alert--info" role="status">
                  <p>Harga SIMPROK berhasil dihitung dan disimpan.</p>
                  <p>{persistState.target.itemLabel}: {persistState.unitPriceDisplay} / {persistState.lineTotalDisplay}</p>
                  <button
                    className="simprok-rab-action simprok-rab-action--secondary"
                    onClick={() => navigate(`/project/${projectId}/rab`)}
                  >
                    Lihat hasil tersimpan
                  </button>
                </div>
              ) : null}
              {persistState.kind === 'failed_confirmed' && isPersistResultFresh(persistState.target, currentPersistIdentity) ? (
                <div className="simprok-rab-validation-alert" role="alert">
                  Harga belum dapat disimpan: {persistState.reason}
                </div>
              ) : null}
              {persistState.kind === 'outcome_unknown' && persistState.target.projectId === projectId && persistState.target.boqItemId === selectedItem.id ? (
                <div className="simprok-rab-validation-alert" role="alert">
                  Status penyimpanan tidak dapat dipastikan. Muat ulang draft untuk memastikan status harga sebelum mencoba lagi.
                </div>
              ) : null}
            </div>
            {persistedProofDisplay ? (
              <div className="simprok-persist-action" aria-label="Penelusuran harga tersimpan">
                <h4 style={{ margin: 0, color: 'var(--simprok-authority-navy-900)' }}>
                  Penelusuran harga tersimpan
                </h4>
                <p
                  role="status"
                  style={{
                    margin: '4px 0 0',
                    color:
                      persistedProofDisplay.kind === 'mismatch'
                        ? 'var(--simprok-critical-red-600)'
                        : persistedProofDisplay.kind === 'verified'
                          ? 'var(--simprok-authority-navy-900)'
                          : 'var(--simprok-catatan-muted)',
                  }}
                >
                  <strong>{persistedProofDisplay.badge}</strong> — {persistedProofDisplay.message}
                </p>

                {persistedProofDisplay.provenance ? (
                  <>
                    <dl
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'auto 1fr',
                        gap: '2px 12px',
                        margin: '10px 0 0',
                        fontSize: '12px',
                        color: 'var(--simprok-catatan-muted)',
                      }}
                    >
                      <dt>Harga satuan tersimpan</dt>
                      <dd style={{ margin: 0, color: 'var(--simprok-authority-navy-900)' }}>
                        {persistedProofDisplay.storedUnitPriceDisplay}
                      </dd>
                      <dt>Dihitung ulang</dt>
                      <dd
                        style={{
                          margin: 0,
                          color:
                            persistedProofDisplay.kind === 'mismatch'
                              ? 'var(--simprok-critical-red-600)'
                              : 'var(--simprok-authority-navy-900)',
                        }}
                      >
                        {persistedProofDisplay.recomputedUnitPriceDisplay}
                      </dd>
                      <dt>Jumlah tersimpan</dt>
                      <dd style={{ margin: 0, color: 'var(--simprok-authority-navy-900)' }}>
                        {persistedProofDisplay.storedLineTotalDisplay}
                      </dd>
                      <dt>Volume</dt>
                      <dd style={{ margin: 0 }}>
                        {persistedProofDisplay.volumeDisplay} {persistedProofDisplay.unit}
                      </dd>
                      <dt>Per tanggal</dt>
                      <dd style={{ margin: 0 }}>{persistedProofDisplay.provenance.asOfDate}</dd>
                      <dt>Region harga</dt>
                      <dd style={{ margin: 0 }}>{persistedProofDisplay.provenance.regionName}</dd>
                      <dt>Kebijakan hitung</dt>
                      <dd style={{ margin: 0 }}>{persistedProofDisplay.provenance.policyVersion}</dd>
                    </dl>

                    <table
                      style={{
                        width: '100%',
                        marginTop: '10px',
                        borderCollapse: 'collapse',
                        fontSize: '12px',
                      }}
                    >
                      <caption
                        style={{
                          captionSide: 'top',
                          textAlign: 'left',
                          padding: '0 0 4px',
                          color: 'var(--simprok-catatan-muted)',
                        }}
                      >
                        Komponen pembentuk harga satuan
                      </caption>
                      <thead>
                        <tr style={{ textAlign: 'left', color: 'var(--simprok-catatan-muted)' }}>
                          <th scope="col">Komponen</th>
                          <th scope="col">Koefisien</th>
                          <th scope="col">Harga dasar</th>
                          <th scope="col">Biaya</th>
                        </tr>
                      </thead>
                      <tbody>
                        {persistedProofDisplay.resources.map((resource) => (
                          <tr
                            key={resource.resolutionId}
                            style={{ borderTop: '1px solid var(--simprok-catatan-line)' }}
                          >
                            <th
                              scope="row"
                              style={{ textAlign: 'left', fontWeight: 400 }}
                              title={`${resource.type} · Basic Price ${resource.basicPriceId ?? '—'} · berlaku ${resource.effectiveDate} · ${resource.sourceOrigin}`}
                            >
                              {resource.name}
                            </th>
                            <td>
                              {resource.coefficientDisplay} {resource.ahspUnit}
                            </td>
                            <td>{resource.adaptedPriceDisplay}</td>
                            <td style={{ color: 'var(--simprok-authority-navy-900)' }}>
                              {resource.resourceCostDisplay}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                ) : null}
              </div>
            ) : null}
            <div className="simprok-persist-action" aria-label="Pilihan AHSP kontekstual">
              <label htmlFor="simprok-ahsp-version-selector">AHSP Version</label>
              <select
                id="simprok-ahsp-version-selector"
                value={selectedAhspVersionId}
                onChange={(event) => setSelectedAhspVersionId(event.target.value)}
                disabled={!canEditDraft || isSelectingAhsp}
              >
                <option value="">Pilih AHSP Version</option>
                {eligibleAhspVersions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {formatAhspVersionOption(version)}
                  </option>
                ))}
              </select>
              {isWorkspacePrivateAhsp(
                eligibleAhspVersions.find(
                  (version) => version.id === selectedAhspVersionId,
                )?.origin,
              ) ? (
                /**
                 * RM-03B honesty: a private AHSP is usable immediately and needs
                 * no publication — but the user must not mistake it for a
                 * SIMPROK-curated analysis. It says whose analysis it is, and
                 * claims nothing about review or verification that never happened.
                 */
                <p
                  className="simprok-rab-recap__incomplete-note"
                  role="status"
                  style={{ color: 'var(--simprok-catatan-muted)' }}
                >
                  Analisa milik workspace Anda sendiri — bukan kurasi SIMPROK.
                  Harga dasarnya tetap berasal dari Basic Price yang sah.
                </p>
              ) : null}
              <label htmlFor="simprok-region-selector">Region harga</label>
              <select
                id="simprok-region-selector"
                value={selectedRegionId}
                onChange={(event) => setSelectedRegionId(event.target.value)}
                disabled={!canEditDraft || isSelectingAhsp}
              >
                <option value="">Pilih Region</option>
                {activeRegions.map((region) => (
                  <option key={region.id} value={region.id}>{region.code} — {region.name}</option>
                ))}
              </select>
              <button
                className="simprok-ahsp-drawer__primary"
                onClick={handlePickAhsp}
                disabled={!canEditDraft || !selectedAhspVersionId || !selectedRegionId || isSelectingAhsp}
                title="Pilih / Ganti AHSP"
                aria-label="Pilih / Ganti AHSP"
                data-route="/?ruang=pilih-ganti-ahsp"
              >
                <ListChecks size={17} /> {isSelectingAhsp ? 'Memproses...' : 'Pilih / Ganti AHSP'}
              </button>
            </div>
          </aside>
        ) : null}
      </main>
    </div>
  );
}
