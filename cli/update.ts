import * as path from 'path';
import * as fs from 'fs';
import { VectorDB } from '../src/storage/vector-db';
import { MetadataDB } from '../src/storage/metadata-db';
import { Embedder } from '../src/indexer/embedder';
import { Updater } from '../src/indexer/updater';
import { IndexaConfig } from '../src/types';
import { logger } from '../src/utils';

/** Load config from the project directory */
function loadConfig(projectRoot: string): IndexaConfig {
  const configPath = path.join(projectRoot, 'config', 'indexa.config.json');

  const defaults: IndexaConfig = {
    projectRoot,
    dataDir: path.join(projectRoot, 'data'),
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
      return { ...defaults, ...JSON.parse(raw) };
    } catch {
      logger.warn('Failed to load config, using defaults');
    }
  }

  return defaults;
}

/**
 * CLI index command — full index of a directory.
 */
export async function indexCommand(
  targetDir?: string,
  options?: { dataDir?: string }
): Promise<void> {
  const projectRoot = process.cwd();
  const config = loadConfig(projectRoot);

  if (options?.dataDir) {
    config.dataDir = options.dataDir;
  }

  const vectorDB = new VectorDB(config.dataDir);
  const metadataDB = new MetadataDB(config.dataDir);
  const embedder = new Embedder();
  const updater = new Updater(config, vectorDB, metadataDB, embedder);

  const dir = targetDir ? path.resolve(targetDir) : config.projectRoot;

  logger.info(`Indexing directory: ${dir}`);
  const start = Date.now();

  const result = await updater.indexAll(dir);

  const elapsed = ((Date.now() - start) / 1000).toFixed(2);
  console.log(`\nIndexing complete in ${elapsed}s`);
  console.log(`  Files indexed: ${result.indexed}`);
  console.log(`  Chunks created: ${result.chunks}`);
  console.log(`  Data stored in: ${config.dataDir}`);
}

/**
 * CLI update command — incremental update using git diff.
 */
export async function updateCommand(options?: { dataDir?: string }): Promise<void> {
  const projectRoot = process.cwd();
  const config = loadConfig(projectRoot);

  if (options?.dataDir) {
    config.dataDir = options.dataDir;
  }

  const vectorDB = new VectorDB(config.dataDir);
  const metadataDB = new MetadataDB(config.dataDir);
  const embedder = new Embedder();
  const updater = new Updater(config, vectorDB, metadataDB, embedder);

  logger.info('Running incremental update...');
  const start = Date.now();

  const result = await updater.updateFromGit();

  const elapsed = ((Date.now() - start) / 1000).toFixed(2);
  console.log(`\nUpdate complete in ${elapsed}s`);
  console.log(`  Files updated: ${result.updated}`);
  console.log(`  Files removed: ${result.removed}`);
  console.log(`  Chunks created: ${result.chunks}`);
}
