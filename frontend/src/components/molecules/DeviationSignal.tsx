import React from 'react';
import { NumericFact } from '../atoms/NumericFact';

interface DeviationSignalProps {
  label: string;
  plannedValue: number;
  actualValue: number;
  unit?: string;
  lowerIsBetter?: boolean;
}

export function DeviationSignal({ 
  label, 
  plannedValue, 
  actualValue, 
  unit = '',
  lowerIsBetter = false 
}: DeviationSignalProps) {
  
  const variance = actualValue - plannedValue;
  const isPositiveVariance = lowerIsBetter ? variance <= 0 : variance >= 0;
  const varianceColor = isPositiveVariance ? 'var(--simprok-success-green-600)' : 'var(--simprok-critical-red-600)';
  const varianceSign = variance > 0 ? '+' : '';

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-2)',
      padding: 'var(--space-3)',
      backgroundColor: 'var(--simprok-surface-light)',
      borderRadius: 'var(--radius-sm)',
      border: '1px solid var(--simprok-engineering-blue-200)'
    }}>
      <span style={{ 
        fontSize: 'var(--text-xs)', 
        fontWeight: 'var(--weight-medium)', 
        color: 'var(--simprok-engineering-blue-700)',
        textTransform: 'uppercase'
      }}>
        {label}
      </span>
      
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 'var(--space-4)', alignItems: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--simprok-engineering-blue-700)' }}>Planned (C2)</span>
          <NumericFact value={plannedValue} suffix={unit} certaintyLevel="C2" size="sm" />
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--simprok-engineering-blue-700)' }}>Actual (C3)</span>
          <NumericFact value={actualValue} suffix={unit} certaintyLevel="C3" size="sm" />
        </div>

        <div style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'flex-end',
          paddingLeft: 'var(--space-4)',
          borderLeft: '1px solid var(--simprok-engineering-blue-200)'
        }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--simprok-engineering-blue-700)' }}>Variance</span>
          <span 
            className="simprok-numeric certainty-c4" 
            style={{ color: varianceColor, fontSize: 'var(--text-base)' }}
          >
            {varianceSign}{variance}{unit}
          </span>
        </div>
      </div>
    </div>
  );
}
