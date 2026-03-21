# Indexa — CLI Reference

```
npx indexa-mcp <command> [options]
```

Or install globally: `npm install -g indexa-mcp`, then use `indexa-mcp <command>`.

All commands work from any directory — data paths resolve automatically.

---

## `setup` (Start Here)

One-command setup: detect project → index → configure MCP → verify. Under 60 seconds.

```bash
npx indexa-mcp setup                                # Auto-detects project from current dir
npx indexa-mcp setup "D:\SafeGuard\SPINext-App"     # Explicit project path
```

**What it does automatically:**
1. Detects project root, language, and framework
2. Indexes the codebase with ML embeddings
3. Cleans junk entries (minified builds, vendor scripts, tests)
4. Configures MCP in `~/.mcp.json` (merges, doesn't overwrite other servers)
5. Creates project-level `.mcp.json` for team sharing
6. Runs a live test query to verify everything works

---

## `doctor`

Health check — verifies every component of the Indexa pipeline.

```bash
npx indexa-mcp doctor
```

Checks:
- Index exists and has chunks
- Embedding type (ML 384-dim vs hash 128-dim)
- Metadata file integrity
- MCP config in `~/.mcp.json`
- Claude Code installation
- Compiled MCP server exists
- MCP server starts and responds

---

## `index`

Full index of a codebase directory. Uses local ML embeddings (Transformers.js, gte-small, 384-dim) — no API keys needed.

```bash
npx indexa-mcp index "D:\path\to\project"
```

| Option | Description |
|--------|-------------|
| `[directory]` | Directory to index |
| `--data-dir <path>` | Custom data directory |

---

## `update`

Incremental update using git diff.

```bash
npx indexa-mcp update
```

---

## `bundle` (PRIMARY)

Build a context bundle: search → pack symbols + dependencies + connections within token budget. Enforces max 2 chunks per file for diversity.

```bash
npx indexa-mcp bundle "vendor service area"
npx indexa-mcp bundle "authentication flow" --token-budget 1500
```

| Option | Description |
|--------|-------------|
| `<query>` | Search query (required) |
| `-b, --token-budget <number>` | Token budget (default: 2000) |
| `--data-dir <path>` | Custom data directory |

---

## `flow`

Trace execution flow from a symbol or query. Shows call chains across functions and files.

```bash
npx indexa-mcp flow "getVendorRatesByServiceArea"
npx indexa-mcp flow "VendorController" --depth 4
```

| Option | Description |
|--------|-------------|
| `<query>` | Symbol name, ID, or search query (required) |
| `-d, --depth <number>` | Traversal depth (default: 3, max: 6) |
| `--data-dir <path>` | Custom data directory |

---

## `explain`

Generate a human-readable explanation of a code area. No hallucination — only uses indexed symbols.

```bash
npx indexa-mcp explain "vendor service area"
npx indexa-mcp explain "authentication" --token-budget 1500
```

| Option | Description |
|--------|-------------|
| `<query>` | What to explain (required) |
| `-b, --token-budget <number>` | How much code to analyze (default: 2000) |
| `--data-dir <path>` | Custom data directory |

---

## `search`

Search the indexed codebase with auto-routing and intent classification.

Query router: identifiers → symbol lookup, short queries → BM25 keyword, else → hybrid (35% semantic + 25% BM25 + 15% name match + 25% path match).

Search output is capped: max 10 results, 2KB per chunk, 12K total chars, 12-line code preview.

```bash
npx indexa-mcp search "VendorService" --top-k 3
npx indexa-mcp search "service" --token-budget 500
```

| Option | Description |
|--------|-------------|
| `<query>` | Search query (required) |
| `-k, --top-k <number>` | Max results (default: 5) |
| `-b, --token-budget <number>` | Token budget (overrides topK) |
| `--data-dir <path>` | Custom data directory |

---

## `clean`

Purge junk chunks from the index (minified builds, vendor scripts, storybook, etc.).

```bash
npx indexa-mcp clean
```

---

## `serve`

Start the REST API server. Exposes 12 endpoints.

```bash
npx indexa-mcp serve --port 3000
```
