interface NumericFactProps {
  value: string | number;
  certaintyLevel?: 'C0' | 'C1' | 'C2' | 'C3' | 'C4' | 'C5';
  prefix?: string;
  suffix?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export function NumericFact({ 
  value, 
  certaintyLevel = 'C3', 
  prefix, 
  suffix,
  size = 'md' 
}: NumericFactProps) {
  
  // Font sizes mapped to tokens
  const sizeMap = {
    sm: 'var(--text-sm)',
    md: 'var(--text-base)',
    lg: 'var(--text-2xl)',
    xl: 'var(--text-4xl)'
  };

  return (
    <span 
      className={`simprok-numeric certainty-${certaintyLevel.toLowerCase()}`}
      style={{ fontSize: sizeMap[size], display: 'inline-flex', alignItems: 'baseline', gap: 'var(--space-1)' }}
    >
      {prefix && <span style={{ fontSize: '0.85em', opacity: 0.8 }}>{prefix}</span>}
      {value}
      {suffix && <span style={{ fontSize: '0.85em', opacity: 0.8 }}>{suffix}</span>}
    </span>
  );
}
