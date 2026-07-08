import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FileSpreadsheet, FileText, Lock, Search, X, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

type AhspComponentGroup = 'Tenaga / Upah' | 'Bahan' | 'Alat';

interface AhspComponent {
  group: AhspComponentGroup;
  name: string;
  coefficient: string;
  unit: string;
  price: string;
  amount: string;
}

interface AhspItem {
  code: string;
  category: string;
  description: string;
  unit: string;
  total: string;
  components: AhspComponent[];
  recap: {
    labor: string;
    material: string;
    equipment: string;
    total: string;
  };
}

const defaultProjectMeta = {
  name: 'Data belum tersedia',
  rabCode: 'Data belum tersedia',
  owner: 'Data belum tersedia',
  rabStatus: 'Data belum tersedia',
};

const categories = ['Semua Kategori', 'Pekerjaan Persiapan', 'Pekerjaan Tanah', 'Pekerjaan Struktur Beton', 'Pekerjaan Finishing'] as const;

export function ProjectAhspSnapshotPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [projectMeta, setProjectMeta] = useState(defaultProjectMeta);
  const [ahspItems, setAhspItems] = useState<AhspItem[]>([]);
  
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('Semua Kategori');
  const [selectedCode, setSelectedCode] = useState('');
  const [exportMessage, setExportMessage] = useState('');

  useEffect(() => {
    async function loadData() {
      if (!projectId) return;
      try {
        setLoading(true);
        setError(null);
        
        const projResponse = await apiFetch(`/projects/${projectId}`);
        const projData = await projResponse.json();
        
        let mappedStatus = 'Draft';
        if (projData?.status === 'ACTIVE') mappedStatus = 'RAB Terkunci';
        else if (projData?.status === 'COMPLETED') mappedStatus = 'Selesai';
        else if (projData?.status === 'ON_HOLD') mappedStatus = 'RAB Terkunci';

        setProjectMeta({
          name: projData?.name || 'Data belum tersedia',
          rabCode: projData?.id ? `PRJ-${String(projData.id).slice(0, 5).toUpperCase()}` : 'Data belum tersedia',
          owner: 'Belum tersedia',
          rabStatus: mappedStatus,
        });

        const snapshotResponse = await apiFetch(`/projects/${projectId}/ahsp-snapshot`);
        const snapshotData = await snapshotResponse.json();
        if (Array.isArray(snapshotData)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const mappedItems = snapshotData.map((snapshot: any) => {
            const components: AhspComponent[] = [];
            if (snapshot.resources) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              snapshot.resources.forEach((res: any) => {
                let group: AhspComponentGroup = 'Tenaga / Upah';
                if (res.resourceType === 'MATERIAL') group = 'Bahan';
                else if (res.resourceType === 'EQUIPMENT') group = 'Alat';
                
                components.push({
                  group,
                  name: res.resourceId || 'Data belum tersedia',
                  coefficient: String(res.coefficient || '0'),
                  unit: res.baseUnit || '-',
                  price: 'Belum tersedia',
                  amount: 'Belum tersedia'
                });
              });
            }
            return {
              code: snapshot.id || 'Unknown',
              category: snapshot.workType || 'Lainnya',
              description: snapshot.methodName || 'Data belum tersedia',
              unit: '-',
              total: 'Belum tersedia',
              components,
              recap: {
                labor: 'Belum tersedia',
                material: 'Belum tersedia',
                equipment: 'Belum tersedia',
                total: 'Belum tersedia'
              }
            };
          });
          setAhspItems(mappedItems);
          if (mappedItems.length > 0) {
            setSelectedCode(mappedItems[0].code);
          }
        }
      } catch {
        setError('Snapshot AHSP belum dapat dimuat.');
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [projectId]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return ahspItems.filter((item) => {
      const matchCategory = category === 'Semua Kategori' || item.category === category;
      const matchQuery =
        normalizedQuery.length === 0 ||
        item.code.toLowerCase().includes(normalizedQuery) ||
        item.description.toLowerCase().includes(normalizedQuery);
      return matchCategory && matchQuery;
    });
  }, [category, query, ahspItems]);

  const selectedItem = ahspItems.find((item) => item.code === selectedCode) || filteredItems[0] || ahspItems[0];

  const showExportMessage = () => {
    setExportMessage('Kerangka export siap. Engine export belum aktif.');
  };

  return (
    <main className="simprok-ahsp-snapshot">
      <nav className="simprok-detail__breadcrumb" aria-label="Breadcrumb">
        <button type="button" onClick={() => navigate('/')}>
          SIMPROK
        </button>
        <span>/</span>
        <button type="button" onClick={() => navigate('/proyek')}>
          Proyek Saya
        </button>
        <span>/</span>
        <button type="button" onClick={() => navigate(projectId ? `/project/${projectId}/detail` : '/proyek')}>
          {projectMeta.name}
        </button>
        <span>/</span>
        <button type="button" onClick={() => navigate(projectId ? `/project/${projectId}/rab` : '/proyek')}>
          RAB
        </button>
        <span>/</span>
        <strong>AHSP Snapshot</strong>
      </nav>

      <section className="simprok-ahsp-snapshot-hero">
        <div>
          <p className="simprok-ahsp-snapshot__eyebrow">Snapshot Aktif</p>
          <h1>AHSP Snapshot</h1>
          <p>Analisa Harga Satuan Pekerjaan yang menjadi acuan RAB ini.</p>
        </div>
        <span className="simprok-ahsp-snapshot__lock">
          <Lock size={14} aria-hidden="true" />
          Read-only Snapshot
        </span>
      </section>

      <section className="simprok-ahsp-snapshot__meta" aria-label="Informasi Proyek dan RAB">
        <div><span>Kode RAB</span><strong>{projectMeta.rabCode}</strong></div>
        <div><span>Owner/Instansi</span><strong>{projectMeta.owner}</strong></div>
        <div><span>Status RAB</span><strong>{projectMeta.rabStatus}</strong></div>
        <div><span>Snapshot</span><strong>Aktif</strong></div>
      </section>

      <section className="simprok-ahsp-snapshot__toolbar" aria-label="Toolbar baca AHSP">
        <label className="simprok-ahsp-snapshot__search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cari kode atau nama pekerjaan..."
            aria-label="Cari kode atau nama pekerjaan"
          />
        </label>
        <div className="simprok-ahsp-snapshot__export">
          <button type="button" onClick={showExportMessage}>
            <FileText size={15} aria-hidden="true" />
            Export PDF
          </button>
          <button type="button" onClick={showExportMessage}>
            <FileSpreadsheet size={15} aria-hidden="true" />
            Export Excel
          </button>
        </div>
      </section>

      {exportMessage ? (
        <div className="simprok-ahsp-snapshot-official-message">
          <FileText size={15} aria-hidden="true" />
          <span>{exportMessage}</span>
        </div>
      ) : null}

      <div className="simprok-ahsp-snapshot__layout">
        <aside className="simprok-ahsp-snapshot__filters" aria-label="Filter kategori AHSP">
          <h2>Kategori AHSP</h2>
          {categories.map((item) => (
            <button
              key={item}
              type="button"
              className={category === item ? 'simprok-ahsp-snapshot__filter simprok-ahsp-snapshot__filter--active' : 'simprok-ahsp-snapshot__filter'}
              onClick={() => setCategory(item)}
            >
              {item}
            </button>
          ))}
        </aside>

        <section className="simprok-ahsp-snapshot__list" aria-label="Daftar AHSP">
          <header>
            <h2>Daftar AHSP</h2>
            <span>{filteredItems.length} item</span>
          </header>
          
          {loading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--simprok-text-muted)' }}>
              Memuat dokumen AHSP Snapshot...
            </div>
          ) : error ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--simprok-text-muted)' }}>
              <AlertTriangle size={24} style={{ margin: '0 auto 1rem', display: 'block' }} />
              {error}
            </div>
          ) : ahspItems.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--simprok-text-muted)' }}>
              <FileText size={24} style={{ margin: '0 auto 1rem', display: 'block' }} />
              Snapshot AHSP belum tersedia untuk proyek ini.
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="simprok-ahsp-snapshot__empty">Tidak ada AHSP yang cocok dengan pencarian.</div>
          ) : (
            filteredItems.map((item) => (
              <article key={item.code} className={selectedItem?.code === item.code ? 'simprok-ahsp-snapshot-card simprok-ahsp-snapshot-card--active' : 'simprok-ahsp-snapshot-card'}>
                <div>
                  <span className="simprok-ahsp-snapshot-card__code">{item.code}</span>
                  <h3>{item.description}</h3>
                  <p>{item.category}</p>
                </div>
                <dl>
                  <div><dt>Satuan</dt><dd>{item.unit}</dd></div>
                  <div><dt>Total Harga Satuan</dt><dd>{item.total}</dd></div>
                </dl>
                <div className="simprok-ahsp-snapshot-card__actions">
                  <button type="button" onClick={() => setSelectedCode(item.code)}>
                    Lihat Rincian
                  </button>
                </div>
              </article>
            ))
          )}
        </section>

        {selectedItem && (
          <aside className="simprok-ahsp-snapshot-detail" aria-label="Rincian AHSP read-only">
            <header>
              <div>
                <span>{selectedItem.code}</span>
                <h2>{selectedItem.description}</h2>
                <p>{selectedItem.category} · {selectedItem.unit}</p>
              </div>
              <button type="button" onClick={() => setSelectedCode('')} aria-label="Tutup rincian">
                <X size={16} aria-hidden="true" />
              </button>
            </header>

            <div className="simprok-ahsp-snapshot-detail__total">
              <span>Total Harga Satuan</span>
              <strong>{selectedItem.total}</strong>
            </div>

            <section className="simprok-ahsp-snapshot-ef-detail">
              <header>
                <h3>Rekomendasi Execution Factor</h3>
              </header>
              <p className="simprok-ahsp-snapshot-empty-ef" style={{ color: 'var(--simprok-text-muted)', fontSize: '12px' }}>
                EF belum tersedia dalam snapshot (Data AHSP belum tersambung secara utuh).
              </p>
            </section>

            {(['Tenaga / Upah', 'Bahan', 'Alat'] as AhspComponentGroup[]).map((group) => (
              <section key={group} className="simprok-ahsp-snapshot-detail__group">
                <h3>{group}</h3>
                <div className="simprok-ahsp-snapshot-detail__table">
                  <table>
                    <thead>
                      <tr>
                        <th>Komponen</th>
                        <th>Koefisien</th>
                        <th>Satuan</th>
                        <th>Harga</th>
                        <th>Jumlah</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedItem.components.filter((component) => component.group === group).map((component, idx) => (
                        <tr key={`${group}-${component.name}-${idx}`}>
                          <td>{component.name}</td>
                          <td>{component.coefficient}</td>
                          <td>{component.unit}</td>
                          <td>{component.price}</td>
                          <td>{component.amount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}

            <section className="simprok-ahsp-snapshot-recap">
              <h3>Rekapitulasi</h3>
              <dl>
                <div><dt>Total tenaga</dt><dd>{selectedItem.recap.labor}</dd></div>
                <div><dt>Total bahan</dt><dd>{selectedItem.recap.material}</dd></div>
                <div><dt>Total alat</dt><dd>{selectedItem.recap.equipment}</dd></div>
                <div><dt>Total harga satuan</dt><dd>{selectedItem.recap.total}</dd></div>
              </dl>
            </section>
          </aside>
        )}
      </div>
    </main>
  );
}

export default ProjectAhspSnapshotPage;
