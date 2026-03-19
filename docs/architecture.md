# Indexa v3.0 — Architecture

## Overview

Indexa is a code intelligence system that provides semantic retrieval, execution flow tracing, and code explanation via the Model Context Protocol (MCP).

```
┌───────────────────────────────────────────────────────────────┐
│                        Consumers                               │
│  Claude Code (MCP, 9 tools)  │  REST API  │  CLI               │
└──────────┬───────────────────┴──────┬─────┴──────┬─────────────┘
           │                          │            │
           ▼                          ▼            ▼
┌───────────────────────────────────────────────────────────────┐
│                   Intelligence Layer                           │
│                                                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │  Flow Engine  │  │  Explain     │  │  LRU Query Cache     │ │
│  │  (call trace) │  │  Engine      │  │  (100 entries, 5min) │ │
│  └──────────────┘  └──────────────┘  └──────────────────────┘ │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │              Context Stitching (connections)              │ │
│  └──────────────────────────────────────────────────────────┘ │
└──────────────────────────┬────────────────────────────────────┘
                           │
┌──────────────────────────▼────────────────────────────────────┐
│                    Query Router                                │
│  identifier → symbol lookup | short → BM25 | else → hybrid    │
└──────────────────────────┬────────────────────────────────────┘
                           │
┌──────────────────────────▼────────────────────────────────────┐
│                     Core Engine                                │
│                                                                │
│  ┌──────────────┐  ┌───────────────┐  ┌────────────────────┐ │
│  │   Indexer     │  │  Retrieval    │  │    Storage          │ │
│  │  Parser      │  │  Semantic     │  │  VectorDB           │ │
│  │  Chunker     │  │  BM25 Keyword │  │  MetadataDB         │ │
│  │  Embedder    │  │  Hybrid       │  │  (atomic writes)    │ │
│  │  Updater     │  │  Graph        │  │                    │ │
│  └──────────────┘  └───────────────┘  └────────────────────┘ │
│                                                                │
│  ┌────────────────────────────────────────────────────────┐   │
│  │  Source Files — code read via byte offsets (O(1))      │   │
│  └────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
```

## Intelligence Layer (`src/intelligence/`)

### Flow Engine (`flow.ts`)

Traces execution paths across functions and files using BFS:

1. Resolve query → entry symbol (direct ID, name match, or search)
2. For each symbol: find callees via `dependencies` → indexed name matches
3. BFS traversal with depth limit (max 6) and cycle detection
4. Filters noise: skips builtins (`console`, `Promise`, `Array`, etc.)
5. Returns ordered `FlowStep[]` with calls list per step

### Explain Engine (`explain.ts`)

Generates structured explanations from actual code:

1. Runs context bundle search to get relevant symbols
2. Analyzes symbol names to infer purpose (e.g., `getVendors` → "retrieves vendors")
3. Builds explanation paragraph from symbols + types + file locations
4. Generates numbered steps from symbol summaries
5. Returns `ExplainResult` with explanation, steps, symbolsUsed

### Context Stitching (`explain.ts::detectConnections`)

Adds `connections[]` to context bundles:

- Detects `calls` relationships by checking if symbol A's code contains `symbolB(`
- Detects `depends_on` relationships via import/dependency references
- Deduplicates connections across relationship types

### Query Cache (`cache.ts`)

LRU cache for expensive operations:

- **Key:** tool name + JSON-serialized params
- **Max size:** 100 entries (evicts oldest on full)
- **TTL:** 5 minutes
- **Cached:** context_bundle, flow, explain
- **Auto-cleared** on re-index

## Hybrid Scoring

```
score = semantic × 0.5 + keyword(BM25) × 0.3 + name_match × 0.2
```

## MCP Tools (9)

| # | Tool | Category | Description |
|---|------|----------|-------------|
| 1 | `indexa_context_bundle` | Intelligence | PRIMARY. Symbols + deps + connections |
| 2 | `indexa_flow` | Intelligence | Execution flow tracing |
| 3 | `indexa_explain` | Intelligence | Code explanation |
| 4 | `indexa_search` | Retrieval | Auto-routed search |
| 5 | `indexa_symbol` | Retrieval | O(1) ID lookup or name search |
| 6 | `indexa_file` | Retrieval | File outline or full code |
| 7 | `indexa_references` | Analysis | Find usages + blast radius |
| 8 | `indexa_index` | Management | Index a directory |
| 9 | `indexa_stats` | Management | Index stats + cache status |

## File Map

```
indexa/
├── src/
│   ├── intelligence/
│   │   ├── index.ts          # Barrel export
│   │   ├── cache.ts          # LRU query cache with TTL
│   │   ├── flow.ts           # Execution flow tracing (BFS)
│   │   └── explain.ts        # Code explanation + context stitching
│   ├── retrieval/
│   │   ├── semantic.ts       # Cosine similarity
│   │   ├── keyword.ts        # BM25 + field weighting
│   │   ├── hybrid.ts         # Query router + 3-component scoring
│   │   └── graph.ts          # Deps, refs, hierarchy, context bundles
│   ├── indexer/
│   │   ├── parser.ts         # AST + regex + byte offsets
│   │   ├── chunker.ts        # Element → chunk (no code stored)
│   │   ├── embedder.ts       # Pluggable embeddings
│   │   └── updater.ts        # Full + incremental indexing
│   ├── storage/
│   │   ├── vector-db.ts      # Atomic JSON, no inline code
│   │   └── metadata-db.ts    # Atomic JSON, file hashes
│   ├── server/               # Express REST API
│   ├── mcp/stdio.ts          # MCP server (9 tools)
│   ├── types/index.ts        # All interfaces
│   └── utils/index.ts        # BM25, byte-offset, query routing, summaries
├── cli/                      # Commander CLI (8 commands)
├── docs/                     # Documentation (7 guides)
├── sample-code/              # Test data
├── config/                   # indexa.config.json
└── data/                     # Generated index
```
