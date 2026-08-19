import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';

export interface IntakeStoragePort {
  writeTemp(bytes: Buffer): Promise<string>;
  computeChecksum(bytes: Buffer): string;
  moveToFinal(tempPath: string, safeKey: string): Promise<string>;
  resolveFinalPath(safeKey: string): string;
  readFinal(storageRef: string): Promise<Buffer>;
  deleteTemp(tempPath: string | null): Promise<void>;
  deleteFinal(storageRef: string | null): Promise<void>;
}

/**
 * USI-01R2 §8 — WHERE RETAINED SOURCE BYTES ACTUALLY LIVE.
 *
 * The default root is derived from `process.cwd()`, which is fine for tests and
 * local development and NOT fine for live operation: the working directory of a
 * deployed process is incidental, and a build or redeploy that replaces the tree
 * would take every retained source artifact with it. A `storageRef` that stops
 * resolving after a restart is worse than no evidence at all, because the batch
 * still claims the bytes exist.
 *
 * So live operation must SAY where they go. `INTAKE_STORAGE_DIR` is the existing
 * mechanism; this only makes it mandatory outside test/development rather than
 * inventing a new one.
 */
export const INTAKE_STORAGE_DIR_ENV = 'INTAKE_STORAGE_DIR';
export const INTAKE_STORAGE_DIR_REQUIRED =
  'INTAKE_STORAGE_DIR_REQUIRED_IN_PRODUCTION';

export function resolveIntakeStorageRoot(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = env[INTAKE_STORAGE_DIR_ENV];
  if (configured && configured.trim() !== '') return configured;

  // Fail closed in production rather than silently retaining evidence inside a
  // disposable directory.
  if (env.NODE_ENV === 'production') throw new Error(INTAKE_STORAGE_DIR_REQUIRED);

  return path.join(process.cwd(), 'storage', 'reality-intake');
}

@Injectable()
export class StorageService implements IntakeStoragePort {
  private readonly rootDir = resolveIntakeStorageRoot();

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

  /**
   * The absolute path a `safeKey` resolves to. Pure path arithmetic, no I/O —
   * a caller that lost a rename race needs to name the winner's file without
   * having been the one to create it.
   */
  resolveFinalPath(safeKey: string): string {
    const normalizedSafeKey = safeKey
      .split('/')
      .filter((segment) => segment.length > 0)
      .join(path.sep);
    return path.join(this.rootDir, normalizedSafeKey);
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
