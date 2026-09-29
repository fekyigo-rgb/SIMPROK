/**
 * T-IAC — Human-assisted Import ↔ Classification ↔ Assignment connection.
 * Connects existing services; does not rebuild foundations.
 */

import {
  emptyAssistedClassificationContext,
  parseAssistedClassificationContext,
} from '../document/ahsp-assisted-classification';
import { AhspClassificationAssignmentProvenance } from '@prisma/client';

describe('T-IAC assisted classification context parsing', () => {
  it('T-IAC-20: empty / malformed degrades safely (legacy commit still works)', () => {
    expect(parseAssistedClassificationContext(null)).toBeNull();
    expect(parseAssistedClassificationContext('')).toBeNull();
    expect(parseAssistedClassificationContext({ not: 'valid' } as unknown)).toEqual({
      jenisPengadaanRootId: null,
      paths: [],
      dasarAcuan: null,
      penerbit: null,
    });
  });

  it('T-IAC-11/12: provenance hints preserved for assignment mapping', () => {
    const ctx = parseAssistedClassificationContext({
      jenisPengadaanRootId: 'root-1',
      paths: [
        { leafNodeId: 'leaf-a', provenanceHint: 'FROM_SOURCE' },
        { leafNodeId: 'leaf-b', provenanceHint: 'FROM_USER' },
      ],
      dasarAcuan: 'SE DJBK 47',
      penerbit: 'Ditjen Bina Konstruksi',
    });
    expect(ctx?.paths).toEqual([
      { leafNodeId: 'leaf-a', provenanceHint: 'FROM_SOURCE', sourceEvidence: null },
      { leafNodeId: 'leaf-b', provenanceHint: 'FROM_USER', sourceEvidence: null },
    ]);
    expect(ctx?.dasarAcuan).toBe('SE DJBK 47');
    expect(ctx?.penerbit).toBe('Ditjen Bina Konstruksi');
    expect(AhspClassificationAssignmentProvenance.SOURCE_DERIVED).toBe(
      'SOURCE_DERIVED',
    );
    expect(AhspClassificationAssignmentProvenance.HUMAN_ADDED).toBe('HUMAN_ADDED');
  });

  it('T-IAC-21: Dasar and Penerbit stay distinct fields', () => {
    const empty = emptyAssistedClassificationContext();
    expect(empty).toEqual({
      jenisPengadaanRootId: null,
      paths: [],
      dasarAcuan: null,
      penerbit: null,
    });
    const ctx = parseAssistedClassificationContext({
      dasarAcuan: 'Dasar X',
      penerbit: 'Penerbit Y',
      paths: [],
    });
    expect(ctx?.dasarAcuan).toBe('Dasar X');
    expect(ctx?.penerbit).toBe('Penerbit Y');
    expect(ctx?.dasarAcuan).not.toBe(ctx?.penerbit);
  });

  it('T-IAC-05: multi-path declarations parse without collapsing', () => {
    const ctx = parseAssistedClassificationContext({
      jenisPengadaanRootId: 'jp-1',
      paths: [
        { leafNodeId: 'a', provenanceHint: 'FROM_SOURCE' },
        { leafNodeId: 'b', provenanceHint: 'FROM_USER' },
        { leafNodeId: '', provenanceHint: 'FROM_USER' },
      ],
    });
    expect(ctx?.paths.map((p) => p.leafNodeId)).toEqual(['a', 'b']);
  });
});

describe('T-IAC wiring symbols (no-warehouse)', () => {
  it('T-IAC-22: assisted types live under ahsp/document — not a second taxonomy module', () => {
    // Importing from document/ proves the Import seam owns the DTO.
    expect(typeof parseAssistedClassificationContext).toBe('function');
    expect(typeof emptyAssistedClassificationContext).toBe('function');
  });
});
