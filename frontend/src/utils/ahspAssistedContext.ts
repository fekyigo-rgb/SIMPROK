import type { AssistedClassificationContext } from '../components/AhspImportAssistedClassificationPanel';

/** Reuse the same empty assisted classification state across Import, Manual, and Detail. */
export function emptyAssistedContext(): AssistedClassificationContext {
  return {
    jenisPengadaanRootId: null,
    paths: [],
    pendingPaths: [],
    dasarAcuan: null,
    penerbit: null,
    displayLabels: {
      jenisPengadaan: null,
      kategori: [],
      subkategori: [],
      jenisPekerjaan: [],
    },
  };
}
