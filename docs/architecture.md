# Indexa v3.1 — Architecture

## Overview

Indexa is a code intelligence system that provides semantic retrieval, execution flow tracing, and code explanation via the Model Context Protocol (MCP). Uses local ML embeddings (Transformers.js, gte-small, 384 dimensions) — no API keys needed, fully offline-capable.

```
┌───────────────────────────────────────────────────────────────┐
│                        Consumers                               │
│  Claude Code (MCP, 9 tools)  │  VS Code Extension  │  REST API  │  CLI
└──────────┬───────────────────┴──────────┬───────────┴──────┬─────┴──────┐
           │                              │                  │            │
           ▼                              ▼                  ▼            ▼
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
│  │  (gte-small) │  │  Graph        │  │                    │ │
│  │  Updater     │  │               │  │                    │ │
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

## Embeddings

Indexa v3.1 uses local ML embeddings via **Transformers.js** with the **gte-small** model:

- **Dimensions:** 384
- **Model:** Supabase/gte-small (downloaded and cached locally on first run)
- **No API keys required** — runs entirely offline
- **Batch processing** during indexing for throughput

This replaces the earlier hash-based embeddings, providing high-quality semantic similarity.

## Hybrid Scoring

```
score = semantic × 0.35 + keyword(BM25) × 0.25 + name_match × 0.15 + path_match × 0.25
```

| Component | Weight | Description |
|-----------|--------|-------------|
| Semantic (cosine similarity) | 35% | ML embedding similarity via gte-small |
| BM25 keyword | 25% | Term frequency x inverse document frequency |
| Name match | 15% | Query tokens matching symbol names |
| Path match | 25% | Query tokens matching file path segments |

## File Diversity

Context bundles enforce a **max 2 chunks per file** limit. This prevents any single large file from monopolizing the results and ensures the LLM sees code from multiple relevant files.

## Query Router

The query router auto-detects query type and routes accordingly:

| Query Pattern | Route | Example |
|---------------|-------|---------|
| PascalCase/camelCase identifiers | Symbol lookup (O(1)) | `getVendorRates`, `VendorService` |
| Short queries (1-2 words) | BM25 keyword search | `vendor`, `auth service` |
| Natural language | Hybrid search | `how does vendor pricing work` |

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

## REST API Endpoints (12)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/search` | Auto-routed search |
| POST | `/api/context-bundle` | PRIMARY. Symbols + deps + connections |
| POST | `/api/flow` | Execution flow tracing |
| POST | `/api/explain` | Code explanation |
| GET | `/api/file?path=` | File chunks |
| GET | `/api/symbol?name=` | Symbol lookup |
| GET | `/api/references?name=` | References + blast radius |
| GET | `/api/blast-radius?name=` | Change impact analysis |
| GET | `/api/stats` | Index statistics |
| GET | `/api/health` | Health check |
| POST | `/api/update` | Incremental re-index |
| GET | `/api/outline?path=` | File symbol outline |

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
│   │   ├── hybrid.ts         # Query router + 4-component scoring
│   │   └── graph.ts          # Deps, refs, hierarchy, context bundles
│   ├── indexer/
│   │   ├── parser.ts         # AST + regex + byte offsets
│   │   ├── chunker.ts        # Element → chunk (no code stored)
│   │   ├── embedder.ts       # Transformers.js ML embeddings (gte-small, 384-dim)
│   │   └── updater.ts        # Full + incremental indexing
│   ├── storage/
│   │   ├── vector-db.ts      # Atomic JSON, no inline code
│   │   └── metadata-db.ts    # Atomic JSON, file hashes
│   ├── server/               # Express REST API (12 endpoints)
│   ├── mcp/stdio.ts          # MCP server (9 tools)
│   ├── types/index.ts        # All interfaces
│   └── utils/index.ts        # BM25, byte-offset, query routing, summaries
├── cli/                      # Commander CLI (8 commands)
├── indexa-vscode/            # VS Code extension (Ask Indexa, Explain, Flow, etc.)
├── docs/                     # Documentation (8 guides)
├── sample-code/              # Test data
├── config/                   # indexa.config.json
└── data/                     # Generated index
```
