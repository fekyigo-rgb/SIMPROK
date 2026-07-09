import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { FileSpreadsheet, AlertTriangle, ArrowLeft, CheckCircle } from 'lucide-react';
import { firstRealInputPreview, fixtureMetadata } from '../fixtures/firstRealInputPreview';
import { normalisasiSatuan } from '../simprokKamus';
import { resolveUnitPrice, type AhspItemPreview, type BoqItemPreview } from '../utils/goldenThread';

const formatRupiah = (value: number) => `Rp ${Math.round(value).toLocaleString('id-ID')}`;

const normalizeSearch = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const scoreAhspCandidate = (boqName: string, ahspName: string) => {
  const boqTokens = new Set(normalizeSearch(boqName).split(' ').filter((token) => token.length > 3));
  const ahspTokens = normalizeSearch(ahspName).split(' ');
  return ahspTokens.reduce((score, token) => score + (boqTokens.has(token) ? 1 : 0), 0);
};

export function FirstRealInputPreviewPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const activeTab = searchParams.get('tab') || 'boq';
  const [selectedBoqKey, setSelectedBoqKey] = useState(() => {
    const firstBoq = firstRealInputPreview.boqItems[0];
    return `${firstBoq.wbsCode}-${firstBoq.name}`;
  });
  const [selectedAhspCode, setSelectedAhspCode] = useState('');

  const selectedBoq = useMemo(
    () =>
      firstRealInputPreview.boqItems.find(
        (boq) => `${boq.wbsCode}-${boq.name}` === selectedBoqKey,
      ) ?? firstRealInputPreview.boqItems[0],
    [selectedBoqKey],
  );

  const selectedAhsp = useMemo(
    () => firstRealInputPreview.ahspAnalyses.find((ahsp) => ahsp.code === selectedAhspCode) ?? null,
    [selectedAhspCode],
  );

  const ahspOptions = useMemo(
    () =>
      [...firstRealInputPreview.ahspAnalyses].sort(
        (left, right) =>
          scoreAhspCandidate(selectedBoq.name, right.name) -
          scoreAhspCandidate(selectedBoq.name, left.name),
      ),
    [selectedBoq],
  );

  const goldenThreadResult = useMemo(
    () =>
      resolveUnitPrice({
        boqItem: selectedBoq as BoqItemPreview,
        ahspItem: selectedAhsp as AhspItemPreview | null,
        basicPrices: firstRealInputPreview.basicPrices,
      }),
    [selectedAhsp, selectedBoq],
  );

  const mappingLabel =
    goldenThreadResult.mappingStatus === 'MANUAL_LINKED'
      ? 'MANUAL_LINKED: Dipilih manual oleh manusia'
      : 'NOT_MATCHED: Menunggu pilihan AHSP';

  useEffect(() => {
    // Just scrolling to top on mount
    window.scrollTo(0, 0);
  }, []);

  return (
    <main className="simprok-ahsp-snapshot">
      <nav className="simprok-detail__breadcrumb" aria-label="Breadcrumb">
        <button type="button" onClick={() => navigate('/')}>SIMPROK</button>
        <span>/</span>
        <button type="button" onClick={() => navigate(-1)}>Kembali</button>
        <span>/</span>
        <strong>Preview Input Pertama</strong>
      </nav>

      <section className="simprok-ahsp-snapshot-hero" style={{ background: 'linear-gradient(to right, #fff5e6, #fff)', border: '1px solid #ffd8a8' }}>
        <div>
          <p className="simprok-ahsp-snapshot__eyebrow" style={{ color: '#d97706' }}>Data Contoh (Preview)</p>
          <h1>Preview Data Input Pertama</h1>
          <p>Data contoh dari file Excel Owner. Belum tersimpan ke database dan belum menjadi baseline resmi.</p>
        </div>
        <span className="simprok-ahsp-snapshot__lock" style={{ background: '#fff3cd', color: '#856404' }}>
          <AlertTriangle size={14} aria-hidden="true" />
          Not Saved to Database
        </span>
      </section>

      <section style={{ margin: '1.5rem', padding: '1rem', border: '1px solid var(--simprok-border)', borderRadius: '8px', background: '#fff' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <div>
            <p className="simprok-ahsp-snapshot__eyebrow" style={{ color: '#C77A17', margin: 0 }}>
              Data Contoh (Import-ready) - Belum baseline resmi - Belum tersimpan ke database
            </p>
            <h2 style={{ margin: '0.25rem 0' }}>Golden Thread Import-ready Result</h2>
            <p style={{ margin: 0, color: 'var(--simprok-text-muted)' }}>
              Manusia memilih mapping BOQ ke AHSP. SIMPROK menghitung hanya jika resource dan satuan kanonik sah resolved.
            </p>
          </div>
          <strong style={{ color: goldenThreadResult.resultStatus === 'READY' ? '#2E9E6B' : '#98A2B3' }}>
            {goldenThreadResult.resultStatus}
          </strong>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
          <label style={{ display: 'grid', gap: '0.4rem', fontSize: '13px', color: 'var(--simprok-text-muted)' }}>
            Pilih BOQ item nyata
            <select
              value={selectedBoqKey}
              onChange={(event) => {
                setSelectedBoqKey(event.target.value);
                setSelectedAhspCode('');
              }}
              style={{ padding: '0.65rem', border: '1px solid var(--simprok-border)', borderRadius: '6px', color: 'var(--simprok-text)' }}
            >
              {firstRealInputPreview.boqItems.map((boq) => (
                <option key={`${boq.wbsCode}-${boq.name}`} value={`${boq.wbsCode}-${boq.name}`}>
                  {boq.wbsCode} - {boq.name} ({boq.quantity} {boq.unit})
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'grid', gap: '0.4rem', fontSize: '13px', color: 'var(--simprok-text-muted)' }}>
            Pilih AHSP nyata
            <select
              value={selectedAhspCode}
              onChange={(event) => setSelectedAhspCode(event.target.value)}
              style={{ padding: '0.65rem', border: '1px solid var(--simprok-border)', borderRadius: '6px', color: 'var(--simprok-text)' }}
            >
              <option value="">Menunggu pilihan AHSP</option>
              {ahspOptions.map((ahsp) => (
                <option key={ahsp.code} value={ahsp.code}>
                  {ahsp.code} - {ahsp.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
          <div style={{ border: '1px solid var(--simprok-border)', borderRadius: '8px', padding: '0.75rem' }}>
            <span style={{ color: 'var(--simprok-text-muted)', fontSize: '12px' }}>Status mapping</span>
            <strong style={{ display: 'block', color: goldenThreadResult.mappingStatus === 'MANUAL_LINKED' ? '#C77A17' : '#98A2B3' }}>{mappingLabel}</strong>
            <small>Match source: {goldenThreadResult.matchSource}</small>
          </div>
          <div style={{ border: '1px solid var(--simprok-border)', borderRadius: '8px', padding: '0.75rem' }}>
            <span style={{ color: 'var(--simprok-text-muted)', fontSize: '12px' }}>AHSP terpilih</span>
            <strong style={{ display: 'block' }}>{selectedAhsp ? `${selectedAhsp.code} - ${selectedAhsp.name}` : 'Belum dipilih'}</strong>
          </div>
          <div style={{ border: '1px solid var(--simprok-border)', borderRadius: '8px', padding: '0.75rem' }}>
            <span style={{ color: 'var(--simprok-text-muted)', fontSize: '12px' }}>Domain BOQ</span>
            <strong style={{ display: 'block' }}>{goldenThreadResult.boqDomain ?? 'Menunggu AHSP'}</strong>
          </div>
          <div style={{ border: '1px solid var(--simprok-border)', borderRadius: '8px', padding: '0.75rem' }}>
            <span style={{ color: 'var(--simprok-text-muted)', fontSize: '12px' }}>Domain AHSP</span>
            <strong style={{ display: 'block' }}>{goldenThreadResult.ahspDomain ?? 'Belum dipilih'}</strong>
          </div>
          <div style={{ border: '1px solid var(--simprok-border)', borderRadius: '8px', padding: '0.75rem' }}>
            <span style={{ color: 'var(--simprok-text-muted)', fontSize: '12px' }}>Status Domain</span>
            <strong style={{ display: 'block', color: goldenThreadResult.domainCompatible ? '#2E9E6B' : '#C77A17' }}>
              {goldenThreadResult.domainCompatible ? 'DOMAIN_MATCH' : 'DOMAIN_MISMATCH'}
            </strong>
            <small>{goldenThreadResult.domainReason}</small>
          </div>
          <div style={{ border: '1px solid var(--simprok-border)', borderRadius: '8px', padding: '0.75rem' }}>
            <span style={{ color: 'var(--simprok-text-muted)', fontSize: '12px' }}>Harga Satuan</span>
            <strong style={{ display: 'block', color: goldenThreadResult.hargaSatuan !== null ? '#16294B' : '#98A2B3' }}>
              {goldenThreadResult.hargaSatuan !== null ? formatRupiah(goldenThreadResult.hargaSatuan) : 'Belum dapat dihitung'}
            </strong>
          </div>
          <div style={{ border: '1px solid var(--simprok-border)', borderRadius: '8px', padding: '0.75rem' }}>
            <span style={{ color: 'var(--simprok-text-muted)', fontSize: '12px' }}>Jumlah RAB preview</span>
            <strong style={{ display: 'block', color: goldenThreadResult.jumlah !== null ? '#16294B' : '#98A2B3' }}>
              {goldenThreadResult.jumlah !== null ? formatRupiah(goldenThreadResult.jumlah) : 'Belum dapat dihitung'}
            </strong>
          </div>
        </div>

        {selectedAhsp && (
          <div className="simprok-ahsp-snapshot-detail__table" style={{ marginBottom: '1rem' }}>
            <table>
              <thead>
                <tr>
                  <th>Komponen AHSP</th>
                  <th>Kategori Kamus</th>
                  <th>Satuan Asli</th>
                  <th>Satuan Kanonik</th>
                  <th>Basic Price</th>
                  <th>Status Resolve</th>
                </tr>
              </thead>
              <tbody>
                {[...goldenThreadResult.resolvedComponents, ...goldenThreadResult.unresolvedComponents].map((component, index) => (
                  <tr key={`${component.resourceName}-${component.baseUnit}-${index}`}>
                    <td>{component.resourceName}</td>
                    <td>{component.kategori ?? 'PERLU KONFIRMASI MANUSIA'}</td>
                    <td>{component.baseUnit}</td>
                    <td>{component.canonicalUnit ?? 'PERLU KONFIRMASI'}</td>
                    <td>
                      {'basicPriceName' in component && component.basicPriceName
                        ? `${component.basicPriceName} (${component.basicPriceUnit} -> ${component.basicPriceCanonicalUnit ?? 'PERLU KONFIRMASI'})`
                        : 'Belum ditemukan'}
                    </td>
                    <td>
                      <span style={{ color: component.resolveStatus === 'RESOLVED' ? '#2E9E6B' : '#98A2B3' }}>
                        {component.resolveStatus}
                      </span>
                      <br />
                      <small>{component.resolveReason}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <details open style={{ border: '1px solid var(--simprok-border)', borderRadius: '8px', padding: '0.75rem', background: '#fafafa' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Jejak asal-usul angka / alasan incomplete</summary>
          <ul style={{ margin: '0.75rem 0 0', paddingLeft: '1.25rem' }}>
            {goldenThreadResult.jejak.map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
            {goldenThreadResult.unresolvedReasons.map((reason, index) => (
              <li key={`${reason}-${index}`} style={{ color: '#98A2B3' }}>{reason}</li>
            ))}
          </ul>
        </details>
      </section>

      {fixtureMetadata.warnings.length > 0 && (
        <div style={{ margin: '1.5rem', padding: '1rem', background: '#ffebee', color: '#c62828', borderRadius: '8px', border: '1px solid #ffcdd2' }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <AlertTriangle size={18} /> Peringatan Pengecekan Kualitas Data
          </h3>
          <ul style={{ margin: 0, paddingLeft: '1.5rem' }}>
            {fixtureMetadata.warnings.map((w, idx) => (
              <li key={idx}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ display: 'flex', gap: '1rem', padding: '0 1.5rem', borderBottom: '1px solid var(--simprok-border)' }}>
        <button 
          onClick={() => navigate('?tab=boq')}
          style={{ padding: '1rem', background: 'transparent', border: 'none', borderBottom: activeTab === 'boq' ? '2px solid var(--simprok-primary)' : '2px solid transparent', fontWeight: activeTab === 'boq' ? 600 : 400, color: activeTab === 'boq' ? 'var(--simprok-primary)' : 'var(--simprok-text-muted)', cursor: 'pointer' }}
        >
          Preview BOQ
        </button>
        <button 
          onClick={() => navigate('?tab=ahsp')}
          style={{ padding: '1rem', background: 'transparent', border: 'none', borderBottom: activeTab === 'ahsp' ? '2px solid var(--simprok-primary)' : '2px solid transparent', fontWeight: activeTab === 'ahsp' ? 600 : 400, color: activeTab === 'ahsp' ? 'var(--simprok-primary)' : 'var(--simprok-text-muted)', cursor: 'pointer' }}
        >
          Preview AHSP
        </button>
        <button 
          onClick={() => navigate('?tab=basic-price')}
          style={{ padding: '1rem', background: 'transparent', border: 'none', borderBottom: activeTab === 'basic-price' ? '2px solid var(--simprok-primary)' : '2px solid transparent', fontWeight: activeTab === 'basic-price' ? 600 : 400, color: activeTab === 'basic-price' ? 'var(--simprok-primary)' : 'var(--simprok-text-muted)', cursor: 'pointer' }}
        >
          Preview Basic Price
        </button>
      </div>

      <div style={{ padding: '1.5rem' }}>
        {activeTab === 'boq' && (
          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2>Daftar BOQ ({firstRealInputPreview.boqItems.length} item)</h2>
              <span style={{ fontSize: '13px', color: '#666', display: 'flex', gap: '0.5rem', alignItems: 'center' }}><FileSpreadsheet size={15}/> {fixtureMetadata.sourceFile}</span>
            </div>
            <div className="simprok-ahsp-snapshot-detail__table">
              <table>
                <thead>
                  <tr>
                    <th>WBS / No</th>
                    <th>Uraian Pekerjaan</th>
                    <th>Satuan</th>
                    <th>Volume</th>
                    <th>Status Matching AHSP</th>
                  </tr>
                </thead>
                <tbody>
                  {firstRealInputPreview.boqItems.map((boq, idx) => {
                    const match = firstRealInputPreview.matches.find(m => m.type === 'BOQ_TO_AHSP' && m.from === boq.name);
                    return (
                      <tr key={idx}>
                        <td>{boq.wbsCode}</td>
                        <td>{boq.name}</td>
                        <td>{boq.unit}</td>
                        <td>{boq.quantity}</td>
                        <td>
                          {match ? (
                            <span style={{ color: '#059669', display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                              <CheckCircle size={14}/> Tersambung (Confidence: {match.confidence})
                            </span>
                          ) : (
                            <span style={{ color: '#d97706' }}>Belum match</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === 'ahsp' && (
          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2>Daftar Analisa ({firstRealInputPreview.ahspAnalyses.length} item)</h2>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {firstRealInputPreview.ahspAnalyses.map((ahsp, idx) => (
                <div key={idx} style={{ border: '1px solid var(--simprok-border)', borderRadius: '8px', padding: '1rem' }}>
                  <h3 style={{ margin: '0 0 0.5rem 0' }}>{ahsp.code} - {ahsp.name}</h3>
                  <p style={{ margin: '0 0 1rem 0', fontSize: '14px', color: 'var(--simprok-text-muted)' }}>Satuan Pekerjaan: {ahsp.unit}</p>
                  
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead style={{ background: 'var(--simprok-surface)', textAlign: 'left' }}>
                      <tr>
                        <th style={{ padding: '0.5rem', borderBottom: '1px solid var(--simprok-border)' }}>Komponen</th>
                        <th style={{ padding: '0.5rem', borderBottom: '1px solid var(--simprok-border)' }}>Tipe</th>
                        <th style={{ padding: '0.5rem', borderBottom: '1px solid var(--simprok-border)' }}>Koef</th>
                        <th style={{ padding: '0.5rem', borderBottom: '1px solid var(--simprok-border)' }}>Sat</th>
                        <th style={{ padding: '0.5rem', borderBottom: '1px solid var(--simprok-border)' }}>Status Basic Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ahsp.components.map((comp, cidx) => {
                        const match = firstRealInputPreview.matches.find(m => m.type === 'AHSP_TO_BASIC_PRICE' && m.from === comp.resourceName);
                        const kategori = goldenThreadResult.resolvedComponents.find((item) => item.resourceName === comp.resourceName)?.kategori
                          ?? goldenThreadResult.unresolvedComponents.find((item) => item.resourceName === comp.resourceName)?.kategori
                          ?? comp.resourceType;
                        return (
                          <tr key={cidx}>
                            <td style={{ padding: '0.5rem', borderBottom: '1px solid var(--simprok-border)' }}>{comp.resourceName}</td>
                            <td style={{ padding: '0.5rem', borderBottom: '1px solid var(--simprok-border)' }}>{kategori}</td>
                            <td style={{ padding: '0.5rem', borderBottom: '1px solid var(--simprok-border)' }}>{comp.coefficient}</td>
                            <td style={{ padding: '0.5rem', borderBottom: '1px solid var(--simprok-border)' }}>{comp.baseUnit} ({normalisasiSatuan(comp.baseUnit, { kategori: kategori === 'LABOR' || kategori === 'MATERIAL' || kategori === 'EQUIPMENT' ? kategori : null }) ?? 'PERLU KONFIRMASI'})</td>
                            <td style={{ padding: '0.5rem', borderBottom: '1px solid var(--simprok-border)' }}>
                              {match ? <span style={{color: '#059669'}}>Match: {match.to}</span> : <span style={{color: '#d97706'}}>No Match</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === 'basic-price' && (
          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2>Harga Dasar ({firstRealInputPreview.basicPrices.length} item)</h2>
            </div>
            <div className="simprok-ahsp-snapshot-detail__table">
              <table>
                <thead>
                  <tr>
                    <th>Kode</th>
                    <th>Nama Sumber Daya</th>
                    <th>Tipe</th>
                    <th>Satuan</th>
                    <th>Harga (Rp)</th>
                  </tr>
                </thead>
                <tbody>
                  {firstRealInputPreview.basicPrices.map((bp, idx) => (
                    <tr key={idx}>
                      <td>{bp.code}</td>
                      <td>{bp.name}</td>
                      <td>{bp.type}</td>
                      <td>{bp.unit}</td>
                      <td>{bp.price.toLocaleString('id-ID')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
      
      <div style={{ padding: '1.5rem', textAlign: 'center' }}>
        <button 
          onClick={() => navigate(-1)} 
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1.5rem', background: 'var(--simprok-surface)', border: '1px solid var(--simprok-border)', borderRadius: '6px', cursor: 'pointer' }}
        >
          <ArrowLeft size={16} />
          Kembali ke Proyek
        </button>
      </div>
    </main>
  );
}

export default FirstRealInputPreviewPage;
