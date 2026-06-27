import { NumericFact } from '../atoms/NumericFact';
import { CertaintyBadge } from '../atoms/CertaintyBadge';

interface FactHeaderProps {
  label: string;
  value: string | number;
  certaintyLevel: 'C0' | 'C1' | 'C2' | 'C3' | 'C4' | 'C5';
  prefix?: string;
  suffix?: string;
  showBadge?: boolean;
}

export function FactHeader({ 
  label, 
  value, 
  certaintyLevel, 
  prefix, 
  suffix,
  showBadge = true 
}: FactHeaderProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ 
          fontSize: 'var(--text-sm)', 
          color: 'var(--simprok-engineering-blue-700)',
          fontWeight: 'var(--weight-medium)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em'
        }}>
          {label}
        </span>
        {showBadge && <CertaintyBadge level={certaintyLevel} />}
      </div>
      <NumericFact 
        value={value} 
        certaintyLevel={certaintyLevel} 
        prefix={prefix} 
        suffix={suffix} 
        size="lg" 
      />
    </div>
  );
}
