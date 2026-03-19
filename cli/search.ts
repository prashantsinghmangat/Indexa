import * as path from 'path';
import { VectorDB } from '../src/storage/vector-db';
import { Embedder } from '../src/indexer/embedder';
import { HybridSearch } from '../src/retrieval/hybrid';
import { GraphAnalysis } from '../src/retrieval/graph';
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

/**
 * CLI bundle command — builds a context bundle from a query.
 */
export async function bundleCommand(
  query: string,
  options: { tokenBudget?: number; dataDir?: string }
): Promise<void> {
  const dataDir = options.dataDir || path.resolve(process.cwd(), 'data');
  const tokenBudget = options.tokenBudget || 2000;

  const vectorDB = new VectorDB(dataDir);
  const embedder = new Embedder();
  const hybridSearch = new HybridSearch(vectorDB, embedder);
  const graph = new GraphAnalysis(vectorDB);

  if (vectorDB.size === 0) {
    logger.error('No indexed data found. Run "indexa index" first.');
    return;
  }

  logger.info(`Building context bundle for: "${query}" (budget=${tokenBudget} tokens)`);

  const results = await hybridSearch.directSearch(query, 15);
  const bundle = graph.buildQueryBundle(results, tokenBudget);

  if (bundle.symbols.length === 0) {
    console.log('\nNo results found.');
    return;
  }

  console.log(`\n=== Context Bundle (${bundle.symbols.length} symbols, ~${bundle.estimatedTokens} tokens) ===\n`);

  for (const sym of bundle.symbols) {
    console.log(`--- [${sym.type}] ${sym.name} ---`);
    console.log(`  ID: ${sym.id}`);
    console.log(`  File: ${sym.filePath}:${sym.startLine}-${sym.endLine}`);
    console.log(`  Summary: ${sym.summary}`);
    console.log(sym.code);
    console.log('');
  }

  if (bundle.imports.length > 0) {
    console.log(`--- Dependencies (${bundle.imports.length}) ---\n`);
    for (const dep of bundle.imports) {
      console.log(`  [${dep.type}] ${dep.name} — ${dep.filePath}:${dep.startLine}-${dep.endLine}`);
      const lines = dep.code.split('\n');
      const preview = lines.slice(0, 5).join('\n');
      console.log(`  ${preview}`);
      if (lines.length > 5) console.log(`  ... (${lines.length - 5} more lines)`);
      console.log('');
    }
  }

  console.log(`Tokens: ~${bundle.estimatedTokens} / ${tokenBudget}`);
}
