# Indexa v3.4 — Quick Start

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
6. **Configures MCP** — adds Indexa to `~/.mcp.json` (with `instructions` field) and creates project-level `.mcp.json` pointing to `.indexa/`
7. **Creates `CLAUDE.md`** with Indexa tool instructions so Claude auto-uses Indexa first
8. **Verifies** by running a live test query

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

Restart Claude Code after setup. 19 tools are auto-available. Just ask:

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
npx indexa-mcp dead-code                             # Find unreferenced symbols
npx indexa-mcp blast-radius "VendorService"          # What breaks if you change it
npx indexa-mcp impact-chain "pricingService"         # Full transitive impact
npx indexa-mcp circular-deps                         # Detect import cycles
npx indexa-mcp unused-exports                        # Find dead exports
npx indexa-mcp duplicates -t 0.9                     # Near-duplicate code
npx indexa-mcp export "auth flow" -o ctx.md -f md    # Export LLM-ready context
npx indexa-mcp grep "TODO|FIXME" -f "*.ts"           # Regex search
npx indexa-mcp watch                                 # Live re-index on changes
```

**Query intent classification** auto-detects what you need:
- _"how does auth work"_ → **flow** intent → boosts semantic weights
- _"where is pricingService used"_ → **references** intent → boosts name matching
- _"fix login bug"_ → **debug** intent → boosts path context
- _"VendorAuthGuard"_ → **symbol lookup** → direct name match

## 6. Use with VS Code (Optional)

Install the VS Code extension (v0.4.0) for a sidebar UI with search, flow tracing, inline AI commands, and click-to-navigate:

1. **From Marketplace (recommended):** Search "Indexa Code Intelligence" in VS Code Extensions, or visit [Indexa on Marketplace](https://marketplace.visualstudio.com/items?itemName=PrashantSingh.indexa-code-intelligence)
2. **Or from GitHub:** Download `.vsix` from [Releases](https://github.com/prashantsinghmangat/Indexa/releases) → `code --install-extension indexa-code-intelligence-0.4.0.vsix`
3. The extension auto-starts the Indexa server — no manual terminal needed.
4. Use `Ctrl+Shift+I` to open the Indexa sidebar and start querying.

| Command | Shortcut | Description |
|---------|----------|-------------|
| **Ask Indexa** | `Ctrl+Shift+I` | Query from the editor |
| **Explain This** | `Ctrl+Shift+E` | Explain selected code using indexed context |
| **Fix This** | `Ctrl+Shift+F` | Fix selected code using indexed context |
| **What Calls This** | Right-click | Find callers of the selected symbol |
| **Refactor This** | Right-click | Suggest refactoring using indexed context |
| **Generate Tests** | Right-click | Generate tests for selected code |
| **Show Flow** | Right-click | Trace execution flow |
| **Find References** | Right-click | Find symbol usages |
| **Reindex** | Command palette | Re-index workspace |
| **Health Check** | Command palette | Verify server status |

**Auto-index on save:** Modified files are automatically re-indexed when saved — no manual action needed.

**Diagnostic integration:** Error squiggles get a lightbulb "Fix with Indexa" code action that uses indexed context to suggest fixes.

## 7. Re-index After Code Changes

```bash
npx indexa-mcp index "D:\path\to\project"       # Full (skips unchanged files)
npx indexa-mcp update                            # Git-based incremental
npx indexa-mcp watch                             # Live re-index on file changes
```

Or from Claude Code: _"Use indexa_index to re-index my project"_

The VS Code extension also auto-indexes on save — no action needed.

See [Re-indexing Guide](./reindexing.md) for details.

## What's Next?

- [CLI Reference](./cli-reference.md) — All commands and options
- [MCP Integration](./mcp-integration.md) — Claude Code setup, CLAUDE.md template
- [Architecture](./architecture.md) — System design and data flow
- [Configuration](./configuration.md) — Exclude patterns, file types, embeddings
- [API Reference](./api-reference.md) — REST endpoint details
- [Re-indexing Guide](./reindexing.md) — Keeping the index fresh
- [Troubleshooting](./troubleshooting.md) — Common issues and fixes
