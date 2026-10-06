/**
 * SIMPROK — lower-level classification vocabulary CONSUMER (backend).
 *
 * CANONICAL WRITE AUTHORITY:
 *   shared/construction-taxonomy.vocabulary.json
 *
 * Deterministic adapter only. Do not edit option lists here.
 * Jenis Pengadaan stays in shared/jenis-pengadaan.vocabulary.json.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type ConstructionTaxonomyVocabularyFile = {
  kategori: string[];
  subkategoriByKategori: Record<string, string[]>;
  jenisPekerjaan: string[];
};

function resolveVocabularyPath(): string {
  return join(process.cwd(), '..', 'shared', 'construction-taxonomy.vocabulary.json');
}

const vocabulary = JSON.parse(
  readFileSync(resolveVocabularyPath(), 'utf8'),
) as ConstructionTaxonomyVocabularyFile;

export const APPROVED_KATEGORI: readonly string[] = vocabulary.kategori;

export const APPROVED_SUBKATEGORI_BY_KATEGORI: Readonly<
  Record<string, readonly string[]>
> = vocabulary.subkategoriByKategori;

export const APPROVED_JENIS_PEKERJAAN: readonly string[] = vocabulary.jenisPekerjaan;

export const CONSTRUCTION_TAXONOMY_VOCABULARY_PATH = resolveVocabularyPath();

export function approvedSubkategoriFor(kategori: string): readonly string[] {
  return APPROVED_SUBKATEGORI_BY_KATEGORI[kategori] ?? [];
}
