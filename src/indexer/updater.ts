import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { Parser } from './parser';
import { Chunker } from './chunker';
import { Embedder } from './embedder';
import { VectorDB } from '../storage/vector-db';
import { MetadataDB } from '../storage/metadata-db';
import { IndexedChunk, IndexaConfig } from '../types';
import { hashFile, logger, findFiles, normalizePath } from '../utils';

/**
 * Handles full and incremental indexing.
 * Uses git diff for change detection on incremental updates.
 */
export class Updater {
  private parser: Parser;
  private chunker: Chunker;
  private embedder: Embedder;
  private vectorDB: VectorDB;
  private metadataDB: MetadataDB;
  private config: IndexaConfig;

  constructor(
    config: IndexaConfig,
    vectorDB: VectorDB,
    metadataDB: MetadataDB,
    embedder?: Embedder
  ) {
    this.config = config;
    this.parser = new Parser();
    this.chunker = new Chunker();
    this.embedder = embedder || new Embedder();
    this.vectorDB = vectorDB;
    this.metadataDB = metadataDB;
  }

  /** Progress callback type */
  onProgress?: (current: number, total: number, file: string, chunks: number) => void;

  /** Full index of all matching files in the project */
  async indexAll(targetDir?: string): Promise<{ indexed: number; chunks: number }> {
    const dir = targetDir || this.config.projectRoot;
    const files = findFiles(dir, this.config.includePatterns, this.config.excludePatterns);

    logger.info(`Found ${files.length} files to index in ${dir}`);

    let totalChunks = 0;
    let processed = 0;

    for (const file of files) {
      const chunks = await this.indexFile(file);
      totalChunks += chunks;
      processed++;

      if (this.onProgress) {
        const shortName = path.basename(file);
        this.onProgress(processed, files.length, shortName, totalChunks);
      }
    }

    this.vectorDB.save();
    this.metadataDB.save();

    logger.info(`Indexed ${files.length} files, ${totalChunks} chunks`);
    return { indexed: files.length, chunks: totalChunks };
  }

  /** Incremental update using git diff */
  async updateFromGit(): Promise<{ updated: number; removed: number; chunks: number }> {
    const changedFiles = this.getGitChangedFiles();

    if (changedFiles.length === 0) {
      logger.info('No changed files detected');
      return { updated: 0, removed: 0, chunks: 0 };
    }

    logger.info(`Detected ${changedFiles.length} changed files`);

    let totalChunks = 0;
    let removed = 0;

    for (const { file, status } of changedFiles) {
      const absPath = path.resolve(this.config.projectRoot, file);

      if (status === 'D') {
        this.removeFileChunks(absPath);
        removed++;
      } else {
        this.removeFileChunks(absPath);
        if (fs.existsSync(absPath)) {
          const chunks = await this.indexFile(absPath);
          totalChunks += chunks;
        }
      }
    }

    this.vectorDB.save();
    this.metadataDB.save();

    logger.info(`Updated ${changedFiles.length - removed} files, removed ${removed}, ${totalChunks} chunks`);
    return { updated: changedFiles.length - removed, removed, chunks: totalChunks };
  }

  /** Index a single file: parse -> chunk -> embed -> store (no code in index) */
  private async indexFile(filePath: string): Promise<number> {
    const normalizedPath = normalizePath(filePath);

    // Check if file has changed
    const currentHash = hashFile(filePath);
    const existingMeta = this.metadataDB.getFile(normalizedPath);

    if (existingMeta && existingMeta.hash === currentHash) {
      logger.debug(`Skipping unchanged file: ${normalizedPath}`);
      return 0;
    }

    // Parse and chunk
    const elements = this.parser.parseFile(filePath);
    const chunks = this.chunker.chunkElements(elements);

    // Generate embeddings and store (without inline code)
    const chunkIds: string[] = [];
    for (const chunk of chunks) {
      // Use summary + name + type for embedding (not full code)
      const embedding = await this.embedder.embedChunk(
        chunk.summary, chunk.name, chunk.type
      );

      const indexed: IndexedChunk = {
        id: chunk.id,
        name: chunk.name,
        type: chunk.type,
        summary: chunk.summary,
        filePath: normalizedPath,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        byteOffset: chunk.byteOffset,
        byteLength: chunk.byteLength,
        dependencies: chunk.dependencies,
        imports: chunk.imports,
        contentHash: chunk.contentHash,
        embedding,
        indexedAt: new Date().toISOString(),
      };
      this.vectorDB.upsert(indexed);
      chunkIds.push(chunk.id);
    }

    // Update metadata
    this.metadataDB.setFile(normalizedPath, {
      filePath: normalizedPath,
      hash: currentHash,
      lastIndexed: new Date().toISOString(),
      chunkIds,
    });

    logger.debug(`Indexed ${normalizedPath}: ${chunks.length} chunks`);
    return chunks.length;
  }

  /** Remove all chunks belonging to a file */
  private removeFileChunks(filePath: string): void {
    const normalizedPath = normalizePath(filePath);
    const meta = this.metadataDB.getFile(normalizedPath);

    if (meta) {
      for (const chunkId of meta.chunkIds) {
        this.vectorDB.remove(chunkId);
      }
      this.metadataDB.removeFile(normalizedPath);
      logger.debug(`Removed chunks for ${normalizedPath}`);
    }
  }

  /** Get list of changed files from git */
  private getGitChangedFiles(): Array<{ file: string; status: string }> {
    try {
      const output = execSync('git diff --name-status HEAD~1', {
        cwd: this.config.projectRoot,
        encoding: 'utf-8',
      });

      return output
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          const [status, ...fileParts] = line.split('\t');
          return { status: status.trim(), file: fileParts.join('\t').trim() };
        })
        .filter(({ file }) => {
          return this.config.includePatterns.some(pattern => {
            if (pattern.startsWith('*')) return file.endsWith(pattern.slice(1));
            return file === pattern;
          });
        });
    } catch (err) {
      logger.warn('Git diff failed, falling back to full index');
      return [];
    }
  }
}
