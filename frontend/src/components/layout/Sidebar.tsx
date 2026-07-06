import { Link, useLocation } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  BookOpen,
  Briefcase,
  ClipboardList,
  HardHat,
  HelpCircle,
  Home,
  PackageSearch,
  Pickaxe,
  RefreshCcw,
  Settings,
  ShieldAlert,
  Users,
} from 'lucide-react';

const navItems = [
  { name: 'Beranda', path: '/', icon: Home, routeLabel: 'Beranda SIMPROK' },
  { name: 'Buat RAB', path: '/project/new', icon: ClipboardList, routeLabel: 'Ruang buat RAB' },
  { name: 'Proyek Saya', path: '/?ruang=proyek-saya', icon: Briefcase, routeLabel: 'Proyek Saya' },
  { name: 'Monitoring', path: '/field', icon: Activity, routeLabel: 'Ruang monitoring dan laporan progress' },
  { name: 'Recovery', path: '/?ruang=recovery', icon: RefreshCcw, routeLabel: 'Placeholder Recovery' },
  { name: 'Insight / War Room', path: '/?ruang=insight-war-room', icon: BarChart3, routeLabel: 'Placeholder Insight / War Room' },
  { name: 'AHSP', path: '/?ruang=ahsp', icon: BookOpen, routeLabel: 'Placeholder AHSP' },
  { name: 'Basic Price', path: '/?ruang=basic-price', icon: PackageSearch, routeLabel: 'Placeholder Basic Price' },
  { name: 'Peralatan', path: '/?ruang=peralatan', icon: Pickaxe, routeLabel: 'Placeholder Peralatan' },
  { name: 'Personel', path: '/?ruang=personel', icon: Users, routeLabel: 'Placeholder Personel' },
  { name: 'Metode Pelaksanaan', path: '/?ruang=metode-pelaksanaan', icon: HardHat, routeLabel: 'Placeholder Metode Pelaksanaan' },
  { name: 'Risiko Bahaya', path: '/?ruang=risiko-bahaya', icon: ShieldAlert, routeLabel: 'Placeholder Risiko Bahaya' },
  { name: 'Pengaturan', path: '/?ruang=pengaturan', icon: Settings, routeLabel: 'Placeholder Pengaturan' },
  { name: 'Bantuan', path: '/?ruang=bantuan', icon: HelpCircle, routeLabel: 'Placeholder Bantuan' },
];

export function Sidebar() {
  const location = useLocation();

  return (
    <aside className="simprok-sidebar" aria-label="Navigasi utama SIMPROK">
      <div className="simprok-sidebar__brand">
        <div className="simprok-sidebar__symbol-frame">
          <img
            src="/brand/simprok-symbol.png"
            alt="Logo SIMPROK"
            className="simprok-sidebar__symbol"
          />
        </div>
        <h1>
          SIMPROK
        </h1>
        <span>
          Sistem Intelijen Manajemen Proyek
        </span>
      </div>

      <nav className="simprok-sidebar__nav">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.path === '/'
            ? location.pathname === '/' && !location.search
            : location.pathname + location.search === item.path || location.pathname === item.path;
          return (
            <Link 
              key={item.path} 
              to={item.path}
              className={`simprok-sidebar__link${isActive ? ' simprok-sidebar__link--active' : ''}`}
              title={item.routeLabel}
              aria-label={item.routeLabel}
              data-route={item.path}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </nav>

      <div className="simprok-sidebar__footer">
        Product by Dirk &amp; Jo Group
      </div>
    </aside>
  );
}
