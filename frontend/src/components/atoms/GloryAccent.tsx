import React from 'react';

interface GloryAccentProps {
  children: React.ReactNode;
  label: string;
}

export function GloryAccent({ children, label }: GloryAccentProps) {
  return (
    <div style={{
      borderLeft: '4px solid var(--simprok-glory-purple-500)',
      paddingLeft: 'var(--space-4)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-2)'
    }}>
      <span style={{
        color: 'var(--simprok-glory-purple-500)',
        fontSize: 'var(--text-xs)',
        fontWeight: 'var(--weight-bold)',
        letterSpacing: '0.05em',
        textTransform: 'uppercase'
      }}>
        {label}
      </span>
      {children}
    </div>
  );
}
