import { Request, Response } from 'express';
import { HybridSearch } from '../../retrieval/hybrid';
import { SemanticSearch } from '../../retrieval/semantic';
import { KeywordSearch } from '../../retrieval/keyword';
import { VectorDB } from '../../storage/vector-db';
import { Embedder } from '../../indexer/embedder';
import { SearchRequest } from '../../types';
import { logger, readCodeAtOffset } from '../../utils';

/**
 * Controller for search-related API endpoints.
 */
export class SearchController {
  private hybridSearch: HybridSearch;
  private semanticSearch: SemanticSearch;
  private keywordSearch: KeywordSearch;

  constructor(vectorDB: VectorDB, embedder: Embedder) {
    this.hybridSearch = new HybridSearch(vectorDB, embedder);
    this.semanticSearch = new SemanticSearch(vectorDB, embedder);
    this.keywordSearch = new KeywordSearch(vectorDB);
  }

  /** POST /search — hybrid, semantic, or keyword search */
  search = async (req: Request, res: Response): Promise<void> => {
    try {
      const { query, topK = 5, tokenBudget, mode = 'hybrid' } = req.body as SearchRequest;

      if (!query || typeof query !== 'string') {
        res.status(400).json({ error: 'Missing or invalid "query" field' });
        return;
      }

      const k = Math.min(Math.max(topK, 1), 50);

      let results;
      switch (mode) {
        case 'semantic':
          results = await this.semanticSearch.search(query, k);
          break;
        case 'keyword':
          results = this.keywordSearch.search(query, k);
          break;
        case 'hybrid':
        default:
          results = await this.hybridSearch.search(query, k, tokenBudget);
      }

      // Return results with code loaded on demand
      const cleaned = results.map(r => ({
        score: Math.round(r.score * 1000) / 1000,
        matchType: r.matchType,
        chunk: {
          id: r.chunk.id,
          name: r.chunk.name,
          type: r.chunk.type,
          filePath: r.chunk.filePath,
          startLine: r.chunk.startLine,
          endLine: r.chunk.endLine,
          summary: r.chunk.summary,
          code: readCodeAtOffset(r.chunk.filePath, r.chunk.byteOffset, r.chunk.byteLength),
          dependencies: r.chunk.dependencies,
          imports: r.chunk.imports,
        },
      }));

      logger.info(`Search "${query}" (${mode}, topK=${k}): ${cleaned.length} results`);
      res.json({ query, mode, results: cleaned });
    } catch (err) {
      logger.error(`Search failed: ${err}`);
      res.status(500).json({ error: 'Search failed' });
    }
  };
}
