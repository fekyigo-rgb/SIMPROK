import { type ReactNode, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, ChevronRight, FileText, Lock, X } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

type ChangeType = 'identity' | 'party' | 'personnel' | 'access';

interface DataRow {
  label: string;
  value: ReactNode;
}

const baseProjectDetail = {
  category: 'Konstruksi - Bina Marga',
  location: 'Namlea, Maluku',
  year: '2026',
  owner: 'Dinas PU Kab. Buru',
  plannedValue: 'Rp 2.450.000.000',
  lockedValue: 'Rp 2.417.500.000',
  fundingSource: 'APBD',
  contractor: 'PT Kontraktor A',
  supervisor: 'PT Konsultan B',
  planner: 'PT Konsultan C',
  responsible: 'Feky de Fretes - Project Manager / PT Kontraktor A',
  proposedBy: 'Jusuf - Direktur / PT Kontraktor A',
  reviewedBy: 'Saul - Team Leader / PT Konsultan B',
  approvedBy: 'Yance - Direksi / Dinas PU',
  approver: 'Gerson - PPK / Dinas PU',
  signingParty: 'John - KPA / Dinas PU',
  knowingParty: 'Saul - Team Leader / PT Konsultan B',
  stakeholders: '1 orang',
  description: '',
  specification: '',
  notes: '',
  startDate: '',
  endDate: '',
  progress: 'Progress akan terbaca setelah Monitoring aktif.',
  myRole: 'Owner / Creator',
  myAccess: 'Akses contoh: lihat detail dan buka Ruang RAB',
  relationStatus: 'Tidak ada relasi',
};

type ProjectDetail = typeof baseProjectDetail & {
  name: string;
  status: 'Draft' | 'Terkunci' | 'Approved' | 'Berjalan' | 'Selesai';
  relation: string;
  code: string;
  dataSource?: 'fixture' | 'api';
};

const projectDetailById: Record<string, ProjectDetail> = {
  'gedung-a': {
    ...baseProjectDetail,
    name: 'Pembangunan Gedung A',
    status: 'Draft',
    relation: 'Dibuat oleh Saya',
    code: 'PRJ-2026-GDG-001',
    lockedValue: 'Belum terkunci',
    dataSource: 'fixture',
  },
  'pipa-b': {
    ...baseProjectDetail,
    name: 'Renovasi Jaringan Pipa B',
    status: 'Terkunci',
    relation: 'Diundang / Dibagikan',
    code: 'PRJ-2026-PIP-002',
    dataSource: 'fixture',
  },
  'kendaraan-c': {
    ...baseProjectDetail,
    name: 'Pengadaan Kendaraan C',
    status: 'Approved',
    relation: 'Dibuat oleh Saya',
    code: 'PRJ-2026-KDR-003',
    category: 'Pengadaan Barang',
    lockedValue: 'Rp 1.185.000.000',
    plannedValue: 'Rp 1.200.000.000',
    dataSource: 'fixture',
  },
  'infrastruktur-d': {
    ...baseProjectDetail,
    name: 'Perbaikan Infrastruktur D',
    status: 'Berjalan',
    relation: 'Ditugaskan ke Saya',
    code: 'PRJ-2026-INF-004',
    plannedValue: 'Rp 5.400.000.000',
    lockedValue: 'Rp 5.320.000.000',
    dataSource: 'fixture',
  },
  'arsip-e': {
    ...baseProjectDetail,
    name: 'Pekerjaan Drainase E',
    status: 'Selesai',
    relation: 'Ditugaskan ke Saya',
    code: 'PRJ-2026-DRN-005',
    plannedValue: 'Rp 640.000.000',
    lockedValue: 'Rp 632.000.000',
    dataSource: 'fixture',
  },
};

const documentDoors = [
  'Spesifikasi Teknis',
  'RKK',
  'Peralatan Utama',
  'Tenaga Kerja',
  'Metode Pelaksanaan',
  'Schedule / Jadwal',
];

const changeTypeLabel: Record<ChangeType, string> = {
  identity: 'Data Identitas Proyek',
  party: 'Data Pihak / Organisasi / Perusahaan',
  personnel: 'Data Personel / Stakeholder',
  access: 'Data Kewenangan / Approval',
};

const governanceOrganizations = [
  {
    name: 'Dinas PU Kab. C',
    category: 'Pemberi Kerja / Owner',
    functionLabel: 'Satuan Kerja',
    people: [
      { name: 'Semi', job: 'PPTK', host: true, status: 'Terkunci', scopes: ['Detail', 'Review'] },
      { name: 'Gerson', job: 'PPK', status: 'Terkunci', scopes: ['Detail', 'Review', 'Approve', 'Kelola Akses'] },
      { name: 'Gunawan', job: 'KPA', status: 'Draft', scopes: ['Detail', 'Approve'] },
    ],
  },
  {
    name: 'PT Kontraktor A',
    category: 'Penyedia Jasa',
    functionLabel: 'Kontraktor Pelaksana',
    people: [
      { name: 'Jusuf', job: 'Direktur / Project Manager', host: true, status: 'Terkunci', scopes: ['Detail', 'Ruang RAB', 'Monitoring'] },
      { name: 'Feky', job: 'Pelaksana Lapangan', status: 'Draft', scopes: ['Detail', 'Monitoring', 'Input Progress'] },
    ],
  },
  {
    name: 'PT Konsultan B',
    category: 'Penyedia Jasa',
    functionLabel: 'Konsultan Pengawas',
    people: [
      { name: 'Ryan', job: 'Team Leader / Inspector', host: true, status: 'Terkunci', scopes: ['Detail', 'Monitoring', 'Review'] },
      { name: 'Saul', job: 'Supervisi Lapangan', status: 'Draft', scopes: ['Detail', 'Preview Dokumen'] },
    ],
  },
  {
    name: 'PT Konsultan D',
    category: 'Penyedia Jasa',
    functionLabel: 'Konsultan Perencana',
    people: [
      { name: 'Wisnu', job: 'Koordinator Tim Perencana', host: true, status: 'Terkunci', scopes: ['Detail', 'Ruang RAB', 'Preview Dokumen'] },
    ],
  },
];

const statusLabelFromApi = (status: unknown): ProjectDetail['status'] => {
  if (status === 'ACTIVE') return 'Berjalan';
  if (status === 'ON_HOLD') return 'Terkunci';
  if (status === 'COMPLETED' || status === 'ARCHIVED') return 'Selesai';
  return 'Draft';
};

const formatOptionalDate = (value: unknown) => {
  if (typeof value !== 'string' || !value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'long', year: 'numeric' }).format(date);
};

const formatOptionalRupiah = (value: unknown) => {
  if (value === null || value === undefined || value === '') return 'Belum tersedia';
  const numericValue = Number(value);
  if (Number.isNaN(numericValue)) return 'Belum tersedia';
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(numericValue);
};

const extractYear = (project: Record<string, unknown>) => {
  const candidates = [project.startDate, project.createdAt, project.updatedAt];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate) continue;
    const date = new Date(candidate);
    if (!Number.isNaN(date.getTime())) return String(date.getFullYear());
  }
  return '';
};

const buildFormalData = (detail?: ProjectDetail) => ({
  code: detail?.code || '',
  name: detail?.name || '',
  owner: detail?.owner || '',
  category: detail?.category || '',
  location: detail?.location || '',
  year: detail?.year || '',
  status: detail?.status || '',
  plannedValue: detail?.plannedValue || '',
  fundingSource: detail?.fundingSource || '',
  description: detail?.description || '',
  specification: detail?.specification || '',
  notes: detail?.notes || '',
  startDate: detail?.startDate || '',
  endDate: detail?.endDate || '',
});

const mapApiProjectToDetail = (project: Record<string, unknown>): ProjectDetail => ({
  ...baseProjectDetail,
  name: typeof project.name === 'string' && project.name.trim() ? project.name : 'Proyek Tanpa Nama',
  status: statusLabelFromApi(project.status),
  relation: 'Relasi menunggu data akses proyek',
  code: typeof project.code === 'string' && project.code.trim() ? project.code : String(project.id || 'Belum tersedia'),
  owner: typeof project.clientName === 'string' && project.clientName.trim() ? project.clientName : 'Belum tersedia',
  category: typeof project.type === 'string' && project.type.trim() ? project.type : 'Belum tersedia',
  location: typeof project.location === 'string' && project.location.trim() ? project.location : 'Belum tersedia',
  year: extractYear(project),
  plannedValue: formatOptionalRupiah(project.budgetBaseline),
  lockedValue: project.status === 'PLANNED' ? 'Belum terkunci' : 'Belum tersedia',
  fundingSource: 'Belum tersedia',
  description: typeof project.description === 'string' ? project.description : '',
  specification: typeof project.mainMaterialSpec === 'string' ? project.mainMaterialSpec : '',
  startDate: formatOptionalDate(project.startDate),
  endDate: formatOptionalDate(project.endDate),
  myRole: 'Relasi belum tersedia dari API',
  myAccess: 'Akses detail tersedia; kewenangan menunggu RBAC/backend aktif.',
  relationStatus: 'Data proyek nyata dari API. Kewenangan belum ditegakkan mesin.',
  dataSource: 'api',
});

function DataList({ rows }: { rows: DataRow[] }) {
  return (
    <dl className="simprok-detail-data">
      {rows.map((row) => (
        <div key={row.label} className="simprok-detail-data__row">
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function DetailCard({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`simprok-detail-card${className ? ` ${className}` : ''}`}>
      <header className="simprok-detail-card__header">
        <h2>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

function Drawer({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="simprok-detail-drawer" role="dialog" aria-modal="true" aria-label={title}>
      <div className="simprok-detail-drawer__backdrop" onClick={onClose} />
      <aside className="simprok-detail-drawer__panel">
        <header className="simprok-detail-drawer__header">
          <h2>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Tutup">
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="simprok-detail-drawer__body">{children}</div>
      </aside>
    </div>
  );
}

export function ProjectDetailDoorPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const initialProjectDetail = projectId ? projectDetailById[projectId] : undefined;
  const [projectDetail, setProjectDetail] = useState<ProjectDetail | undefined>(initialProjectDetail);
  const [detailLoading, setDetailLoading] = useState(!initialProjectDetail && Boolean(projectId));
  const [detailError, setDetailError] = useState('');
  const [formalEditOpen, setFormalEditOpen] = useState(false);
  const [formalData, setFormalData] = useState(() => buildFormalData(initialProjectDetail));
  const [formalDraft, setFormalDraft] = useState(formalData);
  const [changeDrawerOpen, setChangeDrawerOpen] = useState(false);
  const [preselectedChangeType, setPreselectedChangeType] = useState<ChangeType | null>(null);
  const [previewDoc, setPreviewDoc] = useState<string | null>(null);
  const [changeDraft, setChangeDraft] = useState({
    currentData: '',
    proposedData: '',
    reason: '',
    summary: '',
    impact: '',
    before: '',
    after: '',
    attachmentNote: '',
    reviewer: '',
  });

  useEffect(() => {
    const fixtureDetail = projectId ? projectDetailById[projectId] : undefined;
    if (fixtureDetail) {
      const nextFormalData = buildFormalData(fixtureDetail);
      setProjectDetail(fixtureDetail);
      setFormalData(nextFormalData);
      setFormalDraft(nextFormalData);
      setDetailError('');
      setDetailLoading(false);
      return;
    }

    if (!projectId) {
      setProjectDetail(undefined);
      setFormalData(buildFormalData());
      setFormalDraft(buildFormalData());
      setDetailError('projectId tidak tersedia.');
      setDetailLoading(false);
      return;
    }

    let cancelled = false;
    setDetailLoading(true);
    setDetailError('');

    apiFetch(`/projects/${projectId}`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`GET /projects/${projectId} gagal dengan status ${response.status}`);
        }
        const data = (await response.json()) as unknown;
        if (!data || typeof data !== 'object') {
          throw new Error('Respons proyek tidak berisi object data.');
        }
        return mapApiProjectToDetail(data as Record<string, unknown>);
      })
      .then((nextProjectDetail) => {
        if (cancelled) return;
        const nextFormalData = buildFormalData(nextProjectDetail);
        setProjectDetail(nextProjectDetail);
        setFormalData(nextFormalData);
        setFormalDraft(nextFormalData);
      })
      .catch(() => {
        if (cancelled) return;
        setProjectDetail(undefined);
        setFormalData(buildFormalData());
        setFormalDraft(buildFormalData());
        setDetailError('Data proyek belum dapat dimuat dari API.');
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const openRabRoom = () => {
    if (!projectId) {
      navigate('/proyek');
      return;
    }

    navigate(`/project/${projectId}/rab`);
  };

  const openChangeDrawer = (type: ChangeType | null = null) => {
    setPreselectedChangeType(type);
    setChangeDrawerOpen(true);
  };

  const manualValue = (value: string) => value.trim() || <span className="simprok-detail-empty">Belum diisi</span>;
  const formalDataManagementFields = [
    { key: 'code', label: 'Kode Proyek / Kode RAB', value: formalData.code },
    { key: 'name', label: 'Nama Proyek', value: formalData.name },
    { key: 'owner', label: 'Pemilik / Klien / Satuan Kerja / Owner', value: formalData.owner },
    { key: 'category', label: 'Kategori', value: formalData.category },
    { key: 'location', label: 'Lokasi', value: formalData.location },
    { key: 'year', label: 'Tahun / Periode', value: formalData.year },
    { key: 'status', label: 'Status', value: formalData.status },
    { key: 'plannedValue', label: 'Pagu / Nilai Rencana / Estimasi', value: formalData.plannedValue },
    { key: 'fundingSource', label: 'Sumber Dana', value: formalData.fundingSource },
    { key: 'description', label: 'Uraian Pekerjaan', value: formalData.description },
    { key: 'specification', label: 'Spesifikasi Umum', value: formalData.specification },
    { key: 'notes', label: 'Catatan Pekerjaan', value: formalData.notes },
    { key: 'startDate', label: 'Rencana Mulai', value: formalData.startDate },
    { key: 'endDate', label: 'Rencana Selesai', value: formalData.endDate },
  ];
  const completedFormalData = formalDataManagementFields.filter((field) => field.value.trim()).length;
  const missingFormalData = formalDataManagementFields.filter((field) => !field.value.trim()).map((field) => field.label);
  const openFormalEdit = () => {
    setFormalDraft(formalData);
    setFormalEditOpen(true);
  };
  const updateFormalDraft = (key: keyof typeof formalDraft, value: string) => {
    setFormalDraft((current) => ({ ...current, [key]: value }));
  };

  const isApiProject = projectDetail?.dataSource === 'api';

  if (!projectDetail) {
    return (
      <main className="simprok-detail">
        <nav className="simprok-detail__breadcrumb" aria-label="Breadcrumb">
          <button type="button" onClick={() => navigate('/proyek')}>
            Proyek Saya
          </button>
          <span>/</span>
          <strong>Detail Proyek</strong>
        </nav>
        <section className="simprok-detail-hero">
          <div className="simprok-detail-hero__main">
            <h1>Detail Proyek</h1>
            <p className="simprok-detail-note">
              {detailLoading ? 'Memuat data proyek dari API...' : detailError || 'Data detail proyek belum tersedia untuk proyek ini.'}
            </p>
            <p className="simprok-detail__technical">projectId: {projectId || 'tidak tersedia'}</p>
          </div>
          <button type="button" className="simprok-detail-button simprok-detail-button--plain" onClick={() => navigate('/proyek')}>
            Kembali ke Proyek Saya
          </button>
        </section>
      </main>
    );
  }

  const identityRows: DataRow[] = [
    { label: 'Kode Proyek / RAB', value: manualValue(formalData.code) },
    { label: 'Pemilik / Klien *', value: manualValue(formalData.owner) },
    { label: 'Kategori *', value: manualValue(formalData.category) },
    { label: 'Lokasi *', value: manualValue(formalData.location) },
    { label: 'Tahun / Periode *', value: manualValue(formalData.year) },
    { label: 'Status *', value: formalData.status ? <span className="simprok-detail-status-chip">{formalData.status}</span> : manualValue('') },
  ];

  return (
    <main className="simprok-detail">
      <nav className="simprok-detail__breadcrumb" aria-label="Breadcrumb">
        <button type="button" onClick={() => navigate('/proyek')}>
          Proyek Saya
        </button>
        <span>/</span>
        <strong>Detail Proyek</strong>
      </nav>

      <section className="simprok-detail-hero">
        <div className="simprok-detail-hero__main">
          <div className="simprok-detail-hero__title-row">
            <h1>{formalData.name || projectDetail.name}</h1>
            <span className="simprok-detail-status-chip">{formalData.status || projectDetail.status}</span>
          </div>
          <div className="simprok-detail-chips" aria-label="Konteks proyek">
            <span>{formalData.category || 'Belum diisi'}</span>
            <span>{formalData.location || 'Belum diisi'}</span>
            <span>{formalData.year || 'Belum diisi'}</span>
            <span>{projectDetail.relation}</span>
            {isApiProject ? <span>Data API proyek nyata</span> : null}
          </div>
          <p className="simprok-detail__technical">projectId: {projectId || 'tidak tersedia'}</p>
          {isApiProject ? (
            <p className="simprok-detail-note">
              Detail Proyek ini memakai data project nyata dari API. Field administrasi yang belum tersedia tetap ditandai jujur sebagai belum tersedia.
            </p>
          ) : null}
        </div>
        <div className="simprok-detail-hero__actions">
          <button type="button" className="simprok-detail-button simprok-detail-button--secondary" onClick={() => openChangeDrawer()}>
            Ajukan Perubahan Data
          </button>
          <button type="button" className="simprok-detail-button simprok-detail-button--primary" onClick={openRabRoom}>
            Buka Ruang RAB
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      </section>

      <section className="simprok-detail-wisdom">
        <strong>Rekomendasi SIMPROK</strong>
        <p>
          SIMPROK menyarankan melengkapi personel approval sebelum finalisasi. Keputusan tetap di
          tangan Anda.
        </p>
      </section>

      <div className="simprok-detail-grid">
        <DetailCard title="A. Identitas Proyek">
          <DataList rows={identityRows} />
        </DetailCard>

        <DetailCard title="B. Nilai & Sumber Dana">
          <div className="simprok-detail-value">
            <span>Nilai Terkunci / Approved</span>
            <strong>{projectDetail.lockedValue}</strong>
          </div>
          <DataList
            rows={[
              { label: 'Nilai Rencana / Estimasi', value: manualValue(formalData.plannedValue) },
              { label: 'Sumber Dana', value: manualValue(formalData.fundingSource) },
            ]}
          />
          <p className="simprok-detail-note">Perubahan nilai dan RAB dilakukan melalui Ruang RAB.</p>
        </DetailCard>

        <DetailCard title="C. Uraian & Lingkup">
          <DataList
            rows={[
              { label: 'Uraian Pekerjaan *', value: manualValue(formalData.description) },
              { label: 'Spesifikasi Umum', value: manualValue(formalData.specification) },
              { label: 'Catatan Pekerjaan', value: manualValue(formalData.notes) },
            ]}
          />
        </DetailCard>

        <DetailCard title="D. Jadwal">
          <DataList
            rows={[
              { label: 'Rencana Mulai *', value: manualValue(formalData.startDate) },
              { label: 'Rencana Selesai *', value: manualValue(formalData.endDate) },
              { label: 'Progress Saat Ini', value: projectDetail.progress },
            ]}
          />
          <button type="button" className="simprok-detail-mini-button" disabled>
            Lihat Schedule
            <Lock size={13} aria-hidden="true" />
          </button>
          <p className="simprok-detail-note">Menunggu mesin Schedule.</p>
        </DetailCard>

        <DetailCard title="E. Kelengkapan Data Formal" className="simprok-detail-card--formal-completeness">
          <div className="simprok-detail-formal-summary">
            <div className="simprok-detail-completeness">
              <div>
                <strong>{completedFormalData} dari {formalDataManagementFields.length} data formal</strong>
                <span>Belum lengkap: {missingFormalData.length ? missingFormalData.join(', ') : 'Tidak ada'}</span>
              </div>
              <div className="simprok-detail-progress" aria-hidden="true">
                <span style={{ width: `${(completedFormalData / formalDataManagementFields.length) * 100}%` }} />
              </div>
            </div>
            <button type="button" className="simprok-detail-mini-button simprok-detail-mini-button--blue" onClick={openFormalEdit}>
              Lengkapi Data Formal
            </button>
          </div>
          {formalEditOpen ? (
            <div className="simprok-detail-inline-form" aria-label="Form edit Data Formal Proyek">
              {formalDataManagementFields.map((field) => (
                <label key={field.key}>
                  <span>{field.label}</span>
                  {field.key === 'description' || field.key === 'specification' || field.key === 'notes' ? (
                    <textarea
                      rows={3}
                      value={formalDraft[field.key as keyof typeof formalDraft]}
                      onChange={(event) => updateFormalDraft(field.key as keyof typeof formalDraft, event.target.value)}
                    />
                  ) : (
                    <input
                      value={formalDraft[field.key as keyof typeof formalDraft]}
                      onChange={(event) => updateFormalDraft(field.key as keyof typeof formalDraft, event.target.value)}
                    />
                  )}
                </label>
              ))}
              <p className="simprok-detail-inline-form__note">
                Perubahan ini hanya berlaku pada tampilan sementara dan belum mengubah data resmi tersimpan.
              </p>
              <div className="simprok-detail-inline-form__actions">
                <button
                  type="button"
                  className="simprok-detail-mini-button simprok-detail-mini-button--blue"
                  onClick={() => {
                    setFormalData(formalDraft);
                    setFormalEditOpen(false);
                  }}
                >
                  Terapkan Sementara
                </button>
                <button type="button" className="simprok-detail-mini-button" onClick={() => setFormalEditOpen(false)}>
                  Batal
                </button>
              </div>
            </div>
          ) : null}
        </DetailCard>

        <DetailCard title="F. Pihak Terlibat & Kewenangan" className="simprok-detail-card--governance">
          <section className="project-detail-governance adaptive-governance" aria-labelledby="adaptive-governance-title">
            <header className="adaptive-governance__header">
              <div>
                <p className="adaptive-governance__eyebrow">Governance</p>
                <h3 id="adaptive-governance-title">Para Pihak & Kewenangan</h3>
                <p>{isApiProject ? 'Governance proyek nyata menunggu data pihak, personel, dan kewenangan dari backend.' : 'Organisasi, personel, jabatan/fungsi, dan kewenangan per orang.'}</p>
              </div>
              <span className="adaptive-governance__status">
                <Lock size={13} aria-hidden="true" />
                Menunggu RBAC
              </span>
            </header>

            <div className="adaptive-gov-law adaptive-gov-law--compact">
              <strong>{isApiProject ? 'Data governance belum tersambung' : 'Kerangka draft'}</strong>
              <span>{isApiProject ? 'SIMPROK tidak menampilkan pihak contoh sebagai data nyata. Kewenangan akan tampil setelah assignment/RBAC backend tersedia.' : 'Kewenangan ditampilkan per personel. Penegakan akses menunggu RBAC/backend aktif.'}</span>
            </div>

            <div className="adaptive-gov-actions">
              <button type="button" className="adaptive-gov-action adaptive-gov-action--primary" disabled>
                Tambah Organisasi / Pihak
                <small>Menunggu RBAC</small>
              </button>
              <button type="button" className="adaptive-gov-action" disabled>
                Kelola Pihak & Kewenangan
                <small>Menunggu RBAC</small>
              </button>
              <button type="button" className="adaptive-gov-action adaptive-gov-action--gold" onClick={() => openChangeDrawer('access')}>
                Ajukan Perubahan Data
              </button>
              <span>Kewenangan belum ditegakkan mesin. Tombol tetap ditampilkan sebagai locked-door action.</span>
            </div>

            {isApiProject ? (
              <DataList
                rows={[
                  { label: 'Sumber data proyek', value: 'API project nyata' },
                  { label: 'Pihak / organisasi', value: 'Belum tersedia dari API' },
                  { label: 'Personel dan kewenangan', value: 'Menunggu RBAC/backend assignment' },
                  { label: 'Akses saya', value: projectDetail.myAccess },
                ]}
              />
            ) : (
              <div className="adaptive-gov-org-list" aria-label="Pihak / Organisasi">
                {governanceOrganizations.map((organization) => (
                <article key={organization.name} className="adaptive-gov-org">
                  <header className="adaptive-gov-org__header">
                    <div className="adaptive-gov-org__icon" aria-hidden="true">
                      {organization.name.includes('Kontraktor') ? 'PT' : organization.name.includes('Konsultan') ? 'KS' : 'DP'}
                    </div>
                    <div>
                      <h4>{organization.name}</h4>
                      <p>{organization.category}</p>
                    </div>
                    <span>{organization.functionLabel}</span>
                  </header>

                  <div className="adaptive-gov-people-tree" aria-label={`Personel ${organization.name}`}>
                    {organization.people.map((person) => (
                      <div key={person.name} className="adaptive-gov-person">
                        <div className="adaptive-gov-avatar">{person.name.slice(0, 2).toUpperCase()}</div>
                        <div className="adaptive-gov-person__body">
                          <div className="adaptive-gov-person__line">
                            <strong>{person.name}</strong>
                            {person.host ? <span>Host</span> : null}
                            <em className={person.status === 'Terkunci' ? 'adaptive-gov-status--locked' : 'adaptive-gov-status--draft'}>
                              {person.status}
                            </em>
                          </div>
                          <div className="adaptive-gov-person__access-line">
                            <span className="adaptive-gov-person__job">{person.job}</span>
                            <div className="adaptive-gov-person__scopes">
                              {person.scopes.map((scope) => (
                                <span key={scope}>{scope}</span>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <button type="button" className="adaptive-gov-action" disabled>
                    Undang Personel
                    <small>Menunggu RBAC</small>
                  </button>
                </article>
                ))}
              </div>
            )}

          </section>
        </DetailCard>

        <DetailCard title="G. Perubahan Data Proyek">
          <DataList
            rows={[
              { label: 'Riwayat Perubahan Data', value: 'Belum ada' },
              { label: 'Status Audit Trail', value: 'Riwayat tersedia setelah audit trail aktif.' },
            ]}
          />
          <div className="simprok-detail-mini-actions">
            <button type="button" className="simprok-detail-mini-button" onClick={() => openChangeDrawer()}>
              Lihat Riwayat
            </button>
            <button
              type="button"
              className="simprok-detail-mini-button simprok-detail-mini-button--gold"
              onClick={() => openChangeDrawer()}
            >
              Ajukan Perubahan Data
            </button>
          </div>
        </DetailCard>

        <DetailCard title="H. Relasi Proyek">
          <DataList
            rows={[
              { label: 'Status Relasi', value: projectDetail.relationStatus },
              { label: 'Konsolidasi', value: 'Konsolidasi & struktur proyek tersedia tahap berikutnya.' },
            ]}
          />
        </DetailCard>
      </div>

      <section className="simprok-detail-docs">
        <header>
          <div>
            <h2>Pintu Dokumen & Ruang Kerja</h2>
            <p>
              Pintu dokumen dari Detail Proyek adalah preview baca cepat. Edit dokumen tetap melalui
              Ruang RAB dan mengikuti kewenangan.
            </p>
          </div>
        </header>
        <div className="simprok-detail-docs__grid">
          {documentDoors.map((docName) => (
            <button key={docName} type="button" onClick={() => setPreviewDoc(docName)}>
              <FileText size={16} aria-hidden="true" />
              <span>{docName}</span>
              <small>Preview read-only</small>
              <ChevronRight size={15} aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>

      <Drawer title="Ajukan Perubahan Data Proyek" open={changeDrawerOpen} onClose={() => setChangeDrawerOpen(false)}>
        <p className="simprok-detail-note">
          Perubahan data belum dikirim ke server. Mesin approval dan audit trail belum aktif.
          Pilihan perubahan akan disaring berdasarkan kewenangan setelah mesin RBAC aktif.
        </p>
        <div className="simprok-detail-change-types">
          {(Object.keys(changeTypeLabel) as ChangeType[]).map((type) => (
            <button
              key={type}
              type="button"
              className={preselectedChangeType === type ? 'simprok-detail-change-types__item--active' : ''}
              onClick={() => setPreselectedChangeType(type)}
            >
              {changeTypeLabel[type]}
            </button>
          ))}
        </div>
        <div className="simprok-detail-form">
          <label>
            <span>Jenis Perubahan</span>
            <input value={preselectedChangeType ? changeTypeLabel[preselectedChangeType] : 'Belum dipilih'} readOnly />
          </label>
          <label>
            <span>Data saat ini / nilai lama</span>
            <input
              value={changeDraft.currentData}
              onChange={(event) => setChangeDraft((current) => ({ ...current, currentData: event.target.value }))}
              placeholder="Contoh: kewenangan atau data saat ini"
            />
          </label>
          <label>
            <span>Data usulan / nilai baru</span>
            <input
              value={changeDraft.proposedData}
              onChange={(event) => setChangeDraft((current) => ({ ...current, proposedData: event.target.value }))}
              placeholder="Isi nilai/data usulan"
            />
          </label>
          <label>
            <span>Alasan perubahan *</span>
            <textarea
              rows={3}
              value={changeDraft.reason}
              onChange={(event) => setChangeDraft((current) => ({ ...current, reason: event.target.value }))}
              placeholder="Jelaskan alasan perubahan data."
            />
          </label>
          <label>
            <span>Ringkasan perubahan *</span>
            <textarea
              rows={3}
              value={changeDraft.summary}
              onChange={(event) => setChangeDraft((current) => ({ ...current, summary: event.target.value }))}
              placeholder="Ringkas perubahan yang diajukan."
            />
          </label>
          <label>
            <span>Dampak terhadap akses/kewenangan/administrasi</span>
            <textarea
              rows={2}
              value={changeDraft.impact}
              onChange={(event) => setChangeDraft((current) => ({ ...current, impact: event.target.value }))}
              placeholder="Jelaskan dampak administrasi atau kewenangan."
            />
          </label>
          <div className="simprok-detail-form__split">
            <label>
              <span>Sebelum</span>
              <input value={changeDraft.before} onChange={(event) => setChangeDraft((current) => ({ ...current, before: event.target.value }))} />
            </label>
            <label>
              <span>Sesudah</span>
              <input value={changeDraft.after} onChange={(event) => setChangeDraft((current) => ({ ...current, after: event.target.value }))} />
            </label>
          </div>
          <label>
            <span>Lampiran / catatan</span>
            <input
              value={changeDraft.attachmentNote}
              onChange={(event) => setChangeDraft((current) => ({ ...current, attachmentNote: event.target.value }))}
              placeholder="Catatan lampiran. Upload resmi belum aktif."
            />
          </label>
          <label>
            <span>Pihak reviewer / approver</span>
            <input
              value={changeDraft.reviewer}
              onChange={(event) => setChangeDraft((current) => ({ ...current, reviewer: event.target.value }))}
              placeholder="Akan mengikuti RBAC setelah tersambung."
            />
          </label>
        </div>
        <div className="simprok-detail-drawer__actions">
          <button type="button" className="simprok-detail-button simprok-detail-button--secondary" onClick={() => setChangeDrawerOpen(false)}>
            Simpan Draft Perubahan
          </button>
          <button type="button" className="simprok-detail-button simprok-detail-button--plain" onClick={() => setChangeDrawerOpen(false)}>
            Tutup
          </button>
        </div>
      </Drawer>

      <Drawer title={previewDoc || 'Preview Dokumen'} open={previewDoc !== null} onClose={() => setPreviewDoc(null)}>
        <DataList
          rows={[
            { label: 'Jenis', value: previewDoc || '-' },
            { label: 'Mode', value: 'Preview baca cepat dari Detail Proyek.' },
            { label: 'Status Engine', value: 'Menunggu mesin.' },
            {
              label: 'Keterangan',
              value:
                'Dokumen ini hidup di Ruang RAB. Untuk mengedit, buka Ruang RAB dan gunakan akses sesuai kewenangan.',
            },
          ]}
        />
        <div className="simprok-detail-drawer__actions">
          <button type="button" className="simprok-detail-button simprok-detail-button--primary" onClick={openRabRoom}>
            Buka Ruang RAB
          </button>
          <button type="button" className="simprok-detail-button simprok-detail-button--plain" onClick={() => setPreviewDoc(null)}>
            Tutup
          </button>
        </div>
      </Drawer>
    </main>
  );
}

export default ProjectDetailDoorPage;
