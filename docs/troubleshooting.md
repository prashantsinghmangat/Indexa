# Indexa v3.0 — Troubleshooting

## Common Issues

### PowerShell `&&` error

```
The token '&&' is not a valid statement separator in this version.
```

**Fix:** Run commands separately in PowerShell:
```powershell
npm install
npm run build
```

---

### Build fails

```
error TS2305: Module has no exported member
```

**Fix:** Delete `dist/` and rebuild:
```powershell
rm -r dist
npm run build
```

---

### MCP tools not appearing in Claude Code

**Checklist:**
1. Verify `~/.mcp.json` exists:
   ```powershell
   cat ~/.mcp.json
   ```
2. Verify compiled file exists:
   ```powershell
   ls D:\Project\Indexa\dist\src\mcp\stdio.js
   ```
3. Verify Claude Code settings:
   ```powershell
   cat ~/.claude/settings.local.json
   ```
   Should contain: `"enabledMcpjsonServers": ["indexa"]`
4. **Restart Claude Code** — MCP servers load at session start only

---

### MCP connected but shows 0 chunks

**Cause:** The `--data-dir` argument is missing or the data files don't exist.

**Fix:** Ensure `.mcp.json` has the `--data-dir` argument:
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

Verify data files exist:
```powershell
ls D:\Project\Indexa\data\embeddings.json
ls D:\Project\Indexa\data\metadata.json
```

---

### MCP error: `[INFO]` lines corrupting protocol

**Cause:** Logger was writing to stdout, corrupting MCP JSON-RPC.

**Fix:** Already fixed in v3.0 — all logger output goes to stderr via `console.error()`. Rebuild:
```powershell
npm run build
```

---

### MCP error: Input validation error (tokenBudget)

```
Invalid arguments: expected number, received string
```

**Cause:** Claude sends string instead of number for optional parameters.

**Fix:** Already fixed — all numeric params use `z.coerce.number()`. Rebuild:
```powershell
npm run build
```

---

### Claude ignores Indexa and uses Explore/Grep instead

**Cause:** The Indexa instructions in CLAUDE.md are not at the top, or are too polite.

**Fix:** Move the Indexa section to the **very first thing** in CLAUDE.md, marked as MANDATORY:
```markdown
## MANDATORY: Use Indexa MCP Tools First

**RULE: Before using Explore, Grep, Read, or Bash to understand code, you MUST call Indexa MCP tools first.**
...
```

Instructions at the top of CLAUDE.md have highest priority. Buried instructions (line 100+) get deprioritized.

---

### Index shows 0 new chunks on re-index

**Normal behavior.** Files are unchanged — content hashes match. The index is already up to date.

**To force full re-index:**
```powershell
del data\embeddings.json
del data\metadata.json
node dist/cli/index.js index "D:\path\to\project" --data-dir ./data
```

---

### Search returns irrelevant results (noise)

**Common causes:**
1. **Minified build artifacts indexed** — single-letter function names (`e`, `s`, `v`) match everything
2. **Storybook/test files indexed** — `Search` from UiIcon.stories.tsx matches "search" queries
3. **Vendor libraries indexed** — angular-resource.js, jQuery, angular-mocks, etc.
4. **E2E test files indexed** — test infrastructure polluting results

**Fix:** Update `config/indexa.config.json` exclude patterns:
```json
"excludePatterns": [
  "node_modules", "dist", ".git",
  "*.test.*", "*.spec.*", "*.stories.*",
  "public/react-shell/assets",
  "public/Scripts", "public/Scripts/",
  "angular-mocks", "e2e/",
  "*.min.js", "*.bundle.js"
]
```

Then purge existing junk and re-index:
```powershell
node -e "const {VectorDB}=require('./dist/src/storage/vector-db');const db=new VectorDB('./data');let r=0;db.getAll().forEach(c=>{if(c.filePath.includes('pattern/to/remove')){db.remove(c.id);r++}});db.save();console.log('Removed',r)"
```

---

### Transformers.js model download fails

**Cause:** First run requires downloading the gte-small model (~30MB). May fail behind corporate proxies.

**Fix:** Ensure network access on first run, or copy the cached model from another machine. The model is cached in the default Hugging Face cache directory after first download.

---

### Embeddings dimension mismatch after upgrade

**Cause:** Upgraded from hash-based embeddings (128-dim) to ML embeddings (384-dim).

**Fix:** Delete old data and re-index:
```powershell
del data\embeddings.json
del data\metadata.json
node dist/cli/index.js index "D:\path\to\project" --data-dir ./data
```

Also update `embeddingDim` in `config/indexa.config.json` to `384`.

---

### Windows: `cd D:\path` doesn't change directory

**Cause:** In CMD, `cd` doesn't change drives.

**Fix:**
```cmd
D:
cd \SafeGuard\SPINext-App-SPIGlass
```

Or:
```cmd
cd /d D:\SafeGuard\SPINext-App-SPIGlass
```

---

### Server port already in use

```
Error: listen EADDRINUSE: address already in use :::3000
```

**Fix:**
```powershell
node dist/cli/index.js serve --port 8080
```

---

### Large embeddings.json (>100MB)

**Mitigations:**
1. Narrow `includePatterns` to only needed file types
2. Add more `excludePatterns` (generated code, vendor libs)
3. Index specific subdirectories instead of the entire project
4. Purge junk entries (see "Search returns irrelevant results")

---

## Diagnostic Commands

### Test MCP server manually

```powershell
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' | node D:\Project\Indexa\dist\src\mcp\stdio.js --data-dir D:\Project\Indexa\data 2>nul
```

Should return clean JSON (no `[INFO]` lines).

### Check index contents

```powershell
node dist/cli/index.js search "test" --top-k 3 --data-dir ./data
```

### Check chunk distribution

```powershell
node -e "const {VectorDB}=require('./dist/src/storage/vector-db');const db=new VectorDB('./data');const t={};db.getAll().forEach(c=>t[c.type]=(t[c.type]||0)+1);console.log('Total:',db.size);console.log(JSON.stringify(t,null,2))"
```

### Check for junk entries

```powershell
node -e "const {VectorDB}=require('./dist/src/storage/vector-db');const db=new VectorDB('./data');const junk=db.getAll().filter(c=>c.name.length<=2);console.log('Single/double-letter names (likely minified):',junk.length);junk.slice(0,10).forEach(c=>console.log(' ',c.filePath.substring(0,80),c.name))"
```
