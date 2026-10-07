import { useEffect, useId, useRef, useState } from "react";
import {
  regionOptionLabels,
  type RegionLookupItem,
} from "../../utils/basicPriceWorkflowDisplay";
import {
  REGION_HIERARCHY_LEVELS,
  emptyRegionHierarchy,
  hierarchyCodesForRegion,
  hierarchyLevelShouldRecover,
  hierarchyLevelFromRegionCode,
  persistedRegionFromHierarchy,
  persistedRegionFromVillageCoverage,
  preserveSelectedRegionOption,
  setRegionHierarchyLevel,
  type RegionHierarchyLevel,
  type RegionHierarchyLoadState,
  type RegionHierarchySelection,
} from "../../utils/regionHierarchy";

export interface RegionHierarchyQuery {
  q?: string;
  parentId?: string;
  administrativeLevel: RegionHierarchyLevel;
}

interface RegionHierarchySelectProps {
  selected: RegionLookupItem | null;
  coveredVillages?: RegionLookupItem[];
  disabled?: boolean;
  onSelect: (region: RegionLookupItem | null) => void;
  onCoveredVillagesChange?: (regions: RegionLookupItem[]) => void;
  loadRegions: (
    query: RegionHierarchyQuery,
    signal?: AbortSignal,
  ) => Promise<RegionLookupItem[]>;
  contextLabel: string;
}

const LABELS: Record<RegionHierarchyLevel, string> = {
  COUNTRY: "Negara",
  PROVINCE: "Provinsi",
  REGENCY_CITY: "Kabupaten/Kota",
  DISTRICT: "Kecamatan",
  VILLAGE: "Desa/Kelurahan (opsional)",
};

const PLACEHOLDERS: Record<RegionHierarchyLevel, string> = {
  COUNTRY: "Pilih negara",
  PROVINCE: "Pilih provinsi",
  REGENCY_CITY: "Pilih kabupaten/kota",
  DISTRICT: "Pilih kecamatan",
  VILLAGE: "Tanpa desa/kelurahan",
};

type OptionsByLevel = Record<RegionHierarchyLevel, RegionLookupItem[]>;
type StateByLevel = Record<RegionHierarchyLevel, RegionHierarchyLoadState>;

const emptyOptions = (): OptionsByLevel => ({
  COUNTRY: [],
  PROVINCE: [],
  REGENCY_CITY: [],
  DISTRICT: [],
  VILLAGE: [],
});

const emptyStates = (): StateByLevel => ({
  COUNTRY: "idle",
  PROVINCE: "idle",
  REGENCY_CITY: "idle",
  DISTRICT: "idle",
  VILLAGE: "idle",
});

const nextLevel = (
  level: RegionHierarchyLevel,
): RegionHierarchyLevel | null => {
  const index = REGION_HIERARCHY_LEVELS.indexOf(level);
  return REGION_HIERARCHY_LEVELS[index + 1] ?? null;
};

export function RegionHierarchySelect({
  selected,
  coveredVillages = [],
  disabled = false,
  onSelect,
  onCoveredVillagesChange,
  loadRegions,
  contextLabel,
}: RegionHierarchySelectProps) {
  const [selection, setSelection] =
    useState<RegionHierarchySelection>(emptyRegionHierarchy);
  const [options, setOptions] = useState<OptionsByLevel>(emptyOptions);
  const [states, setStates] = useState<StateByLevel>(emptyStates);
  const [isVillageOpen, setIsVillageOpen] = useState(false);
  const requestVersion = useRef(0);
  const initialized = useRef(false);
  // `undefined` means this control has never emitted. It must stay distinct
  // from an intentional `null` clear: React StrictMode runs a mount effect,
  // cleans it up (aborting the request), then runs it again. Initialising this
  // ref to null made that second run look like a self-emitted clear and left
  // Country permanently empty in the real browser.
  const lastEmittedId = useRef<string | null | undefined>(undefined);
  const selectRefs = useRef<
    Partial<Record<RegionHierarchyLevel, HTMLSelectElement | null>>
  >({});
  const villageDetailsRef = useRef<HTMLDetailsElement | null>(null);
  const villageSummaryRef = useRef<HTMLElement | null>(null);
  const rootId = useId();

  useEffect(() => {
    if (!isVillageOpen) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !villageDetailsRef.current?.contains(event.target)
      ) {
        setIsVillageOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setIsVillageOpen(false);
      villageSummaryRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isVillageOpen]);

  useEffect(() => {
    const selectedId = selected?.id ?? null;
    if (initialized.current && selectedId === lastEmittedId.current) return;
    initialized.current = true;
    const version = ++requestVersion.current;
    const controller = new AbortController();

    const hydrate = async () => {
      const nextSelection = emptyRegionHierarchy();
      const nextOptions = emptyOptions();
      const nextStates = emptyStates();
      const selectedHasCanonicalCode = selected
        ? hierarchyLevelFromRegionCode(selected.code) !== null
        : false;
      const expectedCodes =
        selected && selectedHasCanonicalCode
          ? hierarchyCodesForRegion(selected.code)
          : { COUNTRY: "ID" };
      let parentId: string | undefined;

      try {
        for (const level of REGION_HIERARCHY_LEVELS) {
          const expectedCode = expectedCodes[level];
          if (!expectedCode) break;
          nextStates[level] = "loading";
          const items = await loadRegions(
            { administrativeLevel: level, parentId },
            controller.signal,
          );
          if (version !== requestVersion.current) return;
          const stableItems = preserveSelectedRegionOption(
            items,
            selected?.code === expectedCode ? selected : null,
          );
          nextOptions[level] = stableItems;
          nextStates[level] = items.length > 0 ? "ready" : "empty";
          const exact =
            stableItems.find((item) => item.code === expectedCode) ?? null;
          if (!exact) break;
          nextSelection[level] = exact;
          parentId = exact.id;
        }

        // A scalar District intentionally has no expected Village code, while
        // an explicit multi-coverage value still needs its direct children to
        // restore the checklist. Load that one next level from the same
        // canonical paginated lookup; no second Region endpoint or inference.
        if (nextSelection.DISTRICT && nextOptions.VILLAGE.length === 0) {
          nextStates.VILLAGE = "loading";
          const villages = await loadRegions(
            {
              administrativeLevel: "VILLAGE",
              parentId: nextSelection.DISTRICT.id,
            },
            controller.signal,
          );
          if (version !== requestVersion.current) return;
          nextOptions.VILLAGE = villages;
          nextStates.VILLAGE = villages.length > 0 ? "ready" : "empty";
        }

        // A new form starts at canonical Indonesia and immediately exposes
        // its official provinces. It does not yet persist a regionId.
        if ((!selected || !selectedHasCanonicalCode) && nextSelection.COUNTRY) {
          const provinces = await loadRegions(
            {
              administrativeLevel: "PROVINCE",
              parentId: nextSelection.COUNTRY.id,
            },
            controller.signal,
          );
          if (version !== requestVersion.current) return;
          nextOptions.PROVINCE = provinces;
          nextStates.PROVINCE = provinces.length > 0 ? "ready" : "empty";
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        const loadingLevel = REGION_HIERARCHY_LEVELS.find(
          (level) => nextStates[level] === "loading",
        );
        if (loadingLevel) nextStates[loadingLevel] = "error";
      }

      if (version !== requestVersion.current) return;
      setSelection(nextSelection);
      setOptions(nextOptions);
      setStates(nextStates);
    };

    void hydrate();
    return () => controller.abort();
  }, [loadRegions, selected?.id]);

  const loadLevel = async (
    level: RegionHierarchyLevel,
    parentId: string | undefined,
    version: number,
  ) => {
    setStates((current) => ({ ...current, [level]: "loading" }));
    try {
      const items = await loadRegions({ administrativeLevel: level, parentId });
      if (requestVersion.current !== version) return;
      setOptions((current) => ({
        ...current,
        [level]: preserveSelectedRegionOption(items, selection[level]),
      }));
      setStates((current) => ({
        ...current,
        [level]: items.length > 0 ? "ready" : "empty",
      }));
    } catch {
      if (requestVersion.current !== version) return;
      setStates((current) => ({ ...current, [level]: "error" }));
    }
  };

  const recover = async (level: RegionHierarchyLevel) => {
    const levelIndex = REGION_HIERARCHY_LEVELS.indexOf(level);
    const parentLevel = REGION_HIERARCHY_LEVELS[levelIndex - 1];
    const parentId = parentLevel ? selection[parentLevel]?.id : undefined;
    const parentReady = levelIndex === 0 || parentId !== undefined;
    if (!hierarchyLevelShouldRecover(states[level], parentReady)) return;
    const version = ++requestVersion.current;
    await loadLevel(level, parentId, version);
    selectRefs.current[level]?.focus();
  };

  const choose = (level: RegionHierarchyLevel, regionId: string) => {
    const region = options[level].find((item) => item.id === regionId) ?? null;
    const nextSelection = setRegionHierarchyLevel(selection, level, region);
    const levelIndex = REGION_HIERARCHY_LEVELS.indexOf(level);
    const version = ++requestVersion.current;
    setSelection(nextSelection);
    setOptions(
      (current) =>
        Object.fromEntries(
          REGION_HIERARCHY_LEVELS.map((candidate, index) => [
            candidate,
            index <= levelIndex ? current[candidate] : [],
          ]),
        ) as OptionsByLevel,
    );
    setStates(
      (current) =>
        Object.fromEntries(
          REGION_HIERARCHY_LEVELS.map((candidate, index) => [
            candidate,
            index <= levelIndex ? current[candidate] : "idle",
          ]),
        ) as StateByLevel,
    );
    setIsVillageOpen(false);

    const persisted = persistedRegionFromHierarchy(nextSelection);
    lastEmittedId.current = persisted?.id ?? null;
    if (level !== "VILLAGE") onCoveredVillagesChange?.([]);
    onSelect(persisted);

    const childLevel = nextLevel(level);
    if (region && childLevel) {
      void loadLevel(childLevel, region.id, version);
    }
  };

  const selectedVillages =
    coveredVillages.length > 0
      ? coveredVillages
      : selected && hierarchyLevelFromRegionCode(selected.code) === "VILLAGE"
        ? [selected]
        : [];
  const selectedVillageIds = new Set(selectedVillages.map((item) => item.id));

  const emitVillageSelection = (nextVillages: RegionLookupItem[]) => {
    const sorted = [...nextVillages].sort(
      (left, right) =>
        left.code.localeCompare(right.code, "en") ||
        left.id.localeCompare(right.id, "en"),
    );
    const persisted = persistedRegionFromVillageCoverage(
      selection.DISTRICT,
      sorted,
    );
    setSelection((current) => ({
      ...current,
      VILLAGE: sorted.length === 1 ? sorted[0] : null,
    }));
    onCoveredVillagesChange?.(sorted);
    lastEmittedId.current = persisted?.id ?? null;
    onSelect(persisted ?? null);
  };

  const toggleVillage = (region: RegionLookupItem, checked: boolean) => {
    const next = checked
      ? [...selectedVillages.filter((item) => item.id !== region.id), region]
      : selectedVillages.filter((item) => item.id !== region.id);
    emitVillageSelection(next);
  };

  return (
    <fieldset className="bp-region-hierarchy" aria-label={contextLabel}>
      <legend className="bp-region-hierarchy__legend">{contextLabel}</legend>
      {REGION_HIERARCHY_LEVELS.map((level, index) => {
        const parentLevel = REGION_HIERARCHY_LEVELS[index - 1];
        const parentReady = index === 0 || selection[parentLevel] !== null;
        const optionLabels = regionOptionLabels(options[level]);
        if (level === "VILLAGE") {
          const villageDisabled =
            disabled || !parentReady || states.VILLAGE === "loading";
          const allSelected =
            options.VILLAGE.length > 0 &&
            selectedVillages.length === options.VILLAGE.length &&
            options.VILLAGE.every((item) => selectedVillageIds.has(item.id));
          const closedLabel =
            selectedVillages.length === 0
              ? PLACEHOLDERS.VILLAGE
              : selectedVillages.length === 1
                ? (optionLabels.get(selectedVillages[0].id) ??
                  selectedVillages[0].name)
                : allSelected
                  ? `Semua (${selectedVillages.length}) desa/kelurahan`
                  : `${selectedVillages.length} desa/kelurahan dipilih`;
          return (
            <div className="bp-field" key={level}>
              <label
                className="bp-field__label"
                htmlFor={`${rootId}-${level}`}
              >
                {LABELS[level]}
              </label>
              <details
                ref={villageDetailsRef}
                className="bp-region-multiselect"
                data-region-level={level}
                open={isVillageOpen}
              >
                <summary
                  ref={villageSummaryRef}
                  id={`${rootId}-${level}`}
                  className="bp-region-multiselect__summary"
                  aria-disabled={villageDisabled}
                  aria-expanded={isVillageOpen}
                  aria-controls={`${rootId}-${level}-panel`}
                  onClick={(event) => {
                    event.preventDefault();
                    if (!villageDisabled) {
                      setIsVillageOpen((current) => !current);
                    }
                  }}
                  onFocus={() => void recover(level)}
                >
                  {closedLabel}
                </summary>
                <div
                  id={`${rootId}-${level}-panel`}
                  className="bp-region-multiselect__panel"
                  role="group"
                  aria-label="Pilihan Desa/Kelurahan"
                >
                  <div className="bp-region-multiselect__actions">
                    <button
                      type="button"
                      className="bp-btn bp-btn--link"
                      disabled={villageDisabled || allSelected}
                      onClick={() => emitVillageSelection(options.VILLAGE)}
                    >
                      Pilih semua
                    </button>
                    <button
                      type="button"
                      className="bp-btn bp-btn--link"
                      disabled={villageDisabled || selectedVillages.length === 0}
                      onClick={() => emitVillageSelection([])}
                    >
                      Tanpa desa/kelurahan
                    </button>
                    <button
                      type="button"
                      className="bp-btn bp-btn--link"
                      onClick={() => {
                        setIsVillageOpen(false);
                        villageSummaryRef.current?.focus();
                      }}
                    >
                      Selesai
                    </button>
                  </div>
                  <div className="bp-region-multiselect__options">
                    {options.VILLAGE.map((region) => (
                      <label
                        className="bp-region-multiselect__option"
                        key={region.id}
                      >
                        <input
                          type="checkbox"
                          checked={selectedVillageIds.has(region.id)}
                          disabled={villageDisabled}
                          onChange={(event) =>
                            toggleVillage(region, event.target.checked)
                          }
                        />
                        <span>{optionLabels.get(region.id) ?? region.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </details>
              {states.VILLAGE === "loading" ? (
                <small className="bp-field__help" role="status">
                  Memuat...
                </small>
              ) : null}
              {states.VILLAGE === "error" ? (
                <div className="bp-field__help" role="alert">
                  Gagal memuat wilayah.
                  <button
                    type="button"
                    className="bp-btn bp-btn--link"
                    onClick={() => void recover(level)}
                    disabled={disabled}
                  >
                    Coba lagi
                  </button>
                </div>
              ) : null}
              {states.VILLAGE === "empty" ? (
                <div className="bp-field__help" role="status">
                  Tidak ada wilayah pada tingkat ini.
                </div>
              ) : null}
            </div>
          );
        }
        return (
          <div className="bp-field" key={level}>
            <label className="bp-field__label" htmlFor={`${rootId}-${level}`}>
              {LABELS[level]}
            </label>
            <select
              ref={(node) => {
                selectRefs.current[level] = node;
              }}
              id={`${rootId}-${level}`}
              className="bp-select"
              data-region-level={level}
              value={selection[level]?.id ?? ""}
              disabled={disabled || !parentReady || states[level] === "loading"}
              required
              onChange={(event) => choose(level, event.target.value)}
              onFocus={() => void recover(level)}
            >
              <option value="">{PLACEHOLDERS[level]}</option>
              {options[level].map((region) => (
                <option key={region.id} value={region.id}>
                  {optionLabels.get(region.id) ?? region.name}
                </option>
              ))}
            </select>
            {states[level] === "loading" ? (
              <small className="bp-field__help" role="status">
                Memuat...
              </small>
            ) : null}
            {states[level] === "error" ? (
              <div className="bp-field__help" role="alert">
                Gagal memuat wilayah.
                <button
                  type="button"
                  className="bp-btn bp-btn--link"
                  onClick={() => void recover(level)}
                  disabled={disabled}
                >
                  Coba lagi
                </button>
              </div>
            ) : null}
            {states[level] === "empty" ? (
              <div className="bp-field__help" role="status">
                Tidak ada wilayah pada tingkat ini.
                <button
                  type="button"
                  className="bp-btn bp-btn--link"
                  onClick={() => void recover(level)}
                  disabled={disabled}
                >
                  Muat ulang
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
    </fieldset>
  );
}
