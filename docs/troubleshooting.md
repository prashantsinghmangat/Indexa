# Indexa — Troubleshooting

## First Step: Run Doctor

Before debugging manually, run:
```bash
npx indexa-mcp doctor
```

This checks index, embeddings, MCP config, Claude Code, build, and server — with pass/fail for each.

---

## Common Issues

### `indexa-mcp` command not found

**Fix:** Use `npx` which doesn't require global install:
```bash
npx indexa-mcp doctor
```

Or install globally:
```bash
npm install -g indexa-mcp
```

---

### npm package name is `indexa-mcp`, not `indexa`

The name `indexa` was taken on npm. The correct package name is `indexa-mcp`:
```bash
npx indexa-mcp setup        # correct
npx indexa setup             # wrong — installs a different package
```

---

### Search returns "No indexed data found"

**Cause:** CLI was looking for `data/` relative to your current directory.

**Fix:** Update to latest version — all CLI commands now resolve data paths from the Indexa install root automatically.

---

### Search returns too large output (crashes Claude)

**Cause:** Minified build output (90KB+ chunks) or too many results returned.

**Fix:** Already fixed in v3.1 — search output is capped at:
- Max 10 results
- 2KB per chunk read
- 12K total chars
- 12-line code preview

Rebuild and restart Claude Code to pick up the fix.

---

### Build output indexed (`.next/`, `out/`, `build/`)

**Cause:** Framework build output was indexed before exclude patterns were updated.

**Fix:**
1. Run `npx indexa-mcp clean` to purge junk entries
2. Update `config/indexa.config.json` exclude patterns to include: `.next`, `_next`, `out`, `.vercel`, `build`, `chunks`
3. Re-index: `npx indexa-mcp index "D:\path\to\project"`

---

### MCP tools not appearing in Claude Code

**Checklist:**
1. Verify `~/.mcp.json` exists and has the `indexa` entry
2. Verify compiled file exists: `ls D:\Project\Indexa\dist\src\mcp\stdio.js`
3. **Restart Claude Code** — MCP servers load at session start only

---

### MCP connected but shows 0 chunks

**Cause:** The `--data-dir` argument points to a directory without index data.

**Fix:** Run `indexa-mcp setup` in your project directory. This creates `.indexa/` with index data and configures `.mcp.json` to point to it:
```json
{
  "mcpServers": {
    "indexa": {
      "command": "node",
      "args": [
        "/path/to/indexa-mcp/dist/src/mcp/stdio.js",
        "--data-dir",
        "/path/to/your-project/.indexa"
      ]
    }
  }
}
```

**Common mistake:** If you previously installed `indexa-mcp` as a project dependency (`npm i indexa-mcp`), the data may be in `node_modules/indexa-mcp/data/` — this gets wiped on `npm install`. Re-run `indexa-mcp setup` to fix.

---

### Claude ignores Indexa and uses Explore/Grep instead

**Fix:** Move the Indexa section to the **very first thing** in CLAUDE.md, marked as MANDATORY:
```markdown
## MANDATORY: Use Indexa MCP Tools First

**RULE: Before using Explore, Grep, Read, or Bash to understand code, you MUST call Indexa MCP tools first.**
```

Instructions at the top of CLAUDE.md have highest priority.

---

### Search returns irrelevant results (noise)

**Common causes:**
1. Minified build artifacts indexed (single-letter function names)
2. Storybook/test files indexed
3. Vendor libraries indexed

**Fix:** Run `npx indexa-mcp clean` to purge junk, then update exclude patterns in config.

---

### Transformers.js model download fails

**Cause:** First run requires downloading the gte-small model (~30MB). May fail behind corporate proxies.

**Fix:** Ensure network access on first run. The model is cached after first download.

---

### Embeddings dimension mismatch after upgrade

**Cause:** Upgraded from hash-based embeddings (128-dim) to ML embeddings (384-dim).

**Fix:** Delete old data and re-index:
```bash
npx indexa-mcp index "D:\path\to\project"
```

---

### Server port already in use

```bash
npx indexa-mcp serve --port 8080
```

---

### VS Code extension not showing in sidebar

**Checklist:**
1. Verify the extension is installed: `code --list-extensions | grep indexa`
2. If not installed: search "Indexa Code Intelligence" in VS Code Extensions, or visit [Marketplace](https://marketplace.visualstudio.com/items?itemName=PrashantSingh.indexa-code-intelligence). Alternatively, download `.vsix` from [GitHub Releases](https://github.com/prashantsinghmangat/Indexa/releases).
3. **Reload VS Code** — `Ctrl+Shift+P` → "Developer: Reload Window"
4. Check that `npx indexa-mcp setup` has been run in the project (the extension needs `.indexa/` data)
5. Look for the Indexa icon in the Activity Bar (left sidebar). If missing, right-click the Activity Bar and ensure Indexa is checked.

### VS Code extension not connecting to server

The extension auto-starts the Indexa server. If it fails:
1. Check the Output panel: `View` → `Output` → select "Indexa" from the dropdown
2. Verify `npm install -g indexa-mcp` was run, or that `npx indexa-mcp serve` works manually
3. Ensure port 3000 is not in use by another process

---

## Diagnostic Commands

```bash
npx indexa-mcp doctor                              # Full health check
npx indexa-mcp search "test" --top-k 3             # Verify search works
npx indexa-mcp clean                                # Purge junk entries
```
