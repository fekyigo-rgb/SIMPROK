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

export function getProjectNotes(_projectId: string): ProjectNote[] {
  return [];
}

export function getProjectNoteSummary(_projectId: string) {
  return { jumlah: 0, titikMerah: false };
}
