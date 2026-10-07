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
 * Existing import Region door, now connected to the existing parentId and
 * administrativeLevel lookup filters. The shared hierarchy control emits one
 * Region only: District when Village is empty, Village when it is selected.
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
    />
  );
}
