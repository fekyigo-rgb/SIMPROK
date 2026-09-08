/**
 * User-facing "Status Usulan" for an AHSP, and the rule for when it may be
 * proposed. The backend keeps the truth (proposedAt marker + reviewStatus);
 * this module only chooses the plain Indonesian words the Owner mockup shows —
 * never an enum, a UUID, or a reason code.
 */

export interface AhspProposalWire {
  proposedAt?: string | null;
  reviewStatus?: string | null;
  ownershipType?: string | null;
}

/**
 * BELUM DIUSULKAN — created but not yet submitted for review.
 * SEDANG DITINJAU — submitted, awaiting a reviewer's human decision.
 * DITERIMA / DITOLAK — the reviewer's decision (reviewStatus).
 */
export const describeAhspProposalStatus = (ahsp: AhspProposalWire): string => {
  if (ahsp.reviewStatus === 'APPROVED') return 'Diterima';
  if (ahsp.reviewStatus === 'REJECTED') return 'Ditolak';
  if (ahsp.proposedAt) return 'Sedang ditinjau';
  return 'Belum diusulkan';
};

/**
 * A workspace-owned AHSP that has not yet been submitted and is not already
 * accepted may be proposed. Mirrors the backend canPropose rule so the button
 * is only offered when the action is real.
 */
export const canProposeAhsp = (ahsp: AhspProposalWire): boolean =>
  ahsp.ownershipType === 'USER_ASSET' &&
  !ahsp.proposedAt &&
  ahsp.reviewStatus !== 'APPROVED';

const INDO_MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

/** "2026-08-12..." -> "12 Agustus 2026". Falls back to the em dash for empty. */
export const formatIndoDate = (value: string | null | undefined): string => {
  if (!value) return '—';
  const day = value.slice(0, 10);
  const parts = day.split('-');
  if (parts.length !== 3) return value;
  const [y, m, d] = parts;
  const month = INDO_MONTHS[Number(m) - 1];
  if (!month || Number.isNaN(Number(d)) || Number.isNaN(Number(y))) return value;
  return `${Number(d)} ${month} ${y}`;
};
