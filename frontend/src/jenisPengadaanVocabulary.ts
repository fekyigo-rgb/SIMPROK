/**
 * SIMPROK — Jenis Pengadaan vocabulary CONSUMER (frontend).
 *
 * CANONICAL WRITE AUTHORITY (Slice 1 closure):
 *   shared/jenis-pengadaan.vocabulary.json
 *
 * Buat RAB / Ruang Interaksi and the classification foundation both consume
 * that single file. Do not edit option lists here.
 */

import vocabulary from '../../shared/jenis-pengadaan.vocabulary.json';

export const JENIS_PENGADAAN_OPTIONS: readonly string[] =
  vocabulary.jenisPengadaanOptions;

export const JENIS_PENGADAAN_WITH_BIDANG: readonly string[] =
  vocabulary.jenisPengadaanWithBidang;
