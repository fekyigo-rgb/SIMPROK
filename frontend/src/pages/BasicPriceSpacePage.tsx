import { useNavigate } from 'react-router-dom';
import { FileInput } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { computeBasicPriceSpaceViewModel } from '../utils/basicPriceSpaceViewModel';
import { BasicPriceExplorerPage } from './BasicPriceExplorerPage';

/**
 * RM02D2A2-REMEDIATION-02 — the routed content for `/basic-price`. This is
 * the capability-aware Basic Price space, not an Explorer-only route: an
 * actor without BASIC_PRICE_VIEW but with BASIC_PRICE_IMPORT/_REVIEW_VIEW/
 * _PUBLISH still finds their own door here, on a human, permission-aware
 * landing — never a forced detour through an Explorer they cannot use, never
 * an empty/error-looking Explorer, and never a GET /basic-prices call they
 * have no reason to make. BasicPriceSpaceRoute (ProtectedRoute.tsx) already
 * guarantees at least one Basic Price capability is present before this
 * renders at all.
 */
export function BasicPriceSpacePage() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const basicPriceSpace = computeBasicPriceSpaceViewModel({
    hasView: hasPermission('BASIC_PRICE_VIEW'),
    hasImport: hasPermission('BASIC_PRICE_IMPORT'),
    hasReviewView: hasPermission('BASIC_PRICE_REVIEW_VIEW'),
    hasPublish: hasPermission('BASIC_PRICE_PUBLISH'),
  });

  if (basicPriceSpace.showExplorer) {
    return <BasicPriceExplorerPage />;
  }

  return (
    <div className="simprok-rab-workspace">
      <header className="simprok-rab-workspace__header">
        <div>
          <div className="simprok-rab-workspace__eyebrow">SIMPROK / Basic Price</div>
          <h1>Ruang Basic Price</h1>
          <p>Pilih tugas yang tersedia untuk Anda di ruang Basic Price.</p>
        </div>
      </header>

      <div className="simprok-rab-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {basicPriceSpace.showImportDoor ? (
          <button onClick={() => navigate('/basic-price/import')} title="Impor atau kontribusikan harga dasar">
            <FileInput size={16} /> Impor / Kontribusikan Harga
          </button>
        ) : null}
        {basicPriceSpace.showReviewDoor ? (
          <button onClick={() => navigate('/basic-price/reviews')} title="Buka antrean review Basic Price">
            Antrean Review
          </button>
        ) : null}
        {basicPriceSpace.showPublicationDoor ? (
          <button onClick={() => navigate('/basic-price/publications')} title="Buka antrean penerbitan Basic Price">
            Antrean Publikasi
          </button>
        ) : null}
      </div>
    </div>
  );
}
