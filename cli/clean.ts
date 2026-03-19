import * as path from 'path';
import * as fs from 'fs';
import { VectorDB } from '../src/storage/vector-db';
import { MetadataDB } from '../src/storage/metadata-db';
import { logger } from '../src/utils';

/** Junk patterns — chunks matching any of these file path segments get purged */
const JUNK_PATTERNS = [
  'public/scripts/',
  'public/react-shell/assets/',
  '.stories.',
  '.spec.',
  '.test.',
  'angular-mocks',
  'e2e/',
  '__tests__/',
  '__mocks__/',
  '.min.js',
  '.bundle.js',
  'polyfills.js',
  'playwright-report',
  'coverage/',
  '.nyc_output',
  'storybook-static',
];

/**
 * CLI clean command — purge junk chunks from the index.
 * Removes minified builds, vendor scripts, storybook, test files, mocks.
 */
export async function cleanCommand(options?: {
  dataDir?: string;
  dryRun?: boolean;
  patterns?: string[];
}): Promise<{ removed: number; remaining: number }> {
  const projectRoot = process.cwd();
  const dataDir = options?.dataDir || path.join(projectRoot, 'data');

  const vectorDB = new VectorDB(dataDir);
  const metadataDB = new MetadataDB(dataDir);

  const patterns = [...JUNK_PATTERNS, ...(options?.patterns || [])];

  const chunks = vectorDB.getAll();
  let removed = 0;

  for (const chunk of chunks) {
    const fp = chunk.filePath.toLowerCase();
    if (patterns.some(p => fp.includes(p.toLowerCase()))) {
      if (!options?.dryRun) {
        vectorDB.remove(chunk.id);
      }
      removed++;
    }
  }

  // Also clean metadata
  if (!options?.dryRun) {
    const metaFiles = metadataDB.getAllFiles();
    for (const f of metaFiles) {
      const fl = f.toLowerCase();
      if (patterns.some(p => fl.includes(p.toLowerCase()))) {
        metadataDB.removeFile(f);
      }
    }

    vectorDB.save();
    metadataDB.save();
  }

  const remaining = options?.dryRun ? chunks.length - removed : vectorDB.size;

  if (options?.dryRun) {
    console.log(`[DRY RUN] Would remove ${removed} chunks`);
    console.log(`[DRY RUN] Would keep ${remaining} chunks`);
  } else {
    console.log(`Cleaned ${removed} junk chunks`);
    console.log(`Remaining: ${remaining} chunks`);
  }

  return { removed, remaining };
}

/**
 * CLI stats command — show index health report.
 */
export function statsCommand(options?: { dataDir?: string }): void {
  const projectRoot = process.cwd();
  const dataDir = options?.dataDir || path.join(projectRoot, 'data');

  const embPath = path.join(dataDir, 'embeddings.json');
  const metaPath = path.join(dataDir, 'metadata.json');

  if (!fs.existsSync(embPath)) {
    console.log('No index found. Run: indexa index <directory>');
    return;
  }

  const vectorDB = new VectorDB(dataDir);
  const metadataDB = new MetadataDB(dataDir);

  const chunks = vectorDB.getAll();

  // Type distribution
  const types: Record<string, number> = {};
  chunks.forEach(c => {
    types[c.type] = (types[c.type] || 0) + 1;
  });

  // Embedding dimension (from first chunk)
  const dim = chunks[0]?.embedding?.length || 0;

  // Junk check
  let junkCount = 0;
  for (const chunk of chunks) {
    const fp = chunk.filePath.toLowerCase();
    if (JUNK_PATTERNS.some(p => fp.includes(p.toLowerCase()))) {
      junkCount++;
    }
  }

  // Short-name check (likely minified)
  const shortNames = chunks.filter(c => c.name.length <= 2).length;

  // File sizes
  const embSize = fs.statSync(embPath).size;
  const metaSize = fs.existsSync(metaPath) ? fs.statSync(metaPath).size : 0;

  console.log('=== Indexa Health Report ===\n');
  console.log(`Chunks:     ${chunks.length}`);
  console.log(`Files:      ${metadataDB.size}`);
  console.log(`Embedding:  ${dim}-dim ${dim >= 256 ? '(ML model)' : '(hash-based)'}`);
  console.log(`Data:       ${dataDir}`);
  console.log(`Index size: ${(embSize / 1024 / 1024).toFixed(1)} MB`);
  console.log(`Meta size:  ${(metaSize / 1024).toFixed(0)} KB`);

  console.log('\nType Distribution:');
  Object.entries(types)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      console.log(`  ${type.padEnd(15)} ${count}`);
    });

  if (junkCount > 0 || shortNames > 0) {
    console.log('\n⚠ Issues Found:');
    if (junkCount > 0) {
      console.log(`  ${junkCount} chunks match junk patterns → run: indexa clean`);
    }
    if (shortNames > 0) {
      console.log(`  ${shortNames} chunks have 1-2 char names (likely minified) → run: indexa clean`);
    }
  } else {
    console.log('\n✓ Index is clean');
  }
}
