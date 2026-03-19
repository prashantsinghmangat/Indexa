import * as fs from 'fs';
import * as path from 'path';
import { FileMetadata } from '../types';
import { ensureDir, logger, atomicWriteJSON } from '../utils';

/**
 * File metadata store for tracking indexed files and change detection.
 * Uses atomic JSON writes for persistence.
 */
export class MetadataDB {
  private files: Map<string, FileMetadata> = new Map();
  private filePath: string;
  private dirty: boolean = false;

  constructor(dataDir: string) {
    ensureDir(dataDir);
    this.filePath = path.join(dataDir, 'metadata.json');
    this.load();
  }

  /** Get metadata for a file */
  getFile(filePath: string): FileMetadata | undefined {
    return this.files.get(filePath);
  }

  /** Set metadata for a file */
  setFile(filePath: string, metadata: FileMetadata): void {
    this.files.set(filePath, metadata);
    this.dirty = true;
  }

  /** Remove metadata for a file */
  removeFile(filePath: string): boolean {
    const deleted = this.files.delete(filePath);
    if (deleted) this.dirty = true;
    return deleted;
  }

  /** Get all tracked file paths */
  getAllFiles(): string[] {
    return Array.from(this.files.keys());
  }

  /** Get all metadata entries */
  getAll(): FileMetadata[] {
    return Array.from(this.files.values());
  }

  /** Get total number of tracked files */
  get size(): number {
    return this.files.size;
  }

  /** Persist to disk using atomic write */
  save(): void {
    if (!this.dirty && fs.existsSync(this.filePath)) return;
    const data = Object.fromEntries(this.files);
    atomicWriteJSON(this.filePath, data);
    this.dirty = false;
    logger.debug(`Saved metadata for ${this.files.size} files to ${this.filePath}`);
  }

  /** Load from disk */
  private load(): void {
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const data: Record<string, FileMetadata> = JSON.parse(raw);
        for (const [key, value] of Object.entries(data)) {
          this.files.set(key, value);
        }
        logger.info(`Loaded metadata for ${this.files.size} files from ${this.filePath}`);
      } catch (err) {
        logger.warn(`Failed to load metadata DB: ${err}`);
      }
    }
  }

  /** Clear all data */
  clear(): void {
    this.files.clear();
    this.dirty = true;
    this.save();
  }
}
