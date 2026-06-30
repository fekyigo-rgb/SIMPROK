import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ProgressCard } from '../components/organisms/ProgressCard';
import { RiskCard } from '../components/organisms/RiskCard';
import { ForecastCard } from '../components/organisms/ForecastCard';
import { RecommendationCard } from '../components/organisms/RecommendationCard';
import { Button } from '../components/atoms/Button';
import { useAuth } from '../contexts/AuthContext';
import { DeviationSignal } from '../components/molecules/DeviationSignal';
import { apiFetch } from '../utils/apiClient';

type RoomType = 'HUB' | 'REALITY' | 'HORIZON' | 'STORM' | 'WISDOM' | 'AUTHORITY' | 'LOGISTICS';

export function ProjectWarRoomPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { token } = useAuth();
  const [activeRoom, setActiveRoom] = useState<RoomType>('HUB');

  const [project, setProject] = useState<any>(null);
  const [reality, setReality] = useState<any>(null);
  const [horizon, setHorizon] = useState<any>(null);
  const [storm, setStorm] = useState<any[]>([]);
  const [wisdom, setWisdom] = useState<any[]>([]);
  const [authority, setAuthority] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchIntelligence() {
      try {
        const [projRes, realRes, horzRes, stormRes, wisRes, authRes] = await Promise.all([
          apiFetch(`http://localhost:3000/projects/${id}`),
          apiFetch(`http://localhost:3000/projects/${id}/reality`),
          apiFetch(`http://localhost:3000/projects/${id}/horizon`),
          apiFetch(`http://localhost:3000/projects/${id}/storm`),
          apiFetch(`http://localhost:3000/projects/${id}/wisdom`),
          apiFetch(`http://localhost:3000/projects/${id}/authority`)
        ]);

        if (!projRes.ok) throw new Error('Failed to fetch project details');

        setProject(await projRes.json());
        setReality(await realRes.json());
        setHorizon(await horzRes.json());
        setStorm(await stormRes.json());
        setWisdom(await wisRes.json());
        setAuthority(await authRes.json());
        setLoading(false);
      } catch (error) {
        console.error('Intelligence Fetch Failed:', error);
        setLoading(false);
      }
    }
    if (token) {
      fetchIntelligence();
    }
  }, [id, token]);

  if (loading) return <div style={{ padding: 'var(--space-8)' }}>Initializing Project Intelligence...</div>;
  if (!project) return <div style={{ padding: 'var(--space-8)' }}>Project Reality Not Found.</div>;

  const tabs: { id: RoomType; label: string; alert?: boolean }[] = [
    { id: 'HUB', label: 'War Room Hub' },
    { id: 'REALITY', label: 'Reality' },
    { id: 'HORIZON', label: 'Horizon' },
    { id: 'STORM', label: 'Storm', alert: storm?.length > 0 },
    { id: 'WISDOM', label: 'Wisdom' },
    { id: 'AUTHORITY', label: 'Authority', alert: authority?.some(a => a.status === 'RECORDED') },
    { id: 'LOGISTICS', label: 'Logistics' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      
      {/* PHASE 2: BREADCRUMB & RETURN PATH */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-sm)', color: 'var(--simprok-engineering-blue-700)' }}>
        <span onClick={() => navigate('/')} style={{ cursor: 'pointer', fontWeight: 'var(--weight-semibold)' }}>Observatory</span>
        <span>›</span>
        <span>{project.name}</span>
        <span>›</span>
        <span style={{ color: 'var(--simprok-engineering-blue-900)', fontWeight: 'var(--weight-bold)' }}>War Room</span>
      </div>

      <div style={{ backgroundColor: 'var(--simprok-white)', padding: 'var(--space-6)', borderRadius: 'var(--radius-lg)', boxShadow: '0 0 12px rgba(14, 165, 233, 0.25), 0 4px 6px rgba(0,0,0,0.05)', border: '1px solid var(--simprok-bright-sky-blue-500)', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
        
        {/* PHASE 2: PROJECT HEADER */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--simprok-engineering-blue-700)', fontFamily: 'var(--font-mono)' }}>{project.code}</span>
            <h2 style={{ fontSize: 'var(--text-3xl)', color: 'var(--simprok-engineering-blue-900)', fontWeight: 'var(--weight-bold)', margin: 0 }}>
              {project.name}
            </h2>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--simprok-engineering-blue-700)', marginTop: 'var(--space-1)' }}>
              Status: <strong style={{ color: project.status === 'CRITICAL' ? 'var(--simprok-critical-red-600)' : 'var(--simprok-success-green-600)' }}>{project.status}</strong>
            </span>
          </div>
        </div>

        {/* PHASE 3: ROOM NAVIGATION */}
        <div style={{ display: 'flex', gap: 'var(--space-2)', borderBottom: '2px solid var(--simprok-engineering-blue-100)', paddingBottom: 'var(--space-4)', overflowX: 'auto' }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveRoom(tab.id)}
              style={{
                padding: 'var(--space-2) var(--space-4)',
                backgroundColor: activeRoom === tab.id ? 'var(--simprok-engineering-blue-900)' : 'var(--simprok-surface-light)',
                color: activeRoom === tab.id ? 'var(--simprok-white)' : 'var(--simprok-engineering-blue-700)',
                border: '1px solid',
                borderColor: activeRoom === tab.id ? 'var(--simprok-engineering-blue-900)' : 'var(--simprok-engineering-blue-200)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--text-sm)',
                fontWeight: activeRoom === tab.id ? 'var(--weight-bold)' : 'var(--weight-medium)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                transition: 'all 0.2s ease'
              }}
            >
              {tab.label}
              {tab.alert && (
                <span style={{ 
                  width: '8px', 
                  height: '8px', 
                  backgroundColor: 'var(--simprok-critical-red-600)', 
                  borderRadius: '50%',
                  display: 'inline-block'
                }} />
              )}
            </button>
          ))}
        </div>

        {/* ROOM CONTENT AREA */}
        <div style={{ minHeight: '400px' }}>
          
          {activeRoom === 'HUB' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
              <p style={{ fontSize: 'var(--text-lg)', color: 'var(--simprok-engineering-blue-800)', margin: 0 }}>
                Welcome to the Project War Room. <br/>
                <strong>Status:</strong> There are {storm?.length || 0} active alerts in the <span style={{color: 'var(--simprok-critical-red-600)'}}>Storm Room</span> requiring an <span style={{color: 'var(--simprok-engineering-blue-800)'}}>Authority Decision</span>.
              </p>
              <div style={{ padding: 'var(--space-4)', backgroundColor: 'var(--simprok-bright-sky-blue-50)', borderLeft: '4px solid var(--simprok-bright-sky-blue-500)', borderRadius: 'var(--radius-sm)' }}>
                <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', textTransform: 'uppercase', color: 'var(--simprok-bright-sky-blue-600)' }}>Quick Action Required</span>
                <p style={{ margin: 'var(--space-2) 0 0 0', fontSize: 'var(--text-sm)' }}>Please review the Storm Room for weather delays, then proceed to the Wisdom Room for system recommendations.</p>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-start', paddingTop: 'var(--space-4)' }}>
                <Button onClick={() => setActiveRoom('REALITY')}>Start Journey: Enter Reality Room →</Button>
              </div>
            </div>
          )}

          {activeRoom === 'REALITY' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--simprok-engineering-blue-700)', textTransform: 'uppercase', fontWeight: 'var(--weight-bold)', letterSpacing: '0.05em' }}>Reality Room</span>
                <button 
                  onClick={() => navigate(`/field/project/${id}`)}
                  style={{ padding: '6px 12px', backgroundColor: 'var(--simprok-engineering-blue-800)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: 'var(--text-xs)', fontWeight: 'bold' }}>
                  📡 Launch Field Terminal
                </button>
              </div>
              {reality ? (
                <ProgressCard 
                  itemName="Overall Project Execution"
                  itemCode="WBS-ROOT"
                  weight={100}
                  plannedProgress={parseFloat(reality.overallPlannedProgress) || 0}
                  actualProgress={parseFloat(reality.overallActualProgress) || 0}
                  plannedCost={parseFloat(reality.overallPlannedCost) || 0}
                  actualCost={parseFloat(reality.overallActualCost) || 0}
                  actualCostRecorded={(parseFloat(reality.overallActualCost) || 0) > 0}
                  certaintyLevel="C4"
                />
              ) : <p>No reality data logged yet.</p>}
              
              {/* DEVIATION SIGNALS */}
              {reality?.deviationSignals && reality.deviationSignals.length > 0 && (
                <div style={{ marginTop: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--simprok-engineering-blue-700)', fontWeight: 'var(--weight-bold)' }}>Observed Deviations</span>
                  {reality.deviationSignals.map((signal: any) => (
                    <div key={signal.id} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                      <DeviationSignal 
                        label={signal.type + ' DEVIATION'}
                        plannedValue={reality.overallPlannedProgress} // Mocked for UI, actual variance is computed in backend
                        actualValue={reality.overallActualProgress}
                        unit="%"
                        lowerIsBetter={false}
                      />
                      <div style={{ padding: 'var(--space-2) var(--space-3)', backgroundColor: signal.severity === 'WARNING' ? '#FEF3C7' : 'var(--simprok-surface-light)', borderRadius: 'var(--radius-sm)', border: '1px solid', borderColor: signal.severity === 'WARNING' ? '#F59E0B' : 'var(--simprok-engineering-blue-200)' }}>
                        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: signal.severity === 'WARNING' ? '#B45309' : 'var(--simprok-engineering-blue-700)', display: 'block', marginBottom: '4px' }}>SIMPROK SIGNAL ({signal.severity})</span>
                        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--simprok-text-main)' }}>{signal.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--simprok-engineering-blue-100)' }}>
                <Button onClick={() => setActiveRoom('HORIZON')}>Proceed to Horizon Room (Forecast) →</Button>
              </div>
            </div>
          )}

          {activeRoom === 'HORIZON' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--simprok-engineering-blue-700)', textTransform: 'uppercase', fontWeight: 'var(--weight-bold)', letterSpacing: '0.05em' }}>Horizon Room — Forecast</span>
                <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', backgroundColor: '#FEF3C7', color: '#92400E', padding: '2px 8px', borderRadius: '4px', fontWeight: 'var(--weight-bold)' }}>⚠ DATA SOURCE: SEED ONLY</span>
              </div>
              <div style={{ padding: 'var(--space-4)', backgroundColor: '#FFFBEB', border: '1px solid #F59E0B', borderRadius: 'var(--radius-sm)' }}>
                <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: '#92400E', fontWeight: 'var(--weight-semibold)' }}>Forecast Engine Not Yet Activated</p>
                <p style={{ margin: '4px 0 0', fontSize: 'var(--text-xs)', color: '#B45309' }}>Data shown below is seeded verification data, not derived from project execution. A Forecast Engine must be activated before Horizon Room can be trusted.</p>
              </div>
              {horizon ? (
                <ForecastCard 
                  title="[UNVERIFIED] Projected Baseline Breach"
                  scenarioDescription="[SEED DATA — NOT INTELLIGENCE] This is placeholder forecast data created during system verification."
                  eac={parseFloat(horizon.eacCost) || 0}
                  etc={parseFloat(horizon.etcCost) || 0}
                  projectedFinishDate={horizon.projectedEndDate}
                  confidencePercentage={0}
                  certaintyLevel="C0"
                />
              ) : <p>No forecast data available.</p>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--simprok-engineering-blue-100)' }}>
                <Button onClick={() => setActiveRoom('STORM')} style={{ backgroundColor: 'var(--simprok-critical-red-600)' }}>Proceed to Storm Room (Risk) →</Button>
              </div>
            </div>
          )}

          {activeRoom === 'STORM' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--simprok-engineering-blue-700)', textTransform: 'uppercase', fontWeight: 'var(--weight-bold)', letterSpacing: '0.05em' }}>Storm Room — Risk</span>
                <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', backgroundColor: '#FEF3C7', color: '#92400E', padding: '2px 8px', borderRadius: '4px', fontWeight: 'var(--weight-bold)' }}>⚠ DATA SOURCE: SEED ONLY</span>
              </div>
              <div style={{ padding: 'var(--space-4)', backgroundColor: '#FFFBEB', border: '1px solid #F59E0B', borderRadius: 'var(--radius-sm)' }}>
                <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: '#92400E', fontWeight: 'var(--weight-semibold)' }}>Risk Engine Not Yet Activated</p>
                <p style={{ margin: '4px 0 0', fontSize: 'var(--text-xs)', color: '#B45309' }}>Risks shown are seeded verification data. A Risk Detection Engine must be activated before Storm Room can be trusted.</p>
              </div>
              {storm?.length > 0 ? storm.map((r: any) => (
                <RiskCard 
                  key={r.id}
                  title={`[SEED] ${r.title}`}
                  category={r.category}
                  trigger={r.description}
                  probability={parseFloat(r.probability) * 100}
                  impact={parseFloat(r.impact) || 0}
                  severity={r.classification}
                  status={r.status}
                  owner="Not Verified"
                  detectionDate={r.createdAt}
                />
              )) : <p>No active risks detected.</p>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--simprok-engineering-blue-100)' }}>
                <Button onClick={() => setActiveRoom('WISDOM')} style={{ backgroundColor: 'var(--simprok-glory-purple-500)' }}>Proceed to Wisdom (Recommendations) →</Button>
              </div>
            </div>
          )}

          {activeRoom === 'WISDOM' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--simprok-glory-purple-500)', textTransform: 'uppercase', fontWeight: 'var(--weight-bold)', letterSpacing: '0.05em' }}>Wisdom Room — Recommendations</span>
                <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', backgroundColor: '#FEF3C7', color: '#92400E', padding: '2px 8px', borderRadius: '4px', fontWeight: 'var(--weight-bold)' }}>⚠ DATA SOURCE: SEED ONLY</span>
              </div>
              <div style={{ padding: 'var(--space-4)', backgroundColor: '#FFFBEB', border: '1px solid #F59E0B', borderRadius: 'var(--radius-sm)' }}>
                <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: '#92400E', fontWeight: 'var(--weight-semibold)' }}>Recommendation Engine Not Yet Activated</p>
                <p style={{ margin: '4px 0 0', fontSize: 'var(--text-xs)', color: '#B45309' }}>Recommendations shown are seeded verification data. A Recommendation Engine must be activated before Wisdom Room can be trusted.</p>
              </div>
              {wisdom?.length > 0 ? wisdom.map((w: any) => (
                <RecommendationCard 
                  key={w.id}
                  realityStatement={`[SEED] ${w.context}`}
                  understandingStatement={w.analysis}
                  options={w.options.map((opt: any) => ({
                    id: opt.id,
                    title: opt.description,
                    impactDescription: opt.expectedImpact,
                    isPrimary: opt.rank === 1
                  }))}
                />
              )) : <p>No recommendations available.</p>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 'var(--space-4)' }}>
                <Button onClick={() => setActiveRoom('AUTHORITY')} style={{ backgroundColor: 'var(--simprok-engineering-blue-800)' }}>Proceed to Authority Decision →</Button>
              </div>
            </div>
          )}

          {activeRoom === 'AUTHORITY' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--simprok-engineering-blue-800)', textTransform: 'uppercase', fontWeight: 'var(--weight-bold)', letterSpacing: '0.05em' }}>Authority Room</span>
                <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', backgroundColor: '#EDE9FE', color: '#5B21B6', padding: '2px 8px', borderRadius: '4px', fontWeight: 'var(--weight-bold)' }}>ENGINE NOT ACTIVATED</span>
              </div>
              <div style={{ padding: 'var(--space-6)', backgroundColor: 'var(--simprok-engineering-blue-50)', border: '1px dashed var(--simprok-engineering-blue-300)', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
                <span style={{ fontSize: 'var(--text-2xl)' }}>🔒</span>
                <p style={{ margin: '8px 0 4px', fontSize: 'var(--text-base)', fontWeight: 'var(--weight-semibold)', color: 'var(--simprok-engineering-blue-800)' }}>Authority Engine Not Yet Activated</p>
                <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--simprok-engineering-blue-500)' }}>Approval workflows and authority matrices require an engine activation step. No approval data is being tracked in the current system.</p>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--simprok-engineering-blue-100)' }}>
                <Button onClick={() => setActiveRoom('LOGISTICS')} style={{ backgroundColor: 'var(--simprok-success-green-600)' }}>Proceed to Logistics →</Button>
              </div>
            </div>
          )}

          {activeRoom === 'LOGISTICS' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--simprok-success-green-600)', textTransform: 'uppercase', fontWeight: 'var(--weight-bold)', letterSpacing: '0.05em' }}>Logistics Room</span>
                <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', backgroundColor: '#EDE9FE', color: '#5B21B6', padding: '2px 8px', borderRadius: '4px', fontWeight: 'var(--weight-bold)' }}>ENGINE NOT ACTIVATED</span>
              </div>
              <div style={{ padding: 'var(--space-6)', backgroundColor: 'var(--simprok-engineering-blue-50)', border: '1px dashed var(--simprok-engineering-blue-300)', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
                <span style={{ fontSize: 'var(--text-2xl)' }}>📦</span>
                <p style={{ margin: '8px 0 4px', fontSize: 'var(--text-base)', fontWeight: 'var(--weight-semibold)', color: 'var(--simprok-engineering-blue-800)' }}>Logistics Engine Not Yet Activated</p>
                <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--simprok-engineering-blue-500)' }}>Contract tracking, procurement, and logistics execution require an engine activation step. No logistics data is being tracked in the current system.</p>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--simprok-engineering-blue-100)' }}>
                <Button onClick={() => setActiveRoom('HUB')} variant="secondary">↺ Return to War Room Hub</Button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
