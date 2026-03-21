# Indexa

[![npm](https://img.shields.io/npm/v/indexa-mcp)](https://www.npmjs.com/package/indexa-mcp) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) [![GitHub](https://img.shields.io/github/stars/prashantsinghmangat/Indexa)](https://github.com/prashantsinghmangat/Indexa)

AI code intelligence via the Model Context Protocol (MCP). Not just search — Indexa explains code, traces execution flows, and assembles context bundles for LLMs.

Built for large-scale projects and migrations (e.g., AngularJS to React/Angular 17). Returns minimal, relevant code — never full files. **Proven 51% token reduction** vs manual file reading.

**Free forever** — no API keys needed, runs locally, offline-capable. Uses local ML embeddings via [Transformers.js](https://huggingface.co/docs/transformers.js) (gte-small model, 384 dimensions).

[Website](https://prashantsinghmangat.github.io/Indexa/) · [npm](https://www.npmjs.com/package/indexa-mcp) · [GitHub](https://github.com/prashantsinghmangat/Indexa)

## Quick Start (One Command)

```bash
npx indexa-mcp setup
```

Or install globally:
```bash
npm install -g indexa-mcp
indexa-mcp setup
```

That's it. `indexa-mcp setup` automatically:
- Detects your project (language, framework)
- Indexes the codebase with ML embeddings
- Stores index data in `.indexa/` inside your project (per-project isolation)
- Adds `.indexa/` to `.gitignore`
- Configures MCP for Claude Code (both global `~/.mcp.json` and project `.mcp.json`)
- Runs a test query to verify everything works

```
  ╔═══════════════════════════════════╗
  ║   Indexa ready!                    ║
  ╚═══════════════════════════════════╝
  Setup complete in 12.6s
  6,838 chunks indexed
```

Then restart Claude Code and ask: _"explain the authentication flow"_

See [Quick Start Guide](docs/quick-start.md) for full details.

## What's New in v3.2

- **Per-project data storage** — Index data stored in `.indexa/` inside each project. No cross-project pollution. Works on any machine
- **Auto `.gitignore`** — Setup adds `.indexa/` to `.gitignore` automatically
- **Proper `export default` naming** — `export default function Foo` is indexed as `Foo`, not `default`
- **Search output caps** — Max 10 results, 2KB/chunk, 12K total chars to prevent context overflow
- **Build output exclusion** — `.next/`, `out/`, `_next/`, `.vercel/` excluded automatically

### v3.1

- **`indexa-mcp setup`** — One command: detect project → index → configure MCP → verify. Under 60 seconds
- **`indexa-mcp doctor`** — Health check: index, embeddings, MCP config, server startup
- **Query intent classification** — Auto-detects flow/explain/references/debug/search intent and adjusts weights
- **CLI works from any directory** — No need to `cd` into Indexa; commands resolve data paths automatically
- **Entry-point boosting** — Controllers, services, exports rank above internal helpers
- **Dependency pruning** — Trivial 1-line functions excluded from bundles

### v3.0 Features

- **Local ML embeddings** — Transformers.js with gte-small model (384-dim vectors)
- **`indexa_context_bundle`** — PRIMARY tool. Symbols + code + deps + connections within token budget
- **`indexa_flow`** — Trace execution flow across functions/files
- **`indexa_explain`** — Human-readable code explanation from actual symbols
- **Context stitching** — Connections between symbols: `calls`, `imports`, `depends_on`
- **LRU query cache** — 100 entries, 5min TTL
- **Byte-offset retrieval** — Code read from source via O(1) seek
- **BM25 keyword search** — Stop-word filtering, path matching
- **File diversity** — Max 2 chunks per file in bundles
- **VS Code extension** — Native editor integration

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

## Per-Project Data Storage

Each project gets its own isolated index:

```
my-project/
├── .indexa/              ← index data (auto-gitignored)
│   ├── embeddings.json   ← chunks + ML embeddings
│   └── metadata.json     ← file hash tracking
├── .mcp.json             ← MCP config (auto-created)
├── .gitignore            ← .indexa/ auto-added
└── src/
```

- No cross-project pollution — each project's index is completely separate
- Works on any machine — relative paths, no hardcoded directories
- `.indexa/` is gitignored — doesn't pollute your repo
- MCP config auto-created — Claude Code discovers tools on restart

## Use with Claude Code (MCP)

`indexa-mcp setup` automatically configures both:
- **`~/.mcp.json`** — global MCP config
- **`<project>/.mcp.json`** — project-level MCP config pointing to `.indexa/`

No manual configuration needed. Just restart Claude Code after setup.

**9 tools** become available:

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

```bash
npx indexa-mcp setup    # does everything automatically
```

### After code changes (incremental)

```bash
# Option 1: CLI — hash-based, skips unchanged files
npx indexa-mcp index "D:\path\to\your\project"

# Option 2: Git-based — only re-indexes files changed since last commit
npx indexa-mcp update

# Option 3: From Claude Code — ask Claude directly
"Use indexa_index to re-index D:\path\to\your\project"
```

### After switching branches

Run a full re-index (it still skips unchanged files):
```bash
npx indexa-mcp index "D:\path\to\your\project"
```

### What gets indexed

Controlled by `config/indexa.config.json`:
```json
{
  "includePatterns": ["*.ts", "*.tsx", "*.js", "*.jsx"],
  "excludePatterns": [
    "node_modules", "dist", ".git", ".next", "_next", "out",
    ".nuxt", ".output", ".vercel", "build", "coverage",
    "*.test.*", "*.spec.*", "*.stories.*",
    "*.min.js", "*.bundle.js", "vendor.js", "polyfills.js",
    "angular-mocks", "e2e", "chunks"
  ]
}
```

See [Configuration](docs/configuration.md) for all options.

## CLI Commands

```bash
npx indexa-mcp setup "D:\path\to\project"     # One-command setup (auto everything)
npx indexa-mcp doctor                          # Health check (index, MCP, server)
npx indexa-mcp search "vendor pricing"         # Hybrid search
npx indexa-mcp bundle "authentication flow"    # Context bundle (PRIMARY for LLMs)
npx indexa-mcp flow "getVendorRates"           # Execution flow tracing
npx indexa-mcp explain "vendor pricing system" # Code explanation
npx indexa-mcp index "D:\path\to\project"      # Full index (skips unchanged)
npx indexa-mcp update                           # Incremental via git diff
npx indexa-mcp clean                            # Purge junk chunks
npx indexa-mcp serve                            # REST API on :3000
```

> **Tip:** Install globally with `npm i -g indexa-mcp` to use `indexa-mcp` directly instead of `npx`.

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
