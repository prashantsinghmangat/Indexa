# Indexa — Code Intelligence Engine

**Stop reading code manually. Ask Indexa, click the answer, jump to the line.**

Indexa is a context engine that sits between your codebase and your brain. It indexes your code once, then lets you search, trace execution flows, and find references — all from a sidebar in VS Code.

## What It Does

Most tools help you **find** code. Indexa helps you **understand** it.

| Query | What You Get |
|-------|-------------|
| `"how does the theme work"` | Components + dependencies + connections |
| `"trace HeroSection"` | 9-step execution flow across files |
| `"where is useUIStore used"` | All references + blast radius |

## Features

### Sidebar Search
Type a question, get structured results. Click any result to jump to the exact line.

### Execution Flow Tracing
See the full call chain for any function or component — across files, with one query.

### Find References & Blast Radius
Know what breaks before you change it. See every file affected by a symbol.

### Type-Aware Results
Functions, components, services, hooks — each with its own icon and label. Results are grouped by Context, Dependencies, and Connections.

### One-Command Setup
```bash
npx indexa-mcp setup
```
Indexes your codebase, configures MCP for Claude Code, and you're ready.

## Quick Start

1. Install this extension
2. Open a terminal in your project and run:
   ```bash
   npx indexa-mcp setup
   ```
3. Click the Indexa icon in the sidebar
4. Try: `"explain the auth flow"`

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+I` | Ask Indexa (search) |
| Right-click → Explain | Explain selected code |
| Right-click → Flow | Trace execution flow |
| Right-click → References | Find all references |

## How It Works

```
Your Code → Indexa indexes it → You ask a question → Get exact answers
```

Indexa uses:
- **ML embeddings** (Transformers.js) for semantic search
- **BM25** for keyword matching
- **AST parsing** for structural understanding
- **Dependency graphs** for relationship tracking

All runs locally. No API keys. No cloud. Free forever.

## Works With

- **Claude Code** (via MCP — auto-configured)
- **VS Code** (this extension)
- **Any AI tool** (via REST API)

## Requirements

- Node.js >= 18
- `npx indexa-mcp setup` must be run in your project first

## Links

- [GitHub](https://github.com/prashantsinghmangat/Indexa)
- [npm](https://www.npmjs.com/package/indexa-mcp)
- [Website](https://prashantsinghmangat.github.io/Indexa/)
- [Author](https://prashantsinghmangat.netlify.app/)

## License

MIT
