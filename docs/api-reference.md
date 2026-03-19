# Indexa v2.1 — API Reference

Base URL: `http://localhost:3000`

All endpoints prefixed with `/api`.

---

## `POST /api/context-bundle` (PRIMARY)

**The primary endpoint.** Query → search → pack symbols + dependencies within token budget.

**Request:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `query` | string | *required* | Search query |
| `tokenBudget` | number | 2000 | Max tokens to return |

**Example:**
```bash
curl -X POST http://localhost:3000/api/context-bundle \
  -H "Content-Type: application/json" \
  -d '{"query": "vendor service area", "tokenBudget": 1500}'
```

**Response:**
```json
{
  "query": "vendor service area",
  "tokenBudget": 1500,
  "estimatedTokens": 680,
  "symbols": [
    {
      "id": "src/vendor.service.ts::VendorService#class",
      "name": "VendorService",
      "type": "class",
      "filePath": "src/vendor.service.ts",
      "startLine": 10,
      "endLine": 85,
      "code": "export class VendorService { ... }",
      "summary": "class VendorService [76L] — service provider"
    }
  ],
  "dependencies": [
    {
      "id": "src/utils.ts::haversineDistance#function",
      "name": "haversineDistance",
      "type": "function",
      "filePath": "src/utils.ts",
      "startLine": 101,
      "endLine": 114,
      "code": "function haversineDistance(...) { ... }",
      "summary": "function haversineDistance [14L]"
    }
  ]
}
```

---

## `POST /api/search`

Auto-routed search. Identifiers → symbol lookup, short → BM25, else → hybrid.

**Request:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `query` | string | *required* | Search query |
| `topK` | number | 5 | Max results (1–50) |
| `tokenBudget` | number | — | Token budget (overrides topK) |
| `mode` | string | `"hybrid"` | Force `"hybrid"`, `"semantic"`, or `"keyword"` |

---

## `GET /api/symbol?name=`

Find symbols by name (case-insensitive partial match).

---

## `GET /api/symbol/:id`

Get symbol by stable ID. O(1) lookup.

**Example:**
```bash
curl "http://localhost:3000/api/symbol/src%2Fauth.ts%3A%3AvalidateToken%23function"
```

---

## `GET /api/file?path=`

Get all indexed chunks for a file (with code).

---

## `GET /api/outline?path=`

File symbol outline — names, types, lines. No code loaded.

---

## `GET /api/references?name=`

Find all symbols that reference a given symbol + blast radius.

---

## `GET /api/blast-radius?name=`

Estimate change impact — direct refs, transitive refs, affected files.

---

## `POST /api/update`

Trigger incremental re-index via git diff.

---

## `GET /api/stats`

Index statistics: chunk count, file count, data location.

---

## `GET /api/health`

Health check.

```json
{ "status": "ok", "chunks": 12317, "files": 1353 }
```

---

## Error Responses

```json
{ "error": "Description" }
```

| Status | Meaning |
|--------|---------|
| `400` | Missing/invalid parameter |
| `404` | Not found |
| `500` | Internal error |
