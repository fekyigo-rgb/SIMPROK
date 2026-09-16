import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch } from '../../utils/apiClient';
import {
  executionPlanBlockerLabel,
  executionPlanCurveUnavailableLabel,
  executionPlanPeriodCountLabel,
  executionPlanStatusLabel,
  type ExecutionPlanResponse,
} from '../../utils/executionPlan';
import {
  formatProjectBusinessDate,
  recordedAtLabel,
  scheduleRealizationPresentation,
  type MonitoringItem,
} from '../../utils/monitoringCurrent';

type ReviewView = 'schedule' | 'work-plan' | 'planned-curve';

interface DraftRow {
  key: string;
  boqItemId: string;
  periodStartDate: string;
  periodEndDate: string;
  plannedIncrementalQuantity: string;
}

export function ExecutionPlanReadinessPanel({
  projectId,
  executionPlan,
  realizationByBoqItemId,
  onChanged,
}: {
  projectId: string;
  executionPlan: ExecutionPlanResponse;
  realizationByBoqItemId: ReadonlyMap<string, MonitoringItem>;
  onChanged: () => void;
}) {
  const { hasPermission } = useAuth();
  const [view, setView] = useState<ReviewView>('schedule');
  const [editing, setEditing] = useState(false);
  const [draftRows, setDraftRows] = useState<DraftRow[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locked = executionPlan.plan?.status === 'LOCKED';
  const canEdit =
    executionPlan.capabilities.canEditDraft &&
    hasPermission('EXECUTION_PLAN_EDIT');
  const canLock =
    executionPlan.capabilities.canLock &&
    hasPermission('EXECUTION_PLAN_LOCK');

  const beginRevision = () => {
    const existing = executionPlan.distributions.map((row) => ({
      key: row.id,
      boqItemId: row.boqItemId,
      periodStartDate: row.periodStartDate,
      periodEndDate: row.periodEndDate,
      plannedIncrementalQuantity: row.plannedIncrementalQuantity,
    }));
    setDraftRows(
      existing.length > 0
        ? existing
        : [
            {
              key: crypto.randomUUID(),
              boqItemId: executionPlan.workPlan[0]?.boqItemId ?? '',
              periodStartDate: '',
              periodEndDate: '',
              plannedIncrementalQuantity: '',
            },
          ],
    );
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    setWorking(true);
    setError(null);
    try {
      const response = await apiFetch(`/projects/${projectId}/execution-plan/draft`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedRevision: executionPlan.plan?.revision ?? 0,
          distributions: draftRows.map(({ key: _key, ...row }) => row),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { message?: string | string[] }
          | null;
        throw new Error(
          Array.isArray(body?.message)
            ? body.message.join(' ')
            : body?.message ?? `Rencana gagal disimpan (${response.status}).`,
        );
      }
      setEditing(false);
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Rencana gagal disimpan.');
    } finally {
      setWorking(false);
    }
  };

  const lock = async () => {
    const plan = executionPlan.plan;
    if (
      !plan ||
      !window.confirm(
        'Kunci Rencana Pelaksanaan sebagai dasar resmi pelaksanaan?',
      )
    ) {
      return;
    }
    setWorking(true);
    setError(null);
    try {
      const response = await apiFetch(`/projects/${projectId}/execution-plan/lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          executionPlanVersionId: plan.id,
          expectedRevision: plan.revision,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { message?: string | string[] }
          | null;
        throw new Error(
          Array.isArray(body?.message)
            ? body.message.join(' ')
            : body?.message ?? `Rencana gagal dikunci (${response.status}).`,
        );
      }
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Rencana gagal dikunci.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="execution-plan" aria-labelledby="execution-plan-title">
      <div className="execution-plan-heading">
        <div>
          <p className="h2a0-eyebrow">Execution Readiness</p>
          <h2 id="execution-plan-title">Rencana Pelaksanaan</h2>
          <p className="execution-plan-note">
            Status Proyek: <strong>{executionPlan.projectStatus}</strong>
          </p>
        </div>
        <strong className={`execution-plan-state ${locked ? 'is-locked' : ''}`}>
          {executionPlanStatusLabel(executionPlan.readinessState)}
        </strong>
      </div>

      <div className="execution-plan-actions" aria-label="Tinjau Rencana Pelaksanaan">
        <button type="button" onClick={() => setView('schedule')}>
          Schedule Rencana <span>Tinjau</span>
        </button>
        <button type="button" onClick={() => setView('work-plan')}>
          Rencana Kerja <span>Tinjau</span>
        </button>
        <button type="button" onClick={() => setView('planned-curve')}>
          Kurva S Rencana <span>Tinjau</span>
        </button>
      </div>

      {executionPlan.blockers.length > 0 && !locked && (
        <div className="execution-plan-blockers" role="status">
          <strong>Yang perlu diselesaikan sebelum penguncian:</strong>
          <ul>
            {executionPlan.blockers.map((blocker, index) => (
              <li key={`${blocker.code}-${blocker.boqItemId ?? index}`}>
                {executionPlanBlockerLabel(blocker)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {view === 'schedule' && (
        <div className="execution-plan-review">
          <h3>Schedule Rencana + Realisasi Terkini</h3>
          <p className="execution-plan-note">
            Waktu tetap berasal dari rencana resmi. Realisasi menampilkan fakta
            Current Official terkini, bukan Actual Start, Actual Finish, atau durasi aktual.
          </p>
          {executionPlan.schedule.length === 0 ? (
            <p>Distribusi waktu belum tersedia.</p>
          ) : (
            <div className="execution-plan-table-scroll">
              <table className="execution-plan-schedule">
                <thead>
                  <tr>
                    <th>Pekerjaan</th>
                    <th>Rencana Mulai</th>
                    <th>Rencana Selesai</th>
                    <th>Rencana</th>
                    <th>Realisasi Terkini</th>
                    <th>Progress Terkini</th>
                    <th>Tanggal Kerja Efektif</th>
                    <th>Status Fakta</th>
                  </tr>
                </thead>
                <tbody>
                  {executionPlan.schedule.map((row) => {
                    const realization = scheduleRealizationPresentation(
                      realizationByBoqItemId.get(row.boqItemId),
                      row.unit,
                    );
                    return (
                      <tr key={row.boqItemId}>
                        <td>{row.wbsCode} · {row.name}</td>
                        <td>{formatProjectBusinessDate(row.plannedStartDate)}</td>
                        <td>{formatProjectBusinessDate(row.plannedFinishDate)}</td>
                        <td>{row.plannedQuantity} {row.unit}</td>
                        <td className="execution-plan-realization-value">
                          {realization.currentOfficialQuantity}
                        </td>
                        <td className="execution-plan-realization-value">
                          {realization.currentOfficialItemProgress}
                        </td>
                        <td>{realization.effectiveWorkDate}</td>
                        <td>
                          <span className="execution-plan-fact-state">
                            <small>Kuantitas</small>
                            {realization.quantityState}
                          </span>
                          <span className="execution-plan-fact-state">
                            <small>Progress</small>
                            {realization.progressState}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {view === 'work-plan' && (
        <div className="execution-plan-review">
          <h3>Rencana Kerja</h3>
          <div className="execution-plan-table-scroll">
            <table>
              <thead>
                <tr><th>WBS / Pekerjaan</th><th>Volume Baseline</th><th>Periode Rencana</th></tr>
              </thead>
              <tbody>
                {executionPlan.workPlan.map((row) => (
                  <tr key={row.boqItemId}>
                    <td>{row.wbsCode} · {row.name}</td>
                    <td>{row.baselineQuantity} {row.unit}</td>
                    <td>{executionPlanPeriodCountLabel(row.distributionCount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === 'planned-curve' && (
        <div className="execution-plan-review">
          <h3>Kurva S Rencana</h3>
          <p className="execution-plan-note">
            Dibentuk SIMPROK dari kuantitas incremental dan bobot RAB resmi; bukan titik kurva yang diedit manual.
          </p>
          {executionPlan.plannedCurve.state === 'UNAVAILABLE' ? (
            <p>
              {executionPlanCurveUnavailableLabel(
                executionPlan.plannedCurve.reason,
              )}
            </p>
          ) : (
            <div className="execution-plan-curve" data-state={executionPlan.plannedCurve.state}>
              {executionPlan.plannedCurve.points.map((point) => (
                <div key={point.periodEndDate}>
                  <span>{formatProjectBusinessDate(point.periodEndDate)}</span>
                  <strong>{point.knownWeightedPlannedProgressPercent}%</strong>
                </div>
              ))}
              {executionPlan.plannedCurve.state === 'INCOMPLETE' && (
                <small>Subtotal yang diketahui; belum menjadi kurva lengkap.</small>
              )}
            </div>
          )}
        </div>
      )}

      {locked && executionPlan.plan && (
        <>
          <p className="execution-plan-note">
            Rencana Pelaksanaan telah dikunci. Monitoring menggunakan rencana
            ini sebagai dasar Pengawasan dan Pengendalian.
          </p>
          <dl className="execution-plan-lock-facts">
            <div><dt>Plan Version</dt><dd>{executionPlan.plan.versionNumber}</dd></div>
            <div><dt>Revision frozen</dt><dd>{executionPlan.plan.lockedFromRevision}</dd></div>
            <div><dt>Baseline Version</dt><dd>{executionPlan.baseline?.versionNumber}</dd></div>
            <div>
              <dt>Locked At</dt>
              <dd>{recordedAtLabel(executionPlan.plan.lockedAt, executionPlan.projectTimeZone).value}</dd>
            </div>
            <div><dt>Authority</dt><dd>{executionPlan.plan.authority?.code ?? 'TIDAK TERSEDIA'}</dd></div>
          </dl>
        </>
      )}

      {!locked && !editing && (
        <div className="execution-plan-command-bar">
          {canEdit && (
            <button type="button" onClick={beginRevision} disabled={working}>
              {executionPlan.plan
                ? 'Revisi Rencana'
                : 'Lengkapi Rencana Pelaksanaan'}
            </button>
          )}
          {canLock && (
            <button type="button" className="is-primary" onClick={lock} disabled={working}>
              Kunci Rencana Pelaksanaan
            </button>
          )}
        </div>
      )}

      {editing && (
        <div className="execution-plan-editor">
          <h3>Revisi Draft Rencana</h3>
          {draftRows.map((row, index) => (
            <div className="execution-plan-editor-row" key={row.key}>
              <select
                aria-label={`Pekerjaan periode ${index + 1}`}
                value={row.boqItemId}
                onChange={(event) =>
                  setDraftRows((current) => current.map((candidate) =>
                    candidate.key === row.key
                      ? { ...candidate, boqItemId: event.target.value }
                      : candidate,
                  ))
                }
              >
                {executionPlan.workPlan.map((item) => (
                  <option key={item.boqItemId} value={item.boqItemId}>
                    {item.wbsCode} · {item.name} ({item.unit})
                  </option>
                ))}
              </select>
              <input type="date" aria-label="Tanggal mulai periode" required value={row.periodStartDate} onChange={(event) => setDraftRows((current) => current.map((candidate) => candidate.key === row.key ? { ...candidate, periodStartDate: event.target.value } : candidate))} />
              <input type="date" aria-label="Tanggal selesai periode" required value={row.periodEndDate} onChange={(event) => setDraftRows((current) => current.map((candidate) => candidate.key === row.key ? { ...candidate, periodEndDate: event.target.value } : candidate))} />
              <input type="text" inputMode="decimal" aria-label="Kuantitas incremental" required placeholder="Kuantitas incremental" value={row.plannedIncrementalQuantity} onChange={(event) => setDraftRows((current) => current.map((candidate) => candidate.key === row.key ? { ...candidate, plannedIncrementalQuantity: event.target.value } : candidate))} />
              <button type="button" onClick={() => setDraftRows((current) => current.filter((candidate) => candidate.key !== row.key))}>Hapus</button>
            </div>
          ))}
          <div className="execution-plan-command-bar">
            <button type="button" onClick={() => setDraftRows((current) => [...current, { key: crypto.randomUUID(), boqItemId: executionPlan.workPlan[0]?.boqItemId ?? '', periodStartDate: '', periodEndDate: '', plannedIncrementalQuantity: '' }])}>Tambah Periode</button>
            <button type="button" onClick={() => setEditing(false)} disabled={working}>Batal</button>
            <button type="button" className="is-primary" onClick={save} disabled={working || draftRows.length === 0}>Simpan Draft</button>
          </div>
        </div>
      )}

      {error && <p className="execution-plan-error" role="alert">{error}</p>}
    </section>
  );
}
