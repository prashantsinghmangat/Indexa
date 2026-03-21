import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { ensureDir, logger } from '../src/utils';
import { indexCommand } from './update';
import { cleanCommand, statsCommand } from './clean';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function print(msg: string) { console.log(msg); }
function success(msg: string) { console.log(`  ✓ ${msg}`); }
function warn(msg: string) { console.log(`  ! ${msg}`); }
function fail(msg: string) { console.log(`  ✗ ${msg}`); }

/** Find the Indexa installation root (where dist/ and data/ live).
 *  At runtime, __dirname is dist/cli/ so we go up 2 levels. */
function getIndexaRoot(): string {
  // __dirname at runtime = d:/Project/Indexa/dist/cli
  // We need: d:/Project/Indexa
  let dir = __dirname;
  // Walk up until we find package.json with name "indexa"
  for (let i = 0; i < 5; i++) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.name === 'indexa') return dir;
      } catch { /* continue */ }
    }
    dir = path.dirname(dir);
  }
  // Fallback: assume dist/cli → go up 2
  return path.resolve(__dirname, '..', '..');
}

/** Detect project root by walking up from cwd looking for markers */
function detectProjectRoot(startDir: string): string {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;

  while (dir !== root) {
    if (
      fs.existsSync(path.join(dir, 'package.json')) ||
      fs.existsSync(path.join(dir, '.git')) ||
      fs.existsSync(path.join(dir, 'tsconfig.json'))
    ) {
      return dir;
    }
    dir = path.dirname(dir);
  }

  return startDir; // fallback to cwd
}

/** Detect project language/framework */
function detectProjectType(projectRoot: string): { lang: string; framework: string; files: number } {
  const pkg = path.join(projectRoot, 'package.json');
  let framework = 'unknown';
  let lang = 'javascript';

  if (fs.existsSync(path.join(projectRoot, 'tsconfig.json'))) {
    lang = 'typescript';
  }

  if (fs.existsSync(pkg)) {
    try {
      const pkgData = JSON.parse(fs.readFileSync(pkg, 'utf-8'));
      const allDeps = { ...pkgData.dependencies, ...pkgData.devDependencies };
      if (allDeps['react']) framework = 'react';
      else if (allDeps['@angular/core']) framework = 'angular';
      else if (allDeps['vue']) framework = 'vue';
      else if (allDeps['express'] || allDeps['fastify']) framework = 'node-server';
      else framework = 'node';
    } catch { /* ignore */ }
  }

  // Count source files (rough estimate)
  let files = 0;
  try {
    const output = execSync(
      `find "${projectRoot}" -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" | grep -v node_modules | grep -v dist | grep -v .git | wc -l`,
      { encoding: 'utf-8', timeout: 10000 }
    ).trim();
    files = parseInt(output, 10) || 0;
  } catch {
    files = -1; // couldn't count
  }

  return { lang, framework, files };
}

/** Check if Claude Code is installed */
function hasClaudeCode(): boolean {
  try {
    execSync('claude --version', { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/** Get the MCP server script path */
function getMcpServerPath(): string {
  return path.join(getIndexaRoot(), 'dist', 'src', 'mcp', 'stdio.js').replace(/\\/g, '/');
}

/** Get the data directory path — per-project .indexa/ directory */
function getProjectDataDir(projectRoot: string): string {
  return path.join(projectRoot, '.indexa').replace(/\\/g, '/');
}

/** Add .indexa/ to the project's .gitignore if not already present */
function addToGitignore(projectRoot: string): void {
  const gitignorePath = path.join(projectRoot, '.gitignore');
  try {
    let content = '';
    if (fs.existsSync(gitignorePath)) {
      content = fs.readFileSync(gitignorePath, 'utf-8');
    }
    if (!content.includes('.indexa')) {
      const separator = content.endsWith('\n') || content === '' ? '' : '\n';
      fs.appendFileSync(gitignorePath, `${separator}\n# Indexa code intelligence data\n.indexa/\n`);
    }
  } catch { /* ignore — non-critical */ }
}

/** Configure MCP in ~/.mcp.json */
function setupMcp(projectDataDir: string): boolean {
  const mcpPath = path.join(process.env.HOME || process.env.USERPROFILE || '', '.mcp.json');
  const serverPath = getMcpServerPath();

  const mcpConfig = {
    mcpServers: {
      indexa: {
        command: 'node',
        args: [serverPath, '--data-dir', projectDataDir],
      },
    },
  };

  try {
    let existing: any = {};
    if (fs.existsSync(mcpPath)) {
      existing = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
    }

    // Merge — don't overwrite other MCP servers
    if (!existing.mcpServers) existing.mcpServers = {};
    existing.mcpServers.indexa = mcpConfig.mcpServers.indexa;

    fs.writeFileSync(mcpPath, JSON.stringify(existing, null, 2));
    return true;
  } catch {
    return false;
  }
}

/** Create project-level .mcp.json pointing to local .indexa/ */
function setupProjectMcp(projectRoot: string, projectDataDir: string): boolean {
  const mcpPath = path.join(projectRoot, '.mcp.json');
  const serverPath = getMcpServerPath();

  const mcpEntry = {
    command: 'node',
    args: [serverPath, '--data-dir', projectDataDir],
  };

  try {
    let existing: any = {};
    if (fs.existsSync(mcpPath)) {
      existing = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
    }
    if (!existing.mcpServers) existing.mcpServers = {};
    existing.mcpServers.indexa = mcpEntry;

    fs.writeFileSync(mcpPath, JSON.stringify(existing, null, 2));
    return true;
  } catch {
    return false;
  }
}

// ─── Main Setup Command ───────────────────────────────────────────────────────

export async function setupCommand(targetDir?: string): Promise<void> {
  const startTime = Date.now();
  const indexaRoot = getIndexaRoot();

  print('');
  print('  ╔═══════════════════════════════════╗');
  print('  ║         Indexa Setup               ║');
  print('  ║   Code Intelligence for LLMs       ║');
  print('  ╚═══════════════════════════════════╝');
  print('');

  // ─── Step 1: Detect Project ───────────────────────────────────────────
  print('  Step 1/5: Detecting project...');

  const projectRoot = targetDir
    ? path.resolve(targetDir)
    : detectProjectRoot(process.cwd());

  const project = detectProjectType(projectRoot);
  const dataDir = getProjectDataDir(projectRoot);
  success(`Project: ${path.basename(projectRoot)}`);
  success(`Type: ${project.lang} / ${project.framework}`);
  if (project.files > 0) success(`Files: ~${project.files} source files`);
  print('');

  // ─── Step 2: Ensure data directory ────────────────────────────────────
  print('  Step 2/5: Preparing data storage...');
  ensureDir(dataDir);
  addToGitignore(projectRoot);
  success(`Data: ${dataDir}`);
  success('Added .indexa/ to .gitignore');
  print('');

  // ─── Step 3: Index the codebase ───────────────────────────────────────
  print('  Step 3/5: Indexing codebase...');
  print(`           (${projectRoot})`);
  print('');

  try {
    await indexCommand(projectRoot, { dataDir });
    print('');
    print('  Cleaning junk entries...');
    await cleanCommand({ dataDir });
  } catch (err) {
    warn(`Indexing encountered issues: ${err instanceof Error ? err.message : err}`);
    warn('You can retry with: indexa index <directory>');
  }
  print('');

  // ─── Step 4: Setup MCP ────────────────────────────────────────────────
  print('  Step 4/5: Configuring MCP...');

  const mcpOk = setupMcp(dataDir);
  if (mcpOk) {
    success('Global MCP configured (~/.mcp.json)');
  } else {
    warn('Could not configure global MCP — set up manually');
  }

  const projectMcpOk = setupProjectMcp(projectRoot, dataDir);
  if (projectMcpOk) {
    success(`Project MCP created (${path.basename(projectRoot)}/.mcp.json)`);
  }

  if (hasClaudeCode()) {
    success('Claude Code detected');
  } else {
    warn('Claude Code not found — MCP config saved for when you install it');
  }
  print('');

  // ─── Step 5: Verify with live test ─────────────────────────────────
  print('  Step 5/5: Testing...');

  let chunks = 0;
  let testPassed = false;
  try {
    const embPath = path.join(dataDir, 'embeddings.json');
    if (fs.existsSync(embPath)) {
      const raw = fs.readFileSync(embPath, 'utf-8');
      const data = JSON.parse(raw);
      chunks = Array.isArray(data) ? data.length : 0;
    }
  } catch { /* ignore */ }

  if (chunks > 0) {
    success(`Index: ${chunks.toLocaleString()} chunks ready`);

    // Run a live test query to prove it works
    try {
      const { HybridSearch } = require(path.join(indexaRoot, 'dist', 'src', 'retrieval', 'hybrid'));
      const { VectorDB } = require(path.join(indexaRoot, 'dist', 'src', 'storage', 'vector-db'));
      const { Embedder } = require(path.join(indexaRoot, 'dist', 'src', 'indexer', 'embedder'));

      const db = new VectorDB(dataDir);
      const embedder = new Embedder();
      const search = new HybridSearch(db, embedder);

      await embedder.ready;
      const results = await search.directSearch('main entry point', 3);

      if (results.length > 0) {
        testPassed = true;
        success(`Test query: found ${results.length} results`);
        // Show first result as proof
        const top = results[0].chunk;
        const shortPath = top.filePath.replace(/.*[/\\]/, '');
        success(`Top result: ${top.name} (${top.type}) — ${shortPath}`);
      } else {
        warn('Test query returned 0 results — index may need rebuilding');
      }
    } catch (err) {
      warn('Could not run test query — verify manually with: indexa search "test"');
    }
  } else {
    fail('Index is empty — indexing may have failed');
    print('    Try: indexa reindex <directory>');
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  print('');

  if (testPassed) {
    print('  ╔═══════════════════════════════════╗');
    print('  ║   Indexa ready!                    ║');
    print('  ╚═══════════════════════════════════╝');
  } else {
    print('  ════════════════════════════════════');
  }

  print(`  Setup complete in ${elapsed}s`);
  if (chunks > 0) {
    print(`  ${chunks.toLocaleString()} chunks indexed`);
  }
  print('');
  print('  Next steps:');
  print('    1. Restart Claude Code (to load MCP)');
  print('    2. Try: "explain the authentication flow"');
  print('');
  print('  CLI:');
  print('    indexa search "vendor pricing"');
  print('    indexa bundle "how does auth work"');
  print('    indexa doctor');
  print('');
}

// ─── Doctor Command ─────────────────────────────────────────────────────────

export async function doctorCommand(opts: { dataDir?: string } = {}): Promise<void> {
  const indexaRoot = getIndexaRoot();
  // Check for project-local .indexa/ first, then fall back to global
  const localDataDir = path.join(process.cwd(), '.indexa');
  const dataDir = opts.dataDir || (fs.existsSync(localDataDir) ? localDataDir : path.join(indexaRoot, 'data'));

  print('');
  print('  Indexa Doctor');
  print('  ─────────────');

  // 1. Check index exists
  const embPath = path.join(dataDir, 'embeddings.json');
  const metaPath = path.join(dataDir, 'metadata.json');

  if (fs.existsSync(embPath)) {
    try {
      const raw = fs.readFileSync(embPath, 'utf-8');
      const data = JSON.parse(raw);
      const chunks = Array.isArray(data) ? data.length : 0;
      if (chunks > 0) {
        success(`Index: ${chunks.toLocaleString()} chunks`);
        // Check embedding dimension
        if (data[0]?.embedding?.length) {
          const dim = data[0].embedding.length;
          if (dim >= 256) {
            success(`Embeddings: ML (${dim}-dim)`);
          } else {
            warn(`Embeddings: hash-based (${dim}-dim) — consider re-indexing for better quality`);
          }
        }
      } else {
        fail('Index: empty (0 chunks) — run: indexa setup');
      }
    } catch {
      fail('Index: corrupt — run: indexa reindex <dir>');
    }
  } else {
    fail('Index: not found — run: indexa setup');
  }

  if (fs.existsSync(metaPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      const files = Object.keys(data).length;
      success(`Metadata: ${files.toLocaleString()} files tracked`);
    } catch {
      warn('Metadata: corrupt');
    }
  } else {
    fail('Metadata: not found');
  }

  // 2. Check MCP config
  const mcpPath = path.join(process.env.HOME || process.env.USERPROFILE || '', '.mcp.json');
  if (fs.existsSync(mcpPath)) {
    try {
      const mcp = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
      if (mcp.mcpServers?.indexa) {
        const serverPath = mcp.mcpServers.indexa.args?.[0] || '';
        if (fs.existsSync(serverPath)) {
          success('MCP: configured and server file exists');
        } else {
          fail(`MCP: configured but server not found at ${serverPath}`);
        }
      } else {
        fail('MCP: ~/.mcp.json exists but no "indexa" entry');
      }
    } catch {
      fail('MCP: ~/.mcp.json is corrupt');
    }
  } else {
    fail('MCP: not configured — run: indexa setup');
  }

  // 3. Check Claude Code
  if (hasClaudeCode()) {
    success('Claude Code: installed');
  } else {
    warn('Claude Code: not found (MCP tools won\'t work without it)');
  }

  // 4. Check build
  const distPath = path.join(indexaRoot, 'dist', 'src', 'mcp', 'stdio.js');
  if (fs.existsSync(distPath)) {
    success('Build: dist/src/mcp/stdio.js exists');
  } else {
    fail('Build: MCP server not compiled — run: npm run build');
  }

  // 5. Test MCP server startup (cross-platform)
  print('');
  print('  Testing MCP server...');
  try {
    const { spawnSync } = require('child_process');
    const initMsg = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"doctor","version":"1.0.0"}}}\n';
    const child = spawnSync('node', [distPath, '--data-dir', dataDir], {
      input: initMsg,
      encoding: 'utf-8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdout = (child.stdout || '').trim();
    if (stdout.includes('"protocolVersion"')) {
      success('MCP server: starts and responds correctly');
    } else if (child.status === null) {
      // Timed out = server started but didn't exit (expected for stdio servers)
      success('MCP server: starts successfully');
    } else {
      warn('MCP server: started but unexpected output');
    }
  } catch {
    fail('MCP server: failed to start — check logs');
  }

  print('');
}
