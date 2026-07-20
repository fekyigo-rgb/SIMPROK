import { useMemo, useState, useEffect, useRef, type CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Archive, ChevronLeft, ChevronRight, Download, FileText, Lock, Maximize2, Minimize2, Printer, RotateCcw, Upload, ZoomIn, ZoomOut, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

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

interface RabRow {
  code: string;
  description: string;
  unit: string;
  volume: string;
  unitPrice: string;
  total: string;
}

interface DraftRecap {
  subtotal?: number | string | null;
  marginPercent?: number | string | null;
  marginAmount?: number | string | null;
  taxPercent?: number | string | null;
  ppnPercent?: number | string | null;
  taxAmount?: number | string | null;
  grandTotal?: number | string | null;
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

const formatRupiah = (value: number) => `Rp ${Math.round(value).toLocaleString('id-ID')}`;

const toFiniteNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mapBoqRowsToRabRows = (items: any[]): RabRow[] => items.map((item, idx) => {
  const qty = Number(item.quantity) || 0;
  const up = Number(item.unitPrice) || 0;
  return {
    code: item.wbsCode || String(idx + 1),
    description: item.name || 'Belum tersedia',
    unit: item.unit || '-',
    volume: qty > 0 ? qty.toLocaleString('id-ID') : '-',
    unitPrice: up > 0 ? formatRupiah(up) : '-',
    total: qty > 0 && up > 0 ? formatRupiah(qty * up) : '-',
  };
});

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

export function ProjectRabDoorPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [project, setProject] = useState<RabProject>(defaultProject);
  const [rabRows, setRabRows] = useState<RabRow[]>([]);
  const [rabSource, setRabSource] = useState<RabSource>('empty');
  const [draftRecap, setDraftRecap] = useState<DraftRecap | null>(null);
  
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const boqData = await boqResponse.json() as any;
          if (Array.isArray(boqData) && boqData.length > 0) {
            setRabRows(mapBoqRowsToRabRows(boqData));
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const draftData = await draftResponse.json() as any;
            const draftItems = draftResponse.ok && Array.isArray(draftData?.items) ? draftData.items : [];

            if (draftItems.length > 0) {
              setRabRows(mapBoqRowsToRabRows(draftItems));
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
  const zoomScale = zoom / 100;
  const hasRabRows = rabRows.length > 0;
  const draftTaxPercent = draftRecap?.ppnPercent ?? draftRecap?.taxPercent ?? 0;

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

  const statusMechanismCopy = isDraftPreview
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
            <span className={`simprok-rab-status simprok-rab-status--${project.status.toLowerCase()}`}>
              {archived ? <Archive size={14} aria-hidden="true" /> : readOnly && !isDraftPreview ? <Lock size={14} aria-hidden="true" /> : null}
              {isDraftPreview ? 'Draft  Belum Dikunci' : archived ? 'Selesai  Arsip' : project.status === 'Draft' ? 'Draft' : 'RAB Terkunci'}
            </span>
            {rabSource === 'baseline' && project.status === 'Approved' ? <span className="simprok-rab-status simprok-rab-status--approved">Approved</span> : null}
            {rabSource === 'baseline' && readOnly && !archived ? <span className="simprok-rab-status simprok-rab-status--approved">Baseline 01</span> : null}
          </div>
          <p>{statusMechanismCopy}</p>
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
              {isDraftPreview ? (
                <small>Draft Preview: RAB draft tersimpan, belum menjadi baseline resmi.</small>
              ) : !archived ? (
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
                  {isDraftPreview ? (
                    <div style={{ marginBottom: '0.75rem', padding: '0.75rem 1rem', border: '1px solid #D0D5DD', borderRadius: '8px', color: '#16294B', background: '#F8FAFC' }}>
                      <strong>RAB draft tersimpan, belum menjadi baseline resmi.</strong>
                    </div>
                  ) : null}
                  <table className="simprok-rab-table">
                    <thead>
                      <tr>
                        <th>Kode</th>
                        <th>Uraian Pekerjaan</th>
                        <th>Satuan</th>
                        <th>Volume</th>
                        <th>Harga Satuan</th>
                        <th>Jumlah</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rabRows.map((row) => (
                        <tr key={row.code}>
                          <td>{row.code}</td>
                          <td>{row.description}</td>
                          <td>{row.unit}</td>
                          <td>{row.volume}</td>
                          <td>{row.unitPrice}</td>
                          <td>{row.total}</td>
                          <td>{isDraftPreview ? 'Draft Preview' : readOnly ? 'Read-only' : 'Draft RAB'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {isDraftPreview && draftRecap ? (
                    <div style={{ marginTop: '0.875rem', display: 'grid', gap: '0.4rem', maxWidth: '360px', color: '#16294B' }}>
                      <span>Subtotal: <strong>{formatRupiah(toFiniteNumber(draftRecap.subtotal))}</strong></span>
                      <span>Margin {toFiniteNumber(draftRecap.marginPercent).toLocaleString('id-ID')}%: <strong>{formatRupiah(toFiniteNumber(draftRecap.marginAmount))}</strong></span>
                      <span>PPN {toFiniteNumber(draftTaxPercent).toLocaleString('id-ID')}%: <strong>{formatRupiah(toFiniteNumber(draftRecap.taxAmount))}</strong></span>
                      <span>Grand Total Draft: <strong>{formatRupiah(toFiniteNumber(draftRecap.grandTotal))}</strong></span>
                    </div>
                  ) : null}
                </>
              )}
              </div>
            </div>
          </div>
        </section>

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
      </div>
    </main>
  );
}

export default ProjectRabDoorPage;
