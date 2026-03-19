import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ChunkType, SymbolId } from '../types';

/** Simple logger with levels */
export const logger = {
  info: (msg: string, ...args: unknown[]) => console.log(`[INFO] ${msg}`, ...args),
  warn: (msg: string, ...args: unknown[]) => console.warn(`[WARN] ${msg}`, ...args),
  error: (msg: string, ...args: unknown[]) => console.error(`[ERROR] ${msg}`, ...args),
  debug: (msg: string, ...args: unknown[]) => {
    if (process.env.INDEXA_DEBUG) console.log(`[DEBUG] ${msg}`, ...args);
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

export type QueryIntent = 'symbol_lookup' | 'keyword' | 'hybrid';

/** Detect query intent to route to the best search strategy */
export function detectQueryIntent(query: string): QueryIntent {
  const trimmed = query.trim();

  // Single word that looks like an identifier: camelCase, PascalCase, snake_case, $prefix
  if (/^[\w$]+$/.test(trimmed) && (/[A-Z]/.test(trimmed) || trimmed.includes('_') || trimmed.startsWith('$'))) {
    return 'symbol_lookup';
  }

  // Looks like a symbol ID (contains :: or #)
  if (trimmed.includes('::') || trimmed.includes('#')) {
    return 'symbol_lookup';
  }

  // Short query (1-2 words, no spaces or just one) — keyword is more precise
  const words = trimmed.split(/\s+/);
  if (words.length <= 2 && words.every(w => w.length <= 30)) {
    return 'keyword';
  }

  // Default: hybrid for natural language queries
  return 'hybrid';
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

/** Tokenize text for BM25: split camelCase/snake_case, lowercase, filter short tokens */
export function bm25Tokenize(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase split
    .replace(/[_\-./\\]/g, ' ')           // snake_case / path split
    .toLowerCase()
    .replace(/[^a-z0-9$\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
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
