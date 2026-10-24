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
const storageKey = (accountId: string, workspaceId: string): string =>
  KEY_PREFIX + accountId + ':' + workspaceId;

/** Session-only recovery, never Project/BOQ canonical persistence. Scoped per account and workspace. */
export function readRabRecovery<T>(accountId: string | null | undefined, workspaceId: string | null | undefined): Recovery<T> | null {
  if (!accountId || !workspaceId) return null;
  try {
    const raw = sessionStorage.getItem(storageKey(accountId, workspaceId));
    if (!raw || raw.length > 2_000_000) return null;
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

export function writeRabRecovery<T>(accountId: string | null | undefined, workspaceId: string | null | undefined, state: Recovery<T>): boolean {
  if (!accountId || !workspaceId || state.preparedProject.workspaceId !== workspaceId) return false;
  try { sessionStorage.setItem(storageKey(accountId, workspaceId), JSON.stringify(state)); return true; }
  catch { return false; }
}

export function clearRabRecovery(accountId: string | null | undefined, workspaceId: string | null | undefined): void {
  if (!accountId || !workspaceId) return;
  try { sessionStorage.removeItem(storageKey(accountId, workspaceId)); } catch { /* browser storage unavailable */ }
}
