import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BarChart3,
  CalendarDays,
  FileText,
  Image as ImageIcon,
  MessageSquare,
  PackageSearch,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch } from '../../utils/apiClient';
import {
  periodicScheduleCoherence,
  periodicSchedulePlanDecision,
  type ExecutionPlanResponse,
} from '../../utils/executionPlan';
import {
  actualStateLabel,
  buildMonitoringRows,
  captureMethodLabel,
  dataThroughLabel,
  effectiveActual,
  formatWeightPercentage,
  formatProjectBusinessDate,
  monitoringEvidencePresentation,
  lastRecordedLabel,
  monitoringComparisonCutoff,
  monitoringComparisonRequestPath,
  monitoringActiveSnapshot,
  monitoringPeriodNavigatorRequestPath,
  monitoringPeriodNavigatorUnavailableMessage,
  monitoringTemporalBasisLabel,
  monitoringTemporalGranularityLabel,
  monitoringTemporalLensRequestPath,
  monitoringTemporalLensUnavailableMessage,
  monitoringPeriodicSnapshotForRequest,
  monitoringTemporalPeriodLabel,
  monitoringTemporalSnapshotCoherence,
  monitoringWorkItemsById,
  periodicComparisonCoherence,
  officialFactStateLabel,
  officialItemProgressLabel,
  officialQuantityLabel,
  plannedPeriodQuantityLabel,
  progressDetailPath,
  recordedAtLabel,
  rowWeightPresentation,
  selectedWorkItem,
  temporalActualQuantityLabel,
  temporalLensItemsByBoqItemId,
  weightCompletenessExplanation,
  weightCompletenessLabel,
  type MonitoringProject,
  type MonitoringPeriodicComparisonPresentation,
  type MonitoringPeriodNavigator,
  type MonitoringProgressComparisonPresentation,
  type MonitoringResponse,
  type MonitoringTemporalBasis,
  type MonitoringTemporalGranularity,
  type MonitoringTemporalLens,
  type MonitoringTemporalPeriod,
} from '../../utils/monitoringCurrent';
import {
  DEFAULT_MONITORING_TIME_LENS,
  MONITORING_TIME_LENSES,
  monitoringTimeLensAllowsActualAction,
  monitoringTimeLensLabel,
  monitoringTimeLensOf,
  monitoringTimeLensState,
  type MonitoringTimeLens,
} from '../../utils/monitoringTimeLens';
import { ExecutionPlanReadinessPanel } from './ExecutionPlanReadinessPanel';
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

type TemporalContextMode = 'TERKINI' | 'PERIODIK';
type MonitoringContentLens = 'CONDITION' | 'VISUAL' | 'ANALYSIS' | 'SCHEDULE';
type PeriodicTemporalLensPresentation =
  | { state: 'DISABLED' | 'WAITING_INPUT' | 'LOADING' }
  | { state: 'RESOLVED'; requestKey: string;
      response: MonitoringResponse;
      lens: Extract<MonitoringTemporalLens, { state: 'RESOLVED' }> }
  | { state: 'UNAVAILABLE'; requestKey: string;
      lens: Extract<MonitoringTemporalLens, { state: 'UNAVAILABLE' }> }
  | { state: 'INCOHERENT'; requestKey: string }
  | { state: 'ERROR'; requestKey: string; status: number | null };

type PeriodNavigatorPresentation =
  | { state: 'DISABLED' }
  | { state: 'LOADING'; requestKey: string }
  | {
      state: 'RESOLVED';
      requestKey: string;
      periods: MonitoringTemporalPeriod[];
      hasMoreOlder: boolean;
      olderCursor: string | null;
      olderState: 'IDLE' | 'LOADING' | 'ERROR';
    }
  | {
      state: 'UNAVAILABLE';
      requestKey: string;
      navigator: Extract<MonitoringPeriodNavigator, { state: 'UNAVAILABLE' }>;
    }
  | { state: 'ERROR'; requestKey: string; status: number | null };

type PeriodicSchedulePresentation =
  | { state: 'DISABLED' }
  | { state: 'NO_PLANNED_SOURCE' | 'CHECKING'; requestKey: string }
  | {
      state: 'RESOLVED';
      requestKey: string;
      executionPlan: ExecutionPlanResponse;
    }
  | { state: 'INCOHERENT' | 'ERROR'; requestKey: string };

/**
 * The Smart Monitoring Table opens on the Owner's default window: TERKINI.
 * MINGGUAN and BULANAN are the same table under a different time window, so the
 * granularity carried alongside the default is only the window a later periodic
 * switch would open on.
 */
const DEFAULT_TIME_LENS_STATE = monitoringTimeLensState(
  DEFAULT_MONITORING_TIME_LENS,
  'WEEK',
);

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

function officialProjectProgressLabel(
  fact: MonitoringResponse['currentOfficialRabWeightedPhysicalProgress'],
): string {
  switch (fact.state) {
    case 'COMPLETE':
      return `${fact.currentOfficialRabWeightedPhysicalProgressPercent}%`;
    case 'INCOMPLETE':
      return `BELUM LENGKAP — subtotal ${fact.knownWeightedContributionSubtotalPercent}%`;
    case 'UNAVAILABLE':
      return `TIDAK TERSEDIA — ${fact.reason}`;
  }
}

export function ProjectWorkPage() {
  const { projectId } = useParams();
  const { token, hasPermission } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnItemId = searchParams.get('item');
  const [project, setProject] = useState<MonitoringProject | null>(null);
  const [monitoring, setMonitoring] = useState<MonitoringResponse | null>(null);
  const [executionPlan, setExecutionPlan] = useState<ExecutionPlanResponse | null>(null);
  const [progressComparisonPresentation, setProgressComparisonPresentation] =
    useState<MonitoringProgressComparisonPresentation>({
      state: 'PENDING',
      cutoffDate: null,
      comparison: null,
    });
  const comparisonRequestRef = useRef<{
    key: string;
    promise: Promise<MonitoringResponse>;
  } | null>(null);
  const [executionPlanRefresh, setExecutionPlanRefresh] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [monitoringContentLens, setMonitoringContentLens] =
    useState<MonitoringContentLens>('CONDITION');
  const [temporalContextMode, setTemporalContextMode] =
    useState<TemporalContextMode>(DEFAULT_TIME_LENS_STATE.mode);
  const [temporalBasis, setTemporalBasis] =
    useState<MonitoringTemporalBasis>('WORK_PERIOD');
  const [temporalGranularity, setTemporalGranularity] =
    useState<MonitoringTemporalGranularity>(DEFAULT_TIME_LENS_STATE.granularity);
  const [temporalReferenceDate, setTemporalReferenceDate] = useState('');
  const [selectedPeriodKey, setSelectedPeriodKey] = useState<string | null>(null);
  const [periodMenuOpen, setPeriodMenuOpen] = useState(false);
  const [periodNavigatorPresentation, setPeriodNavigatorPresentation] =
    useState<PeriodNavigatorPresentation>({ state: 'DISABLED' });
  const [periodNavigatorRefresh, setPeriodNavigatorRefresh] = useState(0);
  const [periodicPresentation, setPeriodicPresentation] =
    useState<PeriodicTemporalLensPresentation>({ state: 'DISABLED' });
  const [periodicSchedulePresentation, setPeriodicSchedulePresentation] =
    useState<PeriodicSchedulePresentation>({ state: 'DISABLED' });
  const [periodicSchedulePlanCache, setPeriodicSchedulePlanCache] =
    useState<ExecutionPlanResponse | null>(null);
  const [temporalRequestRefresh, setTemporalRequestRefresh] = useState(0);
  const temporalRequestGenerationRef = useRef(0);
  const periodNavigatorGenerationRef = useRef(0);
  const periodNavigatorRequestRef = useRef<{
    key: string;
    promise: Promise<MonitoringResponse>;
  } | null>(null);
  const selectedPeriodKeyRef = useRef<string | null>(null);
  const periodicScheduleGenerationRef = useRef(0);
  const periodicScheduleRequestRef = useRef<{
    key: string;
    controller: AbortController;
    promise: Promise<ExecutionPlanResponse>;
  } | null>(null);
  const temporalProjectRef = useRef<string | null>(null);
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const [errorProjectId, setErrorProjectId] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorKind, setErrorKind] = useState<ErrorKind>(null);

  useEffect(() => {
    if (!token || !projectId) return;

    const controller = new AbortController();
    let active = true;
    setProgressComparisonPresentation({
      state: 'PENDING',
      cutoffDate: null,
      comparison: null,
    });

    const load = async () => {
      try {
        const [projectResponse, monitoringResponse, executionPlanResponse] =
          await Promise.all([
            apiFetch(`/projects/${projectId}`, {
              signal: controller.signal,
            }),
            apiFetch(`/projects/${projectId}/progress/monitoring`, {
              signal: controller.signal,
            }),
            apiFetch(`/projects/${projectId}/execution-plan`, {
              signal: controller.signal,
            }),
          ]);

        if (!projectResponse.ok) {
          throw new MonitoringRequestError(projectResponse.status);
        }
        if (!monitoringResponse.ok) {
          throw new MonitoringRequestError(monitoringResponse.status);
        }
        if (!executionPlanResponse.ok) {
          throw new MonitoringRequestError(executionPlanResponse.status);
        }

        const [projectData, monitoringData, executionPlanData] =
          await Promise.all([
            projectResponse.json() as Promise<MonitoringProject>,
            monitoringResponse.json() as Promise<MonitoringResponse>,
            executionPlanResponse.json() as Promise<ExecutionPlanResponse>,
          ]);

        if (!active) return;
        if (temporalProjectRef.current !== projectId) {
          temporalProjectRef.current = projectId;
          setMonitoringContentLens('VISUAL');
          setTemporalContextMode(DEFAULT_TIME_LENS_STATE.mode);
          setTemporalBasis('WORK_PERIOD');
          setTemporalGranularity(DEFAULT_TIME_LENS_STATE.granularity);
          setTemporalReferenceDate('');
          selectedPeriodKeyRef.current = null;
          setSelectedPeriodKey(null);
          setPeriodMenuOpen(false);
          setPeriodNavigatorPresentation({ state: 'DISABLED' });
          setPeriodicPresentation({ state: 'DISABLED' });
        }
        setProject(projectData);
        setMonitoring(monitoringData);
        setExecutionPlan(executionPlanData);
        setSelectedId(
          monitoringData.items.some(
            (item) =>
              item.id === returnItemId && item.itemType === 'WORK_ITEM',
          )
            ? returnItemId
            : null,
        );
        setLoadedProjectId(projectId);
        setErrorProjectId(null);
        setErrorKind(null);
        setErrorStatus(null);

        const cutoffDate = monitoringComparisonCutoff(
          monitoringData.freshness.dataThrough,
        );
        if (cutoffDate === null) {
          setProgressComparisonPresentation({
            state: 'MISSING_CUTOFF',
            cutoffDate: null,
            comparison: null,
          });
          return;
        }

        setProgressComparisonPresentation({
          state: 'LOADING',
          cutoffDate,
          comparison: null,
        });

        const plan = executionPlanData.plan;
        const comparisonRequestKey = [
          projectId,
          cutoffDate,
          executionPlanData.baseline?.id ?? 'NO_BASELINE',
          plan?.id ?? 'NO_PLAN',
          plan?.status ?? 'NO_PLAN_STATUS',
          String(plan?.revision ?? 'NO_REVISION'),
        ].join(':');
        let comparisonPromise: Promise<MonitoringResponse>;
        if (comparisonRequestRef.current?.key === comparisonRequestKey) {
          comparisonPromise = comparisonRequestRef.current.promise;
        } else {
          comparisonPromise = apiFetch(
            monitoringComparisonRequestPath(projectId, cutoffDate),
          ).then(async (response) => {
            if (!response.ok) {
              throw new MonitoringRequestError(response.status);
            }
            return response.json() as Promise<MonitoringResponse>;
          });
          comparisonRequestRef.current = {
            key: comparisonRequestKey,
            promise: comparisonPromise,
          };
        }

        try {
          const comparisonData = await comparisonPromise;
          if (!active) return;
          if (comparisonData.progressComparison === undefined) {
            setProgressComparisonPresentation({
              state: 'UNAVAILABLE',
              cutoffDate,
              comparison: null,
            });
            return;
          }
          setProgressComparisonPresentation({
            state: 'AVAILABLE',
            cutoffDate: comparisonData.progressComparison.cutoffDate,
            comparison: comparisonData.progressComparison,
          });
        } catch (comparisonError) {
          if (!active) return;
          console.error(
            'Failed to fetch optional Monitoring comparison:',
            comparisonError,
          );
          setProgressComparisonPresentation({
            state: 'UNAVAILABLE',
            cutoffDate,
            comparison: null,
          });
        }
      } catch (error: unknown) {
        if (!active) return;
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
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
        setExecutionPlan(null);
      }
    };

    void load();

    return () => {
      active = false;
      controller.abort();
    };
  }, [token, projectId, returnItemId, executionPlanRefresh]);

  const periodNavigatorRequestKey = [
    projectId ?? '',
    temporalBasis,
    temporalGranularity,
  ].join(':');

  useEffect(() => {
    const generation = periodNavigatorGenerationRef.current + 1;
    periodNavigatorGenerationRef.current = generation;
    if (
      temporalContextMode !== 'PERIODIK' ||
      !token ||
      !projectId ||
      loadedProjectId !== projectId
    ) {
      return;
    }

    let active = true;
    setPeriodNavigatorPresentation({
      state: 'LOADING',
      requestKey: periodNavigatorRequestKey,
    });

    const transportKey =
      `${periodNavigatorRequestKey}:${periodNavigatorRefresh}`;
    let request = periodNavigatorRequestRef.current;
    if (request?.key !== transportKey) {
      const promise = apiFetch(
          monitoringPeriodNavigatorRequestPath({
            projectId,
            basis: temporalBasis,
            granularity: temporalGranularity,
          }),
        ).then(async (response) => {
        if (!response.ok) throw new MonitoringRequestError(response.status);
        return response.json() as Promise<MonitoringResponse>;
      });
      request = { key: transportKey, promise };
      periodNavigatorRequestRef.current = request;
    }

    void request.promise
      .then((data) => {
        if (!active || periodNavigatorGenerationRef.current !== generation) return;

        const navigator = data.periodNavigator;
        if (
          navigator === undefined ||
          navigator.basis !== temporalBasis ||
          navigator.granularity !== temporalGranularity
        ) {
          setPeriodNavigatorPresentation({
            state: 'ERROR',
            requestKey: periodNavigatorRequestKey,
            status: null,
          });
          return;
        }
        if (navigator.state === 'UNAVAILABLE') {
          selectedPeriodKeyRef.current = null;
          setSelectedPeriodKey(null);
          setTemporalReferenceDate('');
          setPeriodNavigatorPresentation({
            state: 'UNAVAILABLE',
            requestKey: periodNavigatorRequestKey,
            navigator,
          });
          return;
        }

        const selectedPeriod =
          navigator.periods.find(
            (period) => period.periodKey === selectedPeriodKeyRef.current,
          ) ??
          navigator.periods[0] ??
          null;
        selectedPeriodKeyRef.current = selectedPeriod?.periodKey ?? null;
        setSelectedPeriodKey(selectedPeriod?.periodKey ?? null);
        setTemporalReferenceDate(selectedPeriod?.endDate ?? '');
        setPeriodNavigatorPresentation({
          state: 'RESOLVED',
          requestKey: periodNavigatorRequestKey,
          periods: navigator.periods,
          hasMoreOlder: navigator.hasMoreOlder,
          olderCursor: navigator.olderCursor,
          olderState: 'IDLE',
        });
      })
      .catch((error: unknown) => {
        if (
          !active ||
          periodNavigatorGenerationRef.current !== generation
        ) {
          return;
        }
        setPeriodNavigatorPresentation({
          state: 'ERROR',
          requestKey: periodNavigatorRequestKey,
          status: error instanceof MonitoringRequestError ? error.status : null,
        });
      });

    return () => {
      active = false;
    };
  }, [
    token,
    projectId,
    loadedProjectId,
    temporalContextMode,
    temporalBasis,
    temporalGranularity,
    periodNavigatorRequestKey,
    periodNavigatorRefresh,
  ]);

  const activePeriodNavigatorPresentation = useMemo<PeriodNavigatorPresentation>(
    () =>
      temporalContextMode !== 'PERIODIK'
        ? { state: 'DISABLED' }
        : 'requestKey' in periodNavigatorPresentation &&
            periodNavigatorPresentation.requestKey === periodNavigatorRequestKey
          ? periodNavigatorPresentation
          : { state: 'LOADING', requestKey: periodNavigatorRequestKey },
    [
      periodNavigatorPresentation,
      periodNavigatorRequestKey,
      temporalContextMode,
    ],
  );

  const temporalRequestKey = [
    projectId ?? '', temporalBasis, temporalGranularity,
    temporalReferenceDate, String(temporalRequestRefresh),
  ].join(':');

  useEffect(() => {
    const generation = temporalRequestGenerationRef.current + 1;
    temporalRequestGenerationRef.current = generation;
    if (temporalContextMode !== 'PERIODIK') {
      return;
    }
    if (
      !token ||
      !projectId ||
      loadedProjectId !== projectId ||
      temporalReferenceDate === ''
    ) {
      return;
    }

    const controller = new AbortController();
    let active = true;
    const loadTemporalLens = async () => {
      try {
        const response = await apiFetch(
          monitoringTemporalLensRequestPath({
            projectId,
            basis: temporalBasis,
            granularity: temporalGranularity,
            referenceDate: temporalReferenceDate,
          }),
          { signal: controller.signal },
        );
        if (!response.ok) throw new MonitoringRequestError(response.status);
        const data = (await response.json()) as MonitoringResponse;
        if (!active || temporalRequestGenerationRef.current !== generation) return;
        if (data.temporalLens === undefined) {
          setPeriodicPresentation({ state: 'ERROR', requestKey: temporalRequestKey,
            status: null });
        } else if (data.temporalLens.state === 'UNAVAILABLE') {
          setPeriodicPresentation({ state: 'UNAVAILABLE', requestKey: temporalRequestKey,
            lens: data.temporalLens });
        } else {
          const coherence = monitoringTemporalSnapshotCoherence({
            requestedProjectId: projectId,
            response: data,
          });
          if (coherence.state === 'INCOHERENT') {
            setPeriodicPresentation({ state: 'INCOHERENT', requestKey: temporalRequestKey });
          } else if (
            coherence.lens.basis !== temporalBasis ||
            coherence.lens.granularity !== temporalGranularity ||
            coherence.lens.period.periodKey !== selectedPeriodKeyRef.current
          ) {
            setPeriodicPresentation({ state: 'INCOHERENT', requestKey: temporalRequestKey });
          } else {
            setPeriodicPresentation({ state: 'RESOLVED', requestKey: temporalRequestKey,
              response: data, lens: coherence.lens });
          }
        }
      } catch (error: unknown) {
        if (
          !active ||
          temporalRequestGenerationRef.current !== generation ||
          (error instanceof DOMException && error.name === 'AbortError')
        ) return;
        console.error('Failed to fetch optional Monitoring Temporal Lens:', error);
        setPeriodicPresentation({
          state: 'ERROR',
          requestKey: temporalRequestKey,
          status: error instanceof MonitoringRequestError ? error.status : null,
        });
      }
    };
    void loadTemporalLens();
    return () => {
      active = false;
      controller.abort();
    };
  }, [
    token,
    projectId,
    loadedProjectId,
    temporalContextMode,
    temporalBasis,
    temporalGranularity,
    temporalReferenceDate,
    temporalRequestRefresh,
    temporalRequestKey,
  ]);

  const activePeriodicPresentation = useMemo<PeriodicTemporalLensPresentation>(
    () =>
      temporalContextMode !== 'PERIODIK'
        ? { state: 'DISABLED' }
        : temporalReferenceDate === ''
          ? { state: 'WAITING_INPUT' }
          : 'requestKey' in periodicPresentation &&
              periodicPresentation.requestKey === temporalRequestKey
            ? periodicPresentation
            : { state: 'LOADING' },
    [
      periodicPresentation,
      temporalContextMode,
      temporalReferenceDate,
      temporalRequestKey,
    ],
  );

  const periodicResolvedResponse =
    activePeriodicPresentation.state === 'RESOLVED'
      ? monitoringPeriodicSnapshotForRequest({
          activeRequestKey: temporalRequestKey,
          responseRequestKey: activePeriodicPresentation.requestKey,
          response: activePeriodicPresentation.response,
        })
      : null;
  const activeMonitoringSnapshot = monitoringActiveSnapshot({
    mode: temporalContextMode,
    currentResponse: monitoring,
    periodicResponse: periodicResolvedResponse,
  });
  const rows = useMemo(
    () => buildMonitoringRows(activeMonitoringSnapshot?.items ?? []),
    [activeMonitoringSnapshot?.items],
  );
  const realizationByBoqItemId = useMemo(
    () => monitoringWorkItemsById(monitoring?.items ?? []),
    [monitoring?.items],
  );
  const temporalLensItemsById = useMemo(
    () => temporalLensItemsByBoqItemId(
      activePeriodicPresentation.state === 'RESOLVED'
        ? activePeriodicPresentation.lens.items
        : [],
    ),
    [activePeriodicPresentation],
  );
  const selected = useMemo(
    () => selectedWorkItem(rows, selectedId),
    [rows, selectedId],
  );
  const selectedActual = effectiveActual(selected);
  const selectedEvidenceReferences =
    temporalContextMode === 'TERKINI'
      ? selectedActual?.evidenceReferences
      : undefined;
  const selectedEvidence = monitoringEvidencePresentation(
    selectedEvidenceReferences,
  );

  const selectedTemporalItem = selected
    ? temporalLensItemsById.get(selected.id)
    : undefined;
  const selectedPeriodEvidence =
    selectedTemporalItem?.actual.periodEvidence;
  const effectiveItemCount = useMemo(
    () => rows.filter((row) => effectiveActual(row) !== null).length,
    [rows],
  );
  const workItemCount = useMemo(
    () => rows.filter((row) => row.itemType === 'WORK_ITEM').length,
    [rows],
  );

  const dataThrough = activeMonitoringSnapshot
    ? dataThroughLabel(activeMonitoringSnapshot.freshness.dataThrough)
    : 'TIDAK TERSEDIA';
  const lastRecorded = activeMonitoringSnapshot
    ? lastRecordedLabel(
        activeMonitoringSnapshot.freshness.lastRecordedAt,
        activeMonitoringSnapshot.projectTimeZone,
      )
    : { value: 'TIDAK TERSEDIA', basis: '' };
  const currentErrorKind = errorProjectId === projectId ? errorKind : null;
  const loading = loadedProjectId !== projectId && currentErrorKind === null;
  const periodicResolvedLens =
    activePeriodicPresentation.state === 'RESOLVED'
      ? activePeriodicPresentation.lens
      : null;
  const periodicScheduleRequestKey =
    periodicResolvedResponse && periodicResolvedLens
      ? [
          temporalRequestKey,
          periodicResolvedResponse.projectId,
          periodicResolvedResponse.baseline?.id ?? 'NO_BASELINE',
          periodicResolvedResponse.baseline?.versionNumber ?? 'NO_BASELINE_VERSION',
          periodicResolvedLens.plannedSource?.executionPlanVersionId ??
            'NO_PLANNED_SOURCE',
          periodicResolvedLens.plannedSource?.versionNumber ??
            'NO_PLANNED_SOURCE_VERSION',
        ].join(':')
      : null;

  useEffect(() => {
    const generation = periodicScheduleGenerationRef.current + 1;
    periodicScheduleGenerationRef.current = generation;

    if (
      temporalContextMode !== 'PERIODIK' ||
      !token ||
      !projectId ||
      periodicResolvedResponse === null ||
      periodicResolvedLens === null ||
      periodicScheduleRequestKey === null
    ) {
      periodicScheduleRequestRef.current?.controller.abort();
      periodicScheduleRequestRef.current = null;
      return;
    }

    const decision = periodicSchedulePlanDecision({
      periodicResponse: periodicResolvedResponse,
      candidates: [executionPlan, periodicSchedulePlanCache],
    });
    if (decision.state === 'NO_PLANNED_SOURCE') {
      periodicScheduleRequestRef.current?.controller.abort();
      periodicScheduleRequestRef.current = null;
      return;
    }
    if (decision.state === 'REUSE') {
      periodicScheduleRequestRef.current?.controller.abort();
      periodicScheduleRequestRef.current = null;
      return;
    }

    const previousRequest = periodicScheduleRequestRef.current;
    let activeRequest = previousRequest;
    if (activeRequest?.key !== periodicScheduleRequestKey) {
      previousRequest?.controller.abort();
      const controller = new AbortController();
      const promise = apiFetch(`/projects/${projectId}/execution-plan`, {
        signal: controller.signal,
      }).then(async (response) => {
        if (!response.ok) throw new MonitoringRequestError(response.status);
        return response.json() as Promise<ExecutionPlanResponse>;
      });
      activeRequest = {
        key: periodicScheduleRequestKey,
        controller,
        promise,
      };
      periodicScheduleRequestRef.current = activeRequest;
    }

    let active = true;
    void activeRequest.promise
      .then((freshExecutionPlan) => {
        if (
          !active ||
          periodicScheduleGenerationRef.current !== generation ||
          periodicScheduleRequestRef.current?.key !== periodicScheduleRequestKey
        ) {
          return;
        }
        const coherence = periodicScheduleCoherence({
          periodicResponse: periodicResolvedResponse,
          executionPlan: freshExecutionPlan,
        });
        if (coherence.state !== 'COHERENT') {
          setPeriodicSchedulePresentation({
            state: 'INCOHERENT',
            requestKey: periodicScheduleRequestKey,
          });
          return;
        }
        setPeriodicSchedulePlanCache(freshExecutionPlan);
        setPeriodicSchedulePresentation({
          state: 'RESOLVED',
          requestKey: periodicScheduleRequestKey,
          executionPlan: freshExecutionPlan,
        });
      })
      .catch((scheduleError: unknown) => {
        if (
          !active ||
          periodicScheduleGenerationRef.current !== generation ||
          (scheduleError instanceof DOMException &&
            scheduleError.name === 'AbortError')
        ) {
          return;
        }
        console.error('Failed to verify Periodic Schedule provenance:', scheduleError);
        periodicScheduleRequestRef.current = null;
        setPeriodicSchedulePresentation({
          state: 'ERROR',
          requestKey: periodicScheduleRequestKey,
        });
      });

    return () => {
      active = false;
    };
  }, [
    token,
    projectId,
    temporalContextMode,
    temporalRequestKey,
    periodicResolvedResponse,
    periodicResolvedLens,
    periodicScheduleRequestKey,
    executionPlan,
    periodicSchedulePlanCache,
  ]);

  useEffect(
    () => () => periodicScheduleRequestRef.current?.controller.abort(),
    [],
  );

  const periodicScheduleImmediateDecision =
    temporalContextMode === 'PERIODIK' && periodicResolvedResponse
      ? periodicSchedulePlanDecision({
          periodicResponse: periodicResolvedResponse,
          candidates: [executionPlan, periodicSchedulePlanCache],
        })
      : null;
  const activePeriodicSchedulePresentation =
    periodicScheduleRequestKey === null ||
    periodicScheduleImmediateDecision === null
      ? ({ state: 'DISABLED' } as const)
      : periodicScheduleImmediateDecision.state === 'NO_PLANNED_SOURCE'
        ? ({
            state: 'NO_PLANNED_SOURCE',
            requestKey: periodicScheduleRequestKey,
          } as const)
        : periodicScheduleImmediateDecision.state === 'REUSE'
          ? ({
              state: 'RESOLVED',
              requestKey: periodicScheduleRequestKey,
              executionPlan: periodicScheduleImmediateDecision.executionPlan,
            } as const)
          : 'requestKey' in periodicSchedulePresentation &&
              periodicSchedulePresentation.requestKey ===
                periodicScheduleRequestKey
            ? periodicSchedulePresentation
            : ({
                state: 'CHECKING',
                requestKey: periodicScheduleRequestKey,
              } as const);

  const periodicSchedulePlanIdentity =
    activePeriodicSchedulePresentation.state === 'RESOLVED'
      ? activePeriodicSchedulePresentation.executionPlan.plan
      : null;
  const periodicAtomicComparisonKey =
    periodicResolvedResponse && periodicResolvedLens ? temporalRequestKey : null;
  const activePeriodicComparisonPresentation: MonitoringPeriodicComparisonPresentation =
    periodicAtomicComparisonKey === null ||
    periodicResolvedResponse === null ||
    periodicResolvedLens === null
      ? { state: 'DISABLED' }
      : periodicResolvedLens.plannedSource === null
        ? {
            state: 'NO_COMPARATOR_CONTEXT',
            requestKey: periodicAtomicComparisonKey,
          }
        : (() => {
            const coherence = periodicComparisonCoherence({
              periodicResponse: periodicResolvedResponse,
              periodicSchedulePlan: periodicSchedulePlanIdentity,
            });
            return coherence.state === 'COHERENT'
              ? {
                  state: 'RESOLVED' as const,
                  requestKey: periodicAtomicComparisonKey,
                  response: coherence.response,
                  comparison: coherence.comparison,
                }
              : {
                  state: 'INCOHERENT' as const,
                  requestKey: periodicAtomicComparisonKey,
                };
          })();
  /**
   * The user-facing primary lens of the Smart Monitoring Table. The internal
   * temporal context mode and granularity are unchanged; this is the same
   * canonical state read through the Owner's three-window model.
   */
  const activeTimeLens = monitoringTimeLensOf({
    mode: temporalContextMode,
    granularity: temporalGranularity,
  });
  const selectNavigatorPeriod = (period: MonitoringTemporalPeriod) => {
    selectedPeriodKeyRef.current = period.periodKey;
    setSelectedPeriodKey(period.periodKey);
    setTemporalReferenceDate(period.endDate);
    setPeriodMenuOpen(false);
  };

  const loadOlderPeriods = async () => {
    if (
      !token ||
      !projectId ||
      activePeriodNavigatorPresentation.state !== 'RESOLVED' ||
      !activePeriodNavigatorPresentation.hasMoreOlder ||
      activePeriodNavigatorPresentation.olderCursor === null ||
      activePeriodNavigatorPresentation.olderState === 'LOADING'
    ) {
      return;
    }

    const requestKey = activePeriodNavigatorPresentation.requestKey;
    const cursor = activePeriodNavigatorPresentation.olderCursor;
    setPeriodNavigatorPresentation((current) =>
      current.state === 'RESOLVED' && current.requestKey === requestKey
        ? { ...current, olderState: 'LOADING' }
        : current,
    );

    try {
      const response = await apiFetch(
        monitoringPeriodNavigatorRequestPath({
          projectId,
          basis: temporalBasis,
          granularity: temporalGranularity,
          cursor,
        }),
      );
      if (!response.ok) throw new MonitoringRequestError(response.status);
      const data = (await response.json()) as MonitoringResponse;
      const navigator = data.periodNavigator;
      if (
        navigator === undefined ||
        navigator.state !== 'RESOLVED' ||
        navigator.basis !== temporalBasis ||
        navigator.granularity !== temporalGranularity
      ) {
        throw new Error('Period Navigator continuation is not coherent');
      }

      setPeriodNavigatorPresentation((current) => {
        if (current.state !== 'RESOLVED' || current.requestKey !== requestKey) {
          return current;
        }
        const identities = new Set(
          current.periods.map(
            (period) =>
              `${period.basis}:${period.granularity}:${period.periodKey}`,
          ),
        );
        const additionalPeriods = navigator.periods.filter((period) => {
          const identity =
            `${period.basis}:${period.granularity}:${period.periodKey}`;
          if (identities.has(identity)) return false;
          identities.add(identity);
          return true;
        });
        return {
          ...current,
          periods: [...current.periods, ...additionalPeriods],
          hasMoreOlder: navigator.hasMoreOlder,
          olderCursor: navigator.olderCursor,
          olderState: 'IDLE',
        };
      });
    } catch {
      setPeriodNavigatorPresentation((current) =>
        current.state === 'RESOLVED' && current.requestKey === requestKey
          ? { ...current, olderState: 'ERROR' }
          : current,
      );
    }
  };

  /**
   * One table, three windows. Switching windows never rebuilds the table, never
   * navigates, and never clears the selected WORK_ITEM — the selection survives
   * wherever the item exists in the newly active canonical snapshot. A changed
   * window asks the backend for that window's own canonical period identities.
   */
  const selectTimeLens = (nextLens: MonitoringTimeLens) => {
    if (nextLens === activeTimeLens) {
      if (nextLens !== 'TERKINI') {
        setPeriodMenuOpen((current) => !current);
      }
      return;
    }
    const next = monitoringTimeLensState(nextLens, temporalGranularity);

    if (next.mode === 'TERKINI') {
      setTemporalContextMode('TERKINI');
      setPeriodMenuOpen(false);
      setPeriodicPresentation({ state: 'DISABLED' });
      return;
    }

    if (next.granularity !== temporalGranularity) {
      selectedPeriodKeyRef.current = null;
      setSelectedPeriodKey(null);
      setTemporalReferenceDate('');
      setPeriodicPresentation({ state: 'DISABLED' });
    }
    setTemporalGranularity(next.granularity);
    setTemporalContextMode('PERIODIK');
    setPeriodMenuOpen(true);
  };

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

  if (!project || !monitoring || !executionPlan) return null;

  const selectedRecordedAt =
    selected?.actual?.state === 'NOT_YET_RECORDED'
      ? { value: 'BELUM DICATAT', basis: '' }
      : recordedAtLabel(
          selectedActual?.recordedAt ?? null,
          monitoring.projectTimeZone,
        );
  const monitoringPlanView =
    monitoringContentLens === 'ANALYSIS' || monitoringContentLens === 'SCHEDULE'
      ? monitoringContentLens
      : null;

  /**
   * The primary time lens belongs to the Smart Monitoring Table itself: the
   * same table, the same RAB structure, read through one of three windows.
   */
  const timeLensSelector = (
    <div
      className="h2a0-time-lens"
      role="group"
      aria-label="Jendela waktu Monitoring"
    >
      {MONITORING_TIME_LENSES.map((lens) => (
        <button
          key={lens}
          type="button"
          aria-pressed={activeTimeLens === lens}
          aria-haspopup={lens === 'TERKINI' ? undefined : 'listbox'}
          aria-expanded={
            lens === 'TERKINI'
              ? undefined
              : activeTimeLens === lens && periodMenuOpen
          }
          aria-controls={lens === 'TERKINI' ? undefined : 'monitoring-period-options'}
          onClick={() => selectTimeLens(lens)}
        >
          <span>{monitoringTimeLensLabel(lens)}</span>
          {lens !== 'TERKINI' && (
            <span className="h2a0-time-lens-caret" aria-hidden="true">
              &#9662;
            </span>
          )}
        </button>
      ))}
      {periodMenuOpen && temporalContextMode === 'PERIODIK' && (
        <div
          id="monitoring-period-options"
          className="h2a0-period-menu"
          aria-live="polite"
        >
          <div
            className="h2a0-period-basis"
            role="group"
            aria-label="Dasar periode"
          >
            <button
              type="button"
              aria-pressed={temporalBasis === 'WORK_PERIOD'}
              onClick={() => {
                if (temporalBasis === 'WORK_PERIOD') return;
                selectedPeriodKeyRef.current = null;
                setSelectedPeriodKey(null);
                setTemporalReferenceDate('');
                setPeriodicPresentation({ state: 'DISABLED' });
                setTemporalBasis('WORK_PERIOD');
                setPeriodMenuOpen(true);
              }}
            >
              Waktu Kerja
            </button>
            <button
              type="button"
              aria-pressed={temporalBasis === 'CALENDAR'}
              onClick={() => {
                if (temporalBasis === 'CALENDAR') return;
                selectedPeriodKeyRef.current = null;
                setSelectedPeriodKey(null);
                setTemporalReferenceDate('');
                setPeriodicPresentation({ state: 'DISABLED' });
                setTemporalBasis('CALENDAR');
                setPeriodMenuOpen(true);
              }}
            >
              Kalender
            </button>
          </div>
          {activePeriodNavigatorPresentation.state === 'LOADING' && (
            <p className="h2a0-period-menu-state" role="status">
              Memuat periode resmi...
            </p>
          )}
          {activePeriodNavigatorPresentation.state === 'UNAVAILABLE' && (
            <p className="h2a0-period-menu-state">
              {monitoringPeriodNavigatorUnavailableMessage(
                activePeriodNavigatorPresentation.navigator.reason,
              )}
            </p>
          )}
          {activePeriodNavigatorPresentation.state === 'ERROR' && (
            <div className="h2a0-period-menu-state" role="alert">
              <p>Periode belum berhasil dimuat.</p>
              <button
                type="button"
                onClick={() =>
                  setPeriodNavigatorRefresh((current) => current + 1)
                }
              >
                Coba lagi
              </button>
            </div>
          )}
          {activePeriodNavigatorPresentation.state === 'RESOLVED' && (
            <>
              {activePeriodNavigatorPresentation.periods.length === 0 ? (
                <p className="h2a0-period-menu-state">
                  Belum ada periode yang tersedia.
                </p>
              ) : (
                <ul
                  className="h2a0-period-options"
                  role="listbox"
                  aria-label={`Pilihan periode ${monitoringTemporalGranularityLabel(
                    temporalGranularity,
                  ).toLowerCase()}`}
                >
                  {activePeriodNavigatorPresentation.periods.map((period) => {
                    const selected = period.periodKey === selectedPeriodKey;
                    return (
                      <li
                        key={`${period.basis}:${period.granularity}:${period.periodKey}`}
                        role="option"
                        aria-selected={selected}
                      >
                        <button
                          type="button"
                          className={selected ? 'is-selected' : undefined}
                          onClick={() => selectNavigatorPeriod(period)}
                        >
                          <strong>{monitoringTemporalPeriodLabel(period)}</strong>
                          <span>
                            {formatProjectBusinessDate(period.startDate)}
                            {' \u2013 '}
                            {formatProjectBusinessDate(period.endDate)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {activePeriodNavigatorPresentation.hasMoreOlder && (
                <button
                  type="button"
                  className="h2a0-period-older"
                  disabled={
                    activePeriodNavigatorPresentation.olderState === 'LOADING'
                  }
                  onClick={() => void loadOlderPeriods()}
                >
                  {activePeriodNavigatorPresentation.olderState === 'LOADING'
                    ? 'Memuat...'
                    : activePeriodNavigatorPresentation.olderState === 'ERROR'
                      ? 'Coba muat lagi'
                      : 'Periode sebelumnya'}
                </button>
              )}
              {activePeriodNavigatorPresentation.olderState === 'ERROR' && (
                <small className="h2a0-period-older-note" role="alert">
                  Riwayat sebelumnya belum berhasil dimuat.
                </small>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );

  /**
   * Basis and the server-issued period are secondary context for a periodic
   * window, never a second reporting engine. The selected canonical period's
   * end date is only passed back as the existing Temporal Lens reference.
   */
  const monitoringLensSelector = (
    <nav className="h2a0-primary-view-nav" aria-label="Tampilan utama Monitoring">
      <button
        type="button"
        aria-pressed={monitoringContentLens === 'CONDITION'}
        onClick={() => setMonitoringContentLens('CONDITION')}
      >
        <Activity size={16} aria-hidden="true" />
        Kondisi Proyek
      </button>
      <button
        type="button"
        aria-pressed={monitoringContentLens === 'VISUAL'}
        onClick={() => setMonitoringContentLens('VISUAL')}
      >
        <ImageIcon size={16} aria-hidden="true" />
        Visual
      </button>
      <button
        type="button"
        aria-pressed={monitoringContentLens === 'ANALYSIS'}
        onClick={() => setMonitoringContentLens('ANALYSIS')}
      >
        <BarChart3 size={16} aria-hidden="true" />
        Analisis
      </button>
      <button
        type="button"
        aria-pressed={monitoringContentLens === 'SCHEDULE'}
        onClick={() => setMonitoringContentLens('SCHEDULE')}
      >
        <CalendarDays size={16} aria-hidden="true" />
        Jadwal
      </button>
    </nav>
  );
  const monitoringPlanContent =
    monitoringPlanView === null ? null : temporalContextMode === 'TERKINI' ? (
      <ExecutionPlanReadinessPanel
        presentation={monitoringPlanView}
        projectId={project.id}
        executionPlan={executionPlan}
        realizationByBoqItemId={realizationByBoqItemId}
        progressComparisonPresentation={progressComparisonPresentation}
        onChanged={() => setExecutionPlanRefresh((current) => current + 1)}
      />
    ) : activePeriodicSchedulePresentation.state === 'RESOLVED' &&
      periodicResolvedResponse &&
      periodicResolvedLens ? (
      <ExecutionPlanReadinessPanel
        periodicSchedule={{
          view: monitoringPlanView,
          monitoring: periodicResolvedResponse,
          lens: periodicResolvedLens,
          executionPlan: activePeriodicSchedulePresentation.executionPlan,
          comparisonPresentation: activePeriodicComparisonPresentation,
        }}
      />
    ) : periodicResolvedLens ? (
      <section className="h2a0-periodic-deferred" role="status">
        {activePeriodicSchedulePresentation.state === 'NO_PLANNED_SOURCE' && (
          <strong>
            {monitoringPlanView === 'SCHEDULE'
              ? 'Schedule periode belum tersedia karena Rencana Pelaksanaan resmi belum tersedia.'
              : 'Kurva S periode belum tersedia karena Rencana Pelaksanaan resmi belum tersedia.'}
          </strong>
        )}
        {activePeriodicSchedulePresentation.state === 'CHECKING' && (
          <strong>
            {monitoringPlanView === 'SCHEDULE'
              ? 'Memeriksa Rencana Pelaksanaan resmi untuk periode ini...'
              : 'Menyiapkan Kurva S sampai akhir periode yang dipilih...'}
          </strong>
        )}
        {activePeriodicSchedulePresentation.state === 'INCOHERENT' && (
          <strong>
            {monitoringPlanView === 'SCHEDULE'
              ? 'Schedule periode tidak dapat ditampilkan karena konteks Rencana, RAB, dan periode tidak konsisten.'
              : 'Kurva S periode tidak dapat ditampilkan karena konteks RAB, rencana, dan perbandingan tidak konsisten.'}
          </strong>
        )}
        {activePeriodicSchedulePresentation.state === 'ERROR' && (
          <strong>
            {monitoringPlanView === 'SCHEDULE'
              ? 'Schedule periode gagal dimuat. Fakta periode tetap aman.'
              : 'Kurva S periode gagal dimuat. Fakta periode lainnya tetap aman.'}
          </strong>
        )}
      </section>
    ) : null;
  const monitoringPlanWorkspace =
    monitoringPlanView === null ? null : (
      <section
        className="h2a0-plan-workspace"
        aria-label={monitoringPlanView === 'ANALYSIS' ? 'Pilihan Analisis' : 'Pilihan Jadwal'}
      >
        <label className="h2a0-view-selector">
          <span>{monitoringPlanView === 'ANALYSIS' ? 'Tampilan Analisis' : 'Tampilan Jadwal'}</span>
          {monitoringPlanView === 'ANALYSIS' ? (
            <select value="CURVE" onChange={() => undefined}>
              <option value="CURVE">Kurva S</option>
              <option value="PIE" disabled>Diagram Lingkaran</option>
              <option value="BAR" disabled>Diagram Batang</option>
            </select>
          ) : (
            <select value="WORK_PROGRAM" onChange={() => undefined}>
              <option value="WORK_PROGRAM">Program Kerja</option>
              <option value="NETWORK" disabled>Network Planning</option>
            </select>
          )}
        </label>
        {monitoringPlanContent}
      </section>
    );

  return (
    <main className="h2a0-page">
      <button className="h2a0-back" onClick={() => navigate('/field')}>
        ← Kembali ke Daftar Proyek
      </button>

      <header className="h2a0-project-header">
        <div className="h2a0-project-overview">
          <div className="h2a0-project-identity">
            <p className="h2a0-eyebrow">Monitoring Proyek</p>
            <h1>{project.name}</h1>
          </div>
          <dl className="h2a0-project-meta">
            {project.code && (
              <div>
                <dt>Kode Paket</dt>
                <dd className="is-code">{project.code}</dd>
              </div>
            )}
            {project.status && (
              <div>
                <dt>Status Proyek</dt>
                <dd>{project.status}</dd>
              </div>
            )}
            <div>
              <dt>Baseline Aktif</dt>
              {activeMonitoringSnapshot?.baseline ? (
                <>
                  <dd>Versi {activeMonitoringSnapshot.baseline.versionNumber}</dd>
                  <small>
                    Disetujui{' '}
                    {
                      recordedAtLabel(
                        activeMonitoringSnapshot.baseline.approvedAt,
                        activeMonitoringSnapshot.projectTimeZone,
                      ).value
                    }
                  </small>
                </>
              ) : (
                <dd>TIDAK TERSEDIA</dd>
              )}
            </div>
            <div>
              <dt>Data pekerjaan sampai</dt>
              <dd>{dataThrough}</dd>
              <small>Tanggal kerja efektif terbaru</small>
            </div>
          </dl>
        </div>
        <div className="h2a0-project-header-controls">
          <ExecutionPlanReadinessPanel
            presentation="GOVERNANCE"
            projectId={project.id}
            executionPlan={executionPlan}
            realizationByBoqItemId={realizationByBoqItemId}
            progressComparisonPresentation={progressComparisonPresentation}
            onChanged={() => setExecutionPlanRefresh((current) => current + 1)}
          />
          <dl className="h2a0-project-updated">
            <div>
              <dt>Terakhir diperbarui</dt>
              <dd>{lastRecorded.value}</dd>
              {lastRecorded.basis && <small>{lastRecorded.basis}</small>}
            </div>
          </dl>
        </div>
      </header>

        <div className="h2a0-workspace">
          <section className="h2a0-anchor" aria-labelledby="h2a0-anchor-title">
            <div className="h2a0-section-heading">
              <div>
                <h2 id="h2a0-anchor-title">Daftar Uraian Pekerjaan Monitoring</h2>
              </div>
              {timeLensSelector}
            </div>

            {temporalContextMode === 'PERIODIK' &&
            activePeriodicPresentation.state !== 'RESOLVED' ? (
              <section className={`h2a0-periodic-state is-${activePeriodicPresentation.state.toLowerCase()}`}
                role={activePeriodicPresentation.state === 'ERROR' ||
                  activePeriodicPresentation.state === 'INCOHERENT' ? 'alert' : 'status'}
                aria-live="polite">
                {activePeriodicPresentation.state === 'WAITING_INPUT' && (
                  activePeriodNavigatorPresentation.state === 'UNAVAILABLE' ? (
                    <><h2>Periode belum tersedia</h2>
                      <p>{monitoringPeriodNavigatorUnavailableMessage(
                        activePeriodNavigatorPresentation.navigator.reason,
                      )}</p></>
                  ) : activePeriodNavigatorPresentation.state === 'ERROR' ? (
                    <><h2>Periode gagal dimuat</h2>
                      <p>Coba lagi dari pemilih periode atau kembali ke TERKINI.</p></>
                  ) : activePeriodNavigatorPresentation.state === 'LOADING' ? (
                    <><h2>Menyiapkan periode...</h2>
                      <p>SIMPROK sedang memuat periode resmi proyek.</p></>
                  ) : (
                    <><h2>Lengkapi konteks periode</h2>
                      <p>Pilih periode resmi untuk melihat konteks Monitoring.</p></>
                  )
                )}
                {activePeriodicPresentation.state === 'LOADING' && (
                  <><h2>Memuat konteks periode...</h2>
                    <p>SIMPROK sedang menyelesaikan batas dan fakta periode yang dipilih.</p></>
                )}
                {activePeriodicPresentation.state === 'UNAVAILABLE' && (
                  <><h2>Konteks periode belum tersedia</h2>
                    <p>{monitoringTemporalLensUnavailableMessage(
                      activePeriodicPresentation.lens.reason,
                    )}</p>
                    <small>Alasan teknis: {activePeriodicPresentation.lens.reason}</small></>
                )}
                {activePeriodicPresentation.state === 'ERROR' && (
                  <><h2>Konteks periode gagal dimuat</h2>
                    <p>Data Monitoring Terkini tetap aman. Coba lagi atau kembali ke TERKINI.</p>
                    <button type="button"
                      onClick={() => setTemporalRequestRefresh((current) => current + 1)}>
                      Coba Lagi
                    </button></>
                )}
                {activePeriodicPresentation.state === 'INCOHERENT' && (
                  <><h2>Konteks periode tidak konsisten</h2>
                    <p>Fakta periode tidak dapat ditampilkan karena konteks RAB dan periode
                      tidak konsisten. Data Terkini tetap aman.</p></>
                )}
              </section>
            ) : temporalContextMode === 'TERKINI' && !monitoring.baseline ? (
              <section className="h2a0-warning" role="status">
                <h2>Baseline aktif tidak tersedia</h2>
                <p>
                  Identitas proyek tetap dapat dilihat, tetapi RAB/WBS dan data
                  realisasi tidak ditampilkan tanpa Baseline aktif yang sah.
                </p>
              </section>
            ) : (
              <>

            {rows.length === 0 ? (
              <p className="h2a0-empty">Struktur RAB/WBS belum tersedia.</p>
            ) : (
              <div className="h2a0-table-scroll">
                <table className={temporalContextMode === 'PERIODIK'
                  ? 'h2a0-table is-periodic'
                  : 'h2a0-table'}>
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
                      {temporalContextMode === 'TERKINI' ? (
                        <><th>Realisasi Terakhir yang Berlaku</th>
                          <th>Tanggal Pekerjaan</th><th>Status Realisasi</th></>
                      ) : (
                        <><th>Rencana Periode</th><th>Realisasi Resmi Periode</th>
                          <th>Rencana s.d. Akhir Periode</th>
                          <th>Realisasi Resmi s.d. Akhir Periode</th></>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const actual = effectiveActual(row);
                      const temporalItem = temporalLensItemsById.get(row.id);
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
                          {temporalContextMode === 'TERKINI' ? (<>
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
                          </>) : (<>
                            <td data-label="Rencana Periode">
                              {isWorkItem ? plannedPeriodQuantityLabel(
                                temporalItem?.planned.periodQuantity, row.planned.unit,
                              ) : '\u2014'}
                            </td>
                            <td data-label="Realisasi Resmi Periode">
                              {isWorkItem ? temporalActualQuantityLabel(
                                temporalItem?.actual.periodOfficialQuantity, row.planned.unit,
                              ) : '\u2014'}
                            </td>
                            <td data-label="Rencana s.d. Akhir Periode">
                              {isWorkItem ? plannedPeriodQuantityLabel(
                                temporalItem?.planned.cumulativeQuantityThroughEndDate,
                                row.planned.unit,
                              ) : '\u2014'}
                            </td>
                            <td data-label="Realisasi Resmi s.d. Akhir Periode">
                              {isWorkItem ? temporalActualQuantityLabel(
                                temporalItem?.actual.cumulativeOfficialQuantityThroughEndDate,
                                row.planned.unit,
                              ) : '\u2014'}
                            </td>
                          </>)}
                        </tr>
                      );
                    })}
                  </tbody>
                  {activeMonitoringSnapshot && (
                    <tfoot>
                      <tr>
                        <th scope="row" colSpan={4}>TOTAL PROYEK</th>
                        <td data-label="Cakupan Bobot">
                          <strong>{weightCompletenessLabel(activeMonitoringSnapshot.weight)}</strong>
                        </td>
                        <td data-label="Bobot terhitung">
                          <strong>
                            {activeMonitoringSnapshot.weight.weightedWorkItemCount} /{' '}
                            {activeMonitoringSnapshot.weight.eligibleWorkItemCount} item
                          </strong>
                        </td>
                        <td
                          data-label="Progress fisik resmi"
                          colSpan={temporalContextMode === 'PERIODIK' ? 4 : 3}
                        >
                          <strong>
                            {officialProjectProgressLabel(
                              activeMonitoringSnapshot.currentOfficialRabWeightedPhysicalProgress,
                            )}
                          </strong>
                          <small>Progress fisik resmi · bukan bobot</small>
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
              </>
            )}
            <nav className="h2a0-support-actions" aria-label="Aksi penunjang Monitoring">
              <button type="button" disabled data-capability-status="ABSENT" title="Cashflow belum tersedia">
                <BarChart3 size={20} aria-hidden="true" />
                <span>Cashflow</span>
                <small>Belum tersedia</small>
              </button>
              <button type="button" disabled data-capability-status="ABSENT" title="Laporan SMKK belum tersedia">
                <ShieldCheck size={20} aria-hidden="true" />
                <span>Lap. SMKK</span>
                <small>Belum tersedia</small>
              </button>
              <button type="button" disabled data-capability-status="ABSENT" title="Laporan Harian belum tersedia">
                <FileText size={20} aria-hidden="true" />
                <span>Laporan Harian</span>
                <small>Belum tersedia</small>
              </button>
              <button type="button" disabled data-capability-status="EXISTS_BUT_NOT_READY" title="Logistik belum diaktifkan">
                <PackageSearch size={20} aria-hidden="true" />
                <span>Logistik</span>
                <small>Belum diaktifkan</small>
              </button>
            </nav>
          </section>

          <aside className="h2a0-current" aria-label="Ruang kontekstual Monitoring">
            {monitoringLensSelector}
            <div className="h2a0-right-viewport">
            {temporalContextMode === 'PERIODIK' ? (
              periodicResolvedLens ? (!selected ? (
                <div className="h2a0-project-scope">
                  <span className="h2a0-scope-badge">SELURUH PROYEK</span>
                  {monitoringPlanView === null ? (
                    <h3>{monitoringTemporalPeriodLabel(periodicResolvedLens.period)}</h3>
                  ) : (
                    <details className="h2a0-period-context-help">
                      <summary
                        aria-label={`Buka informasi periode ${monitoringTemporalPeriodLabel(periodicResolvedLens.period)}`}
                        aria-describedby="h2a0-period-context-tooltip"
                      >
                        <span className="h2a0-period-context-label">
                          {monitoringTemporalPeriodLabel(periodicResolvedLens.period)}
                        </span>
                        <span
                          id="h2a0-period-context-tooltip"
                          className="h2a0-period-context-tooltip"
                          role="tooltip"
                        >
                          <strong>
                            {monitoringPlanView === 'SCHEDULE'
                              ? 'Schedule Rencana + Realisasi Periode'
                              : 'Kurva S Rencana + Realisasi s.d. Akhir Periode'}
                          </strong>
                          <small>
                            {monitoringTemporalPeriodLabel(periodicResolvedLens.period)} {' · '}
                            {formatProjectBusinessDate(periodicResolvedLens.period.startDate)} {' - '}
                            {formatProjectBusinessDate(periodicResolvedLens.period.endDate)}
                          </small>
                        </span>
                      </summary>
                    </details>
                  )}
                  {monitoringContentLens === 'CONDITION' && (<>
                  <p>Konteks dibentuk backend dari basis dan periode resmi yang dipilih.
                    Kuantitas lintas satuan tidak dijumlahkan pada lingkup proyek.</p>
                  <dl className="h2a0-facts">
                    <div><dt>Basis</dt>
                      <dd>{monitoringTemporalBasisLabel(periodicResolvedLens.basis)}</dd></div>
                    <div><dt>Tampilan</dt>
                      <dd>{monitoringTemporalGranularityLabel(periodicResolvedLens.granularity)}</dd></div>
                    <div><dt>Rentang kanonikal</dt><dd>
                      {formatProjectBusinessDate(periodicResolvedLens.period.startDate)}
                      {' - '}
                      {formatProjectBusinessDate(periodicResolvedLens.period.endDate)}
                    </dd></div>
                    <div><dt>Baseline Aktif</dt><dd>
                      {activeMonitoringSnapshot?.baseline
                        ? `Versi ${activeMonitoringSnapshot.baseline.versionNumber}`
                        : 'TIDAK TERSEDIA'}
                    </dd></div>
                    <div><dt>Sumber Rencana</dt><dd>
                      {periodicResolvedLens.plannedSource
                        ? `Rencana Pelaksanaan versi ${periodicResolvedLens.plannedSource.versionNumber}`
                        : 'TIDAK TERSEDIA'}
                    </dd>
                      {periodicResolvedLens.plannedContext.state !== 'COMPLETE' && (
                        <small>Fakta rencana {periodicResolvedLens.plannedContext.state === 'INCOMPLETE'
                          ? 'belum lengkap.' : 'belum tersedia.'}</small>
                      )}
                    </div>
                    <div><dt>Makna Actual</dt>
                      <dd>Kebenaran resmi saat ini, disajikan kembali menurut tanggal kerja</dd></div>
                  </dl>
                  {periodicResolvedLens.weeklyRecap && (
                    <p className="h2a0-guidance">Diringkas dari{' '}
                      {periodicResolvedLens.weeklyRecap.sliceCount} irisan minggu kanonikal.</p>
                  )}
                  <p className="h2a1-weight-note">Bobot tetap menunjukkan komposisi nilai
                    Baseline RAB, bukan progress atau kinerja periode.</p>
                  </>)}
                  {monitoringContentLens === 'VISUAL' ? (
                    <section
                      className="h2a0-visual-evidence"
                      aria-labelledby="h2a0-periodic-visual-guidance-title"
                    >
                      <div className="h2a0-visual-evidence-heading">
                        <h4 id="h2a0-periodic-visual-guidance-title">
                          Visual Lapangan
                        </h4>
                        <p>
                          Pilih satu pekerjaan untuk melihat bukti yang terlampir pada
                          Actual resmi di periode ini.
                        </p>
                      </div>
                    </section>
                  ) : monitoringPlanWorkspace}
                </div>
              ) : (
                <div className="h2a0-item-scope">
                  <span className="h2a0-scope-badge">Pekerjaan {'\u00b7'} {selected.number}</span>
                  <h3>{selected.name}</h3><p className="h2a0-wbs-code">{selected.wbsCode}</p>
                  {monitoringContentLens === 'CONDITION' && (<>
                  <dl className="h2a0-facts">
                    <div><dt>Volume BOQ</dt>
                      <dd>{selected.planned.quantity} {selected.planned.unit}</dd></div>
                    <div><dt>Bobot terhadap proyek</dt>
                      <dd>{formatWeightPercentage(selected.weight.own)}</dd></div>
                    <div><dt>Bobot kumulatif RAB</dt>
                      <dd>{formatWeightPercentage(selected.weight.cumulative)}</dd></div>
                    <div><dt>Rencana Periode</dt><dd>{plannedPeriodQuantityLabel(
                      selectedTemporalItem?.planned.periodQuantity, selected.planned.unit,
                    )}</dd></div>
                    <div><dt>Realisasi Resmi Periode</dt><dd>{temporalActualQuantityLabel(
                      selectedTemporalItem?.actual.periodOfficialQuantity, selected.planned.unit,
                    )}</dd></div>
                    <div><dt>Rencana Kumulatif s.d. Akhir Periode</dt>
                      <dd>{plannedPeriodQuantityLabel(
                        selectedTemporalItem?.planned.cumulativeQuantityThroughEndDate,
                        selected.planned.unit,
                      )}</dd></div>
                    <div><dt>Realisasi Resmi Kumulatif s.d. Akhir Periode</dt>
                      <dd>{temporalActualQuantityLabel(
                        selectedTemporalItem?.actual.cumulativeOfficialQuantityThroughEndDate,
                        selected.planned.unit,
                      )}</dd></div>
                  </dl>
                  <p className="h2a1-weight-note">Bobot menunjukkan kontribusi nilai item
                    dan komposisi RAB. Nilai itu bukan persentase progress periode.</p>
                  </>)}
                  {monitoringContentLens === 'VISUAL' ? (
                    <section
                      className="h2a0-visual-evidence"
                      aria-labelledby="h2a0-periodic-visual-evidence-title"
                    >
                    <div className="h2a0-visual-evidence-heading">
                      <h4 id="h2a0-periodic-visual-evidence-title">
                        Visual Lapangan
                      </h4>
                      <p>
                        Bukti yang terlampir pada Actual resmi yang saat ini berlaku
                        dan berada pada periode terpilih.
                      </p>
                    </div>
                    {!selectedPeriodEvidence ? (
                      <p className="h2a0-visual-evidence-empty">
                        Bukti periode tidak tersedia dari snapshot kanonikal.
                      </p>
                    ) : selectedPeriodEvidence.state !== 'COMPLETE' &&
                      selectedPeriodEvidence.state !== 'INCOMPLETE' ? (
                      <p className="h2a0-visual-evidence-empty">
                        Bukti periode tidak dapat ditampilkan sebagai fakta resmi:{' '}
                        {officialFactStateLabel(selectedPeriodEvidence.state)}.
                      </p>
                    ) : (
                      <>
                        {selectedPeriodEvidence.state === 'COMPLETE' &&
                        selectedPeriodEvidence.facts.length === 0 ? (
                          <p className="h2a0-visual-evidence-empty">
                            Tidak ada Actual resmi yang berlaku pada periode ini.
                          </p>
                        ) : (
                          selectedPeriodEvidence.facts.map((fact) => {
                            const factEvidence = monitoringEvidencePresentation(
                              fact.evidenceReferences,
                            );
                            const factRecordedAt = recordedAtLabel(
                              fact.recordedAt,
                              activeMonitoringSnapshot?.projectTimeZone ?? null,
                            );
                            return (
                              <article
                                className="h2a0-period-evidence-fact"
                                key={fact.sourceActualEntryId}
                              >
                                <dl className="h2a0-visual-evidence-context">
                                  <div>
                                    <dt>Tanggal pekerjaan</dt>
                                    <dd>
                                      {formatProjectBusinessDate(fact.workDate) ||
                                        'TIDAK TERSEDIA'}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt>Dicatat di SIMPROK</dt>
                                    <dd>{factRecordedAt.value}</dd>
                                    {factRecordedAt.basis && (
                                      <small>{factRecordedAt.basis}</small>
                                    )}
                                  </div>
                                  <div>
                                    <dt>Metode pencatatan</dt>
                                    <dd>{captureMethodLabel(fact.captureMethod)}</dd>
                                  </div>
                                </dl>
                                {fact.notes?.trim() && (
                                  <p className="h2a0-visual-evidence-notes">
                                    <strong>Catatan Actual</strong>
                                    <span>{fact.notes}</span>
                                  </p>
                                )}
                                {fact.evidenceReferences.length === 0 ? (
                                  <p className="h2a0-visual-evidence-empty">
                                    Actual resmi pada periode ini belum memiliki bukti
                                    lapangan terlampir.
                                  </p>
                                ) : factEvidence.length === 0 ? (
                                  <p className="h2a0-visual-evidence-empty">
                                    Bukti lapangan pada periode ini tidak dapat
                                    ditampilkan dengan aman.
                                  </p>
                                ) : (
                                  <ul className="h2a0-visual-evidence-list">
                                    {factEvidence.map((evidence) => (
                                      <li
                                        className="h2a0-visual-evidence-card"
                                        key={`${fact.sourceActualEntryId}:${evidence.url}:${evidence.label}`}
                                      >
                                        <span>
                                          {evidence.presentation === 'IMAGE'
                                            ? 'Gambar'
                                            : evidence.presentation === 'VIDEO'
                                              ? 'Video'
                                              : 'Referensi'}
                                        </span>
                                        <h5>{evidence.label}</h5>
                                        <a
                                          href={evidence.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          aria-label={`Buka ${evidence.label} di tab baru`}
                                        >
                                          Buka bukti di tab baru
                                        </a>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </article>
                            );
                          })
                        )}
                        {selectedPeriodEvidence.state === 'INCOMPLETE' && (
                          <p className="h2a0-warning">
                            Bukti periode belum lengkap karena belum seluruh fakta
                            Actual dapat disajikan sebagai fakta resmi pada periode ini.
                          </p>
                        )}
                      </>
                    )}
                    </section>
                  ) : monitoringPlanWorkspace}
                </div>
              )) : (
                <div className="h2a0-project-scope">
                  <p className="h2a0-guidance">
                    Detail periode akan tampil setelah SIMPROK menyelesaikan
                    konteks periode yang dipilih.
                  </p>
                </div>
              )
            ) : !selected ? (
              <div className="h2a0-project-scope">
                <span className="h2a0-scope-badge">SELURUH PROYEK</span>
                <h3>{project.name}</h3>
                {monitoringContentLens === 'CONDITION' && (<>
                <p>
                  {effectiveItemCount} dari {workItemCount} item pekerjaan mempunyai
                  catatan realisasi yang berlaku. Ini adalah hitungan ketersediaan
                  data, bukan persentase kemajuan proyek.
                </p>
                <dl className="h2a0-facts">
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
                    <dt>Progress fisik resmi RAB</dt>
                    <dd>
                      {officialProjectProgressLabel(
                        monitoring.currentOfficialRabWeightedPhysicalProgress,
                      )}
                    </dd>
                  </div>
                </dl>
                <p className="h2a0-guidance">
                  Pilih satu item pekerjaan pada struktur RAB/WBS untuk melihat
                  catatan realisasi yang berlaku tanpa meninggalkan orientasi proyek.
                </p>
                </>)}
                {monitoringContentLens === 'VISUAL' ? (
                  <section
                    className="h2a0-visual-evidence"
                    aria-labelledby="h2a0-visual-guidance-title"
                  >
                    <div className="h2a0-visual-evidence-heading">
                      <h4 id="h2a0-visual-guidance-title">Visual Lapangan</h4>
                      <p>
                        Pilih satu pekerjaan untuk melihat bukti lapangan yang melekat
                        pada Actual yang berlaku.
                      </p>
                    </div>
                  </section>
                ) : monitoringPlanWorkspace}
              </div>
            ) : (
              <div className="h2a0-item-scope">
                <span className="h2a0-scope-badge">Pekerjaan · {selected.number}</span>
                <h3>{selected.name}</h3>
                <p className="h2a0-wbs-code">{selected.wbsCode}</p>
                {monitoringContentLens === 'CONDITION' && (<>
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
                    <dt>Volume resmi untuk perhitungan</dt>
                    <dd>
                      {officialQuantityLabel(
                        selected.currentOfficialQuantity,
                        selected.planned.unit,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Progress fisik resmi</dt>
                    <dd>
                      {officialItemProgressLabel(
                        selected.currentOfficialItemProgress,
                      )}
                    </dd>
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
                  Realisasi Terakhir yang Berlaku adalah catatan aktual yang
                  saat ini berlaku. Nilai ini berbeda dari Volume resmi untuk
                  perhitungan dan Progress fisik resmi yang ditetapkan oleh
                  aturan perhitungan backend.
                </p>
                <p className="h2a1-weight-note">
                  Bobot menunjukkan kontribusi nilai item terhadap total nilai dasar
                  Baseline RAB. Bobot kumulatif menunjukkan komposisi RAB sesuai
                  urutan pekerjaan, bukan persentase kemajuan atau perkembangan
                  terhadap waktu.
                </p>
                </>)}
                {monitoringContentLens === 'VISUAL' ? (
                  <section
                    className="h2a0-visual-evidence"
                    aria-labelledby="h2a0-visual-evidence-title"
                  >
                  <div className="h2a0-visual-evidence-heading">
                    <h4 id="h2a0-visual-evidence-title">Visual Lapangan</h4>
                    <p>
                      Bukti yang terlampir pada Actual yang berlaku untuk pekerjaan ini.
                    </p>
                  </div>
                  {!selectedActual ? (
                    <p className="h2a0-visual-evidence-empty">
                      Belum ada Actual yang berlaku untuk pekerjaan ini.
                    </p>
                  ) : (
                    <>
                      <dl className="h2a0-visual-evidence-context">
                        <div>
                          <dt>Tanggal pekerjaan</dt>
                          <dd>
                            {formatProjectBusinessDate(selectedActual.workDate) ||
                              'TIDAK TERSEDIA'}
                          </dd>
                        </div>
                        <div>
                          <dt>Dicatat di SIMPROK</dt>
                          <dd>{selectedRecordedAt.value}</dd>
                        </div>
                        <div>
                          <dt>Metode pencatatan</dt>
                          <dd>{captureMethodLabel(selectedActual.captureMethod)}</dd>
                        </div>
                      </dl>
                      {selectedActual.notes?.trim() && (
                        <p className="h2a0-visual-evidence-notes">
                          <strong>Catatan Actual</strong>
                          <span>{selectedActual.notes}</span>
                        </p>
                      )}
                      {Array.isArray(selectedEvidenceReferences) &&
                      selectedEvidenceReferences.length === 0 ? (
                        <p className="h2a0-visual-evidence-empty">
                          Actual yang berlaku belum memiliki bukti lapangan terlampir.
                        </p>
                      ) : selectedEvidence.length === 0 ? (
                        <p className="h2a0-visual-evidence-empty">
                          Bukti lapangan terlampir tidak dapat ditampilkan dengan aman.
                        </p>
                      ) : (
                        <ul className="h2a0-visual-evidence-list">
                          {selectedEvidence.map((evidence) => (
                            <li
                              className="h2a0-visual-evidence-card"
                              key={`${evidence.url}\u0000${evidence.label}`}
                            >
                              <span>
                                {evidence.presentation === 'IMAGE'
                                  ? 'Gambar'
                                  : evidence.presentation === 'VIDEO'
                                    ? 'Video'
                                    : 'Referensi'}
                              </span>
                              <h5>{evidence.label}</h5>
                              <a
                                href={evidence.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={`Buka ${evidence.label} di tab baru`}
                              >
                                Buka bukti di tab baru
                              </a>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                  </section>
                ) : monitoringPlanWorkspace}
                {/*
                  ACTION HIERARCHY — this door stands last on purpose.
                  Lihat Kondisi -> Lihat Bukti -> Pahami Angka -> Pahami Penyebab
                  -> Ambil Tindakan. It is offered only under TERKINI; a periodic
                  window is read-only and exposes no Actual mutation door.
                */}
                {monitoringContentLens === 'CONDITION' &&
                monitoringTimeLensAllowsActualAction(activeTimeLens) && (
                  <button
                    className="h2a0-detail-action"
                    onClick={() =>
                      navigate(progressDetailPath(project.id, selected.id))
                    }
                  >
                    {hasPermission('FIELD_PROGRESS_SUBMIT')
                      ? 'Catat / Kelola Actual'
                      : 'Lihat Riwayat Actual'}
                  </button>
                )}
              </div>
            )}
            </div>
            <footer className="h2a0-interaction-dock" aria-label="Ruang Interaksi SIMPROK">
              <label htmlFor="h2a0-interaction-input">
                <MessageSquare size={16} aria-hidden="true" />
                Tanyakan ke SIMPROK...
              </label>
              <div className="h2a0-interaction-input-row">
                <input
                  id="h2a0-interaction-input"
                  type="text"
                  placeholder="Tanyakan ke SIMPROK..."
                  disabled
                  title="Ruang interaksi belum aktif"
                />
                <button type="button" disabled aria-label="Kirim pertanyaan" title="Ruang interaksi belum aktif">
                  <Send size={17} aria-hidden="true" />
                </button>
              </div>
            </footer>
          </aside>
        </div>
    </main>
  );
}
