import { SearchResult, IndexedChunk } from '../types';
import { SemanticSearch } from './semantic';
import { KeywordSearch } from './keyword';
import { VectorDB } from '../storage/vector-db';
import { Embedder } from '../indexer/embedder';
import { logger, estimateTokens, packByTokenBudget, bm25Tokenize, detectQueryIntent } from '../utils';

/** Hybrid scoring weights */
const SEMANTIC_WEIGHT = 0.5;
const KEYWORD_WEIGHT = 0.3;
const NAME_MATCH_WEIGHT = 0.2;

/**
 * Hybrid search with query routing.
 * Combines semantic (0.5) + keyword/BM25 (0.3) + symbol name match (0.2).
 * Auto-routes queries: identifiers → symbol lookup, short → keyword, else → hybrid.
 */
export class HybridSearch {
  private semanticSearch: SemanticSearch;
  private keywordSearch: KeywordSearch;
  private vectorDB: VectorDB;

  constructor(vectorDB: VectorDB, embedder?: Embedder) {
    this.vectorDB = vectorDB;
    this.semanticSearch = new SemanticSearch(vectorDB, embedder);
    this.keywordSearch = new KeywordSearch(vectorDB);
  }

  /** Smart search: auto-routes based on query intent */
  async search(query: string, topK: number = 5, tokenBudget?: number): Promise<SearchResult[]> {
    const intent = detectQueryIntent(query);

    logger.debug(`Query "${query}" → intent: ${intent}`);

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

  /** Direct search without query routing (for context bundle) */
  async directSearch(query: string, topK: number = 5): Promise<SearchResult[]> {
    return this.hybridSearch(query, topK);
  }

  /** Full hybrid search: semantic + keyword + name match */
  private async hybridSearch(query: string, topK: number): Promise<SearchResult[]> {
    const candidateK = Math.max(topK * 3, 20);

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

    // Compute final hybrid scores
    const hybridResults: SearchResult[] = Array.from(scoreMap.values()).map(entry => ({
      chunk: entry.chunk,
      score: entry.semanticScore * SEMANTIC_WEIGHT
           + entry.keywordScore * KEYWORD_WEIGHT
           + entry.nameScore * NAME_MATCH_WEIGHT,
      matchType: 'hybrid' as const,
    }));

    hybridResults.sort((a, b) => b.score - a.score);

    logger.debug(`Hybrid: ${semanticResults.length} semantic + ${keywordResults.length} keyword → ${hybridResults.length} merged`);

    return hybridResults.slice(0, topK);
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

  /** Normalize scores to [0, 1] range using min-max normalization */
  private normalizeScores(results: SearchResult[]): SearchResult[] {
    if (results.length === 0) return [];

    const scores = results.map(r => r.score);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const range = max - min;

    if (range === 0) {
      return results.map(r => ({ ...r, score: 1 }));
    }

    return results.map(r => ({
      ...r,
      score: (r.score - min) / range,
    }));
  }
}
