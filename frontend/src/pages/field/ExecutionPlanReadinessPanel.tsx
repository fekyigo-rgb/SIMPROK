import { useState, type KeyboardEvent } from 'react';
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

type MonitoringPlanView = 'ANALYSIS' | 'SCHEDULE';

interface DraftRow {
  key: string;
  boqItemId: string;
  periodStartDate: string;
  periodEndDate: string;
  plannedIncrementalQuantity: string;
}

interface GovernanceExecutionPlanReadinessPanelProps {
  presentation: 'GOVERNANCE';
  showWorkPlanWhenLocked?: boolean;
  projectId: string;
  executionPlan: ExecutionPlanResponse;
  onChanged: () => void;
}

interface CurrentMonitoringExecutionPlanReadinessPanelProps {
  presentation: MonitoringPlanView;
  projectId: string;
  executionPlan: ExecutionPlanResponse;
  realizationByBoqItemId: ReadonlyMap<string, MonitoringItem>;
  progressComparisonPresentation: MonitoringProgressComparisonPresentation;
  onChanged: () => void;
}

interface PeriodicExecutionPlanReadinessPanelProps {
  periodicSchedule: {
    view: MonitoringPlanView;
    monitoring: MonitoringResponse;
    lens: Extract<MonitoringTemporalLens, { state: 'RESOLVED' }>;
    executionPlan: ExecutionPlanResponse;
    comparisonPresentation: MonitoringPeriodicComparisonPresentation;
  };
}

type ExecutionPlanReadinessPanelProps =
  | GovernanceExecutionPlanReadinessPanelProps
  | CurrentMonitoringExecutionPlanReadinessPanelProps
  | PeriodicExecutionPlanReadinessPanelProps;

interface MonitoringComparisonCurveProps {
  comparison: MonitoringProgressComparison;
  subtitle: string;
  contextLine: string;
  plannedSummaryLabel: string;
  actualSummaryLabel: string;
  deviationSummaryLabel: string;
}

function useOnDemandHelp() {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const dismiss = () => {
    setPinned(false);
    setOpen(false);
  };

  return {
    open,
    triggerProps: {
      onMouseEnter: () => setOpen(true),
      onMouseLeave: () => {
        if (!pinned) setOpen(false);
      },
      onFocus: () => setOpen(true),
      onBlur: dismiss,
      onClick: () => {
        const nextPinned = !pinned;
        setPinned(nextPinned);
        setOpen(nextPinned);
      },
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
        if (event.key === 'Escape') {
          dismiss();
          event.currentTarget.blur();
        }
      },
    },
  };
}

function OnDemandHeadingHelp({
  headingId,
  helpId,
  title,
  explanation,
}: {
  headingId: string;
  helpId: string;
  title: string;
  explanation: string;
}) {
  const help = useOnDemandHelp();

  return (
    <>
      <h2 id={headingId}>
        <button
          type="button"
          className="execution-plan-help-trigger"
          aria-expanded={help.open}
          aria-controls={helpId}
          {...help.triggerProps}
        >
          {title}
        </button>
      </h2>
      {help.open && (
        <div id={helpId} className="execution-plan-help-popover" role="tooltip">
          <p>{explanation}</p>
        </div>
      )}
    </>
  );
}

function MonitoringComparisonCurve({
  comparison,
  subtitle,
  contextLine,
  plannedSummaryLabel,
  actualSummaryLabel,
  deviationSummaryLabel,
}: MonitoringComparisonCurveProps) {
  const curveHelp = useOnDemandHelp();
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
        <div className="execution-plan-help-anchor">
          <h3>
            <button
              type="button"
              className="execution-plan-help-trigger"
              aria-expanded={curveHelp.open}
              aria-controls="execution-plan-curve-help"
              {...curveHelp.triggerProps}
            >
              Kurva S
            </button>
          </h3>
          {curveHelp.open && (
            <div
              id="execution-plan-curve-help"
              className="execution-plan-help-popover"
              role="tooltip"
            >
              <strong>{subtitle}</strong>
              <p>
                Rencana, Realisasi, dan Deviasi berasal dari perbandingan temporal
                kanonikal backend. Garis terputus saat fakta belum lengkap atau tidak
                tersedia.
              </p>
              <small className="execution-plan-curve-provenance">
                {comparison.baseline
                  ? 'Baseline v' + comparison.baseline.versionNumber
                  : 'Baseline tidak tersedia'}
                {' · '}
                {comparison.plannedSource
                  ? 'Rencana Pelaksanaan v' + comparison.plannedSource.versionNumber
                  : 'Sumber rencana tidak tersedia'}
              </small>
            </div>
          )}
        </div>
        <span>{contextLine}</span>
      </div>

      {comparison.points.length === 0 ? (
        <p>Fakta perbandingan temporal belum tersedia.</p>
      ) : (
        <>
          <div
            className="execution-plan-comparison-chart"
            data-boundary-basis={comparison.boundaryBasis}
          >
            <button
              type="button"
              className="execution-plan-comparison-legend"
              aria-label="Legenda Kurva S"
              aria-expanded={curveHelp.open}
              aria-controls="execution-plan-curve-help"
              {...curveHelp.triggerProps}
            >
              <span className="is-planned">Rencana</span>
              <span className="is-actual">Realisasi</span>
            </button>
            <div className="execution-plan-comparison-plot">
              <div className="execution-plan-comparison-plot-frame">
                <svg
                  role="img"
                  aria-label="Kurva S Rencana dan Realisasi terhadap tanggal kerja"
                  viewBox={
                    '0 0 ' + comparisonChart.width + ' ' + comparisonChart.height
                  }
                >
                  {comparisonChart.percentageTicks.map((tick) => (
                    <g key={tick.value}>
                      <line
                        className={
                          tick.value === 0 || tick.value === 100
                            ? 'comparison-grid is-boundary'
                            : 'comparison-grid'
                        }
                        x1={comparisonChart.padding}
                        y1={tick.y}
                        x2={comparisonChart.width - comparisonChart.padding}
                        y2={tick.y}
                        aria-hidden="true"
                      />
                      <text
                        className="comparison-axis-label"
                        x={comparisonChart.padding - 10}
                        y={tick.y}
                        textAnchor="end"
                        dominantBaseline="middle"
                      >
                        {tick.value}%
                      </text>
                    </g>
                  ))}
                  <line
                    className="comparison-axis"
                    x1={comparisonChart.padding}
                    y1={comparisonChart.padding}
                    x2={comparisonChart.padding}
                    y2={comparisonChart.height - comparisonChart.padding}
                  />
                  {comparisonChart.dateTicks.map((tick) => (
                    <g key={tick.cutoffDate}>
                      <line
                        className="comparison-x-tick"
                        x1={tick.x}
                        y1={comparisonChart.height - comparisonChart.padding}
                        x2={tick.x}
                        y2={comparisonChart.height - comparisonChart.padding + 6}
                        aria-hidden="true"
                      />
                      {tick.label && (
                        <text
                          className="comparison-x-label"
                          x={tick.x}
                          y={comparisonChart.height - comparisonChart.padding + 22}
                          textAnchor="middle"
                          dominantBaseline="middle"
                        >
                          {formatProjectBusinessDate(tick.cutoffDate)}
                        </text>
                      )}
                    </g>
                  ))}
                  {comparisonChart.plannedCurve.path && (
                    <path
                      className="comparison-line is-planned"
                      d={comparisonChart.plannedCurve.path}
                    />
                  )}
                  {comparisonChart.actualCurve.path && (
                    <path
                      className="comparison-line is-actual"
                      d={comparisonChart.actualCurve.path}
                    />
                  )}
                  {comparisonChart.points.map((point) => (
                    <g key={point.cutoffDate}>
                      {point.x !== null && point.plannedY !== null && (
                        <circle
                          className="comparison-point is-planned"
                          cx={point.x}
                          cy={point.plannedY}
                          r={4.5}
                        />
                      )}
                      {point.x !== null && point.actualY !== null && (
                        <circle
                          className="comparison-point is-actual"
                          cx={point.x}
                          cy={point.actualY}
                          r={4.5}
                        />
                      )}
                    </g>
                  ))}
                </svg>
              </div>
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

          <details className="execution-plan-comparison-detail">
            <summary>Lihat detail</summary>
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
          </details>
        </>
      )}
    </>
  );
}

function PeriodicScheduleReadOnly({
  view,
  monitoring,
  lens,
  executionPlan,
  comparisonPresentation,
}: PeriodicExecutionPlanReadinessPanelProps['periodicSchedule']) {
  const periodicItemsById = monitoringWorkItemsById(monitoring.items);
  const temporalItemsById = temporalLensItemsByBoqItemId(lens.items);

  return (
    <section
      className="execution-plan"
      aria-labelledby={view === 'SCHEDULE' ? 'execution-plan-periodic-title' : undefined}
      aria-label={view === 'ANALYSIS' ? 'Analisis Kurva S' : undefined}
    >
      <div
        className={
          view === 'ANALYSIS'
            ? 'execution-plan-heading execution-plan-heading-state-only'
            : 'execution-plan-heading'
        }
      >
        {view === 'SCHEDULE' && (
          <div className="execution-plan-help-anchor">
            <OnDemandHeadingHelp
              headingId="execution-plan-periodic-title"
              helpId="execution-plan-periodic-schedule-help"
              title="Jadwal Proyek"
              explanation="Tanggal rencana berasal dari Rencana Pelaksanaan resmi. Kuantitas periode dan kumulatif berasal dari konteks periode kanonikal yang dipilih, bukan progress, Actual Start, Actual Finish, atau durasi aktual."
            />
          </div>
        )}
        <strong className="execution-plan-state is-locked">Hanya baca</strong>
      </div>

      {view === 'SCHEDULE' && (
        <div className="execution-plan-review">
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

      {view === 'ANALYSIS' && (
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
  const [editing, setEditing] = useState(false);
  const [draftRows, setDraftRows] = useState<DraftRow[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if ('periodicSchedule' in props) {
    return <PeriodicScheduleReadOnly {...props.periodicSchedule} />;
  }

  const showWorkPlanWhenLocked =
    props.presentation === 'GOVERNANCE' &&
    props.showWorkPlanWhenLocked === true;
  const {
    presentation,
    projectId,
    executionPlan,
    onChanged,
  } = props;

  const locked = executionPlan.plan?.status === 'LOCKED';
  const canEdit =
    executionPlan.capabilities.canEditDraft &&
    hasPermission('EXECUTION_PLAN_EDIT');
  const canLock =
    executionPlan.capabilities.canLock &&
    hasPermission('EXECUTION_PLAN_LOCK');
  if (presentation === 'SCHEDULE') {
    const { realizationByBoqItemId } = props;
    return (
      <section
        className="execution-plan"
        aria-labelledby="execution-plan-current-schedule-title"
      >
        <div className="execution-plan-heading">
          <div className="execution-plan-help-anchor">
            <p className="h2a0-eyebrow">Schedule Terkini</p>
            <OnDemandHeadingHelp
              headingId="execution-plan-current-schedule-title"
              helpId="execution-plan-current-schedule-help"
              title="Jadwal Proyek"
              explanation="Waktu tetap berasal dari rencana resmi. Realisasi menampilkan fakta Current Official terkini, bukan Actual Start, Actual Finish, atau durasi aktual."
            />
            <p className="execution-plan-note">
              Schedule Rencana + Realisasi Terkini
            </p>
          </div>
        </div>
        <div className="execution-plan-review">
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
      </section>
    );
  }

  if (presentation === 'ANALYSIS') {
    const { progressComparisonPresentation } = props;
    const progressComparison =
      progressComparisonPresentation.state === 'AVAILABLE'
        ? progressComparisonPresentation.comparison
        : null;
    return (
      <section className="execution-plan" aria-label="Analisis Kurva S">
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
      </section>
    );
  }

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

  /*
   * MONITORING IS NOT A PLANNING ENGINE.
   *
   * Governance stays in one instance beside the project identity. Opening this
   * disclosure reveals the same readiness facts and the same bounded mutation
   * handlers; opening it does not itself save, lock, or change any plan fact.
   * Schedule and comparison rendering returned above remain independent.
   */
  return (
    <details className="execution-plan-header-control">
      <summary aria-describedby="execution-plan-header-help">
        <span className="execution-plan-header-title">
          Rencana Pelaksanaan
          <span
            className="execution-plan-header-help"
            id="execution-plan-header-help"
            role="tooltip"
          >
            Digunakan sebagai dasar pengawasan dan pengendalian.
          </span>
        </span>
        <strong className={`execution-plan-state ${locked ? 'is-locked' : ''}`}>
          {executionPlanStatusLabel(executionPlan.readinessState)}
        </strong>
        <span className="execution-plan-header-caret" aria-hidden="true">
          &#8964;
        </span>
      </summary>

      <div
        className="execution-plan execution-plan-header-detail"
        role="region"
        aria-label="Detail Rencana Pelaksanaan"
      >
        <div className="execution-plan-disclosure-heading">
          <strong>Detail Rencana Pelaksanaan</strong>
          <p className="execution-plan-note">
            Status Proyek: <strong>{executionPlan.projectStatus}</strong>
          </p>
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

      {(!locked || showWorkPlanWhenLocked) && (
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

      {locked && executionPlan.plan && (
        <>
          <p className="execution-plan-note execution-plan-governance-note">
            Rencana Pelaksanaan telah dikunci. Monitoring menggunakan rencana
            ini sebagai dasar Pengawasan dan Pengendalian. Distribusi waktu
            tetap dapat dibaca melalui Jadwal Rencana.
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
      </div>
    </details>
  );
}
