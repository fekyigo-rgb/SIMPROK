import { type MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
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
  applyBatchResults,
  beginLoadingRows,
  buildPersistCalculationRequestBody,
  classifyPersistOutcome,
  computeDirectCostTotal,
  derivePersistFailureReason,
  evaluatePersistActionReachability,
  formatBackendRupiah,
  formatBoqImportMeasurement,
  GENERIC_PERSIST_FAILURE_REASON,
  invalidateRow,
  isDraftPricingComplete,
  markRequestFailed,
  toLocalDateOnlyString,
  toRabCostDisplay,
  type CostBatchResponse,
  type CostRowStatus,
  type PersistActionReachability,
  type PersistReloadOutcome,
} from '../utils/rabCostDisplay';
import type { DashboardOutletContext } from '../components/layout/DashboardLayout';

type RabRowType = 'folder' | 'item' | 'note';

interface RabRow {
  id: string;
  parentId: string | null;
  type: RabRowType;
  name: string;
  ahspCode: string;
  /** Non-null only for WORK_ITEM rows with an AHSP association — the Cost Kernel eligibility flag. */
  ahspVersionId: string | null;
  category: string;
  unit: string;
  unitPrice: number;
  manualUnitPrice: boolean;
  manualAhsp: boolean;
  sortOrder: number;
}

interface BoqItemResponse {
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

const buildNumberedRows = (rows: RabRow[]): NumberedRabRow[] => {
  const sortedRows = [...rows].sort((a, b) => a.sortOrder - b.sortOrder);
  const childrenByParent = sortedRows.reduce<Record<string, RabRow[]>>((acc, row) => {
    const key = row.parentId || 'root';
    acc[key] = [...(acc[key] || []), row];
    return acc;
  }, {});
  const result: NumberedRabRow[] = [];

  const visit = (parentId: string | null, prefix: number[], depth: number) => {
    const children = childrenByParent[parentId || 'root'] || [];
    children.forEach((row, index) => {
      const numberParts = [...prefix, index + 1];
      const number = row.type === 'note' ? '' : numberParts.join('.');
      result.push({ ...row, number, depth });
      visit(row.id, numberParts, depth + 1);
    });
  };

  visit(null, [], 0);
  return result;
};

const mapBoqToRows = (items: BoqItemResponse[]) => items
  .map((item, index): RabRow => ({
    id: item.id,
    parentId: item.parentId || null,
    type: item.itemType === 'FOLDER' ? 'folder' : item.itemType === 'NOTE' ? 'note' : 'item',
    name: item.name,
    ahspCode: item.ahspVersionId || item.ahspSnapshotId ? item.wbsCode.trim() : '',
    ahspVersionId: item.itemType === 'WORK_ITEM' ? (item.ahspVersionId ?? null) : null,
    category: item.itemType === 'FOLDER' ? 'Subjudul' : item.itemType === 'NOTE' ? 'Catatan' : 'Standby',
    unit: item.unit || '',
    unitPrice: toNumber(item.unitPrice),
    manualUnitPrice: item.unitPrice !== null && item.unitPrice !== undefined,
    manualAhsp: false,
    sortOrder: item.sortOrder ?? index,
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
  ahspCode: type === 'item' ? '' : '',
  ahspVersionId: null,
  category: type === 'folder' ? 'Subjudul' : type === 'note' ? 'Catatan' : 'Standby',
  unit: type === 'item' ? 'ls' : '',
  unitPrice: 0,
  manualUnitPrice: type === 'item',
  manualAhsp: false,
  sortOrder,
});

interface PersistTarget {
  projectId: string;
  boqItemId: string;
  itemLabel: string;
  calculationAsOfDate: string;
}

/**
 * GATE2A-PRODUCTIZATION-C: mirrors RabKernelPersistenceService's
 * PersistBoqItemCalculationResult exactly — this page never invents its own
 * shape for the persisted result, it only reads what the server returns.
 */
interface PersistBoqItemCalculationResponse {
  boqItemId: string;
  unitPrice: string;
  lineTotal: string;
  priceOrigin: 'SERVER_COST_KERNEL';
  calculationOccurrenceId: string;
  calculationAsOfDate: string;
  calculatedAt: string;
  calculationPolicyVersion: string;
  rabTotals: {
    pricingStatus: 'COMPLETE';
    totalBaseCost: string;
    totalFinalCost: string;
  };
}

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
  const persistGenerationRef = useRef(0);

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

  const applyRows = (items: BoqItemResponse[]) => {
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
    setSelectedRowId(mappedRows.find((row) => row.type === 'item')?.id || '');
    setDraftDirty(false);
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
    if (!projectId) {
      costLoadGenerationRef.current += 1;
      setRows([]);
      setVolumes({});
      setUnitPrices({});
      setCostRowStatuses({});
      setSelectedRowId('');
      setDraftDirty(false);
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

      if (data.capability?.canEditDraft !== true) {
        setCapabilityState({ kind: 'lifecycle-denied', reasonCode: data.capability?.reasonCode ?? null });
        return;
      }

      setCapabilityState({ kind: 'ready', canEditDraft: true });

      applyRecap(data.recap);
      if (data.items.length > 0) {
        applyRows(data.items);
        loadCostCalculations(data.items);
        setStatusMessage('Draft tersimpan dimuat. Ruang kerja siap.');
        return;
      }

      // No saved draft — seed from baseline if available, else empty
      const baselineResponse = await apiFetch(`/projects/${projectId}/boq`).catch(() => null);
      if (cancelled) return;
      const baseline = baselineResponse && baselineResponse.ok ? await baselineResponse.json() : [];
      const baselineItems = Array.isArray(baseline) ? (baseline as BoqItemResponse[]) : [];
      if (baselineItems.length > 0) {
        applyRows(baselineItems);
        loadCostCalculations(baselineItems);
        setStatusMessage('Draft kosong. Data baseline dimuat sebagai titik awal — klik Simpan Draft untuk menyimpan perubahan.');
      } else {
        costLoadGenerationRef.current += 1;
        setRows([]);
        setVolumes({});
        setUnitPrices({});
        setCostRowStatuses({});
        setSelectedRowId('');
        setStatusMessage('Draft kosong. Tambahkan item pekerjaan, lalu klik Simpan Draft.');
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, retryToken]);

  const numberedRows = useMemo(() => buildNumberedRows(rows), [rows]);
  const selectedItem = useMemo(() => {
    const row = numberedRows.find((item) => item.id === selectedRowId);
    return row?.type === 'item' ? row : null;
  }, [numberedRows, selectedRowId]);
  const selectedCostStatus = selectedItem ? costRowStatuses[selectedItem.id] : undefined;
  const selectedCostDisplay = selectedCostStatus ? toRabCostDisplay(selectedCostStatus) : null;
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
        costRowStatuses,
      ),
    [rows, unitPrices, volumes, costRowStatuses],
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
        costRowStatuses,
      ),
    [rows, costRowStatuses],
  );

  const [showBackflowWarning, setShowBackflowWarning] = useState(false);

  const openPlaceholder = (action: string) => {
    setStatusMessage(`${action}: fitur disiapkan, belum aktif.`);
  };

  const handlePickAhsp = () => {
    setStatusMessage('Pemilihan AHSP belum tersambung. Ruang pilihan AHSP sudah disiapkan.');
  };

  const activateRow = (rowId: string) => {
    setSelectedRowId(rowId);
  };

  const handleRowClick = (rowId: string, event: MouseEvent<HTMLTableRowElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('button, input, textarea, a')) return;
    activateRow(rowId);
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
        wbsCode: row.ahspCode || '',
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
   * Every local-only row edit funnels through here so draftDirty stays a
   * single, bounded, honest flag — cleared only by applyRows (a real server
   * sync), never by a local mutation. GATE2A-PRODUCTIZATION-C: the persist
   * action's reload would otherwise silently overwrite unsaved local edits.
   */
  const mutateRows = (updater: (current: RabRow[]) => RabRow[]) => {
    setDraftDirty(true);
    setRows(updater);
  };

  const addChild = (parentId: string | null, type: RabRowType) => {
    const newRow = createRow(type, parentId, Math.max(0, ...rows.map((row) => row.sortOrder)) + 1);
    mutateRows((current) => [...current, newRow]);
    if (type === 'item') setUnitPrices((current) => ({ ...current, [newRow.id]: 0 }));
    setStatusMessage(`${type === 'folder' ? 'Sub Judul' : type === 'note' ? 'Catatan' : 'Item'} ditambahkan. Klik Simpan Draft untuk menyimpan.`);
  };

  const removeRow = (rowId: string) => {
    mutateRows((current) => {
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

  const reloadDraft = async () => {
    if (!projectId) return;
    const response = await apiFetch(`/projects/${projectId}/boq/draft`);
    if (!response.ok) throw new Error('draft-reload-failed');
    const draft = await response.json() as DraftBoqResponse;
    applyRecap(draft.recap); applyRows(draft.items); loadCostCalculations(draft.items);
  };

  /**
   * GATE2A-PRODUCTIZATION-C — the one minimal persist action. Sends only
   * calculationAsOfDate to the existing Gate-2A persist route; the backend
   * (RabKernelPersistenceService) remains sole authority for eligibility,
   * calculation, persistence, provenance, and the whole-RAB total. The
   * request target (project/item/date) is captured once at click time so a
   * later selection change can never cause this response to be displayed
   * against a different item — combined with persistGenerationRef, a stale
   * response for a superseded attempt is dropped outright.
   */
  const handlePersistCalculation = () => {
    if (!projectId || !selectedItem || persistReachability !== 'READY') return;
    const target: PersistTarget = {
      projectId,
      boqItemId: selectedItem.id,
      itemLabel: selectedItem.name,
      calculationAsOfDate,
    };
    const generation = ++persistGenerationRef.current;
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
          setPersistState({ kind: 'failed_confirmed', target, reason });
        }
        return;
      }

      setPersistState({ kind: 'reloading', target });
      let reloadOutcome: PersistReloadOutcome;
      let result: PersistBoqItemCalculationResponse | undefined;
      try {
        result = (await response.json()) as PersistBoqItemCalculationResponse;
        await reloadDraft();
        reloadOutcome = { kind: 'success' };
      } catch {
        reloadOutcome = { kind: 'error' };
      }

      if (generation !== persistGenerationRef.current) return;

      const outcome = classifyPersistOutcome({ kind: 'response', ok: true }, reloadOutcome);
      if (outcome === 'SUCCESS' && result) {
        setPersistState({
          kind: 'success',
          target,
          unitPriceDisplay: formatBackendRupiah(result.unitPrice),
          lineTotalDisplay: formatBackendRupiah(result.lineTotal),
        });
      } else {
        // Covers both a malformed 2xx body and a reload failure after a
        // confirmed 2xx — never a false SUCCESS, never claimed "not saved".
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
          <p>{projectId ? `Project: ${projectId}. Ruang kerja draft RAB — edit dan simpan sebelum baseline resmi.` : 'Tidak ada project aktif. Navigasi dari Proyek Saya untuk membuka ruang kerja.'}</p>
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
        <button className="simprok-rab-toolbar__save" onClick={handleSaveDraft} title={isSaving ? 'Menyimpan...' : 'Simpan Draft ke server'} aria-label="Simpan Draft" data-route="/?ruang=simpan-draft" aria-disabled={hasNegativeValue || isSaving || !projectId || !canEditDraft}>
          <Save size={17} /> {isSaving ? 'Menyimpan...' : 'Simpan Draft'}
        </button>
        <button className="simprok-rab-toolbar__lock" onClick={() => openPlaceholder('Kunci RAB')} title="Kunci RAB - menunggu mesin finalisasi" aria-label="Kunci RAB - belum aktif" data-route="/?ruang=kunci-rab" aria-disabled={true}>
          <LockKeyhole size={17} /> Kunci RAB
        </button>
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

      <main className="simprok-rab-workspace__body">
        <section className="simprok-rab-sheet" aria-label="Tabel RAB">
          <div className="simprok-rab-sheet__label">
            <strong>Draft RAB</strong>
            <span>{projectId ? 'Draft tersimpan di server — edit bebas, simpan kapan saja' : 'Tidak ada project aktif'}</span>
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
                          <strong>Draft RAB masih kosong.</strong>
                        </p>
                        <p>Tambahkan Sub Judul atau Item pekerjaan untuk mulai menyusun RAB.</p>
                        <div className="simprok-rab-empty-state__actions">
                          <button className="simprok-rab-add-sub" onClick={() => addChild(null, 'folder')} aria-label="Tambah Sub Judul ke draft">
                            + Sub Judul
                          </button>
                          <button className="simprok-rab-add-item" onClick={() => addChild(null, 'item')} aria-label="Tambah Item pekerjaan ke draft">
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
                  const costStatus = costRowStatuses[row.id];
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
                            <button onClick={() => mutateRows((current) => moveWithinSiblings(current, row.id, 'up'))} title="Pindah baris ke atas" aria-label="Pindah baris ke atas">
                              <ArrowUp size={14} />
                            </button>
                            <button onClick={() => mutateRows((current) => indentRow(current, row.id))} disabled={!canIndent} title="Jadikan sub-bagian" aria-label="Jadikan sub-bagian">
                              <ArrowRight size={14} />
                            </button>
                            <button onClick={() => mutateRows((current) => moveWithinSiblings(current, row.id, 'down'))} title="Pindah baris ke bawah" aria-label="Pindah baris ke bawah">
                              <ArrowDown size={14} />
                            </button>
                            <button onClick={() => mutateRows((current) => outdentRow(current, row.id))} disabled={!canOutdent} title="Naikkan tingkat" aria-label="Naikkan tingkat">
                              <ArrowLeft size={14} />
                            </button>
                          </div>
                        </td>
                        <td></td>
                        <td></td>
                        <td colSpan={5} style={{ paddingLeft: `${row.depth * 18 + 12}px` }}>
                          <input className="simprok-rab-description-input" value={row.name} onChange={(event) => updateRowName(row.id, event.target.value)} aria-label="Uraian catatan" />
                        </td>
                        <td>
                          <button className="simprok-rab-delete" onClick={() => removeRow(row.id)} title="Hapus catatan" aria-label="Hapus catatan">
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
                          <button onClick={() => mutateRows((current) => moveWithinSiblings(current, row.id, 'up'))} title="Pindah baris ke atas" aria-label="Pindah baris ke atas">
                            <ArrowUp size={14} />
                          </button>
                          <button onClick={() => mutateRows((current) => indentRow(current, row.id))} disabled={!canIndent} title="Jadikan sub-bagian" aria-label="Jadikan sub-bagian">
                            <ArrowRight size={14} />
                          </button>
                          <button onClick={() => mutateRows((current) => moveWithinSiblings(current, row.id, 'down'))} title="Pindah baris ke bawah" aria-label="Pindah baris ke bawah">
                            <ArrowDown size={14} />
                          </button>
                          <button onClick={() => mutateRows((current) => outdentRow(current, row.id))} disabled={!canOutdent} title="Naikkan tingkat" aria-label="Naikkan tingkat">
                            <ArrowLeft size={14} />
                          </button>
                        </div>
                      </td>
                      <td className="simprok-rab-row__number">{row.number}</td>
                      <td>
                        {row.type === 'item' ? (
                          <div className="simprok-rab-ahsp-cell">
                            {row.ahspCode ? (
                              <button className="simprok-rab-ahsp-code" onClick={() => activateRow(row.id)} title="Buka Detail Analisa AHSP" aria-label={`Buka AHSP ${row.ahspCode}`} data-route={`/?ruang=detail-ahsp-${row.id}`}>
                                {row.ahspCode}
                              </button>
                            ) : (
                              <button className="simprok-rab-ahsp-pick" onClick={() => activateRow(row.id)} title="Pilih AHSP" aria-label="Pilih AHSP" data-route={`/?ruang=pilih-ahsp-${row.id}`}>
                                Pilih AHSP
                              </button>
                            )}
                            {row.manualAhsp ? <span className="simprok-rab-ahsp-badge simprok-rab-ahsp-badge--manual">MANUAL</span> : null}
                            <span className="simprok-rab-ahsp-badge">{costDisplay ? costDisplay.badge : row.ahspCode ? 'Standby' : 'Menunggu rekomendasi'}</span>
                          </div>
                        ) : row.type === 'folder' ? (
                          <small>{row.category}</small>
                        ) : null}
                      </td>
                      <td style={{ paddingLeft: `${row.depth * 18 + 12}px` }}>
                        <span className="simprok-rab-row__name">
                          {row.type === 'folder' ? <FolderOpen size={16} /> : null}
                          <input className="simprok-rab-description-input" value={row.name} onChange={(event) => updateRowName(row.id, event.target.value)} aria-label={`Uraian ${row.type === 'folder' ? 'sub judul' : 'item pekerjaan'}`} />
                        </span>
                      </td>
                      <td>
                        {row.type === 'item' ? (
                          <input
                            className={(volumes[row.id] || 0) < 0 ? 'simprok-rab-number-invalid' : ''}
                            type="number"
                            step="0.01"
                            value={volumes[row.id] || 0}
                            onChange={(event) => {
                              setDraftDirty(true);
                              setVolumes((current) => ({
                                ...current,
                                [row.id]: Number(event.target.value),
                              }));
                              setCostRowStatuses((current) => invalidateRow(current, row.id));
                            }}
                            aria-label={`Volume ${row.name}`}
                          />
                        ) : null}
                      </td>
                      <td>{row.type === 'item' ? <input className="simprok-rab-description-input" value={row.unit} onChange={(event) => updateRowUnit(row.id, event.target.value)} aria-label={`Satuan ${row.name}`} /> : null}</td>
                      <td className="simprok-rab-unit-price-column">
                        {row.type === 'item' ? (
                          <span className="simprok-rab-price-cell">
                            {isKernelEligible ? (
                              costStatus?.kind === 'calculated' ? (
                                <strong aria-label={`Harga satuan ${row.name}`}>{costDisplay?.unitPrice}</strong>
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
                                  onChange={(event) => {
                                    setDraftDirty(true);
                                    setUnitPrices((current) => ({
                                      ...current,
                                      [row.id]: parseDraftNumber(event.target.value),
                                    }));
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
                              : '—'
                            : row.manualUnitPrice ? formatRupiah(amount) : '—'
                          : ''}
                      </td>
                      <td>
                        <div className="simprok-rab-row-actions">
                          {row.type === 'folder' ? (
                            <>
                              <button className="simprok-rab-add-sub" onClick={() => addChild(row.id, 'folder')} title="Tambah Sub Judul" aria-label="Tambah Sub Judul">
                                + Sub Judul
                              </button>
                              <button className="simprok-rab-add-item" onClick={() => addChild(row.id, 'item')} title="Tambah Item" aria-label="Tambah Item">
                                + Item
                              </button>
                            </>
                          ) : row.type === 'item' ? (
                            <button className="simprok-rab-table-action" onClick={() => setSelectedRowId(row.id)} title="Buka Detail Analisa AHSP" aria-label="Buka Detail Analisa AHSP" data-route={`/?ruang=detail-ahsp-${row.id}`}>
                              Detail
                            </button>
                          ) : null}
                          <button className="simprok-rab-delete" onClick={() => removeRow(row.id)} title="Hapus baris" aria-label="Hapus baris">
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
                    <input type="number" min="0" value={marginPercent} onChange={(event) => { setDraftDirty(true); setMarginPercent(Number(event.target.value)); }} aria-label="Persentase margin" />
                    <span>%</span>
                  </span>
                  <strong className="simprok-rab-recap__value">{pricingComplete ? formatRupiah(margin) : '—'}</strong>
                </div>
                <div className="simprok-rab-recap__row">
                  <span className="simprok-rab-recap__label">Pajak / PPN</span>
                  <span className="simprok-rab-recap__input-wrap">
                    <input type="number" min="0" value={ppnPercent} onChange={(event) => { setDraftDirty(true); setPpnPercent(Number(event.target.value)); }} aria-label="Persentase PPN" />
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
                <h2>Detail Analisa AHSP</h2>
              </div>
              <button onClick={() => setSelectedRowId('')} title="Tutup panel" aria-label="Tutup panel">
                <X size={17} />
              </button>
            </div>
            <div className="simprok-ahsp-drawer__selected">
              <strong>{selectedItem.name}</strong>
              <small>
                {selectedItem.number} - {selectedItem.unit || 'satuan menunggu data'}
              </small>
            </div>
            <div className="simprok-ahsp-meta">
              <div>
                <span>Kode AHSP</span>
                <strong>{selectedItem.ahspCode || 'Belum dipilih'}</strong>
              </div>
              <div>
                <span>Status AHSP</span>
                <strong>{selectedItem.ahspCode ? 'Standby' : 'Engine belum aktif'}</strong>
              </div>
              <div>
                <span>Sumber Harga</span>
                <strong>Belum tersambung</strong>
              </div>
              <div>
                <span>Persistensi</span>
                <strong>{projectId ? 'Draft tersimpan di server' : 'Belum ada project aktif'}</strong>
              </div>
            </div>
            <div className="simprok-ahsp-drawer__frame">
              <span className="simprok-honest-frame__badge">Engine belum aktif</span>
              <p>Komponen tenaga, bahan, alat, koefisien, dan Basic Price akan tampil setelah engine AHSP tersambung. Angka detail tidak dibuat palsu.</p>
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
                onChange={(event) => setCalculationAsOfDate(event.target.value)}
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
              {persistState.kind === 'success' && persistState.target.boqItemId === selectedItem.id ? (
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
              {persistState.kind === 'failed_confirmed' && persistState.target.boqItemId === selectedItem.id ? (
                <div className="simprok-rab-validation-alert" role="alert">
                  Harga belum dapat disimpan: {persistState.reason}
                </div>
              ) : null}
              {persistState.kind === 'outcome_unknown' && persistState.target.boqItemId === selectedItem.id ? (
                <div className="simprok-rab-validation-alert" role="alert">
                  Status penyimpanan tidak dapat dipastikan. Muat ulang draft untuk memastikan status harga sebelum mencoba lagi.
                </div>
              ) : null}
            </div>
            <button className="simprok-ahsp-drawer__primary" onClick={handlePickAhsp} title="Pilih / Ganti AHSP - belum tersambung" aria-label="Pilih / Ganti AHSP - belum tersambung" data-route="/?ruang=pilih-ganti-ahsp">
              <ListChecks size={17} /> Pilih / Ganti AHSP
            </button>
          </aside>
        ) : null}
      </main>
    </div>
  );
}
