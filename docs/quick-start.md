# Indexa v2.1 — Quick Start

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

## 3. Index Your Codebase

```powershell
node dist/cli/index.js index "D:\path\to\your\project"
```

Example output:
```
Indexing complete in 39.18s
  Files indexed: 1353
  Chunks created: 12317
  Data stored in: ./data
```

## 4. Context Bundle (PRIMARY)

The most important command. Returns relevant symbols + dependencies within a token budget:

```powershell
node dist/cli/index.js bundle "vendor service area" --token-budget 1500
```

Output: 2-7 symbols with source code + their dependencies, all packed within 1500 tokens.

## 5. Search

```powershell
# Smart auto-routing: identifiers → symbol lookup, short → keyword, else → hybrid
node dist/cli/index.js search "VendorService"               # → symbol lookup
node dist/cli/index.js search "vendor service"               # → BM25 keyword
node dist/cli/index.js search "vendor service area logic"    # → hybrid

# Token budget mode
node dist/cli/index.js search "service" --token-budget 500
```

## 6. Start the API Server

```powershell
node dist/cli/index.js serve
```

Test the primary endpoint:
```powershell
curl -X POST http://localhost:3000/api/context-bundle -H "Content-Type: application/json" -d "{\"query\": \"vendor service\", \"tokenBudget\": 1500}"
```

## 7. Use with Claude Code (MCP)

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

Restart Claude Code. 8 tools available — `indexa_context_bundle` is the PRIMARY tool LLMs should use first.

## What's Next?

- [CLI Reference](./cli-reference.md) — all commands and options
- [API Reference](./api-reference.md) — REST endpoint details
- [MCP Integration](./mcp-integration.md) — Claude Code setup and all 8 tools
- [Configuration](./configuration.md) — customize file patterns, port, etc.
- [Architecture](./architecture.md) — how it all works
