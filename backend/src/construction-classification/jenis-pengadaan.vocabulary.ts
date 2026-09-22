/**
 * SIMPROK — Jenis Pengadaan vocabulary CONSUMER (backend).
 *
 * CANONICAL WRITE AUTHORITY (Slice 1 closure):
 *   shared/jenis-pengadaan.vocabulary.json
 *
 * Deterministic adapter only — loads the shared file. Do not edit option lists
 * here. Nest keeps rootDir under backend/src, so this uses filesystem load
 * rather than a cross-package TypeScript import.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type JenisPengadaanVocabularyFile = {
  jenisPengadaanOptions: string[];
  jenisPengadaanWithBidang: string[];
};

function resolveVocabularyPath(): string {
  // Jest / nest / npm scripts in this repo run with cwd = backend/.
  return join(
    process.cwd(),
    '..',
    'shared',
    'jenis-pengadaan.vocabulary.json',
  );
}

const vocabulary = JSON.parse(
  readFileSync(resolveVocabularyPath(), 'utf8'),
) as JenisPengadaanVocabularyFile;

export const JENIS_PENGADAAN_OPTIONS: readonly string[] =
  vocabulary.jenisPengadaanOptions;

export const JENIS_PENGADAAN_WITH_BIDANG: readonly string[] =
  vocabulary.jenisPengadaanWithBidang;

/** Absolute path of the write-authority file — used by T-S1-15. */
export const JENIS_PENGADAAN_VOCABULARY_PATH = resolveVocabularyPath();
