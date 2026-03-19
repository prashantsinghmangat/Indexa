# Indexa v2.1 — CLI Reference

All commands are run from the project root (`D:\Project\Indexa`).

```
node dist/cli/index.js <command> [options]
```

---

## `init`

Initialize Indexa in the current directory.

```powershell
node dist/cli/index.js init
node dist/cli/index.js init --dir "D:\other\project"
```

| Option | Description |
|--------|-------------|
| `-d, --dir <path>` | Target directory (default: current directory) |

---

## `index`

Full index of a codebase directory.

```powershell
node dist/cli/index.js index "D:\path\to\project"
node dist/cli/index.js index ./sample-code
```

| Option | Description |
|--------|-------------|
| `[directory]` | Directory to index (positional) |
| `--data-dir <path>` | Custom data storage directory |

Skips unchanged files (hash-based detection). Code is NOT stored in the index — only byte offsets.

---

## `update`

Incremental update using git diff.

```powershell
node dist/cli/index.js update
```

| Option | Description |
|--------|-------------|
| `--data-dir <path>` | Custom data storage directory |

---

## `bundle` (PRIMARY)

Build a context bundle: search → pack symbols + dependencies within a token budget. **This is the most useful command.**

```powershell
node dist/cli/index.js bundle "vendor service area"
node dist/cli/index.js bundle "authentication flow" --token-budget 1500
node dist/cli/index.js bundle "VendorService" --token-budget 500
```

| Option | Description |
|--------|-------------|
| `<query>` | Search query (required) |
| `-b, --token-budget <number>` | Token budget (default: 2000) |
| `--data-dir <path>` | Custom data directory |

**What it does:**
1. Runs hybrid search (auto-routed by query type)
2. Ranks results by 3-component score (semantic + BM25 + name match)
3. Reads code from source files via byte offsets
4. Packs symbols until token budget is exhausted
5. Resolves 1-level dependencies for each symbol
6. Returns ready-to-use context

---

## `search`

Search the indexed codebase. Auto-routes by query type.

```powershell
node dist/cli/index.js search "VendorService"                    # → symbol lookup
node dist/cli/index.js search "vendor service"                    # → BM25 keyword
node dist/cli/index.js search "vendor service area logic" -k 3    # → hybrid
node dist/cli/index.js search "service" --token-budget 500        # → token budget
```

| Option | Description |
|--------|-------------|
| `<query>` | Search query (required) |
| `-k, --top-k <number>` | Number of results (default: 5) |
| `-b, --token-budget <number>` | Token budget (overrides topK) |
| `--data-dir <path>` | Custom data directory |

**Query routing:**

| Query pattern | Route |
|--------------|-------|
| `VendorService`, `$scope`, `get_user` | Symbol lookup (O(1)) |
| `vendor service` (1-2 words) | BM25 keyword |
| `vendor service area logic` (3+ words) | Full hybrid |

---

## `serve`

Start the REST API server.

```powershell
node dist/cli/index.js serve
node dist/cli/index.js serve --port 8080
```

| Option | Description |
|--------|-------------|
| `-p, --port <number>` | Server port (default: 3000) |

See [API Reference](./api-reference.md) for endpoints.

---

## `--help`

```powershell
node dist/cli/index.js --help
node dist/cli/index.js bundle --help
```

## `--version`

```powershell
node dist/cli/index.js --version
```
