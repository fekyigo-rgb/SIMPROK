import { NumericFact } from '../atoms/NumericFact';
import { CertaintyBadge } from '../atoms/CertaintyBadge';

interface ForecastCardProps {
  title: string;
  scenarioDescription: string;
  eac: number; // Estimate at Completion (Cost)
  etc: number; // Estimate to Complete (Cost)
  projectedFinishDate: string;
  confidencePercentage: number;
  certaintyLevel: 'C1' | 'C2';
}

export function ForecastCard({
  title,
  scenarioDescription,
  eac,
  etc,
  projectedFinishDate,
  confidencePercentage,
  certaintyLevel
}: ForecastCardProps) {
  
  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      gap: 'var(--space-4)',
      backgroundColor: 'var(--simprok-surface-light)',
      border: '1px dashed var(--simprok-engineering-blue-200)', // RULE-001: Visually distinguishable from measured reality
      borderRadius: 'var(--radius-sm)',
      padding: 'var(--space-4)'
    }}>
      {/* Header: Title and Certainty */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px dashed var(--simprok-engineering-blue-200)', paddingBottom: 'var(--space-3)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--simprok-engineering-blue-700)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Forecast Scenario
          </span>
          <h3 style={{ fontSize: 'var(--text-lg)', color: 'var(--simprok-engineering-blue-900)', fontWeight: 'var(--weight-semibold)', margin: 0, fontStyle: 'italic' }}>
            {title}
          </h3>
        </div>
        <CertaintyBadge level={certaintyLevel} />
      </div>

      {/* Body: Scenario Description */}
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--simprok-engineering-blue-700)', fontStyle: 'italic', margin: 0 }}>
        "{scenarioDescription}"
      </p>

      {/* Body: Projected Financials */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginTop: 'var(--space-2)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--simprok-engineering-blue-700)' }}>EAC (Estimate At Completion)</span>
          <NumericFact value={eac} prefix="Rp " size="lg" certaintyLevel={certaintyLevel} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--simprok-engineering-blue-700)' }}>ETC (Estimate To Complete)</span>
          <NumericFact value={etc} prefix="Rp " size="md" certaintyLevel={certaintyLevel} />
        </div>
      </div>

      {/* Footer: Date and Confidence */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 'var(--space-3)', borderTop: '1px dashed var(--simprok-engineering-blue-200)' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--simprok-engineering-blue-700)' }}>Projected Finish Date</span>
          <span className={`certainty-${certaintyLevel.toLowerCase()}`} style={{ fontSize: 'var(--text-sm)', color: 'var(--simprok-engineering-blue-900)', fontFamily: 'var(--font-mono)' }}>
            {projectedFinishDate}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--simprok-engineering-blue-700)' }}>Statistical Confidence</span>
          <NumericFact value={confidencePercentage} suffix="%" size="sm" certaintyLevel={certaintyLevel} />
        </div>
      </div>
    </div>
  );
}
