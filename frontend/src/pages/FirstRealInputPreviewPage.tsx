import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { FileSpreadsheet, AlertTriangle, ArrowLeft, CheckCircle } from 'lucide-react';
import { firstRealInputPreview, fixtureMetadata } from '../fixtures/firstRealInputPreview';

export function FirstRealInputPreviewPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const activeTab = searchParams.get('tab') || 'boq';

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
                        return (
                          <tr key={cidx}>
                            <td style={{ padding: '0.5rem', borderBottom: '1px solid var(--simprok-border)' }}>{comp.resourceName}</td>
                            <td style={{ padding: '0.5rem', borderBottom: '1px solid var(--simprok-border)' }}>{comp.resourceType}</td>
                            <td style={{ padding: '0.5rem', borderBottom: '1px solid var(--simprok-border)' }}>{comp.coefficient}</td>
                            <td style={{ padding: '0.5rem', borderBottom: '1px solid var(--simprok-border)' }}>{comp.baseUnit}</td>
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
