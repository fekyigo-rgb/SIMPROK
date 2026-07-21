export type PermissionState = 'IDLE' | 'LOADING' | 'READY' | 'ERROR';

/**
 * Fail-closed by construction: a permission is only ever granted when the
 * capability fetch for the *current* workspace has actually completed
 * (READY) and the code is present in that response. IDLE, LOADING, and
 * ERROR — and any code not in the list — always evaluate to false. There is
 * no fallback to role labels or localStorage.
 */
export function evaluatePermission(
  state: PermissionState,
  permissions: readonly string[],
  code: string,
): boolean {
  if (state !== 'READY') return false;
  return permissions.includes(code);
}
