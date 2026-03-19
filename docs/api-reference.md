# Indexa v3.0 — API Reference

Base URL: `http://localhost:3000` — all endpoints prefixed with `/api`.

---

## `POST /api/context-bundle` (PRIMARY)

Query → symbols + dependencies + connections within token budget.

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

Auto-routed search. Identifiers → symbol lookup, short → BM25, else → hybrid.

```json
{ "query": "VendorService", "topK": 5 }
```

---

## `GET /api/symbol?name=` | `GET /api/symbol/:id`

Find symbols by name or get by stable ID.

---

## `GET /api/file?path=` | `GET /api/outline?path=`

File chunks (with code) or outline (without code).

---

## `GET /api/references?name=` | `GET /api/blast-radius?name=`

Find usages and estimate change impact.

---

## `POST /api/update` | `GET /api/stats` | `GET /api/health`

Index management, statistics, and health check.
