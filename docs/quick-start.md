# Indexa v3.0 — Quick Start

Get up and running in under 2 minutes. Free forever — no API keys needed, runs locally, offline-capable.

## Prerequisites

- Node.js >= 18
- npm
- Git (for incremental updates)

## 1. Install & Build

```powershell
cd D:\Project\Indexa
npm install
npm run build
```

> **PowerShell note:** Run commands separately. PowerShell does not support `&&`.

## 2. Initialize

```powershell
node dist/cli/index.js init
```

Creates `config/indexa.config.json` and `data/` directory.

## 3. Index Your Codebase

```powershell
node dist/cli/index.js index "D:\SafeGuard\SPINext-App-SPIGlass"
```

Output:
```
Indexing complete in 4.2s
  Files indexed: 1016
  Chunks created: 8510
  Data stored in: ./data
```

The indexer automatically:
- Parses TypeScript/TSX with ts-morph AST, JavaScript with regex patterns
- Extracts functions, classes, React components, AngularJS controllers/services
- Generates ML embeddings locally via Transformers.js (gte-small, 384 dimensions) — no API keys needed
- Stores byte-offset references (code is NOT stored in the index)
- Skips minified builds, storybook, vendor scripts, test files, angular-mocks, e2e
- Skips unchanged files on re-run (hash-based detection)

## 4. Search

```powershell
node dist/cli/index.js search "vendor pricing"
node dist/cli/index.js search "getVendorRatesByServiceArea" --top-k 3
```

The query router auto-detects: identifiers → symbol lookup, short queries → keyword/BM25, else → hybrid search (35% semantic + 25% BM25 + 15% name match + 25% path match).

## 5. Start the REST API

```powershell
node dist/cli/index.js serve
```

Server at http://localhost:3000. See [API Reference](./api-reference.md) for all 12 endpoints.

## 6. Use with Claude Code (MCP)

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

**Important:** `--data-dir` is required so the MCP server finds index data regardless of which directory Claude Code is opened from.

Restart Claude Code. 9 tools become available. Proven 51% token reduction vs manual file reading.

## 7. Use with VS Code

A native VS Code extension is available at `indexa-vscode/`. Key commands:

| Command | Shortcut | Description |
|---------|----------|-------------|
| **Ask Indexa** | `Ctrl+Shift+I` | Query Indexa from the editor |
| **Explain This** | — | Explain selected code |
| **Show Flow** | — | Trace execution flow |
| **Find References** | — | Find all references to selected symbol |
| **Reindex** | — | Re-index the current workspace |
| **Health Check** | — | Verify Indexa server status |

## 8. Re-index After Code Changes

See [Re-indexing Guide](./reindexing.md) for all options.

Quick version:
```powershell
# Full re-index (skips unchanged files)
node dist/cli/index.js index "D:\path\to\project" --data-dir ./data

# Git-based incremental (only files changed since last commit)
node dist/cli/index.js update --data-dir ./data

# From Claude Code:
# "Use indexa_index to re-index D:\SafeGuard\SPINext-App-SPIGlass"
```

## What's Next?

- [Re-indexing Guide](./reindexing.md) — How to keep the index fresh
- [MCP Integration](./mcp-integration.md) — Claude Code setup, CLAUDE.md template
- [Architecture](./architecture.md) — System design and data flow
- [Configuration](./configuration.md) — Exclude patterns, file types, embeddings
- [CLI Reference](./cli-reference.md) — All commands and options
- [API Reference](./api-reference.md) — REST endpoint details
- [Troubleshooting](./troubleshooting.md) — Common issues and fixes
