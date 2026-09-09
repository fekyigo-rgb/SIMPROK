import { useEffect, useRef, type CSSProperties } from 'react';
import {
  USULKAN_CANCEL,
  USULKAN_CONFIRM,
  USULKAN_MODAL_BODY_1,
  USULKAN_MODAL_BODY_2,
  USULKAN_MODAL_TITLE,
} from '../../utils/ahspProposalCopy';

/**
 * Confirmation dialog for "Usulkan ke SIMPROK". It only asks; it does not
 * propose. onConfirm runs the EXISTING POST /ahsp/:id/propose lifecycle in the
 * caller — this component adds no endpoint, no state, no governance of its own.
 *
 * Presentation reuses the established design tokens (Color Lock CSS variables,
 * the card + primary/outline button vocabulary used across the AHSP pages); it
 * introduces no new hex and no new stylesheet. Cancel is the safe default —
 * Escape and a backdrop click both cancel, and nothing is submitted.
 */

type Props = {
  open: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

const NAVY = 'var(--simprok-authority-navy-800)';
const MUTED = 'var(--simprok-engineering-blue-500)';
const BLUE = 'var(--simprok-trust-blue-500)';
const HAIRLINE = '1px solid var(--simprok-engineering-blue-100)';

const backdrop: CSSProperties = {
  position: 'fixed',
  inset: 0,
  // The Color Lock navy (#16294B) as a translucent scrim — not a new colour.
  background: 'rgba(22, 41, 75, 0.55)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'var(--space-4)',
  zIndex: 1000,
};
const panel: CSSProperties = {
  background: '#FFFFFF',
  border: HAIRLINE,
  borderRadius: '12px',
  padding: 'var(--space-5, 1.25rem)',
  width: '100%',
  maxWidth: '30rem',
  boxShadow: '0 10px 30px rgba(22, 41, 75, 0.18)',
};
const outlineButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  background: '#FFFFFF',
  color: NAVY,
  border: HAIRLINE,
  borderRadius: '8px',
  padding: 'var(--space-2) var(--space-4)',
  cursor: 'pointer',
  fontSize: 'var(--text-sm)',
};
const primaryButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  background: BLUE,
  color: '#FFFFFF',
  border: 0,
  borderRadius: '8px',
  padding: 'var(--space-2) var(--space-4)',
  cursor: 'pointer',
  fontSize: 'var(--text-sm)',
};

export function UsulkanSimprokDialog({ open, busy, onCancel, onConfirm }: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      style={backdrop}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={USULKAN_MODAL_TITLE} style={panel}>
        <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: NAVY, margin: '0 0 var(--space-3)' }}>
          {USULKAN_MODAL_TITLE}
        </h2>
        <p style={{ color: MUTED, fontSize: 'var(--text-sm)', margin: '0 0 var(--space-2)' }}>{USULKAN_MODAL_BODY_1}</p>
        <p style={{ color: MUTED, fontSize: 'var(--text-sm)', margin: '0 0 var(--space-4)' }}>{USULKAN_MODAL_BODY_2}</p>
        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onCancel} style={outlineButton}>
            {USULKAN_CANCEL}
          </button>
          <button ref={confirmRef} type="button" disabled={busy} onClick={onConfirm} style={primaryButton}>
            {busy ? 'Memproses…' : USULKAN_CONFIRM}
          </button>
        </div>
      </div>
    </div>
  );
}

export default UsulkanSimprokDialog;
