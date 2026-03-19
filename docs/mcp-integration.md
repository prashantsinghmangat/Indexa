# Indexa v2.1 — MCP Integration with Claude Code

Indexa acts as an MCP server, giving Claude Code direct access to your indexed codebase through 8 focused tools.

## Setup

### 1. Build

```powershell
cd D:\Project\Indexa
npm install
npm run build
```

### 2. Index

```powershell
node dist/cli/index.js init
node dist/cli/index.js index "D:\path\to\your\project"
```

### 3. Configure Claude Code

Add to `~/.mcp.json`:

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

---

## MCP Tools (8)

### `indexa_context_bundle` — PRIMARY

**Use this first for any code question.** Given a query + token budget, returns packed symbols + 1-level dependencies.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `query` | string | *required* | What you're looking for |
| `tokenBudget` | number | 2000 | Max tokens. Keep 1000-3000 for focused results |

**Example prompt:** "Use indexa_context_bundle to find vendor service area logic"

---

### `indexa_search`

Raw search with scores. Auto-routes by query type (identifier → symbol lookup, short → BM25, else → hybrid). Use `indexa_context_bundle` instead if you want code + deps.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `query` | string | *required* | Search query |
| `topK` | number | 5 | Max results |
| `tokenBudget` | number | 0 | Token budget (0 = use topK) |

---

### `indexa_symbol`

O(1) lookup by stable ID, or name search.

| Param | Type | Description |
|-------|------|-------------|
| `name` | string | Stable ID (e.g. `src/auth.ts::validate#function`) or symbol name |

---

### `indexa_file`

File outline (default) or full code for all symbols.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `path` | string | *required* | File path |
| `include_code` | boolean | false | Include source code |

---

### `indexa_dependencies`

What a symbol depends on + what depends on it.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `symbolId` | string | *required* | Symbol ID or name |
| `depth` | number | 2 | Traversal depth (1-5) |

---

### `indexa_references`

Find all usages of a symbol + blast radius (direct + transitive).

| Param | Type | Description |
|-------|------|-------------|
| `name` | string | Symbol name |

---

### `indexa_index`

Index or re-index a directory.

| Param | Type | Description |
|-------|------|-------------|
| `directory` | string | Absolute path |

---

### `indexa_stats`

Index statistics. No parameters.

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `INDEXA_DATA_DIR` | Override data directory |
| `INDEXA_CONFIG` | Override config file path |
| `INDEXA_DEBUG` | Enable debug logging |

---

## Usage Tips

1. **Always start with `indexa_context_bundle`.** It handles 80% of cases in a single call.
2. **Use `indexa_symbol` for known IDs.** If you have an ID from a previous call, use it for O(1) lookup.
3. **Use small token budgets.** 1000-2000 tokens is usually enough. Don't request 10K.
4. **Use `indexa_references` before refactoring.** Check what breaks before changing a symbol.
5. **Use `indexa_file` with `include_code: false` for orientation.** See what's in a file without loading all code.
6. **Re-index after major changes.** Byte offsets shift after refactors.

---

## Per-Project Config

Create `.mcp.json` in the project root instead of global:

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

## Troubleshooting

See [Troubleshooting](./troubleshooting.md).
