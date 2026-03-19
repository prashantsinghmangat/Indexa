import { IndexedChunk, SearchResult } from '../types';
import { VectorDB } from '../storage/vector-db';
import { bm25Tokenize, bm25Score, logger } from '../utils';

/** Exact name match bonus */
const NAME_EXACT_BONUS = 50;

/**
 * BM25-based keyword search with field weighting.
 * Builds a virtual document per chunk: name (3x), type (2x), summary, file path.
 */
export class KeywordSearch {
  private vectorDB: VectorDB;

  constructor(vectorDB: VectorDB) {
    this.vectorDB = vectorDB;
  }

  /** Search for chunks matching keyword terms using BM25 */
  search(query: string, topK: number = 5): SearchResult[] {
    const queryTokens = bm25Tokenize(query);
    const allChunks = this.vectorDB.getAll();

    if (allChunks.length === 0 || queryTokens.length === 0) {
      return [];
    }

    // Build virtual documents with field weighting via repetition
    const docs = allChunks.map(chunk => this.buildVirtualDoc(chunk));
    const avgDocLength = docs.reduce((sum, d) => sum + d.length, 0) / docs.length;

    // Compute document frequencies for IDF
    const docFrequencies = new Map<string, number>();
    for (const doc of docs) {
      const uniqueTokens = new Set(doc);
      for (const token of uniqueTokens) {
        docFrequencies.set(token, (docFrequencies.get(token) || 0) + 1);
      }
    }

    // Score all chunks
    const scored: SearchResult[] = allChunks.map((chunk, i) => {
      let score = bm25Score(docs[i], queryTokens, avgDocLength, docFrequencies, allChunks.length);

      // Exact name match bonus
      const nameLower = chunk.name.toLowerCase();
      for (const term of queryTokens) {
        if (nameLower === term) {
          score += NAME_EXACT_BONUS;
        }
      }

      return { chunk, score, matchType: 'keyword' as const };
    });

    const results = scored.filter(r => r.score > 0);
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  /** Build a virtual document with field weighting via repetition */
  private buildVirtualDoc(chunk: IndexedChunk): string[] {
    const nameTokens = bm25Tokenize(chunk.name);
    const typeTokens = bm25Tokenize(chunk.type);
    const summaryTokens = bm25Tokenize(chunk.summary);
    const fileTokens = bm25Tokenize(chunk.filePath);

    return [
      ...nameTokens, ...nameTokens, ...nameTokens, // 3x name weight
      ...typeTokens, ...typeTokens,                  // 2x type weight
      ...summaryTokens,                              // 1x summary
      ...fileTokens,                                 // 1x file path
    ];
  }
}
