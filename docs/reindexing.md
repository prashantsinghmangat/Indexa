# Indexa — Re-indexing Guide

How to keep the index fresh after code changes.

## Methods

### Method 1: Full Re-index (CLI)

Best for: first-time setup, branch switches, large changes.

```powershell
cd D:\Project\Indexa
node dist/cli/index.js index "D:\SafeGuard\SPINext-App-SPIGlass" --data-dir ./data
```

**How it works:**
1. Walks the directory recursively
2. Filters by include/exclude patterns from `config/indexa.config.json`
3. For each file: computes content hash → compares with stored hash
4. **Skips unchanged files** — only re-parses files whose hash changed
5. Re-parses changed files → extracts symbols → generates embeddings → stores

**When to use:**
- First time indexing a project
- After switching git branches (many files change at once)
- After modifying exclude patterns in config
- When you want to be sure the index is fully up to date

**Time:** ~1-5 seconds for incremental (most files unchanged), ~30-60 seconds for a fresh index of 1000+ files.

---

### Method 2: Git-based Incremental (CLI)

Best for: after a few commits, quick updates.

```powershell
cd D:\Project\Indexa
node dist/cli/index.js update --data-dir ./data
```

**How it works:**
1. Runs `git diff --name-status HEAD~1` in the project directory
2. For **deleted** files: removes all their chunks from the index
3. For **added/modified** files: removes old chunks → re-parses → re-indexes
4. Only processes files matching include patterns

**When to use:**
- After committing changes
- Quick refresh during development
- When you know only a few files changed

---

### Method 3: From Claude Code (MCP)

Best for: during a conversation, without leaving Claude Code.

Just tell Claude:
```
Use indexa_index to re-index D:\SafeGuard\SPINext-App-SPIGlass
```

Claude will call the `indexa_index` MCP tool. Same behavior as Method 1 — skips unchanged files.

**When to use:**
- You're already in a Claude Code session
- You just created/modified files and want them searchable immediately
- Quick ad-hoc re-index without switching terminals

---

### Method 4: REST API

Best for: automation, CI/CD integration.

```powershell
curl -X POST http://localhost:3000/api/update
```

Requires the Indexa server to be running (`node dist/cli/index.js serve`).

---

## What Gets Indexed

Controlled by `config/indexa.config.json`:

```json
{
  "includePatterns": ["*.ts", "*.tsx", "*.js", "*.jsx"],
  "excludePatterns": [
    "node_modules", "dist", ".git",
    "*.test.*", "*.spec.*", "*.stories.*",
    "public/react-shell/assets",
    "public/Scripts",
    "*.min.js", "*.bundle.js",
    "vendor.js", "polyfills.js"
  ]
}
```

### Included
- TypeScript files (`.ts`, `.tsx`) — parsed with ts-morph AST
- JavaScript files (`.js`, `.jsx`) — parsed with regex patterns for AngularJS

### Excluded (to reduce noise)
| Pattern | Why |
|---------|-----|
| `node_modules` | Third-party code |
| `dist` | Compiled output |
| `public/react-shell/assets` | Vite-minified bundles (single-letter function names) |
| `public/Scripts` | Vendor libraries (Angular, jQuery, etc.) |
| `*.test.*`, `*.spec.*` | Test files |
| `*.stories.*` | Storybook files |
| `*.min.js`, `*.bundle.js` | Minified/bundled files |

### To add more file types
Edit `includePatterns`:
```json
"includePatterns": ["*.ts", "*.tsx", "*.js", "*.jsx", "*.html", "*.scss"]
```

### To exclude more directories
Add to `excludePatterns`:
```json
"excludePatterns": [..., "coverage", ".next", "generated"]
```

After changing patterns, run a full re-index.

---

## How Change Detection Works

1. When a file is indexed, its **SHA-256 hash** (first 16 chars) is stored in `data/metadata.json`
2. On re-index, the file's current hash is compared with the stored hash
3. If they match → file is skipped (no work done)
4. If they differ → old chunks are removed, file is re-parsed, new chunks are stored
5. If the file no longer exists → its chunks are removed from the index

This means running `index` is always safe — it converges to the correct state without unnecessary work.

---

## Storage Files

| File | Size (typical) | Contents |
|------|---------------|---------|
| `data/embeddings.json` | 10-50 MB | All chunk metadata + embedding vectors (no inline code) |
| `data/metadata.json` | < 1 MB | File path → content hash mapping |

Both files are written atomically (write to `.tmp` then rename) to prevent corruption.

---

## Multi-Project Setup

To index multiple projects, use separate data directories:

```powershell
# Index project A
node dist/cli/index.js index "D:\ProjectA" --data-dir ./data-projectA

# Index project B
node dist/cli/index.js index "D:\ProjectB" --data-dir ./data-projectB

# Search project A
node dist/cli/index.js search "query" --data-dir ./data-projectA
```

For MCP, configure per-project data dirs:
```json
{
  "mcpServers": {
    "indexa-projectA": {
      "command": "node",
      "args": ["D:/Project/Indexa/dist/src/mcp/stdio.js", "--data-dir", "D:/Project/Indexa/data-projectA"]
    }
  }
}
```

---

## Troubleshooting

### Index shows 0 new chunks
Files are unchanged — hashes match. This is normal. If you need to force re-index:
```powershell
del data\embeddings.json
del data\metadata.json
node dist/cli/index.js index "D:\path\to\project" --data-dir ./data
```

### Index is too large
Check for junk entries:
```powershell
node -e "const {VectorDB}=require('./dist/src/storage/vector-db');const db=new VectorDB('./data');console.log('Chunks:',db.size);const all=db.getAll();const types={};all.forEach(c=>{types[c.type]=(types[c.type]||0)+1});console.log(JSON.stringify(types,null,2))"
```

If you see minified code, update exclude patterns and purge:
```powershell
node -e "
const {VectorDB}=require('./dist/src/storage/vector-db');
const db=new VectorDB('./data');
let removed=0;
db.getAll().forEach(c=>{
  if(c.filePath.includes('some/junk/path')){db.remove(c.id);removed++;}
});
db.save();
console.log('Removed',removed);
"
```
