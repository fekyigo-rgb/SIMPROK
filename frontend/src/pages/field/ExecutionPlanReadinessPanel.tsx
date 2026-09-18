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
  actualComparisonLabel,
  deviationComparisonPresentation,
  formatProjectBusinessDate,
  monitoringComparisonChartProjection,
  monitoringTemporalPeriodLabel,
  monitoringWorkItemsById,
  plannedComparisonLabel,
  plannedPeriodQuantityLabel,
  recordedAtLabel,
  scheduleRealizationPresentation,
  temporalActualQuantityLabel,
  temporalLensItemsByBoqItemId,
  type MonitoringItem,
  type MonitoringPeriodicComparisonPresentation,
  type MonitoringProgressComparison,
  type MonitoringProgressComparisonPresentation,
  type MonitoringResponse,
  type MonitoringTemporalLens,
} from '../../utils/monitoringCurrent';

type ReviewView = 'schedule' | 'work-plan' | 'planned-curve';

interface DraftRow {
  key: string;
  boqItemId: string;
  periodStartDate: string;
  periodEndDate: string;
  plannedIncrementalQuantity: string;
}

interface CurrentExecutionPlanReadinessPanelProps {
  projectId: string;
  executionPlan: ExecutionPlanResponse;
  realizationByBoqItemId: ReadonlyMap<string, MonitoringItem>;
  progressComparisonPresentation: MonitoringProgressComparisonPresentation;
  onChanged: () => void;
}

interface PeriodicExecutionPlanReadinessPanelProps {
  periodicSchedule: {
    monitoring: MonitoringResponse;
    lens: Extract<MonitoringTemporalLens, { state: 'RESOLVED' }>;
    executionPlan: ExecutionPlanResponse;
    comparisonPresentation: MonitoringPeriodicComparisonPresentation;
  };
}

type ExecutionPlanReadinessPanelProps =
  | CurrentExecutionPlanReadinessPanelProps
  | PeriodicExecutionPlanReadinessPanelProps;

interface MonitoringComparisonCurveProps {
  comparison: MonitoringProgressComparison;
  subtitle: string;
  contextLine: string;
  plannedSummaryLabel: string;
  actualSummaryLabel: string;
  deviationSummaryLabel: string;
}

function MonitoringComparisonCurve({
  comparison,
  subtitle,
  contextLine,
  plannedSummaryLabel,
  actualSummaryLabel,
  deviationSummaryLabel,
}: MonitoringComparisonCurveProps) {
  const comparisonChart = monitoringComparisonChartProjection(comparison.points);
  const finalComparisonPoint =
    comparison.points.length > 0
      ? comparison.points[comparison.points.length - 1]
      : null;
  const finalDeviation = finalComparisonPoint
    ? deviationComparisonPresentation(
        finalComparisonPoint.deviationPercentagePoints,
      )
    : null;

  return (
    <>
      <div className="execution-plan-curve-heading">
        <div>
          <h3>Kurva S</h3>
          <p>{subtitle}</p>
        </div>
        <span>{contextLine}</span>
      </div>
      <p className="execution-plan-note">
        Rencana, Realisasi, dan Deviasi berasal dari perbandingan temporal
        kanonikal backend. Garis terputus saat fakta belum lengkap atau tidak
        tersedia.
      </p>
      <p className="execution-plan-curve-provenance">
        {comparison.baseline
          ? 'Baseline v' + comparison.baseline.versionNumber
          : 'Baseline tidak tersedia'}
        {' · '}
        {comparison.plannedSource
          ? 'Rencana Pelaksanaan v' + comparison.plannedSource.versionNumber
          : 'Sumber rencana tidak tersedia'}
      </p>

      {comparison.points.length === 0 ? (
        <p>Fakta perbandingan temporal belum tersedia.</p>
      ) : (
        <>
          <div
            className="execution-plan-comparison-chart"
            data-boundary-basis={comparison.boundaryBasis}
          >
            <div
              className="execution-plan-comparison-legend"
              aria-label="Legenda Kurva S"
            >
              <span className="is-planned">Rencana</span>
              <span className="is-actual">Realisasi</span>
            </div>
            <svg
              role="img"
              aria-label="Kurva S Rencana dan Realisasi terhadap tanggal kerja"
              viewBox={
                '0 0 ' + comparisonChart.width + ' ' + comparisonChart.height
              }
            >
              <line
                className="comparison-axis"
                x1={comparisonChart.padding}
                y1={comparisonChart.padding}
                x2={comparisonChart.padding}
                y2={comparisonChart.height - comparisonChart.padding}
              />
              <line
                className="comparison-axis"
                x1={comparisonChart.padding}
                y1={comparisonChart.height - comparisonChart.padding}
                x2={comparisonChart.width - comparisonChart.padding}
                y2={comparisonChart.height - comparisonChart.padding}
              />
              <text x={4} y={comparisonChart.padding + 4}>100%</text>
              <text
                x={16}
                y={comparisonChart.height - comparisonChart.padding + 4}
              >
                0%
              </text>
              {comparisonChart.plannedSegments.map((segment, index) => (
                <line
                  key={'planned-' + index}
                  className="comparison-line is-planned"
                  x1={segment.from.x}
                  y1={segment.from.y}
                  x2={segment.to.x}
                  y2={segment.to.y}
                />
              ))}
              {comparisonChart.actualSegments.map((segment, index) => (
                <line
                  key={'actual-' + index}
                  className="comparison-line is-actual"
                  x1={segment.from.x}
                  y1={segment.from.y}
                  x2={segment.to.x}
                  y2={segment.to.y}
                />
              ))}
              {comparisonChart.points.map((point) => (
                <g key={point.cutoffDate}>
                  {point.x !== null && point.plannedY !== null && (
                    <circle
                      className="comparison-point is-planned"
                      cx={point.x}
                      cy={point.plannedY}
                      r={4}
                    />
                  )}
                  {point.x !== null && point.actualY !== null && (
                    <circle
                      className="comparison-point is-actual"
                      cx={point.x}
                      cy={point.actualY}
                      r={4}
                    />
                  )}
                </g>
              ))}
            </svg>
            <div className="execution-plan-comparison-range">
              <span>
                {formatProjectBusinessDate(comparison.points[0].cutoffDate)}
              </span>
              {comparison.points[0].cutoffDate !==
                comparison.points[comparison.points.length - 1].cutoffDate && (
                <span>
                  {formatProjectBusinessDate(
                    comparison.points[comparison.points.length - 1].cutoffDate,
                  )}
                </span>
              )}
            </div>
          </div>

          {finalComparisonPoint && finalDeviation && (
            <dl className="execution-plan-comparison-current">
              <div>
                <dt>{plannedSummaryLabel}</dt>
                <dd>{plannedComparisonLabel(finalComparisonPoint.planned)}</dd>
              </div>
              <div>
                <dt>{actualSummaryLabel}</dt>
                <dd>{actualComparisonLabel(finalComparisonPoint.actual)}</dd>
              </div>
              <div>
                <dt>{deviationSummaryLabel}</dt>
                <dd>{finalDeviation.value}</dd>
                <small>{finalDeviation.meaning}</small>
              </div>
            </dl>
          )}

          <div className="execution-plan-table-scroll">
            <table className="execution-plan-comparison-table">
              <caption>Detail fakta perbandingan Kurva S</caption>
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th>Rencana</th>
                  <th>Realisasi</th>
                  <th>Deviasi</th>
                </tr>
              </thead>
              <tbody>
                {comparison.points.map((point) => {
                  const deviation = deviationComparisonPresentation(
                    point.deviationPercentagePoints,
                  );
                  return (
                    <tr key={point.cutoffDate}>
                      <td>
                        <time dateTime={point.cutoffDate}>
                          {formatProjectBusinessDate(point.cutoffDate)}
                        </time>
                      </td>
                      <td data-state={point.planned.state}>
                        {plannedComparisonLabel(point.planned)}
                      </td>
                      <td data-state={point.actual.state}>
                        {actualComparisonLabel(point.actual)}
                      </td>
                      <td data-state={point.deviationPercentagePoints.state}>
                        <strong>{deviation.value}</strong>
                        <small>{deviation.meaning}</small>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function PeriodicScheduleReadOnly({
  monitoring,
  lens,
  executionPlan,
  comparisonPresentation,
}: PeriodicExecutionPlanReadinessPanelProps['periodicSchedule']) {
  const [periodicView, setPeriodicView] =
    useState<'schedule' | 'curve'>('schedule');
  const periodicItemsById = monitoringWorkItemsById(monitoring.items);
  const temporalItemsById = temporalLensItemsByBoqItemId(lens.items);

  return (
    <section
      className="execution-plan"
      aria-labelledby="execution-plan-periodic-title"
    >
      <div className="execution-plan-heading">
        <div>
          <p className="h2a0-eyebrow">Schedule Periode</p>
          <h2 id="execution-plan-periodic-title">
            {periodicView === 'schedule'
              ? 'Schedule Rencana + Realisasi Periode'
              : 'Kurva S Rencana + Realisasi s.d. Akhir Periode'}
          </h2>
          <p className="execution-plan-note">
            {monitoringTemporalPeriodLabel(lens.period)} {' · '}
            {formatProjectBusinessDate(lens.period.startDate)} {' - '}
            {formatProjectBusinessDate(lens.period.endDate)}
          </p>
        </div>
        <strong className="execution-plan-state is-locked">Hanya baca</strong>
      </div>

      <div
        className="execution-plan-actions"
        aria-label="Tinjau konteks Rencana Pelaksanaan periode"
      >
        <button
          type="button"
          aria-pressed={periodicView === 'schedule'}
          onClick={() => setPeriodicView('schedule')}
        >
          Schedule <span>Tinjau</span>
        </button>
        <button
          type="button"
          aria-pressed={periodicView === 'curve'}
          onClick={() => setPeriodicView('curve')}
        >
          Kurva S <span>Tinjau</span>
        </button>
      </div>

      {periodicView === 'schedule' && (
        <div className="execution-plan-review">
          <p className="execution-plan-note">
            Tanggal rencana berasal dari Rencana Pelaksanaan resmi. Kuantitas
            periode dan kumulatif berasal dari konteks periode kanonikal yang
            dipilih, bukan progress, Actual Start, Actual Finish, atau durasi
            aktual.
          </p>
          {executionPlan.schedule.length === 0 ? (
            <p>Schedule resmi belum mempunyai baris pekerjaan.</p>
          ) : (
            <div className="execution-plan-table-scroll">
              <table className="execution-plan-schedule">
              <thead>
                <tr>
                  <th>Pekerjaan</th>
                  <th>Rencana Mulai</th>
                  <th>Rencana Selesai</th>
                  <th>Rencana Periode</th>
                  <th>Realisasi Resmi Periode</th>
                  <th>Rencana s.d. Akhir Periode</th>
                  <th>Realisasi Resmi s.d. Akhir Periode</th>
                </tr>
              </thead>
              <tbody>
                {executionPlan.schedule.map((row) => {
                  const periodicItem = periodicItemsById.get(row.boqItemId)!;
                  const temporalItem = temporalItemsById.get(row.boqItemId)!;
                  const unit = periodicItem.planned.unit;
                  return (
                    <tr key={row.boqItemId}>
                      <td>{periodicItem.wbsCode} · {periodicItem.name}</td>
                      <td>
                        <time dateTime={row.plannedStartDate}>
                          {formatProjectBusinessDate(row.plannedStartDate)}
                        </time>
                      </td>
                      <td>
                        <time dateTime={row.plannedFinishDate}>
                          {formatProjectBusinessDate(row.plannedFinishDate)}
                        </time>
                      </td>
                      <td>
                        {plannedPeriodQuantityLabel(
                          temporalItem.planned.periodQuantity,
                          unit,
                        )}
                      </td>
                      <td>
                        {temporalActualQuantityLabel(
                          temporalItem.actual.periodOfficialQuantity,
                          unit,
                        )}
                      </td>
                      <td>
                        {plannedPeriodQuantityLabel(
                          temporalItem.planned.cumulativeQuantityThroughEndDate,
                          unit,
                        )}
                      </td>
                      <td>
                        {temporalActualQuantityLabel(
                          temporalItem.actual
                            .cumulativeOfficialQuantityThroughEndDate,
                          unit,
                        )}
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

      {periodicView === 'curve' && (
        <div className="execution-plan-review">
          {comparisonPresentation.state === 'RESOLVED' && (
            <MonitoringComparisonCurve
              comparison={comparisonPresentation.comparison}
              subtitle="Rencana vs Realisasi s.d. Akhir Periode"
              contextLine={`${monitoringTemporalPeriodLabel(lens.period)} · s.d. ${formatProjectBusinessDate(
                comparisonPresentation.comparison.cutoffDate,
              )}`}
              plannedSummaryLabel="Rencana s.d. akhir periode"
              actualSummaryLabel="Realisasi s.d. akhir periode"
              deviationSummaryLabel="Deviasi s.d. akhir periode"
            />
          )}
          {comparisonPresentation.state === 'NO_COMPARATOR_CONTEXT' && (
            <p className="execution-plan-comparison-state" role="status">
              Kurva S periode belum tersedia karena Rencana Pelaksanaan resmi
              belum tersedia.
            </p>
          )}
          {(comparisonPresentation.state === 'DISABLED' ||
            comparisonPresentation.state === 'CHECKING') && (
            <p className="execution-plan-comparison-state" role="status">
              Menyiapkan Kurva S sampai akhir periode yang dipilih…
            </p>
          )}
          {comparisonPresentation.state === 'INCOHERENT' && (
            <p className="execution-plan-comparison-state" role="alert">
              Kurva S periode tidak dapat ditampilkan karena konteks RAB,
              rencana, dan perbandingan tidak konsisten.
            </p>
          )}
          {comparisonPresentation.state === 'ERROR' && (
            <p className="execution-plan-comparison-state" role="alert">
              Kurva S periode gagal dimuat. Fakta periode lainnya tetap aman.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export function ExecutionPlanReadinessPanel(
  props: ExecutionPlanReadinessPanelProps,
) {
  const { hasPermission } = useAuth();
  const [view, setView] = useState<ReviewView>('schedule');
  const [editing, setEditing] = useState(false);
  const [draftRows, setDraftRows] = useState<DraftRow[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if ('periodicSchedule' in props) {
    return <PeriodicScheduleReadOnly {...props.periodicSchedule} />;
  }

  const {
    projectId,
    executionPlan,
    realizationByBoqItemId,
    progressComparisonPresentation,
    onChanged,
  } = props;

  const locked = executionPlan.plan?.status === 'LOCKED';
  const canEdit =
    executionPlan.capabilities.canEditDraft &&
    hasPermission('EXECUTION_PLAN_EDIT');
  const canLock =
    executionPlan.capabilities.canLock &&
    hasPermission('EXECUTION_PLAN_LOCK');
  const progressComparison =
    progressComparisonPresentation.state === 'AVAILABLE'
      ? progressComparisonPresentation.comparison
      : null;

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
          Kurva S <span>Tinjau</span>
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
          {progressComparison ? (
            <MonitoringComparisonCurve
              comparison={progressComparison}
              subtitle="Rencana vs Realisasi"
              contextLine={`TERKINI · Data sampai ${formatProjectBusinessDate(progressComparison.cutoffDate)}`}
              plannedSummaryLabel="Rencana"
              actualSummaryLabel="Realisasi"
              deviationSummaryLabel="Deviasi"
            />
          ) : (
            <>
              <h3>Kurva S Rencana</h3>
              <p className="execution-plan-note">
                Dibentuk SIMPROK dari kuantitas incremental dan bobot RAB
                resmi; bukan titik kurva yang diedit manual.
              </p>
              {progressComparisonPresentation.state === 'MISSING_CUTOFF' && (
                <p className="execution-plan-comparison-state" role="status">
                  Kurva Realisasi belum tersedia karena belum ada tanggal data
                  pekerjaan yang berlaku.
                </p>
              )}
              {progressComparisonPresentation.state === 'UNAVAILABLE' && (
                <p className="execution-plan-comparison-state" role="status">
                  Perbandingan Rencana dan Realisasi sedang tidak tersedia.
                  Kurva Rencana tetap ditampilkan.
                </p>
              )}
              {(progressComparisonPresentation.state === 'PENDING' ||
                progressComparisonPresentation.state === 'LOADING') && (
                <p className="execution-plan-comparison-state" role="status">
                  Menyiapkan perbandingan Rencana dan Realisasi terkini…
                </p>
              )}
              {executionPlan.plannedCurve.state === 'UNAVAILABLE' ? (
                <p>
                  {executionPlanCurveUnavailableLabel(
                    executionPlan.plannedCurve.reason,
                  )}
                </p>
              ) : (
                <div
                  className="execution-plan-curve"
                  data-state={executionPlan.plannedCurve.state}
                >
                  {executionPlan.plannedCurve.points.map((point) => (
                    <div key={point.periodEndDate}>
                      <span>
                        {formatProjectBusinessDate(point.periodEndDate)}
                      </span>
                      <strong>
                        {point.knownWeightedPlannedProgressPercent}%
                      </strong>
                    </div>
                  ))}
                  {executionPlan.plannedCurve.state === 'INCOMPLETE' && (
                    <small>
                      Subtotal yang diketahui; belum menjadi kurva lengkap.
                    </small>
                  )}
                </div>
              )}
            </>
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
