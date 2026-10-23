import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../utils/apiClient';
import {
  emptyIntakeClassification,
  projectIntakeChildrenQuery,
  setIntakeClassificationRoot,
  visibleProjectClassificationNodes,
  type IntakeClassificationSelection,
  type ProjectClassificationNode,
} from '../../utils/projectIntakeSelection';
import {
  projectKategoriOptions,
  projectKategoriSelectionKey,
  projectKategoriIdsFromKey,
  projectSubkategoriOptions,
  projectClassificationCreateSelection,
  toggleProjectClassification,
  type ProjectVocabularyPath,
} from '../../utils/projectIntakeVocabulary';
import { isVocabularyOptionId } from '../../utils/ahspBaselineVocabulary';

type ProjectIntakeClassificationFieldsProps = {
  onChange: (state: {
    classificationNodeIds: string[] | null;
    classificationVocabularyPaths: ProjectVocabularyPath[];
    blockedReason: string | null;
  }) => void;
};

type ChildState = {
  loaded: boolean;
  nodes: ProjectClassificationNode[];
};

export function ProjectIntakeClassificationFields({
  onChange,
}: ProjectIntakeClassificationFieldsProps) {
  const [roots, setRoots] = useState<ProjectClassificationNode[]>([]);
  const [kategoriOptions, setKategoriOptions] = useState<ProjectClassificationNode[]>([]);
  const [kategoriLoaded, setKategoriLoaded] = useState(false);
  const [children, setChildren] = useState<Record<string, ChildState>>({});
  const [selection, setSelection] = useState<IntakeClassificationSelection>(emptyIntakeClassification());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const request = useRef(0);
  const childRequest = useRef<Record<string, number>>({});

  async function loadNodes(
    level: 'JENIS_PENGADAAN' | 'KATEGORI' | 'SUBKATEGORI',
    parentId?: string,
  ): Promise<ProjectClassificationNode[]> {
    if (level === 'SUBKATEGORI' && parentId && isVocabularyOptionId(parentId)) {
      const parent = kategoriOptions.find((node) => node.id === parentId);
      return parent ? projectSubkategoriOptions([], parent, selection.root?.name ?? '') : [];
    }
    const response = await apiFetch(
      parentId
        ? projectIntakeChildrenQuery(parentId)
        : '/project-intake/classification/roots',
    );
    if (!response.ok) throw new Error(await readError(response));
    const body: unknown = await response.json();
    const stored = visibleProjectClassificationNodes(readClassificationNodes(body), level).filter(
      (node) => isPersistedNode(node),
    );
    if (level === 'KATEGORI' && parentId) return projectKategoriOptions(stored, parentId, roots.find((node) => node.id === parentId)?.name ?? '');
    if (level === 'SUBKATEGORI' && parentId) {
      const parent = kategoriOptions.find((node) => node.id === parentId);
      return parent ? projectSubkategoriOptions(stored, parent, selection.root?.name ?? '') : stored;
    }
    return stored;
  }

  async function loadRoots() {
    const ticket = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const nodes = await loadNodes('JENIS_PENGADAAN');
      if (ticket !== request.current) return;
      setRoots(nodes);
      setKategoriOptions([]);
      setChildren({});
      setSelection(emptyIntakeClassification());
      if (nodes.length === 0) setError('Klasifikasi resmi belum tersedia.');
    } catch (cause) {
      if (ticket !== request.current) return;
      setRoots([]);
      setError(cause instanceof Error ? cause.message : 'Klasifikasi resmi tidak tersedia.');
    } finally {
      if (ticket === request.current) setLoading(false);
    }
  }

  useEffect(() => {
    void loadRoots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rootId = selection.root?.id ?? '';
  useEffect(() => {
    if (!rootId) {
      setKategoriOptions([]);
      setKategoriLoaded(false);
      setChildren({});
      return;
    }
    const ticket = ++request.current;
    setKategoriLoaded(false);
    void loadNodes('KATEGORI', rootId)
      .then((nodes) => {
        if (ticket !== request.current) return;
        setKategoriOptions(nodes);
        setKategoriLoaded(true);
      })
      .catch((cause) => {
        if (ticket !== request.current) return;
        setKategoriOptions([]);
        setError(cause instanceof Error ? cause.message : 'Klasifikasi resmi tidak tersedia.');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootId]);

  const kategoriKey = projectKategoriSelectionKey(selection.picks);

  useEffect(() => {
    const ids = projectKategoriIdsFromKey(kategoriKey);
    setChildren((current) => {
      const next: Record<string, ChildState> = {};
      for (const id of ids) next[id] = current[id] ?? { loaded: false, nodes: [] };
      return next;
    });
    for (const id of ids) {
      if (children[id]?.loaded) continue;
      const ticket = (childRequest.current[id] ?? 0) + 1;
      childRequest.current[id] = ticket;
      void loadNodes('SUBKATEGORI', id)
        .then((nodes) => {
          if (childRequest.current[id] !== ticket) return;
          setChildren((current) => ({ ...current, [id]: { loaded: true, nodes } }));
        })
        .catch((cause) => {
          if (childRequest.current[id] !== ticket) return;
          setError(cause instanceof Error ? cause.message : 'Klasifikasi resmi tidak tersedia.');
        });
    }
    // children is intentionally read as a cache. The kategori key owns the reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kategoriKey]);

  const prepared = projectClassificationCreateSelection(selection, children);
  const idKey = prepared.classificationNodeIds?.join('|') ?? '';
  const pathKey = JSON.stringify(prepared.classificationVocabularyPaths);
  const waitingForChildren = prepared.waitingForChildren;

  useEffect(() => {
    onChange({
      classificationNodeIds: idKey ? idKey.split('|') : null,
      classificationVocabularyPaths: prepared.classificationVocabularyPaths,
      blockedReason: error ?? (loading || waitingForChildren ? 'Memuat klasifikasi resmi.' : null),
    });
  }, [error, idKey, pathKey, loading, onChange, waitingForChildren]);

  const selectedKategori = new Set(
    selection.picks.filter((pick) => pick.level === 'KATEGORI').map((pick) => pick.id),
  );
  const selectedSub = new Set(
    selection.picks.filter((pick) => pick.level === 'SUBKATEGORI').map((pick) => pick.id),
  );
  const subOptions = selection.picks
    .filter((pick) => pick.level === 'KATEGORI')
    .flatMap((pick) => children[pick.id]?.nodes ?? []);

  return (
    <>
      <label className="simprok-rab-field simprok-rab-field--kategori">
        <span>Jenis Pengadaan</span>
        <select
          aria-label="Jenis Pengadaan"
          value={selection.root?.id ?? ''}
          disabled={loading && roots.length === 0}
          onChange={(event) => {
            const root = roots.find((item) => item.id === event.target.value) ?? null;
            setSelection(setIntakeClassificationRoot(selection, root));
            setChildren({});
            setError(null);
          }}
        >
          <option value="">
            {loading && roots.length === 0
              ? 'Memuat klasifikasi resmi...'
              : 'Pilih Jenis Pengadaan'}
          </option>
          {roots.map((node) => (
            <option key={node.id} value={node.id}>
              {node.name}
            </option>
          ))}
        </select>
      </label>
      <div className="simprok-rab-field simprok-rab-region-multi">
        <span id="intake-class-KATEGORI">Kategori</span>
        <p className="simprok-rab-region-multi__scope">
          {selection.root ? `Cakupan: ${selection.root.name}` : 'Pilih Jenis Pengadaan terlebih dahulu.'}
        </p>
        <div role="group" aria-labelledby="intake-class-KATEGORI" className="simprok-rab-region-multi__list">
          {kategoriOptions.length === 0 ? (
            <small>
              {!selection.root
                ? 'Belum ada cakupan.'
                : kategoriLoaded
                  ? 'Tidak ada kategori resmi pada cakupan ini.'
                  : 'Memuat klasifikasi resmi...'}
            </small>
          ) : (
            kategoriOptions.map((node) => (
              <label key={node.id}>
                <input
                  type="checkbox"
                  value={node.id}
                  data-classification-id={node.id}
                  checked={selectedKategori.has(node.id)}
                  disabled={!selection.root}
                  onChange={() => {
                    if (!selection.root) return;
                    setSelection((current) =>
                      toggleProjectClassification(current, {
                        id: node.id,
                        name: node.name,
                        parentId: current.root?.id ?? '',
                        level: 'KATEGORI',
                      }),
                    );
                  }}
                />
                <span>{node.name}</span>
              </label>
            ))
          )}
        </div>
      </div>
      <div className="simprok-rab-field simprok-rab-region-multi">
        <span id="intake-class-SUBKATEGORI">Subkategori</span>
        <p className="simprok-rab-region-multi__scope">
          {selectedKategori.size > 0
            ? `Cakupan: ${selection.picks
                .filter((pick) => pick.level === 'KATEGORI')
                .map((pick) => pick.name)
                .join(' · ')}`
            : 'Pilih kategori terlebih dahulu.'}
        </p>
        <div role="group" aria-labelledby="intake-class-SUBKATEGORI" className="simprok-rab-region-multi__list">
          {selectedKategori.size === 0 ? (
            <small>Belum ada cakupan.</small>
          ) : waitingForChildren ? (
            <small>Memuat klasifikasi resmi...</small>
          ) : subOptions.length === 0 ? (
            <small>Tidak ada subkategori resmi pada cakupan ini.</small>
          ) : (
            subOptions.map((node) => (
              <label key={node.id}>
                <input
                  type="checkbox"
                  value={node.id}
                  data-classification-id={node.id}
                  data-parent-id={node.parentId ?? ''}
                  checked={selectedSub.has(node.id)}
                  onChange={() => {
                    if (!node.parentId) return;
                    setSelection((current) =>
                      toggleProjectClassification(current, {
                        id: node.id,
                        name: node.name,
                        parentId: node.parentId ?? '',
                        level: 'SUBKATEGORI',
                      }),
                    );
                  }}
                />
                <span>{node.name}</span>
              </label>
            ))
          )}
        </div>
      </div>
      {error ? (
        <div className="simprok-rab-field simprok-rab-field--wide">
          <strong style={{ color: '#C0392B' }}>{error}</strong>
          <button type="button" onClick={() => void loadRoots()}>
            Muat ulang klasifikasi
          </button>
        </div>
      ) : null}
    </>
  );
}

function isPersistedNode(node: ProjectClassificationNode): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(node.id)
    && !node.id.includes('||');
}

function readClassificationNodes(body: unknown): ProjectClassificationNode[] {
  if (!Array.isArray(body)) {
    throw new Error('Klasifikasi resmi tidak tersedia.');
  }
  return body.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const node = value as Record<string, unknown>;
    if (
      typeof node.id !== 'string' ||
      typeof node.level !== 'string' ||
      typeof node.name !== 'string'
    ) {
      return [];
    }
    return [
      {
        id: node.id,
        level: node.level,
        name: node.name,
        parentId: typeof node.parentId === 'string' ? node.parentId : null,
      },
    ];
  });
}

async function readError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as
    | { message?: string | string[] }
    | null;
  if (Array.isArray(body?.message)) return body.message.join(' ');
  if (typeof body?.message === 'string' && body.message.trim()) return body.message;
  return `Klasifikasi resmi tidak dapat dimuat (${response.status}).`;
}
