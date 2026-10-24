import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  acceptIntakeRegionPage,
  clearIntakeLevel,
  deepestSelectedRegion,
  composeDraftDescription,
  emptyIntakeRegionSelection,
  fieldContextAcknowledgement,
  projectFieldContextView,
  readSavedFieldContext,
  intakeContextMatches,
  intakeLocationRegionIds,
  intakeLocationSummary,
  INTAKE_REGION_PAGE_LIMIT,
  beginProjectCreate,
  PROJECT_CREATE_NOT_ATTEMPTED,
  PROJECT_CREATE_UNAUTHORIZED_READBACK_MESSAGE,
  projectCreateHttpDisposition,
  projectCreateRejected,
  projectCreateRequest,
  projectCreateUncertain,
  projectCreateView,
  projectCreated,
  projectIntakeChildrenQuery,
  projectReadbackOutcome,
  projectIntakeRegionQuery,
  classificationNodeIds,
  emptyIntakeClassification,
  retainClassificationSelection,
  selectAllIntakeRegions,
  setIntakeClassificationRoot,
  setIntakeCountry,
  toggleIntakeClassification,
  toggleIntakeRegion,
  visibleProjectClassificationNodes,
  type ClassificationCatalogEntry,
  type IntakeClassificationPick,
  type IntakeRegionPick,
  type IntakeRegionSelection,
  type ProjectClassificationNode,
} from './projectIntakeSelection.ts';
import {
  emptyRegionHierarchy,
  setRegionHierarchyLevel,
} from './regionHierarchy.ts';

const root: ProjectClassificationNode = {
  id: 'root-1',
  level: 'JENIS_PENGADAAN',
  name: 'Pekerjaan Konstruksi',
  parentId: null,
};
const kategori: ProjectClassificationNode = {
  id: 'kat-1',
  level: 'KATEGORI',
  name: 'Bangunan Gedung',
  parentId: 'root-1',
};
const jenisPekerjaan: ProjectClassificationNode = {
  id: 'jp-1',
  level: 'JENIS_PEKERJAAN',
  name: 'Pekerjaan Beton',
  parentId: 'sub-1',
};

test('classification options keep only the requested canonical level', () => {
  assert.deepEqual(
    visibleProjectClassificationNodes(
      [root, kategori, jenisPekerjaan],
      'JENIS_PENGADAAN',
    ),
    [root],
  );
  assert.deepEqual(
    visibleProjectClassificationNodes([kategori, jenisPekerjaan], 'KATEGORI'),
    [kategori],
  );
});

const CLASS = {
  root: '11111111-1111-4111-8111-111111111111',
  other: '12121212-1212-4121-8121-121212121212',
  bina: '22222222-2222-4222-8222-222222222222',
  cipta: '33333333-3333-4333-8333-333333333333',
  jalan: '44444444-4444-4444-8444-444444444444',
  jembatan: '55555555-5555-4555-8555-555555555555',
  gedung: '66666666-6666-4666-8666-666666666666',
};

function classPick(
  id: string,
  name: string,
  parentId: string,
  level: IntakeClassificationPick['level'],
): IntakeClassificationPick {
  return { id, name, parentId, level };
}

function withClass(
  selection: ReturnType<typeof emptyIntakeClassification>,
  pick: IntakeClassificationPick,
) {
  return toggleIntakeClassification(selection, pick);
}

function catalogFor(
  entries: Array<[string, string[] | null]>,
): ClassificationCatalogEntry[] {
  return entries.map(([kategoriId, childIds]) => ({
    kategoriId,
    loaded: childIds !== null,
    childIds: childIds ?? [],
  }));
}

test('a changed classification root clears every kategori and subkategori', () => {
  let selected = setIntakeClassificationRoot(emptyIntakeClassification(), {
    id: CLASS.root,
    name: 'Pekerjaan Konstruksi',
  });
  selected = withClass(selected, classPick(CLASS.bina, 'Bina Marga', CLASS.root, 'KATEGORI'));
  selected = withClass(selected, classPick(CLASS.jalan, 'Jalan', CLASS.bina, 'SUBKATEGORI'));
  assert.deepEqual(
    classificationNodeIds(selected, catalogFor([[CLASS.bina, [CLASS.jalan]]])),
    [CLASS.root, CLASS.bina, CLASS.jalan],
  );
  const changed = setIntakeClassificationRoot(selected, {
    id: CLASS.other,
    name: 'Pekerjaan Konstruksi Terintegrasi',
  });
  assert.deepEqual(changed.picks, []);
  assert.equal(classificationNodeIds(changed, []), null);
});

test('a stale classification id is dropped when the official options no longer contain it', () => {
  assert.equal(retainClassificationSelection('kat-1', [kategori]), 'kat-1');
  assert.equal(retainClassificationSelection('missing', [kategori]), null);
});

test('multi kategori and subkategori stay canonical and prune only the released parent', () => {
  let selected = setIntakeClassificationRoot(emptyIntakeClassification(), {
    id: CLASS.root,
    name: 'Pekerjaan Konstruksi',
  });
  selected = withClass(selected, classPick(CLASS.bina, 'Bina Marga', CLASS.root, 'KATEGORI'));
  selected = withClass(selected, classPick(CLASS.cipta, 'Cipta Karya', CLASS.root, 'KATEGORI'));
  selected = withClass(selected, classPick(CLASS.jalan, 'Jalan', CLASS.bina, 'SUBKATEGORI'));
  selected = withClass(selected, classPick(CLASS.jembatan, 'Jembatan', CLASS.bina, 'SUBKATEGORI'));
  selected = withClass(selected, classPick(CLASS.gedung, 'Bangunan Gedung', CLASS.cipta, 'SUBKATEGORI'));
  selected = withClass(selected, classPick(CLASS.jalan, 'Jalan', CLASS.bina, 'SUBKATEGORI'));
  const catalog = catalogFor([
    [CLASS.bina, [CLASS.jalan, CLASS.jembatan]],
    [CLASS.cipta, [CLASS.gedung]],
  ]);
  assert.deepEqual(classificationNodeIds(selected, catalog), [
    CLASS.root,
    CLASS.bina,
    CLASS.cipta,
    CLASS.jembatan,
    CLASS.gedung,
  ]);
  selected = withClass(selected, classPick(CLASS.bina, 'Bina Marga', CLASS.root, 'KATEGORI'));
  assert.deepEqual(
    classificationNodeIds(selected, catalogFor([[CLASS.cipta, [CLASS.gedung]]])),
    [CLASS.root, CLASS.cipta, CLASS.gedung],
  );
  assert.equal(
    classificationNodeIds(
      withClass(
        setIntakeClassificationRoot(emptyIntakeClassification(), {
          id: CLASS.root,
          name: 'Pekerjaan Konstruksi',
        }),
        classPick(CLASS.bina, 'Bina Marga', CLASS.root, 'KATEGORI'),
      ),
      catalogFor([[CLASS.bina, []]]),
    )?.includes(CLASS.bina),
    true,
  );
  const broad = withClass(
    setIntakeClassificationRoot(emptyIntakeClassification(), {
      id: CLASS.root,
      name: 'Pekerjaan Konstruksi',
    }),
    classPick(CLASS.bina, 'Bina Marga', CLASS.root, 'KATEGORI'),
  );
  assert.deepEqual(
    classificationNodeIds(broad, catalogFor([[CLASS.bina, [CLASS.jalan]]])),
    [CLASS.root, CLASS.bina],
  );
  assert.equal(
    classificationNodeIds(
      withClass(broad, classPick(CLASS.jalan, 'Jalan', CLASS.bina, 'SUBKATEGORI')),
      catalogFor([[CLASS.bina, null]]),
    ),
    null,
  );
});

test('region lookup uses the project intake door and keeps one country context', () => {
  assert.equal(
    projectIntakeChildrenQuery('root-1'),
    '/project-intake/classification/children?parentId=root-1',
  );
  assert.equal(
    projectIntakeRegionQuery({
      administrativeLevel: 'PROVINCE',
      parentId: 'country-1',
      page: 2,
    }),
    '/project-intake/regions?administrativeLevel=PROVINCE&page=2&limit=50&parentId=country-1',
  );
});

const REGION = {
  indonesia: '11111111-1111-4111-8111-111111111111',
  lain: '12121212-1212-4121-8121-121212121212',
  maluku: '22222222-2222-4222-8222-222222222222',
  papua: '33333333-3333-4333-8333-333333333333',
  ambon: '44444444-4444-4444-8444-444444444444',
  tual: '55555555-5555-4555-8555-555555555555',
  jayapura: '66666666-6666-4666-8666-666666666666',
  sirimau: '77777777-7777-4777-8777-777777777777',
  nusaniwe: '88888888-8888-4888-8888-888888888888',
  desaA: '99999999-9999-4999-8999-999999999999',
  desaB: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
};

function pick(
  id: string,
  name: string,
  parentId: string,
  level: IntakeRegionPick['level'],
): IntakeRegionPick {
  return { id, name, parentId, level };
}

function choose(selection: IntakeRegionSelection, next: IntakeRegionPick): IntakeRegionSelection {
  return toggleIntakeRegion(selection, next);
}

function indonesia(): IntakeRegionSelection {
  return setIntakeCountry(emptyIntakeRegionSelection(), {
    id: REGION.indonesia,
    name: 'Indonesia',
  });
}

test('one kabupaten under one province is the precise canonical scope', () => {
  const selected = choose(
    choose(indonesia(), pick(REGION.maluku, 'Maluku', REGION.indonesia, 'PROVINCE')),
    pick(REGION.ambon, 'Kota Ambon', REGION.maluku, 'REGENCY_CITY'),
  );
  assert.deepEqual(intakeLocationRegionIds(selected), [REGION.ambon]);
  assert.equal(intakeLocationRegionIds(selected).includes(REGION.maluku), false);
  assert.equal(intakeLocationSummary(selected)[0]?.label, 'Indonesia · Maluku · Kota Ambon');
});

test('two kabupaten in one province stay distinct canonical ids', () => {
  const selected = [REGION.ambon, REGION.tual].reduce(
    (current, id, index) =>
      choose(
        current,
        pick(id, index === 0 ? 'Kota Ambon' : 'Kota Tual', REGION.maluku, 'REGENCY_CITY'),
      ),
    choose(indonesia(), pick(REGION.maluku, 'Maluku', REGION.indonesia, 'PROVINCE')),
  );
  assert.deepEqual(intakeLocationRegionIds(selected), [REGION.ambon, REGION.tual]);
});

test('two kabupaten in different provinces under one country stay together', () => {
  let selected = choose(indonesia(), pick(REGION.maluku, 'Maluku', REGION.indonesia, 'PROVINCE'));
  selected = choose(selected, pick(REGION.papua, 'Papua', REGION.indonesia, 'PROVINCE'));
  selected = choose(selected, pick(REGION.ambon, 'Kota Ambon', REGION.maluku, 'REGENCY_CITY'));
  selected = choose(selected, pick(REGION.jayapura, 'Kota Jayapura', REGION.papua, 'REGENCY_CITY'));
  assert.deepEqual(intakeLocationRegionIds(selected), [REGION.ambon, REGION.jayapura]);
  const other = setIntakeCountry(selected, { id: REGION.lain, name: 'Negara Lain' });
  assert.deepEqual(other.picks, []);
  assert.deepEqual(intakeLocationRegionIds(other), [REGION.lain]);
});

test('kecamatan and desa from different selected parents stay with their own parents', () => {
  let selected = choose(indonesia(), pick(REGION.maluku, 'Maluku', REGION.indonesia, 'PROVINCE'));
  selected = choose(selected, pick(REGION.ambon, 'Kota Ambon', REGION.maluku, 'REGENCY_CITY'));
  selected = choose(selected, pick(REGION.tual, 'Kota Tual', REGION.maluku, 'REGENCY_CITY'));
  selected = choose(selected, pick(REGION.sirimau, 'Sirimau', REGION.ambon, 'DISTRICT'));
  selected = choose(selected, pick(REGION.nusaniwe, 'Nusaniwe', REGION.tual, 'DISTRICT'));
  assert.deepEqual(intakeLocationRegionIds(selected), [REGION.sirimau, REGION.nusaniwe]);
  selected = choose(selected, pick(REGION.desaA, 'Desa A', REGION.sirimau, 'VILLAGE'));
  selected = choose(selected, pick(REGION.desaB, 'Desa B', REGION.nusaniwe, 'VILLAGE'));
  assert.deepEqual(intakeLocationRegionIds(selected), [REGION.desaA, REGION.desaB]);
  assert.equal(intakeLocationRegionIds(selected).includes(REGION.sirimau), false);
});

test('SEMUA resolves only the verified parent scope and refuses a partial page', () => {
  const province = choose(
    indonesia(),
    pick(REGION.maluku, 'Maluku', REGION.indonesia, 'PROVINCE'),
  );
  const refused = selectAllIntakeRegions(province, 'REGENCY_CITY', {
    items: [pick(REGION.ambon, 'Kota Ambon', REGION.maluku, 'REGENCY_CITY')],
    complete: false,
  });
  assert.equal(refused.selection, province);
  assert.match(refused.refused ?? '', /belum selesai dimuat/);
  const semua = selectAllIntakeRegions(province, 'REGENCY_CITY', {
    items: [
      pick(REGION.ambon, 'Kota Ambon', REGION.maluku, 'REGENCY_CITY'),
      pick(REGION.ambon, 'Kota Ambon', REGION.maluku, 'REGENCY_CITY'),
      pick(REGION.tual, 'Kota Tual', REGION.maluku, 'REGENCY_CITY'),
      pick(REGION.jayapura, 'Kota Jayapura', REGION.papua, 'REGENCY_CITY'),
      pick('SEMUA', 'SEMUA', REGION.maluku, 'REGENCY_CITY'),
    ],
    complete: true,
  });
  assert.equal(semua.refused, null);
  assert.deepEqual(intakeLocationRegionIds(semua.selection), [REGION.ambon, REGION.tual]);
  const districts = selectAllIntakeRegions(semua.selection, 'DISTRICT', {
    items: [
      pick(REGION.sirimau, 'Sirimau', REGION.ambon, 'DISTRICT'),
      pick(REGION.nusaniwe, 'Nusaniwe', REGION.tual, 'DISTRICT'),
    ],
    complete: true,
  });
  assert.deepEqual(intakeLocationRegionIds(districts.selection), [REGION.sirimau, REGION.nusaniwe]);
  const villages = selectAllIntakeRegions(districts.selection, 'VILLAGE', {
    items: [
      pick(REGION.desaA, 'Desa A', REGION.sirimau, 'VILLAGE'),
      pick(REGION.desaB, 'Desa B', REGION.nusaniwe, 'VILLAGE'),
    ],
    complete: true,
  });
  assert.deepEqual(intakeLocationRegionIds(villages.selection), [REGION.desaA, REGION.desaB]);
  const page = acceptIntakeRegionPage(
    { items: [], pages: INTAKE_REGION_PAGE_LIMIT - 1 },
    {
      items: [pick(REGION.ambon, 'Kota Ambon', REGION.maluku, 'REGENCY_CITY')],
      hasNext: true,
    },
  );
  assert.equal(page.truncated, true);
  assert.deepEqual(page.items, []);
});

test('removing one parent prunes only that branch and never repeats a region id', () => {
  let selected = choose(indonesia(), pick(REGION.maluku, 'Maluku', REGION.indonesia, 'PROVINCE'));
  selected = choose(selected, pick(REGION.papua, 'Papua', REGION.indonesia, 'PROVINCE'));
  selected = choose(selected, pick(REGION.ambon, 'Kota Ambon', REGION.maluku, 'REGENCY_CITY'));
  selected = choose(selected, pick(REGION.jayapura, 'Kota Jayapura', REGION.papua, 'REGENCY_CITY'));
  selected = choose(selected, pick(REGION.sirimau, 'Sirimau', REGION.ambon, 'DISTRICT'));
  selected = choose(selected, pick(REGION.maluku, 'Maluku', REGION.indonesia, 'PROVINCE'));
  assert.deepEqual(intakeLocationRegionIds(selected), [REGION.jayapura]);
  const cleared = clearIntakeLevel(selected, 'REGENCY_CITY');
  assert.deepEqual(intakeLocationRegionIds(cleared), [REGION.papua]);
  const ids = intakeLocationRegionIds(selected);
  assert.equal(new Set(ids).size, ids.length);
});

test('the idle save action names one draft save and an uncertain result stays closed', () => {
  assert.equal(
    projectCreateView(PROJECT_CREATE_NOT_ATTEMPTED).primaryLabel,
    'Simpan Draft & Lanjut ke Ruang Kerja RAB',
  );
  assert.equal(projectCreateView(PROJECT_CREATE_NOT_ATTEMPTED).primaryDisabled, false);
  const uncertain = projectCreateUncertain();
  assert.equal(projectCreateRequest(uncertain), 'none');
  assert.equal(beginProjectCreate(uncertain), uncertain);
  assert.equal(projectCreateView(uncertain).primaryDisabled, true);
});

test('changing a region parent clears stale descendants and adds only the deepest real selection', () => {
  const country = {
    id: 'country-1',
    code: 'ID',
    name: 'Indonesia',
    administrativeLevel: 'COUNTRY' as const,
    parentId: null,
  };
  const province = {
    id: 'province-1',
    code: 'MLK',
    name: 'Maluku',
    administrativeLevel: 'PROVINCE' as const,
    parentId: 'country-1',
  };
  const stale = setRegionHierarchyLevel(
    setRegionHierarchyLevel(emptyRegionHierarchy(), 'COUNTRY', country),
    'PROVINCE',
    province,
  );
  const nextCountry = setRegionHierarchyLevel(stale, 'COUNTRY', {
    ...country,
    id: 'country-2',
    name: 'Negara Lain',
  });
  assert.equal(nextCountry.PROVINCE, null);
  assert.deepEqual(deepestSelectedRegion(stale), province);
  assert.equal(
    deepestSelectedRegion(emptyRegionHierarchy()),
    null,
  );
});

test('canonical readback must match the submitted ids before success is trusted', () => {
  const submitted = {
    classificationNodeIds: ['root-1', 'kat-1', 'sub-1'],
    locationRegionIds: ['ambon', 'jayapura'],
  };
  assert.equal(
    intakeContextMatches({
      ...submitted,
      classificationSelections: submitted.classificationNodeIds.map((id) => ({
        id,
      })),
      locationSelections: submitted.locationRegionIds.map((id) => ({ id })),
    }),
    true,
  );
  assert.equal(
    intakeContextMatches({
      ...submitted,
      classificationSelections: [
        { id: 'sub-1' },
        { id: 'root-1' },
        { id: 'kat-1' },
      ],
      locationSelections: [{ id: 'jayapura' }, { id: 'ambon' }],
    }),
    true,
  );
  assert.equal(
    intakeContextMatches({
      ...submitted,
      classificationSelections: [{ id: 'root-1' }],
      locationSelections: [{ id: 'ambon' }, { id: 'jayapura' }],
    }),
    false,
  );
});

const submittedContext = {
  projectId: 'project-1',
  classificationNodeIds: ['root-1', 'kat-1', 'sub-1'],
  locationRegionIds: ['ambon', 'jayapura'],
};

test('matching readback navigates once and a second submit does not create again', () => {
  const created = projectCreated(submittedContext);
  const verified = projectReadbackOutcome({
    context: submittedContext,
    httpStatus: 200,
    matches: true,
  });
  assert.equal(verified.phase, 'verified');
  assert.equal(
    projectCreateView(verified).navigateTo,
    '/project/project-1/rab/workspace',
  );
  assert.equal(projectCreateRequest(created), 'none');
  assert.equal(projectCreateRequest(verified), 'none');
  assert.equal(beginProjectCreate(verified), verified);
});

test('readback 403 keeps the project unverified and retries the read only', () => {
  const outcome = projectReadbackOutcome({
    context: submittedContext,
    httpStatus: 403,
    matches: false,
  });
  assert.equal(outcome.phase, 'unverified');
  if (outcome.phase !== 'unverified') return;
  assert.equal(outcome.reason, 'unauthorized');
  assert.equal(outcome.projectId, 'project-1');
  assert.equal(outcome.message, PROJECT_CREATE_UNAUTHORIZED_READBACK_MESSAGE);
  assert.equal(projectCreateView(outcome).navigateTo, null);
  assert.equal(projectCreateRequest(outcome), 'get');
  assert.equal(beginProjectCreate(outcome), outcome);
});

test('readback 500 or a lost response retries the read without another create', () => {
  for (const httpStatus of [500, null]) {
    const outcome = projectReadbackOutcome({
      context: submittedContext,
      httpStatus,
      matches: false,
    });
    assert.equal(outcome.phase, 'unverified');
    if (outcome.phase !== 'unverified') continue;
    assert.equal(outcome.reason, 'unavailable');
    assert.equal(outcome.projectId, 'project-1');
    assert.equal(projectCreateRequest(outcome), 'get');
    assert.equal(projectCreateView(outcome).navigateTo, null);
  }
});

test('a mismatched readback fails closed and preserves the project id', () => {
  const outcome = projectReadbackOutcome({
    context: submittedContext,
    httpStatus: 200,
    matches: false,
  });
  assert.equal(outcome.phase, 'unverified');
  if (outcome.phase !== 'unverified') return;
  assert.equal(outcome.reason, 'mismatch');
  assert.deepEqual(outcome.classificationNodeIds, submittedContext.classificationNodeIds);
  assert.deepEqual(outcome.locationRegionIds, submittedContext.locationRegionIds);
  assert.equal(projectCreateView(outcome).navigateTo, null);
  assert.equal(projectCreateRequest(outcome), 'get');
});

test('an inconclusive POST status does not permit another create', () => {
  for (const status of [500, 502, 503, 504, 408, 429]) {
    const disposition = projectCreateHttpDisposition(status);
    const outcome =
      disposition === 'rejected'
        ? projectCreateRejected('should not be used')
        : projectCreateUncertain();
    assert.equal(disposition, 'uncertain');
    assert.equal(outcome.phase, 'uncertain');
    assert.equal(projectCreateRequest(outcome), 'none');
    assert.equal(beginProjectCreate(outcome), outcome);
    assert.equal(projectCreateView(outcome).primaryDisabled, true);
  }
});

test('a confirmed validation or authorization rejection stays correctable', () => {
  for (const status of [400, 401, 403, 409]) {
    assert.equal(projectCreateHttpDisposition(status), 'rejected');
  }
  const rejected = projectCreateRejected('Kode proyek sudah dipakai di workspace ini.');
  assert.equal(projectCreateRequest(rejected), 'post');
  assert.equal(beginProjectCreate(rejected).phase, 'in_progress');
});

test('an uncertain create is not repeated, while a rejected create can be corrected', () => {
  const uncertain = projectCreateUncertain();
  assert.equal(projectCreateRequest(uncertain), 'none');
  assert.equal(beginProjectCreate(uncertain), uncertain);
  assert.equal(projectCreateView(uncertain).primaryDisabled, true);

  const rejected = projectCreateRejected('Pagu Anggaran tidak valid.');
  assert.equal(projectCreateRequest(rejected), 'post');
  assert.equal(beginProjectCreate(rejected).phase, 'in_progress');
  assert.equal(projectCreateView(rejected).error, 'Pagu Anggaran tidak valid.');
});

test('a readback retry keeps the same project and does not reopen creation', () => {
  const failed = projectReadbackOutcome({
    context: submittedContext,
    httpStatus: 500,
    matches: false,
  });
  assert.equal(failed.phase, 'unverified');
  if (failed.phase !== 'unverified') return;
  const retry = projectCreated(failed);
  assert.equal(retry.phase, 'readback_pending');
  if (retry.phase !== 'readback_pending') return;
  assert.equal(retry.projectId, 'project-1');
  assert.equal(projectCreateRequest(retry), 'none');
});

test('a second submit while creation is pending does not start another create', () => {
  const pending = beginProjectCreate(PROJECT_CREATE_NOT_ATTEMPTED);
  assert.equal(pending.phase, 'in_progress');
  assert.equal(projectCreateRequest(pending), 'none');
  assert.equal(beginProjectCreate(pending), pending);
});

test('field context is kept as a description and is not called understanding', () => {
  const empty = fieldContextAcknowledgement('   ');
  assert.equal(empty.descriptiveContext, null);
  assert.match(empty.status, /Engine belum aktif/);
  assert.doesNotMatch(empty.status, /dipahami|rekomendasi|disetujui/);

  const held = fieldContextAcknowledgement('  akses material sempit  ');
  assert.equal(held.descriptiveContext, 'akses material sempit');
  assert.match(held.status, /keterangan proyek/);
  assert.match(held.status, /belum dipahami/);
  assert.match(held.status, /Engine belum aktif/);
  assert.doesNotMatch(held.status, /rekomendasi|disetujui/);
});

test('saved field context round-trips through the project description without rewriting the words', () => {
  const narrative = 'akses material sempit\nKonteks Lapangan: jangan dipotong\nNama Proyek: ini bagian kalimat';
  const description = composeDraftDescription({
    address: 'Jl. Pattimura',
    fieldContext: narrative,
    preparationLines: ['Nama Proyek: Jalan Lingkungan', 'Pemilik / Instansi: Belum diisi'],
  });
  const read = readSavedFieldContext(description);
  assert.equal(read.state, 'present');
  if (read.state !== 'present') return;
  assert.equal(read.text, narrative);
  assert.match(description, /Alamat Detail: Jl\. Pattimura/);
  assert.match(description, /Nama Proyek: Jalan Lingkungan/);

  assert.deepEqual(readSavedFieldContext(composeDraftDescription({
    address: null,
    fieldContext: null,
    preparationLines: ['Nama Proyek: Jalan'],
  })), { state: 'absent' });
  assert.deepEqual(readSavedFieldContext(''), { state: 'absent' });
  assert.deepEqual(readSavedFieldContext(null), { state: 'absent' });
  assert.deepEqual(readSavedFieldContext(12), { state: 'unreadable' });
  assert.deepEqual(readSavedFieldContext('Konteks Lapangan: tanpa penanda baris'), { state: 'absent' });
});

test('project field context read states stay honest', () => {
  const narrative = 'curah hujan tinggi';
  const description = composeDraftDescription({
    address: null,
    fieldContext: narrative,
    preparationLines: [],
  });
  const present = projectFieldContextView({
    projectId: 'project-1',
    httpStatus: 200,
    description,
    failed: false,
  });
  assert.equal(present.kind, 'present');
  if (present.kind !== 'present') return;
  assert.equal(present.text, narrative);
  assert.match(present.message, /belum diverifikasi/);
  assert.doesNotMatch(present.message, /dipahami|rekomendasi|disetujui/);

  assert.equal(projectFieldContextView({
    projectId: 'project-1',
    httpStatus: 403,
    description: null,
    failed: false,
  }).kind, 'unauthorized');
  assert.equal(projectFieldContextView({
    projectId: 'project-1',
    httpStatus: 500,
    description: null,
    failed: false,
  }).kind, 'unavailable');
  assert.equal(projectFieldContextView({
    projectId: 'project-1',
    httpStatus: null,
    description: null,
    failed: true,
  }).kind, 'unavailable');
  assert.equal(projectFieldContextView({
    projectId: null,
    httpStatus: 200,
    description,
    failed: false,
  }).kind, 'absent');
  const missing = projectFieldContextView({
    projectId: 'project-1',
    httpStatus: 200,
    description: 'Draft tanpa keterangan lapangan',
    failed: false,
  });
  assert.equal(missing.kind, 'absent');
  if (missing.kind !== 'absent') return;
  assert.match(missing.message, /Belum ada keterangan lapangan/);
});

test('Ruang Persiapan uses the canonical intake doors and no competing taxonomy', () => {
  const page = readFileSync(
    new URL('../pages/ProjectSetupPage.tsx', import.meta.url),
    'utf8',
  );
  const classification = readFileSync(
    new URL(
      '../components/project/ProjectIntakeClassificationFields.tsx',
      import.meta.url,
    ),
    'utf8',
  );
  const location = readFileSync(
    new URL(
      '../components/project/ProjectIntakeLocationFields.tsx',
      import.meta.url,
    ),
    'utf8',
  );
  const setup = page;
  assert.doesNotMatch(setup, /LegacyRabWorkspacePage|localhost:3000/);
  const selection = readFileSync(
    new URL('./projectIntakeSelection.ts', import.meta.url),
    'utf8',
  );
  const wiring = `${setup}\n${classification}\n${location}\n${selection}`;
  assert.match(classification, /\/project-intake\/classification\/roots/);
  assert.match(location, /projectIntakeRegionQuery/);
  assert.match(location, /intakeLocationRegionIds/);
  assert.match(location, /selectAllIntakeRegions/);
  assert.doesNotMatch(location, /Tambah lokasi/);
  assert.doesNotMatch(location, /projectIntakeLocationIds/);
  assert.match(setup, /role="tooltip"/);
  assert.match(setup, /Jika kosong, SIMPROK membuat kode draft unik\./);
  assert.match(setup, /placeholder="Isi kode jika tersedia"/);
  assert.doesNotMatch(setup, /<small id="project-code-draft-note"/);
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
  assert.match(css, /\.simprok-rab-code-help:hover \.simprok-rab-code-help__tip/);
  assert.match(css, /\.simprok-rab-code-help:focus-within \.simprok-rab-code-help__tip/);
  assert.match(selection, /\/project-intake\/regions/);
  assert.match(setup, /classificationNodeIds/);
  assert.match(setup, /locationRegionIds/);
  // First project save moved from Persiapan to the new RAB workspace.
  // Opening the room is local-only and must not write a Project to the server.
  assert.match(setup, /navigate\('\/project\/new\/rab\/workspace'/);
  assert.doesNotMatch(setup, /apiFetch\('\/projects'/);
  assert.doesNotMatch(setup, /Simpan Draft & Lanjut ke Ruang Kerja RAB/);
  assert.match(setup, /classificationNodeIds: selectedClassificationIds/);
  assert.match(setup, /locationRegionIds: selectedLocationRegionIds/);
  assert.match(setup, /fieldContextAcknowledgement/);
  assert.match(setup, /composeDraftDescription/);
  assert.match(setup, /Tahan keterangan/);
  assert.doesNotMatch(setup, /Kirim Konteks/);
  assert.match(setup, /Engine belum aktif/);
  assert.doesNotMatch(setup, /rab-intelligence\/proposals/);
  const workspace = readFileSync(
    new URL('../pages/RabWorkspacePage.tsx', import.meta.url),
    'utf8',
  );
  assert.match(workspace, /apiFetch\(`\/projects\/\$\{projectId\}`, \{ signal: controller\.signal \}\)/);
  assert.match(workspace, /projectFieldContextView/);
  assert.match(workspace, /Memuat keterangan proyek/);
  assert.doesNotMatch(workspace, /rab-intelligence\/proposals/);
  assert.doesNotMatch(wiring, /Bidang Bina Marga/);
  assert.doesNotMatch(wiring, /JENIS_PENGADAAN_OPTIONS/);
  assert.doesNotMatch(wiring, /JENIS_PEKERJAAN/);
});
