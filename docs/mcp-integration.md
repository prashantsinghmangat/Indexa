# Indexa v3.0 — MCP Integration with Claude Code

Indexa provides 9 MCP tools including execution flow tracing, code explanation, and context-stitched bundles.

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

Add to `~/.mcp.json`:

```json
{
  "mcpServers": {
    "indexa": {
      "command": "node",
      "args": [
        "D:/Project/Indexa/dist/src/mcp/stdio.js",
        "--data-dir",
        "D:/Project/Indexa/data"
      ]
    }
  }
}
```

**Critical:** The `--data-dir` argument passes the absolute path to the data directory. Without it, the MCP server looks for data relative to `__dirname` which may not resolve correctly.

### 4. (Recommended) Add Project-Level Config

Create `.mcp.json` in the target project root (same content). This ensures Indexa is available when Claude Code is opened in that project.

### 5. Restart Claude Code

MCP servers load at session start. You must restart Claude Code after changing `.mcp.json`.

On startup, verify: type `MCP: indexa` — should show chunk/file counts.

---

## CLAUDE.md Template

Add this to the **top** of your project's `CLAUDE.md` to make Claude auto-use Indexa:

```markdown
## MANDATORY: Use Indexa MCP Tools First

**RULE: Before using Explore, Grep, Read, or Bash to understand code, you MUST call Indexa MCP tools first.** This project has pre-indexed code chunks available instantly. Do NOT spawn Agent:Explore or run file searches when Indexa can answer the question in seconds.

**Tool priority for code questions:**
1. `indexa_context_bundle` — ALWAYS call this first. Returns relevant code + deps + connections within a token budget.
2. `indexa_explain` — For "explain" or "how does X work" questions. Returns structured explanation.
3. `indexa_flow` — For "what calls what" or debugging questions. Returns execution trace.
4. `indexa_symbol` — For looking up a specific function/class by name. O(1) lookup.
5. `indexa_search` — For general code search. Faster than Grep for indexed files.

**Only use Explore/Grep/Read/Bash if:**
- Indexa returns no results or irrelevant results
- You need files created in this session (not yet indexed)
- You need non-code files (config, package.json, etc.)
- The user explicitly asks to read a specific file

**Token budget guidelines:** Use `tokenBudget: 2000` for focused queries, `tokenBudget: 3000` for cross-module queries.
```

**Important:** This must be at the **top** of CLAUDE.md, not buried in the middle. Instructions at the top have the highest priority.

---

## Available MCP Tools

### `indexa_context_bundle` (PRIMARY)

The main tool. Returns relevant symbols + source code + dependencies + connections, all packed within a token budget.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | *required* | What you are looking for |
| `tokenBudget` | number | 2000 | Max tokens (1000-3000 for focused results) |

### `indexa_flow`

Traces execution flow from a symbol or query. Shows call chains across functions and files.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | *required* | Symbol name, ID, or search query |
| `depth` | number | 3 | How many levels deep (1-6) |

### `indexa_explain`

Human-readable explanation of a code area. Built from actual symbols — no hallucination.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | *required* | What to explain |
| `tokenBudget` | number | 2000 | How much code to analyze |

### `indexa_search`

Auto-routed search. Detects if query is an identifier, keyword, or natural language and routes accordingly.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | *required* | Search query |
| `topK` | number | 5 | Max results (1-50) |
| `tokenBudget` | number | 0 | Token budget (0 = use topK) |

### `indexa_symbol`

O(1) lookup by stable ID or name.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `name` | string | *required* | Symbol name or stable ID |

### `indexa_file`

Get all indexed symbols in a file.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | string | *required* | File path |
| `include_code` | boolean | false | Include source code |

### `indexa_references`

Find all references to a symbol + blast radius.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `name` | string | *required* | Symbol name |

### `indexa_index`

Index or re-index a codebase directory. Skips unchanged files.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `directory` | string | *required* | Absolute path to directory |

### `indexa_stats`

Index statistics and cache status. No parameters.

---

## Re-indexing from Claude Code

Ask Claude directly:

```
Use indexa_index to re-index D:\SafeGuard\SPINext-App-SPIGlass
```

See [Re-indexing Guide](./reindexing.md) for all options.

---

## Troubleshooting MCP

### Tools not appearing in Claude Code

1. Check `~/.mcp.json` exists and is valid JSON
2. Check the compiled file exists: `D:\Project\Indexa\dist\src\mcp\stdio.js`
3. Check `~/.claude/settings.local.json` has `"enabledMcpjsonServers": ["indexa"]`
4. **Restart Claude Code** (MCP loads at session start)

### MCP connected but 0 chunks

The `--data-dir` argument is missing or wrong. Check your `.mcp.json`:
```json
"args": [
  "D:/Project/Indexa/dist/src/mcp/stdio.js",
  "--data-dir",
  "D:/Project/Indexa/data"
]
```

### Claude ignores Indexa and uses Explore/Grep instead

The CLAUDE.md instructions must be at the **very top** of the file, marked as MANDATORY. If buried in the middle (after line 100+), Claude deprioritizes them.

### MCP error: Input validation error

This was fixed in v3.0.1 — all numeric parameters now use `z.coerce.number()` to accept both strings and numbers. Rebuild with `npm run build`.

### Test MCP server manually

```powershell
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' | node D:\Project\Indexa\dist\src\mcp\stdio.js --data-dir D:\Project\Indexa\data
```

Should return clean JSON-RPC (no `[INFO]` lines on stdout). All logging goes to stderr.
