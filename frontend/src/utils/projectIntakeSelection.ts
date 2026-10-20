import type { RegionLookupItem } from './basicPriceWorkflowDisplay.ts';
import {
  REGION_HIERARCHY_LEVELS,
  type RegionHierarchyLevel,
  type RegionHierarchySelection,
} from './regionHierarchy.ts';

export const PROJECT_CLASSIFICATION_LEVELS = [
  'JENIS_PENGADAAN',
  'KATEGORI',
  'SUBKATEGORI',
] as const;

export type ProjectClassificationLevel =
  (typeof PROJECT_CLASSIFICATION_LEVELS)[number];

export type ProjectClassificationNode = {
  id: string;
  level: string;
  name: string;
  parentId: string | null;
};

export type IntakeClassificationLevel = 'KATEGORI' | 'SUBKATEGORI';

export type IntakeClassificationPick = {
  id: string;
  name: string;
  parentId: string;
  level: IntakeClassificationLevel;
};

export type IntakeClassificationSelection = {
  root: { id: string; name: string } | null;
  picks: IntakeClassificationPick[];
};

export type ClassificationCatalogEntry = {
  kategoriId: string;
  loaded: boolean;
  childIds: readonly string[];
};

export const emptyIntakeClassification = (): IntakeClassificationSelection => ({
  root: null,
  picks: [],
});

export function visibleProjectClassificationNodes(
  nodes: ProjectClassificationNode[],
  level: ProjectClassificationLevel,
): ProjectClassificationNode[] {
  return nodes.filter(
    (node) =>
      node.level === level &&
      node.id.trim().length > 0 &&
      node.name.trim().length > 0,
  );
}

export function retainClassificationSelection(
  selectedId: string | null,
  options: ProjectClassificationNode[],
): string | null {
  if (!selectedId) return null;
  return options.some((option) => option.id === selectedId) ? selectedId : null;
}

export function setIntakeClassificationRoot(
  selection: IntakeClassificationSelection,
  root: { id: string; name: string } | null,
): IntakeClassificationSelection {
  if (!root || !isCanonicalRegionId(root.id)) return emptyIntakeClassification();
  if (selection.root?.id === root.id) return selection;
  return { root: { id: root.id, name: root.name }, picks: [] };
}

export function pruneIntakeClassificationPicks(
  picks: readonly IntakeClassificationPick[],
  rootId: string | null,
): IntakeClassificationPick[] {
  if (!rootId || !isCanonicalRegionId(rootId)) return [];
  const seen = new Set<string>();
  const kategori = picks.filter((pick) => {
    if (pick.level !== 'KATEGORI' || pick.parentId !== rootId) return false;
    if (!isCanonicalRegionId(pick.id) || seen.has(pick.id)) return false;
    seen.add(pick.id);
    return true;
  });
  const kategoriIds = new Set(kategori.map((pick) => pick.id));
  const subkategori = picks.filter((pick) => {
    if (pick.level !== 'SUBKATEGORI' || !kategoriIds.has(pick.parentId)) return false;
    if (!isCanonicalRegionId(pick.id) || seen.has(pick.id)) return false;
    seen.add(pick.id);
    return true;
  });
  return [...kategori, ...subkategori];
}

export function toggleIntakeClassification(
  selection: IntakeClassificationSelection,
  pick: IntakeClassificationPick,
): IntakeClassificationSelection {
  if (!selection.root || !isCanonicalRegionId(pick.id) || !isCanonicalRegionId(pick.parentId)) {
    return selection;
  }
  const kategoriIds = new Set(
    selection.picks.filter((item) => item.level === 'KATEGORI').map((item) => item.id),
  );
  const parentOk =
    pick.level === 'KATEGORI'
      ? pick.parentId === selection.root.id
      : kategoriIds.has(pick.parentId);
  if (!parentOk) return selection;
  const exists = selection.picks.some((item) => item.id === pick.id);
  const picks = exists
    ? selection.picks.filter((item) => item.id !== pick.id)
    : [...selection.picks, pick];
  return {
    root: selection.root,
    picks: pruneIntakeClassificationPicks(picks, selection.root.id),
  };
}

export function classificationNodeIds(
  selection: IntakeClassificationSelection,
  catalog: readonly ClassificationCatalogEntry[],
): string[] | null {
  if (!selection.root || !isCanonicalRegionId(selection.root.id)) return null;
  const picks = pruneIntakeClassificationPicks(selection.picks, selection.root.id);
  const kategori = picks.filter((pick) => pick.level === 'KATEGORI');
  if (kategori.length === 0) return null;
  const byParent = new Map(catalog.map((entry) => [entry.kategoriId, entry]));
  const verifiedSubs: IntakeClassificationPick[] = [];
  for (const pick of picks) {
    if (pick.level !== 'SUBKATEGORI') continue;
    const entry = byParent.get(pick.parentId);
    if (!entry?.loaded) return null;
    if (!entry.childIds.includes(pick.id)) continue;
    verifiedSubs.push(pick);
  }
  const ids = [
    selection.root.id,
    ...kategori.map((pick) => pick.id),
    ...verifiedSubs.map((pick) => pick.id),
  ];
  return ids.filter((id, index) => isCanonicalRegionId(id) && ids.indexOf(id) === index);
}

export function projectIntakeChildrenQuery(parentId: string): string {
  return `/project-intake/classification/children?parentId=${encodeURIComponent(parentId)}`;
}

export function projectIntakeRegionQuery(input: {
  administrativeLevel: RegionHierarchyLevel;
  parentId?: string | null;
  page: number;
  q?: string;
}): string {
  const params = new URLSearchParams();
  params.set('administrativeLevel', input.administrativeLevel);
  params.set('page', String(input.page));
  params.set('limit', '50');
  if (input.parentId) params.set('parentId', input.parentId);
  if (input.q?.trim()) params.set('q', input.q.trim());
  return `/project-intake/regions?${params.toString()}`;
}

export function deepestSelectedRegion(
  selection: RegionHierarchySelection,
): RegionLookupItem | null {
  for (let index = REGION_HIERARCHY_LEVELS.length - 1; index >= 0; index -= 1) {
    const item = selection[REGION_HIERARCHY_LEVELS[index]];
    if (item) return item;
  }
  return null;
}

export function locationPathLabel(selection: RegionHierarchySelection): string {
  return REGION_HIERARCHY_LEVELS.map((level) => selection[level]?.name)
    .filter((name): name is string => Boolean(name))
    .join(' · ');
}

export const INTAKE_MULTI_LEVELS = [
  'PROVINCE',
  'REGENCY_CITY',
  'DISTRICT',
  'VILLAGE',
] as const;

export type IntakeMultiLevel = (typeof INTAKE_MULTI_LEVELS)[number];

export const INTAKE_REGION_PAGE_LIMIT = 20;

const CANONICAL_REGION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCanonicalRegionId(id: string): boolean {
  return CANONICAL_REGION_ID.test(id);
}

export type IntakeRegionPick = {
  id: string;
  name: string;
  parentId: string;
  level: IntakeMultiLevel;
};

export type IntakeRegionSelection = {
  country: { id: string; name: string } | null;
  picks: IntakeRegionPick[];
};

export const emptyIntakeRegionSelection = (): IntakeRegionSelection => ({
  country: null,
  picks: [],
});

const PARENT_LEVEL: Record<IntakeMultiLevel, 'COUNTRY' | IntakeMultiLevel> = {
  PROVINCE: 'COUNTRY',
  REGENCY_CITY: 'PROVINCE',
  DISTRICT: 'REGENCY_CITY',
  VILLAGE: 'DISTRICT',
};

function uniquePicks(picks: readonly IntakeRegionPick[]): IntakeRegionPick[] {
  const seen = new Set<string>();
  const result: IntakeRegionPick[] = [];
  for (const pick of picks) {
    if (!isCanonicalRegionId(pick.id) || !isCanonicalRegionId(pick.parentId)) continue;
    if (seen.has(pick.id)) continue;
    seen.add(pick.id);
    result.push(pick);
  }
  return result;
}

export function intakePicksAt(
  selection: IntakeRegionSelection,
  level: IntakeMultiLevel,
): IntakeRegionPick[] {
  return selection.picks.filter((pick) => pick.level === level);
}

export function intakeParentIds(
  selection: IntakeRegionSelection,
  level: IntakeMultiLevel,
): string[] {
  if (level === 'PROVINCE') {
    return selection.country && isCanonicalRegionId(selection.country.id)
      ? [selection.country.id]
      : [];
  }
  const parentLevel = PARENT_LEVEL[level];
  if (parentLevel === 'COUNTRY') return [];
  return intakePicksAt(selection, parentLevel).map((pick) => pick.id);
}

export function pruneIntakeRegionPicks(
  picks: readonly IntakeRegionPick[],
  countryId: string | null,
): IntakeRegionPick[] {
  if (!countryId || !isCanonicalRegionId(countryId)) return [];
  const provinces = uniquePicks(picks).filter(
    (pick) => pick.level === 'PROVINCE' && pick.parentId === countryId,
  );
  const provinceIds = new Set(provinces.map((pick) => pick.id));
  const regencies = uniquePicks(picks).filter(
    (pick) => pick.level === 'REGENCY_CITY' && provinceIds.has(pick.parentId),
  );
  const regencyIds = new Set(regencies.map((pick) => pick.id));
  const districts = uniquePicks(picks).filter(
    (pick) => pick.level === 'DISTRICT' && regencyIds.has(pick.parentId),
  );
  const districtIds = new Set(districts.map((pick) => pick.id));
  const villages = uniquePicks(picks).filter(
    (pick) => pick.level === 'VILLAGE' && districtIds.has(pick.parentId),
  );
  return [...provinces, ...regencies, ...districts, ...villages];
}

function withPrunedPicks(
  selection: IntakeRegionSelection,
  picks: readonly IntakeRegionPick[],
): IntakeRegionSelection {
  return {
    country: selection.country,
    picks: pruneIntakeRegionPicks(picks, selection.country?.id ?? null),
  };
}

export function setIntakeCountry(
  selection: IntakeRegionSelection,
  country: { id: string; name: string } | null,
): IntakeRegionSelection {
  if (!country || !isCanonicalRegionId(country.id)) return emptyIntakeRegionSelection();
  if (selection.country?.id === country.id) return selection;
  return { country: { id: country.id, name: country.name }, picks: [] };
}

export function toggleIntakeRegion(
  selection: IntakeRegionSelection,
  pick: IntakeRegionPick,
): IntakeRegionSelection {
  const parents = new Set(intakeParentIds(selection, pick.level));
  if (!parents.has(pick.parentId) || !isCanonicalRegionId(pick.id)) return selection;
  const exists = selection.picks.some((item) => item.id === pick.id);
  const picks = exists
    ? selection.picks.filter((item) => item.id !== pick.id)
    : [...selection.picks, pick];
  return withPrunedPicks(selection, picks);
}

export function clearIntakeLevel(
  selection: IntakeRegionSelection,
  level: IntakeMultiLevel,
): IntakeRegionSelection {
  return withPrunedPicks(
    selection,
    selection.picks.filter((pick) => pick.level !== level),
  );
}

export function selectAllIntakeRegions(
  selection: IntakeRegionSelection,
  level: IntakeMultiLevel,
  coverage: { items: readonly IntakeRegionPick[]; complete: boolean },
): { selection: IntakeRegionSelection; refused: string | null } {
  if (!coverage.complete) {
    return {
      selection,
      refused:
        'Semua wilayah pada cakupan ini belum selesai dimuat. Pilihan tidak diubah.',
    };
  }
  const parents = new Set(intakeParentIds(selection, level));
  if (parents.size === 0) {
    return { selection, refused: 'Pilih induk wilayah terlebih dahulu.' };
  }
  const lawful = coverage.items.filter(
    (item) =>
      item.level === level &&
      parents.has(item.parentId) &&
      isCanonicalRegionId(item.id),
  );
  const kept = selection.picks.filter((pick) => pick.level !== level);
  return { selection: withPrunedPicks(selection, [...kept, ...lawful]), refused: null };
}

export function acceptIntakeRegionPage(
  state: { items: IntakeRegionPick[]; pages: number },
  page: { items: readonly IntakeRegionPick[]; hasNext: boolean },
): { items: IntakeRegionPick[]; pages: number; done: boolean; truncated: boolean } {
  const pages = state.pages + 1;
  if (page.hasNext && pages >= INTAKE_REGION_PAGE_LIMIT) {
    return { items: state.items, pages, done: true, truncated: true };
  }
  const seen = new Set(state.items.map((item) => item.id));
  const items = [...state.items];
  for (const item of page.items) {
    if (!isCanonicalRegionId(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return { items, pages, done: page.hasNext !== true, truncated: false };
}

export function intakeLocationRegionIds(selection: IntakeRegionSelection): string[] {
  const picks = pruneIntakeRegionPicks(selection.picks, selection.country?.id ?? null);
  if (!selection.country || !isCanonicalRegionId(selection.country.id)) return [];
  if (picks.length === 0) return [selection.country.id];
  const selected = new Set(picks.map((pick) => pick.id));
  const redundant = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const pick of picks) {
      if (selected.has(pick.parentId) && !redundant.has(pick.parentId)) {
        redundant.add(pick.parentId);
        changed = true;
      }
    }
  }
  return picks.filter((pick) => !redundant.has(pick.id)).map((pick) => pick.id);
}

export function intakeLocationSummary(
  selection: IntakeRegionSelection,
): { id: string; label: string }[] {
  const ids = new Set(intakeLocationRegionIds(selection));
  const byId = new Map(selection.picks.map((pick) => [pick.id, pick]));
  if (ids.size === 1 && selection.country && ids.has(selection.country.id)) {
    return [{ id: selection.country.id, label: selection.country.name }];
  }
  return selection.picks
    .filter((pick) => ids.has(pick.id))
    .map((pick) => {
      const names: string[] = [];
      let cursor: IntakeRegionPick | undefined = pick;
      while (cursor) {
        names.unshift(cursor.name);
        cursor = byId.get(cursor.parentId);
      }
      if (selection.country) names.unshift(selection.country.name);
      return { id: pick.id, label: names.join(' · ') };
    });
}

export function intakeContextMatches(input: {
  classificationNodeIds: string[];
  locationRegionIds: string[];
  classificationSelections: { id: string }[];
  locationSelections: { id: string }[];
}): boolean {
  return (
    sameIds(
      input.classificationSelections.map((item) => item.id),
      input.classificationNodeIds,
    ) &&
    sameIds(
      input.locationSelections.map((item) => item.id),
      input.locationRegionIds,
    )
  );
}

export type ProjectCreateSafety =
  | { phase: 'not_attempted' }
  | { phase: 'in_progress' }
  | { phase: 'rejected'; message: string }
  | { phase: 'uncertain'; message: string }
  | {
      phase: 'readback_pending';
      projectId: string;
      classificationNodeIds: string[];
      locationRegionIds: string[];
    }
  | { phase: 'verified'; projectId: string }
  | {
      phase: 'unverified';
      projectId: string;
      classificationNodeIds: string[];
      locationRegionIds: string[];
      reason: 'unauthorized' | 'mismatch' | 'unavailable';
      message: string;
    };

export const PROJECT_CREATE_NOT_ATTEMPTED: ProjectCreateSafety = {
  phase: 'not_attempted',
};

export const PROJECT_CREATE_UNCERTAIN_MESSAGE =
  'Hasil pembuatan proyek belum pasti karena sambungan terputus. Pembuatan tidak diulang dari formulir ini. Periksa Proyek Saya sebelum membuat draft baru.';

export const PROJECT_CREATE_UNAUTHORIZED_READBACK_MESSAGE =
  'Proyek sudah dibuat, tetapi konteks resmi belum dapat dibaca dari sesi ini. Verifikasi kanonik belum dilakukan. Proyek ini tidak dibuat ulang.';

export const PROJECT_CREATE_MISMATCH_MESSAGE =
  'Proyek sudah dibuat, tetapi konteks resmi tidak sama dengan pilihan. Proyek ini tidak dibuat ulang.';

export const PROJECT_CREATE_READBACK_FAILED_MESSAGE =
  'Proyek sudah dibuat, tetapi pemeriksaan konteks resmi gagal. Pemeriksaan dapat diulang tanpa membuat proyek baru.';

export type SubmittedProjectContext = {
  projectId: string;
  classificationNodeIds: string[];
  locationRegionIds: string[];
};

export function beginProjectCreate(
  current: ProjectCreateSafety,
): ProjectCreateSafety {
  if (current.phase !== 'not_attempted' && current.phase !== 'rejected') {
    return current;
  }
  return { phase: 'in_progress' };
}

export function projectCreateRequest(
  current: ProjectCreateSafety,
): 'post' | 'get' | 'none' {
  if (current.phase === 'not_attempted' || current.phase === 'rejected') {
    return 'post';
  }
  if (current.phase === 'unverified') return 'get';
  return 'none';
}

export function projectCreated(
  context: SubmittedProjectContext,
): ProjectCreateSafety {
  return {
    phase: 'readback_pending',
    projectId: context.projectId,
    classificationNodeIds: context.classificationNodeIds,
    locationRegionIds: context.locationRegionIds,
  };
}

export function projectCreateRejected(message: string): ProjectCreateSafety {
  return { phase: 'rejected', message };
}

export function projectCreateUncertain(
  message = PROJECT_CREATE_UNCERTAIN_MESSAGE,
): ProjectCreateSafety {
  return { phase: 'uncertain', message };
}

/**
 * POST /projects statuses that prove this request did not create a project:
 * validation (400), authentication (401), authorization (403), and the
 * existing unique-code conflict (409).
 */
const DEFINITE_PROJECT_CREATE_REJECTION = new Set([400, 401, 403, 409]);

export function projectCreateHttpDisposition(
  status: number,
): 'rejected' | 'uncertain' {
  if (DEFINITE_PROJECT_CREATE_REJECTION.has(status)) return 'rejected';
  return 'uncertain';
}

export function projectReadbackOutcome(input: {
  context: SubmittedProjectContext;
  httpStatus: number | null;
  matches: boolean;
  detail?: string | null;
}): ProjectCreateSafety {
  if (input.httpStatus === 200 && input.matches) {
    return { phase: 'verified', projectId: input.context.projectId };
  }
  if (input.httpStatus === 403) {
    return {
      phase: 'unverified',
      projectId: input.context.projectId,
      classificationNodeIds: input.context.classificationNodeIds,
      locationRegionIds: input.context.locationRegionIds,
      reason: 'unauthorized',
      message: PROJECT_CREATE_UNAUTHORIZED_READBACK_MESSAGE,
    };
  }
  if (input.httpStatus === 200) {
    return {
      phase: 'unverified',
      projectId: input.context.projectId,
      classificationNodeIds: input.context.classificationNodeIds,
      locationRegionIds: input.context.locationRegionIds,
      reason: 'mismatch',
      message: PROJECT_CREATE_MISMATCH_MESSAGE,
    };
  }
  const detail = input.detail?.trim();
  return {
    phase: 'unverified',
    projectId: input.context.projectId,
    classificationNodeIds: input.context.classificationNodeIds,
    locationRegionIds: input.context.locationRegionIds,
    reason: 'unavailable',
    message: detail
      ? `${PROJECT_CREATE_READBACK_FAILED_MESSAGE} ${detail}`
      : PROJECT_CREATE_READBACK_FAILED_MESSAGE,
  };
}

export function projectCreateView(current: ProjectCreateSafety): {
  status: string;
  error: string;
  primaryLabel: string;
  primaryDisabled: boolean;
  navigateTo: string | null;
} {
  switch (current.phase) {
    case 'not_attempted':
      return {
        status: 'Belum ada draft project yang dibuat.',
        error: '',
        primaryLabel: 'Simpan Draft & Lanjut ke Ruang Kerja RAB',
        primaryDisabled: false,
        navigateTo: null,
      };
    case 'in_progress':
      return {
        status: 'Membuat draft project. Belum baseline resmi.',
        error: '',
        primaryLabel: 'Membuat Draft...',
        primaryDisabled: true,
        navigateTo: null,
      };
    case 'rejected':
      return {
        status: 'Project draft belum dapat dibuat.',
        error: current.message,
        primaryLabel: 'Simpan Draft & Lanjut ke Ruang Kerja RAB',
        primaryDisabled: false,
        navigateTo: null,
      };
    case 'uncertain':
      return {
        status: 'Hasil pembuatan proyek belum pasti.',
        error: current.message,
        primaryLabel: 'Hasil pembuatan belum pasti',
        primaryDisabled: true,
        navigateTo: null,
      };
    case 'readback_pending':
      return {
        status: `Memeriksa konteks resmi proyek ${current.projectId}.`,
        error: '',
        primaryLabel: 'Memeriksa konteks resmi...',
        primaryDisabled: true,
        navigateTo: null,
      };
    case 'verified':
      return {
        status: 'Draft project dibuat. Masuk ke Ruang Kerja RAB. Belum baseline resmi.',
        error: '',
        primaryLabel: 'Lanjut ke Ruang Kerja RAB',
        primaryDisabled: true,
        navigateTo: `/project/${current.projectId}/rab/workspace`,
      };
    case 'unverified':
      return {
        status: `Proyek ${current.projectId} dipertahankan.`,
        error: current.message,
        primaryLabel: 'Periksa kembali konteks resmi',
        primaryDisabled: false,
        navigateTo: null,
      };
  }
}

export const FIELD_CONTEXT_MARKER = '\nKonteks Lapangan: ';

export function composeDraftDescription(parts: {
  address: string | null;
  fieldContext: string | null;
  preparationLines: string[];
}): string {
  const lines = [
    'Draft project dibuat dari Persiapan RAB. Belum baseline resmi dan belum RAB final.',
    parts.address ? `Alamat Detail: ${parts.address}` : null,
    ...parts.preparationLines,
  ].filter((line): line is string => Boolean(line));
  const body = lines.join('\n');
  if (!parts.fieldContext) return body;
  return `${body}${FIELD_CONTEXT_MARKER}${parts.fieldContext.length}\n${parts.fieldContext}`;
}

export function readSavedFieldContext(
  description: unknown,
): { state: 'present'; text: string } | { state: 'absent' } | { state: 'unreadable' } {
  if (description == null || description === '') return { state: 'absent' };
  if (typeof description !== 'string') return { state: 'unreadable' };
  let searchFrom = 0;
  let sawMarker = false;
  while (searchFrom < description.length) {
    const at = description.indexOf(FIELD_CONTEXT_MARKER, searchFrom);
    if (at < 0) break;
    sawMarker = true;
    const rest = description.slice(at + FIELD_CONTEXT_MARKER.length);
    const breakAt = rest.indexOf('\n');
    const length = breakAt > 0 ? Number(rest.slice(0, breakAt)) : Number.NaN;
    const text = breakAt > 0 ? rest.slice(breakAt + 1, breakAt + 1 + length) : '';
    if (
      Number.isInteger(length)
      && length >= 1
      && text.length === length
      && breakAt + 1 + length === rest.length
    ) {
      return { state: 'present', text };
    }
    searchFrom = at + FIELD_CONTEXT_MARKER.length;
  }
  return sawMarker ? { state: 'unreadable' } : { state: 'absent' };
}

export type ProjectFieldContextView =
  | { kind: 'absent'; message: string }
  | { kind: 'present'; message: string; text: string }
  | { kind: 'unauthorized'; message: string }
  | { kind: 'unavailable'; message: string }
  | { kind: 'unreadable'; message: string };

export function projectFieldContextView(input: {
  projectId: string | null;
  httpStatus: number | null;
  description: unknown;
  failed: boolean;
}): ProjectFieldContextView {
  if (!input.projectId) {
    return {
      kind: 'absent',
      message: 'Tidak ada proyek aktif. Keterangan lapangan tidak dibaca.',
    };
  }
  if (input.failed || input.httpStatus == null || input.httpStatus !== 200) {
    if (input.httpStatus === 401 || input.httpStatus === 403) {
      return {
        kind: 'unauthorized',
        message: 'Keterangan proyek tidak dapat dibaca. Akses belum diizinkan.',
      };
    }
    return {
      kind: 'unavailable',
      message: 'Keterangan proyek belum dapat dimuat.',
    };
  }
  const read = readSavedFieldContext(input.description);
  if (read.state === 'present') {
    return {
      kind: 'present',
      message: 'Keterangan lapangan. Ditulis pengguna, belum diverifikasi.',
      text: read.text,
    };
  }
  if (read.state === 'unreadable') {
    return { kind: 'unreadable', message: 'Keterangan proyek tidak terbaca.' };
  }
  return {
    kind: 'absent',
    message: 'Belum ada keterangan lapangan pada proyek ini.',
  };
}

export function fieldContextAcknowledgement(text: string): {
  status: string;
  descriptiveContext: string | null;
} {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      status: 'Belum ada konteks lapangan. Engine belum aktif.',
      descriptiveContext: null,
    };
  }
  return {
    status:
      'Konteks lapangan ditahan sebagai keterangan proyek dan ikut tersimpan saat draft dibuat. Konteks belum dipahami. Engine belum aktif.',
    descriptiveContext: trimmed,
  };
}

function sameIds(actual: string[], expected: string[]): boolean {
  if (actual.length !== expected.length) return false;
  const counts = new Map<string, number>();
  for (const id of expected) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const id of actual) {
    const remaining = counts.get(id) ?? 0;
    if (remaining === 0) return false;
    counts.set(id, remaining - 1);
  }
  return true;
}
