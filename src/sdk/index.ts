/**
 * Indexa SDK — Programmatic API for code intelligence.
 *
 * Usage:
 *   import { createIndexa } from 'indexa-mcp/sdk';
 *   const indexa = createIndexa({ dataDir: '.indexa' });
 *   const results = await indexa.search('auth middleware');
 *   const bundle = await indexa.contextBundle('login flow', 3000);
 *   const dead = indexa.findDeadCode();
 */

import * as path from 'path';
import * as fs from 'fs';
import { VectorDB } from '../storage/vector-db';
import { MetadataDB } from '../storage/metadata-db';
import { Embedder } from '../indexer/embedder';
import { Updater } from '../indexer/updater';
import { HybridSearch } from '../retrieval/hybrid';
import { GraphAnalysis } from '../retrieval/graph';
import { FlowEngine, ExplainEngine } from '../intelligence';
import { IndexaConfig, SearchResult, ContextBundle, FlowResult, ExplainResult, StitchedBundle } from '../types';

export interface IndexaSDKOptions {
  /** Path to index data directory (default: .indexa in cwd) */
  dataDir?: string;
  /** Project root for indexing (default: cwd) */
  projectRoot?: string;
  /** Token budget for context bundles (default: 3000) */
  defaultTokenBudget?: number;
}

export class Indexa {
  private vectorDB: VectorDB;
  private metadataDB: MetadataDB;
  private embedder: Embedder;
  private search: HybridSearch;
  private graph: GraphAnalysis;
  private flow: FlowEngine;
  private explain: ExplainEngine;
  private config: IndexaConfig;

  constructor(options: IndexaSDKOptions = {}) {
    const dataDir = options.dataDir || path.join(process.cwd(), '.indexa');
    const projectRoot = options.projectRoot || process.cwd();

    this.config = {
      projectRoot,
      dataDir,
      port: 3000,
      embeddingDim: 128,
      defaultTopK: 5,
      defaultTokenBudget: options.defaultTokenBudget || 3000,
      includePatterns: ['*.ts', '*.tsx', '*.js', '*.jsx'],
      excludePatterns: ['node_modules', 'dist', '.git', '*.test.*', '*.spec.*'],
    };

    this.vectorDB = new VectorDB(dataDir);
    this.metadataDB = new MetadataDB(dataDir);
    this.embedder = new Embedder();
    this.search = new HybridSearch(this.vectorDB, this.embedder);
    this.graph = new GraphAnalysis(this.vectorDB);
    this.flow = new FlowEngine(this.vectorDB, this.search);
    this.explain = new ExplainEngine(this.graph, this.search);
  }

  /** Number of indexed chunks */
  get size(): number {
    return this.vectorDB.size;
  }

  /** Index a directory */
  async index(directory?: string): Promise<{ indexed: number; chunks: number }> {
    const updater = new Updater(this.config, this.vectorDB, this.metadataDB, this.embedder);
    return updater.indexAll(directory || this.config.projectRoot);
  }

  /** Incremental update from git diff */
  async update(): Promise<{ updated: number; removed: number; chunks: number }> {
    const updater = new Updater(this.config, this.vectorDB, this.metadataDB, this.embedder);
    return updater.updateFromGit();
  }

  /** Hybrid search */
  async searchCode(query: string, topK: number = 5): Promise<SearchResult[]> {
    return this.search.search(query, topK);
  }

  /** Context bundle — primary tool for LLM consumption */
  async contextBundle(query: string, tokenBudget?: number): Promise<StitchedBundle> {
    const budget = tokenBudget || this.config.defaultTokenBudget;
    const results = await this.search.directSearch(query, 25);
    return this.explain.stitch(results, budget);
  }

  /** Trace execution flow */
  async traceFlow(query: string, depth: number = 3): Promise<FlowResult> {
    return this.flow.trace(query, depth);
  }

  /** Explain code area */
  async explainCode(query: string, tokenBudget?: number): Promise<ExplainResult> {
    return this.explain.explain(query, tokenBudget || this.config.defaultTokenBudget);
  }

  /** Find references to a symbol */
  findReferences(symbolName: string) {
    return this.graph.findReferences(symbolName);
  }

  /** Blast radius for a symbol */
  getBlastRadius(symbolName: string) {
    return this.graph.getBlastRadius(symbolName);
  }

  /** Full transitive impact chain */
  getFullImpactChain(symbolName: string, depth: number = 5) {
    return this.graph.getFullImpactChain(symbolName, depth);
  }

  /** Find dead code */
  findDeadCode(options?: { includeEntryPoints?: boolean }) {
    return this.graph.findDeadCode(options);
  }

  /** Find circular dependencies */
  findCircularDependencies() {
    return this.graph.findCircularDependencies();
  }

  /** Find unused exports */
  findUnusedExports() {
    return this.graph.findUnusedExports();
  }

  /** Find near-duplicate code */
  findDuplicates(threshold: number = 0.92) {
    return this.graph.findDuplicates(threshold);
  }

  /** Find importers of a file */
  findImporters(filePath: string) {
    return this.graph.findImporters(filePath);
  }
}

/** Create an Indexa instance */
export function createIndexa(options?: IndexaSDKOptions): Indexa {
  return new Indexa(options);
}

// Re-export types for SDK consumers
export type {
  SearchResult,
  ContextBundle,
  StitchedBundle,
  FlowResult,
  ExplainResult,
  IndexaConfig,
} from '../types';
