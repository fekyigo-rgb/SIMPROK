// AHSP INTELLIGENCE CLOSURE — GOLDEN-CASE EVIDENCE PATH, ON REAL DOCUMENTS.
//
// Runs the REAL intake reader, the REAL understanding parser and the REAL Unit
// Kernel over the Owner's real AHSP workbooks, and prints, per golden case:
//
//   SOURCE -> CAPTURE -> STORE (what CLOSURE 1 now persists) -> UNIT
//
// WHAT THIS DELIBERATELY DOES NOT CLAIM. IDENTITY and CANDIDATE depend on the
// ResourceCatalog of the workspace doing the import, which differs per
// environment; this harness reads the e2e vocabulary only. It therefore reports
// what SIMPROK can prove from the DOCUMENT plus the unit authority, and says
// plainly where the remaining question belongs. Nothing is written anywhere.
import { config as loadEnv } from 'dotenv';
import { resolve as resolvePath } from 'path';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

loadEnv({ path: resolvePath(__dirname, '..', '..', '.env.e2e') });

import { sealSourceEnvelope } from '../../src/universal-intake/source-envelope';
import { ReaderRegistry } from '../../src/universal-intake/readers/reader-registry';
import { understandAhspDocument } from '../../src/ahsp/document/ahsp-document-understanding';
import { UnitKernelService } from '../../src/unit-kernel/unit-kernel.service';
import { trustedUnitContext } from '../../src/unit-kernel/unit-kernel.contracts';
import { identicalQuestionKey } from '../../src/resource-catalog/identical-question-key';

const FILES = [
  'C:/SIMPROK/data/first-real-input/AHSP ok(1).xlsx',
  'C:/SIMPROK/data/first-real-input/AHSP Bina Marga 2026 B1-B12.xlsx',
  'C:/SIMPROK/data/first-real-input/AHSP BINA MARGA.xlsx',
];

const GOLDEN = [
  'Alat Bantu', 'Plastizier', 'Batu Kosong', 'Agregat kasar', 'Dump Truck',
  'Tanah Biasa', 'Water Tank', 'Semen', 'Pipa porous', 'Wheel Loader',
  'Motor Grader', 'Concrete Mixer',
];

const WORKSPACE = '00000000-0000-4000-8000-000000000001';

async function main() {
  const prisma = new PrismaClient();
  const kernel = new UnitKernelService(prisma as any);

  type Row = {
    file: string; item: string | null; itemCode: string | null;
    group: string | null; rawName: string | null; rawCode: string | null;
    rawUnit: string | null; coefficient: number | null;
    sheet: string | null; row: number | null; nameCell: string | null;
    codeCell: string | null; unitCell: string | null; sha: string; fileName: string;
    parser: string; itemReady: boolean; itemReasons: readonly string[];
  };
  const rows: Row[] = [];

  for (const file of FILES) {
    const envelope = sealSourceEnvelope({
      ingestionChannel: 'HUMAN_UPLOAD' as any,
      fileName: file.split('/').pop()!,
      mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      bytes: readFileSync(file),
      workspaceId: WORKSPACE,
      organizationId: '00000000-0000-4000-8000-000000000002',
      actorAccountId: '00000000-0000-4000-8000-000000000003',
    });
    const read = await ReaderRegistry.default().read(envelope);
    const k = understandAhspDocument(read, envelope);
    for (const item of k.workItems) {
      for (const r of item.resources) {
        rows.push({
          file: file.split('/').pop()!,
          item: item.methodName?.raw ?? null,
          itemCode: item.workType?.raw ?? null,
          group: r.group, rawName: r.rawName, rawCode: r.rawCode,
          rawUnit: r.rawUnit, coefficient: r.coefficient,
          sheet: r.nameEvidence?.sheetName ?? null,
          row: r.nameEvidence?.rowNumber ?? null,
          nameCell: r.nameEvidence?.locator ?? null,
          codeCell: r.codeEvidence?.locator ?? null,
          unitCell: r.unitEvidence?.locator ?? null,
          sha: k.source.contentDigestSha256,
          fileName: k.source.fileName,
          parser: k.source.readerContractVersion,
          itemReady: item.status === 'READY',
          itemReasons: item.reasonCodes,
        });
      }
    }
  }

  console.log('REAL AHSP CORPUS — resources captured:', rows.length);

  for (const g of GOLDEN) {
    const hits = rows.filter((r) => (r.rawName ?? '').toLowerCase().includes(g.toLowerCase()));
    console.log('\n' + '='.repeat(78));
    console.log('GOLDEN CASE: ' + g);
    if (hits.length === 0) {
      console.log('  SOURCE      : ABSENT from all three real AHSP workbooks');
      console.log('  VERDICT     : R0 — source reality unavailable. Nothing to capture,');
      console.log('                nothing to identify, and no human question to ask.');
      continue;
    }
    // Distinct captured forms.
    const forms = new Map<string, Row>();
    for (const h of hits) {
      const key = [h.group, h.rawName, h.rawCode ?? '-', h.rawUnit ?? '-'].join('|');
      if (!forms.has(key)) forms.set(key, h);
    }
    console.log('  SOURCE      : ' + hits.length + ' row(s), ' + forms.size + ' distinct form(s)');

    for (const [, h] of forms) {
      console.log('  ----------------------------------------------------------------');
      console.log('  CAPTURE     : name=' + JSON.stringify(h.rawName) +
        ' code=' + JSON.stringify(h.rawCode) +
        ' unit=' + JSON.stringify(h.rawUnit) +
        ' type=' + h.group + ' coef=' + h.coefficient);
      console.log('  CONTEXT     : item=' + JSON.stringify((h.itemCode ?? '') + ' ' + (h.item ?? '')).slice(0, 86));
      console.log('  STORE       : sheet=' + h.sheet + ' row=' + h.row +
        ' cells(name/code/unit)=' + h.nameCell + '/' + h.codeCell + '/' + h.unitCell);
      console.log('                sha256=' + h.sha.slice(0, 12) + '… file=' + JSON.stringify(h.fileName) + ' parser=' + h.parser);

      // UNIT — the real kernel, asked WITH the class the document declared.
      if (h.rawUnit) {
        const withCtx = await kernel.resolve(h.rawUnit, h.rawUnit, undefined, trustedUnitContext(h.group));
        const without = await kernel.resolve(h.rawUnit, h.rawUnit);
        const fmt = (r: any) => r.status + (r.sourceUnitDefinition ? '/' + r.sourceUnitDefinition.code : '');
        console.log('  UNIT        : with class -> ' + fmt(withCtx) + '   (without class -> ' + fmt(without) + ')');
      } else {
        console.log('  UNIT        : source stated none');
      }

      // SPECIFICATION — read, never invented.
      const designations = (h.rawName ?? '').split(/\s+/).filter((t) => /\d/.test(t));
      console.log('  SPEC        : ' + (designations.length
        ? 'stated in the name: ' + JSON.stringify(designations.join(' ')) +
          ' — a candidate stating a DIFFERENT designation is a contradiction and is dropped'
        : 'the source states none — unproven, never contradicted'));

      // The exact question the occurrence path will now ask.
      const key = identicalQuestionKey({
        workspaceId: WORKSPACE,
        resourceType: h.group ?? '',
        rawName: h.rawName ?? '',
        rawCode: h.rawCode,
        rawUnit: h.rawUnit,
      });
      console.log('  QUESTION    : ' + key.slice(0, 16) + '…  (import and occurrence now ask this same key)');
      console.log('  ITEM STATE  : ' + (h.itemReady ? 'READY — the work item can be written' :
        'NOT READY — ' + JSON.stringify(h.itemReasons)));
    }
  }

  console.log('\n' + '='.repeat(78));
  console.log('IDENTITY / CANDIDATE are decided against the importing workspace\'s own');
  console.log('ResourceCatalog and are therefore environment-specific. This harness');
  console.log('proves the document-side evidence path only, and claims nothing else.');
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
