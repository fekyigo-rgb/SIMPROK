import React from 'react';
import { GloryAccent } from '../atoms/GloryAccent';

interface InsightHeaderProps {
  label: string;
  title: string;
  description?: string;
}

export function InsightHeader({ label, title, description }: InsightHeaderProps) {
  return (
    <GloryAccent label={label}>
      <h3 style={{ 
        fontSize: 'var(--text-lg)', 
        color: 'var(--simprok-engineering-blue-900)',
        fontWeight: 'var(--weight-semibold)',
        margin: 0
      }}>
        {title}
      </h3>
      {description && (
        <p style={{ 
          fontSize: 'var(--text-sm)', 
          color: 'var(--simprok-engineering-blue-700)',
          marginTop: 'var(--space-1)',
          margin: 0
        }}>
          {description}
        </p>
      )}
    </GloryAccent>
  );
}
