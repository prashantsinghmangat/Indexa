# Indexa v2.0 — Configuration

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
  "excludePatterns": ["node_modules", "dist", ".git", "*.test.*", "*.spec.*"]
}
```

## Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `projectRoot` | string | `"."` | Root directory of the project to index |
| `dataDir` | string | `"./data"` | Directory for storing index data |
| `port` | number | `3000` | Port for the REST API server |
| `embeddingDim` | number | `128` | Dimension of embedding vectors |
| `defaultTopK` | number | `5` | Default number of search results |
| `defaultTokenBudget` | number | `4000` | Default token budget for context bundles |
| `includePatterns` | string[] | `["*.ts", "*.tsx", "*.js", "*.jsx"]` | File patterns to index |
| `excludePatterns` | string[] | `["node_modules", "dist", ".git", "*.test.*", "*.spec.*"]` | Patterns to skip |

## File Patterns

### includePatterns

Glob-style patterns for files to index:

```json
{
  "includePatterns": ["*.ts", "*.tsx", "*.js", "*.jsx", "*.html", "*.scss"]
}
```

### excludePatterns

Patterns for files and directories to skip:

```json
{
  "excludePatterns": [
    "node_modules", "dist", ".git",
    "*.test.*", "*.spec.*", "*.d.ts",
    "coverage", ".next"
  ]
}
```

## Environment Variables

| Variable | Overrides | Description |
|----------|-----------|-------------|
| `INDEXA_DATA_DIR` | `dataDir` | Data storage directory |
| `INDEXA_CONFIG` | — | Path to config file |
| `INDEXA_DEBUG` | — | Enable debug logging (set to any value) |

## Data Storage

Index data is stored as two JSON files:

| File | Contents |
|------|---------|
| `data/embeddings.json` | Chunk metadata + embeddings (no code stored) |
| `data/metadata.json` | File path to hash mapping for change detection |

### v2 Index Format

Code is NOT stored in the index. Each chunk stores:
- `byteOffset` + `byteLength` for O(1) code retrieval from source files
- `contentHash` for drift detection
- `imports` for graph analysis

This makes the index ~5x smaller than v1.

### Multi-Project Setup

```powershell
node dist/cli/index.js index "D:\ProjectA" --data-dir ./data-projectA
node dist/cli/index.js index "D:\ProjectB" --data-dir ./data-projectB
node dist/cli/index.js search "query" --data-dir ./data-projectA
```

## Pluggable Embeddings

The default hash-based embedder works offline with no API keys. To use real embeddings:

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
      body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
    });
    const data = await response.json();
    return data.data[0].embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: texts }),
    });
    const data = await response.json();
    return data.data.map((d: any) => d.embedding);
  }
}
```

> **Note:** When switching embedding providers, you must re-index the entire codebase.
