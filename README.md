<p align="center">
  <img src="https://raw.githubusercontent.com/prashantsinghmangat/Indexa/main/brand/banners/npm-readme-banner.svg" alt="Indexa" width="600" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/indexa-mcp"><img src="https://img.shields.io/npm/v/indexa-mcp" alt="npm" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="MIT" /></a>
  <a href="https://github.com/prashantsinghmangat/Indexa"><img src="https://img.shields.io/github/stars/prashantsinghmangat/Indexa" alt="GitHub Stars" /></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=PrashantSingh.indexa-code-intelligence"><img src="https://img.shields.io/visual-studio-marketplace/v/PrashantSingh.indexa-code-intelligence" alt="VS Code" /></a>
</p>

# Indexa

**Your AI reads 10,000 lines to find 1 function. Indexa gives it exactly what it needs.**

A context engine for AI coding tools. Sits between your codebase and your AI assistant — returns symbols, dependencies, and execution flows instead of full files.

Index once. Query forever. **50-70% fewer tokens.**

[Website](https://prashantsinghmangat.github.io/Indexa/) | [npm](https://www.npmjs.com/package/indexa-mcp) | [GitHub](https://github.com/prashantsinghmangat/Indexa) | [VS Code Extension](https://marketplace.visualstudio.com/items?itemName=PrashantSingh.indexa-code-intelligence)

---

## Why Developers Use Indexa Daily

### The problem

Every AI coding tool — Copilot, Claude, ChatGPT — has the same bottleneck: **context**. They open full files, skim hundreds of lines, burn thousands of tokens, and still miss dependencies across files.

```
Without Indexa:
  Open file (800 lines) → find 1 function → repeat x7 files
  = 10,000+ tokens burned. 30+ seconds. Missed dependencies.
```

### The fix

Indexa indexes your codebase once, then answers any question with **only the relevant symbols, their dependencies, and connections** — packed within a token budget.

```
With Indexa:
  "explain the auth flow" → 5 symbols + deps + connections
  = 3,000 tokens. 2 seconds. Nothing missed.
```

**Proven: 51% average token reduction** on production codebases.

---

## Quick Start

```bash
npx indexa-mcp setup
```

One command. Under 60 seconds. Indexes your code, configures MCP for Claude Code, runs a test query.

```
  Indexa Setup
  ✓ Project: my-app (typescript / react)
  ✓ Indexed 87 chunks in 5.3s
  ✓ MCP configured
  ✓ Test query: found 3 results

  Indexa ready!
```

Restart Claude Code. Ask anything:

- _"explain the auth flow"_
- _"trace handleLogin"_
- _"what breaks if I change UserService"_
- _"find dead code"_

---

## What Indexa Does for Your Daily Workflow

### 1. Understand any feature in seconds

```
You:    "how does the theme system work"
Indexa: 3 symbols + connections = 1,789 tokens

  [component] ThemeSwitcher — UI picker (4 themes)
  [function]  ThemeApplier  — sets data-theme on <html>
  [export]    Theme         — type definition

  Connections:
    ThemeSwitcher → calls → useUIStore
    ThemeApplier  → calls → useUIStore
```

**Without Indexa:** Read 3 full files (400+ lines, 5,000 tokens). **With Indexa:** 1,789 tokens. Same understanding.

### 2. Trace execution flows across files

```
You:    "trace VendorAuthGuard"
Indexa: 9 steps across 5 files, 2 seconds

  1. VendorAuthGuard → calls VendorFlowGuard, StaffFlowGuard
  2. VendorFlowGuard → calls verifyPkceSession, setAuth
  3. verifyPkceSession → calls getAppSessionCookie, isRealJwt
  4. getAppSessionCookie → reads document.cookie
  5. useVcAuthStore → Zustand store (sessionStorage)
```

This normally takes 10-15 minutes of manual file-by-file tracing.

### 3. Know what breaks before you refactor

```
You:    "what breaks if I change UserService"
Indexa: 12 direct references, 23 transitive, 8 files affected

  Direct:
    [controller] UserController — src/controllers/user.ts:15
    [service] AuthService — src/services/auth.ts:42
    [component] UserProfile — src/components/UserProfile.tsx:8
    ... +9 more

  Transitive impact (depth 3):
    AuthService → LoginPage → App → 3 more files
```

### 4. Clean up your codebase

```
You:    "find dead code"
Indexa: 7 unreferenced symbols across 4 files

  src/utils/legacy.ts
    [function] formatOldDate (L12-28) — Unused function
    [function] parseLegacyToken (L30-45) — Unused function

  src/helpers/deprecated.ts
    [function] oldValidate (L5-18) — Unused function
```

```
You:    "find circular dependencies"
Indexa: 2 cycles detected

  Cycle 1: src/auth/guard.ts → src/auth/session.ts → src/auth/guard.ts
  Cycle 2: src/store/user.ts → src/store/ui.ts → src/store/user.ts
```

```
You:    "find duplicate code"
Indexa: 3 pairs above 92% similarity

  Pair 1 — 96.2% similar:
    [function] validateUserInput — src/validators/user.ts:12-35
    [function] validateAdminInput — src/validators/admin.ts:8-31
```

### 5. Review PRs with full context

```
You:    "review this PR"
Indexa: 4 changed files, 12 symbols, blast radius mapped

  src/services/auth.ts (3 symbols)
    [method] validateToken — impact: 5 direct refs, 12 files affected
    [method] refreshSession — impact: 3 direct refs, 8 files affected

  Key connections:
    validateToken → calls → decodeJWT → verifySignature
    refreshSession → calls → validateToken → updateStore
```

### 6. Export context for any AI tool

```bash
# Export to markdown — paste into ChatGPT, Claude, or any LLM
indexa export "auth flow" -o context.md

# Export as JSON — pipe to scripts, CI/CD
indexa export "payment logic" -f json | your-tool

# Copy to clipboard with structured prompt
# (VS Code: Ctrl+Shift+P → "Indexa: Copy for AI")
```

### 7. Live re-indexing — always fresh

```bash
indexa watch
# Indexa Watch Mode — monitoring ./src
# [10:30:15] 2 files → 8 chunks indexed (total: 142)
# [10:31:02] 1 files → 3 chunks indexed (total: 145)
```

VS Code auto-indexes on save — no manual step needed.

---

## Efficiency Gains

| Metric | Without Indexa | With Indexa | Improvement |
|--------|---------------|-------------|-------------|
| Tokens per question | 5,000-15,000 | 1,500-3,000 | **50-70% reduction** |
| Time to understand a feature | 10-15 min | 2 seconds | **300x faster** |
| Files opened to trace a flow | 5-10 files | 0 files (one query) | **Zero manual work** |
| Finding dead code | Hours (manual audit) | 1 command | **Instant** |
| Blast radius before refactor | Guess and pray | Full impact map | **100% visibility** |
| PR review context gathering | 15-30 min | 1 command | **30x faster** |
| Keeping index fresh | Manual re-run | Auto on save | **Zero friction** |
| Circular dependency detection | External tool / manual | Built in | **Free** |
| Duplicate code detection | External tool ($$$) | Built in | **Free** |

---

## How It Works

```
Your Code → Parser (AST) → Chunker → Embedder → .indexa/
                                                     ↓
AI Query  → Intent Router → Hybrid Search → Bundle → Response
                               ↓
                  Semantic (35%) + BM25 (25%)
                + Name match (15%) + Path (25%)
```

1. **Index once** — AST parsing (ts-morph) extracts functions, classes, components. ML embeddings (Transformers.js, 384-dim) capture meaning. Stored in `.indexa/` per project.
2. **Query smartly** — Auto-detects intent (flow/explain/debug/search). Routes to the best strategy. No configuration needed.
3. **Return minimal context** — Only relevant symbols, packed within a token budget. Includes dependencies and connections between symbols.

### Built for reliability

- Binary file protection — skips images, PDFs, compiled files automatically
- Corrupt index recovery — auto-backup before every save, restores from `.bak`
- Embedding fallback — hash-based embeddings if ML model download fails
- Buffer overflow protection — validates all byte offsets before reading
- Reverse reference index — O(1) lookups instead of O(n) scans
- 23 integration tests — first-run, recovery, binary handling, performance

---

## 18 MCP Tools

| Tool | What it does |
|------|-------------|
| **`indexa_context_bundle`** | **Start here.** Code + deps + connections within token budget |
| **`indexa_flow`** | Trace execution: what calls what, across files |
| **`indexa_explain`** | Human-readable explanation from actual code |
| `indexa_search` | Smart search — auto-routes by query type |
| `indexa_symbol` | Instant lookup by name or ID |
| `indexa_file` | All symbols in a file |
| `indexa_references` | Find usages + blast radius |
| `indexa_dead_code` | Unreferenced functions, methods, classes |
| `indexa_blast_radius` | What breaks if you change a symbol |
| `indexa_impact_chain` | Full transitive impact (deeper than blast radius) |
| `indexa_circular_deps` | Circular dependencies between files |
| `indexa_unused_exports` | Exports nobody imports |
| `indexa_duplicates` | Near-duplicate code via embedding similarity |
| `indexa_importers` | Who imports from a given file |
| `indexa_review_pr` | Context-aware PR review |
| `indexa_security_scan` | Deep scan grouped by OWASP domains |
| `indexa_index` | Index or re-index a directory |
| `indexa_stats` | Index health and stats |

Auto-configured by `indexa setup`. No manual `.mcp.json` editing.

---

## CLI — 21 Commands

```bash
# Setup
indexa setup                        # One-command setup
indexa doctor                       # Health check

# Search & Context
indexa search "auth middleware"      # Hybrid search
indexa bundle "payment flow"        # Context bundle for LLMs
indexa flow "handleLogin"           # Execution flow
indexa explain "pricing system"     # Code explanation

# Code Analysis
indexa dead-code                    # Unreferenced symbols
indexa blast-radius UserService     # What breaks
indexa impact-chain UserService     # Full transitive impact
indexa circular-deps                # Import cycles
indexa unused-exports               # Dead exports
indexa duplicates                   # Near-duplicate code
indexa duplicates -t 0.85           # Custom threshold

# Export & Live
indexa export "auth" -o context.md  # Export context to file
indexa export "auth" -f json        # Export as JSON
indexa watch                        # Live re-index on save

# Index Management
indexa index ./src                  # Full index
indexa update                       # Incremental via git diff
indexa clean                        # Remove junk chunks
indexa reindex ./src                # Full clean re-index
indexa serve                        # REST API on :3000
```

Install globally: `npm i -g indexa-mcp`

---

## REST API — 21 Endpoints

Start with `indexa serve`:

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/context-bundle` | Symbols + deps + connections |
| POST | `/api/flow` | Execution flow tracing |
| POST | `/api/explain` | Code explanation |
| POST | `/api/search` | Smart search |
| GET | `/api/symbol?name=` | Symbol lookup |
| GET | `/api/references?name=` | References + blast radius |
| GET | `/api/blast-radius?name=` | Impact analysis |
| GET | `/api/impact-chain?name=&depth=` | Full transitive impact |
| GET | `/api/dead-code` | Unreferenced symbols |
| GET | `/api/circular-deps` | Circular dependencies |
| GET | `/api/unused-exports` | Dead exports |
| GET | `/api/duplicates?threshold=` | Near-duplicate code |
| GET | `/api/importers?path=` | File importers |
| GET | `/api/file?path=` | File symbols |
| GET | `/api/outline?path=` | File outline (no code) |
| GET | `/api/symbol/:id` | Symbol by ID |
| POST | `/api/update` | Incremental re-index |
| GET | `/api/stats` | Index statistics |
| GET | `/api/health` | Health check |

---

## SDK — Build on Indexa

```typescript
import { createIndexa } from 'indexa-mcp/sdk';

const indexa = createIndexa({ dataDir: '.indexa' });

// Search
const results = await indexa.searchCode('auth middleware');

// Context bundle for LLMs
const bundle = await indexa.contextBundle('login flow', 3000);

// Code analysis
const dead = indexa.findDeadCode();
const cycles = indexa.findCircularDependencies();
const dupes = indexa.findDuplicates(0.90);
const impact = indexa.getFullImpactChain('UserService', 5);

// Flow tracing
const flow = await indexa.traceFlow('handleLogin', 5);
```

---

## VS Code Extension

Search "Indexa Code Intelligence" in VS Code, or install from [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=PrashantSingh.indexa-code-intelligence).

| Feature | What it does |
|---------|-------------|
| **Ask Indexa** (`Ctrl+Shift+I`) | Query from sidebar |
| **Show Flow** | Trace execution from selection |
| **Find References** | Usages + blast radius |
| **Copy for AI** | Export context to clipboard with structured prompt |
| **Open for Copilot** | Open relevant files so Copilot has context |
| **Auto-index on save** | Re-indexes automatically when you save |
| **Health Check** | Verify connection and index status |

Auto-starts the Indexa server. No manual terminal needed.

---

## Why Indexa Over Alternatives

| | Copilot | ChatGPT | Cursor | Grep | **Indexa** |
|---|---|---|---|---|---|
| Understands code structure | No | No | Partial | No | **Yes (AST)** |
| Traces execution across files | No | No | No | No | **Yes** |
| Blast radius / impact analysis | No | No | No | No | **Yes** |
| Dead code / circular deps | No | No | No | No | **Yes** |
| Duplicate detection | No | No | No | No | **Yes** |
| Token efficient | Poor | Poor | Medium | N/A | **50-70% reduction** |
| Runs 100% locally | No | No | No | Yes | **Yes** |
| Free forever | No | No | No | Yes | **Yes** |
| Works with any LLM | No | No | No | N/A | **Yes (MCP/API/CLI)** |

---

## Per-Project Storage

Each project gets its own isolated index. No shared state.

```
my-project/
  .indexa/              <- index data (auto-gitignored)
    embeddings.json
    embeddings.json.bak <- auto-backup for recovery
    metadata.json
  .mcp.json             <- MCP config (auto-created)
```

---

## Query Intent Detection

Indexa auto-classifies your query and adjusts search weights:

| You ask | Indexa detects | Search strategy |
|---------|---------------|----------------|
| "how does auth work" | **flow** | Boost semantic |
| "explain vendor pricing" | **explain** | Balanced |
| "where is UserService used" | **references** | Boost name matching |
| "fix login bug on token" | **debug** | Boost semantic + path |
| "VendorAuthGuard" | **symbol lookup** | Direct O(1) name match |
| "payment logic" | **search** | Default hybrid weights |

No configuration needed.

---

## Documentation

| Guide | What you'll learn |
|-------|-------------------|
| [Quick Start](docs/quick-start.md) | Setup to first query in 60 seconds |
| [Architecture](docs/architecture.md) | How the system works under the hood |
| [CLI Reference](docs/cli-reference.md) | Every command and option |
| [API Reference](docs/api-reference.md) | REST endpoints with curl examples |
| [MCP Integration](docs/mcp-integration.md) | Claude Code setup and CLAUDE.md template |
| [Configuration](docs/configuration.md) | Exclude patterns, embeddings, tuning |
| [Re-indexing](docs/reindexing.md) | Keeping the index fresh |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and fixes |

---

## Built With

- **TypeScript** — end to end
- **ts-morph** — AST parsing
- **Transformers.js** — local ML embeddings (all-MiniLM-L6-v2, 384-dim)
- **Express** — REST API
- **Commander** — CLI
- **@modelcontextprotocol/sdk** — MCP transport
- **JSON storage** — zero native dependencies

---

## The Numbers

```
18 MCP tools
21 CLI commands
21 API endpoints
1  SDK (programmatic API)
1  VS Code extension (auto-index, AI bridge)
23 integration tests
0  API keys required
0  cloud dependencies
```

---

## License

MIT — free forever, no API keys, runs 100% offline.

Built by [Prashant Singh](https://prashantsinghmangat.netlify.app/).
