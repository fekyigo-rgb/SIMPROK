import React from 'react';
import { InsightHeader } from '../molecules/InsightHeader';
import { Button } from '../atoms/Button';
import { GloryAccent } from '../atoms/GloryAccent';

interface RecommendationOption {
  id: string;
  title: string;
  impactDescription: string;
  isPrimary?: boolean;
}

interface RecommendationCardProps {
  realityStatement: string; // What happened
  understandingStatement: string; // Why did it happen
  options: RecommendationOption[]; // What options are available
}

export function RecommendationCard({
  realityStatement,
  understandingStatement,
  options
}: RecommendationCardProps) {
  
  return (
    <div className="simprok-insight-card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      
      {/* GLORY HEADER: Announcing Wisdom */}
      <InsightHeader 
        label="SIMPROK Wisdom" 
        title="Intervention Recommended" 
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', paddingLeft: 'var(--space-4)', borderLeft: '2px solid var(--simprok-engineering-blue-100)' }}>
        
        {/* SECTION 1: REALITY (What happened?) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--simprok-engineering-blue-700)', textTransform: 'uppercase' }}>1. Reality Observation</span>
          <p style={{ fontSize: 'var(--text-base)', color: 'var(--simprok-engineering-blue-900)', margin: 0 }}>
            {realityStatement}
          </p>
        </div>

        {/* SECTION 2: UNDERSTANDING (Why did it happen?) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--simprok-engineering-blue-700)', textTransform: 'uppercase' }}>2. Synthesis & Understanding</span>
          <p style={{ fontSize: 'var(--text-base)', color: 'var(--simprok-engineering-blue-800)', fontStyle: 'italic', margin: 0 }}>
            {understandingStatement}
          </p>
        </div>

      </div>

      {/* SECTION 3: WISDOM (What options are available?) */}
      {/* Wrapped in Glory Accent to highlight the system's generated options */}
      <div style={{ backgroundColor: 'var(--simprok-glory-purple-50)', padding: 'var(--space-4)', borderRadius: 'var(--radius-sm)' }}>
        <GloryAccent label="3. Strategic Options">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
            {options.map((opt, idx) => (
              <div key={opt.id} style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start', padding: 'var(--space-3)', backgroundColor: 'var(--simprok-white)', border: opt.isPrimary ? '1px solid var(--simprok-glory-purple-500)' : '1px solid var(--simprok-engineering-blue-200)', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '24px', height: '24px', borderRadius: '50%', backgroundColor: opt.isPrimary ? 'var(--simprok-glory-purple-500)' : 'var(--simprok-engineering-blue-200)', color: opt.isPrimary ? 'var(--simprok-white)' : 'var(--simprok-engineering-blue-800)', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)' }}>
                  {idx + 1}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: 'var(--simprok-engineering-blue-900)' }}>{opt.title}</span>
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--simprok-engineering-blue-700)' }}>{opt.impactDescription}</span>
                </div>
              </div>
            ))}
          </div>
        </GloryAccent>
      </div>

      {/* SECTION 4: HUMAN AUTHORITY (Decision) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--simprok-engineering-blue-200)' }}>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--simprok-engineering-blue-700)', textTransform: 'uppercase', textAlign: 'center' }}>
          4. Human Authority Required
        </span>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--space-3)' }}>
          <Button variant="secondary">Reject Intervention</Button>
          <Button variant="override">Override (Manual Route)</Button>
          <Button variant="primary">Approve Option 1</Button>
        </div>
      </div>

    </div>
  );
}
