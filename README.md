# Indexa v3.0

Code intelligence via the Model Context Protocol (MCP). Not just search — Indexa explains code, traces execution flows, and assembles context bundles for LLMs.

Built for large-scale projects and migrations (e.g., AngularJS to React/Angular 17). Returns minimal, relevant code — never full files. **Proven 51% token reduction** vs manual file reading.

**Free forever** — no API keys needed, runs locally, offline-capable. Uses local ML embeddings via [Transformers.js](https://huggingface.co/docs/transformers.js) (gte-small model, 384 dimensions).

## What's New in v3.0

- **Local ML embeddings** — Transformers.js with gte-small model (384-dim vectors), no API keys needed
- **`indexa_context_bundle`** — PRIMARY tool. Returns symbols + code + dependencies + connections within a token budget
- **`indexa_flow`** — Trace execution flow across functions/files with depth control
- **`indexa_explain`** — Human-readable code explanation from actual symbols
- **Context stitching** — Connections between symbols: `calls`, `imports`, `depends_on`
- **LRU query cache** — 100 entries, 5min TTL. Auto-invalidated on re-index
- **Byte-offset retrieval** — Code read from source files via O(1) seek, not stored in index
- **Stable symbol IDs** — `filePath::name#type`, human-readable and bookmarkable
- **BM25 keyword search** — With stop-word filtering and path matching
- **File diversity** — Max 2 chunks per file in context bundles to prevent monopolization
- **Cleaned index** — Auto-excludes minified builds, storybook files, vendor scripts
- **VS Code extension** — Native editor integration at `indexa-vscode/`

## Quick Start

```powershell
cd D:\Project\Indexa
npm install
npm run build
node dist/cli/index.js init
node dist/cli/index.js index "D:\SafeGuard\SPINext-App-SPIGlass"
node dist/cli/index.js search "vendor pricing"
```

See [Quick Start Guide](docs/quick-start.md) for full details.

## VS Code Extension

A native VS Code extension is available at `indexa-vscode/`. Install it for in-editor code intelligence.

**Commands:**

| Command | Shortcut | Description |
|---------|----------|-------------|
| **Ask Indexa** | `Ctrl+Shift+I` | Query Indexa from the editor |
| **Explain This** | — | Explain selected code |
| **Show Flow** | — | Trace execution flow from selection |
| **Find References** | — | Find all references to selected symbol |
| **Reindex** | — | Re-index the current workspace |
| **Health Check** | — | Verify Indexa server status |

## Use with Claude Code (MCP)

Add to `~/.mcp.json`:

```json
{
  "mcpServers": {
    "indexa": {
      "command": "node",
      "args": [
        "D:/Project/Indexa/dist/src/mcp/stdio.js",
        "--data-dir",
        "D:/Project/Indexa/data"
      ]
    }
  }
}
```

Also add a project-level `.mcp.json` in the target project root (same content) for project-scoped access.

Restart Claude Code. **9 tools** become available:

| # | Tool | Description |
|---|------|-------------|
| 1 | **`indexa_context_bundle`** | **PRIMARY.** Query → symbols + deps + connections within token budget |
| 2 | **`indexa_flow`** | Trace execution flow across functions/files |
| 3 | **`indexa_explain`** | Human-readable code explanation with steps |
| 4 | `indexa_search` | Auto-routed search (identifier/keyword/hybrid) |
| 5 | `indexa_symbol` | O(1) lookup by stable ID or name |
| 6 | `indexa_file` | File outline or full code |
| 7 | `indexa_references` | Find usages + blast radius |
| 8 | `indexa_index` | Index/re-index a directory |
| 9 | `indexa_stats` | Index stats + cache status |

See [MCP Integration Guide](docs/mcp-integration.md) for CLAUDE.md setup and usage tips.

## Indexing & Re-indexing

### First-time index

```powershell
node dist/cli/index.js index "D:\path\to\your\project"
```

### After code changes (incremental)

```powershell
# Option 1: CLI — hash-based, skips unchanged files
node dist/cli/index.js index "D:\path\to\your\project" --data-dir ./data

# Option 2: Git-based — only re-indexes files changed since last commit
node dist/cli/index.js update --data-dir ./data

# Option 3: From Claude Code — ask Claude directly
"Use indexa_index to re-index D:\SafeGuard\SPINext-App-SPIGlass"
```

### After switching branches

Run a full re-index (it still skips unchanged files):
```powershell
node dist/cli/index.js index "D:\path\to\your\project" --data-dir ./data
```

### What gets indexed

Controlled by `config/indexa.config.json`:
```json
{
  "includePatterns": ["*.ts", "*.tsx", "*.js", "*.jsx"],
  "excludePatterns": [
    "node_modules", "dist", ".git",
    "*.test.*", "*.spec.*", "*.stories.*",
    "public/react-shell/assets", "public/Scripts",
    "public/Scripts/", "angular-mocks",
    "*.min.js", "*.bundle.js", "vendor.js", "polyfills.js",
    "e2e/"
  ]
}
```

See [Configuration](docs/configuration.md) for all options.

## CLI Commands

```powershell
node dist/cli/index.js init                              # Initialize config + data dirs
node dist/cli/index.js index "D:\path\to\project"        # Full index (skips unchanged)
node dist/cli/index.js update                             # Incremental via git diff
node dist/cli/index.js search "query"                     # Hybrid search
node dist/cli/index.js search "query" --top-k 10          # More results
node dist/cli/index.js serve                               # REST API on :3000
node dist/cli/index.js serve --port 8080                   # Custom port
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
| GET | `/api/blast-radius?name=` | Change impact analysis |
| POST | `/api/update` | Incremental re-index |
| GET | `/api/stats` | Index statistics |
| GET | `/api/health` | Health check |

## Documentation

| Doc | Description |
|-----|-------------|
| [Quick Start](docs/quick-start.md) | Get up and running in 2 minutes |
| [Architecture](docs/architecture.md) | System design, data flow, module breakdown |
| [CLI Reference](docs/cli-reference.md) | All commands and options |
| [API Reference](docs/api-reference.md) | REST endpoint specs with examples |
| [MCP Integration](docs/mcp-integration.md) | Claude Code setup, all 9 tools, CLAUDE.md template |
| [Configuration](docs/configuration.md) | Config fields, exclude patterns, embeddings |
| [Re-indexing](docs/reindexing.md) | How to keep the index fresh |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and fixes |

## Architecture

```
indexa/
├── src/
│   ├── intelligence/    # Flow engine, explain engine, LRU cache
│   ├── retrieval/       # Semantic, BM25 keyword, hybrid + query router, graph
│   ├── indexer/         # Parser (ts-morph), chunker, embedder (Transformers.js), updater
│   ├── storage/         # JSON vector + metadata stores (atomic writes)
│   ├── server/          # Express REST API
│   ├── mcp/            # MCP stdio transport (9 tools)
│   ├── types/          # TypeScript interfaces
│   └── utils/          # BM25, byte-offset, query routing, stop words
├── cli/                # CLI commands (Commander)
├── indexa-vscode/      # VS Code extension
├── docs/               # Documentation (8 guides)
├── sample-code/        # Test data
├── config/             # indexa.config.json
└── data/               # Generated index (byte-offset, no inline code)
```

## Core Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Local ML embeddings** | Transformers.js with gte-small (384-dim). No API keys, runs offline, high-quality semantic vectors. |
| **Byte-offset retrieval** | Code read from source via O(1) seek, not stored in index. Keeps index small. |
| **Stable symbol IDs** | `filePath::name#type` — human-readable, no UUIDs. |
| **Query routing** | Identifiers → symbol lookup, short → BM25, natural language → hybrid. |
| **Hybrid scoring** | 35% semantic + 25% BM25 + 15% name match + 25% path match. Balanced weights leveraging ML embeddings. |
| **File diversity** | Max 2 chunks per file in context bundles to prevent any single file from monopolizing results. |
| **Stop-word filtering** | Common terms (`system`, `data`, `list`, `type`, `get`, `set`) excluded from BM25 to reduce noise. |
| **Token budgeting** | Pack results until budget exhausted. Typical: 1500-3000 tokens. |
| **LRU cache** | 100 entries, 5min TTL. Invalidated on re-index. |
| **Context stitching** | Connections between symbols: calls, imports, depends_on. |
| **Exclude patterns** | Minified builds, storybook, vendor scripts, test files, angular-mocks, e2e — all auto-excluded. |
| **Logger → stderr** | All `console.error()` so stdout stays clean for MCP JSON-RPC protocol. |
| **51% token reduction** | Proven savings vs manual file reading — returns only relevant code fragments. |

## License

MIT
