import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '../utils/apiClient';
import {
  executionPlanCurveUnavailableLabel,
  executionPlanStatusLabel,
  type ExecutionPlanResponse,
} from '../utils/executionPlan';
import { formatProjectBusinessDate } from '../utils/monitoringCurrent';
import { ExecutionPlanReadinessPanel } from './field/ExecutionPlanReadinessPanel';
import './field/ProjectWorkPage.css';
import './ScheduleHomePage.css';

interface ScheduleProject {
  id: string;
  name?: string | null;
  code?: string | null;
}

class ScheduleRequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Schedule request failed with ${status}`);
    this.status = status;
  }
}

function scheduleErrorMessage(error: unknown): string {
  if (error instanceof ScheduleRequestError) {
    if (error.status === 401) return 'Sesi berakhir. Silakan masuk kembali.';
    if (error.status === 403) return 'Anda tidak memiliki akses ke proyek ini.';
    if (error.status === 404) return 'Project tidak ditemukan.';
    if (error.status === 409) {
      return 'Schedule dihentikan karena konteks Rencana Pelaksanaan tidak konsisten.';
    }
  }
  return 'Schedule belum dapat dimuat. Muat ulang atau coba lagi.';
}

export function ScheduleHomePage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<ScheduleProject | null>(null);
  const [executionPlan, setExecutionPlan] = useState<ExecutionPlanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!projectId) {
      setLoading(false);
      setError('Project tidak ditemukan.');
      return;
    }

    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        const [projectResponse, executionPlanResponse] = await Promise.all([
          apiFetch(`/projects/${projectId}`, { signal: controller.signal }),
          apiFetch(`/projects/${projectId}/execution-plan`, {
            signal: controller.signal,
          }),
        ]);
        if (!projectResponse.ok) throw new ScheduleRequestError(projectResponse.status);
        if (!executionPlanResponse.ok) {
          throw new ScheduleRequestError(executionPlanResponse.status);
        }

        const [projectData, executionPlanData] = await Promise.all([
          projectResponse.json() as Promise<ScheduleProject>,
          executionPlanResponse.json() as Promise<ExecutionPlanResponse>,
        ]);
        if (
          projectData.id !== projectId ||
          executionPlanData.projectId !== projectId
        ) {
          throw new Error('Schedule project identity mismatch');
        }
        if (!active) return;
        setProject(projectData);
        setExecutionPlan(executionPlanData);
      } catch (caught) {
        if (!active || (caught instanceof DOMException && caught.name === 'AbortError')) {
          return;
        }
        setProject(null);
        setExecutionPlan(null);
        setError(scheduleErrorMessage(caught));
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [projectId, refresh]);

  if (loading) {
    return (
      <main className="schedule-home schedule-home--state" aria-live="polite">
        Memuat Schedule…
      </main>
    );
  }

  if (error || !projectId || !project || !executionPlan) {
    return (
      <main className="schedule-home schedule-home--state" role="alert">
        <strong>{error ?? 'Schedule belum tersedia.'}</strong>
        <button type="button" onClick={() => setRefresh((current) => current + 1)}>
          Muat Ulang
        </button>
      </main>
    );
  }

  return (
    <main className="schedule-home">
      <nav className="simprok-detail__breadcrumb" aria-label="Breadcrumb">
        <button type="button" onClick={() => navigate('/proyek')}>
          Proyek Saya
        </button>
        <span>/</span>
        <button type="button" onClick={() => navigate(`/project/${projectId}/detail`)}>
          Detail Proyek
        </button>
        <span>/</span>
        <strong>Schedule</strong>
      </nav>

      <header className="schedule-home__header">
        <div>
          <p className="schedule-home__eyebrow">Rencana Pelaksanaan</p>
          <h1>Schedule</h1>
          <p className="schedule-home__identity">
            {project.name?.trim() || 'Belum tersedia'}
            <span>{project.code?.trim() || 'Belum tersedia'}</span>
          </p>
        </div>
        <dl className="schedule-home__facts">
          <div>
            <dt>Status Proyek</dt>
            <dd>{executionPlan.projectStatus || 'Belum tersedia'}</dd>
          </div>
          <div>
            <dt>Status Schedule</dt>
            <dd>{executionPlanStatusLabel(executionPlan.readinessState)}</dd>
          </div>
          <div>
            <dt>Baseline Aktif</dt>
            <dd>
              {executionPlan.baseline
                ? `Versi ${executionPlan.baseline.versionNumber}`
                : 'Belum tersedia'}
            </dd>
          </div>
          <div>
            <dt>Rencana Pelaksanaan</dt>
            <dd>
              {executionPlan.plan
                ? `Versi ${executionPlan.plan.versionNumber} · Revisi ${executionPlan.plan.revision}`
                : 'Belum tersedia'}
            </dd>
          </div>
        </dl>
      </header>

      <section className="schedule-home__section" aria-labelledby="schedule-governance-title">
        <header>
          <div>
            <p className="schedule-home__eyebrow">Planning</p>
            <h2 id="schedule-governance-title">Rencana Pelaksanaan</h2>
          </div>
          <p>Kesiapan, Rencana Kerja, revisi, dan penguncian menggunakan Rencana Pelaksanaan yang sama.</p>
        </header>
        <ExecutionPlanReadinessPanel
          presentation="GOVERNANCE"
          showWorkPlanWhenLocked
          projectId={projectId}
          executionPlan={executionPlan}
          onChanged={() => setRefresh((current) => current + 1)}
        />
      </section>

      <section className="schedule-home__section" aria-labelledby="schedule-plan-title">
        <header>
          <div>
            <p className="schedule-home__eyebrow">Planning</p>
            <h2 id="schedule-plan-title">Jadwal Rencana</h2>
          </div>
          <p>Tanggal dan kuantitas berasal dari Rencana Pelaksanaan proyek.</p>
        </header>
        {executionPlan.schedule.length === 0 ? (
          <p className="schedule-home__empty">Distribusi waktu belum tersedia.</p>
        ) : (
          <div className="schedule-home__table-scroll">
            <table>
              <thead>
                <tr>
                  <th>WBS / Pekerjaan</th>
                  <th>Rencana Mulai</th>
                  <th>Rencana Selesai</th>
                  <th>Kuantitas Rencana</th>
                  <th>Satuan</th>
                </tr>
              </thead>
              <tbody>
                {executionPlan.schedule.map((row) => (
                  <tr key={row.boqItemId}>
                    <td>
                      <strong>{row.wbsCode}</strong>
                      <span>{row.name}</span>
                    </td>
                    <td>{formatProjectBusinessDate(row.plannedStartDate)}</td>
                    <td>{formatProjectBusinessDate(row.plannedFinishDate)}</td>
                    <td>{row.plannedQuantity}</td>
                    <td>{row.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="schedule-home__section" aria-labelledby="schedule-curve-title">
        <header>
          <div>
            <p className="schedule-home__eyebrow">Planning</p>
            <h2 id="schedule-curve-title">Kurva S Rencana</h2>
          </div>
          <p>Kurva S Rencana berasal dari Rencana Pelaksanaan proyek; tanpa Realisasi atau Deviasi.</p>
        </header>
        {executionPlan.plannedCurve.state === 'UNAVAILABLE' ? (
          <p className="schedule-home__empty">
            {executionPlanCurveUnavailableLabel(executionPlan.plannedCurve.reason)}
          </p>
        ) : (
          <div
            className="schedule-home__curve"
            data-state={executionPlan.plannedCurve.state}
          >
            {executionPlan.plannedCurve.points.map((point) => (
              <div key={point.periodEndDate}>
                <span>{formatProjectBusinessDate(point.periodEndDate)}</span>
                <strong>{point.knownWeightedPlannedProgressPercent}%</strong>
              </div>
            ))}
            {executionPlan.plannedCurve.state === 'INCOMPLETE' && (
              <small>Subtotal yang diketahui; Kurva S Rencana belum lengkap.</small>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

export default ScheduleHomePage;
