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

### `npx mcp` installs a random package

```
Need to install the following packages: mcp@1.4.2
```

**Fix:** Use `node` directly:
```powershell
node dist/cli/index.js search "query"
```

---

### Index shows 0 chunks created

```
Indexing complete in 1.06s
  Files indexed: 1353
  Chunks created: 0
```

**Cause:** Files were already indexed with the same content hash. Indexa skips unchanged files.

**To force re-index:**
```powershell
rm data/embeddings.json
rm data/metadata.json
node dist/cli/index.js index "D:\path\to\project"
```

---

### Code preview shows empty or wrong code

**Cause:** Source files have changed since indexing. Byte offsets no longer match.

**Fix:** Re-index:
```powershell
rm data/embeddings.json data/metadata.json
node dist/cli/index.js index "D:\path\to\project"
```

> Use `contentHash` to detect drift: the hash stored in the index can be compared against the current source to verify integrity.

---

### No results found for search

**Possible causes:**
1. Index is empty — run `indexa index` first
2. Query too specific — try broader terms
3. Data directory mismatch — check `--data-dir`

---

### MCP server not appearing in Claude Code

**Checklist:**
1. Verify config exists:
   ```powershell
   cat ~/.mcp.json
   ```

2. Verify compiled file exists:
   ```powershell
   ls D:\Project\Indexa\dist\src\mcp\stdio.js
   ```

3. Test MCP server manually:
   ```powershell
   echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' | node D:\Project\Indexa\dist\src\mcp\stdio.js
   ```

   Should return JSON with `"serverInfo":{"name":"indexa","version":"2.0.0"}`.

4. **Restart Claude Code** — MCP servers load at session start.

---

### MCP server errors

**Enable debug logging:**
```json
{
  "mcpServers": {
    "indexa": {
      "command": "node",
      "args": ["D:/Project/Indexa/dist/src/mcp/stdio.js"],
      "env": { "INDEXA_DEBUG": "1" }
    }
  }
}
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

### Large codebase — slow indexing

**Tuning:**
1. Narrow `includePatterns` to only needed files
2. Add more `excludePatterns` (generated files, vendor code)
3. Index specific subdirectories:
   ```powershell
   node dist/cli/index.js index "D:\project\src"
   ```

---

### Embeddings file too large

v2 stores no code in the index (only metadata + embeddings), so this is much less of an issue than v1. For very large codebases (>30K chunks):
- Index only the directories you need
- Exclude generated/vendored code
- Reduce embedding dimension in config (e.g., 64)

---

## Getting Help

1. Check the [Architecture](./architecture.md) doc
2. Enable debug logging with `INDEXA_DEBUG=1`
3. File an issue with the error message and steps to reproduce
