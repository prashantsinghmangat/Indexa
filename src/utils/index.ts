import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ChunkType, SymbolId } from '../types';

/** Simple logger with levels.
 *  ALL output goes to stderr so stdout stays clean for MCP JSON-RPC. */
export const logger = {
  info: (msg: string, ...args: unknown[]) => console.error(`[INFO] ${msg}`, ...args),
  warn: (msg: string, ...args: unknown[]) => console.error(`[WARN] ${msg}`, ...args),
  error: (msg: string, ...args: unknown[]) => console.error(`[ERROR] ${msg}`, ...args),
  debug: (msg: string, ...args: unknown[]) => {
    if (process.env.INDEXA_DEBUG) console.error(`[DEBUG] ${msg}`, ...args);
  },
};

// --- Symbol ID ---

/** Create a stable symbol ID: filePath::name#type */
export function makeSymbolId(filePath: string, name: string, type: ChunkType): string {
  const normalized = normalizePath(filePath);
  return `${normalized}::${name}#${type}`;
}

/** Parse a symbol ID back into its components */
export function parseSymbolId(id: string): SymbolId | null {
  const match = id.match(/^(.+)::(.+)#(.+)$/);
  if (!match) return null;
  return { filePath: match[1], name: match[2], type: match[3] as ChunkType };
}

/** Disambiguate overloaded symbol IDs by appending ordinal */
export function disambiguateId(id: string, index: number): string {
  return index === 0 ? id : `${id}~${index}`;
}

// --- Hashing ---

/** Hash file content for change detection */
export function hashFile(filePath: string): string {
  const content = fs.readFileSync(filePath, 'utf-8');
  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
}

/** Hash a string (for content drift detection) */
export function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
}

// --- Code reading via byte offset ---

/** Read code from disk using byte offset + length */
export function readCodeAtOffset(filePath: string, byteOffset: number, byteLength: number): string {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(byteLength);
    fs.readSync(fd, buffer, 0, byteLength, byteOffset);
    fs.closeSync(fd);
    return buffer.toString('utf-8');
  } catch {
    logger.debug(`Failed to read code at offset from ${filePath}`);
    return '';
  }
}

/** Get byte offset and length for a substring in a file */
export function getByteRange(content: string, startLine: number, endLine: number): { byteOffset: number; byteLength: number } {
  const lines = content.split('\n');
  let byteOffset = 0;
  let byteLength = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineBytes = Buffer.byteLength(lines[i], 'utf-8') + 1; // +1 for newline
    if (i + 1 < startLine) {
      byteOffset += lineBytes;
    } else if (i + 1 <= endLine) {
      byteLength += lineBytes;
    }
  }

  return { byteOffset, byteLength };
}

// --- Summaries ---

/** Generate a smart summary from code and metadata */
export function summarizeCode(code: string, name: string, type: string): string {
  const lines = code.split('\n');
  const lineCount = lines.length;

  // Extract signature (first meaningful line)
  let signature = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('/*') && !trimmed.startsWith('*')) {
      signature = trimmed.substring(0, 120);
      break;
    }
  }

  // Extract parameters from function/method signatures
  const paramMatch = signature.match(/\(([^)]*)\)/);
  const params = paramMatch ? paramMatch[1].split(',').map(p => p.trim().split(/[:\s=]/)[0].trim()).filter(Boolean) : [];

  // Extract return type hint
  const returnMatch = signature.match(/\):\s*([^{]+)/);
  const returnType = returnMatch ? returnMatch[1].trim() : '';

  // Detect what the function does from its name
  const purpose = inferPurpose(name, type);

  // Build compact summary
  const parts: string[] = [`${type} ${name}`];
  if (params.length > 0 && params.length <= 4) {
    parts.push(`(${params.join(', ')})`);
  } else if (params.length > 4) {
    parts.push(`(${params.slice(0, 3).join(', ')}, +${params.length - 3} more)`);
  }
  if (returnType && returnType.length < 30) {
    parts.push(`→ ${returnType}`);
  }
  parts.push(`[${lineCount}L]`);
  if (purpose) {
    parts.push(`— ${purpose}`);
  }

  return parts.join(' ');
}

/** Infer purpose from symbol name using common patterns */
function inferPurpose(name: string, type: string): string {
  const lower = name.toLowerCase();
  const baseName = name.replace(/^(get|set|is|has|can|should|will|did|on|handle|create|update|delete|remove|add|fetch|load|save|parse|validate|check|find|search|filter|sort|format|render|init|setup|configure|register|process|transform|convert|build|make|ensure|resolve|compute|calculate)/i, '');

  if (/^get[A-Z]/.test(name)) return `retrieves ${splitCamelCase(baseName)}`;
  if (/^set[A-Z]/.test(name)) return `sets ${splitCamelCase(baseName)}`;
  if (/^is[A-Z]|^has[A-Z]|^can[A-Z]/.test(name)) return `checks ${splitCamelCase(baseName)}`;
  if (/^on[A-Z]|^handle[A-Z]/.test(name)) return `handles ${splitCamelCase(baseName)}`;
  if (/^create[A-Z]|^build[A-Z]|^make[A-Z]/.test(name)) return `creates ${splitCamelCase(baseName)}`;
  if (/^update[A-Z]/.test(name)) return `updates ${splitCamelCase(baseName)}`;
  if (/^delete[A-Z]|^remove[A-Z]/.test(name)) return `removes ${splitCamelCase(baseName)}`;
  if (/^fetch[A-Z]|^load[A-Z]/.test(name)) return `loads ${splitCamelCase(baseName)}`;
  if (/^save[A-Z]/.test(name)) return `saves ${splitCamelCase(baseName)}`;
  if (/^parse[A-Z]/.test(name)) return `parses ${splitCamelCase(baseName)}`;
  if (/^validate[A-Z]|^check[A-Z]/.test(name)) return `validates ${splitCamelCase(baseName)}`;
  if (/^find[A-Z]|^search[A-Z]|^filter[A-Z]/.test(name)) return `finds ${splitCamelCase(baseName)}`;
  if (/^render[A-Z]/.test(name)) return `renders ${splitCamelCase(baseName)}`;
  if (/^init|^setup|^configure/.test(lower)) return `initializes ${splitCamelCase(baseName) || type}`;
  if (/^transform|^convert/.test(lower)) return `transforms ${splitCamelCase(baseName)}`;
  if (type === 'component') return `UI component`;
  if (type === 'controller') return `AngularJS controller`;
  if (type === 'service') return `service provider`;
  return '';
}

/** Split camelCase into lowercase words */
function splitCamelCase(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .trim();
}

// --- Query routing ---

/** Low-level search strategy */
export type SearchStrategy = 'symbol_lookup' | 'keyword' | 'hybrid';

/** High-level semantic intent — what the developer is trying to do */
export type SemanticIntent = 'flow' | 'explain' | 'references' | 'debug' | 'search';

/** Full query classification result */
export interface QueryClassification {
  /** Low-level: how to search */
  strategy: SearchStrategy;
  /** High-level: what the developer wants */
  intent: SemanticIntent;
  /** 0-1 confidence in the intent classification */
  confidence: number;
  /** Extracted subject (the thing being queried about) */
  subject: string;
}

// --- Intent detection patterns ---

const FLOW_PATTERNS = [
  /how\s+does\s+/i,           // "how does auth work"
  /what\s+happens\s+when/i,   // "what happens when user logs in"
  /execution\s+(flow|path)/i, // "execution flow of pricing"
  /call\s+(chain|graph|tree)/i,
  /\bflow\b/i,                // "authentication flow"
  /\bpipeline\b/i,
  /\blifecycle\b/i,
  /\bsequence\b/i,
  /what\s+calls\b/i,          // "what calls getUser"
  /\btrace\b/i,
];

const EXPLAIN_PATTERNS = [
  /explain\b/i,               // "explain vendor pricing"
  /what\s+(is|are)\s+/i,      // "what is ChangeSource"
  /how\s+(is|are)\s+.*\s+(used|implemented|structured)/i,
  /\bpurpose\b/i,
  /\boverview\b/i,
  /\barchitecture\b/i,
  /\bdesign\b/i,
  /why\s+(does|is|do)\s+/i,   // "why does login redirect"
  /what\s+does\s+.*\s+do\b/i, // "what does VendorAuthGuard do"
  /describe\b/i,
];

const REFERENCE_PATTERNS = [
  /where\s+(is|are)\s+.*\s+used/i,    // "where is pricingService used"
  /who\s+(uses|calls|imports)/i,       // "who calls getVendorRates"
  /\bused\s+by\b/i,
  /\bdepends\s+on\b/i,
  /\bimported\s+by\b/i,
  /\breferences?\s+to\b/i,
  /what\s+(uses|depends|imports)/i,    // "what uses ErrorBoundary"
  /\bblast\s*radius\b/i,
  /\bimpact\b/i,
];

const DEBUG_PATTERNS = [
  /\bfix\b/i,                 // "fix login bug"
  /\bbug\b/i,
  /\berror\b.*\b(in|on|at)\b/i,  // "error in auth handler"
  /\bfail(s|ing|ed)?\b/i,    // "login failing on token"
  /\bbroken\b/i,
  /\bnot\s+working\b/i,
  /\bcrash(es|ing)?\b/i,
  /\bissue\b/i,
  /why\s+(is|does).*\b(fail|break|crash|error)/i,
  /\bdebug\b/i,
  /\btroubleshoot\b/i,
];

/** Classify a query into search strategy + semantic intent */
export function classifyQuery(query: string): QueryClassification {
  const trimmed = query.trim();
  const lower = trimmed.toLowerCase();

  // --- Detect search strategy (how to search) ---
  let strategy: SearchStrategy = 'hybrid';

  // Symbol ID (contains :: or #)
  if (trimmed.includes('::') || trimmed.includes('#')) {
    strategy = 'symbol_lookup';
  }
  // Single identifier: camelCase, PascalCase, snake_case, $prefix
  else if (/^[\w$]+$/.test(trimmed) && (/[A-Z]/.test(trimmed) || trimmed.includes('_') || trimmed.startsWith('$'))) {
    strategy = 'symbol_lookup';
  }
  // Single short word → keyword
  else if (trimmed.split(/\s+/).length === 1 && trimmed.length <= 30) {
    strategy = 'keyword';
  }

  // --- Detect semantic intent (what the developer wants) ---
  const intentScores: Record<SemanticIntent, number> = {
    flow: 0, explain: 0, references: 0, debug: 0, search: 0,
  };

  for (const p of FLOW_PATTERNS) { if (p.test(lower)) intentScores.flow += 1; }
  for (const p of EXPLAIN_PATTERNS) { if (p.test(lower)) intentScores.explain += 1; }
  for (const p of REFERENCE_PATTERNS) { if (p.test(lower)) intentScores.references += 1; }
  for (const p of DEBUG_PATTERNS) { if (p.test(lower)) intentScores.debug += 1; }

  // Find the best-scoring intent
  let bestIntent: SemanticIntent = 'search';
  let bestScore = 0;
  for (const [intent, score] of Object.entries(intentScores)) {
    if (score > bestScore) {
      bestScore = score;
      bestIntent = intent as SemanticIntent;
    }
  }

  // Confidence: normalize by max possible matches for that intent type
  const maxPatterns = Math.max(FLOW_PATTERNS.length, EXPLAIN_PATTERNS.length, REFERENCE_PATTERNS.length, DEBUG_PATTERNS.length);
  const confidence = bestScore > 0 ? Math.min(bestScore / 2, 1.0) : 0;

  // Extract subject: strip intent keywords to isolate what's being queried
  const subject = extractSubject(trimmed);

  return { strategy, intent: bestIntent, confidence, subject };
}

/** Extract the subject (the "thing" being queried) by stripping intent keywords */
function extractSubject(query: string): string {
  return query
    .replace(/^(how\s+does|how\s+is|what\s+(is|are|does|calls|uses|depends\s+on)|where\s+(is|are)|who\s+(uses|calls|imports)|explain|describe|fix|debug|trace|why\s+(is|does))\s+/i, '')
    .replace(/\s+(work(s|ing)?|used|implemented|called|imported|do|flow|logic|system|module|failing|broken|not\s+working)$/i, '')
    .replace(/\?+$/, '')
    .trim();
}

/** Legacy compat: map to old QueryIntent type */
export type QueryIntent = SearchStrategy;

/** Legacy compat: returns just the search strategy */
export function detectQueryIntent(query: string): QueryIntent {
  return classifyQuery(query).strategy;
}

// --- Token estimation ---

/** Estimate token count for a string (rough: ~4 chars per token) */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Pack results into a token budget, greedy */
export function packByTokenBudget<T>(
  items: T[],
  getTokens: (item: T) => number,
  budget: number
): T[] {
  const packed: T[] = [];
  let used = 0;
  for (const item of items) {
    const tokens = getTokens(item);
    if (used + tokens > budget && packed.length > 0) break;
    packed.push(item);
    used += tokens;
  }
  return packed;
}

// --- Cosine similarity ---

/** Cosine similarity between two vectors */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

// --- BM25 ---

/** BM25 scoring parameters */
const BM25_K1 = 1.5;
const BM25_B = 0.75;

/** Stop words for BM25 — ONLY true English stop words.
 *  Code-relevant terms (error, data, get, set, function, class, etc.) are kept
 *  because they carry real signal in code search. "error handling" should NOT
 *  become just "handling". */
const STOP_WORDS = new Set([
  'the', 'is', 'at', 'which', 'on', 'in', 'for', 'to', 'of', 'and', 'or',
  'it', 'an', 'as', 'by', 'be', 'this', 'that', 'from', 'with', 'are',
  'was', 'were', 'been', 'has', 'have', 'had', 'do', 'does', 'did', 'not',
  'but', 'if', 'no', 'so', 'up', 'out', 'about', 'into', 'can', 'will',
  'all', 'how', 'what', 'when', 'where', 'why', 'who',
  // Only JS keywords that are literally never symbol names
  'const', 'let', 'var', 'default', 'return', 'typeof', 'instanceof',
]);

/** Tokenize text for BM25: split camelCase/snake_case, lowercase, filter stop words */
export function bm25Tokenize(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase split
    .replace(/[_\-./\\]/g, ' ')           // snake_case / path split
    .toLowerCase()
    .replace(/[^a-z0-9$\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t));
}

/** Compute BM25 score for a document against query terms */
export function bm25Score(
  docTokens: string[],
  queryTokens: string[],
  avgDocLength: number,
  docFrequencies: Map<string, number>,
  totalDocs: number
): number {
  const docLength = docTokens.length;
  const termFreq = new Map<string, number>();

  for (const token of docTokens) {
    termFreq.set(token, (termFreq.get(token) || 0) + 1);
  }

  let score = 0;
  for (const term of queryTokens) {
    const tf = termFreq.get(term) || 0;
    if (tf === 0) continue;

    const df = docFrequencies.get(term) || 0;
    const idf = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1);

    const tfNorm = (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * (docLength / avgDocLength)));
    score += idf * tfNorm;
  }

  return score;
}

// --- File operations ---

/** Recursively find files matching patterns */
export function findFiles(dir: string, include: string[], exclude: string[]): string[] {
  const results: string[] = [];

  function walk(currentDir: string) {
    if (!fs.existsSync(currentDir)) return;

    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = path.relative(dir, fullPath);

      if (exclude.some(pattern => {
        if (pattern.startsWith('*')) return entry.name.endsWith(pattern.slice(1));
        return relativePath.includes(pattern) || entry.name === pattern;
      })) {
        continue;
      }

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const matches = include.some(pattern => {
          if (pattern.startsWith('*')) return entry.name.endsWith(pattern.slice(1));
          return entry.name === pattern;
        });
        if (matches) {
          results.push(fullPath);
        }
      }
    }
  }

  walk(dir);
  return results;
}

/** Ensure directory exists */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/** Normalize a file path for consistent storage */
export function normalizePath(filePath: string): string {
  return path.normalize(filePath).replace(/\\/g, '/');
}

// --- Atomic file writes ---

/** Write JSON data atomically: write to temp file, then rename */
export function atomicWriteJSON(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  ensureDir(dir);

  const tmpPath = path.join(dir, `.tmp_${Date.now()}_${process.pid}`);
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data));
    // On Windows, fs.renameSync fails if target exists — remove first
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    // Clean up temp file on failure
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}
