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

## 2. Initialize & Index

```powershell
node dist/cli/index.js init
node dist/cli/index.js index "D:\path\to\your\project"
```

## 3. Context Bundle (PRIMARY)

The most important command — returns relevant symbols + dependencies + connections:

```powershell
node dist/cli/index.js bundle "vendor service area" --token-budget 1500
```

## 4. Trace Execution Flow

See how functions call each other across files:

```powershell
node dist/cli/index.js flow "getVendorRatesByServiceArea"
```

## 5. Explain Code

Get a human-readable explanation:

```powershell
node dist/cli/index.js explain "vendor management pricing"
```

## 6. Search

```powershell
node dist/cli/index.js search "VendorService"          # → symbol lookup
node dist/cli/index.js search "vendor service"          # → BM25 keyword
node dist/cli/index.js search "vendor service logic"    # → hybrid
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

Restart Claude Code. 9 tools available — `indexa_context_bundle`, `indexa_flow`, and `indexa_explain` are the key intelligence tools.

## What's Next?

- [CLI Reference](./cli-reference.md) — all commands
- [API Reference](./api-reference.md) — REST endpoints
- [MCP Integration](./mcp-integration.md) — all 9 MCP tools
- [Architecture](./architecture.md) — how the intelligence layer works
