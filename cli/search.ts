import * as path from 'path';
import { VectorDB } from '../src/storage/vector-db';
import { Embedder } from '../src/indexer/embedder';
import { HybridSearch } from '../src/retrieval/hybrid';
import { logger, readCodeAtOffset } from '../src/utils';

/**
 * CLI search command — performs hybrid search and prints results.
 */
export async function searchCommand(
  query: string,
  options: { topK?: number; tokenBudget?: number; mode?: string; dataDir?: string }
): Promise<void> {
  const dataDir = options.dataDir || path.resolve(process.cwd(), 'data');
  const topK = options.topK || 5;
  const tokenBudget = options.tokenBudget;

  const vectorDB = new VectorDB(dataDir);
  const embedder = new Embedder();
  const hybridSearch = new HybridSearch(vectorDB, embedder);

  if (vectorDB.size === 0) {
    logger.error('No indexed data found. Run "indexa index" first.');
    return;
  }

  logger.info(`Searching for: "${query}" (topK=${topK}${tokenBudget ? `, tokenBudget=${tokenBudget}` : ''})`);

  const results = await hybridSearch.search(query, topK, tokenBudget);

  if (results.length === 0) {
    console.log('\nNo results found.');
    return;
  }

  console.log(`\n Found ${results.length} results:\n`);

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const score = (r.score * 100).toFixed(1);

    console.log(`--- Result ${i + 1} (score: ${score}%) ---`);
    console.log(`  ID: ${r.chunk.id}`);
    console.log(`  Name: ${r.chunk.name}`);
    console.log(`  Type: ${r.chunk.type}`);
    console.log(`  File: ${r.chunk.filePath}:${r.chunk.startLine}-${r.chunk.endLine}`);
    console.log(`  Summary: ${r.chunk.summary}`);

    // Read code from source file via byte offset
    const code = readCodeAtOffset(r.chunk.filePath, r.chunk.byteOffset, r.chunk.byteLength);
    if (code) {
      const codeLines = code.split('\n');
      const preview = codeLines.slice(0, 8).join('\n');
      console.log(`  Code:\n${preview}`);
      if (codeLines.length > 8) {
        console.log(`    ... (${codeLines.length - 8} more lines)`);
      }
    } else {
      console.log('  (source file not available for code preview)');
    }
    console.log('');
  }
}
