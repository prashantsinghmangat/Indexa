# Indexa v3.0 — CLI Reference

```
node dist/cli/index.js <command> [options]
```

---

## `init`

Initialize Indexa in the current directory.

```powershell
node dist/cli/index.js init
```

---

## `index`

Full index of a codebase directory. Uses local ML embeddings (Transformers.js, gte-small, 384-dim) — no API keys needed.

```powershell
node dist/cli/index.js index "D:\path\to\project"
```

| Option | Description |
|--------|-------------|
| `[directory]` | Directory to index |
| `--data-dir <path>` | Custom data directory |

---

## `update`

Incremental update using git diff.

```powershell
node dist/cli/index.js update
```

---

## `bundle` (PRIMARY)

Build a context bundle: search → pack symbols + dependencies + connections within token budget. Enforces max 2 chunks per file for diversity.

```powershell
node dist/cli/index.js bundle "vendor service area"
node dist/cli/index.js bundle "authentication flow" --token-budget 1500
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
node dist/cli/index.js flow "getVendorRatesByServiceArea"
node dist/cli/index.js flow "VendorController" --depth 4
node dist/cli/index.js flow "vendor service area"
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
node dist/cli/index.js explain "vendor service area"
node dist/cli/index.js explain "authentication" --token-budget 1500
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
node dist/cli/index.js search "VendorService" --top-k 3
node dist/cli/index.js search "service" --token-budget 500
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
node dist/cli/index.js serve --port 3000
```
