import * as fs from 'fs';
import * as path from 'path';
import { ensureDir, logger } from '../src/utils';

/** Default Indexa configuration */
const DEFAULT_CONFIG = {
  projectRoot: '.',
  dataDir: './data',
  port: 3000,
  embeddingDim: 128,
  defaultTopK: 5,
  includePatterns: ['*.ts', '*.tsx', '*.js', '*.jsx'],
  excludePatterns: ['node_modules', 'dist', '.git', '*.test.*', '*.spec.*'],
};

/**
 * Initialize Indexa project structure in the current directory.
 * Creates config, data directories, and default config file.
 */
export function initProject(targetDir?: string): void {
  const root = targetDir || process.cwd();

  logger.info(`Initializing Indexa project in ${root}`);

  // Create directories
  ensureDir(path.join(root, 'config'));
  ensureDir(path.join(root, 'data'));

  // Write config file
  const configPath = path.join(root, 'config', 'indexa.config.json');
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
    logger.info(`Created config: ${configPath}`);
  } else {
    logger.info('Config already exists, skipping');
  }

  // Create empty data files
  const embeddingsPath = path.join(root, 'data', 'embeddings.json');
  if (!fs.existsSync(embeddingsPath)) {
    fs.writeFileSync(embeddingsPath, '[]');
  }

  const metadataPath = path.join(root, 'data', 'metadata.json');
  if (!fs.existsSync(metadataPath)) {
    fs.writeFileSync(metadataPath, '{}');
  }

  logger.info('Indexa project initialized successfully');
}
