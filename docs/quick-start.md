# Indexa v3.1 — Quick Start

Get up and running in under 60 seconds. Free forever — no API keys, runs locally, offline-capable.

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

## 2. Setup (One Command)

```powershell
indexa setup "D:\path\to\your\project"
```

> If `indexa` isn't in your PATH: `node dist/cli/index.js setup "D:\path\to\your\project"`

This single command:
1. **Detects** your project (language, framework, file count)
2. **Indexes** the codebase with ML embeddings (Transformers.js, 384-dim)
3. **Cleans** junk entries (minified builds, vendor scripts, storybook, tests)
4. **Configures MCP** — adds Indexa to `~/.mcp.json` and creates project-level `.mcp.json`
5. **Verifies** by running a live test query

Output:
```
  ╔═══════════════════════════════════╗
  ║   Indexa ready!                    ║
  ╚═══════════════════════════════════╝
  Setup complete in 12.6s
  6,838 chunks indexed
```

## 3. Verify

```powershell
indexa doctor
```

```
  ✓ Index: 8,997 chunks
  ✓ Embeddings: ML (384-dim)
  ✓ Metadata: 966 files tracked
  ✓ MCP: configured and server file exists
  ✓ Claude Code: installed
  ✓ Build: dist/src/mcp/stdio.js exists
  ✓ MCP server: starts and responds correctly
```

## 4. Use with Claude Code

Restart Claude Code after setup. 9 tools are auto-available. Just ask:

```
"explain the authentication flow"
"what depends on pricingService"
"how does vendor pricing work"
```

Claude will auto-call `indexa_context_bundle` and return relevant code with 51% fewer tokens.

## 5. Use the CLI (Works from Any Directory)

```powershell
indexa search "vendor pricing"               # Hybrid search
indexa bundle "authentication flow"          # Context bundle (best for LLMs)
indexa flow "getVendorRates"                 # Execution flow trace
indexa explain "vendor pricing system"       # Code explanation
```

**Query intent classification** auto-detects what you need:
- _"how does auth work"_ → **flow** intent → boosts semantic weights
- _"where is pricingService used"_ → **references** intent → boosts name matching
- _"fix login bug"_ → **debug** intent → boosts path context
- _"VendorAuthGuard"_ → **symbol lookup** → direct name match

## 6. Use with VS Code

Install the extension from `indexa-vscode/indexa-0.1.0.vsix`:
1. `Ctrl+Shift+P` → "Install from VSIX"
2. Start the server: `indexa serve`
3. Use `Ctrl+Shift+I` to ask Indexa

| Command | Shortcut | Description |
|---------|----------|-------------|
| **Ask Indexa** | `Ctrl+Shift+I` | Query from the editor |
| **Explain This** | Right-click | Explain selected code |
| **Show Flow** | Right-click | Trace execution flow |
| **Find References** | Right-click | Find symbol usages |
| **Reindex** | Command palette | Re-index workspace |
| **Health Check** | Command palette | Verify server status |

## 7. Re-index After Code Changes

```powershell
indexa index "D:\path\to\project"       # Full (skips unchanged files)
indexa update                            # Git-based incremental
indexa reindex "D:\path\to\project"      # Wipe + fresh re-index + clean
```

Or from Claude Code: _"Use indexa_index to re-index my project"_

See [Re-indexing Guide](./reindexing.md) for details.

## What's Next?

- [CLI Reference](./cli-reference.md) — All commands and options
- [MCP Integration](./mcp-integration.md) — Claude Code setup, CLAUDE.md template
- [Architecture](./architecture.md) — System design and data flow
- [Configuration](./configuration.md) — Exclude patterns, file types, embeddings
- [API Reference](./api-reference.md) — REST endpoint details
- [Re-indexing Guide](./reindexing.md) — Keeping the index fresh
- [Troubleshooting](./troubleshooting.md) — Common issues and fixes
