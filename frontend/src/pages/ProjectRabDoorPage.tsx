import { Fragment, useMemo, useState, useEffect, useRef, type CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Archive, ChevronLeft, ChevronRight, Download, FileText, Lock, Maximize2, Minimize2, Printer, RotateCcw, Upload, ZoomIn, ZoomOut, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import {
  toPersistedCalculationDisplay,
  type PersistedCalculationDisplay,
  type PersistedCalculationWire,
} from '../utils/rabPersistedCalculationDisplay';
import {
  toPersistedRowDisplayList,
  toRecapDisplay,
  type PersistedBoqItem,
  type PersistedDraftRecap,
  type PersistedPriceOrigin,
  type PersistedRowDisplay,
} from '../utils/rabPersistedDraftDisplay';
import {
  buildPriceTrace,
  resolvePriceOrigin,
  PRICE_TRACE_ACTION,
  PRICE_TRACE_TITLE,
  TECHNICAL_DETAIL_TITLE,
} from '../utils/rabTraceDisplay';
import {
  RAB_LOCK_COPY,
  recapTotalLabel,
  resolveProjectPresentationStatus,
  type RabLifecycleFactsWire,
} from '../utils/rabLockDisplay';

type RabStatus = 'Draft' | 'Terkunci' | 'Approved' | 'Selesai';
type PanelMode = 'compact' | 'wide' | 'collapsed';
type RabSource = 'baseline' | 'draft' | 'empty';

interface RabProject {
  name: string;
  code: string;
  owner: string;
  location: string;
  fiscalYear: string;
  status: RabStatus;
  value: string;
  /** Raw backend Project.status, used only to gate the draft fallback below — never derived from the display RabStatus. */
  rawStatus: string;
}

/**
 * GET /projects/:projectId/boq/draft response shape (canonical persisted
 * read path). `items` and `recap` are typed via rabPersistedDraftDisplay.ts
 * so `unitPrice`/`lineTotal`/recap money fields stay exact decimal strings
 * end to end — no `any[]` on this path.
 */
interface DraftBoqApiResponse {
  items: PersistedBoqItem[];
  recap?: PersistedDraftRecap | null;
}

const defaultProject: RabProject = {
  name: 'Nama proyek belum tersedia',
  code: 'Data belum tersedia',
  owner: 'Data belum tersedia',
  location: 'Data belum tersedia',
  fiscalYear: 'Data belum tersedia',
  status: 'Draft',
  value: 'Data belum tersedia',
  rawStatus: '',
};

/** Mirrors RAB_EDITABLE_PROJECT_STATUSES on the backend — the only status under which a Working Draft may exist to fall back to. */
const RAB_EDITABLE_PROJECT_STATUSES = ['PLANNED'];

/**
 * Project.budgetBaseline hero display only — a different field on a
 * different endpoint (GET /projects/:projectId) than the BoqItem/recap
 * canonical persisted contract this viewer proves out. Left as-is,
 * deliberately out of this slice's ALLOWED_WRITE_SCOPE-bounded claim.
 */
const formatRupiah = (value: number) => `Rp ${Math.round(value).toLocaleString('id-ID')}`;

const supportDocuments = [
  'Spesifikasi Teknis',
  'RKK',
  'Peralatan Utama',
  'Metode Pelaksanaan',
  'Schedule / Jadwal',
  'TKDN',
];

const snapshotDoors = [
  { name: 'AHSP Snapshot', hasPage: true },
  { name: 'Basic Price Snapshot', hasPage: false },
] as const;

function isReadOnly(status: RabStatus) {
  return status === 'Terkunci' || status === 'Approved' || status === 'Selesai';
}

/** Right-aligned, tabular-numeral cell — canonical money/quantity columns only. */
const numericCellStyle: CSSProperties = { textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

const recapLineStyle: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: '1rem' };

const priceOriginBadgeBaseStyle: CSSProperties = {
  display: 'inline-block',
  padding: '0.1875rem 0.5rem',
  borderRadius: '999px',
  fontSize: '0.75rem',
  fontWeight: 600,
  lineHeight: 1.3,
};

/** Color Lock: Navy = server authority/persisted, neutral grey = manual or not-yet-priced — text label always carries the distinction, color is secondary. */
const priceOriginBadgeStyle = (priceOrigin: PersistedPriceOrigin): CSSProperties => {
  if (priceOrigin === 'SERVER_COST_KERNEL') {
    return { color: '#16294B', background: '#EAF0FB', border: '1px solid #C7D5EC' };
  }
  if (priceOrigin === 'MANUAL_CLIENT') {
    return { color: '#475569', background: '#F1F5F9', border: '1px solid #E2E8F0' };
  }
  return { color: '#98A2B3', background: '#F8FAFC', border: '1px solid #EAECEF' };
};

const provenanceListStyle: CSSProperties = {
  margin: '0.375rem 0 0',
  padding: '0.5rem 0.625rem',
  background: '#F8FAFC',
  border: '1px solid #EAECEF',
  borderRadius: '6px',
  fontSize: '0.75rem',
  color: '#475569',
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  columnGap: '0.5rem',
  rowGap: '0.1875rem',
};

export function ProjectRabDoorPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [project, setProject] = useState<RabProject>(defaultProject);
  const [rabRows, setRabRows] = useState<PersistedRowDisplay[]>([]);
  const [rabSource, setRabSource] = useState<RabSource>('empty');
  const [rabLifecycle, setRabLifecycle] = useState<RabLifecycleFactsWire | null>(null);
  /** RAB-TRACE-01 — which row's price evidence is open. Read-only view state. */
  /** Disclosure only: whether the status card is showing its secondary facts. */
  const [statusDetailOpen, setStatusDetailOpen] = useState(false);
  const [evidenceRowId, setEvidenceRowId] = useState<string | null>(null);
  /**
   * The authoritative persisted proof, kept with the row it belongs to. Keying
   * it this way means a proof can never be read against a different row while
   * a fetch is in flight, and the effect never has to reset state on the way
   * in: an id that does not match is simply "not fetched yet".
   */
  const [evidenceProof, setEvidenceProof] = useState<{
    rowId: string;
    display: PersistedCalculationDisplay | null;
  } | null>(null);
  const evidenceGenerationRef = useRef(0);
  const [draftRecap, setDraftRecap] = useState<PersistedDraftRecap | null>(null);
  
  const [zoom, setZoom] = useState(100);
  const [panelMode, setPanelMode] = useState<PanelMode>('compact');
  const [activeSupport, setActiveSupport] = useState('Spesifikasi Teknis');
  const [addendumOpen, setAddendumOpen] = useState(false);
  const [officialActionMessage, setOfficialActionMessage] = useState('');
  const rabDocumentRef = useRef<HTMLDivElement>(null);
  const [rabDocumentSize, setRabDocumentSize] = useState({ width: 1180, height: 240 });
  
  useEffect(() => {
    async function loadData() {
      if (!projectId) return;
      try {
        setLoading(true);
        setError(null);

        const projResponse = await apiFetch(`/projects/${projectId}`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const projData = await projResponse.json() as any;

        let mappedStatus: RabStatus = 'Draft';
        if (projData?.status === 'ACTIVE') mappedStatus = 'Terkunci';
        else if (projData?.status === 'COMPLETED') mappedStatus = 'Selesai';
        else if (projData?.status === 'ON_HOLD') mappedStatus = 'Terkunci';

        const rawStatus = typeof projData?.status === 'string' ? projData.status : '';
        const isPlannedProject = RAB_EDITABLE_PROJECT_STATUSES.includes(rawStatus);

        // The RAB's own lifecycle, from the server policy. Project.status
        // answers a different question and must not be asked this one.
        setRabLifecycle((projData?.rabLifecycle as RabLifecycleFactsWire) ?? null);

        setProject({
          name: projData?.name || 'Nama proyek belum tersedia',
          code: projData?.code || (projData?.id ? `PRJ-${String(projData.id).slice(0, 8).toUpperCase()}` : 'Belum tersedia'),
          owner: projData?.ownerName || projData?.owner || 'Belum tersedia',
          location: projData?.location || 'Belum tersedia',
          fiscalYear: projData?.fiscalYear || 'Belum tersedia',
          status: mappedStatus,
          value: projData?.budgetBaseline ? formatRupiah(projData.budgetBaseline) : 'Belum tersedia',
          rawStatus,
        });

        let shouldLoadDraft = false;

        // Draft fallback is allowed only after baseline loads successfully and returns no rows.
        try {
          const boqResponse = await apiFetch(`/projects/${projectId}/boq`);
          if (!boqResponse.ok) {
            throw new Error('Baseline RAB response is not OK');
          }
          const boqData = await boqResponse.json() as PersistedBoqItem[];
          if (Array.isArray(boqData) && boqData.length > 0) {
            setRabRows(toPersistedRowDisplayList(boqData));
            setRabSource('baseline');
            setDraftRecap(null);
          } else {
            setRabRows([]);
            shouldLoadDraft = true;
          }
        } catch {
          // Baseline failure must stay visible; do not silently fallback to draft.
          setRabRows([]);
          setRabSource('empty');
          setDraftRecap(null);
          setError('RAB belum bisa dimuat. Gagal membaca baseline RAB. Coba muat ulang atau periksa akses proyek.');
          return;
        }

        if (shouldLoadDraft && isPlannedProject) {
          try {
            const draftResponse = await apiFetch(`/projects/${projectId}/boq/draft`);
            const draftData = await draftResponse.json() as DraftBoqApiResponse;
            const draftItems = draftResponse.ok && Array.isArray(draftData?.items) ? draftData.items : [];

            if (draftItems.length > 0) {
              setRabRows(toPersistedRowDisplayList(draftItems));
              setRabSource('draft');
              setDraftRecap(draftData?.recap ?? null);
            } else {
              setRabRows([]);
              setRabSource('empty');
              setDraftRecap(null);
            }
          } catch {
            setRabRows([]);
            setRabSource('empty');
            setDraftRecap(null);
          }
        } else if (shouldLoadDraft) {
          // Non-PLANNED project with no baseline rows: a Working Draft is not
          // a lawful concept here — do not call GET /boq/draft at all.
          setRabRows([]);
          setRabSource('empty');
          setDraftRecap(null);
        }

      } catch {
        setError('Proyek tidak ditemukan atau belum dapat dimuat.');
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [projectId]);

  const readOnly = isReadOnly(project.status);
  const archived = project.status === 'Selesai';
  const isPlannedProject = RAB_EDITABLE_PROJECT_STATUSES.includes(project.rawStatus);
  const isDraftPreview = rabSource === 'draft';
  const presentation = useMemo(() => resolveProjectPresentationStatus(rabLifecycle), [rabLifecycle]);
  /**
   * `rabSource` says which table the rows were read from, which for a frozen
   * RAB with no baseline is still the draft structure. That is a fact about
   * storage, not about the RAB. Shown to the Owner as a draft-state label it
   * contradicted the lock chip on the very same screen.
   */
  const rabFrozen = presentation.status === 'TERKUNCI' || presentation.status === 'APPROVED';
  const rowStateLabel = presentation.label;
  const zoomScale = zoom / 100;
  const hasRabRows = rabRows.length > 0;
  // RECAP DISPLAY AUTHORITY: COMPLETE renders recap.subtotal/marginAmount/
  // taxAmount/grandTotal exactly as persisted; INCOMPLETE never fabricates a
  // partial total. See rabPersistedDraftDisplay.ts — no formula lives here.
  const recapDisplay = useMemo(() => toRecapDisplay(draftRecap), [draftRecap]);
  /**
   * Opening evidence reads the authoritative proof. A read-only GET is not a
   * mutation: nothing is saved, recalculated, or reassigned — the row is only
   * asked to explain itself. State is written solely in the async result, so
   * opening the panel schedules no cascading render.
   */
  useEffect(() => {
    if (!projectId || !evidenceRowId) return;
    const row = rabRows.find((candidate) => candidate.id === evidenceRowId);
    if (!row || row.priceOrigin !== 'SERVER_COST_KERNEL') return;

    const generation = ++evidenceGenerationRef.current;
    apiFetch(`/projects/${projectId}/boq/items/${evidenceRowId}/persisted-calculation`)
      .then(async (response) => {
        if (!response.ok) throw new Error('persisted-calculation-load-failed');
        return (await response.json()) as PersistedCalculationWire;
      })
      .then((wire) => {
        if (generation !== evidenceGenerationRef.current) return;
        setEvidenceProof({ rowId: evidenceRowId, display: toPersistedCalculationDisplay(wire) });
      })
      .catch(() => {
        if (generation !== evidenceGenerationRef.current) return;
        // Fail closed: an unreadable proof is never replaced by row metadata.
        setEvidenceProof({ rowId: evidenceRowId, display: null });
      });
  }, [projectId, evidenceRowId, rabRows]);

  const evidenceRow = useMemo(
    () => rabRows.find((row) => row.id === evidenceRowId) ?? null,
    [rabRows, evidenceRowId],
  );
  /** Assembled from persisted values only — nothing here computes money. */
  const evidenceTrace = useMemo(
    () =>
      evidenceRow
        ? buildPriceTrace({
            description: evidenceRow.description,
            unit: evidenceRow.unit,
            quantityDisplay: evidenceRow.quantityDisplay,
            unitPriceDisplay: evidenceRow.unitPriceDisplay,
            lineTotalDisplay: evidenceRow.lineTotalDisplay,
            priceOrigin: evidenceRow.priceOrigin,
            isWorkItem: evidenceRow.itemType === 'WORK_ITEM',
            ahsp: evidenceRow.ahspWire,
            authoritative:
              evidenceRow.priceOrigin !== 'SERVER_COST_KERNEL'
                ? null
                : evidenceProof?.rowId === evidenceRow.id
                ? evidenceProof.display
                : undefined,
            provenance: evidenceRow.provenance,
          })
        : null,
    [evidenceRow, evidenceProof],
  );

  useEffect(() => {
    const node = rabDocumentRef.current;
    if (!node) return;

    const measureDocument = () => {
      setRabDocumentSize({
        width: Math.max(node.scrollWidth, hasRabRows ? 1180 : 1),
        height: Math.max(node.scrollHeight, 1),
      });
    };

    measureDocument();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measureDocument);
      return () => window.removeEventListener('resize', measureDocument);
    }

    const observer = new ResizeObserver(measureDocument);
    observer.observe(node);
    return () => observer.disconnect();
  }, [error, hasRabRows, loading, rabRows]);

  const zoomStyle = useMemo(
    () => ({
      '--simprok-rab-zoom': zoomScale,
      position: 'absolute',
      top: 0,
      left: 0,
      width: hasRabRows ? `${Math.max(rabDocumentSize.width, 1180)}px` : '100%',
      minWidth: hasRabRows ? '1180px' : '0',
      transform: `scale(${zoomScale})`,
      transformOrigin: 'top left',
    }) as CSSProperties,
    [hasRabRows, rabDocumentSize.width, zoomScale],
  );

  const zoomScrollAreaStyle = useMemo(
    () => ({
      position: 'relative',
      width: hasRabRows ? `${Math.max(rabDocumentSize.width, 1180) * zoomScale}px` : '100%',
      minWidth: hasRabRows ? `${1180 * zoomScale}px` : '100%',
      height: `${Math.max(rabDocumentSize.height, 1) * zoomScale}px`,
      minHeight: hasRabRows ? undefined : '100%',
    }) as CSSProperties,
    [hasRabRows, rabDocumentSize.height, rabDocumentSize.width, zoomScale],
  );

  const changeZoom = (nextZoom: number) => {
    setZoom(Math.min(140, Math.max(80, nextZoom)));
  };

  const showOfficialActionMessage = (message: string) => {
    setOfficialActionMessage(message);
  };

  const handleAddendumAction = () => {
    if (archived) {
      showOfficialActionMessage('RAB arsip tidak dapat diajukan perubahan. Riwayat tetap tersedia sebagai dokumen resmi.');
      return;
    }

    setAddendumOpen((current) => !current);
    showOfficialActionMessage('Jalur Addendum disiapkan. Engine perubahan resmi belum aktif.');
  };

  // A frozen or approved RAB says so first. Reading the source of the rows
  // ("this came from the draft table") and reporting it as the RAB's state
  // told the Owner their locked RAB was still an open draft.
  const statusMechanismCopy = presentation.status === 'APPROVED'
    ? 'RAB ini sudah disetujui dan menjadi acuan resmi. Perubahan isi RAB dilakukan melalui mekanisme Addendum.'
    : presentation.status === 'TERKUNCI'
    ? RAB_LOCK_COPY.lockedNote
    : isDraftPreview
    ? 'RAB draft tersimpan, belum menjadi baseline resmi. Viewer ini hanya membaca draft dan tidak mengunci RAB.'
    : rabSource === 'empty'
      ? (isPlannedProject ? 'Belum ada baseline resmi atau draft tersimpan untuk proyek ini.' : 'RAB baseline belum tersedia untuk proyek ini.')
      : archived
        ? 'RAB selesai terkunci otomatis sebagai arsip. Perubahan tidak dimungkinkan; riwayat tetap utuh.'
        : readOnly
          ? 'RAB ini sudah menjadi acuan resmi. Perubahan isi RAB dilakukan melalui mekanisme Addendum.'
          : 'RAB masih dapat disempurnakan sesuai kewenangan sebelum dikunci.';

  return (
    <main className="simprok-rab">
      <nav className="simprok-detail__breadcrumb" aria-label="Breadcrumb">
        <button type="button" onClick={() => navigate('/proyek')}>
          Proyek Saya
        </button>
        <span>/</span>
        <button type="button" onClick={() => navigate(projectId ? `/project/${projectId}/detail` : '/proyek')}>
          Detail Proyek
        </button>
        <span>/</span>
        <strong>RAB</strong>
      </nav>

      <section className="simprok-rab-hero">
        <div className="simprok-rab-hero__document">
          <p className="simprok-rab-eyebrow">Ruang Hidup RAB</p>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#16294B', margin: '0 0 0.125rem' }}>{project.name}</h1>
          <p className="simprok-rab-module-label" style={{ fontSize: '1.0625rem', fontWeight: 600, color: '#16294B', margin: '0 0 0.5rem' }}>Rencana Anggaran Biaya (RAB)</p>
          <div className="simprok-rab-identity" aria-label="Identitas RAB">
            <span><b>Kode RAB:</b> {project.code}</span>
            <span><b>Instansi / Owner:</b> {project.owner}</span>
            <span><b>Lokasi:</b> {project.location}</span>
            <span><b>Tahun Anggaran:</b> {project.fiscalYear}</span>
          </div>
        </div>
        <aside className="simprok-rab-mechanism" aria-label="Status dan mekanisme perubahan">
          <span className="simprok-rab-mechanism__label">Status & Mekanisme</span>
          <div className="simprok-rab-mechanism__chips">
            {/*
              One status, the same one every other door shows — and now the way
              to ask for more. "RAB Terkunci" already says the RAB is locked, so
              the sentence explaining that it is locked no longer occupies the
              card permanently. It is disclosure, never an unlock: toggling this
              moves nothing but a paragraph.
            */}
            <button
              type="button"
              className={`simprok-rab-status simprok-rab-status--${presentation.chipModifier}`}
              style={{ border: 'none', font: 'inherit', cursor: 'pointer' }}
              onClick={() => setStatusDetailOpen((open) => !open)}
              aria-expanded={statusDetailOpen}
              aria-controls="simprok-rab-status-detail"
              title={statusDetailOpen ? 'Sembunyikan rincian status' : 'Lihat rincian status'}
            >
              {presentation.status === 'SELESAI' ? <Archive size={14} aria-hidden="true" /> : rabFrozen ? <Lock size={14} aria-hidden="true" /> : null}
              {presentation.badgeLabel}
            </button>
          </div>
          {statusDetailOpen ? (
            <dl id="simprok-rab-status-detail" className="simprok-rab-mechanism__detail" style={{ margin: '0.5rem 0 0', display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: '0.75rem', rowGap: '0.25rem', fontSize: 'var(--text-sm)' }}>
              <dt style={{ color: '#98A2B3' }}>Status RAB</dt>
              <dd style={{ margin: 0, color: '#16294B' }}>{presentation.label}</dd>
              {typeof rabLifecycle?.activeBaselineCount === 'number' ? (
                <>
                  <dt style={{ color: '#98A2B3' }}>Baseline</dt>
                  <dd style={{ margin: 0, color: '#16294B' }}>
                    {rabLifecycle.activeBaselineCount > 0 ? 'Baseline resmi aktif' : 'Belum menjadi baseline resmi'}
                  </dd>
                </>
              ) : null}
              <dt style={{ color: '#98A2B3' }}>Mekanisme</dt>
              <dd style={{ margin: 0, color: '#16294B' }}>{statusMechanismCopy}</dd>
            </dl>
          ) : null}
          {!archived ? (
            <button type="button" className="simprok-rab-button simprok-rab-button--gold" onClick={handleAddendumAction}>
              Ajukan Perubahan / Addendum
            </button>
          ) : null}
        </aside>
      </section>

      {officialActionMessage ? (
        <div className="simprok-rab-official-message">
          <FileText size={15} aria-hidden="true" />
          <span>{officialActionMessage}</span>
        </div>
      ) : null}

      <div className={`simprok-rab-shell simprok-rab-shell--${panelMode}`}>
        <section className="simprok-rab-workspace" aria-label="Dokumen RAB">
          <header className="simprok-rab-toolbar">
            <div>
              <h2>Dokumen RAB</h2>
              {/* The lock sentence and the baseline sentence both live in the
                  status card now — one meaning, one primary message. */}
              {!rabFrozen && !isDraftPreview && !archived ? (
                <small>Beberapa aksi resmi seperti export, cetak, dan import menunggu integrasi backend.</small>
              ) : null}
            </div>
            <div className="simprok-rab-toolbar__actions">
              <button type="button" onClick={() => showOfficialActionMessage('Kerangka export/cetak siap. Engine export resmi belum aktif.')} aria-label="Export atau cetak RAB">
                <Download size={15} aria-hidden="true" />
                Export / Cetak
              </button>
              <button type="button" onClick={() => showOfficialActionMessage('Print dokumen RAB menunggu engine cetak resmi tersambung.')} aria-label="Print RAB">
                <Printer size={15} aria-hidden="true" />
                Print
              </button>
              <button type="button" onClick={() => showOfficialActionMessage('Import Data Pendukung disiapkan sebagai pintu resmi. Engine import belum aktif.')} aria-label="Import Data Pendukung">
                <Upload size={15} aria-hidden="true" />
                Import Data Pendukung
              </button>
              <button type="button" onClick={() => changeZoom(zoom - 10)} aria-label="Zoom out">
                <ZoomOut size={15} aria-hidden="true" />
              </button>
              <span>{zoom}%</span>
              <button type="button" onClick={() => changeZoom(zoom + 10)} aria-label="Zoom in">
                <ZoomIn size={15} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => changeZoom(100)} aria-label="Fit atau reset zoom">
                <RotateCcw size={15} aria-hidden="true" />
                Fit
              </button>
            </div>
          </header>

          {addendumOpen ? (
            <div className="simprok-rab-addendum">
              Addendum ditampilkan sebagai pintu perubahan. Pengiriman resmi dan approval belum aktif di frontend shell ini.
            </div>
          ) : null}

          <div className="simprok-rab-canvas">
            <div style={zoomScrollAreaStyle}>
              <div ref={rabDocumentRef} className="simprok-rab-canvas__zoom" style={zoomStyle}>
              {loading ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--simprok-text-muted)' }}>
                  Memuat dokumen RAB...
                </div>
              ) : error ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--simprok-text-muted)' }}>
                  <AlertTriangle size={24} style={{ margin: '0 auto 1rem', display: 'block' }} />
                  {error}
                </div>
              ) : rabRows.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--simprok-text-muted)' }}>
                  <FileText size={24} style={{ margin: '0 auto 1rem', display: 'block' }} />
                  <strong style={{ display: 'block', color: '#16294B', marginBottom: '0.375rem' }}>RAB belum tersedia.</strong>
                  <span>{isPlannedProject ? 'Belum ada baseline resmi atau draft tersimpan untuk proyek ini.' : 'RAB baseline belum tersedia untuk proyek ini.'}</span>
                </div>
              ) : (
                <>
                  {/* The lock banner and the baseline banner both used to sit
                      here as well as in Status & Mekanisme. The baseline fact is
                      unchanged and still readable there on request; it no longer
                      spends permanent space above the RAB. */}
                  <table className="simprok-rab-table">
                    <thead>
                      <tr>
                        <th>No</th>
                        <th>Kode</th>
                        <th>Uraian Pekerjaan</th>
                        <th>Satuan</th>
                        <th style={{ textAlign: 'right' }}>Volume</th>
                        <th style={{ textAlign: 'right' }}>Harga Satuan</th>
                        <th style={{ textAlign: 'right' }}>Jumlah</th>
                        <th>Asal Harga</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rabRows.map((row) => (
                        <tr key={row.id}>
                          {/* The official structural position, from the same
                              authority Ruang Kerja uses — not this row's
                              index in the response array. */}
                          {/* The first glance is position and code. The AHSP
                              analysis is still known — it is read from the
                              detail surface, not advertised in every row. */}
                          <td>{row.number}</td>
                          <td>{row.code}</td>
                          <td>{row.description || 'Belum tersedia'}</td>
                          <td>{row.unit || '-'}</td>
                          <td style={numericCellStyle}>{row.quantityDisplay || '-'}</td>
                          <td style={numericCellStyle}>{row.unitPriceDisplay || '-'}</td>
                          <td style={numericCellStyle}>{row.lineTotalDisplay || '-'}</td>
                          <td>
                            {/* Asal Harga stays one short fact in the Owner's
                                own vocabulary. The evidence behind it opens in
                                a panel beside the document — expanding it
                                inside the cell reflowed the whole table and
                                made the RAB appear to jump away. */}
                            {/* The origin fact is itself the door to its own
                                evidence. A separate link beside it made the
                                reader choose between a label and a link that
                                mean the same thing. */}
                            {(() => {
                              const origin = resolvePriceOrigin(row.priceOrigin, { isWorkItem: row.itemType === 'WORK_ITEM' });
                              if (!origin.label) return null;
                              const openable = row.itemType === 'WORK_ITEM' && Boolean(row.priceOrigin);
                              const badgeStyle = { ...priceOriginBadgeBaseStyle, ...priceOriginBadgeStyle(row.priceOrigin) };
                              return openable ? (
                                <button
                                  type="button"
                                  onClick={() => setEvidenceRowId(row.id)}
                                  style={{ ...badgeStyle, border: 'none', font: 'inherit', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
                                  title={PRICE_TRACE_ACTION}
                                  aria-label={`${origin.label} — ${PRICE_TRACE_ACTION}: ${row.description}`}
                                >
                                  {origin.label}
                                </button>
                              ) : (
                                <span style={badgeStyle}>{origin.label}</span>
                              );
                            })()}
                          </td>
                          <td>{rowStateLabel}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {isDraftPreview ? (
                    <div style={{ marginTop: '0.875rem', display: 'grid', gap: '0.4rem', maxWidth: '360px', color: '#16294B', fontVariantNumeric: 'tabular-nums' }}>
                      {recapDisplay.incomplete ? (
                        <p role="status" style={{ margin: '0 0 0.125rem', color: '#98A2B3' }}>{recapDisplay.incompleteLabel}</p>
                      ) : null}
                      <span style={recapLineStyle}>Subtotal<strong>{recapDisplay.subtotalDisplay}</strong></span>
                      <span style={recapLineStyle}>Margin {recapDisplay.marginPercentDisplay}%<strong>{recapDisplay.marginAmountDisplay}</strong></span>
                      <span style={recapLineStyle}>PPN {recapDisplay.taxPercentDisplay}%<strong>{recapDisplay.taxAmountDisplay}</strong></span>
                      {/* The recap is read from the draft persistence structure
                          even when the RAB is frozen, but where the numbers are
                          stored is not what state the RAB is in. Calling this
                          total a draft told the Owner their locked RAB was still
                          open, on the same screen that says TERKUNCI. */}
                      <span style={recapLineStyle}>{recapTotalLabel(presentation.status)}<strong>{recapDisplay.grandTotalDisplay}</strong></span>
                    </div>
                  ) : null}
                </>
              )}
              </div>
            </div>
          </div>
        </section>

        {/*
          RAB-TRACE-01 — ONE right-side slot. Price evidence used to render as
          a second aside, which added a sibling to the grid and reorganised the
          page around the document. The slot now switches what it holds, so
          opening evidence changes the panel and never the layout.
        */}
        {evidenceRow ? (
          <aside className="simprok-rab-support" aria-label={PRICE_TRACE_TITLE}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
              <div>
                <strong style={{ display: 'block', color: '#16294B' }}>{evidenceTrace?.title}</strong>
                <small style={{ color: '#98A2B3' }}>{evidenceTrace?.subtitle}</small>
              </div>
              <button
                type="button"
                onClick={() => setEvidenceRowId(null)}
                aria-label={`Tutup ${PRICE_TRACE_TITLE}`}
                style={{ border: 'none', background: 'none', font: 'inherit', cursor: 'pointer', color: '#16294B' }}
              >
                Tutup
              </button>
            </div>
            {/* The verdict first: how far the evidence actually goes. */}
            <p style={{ margin: '0.5rem 0', color: '#16294B', fontSize: '0.8125rem' }}>{evidenceTrace?.verdict}</p>
            <dl style={provenanceListStyle}>
              {evidenceTrace?.facts.map((fact) => (
                <Fragment key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </Fragment>
              ))}
            </dl>
            {evidenceTrace?.unavailable.length ? (
              <p style={{ margin: '0.5rem 0 0', color: '#98A2B3', fontSize: '0.75rem' }}>
                {evidenceTrace.unavailable.join(' ')}
              </p>
            ) : null}
            {evidenceTrace?.resources.length ? (
              <details style={{ marginTop: '0.5rem' }}>
                <summary style={{ cursor: 'pointer', fontSize: '0.75rem', color: '#16294B' }}>
                  Komponen pembentuk harga ({evidenceTrace.resources.length})
                </summary>
                <dl style={provenanceListStyle}>
                  {evidenceTrace.resources.map((resource) => (
                    <Fragment key={resource.resolutionId}>
                      <dt>{resource.name}</dt>
                      <dd>{resource.resourceCostDisplay}</dd>
                    </Fragment>
                  ))}
                </dl>
              </details>
            ) : null}
            {evidenceTrace?.technicalFacts.length ? (
              <details style={{ marginTop: '0.5rem' }}>
                <summary style={{ cursor: 'pointer', fontSize: '0.75rem', color: '#16294B' }}>{TECHNICAL_DETAIL_TITLE}</summary>
                <dl style={provenanceListStyle}>
                  {evidenceTrace.technicalFacts.map((fact) => (
                    <Fragment key={fact.label}>
                      <dt>{fact.label}</dt>
                      <dd style={{ wordBreak: 'break-all' }}>{fact.value}</dd>
                    </Fragment>
                  ))}
                </dl>
              </details>
            ) : null}
          </aside>
        ) : (
        <aside className="simprok-rab-support" aria-label="Data Pendukung RAB">
          <header>
            <div>
              <h2>Data Pendukung</h2>
              {panelMode !== 'collapsed' ? <p>Dokumen dan snapshot acuan RAB.</p> : null}
            </div>
            <div className="simprok-rab-support__controls">
              <button type="button" onClick={() => setPanelMode('collapsed')} aria-label="Collapse panel">
                <ChevronRight size={15} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => setPanelMode('compact')} aria-label="Persempit panel">
                <Minimize2 size={15} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => setPanelMode('wide')} aria-label="Perlebar panel">
                <Maximize2 size={15} aria-hidden="true" />
              </button>
            </div>
          </header>

          {panelMode === 'collapsed' ? (
            <button type="button" className="simprok-rab-support__expand" onClick={() => setPanelMode('compact')}>
              <ChevronLeft size={15} aria-hidden="true" />
              Buka Panel
            </button>
          ) : (
            <>
              <p className="simprok-rab-section-label">Dokumen Pendukung</p>
              <div className="simprok-rab-doc-list">
                {supportDocuments.map((doc) => (
                  <button key={doc} type="button" className={activeSupport === doc ? 'simprok-rab-doc simprok-rab-doc--active' : 'simprok-rab-doc'} onClick={() => setActiveSupport(doc)}>
                    <span>
                      <FileText size={15} aria-hidden="true" />
                      {doc}
                    </span>
                    <em>Belum tersedia</em>
                  </button>
                ))}
              </div>

              <p className="simprok-rab-section-label">Snapshot Acuan</p>
              <div className="simprok-rab-snapshot-list">
                {snapshotDoors.map((snapshot) => (
                  <article key={snapshot.name} className="simprok-rab-snapshot">
                    <div>
                      <strong>{snapshot.name}</strong>
                      <span>Menunggu mesin</span>
                    </div>
                    {snapshot.hasPage && projectId ? (
                      <button type="button" onClick={() => navigate(`/project/${projectId}/rab/ahsp-snapshot`)}>
                        Buka Snapshot
                      </button>
                    ) : (
                      <button type="button" className="simprok-rab-snapshot__secondary" onClick={() => setActiveSupport(snapshot.name)}>
                        Lihat Keterangan
                      </button>
                    )}
                  </article>
                ))}
              </div>

              <div className="simprok-rab-support-preview">
                <span className="simprok-rab-support-preview__label">Keterangan Data Pendukung</span>
                <strong>{activeSupport}</strong>
                <p>
                  {snapshotDoors.some(s => s.name === activeSupport)
                    ? snapshotDoors.find(s => s.name === activeSupport)?.hasPage
                      ? 'Snapshot AHSP tersedia sebagai referensi acuan harga satuan pekerjaan yang melekat pada RAB ini.'
                      : 'Snapshot Basic Price akan tersedia setelah engine data harga dasar tersambung ke RAB ini. Belum tersedia saat ini.'
                    : 'Dokumen ini akan terbentuk setelah RAB jadi dan siap ditinjau sesuai kewenangan. Belum tersedia saat ini.'}
                </p>
              </div>
            </>
          )}
        </aside>
        )}
      </div>
    </main>
  );
}

export default ProjectRabDoorPage;
