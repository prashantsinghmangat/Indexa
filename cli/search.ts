import * as path from 'path';
import * as fs from 'fs';
import { VectorDB } from '../src/storage/vector-db';
import { Embedder } from '../src/indexer/embedder';
import { HybridSearch } from '../src/retrieval/hybrid';
import { GraphAnalysis } from '../src/retrieval/graph';
import { FlowEngine, ExplainEngine } from '../src/intelligence';
import { logger, readCodeAtOffset, estimateTokens } from '../src/utils';

/** Resolve the default data directory.
 *  Priority: 1) .indexa/ in CWD (per-project), 2) Indexa install root/data (legacy) */
function defaultDataDir(): string {
  // Check for project-local .indexa/ directory first
  const localDir = path.join(process.cwd(), '.indexa');
  if (fs.existsSync(localDir)) return localDir;

  // Fall back to Indexa install root
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.name === 'indexa-mcp' || pkg.name === 'indexa') return path.join(dir, 'data');
      } catch { /* continue */ }
    }
    dir = path.dirname(dir);
  }
  return path.resolve(__dirname, '..', '..', 'data');
}

/**
 * CLI search command — performs hybrid search and prints results.
 */
export async function searchCommand(
  query: string,
  options: { topK?: number; tokenBudget?: number; mode?: string; dataDir?: string }
): Promise<void> {
  const dataDir = options.dataDir || defaultDataDir();
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
  const dataDir = options.dataDir || defaultDataDir();
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

/**
 * CLI flow command — traces execution flow from a symbol or query.
 */
export async function flowCommand(
  query: string,
  options: { depth?: number; dataDir?: string }
): Promise<void> {
  const dataDir = options.dataDir || defaultDataDir();
  const depth = options.depth || 3;

  const vectorDB = new VectorDB(dataDir);
  const embedder = new Embedder();
  const hybridSearch = new HybridSearch(vectorDB, embedder);
  const flow = new FlowEngine(vectorDB, hybridSearch);

  if (vectorDB.size === 0) {
    logger.error('No indexed data found. Run "indexa index" first.');
    return;
  }

  logger.info(`Tracing flow for: "${query}" (depth=${depth})`);

  const result = await flow.trace(query, depth);

  if (result.flow.length === 0) {
    console.log('\nNo execution flow found.');
    return;
  }

  console.log(`\nExecution flow from "${result.entry}" (${result.flow.length} steps):\n`);

  for (const step of result.flow) {
    const indent = '  '.repeat(step.step - 1);
    const callsStr = step.calls.length > 0 ? ` → calls: ${step.calls.join(', ')}` : '';
    console.log(`${indent}${step.step}. [${step.type}] ${step.name}${callsStr}`);
    console.log(`${indent}   ${step.summary}`);
    console.log(`${indent}   ${step.filePath}`);
  }
}

/**
 * CLI explain command — generates a human-readable explanation.
 */
export async function explainCommand(
  query: string,
  options: { tokenBudget?: number; dataDir?: string }
): Promise<void> {
  const dataDir = options.dataDir || defaultDataDir();
  const tokenBudget = options.tokenBudget || 2000;

  const vectorDB = new VectorDB(dataDir);
  const embedder = new Embedder();
  const hybridSearch = new HybridSearch(vectorDB, embedder);
  const graph = new GraphAnalysis(vectorDB);
  const explain = new ExplainEngine(graph, hybridSearch);

  if (vectorDB.size === 0) {
    logger.error('No indexed data found. Run "indexa index" first.');
    return;
  }

  logger.info(`Explaining: "${query}" (budget=${tokenBudget} tokens)`);

  const result = await explain.explain(query, tokenBudget);

  console.log(`\n## Explanation\n`);
  console.log(result.explanation);

  if (result.steps.length > 0) {
    console.log(`\n## Steps\n`);
    for (let i = 0; i < result.steps.length; i++) {
      console.log(`  ${i + 1}. ${result.steps[i]}`);
    }
  }

  if (result.symbolsUsed.length > 0) {
    console.log(`\n## Symbols Analyzed (${result.symbolsUsed.length})\n`);
    for (const sym of result.symbolsUsed) {
      console.log(`  [${sym.type}] ${sym.name} — ${sym.summary}`);
    }
  }
}

/**
 * CLI dead-code command — find unreferenced symbols.
 */
export async function deadCodeCommand(
  options: { includeEntryPoints?: boolean; dataDir?: string }
): Promise<void> {
  const dataDir = options.dataDir || defaultDataDir();

  const vectorDB = new VectorDB(dataDir);
  const graph = new GraphAnalysis(vectorDB);

  if (vectorDB.size === 0) {
    logger.error('No indexed data found. Run "indexa index" first.');
    return;
  }

  logger.info(`Scanning for dead code...`);

  const dead = graph.findDeadCode({ includeEntryPoints: options.includeEntryPoints });

  if (dead.length === 0) {
    console.log('\n No dead code found!');
    return;
  }

  // Group by file
  const byFile = new Map<string, typeof dead>();
  for (const d of dead) {
    const list = byFile.get(d.chunk.filePath) || [];
    list.push(d);
    byFile.set(d.chunk.filePath, list);
  }

  console.log(`\n Dead Code Report — ${dead.length} unreferenced symbols across ${byFile.size} files\n`);

  for (const [filePath, items] of byFile) {
    console.log(`  ${filePath}`);
    for (const item of items) {
      console.log(`    [${item.chunk.type}] ${item.chunk.name} (L${item.chunk.startLine}-${item.chunk.endLine}) — ${item.reason}`);
    }
    console.log('');
  }

  console.log('Tip: Verify before deleting — some may be used via dynamic imports or external entry points.');
}

/**
 * CLI blast-radius command — impact analysis for a symbol.
 */
export async function blastRadiusCommand(
  symbolName: string,
  options: { dataDir?: string }
): Promise<void> {
  const dataDir = options.dataDir || defaultDataDir();

  const vectorDB = new VectorDB(dataDir);
  const graph = new GraphAnalysis(vectorDB);

  if (vectorDB.size === 0) {
    logger.error('No indexed data found. Run "indexa index" first.');
    return;
  }

  logger.info(`Analyzing blast radius for: "${symbolName}"`);

  const blast = graph.getBlastRadius(symbolName);
  const directRefs = graph.findReferences(symbolName);

  if (blast.directRefs === 0) {
    console.log(`\nNo references to "${symbolName}" found. Safe to modify or remove.`);
    return;
  }

  console.log(`\n Blast Radius: ${symbolName}\n`);
  console.log(`  Direct references: ${blast.directRefs}`);
  console.log(`  Files affected (transitive): ${blast.transitiveRefs}`);

  console.log(`\n  Direct References:`);
  for (const ref of directRefs.slice(0, 30)) {
    console.log(`    [${ref.type}] ${ref.name} — ${ref.filePath}:${ref.startLine}`);
  }
  if (directRefs.length > 30) console.log(`    ... and ${directRefs.length - 30} more`);

  console.log(`\n  Affected Files:`);
  for (const f of blast.files.slice(0, 20)) {
    console.log(`    ${f}`);
  }
  if (blast.files.length > 20) console.log(`    ... and ${blast.files.length - 20} more`);
}

/**
 * CLI export command — dump LLM-ready context to stdout or file.
 */
export async function exportCommand(
  query: string,
  options: { tokenBudget?: number; format?: string; output?: string; dataDir?: string }
): Promise<void> {
  const dataDir = options.dataDir || defaultDataDir();
  const tokenBudget = options.tokenBudget || 3000;
  const format = options.format || 'markdown';

  const vectorDB = new VectorDB(dataDir);
  const embedder = new Embedder();
  const hybridSearch = new HybridSearch(vectorDB, embedder);
  const graph = new GraphAnalysis(vectorDB);
  const explainEngine = new ExplainEngine(graph, hybridSearch);

  if (vectorDB.size === 0) {
    logger.error('No indexed data found. Run "indexa index" first.');
    return;
  }

  const results = await hybridSearch.directSearch(query, 25);
  const stitched = await explainEngine.stitch(results, tokenBudget);

  if (stitched.symbols.length === 0) {
    console.log(`No results for "${query}".`);
    return;
  }

  let output: string;

  if (format === 'json') {
    output = JSON.stringify({
      query,
      tokenBudget,
      estimatedTokens: stitched.estimatedTokens,
      symbols: stitched.symbols,
      dependencies: stitched.imports,
      connections: stitched.connections,
    }, null, 2);
  } else {
    // Markdown format — LLM-ready
    const lines: string[] = [
      `# Context: ${query}`,
      `> ${stitched.symbols.length} symbols, ~${stitched.estimatedTokens} tokens`,
      '',
    ];

    for (const sym of stitched.symbols) {
      lines.push(`## [${sym.type}] ${sym.name}`);
      lines.push(`File: ${sym.filePath}:${sym.startLine}-${sym.endLine}`);
      lines.push(`Summary: ${sym.summary}`);
      const ext = sym.filePath.split('.').pop() || 'ts';
      lines.push('```' + ext);
      lines.push(sym.code);
      lines.push('```');
      lines.push('');
    }

    if (stitched.imports.length > 0) {
      lines.push(`## Dependencies (${stitched.imports.length})`);
      for (const dep of stitched.imports) {
        lines.push(`### ${dep.name} (${dep.type})`);
        lines.push(`File: ${dep.filePath}:${dep.startLine}-${dep.endLine}`);
        lines.push('```');
        lines.push(dep.code);
        lines.push('```');
        lines.push('');
      }
    }

    if (stitched.connections.length > 0) {
      lines.push(`## Connections`);
      for (const conn of stitched.connections) {
        lines.push(`- ${conn.from} —[${conn.type}]→ ${conn.to}`);
      }
    }

    output = lines.join('\n');
  }

  if (options.output) {
    fs.writeFileSync(options.output, output, 'utf-8');
    console.log(`Exported to ${options.output} (${stitched.symbols.length} symbols, ~${stitched.estimatedTokens} tokens)`);
  } else {
    console.log(output);
  }
}

/**
 * CLI circular-deps command — detect circular dependencies.
 */
export function circularDepsCommand(
  options: { dataDir?: string }
): void {
  const dataDir = options.dataDir || defaultDataDir();
  const vectorDB = new VectorDB(dataDir);
  const graph = new GraphAnalysis(vectorDB);

  if (vectorDB.size === 0) {
    logger.error('No indexed data found. Run "indexa index" first.');
    return;
  }

  const cycles = graph.findCircularDependencies();

  if (cycles.length === 0) {
    console.log('\n No circular dependencies found!');
    return;
  }

  console.log(`\n Circular Dependencies — ${cycles.length} cycles detected\n`);

  for (let i = 0; i < cycles.length; i++) {
    const cycle = cycles[i];
    console.log(`  Cycle ${i + 1}: ${cycle.cycle.join(' → ')}`);
  }

  console.log('\nTip: Break cycles by extracting shared code into a separate module.');
}

/**
 * CLI unused-exports command — find exported symbols nobody imports.
 */
export function unusedExportsCommand(
  options: { dataDir?: string }
): void {
  const dataDir = options.dataDir || defaultDataDir();
  const vectorDB = new VectorDB(dataDir);
  const graph = new GraphAnalysis(vectorDB);

  if (vectorDB.size === 0) {
    logger.error('No indexed data found. Run "indexa index" first.');
    return;
  }

  const unused = graph.findUnusedExports();

  if (unused.length === 0) {
    console.log('\n No unused exports found!');
    return;
  }

  const byFile = new Map<string, typeof unused>();
  for (const u of unused) {
    const list = byFile.get(u.chunk.filePath) || [];
    list.push(u);
    byFile.set(u.chunk.filePath, list);
  }

  console.log(`\n Unused Exports — ${unused.length} symbols across ${byFile.size} files\n`);

  for (const [filePath, items] of byFile) {
    console.log(`  ${filePath}`);
    for (const item of items) {
      console.log(`    [${item.chunk.type}] ${item.exportedName} (L${item.chunk.startLine})`);
    }
    console.log('');
  }
}

/**
 * CLI duplicates command — find near-duplicate code via embedding similarity.
 */
export function duplicatesCommand(
  options: { threshold?: number; dataDir?: string }
): void {
  const dataDir = options.dataDir || defaultDataDir();
  const threshold = options.threshold || 0.92;
  const vectorDB = new VectorDB(dataDir);
  const graph = new GraphAnalysis(vectorDB);

  if (vectorDB.size === 0) {
    logger.error('No indexed data found. Run "indexa index" first.');
    return;
  }

  logger.info(`Scanning for duplicates (threshold: ${(threshold * 100).toFixed(0)}%)...`);

  const dupes = graph.findDuplicates(threshold);

  if (dupes.length === 0) {
    console.log(`\n No duplicates found above ${(threshold * 100).toFixed(0)}% similarity.`);
    return;
  }

  console.log(`\n Code Duplicates — ${dupes.length} pairs above ${(threshold * 100).toFixed(0)}% similarity\n`);

  for (let i = 0; i < Math.min(dupes.length, 30); i++) {
    const d = dupes[i];
    console.log(`  Pair ${i + 1} — ${(d.similarity * 100).toFixed(1)}% similar:`);
    console.log(`    A: [${d.a.type}] ${d.a.name} — ${d.a.filePath}:${d.a.startLine}-${d.a.endLine}`);
    console.log(`    B: [${d.b.type}] ${d.b.name} — ${d.b.filePath}:${d.b.startLine}-${d.b.endLine}`);
    console.log('');
  }
  if (dupes.length > 30) console.log(`  ... and ${dupes.length - 30} more`);
}

/**
 * CLI impact-chain command — full transitive impact analysis.
 */
export function impactChainCommand(
  symbolName: string,
  options: { depth?: number; dataDir?: string }
): void {
  const dataDir = options.dataDir || defaultDataDir();
  const depth = options.depth || 5;
  const vectorDB = new VectorDB(dataDir);
  const graph = new GraphAnalysis(vectorDB);

  if (vectorDB.size === 0) {
    logger.error('No indexed data found. Run "indexa index" first.');
    return;
  }

  logger.info(`Tracing full impact chain for: "${symbolName}" (depth=${depth})`);

  const impact = graph.getFullImpactChain(symbolName, depth);

  if (impact.totalAffected === 0) {
    console.log(`\nNo impact found for "${symbolName}". Safe to modify.`);
    return;
  }

  console.log(`\n Full Impact Chain: ${symbolName}\n`);
  console.log(`  Direct references: ${impact.directRefs}`);
  console.log(`  Total symbols affected: ${impact.totalAffected}`);
  console.log(`  Files affected: ${impact.files.length}`);

  // Group by depth
  const byDepth = new Map<number, typeof impact.chain>();
  for (const item of impact.chain) {
    const list = byDepth.get(item.depth) || [];
    list.push(item);
    byDepth.set(item.depth, list);
  }

  for (const [d, items] of byDepth) {
    console.log(`\n  Depth ${d} (${items.length} symbols):`);
    for (const item of items.slice(0, 20)) {
      console.log(`    [${item.type}] ${item.name} — ${item.filePath}`);
    }
    if (items.length > 20) console.log(`    ... +${items.length - 20} more`);
  }
}

/**
 * CLI watch command — watch for file changes and re-index incrementally.
 */
export async function watchCommand(
  options: { dataDir?: string; directory?: string }
): Promise<void> {
  const dataDir = options.dataDir || defaultDataDir();
  const dir = options.directory || process.cwd();

  const { Updater } = await import('../src/indexer/updater');
  const { MetadataDB } = await import('../src/storage/metadata-db');
  const { Embedder: Emb } = await import('../src/indexer/embedder');

  const vectorDB = new VectorDB(dataDir);
  const metadataDB = new MetadataDB(dataDir);
  const embedder = new Emb();

  const config = {
    projectRoot: dir,
    dataDir,
    port: 3000,
    embeddingDim: 128,
    defaultTopK: 5,
    defaultTokenBudget: 4000,
    includePatterns: ['*.ts', '*.tsx', '*.js', '*.jsx'],
    excludePatterns: ['node_modules', 'dist', '.git', '*.test.*', '*.spec.*'],
  };

  const updater = new Updater(config, vectorDB, metadataDB, embedder);

  console.log(`\n Indexa Watch Mode — monitoring ${dir}`);
  console.log('  Press Ctrl+C to stop.\n');

  const extensions = new Set(['.ts', '.tsx', '.js', '.jsx']);
  const ignoreDirs = new Set(['node_modules', 'dist', '.git', '.indexa']);

  // Debounce: collect changes for 1s before re-indexing
  let pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const processChanges = async () => {
    const files = [...pending];
    pending.clear();
    timer = null;

    let reindexed = 0;
    for (const file of files) {
      try {
        if (fs.existsSync(file)) {
          const chunks = await (updater as any).indexFile(file);
          reindexed += chunks;
        }
      } catch { /* skip errors */ }
    }
    if (reindexed > 0) {
      vectorDB.save();
      metadataDB.save();
      console.log(`  Re-indexed ${files.length} files (${reindexed} chunks)`);
    }
  };

  const watchRecursive = (watchDir: string) => {
    try {
      fs.watch(watchDir, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const fullPath = path.join(watchDir, filename);
        const ext = path.extname(filename);
        if (!extensions.has(ext)) return;

        // Skip ignored dirs
        const parts = filename.replace(/\\/g, '/').split('/');
        if (parts.some(p => ignoreDirs.has(p))) return;

        pending.add(fullPath);
        if (timer) clearTimeout(timer);
        timer = setTimeout(processChanges, 1000);
      });
    } catch {
      logger.error(`Cannot watch directory: ${watchDir}`);
    }
  };

  watchRecursive(dir);

  // Keep the process alive
  await new Promise(() => {});
}
