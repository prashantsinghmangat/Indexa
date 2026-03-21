# Indexa v3.2 — Quick Start

Get up and running in under 60 seconds. Free forever — no API keys, runs locally, offline-capable.

## Prerequisites

- Node.js >= 18
- npm
- Git (for incremental updates)

## 1. Setup (One Command)

```bash
npx indexa-mcp setup
```

Or install globally first:
```bash
npm install -g indexa-mcp
indexa-mcp setup
```

This single command:
1. **Detects** your project (language, framework, file count)
2. **Creates** `.indexa/` directory inside your project for per-project data storage
3. **Adds** `.indexa/` to your `.gitignore` automatically
4. **Indexes** the codebase with ML embeddings (Transformers.js, 384-dim)
5. **Cleans** junk entries (minified builds, vendor scripts, storybook, tests)
6. **Configures MCP** — adds Indexa to `~/.mcp.json` and creates project-level `.mcp.json` pointing to `.indexa/`
7. **Verifies** by running a live test query

After setup, your project looks like:
```
my-project/
├── .indexa/              ← index data (gitignored)
│   ├── embeddings.json
│   └── metadata.json
├── .mcp.json             ← MCP config (auto-created)
└── src/
```

Output:
```
  ╔═══════════════════════════════════╗
  ║   Indexa ready!                    ║
  ╚═══════════════════════════════════╝
  Setup complete in 12.6s
  6,838 chunks indexed
```

## 3. Verify

```bash
npx indexa-mcp doctor
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

```bash
npx indexa-mcp search "vendor pricing"               # Hybrid search
npx indexa-mcp bundle "authentication flow"          # Context bundle (best for LLMs)
npx indexa-mcp flow "getVendorRates"                 # Execution flow trace
npx indexa-mcp explain "vendor pricing system"       # Code explanation
```

**Query intent classification** auto-detects what you need:
- _"how does auth work"_ → **flow** intent → boosts semantic weights
- _"where is pricingService used"_ → **references** intent → boosts name matching
- _"fix login bug"_ → **debug** intent → boosts path context
- _"VendorAuthGuard"_ → **symbol lookup** → direct name match

## 6. Use with VS Code

Install the extension from `indexa-vscode/indexa-0.1.0.vsix`:
1. `Ctrl+Shift+P` → "Install from VSIX"
2. Start the server: `npx indexa-mcp serve`
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

```bash
npx indexa-mcp index "D:\path\to\project"       # Full (skips unchanged files)
npx indexa-mcp update                            # Git-based incremental
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
