# Indexa v3.4 — API Reference

Base URL: `http://localhost:3000` — all endpoints prefixed with `/api`.

22 endpoints available.

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

## `GET /api/dead-code`

Find unreferenced functions, methods, and classes across the index.

**Response:**
```json
{
  "deadCode": [
    { "name": "legacyHelper", "type": "function", "filePath": "src/utils/legacy.ts", "line": 42 }
  ],
  "count": 1
}
```

---

## `GET /api/blast-radius?name=`

Dedicated impact analysis — what breaks if you change a symbol.

**Request:** `GET /api/blast-radius?name=VendorService`

**Response:**
```json
{
  "symbol": "VendorService",
  "directDependents": ["VendorController", "VendorModule"],
  "affectedFiles": ["src/vendor/vendor.controller.ts", "src/vendor/vendor.module.ts"],
  "riskLevel": "medium"
}
```

---

## `GET /api/impact-chain?name=&depth=`

Full transitive impact analysis — follows the chain of dependents recursively.

**Request:** `GET /api/impact-chain?name=pricingService&depth=4`

**Response:**
```json
{
  "symbol": "pricingService",
  "depth": 4,
  "chain": [
    { "level": 1, "symbols": ["PricingController"] },
    { "level": 2, "symbols": ["AppModule"] }
  ],
  "totalAffected": 3
}
```

---

## `GET /api/circular-deps`

Detect circular dependency / import cycles in the codebase.

**Response:**
```json
{
  "cycles": [
    ["src/a.ts", "src/b.ts", "src/a.ts"]
  ],
  "count": 1
}
```

---

## `GET /api/unused-exports`

Find exported symbols that nobody imports.

**Response:**
```json
{
  "unusedExports": [
    { "name": "oldUtil", "filePath": "src/utils/old.ts", "line": 10 }
  ],
  "count": 1
}
```

---

## `GET /api/duplicates?threshold=`

Find near-duplicate code blocks via embedding similarity.

**Request:** `GET /api/duplicates?threshold=0.9`

**Response:**
```json
{
  "duplicates": [
    {
      "a": { "name": "validateUser", "filePath": "src/auth/validate.ts" },
      "b": { "name": "checkUser", "filePath": "src/user/check.ts" },
      "similarity": 0.94
    }
  ],
  "count": 1
}
```

---

## `GET /api/importers?path=`

Find all files/symbols that import from a given file.

**Request:** `GET /api/importers?path=src/utils/index.ts`

**Response:**
```json
{
  "file": "src/utils/index.ts",
  "importers": [
    { "filePath": "src/auth/auth.service.ts", "symbols": ["hashPassword", "validateToken"] },
    { "filePath": "src/vendor/vendor.service.ts", "symbols": ["formatCurrency"] }
  ],
  "count": 2
}
```

---

## `GET /api/grep?pattern=&filePattern=`

Regex pattern search across indexed source files.

**Request:** `GET /api/grep?pattern=TODO|FIXME&filePattern=*.ts`

**Response:**
```json
{
  "matches": [
    { "filePath": "src/auth/auth.service.ts", "line": 55, "text": "// TODO: add rate limiting" }
  ],
  "count": 1
}
```

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
| GET | `/api/blast-radius?name=` | Dedicated impact analysis |
| POST | `/api/update` | Incremental re-index |
| GET | `/api/stats` | Index statistics |
| GET | `/api/health` | Health check |
| GET | `/api/dead-code` | Find unreferenced symbols |
| GET | `/api/impact-chain?name=&depth=` | Full transitive impact analysis |
| GET | `/api/circular-deps` | Circular dependency detection |
| GET | `/api/unused-exports` | Find dead exports |
| GET | `/api/duplicates?threshold=` | Near-duplicate code detection |
| GET | `/api/importers?path=` | Who imports from a file |
| GET | `/api/grep?pattern=&filePattern=` | Regex search across source files |
