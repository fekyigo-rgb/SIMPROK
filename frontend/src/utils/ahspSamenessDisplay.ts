/**
 * Human-facing shaping of the AHSP-whole "sameness" verdict for Import Review.
 *
 * It turns the backend's identity classification into simple Indonesian and a
 * name-only reference to the existing AHSP. The ahspId rides through ONLY to
 * build a door link (/ahsp/:id) — it is never rendered as text, the same
 * discipline resourceObservationDisplay uses for a catalogue id. No score, no
 * UUID, no internal verdict token ('IDENTICAL' / 'POSSIBLY_IDENTICAL') ever
 * reaches the reader; those stay internal states.
 */

export interface AhspIdentityMatchWire {
  readonly ahspId: string;
  readonly workType: string;
  readonly methodName: string;
  readonly code?: string | null;
  readonly deleted?: boolean;
  readonly signal?: string;
}

export interface SamenessItemWire {
  readonly identityVerdict?: string;
  readonly identityMatches?: readonly AhspIdentityMatchWire[];
}

export interface SamenessRef {
  /** /ahsp/:id — the door to the existing AHSP. The id is used here and nowhere visible. */
  readonly openHref: string;
  /** "Jenis Pekerjaan — Uraian". */
  readonly title: string;
  /** "Kode X" or empty when the source stated none. */
  readonly detail: string;
  readonly deleted: boolean;
}

export interface SamenessView {
  readonly verdict: 'IDENTICAL' | 'POSSIBLY_IDENTICAL';
  readonly title: string;
  readonly guidance: string;
  readonly refs: readonly SamenessRef[];
  /** How many further matches exist beyond the ones listed. The guidance asks the
   *  reader to compare, so a silently truncated list would hide evidence. */
  readonly hiddenRefCount: number;
  readonly canUseExisting: boolean;
  readonly canKeepSeparate: boolean;
}

const MAX_REFS = 4;

export const SAMENESS_COPY = {
  IDENTICAL_TITLE: 'AHSP yang sama sudah ada di SIMPROK.',
  IDENTICAL_GUIDANCE:
    'SIMPROK tidak menyimpan dua AHSP yang sama persis. Gunakan AHSP yang sudah ada, atau lewati.',
  POSSIBLY_TITLE: 'SIMPROK menemukan AHSP yang kemungkinan sama.',
  POSSIBLY_GUIDANCE:
    'Periksa padanannya sebelum melanjutkan, lalu putuskan: gunakan yang sudah ada, simpan sebagai AHSP berbeda, atau lewati.',
  POSSIBLY_GUIDANCE_MANY:
    'SIMPROK menemukan lebih dari satu padanan, jadi SIMPROK tidak menebak yang mana. Buka dan bandingkan, lalu putuskan: simpan sebagai AHSP berbeda, atau lewati.',
  DELETED_NOTE: 'AHSP yang cocok ini sebelumnya telah dihapus.',
  // Names NO action, because on this path none is available: the matching AHSP was
  // deleted, so it can be neither adopted nor stored again.
  IDENTICAL_DELETED_GUIDANCE:
    'AHSP yang cocok ini sebelumnya telah dihapus, jadi tidak dapat digunakan di sini. Pekerjaan ini tetap tidak akan disimpan dua kali.',
} as const;

/**
 * ONE line for MANY already-known AHSPs.
 *
 * An exact identity has the SAME canonical outcome whatever the reader clicks
 * (it is never stored twice), so repeating a decision block for each one is
 * ceremony. A document full of AHSPs SIMPROK already holds therefore costs the
 * reader one sentence instead of N identical blocks.
 */
export function identicalAggregateLine(count: number): string {
  return count + ' AHSP sudah ada di SIMPROK dan tidak akan disimpan dua kali.';
}

/**
 * The companion line for identities whose only match was already DELETED. Spoken
 * separately from identicalAggregateLine so the count beside an offered action
 * never includes rows that action cannot touch.
 */
export function identicalDeletedAggregateLine(count: number): string {
  return (
    count +
    ' AHSP yang cocok sebelumnya telah dihapus, jadi tidak dapat digunakan di sini.'
  );
}

function refFrom(match: AhspIdentityMatchWire): SamenessRef {
  const code = (match.code ?? '').trim();
  return {
    openHref: '/ahsp/' + match.ahspId,
    title: (match.workType || '—') + ' — ' + (match.methodName || '—'),
    detail: code !== '' ? 'Kode ' + code : '',
    deleted: match.deleted === true,
  };
}

/**
 * Returns a view ONLY when there is a human decision to make (IDENTICAL or
 * POSSIBLY_IDENTICAL). DISTINCT / absent -> null, so a reader with nothing to
 * decide sees exactly what they saw before.
 *
 * IDENTICAL offers "use existing" ONLY when the twin is live — a byte-exact
 * identity can never be kept separate (the @@unique key bars a second row), and
 * a deleted twin cannot be adopted here (reviving it is a separate, governed
 * action), so it offers only "lewati".
 */
export function describeSameness(item: SamenessItemWire | null | undefined): SamenessView | null {
  if (!item) return null;
  const verdict = item.identityVerdict;
  if (verdict !== 'IDENTICAL' && verdict !== 'POSSIBLY_IDENTICAL') return null;
  const allMatches = item.identityMatches ?? [];
  const refs = allMatches.slice(0, MAX_REFS).map(refFrom);
  const hiddenRefCount = Math.max(0, allMatches.length - refs.length);
  const anyDeleted = refs.some((ref) => ref.deleted);
  if (verdict === 'IDENTICAL') {
    return {
      verdict,
      title: SAMENESS_COPY.IDENTICAL_TITLE,
      // When the twin is deleted, neither named action exists — so say only what is
      // true and offer nothing, rather than naming actions the reader cannot take.
      guidance: anyDeleted
        ? SAMENESS_COPY.IDENTICAL_DELETED_GUIDANCE
        : SAMENESS_COPY.IDENTICAL_GUIDANCE,
      refs,
      hiddenRefCount,
      canUseExisting: !anyDeleted,
      canKeepSeparate: false,
    };
  }
  // With MORE THAN ONE candidate SIMPROK cannot know which one the reader means,
  // and the decision carries no candidate identity, so "use existing" would
  // silently adopt whichever match sorted first. Withhold it instead: the reader
  // opens, compares, then keeps it separate or skips. Never manufacture certainty.
  const single = allMatches.length === 1;
  return {
    verdict,
    title: SAMENESS_COPY.POSSIBLY_TITLE,
    guidance: single
      ? SAMENESS_COPY.POSSIBLY_GUIDANCE
      : SAMENESS_COPY.POSSIBLY_GUIDANCE_MANY,
    refs,
    hiddenRefCount,
    canUseExisting: single,
    canKeepSeparate: true,
  };
}
