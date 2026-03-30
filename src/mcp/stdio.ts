#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as path from 'path';
import * as fs from 'fs';
import { VectorDB } from '../storage/vector-db';
import { MetadataDB } from '../storage/metadata-db';
import { Embedder } from '../indexer/embedder';
import { Updater } from '../indexer/updater';
import { HybridSearch } from '../retrieval/hybrid';
import { GraphAnalysis } from '../retrieval/graph';
import { QueryCache, FlowEngine, ExplainEngine } from '../intelligence';
import { IndexaConfig } from '../types';
import { readCodeAtOffset } from '../utils';

// --- Config ---

// Accept data dir as CLI arg: node stdio.js --data-dir /path/to/data
function parseArgs(): { dataDir?: string; config?: string } {
  const args = process.argv.slice(2);
  const result: { dataDir?: string; config?: string } = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data-dir' && args[i + 1]) result.dataDir = args[++i];
    if (args[i] === '--config' && args[i + 1]) result.config = args[++i];
  }
  return result;
}

const cliArgs = parseArgs();

const DATA_DIR = cliArgs.dataDir
  || process.env.INDEXA_DATA_DIR
  || path.resolve(__dirname, '..', '..', 'data');

const CONFIG_PATH = cliArgs.config
  || process.env.INDEXA_CONFIG
  || path.resolve(__dirname, '..', '..', 'config', 'indexa.config.json');

function loadConfig(): IndexaConfig {
  const defaults: IndexaConfig = {
    projectRoot: process.cwd(),
    dataDir: DATA_DIR,
    port: 3000,
    embeddingDim: 128,
    defaultTopK: 5,
    defaultTokenBudget: 4000,
    includePatterns: ['*.ts', '*.tsx', '*.js', '*.jsx'],
    excludePatterns: ['node_modules', 'dist', '.git', '*.test.*', '*.spec.*', '*.stories.*', 'public/react-shell/assets', 'public/Scripts', '*.min.js', '*.bundle.js', 'vendor.js', 'polyfills.js', 'angular-mocks', 'e2e'],
  };

  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      return { ...defaults, ...JSON.parse(raw) };
    } catch { /* fall through */ }
  }
  return defaults;
}

// --- Initialize ---

const config = loadConfig();
const vectorDB = new VectorDB(config.dataDir);
const metadataDB = new MetadataDB(config.dataDir);
const embedder = new Embedder();
const search = new HybridSearch(vectorDB, embedder);
const graph = new GraphAnalysis(vectorDB);
const cache = new QueryCache(100, 5);
const flowEngine = new FlowEngine(vectorDB, search);
const explainEngine = new ExplainEngine(graph, search);

const server = new McpServer(
  {
    name: 'indexa',
    version: '3.4.0',
  },
  {
    instructions: `You have access to Indexa, a code intelligence engine that has already indexed this codebase.

IMPORTANT: Always use Indexa tools FIRST before reading files directly. Indexa returns only the relevant symbols, dependencies, and connections — saving 50-70% tokens compared to reading full files.

How to use Indexa:

1. For ANY code question → use indexa_context_bundle FIRST. It returns the relevant code + dependencies + connections within a token budget. This is faster and more accurate than opening files.

2. For "how does X work" / "trace X" → use indexa_flow. It traces call chains across files automatically — no need to open files one by one.

3. For finding code patterns (console.log, TODO, hardcoded strings, specific API calls) → use indexa_code_grep. It searches across all indexed source files with regex. Prefer this over grep/rg for project code searches.

4. For "what uses X" / "where is X used" → use indexa_references. Faster than grep because it uses a pre-built reverse index.

5. For "what breaks if I change X" → use indexa_blast_radius or indexa_impact_chain.

6. For code quality → use indexa_dead_code, indexa_circular_deps, indexa_unused_exports, indexa_duplicates.

7. For security review → use indexa_security_scan.

8. For PR review → use indexa_review_pr.

Only fall back to direct file reading (Read/cat) if Indexa returns no results or you need to see a specific line range that Indexa didn't include.`,
  }
);

/** Guard: returns error text if index is empty, null otherwise */
function emptyIndexGuard(): string | null {
  if (vectorDB.size === 0) {
    return 'Index is empty. Run "indexa setup" or "indexa index <directory>" first to index your codebase.';
  }
  return null;
}

// ============================================================
// TOOL 1 (PRIMARY): indexa_context_bundle
// Query → search → pack with deps + connections
// ============================================================
server.tool(
  'indexa_context_bundle',
  'USE THIS FIRST for any code question — BEFORE reading files. Returns relevant code symbols + dependencies + connections, packed within a token budget. 50-70% fewer tokens than reading full files. Replaces: opening files manually, grep for understanding code.',
  {
    query: z.string().describe('What you are looking for'),
    tokenBudget: z.coerce.number().min(100).default(2000).describe('Max tokens (1000-3000 for focused results)'),
  },
  async ({ query, tokenBudget }) => {
    const empty = emptyIndexGuard();
    if (empty) return { content: [{ type: 'text' as const, text: empty }] };

    const cacheKey = QueryCache.key('bundle', { query, tokenBudget });
    const cached = cache.get<string>(cacheKey);
    if (cached) return { content: [{ type: 'text' as const, text: cached }] };

    const queryIntent = search.getQueryIntent(query);
    const results = await search.directSearch(query, 25);
    if (results.length === 0) {
      return { content: [{ type: 'text' as const, text: `No results for "${query}".` }] };
    }

    const stitched = await explainEngine.stitch(results, tokenBudget);
    const lines: string[] = [];

    // Show intent classification so the LLM knows how results were selected
    if (queryIntent.confidence > 0) {
      lines.push(`Intent: ${queryIntent.intent} (${(queryIntent.confidence * 100).toFixed(0)}% confidence) | Subject: "${queryIntent.subject}"`);
      lines.push('');
    }

    for (const sym of stitched.symbols) {
      lines.push(`=== [${sym.type}] ${sym.name} ===`);
      lines.push(`ID: ${sym.id}`);
      lines.push(`File: ${sym.filePath}:${sym.startLine}-${sym.endLine}`);
      lines.push(`Summary: ${sym.summary}`);
      lines.push('```');
      lines.push(sym.code);
      lines.push('```');
      lines.push('');
    }

    if (stitched.imports.length > 0) {
      lines.push(`--- Dependencies (${stitched.imports.length}) ---`);
      for (const dep of stitched.imports) {
        lines.push(`[${dep.type}] ${dep.name} — ${dep.filePath}:${dep.startLine}-${dep.endLine}`);
        lines.push('```');
        lines.push(dep.code);
        lines.push('```');
        lines.push('');
      }
    }

    if (stitched.connections.length > 0) {
      lines.push(`--- Connections ---`);
      for (const conn of stitched.connections) {
        lines.push(`  ${conn.from} —[${conn.type}]→ ${conn.to}`);
      }
      lines.push('');
    }

    lines.push(`Tokens: ~${stitched.estimatedTokens} / ${tokenBudget}`);

    const text = lines.join('\n');
    cache.set(cacheKey, text);
    return { content: [{ type: 'text' as const, text }] };
  }
);

// ============================================================
// TOOL 2: indexa_flow — Execution flow tracing
// ============================================================
server.tool(
  'indexa_flow',
  'Trace execution flow across files — what calls what, in order. Use this INSTEAD of manually opening files to trace logic. Answers: "how does X work", "trace X", "what happens when X is called".',
  {
    query: z.string().describe('Symbol name, ID, or search query to trace from'),
    depth: z.coerce.number().min(1).max(6).default(3).describe('How many levels deep to trace'),
  },
  async ({ query, depth }) => {
    const empty = emptyIndexGuard();
    if (empty) return { content: [{ type: 'text' as const, text: empty }] };

    const cacheKey = QueryCache.key('flow', { query, depth });
    const cached = cache.get<string>(cacheKey);
    if (cached) return { content: [{ type: 'text' as const, text: cached }] };

    const result = await flowEngine.trace(query, depth);

    if (result.flow.length === 0) {
      return { content: [{ type: 'text' as const, text: `No execution flow found for "${query}".` }] };
    }

    const lines: string[] = [`Execution flow from "${result.entry}" (${result.flow.length} steps):\n`];

    for (const step of result.flow) {
      const indent = '  '.repeat(step.step - 1);
      const callsStr = step.calls.length > 0 ? ` → calls: ${step.calls.join(', ')}` : '';
      lines.push(`${indent}${step.step}. [${step.type}] ${step.name}${callsStr}`);
      lines.push(`${indent}   ${step.summary}`);
      lines.push(`${indent}   ${step.filePath}`);
    }

    const text = lines.join('\n');
    cache.set(cacheKey, text);
    return { content: [{ type: 'text' as const, text }] };
  }
);

// ============================================================
// TOOL 3: indexa_explain — Code explanation
// ============================================================
server.tool(
  'indexa_explain',
  'Explain what an area of code does. Returns a human-readable explanation with step-by-step breakdown, built from actual code — no hallucination.',
  {
    query: z.string().describe('What to explain (e.g. "vendor service area", "authentication flow")'),
    tokenBudget: z.coerce.number().min(100).default(2000).describe('How much code to analyze'),
  },
  async ({ query, tokenBudget }) => {
    const cacheKey = QueryCache.key('explain', { query, tokenBudget });
    const cached = cache.get<string>(cacheKey);
    if (cached) return { content: [{ type: 'text' as const, text: cached }] };

    const result = await explainEngine.explain(query, tokenBudget);

    const lines: string[] = [];
    lines.push(`## Explanation\n`);
    lines.push(result.explanation);
    lines.push('');

    if (result.steps.length > 0) {
      lines.push(`## Steps\n`);
      for (let i = 0; i < result.steps.length; i++) {
        lines.push(`${i + 1}. ${result.steps[i]}`);
      }
      lines.push('');
    }

    if (result.symbolsUsed.length > 0) {
      lines.push(`## Symbols Analyzed (${result.symbolsUsed.length})\n`);
      for (const sym of result.symbolsUsed) {
        lines.push(`  [${sym.type}] ${sym.name} — ${sym.summary}`);
      }
    }

    const text = lines.join('\n');
    cache.set(cacheKey, text);
    return { content: [{ type: 'text' as const, text }] };
  }
);

// ============================================================
// TOOL 4: indexa_search
// ============================================================
server.tool(
  'indexa_search',
  'Smart hybrid search across the indexed codebase. Auto-routes by query type (semantic + keyword + name matching). Returns scored results with code previews. Use indexa_context_bundle instead if you need dependencies and connections.',
  {
    query: z.string().describe('Search query'),
    topK: z.coerce.number().min(1).max(50).default(5).describe('Max results'),
    tokenBudget: z.coerce.number().min(0).default(0).describe('Token budget (0 = use topK)'),
  },
  async ({ query, topK, tokenBudget }) => {
    const budget = tokenBudget > 0 ? tokenBudget : undefined;
    const results = await search.search(query, topK, budget);

    if (results.length === 0) {
      return { content: [{ type: 'text' as const, text: `No results for "${query}".` }] };
    }

    // Cap output to prevent overwhelming the LLM context.
    // Show summary + compact code preview per result.
    const MAX_CODE_BYTES = 2000;  // Read at most 2KB per chunk
    const MAX_CODE_LINES = 12;
    const MAX_RESULTS = 10;
    const MAX_TOTAL_CHARS = 12000;
    let totalChars = 0;

    const capped = results.slice(0, MAX_RESULTS);
    const output = capped.map((r, i) => {
      if (totalChars > MAX_TOTAL_CHARS) return null;

      const score = (r.score * 100).toFixed(1);
      // Cap byte read to prevent loading huge minified chunks
      const readLen = Math.min(r.chunk.byteLength, MAX_CODE_BYTES);
      const code = readCodeAtOffset(r.chunk.filePath, r.chunk.byteOffset, readLen);
      const lines = code ? code.split('\n') : [];
      const codePreview = lines.length > 0
        ? lines.slice(0, MAX_CODE_LINES).join('\n') + (lines.length > MAX_CODE_LINES ? `\n... (+${lines.length - MAX_CODE_LINES} lines)` : '')
        : '(source unavailable)';

      const entry = [
        `--- Result ${i + 1} (${score}%) ---`,
        `[${r.chunk.type}] ${r.chunk.name}`,
        `File: ${r.chunk.filePath}:${r.chunk.startLine}-${r.chunk.endLine}`,
        `Summary: ${r.chunk.summary}`,
        `\`\`\`\n${codePreview}\n\`\`\``,
      ].join('\n');

      totalChars += entry.length;
      return entry;
    }).filter(Boolean).join('\n\n');

    const shown = output.split('--- Result').length - 1;
    const footer = `\n\n${shown}/${results.length} results for "${query}" (~${totalChars} chars)`;
    return { content: [{ type: 'text' as const, text: output + footer }] };
  }
);

// ============================================================
// TOOL 5: indexa_symbol
// ============================================================
server.tool(
  'indexa_symbol',
  'Look up a symbol by stable ID or name.',
  {
    name: z.string().describe('Symbol name or stable ID'),
  },
  async ({ name }) => {
    const direct = vectorDB.get(name);
    if (direct) {
      const code = readCodeAtOffset(direct.filePath, direct.byteOffset, direct.byteLength);
      return {
        content: [{
          type: 'text' as const,
          text: [
            `[${direct.type}] ${direct.name}`,
            `ID: ${direct.id}`,
            `File: ${direct.filePath}:${direct.startLine}-${direct.endLine}`,
            `Summary: ${direct.summary}`,
            `Dependencies: ${direct.dependencies.slice(0, 10).join(', ') || 'none'}`,
            code ? `\`\`\`\n${code}\n\`\`\`` : '(source unavailable)',
          ].join('\n'),
        }],
      };
    }

    const matches = vectorDB.findByName(name);
    if (matches.length === 0) {
      return { content: [{ type: 'text' as const, text: `No symbol matching "${name}".` }] };
    }

    const output = matches.slice(0, 10).map(c => {
      const code = readCodeAtOffset(c.filePath, c.byteOffset, c.byteLength);
      return [
        `[${c.type}] ${c.name}`,
        `ID: ${c.id}`,
        `File: ${c.filePath}:${c.startLine}-${c.endLine}`,
        code ? `\`\`\`\n${code}\n\`\`\`` : '',
      ].join('\n');
    }).join('\n\n---\n\n');

    return { content: [{ type: 'text' as const, text: `${matches.length} matches:\n\n${output}` }] };
  }
);

// ============================================================
// TOOL 6: indexa_file
// ============================================================
server.tool(
  'indexa_file',
  'Get all indexed symbols in a file. Outline by default, full code with include_code=true.',
  {
    path: z.string().describe('File path (absolute or partial)'),
    include_code: z.boolean().default(false).describe('Include source code'),
  },
  async ({ path: filePath, include_code }) => {
    const chunks = vectorDB.getByFile(filePath);
    if (chunks.length === 0) {
      return { content: [{ type: 'text' as const, text: `No indexed symbols in "${filePath}".` }] };
    }

    let output: string;
    if (include_code) {
      output = chunks.map(c => {
        const code = readCodeAtOffset(c.filePath, c.byteOffset, c.byteLength);
        return `[${c.type}] ${c.name} (L${c.startLine}-${c.endLine})\n\`\`\`\n${code}\n\`\`\``;
      }).join('\n\n');
    } else {
      output = chunks.map(c =>
        `  ${c.type.padEnd(12)} ${c.name} (L${c.startLine}-${c.endLine}) — ${c.summary}`
      ).join('\n');
    }

    return {
      content: [{
        type: 'text' as const,
        text: `File: ${chunks[0].filePath}\nSymbols (${chunks.length}):\n\n${output}`,
      }],
    };
  }
);

// ============================================================
// TOOL 7: indexa_references
// ============================================================
server.tool(
  'indexa_references',
  'Find all references to a symbol + blast radius. Use this INSTEAD of grep when asked "where is X used", "who calls X". Uses pre-built reverse index — faster and more accurate than text search.',
  {
    name: z.string().describe('Symbol name'),
  },
  async ({ name }) => {
    const refs = graph.findReferences(name);
    if (refs.length === 0) {
      return { content: [{ type: 'text' as const, text: `No references to "${name}".` }] };
    }

    const blast = graph.getBlastRadius(name);
    const output = [
      `References to "${name}": ${refs.length} direct, ${blast.transitiveRefs} files affected`,
      '',
      ...refs.slice(0, 25).map(c =>
        `  [${c.type}] ${c.name} — ${c.filePath}:${c.startLine}`
      ),
      refs.length > 25 ? `  ... and ${refs.length - 25} more` : '',
    ].join('\n');

    return { content: [{ type: 'text' as const, text: output }] };
  }
);

// ============================================================
// TOOL 8: indexa_index
// ============================================================
server.tool(
  'indexa_index',
  'Index or re-index a codebase directory.',
  {
    directory: z.string().describe('Absolute path to directory'),
  },
  async ({ directory }) => {
    const absDir = path.resolve(directory);
    if (!fs.existsSync(absDir)) {
      return { content: [{ type: 'text' as const, text: `Directory not found: ${absDir}` }] };
    }

    const updater = new Updater(
      { ...config, projectRoot: absDir },
      vectorDB, metadataDB, embedder
    );

    const result = await updater.indexAll(absDir);
    cache.clear(); // Invalidate cache after re-index
    return {
      content: [{
        type: 'text' as const,
        text: `Indexed ${result.indexed} files → ${result.chunks} chunks. Total: ${vectorDB.size}`,
      }],
    };
  }
);

// ============================================================
// TOOL 9: indexa_stats
// ============================================================
server.tool(
  'indexa_stats',
  'Index statistics and cache status.',
  {},
  async () => {
    const files = metadataDB.getAllFiles();
    return {
      content: [{
        type: 'text' as const,
        text: [
          `Chunks: ${vectorDB.size}`,
          `Files: ${metadataDB.size}`,
          `Cache: ${cache.size} entries`,
          `Data: ${config.dataDir}`,
          '',
          `Files (first 30):`,
          ...files.slice(0, 30).map(f => `  ${f}`),
          files.length > 30 ? `  ... +${files.length - 30} more` : '',
        ].join('\n'),
      }],
    };
  }
);

// ============================================================
// TOOL 10: indexa_dead_code — Find unreferenced symbols
// ============================================================
server.tool(
  'indexa_dead_code',
  'Find dead code: functions, methods, and classes that are never referenced by other symbols. Useful for cleanup and reducing bundle size.',
  {
    includeEntryPoints: z.boolean().default(false).describe('Include controllers/components/services (usually wired by frameworks)'),
  },
  async ({ includeEntryPoints }) => {
    const dead = graph.findDeadCode({ includeEntryPoints });

    if (dead.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No dead code found.' }] };
    }

    // Group by file
    const byFile = new Map<string, typeof dead>();
    for (const d of dead) {
      const list = byFile.get(d.chunk.filePath) || [];
      list.push(d);
      byFile.set(d.chunk.filePath, list);
    }

    const lines: string[] = [`# Dead Code Report — ${dead.length} unreferenced symbols\n`];

    for (const [filePath, items] of byFile) {
      const shortFile = filePath.replace(/.*[/\\](src|public)[/\\]/, '$1/').replace(/\\/g, '/');
      lines.push(`## ${shortFile}`);
      for (const item of items) {
        lines.push(`  - [${item.chunk.type}] ${item.chunk.name} (L${item.chunk.startLine}-${item.chunk.endLine}) — ${item.reason}`);
      }
      lines.push('');
    }

    lines.push(`\nTotal: ${dead.length} symbols across ${byFile.size} files.`);
    lines.push('Tip: Verify before deleting — some may be used via dynamic imports, reflection, or external entry points.');

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  }
);

// ============================================================
// TOOL 11: indexa_blast_radius — Impact analysis for a symbol
// ============================================================
server.tool(
  'indexa_blast_radius',
  'Estimate blast radius: what breaks if a symbol changes? Shows direct refs, transitive impact, and affected files.',
  {
    name: z.string().describe('Symbol name to analyze'),
  },
  async ({ name }) => {
    const blast = graph.getBlastRadius(name);
    const directRefs = graph.findReferences(name);

    if (blast.directRefs === 0) {
      return { content: [{ type: 'text' as const, text: `No references to "${name}" found. Safe to modify or remove.` }] };
    }

    const lines: string[] = [
      `# Blast Radius: ${name}`,
      '',
      `Direct references: ${blast.directRefs}`,
      `Files affected (transitive): ${blast.transitiveRefs}`,
      '',
      `## Direct References`,
      ...directRefs.slice(0, 30).map(c =>
        `  [${c.type}] ${c.name} — ${c.filePath.replace(/.*[/\\](src|public)[/\\]/, '$1/').replace(/\\/g, '/')}:${c.startLine}`
      ),
      directRefs.length > 30 ? `  ... and ${directRefs.length - 30} more` : '',
      '',
      `## Affected Files`,
      ...blast.files.slice(0, 20).map(f => `  ${f.replace(/.*[/\\](src|public)[/\\]/, '$1/').replace(/\\/g, '/')}`),
      blast.files.length > 20 ? `  ... and ${blast.files.length - 20} more` : '',
    ];

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  }
);

// ============================================================
// TOOL 12: indexa_importers — Who imports from this file?
// ============================================================
server.tool(
  'indexa_importers',
  'Find all symbols that import from a given file. Answers "who depends on this file?"',
  {
    path: z.string().describe('File path (absolute or partial)'),
  },
  async ({ path: filePath }) => {
    const importers = graph.findImporters(filePath);

    if (importers.length === 0) {
      return { content: [{ type: 'text' as const, text: `No symbols import from "${filePath}".` }] };
    }

    const byFile = new Map<string, typeof importers>();
    for (const imp of importers) {
      const list = byFile.get(imp.filePath) || [];
      list.push(imp);
      byFile.set(imp.filePath, list);
    }

    const lines: string[] = [
      `# Importers of ${filePath.replace(/.*[/\\](src|public)[/\\]/, '$1/').replace(/\\/g, '/')}`,
      `${importers.length} symbols across ${byFile.size} files`,
      '',
    ];

    for (const [file, chunks] of byFile) {
      const shortFile = file.replace(/.*[/\\](src|public)[/\\]/, '$1/').replace(/\\/g, '/');
      lines.push(`## ${shortFile}`);
      for (const c of chunks) {
        lines.push(`  [${c.type}] ${c.name} (L${c.startLine})`);
      }
      lines.push('');
    }

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  }
);

// ============================================================
// TOOL 13: indexa_circular_deps — Circular dependency detection
// ============================================================
server.tool(
  'indexa_circular_deps',
  'Detect circular dependencies between files. Circular imports can cause runtime bugs, bundle issues, and make code hard to maintain.',
  {},
  async () => {
    const cycles = graph.findCircularDependencies();

    if (cycles.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No circular dependencies found.' }] };
    }

    const lines: string[] = [`# Circular Dependencies — ${cycles.length} cycles detected\n`];

    for (let i = 0; i < cycles.length; i++) {
      const cycle = cycles[i];
      const shortPaths = cycle.cycle.map(f =>
        f.replace(/.*[/\\](src|public)[/\\]/, '$1/').replace(/\\/g, '/')
      );
      lines.push(`## Cycle ${i + 1} (${cycle.files.length} files)`);
      lines.push(`  ${shortPaths.join(' → ')}`);
      lines.push('');
    }

    lines.push('Tip: Break cycles by extracting shared code into a separate module, or use dependency injection.');

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  }
);

// ============================================================
// TOOL 14: indexa_unused_exports — Find exports nobody imports
// ============================================================
server.tool(
  'indexa_unused_exports',
  'Find exported symbols (types, constants, exports) that no other file imports. Helps reduce public API surface and dead exports.',
  {},
  async () => {
    const unused = graph.findUnusedExports();

    if (unused.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No unused exports found.' }] };
    }

    const byFile = new Map<string, typeof unused>();
    for (const u of unused) {
      const list = byFile.get(u.chunk.filePath) || [];
      list.push(u);
      byFile.set(u.chunk.filePath, list);
    }

    const lines: string[] = [`# Unused Exports — ${unused.length} symbols\n`];

    for (const [filePath, items] of byFile) {
      const shortFile = filePath.replace(/.*[/\\](src|public)[/\\]/, '$1/').replace(/\\/g, '/');
      lines.push(`## ${shortFile}`);
      for (const item of items) {
        lines.push(`  - [${item.chunk.type}] ${item.exportedName} (L${item.chunk.startLine})`);
      }
      lines.push('');
    }

    lines.push('Tip: Unused exports may still be used by external consumers. Verify before removing.');

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  }
);

// ============================================================
// TOOL 15: indexa_duplicates — Find near-duplicate code
// ============================================================
server.tool(
  'indexa_duplicates',
  'Find near-duplicate code across files using embedding similarity. Helps identify copy-paste patterns and refactoring opportunities.',
  {
    threshold: z.coerce.number().min(0.8).max(0.99).default(0.92).describe('Similarity threshold (0.8-0.99, default 0.92). Lower = more results.'),
  },
  async ({ threshold }) => {
    const dupes = graph.findDuplicates(threshold);

    if (dupes.length === 0) {
      return { content: [{ type: 'text' as const, text: `No duplicates found above ${(threshold * 100).toFixed(0)}% similarity.` }] };
    }

    const lines: string[] = [`# Code Duplicates — ${dupes.length} pairs above ${(threshold * 100).toFixed(0)}% similarity\n`];

    for (let i = 0; i < Math.min(dupes.length, 20); i++) {
      const d = dupes[i];
      const shortA = d.a.filePath.replace(/.*[/\\](src|public)[/\\]/, '$1/').replace(/\\/g, '/');
      const shortB = d.b.filePath.replace(/.*[/\\](src|public)[/\\]/, '$1/').replace(/\\/g, '/');

      lines.push(`## Pair ${i + 1} — ${(d.similarity * 100).toFixed(1)}% similar`);
      lines.push(`  A: [${d.a.type}] ${d.a.name} — ${shortA}:${d.a.startLine}-${d.a.endLine}`);
      lines.push(`  B: [${d.b.type}] ${d.b.name} — ${shortB}:${d.b.startLine}-${d.b.endLine}`);
      lines.push('');
    }

    if (dupes.length > 20) {
      lines.push(`... and ${dupes.length - 20} more pairs`);
    }

    lines.push('\nTip: Consider extracting duplicated logic into a shared utility function.');

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  }
);

// ============================================================
// TOOL 16: indexa_impact_chain — Deep transitive impact analysis
// ============================================================
server.tool(
  'indexa_impact_chain',
  'Full transitive impact analysis: trace every symbol affected if a given symbol changes, across all depths. More thorough than blast_radius.',
  {
    name: z.string().describe('Symbol name to analyze'),
    depth: z.coerce.number().min(1).max(10).default(5).describe('Max depth to trace (1-10, default 5)'),
  },
  async ({ name, depth }) => {
    const impact = graph.getFullImpactChain(name, depth);

    if (impact.totalAffected === 0) {
      return { content: [{ type: 'text' as const, text: `No impact found for "${name}". Safe to modify.` }] };
    }

    const lines: string[] = [
      `# Full Impact Chain: ${name}`,
      '',
      `Direct references: ${impact.directRefs}`,
      `Total symbols affected: ${impact.totalAffected}`,
      `Files affected: ${impact.files.length}`,
      '',
      '## Impact Chain (by depth)',
    ];

    // Group by depth
    const byDepth = new Map<number, typeof impact.chain>();
    for (const item of impact.chain) {
      const list = byDepth.get(item.depth) || [];
      list.push(item);
      byDepth.set(item.depth, list);
    }

    for (const [d, items] of byDepth) {
      lines.push(`\n### Depth ${d} (${items.length} symbols)`);
      for (const item of items.slice(0, 15)) {
        const shortFile = item.filePath.replace(/.*[/\\](src|public)[/\\]/, '$1/').replace(/\\/g, '/');
        lines.push(`  [${item.type}] ${item.name} — ${shortFile}`);
      }
      if (items.length > 15) lines.push(`  ... +${items.length - 15} more`);
    }

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  }
);

// ============================================================
// TOOL 17: indexa_review_pr — Context-aware PR review
// ============================================================
server.tool(
  'indexa_review_pr',
  'Get context for reviewing the current PR/recent changes. Reads git diff, finds changed symbols, builds context bundles for each. Use this before doing a code review.',
  {
    tokenBudget: z.coerce.number().min(500).default(4000).describe('Token budget for context'),
  },
  async ({ tokenBudget }) => {
    // Get changed files from git
    let gitOutput: string;
    try {
      const { execSync } = require('child_process');
      gitOutput = execSync('git diff --name-only HEAD~1', {
        cwd: config.projectRoot,
        encoding: 'utf-8',
      });
    } catch {
      return { content: [{ type: 'text' as const, text: 'Could not read git diff. Are you in a git repository with commits?' }] };
    }

    const changedFiles = gitOutput.split('\n').filter(f => f.trim()).filter(f =>
      f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.js') || f.endsWith('.jsx')
    );

    if (changedFiles.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No changed TS/JS files in the latest commit.' }] };
    }

    const lines: string[] = [
      `# PR Review Context — ${changedFiles.length} changed files`,
      '',
    ];

    // Find all indexed symbols in changed files
    const changedSymbols: string[] = [];
    for (const file of changedFiles) {
      const absPath = require('path').resolve(config.projectRoot, file);
      const chunks = vectorDB.getByFile(absPath);
      if (chunks.length > 0) {
        lines.push(`## ${file} (${chunks.length} symbols)`);
        for (const c of chunks.slice(0, 5)) {
          lines.push(`  [${c.type}] ${c.name} (L${c.startLine}-${c.endLine}) — ${c.summary}`);
          changedSymbols.push(c.name);
        }
        if (chunks.length > 5) lines.push(`  ... +${chunks.length - 5} more`);

        // Show blast radius for each changed symbol
        for (const c of chunks.slice(0, 3)) {
          const blast = graph.getBlastRadius(c.name);
          if (blast.directRefs > 0) {
            lines.push(`  Impact: ${c.name} → ${blast.directRefs} direct refs, ${blast.transitiveRefs} files affected`);
          }
        }
        lines.push('');
      } else {
        lines.push(`## ${file} (not indexed)`);
        lines.push('');
      }
    }

    // Build context bundle for the changed symbols
    if (changedSymbols.length > 0) {
      const query = changedSymbols.slice(0, 5).join(' ');
      const results = await search.directSearch(query, 15);
      const stitched = await explainEngine.stitch(results, tokenBudget);

      if (stitched.connections.length > 0) {
        lines.push(`## Key Connections`);
        for (const conn of stitched.connections) {
          lines.push(`  ${conn.from} —[${conn.type}]→ ${conn.to}`);
        }
        lines.push('');
      }
    }

    lines.push('---');
    lines.push('Review these changes for: bugs, security issues, performance impact, and breaking changes to dependents.');

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  }
);

// ============================================================
// TOOL 18: indexa_security_scan — File-level deep security analysis
// Returns FULL code for security-relevant files, grouped by domain,
// so the LLM can do deep analysis (like Claude's Agent:Scan).
// ============================================================

// Security domains: what to look for and where
const SECURITY_DOMAINS: Record<string, {
  label: string;
  description: string;
  namePatterns: RegExp[];
  pathPatterns: RegExp[];
  codePatterns: RegExp[];
}> = {
  auth: {
    label: 'Authentication & Session',
    description: 'Login, logout, token exchange, session management, JWT handling, cookie management',
    namePatterns: [/auth/i, /login/i, /logout/i, /session/i, /token/i, /credential/i, /jwt/i, /pkce/i, /oauth/i, /bearer/i, /principal/i],
    pathPatterns: [/auth/i, /login/i, /session/i],
    codePatterns: [/localStorage|sessionStorage|cookie|Bearer|Authorization|withCredentials|token|password/i],
  },
  access: {
    label: 'Access Control & Permissions',
    description: 'Permission checks, role-based access, admin guards, route protection',
    namePatterns: [/permission/i, /guard/i, /role/i, /access/i, /admin/i, /canEdit|canDelete|canAccess/i, /isAdmin/i],
    pathPatterns: [/permission/i, /guard/i, /role/i],
    codePatterns: [/isAdmin|hasPermission|canAccess|permission.*=.*(?:true|false)/i],
  },
  api: {
    label: 'API & Data Exposure',
    description: 'HTTP clients, API endpoints, request/response handling, CORS, error responses',
    namePatterns: [/axios|http|fetch|client|interceptor|cors/i, /api.*base|base.*url/i],
    pathPatterns: [/axiosClient|httpClient|apiClient/i, /interceptor/i],
    codePatterns: [/withCredentials|Access-Control|\.post\(|\.get\(|\.put\(|\.delete\(/i],
  },
  injection: {
    label: 'Injection & XSS',
    description: 'innerHTML, dangerouslySetInnerHTML, eval, dynamic HTML, URL construction',
    namePatterns: [/sanitize|escape|encode|decode|html/i],
    pathPatterns: [/sanitize/i],
    codePatterns: [/innerHTML|dangerouslySetInnerHTML|eval\s*\(|document\.write|new\s+Function/i],
  },
  secrets: {
    label: 'Secrets & Configuration',
    description: 'API keys, hardcoded URLs, environment variables, config files',
    namePatterns: [/config|env|secret|key|url|base|domain/i],
    pathPatterns: [/config|\.env|auth0/i],
    codePatterns: [/api[_-]?key|secret|password.*=.*['"]|https?:\/\/[a-z]+\.(sgpdev|safeguard)/i],
  },
  crypto: {
    label: 'Cryptographic Operations',
    description: 'Hashing, encryption, JWT validation, token verification',
    namePatterns: [/hash|crypt|sign|verify|jwt|encode|decode/i],
    pathPatterns: [/crypto|jwt/i],
    codePatterns: [/crypto|\.sign\(|\.verify\(|isRealJwt|hashContent/i],
  },
};

server.tool(
  'indexa_security_scan',
  'Deep file-level security scan. Returns FULL code for all security-relevant symbols grouped by security domain (auth, access control, API, injection, secrets, crypto). Designed for LLM deep analysis — use this, then analyze each domain for vulnerabilities.',
  {
    domain: z.string().optional().describe('Security domain to scan: auth, access, api, injection, secrets, crypto, or "all" (default). Use one domain at a time for deep analysis.'),
    tokenBudget: z.coerce.number().optional().describe('Max tokens per domain (default 8000). Higher = more complete code.'),
  },
  async ({ domain, tokenBudget }) => {
    const budget = tokenBudget || 8000;
    const domainsToScan = domain && domain !== 'all'
      ? { [domain]: SECURITY_DOMAINS[domain] }
      : SECURITY_DOMAINS;

    if (domain && domain !== 'all' && !SECURITY_DOMAINS[domain]) {
      return { content: [{ type: 'text' as const, text: `Unknown domain "${domain}". Available: ${Object.keys(SECURITY_DOMAINS).join(', ')}` }] };
    }

    const chunks = vectorDB.getAll();
    const output: string[] = [`# Security Scan — ${chunks.length} symbols analyzed\n`];

    let totalFindings = 0;

    for (const [domainKey, domainDef] of Object.entries(domainsToScan)) {
      if (!domainDef) continue;

      // Find all security-relevant chunks for this domain
      const matches: Array<{ chunk: typeof chunks[0]; score: number; matchReason: string }> = [];

      for (const chunk of chunks) {
        let score = 0;
        const reasons: string[] = [];

        // Check name patterns
        for (const p of domainDef.namePatterns) {
          if (p.test(chunk.name)) { score += 3; reasons.push(`name: ${chunk.name}`); break; }
        }

        // Check path patterns
        for (const p of domainDef.pathPatterns) {
          if (p.test(chunk.filePath)) { score += 2; reasons.push(`path`); break; }
        }

        // Check code content
        const code = readCodeAtOffset(chunk.filePath, chunk.byteOffset, Math.min(chunk.byteLength, 3000));
        if (code) {
          for (const p of domainDef.codePatterns) {
            if (p.test(code)) { score += 2; reasons.push(`code pattern`); break; }
          }
        }

        if (score > 0) {
          matches.push({ chunk, score, matchReason: reasons.join(', ') });
        }
      }

      // Sort by relevance and deduplicate by file (max 3 per file)
      matches.sort((a, b) => b.score - a.score);
      const fileCount = new Map<string, number>();
      const filtered = matches.filter(m => {
        const count = fileCount.get(m.chunk.filePath) || 0;
        if (count >= 3) return false;
        fileCount.set(m.chunk.filePath, count + 1);
        return true;
      });

      if (filtered.length === 0) continue;

      totalFindings += filtered.length;

      output.push(`## ${domainDef.label} (${filtered.length} symbols)`);
      output.push(`> ${domainDef.description}`);
      output.push('');

      // Pack symbols within budget
      let domainTokens = 0;
      let symbolsIncluded = 0;

      for (const match of filtered) {
        const code = readCodeAtOffset(match.chunk.filePath, match.chunk.byteOffset, match.chunk.byteLength);
        if (!code) continue;

        const codeTokens = Math.ceil(code.length / 4);
        if (domainTokens + codeTokens > budget && symbolsIncluded > 0) {
          output.push(`... +${filtered.length - symbolsIncluded} more symbols in this domain (increase tokenBudget to see all)\n`);
          break;
        }

        const shortFile = match.chunk.filePath
          .replace(/.*[/\\](src|public|react-shell)[/\\]/, '$1/')
          .replace(/\\/g, '/');

        output.push(`### ${match.chunk.name} (${match.chunk.type})`);
        output.push(`File: ${shortFile}:${match.chunk.startLine}-${match.chunk.endLine} | Matched: ${match.matchReason}`);
        output.push('```');
        output.push(code);
        output.push('```');
        output.push('');

        domainTokens += codeTokens;
        symbolsIncluded++;
      }
    }

    if (totalFindings === 0) {
      output.push('No security-relevant symbols found.');
    }

    // Add analysis instructions for the LLM
    output.push('---');
    output.push('## Analysis Instructions');
    output.push('For each symbol above, check for:');
    output.push('- **A01 Broken Access Control**: Missing auth checks, IDOR, privilege escalation');
    output.push('- **A02 Cryptographic Failures**: Hardcoded secrets, weak algorithms, plaintext tokens');
    output.push('- **A03 Injection**: XSS via innerHTML, eval(), template injection, SQL injection');
    output.push('- **A05 Security Misconfiguration**: Dev mode in production, permissive CORS, verbose errors');
    output.push('- **A07 Auth Failures**: Weak session management, missing logout, insecure cookie flags');
    output.push('- **A09 Logging Failures**: Sensitive data in console.log');
    output.push('');
    output.push('For each finding provide: Severity, CWE ID, OWASP category, vulnerable code, fix, and blast radius.');

    return { content: [{ type: 'text' as const, text: output.join('\n') }] };
  }
);

// ============================================================
// TOOL 19: indexa_code_grep — Regex pattern search over indexed code
// ============================================================
server.tool(
  'indexa_code_grep',
  'Regex pattern search across all indexed source files. Use this INSTEAD of grep/rg for searching project code — it automatically skips node_modules, dist, and build artifacts. For: console.log, TODO, hardcoded strings, API calls, any literal pattern.',
  {
    pattern: z.string().describe('Regex pattern to search for (e.g., "console\\.log", "TODO|FIXME", "http://localhost")'),
    filePattern: z.string().optional().describe('Filter files by path pattern (e.g., "src/features", ".tsx"). Leave empty for all indexed files.'),
    maxResults: z.coerce.number().min(1).max(200).default(50).describe('Max matches to return (default 50)'),
    contextLines: z.coerce.number().min(0).max(5).default(1).describe('Lines of context around each match (default 1)'),
  },
  async ({ pattern, filePattern, maxResults, contextLines }) => {
    const empty = emptyIndexGuard();
    if (empty) return { content: [{ type: 'text' as const, text: empty }] };

    let regex: RegExp;
    try {
      regex = new RegExp(pattern, 'gi');
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Invalid regex: ${err instanceof Error ? err.message : err}` }] };
    }

    // Get all indexed file paths
    const allFiles = vectorDB.getFilePaths();
    const filesToSearch = filePattern
      ? allFiles.filter(f => f.replace(/\\/g, '/').toLowerCase().includes(filePattern.toLowerCase()))
      : allFiles;

    if (filesToSearch.length === 0) {
      return { content: [{ type: 'text' as const, text: `No indexed files match "${filePattern || '*'}".` }] };
    }

    const results: Array<{
      file: string;
      matches: Array<{ line: number; text: string; context: string[] }>;
    }> = [];
    let totalMatches = 0;

    for (const filePath of filesToSearch) {
      if (totalMatches >= maxResults) break;

      let content: string;
      try {
        const fs = require('fs');
        if (!fs.existsSync(filePath)) continue;
        const raw = fs.readFileSync(filePath);
        // Skip binary files
        if (raw.subarray(0, 4096).includes(0)) continue;
        content = raw.toString('utf-8');
      } catch {
        continue;
      }

      const lines = content.split('\n');
      const fileMatches: Array<{ line: number; text: string; context: string[] }> = [];

      for (let i = 0; i < lines.length; i++) {
        if (totalMatches >= maxResults) break;

        regex.lastIndex = 0;
        if (regex.test(lines[i])) {
          // Gather context lines
          const ctxStart = Math.max(0, i - contextLines);
          const ctxEnd = Math.min(lines.length - 1, i + contextLines);
          const context: string[] = [];
          for (let c = ctxStart; c <= ctxEnd; c++) {
            const prefix = c === i ? '> ' : '  ';
            context.push(`${prefix}${c + 1}: ${lines[c]}`);
          }

          fileMatches.push({
            line: i + 1,
            text: lines[i].trim(),
            context,
          });
          totalMatches++;
        }
      }

      if (fileMatches.length > 0) {
        results.push({ file: filePath, matches: fileMatches });
      }
    }

    if (results.length === 0) {
      return { content: [{ type: 'text' as const, text: `No matches for /${pattern}/ in ${filesToSearch.length} files.` }] };
    }

    // Format output
    const output: string[] = [
      `# Code Grep: /${pattern}/`,
      `${totalMatches} matches in ${results.length} files (searched ${filesToSearch.length} files)`,
      '',
    ];

    for (const result of results) {
      const shortFile = result.file.replace(/.*[/\\](src|public|react-shell)[/\\]/, '$1/').replace(/\\/g, '/');
      output.push(`## ${shortFile} (${result.matches.length} matches)`);

      for (const match of result.matches) {
        output.push(`\`\`\``);
        for (const line of match.context) {
          output.push(line);
        }
        output.push(`\`\`\``);
      }
      output.push('');
    }

    if (totalMatches >= maxResults) {
      output.push(`--- Showing first ${maxResults} matches. Increase maxResults for more. ---`);
    }

    return { content: [{ type: 'text' as const, text: output.join('\n') }] };
  }
);

// --- Start ---

async function main() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (err) {
    process.stderr.write(`[Indexa] Failed to start MCP server: ${err}\n`);
    process.stderr.write(`[Indexa] Data dir: ${config.dataDir}\n`);
    process.stderr.write(`[Indexa] Config: ${CONFIG_PATH}\n`);

    // Check common issues and give specific guidance
    const fs = require('fs');
    if (!fs.existsSync(config.dataDir)) {
      process.stderr.write(`[Indexa] Data directory does not exist. Run: indexa setup\n`);
    }

    process.exit(1);
  }
}

// Handle uncaught errors gracefully — log and continue where possible
process.on('uncaughtException', (err) => {
  process.stderr.write(`[Indexa] Uncaught error: ${err.message}\n`);
  process.stderr.write(`[Indexa] Stack: ${err.stack}\n`);
  // Don't exit — let the MCP server try to continue
});

process.on('unhandledRejection', (reason) => {
  process.stderr.write(`[Indexa] Unhandled rejection: ${reason}\n`);
});

main().catch((err) => {
  process.stderr.write(`[Indexa] Fatal startup error: ${err}\n`);
  process.exit(1);
});
