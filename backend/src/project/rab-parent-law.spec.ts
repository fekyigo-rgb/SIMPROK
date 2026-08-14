import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * RAB-FOCUS-01 §17–§18 — ONE canonical parent law, agreed by every writer.
 *
 * `saveDraftBoq`'s structural preflight refuses a non-FOLDER parent. That guard
 * is only trustworthy if it matches what the OTHER write paths can actually
 * produce — a validator stricter than the importer would reject a document
 * SIMPROK itself created, and one looser than `initiateSetup` would mean two
 * different laws depending on which door the data came through.
 *
 * This file pins the agreement so a future change to any single writer fails
 * here rather than in a Owner's RAB. It asserts structure, not behaviour, on
 * purpose: the guarantee is a property of how these writers are WRITTEN.
 */

const read = (name: string) => readFileSync(join(__dirname, name), 'utf8');

const adapter = read('boq-xlsx-intake.adapter.ts');
const importService = read('boq-import.service.ts');
const projectService = read('project.service.ts');
const preflight = read('rab-structure-preflight.ts');

describe('canonical RAB parent law — only a Sub Judul owns children', () => {
  it('the XLSX adapter can only ever name a FOLDER as a parent', () => {
    // A folder never takes a parent, and a work item takes the active folder.
    expect(adapter).toContain('parentSourceReference: isFolder ? null : activeFolder');
    // It starts as null...
    expect(adapter).toContain('let activeFolder: string | null = null;');
    // ...and the ONLY assignment to it anywhere is guarded by isFolder, so the
    // reference it hands out can never point at a WORK_ITEM.
    const assignments = [...adapter.matchAll(/activeFolder\s*=\s*([^;]+);/g)].map(
      (match) => match[1].trim(),
    );
    expect(assignments).toEqual(['reference']);
    expect(adapter).toContain('if (isFolder) activeFolder = reference;');
  });

  it('the importer resolves a parent only from references the adapter produced', () => {
    // The id map is keyed by source row, filled as rows are created, and the
    // only references fed to it come from `parentSourceReference` above.
    expect(importService).toContain(
      "const parentId = row.parentSourceReference ? ids.get(row.parentSourceReference) ?? null : null",
    );
  });

  it('initiateSetup has always required a FOLDER parent, explicitly', () => {
    // The oldest write path states the law in words; the preflight below is
    // the same law, not a new one.
    expect(projectService).toContain('must be a FOLDER');
    expect(projectService).toContain('folderSet.has(parentId!)');
  });

  it('saveDraftBoq enforces the same law, from one declared set', () => {
    expect(preflight).toContain("PARENT_CAPABLE_ITEM_TYPES = new Set(['FOLDER'])");
    expect(preflight).toContain('INVALID_PARENT_TYPE');
  });

  it('no writer declares a second, different parent-capable set', () => {
    // If another type ever becomes parent-capable it must be decided once, in
    // the declared set above — never by a second literal somewhere else.
    for (const source of [adapter, importService, projectService]) {
      expect(source).not.toMatch(/PARENT_CAPABLE|parentCapableTypes/);
    }
  });
});
