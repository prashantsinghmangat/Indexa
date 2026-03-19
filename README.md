# Indexa v2.1

AST-based codebase indexing with semantic + structural retrieval via the Model Context Protocol (MCP).

Built for large-scale projects and migrations (e.g., AngularJS to React/Angular 17). Reduces LLM token usage by returning only the relevant code chunks instead of full files.

## What's New in v2.1

- **Query-driven context bundles** — The PRIMARY tool. Give it a query + token budget, it returns packed symbols + 1-level dependencies ready for LLM consumption
- **Smart query routing** — Identifiers (`VendorService`) route to O(1) symbol lookup, short queries to BM25 keyword, natural language to full hybrid
- **Reweighted hybrid search** — 50% semantic + 30% keyword (BM25) + 20% symbol name match
- **Smart summaries** — Infers purpose from name patterns (`getVendors` → "retrieves vendors"), extracts params and return types
- **Clean 8-tool MCP set** — Focused tools for daily developer workflows

## The Primary Tool: Context Bundle

The most important feature. Instead of searching and manually assembling context:

```powershell
# CLI
node dist/cli/index.js bundle "vendor service area" --token-budget 1500

# API
curl -X POST http://localhost:3000/api/context-bundle \
  -H "Content-Type: application/json" \
  -d '{"query": "vendor service area", "tokenBudget": 1500}'
```

Returns 2-7 relevant symbols with source code + their dependencies, all packed within the token budget. This is what LLMs should call first.

## Quick Start

```powershell
npm install
npm run build
node dist/cli/index.js init
node dist/cli/index.js index "D:\path\to\your\project"
node dist/cli/index.js bundle "vendor service"
```

See [Quick Start Guide](docs/quick-start.md) for full setup.

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

Restart Claude Code. 8 tools available:

| # | Tool | Description |
|---|------|-------------|
| 1 | **`indexa_context_bundle`** | **PRIMARY.** Query → search → pack symbols + deps within token budget |
| 2 | `indexa_search` | Auto-routed search (identifier/keyword/hybrid) with scores |
| 3 | `indexa_symbol` | O(1) lookup by stable ID, or name search |
| 4 | `indexa_file` | File outline or full code for all symbols in a file |
| 5 | `indexa_dependencies` | What a symbol depends on + what depends on it |
| 6 | `indexa_references` | Find all usages + blast radius |
| 7 | `indexa_index` | Index a directory |
| 8 | `indexa_stats` | Index statistics |

See [MCP Integration Guide](docs/mcp-integration.md) for details.

## Query Routing

Indexa auto-detects query intent:

| Query | Route | Why |
|-------|-------|-----|
| `VendorService` | Symbol lookup | PascalCase identifier |
| `$scope` | Symbol lookup | Angular identifier |
| `vendor service` | BM25 keyword | Short, 2 words |
| `vendor service area logic` | Full hybrid | Natural language, 4+ words |

Falls through automatically if the primary strategy returns nothing.

## CLI Usage

```powershell
node dist/cli/index.js init                              # Initialize
node dist/cli/index.js index "D:\path\to\project"        # Full index
node dist/cli/index.js update                             # Incremental (git)
node dist/cli/index.js search "query"                     # Search (topK=5)
node dist/cli/index.js search "query" -b 500              # Search (token budget)
node dist/cli/index.js bundle "query" -b 1500             # Context bundle
node dist/cli/index.js serve                               # REST API on :3000
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/context-bundle` | **PRIMARY.** Query → symbols + deps |
| POST | `/api/search` | Auto-routed search |
| GET | `/api/symbol?name=` | Find symbols by name |
| GET | `/api/symbol/:id` | Get symbol by stable ID |
| GET | `/api/file?path=` | Get all chunks for a file |
| GET | `/api/outline?path=` | File symbol outline |
| GET | `/api/references?name=` | Find references + blast radius |
| GET | `/api/blast-radius?name=` | Impact analysis |
| POST | `/api/update` | Incremental re-index |
| GET | `/api/stats` | Index statistics |
| GET | `/api/health` | Health check |

## Documentation

| Doc | Description |
|-----|-------------|
| [Quick Start](docs/quick-start.md) | Get up and running in 2 minutes |
| [Architecture](docs/architecture.md) | System design, data flow, design decisions |
| [CLI Reference](docs/cli-reference.md) | All commands and options |
| [API Reference](docs/api-reference.md) | REST endpoint specs with examples |
| [MCP Integration](docs/mcp-integration.md) | Claude Code setup, all 8 tools, usage tips |
| [Configuration](docs/configuration.md) | Config fields, file patterns, custom embeddings |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and fixes |

## Core Design

- **Byte-offset retrieval** — Code is NOT stored in the index. Each symbol stores `byteOffset + byteLength`, code is read from source files via O(1) seek
- **Stable symbol IDs** — `filePath::symbolName#type` format, human-readable, bookmarkable across sessions
- **Token budgeting** — Pack results until budget exhausted, not fixed topK
- **Smart summaries** — `function findVendors (query) → VendorDTO[] [15L] — finds vendors`
- **Atomic writes** — Temp-file + rename pattern prevents index corruption
- **BM25 keyword search** — Proper IDF + field weighting (name 3x, type 2x)

## Project Structure

```
indexa/
├── src/
│   ├── server/          # Express REST API
│   ├── indexer/          # Parser (ts-morph), chunker, embedder, updater
│   ├── retrieval/        # Semantic, BM25 keyword, hybrid + query router, graph analysis
│   ├── storage/          # JSON vector + metadata stores (atomic writes)
│   ├── mcp/             # MCP stdio transport (8 tools)
│   ├── types/           # TypeScript interfaces
│   └── utils/           # BM25, byte-offset, query routing, summaries, token estimation
├── cli/                 # CLI commands (Commander)
├── docs/                # Documentation (7 guides)
├── sample-code/         # Test data
├── config/              # indexa.config.json
└── data/                # Generated index (no inline code)
```

## Tech Stack

- **Node.js** >= 18, **TypeScript**
- **ts-morph** — AST parsing
- **Express** — REST API
- **Commander** — CLI
- **@modelcontextprotocol/sdk** — MCP transport
- **JSON file storage** — zero native dependencies

## License

MIT
