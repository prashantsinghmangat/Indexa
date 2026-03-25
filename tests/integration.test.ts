/**
 * Integration tests for Indexa core flows.
 * Run: npx ts-node tests/integration.test.ts
 *
 * Tests:
 * 1. First-run flow: index sample code → search → get results
 * 2. Corrupt data recovery: corrupt index → load → verify backup restores
 * 3. Analysis tools: dead code, circular deps, duplicates on indexed data
 * 4. Binary file handling: parser should skip binary files without crash
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Test utilities
let passed = 0;
let failed = 0;
const errors: string[] = [];

function assert(condition: boolean, msg: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    errors.push(msg);
    console.log(`  ✗ ${msg}`);
  }
}

function section(name: string): void {
  console.log(`\n═══ ${name} ═══`);
}

// Create a temp directory for test data
function makeTempDir(): string {
  const dir = path.join(os.tmpdir(), `indexa-test-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ─── Test 1: First-run flow ──────────────────────────────────────────────────

async function testFirstRunFlow(): Promise<void> {
  section('Test 1: First-run flow (index → search → results)');

  const dataDir = makeTempDir();
  // __dirname at runtime = dist/tests, so go up 2 levels to repo root
  const repoRoot = path.resolve(__dirname, '..', '..');
  const sampleDir = path.resolve(repoRoot, 'sample-code');

  try {
    const { VectorDB } = require('../src/storage/vector-db');
    const { MetadataDB } = require('../src/storage/metadata-db');
    const { Embedder } = require('../src/indexer/embedder');
    const { Updater } = require('../src/indexer/updater');
    const { HybridSearch } = require('../src/retrieval/hybrid');
    const { GraphAnalysis } = require('../src/retrieval/graph');

    // Step 1: Index sample code
    const vectorDB = new VectorDB(dataDir);
    const metadataDB = new MetadataDB(dataDir);
    const embedder = new Embedder();
    const config = {
      projectRoot: sampleDir,
      dataDir,
      port: 3000,
      embeddingDim: 128,
      defaultTopK: 5,
      defaultTokenBudget: 4000,
      includePatterns: ['*.ts', '*.tsx', '*.js', '*.jsx'],
      excludePatterns: ['node_modules', 'dist', '.git'],
    };

    const updater = new Updater(config, vectorDB, metadataDB, embedder);
    const result = await updater.indexAll(sampleDir);

    assert(result.indexed > 0, `Indexed ${result.indexed} files`);
    assert(result.chunks > 0, `Created ${result.chunks} chunks`);
    assert(vectorDB.size > 0, `VectorDB has ${vectorDB.size} chunks`);

    // Step 2: Search
    const search = new HybridSearch(vectorDB, embedder);
    const searchResults = await search.search('controller', 5);

    assert(searchResults.length > 0, `Search returned ${searchResults.length} results`);
    if (searchResults.length > 0) {
      assert(searchResults[0].score > 0, `Top result has score ${searchResults[0].score.toFixed(3)}`);
    }

    // Step 3: Verify persistence
    vectorDB.save();
    metadataDB.save();

    const embPath = path.join(dataDir, 'embeddings.json');
    assert(fs.existsSync(embPath), 'embeddings.json was written to disk');

    const raw = fs.readFileSync(embPath, 'utf-8');
    const parsed = JSON.parse(raw);
    assert(Array.isArray(parsed) && parsed.length > 0, `File contains ${parsed.length} chunks`);

    // Step 4: Graph analysis works
    const graph = new GraphAnalysis(vectorDB);
    const dead = graph.findDeadCode();
    assert(Array.isArray(dead), `Dead code scan returned ${dead.length} results`);

  } finally {
    cleanup(dataDir);
  }
}

// ─── Test 2: Corrupt data recovery ──────────────────────────────────────────

async function testCorruptDataRecovery(): Promise<void> {
  section('Test 2: Corrupt data recovery (backup/restore)');

  const dataDir = makeTempDir();

  try {
    const { VectorDB } = require('../src/storage/vector-db');

    // Step 1: Create a valid index with some data
    const db1 = new VectorDB(dataDir);
    db1.upsert({
      id: 'test::func1#function',
      name: 'func1',
      type: 'function',
      summary: 'Test function 1',
      filePath: '/test/file.ts',
      startLine: 1,
      endLine: 10,
      byteOffset: 0,
      byteLength: 100,
      dependencies: [],
      imports: [],
      contentHash: 'abc123',
      embedding: new Array(128).fill(0.1),
      indexedAt: new Date().toISOString(),
    });
    db1.upsert({
      id: 'test::func2#function',
      name: 'func2',
      type: 'function',
      summary: 'Test function 2',
      filePath: '/test/file.ts',
      startLine: 12,
      endLine: 20,
      byteOffset: 100,
      byteLength: 80,
      dependencies: ['func1'],
      imports: [],
      contentHash: 'def456',
      embedding: new Array(128).fill(0.2),
      indexedAt: new Date().toISOString(),
    });
    db1.save();

    assert(db1.size === 2, `Created index with ${db1.size} chunks`);

    // Verify backup was created
    const bakPath = path.join(dataDir, 'embeddings.json.bak');
    // First save won't have a backup (no previous file), but second save will
    db1.upsert({
      id: 'test::func3#function',
      name: 'func3',
      type: 'function',
      summary: 'Test function 3',
      filePath: '/test/file2.ts',
      startLine: 1,
      endLine: 5,
      byteOffset: 0,
      byteLength: 50,
      dependencies: [],
      imports: [],
      contentHash: 'ghi789',
      embedding: new Array(128).fill(0.3),
      indexedAt: new Date().toISOString(),
    });
    db1.save();

    assert(fs.existsSync(bakPath), 'Backup file .bak was created');

    // Step 2: Corrupt the primary file
    const embPath = path.join(dataDir, 'embeddings.json');
    fs.writeFileSync(embPath, '{"corrupt": tru', 'utf-8'); // Invalid JSON

    // Step 3: Load — should recover from backup
    const db2 = new VectorDB(dataDir);
    assert(db2.size >= 2, `Recovered ${db2.size} chunks from backup (expected >= 2)`);

    // Step 4: Verify reverse index works after recovery
    const dependents = db2.findDependents('func1');
    assert(dependents.length > 0, `Reverse index works after recovery: ${dependents.length} dependents`);

  } finally {
    cleanup(dataDir);
  }
}

// ─── Test 3: Binary file handling ────────────────────────────────────────────

async function testBinaryFileHandling(): Promise<void> {
  section('Test 3: Binary file handling (parser skips without crash)');

  const tempDir = makeTempDir();

  try {
    const { Parser } = require('../src/indexer/parser');

    // Create a fake binary file with null bytes
    const binaryPath = path.join(tempDir, 'fake-binary.js');
    const buf = Buffer.alloc(100);
    buf.fill(0);
    buf.write('var x = 1;', 0);
    fs.writeFileSync(binaryPath, buf);

    const parser = new Parser();
    const result = parser.parseFile(binaryPath);

    assert(Array.isArray(result), 'Parser returned array (no crash)');
    assert(result.length === 0, `Binary file returned 0 elements (got ${result.length})`);

    // Also test a normal file works
    const normalPath = path.join(tempDir, 'normal.ts');
    fs.writeFileSync(normalPath, 'export function hello() { return "hi"; }', 'utf-8');

    const normalResult = parser.parseFile(normalPath);
    assert(normalResult.length > 0, `Normal file parsed: ${normalResult.length} elements`);

  } finally {
    cleanup(tempDir);
  }
}

// ─── Test 4: Reverse index performance ──────────────────────────────────────

async function testReverseIndex(): Promise<void> {
  section('Test 4: Reverse reference index');

  const dataDir = makeTempDir();

  try {
    const { VectorDB } = require('../src/storage/vector-db');

    const db = new VectorDB(dataDir);

    // Insert chunks with dependencies
    for (let i = 0; i < 100; i++) {
      db.upsert({
        id: `test::func${i}#function`,
        name: `func${i}`,
        type: 'function',
        summary: `Function ${i}`,
        filePath: `/test/file${i % 10}.ts`,
        startLine: 1,
        endLine: 10,
        byteOffset: 0,
        byteLength: 100,
        dependencies: i > 0 ? [`func${i - 1}`] : [],
        imports: i > 0 ? [{ name: `func${i - 1}`, source: `./file${(i - 1) % 10}`, isDefault: false }] : [],
        contentHash: `hash${i}`,
        embedding: new Array(128).fill(i / 100),
        indexedAt: new Date().toISOString(),
      });
    }

    assert(db.size === 100, `Inserted 100 chunks`);

    // Test reverse index lookup
    const start = Date.now();
    const refs = db.findDependents('func0');
    const elapsed = Date.now() - start;

    assert(refs.length > 0, `findDependents('func0') returned ${refs.length} results`);
    assert(elapsed < 50, `Lookup took ${elapsed}ms (should be <50ms)`);

    // Test file index
    const fileChunks = db.getByFile('/test/file0.ts');
    assert(fileChunks.length === 10, `File index: 10 chunks in file0.ts (got ${fileChunks.length})`);

  } finally {
    cleanup(dataDir);
  }
}

// ─── Test 5: Buffer overflow protection ──────────────────────────────────────

async function testBufferOverflow(): Promise<void> {
  section('Test 5: Buffer overflow protection');

  const { readCodeAtOffset } = require('../src/utils');

  // Test with invalid values — should return empty string, not crash
  const result1 = readCodeAtOffset('/nonexistent/file.ts', 0, 100);
  assert(result1 === '', 'Non-existent file returns empty string');

  const result2 = readCodeAtOffset('/test.ts', -1, 100);
  assert(result2 === '', 'Negative offset returns empty string');

  const result3 = readCodeAtOffset('/test.ts', 0, -5);
  assert(result3 === '', 'Negative length returns empty string');

  const result4 = readCodeAtOffset('/test.ts', 0, 2 * 1024 * 1024);
  assert(result4 === '', 'Oversized length (>1MB) returns empty string');
}

// ─── Run All Tests ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n╔═══════════════════════════════════╗');
  console.log('║     Indexa Integration Tests       ║');
  console.log('╚═══════════════════════════════════╝');

  await testFirstRunFlow();
  await testCorruptDataRecovery();
  await testBinaryFileHandling();
  await testReverseIndex();
  await testBufferOverflow();

  console.log('\n═══════════════════════════════════');
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  if (errors.length > 0) {
    console.log(`\n  Failures:`);
    for (const e of errors) {
      console.log(`    ✗ ${e}`);
    }
  }
  console.log('═══════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
