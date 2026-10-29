import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Layers, Users, Package, Wrench, FileText, Info, Pencil, History, ArrowLeft, Send, BadgeCheck, ChevronRight } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { verifySavedVersion } from '../utils/ahspSaveReadback';
import { useAuth } from '../contexts/AuthContext';
import {
  groupAhspDefinitionResources,
  hasAnyDefinitionComponent,
  parseCoefficientInput,
  resolveDefinitionResourceName,
  type AhspDefinitionComponentGroup,
  type AhspDefinitionResourceWire,
} from '../utils/ahspCompositionDisplay';
import { describeAhspProposalStatus, canProposeAhsp, formatIndoDate } from '../utils/ahspProposalStatus';
import { USULKAN_TOOLTIP } from '../utils/ahspProposalCopy';
import { presentAhspIdentity } from '../utils/ahspIdentityDisplay';
import '../styles/ahsp.css';
import '../styles/ahspDetailApproved.css';
import '../styles/ahspDetailUpdateResponsive.css';
import { presentedAhspOutputUnitSymbol, presentedUnitLabel } from '../utils/unitSuggestionLabel';
import { UsulkanSimprokDialog } from '../components/ahsp/UsulkanSimprokDialog';
import { AhspClassificationRevisionPanel } from '../components/AhspClassificationRevisionPanel';
import {
  groupIdenticalObservations,
  type CuratableObservationWire,
  type ObservationGroup,
} from '../utils/resourceObservationDisplay';

/**
 * THE room's own detail — the Owner-approved detail view.
 *
 * Reads GET /ahsp/:id (definition + versions + resources + createdByEmail).
 * Update appends a revision through the existing POST /ahsp/:id/versions route;
 * "Usulkan ke SIMPROK" submits the AHSP for human review through the existing
 * POST /ahsp/:id/propose route — it never publishes. All data is backend truth;
 * this file only arranges it into the Owner mockup and speaks plain Indonesian.
 *
 * STAGE 2A Door B — "Tinjau Resource" is an ENTRY to the EXISTING
 * GET/POST /resource-observations lifecycle, scoped server-side by ahspId.
 * It is not a second review system, readiness engine, or decision writer.
 */

type DetailResourceWire = AhspDefinitionResourceWire & {
  unitDisplayName?: string | null;
  unitSymbol?: string | null;
  unitCode?: string | null;
};

type AhspVersion = {
  id: string;
  versionNumber: number | null;
  status: string | null;
  outputUnit: string | null;
  outputUnitDisplayName?: string | null;
  outputUnitSymbol?: string | null;
  outputUnitCode?: string | null;
  regulationReference: string | null;
  issuerInstitution: string | null;
  effectiveDate: string | null;
  resources?: DetailResourceWire[] | null;
};

type AhspDetail = {
  id: string;
  workspaceId: string | null;
  workType: string | null;
  methodName: string | null;
  code: string | null;
  fieldCategory: string | null;
  subCategory: string | null;
  classification: string | null;
  keterangan: string | null;
  ownershipType: string | null;
  reviewStatus: string | null;
  proposedAt: string | null;
  proposedByName: string | null;
  createdByEmail: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  archivedAt: string | null;
  versions?: AhspVersion[] | null;
};

type ProposalSubjectWire = {
  methodName: string | null;
  code: string | null;
  keterangan: string | null;
  regulationReference: string | null;
  issuerInstitution: string | null;
  outputUnit: string | null;
  outputUnitDisplayName?: string | null;
  outputUnitSymbol?: string | null;
  outputUnitCode?: string | null;
  resources: Array<{
    resourceId: string;
    resourceName?: string | null;
    baseUnit: string;
    coefficient: string | number;
    unitDisplayName?: string | null;
    unitSymbol?: string | null;
    unitCode?: string | null;
  }>;
  classificationAssignments: Array<{
    provenance: string;
    path: { jenisPengadaan: string; kategori: string; subkategori: string; jenisPekerjaan: string };
  }>;
};

function ProposalSubjectView(props: {
  subject: ProposalSubjectWire;
  submittedAt: string;
  submittedBy: string | null;
}) {
  const subject = props.subject;
  const paths = subject.classificationAssignments.map((row) =>
    [row.path.jenisPengadaan, row.path.kategori, row.path.subkategori, row.path.jenisPekerjaan]
      .filter((part) => part !== '')
      .join(' → '),
  );
  return (
    <div style={{ display: 'grid', gap: 'var(--space-2)', fontSize: 'var(--text-sm)', color: NAVY }}>
      <p style={{ margin: 0 }}>{subject.methodName || '—'}</p>
      <p style={{ margin: 0, color: MUTED }}>Kode {subject.code || '—'} · {subject.keterangan || '—'}</p>
      <p style={{ margin: 0 }}>Dasar {subject.regulationReference || '—'} · Penerbit {subject.issuerInstitution || '—'} · Satuan {presentedUnitLabel({
        stored: subject.outputUnit,
        displayName: subject.outputUnitDisplayName,
        symbol: subject.outputUnitSymbol,
        code: subject.outputUnitCode,
      }) || '—'}</p>
      {subject.resources.map((row, index) => (
        <p key={row.resourceId + '-' + index} style={{ margin: 0 }}>
          {((row.resourceName ?? '').trim() || row.resourceId)} · {presentedUnitLabel({
            stored: row.baseUnit,
            displayName: row.unitDisplayName,
            symbol: row.unitSymbol,
            code: row.unitCode,
          })} · {String(row.coefficient)}
        </p>
      ))}
      {paths.map((path, index) => (
        <p key={path + '-' + index} style={{ margin: 0 }}>{path}</p>
      ))}
      <p style={{ margin: 0, color: MUTED }}>
        Diajukan {formatIndoDate(props.submittedAt)}{props.submittedBy ? ` · ${props.submittedBy}` : ''}
      </p>
    </div>
  );
}

type DetailState =
  | { phase: 'LOADING' }
  | { phase: 'READY'; ahsp: AhspDetail }
  | { phase: 'FAILED'; message: string };

type ResourceDraft = {
  /**
   * The line this draft came from, as the server identified it. Carried, never
   * shown, and never invented: a line the reader ADDS has none, which is exactly
   * how the server tells a continued line from a new one.
   */
  lineId: string | null;
  resourceId: string;
  resourceName: string | null;
  stored: boolean;
  resourceType: 'LABOR' | 'MATERIAL' | 'EQUIPMENT';
  coefficient: string;
  baseUnit: string;
};

const NAVY = 'var(--simprok-authority-navy-800)';
const MUTED = 'var(--simprok-engineering-blue-500)';
const BLUE = 'var(--simprok-trust-blue-500)';
const HAIRLINE = '1px solid var(--simprok-engineering-blue-100)';
const CARD: CSSProperties = {
  background: '#FFFFFF',
  border: HAIRLINE,
  borderRadius: '12px',
  padding: 'var(--space-5, 1.25rem)',
};
const ICON_TILE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '2rem',
  height: '2rem',
  borderRadius: '8px',
  background: 'var(--simprok-engineering-blue-100)',
  color: BLUE,
  flex: '0 0 auto',
};
const outlineButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  background: '#FFFFFF',
  color: NAVY,
  border: HAIRLINE,
  borderRadius: '8px',
  padding: 'var(--space-2) var(--space-4)',
  cursor: 'pointer',
  fontSize: 'var(--text-sm)',
};
const primaryButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  background: BLUE,
  color: '#FFFFFF',
  border: 0,
  borderRadius: '8px',
  padding: 'var(--space-2) var(--space-4)',
  cursor: 'pointer',
  fontSize: 'var(--text-sm)',
};

const orDash = (value: string | number | null | undefined) =>
  value === null || value === undefined || value === '' ? (
    <span style={{ color: MUTED }}>—</span>
  ) : (
    <>{String(value)}</>
  );

const emptyResource = (): ResourceDraft => ({
  // A line the reader adds continues nothing, and says so.
  lineId: null,
  resourceId: '',
  resourceName: null,
  stored: false,
  resourceType: 'LABOR',
  coefficient: '',
  baseUnit: '',
});

const toDateInput = (value: string | null | undefined) => {
  if (!value) return '';
  const day = value.slice(0, 10);
  return day.length === 10 ? day : '';
};

const draftsFromVersion = (version: AhspVersion | null): ResourceDraft[] => {
  const resources = version?.resources ?? [];
  if (resources.length === 0) return [emptyResource()];
  return resources.map((row) => ({
    lineId: typeof row.id === 'string' && row.id !== '' ? row.id : null,
    resourceId: (row.resourceId ?? '').trim(),
    resourceName: row.resourceName ?? null,
    stored: true,
    resourceType:
      row.resourceType === 'MATERIAL' || row.resourceType === 'EQUIPMENT'
        ? row.resourceType
        : 'LABOR',
    coefficient: row.coefficient == null ? '' : String(row.coefficient),
    baseUnit: (row.baseUnit ?? '').trim(),
  }));
};

const historyStatusLabel = (status: string | null | undefined) => {
  if (status === 'SUPERSEDED') return 'Diganti';
  if (status === 'ARCHIVED') return 'Diarsipkan';
  if (status === 'DRAFT') return 'Draf';
  if (status === 'PUBLISHED') return 'Diterbitkan';
  return 'Riwayat';
};

const isHistoricalStatus = (status: string | null | undefined) =>
  status === 'SUPERSEDED' || status === 'ARCHIVED';

type DetailClassificationPath = {
  jenisPengadaan: string;
  kategori: string;
  subkategori: string;
  jenisPekerjaan: string;
};

function groupedClassificationValue(
  paths: readonly DetailClassificationPath[],
  key: keyof DetailClassificationPath,
): string {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const path of paths) {
    const value = path[key].trim();
    if (value === '' || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }
  return values.join(', ');
}

function detailPathsFromAssignments(rows: unknown): DetailClassificationPath[] {
  if (!Array.isArray(rows)) return [];
  const paths: DetailClassificationPath[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const path = (row as { path?: unknown }).path;
    if (!Array.isArray(path)) continue;
    const nameOf = (level: string) => {
      const node = path.find(
        (item) => item && typeof item === 'object' && (item as { level?: string }).level === level,
      ) as { name?: string } | undefined;
      return typeof node?.name === 'string' ? node.name : '';
    };
    const jenisPekerjaan = nameOf('JENIS_PEKERJAAN');
    if (!jenisPekerjaan) continue;
    paths.push({
      jenisPengadaan: nameOf('JENIS_PENGADAAN'),
      kategori: nameOf('KATEGORI'),
      subkategori: nameOf('SUBKATEGORI'),
      jenisPekerjaan,
    });
  }
  return paths;
}

const GROUP_ICON: Record<string, ReactNode> = {
  TENAGA: <Users size={16} />,
  BAHAN: <Package size={16} />,
  PERALATAN: <Wrench size={16} />,
};

export function AhspDetailPage() {
  const { ahspId } = useParams<{ ahspId: string }>();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('AHSP_MANAGE');
  const canCurate = hasPermission('AHSP_RESOURCE_IDENTITY_DECIDE');
  const [state, setState] = useState<DetailState>({ phase: 'LOADING' });
  const [classificationPaths, setClassificationPaths] = useState<DetailClassificationPath[]>([]);
  const onClassificationAssignmentsChange = useCallback((rows: readonly unknown[]) => {
    setClassificationPaths(detailPathsFromAssignments(rows));
  }, []);
  const actionInFlight = useRef(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [metadataFeedback, setMetadataFeedback] = useState<string | null>(null);
  const clearSaveFeedback = useCallback(() => {
    setActionSuccess(null);
    setActionError(null);
    setActionNotice(null);
    setMetadataFeedback(null);
  }, []);
  const onClassificationSaveAttempt = useCallback(() => {
    if (actionInFlight.current) return false;
    actionInFlight.current = true;
    clearSaveFeedback();
    return true;
  }, [clearSaveFeedback]);
  const onSaveFinished = useCallback(() => { actionInFlight.current = false; }, []);
  const onClassificationSaved = useCallback(() => {
    setActionError(null);
    setMetadataFeedback(null);
    setActionSuccess('Perubahan klasifikasi berhasil disimpan.');
  }, []);
  const onClassificationCancelled = useCallback(() => {
    clearSaveFeedback();
    setActionNotice('Penambahan klasifikasi dibatalkan.');
  }, [clearSaveFeedback]);
  // A verified success is transient; an error remains visible until the next action.
  // Cleanup prevents an earlier save's timer from dismissing a newer result.
  useEffect(() => {
    if (!actionSuccess) return;
    const timeoutId = window.setTimeout(() => setActionSuccess(null), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [actionSuccess]);
  // Informational cancellation expires, while genuine save errors stay visible.
  useEffect(() => {
    if (!actionNotice) return;
    const timeoutId = window.setTimeout(() => setActionNotice(null), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [actionNotice]);
  const [busy, setBusy] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [showProposeConfirm, setShowProposeConfirm] = useState(false);
  const [showValidStatusNote, setShowValidStatusNote] = useState(false);
  const [proposalSubject, setProposalSubject] = useState<
    | { phase: 'READY'; subject: ProposalSubjectWire }
    | { phase: 'FAILED' }
    | null
  >(null);
  // Parent metadata belongs to the existing audited PATCH /ahsp/:id door.
  // It is NOT a version recipe field and is saved independently from components.
  const [editMethodName, setEditMethodName] = useState('');
  const [editCode, setEditCode] = useState('');
  const [editKeterangan, setEditKeterangan] = useState('');
  const [metadataReason, setMetadataReason] = useState('');
  const [metadataBusy, setMetadataBusy] = useState(false);
  const [outputUnit, setOutputUnit] = useState('');
  const [regulationReference, setRegulationReference] = useState('');
  const [issuerInstitution, setIssuerInstitution] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [resourceDrafts, setResourceDrafts] = useState<ResourceDraft[]>([emptyResource()]);
  const [editingResourceIndex, setEditingResourceIndex] = useState<number | null>(null);
  const [editingResourceOriginal, setEditingResourceOriginal] = useState<ResourceDraft | null>(null);
  const [componentRemovalNotice, setComponentRemovalNotice] = useState(false);
  // STAGE 2A Door B — scoped open observations for THIS AHSP only.
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewRows, setReviewRows] = useState<readonly CuratableObservationWire[]>([]);
  const [reviewPhase, setReviewPhase] = useState<'IDLE' | 'LOADING' | 'READY' | 'FAILED'>('IDLE');
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);
  const reviewLock = useRef(false);
  const reviewSectionRef = useRef<HTMLElement | null>(null);

  const applyPayload = useCallback((data: AhspDetail) => {
    setState({ phase: 'READY', ahsp: data });
    setEditMethodName(data.methodName ?? '');
    setEditCode(data.code ?? '');
    setEditKeterangan(data.keterangan ?? '');
    const current = (data.versions ?? [])[0] ?? null;
    setOutputUnit(current?.outputUnit ?? '');
    setRegulationReference(current?.regulationReference ?? '');
    setIssuerInstitution(current?.issuerInstitution ?? '');
    setEffectiveDate(toDateInput(current?.effectiveDate));
    setResourceDrafts(draftsFromVersion(current));
    setComponentRemovalNotice(false);
    setEditingResourceIndex(null);
    setEditingResourceOriginal(null);
  }, []);

  useEffect(() => {
    let active = true;
    if (!ahspId) {
      // Invalid-route feedback is deferred beyond this effect, but never after cleanup.
      void Promise.resolve().then(() => {
        if (active) setState({
          phase: 'FAILED',
          message: 'AHSP ini tidak dapat dibuka karena identitasnya tidak ada di alamat.',
        });
      });
      return () => { active = false; };
    }
    const load = async () => {
      try {
        const response = await apiFetch('/ahsp/' + ahspId);
        if (!response.ok) {
          if (!active) return;
          setState({
            phase: 'FAILED',
            message:
              response.status === 401 || response.status === 403
                ? 'Workspace aktif Anda tidak memiliki kewenangan untuk membuka AHSP ini.'
                : response.status === 404
                  ? 'AHSP ini tidak ditemukan dalam workspace aktif.'
                  : 'AHSP ini belum dapat dibaca. Coba lagi sebentar.',
          });
          return;
        }
        const data = (await response.json()) as AhspDetail;
        if (!active) return;
        applyPayload(data);
        try {
          const assignmentResponse = await apiFetch('/ahsp/' + ahspId + '/classification-assignments');
          const assignmentRows = assignmentResponse.ok ? await assignmentResponse.json() : [];
          if (active) setClassificationPaths(detailPathsFromAssignments(assignmentRows));
        } catch {
          if (active) setClassificationPaths([]);
        }
      } catch {
        if (!active) return;
        setState({ phase: 'FAILED', message: 'AHSP tidak dapat dihubungi.' });
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [ahspId, applyPayload]);

  useEffect(() => {
    let active = true;
    if (state.phase !== 'READY' || !ahspId || !state.ahsp.proposedAt) {
      // Clear obsolete proposal results asynchronously, guarded against a new AHSP.
      void Promise.resolve().then(() => {
        if (active) setProposalSubject(null);
      });
      return () => { active = false; };
    }
    const loadSubject = async () => {
      try {
        const response = await apiFetch('/ahsp/' + ahspId + '/proposal-subject');
        if (!active) return;
        if (!response.ok) {
          setProposalSubject({ phase: 'FAILED' });
          return;
        }
        setProposalSubject({ phase: 'READY', subject: (await response.json()) as ProposalSubjectWire });
      } catch {
        if (active) setProposalSubject({ phase: 'FAILED' });
      }
    };
    void loadSubject();
    return () => {
      active = false;
    };
  }, [ahspId, state]);

  const currentVersion = useMemo(() => {
    if (state.phase !== 'READY') return null;
    return (state.ahsp.versions ?? [])[0] ?? null;
  }, [state]);

  const historicalVersions = useMemo(() => {
    if (state.phase !== 'READY') return [];
    return (state.ahsp.versions ?? []).slice(1);
  }, [state]);

  const groups: AhspDefinitionComponentGroup[] = useMemo(
    () => groupAhspDefinitionResources(currentVersion?.resources),
    [currentVersion],
  );
  // Appearance-only hint: never collapse two recipe rows or infer that either is wrong.
  const repeatedComponentLabels = useMemo(() => groups.flatMap((group) => {
    const seen = new Map<string, { name: string; unit: string; count: number }>();
    for (const row of group.rows) {
      const name = row.name.trim();
      const unit = row.unit.trim();
      if (!name || ['Tanpa nama', 'Nama sumber daya belum tersedia'].includes(name)) continue;
      const key = name.toLocaleLowerCase('id-ID') + '\u0000' + unit.toLocaleLowerCase('id-ID');
      const prior = seen.get(key);
      if (prior) prior.count += 1;
      else seen.set(key, { name, unit, count: 1 });
    }
    return [...seen.values()].filter((row) => row.count > 1)
      .map((row) => `${group.label}: ${row.name} (${row.count} baris, satuan ${row.unit || 'tidak tercatat'})`);
  }), [groups]);

  const presentedComponentUnit = (storedUnit: string) => {
    const source = (currentVersion?.resources ?? []).find(
      (row) => (row.baseUnit ?? '').trim() === storedUnit,
    );
    return presentedUnitLabel({
      stored: storedUnit,
      displayName: source?.unitDisplayName,
      symbol: source?.unitSymbol,
      code: source?.unitCode,
    });
  };

  const presentedOutputUnit = presentedAhspOutputUnitSymbol({
    stored: currentVersion?.outputUnit,
    displayName: currentVersion?.outputUnitDisplayName,
    symbol: currentVersion?.outputUnitSymbol,
    code: currentVersion?.outputUnitCode,
  });

  const reload = async (): Promise<boolean> => {
    if (!ahspId) return false;
    const response = await apiFetch('/ahsp/' + ahspId);
    if (!response.ok) {
      setActionError('AHSP tidak dapat dibaca ulang. Coba lagi sebentar.');
      return false;
    }
    applyPayload((await response.json()) as AhspDetail);
    return true;
  };

  /** Door B — EXISTING list, scoped by ahspId. Read only. */
  const loadResourceReview = useCallback(async (): Promise<readonly CuratableObservationWire[] | null> => {
    if (!ahspId || !canCurate) return null;
    setReviewPhase('LOADING');
    try {
      const response = await apiFetch(
        '/resource-observations?ahspId=' + encodeURIComponent(ahspId),
      );
      if (!response.ok) {
        setReviewPhase(response.status === 401 || response.status === 403 ? 'FAILED' : 'FAILED');
        setReviewRows([]);
        return null;
      }
      const payload = (await response.json()) as unknown;
      const rows = Array.isArray(payload) ? (payload as CuratableObservationWire[]) : [];
      setReviewRows(rows);
      setReviewPhase('READY');
      return rows;
    } catch {
      setReviewPhase('FAILED');
      setReviewRows([]);
      return null;
    }
  }, [ahspId, canCurate]);

  useEffect(() => {
    let active = true;
    if (state.phase !== 'READY' || !canCurate || !ahspId) {
      // Drop obsolete review state only after the effect; respect identity cleanup.
      void Promise.resolve().then(() => {
        if (!active) return;
        setReviewRows([]);
        setReviewPhase('IDLE');
        setReviewOpen(false);
      });
      return () => { active = false; };
    }
    void Promise.resolve().then(() => {
      if (active) return loadResourceReview();
      return null;
    });
    return () => { active = false; };
  }, [state.phase, canCurate, ahspId, loadResourceReview]);

  const openResourceReview = async () => {
    setReviewOpen(true);
    await loadResourceReview();
    reviewSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    reviewSectionRef.current?.focus();
  };

  const curateOnDetail = async (
    _group: ObservationGroup,
    path: '/curate-existing' | '/curate-new',
    bodyFor: (id: string) => Record<string, unknown>,
    ids: readonly string[],
    busyKey: string,
  ) => {
    if (reviewLock.current || ids.length === 0) return;
    reviewLock.current = true;
    setReviewBusy(busyKey);
    try {
      for (const id of ids) {
        const response = await apiFetch('/resource-observations/' + id + path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyFor(id)),
        });
        if (!response.ok) {
          setActionError('Keputusan sumber daya belum tersimpan. Coba lagi.');
          break;
        }
      }
      await loadResourceReview();
    } finally {
      reviewLock.current = false;
      setReviewBusy(null);
    }
  };

  const proposeToSimprok = async () => {
    if (!ahspId || proposing) return;
    setProposing(true);
    setActionError(null);
    try {
      const response = await apiFetch('/ahsp/' + ahspId + '/propose', { method: 'POST' });
      if (!response.ok) {
        setActionError('Usulan belum dapat dikirim. Coba lagi sebentar.');
        return;
      }
      await reload();
    } catch {
      setActionError('Usulan tidak dapat dihubungi.');
    } finally {
      setProposing(false);
    }
  };

  const confirmProposeToSimprok = async () => {
    await proposeToSimprok();
    setShowProposeConfirm(false);
  };

  // A single atomic parent change: Uraian, optional Kode and Keterangan.
  // Existing AHSP PATCH owns all three columns and one audit transaction.
  const saveBasicInfo = async () => {
    if (!ahspId || metadataBusy || busy || actionInFlight.current || state.phase !== 'READY') return;
    clearSaveFeedback();
    const prior = state.ahsp;
    if (prior.workspaceId === null || prior.ownershipType !== 'USER_ASSET' || prior.archivedAt) {
      setMetadataFeedback('Hanya AHSP privat aktif milik Workspace ini yang dapat diubah.');
      return;
    }
    const methodName = editMethodName.trim();
    const code = editCode.trim();
    const keterangan = editKeterangan.trim();
    const reason = metadataReason.trim();
    if (!methodName) {
      setMetadataFeedback('Uraian/Judul AHSP tidak boleh kosong.');
      return;
    }
    const nameChanged = methodName !== (prior.methodName ?? '').trim();
    const codeChanged = code !== (prior.code ?? '').trim();
    const noteChanged = keterangan !== (prior.keterangan ?? '').trim();
    if (!nameChanged && !codeChanged && !noteChanged) {
      setMetadataFeedback('Belum ada perubahan Informasi Dasar.');
      return;
    }
    if (codeChanged && prior.proposedAt) {
      setMetadataFeedback('Kode yang sudah diusulkan telah dibekukan. Batalkan koreksi kode sebelum menyimpan.');
      return;
    }
    if (!reason) {
      setMetadataFeedback('Tuliskan alasan perubahan untuk catatan audit.');
      return;
    }
    if (!onClassificationSaveAttempt()) return;
    setMetadataBusy(true);
    setMetadataFeedback(null);
    setActionSuccess(null);
    try {
      const response = await apiFetch('/ahsp/' + encodeURIComponent(ahspId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(nameChanged ? { methodName } : {}),
          ...(codeChanged ? { code: code || null } : {}),
          ...(noteChanged ? { keterangan } : {}),
          reason,
        }),
      });
      if (!response.ok) {
        setMetadataFeedback(response.status === 409
          ? 'Kode pada usulan yang sudah dibekukan tidak boleh diganti.'
          : response.status === 401 || response.status === 403
          ? 'Workspace tidak berwenang memperbarui Informasi Dasar ini.'
          : 'Informasi Dasar belum dapat disimpan. Periksa data dan dukungan backend.');
        return;
      }
      const readBack = await apiFetch('/ahsp/' + encodeURIComponent(ahspId));
      if (!readBack.ok) {
        setMetadataFeedback('Permintaan telah dikirim, tetapi hasilnya belum dapat diverifikasi. Muat ulang halaman.');
        return;
      }
      const updated = (await readBack.json()) as AhspDetail;
      if (updated.id !== ahspId || (updated.methodName ?? '').trim() !== methodName ||
          (updated.code ?? '').trim() !== code ||
          (updated.keterangan ?? '').trim() !== keterangan) {
        setMetadataFeedback('Nilai di server belum cocok dengan Informasi Dasar. Jangan anggap tersimpan; muat ulang untuk memeriksa.');
        return;
      }
      // Keep unsaved recipe/version changes intact, including resource drafts.
      setState({ phase: 'READY', ahsp: updated });
      setEditMethodName(updated.methodName ?? '');
      setEditCode(updated.code ?? '');
      setEditKeterangan(updated.keterangan ?? '');
      setMetadataReason('');
      setMetadataFeedback('Informasi Dasar tersimpan dan sesuai dengan data AHSP.');
      setActionError(null);
      setActionSuccess('Perubahan berhasil disimpan.');
    } catch {
      setMetadataFeedback('Status penyimpanan belum dapat dipastikan. Muat ulang sebelum mencoba lagi.');
    } finally {
      setMetadataBusy(false);
      onSaveFinished();
    }
  };

  const addVersion = async (event: FormEvent) => {
    event.preventDefault();
    if (!ahspId || busy || metadataBusy || actionInFlight.current) return;
    clearSaveFeedback();
    if (editingResourceIndex !== null) {
      setActionError('Selesaikan atau batalkan edit komponen sebelum menyimpan versi AHSP.');
      return;
    }
    const unit = outputUnit.trim();
    // AN UPDATE SENDS THE WHOLE RECIPE, so a row this form cannot read would be
    // stored as a component that no longer exists. Dropping it silently is the
    // one thing that must not happen: the author would be told the update
    // succeeded while SIMPROK quietly kept less than it was given.
    //
    // A row the author has not started (never stored, all three fields blank) is
    // an unused slot, not a loss — it is left out without comment. Anything else
    // that cannot be read stops the save and is named, so nothing is guessed and
    // nothing disappears.
    const slots = resourceDrafts.map((row, index) => ({ row, index }));
    const started = slots.filter(
      ({ row }) =>
        row.stored ||
        row.resourceId.trim() !== '' ||
        row.baseUnit.trim() !== '' ||
        String(row.coefficient).trim() !== '',
    );
    if (unit === '') {
      setActionError('Satuan AHSP diperlukan.');
      return;
    }
    const unreadable = started.find(
      ({ row }) =>
        row.resourceId.trim() === '' ||
        row.baseUnit.trim() === '' ||
        parseCoefficientInput(row.coefficient) === null,
    );
    if (unreadable) {
      setActionError(
        `Komponen ${unreadable.index + 1} belum dapat dibaca. Lengkapi sumber daya, satuan, dan koefisien (angka lebih besar dari 0) — SIMPROK tidak menyimpan sebagian resep.`,
      );
      return;
    }
    const resources = started.map(({ row }) => ({
      resourceId: row.resourceId.trim(),
      resourceType: row.resourceType,
      coefficient: parseCoefficientInput(row.coefficient) as number,
      baseUnit: row.baseUnit.trim(),
      // WHICH LINE THIS CONTINUES — never where it came from. The server reads
      // the origin from that line itself; this page cannot state one, and a line
      // the reader added carries nothing.
      ...(row.lineId ? { carriedFromResourceLineId: row.lineId } : {}),
    }));
    if (resources.length === 0) {
      setActionError('Isi paling sedikit satu komponen dengan sumber daya, satuan, dan koefisien.');
      return;
    }
    // A revision is a statement that something changed. Saving an untouched form
    // would supersede the current analysis and write a "Diganti" line into the
    // history for a change nobody made. Deliberately FAIL-OPEN: only a recipe
    // that matches the stored one in every part is treated as unchanged, so any
    // doubt lets the save through rather than blocking the author.
    const stored = currentVersion?.resources ?? [];
    const unchanged =
      currentVersion != null &&
      (currentVersion.outputUnit ?? '') === unit &&
      (currentVersion.regulationReference ?? '') === regulationReference.trim() &&
      (currentVersion.issuerInstitution ?? '') === issuerInstitution.trim() &&
      toDateInput(currentVersion.effectiveDate) === effectiveDate.trim() &&
      stored.length === resources.length &&
      stored.every((row, index) => {
        const sent = resources[index];
        return (
          (row.resourceId ?? '').trim() === sent.resourceId &&
          row.resourceType === sent.resourceType &&
          (row.baseUnit ?? '').trim() === sent.baseUnit &&
          parseCoefficientInput(row.coefficient) === sent.coefficient
        );
      });
    if (unchanged) {
      setActionError('Belum ada perubahan pada Informasi Sumber atau Komponen. Informasi Dasar dan Klasifikasi disimpan melalui tombol masing-masing.');
      return;
    }
    if (!onClassificationSaveAttempt()) return;
    setBusy(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const response = await apiFetch('/ahsp/' + ahspId + '/versions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // The version this revision was composed from, so the server continues
          // THAT recipe's lines rather than whichever version is newest by the
          // time the save arrives.
          ...(currentVersion?.id ? { basedOnVersionId: currentVersion.id } : {}),
          outputUnit: unit,
          regulationReference: regulationReference.trim() || undefined,
          issuerInstitution: issuerInstitution.trim() || undefined,
          effectiveDate: effectiveDate.trim() ? new Date(effectiveDate.trim()).toISOString() : undefined,
          resources,
        }),
      });
      if (!response.ok) {
        setActionError(
          response.status === 400
            ? 'Pembaruan belum dapat disimpan. Periksa satuan dan komponen.'
            : 'Pembaruan AHSP belum dapat disimpan. Coba lagi sebentar.',
        );
        return;
      }
      const receipt = (await response.json()) as { id?: unknown };
      const readBack = await apiFetch('/ahsp/' + ahspId);
      const detail: unknown = readBack.ok ? await readBack.json() : null;
      if (typeof receipt?.id !== 'string' || !verifySavedVersion(detail, ahspId, receipt.id, {
        outputUnit: unit, regulationReference: regulationReference.trim(),
        issuerInstitution: issuerInstitution.trim(), effectiveDate: effectiveDate.trim(), resources,
      })) {
        setActionError('Permintaan telah dikirim, tetapi versi tersimpan belum terbukti sesuai. Muat ulang sebelum mencoba lagi.');
        return;
      }
      applyPayload(detail as AhspDetail);
      setActionError(null);
      setActionSuccess('Perubahan Komponen berhasil disimpan.');
    } catch {
      setActionError('Pembaruan AHSP tidak dapat dihubungi.');
    } finally {
      setBusy(false);
      onSaveFinished();
    }
  };

  const ahsp = state.phase === 'READY' ? state.ahsp : null;
  const workspaceOwned = ahsp?.workspaceId != null;
  const archived = Boolean(ahsp?.archivedAt);
  const outOfForce = archived || isHistoricalStatus(currentVersion?.status);
  const title = ahsp?.methodName || ahsp?.workType || 'AHSP';
  const proposalStatus = ahsp ? describeAhspProposalStatus(ahsp) : '';
  const showPropose = Boolean(ahsp && canManage && canProposeAhsp(ahsp));
  const reviewGroups = groupIdenticalObservations(reviewRows);
  const showTinjauResource =
    canCurate && reviewPhase === 'READY' && reviewRows.length > 0;

  const infoRow = (label: string, value: ReactNode) => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '11rem 0.5rem 1fr',
        gap: 'var(--space-2)',
        padding: 'var(--space-2) 0',
        borderBottom: HAIRLINE,
        fontSize: 'var(--text-sm)',
      }}
    >
      <span style={{ color: MUTED }}>{label}</span>
      <span style={{ color: MUTED }}>:</span>
      <span style={{ color: NAVY }}>{value}</span>
    </div>
  );

  return (
    <main aria-label="Detail AHSP" style={{ padding: 'var(--space-5, 1.25rem)' }}>
      {state.phase === 'LOADING' ? (
        <p role="status" style={{ color: MUTED }}>
          Memuat detail AHSP…
        </p>
      ) : null}

      {state.phase === 'FAILED' ? (
        <section className="simprok-honest-frame" role="alert" aria-label="AHSP tidak tersedia">
          <span className="simprok-honest-frame__badge">Tidak tersedia</span>
          <p>{state.message}</p>
        </section>
      ) : null}

      {ahsp ? (
        <>
          {/* Breadcrumb */}
          <nav aria-label="Jejak navigasi" style={{ fontSize: 'var(--text-sm)', color: MUTED, marginBottom: 'var(--space-3)' }}>
            <span>Beranda</span>
            <span style={{ margin: '0 var(--space-2)' }}>›</span>
            <Link to="/ahsp" style={{ color: MUTED, textDecoration: 'none' }}>AHSP</Link>
            <span style={{ margin: '0 var(--space-2)' }}>›</span>
            <span style={{ color: NAVY }}>{title}</span>
          </nav>

          {/* Header */}
          <header
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--space-3)',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              marginBottom: 'var(--space-4)',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: NAVY, margin: 0 }}>{title}</h1>
                {workspaceOwned ? (
                  <span
                    style={{
                      background: 'rgba(46, 158, 107, 0.12)',
                      color: '#2E9E6B',
                      borderRadius: '999px',
                      padding: '0.15rem 0.6rem',
                      fontSize: 'var(--text-sm)',
                      fontWeight: 600,
                    }}
                  >
                    AHSP Saya
                  </span>
                ) : null}
              </div>
              {classificationPaths.length === 0 && ahsp.classification ? (
                <p style={{ margin: 'var(--space-1) 0 0', color: MUTED, fontSize: 'var(--text-sm)' }}>{ahsp.classification}</p>
              ) : null}
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <Link to="/ahsp" style={outlineButton}>
                <ArrowLeft size={16} /> Kembali
              </Link>
              {showTinjauResource ? (
                <button
                  type="button"
                  onClick={() => void openResourceReview()}
                  style={primaryButton}
                  aria-expanded={reviewOpen}
                >
                  Tinjau Resource
                </button>
              ) : null}
              {showPropose ? (
                <button type="button" title={USULKAN_TOOLTIP} onClick={() => setShowProposeConfirm(true)} disabled={proposing} style={primaryButton}>
                  <Send size={16} /> {proposing ? 'Mengirim…' : 'Usulkan ke SIMPROK'}
                </button>
              ) : null}
            </div>
          </header>

          {actionError ? (
            <p role="alert" aria-atomic="true" style={{ position: 'fixed' as const, top: '5rem', right: '1rem', zIndex: 1100, maxWidth: 'min(28rem, calc(100vw - 2rem))', padding: '0.85rem 1rem', borderRadius: '0.5rem', boxShadow: '0 4px 16px #0002', pointerEvents: 'none' as const, background: '#FFF1F1', border: '1px solid #C0392B', color: '#C0392B', fontSize: 'var(--text-sm)', margin: 0 }}>
              {actionError}
            </p>
          ) : actionSuccess ? (
            <p role="status" aria-live="polite" aria-atomic="true" style={{ position: 'fixed' as const, top: '5rem', right: '1rem', zIndex: 1100, maxWidth: 'min(28rem, calc(100vw - 2rem))', padding: '0.85rem 1rem', borderRadius: '0.5rem', boxShadow: '0 4px 16px #0002', pointerEvents: 'none' as const, background: '#EAF8EF', border: '1px solid #16803C', color: '#16803C', fontWeight: 700, fontSize: 'var(--text-sm)', margin: 0 }}>
              {actionSuccess}
            </p>
          ) : actionNotice ? (
            <p role="status" aria-live="polite" aria-atomic="true" style={{ position: 'fixed' as const, top: '5rem', right: '1rem', zIndex: 1100, maxWidth: 'min(28rem, calc(100vw - 2rem))', padding: '0.85rem 1rem', borderRadius: '0.5rem', boxShadow: '0 4px 16px #0002', pointerEvents: 'none' as const, background: '#F5FBFF', border: '1px solid #B7DCFF', color: '#15365F', fontSize: 'var(--text-sm)', margin: 0 }}>
              {actionNotice}
            </p>
          ) : null}

          {ahsp.proposedAt ? (
            <section aria-label="Data yang diajukan" style={{ ...CARD, marginBottom: 'var(--space-4)' }}>
              <h2 style={{ fontSize: 'var(--text-lg)', color: NAVY, margin: '0 0 var(--space-2)' }}>Data yang diajukan</h2>
              {proposalSubject?.phase === 'FAILED' ? (
                <p style={{ margin: 0, color: MUTED, fontSize: 'var(--text-sm)' }}>Data yang diajukan belum dapat dimuat.</p>
              ) : proposalSubject?.phase === 'READY' ? (
                <ProposalSubjectView subject={proposalSubject.subject} submittedAt={ahsp.proposedAt} submittedBy={ahsp.proposedByName} />
              ) : (
                <p style={{ margin: 0, color: MUTED, fontSize: 'var(--text-sm)' }}>Memuat data yang diajukan…</p>
              )}
            </section>
          ) : null}

          {reviewOpen && canCurate ? (
            <section
              ref={reviewSectionRef}
              tabIndex={-1}
              aria-label="Tinjau Resource"
              style={{ ...CARD, marginBottom: 'var(--space-4)', outline: 'none' }}
            >
              <h2 style={{ fontSize: 'var(--text-lg)', color: NAVY, margin: '0 0 var(--space-2)' }}>
                Tinjau Resource
              </h2>
              <p style={{ fontSize: 'var(--text-sm)', color: MUTED, margin: '0 0 var(--space-3)' }}>
                Pertanyaan identitas untuk AHSP ini saja. Keputusan memakai jalur tinjauan yang sama dengan Import.
              </p>
              {reviewPhase === 'LOADING' ? (
                <p role="status" style={{ color: MUTED }}>Memuat pertanyaan…</p>
              ) : null}
              {reviewPhase === 'FAILED' ? (
                <p role="alert" style={{ color: '#C0392B', fontSize: 'var(--text-sm)' }}>
                  Daftar tinjauan belum dapat dimuat.{' '}
                  <button type="button" style={outlineButton} onClick={() => void loadResourceReview()}>
                    Coba lagi
                  </button>
                </p>
              ) : null}
              {reviewPhase === 'READY' && reviewGroups.length === 0 ? (
                <p role="status" style={{ color: NAVY, fontSize: 'var(--text-sm)' }}>
                  Tidak ada sumber daya yang menunggu tinjauan pada AHSP ini.
                </p>
              ) : null}
              {reviewGroups.length > 0 ? (
                <ul className="ahsp-curation-list">
                  {reviewGroups.map((group) => {
                    const view = group.view;
                    const locked = reviewBusy !== null;
                    return (
                      <li key={group.key} aria-label={'Tinjau ' + view.title} className="ahsp-curation-item">
                        <span className="ahsp-curation-item__title">{view.title}</span>
                        <span className="ahsp-line" style={{ color: MUTED }}>
                          {view.workContext.line}
                          {view.workContext.detail ? ` (${view.workContext.detail})` : ''}
                        </span>
                        {view.candidateLine ? (
                          <span className="ahsp-line" style={{ color: MUTED }}>{view.candidateLine}</span>
                        ) : null}
                        {view.candidateChoices.length > 0 ? (
                          <div className="ahsp-choice-list">
                            {view.candidateChoices.map((choice) => (
                              <button
                                key={choice.resourceCatalogId}
                                type="button"
                                className="ahsp-action ahsp-action--choice"
                                disabled={locked}
                                onClick={() =>
                                  void curateOnDetail(
                                    group,
                                    '/curate-existing',
                                    () => ({ selectedResourceCatalogId: choice.resourceCatalogId }),
                                    group.ids,
                                    'existing:' + choice.resourceCatalogId,
                                  )
                                }
                              >
                                Benar, ini sama dengan: {choice.name}
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {view.canProposeNew && view.newUnitDefinitionId ? (
                          <button
                            type="button"
                            className="ahsp-action ahsp-action--outline"
                            disabled={locked}
                            onClick={() =>
                              void curateOnDetail(
                                group,
                                '/curate-new',
                                () =>
                                  view.newResourceRefusal
                                    ? {
                                        unitDefinitionId: view.newUnitDefinitionId as string,
                                        refusedCandidateIds: view.newResourceRefusal.candidateIds,
                                        candidateContextDigest: view.newResourceRefusal.candidateContextDigest,
                                      }
                                    : { unitDefinitionId: view.newUnitDefinitionId as string },
                                group.ids.slice(0, 1),
                                'new',
                              )
                            }
                          >
                            {view.newResourceActionLabel}
                          </button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              <button
                type="button"
                style={{ ...outlineButton, marginTop: 'var(--space-3)' }}
                onClick={() => setReviewOpen(false)}
              >
                Tutup tinjauan
              </button>
            </section>
          ) : null}

          {/* Two columns: components (left) + information (right) */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-5)', alignItems: 'flex-start' }}>
            <section aria-label="Komponen Pembentuk AHSP" className="ahsp-detail-primary-card" style={{ flex: '1 1 30rem', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
                <span style={ICON_TILE}><Layers size={16} /></span>
                <h2 style={{ fontSize: 'var(--text-lg)', color: NAVY, margin: 0 }}>Komponen Pembentuk AHSP</h2>
              </div>
              {!currentVersion ? (
                <section className="simprok-honest-frame" aria-label="Komponen AHSP kosong">
                  <span className="simprok-honest-frame__badge">Belum ada data</span>
                  <p>Komponen tidak dapat ditampilkan karena rumus belum ada.</p>
                </section>
              ) : !hasAnyDefinitionComponent(groups) ? (
                <section className="simprok-honest-frame" aria-label="Komponen AHSP kosong">
                  <span className="simprok-honest-frame__badge">Belum ada data</span>
                  <p>AHSP ini belum menyatakan komponen tenaga, bahan, atau peralatan.</p>
                </section>
              ) : (
                <>
                {repeatedComponentLabels.length > 0 ? (
                  <aside role="note" aria-label="Periksa komponen dengan uraian berulang" className="ahsp-detail-repeated-note">
                    <strong>Periksa komponen yang tampak berulang</strong>
                    <ul>{repeatedComponentLabels.map((label) => <li key={label}>{label}</li>)}</ul>
                    <span>Uraian dan satuannya sama. Baris serta koefisien tetap ditampilkan apa adanya; periksa apakah ini memang disengaja.</span>
                  </aside>
                ) : null}
                {groups.map((group) => (
                  <section key={group.key} aria-label={group.label} style={{ marginBottom: 'var(--space-5)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <span style={{ ...ICON_TILE, width: '1.6rem', height: '1.6rem' }}>{GROUP_ICON[group.key] ?? <Package size={14} />}</span>
                        <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: NAVY, margin: 0 }}>{group.label}</h3>
                      </div>
                      <span style={{ color: MUTED, fontSize: 'var(--text-sm)' }}>{group.rows.length} komponen</span>
                    </div>
                    {group.rows.length === 0 ? (
                      <p style={{ color: MUTED, fontSize: 'var(--text-sm)', margin: 0 }}>—</p>
                    ) : (
                      <table className="ahsp-resource-columns" style={{ fontSize: 'var(--text-sm)' }}>
                        <colgroup>
                          <col className="ahsp-col-no" />
                          <col className="ahsp-col-name" />
                          <col className="ahsp-col-unit" />
                          <col className="ahsp-col-coef" />
                        </colgroup>
                        <thead>
                          <tr className="ahsp-detail-resource-heading" style={{ textAlign: 'left' }}>
                            <th style={{ padding: 'var(--space-1) var(--space-2)' }}>No.</th>
                            <th style={{ padding: 'var(--space-1) var(--space-2)' }}>Uraian</th>
                            <th style={{ padding: 'var(--space-1) var(--space-2)' }}>Satuan</th>
                            <th style={{ padding: 'var(--space-1) var(--space-2)' }}>Koefisien</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.rows.map((row, index) => (
                            <tr key={group.key + '-' + index}>
                              <td style={{ padding: 'var(--space-1) var(--space-2)', borderBottom: HAIRLINE, color: MUTED }}>{index + 1}</td>
                              <td style={{ padding: 'var(--space-1) var(--space-2)', borderBottom: HAIRLINE, color: NAVY }}>
                                {row.name}
                                {row.identityNote ? (
                                  <span style={{ display: 'block', color: MUTED, fontSize: 'var(--text-sm)' }}>{row.identityNote}</span>
                                ) : null}
                              </td>
                              <td style={{ padding: 'var(--space-1) var(--space-2)', borderBottom: HAIRLINE }}>{presentedComponentUnit(row.unit)}</td>
                              <td style={{ padding: 'var(--space-1) var(--space-2)', borderBottom: HAIRLINE }}>{row.coefficient}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </section>
                ))}
                </>
              )}
            </section>

            <aside style={{ flex: '1 1 20rem', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <section aria-label="Informasi AHSP" className="ahsp-detail-primary-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
                  <span style={ICON_TILE}><FileText size={16} /></span>
                  <h2 style={{ fontSize: 'var(--text-lg)', color: NAVY, margin: 0 }}>Informasi AHSP</h2>
                </div>
                {/* ONE mapping with the room: a recorded source code is the code, never a work type. */}
                {infoRow('Kode', orDash(presentAhspIdentity(ahsp).code))}
                {infoRow('Uraian', orDash(ahsp.methodName))}
                {infoRow('Satuan', orDash(presentedOutputUnit))}
                {classificationPaths.length > 0 ? (
                  <>
                    {infoRow('Jenis Pengadaan', orDash(groupedClassificationValue(classificationPaths, 'jenisPengadaan')))}
                    {infoRow('Kategori', orDash(groupedClassificationValue(classificationPaths, 'kategori')))}
                    {infoRow('Subkategori', orDash(groupedClassificationValue(classificationPaths, 'subkategori')))}
                    {infoRow('Lingkup Pekerjaan', orDash(groupedClassificationValue(classificationPaths, 'jenisPekerjaan')))}
                  </>
                ) : (
                  <>
                    {infoRow('Jenis Pengadaan', orDash(ahsp.classification))}
                    {infoRow('Kategori', orDash(ahsp.fieldCategory))}
                    {infoRow('Subkategori', orDash(ahsp.subCategory))}
                    {infoRow('Lingkup Pekerjaan', orDash(presentAhspIdentity(ahsp).workType))}
                  </>
                )}
                {infoRow('Keterangan', orDash(ahsp.keterangan))}
                {infoRow('Dasar AHSP', orDash(currentVersion?.regulationReference))}
                {infoRow('Penerbit', orDash(currentVersion?.issuerInstitution))}
                {infoRow('Tanggal berlaku versi', currentVersion?.effectiveDate ? formatIndoDate(currentVersion.effectiveDate) : '—')}
                {infoRow('Sumber', ahsp.workspaceId === null ? 'Pustaka SIMPROK' : 'AHSP Saya')}
                {infoRow(
                  'Status Usulan',
                  <span
                    style={{
                      background: 'var(--simprok-engineering-blue-100)',
                      color: NAVY,
                      borderRadius: '999px',
                      padding: '0.1rem 0.55rem',
                      fontSize: 'var(--text-sm)',
                    }}
                  >
                    {proposalStatus}
                  </span>,
                )}
                {ahsp.workspaceId === null
                  ? infoRow('Diusulkan oleh', orDash(ahsp.proposedByName ?? 'Tidak tercatat'))
                  : infoRow('Dibuat oleh', orDash(ahsp.createdByEmail))}
                {infoRow('Tanggal input', formatIndoDate(ahsp.createdAt))}
                {infoRow('Terakhir diperbarui', formatIndoDate(ahsp.updatedAt))}
              </section>

              <section
                aria-label="Tentang AHSP Ini"
                style={{
                  background: 'var(--simprok-engineering-blue-100)',
                  borderRadius: '12px',
                  padding: 'var(--space-4)',
                  display: 'flex',
                  gap: 'var(--space-3)',
                }}
              >
                <span style={{ color: BLUE, flex: '0 0 auto' }}><Info size={18} /></span>
                <div>
                  <p style={{ margin: '0 0 var(--space-1)', fontWeight: 600, color: NAVY, fontSize: 'var(--text-sm)' }}>Tentang AHSP Ini</p>
                  <p style={{ margin: 0, color: MUTED, fontSize: 'var(--text-sm)' }}>
                    AHSP ini berisi komponen tenaga kerja, bahan, dan peralatan untuk pekerjaan {title}. Harga
                    satuan dihitung terpisah pada modul RAB menggunakan harga sumber yang berlaku.
                  </p>
                </div>
              </section>
            </aside>
          </div>

          {/*
            AHSP YANG BERLAKU — an Owner-approved section, and a locked law.
            Validity is not completeness: a missing recipe is answered by writing
            it, not by declaring the AHSP out of force; "Tidak berlaku" is
            reserved for a withdrawn or superseded definition (currentness law).
            No expiry date is invented for any state.
          */}
          <div className="ahsp-detail-action-strip">
          <section
            aria-label="AHSP yang berlaku"
            className={
              currentVersion && !outOfForce
                ? 'ahsp-detail-action-card ahsp-detail-action-card--valid'
                : 'ahsp-detail-action-card ahsp-detail-action-card--neutral'
            }
          >
            <div className="ahsp-detail-action__face">
              <span className="ahsp-detail-action__icon"><BadgeCheck size={22} /></span>
              <div className="ahsp-detail-action__copy">
                <h2 className="ahsp-detail-action__title">AHSP yang berlaku</h2>
                {!currentVersion ? (
                  <div aria-label="AHSP belum memiliki rumus">
                    <span className="simprok-honest-frame__badge">Belum ada rumus</span>
                    <p className="ahsp-detail-action__description">
                      AHSP ini belum memiliki rumus yang tersimpan. Yang belum ada adalah rumusnya —
                      keberlakuannya tidak sedang dinyatakan gugur.
                    </p>
                  </div>
                ) : outOfForce ? (
                  <div aria-label="AHSP tidak berlaku">
                    <span className="simprok-honest-frame__badge">Tidak berlaku</span>
                    <p className="ahsp-detail-action__description">
                      AHSP ini tidak digunakan untuk pilihan baru.
                    </p>
                  </div>
                ) : (
                  <p className="ahsp-detail-action__description">AHSP yang saat ini digunakan SIMPROK.</p>
                )}
              </div>
              {workspaceOwned && currentVersion && !outOfForce ? (
                <div className="ahsp-detail-status-help">
                  <button
                    type="button"
                    className="ahsp-detail-status-help__trigger"
                    aria-label="Keterangan status AHSP yang berlaku"
                    aria-controls="ahsp-validity-note"
                    aria-describedby="ahsp-validity-note"
                    aria-expanded={showValidStatusNote}
                    onClick={() => setShowValidStatusNote((open) => !open)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setShowValidStatusNote(false);
                    }}
                  >
                    <Info size={16} aria-hidden="true" />
                  </button>
                  <p
                    id="ahsp-validity-note"
                    role="tooltip"
                    className="ahsp-detail-status-help__tooltip"
                    data-open={showValidStatusNote ? 'true' : 'false'}
                  >
                    Berlaku sebagai versi AHSP saat ini; bukan pernyataan bahwa AHSP telah disetujui untuk pustaka SIMPROK. Periksa Status Usulan pada Informasi AHSP.
                  </p>
                </div>
              ) : null}
            </div>
          </section>

          {/* Lower accordions: Update AHSP + Riwayat AHSP */}
          {workspaceOwned && canManage && !archived ? (
            <details className="ahsp-detail-action-card ahsp-detail-action-card--update">
              <summary className="ahsp-detail-action__face">
                <span className="ahsp-detail-action__icon"><Pencil size={22} /></span>
                <span className="ahsp-detail-action__copy">
                  <span className="ahsp-detail-action__title">Update AHSP</span>
                  <span className="ahsp-detail-action__description">
                    Klik untuk mengubah informasi AHSP (detail, komponen, dan lainnya).
                  </span>
                </span>
                <ChevronRight className="ahsp-detail-action__arrow" size={20} aria-hidden="true" />
              </summary>
              {ahsp.ownershipType === 'USER_ASSET' ? (
                <section className="ahsp-detail-metadata-editor" aria-label="Informasi dasar AHSP">
                  <h3 className="ahsp-detail-metadata-editor__title">Informasi dasar AHSP</h3>
                  <p className="ahsp-detail-metadata-editor__hint">
                    Uraian, Kode, dan Keterangan tersimpan bersama pada AHSP privat, tanpa membuat versi rumus baru.
                  </p>
                  <div className="ahsp-detail-basic-grid">
                  <label className="ahsp-detail-metadata-editor__field">
                    <span>Uraian / Judul AHSP</span>
                    <textarea
                      rows={2}
                      required
                      aria-label="Uraian / Judul AHSP"
                      value={editMethodName}
                      onChange={(event) => { setEditMethodName(event.target.value); setMetadataFeedback(null); }}
                      disabled={metadataBusy || busy}
                    />
                  </label>
                  <label className="ahsp-detail-metadata-editor__field">
                    <span>Kode (opsional)</span>
                    <input
                      type="text"
                      aria-label="Kode"
                      value={editCode}
                      onChange={(event) => { setEditCode(event.target.value);  }}
                      disabled={metadataBusy || busy || Boolean(ahsp.proposedAt)}
                      placeholder="Contoh: B.13"
                    />
                    {ahsp.proposedAt ? (
                      <span className="ahsp-detail-metadata-editor__hint">Kode pada usulan yang sudah diajukan tidak dapat diganti di sini.</span>
                    ) : (
                      <span className="ahsp-detail-metadata-editor__hint">Kode bukan identitas utama AHSP. Koreksi ini tidak mengubah ID atau kode resource.</span>
                    )}
                  </label>
                  <label className="ahsp-detail-metadata-editor__field">
                    <span>Keterangan (opsional)</span>
                    <textarea
                      rows={3}
                      aria-label="Keterangan AHSP"
                      value={editKeterangan}
                      onChange={(event) => { setEditKeterangan(event.target.value); setMetadataFeedback(null); }}
                      disabled={metadataBusy || busy}
                      placeholder="Catatan AHSP jika tersedia"
                    />
                  </label>
                  <label className="ahsp-detail-metadata-editor__field">
                    <span>Alasan perubahan (untuk audit)</span>
                    <input
                      type="text"
                      aria-label="Alasan perubahan informasi AHSP"
                      value={metadataReason}
                      onChange={(event) => { setMetadataReason(event.target.value); setMetadataFeedback(null); }}
                      disabled={metadataBusy || busy}
                      placeholder="Contoh: koreksi penulisan judul dari dokumen sumber"
                    />
                  </label>
                  </div>
                  <div className="ahsp-detail-metadata-editor__actions">
                    <button
                      type="button"
                      className="ahsp-detail-update__save"
                      disabled={metadataBusy || busy}
                      onClick={() => void saveBasicInfo()}
                    >
                      {metadataBusy ? 'Menyimpan…' : 'Simpan Informasi Dasar'}
                    </button>
                    <button
                      type="button"
                      className="ahsp-detail-update__cancel"
                      disabled={metadataBusy || busy}
                      onClick={() => {
                        setEditCode(ahsp.code ?? '');
                        setEditMethodName(ahsp.methodName ?? '');
                        setEditKeterangan(ahsp.keterangan ?? '');
                        setMetadataReason('');
                        clearSaveFeedback();
                        setActionNotice('Perubahan Informasi Dasar dibatalkan.');
                      }}
                    >
                      Batal
                    </button>
                  </div>
                  {metadataFeedback ? (
                    <p
                      role={metadataFeedback === 'Informasi Dasar tersimpan dan sesuai dengan data AHSP.' ? 'status' : 'alert'}
                      className="ahsp-detail-metadata-editor__feedback"
                      style={{
                        color: metadataFeedback === 'Informasi Dasar tersimpan dan sesuai dengan data AHSP.' ? '#16803C' : '#C0392B',
                        background: metadataFeedback === 'Informasi Dasar tersimpan dan sesuai dengan data AHSP.' ? '#EAF8EF' : '#FFF1F1',
                        fontWeight: 600,
                      }}
                    >
                      {metadataFeedback}
                    </p>
                  ) : null}
                </section>
              ) : null}
              <form aria-label="Update AHSP" onSubmit={addVersion} style={{ marginTop: 'var(--space-4)' }}>
                <AhspClassificationRevisionPanel
                  ahspId={ahsp.id}
                  enabled={canManage && ahsp.ownershipType === 'USER_ASSET' && ahsp.workspaceId !== null && !ahsp.archivedAt && !busy && !metadataBusy}
                  onAssignmentsChange={onClassificationAssignmentsChange}
                  onSaved={onClassificationSaved}
                  onSaveAttempt={onClassificationSaveAttempt}
                  onSaveFinished={onSaveFinished}
                  onCancelled={onClassificationCancelled}
                />

                <section className="ahsp-detail-update__section" aria-label="Informasi sumber AHSP">
                  <h3 className="ahsp-detail-update__heading"><Layers size={18} aria-hidden="true" />Informasi sumber</h3>
                  <div className="ahsp-detail-update__source-grid">
                    <label className="ahsp-detail-update__field">
                      <span>Satuan AHSP</span>
                      <input required value={outputUnit} onChange={(e) => setOutputUnit(e.target.value)} aria-label="Satuan AHSP" />
                    </label>
                    <label className="ahsp-detail-update__field">
                      <span>Dasar AHSP</span>
                      <input value={regulationReference} onChange={(e) => setRegulationReference(e.target.value)} aria-label="Dasar AHSP" />
                    </label>
                    <label className="ahsp-detail-update__field">
                      <span>Penerbit</span>
                      <input value={issuerInstitution} onChange={(e) => setIssuerInstitution(e.target.value)} aria-label="Penerbit AHSP" />
                    </label>
                    <label className="ahsp-detail-update__field">
                      <span>Tanggal berlaku versi AHSP</span>
                      <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} aria-label="Tanggal berlaku versi AHSP" />
                    </label>
                  </div>
                  <p className="ahsp-detail-update__source-hint">
                    Tanggal berlaku adalah tanggal versi AHSP, bukan tanggal penerbitan dokumen. Perubahan Informasi Sumber disimpan bersama Komponen sebagai versi rumus baru melalui tombol <strong>Simpan Perubahan Komponen</strong> di bawah tabel.
                  </p>
                </section>

                <section className="ahsp-detail-update__section" aria-label="Edit komponen pembentuk AHSP">
                  <header className="ahsp-detail-update__toolbar">
                    <h3 className="ahsp-detail-update__heading"><Layers size={18} aria-hidden="true" />Komponen Pembentuk AHSP</h3>
                  </header>
                  <div className="ahsp-detail-update__table-wrap">
                    <table className="ahsp-detail-update__table">
                      <thead>
                        <tr><th>No.</th><th>Uraian</th><th>Jenis</th><th>Satuan</th><th>Koefisien</th><th>Aksi</th></tr>
                      </thead>
                      <tbody>
                        {resourceDrafts.map((row, index) => {
                          const isEditing = editingResourceIndex === index;
                          const active = isEditing || !row.stored;
                          return (
                            <tr key={row.lineId ?? 'new-' + index} className={isEditing ? 'ahsp-detail-update__editing-row' : ''}>
                              <td data-label="No.">{index + 1}</td>
                              <td data-label="Uraian">
                                {row.stored ? (
                                  <span aria-label={'Sumber daya ' + (index + 1)} className="ahsp-detail-update__resource">
                                    {resolveDefinitionResourceName({ resourceId: row.resourceId, resourceName: row.resourceName })}
                                  </span>
                                ) : (
                                  <input
                                    placeholder="Identitas sumber daya"
                                    aria-label={'Sumber daya ' + (index + 1)}
                                    value={row.resourceId}
                                    onChange={(e) => setResourceDrafts((current) =>
                                      current.map((item, i) => i === index ? { ...item, resourceId: e.target.value } : item))}
                                  />
                                )}
                                {isEditing && row.stored ? (
                                  <span className="ahsp-detail-update__identity-note">
                                    Nama mengikuti identitas sumber daya tersimpan. Penggantian nama perlu pemadanan Resource Identity.
                                  </span>
                                ) : null}
                              </td>
                              <td data-label="Jenis">
                                {active ? (
                                  <select aria-label={'Kelompok ' + (index + 1)} value={row.resourceType}
                                    onChange={(e) => setResourceDrafts((current) =>
                                      current.map((item, i) => i === index
                                        ? { ...item, resourceType: e.target.value as ResourceDraft['resourceType'] } : item))}>
                                    <option value="LABOR">Tenaga</option>
                                    <option value="MATERIAL">Bahan</option>
                                    <option value="EQUIPMENT">Peralatan</option>
                                  </select>
                                ) : (row.resourceType === 'LABOR' ? 'Tenaga' : row.resourceType === 'MATERIAL' ? 'Bahan' : 'Peralatan')}
                              </td>
                              <td data-label="Satuan">
                                {active ? (
                                  <input aria-label={'Satuan komponen ' + (index + 1)} value={row.baseUnit}
                                    onChange={(e) => setResourceDrafts((current) =>
                                      current.map((item, i) => i === index ? { ...item, baseUnit: e.target.value } : item))}
                                  />
                                ) : row.baseUnit}
                              </td>
                              <td data-label="Koefisien">
                                {active ? (
                                  <input inputMode="decimal" aria-label={'Koefisien ' + (index + 1)} value={row.coefficient}
                                    onChange={(e) => setResourceDrafts((current) =>
                                      current.map((item, i) => i === index ? { ...item, coefficient: e.target.value } : item))}
                                  />
                                ) : row.coefficient}
                              </td>
                              <td data-label="Aksi">
                                <div className="ahsp-detail-update__row-actions">
                                  {row.stored ? (
                                    <button type="button" className="ahsp-detail-update__edit"
                                      disabled={busy || (editingResourceIndex !== null && !isEditing)}
                                      aria-label={(isEditing ? 'Selesai edit komponen ' : 'Edit komponen ') + (index + 1)}
                                      onClick={() => {
                                        if (isEditing) {
                                          setEditingResourceIndex(null);
                                          setEditingResourceOriginal(null);
                                        } else {
                                          setEditingResourceIndex(index);
                                          setEditingResourceOriginal({ ...row });
                                          setActionError(null);
                                        }
                                      }}>
                                      <Pencil size={14} aria-hidden="true" />{isEditing ? 'Selesai' : 'Edit'}
                                    </button>
                                  ) : <span className="ahsp-detail-update__new-label">Baru</span>}
                                  {isEditing && editingResourceOriginal ? (
                                    <button type="button" className="ahsp-detail-update__cancel"
                                      onClick={() => {
                                        const original = editingResourceOriginal;
                                        setResourceDrafts((current) => current.map((item, i) => i === index ? original : item));
                                        setEditingResourceIndex(null);
                                        setEditingResourceOriginal(null);
                                      }}>Batal</button>
                                  ) : null}
                                  <button type="button" className="ahsp-detail-update__delete"
                                    disabled={busy || (editingResourceIndex !== null && !isEditing)}
                                    aria-label={'Hapus komponen ' + (index + 1)}
                                    title="Hapus hanya dari draft. Tekan Simpan Perubahan Komponen untuk menyimpan."
                                    onClick={() => {
                                      setResourceDrafts((current) => current.filter((_, i) => i !== index));
                                      setComponentRemovalNotice(true);
                                      setEditingResourceIndex(null);
                                      setEditingResourceOriginal(null);
                                    }}>Hapus</button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {componentRemovalNotice ? (
                    <p className="ahsp-detail-update__draft-removal-notice" role="status" aria-live="polite">
                      Baris telah dihapus dari draft saja, belum dari AHSP tersimpan. Tekan <strong>Simpan Perubahan Komponen</strong> untuk menyimpan atau <strong>Batal Perubahan</strong> untuk mengembalikan daftar.
                    </p>
                  ) : null}
                  <div className="ahsp-detail-update__footer">
                    <button type="button" className="ahsp-detail-update__add ahsp-detail-update__add--primary"
                      disabled={busy || editingResourceIndex !== null}
                      onClick={() => setResourceDrafts((current) => [...current, emptyResource()])}>
                      + Tambah Baris Komponen
                    </button>
                    <div className="ahsp-detail-update__footer-actions">
                      <button type="button" className="ahsp-detail-update__cancel"
                        disabled={busy}
                        aria-label="Batal Perubahan"
                        title="Kembalikan semua perubahan draft sumber dan komponen ke versi tersimpan"
                        onClick={() => {
                          setResourceDrafts(draftsFromVersion(currentVersion));
                          setComponentRemovalNotice(false);
                          setOutputUnit(currentVersion?.outputUnit ?? '');
                          setRegulationReference(currentVersion?.regulationReference ?? '');
                          setIssuerInstitution(currentVersion?.issuerInstitution ?? '');
                          setEffectiveDate(toDateInput(currentVersion?.effectiveDate));
                          setEditingResourceIndex(null);
                          setEditingResourceOriginal(null);
                          clearSaveFeedback();
                          setActionNotice('Perubahan Informasi Sumber dan Komponen dibatalkan.');
                        }}>
                        Batal Perubahan
                      </button>
                      <button type="submit" className="ahsp-detail-update__save"
                        disabled={busy || editingResourceIndex !== null}
                        aria-label="Simpan Perubahan Komponen"
                        title="Simpan seluruh perubahan sumber dan komponen dalam satu versi AHSP">
                        {busy ? 'Menyimpan komponen…' : 'Simpan Perubahan Komponen'}
                      </button>
                    </div>
                  </div>
                </section>
              </form>
            </details>
          ) : null}

          {historicalVersions.length > 0 ? (
            <details className="ahsp-detail-action-card ahsp-detail-action-card--history">
              <summary aria-label="Riwayat AHSP" className="ahsp-detail-action__face">
                <span className="ahsp-detail-action__icon"><History size={22} /></span>
                <span className="ahsp-detail-action__copy">
                  <span className="ahsp-detail-action__title">Riwayat AHSP</span>
                  <span className="ahsp-detail-action__description">
                    Lihat versi rumus terdahulu yang tersedia untuk AHSP ini.
                  </span>
                </span>
                <ChevronRight className="ahsp-detail-action__arrow" size={20} aria-hidden="true" />
              </summary>
              <div className="ahsp-detail-history__content">
                <p className="ahsp-detail-history__note">
                  Riwayat ini memuat versi rumus terdahulu yang tersedia, bukan seluruh perubahan Informasi Dasar atau Klasifikasi.
                </p>
                <div className="ahsp-detail-history__scroll" role="region" aria-label="Tabel riwayat versi rumus AHSP" tabIndex={0}>
                  <table className="ahsp-detail-history__table">
                <thead>
                  <tr style={{ textAlign: 'left', color: MUTED, background: 'var(--simprok-engineering-blue-100)' }}>
                    <th scope="col">Versi</th>
                    <th scope="col">Sumber / Peraturan</th>
                    <th scope="col">Satuan output</th>
                    <th scope="col">Tanggal berlaku</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {historicalVersions.map((version) => (
                    <tr key={version.id}>
                      <td>{version.versionNumber != null ? `Versi ${version.versionNumber}` : '—'}</td>
                      <td>{version.regulationReference || '—'}</td>
                      <td>{presentedAhspOutputUnitSymbol({ stored: version.outputUnit, displayName: version.outputUnitDisplayName, symbol: version.outputUnitSymbol, code: version.outputUnitCode }) || '—'}</td>
                      <td>{version.effectiveDate ? formatIndoDate(version.effectiveDate) : '—'}</td>
                      <td>{historyStatusLabel(version.status)}</td>
                    </tr>
                  ))}
                </tbody>
                  </table>
                </div>
              </div>
            </details>
          ) : null}
          </div>
        </>
      ) : null}

      <UsulkanSimprokDialog
        open={showProposeConfirm}
        busy={proposing}
        onCancel={() => setShowProposeConfirm(false)}
        onConfirm={() => void confirmProposeToSimprok()}
      />
    </main>
  );
}

export default AhspDetailPage;
