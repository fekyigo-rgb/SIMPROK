import React from 'react';
import { ShieldCheck, HelpCircle, Clock, CheckCircle } from 'lucide-react';

interface CertaintyBadgeProps {
  level: 'C0' | 'C1' | 'C2' | 'C3' | 'C4' | 'C5';
}

export function CertaintyBadge({ level }: CertaintyBadgeProps) {
  const getBadgeDetails = () => {
    switch (level) {
      case 'C0': return { label: 'Unknown', icon: <HelpCircle size={14} />, style: 'certainty-c0' };
      case 'C1': return { label: 'Estimated', icon: <Clock size={14} />, style: 'certainty-c1' };
      case 'C2': return { label: 'Planned', icon: <Clock size={14} />, style: 'certainty-c2' };
      case 'C3': return { label: 'Measured', icon: <Clock size={14} />, style: 'certainty-c3' };
      case 'C4': return { label: 'Validated', icon: <ShieldCheck size={14} color="var(--simprok-trust-blue-500)" />, style: 'certainty-c4' };
      case 'C5': return { label: 'Confirmed', icon: <CheckCircle size={14} color="var(--simprok-success-green-600)" />, style: 'certainty-c5' };
    }
  };

  const details = getBadgeDetails();

  return (
    <div 
      className={details.style}
      style={{ 
        display: 'inline-flex', 
        alignItems: 'center', 
        gap: 'var(--space-1)',
        fontSize: 'var(--text-xs)',
        padding: 'var(--space-1) var(--space-2)',
        borderRadius: 'var(--radius-sm)',
        backgroundColor: level === 'C5' ? 'var(--simprok-success-green-50)' : 'var(--simprok-surface-light)',
        border: level === 'C5' ? '1px solid var(--simprok-success-green-600)' : '1px solid transparent'
      }}
    >
      {details.icon}
      <span>{level} - {details.label}</span>
    </div>
  );
}
