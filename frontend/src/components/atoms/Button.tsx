import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'override';
  children: React.ReactNode;
}

export function Button({ variant = 'primary', children, style, ...props }: ButtonProps) {
  
  const getVariantStyles = (): React.CSSProperties => {
    switch (variant) {
      case 'primary':
        return {
          backgroundColor: 'var(--simprok-trust-blue-500)',
          color: 'var(--simprok-white)',
          border: 'none',
        };
      case 'secondary':
        return {
          backgroundColor: 'transparent',
          color: 'var(--simprok-engineering-blue-700)',
          border: '1px solid var(--simprok-engineering-blue-200)',
        };
      case 'override':
        // Override uses Engineering Blue to signify human taking technical control 
        // bypassing a recommendation. Not red, because it's a valid authority choice.
        return {
          backgroundColor: 'var(--simprok-engineering-blue-800)',
          color: 'var(--simprok-white)',
          border: 'none',
        };
    }
  };

  const baseStyles: React.CSSProperties = {
    padding: 'var(--space-2) var(--space-4)',
    borderRadius: 'var(--radius-sm)',
    fontWeight: 'var(--weight-medium)',
    fontSize: 'var(--text-sm)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-2)',
    transition: 'all 150ms ease',
    ...getVariantStyles(),
    ...style
  };

  return (
    <button style={baseStyles} className="simprok-button-base" {...props}>
      {children}
    </button>
  );
}
