import { readRabPreparedProject, type RabPreparedProject } from './rabPreparedProject.ts';

type Recovery<T> = {
  preparedProject: RabPreparedProject;
  rows: T[];
  volumes: Record<string, number>;
  unitPrices: Record<string, number>;
  marginPercent: number;
  ppnPercent: number;
  projectCode: string;
};

const KEY_PREFIX = 'simprok-rab-provisional-v1:';
const MAX_RECOVERY_CHARS = 2_000_000;
const storageKey = (accountId: string, workspaceId: string): string =>
  KEY_PREFIX + accountId + ':' + workspaceId;

/** One validation contract for candidate backups and subsequent reads. */
function parseRecoveryPayload<T>(raw: string | null, workspaceId: string): Recovery<T> | null {
  try {
    if (!raw || raw.length > MAX_RECOVERY_CHARS) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const q = parsed as Record<string, unknown>;
    const preparedProject = readRabPreparedProject({ preparedProject: q.preparedProject });
    if (!preparedProject || preparedProject.workspaceId !== workspaceId ||
        !Array.isArray(q.rows) || q.rows.length > 5000 ||
        q.rows.some((r: unknown) => !r || typeof r !== 'object' ||
          typeof (r as { id?: unknown }).id !== 'string' ||
          typeof (r as { name?: unknown }).name !== 'string' ||
          !['folder', 'item', 'note'].includes(String((r as {type?:unknown}).type))) ||
        !q.volumes || typeof q.volumes !== 'object' || Array.isArray(q.volumes) ||
        !q.unitPrices || typeof q.unitPrices !== 'object' || Array.isArray(q.unitPrices) ||
        typeof q.marginPercent !== 'number' || typeof q.ppnPercent !== 'number' ||
        typeof q.projectCode !== 'string') return null;
    return { preparedProject, rows: q.rows as T[], volumes: q.volumes as Record<string, number>,
      unitPrices: q.unitPrices as Record<string, number>,
      marginPercent: q.marginPercent, ppnPercent: q.ppnPercent, projectCode: q.projectCode };
  } catch { return null; }
}

/** Session-only recovery, never Project/BOQ canonical persistence. Scoped per account and workspace. */
export function readRabRecovery<T>(accountId: string | null | undefined, workspaceId: string | null | undefined): Recovery<T> | null {
  if (!accountId || !workspaceId) return null;
  try {
    return parseRecoveryPayload<T>(sessionStorage.getItem(storageKey(accountId, workspaceId)), workspaceId);
  } catch { return null; }
}

export function writeRabRecovery<T>(accountId: string | null | undefined, workspaceId: string | null | undefined, state: Recovery<T>, expectedPreparedProject?: RabPreparedProject): boolean {
  if (!accountId || !workspaceId || state.preparedProject.workspaceId !== workspaceId) return false;
  try {
    const key = storageKey(accountId, workspaceId);
    // Reject numbers JSON would silently coerce to null (NaN / Infinity).
    const serialized = JSON.stringify(state, (_key, value: unknown) => {
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('NON_FINITE_RECOVERY_NUMBER');
      return value;
    });
    if (!parseRecoveryPayload<T>(serialized, workspaceId)) return false;
    const previous = sessionStorage.getItem(key);
    const existing = previous !== null ? readRabRecovery<T>(accountId, workspaceId) : null;
    // A backflow edit requires the exact original snapshot. No cross-draft
    // replacement and no "recreate" if another tab already discarded it.
    if (expectedPreparedProject &&
        (!existing || JSON.stringify(existing.preparedProject) !== JSON.stringify(expectedPreparedProject))) return false;
    // Ordinary backup must never overwrite another recoverable RAB.
    if (existing && !expectedPreparedProject &&
        JSON.stringify(existing.preparedProject) !== JSON.stringify(state.preparedProject)) return false;
    sessionStorage.setItem(key, serialized);
    const readback = sessionStorage.getItem(key);
    const valid = readback === serialized && parseRecoveryPayload<T>(readback, workspaceId) !== null;
    if (!valid && previous !== null) {
      try { sessionStorage.setItem(key, previous); } catch { /* fail closed; caller sees failure */ }
    }
    return valid;
  } catch { return false; }
}

export function clearRabRecovery(accountId: string | null | undefined, workspaceId: string | null | undefined): void {
  if (!accountId || !workspaceId) return;
  try { sessionStorage.removeItem(storageKey(accountId, workspaceId)); } catch { /* browser storage unavailable */ }
}
