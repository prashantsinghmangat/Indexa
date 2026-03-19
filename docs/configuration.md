# Indexa v3.0 — Configuration

## Config File

Located at `config/indexa.config.json`:

```json
{
  "projectRoot": ".",
  "dataDir": "./data",
  "port": 3000,
  "embeddingDim": 128,
  "defaultTopK": 5,
  "defaultTokenBudget": 4000,
  "includePatterns": ["*.ts", "*.tsx", "*.js", "*.jsx"],
  "excludePatterns": [
    "node_modules", "dist", ".git",
    "*.test.*", "*.spec.*", "*.stories.*",
    "public/react-shell/assets", "public/Scripts",
    "*.min.js", "*.bundle.js", "vendor.js", "polyfills.js"
  ]
}
```

## Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `projectRoot` | string | `"."` | Root directory of the project to index |
| `dataDir` | string | `"./data"` | Directory for index data |
| `port` | number | `3000` | Port for REST API server |
| `embeddingDim` | number | `128` | Embedding vector dimensions |
| `defaultTopK` | number | `5` | Default search results |
| `defaultTokenBudget` | number | `4000` | Default token budget for context bundle |
| `includePatterns` | string[] | `["*.ts", "*.tsx", "*.js", "*.jsx"]` | File patterns to index |
| `excludePatterns` | string[] | *(see above)* | Patterns to skip |

## Exclude Patterns

These patterns prevent noise in the index:

| Pattern | Why |
|---------|-----|
| `node_modules` | Third-party dependencies |
| `dist` | Compiled output |
| `.git` | Git internals |
| `*.test.*`, `*.spec.*` | Test files — contain mocks and assertions, not business logic |
| `*.stories.*` | Storybook files — contain component demos, pollute search |
| `public/react-shell/assets` | Vite-minified bundles — single-letter function names match everything |
| `public/Scripts` | Vendor libraries (Angular, jQuery, etc.) — huge, noisy |
| `*.min.js`, `*.bundle.js` | Other minified/bundled files |
| `vendor.js`, `polyfills.js` | Framework polyfills |

### Adding custom excludes

For your project, you may also want to exclude:
```json
"excludePatterns": [
  ...,
  "coverage",
  ".next",
  "generated",
  "__mocks__",
  "*.d.ts"
]
```

After changing patterns, run a full re-index. See [Re-indexing Guide](./reindexing.md).

## MCP Server Arguments

The MCP server (`src/mcp/stdio.ts`) accepts CLI arguments:

| Argument | Description |
|----------|-------------|
| `--data-dir <path>` | Absolute path to data directory (overrides config + env) |
| `--config <path>` | Path to config file |

Priority: CLI args > env vars > config file > defaults.

## Environment Variables

| Variable | Overrides | Description |
|----------|-----------|-------------|
| `INDEXA_DATA_DIR` | `dataDir` | Data storage directory |
| `INDEXA_CONFIG` | — | Path to config file |
| `INDEXA_DEBUG` | — | Enable debug logging (any value) |

## Search Scoring Weights

The hybrid search uses these weights:

| Component | Weight | What it does |
|-----------|--------|-------------|
| Semantic (cosine similarity) | 15% | Vector similarity via hash-based embeddings |
| BM25 keyword | 45% | Term frequency × inverse document frequency |
| Name match | 20% | Query tokens matching symbol names |
| Path match | 20% | Query tokens matching file path segments |

These weights are optimized for hash-based embeddings (which are unreliable for semantic meaning). If you switch to real embeddings (OpenAI, local model), increase semantic weight and decrease keyword weight.

### Stop Words

Common terms are filtered from BM25 to reduce noise:
- English: `the`, `is`, `for`, `to`, `of`, `and`, `or`, ...
- Code-generic: `system`, `data`, `item`, `list`, `type`, `value`, `result`, `get`, `set`, `function`, `class`, `module`, ...

These are defined in `src/utils/index.ts`.

## Data Storage

| File | Size | Contents |
|------|------|---------|
| `data/embeddings.json` | 10-50 MB | Chunk metadata + embedding vectors (no inline code) |
| `data/metadata.json` | < 1 MB | File path → content hash mapping |

Code is NOT stored in the index. It's read on demand from source files via byte offsets.

Both files are written atomically (write to `.tmp` → rename) to prevent corruption.

## Pluggable Embeddings

The default hash-based embedder works offline with no API keys. To use real embeddings, implement the `EmbeddingProvider` interface:

```typescript
import { EmbeddingProvider } from './src/types';

class OpenAIEmbeddings implements EmbeddingProvider {
  dimension = 1536;

  async embed(text: string): Promise<number[]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text,
      }),
    });
    const data = await response.json();
    return data.data[0].embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Batch API call
  }
}
```

> **Note:** Switching embedding providers requires a full re-index. Embeddings from different providers are not compatible.
