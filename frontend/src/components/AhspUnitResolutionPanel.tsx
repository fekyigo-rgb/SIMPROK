import { useEffect, useRef, useState, type ReactNode } from 'react';
import { searchUnitDefinitions, type UnitLookupItem } from '../api/basicPriceImport';
import { filterUnitIssues, type UnitResolutionIssue } from '../utils/ahspImportIntakeDisplay';

const FAMILY: Record<'LABOR' | 'MATERIAL' | 'EQUIPMENT', string> = {
  LABOR: 'Tenaga',
  MATERIAL: 'Bahan',
  EQUIPMENT: 'Peralatan',
};

/**
 * The one unit-resolution surface. Ringkasan, Lanjutkan ke Tinjauan, and an
 * individual AHSP pass a filter. They do not keep a second list.
 * The catalog search is the existing unit lookup. A confirm writes one scoped
 * decision for one stored occurrence. It does not invent an alias.
 */
export function AhspUnitResolutionPanel(props: {
  issues: readonly UnitResolutionIssue[];
  spelling: string | null;
  lineKey: string | null;
  onClose: () => void;
  onRecheck: (() => void) | null;
  onConfirm: ((issue: UnitResolutionIssue, unitDefinitionId: string) => void) | null;
}): ReactNode {
  const shown = filterUnitIssues(props.issues, { spelling: props.spelling, lineKey: props.lineKey });
  const sectionRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    sectionRef.current?.focus();
  }, [props.spelling, props.lineKey]);

  return (
    <section ref={sectionRef} className="ahsp-unit-workspace" tabIndex={-1} aria-label="Penyelesaian satuan">
      <h3 className="ahsp-section-title">Penyelesaian satuan</h3>
      <p className="ahsp-line">
        {props.spelling ? `Ejaan yang dipilih: ${props.spelling}.` : 'Seluruh satuan yang masih menunggu.'}
        {props.lineKey != null ? ' Satu pekerjaan.' : ''}
      </p>
      {shown.length === 0 ? (
        <p className="ahsp-line ahsp-line--abu">Tidak ada satuan yang masih menunggu pada saringan ini.</p>
      ) : (
        <ul className="ahsp-detail-list">
          {shown.map((issue) => (
            <li key={issue.id}>
              <p className="ahsp-line">
                {issue.title} — satuan &apos;{issue.spelling}&apos; · {issue.uses}
                {issue.resourceGroup ? ` · ${FAMILY[issue.resourceGroup]}` : ''}
              </p>
              {props.onConfirm && issue.occurrenceKey ? (
                <UnitOccurrenceChoice issue={issue} onConfirm={props.onConfirm} />
              ) : (
                <p className="ahsp-line ahsp-line--abu">
                  Pilihan satuan untuk impor yang sedang dibaca disimpan setelah impor ini tersimpan.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="ahsp-action-row">
        {props.onRecheck ? (
          <button type="button" className="ahsp-action ahsp-action--primary" onClick={props.onRecheck}>
            Periksa ulang
          </button>
        ) : (
          <p className="ahsp-line ahsp-line--abu">
            Pemeriksaan ulang impor yang sudah tersimpan memakai katalog yang sama, lalu ringkasan dan daftar ini membaca hasilnya.
          </p>
        )}
        <button type="button" className="ahsp-action ahsp-action--outline" onClick={props.onClose}>
          Biarkan belum terselesaikan
        </button>
      </div>
    </section>
  );
}

function UnitOccurrenceChoice(props: {
  issue: UnitResolutionIssue;
  onConfirm: (issue: UnitResolutionIssue, unitDefinitionId: string) => void;
}): ReactNode {
  const [candidates, setCandidates] = useState<UnitLookupItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    const spelling = props.issue.spelling.trim();
    setSelectedId(null);
    if (spelling === '') {
      setCandidates([]);
      return;
    }
    let cancelled = false;
    void searchUnitDefinitions({
      q: spelling,
      page: 1,
      limit: 8,
      ...(props.issue.resourceGroup ? { resourceType: props.issue.resourceGroup } : {}),
    })
      .then((page) => {
        if (!cancelled) setCandidates(page.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setCandidates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [props.issue.spelling, props.issue.resourceGroup, props.issue.id]);

  return (
    <div>
      {candidates.length === 0 ? (
        <p className="ahsp-line">Ejaan ini belum punya padanan pada saringan ini. Tidak ada pilihan yang dipilih sendiri.</p>
      ) : (
        <ul className="ahsp-detail-list">
          {candidates.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="ahsp-action ahsp-action--quiet"
                aria-pressed={selectedId === item.id}
                onClick={() => setSelectedId(item.id)}
              >
                {item.displayName}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="ahsp-action-row">
        <button
          type="button"
          className="ahsp-action ahsp-action--primary"
          disabled={selectedId === null}
          onClick={() => {
            if (selectedId) props.onConfirm(props.issue, selectedId);
          }}
        >
          Konfirmasi satuan
        </button>
      </div>
    </div>
  );
}
