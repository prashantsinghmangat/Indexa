# Indexa v3.1 — CLI Reference

```
indexa <command> [options]
```

> If `indexa` isn't in your PATH, use `node D:/Project/Indexa/dist/cli/index.js` instead.

All commands work from any directory — data paths resolve automatically to the Indexa install root.

---

## `setup` (Start Here)

One-command setup: detect project → index → configure MCP → verify. Under 60 seconds.

```powershell
indexa setup                                # Auto-detects project from current dir
indexa setup "D:\SafeGuard\SPINext-App"     # Explicit project path
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

```powershell
indexa doctor
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

## `init`

Initialize Indexa config and data directories. Not needed if you use `indexa setup`.

```powershell
indexa init
```

---

## `index`

Full index of a codebase directory. Uses local ML embeddings (Transformers.js, gte-small, 384-dim) — no API keys needed.

```powershell
indexa index "D:\path\to\project"
```

| Option | Description |
|--------|-------------|
| `[directory]` | Directory to index |
| `--data-dir <path>` | Custom data directory |

---

## `update`

Incremental update using git diff.

```powershell
indexa update
```

---

## `bundle` (PRIMARY)

Build a context bundle: search → pack symbols + dependencies + connections within token budget. Enforces max 2 chunks per file for diversity.

```powershell
indexa bundle "vendor service area"
indexa bundle "authentication flow" --token-budget 1500
```

| Option | Description |
|--------|-------------|
| `<query>` | Search query (required) |
| `-b, --token-budget <number>` | Token budget (default: 2000) |
| `--data-dir <path>` | Custom data directory |

---

## `flow`

Trace execution flow from a symbol or query. Shows call chains across functions and files.

```powershell
indexa flow "getVendorRatesByServiceArea"
indexa flow "VendorController" --depth 4
indexa flow "vendor service area"
```

| Option | Description |
|--------|-------------|
| `<query>` | Symbol name, ID, or search query (required) |
| `-d, --depth <number>` | Traversal depth (default: 3, max: 6) |
| `--data-dir <path>` | Custom data directory |

**Output:** Indented call chain with step numbers, summaries, and file paths.

---

## `explain`

Generate a human-readable explanation of a code area. No hallucination — only uses indexed symbols.

```powershell
indexa explain "vendor service area"
indexa explain "authentication" --token-budget 1500
```

| Option | Description |
|--------|-------------|
| `<query>` | What to explain (required) |
| `-b, --token-budget <number>` | How much code to analyze (default: 2000) |
| `--data-dir <path>` | Custom data directory |

**Output:** Explanation paragraph, numbered steps, and list of symbols analyzed.

---

## `search`

Search the indexed codebase with auto-routing. Query router: identifiers → symbol lookup, short queries → BM25 keyword, else → hybrid (35% semantic + 25% BM25 + 15% name match + 25% path match).

```powershell
indexa search "VendorService" --top-k 3
indexa search "service" --token-budget 500
```

| Option | Description |
|--------|-------------|
| `<query>` | Search query (required) |
| `-k, --top-k <number>` | Max results (default: 5) |
| `-b, --token-budget <number>` | Token budget (overrides topK) |
| `--data-dir <path>` | Custom data directory |

---

## `serve`

Start the REST API server. Exposes 12 endpoints.

```powershell
indexa serve --port 3000
```
