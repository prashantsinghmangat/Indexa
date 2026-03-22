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

**Your AI reads 10,000 lines to find 1 function.**
**Indexa gives it exactly what it needs.**

A context engine for AI coding tools. Sits between your codebase and your AI assistant — returns symbols, dependencies, and execution flows instead of full files.

Index once. Query forever. **50% fewer tokens.**

[Website](https://prashantsinghmangat.github.io/Indexa/) · [npm](https://www.npmjs.com/package/indexa-mcp) · [GitHub](https://github.com/prashantsinghmangat/Indexa)

---

## See It In 5 Seconds

```bash
$ npx indexa-mcp setup
  ✓ Indexed 87 chunks in 5s
  ✓ MCP configured for Claude Code
```

```
You:   "trace the login flow"
Indexa: VendorAuthGuard → VendorFlowGuard → verifyPkceSession
        → getAppSessionCookie → useVcAuthStore
        9 steps. 5 files. 2,500 tokens. Done.
```

```
You:   "what breaks if I change UserService?"
Indexa: 12 references across 8 files. Blast radius mapped.
```

**That's Indexa.** One query replaces 15 minutes of manual tracing.

---

## Why Indexa?

Without Indexa, AI agents explore code the expensive way:

```
❌  Open file → skim 800 lines → find 1 function → repeat × 7 files
    = 10,000+ tokens burned on irrelevant code
```

With Indexa:

```
✅  "explain the auth flow" → 5 relevant symbols + dependencies + connections
    = 3,000 tokens. Same answer. 70% less waste.
```

**Proven result:** 51% average token reduction in real-world testing on production codebases.

---

## Before vs After

### Without Indexa
- Open files manually, skim hundreds of lines
- Grep across the repo, piece together context
- Copy-paste into AI, hope it understands
- Miss hidden dependencies and call chains
- Burn 10K+ tokens per question

### With Indexa
- Ask one question, get exact symbols + dependencies
- See execution flow across files instantly
- Know the blast radius before you refactor
- **50% fewer tokens. Better answers. No guesswork.**

---

## Quick Start

```bash
npx indexa-mcp setup
```

That's it. One command. Under 60 seconds. It:

1. Detects your project (language, framework)
2. Indexes your code with ML embeddings
3. Creates `.indexa/` in your project (per-project, gitignored)
4. Configures MCP for Claude Code
5. Runs a test query to prove it works

```
  ✓ Project: my-app (typescript / react)
  ✓ Indexed 87 chunks in 5.3s
  ✓ MCP configured
  ✓ Test query: found 3 results

  ╔═══════════════════════════════════╗
  ║   Indexa ready!                    ║
  ╚═══════════════════════════════════╝
```

Restart Claude Code. Now just ask your AI:

- _"explain the auth flow"_
- _"trace the login logic"_
- _"where is pricingService used"_
- _"what breaks if I change UserService"_

---

## Understand Code, Not Just Search It

Search tools return files. **Indexa traces execution.**

```
Query: "trace VendorAuthGuard"

VendorAuthGuard
  → VendorFlowGuard
    → verifyPkceSession
      → getAppSessionCookie
        → useVcAuthStore

9 steps. 5 files. One query.
```

This is what normally takes 10-15 minutes of manual file-by-file tracing. Indexa does it in under 2 seconds.

---

## One Query. Full System Understanding.

```
"trace VendorAuthGuard"  →  9-step execution flow, 5 files connected
"explain theme system"   →  3 symbols + dependencies + connections, 1,789 tokens
"references to pricing"  →  12 usages across 8 files, blast radius mapped
```

This is code intelligence, not file search.

---

## See It Work — Real Examples

### Example 1: Understand a feature

```
Query: "how does the theme system work"
```

Indexa returns:

```
=== [component] ThemeSwitcher ===
File: src/components/ui/ThemeSwitcher.tsx:14-84
→ UI picker with 4 themes (default/cyberpunk/minimal/matrix)

=== [function] ThemeApplier ===
File: src/components/ui/ThemeApplier.tsx:6-14
→ Sets data-theme on <html>, triggers CSS variable swap

=== [export] Theme ===
File: src/store/uiStore.ts:5
→ type Theme = "default" | "cyberpunk" | "minimal" | "matrix"

--- Connections ---
ThemeSwitcher → calls → useUIStore
ThemeApplier → calls → useUIStore

Tokens: ~1,789 / 3,000
```

**Without Indexa:** Claude reads 3 full files (400+ lines, ~5,000 tokens).
**With Indexa:** 3 precise symbols + connections = 1,789 tokens.

### Example 2: Trace an execution flow

```
Query: "trace VendorAuthGuard"
```

```
Flow from VendorAuthGuard (9 steps):

1. [component] VendorAuthGuard → calls: VendorFlowGuard, StaffFlowGuard
2. [component] VendorFlowGuard → calls: verifyPkceSession, setAuth
3. [function] verifyPkceSession → calls: getAppSessionCookie, isRealJwt
4. [function] getAppSessionCookie → reads document.cookie
5. [export] useVcAuthStore → Zustand store (sessionStorage persistence)
```

One query. Full call chain across 5 files. No manual tracing.

### Example 3: Find what breaks if you change something

```
Query: "references to pricingService"
```

```
References to "pricingService": 12 direct, 8 files affected

- ChangeSource.js → calls ListChangeSource, GetChangeSource
- ClientTaskRateLookup.js → calls GetClientTaskRateLookupList
- EditChangeSource.js → calls UpdateChangeSource
- AddClientTaskmap.js → calls AddClientTaskMap
  ... +8 more
```

Know the blast radius before you refactor.

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

1. **Index once** — AST parsing extracts functions, classes, components. ML embeddings (Transformers.js, 384-dim) capture meaning. Stored in `.indexa/` per project.
2. **Query smartly** — Auto-detects intent (flow/explain/debug/search). Routes to the best strategy.
3. **Return minimal context** — Only relevant symbols, packed within a token budget. Includes dependencies and connections.

---

## 9 MCP Tools for Claude Code

| Tool | What it does |
|------|-------------|
| **`indexa_context_bundle`** | **Start here.** Returns relevant code + deps + connections within token budget |
| **`indexa_flow`** | Trace execution: what calls what, across files |
| **`indexa_explain`** | Human-readable explanation from actual code |
| `indexa_search` | Smart search — auto-routes by query type |
| `indexa_symbol` | Instant lookup by name or ID |
| `indexa_file` | Get all symbols in a file |
| `indexa_references` | Find usages + blast radius |
| `indexa_index` | Index or re-index a directory |
| `indexa_stats` | Index health and stats |

MCP is auto-configured by `indexa-mcp setup`. No manual `.mcp.json` editing.

---

## CLI Cheat Sheet

```bash
# Setup & Health
indexa-mcp setup                    # One-command setup (auto everything)
indexa-mcp doctor                   # Health check

# Search & Retrieve
indexa-mcp search "auth middleware" # Hybrid search
indexa-mcp bundle "payment flow"    # Context bundle (best for LLMs)
indexa-mcp flow "handleLogin"       # Execution flow
indexa-mcp explain "pricing system" # Code explanation

# Index Management
indexa-mcp index ./src              # Full index (skips unchanged)
indexa-mcp update                   # Incremental via git diff
indexa-mcp clean                    # Remove junk chunks
indexa-mcp benchmark                # Token savings comparison

# Server
indexa-mcp serve                    # REST API on :3000
```

> Install globally: `npm i -g indexa-mcp` to drop the `npx` prefix.

---

## VS Code Extension

A full-featured sidebar extension with search, flow tracing, references, and click-to-navigate (opens file at exact line). Type-aware icons for functions, components, services, and more. Auto-starts the Indexa server — no manual terminal needed.

### Install

**From VS Code Marketplace (recommended):**

Search "Indexa Code Intelligence" in VS Code Extensions, or install directly:
[Indexa on VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=PrashantSingh.indexa-code-intelligence)

**Or from GitHub Releases:**

Download `indexa-code-intelligence-0.2.0.vsix` from [GitHub Releases](https://github.com/prashantsinghmangat/Indexa/releases), then:
```bash
code --install-extension indexa-code-intelligence-0.2.0.vsix
```

### Features

| Command | Shortcut | What it does |
|---------|----------|-------------|
| **Ask Indexa** | `Ctrl+Shift+I` | Query from sidebar with clickable example queries |
| **Explain This** | — | Explain selected code |
| **Show Flow** | — | Trace from selection |
| **Find References** | — | Usages + blast radius |
| **Reindex** | — | Re-index workspace |
| **Health Check** | — | Verify connection |

---

## Per-Project Storage

Each project gets its own isolated index. No shared state. No cross-project noise.

```
my-project/
├── .indexa/              ← index data (auto-gitignored)
│   ├── embeddings.json
│   └── metadata.json
├── .mcp.json             ← MCP config (auto-created)
└── src/
```

---

## What Gets Indexed (and What Doesn't)

**Indexed:** `*.ts`, `*.tsx`, `*.js`, `*.jsx` — functions, classes, components, exports, services, controllers.

**Excluded automatically:** `node_modules`, `dist`, `.next`, `out`, `.vercel`, `build`, `coverage`, `*.test.*`, `*.spec.*`, `*.stories.*`, `*.min.js`, vendor scripts, e2e tests.

Customize in `config/indexa.config.json`.

---

## Query Intent Detection

Indexa auto-classifies your query and adjusts search weights:

| You ask | Indexa detects | Search strategy |
|---------|---------------|----------------|
| "how does auth work" | **flow** | Boost semantic (understand call chains) |
| "explain vendor pricing" | **explain** | Balanced (broad context) |
| "where is UserService used" | **references** | Boost name matching |
| "fix login bug on token" | **debug** | Boost semantic + path |
| "VendorAuthGuard" | **symbol lookup** | Direct O(1) name match |
| "payment logic" | **search** | Default hybrid weights |

No configuration needed. It just works.

---

## API Endpoints

Start with `indexa-mcp serve` (runs on port 3000):

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/context-bundle` | Symbols + deps + connections |
| POST | `/api/flow` | Execution flow tracing |
| POST | `/api/explain` | Code explanation |
| POST | `/api/search` | Smart search |
| GET | `/api/symbol?name=` | Symbol lookup |
| GET | `/api/references?name=` | References + blast radius |
| GET | `/api/file?path=` | File chunks |
| POST | `/api/update` | Incremental re-index |
| GET | `/api/stats` | Index statistics |
| GET | `/api/health` | Health check |

---

## Why Not Just Use RAG / Copilot / Grep?

| | Generic RAG | Copilot | Grep/Glob | **Indexa** |
|---|---|---|---|---|
| Returns | Raw text chunks | Full file reads | Line matches | **Symbols + deps + connections** |
| Understands structure | No | No | No | **Yes (AST-parsed)** |
| Traces execution | No | No | No | **Yes (call chains across files)** |
| Blast radius | No | No | No | **Yes (what breaks if you change X)** |
| Token efficiency | Poor | Poor | Medium | **50-70% reduction** |
| Runs locally | Sometimes | No | Yes | **Yes (always)** |
| Free | Sometimes | No | Yes | **Yes (always)** |

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
- **Transformers.js** — local ML embeddings (gte-small, 384-dim)
- **Express** — REST API
- **Commander** — CLI
- **@modelcontextprotocol/sdk** — MCP transport
- **JSON storage** — zero native dependencies

---

## License

MIT — free forever, no API keys, runs offline.

Built by [Prashant Singh](https://prashantsinghmangat.netlify.app/).
