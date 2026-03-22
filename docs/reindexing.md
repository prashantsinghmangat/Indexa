# Indexa — Re-indexing Guide

How to keep the index fresh after code changes.

## Methods

### Method 1: Full Re-index (CLI)

Best for: first-time setup, branch switches, large changes.

```bash
npx indexa-mcp index "D:\path\to\your\project"
```

**How it works:**
1. Walks the directory recursively
2. Filters by include/exclude patterns from `config/indexa.config.json`
3. For each file: computes content hash → compares with stored hash
4. **Skips unchanged files** — only re-parses files whose hash changed
5. Re-parses changed files → extracts symbols → generates ML embeddings (gte-small, 384-dim) → stores

**When to use:**
- First time indexing a project
- After switching git branches (many files change at once)
- After modifying exclude patterns in config
- When you want to be sure the index is fully up to date

**Time:** ~1-5 seconds for incremental (most files unchanged), ~30-60 seconds for a fresh index of 1000+ files.

---

### Method 2: Git-based Incremental (CLI)

Best for: after a few commits, quick updates.

```bash
npx indexa-mcp update
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
Use indexa_index to re-index D:\path\to\your\project
```

Claude will call the `indexa_index` MCP tool. Same behavior as Method 1 — skips unchanged files.

---

### Method 4: REST API

Best for: automation, CI/CD integration.

```bash
curl -X POST http://localhost:3000/api/update
```

Requires the Indexa server to be running (`npx indexa-mcp serve`).

---

### Method 5: VS Code Extension

Best for: re-indexing from within the editor.

Use the **Reindex** command in the VS Code extension (`Ctrl+Shift+P` → "Indexa: Reindex"). This triggers a full re-index of the current workspace.

If you don't have the extension yet, install from [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=PrashantSingh.indexa-code-intelligence) or download `.vsix` from [GitHub Releases](https://github.com/prashantsinghmangat/Indexa/releases).

---

## What Gets Indexed

Controlled by `config/indexa.config.json`:

```json
{
  "includePatterns": ["*.ts", "*.tsx", "*.js", "*.jsx"],
  "excludePatterns": [
    "node_modules", "dist", ".git", ".next", "_next", "out",
    ".nuxt", ".output", ".vercel", "build", "coverage",
    "*.test.*", "*.spec.*", "*.stories.*",
    "*.min.js", "*.bundle.js", "vendor.js", "polyfills.js",
    "angular-mocks", "e2e", "chunks"
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
| `dist`, `build`, `out` | Compiled output |
| `.next`, `_next` | Next.js build output |
| `.nuxt`, `.output`, `.vercel` | Framework build output |
| `coverage` | Test coverage reports |
| `*.test.*`, `*.spec.*` | Test files |
| `*.stories.*` | Storybook files |
| `*.min.js`, `*.bundle.js` | Minified/bundled files |
| `angular-mocks` | Angular mock library |
| `e2e` | End-to-end test directories |
| `chunks` | Build chunk directories |

After changing patterns, run a full re-index.

---

## How Change Detection Works

1. When a file is indexed, its **SHA-256 hash** (first 16 chars) is stored in `.indexa/metadata.json` (or `data/metadata.json` for legacy installs)
2. On re-index, the file's current hash is compared with the stored hash
3. If they match → file is skipped (no work done)
4. If they differ → old chunks are removed, file is re-parsed, new chunks are stored
5. If the file no longer exists → its chunks are removed from the index

This means running `index` is always safe — it converges to the correct state without unnecessary work.

---

## Storage Files

| File | Size (typical) | Contents |
|------|---------------|---------|
| `data/embeddings.json` | 10-50 MB | All chunk metadata + ML embedding vectors (384-dim, no inline code) |
| `data/metadata.json` | < 1 MB | File path → content hash mapping |

Both files are written atomically (write to `.tmp` then rename) to prevent corruption.

---

## Multi-Project Setup (Automatic in v3.2+)

Each project gets its own `.indexa/` directory automatically — no `--data-dir` needed:

```bash
# Index project A (creates ProjectA/.indexa/)
cd D:\ProjectA
npx indexa-mcp setup

# Index project B (creates ProjectB/.indexa/)
cd D:\ProjectB
npx indexa-mcp setup

# Search — auto-detects .indexa/ in CWD
cd D:\ProjectA
npx indexa-mcp search "query"
```

Each project's index is completely isolated. The CLI automatically finds `.indexa/` in the current working directory.

---

## Troubleshooting

### Index shows 0 new chunks
Files are unchanged — hashes match. This is normal. If you need to force re-index, delete the data files and re-run.

### Index is too large
Run `npx indexa-mcp clean` to purge junk entries, or update exclude patterns in config and re-index.
