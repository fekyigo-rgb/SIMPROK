export type NoteJenis = 'rapat' | 'lapangan' | 'pribadi';
export type NoteTertaut = 'rab' | 'jadwal' | 'governance' | 'umum';
export type NoteStatus = 'terbuka' | 'ditanggapi' | 'selesai';

export interface ProjectNoteReply {
  id: string;
  penulisNama: string;
  penulisFungsi?: string;
  waktuISO: string;
  isi: string;
}

export interface ProjectNote {
  id: string;
  projectId: string;
  penulisNama: string;
  penulisOrganisasi?: string;
  penulisFungsi?: string;
  waktuISO: string;
  jenis: NoteJenis;
  tertaut: NoteTertaut;
  isi: string;
  status: NoteStatus;
  balasan: ProjectNoteReply[];
}

export const projectNotesSeed: ProjectNote[] = [
  {
    id: 'note-gedung-a-1',
    projectId: 'gedung-a',
    penulisNama: 'Saul',
    penulisOrganisasi: 'PT Konsultan B',
    penulisFungsi: 'Reviewer',
    waktuISO: '2026-07-05T14:20:00+09:00',
    jenis: 'rapat',
    tertaut: 'rab',
    isi: 'Metode galian pada item 3.2 sebaiknya ditinjau ulang. Kondisi tanah di segmen selatan lebih keras dari asumsi dan dampak ke harga satuan perlu dihitung.',
    status: 'terbuka',
    balasan: [],
  },
  {
    id: 'note-gedung-a-2',
    projectId: 'gedung-a',
    penulisNama: 'Feky de Fretes',
    penulisOrganisasi: 'PT Kontraktor A',
    penulisFungsi: 'Penanggung Jawab',
    waktuISO: '2026-07-03T09:05:00+09:00',
    jenis: 'lapangan',
    tertaut: 'jadwal',
    isi: 'Hujan tiga hari berturut menghambat pekerjaan drainase. Perkiraan mundur 4 hari kerja dan perlu dicatat untuk penyesuaian jadwal.',
    status: 'ditanggapi',
    balasan: [
      {
        id: 'reply-gedung-a-2-1',
        penulisNama: 'Yance',
        penulisFungsi: 'Approver',
        waktuISO: '2026-07-03T11:40:00+09:00',
        isi: 'Dicatat. Siapkan usulan penyesuaian jadwal resmi lewat Ajukan Perubahan Data agar tertelusur.',
      },
    ],
  },
  {
    id: 'note-gedung-a-3',
    projectId: 'gedung-a',
    penulisNama: 'Jusuf',
    penulisOrganisasi: 'PT Kontraktor A',
    penulisFungsi: 'Pengusul',
    waktuISO: '2026-07-01T16:30:00+09:00',
    jenis: 'pribadi',
    tertaut: 'umum',
    isi: 'Dokumen RKK versi awal sudah disiapkan tim K3. Menunggu review sebelum diunggah ke ruang dokumen.',
    status: 'selesai',
    balasan: [],
  },
  {
    id: 'note-pipa-b-1',
    projectId: 'pipa-b',
    penulisNama: 'Dani',
    penulisOrganisasi: 'Dinas PU Kab. C',
    penulisFungsi: 'Host',
    waktuISO: '2026-07-04T10:15:00+09:00',
    jenis: 'rapat',
    tertaut: 'governance',
    isi: 'Susunan pihak pengawas perlu dikonfirmasi sebelum finalisasi pembukaan kunci.',
    status: 'ditanggapi',
    balasan: [],
  },
  {
    id: 'note-kendaraan-c-1',
    projectId: 'kendaraan-c',
    penulisNama: 'Gerson',
    penulisOrganisasi: 'Dinas PU Kab. C',
    penulisFungsi: 'PPK',
    waktuISO: '2026-07-06T08:25:00+09:00',
    jenis: 'rapat',
    tertaut: 'umum',
    isi: 'Dokumen pembanding spesifikasi kendaraan perlu dilampirkan sebelum pelaksanaan.',
    status: 'terbuka',
    balasan: [],
  },
  {
    id: 'note-kendaraan-c-2',
    projectId: 'kendaraan-c',
    penulisNama: 'Jusuf',
    penulisOrganisasi: 'PT Kontraktor A',
    penulisFungsi: 'Pengusul',
    waktuISO: '2026-07-05T13:10:00+09:00',
    jenis: 'pribadi',
    tertaut: 'umum',
    isi: 'Tim administrasi menyiapkan ringkasan spesifikasi untuk rapat berikutnya.',
    status: 'selesai',
    balasan: [],
  },
  {
    id: 'note-kendaraan-c-3',
    projectId: 'kendaraan-c',
    penulisNama: 'Ryan',
    penulisOrganisasi: 'PT Konsultan B',
    penulisFungsi: 'Reviewer',
    waktuISO: '2026-07-05T15:00:00+09:00',
    jenis: 'rapat',
    tertaut: 'rab',
    isi: 'Harga satuan pengiriman perlu dipisahkan agar audit nilai lebih jelas.',
    status: 'ditanggapi',
    balasan: [],
  },
  {
    id: 'note-kendaraan-c-4',
    projectId: 'kendaraan-c',
    penulisNama: 'Semi',
    penulisOrganisasi: 'Dinas PU Kab. C',
    penulisFungsi: 'PPTK',
    waktuISO: '2026-07-04T09:45:00+09:00',
    jenis: 'lapangan',
    tertaut: 'jadwal',
    isi: 'Jadwal serah terima perlu disesuaikan dengan kesiapan pemeriksaan barang.',
    status: 'terbuka',
    balasan: [],
  },
  {
    id: 'note-kendaraan-c-5',
    projectId: 'kendaraan-c',
    penulisNama: 'Gunawan',
    penulisOrganisasi: 'Dinas PU Kab. C',
    penulisFungsi: 'KPA',
    waktuISO: '2026-07-02T11:00:00+09:00',
    jenis: 'pribadi',
    tertaut: 'umum',
    isi: 'Siapkan daftar dokumen yang harus dibawa saat pemeriksaan akhir.',
    status: 'selesai',
    balasan: [],
  },
  ...Array.from({ length: 8 }, (_, index) => ({
    id: `note-infrastruktur-d-${index + 1}`,
    projectId: 'infrastruktur-d',
    penulisNama: index % 2 === 0 ? 'Feky de Fretes' : 'Saul',
    penulisOrganisasi: index % 2 === 0 ? 'PT Kontraktor A' : 'PT Konsultan B',
    penulisFungsi: index % 2 === 0 ? 'Pelaksana Lapangan' : 'Reviewer',
    waktuISO: `2026-07-${String(index + 1).padStart(2, '0')}T08:00:00+09:00`,
    jenis: index % 3 === 0 ? 'lapangan' : index % 3 === 1 ? 'rapat' : 'pribadi',
    tertaut: index % 2 === 0 ? 'jadwal' : 'rab',
    isi: `Catatan progress infrastruktur hari ke-${index + 1} untuk evaluasi pelaksanaan dan tindak lanjut tim.`,
    status: index < 2 ? 'terbuka' : index < 5 ? 'ditanggapi' : 'selesai',
    balasan: [],
  })) as ProjectNote[],
];

export function getProjectNotes(projectId: string) {
  return projectNotesSeed.filter((note) => note.projectId === projectId);
}

export function getProjectNoteSummary(projectId: string) {
  const notes = getProjectNotes(projectId);
  return {
    jumlah: notes.length,
    titikMerah: notes.some((note) => note.status === 'terbuka'),
  };
}
