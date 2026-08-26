/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch } from '../../utils/apiClient';

type PreviewKind = 'TIME' | 'WEIGHT';

type PreviewTarget = {
  projectId: string;
  projectName: string;
  kind: PreviewKind;
  anchor: {
    top: number;
    left: number;
    width: number;
  };
} | null;

const EXECUTION_STATUSES = [
  'ACTIVE',
  'ON_HOLD',
  'COMPLETED',
  'CANCELLED',
] as const;

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Berjalan',
  ON_HOLD: 'Pending',
  COMPLETED: 'Selesai',
  CANCELLED: 'Dihentikan',
};

const COLORS = {
  background: '#f8fbff',
  surface: '#ffffff',
  navy: '#0f2450',
  muted: '#617293',
  border: '#dbe6f5',
  borderSoft: '#e9eff7',
  primary: '#1da1f2',
  primaryHover: '#0f8fe6',
  green: '#16a05d',
  orange: '#ff7a00',
  red: '#ff2d35',
};

const DASH = '\u2014';
const PAGE_SIZE = 5;

function readYear(
  value: unknown,
): string | null {
  if (
    typeof value !== 'string' ||
    value.trim() === ''
  ) {
    return null;
  }

  const isoYear =
    /^(\d{4})-/.exec(value);

  if (isoYear) {
    return isoYear[1];
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return null;
  }

  return String(
    date.getFullYear(),
  );
}

function executionYear(
  project: any,
): string | null {
  const startYear =
    readYear(
      project?.startDate,
    );

  if (!startYear) {
    return null;
  }

  const endYear =
    readYear(
      project?.endDate,
    );

  if (
    endYear &&
    endYear !== startYear
  ) {
    return `${startYear}\u2013${endYear}`;
  }

  return startYear;
}

function executionYearFilterValue(
  project: any,
): string | null {
  return readYear(
    project?.startDate,
  );
}

function isExecutionProject(
  project: any,
): boolean {
  return EXECUTION_STATUSES.includes(
    project?.status as
      (typeof EXECUTION_STATUSES)[number],
  );
}

function statusLabel(
  status: unknown,
): string {
  if (
    typeof status !== 'string'
  ) {
    return DASH;
  }

  return (
    STATUS_LABELS[status] ||
    DASH
  );
}

function statusColor(
  status: unknown,
): string {
  switch (status) {
    case 'ACTIVE':
      return COLORS.green;

    case 'ON_HOLD':
      return COLORS.orange;

    case 'COMPLETED':
      return COLORS.primary;

    case 'CANCELLED':
      return COLORS.red;

    default:
      return COLORS.muted;
  }
}

function factualText(
  value: unknown,
): string {
  return (
    typeof value === 'string' &&
    value.trim() !== ''
  )
    ? value.trim()
    : DASH;
}

export function FieldTerminalPage() {
  const [projects, setProjects] =
    useState<any[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState<string | null>(null);

  const [search, setSearch] =
    useState('');

  const [
    locationFilter,
    setLocationFilter,
  ] =
    useState('');

  const [
    yearFilter,
    setYearFilter,
  ] =
    useState('');

  const [
    statusFilter,
    setStatusFilter,
  ] =
    useState('');

  const [page, setPage] =
    useState(1);

  const [preview, setPreview] =
    useState<PreviewTarget>(null);

  const [
    previewData,
    setPreviewData,
  ] =
    useState<any>(null);

  const [
    previewLoading,
    setPreviewLoading,
  ] =
    useState(false);

  const [
    previewError,
    setPreviewError,
  ] =
    useState<string | null>(null);

  const {
    token,
    activeWorkspaceId,
  } =
    useAuth();

  const navigate =
    useNavigate();

  useEffect(() => {
    if (
      !token ||
      !activeWorkspaceId
    ) {
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);

    apiFetch('/projects/mine')
      .then((res) => {
        if (!res.ok) {
          const status =
            res.status;

          let msg =
            'Data gagal dimuat. Coba lagi beberapa saat.';

          if (status === 401) {
            msg =
              'Sesi Anda telah berakhir atau tidak valid. Silakan login kembali.';
          } else if (
            status === 403
          ) {
            msg =
              'Anda tidak memiliki akses untuk membuka data ini.';
          } else if (
            status === 400
          ) {
            msg =
              'Konteks workspace atau permintaan belum valid. Pilih workspace kembali.';
          } else if (
            status === 404
          ) {
            msg =
              'Data tidak ditemukan.';
          }

          throw new Error(msg);
        }

        return res.json();
      })
      .then((data) => {
        setProjects(
          Array.isArray(data)
            ? data
            : [],
        );

        setLoading(false);
      })
      .catch((err) => {
        console.error(
          'Failed to fetch projects:',
          err,
        );

        setError(
          err.message ||
            'Data gagal dimuat. Coba lagi beberapa saat.',
        );

        setProjects([]);
        setLoading(false);
      });
  }, [
    token,
    activeWorkspaceId,
  ]);

  useEffect(() => {
    if (
      !token ||
      !preview
    ) {
      return;
    }

    let active =
      true;

    apiFetch(
      `/projects/${preview.projectId}/progress/monitoring`,
    )
      .then((res) => {
        if (!res.ok) {
          throw new Error(
            'Preview monitoring belum dapat dimuat.',
          );
        }

        return res.json();
      })
      .then((data) => {
        if (!active) {
          return;
        }

        setPreviewData(data);
        setPreviewLoading(false);
      })
      .catch((err) => {
        if (!active) {
          return;
        }

        setPreviewError(
          err instanceof Error
            ? err.message
            : 'Preview monitoring belum dapat dimuat.',
        );

        setPreviewLoading(false);
      });

    return () => {
      active = false;
    };
  }, [
    token,
    preview,
  ]);

  const executionProjects =
    useMemo(
      () =>
        projects.filter(
          isExecutionProject,
        ),
      [projects],
    );

  const locations =
    useMemo(() => {
      return Array.from(
        new Set(
          executionProjects
            .map((project) =>
              typeof project?.location ===
              'string'
                ? project.location.trim()
                : '',
            )
            .filter(Boolean),
        ),
      ).sort(
        (a, b) =>
          a.localeCompare(b),
      );
    }, [
      executionProjects,
    ]);

  const years =
    useMemo(() => {
      return Array.from(
        new Set(
          executionProjects
            .map((project) =>
              executionYearFilterValue(
                project,
              ),
            )
            .filter(
              (
                year,
              ): year is string =>
                Boolean(year),
            ),
        ),
      ).sort(
        (a, b) =>
          b.localeCompare(a),
      );
    }, [
      executionProjects,
    ]);

  const filteredProjects =
    useMemo(() => {
      const query =
        search
          .trim()
          .toLowerCase();

      return executionProjects.filter(
        (project) => {
          const matchesSearch =
            !query ||
            String(
              project?.name || '',
            )
              .toLowerCase()
              .includes(query) ||
            String(
              project?.code || '',
            )
              .toLowerCase()
              .includes(query);

          const matchesLocation =
            !locationFilter ||
            project?.location ===
              locationFilter;

          const matchesYear =
            !yearFilter ||
            executionYearFilterValue(
              project,
            ) === yearFilter;

          const matchesStatus =
            !statusFilter ||
            project?.status ===
              statusFilter;

          return (
            matchesSearch &&
            matchesLocation &&
            matchesYear &&
            matchesStatus
          );
        },
      );
    }, [
      executionProjects,
      search,
      locationFilter,
      yearFilter,
      statusFilter,
    ]);

  const pageCount =
    Math.max(
      1,
      Math.ceil(
        filteredProjects.length /
          PAGE_SIZE,
      ),
    );

  const safePage =
    Math.min(
      page,
      pageCount,
    );

  const pageProjects =
    useMemo(() => {
      const start =
        (safePage - 1) *
        PAGE_SIZE;

      return filteredProjects.slice(
        start,
        start + PAGE_SIZE,
      );
    }, [
      filteredProjects,
      safePage,
    ]);

  const resetFilters = () => {
    setSearch('');
    setLocationFilter('');
    setYearFilter('');
    setStatusFilter('');
    setPage(1);
  };

  const openPreview = (
    project: any,
    kind: PreviewKind,
    target: HTMLElement,
  ) => {
    const rect =
      target.getBoundingClientRect();

    const viewportWidth =
      window.innerWidth;

    const viewportHeight =
      window.innerHeight;

    const width =
      Math.min(
        360,
        viewportWidth - 24,
      );

    const left =
      Math.min(
        Math.max(
          12,
          rect.left,
        ),
        Math.max(
          12,
          viewportWidth -
            width -
            12,
        ),
      );

    const top =
      viewportHeight -
        rect.bottom >=
      270
        ? rect.bottom + 8
        : Math.max(
            12,
            rect.top - 252,
          );

    setPreviewData(null);
    setPreviewError(null);
    setPreviewLoading(true);

    setPreview({
      projectId:
        project.id,

      projectName:
        project.name,

      kind,

      anchor: {
        top,
        left,
        width,
      },
    });
  };

  const closePreview = () => {
    setPreview(null);
    setPreviewData(null);
    setPreviewError(null);
    setPreviewLoading(false);
  };

  const previewUnavailable =
    Array.isArray(
      previewData?.unavailable,
    )
      ? previewData.unavailable
      : [];

  const previewBaseline =
    previewData?.baseline
      ?.versionNumber ??
    null;

  const timeUnavailable =
    previewUnavailable.includes(
      'plannedStart',
    ) ||
    previewUnavailable.includes(
      'plannedFinish',
    ) ||
    previewUnavailable.includes(
      'plannedDuration',
    );

  const weightUnavailable =
    previewUnavailable.includes(
      'plannedWeight',
    );

  const firstVisible =
    filteredProjects.length ===
    0
      ? 0
      : (safePage - 1) *
          PAGE_SIZE +
        1;

  const lastVisible =
    Math.min(
      safePage * PAGE_SIZE,
      filteredProjects.length,
    );

  const filtersActive =
    Boolean(
      search ||
        locationFilter ||
        yearFilter ||
        statusFilter,
    );

  return (
    <div
      style={{
        width: '100%',
        maxWidth: '1440px',
        margin: '0 auto',
        color: COLORS.navy,
      }}
    >
      <section
        aria-label="Filter Monitoring"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '12px',
          alignItems: 'flex-end',
          padding: '16px',
          marginBottom: '18px',
          background:
            COLORS.surface,
          border:
            `1px solid ${COLORS.border}`,
          borderRadius:
            '12px',
        }}
      >
        <label
          style={{
            display: 'grid',
            gap: '6px',
            flex: '2 1 280px',
            minWidth: 0,
          }}
        >
          <span
            style={{
              color:
                COLORS.muted,
              fontSize:
                '12px',
              fontWeight:
                700,
            }}
          >
            Pencarian
          </span>

          <span
            style={{
              display:
                'flex',
              alignItems:
                'center',
              gap: '8px',
              minHeight:
                '42px',
              padding:
                '0 12px',
              background:
                COLORS.surface,
              border:
                `1px solid ${COLORS.border}`,
              borderRadius:
                '9px',
            }}
          >
            <Search
              size={16}
              color={
                COLORS.muted
              }
              aria-hidden="true"
            />

            <input
              type="search"
              value={search}
              onChange={(
                event,
              ) => {
                setSearch(
                  event.target
                    .value,
                );

                setPage(1);
              }}
              placeholder="Cari proyek / kode proyek"
              aria-label="Cari proyek atau kode proyek"
              style={{
                width:
                  '100%',
                minWidth:
                  0,
                border:
                  0,
                outline:
                  0,
                background:
                  'transparent',
                color:
                  COLORS.navy,
                fontSize:
                  '14px',
              }}
            />
          </span>
        </label>

        <label
          style={{
            display: 'grid',
            gap: '6px',
            flex: '1 1 170px',
          }}
        >
          <span
            style={{
              color:
                COLORS.muted,
              fontSize:
                '12px',
              fontWeight:
                700,
            }}
          >
            Lokasi
          </span>

          <select
            value={
              locationFilter
            }
            onChange={(
              event,
            ) => {
              setLocationFilter(
                event.target
                  .value,
              );

              setPage(1);
            }}
            aria-label="Filter Lokasi"
            style={{
              minHeight:
                '42px',
              border:
                `1px solid ${COLORS.border}`,
              borderRadius:
                '9px',
              padding:
                '0 11px',
              background:
                COLORS.surface,
              color:
                COLORS.navy,
              fontSize:
                '14px',
            }}
          >
            <option value="">
              Semua Lokasi
            </option>

            {locations.map(
              (location) => (
                <option
                  key={
                    location
                  }
                  value={
                    location
                  }
                >
                  {location}
                </option>
              ),
            )}
          </select>
        </label>

        <label
          style={{
            display: 'grid',
            gap: '6px',
            flex: '0.8 1 145px',
          }}
        >
          <span
            style={{
              color:
                COLORS.muted,
              fontSize:
                '12px',
              fontWeight:
                700,
            }}
          >
            Tahun
          </span>

          <select
            value={yearFilter}
            onChange={(
              event,
            ) => {
              setYearFilter(
                event.target
                  .value,
              );

              setPage(1);
            }}
            aria-label="Filter Tahun"
            style={{
              minHeight:
                '42px',
              border:
                `1px solid ${COLORS.border}`,
              borderRadius:
                '9px',
              padding:
                '0 11px',
              background:
                COLORS.surface,
              color:
                COLORS.navy,
              fontSize:
                '14px',
            }}
          >
            <option value="">
              Semua Tahun
            </option>

            {years.map(
              (year) => (
                <option
                  key={year}
                  value={year}
                >
                  {year}
                </option>
              ),
            )}
          </select>
        </label>

        <label
          style={{
            display: 'grid',
            gap: '6px',
            flex: '0.9 1 160px',
          }}
        >
          <span
            style={{
              color:
                COLORS.muted,
              fontSize:
                '12px',
              fontWeight:
                700,
            }}
          >
            Status
          </span>

          <select
            value={
              statusFilter
            }
            onChange={(
              event,
            ) => {
              setStatusFilter(
                event.target
                  .value,
              );

              setPage(1);
            }}
            aria-label="Filter Status"
            style={{
              minHeight:
                '42px',
              border:
                `1px solid ${COLORS.border}`,
              borderRadius:
                '9px',
              padding:
                '0 11px',
              background:
                COLORS.surface,
              color:
                COLORS.navy,
              fontSize:
                '14px',
            }}
          >
            <option value="">
              Semua Status
            </option>

            {EXECUTION_STATUSES.map(
              (status) => (
                <option
                  key={status}
                  value={status}
                >
                  {statusLabel(
                    status,
                  )}
                </option>
              ),
            )}
          </select>
        </label>

        <button
          type="button"
          onClick={
            resetFilters
          }
          disabled={
            !filtersActive
          }
          style={{
            minHeight:
              '42px',
            padding:
              '0 15px',
            border:
              `1px solid ${COLORS.border}`,
            borderRadius:
              '9px',
            background:
              COLORS.surface,
            color:
              COLORS.primary,
            cursor:
              filtersActive
                ? 'pointer'
                : 'default',
            fontWeight:
              700,
            opacity:
              filtersActive
                ? 1
                : 0.5,
          }}
        >
          Reset
        </button>
      </section>

      {loading ? (
        <div
          style={{
            padding:
              '22px',
            color:
              COLORS.muted,
            background:
              COLORS.surface,
            border:
              `1px solid ${COLORS.border}`,
            borderRadius:
              '12px',
          }}
        >
          Memuat daftar proyek...
        </div>
      ) : error ? (
        <div
          style={{
            padding:
              '22px',
            color:
              COLORS.red,
            background:
              COLORS.surface,
            border:
              `1px solid ${COLORS.border}`,
            borderRadius:
              '12px',
          }}
        >
          {error}
        </div>
      ) : executionProjects.length ===
        0 ? (
        <div
          style={{
            padding:
              '22px',
            color:
              COLORS.muted,
            background:
              COLORS.surface,
            border:
              `1px solid ${COLORS.border}`,
            borderRadius:
              '12px',
          }}
        >
          Belum ada proyek pelaksanaan yang dapat dimonitor.
        </div>
      ) : filteredProjects.length ===
        0 ? (
        <div
          style={{
            padding:
              '22px',
            color:
              COLORS.muted,
            background:
              COLORS.surface,
            border:
              `1px solid ${COLORS.border}`,
            borderRadius:
              '12px',
          }}
        >
          Tidak ada proyek yang sesuai dengan filter.
        </div>
      ) : (
        <section
          aria-label="Daftar proyek Monitoring"
          style={{
            background:
              COLORS.surface,
            border:
              `1px solid ${COLORS.border}`,
            borderRadius:
              '12px',
            overflow:
              'hidden',
          }}
        >
          <div
            style={{
              overflowX:
                'auto',
            }}
          >
            <table
              style={{
                width:
                  '100%',
                minWidth:
                  '1080px',
                borderCollapse:
                  'collapse',
              }}
            >
              <thead>
                <tr
                  style={{
                    background:
                      COLORS.background,
                    color:
                      COLORS.muted,
                    textAlign:
                      'left',
                  }}
                >
                  {[
                    'Proyek',
                    'Nilai Proyek',
                    'Status',
                    'Realisasi',
                    'Update Terakhir',
                    'Aksi',
                  ].map(
                    (label) => (
                      <th
                        key={
                          label
                        }
                        style={{
                          padding:
                            '13px 16px',
                          borderBottom:
                            `1px solid ${COLORS.border}`,
                          fontSize:
                            '12px',
                          fontWeight:
                            800,
                          letterSpacing:
                            '0.02em',
                          whiteSpace:
                            'nowrap',
                        }}
                      >
                        {label}
                      </th>
                    ),
                  )}
                </tr>
              </thead>

              <tbody>
                {pageProjects.map(
                  (project) => {
                    const year =
                      executionYear(
                        project,
                      ) ||
                      DASH;

                    const organization =
                      factualText(
                        project
                          ?.organizationName,
                      );

                    const location =
                      factualText(
                        project
                          ?.location,
                      );

                    const currentStatusColor =
                      statusColor(
                        project
                          ?.status,
                      );

                    return (
                      <tr
                        key={
                          project.id
                        }
                        style={{
                          borderBottom:
                            `1px solid ${COLORS.borderSoft}`,
                        }}
                      >
                        <td
                          style={{
                            padding:
                              '16px',
                            verticalAlign:
                              'top',
                            minWidth:
                              '370px',
                          }}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              navigate(
                                `/field/project/${project.id}`,
                              )
                            }
                            style={{
                              border:
                                0,
                              background:
                                'transparent',
                              padding:
                                0,
                              margin:
                                0,
                              cursor:
                                'pointer',
                              color:
                                COLORS.navy,
                              fontSize:
                                '15px',
                              fontWeight:
                                800,
                              textAlign:
                                'left',
                            }}
                          >
                            {
                              project.name
                            }
                          </button>

                          <div
                            style={{
                              display:
                                'grid',
                              gridTemplateColumns:
                                'fit-content(42%) minmax(0, 1fr)',
                              columnGap:
                                '16px',
                              rowGap:
                                '2px',
                              alignItems:
                                'start',
                              marginTop:
                                '6px',
                              color:
                                COLORS.muted,
                              fontSize:
                                '12px',
                              lineHeight:
                                1.3,
                              minWidth:
                                0,
                            }}
                          >
                            <span
                              style={{
                                gridColumn:
                                  '1',
                                gridRow:
                                  '1',
                                minWidth:
                                  0,
                                textAlign:
                                  'left',
                                whiteSpace:
                                  'normal',
                                overflowWrap:
                                  'anywhere',
                              }}
                            >
                              Kode:{' '}
                              {
                                project.code
                              }
                            </span>

                            <span
                              style={{
                                display:
                                  'grid',
                                gridTemplateColumns:
                                  'max-content minmax(0, 1fr)',
                                columnGap:
                                  '4px',
                                gridColumn:
                                  '2',
                                gridRow:
                                  '1',
                                minWidth:
                                  0,
                                textAlign:
                                  'left',
                              }}
                            >
                              <span
                                style={{
                                  whiteSpace:
                                    'nowrap',
                                }}
                              >
                                Satker:
                              </span>

                              <span
                                style={{
                                  minWidth:
                                    0,
                                  whiteSpace:
                                    'normal',
                                  overflowWrap:
                                    'anywhere',
                                  textAlign:
                                    'left',
                                }}
                              >
                                {
                                  organization
                                }
                              </span>
                            </span>

                            <span
                              style={{
                                display:
                                  'grid',
                                gridTemplateColumns:
                                  'max-content minmax(0, 1fr)',
                                columnGap:
                                  '4px',
                                gridColumn:
                                  '1',
                                gridRow:
                                  '2',
                                minWidth:
                                  0,
                                textAlign:
                                  'left',
                              }}
                            >
                              <span
                                style={{
                                  whiteSpace:
                                    'nowrap',
                                }}
                              >
                                Lokasi:
                              </span>

                              <span
                                style={{
                                  minWidth:
                                    0,
                                  whiteSpace:
                                    'normal',
                                  overflowWrap:
                                    'anywhere',
                                  textAlign:
                                    'left',
                                }}
                              >
                                {
                                  location
                                }
                              </span>
                            </span>

                            <span
                              style={{
                                gridColumn:
                                  '2',
                                gridRow:
                                  '2',
                                minWidth:
                                  0,
                                textAlign:
                                  'left',
                                whiteSpace:
                                  'normal',
                                overflowWrap:
                                  'anywhere',
                              }}
                            >
                              Tahun:{' '}
                              {
                                year
                              }
                            </span>
                          </div>
                        </td>

                        <td
                          style={{
                            padding:
                              '16px',
                            verticalAlign:
                              'top',
                            color:
                              COLORS.navy,
                            whiteSpace:
                              'nowrap',
                            fontWeight:
                              700,
                          }}
                          title="Nilai proyek belum tersedia sebagai fakta kontrak Page-1 yang terbukti."
                        >
                          {DASH}
                        </td>

                        <td
                          style={{
                            padding:
                              '16px',
                            verticalAlign:
                              'top',
                            position:
                              'relative',
                          }}
                        >
                          <button
                            type="button"
                            onClick={(
                              event,
                            ) =>
                              openPreview(
                                project,
                                'TIME',
                                event.currentTarget,
                              )
                            }
                            aria-haspopup="dialog"
                            title="Buka Preview Waktu"
                            style={{
                              display:
                                'inline-flex',
                              alignItems:
                                'center',
                              gap:
                                '7px',
                              border:
                                0,
                              padding:
                                0,
                              background:
                                'transparent',
                              color:
                                COLORS.navy,
                              cursor:
                                'pointer',
                              fontSize:
                                '13px',
                              fontWeight:
                                750,
                              whiteSpace:
                                'nowrap',
                            }}
                          >
                            <span
                              aria-hidden="true"
                              style={{
                                width:
                                  '8px',
                                height:
                                  '8px',
                                flex:
                                  '0 0 auto',
                                borderRadius:
                                  '999px',
                                background:
                                  currentStatusColor,
                              }}
                            />

                            {statusLabel(
                              project.status,
                            )}

                            <ChevronDown
                              size={13}
                              color={
                                COLORS.muted
                              }
                              aria-hidden="true"
                            />
                          </button>
                        </td>

                        <td
                          style={{
                            padding:
                              '16px',
                            verticalAlign:
                              'top',
                            position:
                              'relative',
                          }}
                        >
                          <button
                            type="button"
                            onClick={(
                              event,
                            ) =>
                              openPreview(
                                project,
                                'WEIGHT',
                                event.currentTarget,
                              )
                            }
                            aria-haspopup="dialog"
                            title="Buka Preview Bobot"
                            style={{
                              display:
                                'inline-flex',
                              alignItems:
                                'center',
                              gap:
                                '5px',
                              border:
                                0,
                              padding:
                                0,
                              background:
                                'transparent',
                              color:
                                COLORS.muted,
                              cursor:
                                'pointer',
                              fontSize:
                                '13px',
                              fontWeight:
                                750,
                              whiteSpace:
                                'nowrap',
                            }}
                          >
                            {DASH}

                            <ChevronDown
                              size={13}
                              color={
                                COLORS.muted
                              }
                              aria-hidden="true"
                            />
                          </button>
                        </td>

                        <td
                          style={{
                            padding:
                              '16px',
                            verticalAlign:
                              'top',
                            color:
                              COLORS.muted,
                            whiteSpace:
                              'nowrap',
                          }}
                          title="Timestamp update monitoring khusus belum tersedia sebagai fakta Page-1 yang terbukti."
                        >
                          {DASH}
                        </td>

                        <td
                          style={{
                            padding:
                              '16px',
                            verticalAlign:
                              'top',
                            whiteSpace:
                              'nowrap',
                          }}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              navigate(
                                `/field/project/${project.id}`,
                              )
                            }
                            style={{
                              minHeight:
                                '34px',
                              border:
                                `1px solid ${COLORS.primary}`,
                              borderRadius:
                                '8px',
                              background:
                                COLORS.primary,
                              color:
                                COLORS.surface,
                              padding:
                                '0 12px',
                              cursor:
                                'pointer',
                              fontSize:
                                '12px',
                              fontWeight:
                                800,
                              whiteSpace:
                                'nowrap',
                            }}
                          >
                            Lihat Detail
                          </button>
                        </td>
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
          </div>

          <footer
            style={{
              display:
                'flex',
              flexWrap:
                'wrap',
              justifyContent:
                'space-between',
              alignItems:
                'center',
              gap:
                '12px',
              minHeight:
                '54px',
              padding:
                '10px 16px',
              borderTop:
                `1px solid ${COLORS.borderSoft}`,
              background:
                COLORS.surface,
              color:
                COLORS.muted,
              fontSize:
                '12px',
            }}
          >
            <span>
              {
                firstVisible
              }
              -
              {
                lastVisible
              }
              {' '}dari{' '}
              {
                filteredProjects.length
              }
              {' '}proyek
            </span>

            <div
              style={{
                display:
                  'flex',
                alignItems:
                  'center',
                gap:
                  '7px',
              }}
            >
              <button
                type="button"
                disabled={
                  safePage <= 1
                }
                onClick={() =>
                  setPage(
                    Math.max(
                      1,
                      safePage -
                        1,
                    ),
                  )
                }
                aria-label="Halaman sebelumnya"
                style={{
                  width:
                    '32px',
                  height:
                    '32px',
                  border:
                    `1px solid ${COLORS.border}`,
                  borderRadius:
                    '7px',
                  background:
                    COLORS.surface,
                  color:
                    COLORS.navy,
                  cursor:
                    safePage <=
                    1
                      ? 'default'
                      : 'pointer',
                  opacity:
                    safePage <=
                    1
                      ? 0.45
                      : 1,
                }}
              >
                {'<'}
              </button>

              <span
                style={{
                  minWidth:
                    '32px',
                  textAlign:
                    'center',
                  fontWeight:
                    800,
                  color:
                    COLORS.navy,
                }}
              >
                {safePage}
              </span>

              <button
                type="button"
                disabled={
                  safePage >=
                  pageCount
                }
                onClick={() =>
                  setPage(
                    Math.min(
                      pageCount,
                      safePage +
                        1,
                    ),
                  )
                }
                aria-label="Halaman berikutnya"
                style={{
                  width:
                    '32px',
                  height:
                    '32px',
                  border:
                    `1px solid ${COLORS.border}`,
                  borderRadius:
                    '7px',
                  background:
                    COLORS.surface,
                  color:
                    COLORS.navy,
                  cursor:
                    safePage >=
                    pageCount
                      ? 'default'
                      : 'pointer',
                  opacity:
                    safePage >=
                    pageCount
                      ? 0.45
                      : 1,
                }}
              >
                {'>'}
              </button>

              <span
                style={{
                  marginLeft:
                    '5px',
                }}
              >
                5 / halaman
              </span>
            </div>
          </footer>
        </section>
      )}

      {preview ? (
        <div
          role="dialog"
          aria-label={
            preview.kind ===
            'TIME'
              ? 'Preview Waktu'
              : 'Preview Bobot'
          }
          style={{
            position:
              'fixed',
            zIndex:
              1200,
            top:
              `${preview.anchor.top}px`,
            left:
              `${preview.anchor.left}px`,
            width:
              `${preview.anchor.width}px`,
            maxWidth:
              'calc(100vw - 24px)',
            padding:
              '15px',
            background:
              COLORS.surface,
            border:
              `1px solid ${COLORS.border}`,
            borderRadius:
              '12px',
            boxShadow:
              '0 16px 38px rgba(15, 36, 80, 0.14)',
          }}
        >
          <div
            style={{
              display:
                'flex',
              justifyContent:
                'space-between',
              gap:
                '12px',
              alignItems:
                'flex-start',
            }}
          >
            <div>
              <strong
                style={{
                  display:
                    'block',
                  color:
                    COLORS.navy,
                  fontSize:
                    '14px',
                }}
              >
                {
                  preview.kind ===
                  'TIME'
                    ? 'Preview Waktu'
                    : 'Preview Bobot'
                }
              </strong>

              <span
                style={{
                  display:
                    'block',
                  marginTop:
                    '3px',
                  color:
                    COLORS.muted,
                  fontSize:
                    '11px',
                }}
              >
                {
                  preview.projectName
                }
              </span>
            </div>

            <button
              type="button"
              onClick={
                closePreview
              }
              style={{
                border:
                  0,
                padding:
                  0,
                background:
                  'transparent',
                color:
                  COLORS.primary,
                cursor:
                  'pointer',
                fontSize:
                  '12px',
                fontWeight:
                  800,
              }}
            >
              Tutup
            </button>
          </div>

          <div
            style={{
              marginTop:
                '13px',
            }}
          >
            {previewLoading ? (
              <div
                style={{
                  color:
                    COLORS.muted,
                  fontSize:
                    '12px',
                }}
              >
                Memuat data monitoring...
              </div>
            ) : previewError ? (
              <div
                style={{
                  color:
                    COLORS.red,
                  fontSize:
                    '12px',
                }}
              >
                {
                  previewError
                }
              </div>
            ) : !previewData?.baseline ? (
              <div
                style={{
                  color:
                    COLORS.muted,
                  fontSize:
                    '12px',
                }}
              >
                Baseline aktif belum tersedia.
              </div>
            ) : (
              <>
                <div
                  style={{
                    marginBottom:
                      '10px',
                    color:
                      COLORS.muted,
                    fontSize:
                      '11px',
                  }}
                >
                  Baseline versi{' '}
                  {
                    previewBaseline
                  }
                </div>

                {preview.kind ===
                'TIME' ? (
                  <>
                    {[
                      [
                        'Tanggal Mulai',
                        DASH,
                      ],
                      [
                        'Selesai Rencana',
                        DASH,
                      ],
                      [
                        'Waktu Berlalu',
                        DASH,
                      ],
                      [
                        'Sisa Waktu',
                        DASH,
                      ],
                    ].map(
                      ([
                        label,
                        value,
                      ]) => (
                        <div
                          key={
                            label
                          }
                          style={{
                            display:
                              'flex',
                            justifyContent:
                              'space-between',
                            gap:
                              '12px',
                            padding:
                              '7px 0',
                            borderTop:
                              `1px solid ${COLORS.borderSoft}`,
                            fontSize:
                              '12px',
                          }}
                        >
                          <span
                            style={{
                              color:
                                COLORS.muted,
                            }}
                          >
                            {
                              label
                            }
                          </span>

                          <strong
                            style={{
                              color:
                                COLORS.navy,
                            }}
                          >
                            {
                              value
                            }
                          </strong>
                        </div>
                      ),
                    )}

                    <div
                      style={{
                        marginTop:
                          '9px',
                        color:
                          COLORS.muted,
                        fontSize:
                          '11px',
                        lineHeight:
                          1.5,
                      }}
                    >
                      {timeUnavailable
                        ? 'Fakta waktu rencana belum tersedia pada kontrak Monitoring saat ini.'
                        : 'Fakta waktu Page-1 belum diekspos oleh kontrak Monitoring.'}
                    </div>
                  </>
                ) : (
                  <>
                    {[
                      [
                        'Periode',
                        DASH,
                      ],
                      [
                        'Bobot Rencana',
                        DASH,
                      ],
                      [
                        'Bobot Realisasi',
                        DASH,
                      ],
                      [
                        'Deviasi',
                        DASH,
                      ],
                    ].map(
                      ([
                        label,
                        value,
                      ]) => (
                        <div
                          key={
                            label
                          }
                          style={{
                            display:
                              'flex',
                            justifyContent:
                              'space-between',
                            gap:
                              '12px',
                            padding:
                              '7px 0',
                            borderTop:
                              `1px solid ${COLORS.borderSoft}`,
                            fontSize:
                              '12px',
                          }}
                        >
                          <span
                            style={{
                              color:
                                COLORS.muted,
                            }}
                          >
                            {
                              label
                            }
                          </span>

                          <strong
                            style={{
                              color:
                                COLORS.navy,
                            }}
                          >
                            {
                              value
                            }
                          </strong>
                        </div>
                      ),
                    )}

                    <div
                      style={{
                        marginTop:
                          '9px',
                        color:
                          COLORS.muted,
                        fontSize:
                          '11px',
                        lineHeight:
                          1.5,
                      }}
                    >
                      {weightUnavailable
                        ? 'Bobot rencana belum tersedia pada kontrak Monitoring saat ini.'
                        : 'Bobot agregat Page-1 belum diekspos oleh kontrak Monitoring.'}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}