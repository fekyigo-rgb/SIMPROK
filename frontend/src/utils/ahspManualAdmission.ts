export type KnownCatalogResource = { id: string; name: string; baseUnit: string };

/**
 * A 409 is not, by itself, proof that the catalog already holds the name.
 * Bind only when the answer actually carries that catalog row. A unit refusal
 * stays a unit refusal.
 */
export function manualAdmissionFailure(
  status: number,
  body: { message?: unknown; resource?: { id?: unknown; name?: unknown; baseUnit?: unknown } } | null,
): { kind: 'bind'; resource: KnownCatalogResource } | { kind: 'message'; text: string } {
  const resource = body?.resource;
  if (
    status === 409 &&
    resource &&
    typeof resource.id === 'string' &&
    resource.id !== '' &&
    typeof resource.name === 'string' &&
    resource.name !== ''
  ) {
    return {
      kind: 'bind',
      resource: {
        id: resource.id,
        name: resource.name,
        baseUnit: typeof resource.baseUnit === 'string' ? resource.baseUnit : '',
      },
    };
  }
  const code = typeof body?.message === 'string' ? body.message : '';
  if (status === 409 && code.startsWith('UNIT_')) {
    return {
      kind: 'message',
      text: 'Satuan yang dipilih tidak dapat dipakai untuk sumber daya ini. Pilih satuan lain dari daftar.',
    };
  }
  if (status === 409) {
    return {
      kind: 'message',
      text: 'Sumber daya belum ditambahkan. Jawaban ini tidak membawa sumber daya katalog yang dapat dipakai.',
    };
  }
  return {
    kind: 'message',
    text: 'Sumber daya belum ditambahkan. Periksa nama dan satuan lalu coba lagi.',
  };
}
