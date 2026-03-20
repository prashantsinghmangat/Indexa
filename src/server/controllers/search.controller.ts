import { Request, Response } from 'express';
import { HybridSearch } from '../../retrieval/hybrid';
import { SemanticSearch } from '../../retrieval/semantic';
import { KeywordSearch } from '../../retrieval/keyword';
import { GraphAnalysis } from '../../retrieval/graph';
import { VectorDB } from '../../storage/vector-db';
import { Embedder } from '../../indexer/embedder';
import { FlowEngine, ExplainEngine } from '../../intelligence';
import { SearchRequest } from '../../types';
import { logger, readCodeAtOffset } from '../../utils';

/**
 * Controller for search, context bundle, flow, and explain endpoints.
 */
export class SearchController {
  private hybridSearch: HybridSearch;
  private semanticSearch: SemanticSearch;
  private keywordSearch: KeywordSearch;
  private graph: GraphAnalysis;
  private flowEngine: FlowEngine;
  private explainEngine: ExplainEngine;

  constructor(vectorDB: VectorDB, embedder: Embedder) {
    this.hybridSearch = new HybridSearch(vectorDB, embedder);
    this.semanticSearch = new SemanticSearch(vectorDB, embedder);
    this.keywordSearch = new KeywordSearch(vectorDB);
    this.graph = new GraphAnalysis(vectorDB);
    this.flowEngine = new FlowEngine(vectorDB, this.hybridSearch);
    this.explainEngine = new ExplainEngine(this.graph, this.hybridSearch);
  }

  /** POST /search */
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

  /** POST /context-bundle — PRIMARY: query → search → pack with deps + connections */
  contextBundle = async (req: Request, res: Response): Promise<void> => {
    try {
      const { query, tokenBudget = 2000 } = req.body as { query: string; tokenBudget?: number };

      if (!query || typeof query !== 'string') {
        res.status(400).json({ error: 'Missing or invalid "query" field' });
        return;
      }

      const results = await this.hybridSearch.directSearch(query, 25);
      const stitched = await this.explainEngine.stitch(results, tokenBudget);

      logger.info(`Context bundle "${query}": ${stitched.symbols.length} symbols, ${stitched.connections.length} connections`);

      res.json({
        query,
        tokenBudget,
        estimatedTokens: stitched.estimatedTokens,
        symbols: stitched.symbols,
        dependencies: stitched.imports,
        connections: stitched.connections,
      });
    } catch (err) {
      logger.error(`Context bundle failed: ${err}`);
      res.status(500).json({ error: 'Context bundle failed' });
    }
  };

  /** POST /flow — trace execution flow */
  flow = async (req: Request, res: Response): Promise<void> => {
    try {
      const { query, depth = 3 } = req.body as { query: string; depth?: number };

      if (!query || typeof query !== 'string') {
        res.status(400).json({ error: 'Missing or invalid "query" field' });
        return;
      }

      const result = await this.flowEngine.trace(query, Math.min(depth, 6));
      logger.info(`Flow "${query}": ${result.flow.length} steps`);
      res.json(result);
    } catch (err) {
      logger.error(`Flow failed: ${err}`);
      res.status(500).json({ error: 'Flow tracing failed' });
    }
  };

  /** POST /explain — generate code explanation */
  explain = async (req: Request, res: Response): Promise<void> => {
    try {
      const { query, tokenBudget = 2000 } = req.body as { query: string; tokenBudget?: number };

      if (!query || typeof query !== 'string') {
        res.status(400).json({ error: 'Missing or invalid "query" field' });
        return;
      }

      const result = await this.explainEngine.explain(query, tokenBudget);
      logger.info(`Explain "${query}": ${result.symbolsUsed.length} symbols`);
      res.json(result);
    } catch (err) {
      logger.error(`Explain failed: ${err}`);
      res.status(500).json({ error: 'Explain failed' });
    }
  };
}
