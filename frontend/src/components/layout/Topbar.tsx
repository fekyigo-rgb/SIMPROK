import { useMemo } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Bell, CircleHelp, LogOut, MessageSquare, UserCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { formatRoleLabel } from '../../utils/roleLabels';

interface AccountWithDisplayName {
  displayName?: string;
  email?: string;
}

export function Topbar() {
  const { account, activeRoles, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const normalizedPath = location.pathname.replace(/\/$/, '') || '/';

  const topbarMeta = useMemo(() => {
    const ruang = searchParams.get('ruang');

    if (normalizedPath === '/project/new') {
      return {
        title: 'Persiapan RAB',
        subtitle: 'Lengkapi data pekerjaan sebelum masuk ke Ruang Kerja RAB',
        mobileLabel: 'Persiapan RAB',
      };
    }

    if (normalizedPath === '/' && ruang === 'ruang-kerja-rab') {
      return {
        title: 'Ruang Kerja RAB',
        subtitle: 'Susun item, volume, AHSP, harga, dan total secara jujur',
        mobileLabel: 'Ruang Kerja RAB',
      };
    }

    if (normalizedPath === '/proyek') {
      return {
        title: 'Proyek Saya',
        subtitle: 'Daftar aset kerja dan proyek yang dapat Anda akses',
        mobileLabel: 'Proyek Saya',
      };
    }

    if (/^\/project\/[^/]+\/detail$/.test(normalizedPath)) {
      return {
        title: 'Detail Proyek',
        subtitle: 'Identitas, governance, dan pintu ruang kerja proyek',
        mobileLabel: 'Detail Proyek',
      };
    }

    if (/^\/project\/[^/]+\/rab(\/.*)?$/.test(normalizedPath)) {
      return {
        title: 'Rencana Anggaran Biaya',
        subtitle: 'Dokumen RAB resmi proyek',
        mobileLabel: 'RAB Proyek',
      };
    }

    return {
      title: 'Beranda SIMPROK',
      subtitle: 'Ruang kendali proyek yang terang dan jujur',
      mobileLabel: 'Beranda',
    };
  }, [normalizedPath, searchParams]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // Derive initials from displayName or email
  const displayName = (account as AccountWithDisplayName | null)?.displayName || account?.email || 'User';
  const initials = displayName
    .split(' ')
    .map((w: string) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const roleLabel = activeRoles.length > 0 ? formatRoleLabel(activeRoles[0]) : 'No Role Assigned';

  const openPlaceholder = (ruang: string) => {
    navigate(`/?ruang=${ruang}`);
  };

  return (
    <header className="simprok-topbar">
      <div className="simprok-topbar__brand-mobile">
        <strong>SIMPROK</strong>
        <span>{topbarMeta.mobileLabel}</span>
      </div>

      <div className="simprok-topbar__title">
        <h2>{topbarMeta.title}</h2>
        <span>{topbarMeta.subtitle}</span>
      </div>

      <div className="simprok-topbar__actions">
        <button
          className="simprok-icon-button"
          onClick={() => openPlaceholder('pesan')}
          title="Pesan - Belum tersambung"
          aria-label="Pesan - Belum tersambung"
          data-route="/?ruang=pesan"
        >
          <MessageSquare size={18} />
        </button>
        <button
          className="simprok-icon-button"
          onClick={() => openPlaceholder('notifikasi')}
          title="Notifikasi - Belum tersambung"
          aria-label="Notifikasi - Belum tersambung"
          data-route="/?ruang=notifikasi"
        >
          <Bell size={18} />
        </button>
        <button
          className="simprok-icon-button"
          onClick={() => openPlaceholder('bantuan')}
          title="Bantuan"
          aria-label="Bantuan"
          data-route="/?ruang=bantuan"
        >
          <CircleHelp size={18} />
        </button>
        <button
          className="simprok-profile-button"
          onClick={() => openPlaceholder('profil')}
          title="Profil akun - Belum tersambung"
          aria-label="Profil akun - Belum tersambung"
          data-route="/?ruang=profil"
        >
          <span className="simprok-profile-button__text">
            <span>
            {displayName}
            </span>
            <small>
            {roleLabel}
            </small>
          </span>
          <span className="simprok-profile-button__avatar" aria-hidden="true">
            {initials || <UserCircle size={18} />}
          </span>
        </button>
        <button
          onClick={handleLogout}
          title="Logout"
          aria-label="Logout"
          className="simprok-icon-button simprok-icon-button--logout"
          data-route="/login"
        >
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
}
