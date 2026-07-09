import {
  canonicalResourceName,
  cekKecocokanDomain,
  klasifikasiResource,
  normalisasiSatuan,
  type ResourceKategori,
  type WorkDomain,
} from '../simprokKamus';

export type MappingStatus = 'NOT_MATCHED' | 'MANUAL_LINKED';
export type MatchSource = 'NONE' | 'HUMAN_SELECTED';
export type ResolveStatus = 'RESOLVED' | 'UNRESOLVED';
export type ResultStatus = 'READY' | 'INCOMPLETE';

export interface BasicPriceItemPreview {
  code: string;
  name: string;
  type: string;
  unit: string;
  price: number;
}

export interface AhspComponentPreview {
  resourceName: string;
  resourceType: string;
  coefficient: number;
  baseUnit: string;
}

export interface AhspItemPreview {
  code: string;
  name: string;
  unit: string;
  components: AhspComponentPreview[];
}

export interface BoqItemPreview {
  wbsCode: string;
  name: string;
  unit: string;
  quantity: number;
}

export interface ResolvedComponent {
  resourceName: string;
  canonicalName: string;
  kategori: ResourceKategori | null;
  coefficient: number;
  baseUnit: string;
  canonicalUnit: string | null;
  basicPriceCode: string;
  basicPriceName: string;
  basicPriceUnit: string;
  basicPriceCanonicalUnit: string;
  price: number;
  lineTotal: number;
  resolveStatus: 'RESOLVED';
  resolveReason: string;
}

export interface UnresolvedComponent {
  resourceName: string;
  canonicalName: string;
  kategori: ResourceKategori | null;
  coefficient: number;
  baseUnit: string;
  canonicalUnit: string | null;
  basicPriceCode?: string;
  basicPriceName?: string;
  basicPriceUnit?: string;
  basicPriceCanonicalUnit?: string | null;
  resolveStatus: 'UNRESOLVED';
  resolveReason: string;
}

export interface RabRowResult {
  boqKey: string;
  ahspCode?: string;
  boqDomain: WorkDomain | null;
  ahspDomain: WorkDomain | null;
  domainCompatible: boolean;
  domainReason: string;
  mappingStatus: MappingStatus;
  matchSource: MatchSource;
  resultStatus: ResultStatus;
  hargaSatuan: number | null;
  jumlah: number | null;
  resolvedComponents: ResolvedComponent[];
  unresolvedComponents: UnresolvedComponent[];
  unresolvedReasons: string[];
  jejak: string[];
}

const toKategori = (name: string, rawType?: string): ResourceKategori | null => {
  const fromKamus = klasifikasiResource(name);
  if (fromKamus) return fromKamus;
  if (rawType === 'LABOR' || rawType === 'MATERIAL' || rawType === 'EQUIPMENT') return rawType;
  return null;
};

const formatRupiah = (value: number) => `Rp${Math.round(value).toLocaleString('id-ID')}`;

export function resolveUnitPrice(params: {
  boqItem: BoqItemPreview;
  ahspItem?: AhspItemPreview | null;
  basicPrices: BasicPriceItemPreview[];
}): RabRowResult {
  const { boqItem, ahspItem, basicPrices } = params;
  const boqKey = `${boqItem.wbsCode}-${boqItem.name}`;

  if (!ahspItem) {
    return {
      boqKey,
      boqDomain: null,
      ahspDomain: null,
      domainCompatible: false,
      domainReason: 'Menunggu pilihan AHSP dari manusia.',
      mappingStatus: 'NOT_MATCHED',
      matchSource: 'NONE',
      resultStatus: 'INCOMPLETE',
      hargaSatuan: null,
      jumlah: null,
      resolvedComponents: [],
      unresolvedComponents: [],
      unresolvedReasons: ['Menunggu pilihan AHSP dari manusia.'],
      jejak: ['NOT_MATCHED: Menunggu pilihan AHSP. Harga Satuan belum dihitung.'],
    };
  }

  const resolvedComponents: ResolvedComponent[] = [];
  const unresolvedComponents: UnresolvedComponent[] = [];
  const domainCheck = cekKecocokanDomain(boqItem.name, ahspItem.name);
  const jejak = [
    'AHSP dipilih manual oleh manusia dari daftar preview.',
    `BOQ ${boqItem.name} diklasifikasi sebagai ${domainCheck.boqDomain}.`,
    `AHSP ${ahspItem.name} diklasifikasi sebagai ${domainCheck.ahspDomain}.`,
  ];

  if (!domainCheck.compatible) {
    const domainReason =
      domainCheck.reason.startsWith('DOMAIN_MISMATCH')
        ? domainCheck.reason
        : `DOMAIN_MISMATCH: ${domainCheck.reason}`;

    return {
      boqKey,
      ahspCode: ahspItem.code,
      boqDomain: domainCheck.boqDomain,
      ahspDomain: domainCheck.ahspDomain,
      domainCompatible: false,
      domainReason,
      mappingStatus: 'MANUAL_LINKED',
      matchSource: 'HUMAN_SELECTED',
      resultStatus: 'INCOMPLETE',
      hargaSatuan: null,
      jumlah: null,
      resolvedComponents: [],
      unresolvedComponents: [],
      unresolvedReasons: [domainReason],
      jejak: [
        ...jejak,
        'AHSP dipilih manual oleh manusia, tetapi domain pekerjaan tidak cocok.',
        'Harga Satuan dan Jumlah tidak dihitung karena domain mismatch.',
      ],
    };
  }

  ahspItem.components.forEach((component) => {
    const kategori = toKategori(component.resourceName, component.resourceType);
    const canonicalName = canonicalResourceName(component.resourceName);
    const canonicalUnit = normalisasiSatuan(component.baseUnit, { kategori });
    const matchingNamePrices = basicPrices.filter(
      (basicPrice) => canonicalResourceName(basicPrice.name) === canonicalName,
    );

    if (matchingNamePrices.length === 0) {
      const resolveReason = `${component.resourceName} belum ditemukan di Basic Price.`;
      unresolvedComponents.push({
        resourceName: component.resourceName,
        canonicalName,
        kategori,
        coefficient: component.coefficient,
        baseUnit: component.baseUnit,
        canonicalUnit,
        resolveStatus: 'UNRESOLVED',
        resolveReason,
      });
      jejak.push(resolveReason);
      return;
    }

    const candidates = matchingNamePrices.map((basicPrice) => {
      const basicKategori = toKategori(basicPrice.name, basicPrice.type);
      return {
        basicPrice,
        canonicalUnit: normalisasiSatuan(basicPrice.unit, { kategori: basicKategori }),
      };
    });

    const unitMatch = candidates.find(
      (candidate) => canonicalUnit !== null && candidate.canonicalUnit === canonicalUnit,
    );

    if (!canonicalUnit || candidates.some((candidate) => candidate.canonicalUnit === null)) {
      const firstCandidate = candidates[0];
      const resolveReason = `Satuan perlu konfirmasi manusia: AHSP ${component.baseUnit}, Basic Price ${firstCandidate.basicPrice.unit}.`;
      unresolvedComponents.push({
        resourceName: component.resourceName,
        canonicalName,
        kategori,
        coefficient: component.coefficient,
        baseUnit: component.baseUnit,
        canonicalUnit,
        basicPriceCode: firstCandidate.basicPrice.code,
        basicPriceName: firstCandidate.basicPrice.name,
        basicPriceUnit: firstCandidate.basicPrice.unit,
        basicPriceCanonicalUnit: firstCandidate.canonicalUnit,
        resolveStatus: 'UNRESOLVED',
        resolveReason,
      });
      jejak.push(resolveReason);
      return;
    }

    if (!unitMatch) {
      const firstCandidate = candidates[0];
      const resolveReason = `Satuan belum cocok: AHSP ${component.baseUnit} = ${canonicalUnit}, Basic Price ${firstCandidate.basicPrice.unit} = ${firstCandidate.canonicalUnit ?? 'PERLU KONFIRMASI'}.`;
      unresolvedComponents.push({
        resourceName: component.resourceName,
        canonicalName,
        kategori,
        coefficient: component.coefficient,
        baseUnit: component.baseUnit,
        canonicalUnit,
        basicPriceCode: firstCandidate.basicPrice.code,
        basicPriceName: firstCandidate.basicPrice.name,
        basicPriceUnit: firstCandidate.basicPrice.unit,
        basicPriceCanonicalUnit: firstCandidate.canonicalUnit,
        resolveStatus: 'UNRESOLVED',
        resolveReason,
      });
      jejak.push(`${component.resourceName} belum resolved karena satuan AHSP ${component.baseUnit} dan Basic Price ${firstCandidate.basicPrice.unit} belum cocok secara kanonik.`);
      return;
    }

    const lineTotal = component.coefficient * unitMatch.basicPrice.price;
    resolvedComponents.push({
      resourceName: component.resourceName,
      canonicalName,
      kategori,
      coefficient: component.coefficient,
      baseUnit: component.baseUnit,
      canonicalUnit,
      basicPriceCode: unitMatch.basicPrice.code,
      basicPriceName: unitMatch.basicPrice.name,
      basicPriceUnit: unitMatch.basicPrice.unit,
      basicPriceCanonicalUnit: canonicalUnit,
      price: unitMatch.basicPrice.price,
      lineTotal,
      resolveStatus: 'RESOLVED',
      resolveReason: 'Nama/canonical dan satuan kanonik cocok.',
    });
    jejak.push(`${component.resourceName}: ${component.coefficient} x ${formatRupiah(unitMatch.basicPrice.price)} (${component.baseUnit} -> ${canonicalUnit})`);
  });

  if (unresolvedComponents.length > 0) {
    return {
      boqKey,
      ahspCode: ahspItem.code,
      boqDomain: domainCheck.boqDomain,
      ahspDomain: domainCheck.ahspDomain,
      domainCompatible: true,
      domainReason: domainCheck.reason,
      mappingStatus: 'MANUAL_LINKED',
      matchSource: 'HUMAN_SELECTED',
      resultStatus: 'INCOMPLETE',
      hargaSatuan: null,
      jumlah: null,
      resolvedComponents,
      unresolvedComponents,
      unresolvedReasons: unresolvedComponents.map((component) => component.resolveReason),
      jejak: [...jejak, 'Harga Satuan belum dihitung karena masih ada resource UNRESOLVED.'],
    };
  }

  const hargaSatuan = resolvedComponents.reduce((total, component) => total + component.lineTotal, 0);
  const jumlah = hargaSatuan * boqItem.quantity;

  return {
    boqKey,
    ahspCode: ahspItem.code,
    boqDomain: domainCheck.boqDomain,
    ahspDomain: domainCheck.ahspDomain,
    domainCompatible: true,
    domainReason: domainCheck.reason,
    mappingStatus: 'MANUAL_LINKED',
    matchSource: 'HUMAN_SELECTED',
    resultStatus: 'READY',
    hargaSatuan,
    jumlah,
    resolvedComponents,
    unresolvedComponents,
    unresolvedReasons: [],
    jejak: [
      ...jejak,
      'Harga Satuan = jumlah seluruh koefisien x harga Basic Price.',
      `Jumlah = Harga Satuan x Volume BOQ (${boqItem.quantity}).`,
    ],
  };
}
