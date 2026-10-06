/**
 * Product Law v1.4 — assisted classification panel inside existing AhspImportPage.
 * Owner PASS visual: Jenis Pengadaan single-select; Kategori / Subkategori /
 * Jenis Pekerjaan = vertical checkbox multi-select (soft cascade). No "Tambah
 * jalur klasifikasi" control — multi-path is produced by multiple leaf checks.
 *
 * Jenis Pengadaan roots come from the classification service.
 * Kategori, Subkategori, and Jenis Pekerjaan options come from the shared
 * lower-level vocabulary plus lawful local nodes already stored for this parent.
 * Checking a baseline name does not write a node. "+ Tambahkan pilihan baru"
 * remains the explicit local-create action.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BIDANG, JENIS_PEKERJAAN, subkategoriForBidang } from '../constructionTaxonomy';
import { apiFetch } from '../utils/apiClient';
import {
  baselineJenisPekerjaanOptions,
  baselineKategoriOptions,
  baselineSubkategoriOptions,
  isVocabularyOptionId,
  optionLabel,
  pendingPathFromSelection,
  readableClassificationPaths,
  vocabularyOptionName,
  vocabularyOptionParent,
  type VocabularyOption,
} from '../utils/ahspBaselineVocabulary';
import { nextJenisSelection } from '../utils/ahspJenisMenu';

export type AssistedPathProvenanceHint = 'FROM_SOURCE' | 'FROM_USER';

export type AssistedClassificationContext = {
  jenisPengadaanRootId: string | null;
  paths: Array<{
    leafNodeId: string;
    provenanceHint: AssistedPathProvenanceHint;
    sourceEvidence?: { label?: string | null; code?: string | null; raw?: string | null } | null;
  }>;
  pendingPaths?: Array<{
    kategori: string;
    subkategori: string;
    jenisPekerjaan: string;
  }>;
  dasarAcuan: string | null;
  penerbit: string | null;
  /** Display names for scalar create consumers (Manual) — derived from the same node truth. */
  displayLabels?: {
    jenisPengadaan: string | null;
    kategori: string[];
    subkategori: string[];
    jenisPekerjaan: string[];
  };
};

type ClassNode = {
  id: string;
  level: string;
  name: string;
  parentId: string | null;
  workspaceId: string | null;
};

type Props = {
  enabled: boolean;
  /** Prefill Dasar from preview knowledge when present. */
  prefillDasarAcuan?: string | null;
  /** When true, omit outer section title (parent card already titled). */
  embedded?: boolean;
  /** Classification-only consumers may hide Dasar/Penerbit without forking the picker. */
  showMetadata?: boolean;
  value: AssistedClassificationContext;
  onChange: (next: AssistedClassificationContext) => void;
};

function summaryLabel(nodes: ClassNode[], selectedIds: ReadonlySet<string>, empty: string): string {
  const names = nodes.filter((n) => selectedIds.has(n.id)).map((n) => n.name);
  if (names.length === 0) return empty;
  if (names.length <= 2) return names.join(', ');
  return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
}

function CheckboxMenu(props: {
  label: string;
  summary: string;
  chips?: readonly { id: string; name: string }[];
  disabled?: boolean;
  open: boolean;
  onToggle: () => void;
  onDismiss: () => void;
  onRemove: (id: string) => void;
  children: ReactNode;
  footer?: ReactNode;
}): ReactNode {
  const chips = props.chips ?? [];
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!props.open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') props.onDismiss();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      props.onDismiss();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [props.open, props.onDismiss]);
  return (
    <div className="ahsp-field ahsp-multi-select" ref={rootRef}>
      <span className="ahsp-field__label">{props.label}</span>
      <button
        type="button"
        className={
          'ahsp-multi-select__trigger' +
          (props.open ? ' ahsp-multi-select__trigger--open' : '') +
          (chips.length > 0 ? ' ahsp-multi-select__trigger--has-chips' : '')
        }
        disabled={props.disabled}
        aria-expanded={props.open}
        onClick={props.onToggle}
      >
        <span className="ahsp-multi-select__summary">{props.summary}</span>
        <span className="ahsp-multi-select__chevron" aria-hidden>
          {props.open ? '\u25B2' : '\u25BC'}
        </span>
      </button>
      {chips.length > 0 ? (
        <ul className="ahsp-multi-select__chips" aria-label={'Terpilih: ' + props.label}>
          {chips.map((chip) => (
            <li key={chip.id} className="ahsp-multi-select__chip">
              <span>{chip.name}</span>
              <button
                type="button"
                className="ahsp-multi-select__chip-remove"
                aria-label={`Hapus ${chip.name}`}
                onClick={() => props.onRemove(chip.id)}
              >
                {'\u00D7'}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {props.open ? (
        <div className="ahsp-multi-select__menu" role="group" aria-label={props.label}>
          {props.children}
          {props.footer}
        </div>
      ) : null}
    </div>
  );
}

function LocalAddFooter(props: {
  levelLabel: string;
  draft: string;
  onDraft: (v: string) => void;
  busy: boolean;
  disabled: boolean;
  onAdd: () => void;
}): ReactNode {
  return (
    <div className="ahsp-action-row ahsp-multi-select__add" style={{ marginTop: '0.5rem' }}>
      <input
        className="ahsp-field__control"
        value={props.draft}
        onChange={(e) => props.onDraft(e.target.value)}
        placeholder={`Nama ${props.levelLabel} baru\u2026`}
        aria-label={`Nama ${props.levelLabel} lokal`}
        style={{ flex: 1 }}
      />
      <button
        type="button"
        className="ahsp-action ahsp-action--quiet ahsp-action--compact"
        disabled={props.busy || props.disabled || !props.draft.trim()}
        onClick={props.onAdd}
      >
        + Tambahkan pilihan baru
      </button>
    </div>
  );
}

export function AhspImportAssistedClassificationPanel({
  enabled,
  prefillDasarAcuan,
  embedded = false,
  showMetadata = true,
  value,
  onChange,
}: Props): ReactNode {
  const [roots, setRoots] = useState<ClassNode[]>([]);
  const [kategoriByRoot, setKategoriByRoot] = useState<ClassNode[]>([]);
  const [childrenByParent, setChildrenByParent] = useState<Record<string, ClassNode[]>>({});
  const [selectedKategoriIds, setSelectedKategoriIds] = useState<Set<string>>(() => new Set());
  const [selectedSubkategoriIds, setSelectedSubkategoriIds] = useState<Set<string>>(() => new Set());
  const [selectedJenisIds, setSelectedJenisIds] = useState<Set<string>>(() => new Set());
  const [openMenu, setOpenMenu] = useState<'kategori' | 'sub' | 'jenis' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draftKategori, setDraftKategori] = useState('');
  const [draftSub, setDraftSub] = useState('');
  const [draftJenis, setDraftJenis] = useState('');
  const [customBusy, setCustomBusy] = useState(false);
  const [searchKat, setSearchKat] = useState('');
  const [searchSub, setSearchSub] = useState('');
  const [searchJenis, setSearchJenis] = useState('');
  const [searchHitsKat, setSearchHitsKat] = useState<ClassNode[]>([]);
  const [searchHitsSub, setSearchHitsSub] = useState<ClassNode[]>([]);
  const [searchHitsJenis, setSearchHitsJenis] = useState<ClassNode[]>([]);

  const allKnown = useMemo(
    () => [
      ...roots,
      ...kategoriByRoot,
      ...Object.values(childrenByParent).flat(),
      ...searchHitsKat,
      ...searchHitsSub,
      ...searchHitsJenis,
    ],
    [roots, kategoriByRoot, childrenByParent, searchHitsKat, searchHitsSub, searchHitsJenis],
  );

  const byId = useMemo(() => {
    const map = new Map<string, ClassNode>();
    for (const n of allKnown) map.set(n.id, n);
    return map;
  }, [allKnown]);

  /**
   * The node index, seeded with a node this same event has just created.
   *
   * `byId` is memoized over state, so inside the event that created a local node
   * it still predates that node. A leaf missing from the index is dropped by
   * `syncPaths` (it cannot confirm the level), which is how a just-added Jenis
   * Pekerjaan could appear checked and still never reach the saved AHSP — and how
   * a new Kategori/Subkategori name went missing from `displayLabels`. Seeding it
   * closes that window without waiting for a re-render.
   */
  const indexWith = useCallback(
    (extra?: ClassNode): Map<string, ClassNode> =>
      extra ? new Map(byId).set(extra.id, extra) : byId,
    [byId],
  );

  const syncPaths = useCallback(
    (next: {
      rootId: string | null;
      jenisIds: ReadonlySet<string>;
      kategoriIds: ReadonlySet<string>;
      subIds: ReadonlySet<string>;
      dasar: string | null;
      penerbit: string | null;
      nodeIndex: Map<string, ClassNode>;
      rootsList: ClassNode[];
    }) => {
      const nameOf = (id: string): string | null =>
        isVocabularyOptionId(id) ? vocabularyOptionName(id) : next.nodeIndex.get(id)?.name ?? null;
      const parentOf = (id: string): string | null =>
        isVocabularyOptionId(id) ? vocabularyOptionParent(id) : next.nodeIndex.get(id)?.parentId ?? null;
      const paths: AssistedClassificationContext['paths'] = [];
      const pendingPaths: NonNullable<AssistedClassificationContext['pendingPaths']> = [];
      for (const leafId of next.jenisIds) {
        const pending = pendingPathFromSelection({ jenisId: leafId, nameOf, parentOf });
        if (pending) {
          pendingPaths.push(pending);
          continue;
        }
        const leaf = next.nodeIndex.get(leafId);
        if (!leaf || leaf.level !== 'JENIS_PEKERJAAN') continue;
        paths.push({ leafNodeId: leafId, provenanceHint: 'FROM_USER' });
      }
      const rootName =
        next.rootsList.find((r) => r.id === next.rootId)?.name ??
        next.nodeIndex.get(next.rootId ?? '')?.name ??
        null;
      const namesOf = (ids: ReadonlySet<string>) =>
        [...ids].map((id) => nameOf(id)).filter((n): n is string => typeof n === 'string' && n !== '');
      onChange({
        jenisPengadaanRootId: next.rootId,
        paths,
        pendingPaths,
        dasarAcuan: next.dasar,
        penerbit: next.penerbit,
        displayLabels: {
          jenisPengadaan: rootName,
          kategori: namesOf(next.kategoriIds),
          subkategori: namesOf(next.subIds),
          jenisPekerjaan: namesOf(next.jenisIds),
        },
      });
    },
    [onChange],
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch('/ahsp/document/classification/roots');
        if (!res.ok) {
          if (!cancelled) setError('Klasifikasi belum dapat dimuat.');
          return;
        }
        const data = (await res.json()) as ClassNode[];
        if (!cancelled) setRoots(data);
      } catch {
        if (!cancelled) setError('Klasifikasi tidak dapat dihubungi.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useEffect(() => {
    if (prefillDasarAcuan && !value.dasarAcuan) {
      onChange({ ...value, dasarAcuan: prefillDasarAcuan });
    }
    // Only when preview prefill arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillDasarAcuan]);

  const loadChildren = async (parentId: string): Promise<ClassNode[]> => {
    if (isVocabularyOptionId(parentId)) return [];
    if (childrenByParent[parentId]) return childrenByParent[parentId];
    const res = await apiFetch(
      `/ahsp/document/classification/children?parentId=${encodeURIComponent(parentId)}`,
    );
    if (!res.ok) return [];
    const data = (await res.json()) as ClassNode[];
    setChildrenByParent((prev) => ({ ...prev, [parentId]: data }));
    return data;
  };

  const mergeHitsIntoChildren = (hits: ClassNode[]) => {
    setChildrenByParent((prev) => {
      const copy = { ...prev };
      for (const hit of hits) {
        if (!hit.parentId) continue;
        const list = copy[hit.parentId] ?? [];
        if (!list.some((n) => n.id === hit.id)) copy[hit.parentId] = [...list, hit];
      }
      return copy;
    });
  };

  const searchLevel = async (
    q: string,
    level: 'KATEGORI' | 'SUBKATEGORI' | 'JENIS_PEKERJAAN',
    preferredParentId: string | null,
    setHits: (nodes: ClassNode[]) => void,
  ) => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const params = new URLSearchParams({ q, level });
    if (preferredParentId) params.set('preferredParentId', preferredParentId);
    const res = await apiFetch(`/ahsp/document/classification/search?${params}`);
    if (!res.ok) return;
    const hits = (await res.json()) as ClassNode[];
    setHits(hits);
    mergeHitsIntoChildren(hits);
  };

  const onRootChange = async (rootId: string) => {
    setError(null);
    setOpenMenu(null);
    const kids = rootId ? await loadChildren(rootId) : [];
    setKategoriByRoot(kids);
    setSelectedKategoriIds(new Set());
    setSelectedSubkategoriIds(new Set());
    setSelectedJenisIds(new Set());
    setSearchKat('');
    setSearchSub('');
    setSearchJenis('');
    setSearchHitsKat([]);
    setSearchHitsSub([]);
    setSearchHitsJenis([]);
    syncPaths({
      rootId: rootId || null,
      jenisIds: new Set(),
      kategoriIds: new Set(),
      subIds: new Set(),
      dasar: value.dasarAcuan,
      penerbit: value.penerbit,
      nodeIndex: byId,
      rootsList: roots,
    });
  };

  const optionName = useCallback(
    (id: string): string | null =>
      isVocabularyOptionId(id) ? vocabularyOptionName(id) : byId.get(id)?.name ?? null,
    [byId],
  );

  const subkategoriOptions = useMemo(() => {
    const out: VocabularyOption[] = [];
    const seen = new Set<string>();
    for (const kid of selectedKategoriIds) {
      const kategoriName = optionName(kid);
      if (!kategoriName) continue;
      const existing = [...(childrenByParent[kid] ?? []), ...searchHitsSub.filter((n) => n.parentId === kid)];
      for (const option of baselineSubkategoriOptions({
        kategoriName,
        kategoriOptionId: kid,
        existing,
      })) {
        if (seen.has(option.id)) continue;
        seen.add(option.id);
        out.push(option);
      }
    }
    return out;
  }, [selectedKategoriIds, childrenByParent, searchHitsSub, optionName]);

  const jenisOptions = useMemo(() => {
    const out: VocabularyOption[] = [];
    const seen = new Set<string>();
    for (const sub of selectedSubkategoriIds) {
      const existing = [
        ...(childrenByParent[sub] ?? []),
        ...searchHitsJenis.filter((n) => n.parentId === sub),
      ];
      for (const option of baselineJenisPekerjaanOptions({ subOptionId: sub, existing })) {
        if (seen.has(option.id)) continue;
        seen.add(option.id);
        out.push(option);
      }
    }
    return out;
  }, [selectedSubkategoriIds, childrenByParent, searchHitsJenis]);

  const kategoriOptions = useMemo(() => {
    if (!value.jenisPengadaanRootId) return [];
    const existing = [...kategoriByRoot, ...searchHitsKat].filter((n) => n.level === 'KATEGORI');
    return baselineKategoriOptions(existing, value.jenisPengadaanRootId);
  }, [value.jenisPengadaanRootId, kategoriByRoot, searchHitsKat]);

  const chipsFor = (ids: ReadonlySet<string>, options: VocabularyOption[]) => {
    const listed = options.filter((node) => ids.has(node.id)).map((node) => ({ id: node.id, name: node.name }));
    const seen = new Set(listed.map((chip) => chip.id));
    for (const id of ids) {
      if (seen.has(id)) continue;
      const name = optionName(id);
      if (!name) continue;
      listed.push({ id, name });
    }
    return listed;
  };

  const pathLines = useMemo(
    () =>
      readableClassificationPaths({
        rootName:
          roots.find((root) => root.id === value.jenisPengadaanRootId)?.name ??
          value.displayLabels?.jenisPengadaan ??
          null,
        pendingPaths: value.pendingPaths ?? [],
        leafIds: value.paths.map((path) => path.leafNodeId),
        nameOf: (id) =>
          isVocabularyOptionId(id) ? vocabularyOptionName(id) : byId.get(id)?.name ?? null,
        parentOf: (id) =>
          isVocabularyOptionId(id) ? vocabularyOptionParent(id) : byId.get(id)?.parentId ?? null,
      }),
    [roots, value.jenisPengadaanRootId, value.displayLabels?.jenisPengadaan, value.pendingPaths, value.paths, byId],
  );

  const toggleKategori = async (id: string, justCreated?: ClassNode) => {
    const index = indexWith(justCreated);
    const next = new Set(selectedKategoriIds);
    if (next.has(id)) next.delete(id);
    else {
      next.add(id);
      if (!isVocabularyOptionId(id)) await loadChildren(id);
    }
    const parentKey = (id: string) =>
      isVocabularyOptionId(id) ? vocabularyOptionParent(id) : index.get(id)?.parentId ?? null;
    const stillValidSub = new Set<string>();
    for (const subId of selectedSubkategoriIds) {
      const parentId = parentKey(subId);
      if (parentId && next.has(parentId)) stillValidSub.add(subId);
    }
    const stillValidJenis = new Set<string>();
    for (const jId of selectedJenisIds) {
      const parentId = parentKey(jId);
      if (parentId && stillValidSub.has(parentId)) stillValidJenis.add(jId);
    }
    setSelectedKategoriIds(next);
    setSelectedSubkategoriIds(stillValidSub);
    setSelectedJenisIds(stillValidJenis);
    syncPaths({
      rootId: value.jenisPengadaanRootId,
      jenisIds: stillValidJenis,
      kategoriIds: next,
      subIds: stillValidSub,
      dasar: value.dasarAcuan,
      penerbit: value.penerbit,
      nodeIndex: index,
      rootsList: roots,
    });
  };

  const toggleSubkategori = async (id: string, justCreated?: ClassNode) => {
    const index = indexWith(justCreated);
    const next = new Set(selectedSubkategoriIds);
    if (next.has(id)) next.delete(id);
    else {
      next.add(id);
      if (!isVocabularyOptionId(id)) await loadChildren(id);
    }
    const stillValidJenis = new Set<string>();
    for (const jId of selectedJenisIds) {
      const parentId = isVocabularyOptionId(jId) ? vocabularyOptionParent(jId) : index.get(jId)?.parentId ?? null;
      if (parentId && next.has(parentId)) stillValidJenis.add(jId);
    }
    setSelectedSubkategoriIds(next);
    setSelectedJenisIds(stillValidJenis);
    syncPaths({
      rootId: value.jenisPengadaanRootId,
      jenisIds: stillValidJenis,
      kategoriIds: selectedKategoriIds,
      subIds: next,
      dasar: value.dasarAcuan,
      penerbit: value.penerbit,
      nodeIndex: index,
      rootsList: roots,
    });
  };

  const toggleJenis = (id: string, justCreated?: ClassNode) => {
    const index = indexWith(justCreated);
    const { ids: next, closeMenu } = nextJenisSelection(selectedJenisIds, id);
    setSelectedJenisIds(next);
    if (closeMenu) setOpenMenu(null);
    syncPaths({
      rootId: value.jenisPengadaanRootId,
      jenisIds: next,
      kategoriIds: selectedKategoriIds,
      subIds: selectedSubkategoriIds,
      dasar: value.dasarAcuan,
      penerbit: value.penerbit,
      nodeIndex: index,
      rootsList: roots,
    });
  };

  const storeNode = async (
    level: 'KATEGORI' | 'SUBKATEGORI' | 'JENIS_PEKERJAAN',
    parentId: string,
    name: string,
  ): Promise<ClassNode | null> => {
    const res = await apiFetch('/ahsp/document/classification/nodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level, name, parentId }),
    });
    if (!res.ok) return null;
    return (await res.json()) as ClassNode;
  };

  const ensureStoredParent = async (parentId: string): Promise<string | null> => {
    if (!isVocabularyOptionId(parentId)) return parentId;
    const level = parentId.split('||')[1];
    const ancestor = vocabularyOptionParent(parentId);
    const name = vocabularyOptionName(parentId);
    if (
      !ancestor ||
      !name ||
      (level !== 'KATEGORI' && level !== 'SUBKATEGORI' && level !== 'JENIS_PEKERJAAN')
    ) {
      return null;
    }
    const realAncestor = await ensureStoredParent(ancestor);
    if (!realAncestor) return null;
    const node = await storeNode(level, realAncestor, name);
    if (!node) return null;
    setChildrenByParent((prev) => {
      const list = prev[realAncestor] ?? [];
      if (list.some((item) => item.id === node.id)) return prev;
      return { ...prev, [realAncestor]: [...list, node] };
    });
    if (node.level === 'KATEGORI') {
      setKategoriByRoot((prev) => (prev.some((item) => item.id === node.id) ? prev : [...prev, node]));
    }
    return node.id;
  };

  const createLocal = async (
    level: 'KATEGORI' | 'SUBKATEGORI' | 'JENIS_PEKERJAAN',
    parentId: string,
    name: string,
    clearDraft: () => void,
  ) => {
    if (!name.trim() || !parentId) return;
    setCustomBusy(true);
    setError(null);
    try {
      const storedParent = await ensureStoredParent(parentId);
      if (!storedParent) {
        setError('Penambahan klasifikasi lokal ditolak.');
        return;
      }
      const node = await storeNode(level, storedParent, name.trim());
      if (!node) {
        setError('Penambahan klasifikasi lokal ditolak.');
        return;
      }
      setChildrenByParent((prev) => {
        const list = prev[storedParent] ?? [];
        return { ...prev, [storedParent]: [...list, node] };
      });
      if (storedParent !== parentId && level === 'SUBKATEGORI') {
        setSelectedKategoriIds((ids) => {
          const next = new Set(ids);
          next.delete(parentId);
          next.add(storedParent);
          return next;
        });
      }
      if (storedParent !== parentId && level === 'JENIS_PEKERJAAN') {
        setSelectedSubkategoriIds((ids) => {
          const next = new Set(ids);
          next.delete(parentId);
          next.add(storedParent);
          return next;
        });
      }
      if (level === 'KATEGORI') {
        setKategoriByRoot((prev) => [...prev, node]);
        await toggleKategori(node.id, node);
      } else if (level === 'SUBKATEGORI') {
        await toggleSubkategori(node.id, node);
      } else {
        toggleJenis(node.id, node);
      }
      clearDraft();
    } catch {
      setError('Penambahan klasifikasi lokal gagal.');
    } finally {
      setCustomBusy(false);
    }
  };

  if (!enabled) return null;

  const firstKategori = [...selectedKategoriIds][0] ?? null;
  const firstSub = [...selectedSubkategoriIds][0] ?? null;
  const sep = '\u203A';

  return (
    <section
      className={'ahsp-panel ahsp-assisted-classification' + (embedded ? ' ahsp-assisted-classification--embedded' : '')}
      aria-label="Klasifikasi dan konteks AHSP"
    >
      {embedded ? null : (
        <>
          <h3 className="ahsp-section-title" style={{ marginBottom: 'var(--space-2)' }}>
            Klasifikasi &amp; Konteks
          </h3>
          <p className="ahsp-line" style={{ color: 'var(--simprok-muted, #98A2B3)', marginBottom: 'var(--space-3)' }}>
            Lengkapi hanya yang belum diketahui SIMPROK. Data dari berkas tidak perlu diketik ulang.
          </p>
        </>
      )}

      {error ? <p className="ahsp-line ahsp-line--error">{error}</p> : null}

      <div className="ahsp-assisted-grid">
      <label className="ahsp-field">
        <span className="ahsp-field__label">Jenis Pengadaan</span>
        <select
          className="ahsp-field__control"
          value={value.jenisPengadaanRootId ?? ''}
          onChange={(e) => void onRootChange(e.target.value)}
        >
          <option value="">Belum dipilih</option>
          {roots.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>

      <CheckboxMenu
        label="Kategori"
        summary={summaryLabel(kategoriOptions, selectedKategoriIds, 'Pilih kategori')}
        chips={chipsFor(selectedKategoriIds, kategoriOptions)}
        disabled={!value.jenisPengadaanRootId}
        open={openMenu === 'kategori'}
        onToggle={() => setOpenMenu((m) => (m === 'kategori' ? null : 'kategori'))}
        onDismiss={() => setOpenMenu(null)}
        onRemove={(id) => void toggleKategori(id)}
        footer={
          value.jenisPengadaanRootId ? (
            <>
              <label className="ahsp-field" style={{ marginTop: '0.35rem' }}>
                <span>Cari di luar saran</span>
                <input
                  type="search"
                  value={searchKat}
                  placeholder={'Cari Kategori\u2026'}
                  onChange={(e) => {
                    setSearchKat(e.target.value);
                    void searchLevel(
                      e.target.value,
                      'KATEGORI',
                      value.jenisPengadaanRootId,
                      setSearchHitsKat,
                    );
                  }}
                />
              </label>
              <LocalAddFooter
                levelLabel="kategori"
                draft={draftKategori}
                onDraft={setDraftKategori}
                busy={customBusy}
                disabled={!value.jenisPengadaanRootId}
                onAdd={() =>
                  void createLocal(
                    'KATEGORI',
                    value.jenisPengadaanRootId as string,
                    draftKategori,
                    () => setDraftKategori(''),
                  )
                }
              />
            </>
          ) : null
        }
      >
        {kategoriOptions.length === 0 ? (
          <p className="ahsp-line ahsp-line--abu">
            Belum ada kategori untuk Jenis Pengadaan ini. Tambahkan pilihan lokal di bawah, atau cari jika sudah ada di
            ruang kerja.
          </p>
        ) : (
          kategoriOptions.map((n) => (
            <label key={n.id} className="ahsp-multi-select__option">
              <input
                type="checkbox"
                checked={selectedKategoriIds.has(n.id)}
                onChange={() => void toggleKategori(n.id)}
              />
              <span>{optionLabel(n, BIDANG)}</span>
            </label>
          ))
        )}
      </CheckboxMenu>

      <CheckboxMenu
        label="Subkategori"
        summary={
          selectedKategoriIds.size === 0
            ? 'Tergantung kategori'
            : summaryLabel(subkategoriOptions, selectedSubkategoriIds, 'Pilih subkategori')
        }
        chips={chipsFor(selectedSubkategoriIds, subkategoriOptions)}
        disabled={selectedKategoriIds.size === 0 && searchHitsSub.length === 0}
        open={openMenu === 'sub'}
        onToggle={() => setOpenMenu((m) => (m === 'sub' ? null : 'sub'))}
        onDismiss={() => setOpenMenu(null)}
        onRemove={(id) => void toggleSubkategori(id)}
        footer={
          <>
            <label className="ahsp-field" style={{ marginTop: '0.35rem' }}>
              <span>Cari di luar saran</span>
              <input
                type="search"
                value={searchSub}
                placeholder={'Cari Subkategori\u2026'}
                onChange={(e) => {
                  setSearchSub(e.target.value);
                  void searchLevel(e.target.value, 'SUBKATEGORI', firstKategori, setSearchHitsSub);
                }}
              />
            </label>
            {firstKategori ? (
              <LocalAddFooter
                levelLabel="subkategori"
                draft={draftSub}
                onDraft={setDraftSub}
                busy={customBusy}
                disabled={!firstKategori}
                onAdd={() =>
                  void createLocal('SUBKATEGORI', firstKategori, draftSub, () => setDraftSub(''))
                }
              />
            ) : null}
          </>
        }
      >
        {subkategoriOptions.length === 0 ? (
          <p className="ahsp-line ahsp-line--abu">
            {selectedKategoriIds.size === 0
              ? 'Pilih kategori terlebih dahulu, cari lintas saran, atau tambah subkategori lokal.'
              : 'Kategori ini belum memiliki subkategori dasar. Tambahan lokal yang sudah ada tetap tampil di sini.'}
          </p>
        ) : (
          subkategoriOptions.map((n) => (
            <label key={n.id} className="ahsp-multi-select__option">
              <input
                type="checkbox"
                checked={selectedSubkategoriIds.has(n.id)}
                onChange={() => void toggleSubkategori(n.id)}
              />
              <span>
                {optionLabel(
                  n,
                  n.parentId ? subkategoriForBidang(optionName(n.parentId) ?? '') : [],
                )}
              </span>
            </label>
          ))
        )}
      </CheckboxMenu>

      <CheckboxMenu
        label="Jenis Pekerjaan"
        summary={
          selectedSubkategoriIds.size === 0
            ? 'Tergantung subkategori'
            : summaryLabel(jenisOptions, selectedJenisIds, 'Pilih jenis pekerjaan')
        }
        chips={chipsFor(selectedJenisIds, jenisOptions)}
        disabled={selectedSubkategoriIds.size === 0 && searchHitsJenis.length === 0}
        open={openMenu === 'jenis'}
        onToggle={() => setOpenMenu((m) => (m === 'jenis' ? null : 'jenis'))}
        onDismiss={() => setOpenMenu(null)}
        onRemove={(id) => toggleJenis(id)}
        footer={
          <>
            <label className="ahsp-field" style={{ marginTop: '0.35rem' }}>
              <span>Cari di luar saran</span>
              <input
                type="search"
                value={searchJenis}
                placeholder={'Cari Jenis Pekerjaan\u2026'}
                onChange={(e) => {
                  setSearchJenis(e.target.value);
                  void searchLevel(
                    e.target.value,
                    'JENIS_PEKERJAAN',
                    firstSub || firstKategori,
                    setSearchHitsJenis,
                  );
                }}
              />
            </label>
            {firstSub ? (
              <LocalAddFooter
                levelLabel="jenis pekerjaan"
                draft={draftJenis}
                onDraft={setDraftJenis}
                busy={customBusy}
                disabled={!firstSub}
                onAdd={() =>
                  void createLocal('JENIS_PEKERJAAN', firstSub, draftJenis, () => setDraftJenis(''))
                }
              />
            ) : null}
          </>
        }
      >
        {jenisOptions.length === 0 ? (
          <p className="ahsp-line ahsp-line--abu">
            Pilih subkategori, cari lintas saran, atau tambah jenis pekerjaan lokal.
          </p>
        ) : (
          jenisOptions.map((n) => (
            <label key={n.id} className="ahsp-multi-select__option">
              <input
                type="checkbox"
                checked={selectedJenisIds.has(n.id)}
                onChange={() => toggleJenis(n.id)}
              />
              <span>{optionLabel(n, JENIS_PEKERJAAN)}</span>
            </label>
          ))
        )}
      </CheckboxMenu>
      </div>

      {pathLines.length > 0 ? (
        <ol className="ahsp-classification-paths" aria-label="Jalur klasifikasi">
          {pathLines.map((line, index) => (
            <li key={line}>
              <span className="ahsp-classification-paths__index">Jalur {index + 1}</span>
              <span>{line}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {showMetadata ? (
        <>
          <div className="ahsp-assisted-meta">
            <label className="ahsp-field ahsp-assisted-meta__dasar">
              <span className="ahsp-field__label">Dasar / Acuan AHSP</span>
              <input
                className="ahsp-field__control"
                value={value.dasarAcuan ?? ''}
                onChange={(e) => {
                  const next = e.target.value;
                  onChange({ ...value, dasarAcuan: next.trim() === '' ? null : next });
                }}
                placeholder={'Contoh: Berdasarkan Peraturan Menteri\u2026'}
              />
            </label>
            <label className="ahsp-field ahsp-assisted-meta__penerbit">
              <span className="ahsp-field__label">Instansi Sumber / Penerbit</span>
              <input
                className="ahsp-field__control"
                value={value.penerbit ?? ''}
                onChange={(e) => {
                  const next = e.target.value;
                  onChange({ ...value, penerbit: next.trim() === '' ? null : next });
                }}
                placeholder="Instansi penerbit (bukan Sumber Data)"
              />
            </label>
          </div>
          <p className="ahsp-line ahsp-line--abu">
            Sumber Data tetap mengikuti asal entri (Import / AHSP Saya) {sep} terpisah dari Dasar dan Penerbit.
          </p>
        </>
      ) : null}
    </section>
  );
}

export function emptyAssistedContext(): AssistedClassificationContext {
  return {
    jenisPengadaanRootId: null,
    paths: [],
    pendingPaths: [],
    dasarAcuan: null,
    penerbit: null,
    displayLabels: {
      jenisPengadaan: null,
      kategori: [],
      subkategori: [],
      jenisPekerjaan: [],
    },
  };
}
