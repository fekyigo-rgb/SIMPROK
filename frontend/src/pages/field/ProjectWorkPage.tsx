import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch } from '../../utils/apiClient';
import {
  actualStateLabel,
  buildMonitoringRows,
  captureMethodLabel,
  dataThroughLabel,
  effectiveActual,
  formatWeightPercentage,
  formatProjectBusinessDate,
  lastRecordedLabel,
  progressDetailPath,
  recordedAtLabel,
  rowWeightPresentation,
  selectedWorkItem,
  weightCompletenessExplanation,
  weightCompletenessLabel,
  type MonitoringProject,
  type MonitoringResponse,
} from '../../utils/monitoringCurrent';
import './ProjectWorkPage.css';

type ErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'workspace'
  | 'baseline-conflict'
  | 'server'
  | 'network'
  | null;

class MonitoringRequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Monitoring request failed with ${status}`);
    this.status = status;
  }
}

function errorKindForStatus(status: number): Exclude<ErrorKind, null> {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status === 400) return 'workspace';
  if (status === 409) return 'baseline-conflict';
  return 'server';
}

function actualQuantity(
  quantity: string | undefined,
  state: 'RECORDED' | 'NOT_YET_RECORDED' | 'UNAVAILABLE' | undefined,
  unit: string,
): string {
  if (state === 'UNAVAILABLE') return 'TIDAK TERSEDIA';
  return quantity === undefined ? 'BELUM DICATAT' : `${quantity} ${unit}`.trim();
}

export function ProjectWorkPage() {
  const { projectId } = useParams();
  const { token } = useAuth();
  const navigate = useNavigate();
  const [project, setProject] = useState<MonitoringProject | null>(null);
  const [monitoring, setMonitoring] = useState<MonitoringResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const [errorProjectId, setErrorProjectId] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorKind, setErrorKind] = useState<ErrorKind>(null);

  useEffect(() => {
    if (!token || !projectId) return;

    const controller = new AbortController();

    Promise.all([
      apiFetch(`/projects/${projectId}`, { signal: controller.signal }),
      apiFetch(`/projects/${projectId}/progress/monitoring`, {
        signal: controller.signal,
      }),
    ])
      .then(async ([projectResponse, monitoringResponse]) => {
        if (!projectResponse.ok) {
          throw new MonitoringRequestError(projectResponse.status);
        }
        if (!monitoringResponse.ok) {
          throw new MonitoringRequestError(monitoringResponse.status);
        }
        return Promise.all([
          projectResponse.json() as Promise<MonitoringProject>,
          monitoringResponse.json() as Promise<MonitoringResponse>,
        ]);
      })
      .then(([projectData, monitoringData]) => {
        setProject(projectData);
        setMonitoring(monitoringData);
        setSelectedId(null);
        setLoadedProjectId(projectId);
        setErrorProjectId(null);
        setErrorKind(null);
        setErrorStatus(null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (error instanceof MonitoringRequestError) {
          setErrorStatus(error.status);
          setErrorKind(errorKindForStatus(error.status));
        } else {
          console.error('Failed to fetch H2-A0 monitoring data:', error);
          setErrorKind('network');
        }
        setErrorProjectId(projectId);
        setLoadedProjectId(null);
        setProject(null);
        setMonitoring(null);
      });

    return () => controller.abort();
  }, [token, projectId]);

  const rows = useMemo(
    () => buildMonitoringRows(monitoring?.items ?? []),
    [monitoring?.items],
  );
  const selected = useMemo(
    () => selectedWorkItem(rows, selectedId),
    [rows, selectedId],
  );
  const selectedActual = effectiveActual(selected);
  const effectiveItemCount = useMemo(
    () => rows.filter((row) => effectiveActual(row) !== null).length,
    [rows],
  );
  const workItemCount = useMemo(
    () => rows.filter((row) => row.itemType === 'WORK_ITEM').length,
    [rows],
  );

  const dataThrough = monitoring
    ? dataThroughLabel(monitoring.freshness.dataThrough)
    : 'TIDAK TERSEDIA';
  const lastRecorded = monitoring
    ? lastRecordedLabel(
        monitoring.freshness.lastRecordedAt,
        monitoring.projectTimeZone,
      )
    : { value: 'TIDAK TERSEDIA', basis: '' };
  const currentErrorKind = errorProjectId === projectId ? errorKind : null;
  const loading = loadedProjectId !== projectId && currentErrorKind === null;

  let errorMessage = '';
  if (currentErrorKind === 'unauthorized') {
    errorMessage = 'Sesi Anda telah berakhir atau tidak valid. Silakan login kembali.';
  } else if (currentErrorKind === 'forbidden') {
    errorMessage = 'Anda tidak memiliki akses ke proyek ini.';
  } else if (currentErrorKind === 'not-found') {
    errorMessage = 'Proyek tidak ditemukan.';
  } else if (currentErrorKind === 'workspace') {
    errorMessage = 'Konteks workspace belum valid. Pilih workspace kembali.';
  } else if (currentErrorKind === 'baseline-conflict') {
    errorMessage =
      'Monitoring dihentikan karena proyek mempunyai lebih dari satu Baseline aktif. Data tidak dipilih secara diam-diam.';
  } else if (currentErrorKind === 'server' || currentErrorKind === 'network') {
    errorMessage = 'Data Monitoring gagal dimuat. Coba lagi beberapa saat.';
  }

  if (loading) {
    if (!token || !projectId) {
      return (
        <div className="h2a0-page">
          <section className="h2a0-error" role="alert">
            <h2>Monitoring tidak dapat dibuka (401)</h2>
            <p>Sesi Anda telah berakhir atau tidak valid. Silakan login kembali.</p>
          </section>
        </div>
      );
    }
    return <div className="h2a0-state">Memuat Monitoring terkini…</div>;
  }

  if (currentErrorKind) {
    return (
      <div className="h2a0-page">
        <button className="h2a0-back" onClick={() => navigate('/field')}>
          ← Kembali ke Daftar Proyek
        </button>
        <section className="h2a0-error" role="alert">
          <h2>Monitoring tidak dapat dibuka ({errorStatus ?? 'Network'})</h2>
          <p>{errorMessage}</p>
        </section>
      </div>
    );
  }

  if (!project || !monitoring) return null;

  const selectedRecordedAt =
    selected?.actual?.state === 'NOT_YET_RECORDED'
      ? { value: 'BELUM DICATAT', basis: '' }
      : recordedAtLabel(
          selectedActual?.recordedAt ?? null,
          monitoring.projectTimeZone,
        );

  return (
    <main className="h2a0-page">
      <button className="h2a0-back" onClick={() => navigate('/field')}>
        ← Kembali ke Daftar Proyek
      </button>

      <header className="h2a0-project-header">
        <div>
          <p className="h2a0-eyebrow">Monitoring Proyek</p>
          <h1>{project.name}</h1>
          {project.code && <p className="h2a0-project-code">{project.code}</p>}
        </div>
        <div className="h2a0-baseline-identity">
          <span>Baseline Aktif</span>
          {monitoring.baseline ? (
            <>
              <strong>Versi {monitoring.baseline.versionNumber}</strong>
              <small>
                Disetujui{' '}
                {
                  recordedAtLabel(
                    monitoring.baseline.approvedAt,
                    monitoring.projectTimeZone,
                  ).value
                }
              </small>
            </>
          ) : (
            <strong>TIDAK TERSEDIA</strong>
          )}
        </div>
      </header>

      <section className="h2a0-context-strip" aria-label="Konteks Monitoring">
        <div>
          <span>Lingkup</span>
          <strong>{selected ? `${selected.number} · ${selected.name}` : 'SELURUH PROYEK'}</strong>
        </div>
        <div>
          <span>Periode</span>
          <strong>TERKINI</strong>
        </div>
        <div>
          <span>Data pekerjaan sampai</span>
          <strong>{dataThrough}</strong>
          <small>Tanggal kerja efektif terbaru</small>
        </div>
        <div>
          <span>Terakhir diperbarui</span>
          <strong>{lastRecorded.value}</strong>
          {lastRecorded.basis && <small>{lastRecorded.basis}</small>}
        </div>
      </section>

      {!monitoring.baseline ? (
        <section className="h2a0-warning" role="status">
          <h2>Baseline aktif tidak tersedia</h2>
          <p>
            Identitas proyek tetap dapat dilihat, tetapi RAB/WBS dan data realisasi
            tidak ditampilkan tanpa Baseline aktif yang sah.
          </p>
        </section>
      ) : (
        <div className="h2a0-workspace">
          <section className="h2a0-anchor" aria-labelledby="h2a0-anchor-title">
            <div className="h2a0-section-heading">
              <div>
                <p className="h2a0-eyebrow">Orientasi stabil</p>
                <h2 id="h2a0-anchor-title">RAB/WBS Monitoring</h2>
              </div>
              <span>{workItemCount} item pekerjaan</span>
            </div>

            {rows.length === 0 ? (
              <p className="h2a0-empty">Struktur RAB/WBS belum tersedia.</p>
            ) : (
              <div className="h2a0-table-scroll">
                <table className="h2a0-table">
                  <thead>
                    <tr>
                      <th>No</th>
                      <th>Uraian Pekerjaan</th>
                      <th>Satuan</th>
                      <th>Volume BOQ</th>
                      <th
                        title="Kontribusi nilai item terhadap total nilai dasar Baseline RAB"
                      >
                        Bobot Item
                      </th>
                      <th
                        title="Komposisi kumulatif RAB sesuai urutan pekerjaan, bukan progress waktu"
                      >
                        Bobot Kumulatif
                      </th>
                      <th>Realisasi Terakhir yang Berlaku</th>
                      <th>Tanggal Pekerjaan</th>
                      <th>Status Realisasi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const actual = effectiveActual(row);
                      const isWorkItem = row.itemType === 'WORK_ITEM';
                      const isSelected = selected?.id === row.id;
                      const weightPresentation = rowWeightPresentation(row);
                      return (
                        <tr
                          key={row.id}
                          className={`${isSelected ? 'is-selected' : ''} ${
                            isWorkItem ? 'is-work-item' : 'is-structural'
                          }`}
                        >
                          <td data-label="No">{row.number || '—'}</td>
                          <td data-label="Uraian Pekerjaan">
                            {isWorkItem ? (
                              <button
                                className="h2a0-row-select"
                                onClick={() => setSelectedId(row.id)}
                                aria-pressed={isSelected}
                              >
                                <span
                                  className="h2a0-row-name"
                                  style={{ paddingInlineStart: `${row.depth * 18}px` }}
                                >
                                  {row.name}
                                </span>
                                <small>{row.wbsCode || 'Kode WBS tidak tersedia'}</small>
                              </button>
                            ) : (
                              <div
                                className="h2a0-structural-name"
                                style={{ paddingInlineStart: `${row.depth * 18}px` }}
                              >
                                <strong>{row.name}</strong>
                                <small>
                                  {row.wbsCode ||
                                    (row.itemType === 'NOTE' ? 'Catatan' : 'Struktur')}
                                </small>
                              </div>
                            )}
                          </td>
                          <td data-label="Satuan">
                            {isWorkItem ? row.planned.unit || '—' : '—'}
                          </td>
                          <td data-label="Volume BOQ">
                            {isWorkItem ? row.planned.quantity : '—'}
                          </td>
                          <td
                            data-label={
                              weightPresentation.kind === 'SECTION'
                                ? 'Bobot Bagian'
                                : 'Bobot Item'
                            }
                          >
                            <span
                              className={`h2a1-weight h2a1-weight-${weightPresentation.kind.toLowerCase()}`}
                            >
                              {weightPresentation.kind === 'SECTION' && (
                                <small>Kontribusi bagian</small>
                              )}
                              <strong>{weightPresentation.value}</strong>
                            </span>
                          </td>
                          <td data-label="Bobot Kumulatif">
                            {formatWeightPercentage(row.weight.cumulative)}
                          </td>
                          <td data-label="Realisasi Terakhir yang Berlaku">
                            {isWorkItem
                              ? actualQuantity(
                                  actual?.installedQuantity,
                                  row.actual?.state,
                                  row.planned.unit,
                                )
                              : '—'}
                          </td>
                          <td data-label="Tanggal Pekerjaan">
                            {isWorkItem
                              ? formatProjectBusinessDate(actual?.workDate ?? null) ||
                                (row.actual?.state === 'UNAVAILABLE'
                                  ? 'TIDAK TERSEDIA'
                                  : 'BELUM DICATAT')
                              : '—'}
                          </td>
                          <td data-label="Status Realisasi">
                            <span
                              className={`h2a0-status h2a0-status-${
                                isWorkItem
                                  ? row.actual?.state.toLowerCase()
                                  : 'structural'
                              }`}
                            >
                              {isWorkItem
                                ? actualStateLabel(row.actual)
                                : row.itemType === 'NOTE'
                                  ? 'CATATAN'
                                  : 'STRUKTUR'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <aside className="h2a0-current" aria-labelledby="h2a0-current-title">
            <div className="h2a0-section-heading">
              <div>
                <p className="h2a0-eyebrow">Lingkup aktif</p>
                <h2 id="h2a0-current-title">Kondisi Terkini</h2>
              </div>
            </div>

            {!selected ? (
              <div className="h2a0-project-scope">
                <span className="h2a0-scope-badge">SELURUH PROYEK</span>
                <h3>{project.name}</h3>
                <p>
                  {effectiveItemCount} dari {workItemCount} item pekerjaan mempunyai
                  catatan realisasi yang berlaku. Ini adalah hitungan ketersediaan
                  data, bukan persentase kemajuan proyek.
                </p>
                <dl className="h2a0-facts">
                  <div>
                    <dt>Baseline Aktif</dt>
                    <dd>Versi {monitoring.baseline.versionNumber}</dd>
                  </div>
                  <div>
                    <dt>Cakupan Bobot</dt>
                    <dd>{weightCompletenessLabel(monitoring.weight)}</dd>
                    <small>{weightCompletenessExplanation(monitoring.weight)}</small>
                  </div>
                  <div>
                    <dt>Bobot terhitung</dt>
                    <dd>
                      {monitoring.weight.weightedWorkItemCount} /{' '}
                      {monitoring.weight.eligibleWorkItemCount} item pekerjaan
                    </dd>
                  </div>
                  <div>
                    <dt>Data pekerjaan sampai</dt>
                    <dd>{dataThrough}</dd>
                  </div>
                  <div>
                    <dt>Terakhir diperbarui</dt>
                    <dd>{lastRecorded.value}</dd>
                  </div>
                </dl>
                <p className="h2a0-guidance">
                  Pilih satu item pekerjaan pada struktur RAB/WBS untuk melihat
                  catatan realisasi yang berlaku tanpa meninggalkan orientasi proyek.
                </p>
              </div>
            ) : (
              <div className="h2a0-item-scope">
                <span className="h2a0-scope-badge">Pekerjaan · {selected.number}</span>
                <h3>{selected.name}</h3>
                <p className="h2a0-wbs-code">{selected.wbsCode}</p>
                <dl className="h2a0-facts">
                  <div>
                    <dt>Volume BOQ</dt>
                    <dd>
                      {selected.planned.quantity} {selected.planned.unit}
                    </dd>
                  </div>
                  <div>
                    <dt>Bobot terhadap proyek</dt>
                    <dd>{formatWeightPercentage(selected.weight.own)}</dd>
                  </div>
                  <div>
                    <dt>Bobot kumulatif RAB</dt>
                    <dd>{formatWeightPercentage(selected.weight.cumulative)}</dd>
                  </div>
                  <div>
                    <dt>Status Realisasi</dt>
                    <dd>{actualStateLabel(selected.actual)}</dd>
                  </div>
                  <div>
                    <dt>Realisasi Terakhir yang Berlaku</dt>
                    <dd>
                      {actualQuantity(
                        selectedActual?.installedQuantity,
                        selected.actual?.state,
                        selected.planned.unit,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Tanggal Pekerjaan</dt>
                    <dd>
                      {formatProjectBusinessDate(selectedActual?.workDate ?? null) ||
                        (selected.actual?.state === 'UNAVAILABLE'
                          ? 'TIDAK TERSEDIA'
                          : 'BELUM DICATAT')}
                    </dd>
                  </div>
                  <div>
                    <dt>Dicatat di SIMPROK</dt>
                    <dd>{selectedRecordedAt.value}</dd>
                    {selectedRecordedAt.basis && (
                      <small>{selectedRecordedAt.basis}</small>
                    )}
                  </div>
                  <div>
                    <dt>Metode pencatatan</dt>
                    <dd>
                      {selectedActual
                        ? captureMethodLabel(selectedActual.captureMethod)
                        : selected.actual?.state === 'UNAVAILABLE'
                          ? 'TIDAK TERSEDIA'
                          : 'BELUM DICATAT'}
                    </dd>
                  </div>
                </dl>
                <p className="h2a0-semantics">
                  Nilai ini adalah catatan realisasi yang saat ini berlaku, bukan
                  total realisasi, realisasi kumulatif, atau persentase kemajuan
                  proyek.
                </p>
                <p className="h2a1-weight-note">
                  Bobot menunjukkan kontribusi nilai item terhadap total nilai dasar
                  Baseline RAB. Bobot kumulatif menunjukkan komposisi RAB sesuai
                  urutan pekerjaan, bukan persentase kemajuan atau perkembangan
                  terhadap waktu.
                </p>
                <button
                  className="h2a0-detail-action"
                  onClick={() =>
                    navigate(progressDetailPath(project.id, selected.id))
                  }
                >
                  Buka Detail Progress
                </button>
              </div>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
