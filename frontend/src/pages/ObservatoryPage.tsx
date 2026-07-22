import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../utils/apiClient';
import { RabWorkspacePage } from './RabWorkspacePage';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Briefcase,
  ClipboardList,
  CloudSun,
  PackageSearch,
  Store,
} from 'lucide-react';

interface ObservatoryProject {
  id?: string;
  name?: string;
  code?: string;
  status?: 'HEALTHY' | 'WARNING' | 'CRITICAL';
  progressPercent?: number;
}

interface ProjectGroup {
  label: string;
  projects: ObservatoryProject[];
}

const isTestProject = (project: ObservatoryProject) => {
  const name = (project.name || '').toUpperCase();
  const code = (project.code || '').toUpperCase();

  if (name.includes('SPPG') || code.includes('SPPG')) return false;
  if (name.includes('PERCOBAAN') || code.includes('PERCOBAAN')) return false;
  if (name.includes('ACCEPTANCE PROJECT') || code.includes('ACC-X')) return false;

  if (name.startsWith('TEST ')) return true;
  if (code.startsWith('A3A-')) return true;
  if (code.startsWith('A3B-')) return true;
  if (code.startsWith('T-ROUND')) return true;
  if (name.includes('VALIDATION') || code.includes('VALIDATION')) return true;
  if (name.includes('HIERARCHY') || code.includes('HIERARCHY')) return true;
  if (name.includes('FIX') || code.includes('FIX')) return true;
  if (name.includes('FORMULA') || code.includes('FORMULA')) return true;
  if (name.includes('ROUND') || code.includes('ROUND')) return true;
  if (name.includes('INVALID NEGATIVE') || code.includes('INVALID NEGATIVE')) return true;

  return false;
};

const buildProjectGroups = (projectList: ObservatoryProject[]): ProjectGroup[] => {
  const groups = projectList.reduce<Record<string, ObservatoryProject[]>>((acc, project) => {
    const status = project.status || 'Menunggu Realisasi';
    const label = status === 'HEALTHY'
      ? 'Proyek Hijau / On Plan'
      : status === 'WARNING'
        ? 'Proyek Menunggu Review'
        : status === 'CRITICAL'
          ? 'Proyek Kritis'
          : 'Proyek Menunggu Realisasi';

    acc[label] = [...(acc[label] || []), project];
    return acc;
  }, {});

  return Object.entries(groups).flatMap(([label, groupedProjects]) => {
    const chunks: ProjectGroup[] = [];
    for (let index = 0; index < groupedProjects.length; index += 3) {
      chunks.push({
        label: groupedProjects.length > 3 ? `${label} ${Math.floor(index / 3) + 1}` : label,
        projects: groupedProjects.slice(index, index + 3),
      });
    }
    return chunks;
  });
};

const getStatusLabel = (status?: ObservatoryProject['status']) => {
  if (status === 'HEALTHY') return 'On plan';
  if (status === 'WARNING') return 'Perlu review';
  if (status === 'CRITICAL') return 'Kritis';
  return 'Belum ada realisasi';
};

export function ObservatoryPage() {
  const [projects, setProjects] = useState<ObservatoryProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projectGroupIndex, setProjectGroupIndex] = useState(0);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const { token, activeWorkspaceId, hasPermission } = useAuth();
  // RM-01a authority matrix: the "Buat RAB" door is gated by the
  // PROJECT_CREATE permission code, not a DIRECTOR/OWNER role literal —
  // matching the backend's PermissionsGuard on POST /projects.
  const canCreateRab = hasPermission('PROJECT_CREATE');
  const activeProjects = projects.filter(p => !isTestProject(p));
  const projectGroups = buildProjectGroups(activeProjects);
  const safeProjectGroupIndex = projectGroups.length > 0 ? projectGroupIndex % projectGroups.length : 0;
  const activeProjectGroup = projectGroups[safeProjectGroupIndex];
  const placeholderRoom = searchParams.get('ruang');

  const goTo = (path: string) => {
    navigate(path);
  };

  useEffect(() => {
    if (!token || !activeWorkspaceId) return;

    Promise.resolve()
      .then(() => {
        setLoading(true);
        setError(null);
        return apiFetch('http://localhost:3000/projects');
      })
      .then(res => {
        if (!res.ok) {
          const status = res.status;
          let msg = 'Data gagal dimuat. Coba lagi beberapa saat.';
          if (status === 401) msg = 'Sesi Anda telah berakhir atau tidak valid. Silakan login kembali.';
          else if (status === 403) msg = 'Anda tidak memiliki akses untuk membuka data ini.';
          else if (status === 400) msg = 'Konteks workspace atau permintaan belum valid. Pilih workspace kembali.';
          else if (status === 404) msg = 'Data tidak ditemukan.';
          throw new Error(msg);
        }
        return res.json();
      })
      .then(data => {
        setProjects(Array.isArray(data) ? data as ObservatoryProject[] : []);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch projects:', err);
        setError(err.message || 'Data gagal dimuat. Coba lagi beberapa saat.');
        setLoading(false);
      });
  }, [token, activeWorkspaceId]);

  useEffect(() => {
    if (projectGroups.length <= 1) return;

    const timer = window.setInterval(() => {
      setProjectGroupIndex(current => (current + 1) % projectGroups.length);
    }, 7000);

    return () => window.clearInterval(timer);
  }, [projectGroups.length]);

  if (placeholderRoom === 'ruang-kerja-rab') {
    return <RabWorkspacePage />;
  }

  return (
    <div className="simprok-home">
      {placeholderRoom ? (
        <section className="simprok-honest-frame simprok-honest-frame--compact" aria-label="Placeholder ruang">
          <span className="simprok-honest-frame__badge">Belum tersambung</span>
          <p>Ruang {placeholderRoom.replace(/-/g, ' ')} sudah menjadi pintu hidup. Panel detailnya menunggu engine atau data tersambung.</p>
        </section>
      ) : null}

      <section className="simprok-welcome">
        <div className="simprok-welcome__copy">
          <div className="simprok-welcome__topline">
            <span className="simprok-section-kicker">Beranda</span>
            <button
              className="simprok-weather-chip"
              onClick={() => goTo('/?ruang=cuaca-lokal')}
              title="Cuaca lokal - Belum tersambung"
              aria-label="Cuaca lokal - Belum tersambung"
              data-route="/?ruang=cuaca-lokal"
            >
              <CloudSun size={16} aria-hidden="true" />
              <span>Cuaca lokal</span>
              <span className="simprok-weather-chip__badge">Belum tersambung</span>
            </button>
          </div>
          <h1>Selamat datang di SIMPROK.</h1>
          <p>Platform intelijen proyek untuk menyusun RAB, membaca realitas lapangan, dan membantu keputusan manusia.</p>
          <div className="simprok-welcome__actions">
            <button
              className="simprok-welcome__cta"
              onClick={() => goTo(canCreateRab ? '/project/new' : '/?ruang=akses-buat-rab')}
              title={canCreateRab ? 'Mulai Buat RAB' : 'Mulai Buat RAB - Menunggu akses'}
              aria-label={canCreateRab ? 'Mulai Buat RAB' : 'Mulai Buat RAB - Menunggu akses'}
              data-route={canCreateRab ? '/project/new' : '/?ruang=akses-buat-rab'}
            >
              Mulai Buat RAB
            </button>
            <button
              className="simprok-welcome__cta"
              onClick={() => goTo('/proyek')}
              title="Lihat Proyek Saya"
              aria-label="Lihat Proyek Saya"
              data-route="/proyek"
            >
              Lihat Proyek Saya
            </button>
            <button
              className="simprok-welcome__cta simprok-welcome__cta--ghost"
              onClick={() => goTo('/?ruang=pelajari-simprok')}
              title="Pelajari SIMPROK"
              aria-label="Pelajari SIMPROK"
              data-route="/?ruang=pelajari-simprok"
            >
              Pelajari SIMPROK
            </button>
          </div>
        </div>
      </section>

      <section className="simprok-section">
        <div className="simprok-section__header">
          <div>
            <span className="simprok-section-kicker">Pintu Kerja Utama</span>
            <h2>Mulai dari ruang yang paling sering dipakai.</h2>
          </div>
        </div>
        <div className="simprok-door-grid">
          <button
            className="simprok-work-door simprok-work-door--primary"
            onClick={() => goTo(canCreateRab ? '/project/new' : '/?ruang=akses-buat-rab')}
            title={canCreateRab ? 'Buat RAB' : 'Buat RAB - Menunggu akses'}
            aria-label={canCreateRab ? 'Buat RAB' : 'Buat RAB - Menunggu akses'}
            data-route={canCreateRab ? '/project/new' : '/?ruang=akses-buat-rab'}
          >
            <span className="simprok-work-door__icon"><ClipboardList size={26} /></span>
            <span>
              <strong>Buat RAB</strong>
              <small>{canCreateRab ? 'Masuk ke ruang penyusunan RAB.' : 'Menunggu akses untuk membuka ruang RAB.'}</small>
            </span>
            <ArrowRight size={20} aria-hidden="true" />
          </button>

          <button
            className="simprok-work-door"
            onClick={() => goTo('/proyek')}
            title="Proyek Saya"
            aria-label="Proyek Saya"
            data-route="/proyek"
          >
            <span className="simprok-work-door__icon"><Briefcase size={26} /></span>
            <span>
              <strong>Proyek Saya</strong>
              <small>Lihat daftar proyek dari data runtime yang tersedia.</small>
            </span>
            <ArrowRight size={20} aria-hidden="true" />
          </button>

          <button
            className="simprok-work-door"
            onClick={() => goTo('/field')}
            title="Monitoring"
            aria-label="Monitoring"
            data-route="/field"
          >
            <span className="simprok-work-door__icon"><Activity size={26} /></span>
            <span>
              <strong>Monitoring</strong>
              <small>Masuk ke ruang pantau dan laporan progress.</small>
            </span>
            <ArrowRight size={20} aria-hidden="true" />
          </button>
        </div>
      </section>

      <section className="simprok-living-room" aria-label="Proyek Berjalan SIMPROK">
        <div className="simprok-living-room__main">
          <section className="simprok-section simprok-living-card">
            <div className="simprok-section__header">
              <div>
                <span className="simprok-section-kicker">Proyek Berjalan</span>
                <h2>Proyek Aktif / RAB berjalan</h2>
              </div>
              <span className="simprok-source-label">Maksimal 3 tampil</span>
            </div>

            {loading ? (
              <div className="simprok-honest-frame">
                <span className="simprok-honest-frame__badge">Menunggu data</span>
                <p>SIMPROK sedang memuat data proyek dari API existing.</p>
              </div>
            ) : error ? (
              <div className="simprok-honest-frame">
                <span className="simprok-honest-frame__badge">Belum tersambung</span>
                <p>{error}</p>
              </div>
            ) : activeProjects.length === 0 ? (
              <div className="simprok-honest-frame">
                <span className="simprok-honest-frame__badge">Menunggu data</span>
                <p>Belum ada RAB berjalan atau proyek aktif. Mulai dari Buat RAB atau buka Proyek Saya.</p>
              </div>
            ) : activeProjectGroup ? (
              <div className="simprok-rotator">
                <div className="simprok-rotator__header">
                  <strong>{activeProjectGroup.label}</strong>
                  <span>{activeProjectGroup.projects.length} proyek tampil</span>
                </div>
                <div className="simprok-running-list">
                  {activeProjectGroup.projects.map((project, index) => (
                    <button
                      key={project.id || `${project.code || 'project'}-${index}`}
                      className="simprok-running-project"
                      onClick={() => project.id ? goTo(`/project/${project.id}`) : goTo('/?ruang=proyek-belum-lengkap')}
                      title={project.id ? `Buka proyek ${project.name || 'tanpa nama'}` : 'Proyek belum lengkap'}
                      aria-label={project.id ? `Buka proyek ${project.name || 'tanpa nama'}` : 'Proyek belum lengkap'}
                      data-route={project.id ? `/project/${project.id}` : '/?ruang=proyek-belum-lengkap'}
                    >
                      <span className={`simprok-status-dot simprok-status-dot--${(project.status || 'waiting').toLowerCase()}`} />
                      <span className="simprok-running-project__body">
                        <strong>{project.name || 'Proyek tanpa nama'}</strong>
                        <small>{project.code || 'Menunggu kode'}</small>
                        {typeof project.progressPercent === 'number' ? (
                          <span className="simprok-progress-track" aria-label="Progress proyek">
                            <span style={{ width: `${Math.max(0, Math.min(project.progressPercent, 100))}%` }} />
                          </span>
                        ) : (
                          <em>Belum ada realisasi</em>
                        )}
                      </span>
                      <span className="simprok-running-project__status">{getStatusLabel(project.status)}</span>
                    </button>
                  ))}
                </div>
                {projectGroups.length > 1 ? (
                  <div className="simprok-rotator__dots" aria-label="Indikator grup proyek">
                    {projectGroups.map((group, index) => (
                      <button
                        key={`${group.label}-${index}`}
                        className={index === safeProjectGroupIndex ? 'simprok-rotator__dot simprok-rotator__dot--active' : 'simprok-rotator__dot'}
                        onClick={() => setProjectGroupIndex(index)}
                        title={`Tampilkan grup ${group.label}`}
                        aria-label={`Tampilkan grup ${group.label}`}
                        data-route={`/?ruang=proyek-grup-${index + 1}`}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="simprok-section simprok-living-card simprok-living-card--compact">
            <div className="simprok-section__header">
              <div>
                <span className="simprok-section-kicker">Wilayah Material</span>
                <h2>Daftar Pemasok Material</h2>
              </div>
              <span className="simprok-source-label">Maksimal 5 tampil</span>
            </div>
            <button
              className="simprok-supplier-strip simprok-honest-frame"
              onClick={() => goTo('/?ruang=pemasok-material')}
              title="Daftar Pemasok Material - Belum tersambung"
              aria-label="Daftar Pemasok Material - Belum tersambung"
              data-route="/?ruang=pemasok-material"
            >
              <span className="simprok-honest-frame__badge">Belum tersambung</span>
              <Store size={24} aria-hidden="true" />
              <span>Daftar toko / supplier material daerah akan tampil setelah data supplier tersambung.</span>
            </button>
          </section>

          <section className="simprok-section simprok-living-card simprok-living-card--compact">
            <div className="simprok-section__header">
              <div>
                <span className="simprok-section-kicker">Update Terbaru</span>
                <h2>Bursa Material</h2>
              </div>
              <span className="simprok-source-label">Harga terpisah</span>
            </div>
            <button
              className="simprok-material-ticker simprok-honest-frame"
              onClick={() => goTo('/?ruang=bursa-material')}
              title="Bursa Material - Belum tersambung"
              aria-label="Bursa Material - Belum tersambung"
              data-route="/?ruang=bursa-material"
            >
              <span className="simprok-honest-frame__badge">Belum tersambung</span>
              <PackageSearch size={24} aria-hidden="true" />
              <span>Perubahan harga material terbaru akan tampil setelah data harga tersambung.</span>
            </button>
          </section>
        </div>

        <aside className="simprok-living-room__side" aria-label="Perlu Perhatian">
          <section className="simprok-attention-room">
            <div className="simprok-attention-room__header">
              <AlertTriangle size={22} aria-hidden="true" />
              <div>
                <h2>Perlu Perhatian</h2>
              </div>
            </div>
            <div className="simprok-attention-list">
              <button
                className="simprok-attention-item simprok-attention-item--review"
                onClick={() => goTo('/?ruang=review-rab')}
                title="RAB menunggu review - Standby"
                aria-label="RAB menunggu review - Standby"
                data-route="/?ruang=review-rab"
              >
                <strong>Review</strong>
                <span>RAB menunggu persetujuan akan tampil di sini.</span>
              </button>
              <button
                className="simprok-attention-item simprok-attention-item--info"
                onClick={() => goTo('/?ruang=update-ahsp-basic-price')}
                title="Update AHSP dan Basic Price - Standby"
                aria-label="Update AHSP dan Basic Price - Standby"
                data-route="/?ruang=update-ahsp-basic-price"
              >
                <strong>Aksi</strong>
                <span>Update AHSP dan Basic Price menunggu data tersambung.</span>
              </button>
              <button
                className="simprok-attention-item simprok-attention-item--waiting"
                onClick={() => goTo('/?ruang=data-proyek-belum-lengkap')}
                title="Data proyek belum lengkap - Standby"
                aria-label="Data proyek belum lengkap - Standby"
                data-route="/?ruang=data-proyek-belum-lengkap"
              >
                <strong>Standby</strong>
                <span>Lokasi, draft, dan item penting akan muncul saat tersedia.</span>
              </button>
            </div>
          </section>
        </aside>
      </section>

      <nav className="simprok-mobile-nav" aria-label="Navigasi cepat mobile">
        <button onClick={() => goTo('/')} title="Beranda" aria-label="Beranda" data-route="/">
          <Briefcase size={18} />
          <span>Beranda</span>
        </button>
        <button onClick={() => goTo(canCreateRab ? '/project/new' : '/?ruang=akses-buat-rab')} title="Buat RAB" aria-label="Buat RAB" data-route={canCreateRab ? '/project/new' : '/?ruang=akses-buat-rab'}>
          <ClipboardList size={18} />
          <span>Buat RAB</span>
        </button>
        <button onClick={() => goTo('/proyek')} title="Proyek" aria-label="Proyek" data-route="/proyek">
          <Briefcase size={18} />
          <span>Proyek</span>
        </button>
        <button onClick={() => goTo('/field')} title="Monitoring" aria-label="Monitoring" data-route="/field">
          <Activity size={18} />
          <span>Monitoring</span>
        </button>
      </nav>
    </div>
  );
}
