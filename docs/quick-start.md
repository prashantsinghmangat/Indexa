# Indexa v2.0 — Quick Start

Get up and running in under 2 minutes.

## Prerequisites

- Node.js >= 18
- npm
- Git (for incremental updates)

## 1. Install

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

This creates:
- `config/indexa.config.json` — default settings
- `data/` — empty index storage

## 3. Index Your Codebase

```powershell
node dist/cli/index.js index "D:\path\to\your\project"
```

Example:
```powershell
node dist/cli/index.js index "D:\SafeGuard\SPINext-App-SPIGlass"
```

Output:
```
Indexing complete in 53.68s
  Files indexed: 1353
  Chunks created: 12317
  Data stored in: ./data
```

> Code is NOT stored in the index. Each chunk stores byte offsets — code is read from source files on demand.

## 4. Search

```powershell
# Standard search (topK=5)
node dist/cli/index.js search "vendor service"

# Limit results
node dist/cli/index.js search "authentication" --top-k 3

# Token budget mode (packs results until budget exhausted)
node dist/cli/index.js search "service" --token-budget 500
```

Results show stable symbol IDs like `D:/project/src/auth.ts::validateToken#function`.

## 5. Start the API Server

```powershell
node dist/cli/index.js serve
```

Server starts at http://localhost:3000. Test with:
```powershell
curl -X POST http://localhost:3000/api/search -H "Content-Type: application/json" -d "{\"query\": \"vendor service\", \"topK\": 3}"
```

New v2 endpoints:
```powershell
# File outline (symbols without code)
curl "http://localhost:3000/api/outline?path=vendor.service.js"

# Find references to a symbol
curl "http://localhost:3000/api/references?name=VendorService"

# Blast radius analysis
curl "http://localhost:3000/api/blast-radius?name=VendorService"

# Get symbol by stable ID
curl "http://localhost:3000/api/symbol/src%2Fauth.ts%3A%3AvalidateToken%23function"
```

## 6. Use with Claude Code (MCP)

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

Restart Claude Code. You now have 12 tools available:

| Tool | Description |
|------|-------------|
| `indexa_search` | Hybrid/semantic/keyword search with token budgeting |
| `indexa_get_symbol` | O(1) lookup by stable symbol ID |
| `indexa_find_symbol` | Name-based symbol search |
| `indexa_file_outline` | Symbol outline for a file |
| `indexa_dependency_graph` | Dependency graph traversal |
| `indexa_find_importers` | Who imports from a file |
| `indexa_find_references` | Who references a symbol |
| `indexa_class_hierarchy` | Parent/child class relationships |
| `indexa_context_bundle` | Symbols + imports, token-budgeted |
| `indexa_blast_radius` | Impact analysis |
| `indexa_index` | Index a directory |
| `indexa_stats` | Index statistics |

## What's Next?

- [CLI Reference](./cli-reference.md) — all commands and options
- [API Reference](./api-reference.md) — REST endpoint details
- [MCP Integration](./mcp-integration.md) — Claude Code setup and all 12 tools
- [Configuration](./configuration.md) — customize file patterns, port, etc.
- [Architecture](./architecture.md) — how it all works
