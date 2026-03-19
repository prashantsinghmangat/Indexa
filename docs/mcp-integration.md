# Indexa v2.0 — MCP Integration with Claude Code

Indexa acts as an MCP (Model Context Protocol) server, giving Claude Code direct access to your indexed codebase through 12 tools.

## Setup

### 1. Build Indexa

```powershell
cd D:\Project\Indexa
npm install
npm run build
```

### 2. Index Your Codebase

```powershell
node dist/cli/index.js init
node dist/cli/index.js index "D:\path\to\your\project"
```

### 3. Configure Claude Code

Add to your MCP config at `~/.mcp.json`:

```json
{
  "mcpServers": {
    "indexa": {
      "command": "node",
      "args": ["D:/Project/Indexa/dist/src/mcp/stdio.js"]
    }
  }
}
```

### 4. Restart Claude Code

Start a new Claude Code session. The 12 Indexa tools will be available automatically.

---

## Available MCP Tools (12)

### Search & Retrieval

#### `indexa_search`

Search the indexed codebase. Supports hybrid, semantic, and BM25 keyword modes. Token budgeting packs results until budget exhausted.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `query` | string | *required* | Search query |
| `topK` | number | 5 | Max results (1–50) |
| `tokenBudget` | number | 0 | Token budget (0 = use topK) |
| `mode` | string | `"hybrid"` | `"hybrid"`, `"semantic"`, or `"keyword"` |

#### `indexa_get_symbol`

O(1) lookup by stable symbol ID. Fastest way to retrieve a specific symbol.

| Param | Type | Description |
|-------|------|-------------|
| `id` | string | Stable symbol ID (e.g. `src/auth.ts::validateToken#function`) |

#### `indexa_find_symbol`

Search for symbols by name (case-insensitive partial match).

| Param | Type | Description |
|-------|------|-------------|
| `name` | string | Symbol name to search for |

---

### File Analysis

#### `indexa_file_outline`

Get the symbol outline of a file — all indexed symbols without loading code.

| Param | Type | Description |
|-------|------|-------------|
| `path` | string | File path (absolute or partial match) |

---

### Graph Analysis

#### `indexa_dependency_graph`

Get the dependency graph for a symbol. Shows what it depends on and what depends on it.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `symbolId` | string | *required* | Symbol ID to analyze |
| `depth` | number | 2 | Traversal depth (1–5) |

#### `indexa_find_importers`

Find all symbols that import from a given file.

| Param | Type | Description |
|-------|------|-------------|
| `filePath` | string | File path to find importers for |

#### `indexa_find_references`

Find all symbols that reference or depend on a given symbol name.

| Param | Type | Description |
|-------|------|-------------|
| `symbolName` | string | Symbol name to find references for |

#### `indexa_class_hierarchy`

Get class inheritance hierarchy — parents and children.

| Param | Type | Description |
|-------|------|-------------|
| `className` | string | Class name to analyze |

#### `indexa_blast_radius`

Estimate change impact — how many symbols and files would be affected.

| Param | Type | Description |
|-------|------|-------------|
| `symbolName` | string | Symbol name to analyze |

---

### Context Assembly

#### `indexa_context_bundle`

Build a context bundle: primary symbols + deduplicated imports. Token-budgeted for LLM consumption.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `symbolIds` | string[] | *required* | Array of symbol IDs to bundle |
| `tokenBudget` | number | 4000 | Max tokens for the bundle |

---

### Index Management

#### `indexa_index`

Index or re-index a codebase directory.

| Param | Type | Description |
|-------|------|-------------|
| `directory` | string | Absolute path to the directory to index |

#### `indexa_stats`

Get statistics about the current index. No parameters.

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `INDEXA_DATA_DIR` | Override the data directory path |
| `INDEXA_CONFIG` | Override the config file path |
| `INDEXA_DEBUG` | Enable debug logging (set to any value) |

Example:
```json
{
  "mcpServers": {
    "indexa": {
      "command": "node",
      "args": ["D:/Project/Indexa/dist/src/mcp/stdio.js"],
      "env": {
        "INDEXA_DATA_DIR": "D:/Project/Indexa/data"
      }
    }
  }
}
```

---

## Per-Project MCP Config

Create `.mcp.json` in the project root instead of global config:

```json
{
  "mcpServers": {
    "indexa": {
      "command": "node",
      "args": ["D:/Project/Indexa/dist/src/mcp/stdio.js"]
    }
  }
}
```

---

## Usage Tips

1. **Use `indexa_get_symbol` for known symbols.** O(1) lookup is faster than searching.
2. **Use token budgets.** Set `tokenBudget: 2000` instead of guessing topK.
3. **Use `indexa_context_bundle` for migrations.** Bundle symbols + imports into one context-ready package.
4. **Use `indexa_blast_radius` before refactoring.** Check impact before renaming or modifying symbols.
5. **Use `indexa_file_outline` for orientation.** Quick overview without loading code.
6. **Re-index after major changes.** Byte offsets may shift after refactors or branch switches.

---

## Troubleshooting

See [Troubleshooting](./troubleshooting.md) for common issues with MCP setup.
