/**
 * RM-03B — how an AHSP's origin is named to a user.
 *
 * Owner law recognises two legitimate origins and they must never be conflated
 * in the words shown on screen:
 *
 *   SIMPROK_CATALOG   curated by SIMPROK's internal back-office.
 *   WORKSPACE_PRIVATE this workspace's own AHSP, usable immediately, with no
 *                     national publication behind it.
 *
 * A private asset is therefore NEVER labelled "published", "verified", or
 * "approved" — it has been through none of those, and saying so would be a
 * claim the data does not support. It is labelled as what it actually is:
 * the user's own.
 */

export type AhspOrigin = 'SIMPROK_CATALOG' | 'WORKSPACE_PRIVATE';

export const AHSP_ORIGIN_LABEL: Record<AhspOrigin, string> = {
  SIMPROK_CATALOG: 'Katalog SIMPROK',
  WORKSPACE_PRIVATE: 'AHSP Saya',
};

/**
 * An absent origin degrades to the catalog label rather than to the private
 * one. Claiming "this is yours" without evidence would be the dishonest
 * direction of the two: it implies an ownership the payload never asserted.
 */
export const describeAhspOrigin = (origin: AhspOrigin | undefined): string =>
  origin ? AHSP_ORIGIN_LABEL[origin] : AHSP_ORIGIN_LABEL.SIMPROK_CATALOG;

/** Option text for the AHSP picker: identity first, origin as the qualifier. */
export const formatAhspVersionOption = (version: {
  origin?: AhspOrigin;
  versionNumber: number;
  outputUnit: string;
  ahsp: { workType: string; methodName: string };
}): string =>
  `[${describeAhspOrigin(version.origin)}] ${version.ahsp.workType} — ${version.ahsp.methodName} · v${version.versionNumber} · ${version.outputUnit}`;

/**
 * True only for a genuinely private asset. Used to decide whether to show the
 * honest "your own analysis, not a SIMPROK-curated price" note — never to
 * decide access, which is the server's business alone.
 */
export const isWorkspacePrivateAhsp = (origin: AhspOrigin | undefined): boolean =>
  origin === 'WORKSPACE_PRIVATE';
