import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, MessageSquare, Search, SlidersHorizontal, Trash2 } from 'lucide-react';
import { getProjectNoteSummary } from '../projectNotes';

import { apiFetch } from '../utils/apiClient';

type RabStatus = 'draft' | 'terkunci' | 'approved' | 'berjalan' | 'selesai';
type UserInvolvement = 'ditugaskan';

interface ProjectItem {
  id: string;
  nama: string;
  status: RabStatus;
  involvement: UserInvolvement;
  nilai: string;
  keterangan: string;
  progress?: number;
}

function mapProjectToItem(backendProject: Record<string, unknown>): ProjectItem {
  let mappedStatus: RabStatus = 'draft';
  if (backendProject.status === 'ACTIVE') mappedStatus = 'berjalan';
  else if (backendProject.status === 'COMPLETED') mappedStatus = 'selesai';
  else if (backendProject.status === 'ON_HOLD') mappedStatus = 'terkunci';
  else if (backendProject.status === 'PLANNED') mappedStatus = 'draft';

  const budget = backendProject.budgetBaseline 
    ? new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(Number(backendProject.budgetBaseline))
    : 'Belum tersedia';

  return {
    id: String(backendProject.id),
    nama: (backendProject.name as string) || 'Proyek Tanpa Nama',
    status: mappedStatus,
    involvement: 'ditugaskan',
    nilai: budget,
    keterangan: (backendProject.description as string) || 'Belum ada keterangan',
    progress: mappedStatus === 'berjalan' ? 0 : undefined,
  };
}

const statusLabel: Record<RabStatus, string> = {
  draft: 'Draft',
  terkunci: 'Terkunci',
  approved: 'Approved',
  berjalan: 'Berjalan',
  selesai: 'Selesai',
};

const rabStatusOptions: { value: RabStatus | 'semua'; label: string }[] = [
  { value: 'semua', label: 'Semua' },
  { value: 'draft', label: 'Draft' },
  { value: 'terkunci', label: 'Terkunci' },
  { value: 'approved', label: 'Approved' },
  { value: 'berjalan', label: 'Berjalan' },
  { value: 'selesai', label: 'Selesai' },
];

const involvementOptions: { value: UserInvolvement | 'semua'; label: string }[] = [
  { value: 'semua', label: 'Semua' },
  { value: 'ditugaskan', label: 'Ditugaskan ke Saya' },
];

const buildRabPath = (id: string) => `/project/${id}/rab`;
const buildDetailPath = (id: string) => `/project/${id}/detail`;
const buildNotesPath = (id: string) => `/project/${id}/catatan`;
const buildContinueDraftPath = (id: string) => `/project/${id}/rab/workspace`;
const buildUnlockPath = (id: string) => buildRabPath(id);

interface ProjectCardAction {
  label: string;
  path?: string;
  disabledReason?: string;
}

export function ProjectListPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<RabStatus | 'semua'>('semua');
  const [involvementFilter, setInvolvementFilter] = useState<UserInvolvement | 'semua'>('semua');

  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    async function loadProjects() {
      try {
        setLoading(true);
        setError(null);
        const response = await apiFetch('/projects/mine');
        if (!response.ok) {
          throw new Error(`GET /projects/mine failed with ${response.status}`);
        }

        const data: unknown = await response.json();
        let projectRows: unknown[] = [];
        if (Array.isArray(data)) {
          projectRows = data;
        } else if (data && typeof data === 'object' && Array.isArray((data as { data?: unknown }).data)) {
          projectRows = (data as { data: unknown[] }).data;
        } else if (data && typeof data === 'object' && Array.isArray((data as { projects?: unknown }).projects)) {
          projectRows = (data as { projects: unknown[] }).projects;
        }

        if (projectRows.length > 0) {
          setProjects(projectRows.map((project) => mapProjectToItem(project as Record<string, unknown>)));
        } else {
          setProjects([]);
        }
      } catch {
        setError('Daftar proyek belum dapat dimuat.');
      } finally {
        setLoading(false);
      }
    }
    
    loadProjects();
  }, [retryCount]);

  const filteredProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return projects.filter((project) => {
      const matchQuery =
        normalizedQuery.length === 0 ||
        project.nama.toLowerCase().includes(normalizedQuery);
      const matchStatus = statusFilter === 'semua' || project.status === statusFilter;
      const matchInvolvement =
        involvementFilter === 'semua' || project.involvement === involvementFilter;

      return matchQuery && matchStatus && matchInvolvement;
    });
  }, [projects, query, statusFilter, involvementFilter]);

  const openRab = (id: string) => {
    navigate(buildRabPath(id));
  };

  const openDetail = (id: string) => {
    navigate(buildDetailPath(id));
  };

  const openNotes = (id: string) => {
    navigate(buildNotesPath(id));
  };

  const resetFilters = () => {
    setQuery('');
    setStatusFilter('semua');
    setInvolvementFilter('semua');
  };

  const primaryAction = (project: ProjectItem): ProjectCardAction => {
    switch (project.status) {
      case 'draft':
        return {
          label: 'Lanjutkan Draft',
          path: buildContinueDraftPath(project.id),
        };
      case 'terkunci':
        return {
          label: 'Buka Kunci',
          path: buildUnlockPath(project.id),
        };
      case 'approved':
        return {
          label: 'Monitoring HOLD',
          disabledReason: 'Monitoring belum aktif pada slice ini.',
        };
      case 'berjalan':
        return {
          label: 'Progress HOLD',
          disabledReason: 'Monitoring progress belum aktif pada slice ini.',
        };
      case 'selesai':
      default:
        return {
          label: 'Lihat Arsip',
          path: buildDetailPath(project.id),
        };
    }
  };

  return (
    <div className="simprok-projects">
      <header className="simprok-projects__header">
        <h1>Proyek Saya</h1>

        <div className="simprok-projects__controls">
          <div className="simprok-projects__search">
            <Search size={16} aria-hidden="true" />
            <input
              type="text"
              placeholder="Cari proyek..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Cari proyek"
            />
          </div>

          <select
            className="simprok-projects__filter"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as RabStatus | 'semua')}
            aria-label="Filter Status RAB"
          >
            {rabStatusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            className="simprok-projects__filter"
            value={involvementFilter}
            onChange={(event) =>
              setInvolvementFilter(event.target.value as UserInvolvement | 'semua')
            }
            aria-label="Filter Keterlibatan Saya"
          >
            {involvementOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <button
            className="simprok-projects__sort"
            type="button"
            aria-label="Urutkan - belum aktif"
            title="Urutkan belum aktif"
            disabled
          >
            <SlidersHorizontal size={16} aria-hidden="true" />
          </button>
        </div>
      </header>

      {loading ? (
        <div className="simprok-projects__empty">
          <p>Memuat daftar proyek...</p>
        </div>
      ) : error ? (
        <div className="simprok-projects__empty">
          <p>{error}</p>
          <button
            className="simprok-projects__empty-reset"
            type="button"
            onClick={() => setRetryCount((c) => c + 1)}
          >
            Coba lagi
          </button>
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="simprok-projects__empty">
          <p>{projects.length === 0 ? 'Belum ada proyek yang ditugaskan kepada Anda.' : 'Tidak ada proyek dengan kriteria ini.'}</p>
          {projects.length > 0 && (
            <button
              className="simprok-projects__empty-reset"
              type="button"
              onClick={resetFilters}
            >
              Reset pencarian
            </button>
          )}
        </div>
      ) : (
        <div className="simprok-projects__grid">
          {filteredProjects.map((project) => {
            const action = primaryAction(project);
            const noteSummary = getProjectNoteSummary(project.id);

            return (
              <article
                key={project.id}
                className={`simprok-project-card simprok-project-card--${project.status}`}
                onClick={() => openRab(project.id)}
              >
                <div className="simprok-project-card__top">
                  <h2 className="simprok-project-card__name">
                    <button
                      type="button"
                      className="simprok-project-card__name-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openRab(project.id);
                      }}
                    >
                      {project.nama}
                    </button>
                  </h2>

                  <span className={`simprok-project-chip simprok-project-chip--${project.status}`}>
                    {statusLabel[project.status]}
                  </span>
                </div>

                <p className="simprok-project-card__value">{project.nilai}</p>
                <p className="simprok-project-card__ket">{project.keterangan}</p>

                {project.status === 'berjalan' && typeof project.progress === 'number' ? (
                  <div
                    className="simprok-project-card__progress"
                    role="progressbar"
                    aria-label={`Progress ${project.progress}%`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={project.progress}
                  >
                    <span style={{ width: `${project.progress}%` }} />
                  </div>
                ) : null}

                <div
                  className="simprok-project-card__actions"
                  onClick={(event) => event.stopPropagation()}
                >
                  <button
                    className="simprok-project-card__primary"
                    type="button"
                    onClick={() => {
                      if (action.path) navigate(action.path);
                    }}
                    disabled={!action.path}
                    title={action.disabledReason}
                    aria-label={action.disabledReason ? `${action.label} - ${action.disabledReason}` : action.label}
                  >
                    {action.label}
                  </button>

                  {project.status === 'draft' ? (
                    <button
                      className="simprok-project-card__danger"
                      type="button"
                      aria-label="Hapus draft - belum aktif"
                      title="Hapus draft belum aktif"
                      disabled
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  ) : null}

                  <div className="simprok-project-card__right-door">
                    <button
                      className={`simprok-project-card__notes${noteSummary.jumlah === 0 ? ' simprok-project-card__notes--empty' : ''}${noteSummary.titikMerah ? ' simprok-project-card__notes--new' : ''}`}
                      type="button"
                      aria-label={`${noteSummary.jumlah} catatan proyek`}
                      onClick={() => openNotes(project.id)}
                    >
                      <MessageSquare size={15} aria-hidden="true" />
                      <span>{noteSummary.jumlah}</span>
                    </button>
                    <button
                      className="simprok-project-card__detail"
                      type="button"
                      onClick={() => openDetail(project.id)}
                    >
                      Lihat Detail
                      <ArrowRight size={14} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ProjectListPage;
