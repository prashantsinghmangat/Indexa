import express from 'express';
import cors from 'cors';
import * as path from 'path';
import * as fs from 'fs';
import { createRouter } from './routes';
import { VectorDB } from '../storage/vector-db';
import { MetadataDB } from '../storage/metadata-db';
import { Embedder } from '../indexer/embedder';
import { IndexaConfig } from '../types';
import { logger } from '../utils';

/** Load config from file or use defaults */
function loadConfig(): IndexaConfig {
  const configPath = path.resolve(process.cwd(), 'config', 'indexa.config.json');

  const defaults: IndexaConfig = {
    projectRoot: process.cwd(),
    dataDir: path.resolve(process.cwd(), 'data'),
    port: 3000,
    embeddingDim: 128,
    defaultTopK: 5,
    defaultTokenBudget: 4000,
    includePatterns: ['*.ts', '*.tsx', '*.js', '*.jsx'],
    excludePatterns: ['node_modules', 'dist', '.git', '*.test.*', '*.spec.*', '*.stories.*', 'public/react-shell/assets', 'public/Scripts', '*.min.js', '*.bundle.js', 'vendor.js', 'polyfills.js', 'angular-mocks', 'e2e'],
  };

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const fileConfig = JSON.parse(raw);
      return { ...defaults, ...fileConfig };
    } catch (err) {
      logger.warn(`Failed to parse config file, using defaults: ${err}`);
    }
  }

  return defaults;
}

/** Start the Indexa API server */
export function startServer(configOverrides?: Partial<IndexaConfig>): void {
  const config = { ...loadConfig(), ...configOverrides };

  const vectorDB = new VectorDB(config.dataDir);
  const metadataDB = new MetadataDB(config.dataDir);
  const embedder = new Embedder();

  const app = express();
  app.use(cors());
  app.use(express.json());

  const router = createRouter(config, vectorDB, metadataDB, embedder);
  app.use('/api', router);

  app.get('/', (_req, res) => {
    res.json({
      name: 'Indexa',
      version: '3.0.0',
      endpoints: [
        'POST /api/context-bundle  ← PRIMARY: query → symbols + deps + connections',
        'POST /api/flow            ← trace execution flow across functions',
        'POST /api/explain         ← human-readable code explanation',
        'POST /api/search',
        'POST /api/update',
        'GET  /api/file?path=',
        'GET  /api/symbol?name=',
        'GET  /api/symbol/:id',
        'GET  /api/outline?path=',
        'GET  /api/references?name=',
        'GET  /api/blast-radius?name=',
        'GET  /api/stats',
        'GET  /api/health',
      ],
    });
  });

  const port = config.port;
  app.listen(port, () => {
    logger.info(`Indexa server running on http://localhost:${port}`);
    logger.info(`Data directory: ${config.dataDir}`);
    logger.info(`Indexed chunks: ${vectorDB.size}`);
  });
}

if (require.main === module) {
  startServer();
}
