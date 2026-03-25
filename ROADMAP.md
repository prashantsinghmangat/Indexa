# Indexa Roadmap

> The context engine for AI. Sits between your codebase and LLMs — makes AI actually reliable for real-world development.

---

## Phase 1: MVP (DONE)

**Goal:** Make it usable for individual devs.

| Feature | Status | Surface |
|---------|--------|---------|
| AST-based codebase indexing (functions, classes, imports) | Done | Core |
| ML embeddings (Transformers.js, local-first) | Done | Core |
| Hybrid search (semantic + BM25 + name + path) | Done | Core |
| Context bundles with token budgets | Done | MCP, CLI, API |
| Execution flow tracing (call chains across files) | Done | MCP, CLI, API |
| Code explanation engine | Done | MCP, CLI, API |
| References + blast radius | Done | MCP, CLI, API |
| VS Code extension (sidebar, flow, references) | Done | Extension |
| CLI tool (index, search, bundle, flow, explain) | Done | CLI |
| REST API server | Done | API |
| MCP server (Model Context Protocol) | Done | MCP |
| Intent classification (auto-route queries) | Done | Core |
| Per-project `.indexa/` storage | Done | Core |
| One-command setup (`indexa setup`) | Done | CLI |

---

## Phase 2: Intelligence Layer (DONE)

**Goal:** Make Indexa think, not just search.

| Feature | Status | Surface |
|---------|--------|---------|
| Dead code detection | Done | MCP, CLI, API |
| Blast radius analysis (dedicated tool) | Done | MCP, CLI, API |
| File importers ("who depends on this file?") | Done | MCP, CLI, API |
| Export context to file (markdown/JSON) | Done | CLI |
| Security scan (OWASP domains) | Done | MCP |
| AI bridge — copy context to clipboard for any LLM | Done | VS Code |
| Open files for Copilot context | Done | VS Code |
| Circular dependency detection | Done | MCP, CLI, API |
| Unused exports detection | Done | MCP, CLI, API |
| Code duplication finder (embedding similarity) | Done | MCP, CLI, API |
| Full transitive impact chain | Done | MCP, CLI, API |
| Context-aware PR review | Done | MCP |
| Dependency graph visualization | Planned | VS Code, CLI |

---

## Phase 3: AI Integration Layer (IN PROGRESS)

**Goal:** Make any AI smarter using Indexa — auto-inject context into prompts.

| Feature | Status | Surface |
|---------|--------|---------|
| Indexa SDK (programmatic API) | Done | SDK |
| Auto-index on file save | Done | VS Code |
| Watch mode (continuous re-index) | Done | CLI |
| Prompt builder (auto-inject context into LLM calls) | Planned | SDK |
| OpenAI / Claude wrapper (context-aware completions) | Planned | SDK |
| "Fix this bug" workflow (Indexa context + LLM) | Planned | VS Code, CLI |
| Context-aware code generation | Planned | SDK |

---

## Phase 4: Platform / API (FUTURE)

**Goal:** Let others build on Indexa. Become infrastructure.

| Feature | Status | Surface |
|---------|--------|---------|
| Cloud indexing (index once, query from anywhere) | Planned | Cloud |
| Team knowledge graph (shared context) | Planned | Cloud |
| Multi-language support (Python, Go, Java, Rust) | Planned | Core |
| Plugin system (custom parsers, custom search) | Planned | Core |
| API pricing (pay per request) | Planned | Cloud |
| GitHub App (auto-index on push) | Planned | Cloud |

---

## What's New (Latest)

### v3.4 — Intelligence + SDK

**5 new MCP tools:**
- `indexa_circular_deps` — Detect circular dependencies between files (DFS cycle detection)
- `indexa_unused_exports` — Find exports nobody imports
- `indexa_duplicates` — Find near-duplicate code via embedding cosine similarity
- `indexa_impact_chain` — Full transitive impact analysis with configurable depth
- `indexa_review_pr` — Context-aware PR review: changed files + blast radius + connections

**6 new CLI commands:**
- `indexa circular-deps` — Detect import cycles
- `indexa unused-exports` — Find dead exports
- `indexa duplicates [-t 0.85]` — Find copy-paste code
- `indexa impact-chain <symbol> [-d 5]` — Deep impact analysis
- `indexa watch` — Live re-index on file changes (fs.watch)
- (Plus all v3.3 commands: dead-code, blast-radius, export)

**4 new REST API endpoints:**
- `GET /api/circular-deps` — Circular dependency report
- `GET /api/unused-exports` — Unused exports report
- `GET /api/duplicates?threshold=` — Near-duplicate code pairs
- `GET /api/impact-chain?name=&depth=` — Full transitive impact

**Indexa SDK:**
- `src/sdk/index.ts` — Programmatic API: `createIndexa()` returns an instance with all features
- Search, context bundles, flow tracing, dead code, duplicates, impact chain — all accessible via code

**VS Code extension:**
- Auto-index on save — debounced re-index when you save TS/JS files (configurable via `indexa.autoIndexOnSave`)

### v3.3 — Analysis & Intelligence

**3 new MCP tools:**
- `indexa_dead_code` — Find unreferenced functions, methods, and classes
- `indexa_blast_radius` — Dedicated impact analysis
- `indexa_importers` — Find all symbols that import from a given file

**3 new CLI commands:**
- `indexa dead-code` — Scan for unused symbols
- `indexa blast-radius <symbol>` — See what breaks before you refactor
- `indexa export <query>` — Export LLM-ready context as markdown or JSON

**Total: 18 MCP tools, 21 CLI commands, 21 API endpoints, 1 SDK.**

---

## Architecture

```
Your Code --> Parser (AST) --> Chunker --> Embedder --> .indexa/
                                                          |
AI Query  --> Intent Router --> Hybrid Search --> Bundle --> Response
                                   |
                      Semantic (35%) + BM25 (25%)
                    + Name match (15%) + Path (25%)
```

**Surfaces:**
- **MCP Server** — Claude Code, any MCP-compatible client (18 tools)
- **REST API** — Any HTTP client, VS Code extension (21 endpoints)
- **CLI** — Terminal workflows, CI/CD, scripting (21 commands)
- **VS Code Extension** — Sidebar, commands, AI bridge, auto-index
- **SDK** — Programmatic API for building on top of Indexa

---

## SDK Quick Start

```typescript
import { createIndexa } from 'indexa-mcp/sdk';

const indexa = createIndexa({ dataDir: '.indexa' });

// Search
const results = await indexa.searchCode('auth middleware');

// Context bundle for LLMs
const bundle = await indexa.contextBundle('login flow', 3000);

// Analysis
const dead = indexa.findDeadCode();
const cycles = indexa.findCircularDependencies();
const dupes = indexa.findDuplicates(0.90);
const impact = indexa.getFullImpactChain('UserService', 5);
```

---

## Contributing

Open issues, PRs, or ideas at [GitHub](https://github.com/prashantsinghmangat/Indexa).

Built by [Prashant Singh](https://prashantsinghmangat.netlify.app/).
