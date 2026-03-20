# Indexa v3.0 — API Reference

Base URL: `http://localhost:3000` — all endpoints prefixed with `/api`.

12 endpoints available.

---

## `POST /api/context-bundle` (PRIMARY)

Query → symbols + dependencies + connections within token budget. File diversity: max 2 chunks per file.

**Request:**
```json
{ "query": "vendor service area", "tokenBudget": 1500 }
```

**Response:**
```json
{
  "query": "vendor service area",
  "tokenBudget": 1500,
  "estimatedTokens": 680,
  "symbols": [{ "id": "...", "name": "...", "type": "...", "code": "...", "summary": "..." }],
  "dependencies": [{ "id": "...", "name": "...", "code": "..." }],
  "connections": [
    { "from": "findVendorsInArea", "to": "haversineDistance", "type": "calls" },
    { "from": "findVendorsInArea", "to": "ServiceAreaQuery", "type": "depends_on" }
  ]
}
```

---

## `POST /api/flow`

Trace execution flow across functions and files.

**Request:**
```json
{ "query": "getVendorRatesByServiceArea", "depth": 3 }
```

**Response:**
```json
{
  "entry": "getVendorRatesByServiceArea",
  "flow": [
    {
      "step": 1,
      "symbolId": "...",
      "name": "getVendorRatesByServiceArea",
      "type": "function",
      "filePath": "...",
      "summary": "retrieves vendor rates by service area",
      "calls": ["vendorManagementService", "GetCategories"]
    }
  ]
}
```

---

## `POST /api/explain`

Human-readable code explanation.

**Request:**
```json
{ "query": "vendor management pricing", "tokenBudget": 2000 }
```

**Response:**
```json
{
  "explanation": "This area of the codebase handles vendor management pricing...",
  "steps": [
    "Retrieves vendor rates by service area",
    "Validates pricing categories",
    "Uses dependencies: vendorManagementService"
  ],
  "symbolsUsed": [
    { "id": "...", "name": "getVendorRatesByServiceArea", "type": "function", "summary": "..." }
  ]
}
```

---

## `POST /api/search`

Auto-routed search. Query router: identifiers → symbol lookup, short queries → BM25 keyword, else → hybrid (35% semantic + 25% BM25 + 15% name match + 25% path match).

```json
{ "query": "VendorService", "topK": 5 }
```

---

## `GET /api/symbol?name=` | `GET /api/symbol/:id`

Find symbols by name or get by stable ID.

---

## `GET /api/file?path=`

File chunks (with code via byte-offset retrieval).

---

## `GET /api/outline?path=`

File symbol outline (without code).

---

## `GET /api/references?name=`

Find all references/usages of a symbol.

---

## `GET /api/blast-radius?name=`

Estimate change impact — which files and symbols would be affected.

---

## `GET /api/stats`

Index statistics: chunk count, file count, cache status.

---

## `GET /api/health`

Health check endpoint. Returns server status.

---

## `POST /api/update`

Incremental re-index via git diff. Only re-indexes files changed since last commit.

---

## Summary Table

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/context-bundle` | **PRIMARY.** Symbols + deps + connections |
| POST | `/api/flow` | Execution flow tracing |
| POST | `/api/explain` | Code explanation |
| POST | `/api/search` | Auto-routed search |
| GET | `/api/symbol?name=` | Find symbols by name |
| GET | `/api/symbol/:id` | Get symbol by stable ID |
| GET | `/api/file?path=` | All chunks for a file |
| GET | `/api/outline?path=` | File symbol outline |
| GET | `/api/references?name=` | References |
| GET | `/api/blast-radius?name=` | Change impact analysis |
| POST | `/api/update` | Incremental re-index |
| GET | `/api/stats` | Index statistics |
| GET | `/api/health` | Health check |
