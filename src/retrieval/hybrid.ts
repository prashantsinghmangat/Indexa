import { SearchResult } from '../types';
import { SemanticSearch } from './semantic';
import { KeywordSearch } from './keyword';
import { VectorDB } from '../storage/vector-db';
import { Embedder } from '../indexer/embedder';
import { logger, estimateTokens, readCodeAtOffset, packByTokenBudget } from '../utils';

/** Weight configuration for hybrid scoring */
const SEMANTIC_WEIGHT = 0.7;
const KEYWORD_WEIGHT = 0.3;

/**
 * Hybrid search combining semantic and keyword results.
 * Supports both topK and token-budget modes.
 */
export class HybridSearch {
  private semanticSearch: SemanticSearch;
  private keywordSearch: KeywordSearch;

  constructor(vectorDB: VectorDB, embedder?: Embedder) {
    this.semanticSearch = new SemanticSearch(vectorDB, embedder);
    this.keywordSearch = new KeywordSearch(vectorDB);
  }

  /** Perform hybrid search with optional token budget */
  async search(query: string, topK: number = 5, tokenBudget?: number): Promise<SearchResult[]> {
    const candidateK = Math.max(topK * 3, 20);

    const [semanticResults, keywordResults] = await Promise.all([
      this.semanticSearch.search(query, candidateK),
      Promise.resolve(this.keywordSearch.search(query, candidateK)),
    ]);

    // Normalize scores to [0, 1] range
    const normSemantic = this.normalizeScores(semanticResults);
    const normKeyword = this.normalizeScores(keywordResults);

    // Merge into a combined score map
    const scoreMap = new Map<string, { result: SearchResult; semanticScore: number; keywordScore: number }>();

    for (const r of normSemantic) {
      scoreMap.set(r.chunk.id, { result: r, semanticScore: r.score, keywordScore: 0 });
    }

    for (const r of normKeyword) {
      const existing = scoreMap.get(r.chunk.id);
      if (existing) {
        existing.keywordScore = r.score;
      } else {
        scoreMap.set(r.chunk.id, { result: r, semanticScore: 0, keywordScore: r.score });
      }
    }

    // Compute hybrid scores
    const hybridResults: SearchResult[] = Array.from(scoreMap.values()).map(entry => ({
      chunk: entry.result.chunk,
      score: entry.semanticScore * SEMANTIC_WEIGHT + entry.keywordScore * KEYWORD_WEIGHT,
      matchType: 'hybrid' as const,
    }));

    hybridResults.sort((a, b) => b.score - a.score);

    logger.debug(`Hybrid search: ${semanticResults.length} semantic + ${keywordResults.length} keyword → ${hybridResults.length} merged`);

    // Token budget mode: pack results until budget exhausted
    if (tokenBudget && tokenBudget > 0) {
      return packByTokenBudget(
        hybridResults,
        (r) => estimateTokens(r.chunk.summary) + Math.ceil(r.chunk.byteLength / 4),
        tokenBudget
      );
    }

    return hybridResults.slice(0, topK);
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
