import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, MessageSquare, Search, SlidersHorizontal, Trash2 } from 'lucide-react';
import { getProjectNoteSummary } from '../projectNotes';

import { apiFetch } from '../utils/apiClient';
import {
  buildDetailPath,
  buildRabPath,
  primaryAction,
  type RabLifecycleProjection,
} from '../utils/projectCardAction';
import {
  PRESENTATION_FILTER_ORDER,
  presentationLabel,
  resolveProjectPresentationStatus,
  type ProjectPresentationStatus,
} from '../utils/rabLockDisplay';

type UserInvolvement = 'ditugaskan';

interface ProjectItem {
  id: string;
  nama: string;
  involvement: UserInvolvement;
  nilai: string;
  keterangan: string;
  rabLifecycle?: RabLifecycleProjection;
}

function mapProjectToItem(backendProject: Record<string, unknown>): ProjectItem {
  const budget = backendProject.budgetBaseline
    ? new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(Number(backendProject.budgetBaseline))
    : 'Belum tersedia';

  return {
    id: String(backendProject.id),
    nama: (backendProject.name as string) || 'Proyek Tanpa Nama',
    involvement: 'ditugaskan',
    nilai: budget,
    keterangan: (backendProject.description as string) || 'Belum ada keterangan',
    rabLifecycle: backendProject.rabLifecycle as RabLifecycleProjection | undefined,
  };
}

/**
 * The filter offers the same lifecycle the cards show, resolved by the same
 * function. It used to run over Project.status while announcing itself as a
 * RAB filter, so picking 'Terkunci' searched a field that never holds it.
 */
const presentationStatusOptions: { value: ProjectPresentationStatus | 'semua'; label: string }[] = [
  { value: 'semua', label: 'Semua' },
  ...PRESENTATION_FILTER_ORDER.map((status) => ({ value: status, label: presentationLabel(status) })),
];

const involvementOptions: { value: UserInvolvement | 'semua'; label: string }[] = [
  { value: 'semua', label: 'Semua' },
  { value: 'ditugaskan', label: 'Ditugaskan ke Saya' },
];

const buildNotesPath = (id: string) => `/project/${id}/catatan`;

export function ProjectListPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ProjectPresentationStatus | 'semua'>('semua');
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
      // Filtered by the same resolver the card badge uses, so the list and
      // the badge can never disagree about what 'Terkunci' means.
      const matchStatus =
        statusFilter === 'semua' ||
        resolveProjectPresentationStatus(project.rabLifecycle).status === statusFilter;
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
            onChange={(event) => setStatusFilter(event.target.value as ProjectPresentationStatus | 'semua')}
            aria-label="Filter Status"
          >
            {presentationStatusOptions.map((option) => (
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
            const presentation = resolveProjectPresentationStatus(project.rabLifecycle);
            const noteSummary = getProjectNoteSummary(project.id);

            return (
              // The card itself is not a door. Three controls, three
              // destinations — a whole-card click would have been a fourth
              // way into a room one of them already opens.
              <article
                key={project.id}
                className={`simprok-project-card simprok-project-card--${presentation.chipModifier}`}
                style={{ cursor: 'default' }}
              >
                <div className="simprok-project-card__top">
                  {/* Identity, not navigation. */}
                  <h2 className="simprok-project-card__name">{project.nama}</h2>

                  {/* Status, and the one door to Ruang Hidup RAB. Same chip
                      styling; only the UA button defaults are neutralised. */}
                  <button
                    type="button"
                    className={`simprok-project-chip simprok-project-chip--${presentation.chipModifier}`}
                    style={{ border: 'none', font: 'inherit', fontSize: '11px', fontWeight: 600, cursor: 'pointer', lineHeight: 1.3 }}
                    onClick={() => openRab(project.id)}
                    aria-label={`${presentation.badgeLabel} — buka Ruang Hidup RAB ${project.nama}`}
                  >
                    {presentation.badgeLabel}
                  </button>
                </div>

                <p className="simprok-project-card__value">{project.nilai}</p>
                <p className="simprok-project-card__ket">{project.keterangan}</p>

                {/* No progress bar: Monitoring is on HOLD, so the only number
                    this card could draw would be one nobody measured. */}

                <div className="simprok-project-card__actions">
                  {/* The RAB lifecycle action slot. It is permanent — each
                      stage fills it with its own next step — and it is never
                      removed just because a later capability is unbuilt. */}
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

                  {presentation.status === 'DRAFT' ? (
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
