/**
 * Buat AHSP Manual — thin HTTP adapter on the page.
 *
 * One POST /ahsp/manual. The server writes parent, version, and HUMAN_ADDED
 * assignments in one transaction through the existing services.
 * Resource search is the existing catalog lookup, reached through the AHSP door
 * so an editor with AHSP_MANAGE does not need Basic Price permission.
 * A name the catalog does not have is stored as the hand-built resourceId words
 * Detail already uses — not a catalog id, not an observation, not a publication.
 * Simpan sebagai Draft is not offered: no Manual draft contract exists.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Check,
  FileText,
  GitBranch,
  Info,
  Package,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Users,
  Wrench,
} from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { useAuth } from '../contexts/AuthContext';
import {
  AhspImportAssistedClassificationPanel,
  emptyAssistedContext,
  type AssistedClassificationContext,
} from '../components/AhspImportAssistedClassificationPanel';
import {
  searchUnitDefinitions,
  type ResourceLookupItem,
  type ResourceType,
  type UnitLookupItem,
} from '../api/basicPriceImport';
import { parseCoefficientInput } from '../utils/ahspCompositionDisplay';
import { manualAdmissionFailure } from '../utils/ahspManualAdmission';
import { unitSuggestionLabels } from '../utils/unitSuggestionLabel';
import '../styles/ahsp.css';

type ResourceGroup = 'LABOR' | 'MATERIAL' | 'EQUIPMENT';

function legacyUnitNote(resourceType: ResourceGroup, baseUnit: string): boolean {
  const token = baseUnit.trim().toLocaleLowerCase('en-US');
  if (token === '') return false;
  const person =
    token === 'person_day' ||
    token === 'person_hour' ||
    token === 'person_week' ||
    token === 'person_month' ||
    token === 'oh' ||
    token === 'oj' ||
    token === 'orang-hari' ||
    token === 'orang-jam' ||
    token === 'orang hari' ||
    token === 'orang jam';
  const equipment = token.startsWith('equipment_') || token === 'jam alat' || token === 'hari alat' || token === 'minggu alat' || token === 'bulan alat';
  if (resourceType === 'EQUIPMENT' && person) return true;
  if (resourceType === 'LABOR' && equipment) return true;
  return false;
}

type ManualResourceRow = {
  key: string;
  resourceId: string;
  resourceName: string;
  baseUnit: string;
  /** Human label of the selected unit. The canonical code stays in baseUnit. */
  unitDisplayName?: string | null;
  unitSymbol?: string | null;
  coefficient: string;
  /** True only when resourceId is the catalog row the user selected. */
  catalogBound: boolean;
};

const newRowKey = () => `r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** A nomination the identity kernel made. Evidence for the human, never a binding. */
type IntakeCandidate = {
  resourceCatalogId: string;
  name: string;
  code: string | null;
  baseUnit: string;
};

type CatalogResourceChoice = {
  id: string;
  name: string;
  baseUnit: string;
};

/**
 * The server's answer to "does this resource already exist?" — one verdict off one
 * identity reading. REVIEW_REQUIRED is the Two-Door door: nothing was minted, and
 * the digest must travel back untouched so an examination is refused against
 * exactly the nominations the person saw.
 */
type IntakeAnswer =
  | { outcome: 'REUSED'; resource: { id: string; name: string; baseUnit: string } }
  | { outcome: 'CREATED'; resource: { id: string; name: string; baseUnit: string } }
  | {
      outcome: 'REVIEW_REQUIRED';
      candidates: IntakeCandidate[];
      candidateContextDigest: string;
    };

function ManualResourceGroupPanel(props: {
  title: string;
  tone: 'labor' | 'material' | 'equipment';
  /** The section IS the type. The editor is never asked to restate it. */
  resourceType: ResourceGroup;
  icon: ReactNode;
  rows: ManualResourceRow[];
  onChange: (rows: ManualResourceRow[]) => void;
  searchQ: string;
  onSearchQ: (q: string) => void;
  hits: ResourceLookupItem[];
  searching: boolean;
  searchFailed: boolean;
  disabled: boolean;
}): ReactNode {
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [unitQ, setUnitQ] = useState('');
  const [unitHits, setUnitHits] = useState<UnitLookupItem[]>([]);
  const [unit, setUnit] = useState<UnitLookupItem | null>(null);
  const [newCoefficient, setNewCoefficient] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [nameHits, setNameHits] = useState<ResourceLookupItem[]>([]);
  const [review, setReview] = useState<{
    candidates: IntakeCandidate[];
    candidateContextDigest: string;
  } | null>(null);
  const [selectedCatalogResource, setSelectedCatalogResource] =
    useState<CatalogResourceChoice | null>(null);
  const addLock = useRef(false);

  useEffect(() => {
    if (!addOpen) return;
    const q = newName.trim();
    if (q.length < 2) {
      setNameHits([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q, type: props.resourceType, page: '1', limit: '8' });
        const response = await apiFetch(`/ahsp/resource-search?${params.toString()}`);
        if (!response.ok) {
          setNameHits([]);
          return;
        }
        const page = (await response.json()) as { items?: ResourceLookupItem[] };
        setNameHits(page.items ?? []);
      } catch {
        setNameHits([]);
      }
    }, 280);
    return () => window.clearTimeout(timer);
  }, [addOpen, newName, props.resourceType]);

  useEffect(() => {
    if (!addOpen) return;
    const t = window.setTimeout(async () => {
      const q = unitQ.trim();
      if (props.resourceType === 'MATERIAL' && q.length < 1) {
        setUnitHits([]);
        return;
      }
      try {
        const page = await searchUnitDefinitions({
          q: q.length > 0 ? q : undefined,
          resourceType: props.resourceType,
          page: 1,
          limit: props.resourceType === 'MATERIAL' ? 12 : 8,
        });
        setUnitHits(page.items ?? []);
      } catch {
        setUnitHits([]);
      }
    }, 280);
    return () => window.clearTimeout(t);
  }, [unitQ, addOpen, props.resourceType]);

  const resetAdd = () => {
    setAddOpen(false);
    setNewName('');
    setUnitQ('');
    setUnitHits([]);
    setUnit(null);
    setNewCoefficient('');
    setAddError(null);
    setNameHits([]);
    setReview(null);
    setSelectedCatalogResource(null);
  };

  const addBound = (
    resource: CatalogResourceChoice,
    occurrenceUnit: UnitLookupItem,
  ) => {
    props.onChange([
      ...props.rows,
      {
        key: newRowKey(),
        resourceId: resource.id,
        resourceName: resource.name,
        // Resource identity and occurrence unit are separate truths. The
        // catalog's baseUnit is only a default/reference; the unit the person
        // selected for THIS AHSP line is what the recipe persists.
        baseUnit: occurrenceUnit.code,
        unitDisplayName: occurrenceUnit.displayName,
        unitSymbol: occurrenceUnit.symbol,
        coefficient: newCoefficient,
        catalogBound: true,
      },
    ]);
    resetAdd();
  };

  const chooseCatalogResource = (resource: CatalogResourceChoice) => {
    setSelectedCatalogResource(resource);
    setAddOpen(true);
    setNewName(resource.name);
    setNameHits([]);
    setReview(null);
    if (!unit) {
      // Offer the catalog reference as the starting search, never as a lock.
      setUnitQ(resource.baseUnit);
      setUnitHits([]);
    }
    props.onSearchQ('');
  };

  /**
   * One request carries the whole decision. An `examination` is sent only after a
   * person has actually seen the nominations and refused all of them — which is
   * why the refused ids and the digest are taken from `review` and never rebuilt.
   */
  const submitNew = async (examined: boolean) => {
    const name = newName.trim();
    if (name === '' || !unit) return;
    if (selectedCatalogResource) {
      addBound(selectedCatalogResource, unit);
      return;
    }
    if (addBusy || addLock.current) return;
    addLock.current = true;
    setAddBusy(true);
    setAddError(null);
    try {
      const response = await apiFetch('/ahsp/resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          resourceType: props.resourceType,
          unitDefinitionId: unit.id,
          ...(examined && review
            ? {
                refusedCandidateIds: review.candidates.map(
                  (c) => c.resourceCatalogId,
                ),
                candidateContextDigest: review.candidateContextDigest,
              }
            : {}),
        }),
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as {
          message?: unknown;
          resource?: { id?: unknown; name?: unknown; baseUnit?: unknown };
        } | null;
        const verdict = manualAdmissionFailure(response.status, failure);
        if (verdict.kind === 'bind') {
          addBound(verdict.resource, unit);
          return;
        }
        setAddError(verdict.text);
        return;
      }
      const answer = (await response.json()) as IntakeAnswer;
      if (answer.outcome === 'REVIEW_REQUIRED') {
        setReview({
          candidates: answer.candidates,
          candidateContextDigest: answer.candidateContextDigest,
        });
        return;
      }
      addBound(answer.resource, unit);
    } catch {
      setAddError('SIMPROK tidak dapat dihubungi. Sumber daya belum ditambahkan.');
    } finally {
      addLock.current = false;
      setAddBusy(false);
    }
  };
  const addHit = (item: ResourceLookupItem) => {
    // Choosing an existing identity must not silently choose its reference unit.
    // Reuse the same Unit Catalog selector the Manual add flow already has.
    chooseCatalogResource(item);
  };

  const keepPrivateName = () => {
    const name = props.searchQ.trim();
    if (name.length < 2) return;
    props.onChange([
      ...props.rows,
      {
        key: newRowKey(),
        resourceId: name,
        resourceName: name,
        baseUnit: '',
        coefficient: '',
        catalogBound: false,
      },
    ]);
    props.onSearchQ('');
  };

  return (
    <section className={`ahsp-manual-comp ahsp-manual-comp--${props.tone}`} aria-label={props.title}>
      <header className="ahsp-manual-comp__header">
        <span className="ahsp-manual-comp__icon" aria-hidden>
          {props.icon}
        </span>
        <h3 className="ahsp-manual-comp__title">{props.title}</h3>
      </header>
      <div className="ahsp-manual-comp__search">
        <Search size={14} aria-hidden />
        <input
          value={props.searchQ}
          onChange={(e) => props.onSearchQ(e.target.value)}
          placeholder={`Cari ${props.title.toLowerCase()}\u2026`}
          aria-label={`Cari ${props.title}`}
        />
      </div>
      {props.searchQ.trim().length >= 2 ? (
        <ul className="ahsp-manual-comp__hits" aria-label={`Hasil pencarian ${props.title}`}>
          {props.searching ? <li className="ahsp-line ahsp-line--abu">Mencari{'\u2026'}</li> : null}
          {!props.searching && props.searchFailed ? (
            <li className="ahsp-line ahsp-line--abu">
              Pencarian katalog tidak berhasil. Nama ini belum dicek, jadi belum boleh dianggap tidak ada.
            </li>
          ) : null}
          {!props.searching && !props.searchFailed && props.hits.length === 0 ? (
            <li className="ahsp-line ahsp-line--abu">
              Belum ada di katalog untuk pencarian ini. Tambahkan sebagai sumber daya SIMPROK dengan + Tambah
              Resource, atau pakai namanya hanya pada AHSP ini.
              <button type="button" className="ahsp-action ahsp-action--outline ahsp-action--compact" onClick={keepPrivateName}>
                Pakai nama ini hanya pada AHSP ini
              </button>
            </li>
          ) : null}
          {props.hits.map((hit) => (
            <li key={hit.id}>
              <button type="button" className="ahsp-manual-comp__hit" onClick={() => addHit(hit)}>
                <strong>{hit.name}</strong>
                <span>
                  {hit.baseUnit}
                  {hit.code ? ` · ${hit.code}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="ahsp-action-row ahsp-manual-comp__add">
        <button
          type="button"
          className="ahsp-action ahsp-action--outline ahsp-action--compact"
          disabled={props.disabled}
          aria-expanded={addOpen}
          onClick={() => (addOpen ? resetAdd() : setAddOpen(true))}
        >
          <Plus size={14} aria-hidden /> Tambah Resource
        </button>
      </div>

      {addOpen ? (
        <div
          className="ahsp-manual-comp__add-form"
          role="group"
          aria-label={`Tambah ${props.title} baru`}
        >
          <label className="ahsp-field">
            <span className="ahsp-field__label">
              Nama Resource <span className="ahsp-required">*</span>
            </span>
            <input
              className="ahsp-field__control"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                setSelectedCatalogResource(null);
                setReview(null);
              }}
              placeholder={`Nama ${props.title.toLowerCase()} baru\u2026`}
              aria-label={`Nama ${props.title} baru`}
            />
            {selectedCatalogResource ? (
              <span className="ahsp-line ahsp-line--abu">
                Resource katalog dipilih. Satuan di bawah berlaku untuk baris AHSP ini; satuan katalog hanya referensi awal.
              </span>
            ) : null}
          </label>
          <label className="ahsp-field">
            <span className="ahsp-field__label">
              Satuan <span className="ahsp-required">*</span>
            </span>
            <input
              className="ahsp-field__control"
              value={unit ? unit.displayName : unitQ}
              onChange={(e) => {
                setUnit(null);
                setUnitQ(e.target.value);
                setReview(null);
              }}
              placeholder={'Cari satuan\u2026'}
              aria-label={`Satuan ${props.title} baru`}
            />
            {!unit && unitHits.length > 0 ? (
              <ul
                className="ahsp-manual-comp__hits"
                aria-label={`Hasil satuan ${props.title}`}
              >
                {unitHits.map((u) => {
                  const labels = unitSuggestionLabels(u);
                  return (
                  <li key={u.id}>
                    <button
                      type="button"
                      className="ahsp-manual-comp__hit"
                      onClick={() => {
                        setUnit(u);
                        setUnitHits([]);
                      }}
                    >
                      <strong>{labels.primary}</strong>
                      {labels.secondary ? <span>{labels.secondary}</span> : null}
                    </button>
                  </li>
                  );
                })}
              </ul>
            ) : null}
          </label>
          <label className="ahsp-field">
            <span className="ahsp-field__label">Koefisien</span>
            <input
              className="ahsp-field__control"
              value={newCoefficient}
              onChange={(e) => setNewCoefficient(e.target.value)}
              aria-label={`Koefisien ${props.title} baru`}
              inputMode="decimal"
            />
          </label>

          {nameHits.length > 0 ? (
            <div role="group" aria-label="Sumber daya katalog untuk nama ini">
              <p className="ahsp-line">
                Katalog sudah memiliki sumber daya untuk nama ini. Pilih yang ada untuk memakainya langsung.
              </p>
              <ul className="ahsp-manual-comp__hits">
                {nameHits.map((hit) => (
                  <li key={hit.id}>
                    <button type="button" className="ahsp-manual-comp__hit" onClick={() => addHit(hit)}>
                      <strong>{hit.name}</strong>
                      <span>
                        {hit.baseUnit}
                        {hit.code ? ` \u00B7 ${hit.code}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {review ? (
            <div className="simprok-honest-frame" role="group" aria-label="Tinjau sumber daya serupa">
              <span className="simprok-honest-frame__badge">Perlu ditinjau</span>
              <p className="ahsp-line">
                SIMPROK menemukan sumber daya yang mungkin sama. Pilih yang sudah ada bila benar sama
                {'\u2014'} menambah yang baru akan menggandakan katalog.
              </p>
              <ul className="ahsp-manual-comp__hits" aria-label="Kandidat sumber daya">
                {review.candidates.map((c) => (
                  <li key={c.resourceCatalogId}>
                    <button
                      type="button"
                      className="ahsp-manual-comp__hit"
                      onClick={() =>
                        chooseCatalogResource({
                          id: c.resourceCatalogId,
                          name: c.name,
                          baseUnit: c.baseUnit,
                        })
                      }
                    >
                      <strong>{c.name}</strong>
                      <span>
                        {c.baseUnit}
                        {c.code ? ` \u00B7 ${c.code}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {addError ? (
            <p role="alert" className="ahsp-line" style={{ color: '#c0392b' }}>
              {addError}
            </p>
          ) : null}

          <div className="ahsp-action-row">
            <button
              type="button"
              className="ahsp-action ahsp-action--primary ahsp-action--compact"
              disabled={addBusy || newName.trim() === '' || !unit}
              aria-busy={addBusy || undefined}
              onClick={() => void submitNew(review !== null)}
            >
              {addBusy
                ? 'Menambahkan\u2026'
                : review !== null
                  ? 'Tambah sebagai resource baru'
                  : 'Tambah'}
            </button>
            <button
              type="button"
              className="ahsp-action ahsp-action--quiet ahsp-action--compact"
              onClick={resetAdd}
            >
              Batal
            </button>
          </div>
        </div>
      ) : null}

      <table className="ahsp-manual-comp__table ahsp-resource-columns">
        <colgroup>
          <col className="ahsp-col-name" />
          <col className="ahsp-col-unit" />
          <col className="ahsp-col-coef" />
          <col className="ahsp-col-action" />
        </colgroup>
        <thead>
          <tr>
            <th>Sumber Daya</th>
            <th>Satuan</th>
            <th>Koefisien</th>
            <th>Aksi</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="ahsp-manual-comp__empty">
                <span className="ahsp-line ahsp-line--abu">Belum ada baris. Cari di katalog di atas.</span>
              </td>
            </tr>
          ) : (
            props.rows.map((row, index) => (
              <tr key={row.key}>
                <td>
                  {row.resourceName || row.resourceId || '—'}
                  {row.catalogBound ? null : (
                    <span className="ahsp-line ahsp-line--abu">
                      {' '}
                      Belum di katalog. Disimpan sebagai nama pada AHSP ini, bukan sumber daya resmi.
                    </span>
                  )}
                </td>
                <td>
                  {legacyUnitNote(props.resourceType, row.baseUnit) ? (
                    <span className="ahsp-line ahsp-line--abu">LEGACY_INVALID_FOR_RESOURCE_TYPE</span>
                  ) : null}
                  {row.catalogBound ? (
                    <span>
                      <strong>
                        {unitSuggestionLabels({
                          displayName: row.unitDisplayName,
                          symbol: row.unitSymbol,
                          code: row.baseUnit,
                        }).primary}
                      </strong>
                    </span>
                  ) : (
                    <input
                      className="ahsp-manual-comp__coef"
                      value={row.baseUnit}
                      onChange={(e) => {
                        const next = [...props.rows];
                        next[index] = { ...row, baseUnit: e.target.value };
                        props.onChange(next);
                      }}
                      aria-label={`Satuan ${props.title} ${index + 1}`}
                      placeholder="Satuan belum dikenal"
                    />
                  )}
                </td>
                <td>
                  <input
                    className="ahsp-manual-comp__coef"
                    value={row.coefficient}
                    onChange={(e) => {
                      const next = [...props.rows];
                      next[index] = { ...row, coefficient: e.target.value };
                      props.onChange(next);
                    }}
                    aria-label={`Koefisien ${props.title} ${index + 1}`}
                    inputMode="decimal"
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="ahsp-action ahsp-action--danger ahsp-action--compact"
                    aria-label={`Hapus ${props.title} ${index + 1}`}
                    onClick={() => props.onChange(props.rows.filter((_, i) => i !== index))}
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}

export function AhspManualPage(): ReactNode {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('AHSP_MANAGE');

  const [assisted, setAssisted] = useState<AssistedClassificationContext>(() => emptyAssistedContext());
  const [methodName, setMethodName] = useState('');
  const [code, setCode] = useState('');
  const [keterangan, setKeterangan] = useState('');
  const [outputUnit, setOutputUnit] = useState('');
  const [unitHits, setUnitHits] = useState<UnitLookupItem[]>([]);
  const [unitSearching, setUnitSearching] = useState(false);
  const [labor, setLabor] = useState<ManualResourceRow[]>([]);
  const [material, setMaterial] = useState<ManualResourceRow[]>([]);
  const [equipment, setEquipment] = useState<ManualResourceRow[]>([]);
  const [laborQ, setLaborQ] = useState('');
  const [materialQ, setMaterialQ] = useState('');
  const [equipmentQ, setEquipmentQ] = useState('');
  const [laborHits, setLaborHits] = useState<ResourceLookupItem[]>([]);
  const [materialHits, setMaterialHits] = useState<ResourceLookupItem[]>([]);
  const [equipmentHits, setEquipmentHits] = useState<ResourceLookupItem[]>([]);
  const [laborSearching, setLaborSearching] = useState(false);
  const [materialSearching, setMaterialSearching] = useState(false);
  const [equipmentSearching, setEquipmentSearching] = useState(false);
  const [laborFailed, setLaborFailed] = useState(false);
  const [materialFailed, setMaterialFailed] = useState(false);
  const [equipmentFailed, setEquipmentFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitLock = useRef(false);
  const explicitSave = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const runResourceSearch = async (
    q: string,
    type: ResourceType,
    setHits: (items: ResourceLookupItem[]) => void,
    setSearching: (v: boolean) => void,
    setFailed: (v: boolean) => void,
  ) => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setHits([]);
      setFailed(false);
      return;
    }
    setSearching(true);
    try {
      const params = new URLSearchParams({ q: trimmed, type, page: '1', limit: '12' });
      const response = await apiFetch(`/ahsp/resource-search?${params.toString()}`);
      if (!response.ok) throw new Error('search failed');
      const page = (await response.json()) as { items?: ResourceLookupItem[] };
      setHits(page.items ?? []);
      setFailed(false);
    } catch {
      setHits([]);
      setFailed(true);
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    const t = window.setTimeout(() => void runResourceSearch(laborQ, 'LABOR', setLaborHits, setLaborSearching, setLaborFailed), 280);
    return () => window.clearTimeout(t);
  }, [laborQ]);

  useEffect(() => {
    const t = window.setTimeout(
      () => void runResourceSearch(materialQ, 'MATERIAL', setMaterialHits, setMaterialSearching, setMaterialFailed),
      280,
    );
    return () => window.clearTimeout(t);
  }, [materialQ]);

  useEffect(() => {
    const t = window.setTimeout(
      () => void runResourceSearch(equipmentQ, 'EQUIPMENT', setEquipmentHits, setEquipmentSearching, setEquipmentFailed),
      280,
    );
    return () => window.clearTimeout(t);
  }, [equipmentQ]);

  useEffect(() => {
    const t = window.setTimeout(async () => {
      const q = outputUnit.trim();
      if (q.length < 1) {
        setUnitHits([]);
        return;
      }
      setUnitSearching(true);
      try {
        const page = await searchUnitDefinitions({ q, page: 1, limit: 12 });
        setUnitHits(page.items ?? []);
      } catch {
        setUnitHits([]);
      } finally {
        setUnitSearching(false);
      }
    }, 280);
    return () => window.clearTimeout(t);
  }, [outputUnit]);

  if (!canManage) {
    return (
      <main className="ahsp-manual-page" aria-label="Buat AHSP Manual">
        <section className="simprok-honest-frame" role="alert">
          <span className="simprok-honest-frame__badge">Tidak tersedia</span>
          <p>Workspace aktif Anda tidak memiliki kewenangan untuk membuat AHSP Manual.</p>
        </section>
      </main>
    );
  }

  const collectResources = () => {
    const packs: Array<{ rows: ManualResourceRow[]; type: ResourceGroup }> = [
      { rows: labor, type: 'LABOR' },
      { rows: material, type: 'MATERIAL' },
      { rows: equipment, type: 'EQUIPMENT' },
    ];
    const started = packs.flatMap(({ rows, type }) =>
      rows
        .filter((r) => r.resourceId.trim() !== '' || r.resourceName.trim() !== '' || r.coefficient.trim() !== '')
        .map((r) => ({ row: r, type })),
    );
    const bad = started.find(
      ({ row }) =>
        row.resourceId.trim() === '' ||
        row.baseUnit.trim() === '' ||
        parseCoefficientInput(row.coefficient) === null,
    );
    if (bad) {
      return {
        error: `Komponen "${bad.row.resourceName || bad.row.resourceId || 'baru'}" belum lengkap. Lengkapi sumber daya, satuan, dan koefisien (> 0).`,
        resources: null as null,
      };
    }
    return {
      error: null as string | null,
      resources: started.map(({ row, type }) => ({
        resourceId: row.resourceId.trim(),
        resourceType: type,
        coefficient: parseCoefficientInput(row.coefficient) as number,
        baseUnit: row.baseUnit.trim(),
      })),
    };
  };

  return (
    <main className="ahsp-manual-page" aria-label="Buat AHSP Manual">
      <header className="ahsp-manual-page__header">
        <div>
          <h1 className="ahsp-manual-page__title">Buat AHSP Manual</h1>
          <p className="ahsp-manual-page__subtitle">
            Gunakan sumber daya dari katalog bila sudah tersedia. Jika belum ada, Anda dapat menambahkannya
            langsung. Resource baru akan disimpan di SIMPROK dan dapat digunakan pada AHSP. Informasi harga
            dikelola melalui Basic Price.
          </p>
        </div>
        <div className="ahsp-action-row">
          <Link to="/ahsp/import" className="ahsp-action ahsp-action--outline">
            <Plus size={16} /> Import AHSP
          </Link>
          <span className="ahsp-action ahsp-action--primary" aria-current="page">
            Buat AHSP Manual
          </span>
        </div>
      </header>

      <form
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
          const target = event.target;
          if (target instanceof HTMLTextAreaElement) return;
          if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
          if (target instanceof HTMLInputElement && target.hasAttribute('list')) return;
          event.preventDefault();
          const controls = Array.from(event.currentTarget.elements).filter(
            (element): element is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement =>
              (element instanceof HTMLInputElement ||
                element instanceof HTMLTextAreaElement ||
                element instanceof HTMLSelectElement) &&
              !element.disabled &&
              !(element instanceof HTMLInputElement && element.type === 'hidden'),
          );
          const currentIndex = controls.indexOf(target);
          if (currentIndex < 0) return;
          const next = controls[currentIndex + (event.shiftKey ? -1 : 1)];
          if (next) next.focus();
          else target.blur();
        }}
        onSubmit={async (event: FormEvent) => {
          event.preventDefault();
          if (!explicitSave.current) return;
          if (busy || submitLock.current) return;
          const uraian = methodName.trim();
          const unit = outputUnit.trim();
          if (!uraian) {
            setError('Uraian AHSP wajib diisi.');
            return;
          }
          if (!unit) {
            setError('Satuan Output wajib diisi.');
            return;
          }
          const collected = collectResources();
          if (collected.error) {
            setError(collected.error);
            return;
          }
          submitLock.current = true;
          setBusy(true);
          setError(null);
          let committed = false;
          try {
            const labels = assisted.displayLabels;
            const response = await apiFetch('/ahsp/manual', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                workType: (labels?.jenisPekerjaan?.[0] ?? '').trim() || uraian,
                methodName: uraian,
                code: code.trim() || null,
                fieldCategory: labels?.kategori?.[0] ?? null,
                subCategory: labels?.subkategori?.[0] ?? null,
                classification: labels?.jenisPengadaan ?? null,
                keterangan: keterangan.trim() || null,
                outputUnit: unit,
                regulationReference: assisted.dasarAcuan?.trim() || undefined,
                issuerInstitution: assisted.penerbit?.trim() || undefined,
                resources: collected.resources ?? [],
                leafNodeIds: assisted.paths.map((p) => p.leafNodeId),
                jenisPengadaanRootId: assisted.jenisPengadaanRootId,
                pendingPaths: assisted.pendingPaths ?? [],
              }),
            });
            if (!response.ok) {
              if (response.status === 409) {
                const conflict = (await response
                  .clone()
                  .json()
                  .catch(() => null)) as { message?: unknown } | null;
                if (conflict?.message === 'AHSP_IDENTITY_REVIEW_REQUIRED') {
                  setError(
                    'SIMPROK menemukan AHSP yang mungkin sama. Tidak ada AHSP kedua yang disimpan. Tinjau AHSP yang sudah ada sebelum memutuskan revisi atau jalur klasifikasi tambahan.',
                  );
                } else {
                  setError(
                    'AHSP dengan konteks dan formula yang sama sudah ada. Tidak ada salinan kedua yang disimpan. Buka AHSP yang sudah tersimpan dari Ruang AHSP.',
                  );
                }
              } else {
                setError(
                  'AHSP belum tersimpan. Tidak ada bagian yang dinyatakan berhasil — periksa satuan, formula, atau klasifikasi lalu coba lagi.',
                );
              }
              return;
            }
            const created = (await response.json()) as { id?: string };
            if (typeof created.id !== 'string' || created.id === '') {
              setError('Server tidak mengembalikan identitas AHSP yang baru dibuat.');
              return;
            }
            committed = true;
            navigate('/ahsp/' + created.id);
          } catch {
            setError('AHSP tidak dapat dihubungi.');
          } finally {
            if (!committed) {
              submitLock.current = false;
              setBusy(false);
            }
          }
        }}
      >
        <section className="ahsp-manual-card" aria-label="Klasifikasi dan konteks">
          <header className="ahsp-manual-card__header">
            <span className="ahsp-manual-card__icon ahsp-manual-card__icon--blue" aria-hidden>
              <BookOpen size={18} />
            </span>
            <div className="ahsp-manual-card__heading">
              <h2 className="ahsp-section-title">Klasifikasi &amp; Konteks</h2>
              <p className="ahsp-line ahsp-line--abu">
                Lengkapi hanya yang belum diketahui. Soft cascade dan pencarian memakai fondasi klasifikasi Import.
              </p>
            </div>
            <aside className="ahsp-manual-intel" aria-label="Intelijen SIMPROK">
              <Sparkles size={14} aria-hidden />
              <span>AHSP dapat memiliki lebih dari satu jalur klasifikasi.</span>
            </aside>
          </header>
          <AhspImportAssistedClassificationPanel
            enabled={canManage && !busy}
            embedded
            value={assisted}
            onChange={setAssisted}
          />
        </section>

        <section className="ahsp-manual-card" aria-label="Informasi AHSP">
          <header className="ahsp-manual-card__header">
            <span className="ahsp-manual-card__icon ahsp-manual-card__icon--purple" aria-hidden>
              <FileText size={18} />
            </span>
            <div className="ahsp-manual-card__heading">
              <h2 className="ahsp-section-title">Informasi AHSP</h2>
            </div>
          </header>
          <div className="ahsp-manual-info-grid">
            <label className="ahsp-field ahsp-manual-info-grid__uraian">
              <span className="ahsp-field__label">
                Uraian AHSP <span className="ahsp-required">*</span>
              </span>
              <input
                className="ahsp-field__control"
                required
                value={methodName}
                onChange={(e) => setMethodName(e.target.value)}
                placeholder="Contoh: Galian tanah biasa sedalam 0 - 1 m"
                aria-label="Uraian AHSP"
              />
            </label>
            <label className="ahsp-field ahsp-manual-info-grid__satuan">
              <span className="ahsp-field__label">
                Satuan Output <span className="ahsp-required">*</span>
              </span>
              <input
                className="ahsp-field__control"
                required
                value={outputUnit}
                onChange={(e) => setOutputUnit(e.target.value)}
                placeholder="Contoh: m3"
                aria-label="Satuan Output"
                list="ahsp-manual-unit-suggestions"
              />
              <datalist id="ahsp-manual-unit-suggestions">
                {unitHits.map((u) => (
                  <option key={u.id} value={u.symbol || u.code}>
                    {u.displayName}
                  </option>
                ))}
              </datalist>
              {unitSearching ? <span className="ahsp-line ahsp-line--abu">Mencari satuan{'\u2026'}</span> : null}
            </label>
            <label className="ahsp-field ahsp-manual-info-grid__kode">
              <span className="ahsp-field__label">Kode AHSP (opsional)</span>
              <input
                className="ahsp-field__control"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Contoh: 7.1.1.1"
                aria-label="Kode AHSP opsional"
              />
            </label>
            <label className="ahsp-field ahsp-manual-info-grid__keterangan">
              <span className="ahsp-field__label">Keterangan</span>
              <textarea
                className="ahsp-field__control"
                value={keterangan}
                onChange={(e) => setKeterangan(e.target.value)}
                placeholder="Catatan singkat (opsional)"
                aria-label="Keterangan"
                rows={3}
              />
            </label>
          </div>
        </section>

        <section className="ahsp-manual-card" aria-label="Komposisi formula AHSP">
          <header className="ahsp-manual-card__header">
            <span className="ahsp-manual-card__icon ahsp-manual-card__icon--navy" aria-hidden>
              <GitBranch size={18} />
            </span>
            <div className="ahsp-manual-card__heading">
              <h2 className="ahsp-section-title">Komposisi / Formula AHSP</h2>
              <p className="ahsp-line ahsp-line--abu">
                Cari sumber daya dari katalog yang sama dengan Basic Price. Jika belum ada, tambahkan langsung
                dengan + Tambah Resource.
              </p>
            </div>
            <aside className="ahsp-manual-info-strip" role="note">
              <Info size={14} aria-hidden />
              <span>
                Cari sumber daya dari katalog yang sama dengan Basic Price. Baris kosong tidak dikirim. Formula boleh
                dilengkapi nanti di Detail.
              </span>
            </aside>
          </header>
          <div className="ahsp-manual-comp-grid">
            <ManualResourceGroupPanel
              title="Tenaga Kerja"
              tone="labor"
              resourceType="LABOR"
              icon={<Users size={16} />}
              rows={labor}
              onChange={setLabor}
              searchQ={laborQ}
              onSearchQ={setLaborQ}
              hits={laborHits}
              searching={laborSearching}
              searchFailed={laborFailed}
              disabled={busy}
            />
            <ManualResourceGroupPanel
              title="Bahan"
              tone="material"
              resourceType="MATERIAL"
              icon={<Package size={16} />}
              rows={material}
              onChange={setMaterial}
              searchQ={materialQ}
              onSearchQ={setMaterialQ}
              hits={materialHits}
              searching={materialSearching}
              searchFailed={materialFailed}
              disabled={busy}
            />
            <ManualResourceGroupPanel
              title="Peralatan"
              tone="equipment"
              resourceType="EQUIPMENT"
              icon={<Wrench size={16} />}
              rows={equipment}
              onChange={setEquipment}
              searchQ={equipmentQ}
              onSearchQ={setEquipmentQ}
              hits={equipmentHits}
              searching={equipmentSearching}
              searchFailed={equipmentFailed}
              disabled={busy}
            />
          </div>
        </section>

        {error ? (
          <p role="alert" className="ahsp-line" style={{ color: '#c0392b' }}>
            {error}
          </p>
        ) : null}

        <div className="ahsp-manual-page__footer">
          <Link to="/ahsp" className="ahsp-action ahsp-action--quiet">
            Batal
          </Link>
          <button
            type="button"
            className="ahsp-action ahsp-action--primary"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={(event) => {
              explicitSave.current = true;
              event.currentTarget.form?.requestSubmit();
              explicitSave.current = false;
            }}
          >
            <Check size={16} /> {busy ? 'Menyimpan\u2026' : 'Simpan AHSP'}
          </button>
        </div>
      </form>
    </main>
  );
}

export default AhspManualPage;
