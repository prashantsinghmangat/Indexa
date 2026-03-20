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

const server = new McpServer({
  name: 'indexa',
  version: '3.0.0',
});

// ============================================================
// TOOL 1 (PRIMARY): indexa_context_bundle
// Query → search → pack with deps + connections
// ============================================================
server.tool(
  'indexa_context_bundle',
  'PRIMARY TOOL. Returns relevant code symbols packed within a token budget, with dependencies and connections between symbols. Use this first for any code question.',
  {
    query: z.string().describe('What you are looking for'),
    tokenBudget: z.coerce.number().min(100).default(2000).describe('Max tokens (1000-3000 for focused results)'),
  },
  async ({ query, tokenBudget }) => {
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
  'Trace execution flow from a symbol or query. Shows the call chain across functions and files — what calls what, in order.',
  {
    query: z.string().describe('Symbol name, ID, or search query to trace from'),
    depth: z.coerce.number().min(1).max(6).default(3).describe('How many levels deep to trace'),
  },
  async ({ query, depth }) => {
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
  'Search the indexed codebase. Auto-routes by query type. Use indexa_context_bundle for code + deps, indexa_explain for understanding.',
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

    const output = results.map((r, i) => {
      const score = (r.score * 100).toFixed(1);
      const code = readCodeAtOffset(r.chunk.filePath, r.chunk.byteOffset, r.chunk.byteLength);
      return [
        `--- Result ${i + 1} (${score}%) ---`,
        `ID: ${r.chunk.id}`,
        `[${r.chunk.type}] ${r.chunk.name}`,
        `File: ${r.chunk.filePath}:${r.chunk.startLine}-${r.chunk.endLine}`,
        `Summary: ${r.chunk.summary}`,
        code ? `\`\`\`\n${code}\n\`\`\`` : '(source unavailable)',
      ].join('\n');
    }).join('\n\n');

    return { content: [{ type: 'text' as const, text: output }] };
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
  'Find all references to a symbol + blast radius.',
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

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Indexa MCP error: ${err}\n`);
  process.exit(1);
});
