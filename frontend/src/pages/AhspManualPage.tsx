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
import '../styles/ahsp.css';

type ResourceGroup = 'LABOR' | 'MATERIAL' | 'EQUIPMENT';

type ManualResourceRow = {
  key: string;
  resourceId: string;
  resourceName: string;
  baseUnit: string;
  coefficient: string;
  /** True only when resourceId is the catalog row the user selected. */
  catalogBound: boolean;
};

const newRowKey = () => `r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function ManualResourceGroupPanel(props: {
  title: string;
  tone: 'labor' | 'material' | 'equipment';
  icon: ReactNode;
  rows: ManualResourceRow[];
  onChange: (rows: ManualResourceRow[]) => void;
  searchQ: string;
  onSearchQ: (q: string) => void;
  hits: ResourceLookupItem[];
  searching: boolean;
  searchFailed: boolean;
}): ReactNode {
  const addHit = (item: ResourceLookupItem) => {
    props.onChange([
      ...props.rows.filter((r) => r.resourceId.trim() !== '' || r.resourceName.trim() !== ''),
      {
        key: newRowKey(),
        resourceId: item.id,
        resourceName: item.name,
        baseUnit: item.baseUnit,
        coefficient: '',
        catalogBound: true,
      },
    ]);
    props.onSearchQ('');
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
              Tidak ada di katalog untuk pencarian ini. Nama ini belum dikenal dan tidak menjadi sumber daya resmi.
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
      <table className="ahsp-manual-comp__table">
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
              <td colSpan={4} className="ahsp-line ahsp-line--abu">
                Belum ada baris. Cari di katalog di atas.
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
                  {row.catalogBound ? (
                    row.baseUnit || '—'
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
            Susun AHSP baru. Sumber daya yang sudah dikenal memakai katalog yang sama dengan Basic Price. Nama yang
            belum ada di katalog tetap hanya pada AHSP ini dan tidak menjadi sumber daya resmi.
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
        onSubmit={async (event: FormEvent) => {
          event.preventDefault();
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
              }),
            });
            if (!response.ok) {
              if (response.status === 409) {
                setError(
                  'AHSP dengan uraian ini sudah ada. Tidak ada salinan kedua yang disimpan. Buka AHSP yang sudah tersimpan dari Ruang AHSP.',
                );
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
              <span>
                Multi-jalur klasifikasi memakai fondasi yang sama dengan Import.
              </span>
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
              <span className="ahsp-field__label">Uraian AHSP</span>
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
              <input
                className="ahsp-field__control"
                value={keterangan}
                onChange={(e) => setKeterangan(e.target.value)}
                placeholder="Catatan singkat (opsional)"
                aria-label="Keterangan"
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
                Cari sumber daya dari katalog yang sama dengan Basic Price. Nama yang belum ada tetap hanya pada AHSP ini.
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
              icon={<Users size={16} />}
              rows={labor}
              onChange={setLabor}
              searchQ={laborQ}
              onSearchQ={setLaborQ}
              hits={laborHits}
              searching={laborSearching}
              searchFailed={laborFailed}
            />
            <ManualResourceGroupPanel
              title="Bahan"
              tone="material"
              icon={<Package size={16} />}
              rows={material}
              onChange={setMaterial}
              searchQ={materialQ}
              onSearchQ={setMaterialQ}
              hits={materialHits}
              searching={materialSearching}
              searchFailed={materialFailed}
            />
            <ManualResourceGroupPanel
              title="Peralatan"
              tone="equipment"
              icon={<Wrench size={16} />}
              rows={equipment}
              onChange={setEquipment}
              searchQ={equipmentQ}
              onSearchQ={setEquipmentQ}
              hits={equipmentHits}
              searching={equipmentSearching}
              searchFailed={equipmentFailed}
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
          <button type="submit" className="ahsp-action ahsp-action--primary" disabled={busy} aria-busy={busy || undefined}>
            <Check size={16} /> {busy ? 'Menyimpan\u2026' : 'Simpan AHSP'}
          </button>
        </div>
      </form>
    </main>
  );
}

export default AhspManualPage;
