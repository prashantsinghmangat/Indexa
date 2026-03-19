/** Supported code element types */
export type ChunkType =
  | 'function'
  | 'class'
  | 'method'
  | 'component'
  | 'service'
  | 'controller'
  | 'module'
  | 'export'
  | 'constant'
  | 'type'
  | 'unknown';

/** A parsed code element extracted from the AST */
export interface ParsedElement {
  id: string;
  type: ChunkType;
  name: string;
  filePath: string;
  code: string;
  startLine: number;
  endLine: number;
  byteOffset: number;
  byteLength: number;
  dependencies: string[];
  /** Symbols this element imports from other files */
  imports: ImportRef[];
}

/** Reference to an imported symbol */
export interface ImportRef {
  name: string;
  source: string;
  isDefault: boolean;
}

/** A chunk ready for indexing — code is loaded on demand from disk */
export interface CodeChunk {
  /** Stable ID: filePath::name#type */
  id: string;
  name: string;
  type: ChunkType;
  summary: string;
  filePath: string;
  startLine: number;
  endLine: number;
  byteOffset: number;
  byteLength: number;
  dependencies: string[];
  imports: ImportRef[];
  /** Content hash for drift detection */
  contentHash: string;
  /** Stored inline only for small chunks; otherwise read from disk */
  code?: string;
  embedding?: number[];
}

/** Stored chunk with embedding vector — no inline code */
export interface IndexedChunk {
  id: string;
  name: string;
  type: ChunkType;
  summary: string;
  filePath: string;
  startLine: number;
  endLine: number;
  byteOffset: number;
  byteLength: number;
  dependencies: string[];
  imports: ImportRef[];
  contentHash: string;
  embedding: number[];
  indexedAt: string;
}

/** Search result with relevance score */
export interface SearchResult {
  chunk: IndexedChunk;
  score: number;
  matchType: 'semantic' | 'keyword' | 'hybrid';
}

/** Search request payload */
export interface SearchRequest {
  query: string;
  topK?: number;
  tokenBudget?: number;
  mode?: 'semantic' | 'keyword' | 'hybrid';
}

/** File metadata for incremental indexing */
export interface FileMetadata {
  filePath: string;
  hash: string;
  lastIndexed: string;
  chunkIds: string[];
}

/** Indexa server configuration */
export interface IndexaConfig {
  projectRoot: string;
  dataDir: string;
  port: number;
  embeddingDim: number;
  defaultTopK: number;
  defaultTokenBudget: number;
  includePatterns: string[];
  excludePatterns: string[];
}

/** Embedding provider interface for pluggable embeddings */
export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  dimension: number;
}

/** Symbol ID in the format filePath::name#type */
export interface SymbolId {
  filePath: string;
  name: string;
  type: ChunkType;
}

/** Dependency graph node */
export interface DepGraphNode {
  id: string;
  name: string;
  type: ChunkType;
  filePath: string;
  imports: ImportRef[];
  /** IDs of chunks this symbol depends on */
  dependsOn: string[];
  /** IDs of chunks that depend on this symbol */
  dependedBy: string[];
}

/** Context bundle for LLM consumption */
export interface ContextBundle {
  /** Primary symbols requested */
  symbols: RetrievedSymbol[];
  /** Deduplicated imports needed */
  imports: RetrievedSymbol[];
  /** Total estimated tokens */
  estimatedTokens: number;
}

/** A retrieved symbol with its source code */
export interface RetrievedSymbol {
  id: string;
  name: string;
  type: ChunkType;
  filePath: string;
  startLine: number;
  endLine: number;
  code: string;
  summary: string;
}
