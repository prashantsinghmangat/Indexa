# Indexa v3.0

Code intelligence via the Model Context Protocol (MCP). Not just search — Indexa explains code, traces execution flows, and assembles context bundles for LLMs.

Built for large-scale projects and migrations (e.g., AngularJS to React/Angular 17). Returns minimal, relevant code — never full files.

## What's New in v3.0: Intelligence Layer

- **`indexa_flow`** — Trace execution flow across functions/files. Shows call chains with depth control
- **`indexa_explain`** — Human-readable explanation of code areas. Step-by-step breakdown from actual symbols — no hallucination
- **Context stitching** — Context bundles now include `connections` showing how symbols relate (`calls`, `imports`, `depends_on`)
- **LRU query cache** — Repeated queries hit cache (100 entries, 5min TTL). Invalidated on re-index
- **Smart summaries** — `function findVendors (query) → VendorDTO[] [15L] — finds vendors`

## The Primary Tool: Context Bundle

```powershell
node dist/cli/index.js bundle "vendor service area" --token-budget 1500
```

Returns symbols + source code + dependencies + connections between them, all within token budget. This is what LLMs should call first.

## Intelligence Tools

```powershell
# Trace execution flow: what calls what
node dist/cli/index.js flow "getVendorRatesByServiceArea"

# Explain code in plain English
node dist/cli/index.js explain "vendor management pricing"

# Context bundle with connections
node dist/cli/index.js bundle "authentication flow" --token-budget 2000
```

## Quick Start

```powershell
npm install
npm run build
node dist/cli/index.js init
node dist/cli/index.js index "D:\path\to\your\project"
node dist/cli/index.js bundle "vendor service"
```

See [Quick Start Guide](docs/quick-start.md).

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

Restart Claude Code. 9 tools available:

| # | Tool | Description |
|---|------|-------------|
| 1 | **`indexa_context_bundle`** | **PRIMARY.** Query → symbols + deps + connections within token budget |
| 2 | **`indexa_flow`** | Trace execution flow across functions/files |
| 3 | **`indexa_explain`** | Human-readable code explanation with steps |
| 4 | `indexa_search` | Auto-routed search (identifier/keyword/hybrid) |
| 5 | `indexa_symbol` | O(1) lookup by stable ID or name |
| 6 | `indexa_file` | File outline or full code |
| 7 | `indexa_references` | Find usages + blast radius |
| 8 | `indexa_index` | Index a directory |
| 9 | `indexa_stats` | Index stats + cache status |

## CLI Commands

```powershell
node dist/cli/index.js init                              # Initialize
node dist/cli/index.js index "D:\path\to\project"        # Full index
node dist/cli/index.js update                             # Incremental (git)
node dist/cli/index.js bundle "query" -b 1500             # Context bundle
node dist/cli/index.js flow "symbolName" -d 3             # Execution flow
node dist/cli/index.js explain "query" -b 2000            # Code explanation
node dist/cli/index.js search "query"                     # Search
node dist/cli/index.js serve                               # REST API on :3000
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/context-bundle` | **PRIMARY.** Symbols + deps + connections |
| POST | `/api/flow` | Execution flow tracing |
| POST | `/api/explain` | Code explanation |
| POST | `/api/search` | Auto-routed search |
| GET | `/api/symbol?name=` | Find symbols by name |
| GET | `/api/symbol/:id` | Get symbol by stable ID |
| GET | `/api/file?path=` | All chunks for a file |
| GET | `/api/outline?path=` | File symbol outline |
| GET | `/api/references?name=` | References + blast radius |
| POST | `/api/update` | Incremental re-index |
| GET | `/api/stats` | Index statistics |
| GET | `/api/health` | Health check |

## Documentation

| Doc | Description |
|-----|-------------|
| [Quick Start](docs/quick-start.md) | Get up and running in 2 minutes |
| [Architecture](docs/architecture.md) | System design, intelligence layer, data flow |
| [CLI Reference](docs/cli-reference.md) | All commands including flow and explain |
| [API Reference](docs/api-reference.md) | REST endpoint specs |
| [MCP Integration](docs/mcp-integration.md) | Claude Code setup, all 9 tools |
| [Configuration](docs/configuration.md) | Config fields, embeddings, storage |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and fixes |

## Architecture

```
indexa/
├── src/
│   ├── intelligence/    # Flow engine, explain engine, LRU cache
│   ├── retrieval/       # Semantic, BM25 keyword, hybrid + query router, graph
│   ├── indexer/         # Parser (ts-morph), chunker, embedder, updater
│   ├── storage/         # JSON vector + metadata stores (atomic writes)
│   ├── server/          # Express REST API
│   ├── mcp/            # MCP stdio transport (9 tools)
│   ├── types/          # TypeScript interfaces
│   └── utils/          # BM25, byte-offset, query routing, summaries
├── cli/                # CLI commands (Commander)
├── docs/               # Documentation (7 guides)
├── sample-code/        # Test data
├── config/             # indexa.config.json
└── data/               # Generated index (no inline code)
```

## Core Design

- **Byte-offset retrieval** — Code read from source via O(1) seek, not stored in index
- **Stable symbol IDs** — `filePath::name#type`, human-readable and bookmarkable
- **Query routing** — Identifiers → symbol lookup, short → BM25, natural language → hybrid
- **Hybrid scoring** — 50% semantic + 30% BM25 + 20% name match
- **Token budgeting** — Pack results until budget exhausted
- **LRU cache** — 100 entries, 5min TTL, auto-invalidated on re-index
- **Context stitching** — Connections between symbols: calls, imports, depends_on

## License

MIT
