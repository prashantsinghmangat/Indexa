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
import { IndexaConfig } from '../types';
import { readCodeAtOffset } from '../utils';

// --- Config ---

const DATA_DIR = process.env.INDEXA_DATA_DIR
  || path.resolve(__dirname, '..', '..', 'data');

const CONFIG_PATH = process.env.INDEXA_CONFIG
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
    excludePatterns: ['node_modules', 'dist', '.git', '*.test.*', '*.spec.*'],
  };

  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      return { ...defaults, ...JSON.parse(raw) };
    } catch {
      // fall through
    }
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

const server = new McpServer({
  name: 'indexa',
  version: '2.1.0',
});

// ============================================================
// TOOL 1 (PRIMARY): indexa_context_bundle
// The main tool LLMs should use. Query → search → pack with deps.
// ============================================================
server.tool(
  'indexa_context_bundle',
  `PRIMARY TOOL. Given a query, returns the most relevant code symbols packed within a token budget, including 1-level dependencies. Use this as your first tool for any code question.`,
  {
    query: z.string().describe('What you are looking for (e.g. "vendor service area logic", "updateServiceArea", "authentication flow")'),
    tokenBudget: z.number().min(100).default(2000).describe('Max tokens to return. Keep small (1000-3000) for focused results.'),
  },
  async ({ query, tokenBudget }) => {
    // Search with extra candidates for bundle packing
    const results = await search.directSearch(query, 15);

    if (results.length === 0) {
      return { content: [{ type: 'text' as const, text: `No results for "${query}".` }] };
    }

    const bundle = graph.buildQueryBundle(results, tokenBudget);

    const lines: string[] = [];

    for (const sym of bundle.symbols) {
      lines.push(`=== [${sym.type}] ${sym.name} ===`);
      lines.push(`ID: ${sym.id}`);
      lines.push(`File: ${sym.filePath}:${sym.startLine}-${sym.endLine}`);
      lines.push(`Summary: ${sym.summary}`);
      lines.push('```');
      lines.push(sym.code);
      lines.push('```');
      lines.push('');
    }

    if (bundle.imports.length > 0) {
      lines.push(`--- Dependencies (${bundle.imports.length}) ---`);
      for (const dep of bundle.imports) {
        lines.push(`[${dep.type}] ${dep.name} — ${dep.filePath}:${dep.startLine}-${dep.endLine}`);
        lines.push('```');
        lines.push(dep.code);
        lines.push('```');
        lines.push('');
      }
    }

    lines.push(`Tokens used: ~${bundle.estimatedTokens} / ${tokenBudget}`);

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  }
);

// ============================================================
// TOOL 2: indexa_search
// Raw search results when you need scores and ranking info.
// ============================================================
server.tool(
  'indexa_search',
  'Search the indexed codebase. Auto-routes: identifiers → symbol lookup, short queries → keyword, else → hybrid. Use indexa_context_bundle instead if you want code + deps.',
  {
    query: z.string().describe('Search query'),
    topK: z.number().min(1).max(50).default(5).describe('Max results'),
    tokenBudget: z.number().min(0).default(0).describe('Token budget (0 = use topK)'),
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
// TOOL 3: indexa_symbol
// Direct O(1) lookup by stable ID, or name search.
// ============================================================
server.tool(
  'indexa_symbol',
  'Look up a symbol. Pass a stable ID (e.g. "src/auth.ts::validateToken#function") for O(1) lookup, or a name for search.',
  {
    name: z.string().describe('Symbol name or stable ID'),
  },
  async ({ name }) => {
    // Try direct ID lookup first
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

    // Fall back to name search
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
// TOOL 4: indexa_file
// File outline or full chunks for a path.
// ============================================================
server.tool(
  'indexa_file',
  'Get all indexed symbols in a file. Returns outline (names + locations) by default, or full code with include_code=true.',
  {
    path: z.string().describe('File path (absolute or partial match)'),
    include_code: z.boolean().default(false).describe('Include source code for each symbol'),
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
// TOOL 5: indexa_dependencies
// Get what a symbol depends on AND what depends on it.
// ============================================================
server.tool(
  'indexa_dependencies',
  'Get dependencies and dependents of a symbol. Shows what it uses and what uses it.',
  {
    symbolId: z.string().describe('Symbol stable ID or name'),
    depth: z.number().min(1).max(5).default(2).describe('Traversal depth'),
  },
  async ({ symbolId, depth }) => {
    // Try direct graph lookup first
    let nodes = graph.getDependencyGraph(symbolId, depth);

    // If not found by ID, try by name
    if (nodes.length === 0) {
      const matches = vectorDB.findByName(symbolId);
      if (matches.length > 0) {
        nodes = graph.getDependencyGraph(matches[0].id, depth);
      }
    }

    if (nodes.length === 0) {
      return { content: [{ type: 'text' as const, text: `No dependencies found for "${symbolId}".` }] };
    }

    const output = nodes.map(n => [
      `[${n.type}] ${n.name}`,
      `  ID: ${n.id}`,
      `  File: ${n.filePath}`,
      n.dependsOn.length > 0 ? `  Uses: ${n.dependsOn.slice(0, 10).join(', ')}` : '  Uses: nothing',
      n.dependedBy.length > 0 ? `  Used by: ${n.dependedBy.slice(0, 10).join(', ')}` : '  Used by: nothing',
    ].join('\n')).join('\n\n');

    return { content: [{ type: 'text' as const, text: `Dependency graph (${nodes.length} nodes):\n\n${output}` }] };
  }
);

// ============================================================
// TOOL 6: indexa_references
// Find all usages of a symbol across the codebase.
// ============================================================
server.tool(
  'indexa_references',
  'Find all symbols that reference or depend on a given symbol name.',
  {
    name: z.string().describe('Symbol name to find references for'),
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
// TOOL 7: indexa_index
// Index or re-index a directory.
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
    return {
      content: [{
        type: 'text' as const,
        text: `Indexed ${result.indexed} files → ${result.chunks} chunks. Total: ${vectorDB.size}`,
      }],
    };
  }
);

// ============================================================
// TOOL 8: indexa_stats
// Quick index stats.
// ============================================================
server.tool(
  'indexa_stats',
  'Index statistics: chunk count, file count, data location.',
  {},
  async () => {
    const files = metadataDB.getAllFiles();
    return {
      content: [{
        type: 'text' as const,
        text: [
          `Chunks: ${vectorDB.size}`,
          `Files: ${metadataDB.size}`,
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
