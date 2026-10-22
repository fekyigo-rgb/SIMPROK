import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../utils/apiClient';
import {
  acceptIntakeRegionPage,
  clearIntakeLevel,
  emptyIntakeRegionSelection,
  INTAKE_MULTI_LEVELS,
  INTAKE_REGION_PAGE_LIMIT,
  intakeLocationRegionIds,
  intakeLocationSummary,
  intakeParentIds,
  intakePicksAt,
  isCanonicalRegionId,
  projectIntakeRegionQuery,
  selectAllIntakeRegions,
  setIntakeCountry,
  toggleIntakeRegion,
  type IntakeMultiLevel,
  type IntakeRegionPick,
  type IntakeRegionSelection,
} from '../../utils/projectIntakeSelection';
import type { RegionLookupItem } from '../../utils/basicPriceWorkflowDisplay';
import { type RegionHierarchyLevel } from '../../utils/regionHierarchy';

const PROJECT_REGION_LABELS: Record<RegionHierarchyLevel, string> = {
  COUNTRY: 'Negara',
  PROVINCE: 'Provinsi',
  REGENCY_CITY: 'Kabupaten/Kota',
  DISTRICT: 'Kecamatan',
  VILLAGE: 'Desa/Kelurahan',
};

const PARENT_LEVEL: Record<IntakeMultiLevel, 'COUNTRY' | IntakeMultiLevel> = {
  PROVINCE: 'COUNTRY',
  REGENCY_CITY: 'PROVINCE',
  DISTRICT: 'REGENCY_CITY',
  VILLAGE: 'DISTRICT',
};

type ProjectIntakeLocationFieldsProps = {
  onChange: (state: {
    locationRegionIds: string[];
    blockedReason: string | null;
  }) => void;
};

export function ProjectIntakeLocationFields({
  onChange,
}: ProjectIntakeLocationFieldsProps) {
  const [selection, setSelection] = useState<IntakeRegionSelection>(emptyIntakeRegionSelection());
  const [countries, setCountries] = useState<RegionLookupItem[]>([]);
  const [options, setOptions] = useState(emptyOptions());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState(idlePhase);
  const request = useRef(0);
  const childRequest = useRef<Record<IntakeMultiLevel, number>>({
    PROVINCE: 0,
    REGENCY_CITY: 0,
    DISTRICT: 0,
    VILLAGE: 0,
  });

  async function loadCoverage(
    level: IntakeMultiLevel,
    parentId: string,
  ): Promise<{ items: IntakeRegionPick[]; complete: boolean }> {
    let state = { items: [] as IntakeRegionPick[], pages: 0 };
    let pageNumber = 1;
    while (pageNumber <= INTAKE_REGION_PAGE_LIMIT) {
      const response = await apiFetch(
        projectIntakeRegionQuery({
          administrativeLevel: level,
          parentId,
          page: pageNumber,
        }),
      );
      if (!response.ok) throw new Error(await readError(response));
      const body = (await response.json()) as { items?: unknown; hasNext?: boolean };
      if (!Array.isArray(body.items)) throw new Error('Wilayah resmi tidak tersedia.');
      const next = acceptIntakeRegionPage(state, {
        items: body.items.flatMap((item) => toPick(item, level, parentId)),
        hasNext: body.hasNext === true,
      });
      state = { items: next.items, pages: next.pages };
      if (next.truncated) return { items: [], complete: false };
      if (next.done) return { items: next.items, complete: true };
      pageNumber += 1;
    }
    return { items: [], complete: false };
  }

  async function refreshLevel(level: IntakeMultiLevel, parentIds: string[]) {
    const ticket = ++childRequest.current[level];
    if (parentIds.length === 0) {
      setOptions((current) => ({ ...current, [level]: [] }));
      setPhase((current) => ({ ...current, [level]: 'idle' }));
      return;
    }
    setPhase((current) => ({ ...current, [level]: 'loading' }));
    try {
      const merged: IntakeRegionPick[] = [];
      for (const parentId of parentIds) {
        const coverage = await loadCoverage(level, parentId);
        if (ticket !== childRequest.current[level]) return;
        if (!coverage.complete) {
          setOptions((current) => ({ ...current, [level]: [] }));
          setPhase((current) => ({ ...current, [level]: 'ready' }));
          setError(
            `Daftar ${PROJECT_REGION_LABELS[level]} melebihi ${INTAKE_REGION_PAGE_LIMIT} halaman. Semua tidak dapat dipilih dari daftar yang terpotong.`,
          );
          return;
        }
        merged.push(...coverage.items);
      }
      if (ticket !== childRequest.current[level]) return;
      setOptions((current) => ({
        ...current,
        [level]: merged.map(pickToRegion),
      }));
      setPhase((current) => ({ ...current, [level]: 'ready' }));
    } catch (cause) {
      if (ticket !== childRequest.current[level]) return;
      setPhase((current) => ({ ...current, [level]: 'ready' }));
      setError(cause instanceof Error ? cause.message : 'Wilayah resmi tidak tersedia.');
    }
  }

  async function loadCountries() {
    const ticket = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const items: RegionLookupItem[] = [];
      let pageNumber = 1;
      let done = false;
      while (!done && pageNumber <= INTAKE_REGION_PAGE_LIMIT) {
        const response = await apiFetch(
          projectIntakeRegionQuery({ administrativeLevel: 'COUNTRY', page: pageNumber }),
        );
        if (!response.ok) throw new Error(await readError(response));
        const body = (await response.json()) as { items?: unknown; hasNext?: boolean };
        if (!Array.isArray(body.items)) throw new Error('Wilayah resmi tidak tersedia.');
        items.push(...body.items.filter(isCountry));
        done = body.hasNext !== true;
        if (!done && pageNumber >= INTAKE_REGION_PAGE_LIMIT) {
          throw new Error(
            `Daftar Negara melebihi ${INTAKE_REGION_PAGE_LIMIT} halaman. Pilihan tidak diubah.`,
          );
        }
        pageNumber += 1;
      }
      if (ticket !== request.current) return;
      setCountries(items);
      setSelection(emptyIntakeRegionSelection());
      setOptions(emptyOptions());
      if (items.length === 0) setError('Wilayah resmi belum tersedia.');
    } catch (cause) {
      if (ticket !== request.current) return;
      setCountries([]);
      setError(cause instanceof Error ? cause.message : 'Wilayah resmi tidak tersedia.');
    } finally {
      if (ticket === request.current) setLoading(false);
    }
  }

  useEffect(() => {
    void loadCountries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const provinceKey = intakeParentIds(selection, 'REGENCY_CITY').join('|');
  const regencyKey = intakeParentIds(selection, 'DISTRICT').join('|');
  const districtKey = intakeParentIds(selection, 'VILLAGE').join('|');
  const countryKey = selection.country?.id ?? '';

  useEffect(() => {
    if (!countryKey) {
      setOptions(emptyOptions());
      return;
    }
    void refreshLevel('PROVINCE', [countryKey]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countryKey]);

  useEffect(() => {
    void refreshLevel('REGENCY_CITY', provinceKey ? provinceKey.split('|') : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provinceKey]);

  useEffect(() => {
    void refreshLevel('DISTRICT', regencyKey ? regencyKey.split('|') : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regencyKey]);

  useEffect(() => {
    void refreshLevel('VILLAGE', districtKey ? districtKey.split('|') : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [districtKey]);

  useEffect(() => {
    onChange({
      locationRegionIds: intakeLocationRegionIds(selection),
      blockedReason: error ?? (loading ? 'Memuat wilayah resmi.' : null),
    });
  }, [error, loading, onChange, selection]);

  async function chooseAll(level: IntakeMultiLevel) {
    const parents = intakeParentIds(selection, level);
    const collected: IntakeRegionPick[] = [];
    for (const parentId of parents) {
      const coverage = await loadCoverage(level, parentId);
      if (!coverage.complete) {
        setError(
          `Semua ${PROJECT_REGION_LABELS[level]} pada cakupan ini belum selesai dimuat. Pilihan tidak diubah.`,
        );
        return;
      }
      collected.push(...coverage.items);
    }
    const next = selectAllIntakeRegions(selection, level, {
      items: collected,
      complete: true,
    });
    if (next.refused) {
      setError(next.refused);
      return;
    }
    setError(null);
    setSelection(next.selection);
  }

  const summary = intakeLocationSummary(selection);

  return (
    <>
      <label className="simprok-rab-field simprok-rab-field--wide">
        <span>Negara</span>
        <select
          aria-label="Negara"
          value={selection.country?.id ?? ''}
          disabled={loading && countries.length === 0}
          onChange={(event) => {
            const country = countries.find((item) => item.id === event.target.value) ?? null;
            setSelection(
              setIntakeCountry(
                selection,
                country ? { id: country.id, name: country.name } : null,
              ),
            );
            setError(null);
          }}
        >
          <option value="">
            {loading && countries.length === 0 ? 'Memuat wilayah resmi...' : 'Pilih Negara'}
          </option>
          {countries.map((region) => (
            <option key={region.id} value={region.id}>
              {region.name}
            </option>
          ))}
        </select>
      </label>
      {INTAKE_MULTI_LEVELS.map((level) => {
        const parents = intakeParentIds(selection, level);
        const scope = scopeNames(selection, level);
        const selected = new Set(intakePicksAt(selection, level).map((pick) => pick.id));
        return (
          <div className="simprok-rab-field simprok-rab-region-multi" key={level}>
            <span id={`intake-region-${level}`}>{PROJECT_REGION_LABELS[level]}</span>
            <p className="simprok-rab-region-multi__scope">
              {scope.length > 0 ? `Cakupan: ${scope.join(' · ')}` : 'Pilih induk wilayah terlebih dahulu.'}
            </p>
            <div role="group" aria-labelledby={`intake-region-${level}`} className="simprok-rab-region-multi__list">
              {options[level].length === 0 ? (
                <small>
                  {parents.length === 0
                    ? 'Belum ada cakupan.'
                    : phase[level] === 'ready'
                      ? 'Tidak ada wilayah pada cakupan ini.'
                      : 'Memuat wilayah resmi...'}
                </small>
              ) : (
                options[level].map((region) => (
                  <label key={region.id}>
                    <input
                      type="checkbox"
                      value={region.id}
                      data-region-id={region.id}
                      checked={selected.has(region.id)}
                      disabled={parents.length === 0}
                      onChange={() => {
                        const [pick] = toPick(region, level, region.parentId ?? '');
                        if (!pick) return;
                        setSelection((current) => toggleIntakeRegion(current, pick));
                      }}
                    />
                    <span>{region.name}</span>
                  </label>
                ))
              )}
            </div>
            <div className="simprok-rab-region-multi__actions">
              <button
                type="button"
                onClick={() => void chooseAll(level)}
                disabled={parents.length === 0 || options[level].length === 0}
              >
                {`Semua ${PROJECT_REGION_LABELS[level]}`}
              </button>
              <button
                type="button"
                onClick={() => setSelection((current) => clearIntakeLevel(current, level))}
                disabled={selected.size === 0}
              >
                Bersihkan
              </button>
            </div>
          </div>
        );
      })}
      <div className="simprok-rab-field simprok-rab-field--wide simprok-rab-chosen">
        <span>Lokasi terpilih</span>
        {summary.length === 0 ? (
          <small>Belum ada lokasi resmi.</small>
        ) : (
          <ul>
            {summary.map((location) => (
              <li key={location.id} data-region-id={location.id}>
                <span>{location.label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error ? (
        <div className="simprok-rab-field simprok-rab-field--wide">
          <strong style={{ color: '#C0392B' }}>{error}</strong>
          <button type="button" onClick={() => void loadCountries()}>
            Muat ulang wilayah
          </button>
        </div>
      ) : null}
    </>
  );
}

function scopeNames(selection: IntakeRegionSelection, level: IntakeMultiLevel): string[] {
  if (level === 'PROVINCE') return selection.country ? [selection.country.name] : [];
  const parent = PARENT_LEVEL[level];
  if (parent === 'COUNTRY') return [];
  return intakePicksAt(selection, parent).map((pick) => pick.name);
}

function emptyOptions(): Record<IntakeMultiLevel, RegionLookupItem[]> {
  return { PROVINCE: [], REGENCY_CITY: [], DISTRICT: [], VILLAGE: [] };
}

function idlePhase(): Record<IntakeMultiLevel, 'idle' | 'loading' | 'ready'> {
  return { PROVINCE: 'idle', REGENCY_CITY: 'idle', DISTRICT: 'idle', VILLAGE: 'idle' };
}

function pickToRegion(pick: IntakeRegionPick): RegionLookupItem {
  return {
    id: pick.id,
    code: '',
    name: pick.name,
    parentId: pick.parentId,
    administrativeLevel: pick.level,
  };
}

function toPick(
  value: unknown,
  level: IntakeMultiLevel,
  parentId: string,
): IntakeRegionPick[] {
  if (!isCountry(value) && !isRegion(value)) return [];
  const region = value as RegionLookupItem;
  const resolvedParent = region.parentId ?? parentId;
  if (!isCanonicalRegionId(region.id) || !isCanonicalRegionId(resolvedParent)) return [];
  return [{ id: region.id, name: region.name, parentId: resolvedParent, level }];
}

function isCountry(value: unknown): value is RegionLookupItem {
  return isRegion(value);
}

function isRegion(value: unknown): value is RegionLookupItem {
  if (!value || typeof value !== 'object') return false;
  const region = value as Record<string, unknown>;
  return typeof region.id === 'string' && typeof region.name === 'string';
}

async function readError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as
    | { message?: string | string[] }
    | null;
  if (Array.isArray(body?.message)) return body.message.join(' ');
  if (typeof body?.message === 'string' && body.message.trim()) return body.message;
  return `Wilayah resmi tidak dapat dimuat (${response.status}).`;
}
