import * as path from 'path';
import * as fs from 'fs';
import { VectorDB } from '../src/storage/vector-db';
import { Embedder } from '../src/indexer/embedder';
import { HybridSearch } from '../src/retrieval/hybrid';
import { GraphAnalysis } from '../src/retrieval/graph';
import { ExplainEngine } from '../src/intelligence';
import { readCodeAtOffset, classifyQuery } from '../src/utils';

/** Resolve the default data directory */
function defaultDataDir(): string {
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.name === 'indexa' || pkg.name === 'indexa-mcp') return path.join(dir, 'data');
      } catch { /* continue */ }
    }
    dir = path.dirname(dir);
  }
  return path.resolve(__dirname, '..', '..', 'data');
}

interface BenchmarkResult {
  query: string;
  intent: string;
  indexaTokens: number;
  rawTokens: number;
  savings: number;
  savingsPercent: string;
  resultCount: number;
  timeMs: number;
}

/**
 * Benchmark command: compare Indexa context bundle tokens vs raw file reading.
 */
export async function benchmarkCommand(options: {
  dataDir?: string;
  queries?: string[];
  tokenBudget?: number;
}): Promise<void> {
  const dataDir = options.dataDir || defaultDataDir();
  const tokenBudget = options.tokenBudget || 3000;

  const vectorDB = new VectorDB(dataDir);
  if (vectorDB.size === 0) {
    console.error('[ERROR] No indexed data found. Run "indexa-mcp setup" first.');
    process.exit(1);
  }

  const embedder = new Embedder();
  const search = new HybridSearch(vectorDB, embedder);
  const graph = new GraphAnalysis(vectorDB);
  const explainEngine = new ExplainEngine(graph, search);

  // Default benchmark queries — covers different intent types
  const defaultQueries = [
    'authentication flow',
    'main component',
    'API routes',
    'error handling',
    'state management',
  ];

  const queries = options.queries && options.queries.length > 0
    ? options.queries
    : defaultQueries;

  console.log('');
  console.log('  ╔═══════════════════════════════════════════════╗');
  console.log('  ║          Indexa Token Benchmark                ║');
  console.log('  ║   Comparing context bundles vs raw file reads  ║');
  console.log('  ╚═══════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Index: ${vectorDB.size} chunks | Budget: ${tokenBudget} tokens/query`);
  console.log('');

  const results: BenchmarkResult[] = [];

  for (const query of queries) {
    const startTime = Date.now();
    const classification = classifyQuery(query);

    // --- Indexa approach: context bundle ---
    const searchResults = await search.directSearch(query, 25);
    const bundle = graph.buildQueryBundle(searchResults, tokenBudget);
    const indexaTokens = bundle.estimatedTokens;

    // --- Raw approach: read full files that Indexa found ---
    const uniqueFiles = new Set<string>();
    for (const sym of bundle.symbols) {
      uniqueFiles.add(sym.filePath);
    }
    for (const dep of bundle.imports) {
      uniqueFiles.add(dep.filePath);
    }

    let rawTokens = 0;
    for (const filePath of uniqueFiles) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        rawTokens += Math.ceil(content.length / 4); // ~4 chars per token
      } catch {
        // File might have been moved/deleted
      }
    }

    const elapsed = Date.now() - startTime;
    const savings = rawTokens - indexaTokens;
    const savingsPercent = rawTokens > 0
      ? ((savings / rawTokens) * 100).toFixed(0)
      : '0';

    results.push({
      query,
      intent: classification.intent,
      indexaTokens,
      rawTokens,
      savings,
      savingsPercent: savingsPercent + '%',
      resultCount: bundle.symbols.length,
      timeMs: elapsed,
    });
  }

  // --- Print results table ---
  console.log('  ┌───────────────────────────────┬──────────┬───────────┬───────────┬─────────┬────────┐');
  console.log('  │ Query                         │ Intent   │ Raw Tokens│ Indexa    │ Saved   │ Time   │');
  console.log('  ├───────────────────────────────┼──────────┼───────────┼───────────┼─────────┼────────┤');

  for (const r of results) {
    const q = r.query.length > 29 ? r.query.substring(0, 26) + '...' : r.query.padEnd(29);
    const intent = r.intent.padEnd(8);
    const raw = r.rawTokens.toLocaleString().padStart(9);
    const indexa = r.indexaTokens.toLocaleString().padStart(9);
    const saved = r.savingsPercent.padStart(7);
    const time = (r.timeMs + 'ms').padStart(6);
    console.log(`  │ ${q} │ ${intent} │ ${raw} │ ${indexa} │ ${saved} │ ${time} │`);
  }

  console.log('  └───────────────────────────────┴──────────┴───────────┴───────────┴─────────┴────────┘');

  // --- Summary ---
  const totalRaw = results.reduce((s, r) => s + r.rawTokens, 0);
  const totalIndexa = results.reduce((s, r) => s + r.indexaTokens, 0);
  const totalSaved = totalRaw - totalIndexa;
  const totalPercent = totalRaw > 0 ? ((totalSaved / totalRaw) * 100).toFixed(0) : '0';
  const avgTime = Math.round(results.reduce((s, r) => s + r.timeMs, 0) / results.length);

  console.log('');
  console.log('  Summary');
  console.log('  ───────');
  console.log(`  Total raw tokens (full files): ${totalRaw.toLocaleString()}`);
  console.log(`  Total Indexa tokens (bundles): ${totalIndexa.toLocaleString()}`);
  console.log(`  Tokens saved:                  ${totalSaved.toLocaleString()} (${totalPercent}%)`);
  console.log(`  Average query time:            ${avgTime}ms`);
  console.log(`  Queries tested:                ${results.length}`);
  console.log('');

  if (parseInt(totalPercent) >= 50) {
    console.log(`  ✓ ${totalPercent}% token reduction — Indexa is saving significant tokens`);
  } else if (parseInt(totalPercent) >= 30) {
    console.log(`  ~ ${totalPercent}% token reduction — moderate savings`);
  } else {
    console.log(`  ! ${totalPercent}% token reduction — low savings (small codebase or few results)`);
  }
  console.log('');
}
