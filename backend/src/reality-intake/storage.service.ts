import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';

export interface IntakeStoragePort {
  writeTemp(bytes: Buffer): Promise<string>;
  computeChecksum(bytes: Buffer): string;
  moveToFinal(tempPath: string, safeKey: string): Promise<string>;
  readFinal(storageRef: string): Promise<Buffer>;
  deleteTemp(tempPath: string | null): Promise<void>;
  deleteFinal(storageRef: string | null): Promise<void>;
}

@Injectable()
export class StorageService implements IntakeStoragePort {
  private readonly rootDir =
    process.env.INTAKE_STORAGE_DIR ||
    path.join(process.cwd(), 'storage', 'reality-intake');

  async writeTemp(bytes: Buffer): Promise<string> {
    const tempDir = path.join(this.rootDir, 'tmp');
    await fs.mkdir(tempDir, { recursive: true });

    const tempPath = path.join(tempDir, `${randomUUID()}.tmp`);
    await fs.writeFile(tempPath, bytes);
    return tempPath;
  }

  computeChecksum(bytes: Buffer): string {
    return createHash('sha256').update(bytes).digest('hex');
  }

  async moveToFinal(tempPath: string, safeKey: string): Promise<string> {
    const normalizedSafeKey = safeKey
      .split('/')
      .filter((segment) => segment.length > 0)
      .join(path.sep);
    const finalPath = path.join(this.rootDir, normalizedSafeKey);

    await fs.mkdir(path.dirname(finalPath), { recursive: true });
    await fs.rename(tempPath, finalPath);
    return finalPath;
  }

  async readFinal(storageRef: string): Promise<Buffer> {
    return fs.readFile(storageRef);
  }

  async deleteTemp(tempPath: string | null): Promise<void> {
    await this.deleteFileIfExists(tempPath);
  }

  async deleteFinal(storageRef: string | null): Promise<void> {
    await this.deleteFileIfExists(storageRef);
  }

  private async deleteFileIfExists(filePath: string | null): Promise<void> {
    if (!filePath) {
      return;
    }

    try {
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
}
