import React from 'react';
import { RiskIndicator } from '../atoms/RiskIndicator';
import { NumericFact } from '../atoms/NumericFact';

interface RiskCardProps {
  title: string;
  category: string;
  trigger: string;
  probability: number; // percentage
  impact: number; // cost impact
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: string;
  owner: string;
  detectionDate: string;
}

export function RiskCard({
  title,
  category,
  trigger,
  probability,
  impact,
  severity,
  status,
  owner,
  detectionDate
}: RiskCardProps) {
  
  // Risk Score = Probability * Impact
  const riskScore = (probability / 100) * impact;

  return (
    <div className="simprok-fact-card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* Header: Title and Severity Indicator */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--simprok-engineering-blue-100)', paddingBottom: 'var(--space-3)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--simprok-engineering-blue-700)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {category} | Status: {status}
          </span>
          <h3 style={{ fontSize: 'var(--text-lg)', color: 'var(--simprok-engineering-blue-900)', fontWeight: 'var(--weight-semibold)', margin: 0 }}>
            {title}
          </h3>
        </div>
        <RiskIndicator message={severity} severity={severity} />
      </div>

      {/* Body: Trigger, Probability, Impact, Score */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--simprok-engineering-blue-700)' }}>Trigger Event</span>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--simprok-engineering-blue-900)', fontWeight: 'var(--weight-medium)' }}>{trigger}</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-4)', backgroundColor: 'var(--simprok-surface-light)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--simprok-engineering-blue-700)' }}>Probability</span>
            <NumericFact value={probability} suffix="%" size="sm" certaintyLevel="C2" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--simprok-engineering-blue-700)' }}>Cost Impact</span>
            <NumericFact value={impact} prefix="Rp " size="sm" certaintyLevel="C1" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', borderLeft: '1px solid var(--simprok-engineering-blue-200)', paddingLeft: 'var(--space-4)' }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--simprok-engineering-blue-700)' }}>Risk Score Exposure</span>
            <NumericFact value={riskScore} prefix="Rp " size="md" certaintyLevel="C2" />
          </div>
        </div>
      </div>

      {/* Footer: Owner and Detection Date */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--simprok-engineering-blue-100)' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--simprok-engineering-blue-700)' }}>Risk Owner</span>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--simprok-engineering-blue-900)', fontWeight: 'var(--weight-medium)' }}>{owner}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--simprok-engineering-blue-700)' }}>Detected</span>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--simprok-engineering-blue-900)', fontWeight: 'var(--weight-medium)', fontFamily: 'var(--font-mono)' }}>{detectionDate}</span>
        </div>
      </div>
    </div>
  );
}
