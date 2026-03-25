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

  // Reverse indexes for O(1) lookups
  private depIndex: Map<string, Set<string>> = new Map();   // dep name (lower) → chunk IDs that depend on it
  private importIndex: Map<string, Set<string>> = new Map(); // import name (lower) → chunk IDs that import it
  private fileIndex: Map<string, Set<string>> = new Map();   // file path → chunk IDs in that file
  private reverseIndexDirty: boolean = true;

  constructor(dataDir: string) {
    ensureDir(dataDir);
    this.filePath = path.join(dataDir, 'embeddings.json');
    this.load();
  }

  /** Insert or update a chunk */
  upsert(chunk: IndexedChunk): void {
    this.chunks.set(chunk.id, chunk);
    this.dirty = true;
    this.reverseIndexDirty = true;
  }

  /** Remove a chunk by ID */
  remove(id: string): boolean {
    const deleted = this.chunks.delete(id);
    if (deleted) {
      this.dirty = true;
      this.reverseIndexDirty = true;
    }
    return deleted;
  }

  /** Build/rebuild reverse indexes for fast lookups */
  private ensureReverseIndex(): void {
    if (!this.reverseIndexDirty) return;

    this.depIndex.clear();
    this.importIndex.clear();
    this.fileIndex.clear();

    for (const chunk of this.chunks.values()) {
      // File index
      const fileSet = this.fileIndex.get(chunk.filePath) || new Set();
      fileSet.add(chunk.id);
      this.fileIndex.set(chunk.filePath, fileSet);

      // Dependency index: who depends on what
      for (const dep of chunk.dependencies) {
        const key = dep.toLowerCase();
        const set = this.depIndex.get(key) || new Set();
        set.add(chunk.id);
        this.depIndex.set(key, set);
      }

      // Import index: who imports what
      for (const imp of chunk.imports) {
        const key = imp.name.toLowerCase();
        const set = this.importIndex.get(key) || new Set();
        set.add(chunk.id);
        this.importIndex.set(key, set);
      }
    }

    this.reverseIndexDirty = false;
  }

  /** Find chunks that depend on or import a given symbol name — O(1) via reverse index */
  findDependents(symbolName: string): IndexedChunk[] {
    this.ensureReverseIndex();
    const lower = symbolName.toLowerCase();
    const ids = new Set<string>();

    // Exact match on dep index
    const depSet = this.depIndex.get(lower);
    if (depSet) for (const id of depSet) ids.add(id);

    // Exact match on import index
    const impSet = this.importIndex.get(lower);
    if (impSet) for (const id of impSet) ids.add(id);

    // Substring matches for dep index (covers partial names like "Service" matching "UserService")
    for (const [key, set] of this.depIndex) {
      if (key !== lower && (key.includes(lower) || lower.includes(key))) {
        for (const id of set) ids.add(id);
      }
    }

    return Array.from(ids).map(id => this.chunks.get(id)!).filter(Boolean);
  }

  /** Get chunks by file path — O(1) via file index */
  getByFileIndexed(filePath: string): IndexedChunk[] {
    this.ensureReverseIndex();
    const normalized = filePath.replace(/\\/g, '/');

    // Try exact match first
    const exact = this.fileIndex.get(normalized);
    if (exact) return Array.from(exact).map(id => this.chunks.get(id)!).filter(Boolean);

    // Fall back to substring match
    const results: IndexedChunk[] = [];
    for (const [fp, ids] of this.fileIndex) {
      if (fp.includes(normalized) || normalized.includes(fp)) {
        for (const id of ids) {
          const chunk = this.chunks.get(id);
          if (chunk) results.push(chunk);
        }
      }
    }
    return results;
  }

  /** Get a chunk by ID */
  get(id: string): IndexedChunk | undefined {
    return this.chunks.get(id);
  }

  /** Get all indexed chunks */
  getAll(): IndexedChunk[] {
    return Array.from(this.chunks.values());
  }

  /** Get chunks for a specific file — uses file index for fast lookup */
  getByFile(filePath: string): IndexedChunk[] {
    return this.getByFileIndexed(filePath);
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

  /** Persist to disk using atomic write. Creates a .bak before overwriting. */
  save(): void {
    if (!this.dirty && fs.existsSync(this.filePath)) return;

    // Create backup before writing
    if (fs.existsSync(this.filePath)) {
      try {
        fs.copyFileSync(this.filePath, this.filePath + '.bak');
      } catch {
        logger.debug('Could not create backup before save');
      }
    }

    const data = Array.from(this.chunks.values());
    atomicWriteJSON(this.filePath, data);
    this.dirty = false;
    logger.debug(`Saved ${data.length} chunks to ${this.filePath}`);
  }

  /** Load from disk — recovers from .bak if primary is corrupt */
  private load(): void {
    if (fs.existsSync(this.filePath)) {
      if (this.tryLoad(this.filePath)) return;

      // Primary is corrupt — try backup
      logger.warn('Index file corrupt, attempting recovery from backup...');
      const bakPath = this.filePath + '.bak';
      if (fs.existsSync(bakPath)) {
        if (this.tryLoad(bakPath)) {
          logger.info('Recovered index from backup.');
          this.dirty = true; // Trigger save to fix primary
          return;
        }
      }
      logger.error('Index corrupt and no valid backup. Run "indexa reindex" to rebuild.');
    }
  }

  /** Try to load chunks from a JSON file, returns true on success */
  private tryLoad(filePath: string): boolean {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      if (!raw.trim()) return false;
      const data: IndexedChunk[] = JSON.parse(raw);
      if (!Array.isArray(data)) return false;
      for (const chunk of data) {
        if (chunk.id && chunk.name) { // Basic validation
          this.chunks.set(chunk.id, chunk);
        }
      }
      logger.info(`Loaded ${this.chunks.size} chunks from ${filePath}`);
      return true;
    } catch (err) {
      logger.warn(`Failed to load from ${filePath}: ${err}`);
      return false;
    }
  }

  /** Clear all data */
  clear(): void {
    this.chunks.clear();
    this.dirty = true;
    this.save();
  }
}
