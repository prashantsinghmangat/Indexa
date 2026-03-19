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
import { SemanticSearch } from '../retrieval/semantic';
import { KeywordSearch } from '../retrieval/keyword';
import { GraphAnalysis } from '../retrieval/graph';
import { IndexaConfig } from '../types';
import { readCodeAtOffset, estimateTokens } from '../utils';

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
      // fall through to defaults
    }
  }
  return defaults;
}

// --- Initialize services ---

const config = loadConfig();
const vectorDB = new VectorDB(config.dataDir);
const metadataDB = new MetadataDB(config.dataDir);
const embedder = new Embedder();
const hybridSearch = new HybridSearch(vectorDB, embedder);
const semanticSearch = new SemanticSearch(vectorDB, embedder);
const keywordSearch = new KeywordSearch(vectorDB);
const graphAnalysis = new GraphAnalysis(vectorDB);

// --- MCP Server ---

const server = new McpServer({
  name: 'indexa',
  version: '2.0.0',
});

// --- Tool: indexa_search ---
server.tool(
  'indexa_search',
  'Search the indexed codebase. Returns relevant code chunks with scores. Supports token budgeting.',
  {
    query: z.string().describe('Search query (e.g. "vendor service", "authentication middleware")'),
    topK: z.number().min(1).max(50).default(5).describe('Max results to return'),
    tokenBudget: z.number().min(0).default(0).describe('Token budget (0 = use topK instead). Packs results until budget exhausted.'),
    mode: z.enum(['hybrid', 'semantic', 'keyword']).default('hybrid').describe('Search mode'),
  },
  async ({ query, topK, tokenBudget, mode }) => {
    let results;
    const budget = tokenBudget > 0 ? tokenBudget : undefined;

    switch (mode) {
      case 'semantic':
        results = await semanticSearch.search(query, topK);
        break;
      case 'keyword':
        results = keywordSearch.search(query, topK);
        break;
      case 'hybrid':
      default:
        results = await hybridSearch.search(query, topK, budget);
    }

    if (results.length === 0) {
      return { content: [{ type: 'text' as const, text: `No results found for "${query}".` }] };
    }

    const output = results.map((r, i) => {
      const score = (r.score * 100).toFixed(1);
      const code = readCodeAtOffset(r.chunk.filePath, r.chunk.byteOffset, r.chunk.byteLength);
      return [
        `--- Result ${i + 1} (${score}% match) ---`,
        `ID: ${r.chunk.id}`,
        `Name: ${r.chunk.name}`,
        `Type: ${r.chunk.type}`,
        `File: ${r.chunk.filePath}:${r.chunk.startLine}-${r.chunk.endLine}`,
        `Summary: ${r.chunk.summary}`,
        code ? `Code:\n${code}` : '(source file not available)',
      ].join('\n');
    }).join('\n\n');

    return { content: [{ type: 'text' as const, text: output }] };
  }
);

// --- Tool: indexa_get_symbol ---
server.tool(
  'indexa_get_symbol',
  'Retrieve a symbol by its stable ID (e.g. "src/auth.ts::validateToken#function"). O(1) lookup.',
  {
    id: z.string().describe('Stable symbol ID in format filePath::name#type'),
  },
  async ({ id }) => {
    const chunk = vectorDB.get(id);
    if (!chunk) {
      return { content: [{ type: 'text' as const, text: `Symbol not found: ${id}` }] };
    }

    const code = readCodeAtOffset(chunk.filePath, chunk.byteOffset, chunk.byteLength);
    const output = [
      `ID: ${chunk.id}`,
      `Name: ${chunk.name}`,
      `Type: ${chunk.type}`,
      `File: ${chunk.filePath}:${chunk.startLine}-${chunk.endLine}`,
      `Summary: ${chunk.summary}`,
      `Dependencies: ${chunk.dependencies.join(', ') || 'none'}`,
      `Imports: ${chunk.imports.map(i => `${i.name} from "${i.source}"`).join(', ') || 'none'}`,
      `\nCode:\n${code || '(source file not available)'}`,
    ].join('\n');

    return { content: [{ type: 'text' as const, text: output }] };
  }
);

// --- Tool: indexa_find_symbol ---
server.tool(
  'indexa_find_symbol',
  'Search for a symbol by name across the indexed codebase. Case-insensitive partial match.',
  {
    name: z.string().describe('Symbol name to search for'),
  },
  async ({ name }) => {
    const matches = vectorDB.findByName(name);
    if (matches.length === 0) {
      return { content: [{ type: 'text' as const, text: `No symbol matching "${name}" found.` }] };
    }

    const output = matches.slice(0, 15).map(c => {
      const code = readCodeAtOffset(c.filePath, c.byteOffset, c.byteLength);
      return [
        `[${c.type}] ${c.name}`,
        `ID: ${c.id}`,
        `File: ${c.filePath}:${c.startLine}-${c.endLine}`,
        code ? `Code:\n${code}` : '',
      ].join('\n');
    }).join('\n\n---\n\n');

    return { content: [{ type: 'text' as const, text: `Found ${matches.length} matches for "${name}":\n\n${output}` }] };
  }
);

// --- Tool: indexa_file_outline ---
server.tool(
  'indexa_file_outline',
  'Get the symbol outline of a file — all indexed symbols without loading code.',
  {
    path: z.string().describe('File path (absolute or partial match)'),
  },
  async ({ path: filePath }) => {
    const chunks = vectorDB.getByFile(filePath);
    if (chunks.length === 0) {
      return { content: [{ type: 'text' as const, text: `No indexed symbols in "${filePath}".` }] };
    }

    const outline = chunks.map(c =>
      `  ${c.type.padEnd(12)} ${c.name} (lines ${c.startLine}-${c.endLine})`
    ).join('\n');

    return {
      content: [{
        type: 'text' as const,
        text: `File: ${chunks[0].filePath}\nSymbols (${chunks.length}):\n${outline}`,
      }],
    };
  }
);

// --- Tool: indexa_dependency_graph ---
server.tool(
  'indexa_dependency_graph',
  'Get the dependency graph for a symbol. Shows what it depends on and what depends on it.',
  {
    symbolId: z.string().describe('Symbol ID to analyze'),
    depth: z.number().min(1).max(5).default(2).describe('How many levels deep to traverse'),
  },
  async ({ symbolId, depth }) => {
    const nodes = graphAnalysis.getDependencyGraph(symbolId, depth);
    if (nodes.length === 0) {
      return { content: [{ type: 'text' as const, text: `No dependency graph found for "${symbolId}".` }] };
    }

    const output = nodes.map(n => [
      `[${n.type}] ${n.name}`,
      `  ID: ${n.id}`,
      `  File: ${n.filePath}`,
      `  Depends on: ${n.dependsOn.length > 0 ? n.dependsOn.join(', ') : 'nothing'}`,
      `  Depended by: ${n.dependedBy.length > 0 ? n.dependedBy.join(', ') : 'nothing'}`,
    ].join('\n')).join('\n\n');

    return { content: [{ type: 'text' as const, text: `Dependency graph (${nodes.length} nodes):\n\n${output}` }] };
  }
);

// --- Tool: indexa_find_importers ---
server.tool(
  'indexa_find_importers',
  'Find all symbols that import from a given file.',
  {
    filePath: z.string().describe('File path to find importers for'),
  },
  async ({ filePath }) => {
    const importers = graphAnalysis.findImporters(filePath);
    if (importers.length === 0) {
      return { content: [{ type: 'text' as const, text: `No importers found for "${filePath}".` }] };
    }

    const output = importers.slice(0, 20).map(c =>
      `  [${c.type}] ${c.name} in ${c.filePath}:${c.startLine}`
    ).join('\n');

    return { content: [{ type: 'text' as const, text: `${importers.length} symbols import from "${filePath}":\n${output}` }] };
  }
);

// --- Tool: indexa_find_references ---
server.tool(
  'indexa_find_references',
  'Find all symbols that reference or depend on a given symbol name.',
  {
    symbolName: z.string().describe('Symbol name to find references for'),
  },
  async ({ symbolName }) => {
    const refs = graphAnalysis.findReferences(symbolName);
    if (refs.length === 0) {
      return { content: [{ type: 'text' as const, text: `No references found for "${symbolName}".` }] };
    }

    const output = refs.slice(0, 20).map(c =>
      `  [${c.type}] ${c.name} in ${c.filePath}:${c.startLine}`
    ).join('\n');

    return { content: [{ type: 'text' as const, text: `${refs.length} references to "${symbolName}":\n${output}` }] };
  }
);

// --- Tool: indexa_class_hierarchy ---
server.tool(
  'indexa_class_hierarchy',
  'Get class inheritance hierarchy — parents and children of a class.',
  {
    className: z.string().describe('Class name to analyze'),
  },
  async ({ className }) => {
    const { parents, children } = graphAnalysis.getClassHierarchy(className);

    const lines: string[] = [`Class hierarchy for "${className}":`];

    if (parents.length > 0) {
      lines.push(`\nParents (${className} extends):`);
      for (const p of parents) {
        lines.push(`  ${p.name} in ${p.filePath}:${p.startLine}`);
      }
    } else {
      lines.push('\nNo parent classes found.');
    }

    if (children.length > 0) {
      lines.push(`\nChildren (extends ${className}):`);
      for (const c of children) {
        lines.push(`  ${c.name} in ${c.filePath}:${c.startLine}`);
      }
    } else {
      lines.push('\nNo child classes found.');
    }

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  }
);

// --- Tool: indexa_context_bundle ---
server.tool(
  'indexa_context_bundle',
  'Build a context bundle: primary symbols + their deduplicated imports. Ready for LLM consumption.',
  {
    symbolIds: z.array(z.string()).describe('Array of symbol IDs to bundle'),
    tokenBudget: z.number().min(100).default(4000).describe('Max tokens for the bundle'),
  },
  async ({ symbolIds, tokenBudget }) => {
    const bundle = graphAnalysis.buildContextBundle(symbolIds, tokenBudget);

    const lines: string[] = [];

    if (bundle.symbols.length > 0) {
      lines.push(`=== Primary Symbols (${bundle.symbols.length}) ===\n`);
      for (const sym of bundle.symbols) {
        lines.push(`--- [${sym.type}] ${sym.name} ---`);
        lines.push(`File: ${sym.filePath}:${sym.startLine}-${sym.endLine}`);
        lines.push(sym.code);
        lines.push('');
      }
    }

    if (bundle.imports.length > 0) {
      lines.push(`\n=== Imports (${bundle.imports.length}) ===\n`);
      for (const imp of bundle.imports) {
        lines.push(`--- [${imp.type}] ${imp.name} ---`);
        lines.push(`File: ${imp.filePath}:${imp.startLine}-${imp.endLine}`);
        lines.push(imp.code);
        lines.push('');
      }
    }

    lines.push(`\nEstimated tokens: ${bundle.estimatedTokens}`);

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  }
);

// --- Tool: indexa_blast_radius ---
server.tool(
  'indexa_blast_radius',
  'Estimate the blast radius of changing a symbol. Shows how many other symbols and files would be affected.',
  {
    symbolName: z.string().describe('Symbol name to analyze impact for'),
  },
  async ({ symbolName }) => {
    const blast = graphAnalysis.getBlastRadius(symbolName);

    const output = [
      `Blast radius for "${symbolName}":`,
      `  Direct references: ${blast.directRefs}`,
      `  Transitive impact: ${blast.transitiveRefs} files`,
      `  Affected files:`,
      ...blast.files.slice(0, 20).map(f => `    ${f}`),
      blast.files.length > 20 ? `    ... and ${blast.files.length - 20} more` : '',
    ].join('\n');

    return { content: [{ type: 'text' as const, text: output }] };
  }
);

// --- Tool: indexa_index ---
server.tool(
  'indexa_index',
  'Index or re-index a codebase directory. Parses source files and builds the search index.',
  {
    directory: z.string().describe('Absolute path to the directory to index'),
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
        text: `Indexing complete.\nFiles indexed: ${result.indexed}\nChunks created: ${result.chunks}\nTotal chunks in store: ${vectorDB.size}`,
      }],
    };
  }
);

// --- Tool: indexa_stats ---
server.tool(
  'indexa_stats',
  'Get statistics about the current index.',
  {},
  async () => {
    const files = metadataDB.getAllFiles();
    const filePaths = vectorDB.getFilePaths();
    return {
      content: [{
        type: 'text' as const,
        text: `Index stats:\nTotal chunks: ${vectorDB.size}\nTotal files: ${metadataDB.size}\nUnique file paths: ${filePaths.length}\nData directory: ${config.dataDir}\n\nIndexed files (first 50):\n${files.slice(0, 50).join('\n')}${files.length > 50 ? `\n... and ${files.length - 50} more` : ''}`,
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
  process.stderr.write(`Indexa MCP server error: ${err}\n`);
  process.exit(1);
});
