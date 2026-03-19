# Indexa v3.0 — Quick Start

Get up and running in under 2 minutes.

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
- Stores byte-offset references (code is NOT stored in the index)
- Skips minified builds, storybook, vendor scripts, test files
- Skips unchanged files on re-run (hash-based detection)

## 4. Search

```powershell
node dist/cli/index.js search "vendor pricing"
node dist/cli/index.js search "getVendorRatesByServiceArea" --top-k 3
```

## 5. Start the REST API

```powershell
node dist/cli/index.js serve
```

Server at http://localhost:3000.

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

Restart Claude Code. 9 tools become available.

## 7. Re-index After Code Changes

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
- [Configuration](./configuration.md) — Exclude patterns, file types
- [CLI Reference](./cli-reference.md) — All commands and options
- [API Reference](./api-reference.md) — REST endpoint details
- [Troubleshooting](./troubleshooting.md) — Common issues and fixes
