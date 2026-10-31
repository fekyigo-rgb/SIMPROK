import {
  searchRegions,
  type RegionLookupItem,
} from '../../api/basicPriceWorkflow';
import { RegionHierarchySelect } from './RegionHierarchySelect';

interface RegionSearchSelectProps {
  selected: RegionLookupItem | null;
  coveredVillages?: RegionLookupItem[];
  disabled?: boolean;
  onSelect: (region: RegionLookupItem | null) => void;
  onCoveredVillagesChange?: (regions: RegionLookupItem[]) => void;
}

/**
 * Import-only city scope: the price applies across all districts/villages of
 * the selected Regency/City when District is omitted. The existing shared
 * hierarchy stays district-first by default for every other consumer.
 */
export function RegionSearchSelect({
  selected,
  coveredVillages = [],
  disabled = false,
  onSelect,
  onCoveredVillagesChange,
}: RegionSearchSelectProps) {
  return (
    <RegionHierarchySelect
      selected={selected}
      coveredVillages={coveredVillages}
      disabled={disabled}
      onSelect={onSelect}
      onCoveredVillagesChange={onCoveredVillagesChange}
      loadRegions={searchRegions}
      contextLabel="Wilayah"
      allowCityScope
    />
  );
}
