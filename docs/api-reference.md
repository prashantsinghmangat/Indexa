# Indexa v2.0 — API Reference

Base URL: `http://localhost:3000`

All API endpoints are prefixed with `/api`.

---

## `GET /`

Server info and available endpoints.

**Response:**
```json
{
  "name": "Indexa",
  "version": "2.0.0",
  "endpoints": [
    "POST /api/search",
    "POST /api/update",
    "GET  /api/file?path=",
    "GET  /api/symbol?name=",
    "GET  /api/symbol/:id",
    "GET  /api/outline?path=",
    "GET  /api/references?name=",
    "GET  /api/blast-radius?name=",
    "GET  /api/stats",
    "GET  /api/health"
  ]
}
```

---

## `POST /api/search`

Search the indexed codebase. Supports token budgeting.

**Request body:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `query` | string | *required* | Search query text |
| `topK` | number | 5 | Results to return (1–50) |
| `tokenBudget` | number | — | Token budget. Packs results until exhausted. Overrides topK when set. |
| `mode` | string | `"hybrid"` | `"hybrid"`, `"semantic"`, or `"keyword"` |

**Example:**
```bash
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{"query": "vendor service", "topK": 3}'
```

**Token budget example:**
```bash
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{"query": "service", "tokenBudget": 500}'
```

**Response:**
```json
{
  "query": "vendor service",
  "mode": "hybrid",
  "results": [
    {
      "score": 0.808,
      "matchType": "hybrid",
      "chunk": {
        "id": "D:/project/src/vendor.service.js::VendorService#service",
        "name": "VendorService",
        "type": "service",
        "filePath": "D:/project/src/vendor.service.js",
        "startLine": 7,
        "endLine": 30,
        "summary": "service \"VendorService\" (24 lines): ...",
        "code": "angular.module('app').factory('VendorService', ...",
        "dependencies": ["$http", "$scope"],
        "imports": []
      }
    }
  ]
}
```

---

## `GET /api/symbol?name=`

Find symbols by name (case-insensitive partial match).

**Query parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `name` | string | Symbol name |

**Example:**
```bash
curl "http://localhost:3000/api/symbol?name=VendorService"
```

---

## `GET /api/symbol/:id`

Get a symbol by its stable ID. O(1) lookup.

**Path parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | string | Stable symbol ID (URL-encoded) |

**Example:**
```bash
curl "http://localhost:3000/api/symbol/src%2Fauth.ts%3A%3AvalidateToken%23function"
```

**Response:**
```json
{
  "id": "src/auth.ts::validateToken#function",
  "name": "validateToken",
  "type": "function",
  "filePath": "D:/project/src/auth.ts",
  "startLine": 45,
  "endLine": 56,
  "summary": "function \"validateToken\" (12 lines): ...",
  "code": "export async function validateToken(token: string) { ... }",
  "dependencies": ["jwt", "verify"],
  "imports": [{"name": "jwt", "source": "jsonwebtoken", "isDefault": true}]
}
```

---

## `GET /api/file?path=`

Get all indexed chunks for a file.

| Param | Type | Description |
|-------|------|-------------|
| `path` | string | File path (absolute or partial match) |

---

## `GET /api/outline?path=`

Get file symbol outline — all symbols without loading code. Fast structural overview.

| Param | Type | Description |
|-------|------|-------------|
| `path` | string | File path |

**Response:**
```json
{
  "filePath": "D:/project/src/vendor.service.ts",
  "symbols": [
    {
      "id": "D:/project/src/vendor.service.ts::VendorService#class",
      "name": "VendorService",
      "type": "class",
      "startLine": 10,
      "endLine": 85,
      "summary": "class \"VendorService\" (76 lines): ..."
    },
    {
      "id": "D:/project/src/vendor.service.ts::VendorService.getAll#method",
      "name": "VendorService.getAll",
      "type": "method",
      "startLine": 15,
      "endLine": 25,
      "summary": "method \"VendorService.getAll\" (11 lines): ..."
    }
  ]
}
```

---

## `GET /api/references?name=`

Find all symbols that reference or depend on a given symbol.

| Param | Type | Description |
|-------|------|-------------|
| `name` | string | Symbol name to find references for |

**Response:**
```json
{
  "symbolName": "VendorService",
  "references": [
    {
      "id": "D:/project/src/app.ts::AppController#controller",
      "name": "AppController",
      "type": "controller",
      "filePath": "D:/project/src/app.ts",
      "startLine": 5
    }
  ],
  "total": 12
}
```

---

## `GET /api/blast-radius?name=`

Estimate the impact of changing a symbol.

| Param | Type | Description |
|-------|------|-------------|
| `name` | string | Symbol name |

**Response:**
```json
{
  "symbolName": "VendorService",
  "directRefs": 8,
  "transitiveRefs": 15,
  "files": [
    "D:/project/src/app.ts",
    "D:/project/src/vendor.controller.ts"
  ]
}
```

---

## `POST /api/update`

Trigger incremental re-indexing via git diff.

```bash
curl -X POST http://localhost:3000/api/update
```

---

## `GET /api/stats`

Index statistics.

```bash
curl http://localhost:3000/api/stats
```

---

## `GET /api/health`

Health check.

```bash
curl http://localhost:3000/api/health
```

**Response:**
```json
{
  "status": "ok",
  "chunks": 12317,
  "files": 1353
}
```

---

## Error Responses

```json
{ "error": "Description of what went wrong" }
```

| Status | Meaning |
|--------|---------|
| `400` | Missing or invalid request parameter |
| `404` | Resource not found in index |
| `500` | Internal server error |
