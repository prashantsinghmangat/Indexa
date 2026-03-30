# Indexa — MCP Integration with Claude Code

Indexa provides 19 MCP tools including execution flow tracing, code explanation, context-stitched bundles, dead code detection, impact analysis, and security scanning. Proven 51% token reduction vs manual file reading.

## Setup (One Command)

```bash
npx indexa-mcp setup
```

This automatically:
1. Installs and indexes your codebase with ML embeddings
2. Configures `~/.mcp.json` for Claude Code (with MCP `instructions` field for auto-tool-selection)
3. Creates a project-level `.mcp.json`
4. Creates `CLAUDE.md` with Indexa tool instructions (auto-use priority)
5. Verifies everything works

### Manual Setup (if needed)

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
      ],
      "instructions": "Use Indexa tools FIRST for all code understanding tasks before using Explore, Grep, Read, or Bash. Indexa has pre-indexed code chunks with semantic search, flow tracing, and impact analysis available instantly."
    }
  }
}
```

**Critical:** The `--data-dir` argument passes the absolute path to the data directory. Without it, the MCP server looks for data relative to `__dirname` which may not resolve correctly.

**Note:** The `instructions` field is an MCP-level directive that tells Claude to prefer Indexa tools automatically. This is set by `setup` and works independently of `CLAUDE.md`.

### 4. (Recommended) Add Project-Level Config

Create `.mcp.json` in the target project root (same content). This ensures Indexa is available when Claude Code is opened in that project.

### 5. Restart Claude Code

MCP servers load at session start. You must restart Claude Code after changing `.mcp.json`.

On startup, verify: type `MCP: indexa` — should show chunk/file counts.

---

## CLAUDE.md Template

> **v3.4+:** `indexa-mcp setup` now auto-creates this `CLAUDE.md` for you. You only need to manually add it if you skipped setup or want to customize it.

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

The main tool. Returns relevant symbols + source code + dependencies + connections, all packed within a token budget. Enforces max 2 chunks per file for diversity.

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

Auto-routed search. Query router detects if query is an identifier, keyword, or natural language and routes accordingly. Hybrid scoring: 35% semantic + 25% BM25 + 15% name match + 25% path match.

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

### `indexa_dead_code`

Find unreferenced functions, methods, and classes across the index.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| *(none)* | — | — | Returns all unreferenced symbols |

### `indexa_blast_radius`

Dedicated impact analysis — what breaks if you change a symbol.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `name` | string | *required* | Symbol name to analyze |

### `indexa_importers`

Find all files and symbols that import from a given file.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | string | *required* | File path to check |

### `indexa_circular_deps`

Detect circular dependency / import cycles in the codebase.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| *(none)* | — | — | Scans entire index for cycles |

### `indexa_unused_exports`

Find exported symbols that nobody imports.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| *(none)* | — | — | Returns all unused exports |

### `indexa_duplicates`

Find near-duplicate code blocks via embedding similarity.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `threshold` | number | 0.85 | Similarity threshold 0-1 |

### `indexa_impact_chain`

Full transitive impact analysis — follows the chain of dependents recursively.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `name` | string | *required* | Symbol name |
| `depth` | number | 3 | Max traversal depth (1-10) |

### `indexa_review_pr`

Context-aware PR review. Analyzes changed files and provides review comments using indexed context.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `baseBranch` | string | `"main"` | Base branch to diff against |

### `indexa_security_scan`

OWASP-grouped security scan across the indexed codebase.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| *(none)* | — | — | Scans for common security patterns |

### `indexa_code_grep`

Regex pattern search across indexed source files.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `pattern` | string | *required* | Regex pattern to search for |
| `filePattern` | string | `""` | File glob filter (e.g., `*.ts`) |

---

## Alternative: VS Code Extension

If you prefer a visual interface over MCP-only workflow, the Indexa VS Code extension (v0.4.0) provides a sidebar with search, flow tracing, references, and inline AI commands — all with click-to-navigate that opens files at the exact line.

1. **From Marketplace:** Search "Indexa Code Intelligence" in VS Code Extensions, or visit [Indexa on Marketplace](https://marketplace.visualstudio.com/items?itemName=PrashantSingh.indexa-code-intelligence)
2. **Or from GitHub:** Download `.vsix` from [Releases](https://github.com/prashantsinghmangat/Indexa/releases) → `code --install-extension indexa-code-intelligence-0.4.0.vsix`
3. The extension auto-starts the server — no manual `indexa-mcp serve` needed.
4. Use `Ctrl+Shift+I` to query from the sidebar.

### Inline AI Commands (v0.4.0)

Select code in the editor and use these commands via right-click or keyboard shortcuts:

| Command | Shortcut | Description |
|---------|----------|-------------|
| **Explain This** | `Ctrl+Shift+E` | Explain selected code using indexed context |
| **Fix This** | `Ctrl+Shift+F` | Fix selected code using indexed context |
| **What Calls This** | Right-click | Find callers of the selected symbol |
| **Refactor This** | Right-click | Suggest refactoring using indexed context |
| **Generate Tests** | Right-click | Generate tests for selected code |

### Diagnostic Integration

The extension integrates with VS Code's diagnostic system:
- **Lightbulb "Fix with Indexa"** — appears on error squiggles, uses indexed context to suggest fixes
- **Auto-index on save** — modified files are re-indexed automatically when saved

The extension and MCP integration work independently. You can use both — MCP for Claude Code conversations, and the extension for quick lookups in VS Code.

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

In v3.4+, the MCP `instructions` field should handle this automatically — Claude is told at the MCP level to prefer Indexa tools. If you still see this issue:

1. Verify your `.mcp.json` has the `"instructions"` field (re-run `npx indexa-mcp setup` to add it)
2. Ensure `CLAUDE.md` exists at the project root with the Indexa instructions at the **very top** (setup auto-creates this)
3. If CLAUDE.md instructions are buried in the middle (after line 100+), Claude deprioritizes them — move them to the top

### MCP error: Input validation error

This was fixed in v3.0.1 — all numeric parameters now use `z.coerce.number()` to accept both strings and numbers. Rebuild with `npm run build`.

### Test MCP server manually

```powershell
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' | node D:\Project\Indexa\dist\src\mcp\stdio.js --data-dir D:\Project\Indexa\data
```

Should return clean JSON-RPC (no `[INFO]` lines on stdout). All logging goes to stderr.
