import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, CloudOff, MessageSquare, Plus, Reply } from 'lucide-react';
import { getProjectNotes, type NoteJenis, type NoteStatus, type NoteTertaut, type ProjectNote } from '../projectNotes';

type NoteFilter = 'semua' | NoteJenis | 'terbuka' | 'rab' | 'jadwal';

const projectNamesById: Record<string, string> = {
  'gedung-a': 'Pembangunan Gedung A',
  'pipa-b': 'Renovasi Jaringan Pipa B',
  'kendaraan-c': 'Pengadaan Kendaraan C',
  'infrastruktur-d': 'Perbaikan Infrastruktur D',
  'arsip-e': 'Pekerjaan Drainase E',
};

const noteFilterLabels: Record<NoteFilter, string> = {
  semua: 'Semua',
  rapat: 'Rapat',
  lapangan: 'Lapangan',
  pribadi: 'Pribadi',
  terbuka: 'Terbuka',
  rab: 'Tertaut RAB',
  jadwal: 'Tertaut Jadwal',
};

const noteJenisLabel: Record<NoteJenis, string> = {
  rapat: 'Rapat',
  lapangan: 'Lapangan',
  pribadi: 'Catatan Pribadi',
};

const noteTertautLabel: Record<NoteTertaut, string> = {
  rab: 'Tertaut: RAB',
  jadwal: 'Tertaut: Jadwal',
  governance: 'Tertaut: Governance',
  umum: 'Umum',
};

const noteStatusLabel: Record<NoteStatus, string> = {
  terbuka: 'Terbuka',
  ditanggapi: 'Ditanggapi',
  selesai: 'Selesai',
};

const noteFilters: NoteFilter[] = ['semua', 'rapat', 'lapangan', 'terbuka', 'rab', 'jadwal'];

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function formatNoteTime(waktuISO: string) {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(waktuISO));
}

export function ProjectNotesPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const projectName = projectId ? projectNamesById[projectId] : undefined;
  const [notes, setNotes] = useState<ProjectNote[]>(() => getProjectNotes(projectId || ''));
  const [noteFilter, setNoteFilter] = useState<NoteFilter>('semua');
  const [noteFormOpen, setNoteFormOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState({
    isi: '',
    jenis: 'rapat' as NoteJenis,
    tertaut: 'umum' as NoteTertaut,
  });

  const filteredNotes = notes.filter((note) => {
    if (noteFilter === 'semua') return true;
    if (noteFilter === 'terbuka') return note.status === 'terbuka';
    if (noteFilter === 'rab' || noteFilter === 'jadwal') return note.tertaut === noteFilter;
    return note.jenis === noteFilter;
  });

  const addNote = () => {
    if (!projectId || !noteDraft.isi.trim()) return;

    setNotes((current) => [
      {
        id: `note-local-${Date.now()}`,
        projectId,
        penulisNama: 'Saya',
        penulisFungsi: 'Draft frontend',
        waktuISO: new Date().toISOString(),
        jenis: noteDraft.jenis,
        tertaut: noteDraft.tertaut,
        isi: noteDraft.isi.trim(),
        status: 'terbuka',
        balasan: [],
      },
      ...current,
    ]);
    setNoteDraft({ isi: '', jenis: 'rapat', tertaut: 'umum' });
    setNoteFormOpen(false);
  };

  const markNoteDone = (noteId: string) => {
    setNotes((current) => current.map((note) => (note.id === noteId ? { ...note, status: 'selesai' } : note)));
  };

  const replyNote = (noteId: string) => {
    setNotes((current) =>
      current.map((note) =>
        note.id === noteId
          ? {
              ...note,
              status: note.status === 'selesai' ? note.status : 'ditanggapi',
              balasan: [
                ...note.balasan,
                {
                  id: `reply-local-${Date.now()}`,
                  penulisNama: 'Saya',
                  penulisFungsi: 'Draft frontend',
                  waktuISO: new Date().toISOString(),
                  isi: 'Tanggapan sementara dicatat di draft frontend.',
                },
              ],
            }
          : note,
      ),
    );
  };

  return (
    <main className="simprok-detail simprok-catatan-page">
      <nav className="simprok-detail__breadcrumb" aria-label="Breadcrumb">
        <button type="button" onClick={() => navigate('/proyek')}>
          Proyek Saya
        </button>
        <span>/</span>
        <button type="button" onClick={() => navigate(projectId ? `/project/${projectId}/detail` : '/proyek')}>
          {projectName || 'Detail Proyek'}
        </button>
        <span>/</span>
        <strong>Catatan & Diskusi</strong>
      </nav>

      <section className="simprok-catatan-room" aria-labelledby="catatan-title">
        <header className="simprok-catatan-room__head">
          <div className="simprok-catatan-room__icon" aria-hidden="true">
            <MessageSquare size={20} />
          </div>
          <div>
            <p className="simprok-catatan-room__eyebrow">{projectName || 'Proyek'}</p>
            <h1 id="catatan-title">Catatan & Diskusi Proyek</h1>
            <p>Masukan personel, notulen rapat, dan catatan yang tertelusur, tertaut, tertanggapi.</p>
          </div>
          <button type="button" className="simprok-catatan-room__new" onClick={() => setNoteFormOpen((current) => !current)}>
            <Plus size={16} aria-hidden="true" />
            Catatan Baru
          </button>
        </header>

        <div className="simprok-catatan-room__filters" aria-label="Filter catatan">
          {noteFilters.map((filter) => (
            <button
              key={filter}
              type="button"
              className={noteFilter === filter ? 'simprok-catatan-filter simprok-catatan-filter--active' : 'simprok-catatan-filter'}
              onClick={() => setNoteFilter(filter)}
            >
              {noteFilterLabels[filter]}
            </button>
          ))}
        </div>

        {noteFormOpen ? (
          <div className="simprok-catatan-form">
            <div className="simprok-catatan-form__row">
              <label>
                <span>Jenis</span>
                <select value={noteDraft.jenis} onChange={(event) => setNoteDraft((current) => ({ ...current, jenis: event.target.value as NoteJenis }))}>
                  <option value="rapat">Rapat</option>
                  <option value="lapangan">Lapangan</option>
                  <option value="pribadi">Pribadi</option>
                </select>
              </label>
              <label>
                <span>Tertaut ke</span>
                <select value={noteDraft.tertaut} onChange={(event) => setNoteDraft((current) => ({ ...current, tertaut: event.target.value as NoteTertaut }))}>
                  <option value="umum">Umum</option>
                  <option value="rab">RAB</option>
                  <option value="jadwal">Jadwal</option>
                  <option value="governance">Governance</option>
                </select>
              </label>
            </div>
            <label>
              <span>Isi catatan</span>
              <textarea
                rows={3}
                value={noteDraft.isi}
                onChange={(event) => setNoteDraft((current) => ({ ...current, isi: event.target.value }))}
                placeholder="Tulis masukan, notulen, atau catatan lapangan."
              />
            </label>
            <div className="simprok-catatan-form__actions">
              <button type="button" className="simprok-detail-mini-button simprok-detail-mini-button--blue" onClick={addNote}>
                Terapkan Sementara
              </button>
              <button type="button" className="simprok-detail-mini-button" onClick={() => setNoteFormOpen(false)}>
                Batal
              </button>
            </div>
          </div>
        ) : null}

        <div className="simprok-catatan-feed">
          {filteredNotes.length === 0 ? (
            <div className="simprok-catatan-empty">Belum ada catatan pada filter ini.</div>
          ) : (
            filteredNotes.map((note) => (
              <article key={note.id} className="simprok-catatan-note">
                <header className="simprok-catatan-note__top">
                  <div className="simprok-catatan-avatar">{initials(note.penulisNama)}</div>
                  <div className="simprok-catatan-note__who">
                    <strong>{note.penulisNama}</strong>
                    <span>
                      {[note.penulisFungsi, note.penulisOrganisasi].filter(Boolean).join(' / ') || 'Personel proyek'}
                    </span>
                  </div>
                  <time>{formatNoteTime(note.waktuISO)}</time>
                </header>
                <div className="simprok-catatan-note__tags">
                  <span className={`simprok-catatan-tag simprok-catatan-tag--${note.jenis}`}>{noteJenisLabel[note.jenis]}</span>
                  <span className="simprok-catatan-link-tag">{noteTertautLabel[note.tertaut]}</span>
                </div>
                <p className="simprok-catatan-note__body">{note.isi}</p>
                <footer className="simprok-catatan-note__foot">
                  <span className={`simprok-catatan-status simprok-catatan-status--${note.status}`}>{noteStatusLabel[note.status]}</span>
                  <div className="simprok-catatan-note__actions">
                    <button type="button" onClick={() => replyNote(note.id)}>
                      <Reply size={14} aria-hidden="true" />
                      Tanggapi
                    </button>
                    {note.status !== 'selesai' ? (
                      <button type="button" onClick={() => markNoteDone(note.id)}>
                        <Check size={14} aria-hidden="true" />
                        Tandai Selesai
                      </button>
                    ) : null}
                  </div>
                </footer>
                {note.balasan.map((reply) => (
                  <div key={reply.id} className="simprok-catatan-reply">
                    <div>
                      <strong>{reply.penulisNama}</strong>
                      <span>{formatNoteTime(reply.waktuISO)}{reply.penulisFungsi ? ` / ${reply.penulisFungsi}` : ''}</span>
                    </div>
                    <p>{reply.isi}</p>
                  </div>
                ))}
              </article>
            ))
          )}
        </div>

        <div className="simprok-catatan-honest">
          <CloudOff size={17} aria-hidden="true" />
          <span>Catatan tersimpan sementara di draft frontend. Penyimpanan resmi, notifikasi lintas-ruang, dan audit trail menunggu mesin tersambung.</span>
        </div>
      </section>
    </main>
  );
}

export default ProjectNotesPage;
