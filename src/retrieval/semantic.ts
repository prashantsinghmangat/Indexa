import { SearchResult } from '../types';
import { Embedder } from '../indexer/embedder';
import { VectorDB } from '../storage/vector-db';
import { cosineSimilarity, logger } from '../utils';

/**
 * Semantic search using vector similarity.
 * Embeds the query and finds the most similar chunks.
 */
export class SemanticSearch {
  private embedder: Embedder;
  private vectorDB: VectorDB;

  constructor(vectorDB: VectorDB, embedder?: Embedder) {
    this.vectorDB = vectorDB;
    this.embedder = embedder || new Embedder();
  }

  /** Search for chunks semantically similar to the query */
  async search(query: string, topK: number = 5): Promise<SearchResult[]> {
    const queryEmbedding = await this.embedder.embed(query);
    const allChunks = this.vectorDB.getAll();

    if (allChunks.length === 0) {
      logger.warn('No indexed chunks available for semantic search');
      return [];
    }

    const scored: SearchResult[] = allChunks.map(chunk => ({
      chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
      matchType: 'semantic' as const,
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }
}
