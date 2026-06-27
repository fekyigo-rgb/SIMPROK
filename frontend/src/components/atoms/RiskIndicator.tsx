import { AlertTriangle } from 'lucide-react';

interface RiskIndicatorProps {
  message: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export function RiskIndicator({ message, severity }: RiskIndicatorProps) {
  // CRITICAL RED is reserved ONLY for CRITICAL risk.
  const isCritical = severity === 'CRITICAL';
  
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 'var(--space-2)',
      padding: 'var(--space-2) var(--space-3)',
      borderRadius: 'var(--radius-sm)',
      backgroundColor: isCritical ? 'var(--simprok-critical-red-50)' : 'var(--simprok-engineering-blue-50)',
      border: `1px solid ${isCritical ? 'var(--simprok-critical-red-600)' : 'var(--simprok-engineering-blue-200)'}`,
      color: isCritical ? 'var(--simprok-critical-red-600)' : 'var(--simprok-engineering-blue-800)',
      fontSize: 'var(--text-sm)',
      fontWeight: 'var(--weight-medium)'
    }}>
      <AlertTriangle size={16} />
      <span>{message}</span>
    </div>
  );
}
