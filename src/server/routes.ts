import { Router } from 'express';
import { SearchController } from './controllers/search.controller';
import { IndexController } from './controllers/index.controller';
import { VectorDB } from '../storage/vector-db';
import { MetadataDB } from '../storage/metadata-db';
import { Embedder } from '../indexer/embedder';
import { IndexaConfig } from '../types';

/**
 * Create and configure all API routes.
 */
export function createRouter(
  config: IndexaConfig,
  vectorDB: VectorDB,
  metadataDB: MetadataDB,
  embedder: Embedder
): Router {
  const router = Router();

  const searchController = new SearchController(vectorDB, embedder);
  const indexController = new IndexController(config, vectorDB, metadataDB, embedder);

  // Search, context, intelligence
  router.post('/search', searchController.search);
  router.post('/context-bundle', searchController.contextBundle);
  router.post('/flow', searchController.flow);
  router.post('/explain', searchController.explain);

  // Index operations
  router.post('/update', indexController.update);

  // File and symbol lookups
  router.get('/file', indexController.getFile);
  router.get('/symbol', indexController.getSymbol);
  router.get('/symbol/:id(*)', indexController.getSymbolById);
  router.get('/outline', indexController.getOutline);

  // Graph analysis
  router.get('/references', indexController.getReferences);
  router.get('/blast-radius', indexController.getBlastRadius);
  router.get('/dead-code', indexController.getDeadCode);
  router.get('/importers', indexController.getImporters);
  router.get('/circular-deps', indexController.getCircularDeps);
  router.get('/unused-exports', indexController.getUnusedExports);
  router.get('/duplicates', indexController.getDuplicates);
  router.get('/impact-chain', indexController.getImpactChain);

  // Code grep
  router.get('/grep', indexController.codeGrep);

  // Stats and health
  router.get('/stats', indexController.getStats);
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', chunks: vectorDB.size, files: metadataDB.size });
  });

  return router;
}
