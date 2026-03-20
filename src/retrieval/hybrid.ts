import { SearchResult, IndexedChunk } from '../types';
import { SemanticSearch } from './semantic';
import { KeywordSearch } from './keyword';
import { VectorDB } from '../storage/vector-db';
import { Embedder } from '../indexer/embedder';
import { logger, estimateTokens, packByTokenBudget, bm25Tokenize, detectQueryIntent, classifyQuery, SemanticIntent } from '../utils';

/** Hybrid scoring weights — auto-adjusted based on embedding quality.
 * Real embeddings (384-dim): semantic-heavy. Hash (128-dim): keyword-heavy. */
function getWeights(embeddingDim: number) {
  if (embeddingDim >= 256) {
    // Real embeddings — semantic actually works.
    // Path weight is important: files in matching directories should rank high
    // even if chunk names don't match (e.g. "listChangeSource" in pricing/ dir).
    return { semantic: 0.35, keyword: 0.25, name: 0.15, path: 0.25 };
  }
  // Hash-based embeddings — keyword-dominant
  return { semantic: 0.15, keyword: 0.40, name: 0.20, path: 0.25 };
}

/**
 * Hybrid search with query routing.
 * Combines semantic (0.5) + keyword/BM25 (0.3) + symbol name match (0.2).
 * Auto-routes queries: identifiers → symbol lookup, short → keyword, else → hybrid.
 */
export class HybridSearch {
  private semanticSearch: SemanticSearch;
  private keywordSearch: KeywordSearch;
  private vectorDB: VectorDB;
  private weights: { semantic: number; keyword: number; name: number; path: number };

  constructor(vectorDB: VectorDB, embedder?: Embedder) {
    this.vectorDB = vectorDB;
    this.semanticSearch = new SemanticSearch(vectorDB, embedder);
    this.keywordSearch = new KeywordSearch(vectorDB);
    this.weights = getWeights(embedder?.dimension ?? 128);
  }

  /** Smart search: auto-routes based on query intent */
  async search(query: string, topK: number = 5, tokenBudget?: number): Promise<SearchResult[]> {
    const classification = classifyQuery(query);
    const intent = classification.strategy;

    logger.debug(`Query "${query}" → strategy: ${intent}, semantic: ${classification.intent} (${(classification.confidence * 100).toFixed(0)}%), subject: "${classification.subject}"`);

    let results: SearchResult[];

    switch (intent) {
      case 'symbol_lookup':
        results = this.symbolLookup(query, topK);
        if (results.length > 0) break;
        // Fall through to hybrid if symbol lookup found nothing
        results = await this.hybridSearch(query, topK);
        break;

      case 'keyword':
        results = this.keywordSearch.search(query, topK * 2);
        // Supplement with semantic if keyword returns few results
        if (results.length < topK) {
          const semantic = await this.semanticSearch.search(query, topK);
          results = this.mergeDedup(results, semantic);
        }
        results = results.slice(0, topK);
        break;

      case 'hybrid':
      default:
        results = await this.hybridSearch(query, topK);
        break;
    }

    // Token budget packing
    if (tokenBudget && tokenBudget > 0) {
      return packByTokenBudget(
        results,
        (r) => estimateTokens(r.chunk.summary) + Math.ceil(r.chunk.byteLength / 4),
        tokenBudget
      );
    }

    return results;
  }

  /** Direct search without query routing (for context bundle).
   *  Uses intent classification to adjust search weights. */
  async directSearch(query: string, topK: number = 5): Promise<SearchResult[]> {
    const classification = classifyQuery(query);
    // Only apply intent weights if confidence is reasonable
    const intent = classification.confidence >= 0.5 ? classification.intent : undefined;
    return this.hybridSearch(query, topK, intent);
  }

  /** Get the classified intent for a query (for external consumers like MCP) */
  getQueryIntent(query: string): { intent: SemanticIntent; confidence: number; subject: string } {
    const c = classifyQuery(query);
    return { intent: c.intent, confidence: c.confidence, subject: c.subject };
  }

  /** Full hybrid search: semantic + keyword + name match.
   *  Optionally adjusts weights based on semantic intent. */
  private async hybridSearch(query: string, topK: number, intentOverride?: SemanticIntent): Promise<SearchResult[]> {
    const candidateK = Math.max(topK * 5, 50);

    const [semanticResults, keywordResults] = await Promise.all([
      this.semanticSearch.search(query, candidateK),
      Promise.resolve(this.keywordSearch.search(query, candidateK)),
    ]);

    // Compute name match scores for all candidates
    const queryTokens = bm25Tokenize(query);

    // Normalize scores to [0, 1]
    const normSemantic = this.normalizeScores(semanticResults);
    const normKeyword = this.normalizeScores(keywordResults);

    // Merge into score map
    const scoreMap = new Map<string, {
      chunk: IndexedChunk;
      semanticScore: number;
      keywordScore: number;
      nameScore: number;
    }>();

    for (const r of normSemantic) {
      scoreMap.set(r.chunk.id, {
        chunk: r.chunk,
        semanticScore: r.score,
        keywordScore: 0,
        nameScore: this.computeNameScore(r.chunk, queryTokens),
      });
    }

    for (const r of normKeyword) {
      const existing = scoreMap.get(r.chunk.id);
      if (existing) {
        existing.keywordScore = r.score;
      } else {
        scoreMap.set(r.chunk.id, {
          chunk: r.chunk,
          semanticScore: 0,
          keywordScore: r.score,
          nameScore: this.computeNameScore(r.chunk, queryTokens),
        });
      }
    }

    // Compute final hybrid scores with intent-aware weights + entry-point boosting.
    // Different intents benefit from different weight distributions.
    const intentWeights = intentOverride ? this.getIntentWeights(intentOverride) : this.weights;

    const hybridResults: SearchResult[] = Array.from(scoreMap.values()).map(entry => {
      const baseScore = entry.semanticScore * intentWeights.semantic
           + entry.keywordScore * intentWeights.keyword
           + entry.nameScore * intentWeights.name
           + this.computePathScore(entry.chunk, queryTokens) * intentWeights.path;

      // Entry-point boost: multiplicative so it preserves ranking within tiers
      const entryBoost = this.computeEntryPointBoost(entry.chunk);

      return {
        chunk: entry.chunk,
        score: baseScore * entryBoost,
        matchType: 'hybrid' as const,
      };
    });

    hybridResults.sort((a, b) => b.score - a.score);

    // Filter out near-zero-relevance results — prevents garbage from consuming token budget
    const MIN_SCORE = 0.05;
    const filtered = hybridResults.filter(r => r.score >= MIN_SCORE);

    logger.debug(`Hybrid: ${semanticResults.length} semantic + ${keywordResults.length} keyword → ${filtered.length} above threshold (of ${hybridResults.length})`);

    return filtered.slice(0, topK);
  }

  /** Symbol lookup: direct name match */
  private symbolLookup(query: string, topK: number): SearchResult[] {
    const matches = this.vectorDB.findByName(query);
    if (matches.length === 0) return [];

    // Score by name closeness
    const queryLower = query.toLowerCase();
    const scored: SearchResult[] = matches.map(chunk => {
      const nameLower = chunk.name.toLowerCase();
      let score = 0;

      if (nameLower === queryLower) {
        score = 1.0; // Exact match
      } else if (nameLower.startsWith(queryLower) || nameLower.endsWith(queryLower)) {
        score = 0.8;
      } else {
        score = 0.5; // Partial/contains
      }

      return { chunk, score, matchType: 'keyword' as const };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /** Compute name match score [0, 1] for a chunk against query tokens */
  private computeNameScore(chunk: IndexedChunk, queryTokens: string[]): number {
    if (queryTokens.length === 0) return 0;

    const nameTokens = bm25Tokenize(chunk.name);
    if (nameTokens.length === 0) return 0;

    let matches = 0;
    for (const qt of queryTokens) {
      if (nameTokens.some(nt => nt === qt)) {
        matches += 1.0;
      } else if (nameTokens.some(nt => nt.includes(qt) || qt.includes(nt))) {
        matches += 0.5;
      }
    }

    return Math.min(matches / queryTokens.length, 1.0);
  }

  /** Get adjusted weights for a specific semantic intent.
   *  FLOW/DEBUG → more semantic (understand meaning), less name match.
   *  REFERENCES → heavy name/path match (finding exact usages).
   *  EXPLAIN → balanced (need both meaning and structure).
   *  SEARCH → default weights. */
  private getIntentWeights(intent: SemanticIntent): typeof this.weights {
    switch (intent) {
      case 'flow':
        // Flow needs to understand call chains — semantic is critical
        return { semantic: 0.45, keyword: 0.20, name: 0.15, path: 0.20 };
      case 'explain':
        // Explanation needs broad context — balanced weights
        return { semantic: 0.40, keyword: 0.25, name: 0.15, path: 0.20 };
      case 'references':
        // Finding usages — name match is critical
        return { semantic: 0.15, keyword: 0.25, name: 0.35, path: 0.25 };
      case 'debug':
        // Debugging — semantic for understanding + path for file context
        return { semantic: 0.40, keyword: 0.20, name: 0.10, path: 0.30 };
      default:
        return this.weights;
    }
  }

  /** Entry-point boost: controllers, services, components, and exports rank higher.
   *  Multiplicative (1.0 = no change, >1.0 = boost).
   *  Helpers, utils, internal _part chunks get no boost. */
  private computeEntryPointBoost(chunk: IndexedChunk): number {
    // Type-based boost: entry points are more useful as starting context
    const TYPE_BOOSTS: Record<string, number> = {
      controller: 1.3,
      service: 1.25,
      component: 1.2,
      module: 1.15,
      export: 1.1,
      class: 1.1,
      method: 1.0,
      function: 1.0,
    };
    let boost = TYPE_BOOSTS[chunk.type] || 1.0;

    // File naming boost: files named controller/service/route are entry points
    const fileName = chunk.filePath.toLowerCase().replace(/\\/g, '/').split('/').pop() || '';
    if (/controller|service|route|api|store/.test(fileName)) boost *= 1.1;

    // Exported symbols are more important than internal ones
    if (chunk.type === 'export') boost *= 1.1;

    // Penalize _part chunks (split artifacts) — they're incomplete
    if (chunk.name.includes('_part') && !chunk.name.endsWith('_part0')) boost *= 0.8;

    return boost;
  }

  /** Compute file path match score [0, 1] against query tokens */
  private computePathScore(chunk: IndexedChunk, queryTokens: string[]): number {
    if (queryTokens.length === 0) return 0;

    // Tokenize the file path: split on /, \, ., -, _ and lowercase
    const pathParts = chunk.filePath
      .replace(/\\/g, '/')
      .split(/[\/.\-_]/)
      .map(p => p.toLowerCase())
      .filter(p => p.length > 1);

    let matches = 0;
    for (const qt of queryTokens) {
      if (pathParts.some(p => p === qt)) {
        matches += 1.0;
      } else if (pathParts.some(p => p.includes(qt) || qt.includes(p))) {
        matches += 0.5;
      }
    }

    return Math.min(matches / queryTokens.length, 1.0);
  }

  /** Merge two result arrays, deduplicating by chunk ID */
  private mergeDedup(a: SearchResult[], b: SearchResult[]): SearchResult[] {
    const seen = new Set(a.map(r => r.chunk.id));
    const merged = [...a];
    for (const r of b) {
      if (!seen.has(r.chunk.id)) {
        merged.push(r);
        seen.add(r.chunk.id);
      }
    }
    return merged;
  }

  /** Normalize scores to [0, 1] using max-relative normalization.
   *  Unlike min-max, this preserves proportional differences and doesn't
   *  inflate single results or tight-range results to 1.0. */
  private normalizeScores(results: SearchResult[]): SearchResult[] {
    if (results.length === 0) return [];
    // Single result = moderate confidence (0.5), not 1.0
    if (results.length === 1) return [{ ...results[0], score: 0.5 }];

    const max = Math.max(...results.map(r => r.score));
    if (max === 0) return results.map(r => ({ ...r, score: 0 }));

    // Normalize relative to max — preserves proportional score differences
    return results.map(r => ({ ...r, score: r.score / max }));
  }
}
