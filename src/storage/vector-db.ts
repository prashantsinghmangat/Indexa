import * as fs from 'fs';
import * as path from 'path';
import { IndexedChunk } from '../types';
import { ensureDir, logger, atomicWriteJSON } from '../utils';

/**
 * File-based vector database.
 * Stores chunk metadata + embeddings in JSON. No inline code.
 * Code is read on demand from source files via byte offsets.
 */
export class VectorDB {
  private chunks: Map<string, IndexedChunk> = new Map();
  private filePath: string;
  private dirty: boolean = false;

  constructor(dataDir: string) {
    ensureDir(dataDir);
    this.filePath = path.join(dataDir, 'embeddings.json');
    this.load();
  }

  /** Insert or update a chunk */
  upsert(chunk: IndexedChunk): void {
    this.chunks.set(chunk.id, chunk);
    this.dirty = true;
  }

  /** Remove a chunk by ID */
  remove(id: string): boolean {
    const deleted = this.chunks.delete(id);
    if (deleted) this.dirty = true;
    return deleted;
  }

  /** Get a chunk by ID */
  get(id: string): IndexedChunk | undefined {
    return this.chunks.get(id);
  }

  /** Get all indexed chunks */
  getAll(): IndexedChunk[] {
    return Array.from(this.chunks.values());
  }

  /** Get chunks for a specific file */
  getByFile(filePath: string): IndexedChunk[] {
    const normalized = filePath.replace(/\\/g, '/');
    return this.getAll().filter(c =>
      c.filePath === normalized || c.filePath.includes(normalized)
    );
  }

  /** Find chunks by symbol name. Prefers exact match → prefix/suffix → contains. */
  findByName(name: string): IndexedChunk[] {
    const lower = name.toLowerCase();
    const all = this.getAll();

    // Tier 1: exact match (highest confidence)
    const exact = all.filter(c => c.name.toLowerCase() === lower);
    if (exact.length > 0) return exact;

    // Tier 2: starts with or ends with (e.g. "getUser" matches "getUsers")
    const prefixSuffix = all.filter(c => {
      const n = c.name.toLowerCase();
      return n.startsWith(lower) || n.endsWith(lower);
    });
    if (prefixSuffix.length > 0) return prefixSuffix;

    // Tier 3: contains (broadest, lowest confidence)
    return all.filter(c => c.name.toLowerCase().includes(lower));
  }

  /** Get all unique file paths in the index */
  getFilePaths(): string[] {
    const paths = new Set<string>();
    for (const chunk of this.chunks.values()) {
      paths.add(chunk.filePath);
    }
    return Array.from(paths);
  }

  /** Get total number of chunks */
  get size(): number {
    return this.chunks.size;
  }

  /** Persist to disk using atomic write */
  save(): void {
    if (!this.dirty && fs.existsSync(this.filePath)) return;
    const data = Array.from(this.chunks.values());
    atomicWriteJSON(this.filePath, data);
    this.dirty = false;
    logger.debug(`Saved ${data.length} chunks to ${this.filePath}`);
  }

  /** Load from disk */
  private load(): void {
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const data: IndexedChunk[] = JSON.parse(raw);
        for (const chunk of data) {
          this.chunks.set(chunk.id, chunk);
        }
        logger.info(`Loaded ${this.chunks.size} chunks from ${this.filePath}`);
      } catch (err) {
        logger.warn(`Failed to load vector DB: ${err}`);
      }
    }
  }

  /** Clear all data */
  clear(): void {
    this.chunks.clear();
    this.dirty = true;
    this.save();
  }
}
