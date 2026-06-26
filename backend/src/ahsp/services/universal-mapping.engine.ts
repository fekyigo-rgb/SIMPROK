import { Injectable } from '@nestjs/common';

export interface MappingResult {
  sourceColumn: string;
  targetField: string;
  confidenceScore: number; // 0 to 100
}

@Injectable()
export class UniversalMappingEngine {
  private readonly dictionary = {
    resourceCode: ['KodeSumberDaya', 'KodeBahan', 'Kode', 'ResourceID'],
    coefficient: ['Koefisien', 'Kuantitas', 'Qty', 'Jumlah'],
    price: ['HargaSatuan', 'Harga', 'Price'],
  };

  /**
   * Maps discovered headers to Prisma fields.
   */
  mapHeaders(discoveredHeaders: string[]): MappingResult[] {
    // Boilerplate for future implementation
    return [];
  }
}
