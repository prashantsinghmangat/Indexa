# Indexa v2.0 — CLI Reference

All commands are run from the project root (`D:\Project\Indexa`).

```
node dist/cli/index.js <command> [options]
```

Or using npm script:
```
npm run indexa -- <command> [options]
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

**What it does:**
- Creates `config/` directory with `indexa.config.json`
- Creates `data/` directory with empty `embeddings.json` and `metadata.json`
- Skips if config already exists

---

## `index`

Full index of a codebase directory.

```powershell
node dist/cli/index.js index "D:\path\to\project"
node dist/cli/index.js index ./sample-code
node dist/cli/index.js index                         # indexes projectRoot from config
```

| Option | Description |
|--------|-------------|
| `[directory]` | Directory to index (positional, optional) |
| `--data-dir <path>` | Custom data storage directory |

**What it does:**
1. Walks the directory recursively
2. Filters files by `includePatterns` / `excludePatterns` from config
3. Parses each file (AST for TS/TSX, regex for JS)
4. Chunks elements at function/class/component level
5. Generates embeddings for each chunk
6. Stores in `data/embeddings.json` and `data/metadata.json`
7. Skips unchanged files (hash-based detection)

**Example output:**
```
Indexing complete in 1.31s
  Files indexed: 1353
  Chunks created: 12241
  Data stored in: ./data
```

---

## `update`

Incremental update using git diff.

```powershell
node dist/cli/index.js update
node dist/cli/index.js update --data-dir ./custom-data
```

| Option | Description |
|--------|-------------|
| `--data-dir <path>` | Custom data storage directory |

**What it does:**
1. Runs `git diff --name-status HEAD~1` to detect changes
2. Removes chunks for deleted files
3. Re-indexes added/modified files
4. Only processes files matching `includePatterns`

**Example output:**
```
Update complete in 0.45s
  Files updated: 5
  Files removed: 1
  Chunks created: 23
```

---

## `search`

Search the indexed codebase.

```powershell
node dist/cli/index.js search "vendor service"
node dist/cli/index.js search "authentication middleware" --top-k 3
node dist/cli/index.js search "$scope controller" --data-dir ./custom-data
node dist/cli/index.js search "service" --token-budget 500
```

| Option | Description |
|--------|-------------|
| `<query>` | Search query (required, positional) |
| `-k, --top-k <number>` | Number of results (default: 5) |
| `-b, --token-budget <number>` | Token budget (overrides topK). Packs results until budget exhausted. |
| `--data-dir <path>` | Custom data storage directory |

**What it does:**
1. Loads the index from `data/embeddings.json`
2. Runs hybrid search (70% semantic + 30% BM25 keyword)
3. If `--token-budget` set: packs results until budget exhausted
4. Reads code from source files via byte offsets
5. Prints ranked results with stable ID, score, name, type, file location, summary, and code preview

**Example output:**
```
Found 5 results:

--- Result 1 (score: 80.8%) ---
  ID: D:/project/public/Areas/VendorManagement/Web/reactVendorFeature.service.js::reactVendorFeatureService#service
  Name: reactVendorFeatureService
  Type: service
  File: public/Areas/VendorManagement/Web/reactVendorFeature.service.js:7-30
  Summary: service "reactVendorFeatureService" (24 lines)
  Code:
    angular.module('app').factory('reactVendorFeatureService', ...
```

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

**What it does:**
- Loads the index into memory
- Starts Express server with all API endpoints
- Serves until terminated (Ctrl+C)

See [API Reference](./api-reference.md) for endpoint details.

---

## `--help`

```powershell
node dist/cli/index.js --help
node dist/cli/index.js search --help
```

Shows usage for any command.

---

## `--version`

```powershell
node dist/cli/index.js --version
```

Prints the Indexa version.
