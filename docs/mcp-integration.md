# Indexa v3.0 — MCP Integration with Claude Code

Indexa provides 9 MCP tools including intelligence features: execution flow tracing, code explanation, and context-stitched bundles.

## Setup

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

Restart Claude Code.

---

## MCP Tools (9)

### Intelligence Tools

#### `indexa_context_bundle` — PRIMARY

**Use this first.** Returns relevant symbols + code + dependencies + connections within a token budget.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `query` | string | *required* | What you're looking for |
| `tokenBudget` | number | 2000 | Max tokens |

#### `indexa_flow`

Trace execution flow. Shows what calls what across functions and files.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `query` | string | *required* | Symbol name, ID, or search query |
| `depth` | number | 3 | Traversal depth (1-6) |

#### `indexa_explain`

Generate a human-readable explanation with step-by-step breakdown. Built from actual code — no hallucination.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `query` | string | *required* | What to explain |
| `tokenBudget` | number | 2000 | How much code to analyze |

---

### Search & Retrieval Tools

#### `indexa_search`
Auto-routed search with scores.

#### `indexa_symbol`
O(1) lookup by stable ID or name search.

#### `indexa_file`
File outline (default) or full code (`include_code: true`).

#### `indexa_references`
Find all usages of a symbol + blast radius.

---

### Index Management

#### `indexa_index`
Index or re-index a directory. Clears query cache.

#### `indexa_stats`
Index statistics + cache status.

---

## Caching

Responses for `indexa_context_bundle`, `indexa_flow`, and `indexa_explain` are cached in-memory:
- **Max entries:** 100
- **TTL:** 5 minutes
- **Auto-invalidated** on re-index

Second call to the same query returns instantly.

---

## Usage Tips

1. **Start with `indexa_context_bundle`** — handles 80% of cases
2. **Use `indexa_flow` to understand call chains** — "what happens when this function runs?"
3. **Use `indexa_explain` for onboarding** — "explain the vendor management system"
4. **Use small token budgets** (1000-2000) for focused results
5. **Use `indexa_symbol` with stable IDs** from previous tool calls for O(1) lookup
6. **Re-index after major changes** — byte offsets shift after refactors

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `INDEXA_DATA_DIR` | Override data directory |
| `INDEXA_CONFIG` | Override config file |
| `INDEXA_DEBUG` | Enable debug logging |
