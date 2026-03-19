# Indexa v2.0

AST-based codebase indexing with semantic + structural retrieval via the Model Context Protocol (MCP).

Built for large-scale projects and migrations (e.g., AngularJS to React/Angular 17). Reduces LLM token usage by returning only the relevant code chunks instead of full files.

## What's New in v2.0

- **Byte-offset retrieval** — Code is NOT stored in the index. Each symbol stores `byteOffset + byteLength`, code is read from source on demand via O(1) seek
- **Stable symbol IDs** — `filePath::symbolName#type` format, human-readable and bookmarkable across sessions
- **BM25 keyword search** — Proper BM25 with IDF, field weighting (name 3x, type 2x), and exact-match bonuses
- **Token budgeting** — Pack results until a token budget is exhausted, instead of fixed topK
- **12 MCP tools** — Up from 5. Added dependency graph, blast radius, importers, references, class hierarchy, context bundle, file outline
- **Graph analysis** — Dependency graph traversal, blast radius estimation, import tracking, class hierarchy
- **Atomic writes** — Temp-file + rename pattern prevents index corruption
- **Method extraction** — Individual class methods are now indexed as separate symbols

## Features

- **AST-based parsing** — Extracts functions, classes, methods, components, AngularJS controllers/services using ts-morph
- **Smart chunking** — Function-level, method-level, and class-level chunks with auto-splitting for large elements
- **Pluggable embeddings** — Built-in hash-based vectors, swappable for OpenAI or local models
- **Hybrid search** — 70% semantic (cosine similarity) + 30% keyword (BM25)
- **Incremental indexing** — Git-based change detection, only re-indexes modified files
- **Content hash drift detection** — Each chunk stores a SHA-256 content hash to verify retrieval matches index
- **REST API** — Express server with search, symbol, outline, references, blast-radius endpoints
- **CLI** — Commands for init, index, update, search, and serve

## Quick Start

```powershell
npm install
npm run build
node dist/cli/index.js init
node dist/cli/index.js index "D:\path\to\your\project"
node dist/cli/index.js search "vendor service"
```

See [Quick Start Guide](docs/quick-start.md) for full setup instructions.

## Use with Claude Code

Add to `~/.mcp.json`:

```json
{
  "mcpServers": {
    "indexa": {
      "command": "node",
      "args": ["D:/Project/Indexa/dist/src/mcp/stdio.js"]
    }
  }
}
```

Restart Claude Code. 12 tools become available:

| Tool | Description |
|------|-------------|
| `indexa_search` | Hybrid/semantic/keyword search with token budgeting |
| `indexa_get_symbol` | O(1) lookup by stable symbol ID |
| `indexa_find_symbol` | Name-based symbol search (case-insensitive partial match) |
| `indexa_file_outline` | Symbol outline for a file (no code loaded) |
| `indexa_dependency_graph` | What depends on what (configurable depth) |
| `indexa_find_importers` | Who imports from a file |
| `indexa_find_references` | Who references a symbol |
| `indexa_class_hierarchy` | Parent/child class relationships |
| `indexa_context_bundle` | Symbols + deduplicated imports, token-budgeted for LLM consumption |
| `indexa_blast_radius` | Impact analysis — how many symbols/files are affected by a change |
| `indexa_index` | Index or re-index a directory |
| `indexa_stats` | Index statistics |

See [MCP Integration Guide](docs/mcp-integration.md) for details.

## CLI Usage

```powershell
node dist/cli/index.js init                          # Initialize project
node dist/cli/index.js index "D:\path\to\project"    # Full index
node dist/cli/index.js update                         # Incremental (git-based)
node dist/cli/index.js search "query"                 # Search (topK=5)
node dist/cli/index.js search "query" -b 500          # Search (token budget=500)
node dist/cli/index.js serve                           # Start REST API on :3000
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/search` | Hybrid/semantic/keyword search with token budgeting |
| GET | `/api/symbol?name=` | Find symbols by name |
| GET | `/api/symbol/:id` | Get symbol by stable ID |
| GET | `/api/file?path=` | Get all chunks for a file |
| GET | `/api/outline?path=` | File symbol outline (no code) |
| GET | `/api/references?name=` | Find references to a symbol |
| GET | `/api/blast-radius?name=` | Impact analysis |
| POST | `/api/update` | Trigger incremental re-index |
| GET | `/api/stats` | Index statistics |
| GET | `/api/health` | Health check |

## Documentation

| Doc | Description |
|-----|-------------|
| [Quick Start](docs/quick-start.md) | Get up and running in 2 minutes |
| [Architecture](docs/architecture.md) | System design, data flow, module breakdown, design decisions |
| [CLI Reference](docs/cli-reference.md) | All commands and options |
| [API Reference](docs/api-reference.md) | REST endpoint specs with examples |
| [MCP Integration](docs/mcp-integration.md) | Claude Code setup, available tools, usage tips |
| [Configuration](docs/configuration.md) | Config fields, file patterns, custom embeddings |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and fixes |

## Project Structure

```
indexa/
├── src/
│   ├── server/          # Express REST API (2 controllers, router)
│   ├── indexer/          # Parser (ts-morph), chunker, embedder, updater
│   ├── retrieval/        # Semantic, keyword (BM25), hybrid, graph analysis
│   ├── storage/          # JSON vector + metadata stores (atomic writes)
│   ├── mcp/             # MCP stdio transport server (12 tools)
│   ├── types/           # TypeScript interfaces (DepGraphNode, ContextBundle, etc.)
│   └── utils/           # Logger, BM25, byte-offset, cosine similarity, token estimation
├── cli/                 # CLI commands (Commander)
├── docs/                # Documentation (7 guides)
├── sample-code/         # Test data (AngularJS, React, TypeScript)
├── config/              # indexa.config.json
└── data/                # Generated index data (no inline code stored)
```

## Tech Stack

- **Node.js** >= 18 + **TypeScript**
- **ts-morph** — AST parsing
- **Express** — REST API
- **Commander** — CLI
- **@modelcontextprotocol/sdk** — MCP transport
- **JSON file storage** — zero native dependencies

## Index Format (v2)

The index file (`data/embeddings.json`) stores metadata + embeddings only. No code is stored inline.

Each chunk contains:
- `id` — Stable symbol ID (`filePath::name#type`)
- `name`, `type`, `summary`, `filePath`, `startLine`, `endLine`
- `byteOffset`, `byteLength` — for O(1) code retrieval from source
- `contentHash` — SHA-256 for drift detection
- `dependencies`, `imports` — for graph analysis
- `embedding` — 128-dim hash vector

Code is read from the original source file on demand. This keeps the index compact (~40MB for 12K chunks vs ~200MB+ with inline code).

## License

MIT
