import { useMemo, useState, useEffect, type CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Archive, ChevronLeft, ChevronRight, Download, FileText, Lock, Maximize2, Minimize2, Printer, RotateCcw, Upload, ZoomIn, ZoomOut, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

type RabStatus = 'Draft' | 'Terkunci' | 'Approved' | 'Selesai';
type PanelMode = 'compact' | 'wide' | 'collapsed';

interface RabProject {
  name: string;
  code: string;
  owner: string;
  location: string;
  fiscalYear: string;
  status: RabStatus;
  value: string;
}

interface RabRow {
  code: string;
  description: string;
  unit: string;
  volume: string;
  unitPrice: string;
  total: string;
}

const defaultProject: RabProject = {
  name: 'Rencana Anggaran Biaya',
  code: 'Data belum tersedia',
  owner: 'Data belum tersedia',
  location: 'Data belum tersedia',
  fiscalYear: 'Data belum tersedia',
  status: 'Draft',
  value: 'Data belum tersedia',
};

const formatRupiah = (value: number) => `Rp ${Math.round(value).toLocaleString('id-ID')}`;

const supportDocuments = [
  'Spesifikasi Teknis',
  'RKK',
  'Peralatan Utama',
  'Metode Pelaksanaan',
  'Schedule / Jadwal',
  'TKDN',
];

const snapshots = ['AHSP Snapshot', 'Basic Price Snapshot'];

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
  
  const [zoom, setZoom] = useState(100);
  const [panelMode, setPanelMode] = useState<PanelMode>('compact');
  const [activeSupport, setActiveSupport] = useState('Spesifikasi Teknis');
  const [addendumOpen, setAddendumOpen] = useState(false);
  const [officialActionMessage, setOfficialActionMessage] = useState('');
  
  useEffect(() => {
    async function loadData() {
      if (!projectId) return;
      try {
        setLoading(true);
        setError(null);
        
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const projData = (await apiFetch(`/projects/${projectId}`)) as any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const boqData = (await apiFetch(`/projects/${projectId}/boq`)) as any;

        let mappedStatus: RabStatus = 'Draft';
        if (projData?.status === 'ACTIVE') mappedStatus = 'Terkunci';
        else if (projData?.status === 'COMPLETED') mappedStatus = 'Selesai';
        else if (projData?.status === 'ON_HOLD') mappedStatus = 'Terkunci';

        setProject({
          name: projData?.name || 'Rencana Anggaran Biaya',
          code: projData?.id ? `PRJ-${String(projData.id).slice(0, 5).toUpperCase()}` : 'Data belum tersedia',
          owner: 'Belum tersedia',
          location: 'Belum tersedia',
          fiscalYear: 'Belum tersedia',
          status: mappedStatus,
          value: projData?.budgetBaseline ? formatRupiah(projData.budgetBaseline) : 'Belum tersedia',
        });

        if (Array.isArray(boqData)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setRabRows(boqData.map((item: any, idx: number) => {
            const qty = Number(item.quantity) || 0;
            const up = Number(item.unitPrice) || 0;
            return {
              code: item.wbsCode || String(idx + 1),
              description: item.name || 'Data belum tersedia',
              unit: item.unit || '-',
              volume: qty > 0 ? qty.toLocaleString('id-ID') : '-',
              unitPrice: up > 0 ? formatRupiah(up) : '-',
              total: qty > 0 && up > 0 ? formatRupiah(qty * up) : '-',
            };
          }));
        } else {
          setRabRows([]);
        }

      } catch {
        setError('RAB proyek belum dapat dimuat.');
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [projectId]);

  const readOnly = isReadOnly(project.status);
  const archived = project.status === 'Selesai';
  const zoomStyle = useMemo(
    () => ({
      '--simprok-rab-zoom': zoom / 100,
    }) as CSSProperties,
    [zoom],
  );

  const changeZoom = (nextZoom: number) => {
    setZoom(Math.min(140, Math.max(80, nextZoom)));
  };

  const openSnapshot = (snapshot: string) => {
    if (snapshot === 'AHSP Snapshot' && projectId) {
      navigate(`/project/${projectId}/rab/ahsp-snapshot`);
      return;
    }

    setActiveSupport(snapshot);
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

  const statusMechanismCopy = archived
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
          <p className="simprok-rab-eyebrow">Dokumen Resmi Proyek</p>
          <h1>Rencana Anggaran Biaya (RAB)</h1>
          <h2>{project.name}</h2>
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
              {archived ? <Archive size={14} aria-hidden="true" /> : readOnly ? <Lock size={14} aria-hidden="true" /> : null}
              {archived ? 'Selesai  Arsip' : project.status === 'Draft' ? 'Draft' : 'RAB Terkunci'}
            </span>
            {project.status === 'Approved' ? <span className="simprok-rab-status simprok-rab-status--approved">Approved</span> : null}
            {readOnly && !archived ? <span className="simprok-rab-status simprok-rab-status--approved">Baseline 01</span> : null}
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
              <p>RAB ditampilkan sebagai dokumen resmi. Perubahan isi RAB mengikuti mekanisme perubahan.</p>
              {!archived ? (
                <small>Beberapa aksi resmi seperti penyimpanan, addendum, dan audit trail menunggu integrasi backend.</small>
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
              {!archived ? (
                <button type="button" className="simprok-rab-toolbar__gold" onClick={handleAddendumAction} aria-label="Ajukan Perubahan atau Addendum">
                  Ajukan Perubahan / Addendum
                </button>
              ) : null}
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



          <div className="simprok-rab-actions">
            {project.status === 'Terkunci' || project.status === 'Approved' ? (
              <button type="button" className="simprok-rab-button simprok-rab-button--gold" onClick={handleAddendumAction}>
                Ajukan Addendum
              </button>
            ) : null}
            {archived ? (
              <span className="simprok-rab-readonly-pill">
                <Lock size={13} aria-hidden="true" />
                Read-only arsip
              </span>
            ) : null}
          </div>

          {addendumOpen ? (
            <div className="simprok-rab-addendum">
              Addendum ditampilkan sebagai pintu perubahan. Pengiriman resmi dan approval belum aktif di frontend shell ini.
            </div>
          ) : null}

          <div className="simprok-rab-canvas">
            <div className="simprok-rab-canvas__zoom" style={zoomStyle}>
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
                  RAB/BOQ belum tersedia untuk proyek ini.
                </div>
              ) : (
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
                        <td>{readOnly ? 'Read-only' : 'Draft RAB'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
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
              <div className="simprok-rab-doc-list">
                {supportDocuments.map((doc) => (
                  <button key={doc} type="button" className={activeSupport === doc ? 'simprok-rab-doc simprok-rab-doc--active' : 'simprok-rab-doc'} onClick={() => setActiveSupport(doc)}>
                    <span>
                      <FileText size={15} aria-hidden="true" />
                      {doc}
                    </span>
                    <em>Siap Ditinjau</em>
                  </button>
                ))}
              </div>

              <div className="simprok-rab-snapshot-list">
                {snapshots.map((snapshot) => (
                  <article key={snapshot} className="simprok-rab-snapshot">
                    <div>
                      <strong>{snapshot}</strong>
                      <span>Snapshot Aktif</span>
                    </div>
                    <button type="button" onClick={() => openSnapshot(snapshot)}>
                      Buka Snapshot
                    </button>
                  </article>
                ))}
              </div>

              <div className="simprok-rab-support-preview">
                <strong>{activeSupport}</strong>
                <p>
                  {snapshots.includes(activeSupport)
                    ? 'Snapshot ini adalah acuan yang melekat pada RAB. Detail resmi akan mengikuti mesin snapshot.'
                    : 'Dokumen pendukung pada shell ini dimodelkan sudah terbentuk otomatis setelah RAB jadi dan siap ditinjau sesuai kewenangan.'}
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
