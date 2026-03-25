# Indexa Roadmap

> The context engine for AI. Sits between your codebase and LLMs — makes AI actually reliable for real-world development.

---

## Phase 1: Foundation (DONE)

| Feature | Status |
|---------|--------|
| AST-based codebase indexing (functions, classes, imports) | Done |
| ML embeddings (Transformers.js, local-first, 384-dim) | Done |
| Hybrid search (semantic + BM25 + name + path) | Done |
| Context bundles with token budgets | Done |
| Execution flow tracing (call chains across files) | Done |
| Code explanation engine | Done |
| References + blast radius | Done |
| VS Code extension (sidebar, flow, references, AI bridge) | Done |
| CLI tool (21 commands) | Done |
| REST API server (21 endpoints) | Done |
| MCP server (18 tools) | Done |
| Intent classification (auto-route queries) | Done |
| Per-project `.indexa/` storage | Done |
| One-command setup (`indexa setup`) | Done |

---

## Phase 2: Intelligence (DONE)

| Feature | Status |
|---------|--------|
| Dead code detection | Done |
| Blast radius + full transitive impact chain | Done |
| Circular dependency detection | Done |
| Unused exports detection | Done |
| Code duplication finder (embedding similarity) | Done |
| File importers ("who depends on this file?") | Done |
| Context-aware PR review | Done |
| Export context to file (markdown/JSON) | Done |
| Security scan (OWASP domains) | Done |
| AI bridge — copy context for any LLM | Done |
| Indexa SDK (programmatic API) | Done |
| Auto-index on save (VS Code) | Done |
| Watch mode (CLI) | Done |

---

## Phase 3: Solid for Daily Use (DONE)

**Goal:** Make Indexa reliable enough that devs use it every day without thinking about it.

| Fix | Status | Impact |
|-----|--------|--------|
| Binary/non-UTF8 file protection | Done | Prevents crash on images, PDFs in repo |
| Embedding model load fallback | Done | Hash-based fallback if model download fails |
| Buffer overflow protection (readCodeAtOffset) | Done | Prevents OOM on corrupt metadata |
| Corrupt index recovery (backup + .bak) | Done | Auto-recovers from power failure / crash |
| Empty index guards (all MCP tools) | Done | Helpful message instead of silent failure |
| Setup directory validation | Done | Warns when directory isn't a JS/TS project |
| O(n²) duplicate detection cap | Done | Capped at 2000 chunks, won't hang on large repos |
| Search name matching tightened | Done | Prevents "user" matching "server" |
| Reverse reference index (O(1) lookups) | Done | `findReferences()` uses reverse index, not O(n) scan |
| Watch mode: smarter file detection | Done | Handles deletes, debounce, graceful shutdown, clear status |
| MCP server error recovery | Done | Uncaught exception handler, diagnostic startup errors |
| Integration tests: first-run flow | Done | 23 tests: index → search → analysis → recovery → binary |
| Integration tests: corrupt data recovery | Done | Backup/restore verified end-to-end |

---

## What's Shipped

**v3.4.0 — 18 MCP tools | 21 CLI commands | 21 API endpoints | 1 SDK**

### Surfaces
- **MCP Server** — Claude Code, any MCP-compatible client
- **REST API** — Any HTTP client, VS Code extension
- **CLI** — Terminal workflows, CI/CD, scripting
- **VS Code Extension** — Sidebar, commands, AI bridge, auto-index
- **SDK** — Programmatic API: `createIndexa()`

### CLI Quick Reference

```bash
# Setup
indexa setup                        # One-command setup (auto everything)
indexa doctor                       # Health check

# Search & Context
indexa search "auth middleware"      # Hybrid search
indexa bundle "payment flow"        # Context bundle (best for LLMs)
indexa flow "handleLogin"           # Execution flow
indexa explain "pricing system"     # Code explanation

# Analysis
indexa dead-code                    # Unreferenced symbols
indexa blast-radius UserService     # What breaks if you change it
indexa impact-chain UserService     # Full transitive impact
indexa circular-deps                # Import cycles
indexa unused-exports               # Dead exports
indexa duplicates                   # Near-duplicate code

# Export & Live
indexa export "auth" -o context.md  # Export context to file
indexa watch                        # Live re-index on save

# Index Management
indexa index ./src                  # Full index
indexa update                       # Incremental via git diff
indexa clean                        # Remove junk
indexa reindex ./src                # Full clean re-index
indexa serve                        # REST API on :3000
```

### SDK Quick Start

```typescript
import { createIndexa } from 'indexa-mcp/sdk';

const indexa = createIndexa({ dataDir: '.indexa' });

const results = await indexa.searchCode('auth middleware');
const bundle = await indexa.contextBundle('login flow', 3000);
const dead = indexa.findDeadCode();
const cycles = indexa.findCircularDependencies();
const dupes = indexa.findDuplicates(0.90);
const impact = indexa.getFullImpactChain('UserService', 5);
```

---

Built by [Prashant Singh](https://prashantsinghmangat.netlify.app/).
