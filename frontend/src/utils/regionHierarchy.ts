import type { RegionLookupItem } from "./basicPriceWorkflowDisplay";

export const REGION_HIERARCHY_LEVELS = [
  "COUNTRY",
  "PROVINCE",
  "REGENCY_CITY",
  "DISTRICT",
  "VILLAGE",
] as const;

export type RegionHierarchyLevel = (typeof REGION_HIERARCHY_LEVELS)[number];

export type RegionHierarchyLoadState =
  "idle" | "loading" | "empty" | "ready" | "error";

export type RegionHierarchySelection = Record<
  RegionHierarchyLevel,
  RegionLookupItem | null
>;

export const emptyRegionHierarchy = (): RegionHierarchySelection => ({
  COUNTRY: null,
  PROVINCE: null,
  REGENCY_CITY: null,
  DISTRICT: null,
  VILLAGE: null,
});

export const setRegionHierarchyLevel = (
  current: RegionHierarchySelection,
  level: RegionHierarchyLevel,
  region: RegionLookupItem | null,
): RegionHierarchySelection => {
  const changedIndex = REGION_HIERARCHY_LEVELS.indexOf(level);
  return Object.fromEntries(
    REGION_HIERARCHY_LEVELS.map((candidate, index) => [
      candidate,
      index < changedIndex
        ? current[candidate]
        : index === changedIndex
          ? region
          : null,
    ]),
  ) as RegionHierarchySelection;
};

export const requiredRegionHierarchyComplete = (
  selection: RegionHierarchySelection,
): boolean =>
  selection.COUNTRY !== null &&
  selection.PROVINCE !== null &&
  selection.REGENCY_CITY !== null &&
  selection.DISTRICT !== null;

/** One persisted regionId: the deepest lawful context, never five ids. */
export const persistedRegionFromHierarchy = (
  selection: RegionHierarchySelection,
): RegionLookupItem | null => selection.VILLAGE ?? selection.DISTRICT ?? null;

/**
 * Scalar anchor law for the optional Village checklist: none/many persist the
 * District, exactly one preserves the existing scalar Village behaviour.
 */
export const persistedRegionFromVillageCoverage = (
  district: RegionLookupItem | null,
  villages: readonly RegionLookupItem[],
): RegionLookupItem | null => (villages.length === 1 ? villages[0] : district);

export const hierarchyLevelShouldRecover = (
  state: RegionHierarchyLoadState,
  parentReady: boolean,
): boolean =>
  parentReady && (state === "idle" || state === "empty" || state === "error");

/** A transient empty/error reload must not erase a canonical chosen value. */
export const preserveSelectedRegionOption = (
  items: RegionLookupItem[],
  selected: RegionLookupItem | null,
): RegionLookupItem[] =>
  selected && !items.some((item) => item.id === selected.id)
    ? [selected, ...items]
    : items;

export const hierarchyLevelFromRegionCode = (
  code: string,
): RegionHierarchyLevel | null => {
  if (code === "ID") return "COUNTRY";
  if (/^\d{2}$/.test(code)) return "PROVINCE";
  if (/^\d{2}\.\d{2}$/.test(code)) return "REGENCY_CITY";
  if (/^\d{2}\.\d{2}\.\d{2}$/.test(code)) return "DISTRICT";
  if (/^\d{2}\.\d{2}\.\d{2}\.\d{4}$/.test(code)) return "VILLAGE";
  return null;
};

export const hierarchyCodesForRegion = (
  code: string,
): Partial<Record<RegionHierarchyLevel, string>> => {
  const level = hierarchyLevelFromRegionCode(code);
  if (!level) return {};
  const parts = code.split(".");
  return {
    COUNTRY: "ID",
    ...(parts.length >= 1 && code !== "ID" ? { PROVINCE: parts[0] } : {}),
    ...(parts.length >= 2 ? { REGENCY_CITY: parts.slice(0, 2).join(".") } : {}),
    ...(parts.length >= 3 ? { DISTRICT: parts.slice(0, 3).join(".") } : {}),
    ...(parts.length >= 4 ? { VILLAGE: code } : {}),
  };
};
