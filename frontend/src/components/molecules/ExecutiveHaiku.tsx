import React from 'react';
import { CertaintyBadge } from '../atoms/CertaintyBadge';

interface ExecutiveHaikuProps {
  /** The single truth sentence — the entire reality of a project distilled */
  text: string;
  /** How much should the reader trust this synthesis? */
  certaintyLevel?: 'C0' | 'C1' | 'C2' | 'C3' | 'C4' | 'C5';
}

/**
 * EXECUTIVE HAIKU — SIMPROK Product Signature (DNA-03)
 * 
 * The first thing a user reads when opening any module.
 * One truth. One sentence. Reality before data.
 * 
 * SIMPROK is the Sight.
 * The Haiku is the Light before the numbers.
 * 
 * Rules:
 * - ONE sentence per module
 * - Must be the FIRST element on any dashboard view
 * - Must include a Certainty indicator
 * - Must breathe (generous whitespace)
 * - Blue luminance = SIMPROK speaking
 */
export function ExecutiveHaiku({ 
  text, 
  certaintyLevel = 'C3' 
}: ExecutiveHaikuProps) {
  return (
    <section className="simprok-haiku">

      {/* Ritual Label — announces what follows */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: 'var(--space-4)'
      }}>
        <span className="simprok-haiku__label">
          Executive Haiku
        </span>
        <CertaintyBadge level={certaintyLevel} />
      </div>

      {/* The Truth — one sentence, the entire reality */}
      <p className="simprok-haiku__text">
        "{text}"
      </p>

    </section>
  );
}
