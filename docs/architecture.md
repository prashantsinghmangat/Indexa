# Indexa v2.0 — Architecture

## Overview

Indexa is an AST-based codebase indexing server that provides semantic and structural code retrieval via the Model Context Protocol (MCP). It reduces LLM token usage by returning only the relevant code chunks instead of full files.

```
┌──────────────────────────────────────────────────────────────┐
│                       Consumers                               │
│  Claude Code (MCP, 12 tools)  │  REST API  │  CLI             │
└──────────┬────────────────────┴──────┬─────┴──────┬───────────┘
           │                           │            │
┌──────────▼───────────────────────────▼────────────▼───────────┐
│                       Indexa Core                              │
│                                                                │
│  ┌──────────────┐  ┌───────────────┐  ┌─────────────────────┐  │
│  │   Indexer     │  │  Retrieval    │  │    Storage           │  │
│  │              │  │               │  │                     │  │
│  │  Parser      │  │  Semantic     │  │  VectorDB           │  │
│  │  Chunker     │  │  Keyword(BM25)│  │  (metadata+embed)   │  │
│  │  Embedder    │  │  Hybrid       │  │                     │  │
│  │  Updater     │  │  Graph        │  │  MetadataDB         │  │
│  │              │  │  Analysis     │  │  (file hashes)      │  │
│  └──────────────┘  └───────────────┘  └─────────────────────┘  │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Source Files (on disk) — code read via byte offsets     │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

## Core Principle: Byte-Offset Retrieval

The most important architectural decision in v2: **code is NOT stored in the index**.

Each indexed symbol stores `byteOffset` and `byteLength`. When code is needed, it is read directly from the source file via `seek() + read()` — an O(1) operation.

```
Index stores:  { id, name, type, summary, filePath, byteOffset, byteLength, embedding, ... }
Code comes from:  fs.openSync(filePath) → fs.readSync(fd, buffer, 0, byteLength, byteOffset)
```

Benefits:
- Index is ~5x smaller (40MB vs 200MB+ for 12K chunks)
- No stale code in index — always reads current source
- `contentHash` field enables drift detection

## Module Breakdown

### 1. Indexer (`src/indexer/`)

The indexer pipeline processes source files in 4 stages:

```
Source Files → Parser → Chunker → Embedder → Storage
                 ↓
         byte offsets captured
         imports extracted
         methods extracted individually
```

| Stage | File | Responsibility |
|-------|------|---------------|
| **Parser** | `parser.ts` | AST extraction using ts-morph. Detects functions, classes, methods, React components, AngularJS controllers/services. Captures byte offsets and import references. Falls back to regex for plain JS. |
| **Chunker** | `chunker.ts` | Splits parsed elements into indexable chunks. Large elements (>100 lines) are split with byte-offset tracking. Generates summaries. Does NOT store code inline. |
| **Embedder** | `embedder.ts` | Converts summary + name + type to vector embeddings. Default: deterministic hash-based vectors (128-dim). Pluggable for OpenAI/local models. |
| **Updater** | `updater.ts` | Orchestrates full and incremental indexing. Uses git diff for change detection. Manages file hash tracking. |

### 2. Retrieval (`src/retrieval/`)

Four modules, operating over the same vector store:

| Module | File | How it works |
|--------|------|-------------|
| **Semantic** | `semantic.ts` | Embeds query → cosine similarity against all chunk embeddings → top K |
| **Keyword** | `keyword.ts` | BM25 scoring with field weighting: name 3x, type 2x, summary 1x, path 1x. IDF for rare terms. 50-point exact-match bonus. |
| **Hybrid** | `hybrid.ts` | Runs both → normalizes to [0,1] → weighted merge (70% semantic, 30% keyword). Supports token-budget packing. |
| **Graph** | `graph.ts` | Dependency graph traversal, import tracking, reference finding, class hierarchy, blast radius estimation, context bundle assembly. |

### 3. Storage (`src/storage/`)

JSON-file persistence with atomic writes — no external database required.

| Store | File | Contents |
|-------|------|---------|
| **VectorDB** | `vector-db.ts` | Chunk metadata + embeddings (no code). Stored in `data/embeddings.json`. In-memory Map for fast lookup. Atomic writes via temp-file + rename. |
| **MetadataDB** | `metadata-db.ts` | File path → hash mapping for change detection. Stored in `data/metadata.json`. Atomic writes. |

### 4. Server (`src/server/`)

Express-based REST API with two controllers:

- **SearchController** — `POST /search` (hybrid/semantic/keyword with token budgeting)
- **IndexController** — `POST /update`, `GET /file`, `GET /symbol`, `GET /symbol/:id`, `GET /outline`, `GET /references`, `GET /blast-radius`, `GET /stats`

### 5. MCP Transport (`src/mcp/`)

Stdio-based MCP server using `@modelcontextprotocol/sdk`. Exposes 12 tools:

| Tool | Description |
|------|-------------|
| `indexa_search` | Hybrid/semantic/keyword search with token budgeting |
| `indexa_get_symbol` | O(1) lookup by stable ID |
| `indexa_find_symbol` | Name-based search |
| `indexa_file_outline` | File symbol outline (no code loaded) |
| `indexa_dependency_graph` | Dependency graph traversal |
| `indexa_find_importers` | Who imports from a file |
| `indexa_find_references` | Who references a symbol |
| `indexa_class_hierarchy` | Parent/child class relationships |
| `indexa_context_bundle` | Symbols + deduplicated imports, token-budgeted |
| `indexa_blast_radius` | Change impact estimation |
| `indexa_index` | Index a directory |
| `indexa_stats` | Index statistics |

### 6. CLI (`cli/`)

Commander-based CLI wrapping the same core modules:

```
indexa init       → cli/init.ts     → creates config + data dirs
indexa index      → cli/update.ts   → full index via Updater
indexa update     → cli/update.ts   → incremental via git diff
indexa search     → cli/search.ts   → hybrid search + formatted output
indexa serve      → src/server/     → starts Express API
```

## Data Flow

### Indexing Flow

```
1. User runs: indexa index ./src
2. findFiles() walks directory, applies include/exclude patterns
3. For each file:
   a. Parser extracts elements (AST for TS/TSX, regex for JS)
      - Captures byte offsets for each element
      - Extracts import statements
      - Extracts individual class methods
   b. Chunker creates chunks (no code stored, just metadata + byte offsets)
   c. Embedder creates vector from summary + name + type
   d. VectorDB stores chunk metadata + embedding (no code)
   e. MetadataDB stores file hash + chunk IDs
4. Both DBs persist atomically (temp file + rename)
```

### Search Flow

```
1. User queries: "vendor service area"
2. Hybrid search:
   a. Semantic: embed query → cosine similarity → top 20 candidates
   b. Keyword (BM25): tokenize → build virtual docs (name 3x, type 2x) → BM25 score → top 20
   c. Normalize both score sets to [0,1]
   d. Merge: 0.7 × semantic + 0.3 × keyword
   e. If tokenBudget: pack results until budget exhausted
      Else: return top K (default 5)
3. For each result: read code from source file via byte offset
4. Return chunk metadata + code
```

### Graph Analysis Flow

```
1. User asks for dependency graph of symbol X
2. GraphAnalysis looks up X in VectorDB
3. For X's dependencies: find matching chunks by name
4. For X's dependents: find chunks whose dependencies include X
5. Recurse to specified depth
6. Return graph nodes with edges
```

### Context Bundle Flow

```
1. User provides list of symbol IDs + token budget
2. For each symbol: read code via byte offset, add to bundle
3. For each symbol's imports: find matching indexed chunks
4. Deduplicate imports across all symbols
5. Pack symbols + imports until token budget exhausted
6. Return bundle ready for LLM consumption
```

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Byte-offset retrieval** | No stale code in index. 5x smaller index files. O(1) code access. Source files are the single source of truth. |
| **Stable symbol IDs** | `filePath::name#type` format. Human-readable, deterministic, bookmarkable across sessions. Agents can reference symbols persistently. |
| **BM25 over simple scoring** | Proper IDF weighting for rare terms. Field weighting via repetition (name 3x). Better ranking than naive occurrence counting. |
| **Token budgeting** | LLM-native result packing. Instead of "give me 5 results", say "give me results that fit in 2000 tokens". More useful for context windows. |
| **JSON storage over SQLite** | Zero native dependencies. Simpler deployment on Windows. Sufficient for codebases up to ~50K chunks. |
| **Hash-based embeddings** | Works offline, no API keys needed. Deterministic. Good enough for keyword-heavy code search. Pluggable for real models. |
| **ts-morph for parsing** | Full TypeScript AST access. Handles JSX/TSX. Supports type analysis. |
| **Regex fallback for JS** | AngularJS patterns (`$scope`, `.controller()`, `.service()`) are easier to detect with regex than AST. |
| **Atomic writes** | Temp-file + rename prevents corruption from crashes or concurrent access. |
| **Method-level extraction** | Individual methods are indexed separately from their class, enabling precise method-level retrieval. |

## Index Format (v2)

Each entry in `embeddings.json`:

```json
{
  "id": "D:/project/src/auth.ts::validateToken#function",
  "name": "validateToken",
  "type": "function",
  "summary": "function \"validateToken\" (12 lines): export async function validateToken(token: string)",
  "filePath": "D:/project/src/auth.ts",
  "startLine": 45,
  "endLine": 56,
  "byteOffset": 1234,
  "byteLength": 456,
  "dependencies": ["jwt", "verify"],
  "imports": [{"name": "jwt", "source": "jsonwebtoken", "isDefault": true}],
  "contentHash": "a1b2c3d4e5f6g7h8",
  "embedding": [0.123, -0.456, ...],
  "indexedAt": "2026-03-19T10:00:00.000Z"
}
```

No `code` field. Code is read from `D:/project/src/auth.ts` at byte offset 1234, length 456.

## File Map

```
indexa/
├── src/
│   ├── server/
│   │   ├── index.ts                   # Express app setup + config loading
│   │   ├── routes.ts                  # Route registration (10 endpoints)
│   │   └── controllers/
│   │       ├── search.controller.ts   # POST /search
│   │       └── index.controller.ts    # /update, /file, /symbol, /outline, /references, /blast-radius, /stats
│   ├── indexer/
│   │   ├── parser.ts                  # AST extraction (ts-morph + regex), byte offsets, imports, methods
│   │   ├── chunker.ts                 # Element → chunk splitting (no code stored)
│   │   ├── embedder.ts                # Text → vector (pluggable)
│   │   └── updater.ts                 # Full + incremental indexing
│   ├── retrieval/
│   │   ├── semantic.ts                # Cosine similarity search
│   │   ├── keyword.ts                 # BM25 with field weighting
│   │   ├── hybrid.ts                  # Weighted merge + token budgeting
│   │   └── graph.ts                   # Dependency graph, importers, references, blast radius, context bundles
│   ├── storage/
│   │   ├── vector-db.ts               # Chunk metadata + embedding store (atomic JSON writes)
│   │   └── metadata-db.ts             # File hash tracking (atomic JSON writes)
│   ├── mcp/
│   │   └── stdio.ts                   # MCP stdio transport server (12 tools)
│   ├── types/
│   │   └── index.ts                   # All TypeScript interfaces
│   └── utils/
│       └── index.ts                   # Logger, BM25, byte-offset, cosine sim, token estimation, atomic writes
├── cli/
│   ├── index.ts                       # Commander CLI entry point
│   ├── init.ts                        # indexa init
│   ├── update.ts                      # indexa index + indexa update
│   └── search.ts                      # indexa search (with token budget support)
├── sample-code/                       # Test data (AngularJS, React, TS)
├── config/
│   └── indexa.config.json             # Default configuration
├── data/                              # Generated index data (no inline code)
├── docs/                              # Documentation (7 guides)
├── package.json
├── tsconfig.json
└── README.md
```
