import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Layers, Users, Package, Wrench, FileText, Info, Pencil, History, ArrowLeft, Send, MoreHorizontal, BadgeCheck } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
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
import { presentedUnitLabel } from '../utils/unitSuggestionLabel';
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
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [showProposeConfirm, setShowProposeConfirm] = useState(false);
  const [proposalSubject, setProposalSubject] = useState<
    | { phase: 'READY'; subject: ProposalSubjectWire }
    | { phase: 'FAILED' }
    | null
  >(null);
  const [outputUnit, setOutputUnit] = useState('');
  const [regulationReference, setRegulationReference] = useState('');
  const [issuerInstitution, setIssuerInstitution] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [resourceDrafts, setResourceDrafts] = useState<ResourceDraft[]>([emptyResource()]);
  // STAGE 2A Door B — scoped open observations for THIS AHSP only.
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewRows, setReviewRows] = useState<readonly CuratableObservationWire[]>([]);
  const [reviewPhase, setReviewPhase] = useState<'IDLE' | 'LOADING' | 'READY' | 'FAILED'>('IDLE');
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);
  const reviewLock = useRef(false);
  const reviewSectionRef = useRef<HTMLElement | null>(null);

  const applyPayload = useCallback((data: AhspDetail) => {
    setState({ phase: 'READY', ahsp: data });
    const current = (data.versions ?? [])[0] ?? null;
    setOutputUnit(current?.outputUnit ?? '');
    setRegulationReference(current?.regulationReference ?? '');
    setIssuerInstitution(current?.issuerInstitution ?? '');
    setEffectiveDate(toDateInput(current?.effectiveDate));
    setResourceDrafts(draftsFromVersion(current));
  }, []);

  useEffect(() => {
    let active = true;
    if (!ahspId) {
      setState({
        phase: 'FAILED',
        message: 'AHSP ini tidak dapat dibuka karena identitasnya tidak ada di alamat.',
      });
      return;
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
    if (state.phase !== 'READY' || !ahspId || !state.ahsp.proposedAt) {
      setProposalSubject(null);
      return;
    }
    let active = true;
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

  const presentedOutputUnit = presentedUnitLabel({
    stored: currentVersion?.outputUnit,
    displayName: currentVersion?.outputUnitDisplayName,
    symbol: currentVersion?.outputUnitSymbol,
    code: currentVersion?.outputUnitCode,
  });

  const reload = async () => {
    if (!ahspId) return;
    const response = await apiFetch('/ahsp/' + ahspId);
    if (!response.ok) {
      setActionError('AHSP tidak dapat dibaca ulang. Coba lagi sebentar.');
      return;
    }
    applyPayload((await response.json()) as AhspDetail);
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
    if (state.phase !== 'READY' || !canCurate || !ahspId) {
      setReviewRows([]);
      setReviewPhase('IDLE');
      setReviewOpen(false);
      return;
    }
    void loadResourceReview();
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

  const addVersion = async (event: FormEvent) => {
    event.preventDefault();
    if (!ahspId || busy) return;
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
          (row.baseUnit ?? '').trim() === sent.baseUnit &&
          parseCoefficientInput(row.coefficient) === sent.coefficient
        );
      });
    if (unchanged) {
      setActionError('Belum ada perubahan untuk disimpan.');
      return;
    }
    setBusy(true);
    setActionError(null);
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
      await reload();
    } catch {
      setActionError('Pembaruan AHSP tidak dapat dihubungi.');
    } finally {
      setBusy(false);
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
              {canManage ? (
                <button type="button" aria-label="Tindakan lain" style={{ ...outlineButton, padding: 'var(--space-2)' }} disabled>
                  <MoreHorizontal size={16} />
                </button>
              ) : null}
            </div>
          </header>

          {actionError ? (
            <p role="alert" style={{ color: '#C0392B', fontSize: 'var(--text-sm)', margin: '0 0 var(--space-3)' }}>
              {actionError}
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
            <section aria-label="Komponen Pembentuk AHSP" style={{ ...CARD, flex: '1 1 30rem', minWidth: 0 }}>
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
                groups.map((group) => (
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
                          <tr style={{ textAlign: 'left', color: MUTED, background: 'var(--simprok-engineering-blue-100)' }}>
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
                ))
              )}
            </section>

            <aside style={{ flex: '1 1 20rem', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <section aria-label="Informasi AHSP" style={CARD}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
                  <span style={ICON_TILE}><FileText size={16} /></span>
                  <h2 style={{ fontSize: 'var(--text-lg)', color: NAVY, margin: 0 }}>Informasi AHSP</h2>
                </div>
                {/* ONE mapping with the room: a recorded source code is the code, never a work type. */}
                {infoRow('Kode', orDash(presentAhspIdentity(ahsp).code))}
                {infoRow('Keterangan', orDash(ahsp.keterangan))}
                {classificationPaths.length > 0
                  ? classificationPaths.map((path, index) => (
                      <div key={'path-' + index}>
                        {infoRow('Jenis Pengadaan', orDash(path.jenisPengadaan))}
                        {infoRow('Kategori', orDash(path.kategori))}
                        {infoRow('Subkategori', orDash(path.subkategori))}
                        {infoRow('Jenis Pekerjaan', orDash(path.jenisPekerjaan))}
                      </div>
                    ))
                  : (
                      <>
                        {infoRow('Jenis Pengadaan', orDash(ahsp.classification))}
                        {infoRow('Kategori', orDash(ahsp.fieldCategory))}
                        {infoRow('Subkategori', orDash(ahsp.subCategory))}
                        {infoRow('Jenis Pekerjaan', orDash(presentAhspIdentity(ahsp).workType))}
                      </>
                    )}
                {infoRow('Uraian', orDash(ahsp.methodName))}
                {infoRow('Satuan', orDash(presentedOutputUnit))}
                {infoRow('Dasar AHSP', orDash(currentVersion?.regulationReference))}
                {infoRow('Penerbit', orDash(currentVersion?.issuerInstitution))}
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
                {infoRow('Dibuat oleh', orDash(ahsp.createdByEmail))}
                {infoRow('Tanggal dibuat', formatIndoDate(ahsp.createdAt))}
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
          <section aria-label="AHSP yang berlaku" style={{ ...CARD, marginTop: 'var(--space-4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              <span style={ICON_TILE}><BadgeCheck size={16} /></span>
              <h2 style={{ fontSize: 'var(--text-lg)', color: NAVY, margin: 0 }}>AHSP yang berlaku</h2>
            </div>
            {!currentVersion ? (
              <div aria-label="AHSP belum memiliki rumus">
                <span className="simprok-honest-frame__badge">Belum ada rumus</span>
                <p style={{ color: MUTED, fontSize: 'var(--text-sm)', margin: 'var(--space-1) 0 0' }}>
                  AHSP ini belum memiliki rumus yang tersimpan. Yang belum ada adalah rumusnya —
                  keberlakuannya tidak sedang dinyatakan gugur.
                </p>
              </div>
            ) : outOfForce ? (
              <div aria-label="AHSP tidak berlaku">
                <span className="simprok-honest-frame__badge">Tidak berlaku</span>
                <p style={{ color: MUTED, fontSize: 'var(--text-sm)', margin: 'var(--space-1) 0 0' }}>
                  AHSP ini tidak digunakan untuk pilihan baru.
                </p>
              </div>
            ) : (
              <p style={{ fontSize: 'var(--text-sm)', color: MUTED, margin: 0 }}>
                AHSP yang saat ini digunakan SIMPROK.
              </p>
            )}
          </section>

          {/* Lower accordions: Update AHSP + Riwayat AHSP */}
          {workspaceOwned && canManage && !archived ? (
            <details style={{ ...CARD, marginTop: 'var(--space-4)' }}>
              <summary style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <span style={ICON_TILE}><Pencil size={16} /></span>
                <span>
                  <span style={{ display: 'block', fontWeight: 600, color: NAVY }}>Update AHSP</span>
                  <span style={{ display: 'block', color: MUTED, fontSize: 'var(--text-sm)' }}>
                    Klik untuk mengubah informasi AHSP (detail, komponen, dan lainnya).
                  </span>
                </span>
              </summary>
              <form aria-label="Update AHSP" onSubmit={addVersion} style={{ marginTop: 'var(--space-4)' }}>
                <AhspClassificationRevisionPanel ahspId={ahsp.id} enabled={canManage} />
                <label style={{ display: 'block', fontSize: 'var(--text-sm)', color: MUTED, marginBottom: 'var(--space-2)' }}>
                  Satuan
                  <input required value={outputUnit} onChange={(e) => setOutputUnit(e.target.value)} aria-label="Satuan AHSP" style={{ display: 'block', color: NAVY }} />
                </label>
                <label style={{ display: 'block', fontSize: 'var(--text-sm)', color: MUTED, marginBottom: 'var(--space-3)' }}>
                  Sumber / peraturan
                  <input value={regulationReference} onChange={(e) => setRegulationReference(e.target.value)} aria-label="Sumber peraturan AHSP" style={{ display: 'block', width: '100%', maxWidth: '36rem', color: NAVY }} />
                </label>
                <label style={{ display: 'block', fontSize: 'var(--text-sm)', color: MUTED, marginBottom: 'var(--space-3)' }}>
                  Penerbit
                  <input value={issuerInstitution} onChange={(e) => setIssuerInstitution(e.target.value)} aria-label="Penerbit AHSP" style={{ display: 'block', width: '100%', maxWidth: '36rem', color: NAVY }} />
                </label>
                <label style={{ display: 'block', fontSize: 'var(--text-sm)', color: MUTED, marginBottom: 'var(--space-3)' }}>
                  Tanggal sumber
                  <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} aria-label="Tanggal sumber" style={{ display: 'block', color: NAVY }} />
                </label>
                {resourceDrafts.map((row, index) => (
                  <fieldset key={index} style={{ border: HAIRLINE, borderRadius: '8px', marginBottom: 'var(--space-2)', padding: 'var(--space-3)' }}>
                    <legend style={{ color: NAVY, fontSize: 'var(--text-sm)' }}>Komponen {index + 1}</legend>
                    {row.stored ? (
                      <span aria-label={'Sumber daya ' + (index + 1)} style={{ marginRight: 'var(--space-2)', color: NAVY }}>
                        {resolveDefinitionResourceName({ resourceId: row.resourceId, resourceName: row.resourceName })}
                      </span>
                    ) : (
                      <input
                        placeholder="Sumber daya"
                        aria-label={'Sumber daya ' + (index + 1)}
                        value={row.resourceId}
                        onChange={(e) => {
                          const next = [...resourceDrafts];
                          next[index] = { ...row, resourceId: e.target.value };
                          setResourceDrafts(next);
                        }}
                        style={{ marginRight: 'var(--space-2)', color: NAVY }}
                      />
                    )}
                    <select
                      aria-label={'Kelompok ' + (index + 1)}
                      value={row.resourceType}
                      onChange={(e) => {
                        const next = [...resourceDrafts];
                        next[index] = { ...row, resourceType: e.target.value as ResourceDraft['resourceType'] };
                        setResourceDrafts(next);
                      }}
                      style={{ marginRight: 'var(--space-2)', color: NAVY }}
                    >
                      <option value="LABOR">Tenaga</option>
                      <option value="MATERIAL">Bahan</option>
                      <option value="EQUIPMENT">Peralatan</option>
                    </select>
                    <input
                      placeholder="Satuan"
                      aria-label={'Satuan komponen ' + (index + 1)}
                      value={row.baseUnit}
                      onChange={(e) => {
                        const next = [...resourceDrafts];
                        next[index] = { ...row, baseUnit: e.target.value };
                        setResourceDrafts(next);
                      }}
                      style={{ marginRight: 'var(--space-2)', color: NAVY }}
                    />
                    <input
                      placeholder="Koefisien"
                      aria-label={'Koefisien ' + (index + 1)}
                      value={row.coefficient}
                      onChange={(e) => {
                        const next = [...resourceDrafts];
                        next[index] = { ...row, coefficient: e.target.value };
                        setResourceDrafts(next);
                      }}
                      style={{ color: NAVY }}
                    />
                    <button
                      type="button"
                      aria-label={'Hapus komponen ' + (index + 1)}
                      onClick={() => setResourceDrafts(resourceDrafts.filter((_, i) => i !== index))}
                      style={{ ...outlineButton, marginLeft: 'var(--space-2)' }}
                    >
                      Hapus
                    </button>
                  </fieldset>
                ))}
                <button type="button" onClick={() => setResourceDrafts([...resourceDrafts, emptyResource()])} style={{ ...outlineButton, marginRight: 'var(--space-2)' }}>
                  Tambah baris komponen
                </button>
                <button type="submit" disabled={busy} style={primaryButton}>Update AHSP</button>
              </form>
            </details>
          ) : null}

          {historicalVersions.length > 0 ? (
            <details style={{ ...CARD, marginTop: 'var(--space-3)' }}>
              <summary aria-label="Riwayat AHSP" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <span style={ICON_TILE}><History size={16} /></span>
                <span>
                  <span style={{ display: 'block', fontWeight: 600, color: NAVY }}>Riwayat AHSP</span>
                  <span style={{ display: 'block', color: MUTED, fontSize: 'var(--text-sm)' }}>
                    Lihat daftar perubahan yang pernah dilakukan pada AHSP ini.
                  </span>
                </span>
              </summary>
              <table style={{ width: '100%', maxWidth: '48rem', borderCollapse: 'collapse', fontSize: 'var(--text-sm)', marginTop: 'var(--space-3)' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: MUTED, background: 'var(--simprok-engineering-blue-100)' }}>
                    <th style={{ padding: 'var(--space-1) var(--space-2)' }}>Sumber / Peraturan</th>
                    <th style={{ padding: 'var(--space-1) var(--space-2)' }}>Berlaku dari</th>
                    <th style={{ padding: 'var(--space-1) var(--space-2)' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {historicalVersions.map((version) => (
                    <tr key={version.id}>
                      <td style={{ padding: 'var(--space-1) var(--space-2)', borderBottom: HAIRLINE, color: NAVY }}>{version.regulationReference || '—'}</td>
                      <td style={{ padding: 'var(--space-1) var(--space-2)', borderBottom: HAIRLINE }}>{formatIndoDate(version.effectiveDate)}</td>
                      <td style={{ padding: 'var(--space-1) var(--space-2)', borderBottom: HAIRLINE }}>{historyStatusLabel(version.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ) : null}
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
