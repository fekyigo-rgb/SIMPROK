import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FileSpreadsheet, FileText, Lock, Search, X } from 'lucide-react';

type AhspCategory = 'Pekerjaan Persiapan' | 'Pekerjaan Tanah' | 'Pekerjaan Struktur Beton' | 'Pekerjaan Finishing';
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
  category: AhspCategory;
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

const projectMetaById: Record<string, { name: string; rabCode: string; owner: string; rabStatus: string }> = {
  'gedung-a': {
    name: 'Pembangunan Gedung A',
    rabCode: 'RAB-GDG-A-2026',
    owner: 'Dinas PUPR Kota Ambon',
    rabStatus: 'Approved / RAB Terkunci',
  },
  'pipa-b': {
    name: 'Renovasi Jaringan Pipa B',
    rabCode: 'RAB-PIP-B-2026',
    owner: 'Dinas PUPR Kota Ambon',
    rabStatus: 'RAB Terkunci',
  },
  'kendaraan-c': {
    name: 'Pengadaan Kendaraan C',
    rabCode: 'RAB-KDR-C-2026',
    owner: 'Dinas PUPR Kota Ambon',
    rabStatus: 'Approved / RAB Terkunci',
  },
  'infrastruktur-d': {
    name: 'Perbaikan Infrastruktur D',
    rabCode: 'RAB-INF-D-2026',
    owner: 'Dinas PUPR Kota Ambon',
    rabStatus: 'Approved / RAB Terkunci',
  },
  'arsip-e': {
    name: 'Pekerjaan Drainase E',
    rabCode: 'RAB-DRN-E-2026',
    owner: 'Dinas PUPR Kota Ambon',
    rabStatus: 'RAB Terkunci',
  },
};

const defaultProjectMeta = {
  name: 'Pembangunan Gedung A',
  rabCode: 'RAB-GDG-A-2026',
  owner: 'Dinas PUPR Kota Ambon',
  rabStatus: 'Approved / RAB Terkunci',
};

const ahspItems: AhspItem[] = [
  {
    code: 'A.2.2.1.4',
    category: 'Pekerjaan Persiapan',
    description: 'Pembersihan Lapangan dan Perataan',
    unit: '1 m2',
    total: 'Rp 17.500',
    components: [
      { group: 'Tenaga / Upah', name: 'Pekerja', coefficient: '0,1200', unit: 'OH', price: 'Rp 95.000', amount: 'Rp 11.400' },
      { group: 'Tenaga / Upah', name: 'Mandor', coefficient: '0,0100', unit: 'OH', price: 'Rp 140.000', amount: 'Rp 1.400' },
      { group: 'Bahan', name: 'Patok kayu bantu', coefficient: '0,0300', unit: 'btg', price: 'Rp 12.000', amount: 'Rp 360' },
      { group: 'Alat', name: 'Peralatan bantu', coefficient: '1,0000', unit: 'ls', price: 'Rp 4.340', amount: 'Rp 4.340' },
    ],
    recap: { labor: 'Rp 12.800', material: 'Rp 360', equipment: 'Rp 4.340', total: 'Rp 17.500' },
  },
  {
    code: 'A.2.3.1.1',
    category: 'Pekerjaan Tanah',
    description: 'Galian Tanah Biasa sedalam 1 meter',
    unit: '1 m3',
    total: 'Rp 85.250',
    components: [
      { group: 'Tenaga / Upah', name: 'Pekerja', coefficient: '0,4500', unit: 'OH', price: 'Rp 95.000', amount: 'Rp 42.750' },
      { group: 'Tenaga / Upah', name: 'Tukang', coefficient: '0,1200', unit: 'OH', price: 'Rp 120.000', amount: 'Rp 14.400' },
      { group: 'Tenaga / Upah', name: 'Kepala Tukang', coefficient: '0,0120', unit: 'OH', price: 'Rp 135.000', amount: 'Rp 1.620' },
      { group: 'Tenaga / Upah', name: 'Mandor', coefficient: '0,0200', unit: 'OH', price: 'Rp 140.000', amount: 'Rp 2.800' },
      { group: 'Alat', name: 'Peralatan galian manual', coefficient: '1,0000', unit: 'ls', price: 'Rp 23.680', amount: 'Rp 23.680' },
    ],
    recap: { labor: 'Rp 61.570', material: 'Rp 0', equipment: 'Rp 23.680', total: 'Rp 85.250' },
  },
  {
    code: 'A.4.1.1.5',
    category: 'Pekerjaan Struktur Beton',
    description: "Membuat Beton Mutu f'c = 21,7 MPa (K-250)",
    unit: '1 m3',
    total: 'Rp 1.150.000',
    components: [
      { group: 'Tenaga / Upah', name: 'Pekerja', coefficient: '1,6500', unit: 'OH', price: 'Rp 95.000', amount: 'Rp 156.750' },
      { group: 'Tenaga / Upah', name: 'Tukang Batu', coefficient: '0,5500', unit: 'OH', price: 'Rp 125.000', amount: 'Rp 68.750' },
      { group: 'Tenaga / Upah', name: 'Kepala Tukang', coefficient: '0,0550', unit: 'OH', price: 'Rp 135.000', amount: 'Rp 7.425' },
      { group: 'Tenaga / Upah', name: 'Mandor', coefficient: '0,0830', unit: 'OH', price: 'Rp 140.000', amount: 'Rp 11.620' },
      { group: 'Bahan', name: 'Semen Portland', coefficient: '371,0000', unit: 'kg', price: 'Rp 1.450', amount: 'Rp 537.950' },
      { group: 'Bahan', name: 'Pasir beton', coefficient: '0,5300', unit: 'm3', price: 'Rp 245.000', amount: 'Rp 129.850' },
      { group: 'Bahan', name: 'Kerikil beton', coefficient: '0,8200', unit: 'm3', price: 'Rp 260.000', amount: 'Rp 213.200' },
      { group: 'Alat', name: 'Concrete mixer', coefficient: '0,0500', unit: 'jam', price: 'Rp 490.000', amount: 'Rp 24.500' },
    ],
    recap: { labor: 'Rp 244.545', material: 'Rp 881.155', equipment: 'Rp 24.500', total: 'Rp 1.150.000' },
  },
  {
    code: 'A.4.1.1.17',
    category: 'Pekerjaan Struktur Beton',
    description: 'Pembesian dengan besi polos atau besi ulir',
    unit: '10 kg',
    total: 'Rp 165.400',
    components: [
      { group: 'Tenaga / Upah', name: 'Pekerja', coefficient: '0,0700', unit: 'OH', price: 'Rp 95.000', amount: 'Rp 6.650' },
      { group: 'Tenaga / Upah', name: 'Tukang Besi', coefficient: '0,0700', unit: 'OH', price: 'Rp 130.000', amount: 'Rp 9.100' },
      { group: 'Tenaga / Upah', name: 'Kepala Tukang', coefficient: '0,0070', unit: 'OH', price: 'Rp 135.000', amount: 'Rp 945' },
      { group: 'Tenaga / Upah', name: 'Mandor', coefficient: '0,0035', unit: 'OH', price: 'Rp 140.000', amount: 'Rp 490' },
      { group: 'Bahan', name: 'Besi beton', coefficient: '10,5000', unit: 'kg', price: 'Rp 13.900', amount: 'Rp 145.950' },
      { group: 'Bahan', name: 'Kawat bendrat', coefficient: '0,1500', unit: 'kg', price: 'Rp 15.100', amount: 'Rp 2.265' },
    ],
    recap: { labor: 'Rp 17.185', material: 'Rp 148.215', equipment: 'Rp 0', total: 'Rp 165.400' },
  },
  {
    code: 'A.5.2.2.3',
    category: 'Pekerjaan Finishing',
    description: 'Plesteran dinding campuran 1 PC : 4 PP',
    unit: '1 m2',
    total: 'Rp 72.800',
    components: [
      { group: 'Tenaga / Upah', name: 'Pekerja', coefficient: '0,1800', unit: 'OH', price: 'Rp 95.000', amount: 'Rp 17.100' },
      { group: 'Tenaga / Upah', name: 'Tukang Batu', coefficient: '0,0900', unit: 'OH', price: 'Rp 125.000', amount: 'Rp 11.250' },
      { group: 'Tenaga / Upah', name: 'Mandor', coefficient: '0,0090', unit: 'OH', price: 'Rp 140.000', amount: 'Rp 1.260' },
      { group: 'Bahan', name: 'Semen Portland', coefficient: '7,5000', unit: 'kg', price: 'Rp 1.450', amount: 'Rp 10.875' },
      { group: 'Bahan', name: 'Pasir pasang', coefficient: '0,0450', unit: 'm3', price: 'Rp 245.000', amount: 'Rp 11.025' },
      { group: 'Alat', name: 'Peralatan plester', coefficient: '1,0000', unit: 'ls', price: 'Rp 21.290', amount: 'Rp 21.290' },
    ],
    recap: { labor: 'Rp 29.610', material: 'Rp 21.900', equipment: 'Rp 21.290', total: 'Rp 72.800' },
  },
];

const categories = ['Semua Kategori', 'Pekerjaan Persiapan', 'Pekerjaan Tanah', 'Pekerjaan Struktur Beton', 'Pekerjaan Finishing'] as const;

const executionFactorByCode: Record<string, {
  character: string;
  complexity: string;
  access: string;
  siteCondition: string;
  safetyExposure: string;
  operationalConstraint: string;
  impact: string;
}> = {
  'A.2.2.1.4': {
    character: 'Manual',
    complexity: 'Sedang',
    access: 'Terbatas',
    siteCondition: 'Perkotaan',
    safetyExposure: 'Sedang',
    operationalConstraint: 'Area aktif',
    impact: 'Produktivitas perlu koordinasi area kerja, tetapi risiko operasional masih terkendali.',
  },
  'A.2.3.1.1': {
    character: 'Manual',
    complexity: 'Sedang',
    access: 'Sulit',
    siteCondition: 'Rawa / Berbukit',
    safetyExposure: 'Tinggi',
    operationalConstraint: 'Akses terbatas',
    impact: 'Produktivitas perlu perhatian, durasi berpotensi bertambah, risiko operasional meningkat.',
  },
  'A.4.1.1.5': {
    character: 'Semi Mekanis',
    complexity: 'Tinggi',
    access: 'Sedang',
    siteCondition: 'Area aktif',
    safetyExposure: 'Tinggi',
    operationalConstraint: 'Jam kerja terbatas',
    impact: 'Pengaturan batching, alat, dan keselamatan perlu dipantau agar mutu dan ritme pekerjaan stabil.',
  },
  'A.4.1.1.17': {
    character: 'Manual / Semi Mekanis',
    complexity: 'Sedang',
    access: 'Sedang',
    siteCondition: 'Perkotaan',
    safetyExposure: 'Sedang',
    operationalConstraint: 'Area kerja padat',
    impact: 'Koordinasi fabrikasi dan pemasangan perlu dijaga agar pekerjaan tidak menahan item beton.',
  },
  'A.5.2.2.3': {
    character: 'Manual',
    complexity: 'Sedang',
    access: 'Mudah',
    siteCondition: 'Perkotaan',
    safetyExposure: 'Sedang',
    operationalConstraint: 'Area aktif',
    impact: 'Kualitas permukaan dan urutan pekerjaan perlu diperhatikan untuk mengurangi pekerjaan ulang.',
  },
};

export function ProjectAhspSnapshotPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const projectMeta = projectId ? projectMetaById[projectId] || defaultProjectMeta : defaultProjectMeta;
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<(typeof categories)[number]>('Semua Kategori');
  const [selectedCode, setSelectedCode] = useState(ahspItems[0]?.code || '');
  const [exportMessage, setExportMessage] = useState('');

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
  }, [category, query]);

  const selectedItem = ahspItems.find((item) => item.code === selectedCode) || filteredItems[0] || ahspItems[0];
  const selectedEf = executionFactorByCode[selectedItem.code];

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

      <section className="simprok-ahsp-snapshot__header">
        <div>
          <p className="simprok-ahsp-snapshot__eyebrow">Snapshot Aktif</p>
          <h1>AHSP Snapshot</h1>
          <p>Analisa Harga Satuan Pekerjaan yang menjadi acuan RAB ini.</p>
        </div>
        <span className="simprok-ahsp-snapshot__lock">
          <Lock size={14} aria-hidden="true" />
          Snapshot Terkunci
        </span>
      </section>

      <section className="simprok-ahsp-snapshot__meta" aria-label="Identitas AHSP Snapshot">
        <div><span>Nama Paket</span><strong>{projectMeta.name}</strong></div>
        <div><span>Kode RAB</span><strong>{projectMeta.rabCode}</strong></div>
        <div><span>Owner/Instansi</span><strong>{projectMeta.owner}</strong></div>
        <div><span>Status RAB</span><strong>{projectMeta.rabStatus}</strong></div>
        <div><span>Snapshot</span><strong>Aktif</strong></div>
        <div><span>Tanggal snapshot</span><strong>12 Juli 2026</strong></div>
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
        <div className="simprok-ahsp-snapshot__export-message">{exportMessage}</div>
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
          {filteredItems.length === 0 ? (
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
            <dl>
              <div><dt>Karakter Pekerjaan</dt><dd>{selectedEf.character}</dd></div>
              <div><dt>Kompleksitas</dt><dd>{selectedEf.complexity}</dd></div>
              <div><dt>Akses Lokasi</dt><dd>{selectedEf.access}</dd></div>
              <div><dt>Kondisi Site</dt><dd>{selectedEf.siteCondition}</dd></div>
              <div><dt>Safety Exposure</dt><dd>{selectedEf.safetyExposure}</dd></div>
              <div><dt>Operational Constraint</dt><dd>{selectedEf.operationalConstraint}</dd></div>
            </dl>
            <p>{selectedEf.impact}</p>
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
                    {selectedItem.components.filter((component) => component.group === group).map((component) => (
                      <tr key={`${group}-${component.name}`}>
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
      </div>
    </main>
  );
}

export default ProjectAhspSnapshotPage;
