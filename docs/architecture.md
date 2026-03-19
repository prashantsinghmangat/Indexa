# Indexa v2.1 — Architecture

## Overview

Indexa is an AST-based codebase indexing server that provides semantic and structural code retrieval via the Model Context Protocol (MCP). It reduces LLM token usage by returning only the relevant code chunks instead of full files.

```
┌──────────────────────────────────────────────────────────────┐
│                       Consumers                               │
│  Claude Code (MCP, 8 tools)  │  REST API  │  CLI              │
└──────────┬───────────────────┴──────┬─────┴──────┬────────────┘
           │                          │            │
           ▼                          ▼            ▼
┌──────────────────────────────────────────────────────────────┐
│                    Query Router                               │
│  identifier → symbol lookup | short → BM25 | else → hybrid   │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│                     Indexa Core                               │
│                                                               │
│  ┌──────────────┐  ┌───────────────┐  ┌────────────────────┐ │
│  │   Indexer     │  │  Retrieval    │  │    Storage          │ │
│  │              │  │               │  │                    │ │
│  │  Parser      │  │  Semantic     │  │  VectorDB          │ │
│  │  Chunker     │  │  BM25 Keyword │  │  (metadata+embed)  │ │
│  │  Embedder    │  │  Hybrid       │  │                    │ │
│  │  Updater     │  │  Graph        │  │  MetadataDB        │ │
│  │              │  │               │  │  (file hashes)     │ │
│  └──────────────┘  └───────────────┘  └────────────────────┘ │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐   │
│  │  Source Files (on disk) — code read via byte offsets   │   │
│  └────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────┘
```

## Core Principles

### 1. Byte-Offset Retrieval

Code is NOT stored in the index. Each symbol stores `byteOffset` and `byteLength`. Code is read from source files on demand via `seek() + read()` — O(1).

### 2. Query Routing

Before searching, Indexa classifies the query:

| Pattern | Route | Example |
|---------|-------|---------|
| Single camelCase/PascalCase/snake_case identifier | Symbol lookup | `VendorService`, `get_user` |
| Starts with `$` | Symbol lookup | `$scope`, `$http` |
| Contains `::` or `#` | Direct ID lookup | `src/auth.ts::validate#function` |
| 1-2 short words | BM25 keyword | `vendor service` |
| 3+ words or natural language | Full hybrid | `vendor service area logic` |

Falls through automatically if the primary strategy returns nothing.

### 3. Context Bundles (PRIMARY)

The most important feature. `indexa_context_bundle` is a single-call tool that:

```
Query → Hybrid Search (15 candidates) → Rank → Read Code (byte offsets)
  → Pack within token budget → Resolve 1-level dependencies → Return
```

Returns a ready-to-use context package for LLMs.

### 4. Hybrid Scoring

Three-component weighted score:

```
score = semantic × 0.5 + keyword(BM25) × 0.3 + name_match × 0.2
```

- **Semantic (0.5):** Cosine similarity between query embedding and chunk embedding
- **Keyword (0.3):** BM25 with field weighting (name 3x, type 2x, summary 1x, path 1x)
- **Name match (0.2):** Token overlap between query and symbol name (exact=1.0, prefix=0.8, contains=0.5)

## Module Breakdown

### Indexer (`src/indexer/`)

```
Source Files → Parser → Chunker → Embedder → Storage
                 ↓
         byte offsets captured
         imports extracted
         methods indexed individually
         smart summaries generated
```

| Stage | File | Responsibility |
|-------|------|---------------|
| **Parser** | `parser.ts` | AST extraction (ts-morph), byte offsets, imports, methods, AngularJS patterns |
| **Chunker** | `chunker.ts` | Element → chunk splitting. No code stored, just byte offsets + content hash |
| **Embedder** | `embedder.ts` | Summary + name + type → 128-dim hash vector. Pluggable for OpenAI/local |
| **Updater** | `updater.ts` | Full + incremental indexing. Git diff for change detection |

### Retrieval (`src/retrieval/`)

| Module | File | Responsibility |
|--------|------|---------------|
| **Semantic** | `semantic.ts` | Cosine similarity against all chunk embeddings |
| **Keyword** | `keyword.ts` | BM25 with field weighting, IDF, exact-match bonus |
| **Hybrid** | `hybrid.ts` | Query router + 3-component scoring + token budgeting |
| **Graph** | `graph.ts` | Dependency graph, references, hierarchy, blast radius, context bundles |

### Storage (`src/storage/`)

| Store | File | Contents |
|-------|------|---------|
| **VectorDB** | `vector-db.ts` | Chunk metadata + embeddings (no code). Atomic JSON writes |
| **MetadataDB** | `metadata-db.ts` | File hash tracking. Atomic JSON writes |

### MCP Transport (`src/mcp/`)

8 tools via stdio:

| # | Tool | Description |
|---|------|-------------|
| 1 | **`indexa_context_bundle`** | **PRIMARY.** Query → symbols + deps within token budget |
| 2 | `indexa_search` | Auto-routed search with scores |
| 3 | `indexa_symbol` | O(1) ID lookup or name search |
| 4 | `indexa_file` | File outline or full code |
| 5 | `indexa_dependencies` | Dependency graph traversal |
| 6 | `indexa_references` | Find usages + blast radius |
| 7 | `indexa_index` | Index a directory |
| 8 | `indexa_stats` | Index statistics |

### Smart Summaries

Generated during indexing from code structure:

| Before (v2.0) | After (v2.1) |
|---------------|-------------|
| `service "VendorService" (19 lines): angular.module...` | `service VendorService ('vendorApp') [19L] — service provider` |
| `function "findVendorsInArea" (15 lines): export function...` | `function findVendorsInArea (query) → VendorDTO[] [15L] — finds vendors in area` |

Infers purpose from name patterns: `get*` → "retrieves", `handle*` → "handles", `validate*` → "validates", etc.

## Data Flow

### Context Bundle Flow (PRIMARY)

```
1. User/LLM calls: indexa_context_bundle("vendor service area", budget=1500)
2. Query router detects: natural language → hybrid search
3. Hybrid search:
   a. Semantic: embed query → cosine similarity → top 15
   b. BM25: tokenize → field-weighted scoring → top 15
   c. Name match: token overlap scoring
   d. Merge: 0.5×semantic + 0.3×keyword + 0.2×name → ranked list
4. Context packing:
   a. For each result (ranked): read code via byte offset
   b. Estimate tokens (length / 4)
   c. Add to bundle until budget exhausted
   d. Resolve 1-level dependencies (top 5 per symbol)
5. Return: symbols[] + dependencies[] + estimatedTokens
```

### Incremental Update Flow

```
1. indexa update → git diff --name-status HEAD~1
2. Deleted files: remove chunks
3. Modified files: remove old chunks → re-parse → re-index
4. Atomic writes: temp-file + rename
```

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Context bundle as PRIMARY** | Single tool call gets everything an LLM needs. Reduces round-trips. |
| **Query routing** | Identifier lookups are O(1). No need for full semantic search on `VendorService`. |
| **0.5/0.3/0.2 weighting** | Semantic catches concepts, BM25 catches exact terms, name match catches symbol names. |
| **Byte-offset retrieval** | 5x smaller index. No stale code. O(1) access. |
| **Token budgeting > topK** | LLMs have context windows, not "give me 5 results" requirements. |
| **Smart summaries** | `findVendors → "finds vendors"` is more useful than the first line of code. |
| **8 tools (not 12)** | Clean, focused set. Merged overlapping tools. `context_bundle` handles 80% of cases. |

## File Map

```
indexa/
├── src/
│   ├── server/
│   │   ├── index.ts                   # Express app setup
│   │   ├── routes.ts                  # Route registration (11 endpoints)
│   │   └── controllers/
│   │       ├── search.controller.ts   # POST /search + POST /context-bundle
│   │       └── index.controller.ts    # /file, /symbol, /outline, /references, /blast-radius, /stats
│   ├── indexer/
│   │   ├── parser.ts                  # AST + regex + byte offsets + imports + methods
│   │   ├── chunker.ts                 # Element → chunk (no code stored)
│   │   ├── embedder.ts                # Pluggable embeddings
│   │   └── updater.ts                 # Full + incremental indexing
│   ├── retrieval/
│   │   ├── semantic.ts                # Cosine similarity
│   │   ├── keyword.ts                 # BM25 + field weighting
│   │   ├── hybrid.ts                  # Query router + 3-component scoring + token budget
│   │   └── graph.ts                   # Deps, refs, hierarchy, blast radius, context bundles
│   ├── storage/
│   │   ├── vector-db.ts               # Atomic JSON, no inline code
│   │   └── metadata-db.ts             # Atomic JSON, file hashes
│   ├── mcp/
│   │   └── stdio.ts                   # MCP server (8 tools)
│   ├── types/
│   │   └── index.ts                   # All interfaces
│   └── utils/
│       └── index.ts                   # BM25, byte-offset, query routing, summaries, token estimation
├── cli/
│   ├── index.ts                       # Commander CLI (init, index, update, search, bundle, serve)
│   ├── init.ts                        # indexa init
│   ├── update.ts                      # indexa index + indexa update
│   └── search.ts                      # indexa search + indexa bundle
├── sample-code/                       # Test data
├── config/indexa.config.json          # Default config
├── data/                              # Generated index (no inline code)
├── docs/                              # Documentation (7 guides)
├── package.json
├── tsconfig.json
└── README.md
```
