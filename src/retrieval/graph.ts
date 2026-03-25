import { IndexedChunk, DepGraphNode, ContextBundle, RetrievedSymbol, SearchResult } from '../types';
import { VectorDB } from '../storage/vector-db';
import { readCodeAtOffset, estimateTokens, logger, packByTokenBudget, cosineSimilarity } from '../utils';

/**
 * Dependency graph and relationship analysis.
 * Builds import/dependency edges between indexed symbols.
 */
export class GraphAnalysis {
  private vectorDB: VectorDB;

  constructor(vectorDB: VectorDB) {
    this.vectorDB = vectorDB;
  }

  /** Build dependency graph for a symbol */
  getDependencyGraph(symbolId: string, depth: number = 2): DepGraphNode[] {
    const visited = new Set<string>();
    const nodes: DepGraphNode[] = [];

    this.walkDependencies(symbolId, depth, visited, nodes);
    return nodes;
  }

  /** Find all chunks that import from a given file */
  findImporters(filePath: string): IndexedChunk[] {
    const normalized = filePath.replace(/\\/g, '/');
    const allChunks = this.vectorDB.getAll();

    return allChunks.filter(chunk =>
      chunk.imports.some(imp => {
        const source = imp.source;
        // Match relative imports that could resolve to this file
        return normalized.includes(source.replace(/^\.\//, '').replace(/^\.\.\//, ''))
          || source.includes(filePath.replace(/\.[^.]+$/, ''));
      })
    );
  }

  /** Find symbols that depend on a given symbol name — uses reverse index for O(1) */
  findReferences(symbolName: string): IndexedChunk[] {
    return this.vectorDB.findDependents(symbolName);
  }

  /** Get class hierarchy — find parent/child relationships */
  getClassHierarchy(className: string): { parents: IndexedChunk[]; children: IndexedChunk[] } {
    const allChunks = this.vectorDB.getAll();
    const parents: IndexedChunk[] = [];
    const children: IndexedChunk[] = [];

    // Find the class itself
    const targetClass = allChunks.find(c =>
      c.type === 'class' && c.name.toLowerCase() === className.toLowerCase()
    );

    if (!targetClass) return { parents, children };

    // Look for "extends ClassName" patterns in summaries and names
    for (const chunk of allChunks) {
      if (chunk.type !== 'class') continue;
      if (chunk.id === targetClass.id) continue;

      // Check if chunk extends our target
      if (chunk.dependencies.includes(className)) {
        children.push(chunk);
      }

      // Check if target extends this chunk
      if (targetClass.dependencies.includes(chunk.name)) {
        parents.push(chunk);
      }
    }

    return { parents, children };
  }

  /** Get file outline: all symbols in a file, without code */
  getFileOutline(filePath: string): IndexedChunk[] {
    return this.vectorDB.getByFile(filePath);
  }

  /** Build a context bundle: primary symbols + their imports, deduplicated */
  buildContextBundle(symbolIds: string[], tokenBudget: number = 4000): ContextBundle {
    const symbols: RetrievedSymbol[] = [];
    const importMap = new Map<string, RetrievedSymbol>();
    let totalTokens = 0;

    for (const id of symbolIds) {
      const chunk = this.vectorDB.get(id);
      if (!chunk) continue;

      const code = readCodeAtOffset(chunk.filePath, chunk.byteOffset, chunk.byteLength);
      const sym: RetrievedSymbol = {
        id: chunk.id,
        name: chunk.name,
        type: chunk.type,
        filePath: chunk.filePath,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        code,
        summary: chunk.summary,
      };

      const symTokens = estimateTokens(code) + estimateTokens(chunk.summary);
      if (totalTokens + symTokens > tokenBudget && symbols.length > 0) break;

      symbols.push(sym);
      totalTokens += symTokens;

      // Resolve imports
      for (const imp of chunk.imports) {
        if (importMap.has(imp.name)) continue;

        const importedChunks = this.vectorDB.findByName(imp.name);
        if (importedChunks.length > 0) {
          const importChunk = importedChunks[0];
          const importCode = readCodeAtOffset(
            importChunk.filePath, importChunk.byteOffset, importChunk.byteLength
          );
          const importTokens = estimateTokens(importCode);

          if (totalTokens + importTokens <= tokenBudget) {
            importMap.set(imp.name, {
              id: importChunk.id,
              name: importChunk.name,
              type: importChunk.type,
              filePath: importChunk.filePath,
              startLine: importChunk.startLine,
              endLine: importChunk.endLine,
              code: importCode,
              summary: importChunk.summary,
            });
            totalTokens += importTokens;
          }
        }
      }
    }

    return {
      symbols,
      imports: Array.from(importMap.values()),
      estimatedTokens: totalTokens,
    };
  }

  /**
   * Query-driven context bundle: search → rank → fetch code → pack with deps.
   * This is the PRIMARY tool for LLM consumption.
   */
  buildQueryBundle(
    searchResults: SearchResult[],
    tokenBudget: number = 2000
  ): ContextBundle {
    const symbols: RetrievedSymbol[] = [];
    const importMap = new Map<string, RetrievedSymbol>();
    let totalTokens = 0;

    // Enforce file diversity: max 2 chunks per file to prevent one file from monopolizing results.
    // This ensures the bundle covers multiple files/modules for broader context.
    const MAX_CHUNKS_PER_FILE = 2;
    const fileChunkCount = new Map<string, number>();

    // Pack primary symbols from search results
    for (const result of searchResults) {
      const chunk = result.chunk;

      // Skip if this file already has enough chunks
      const currentCount = fileChunkCount.get(chunk.filePath) || 0;
      if (currentCount >= MAX_CHUNKS_PER_FILE) continue;

      const code = readCodeAtOffset(chunk.filePath, chunk.byteOffset, chunk.byteLength);
      if (!code) continue;

      const symTokens = estimateTokens(code) + estimateTokens(chunk.summary);
      if (totalTokens + symTokens > tokenBudget && symbols.length > 0) break;

      symbols.push({
        id: chunk.id,
        name: chunk.name,
        type: chunk.type,
        filePath: chunk.filePath,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        code,
        summary: chunk.summary,
      });
      totalTokens += symTokens;
      fileChunkCount.set(chunk.filePath, currentCount + 1);

      // Resolve 1-level dependencies within remaining budget.
      // Use signature-only (first line up to {) for deps — saves tokens, LLMs mostly
      // need name/params/return type, not implementation.
      // Prefer deps from the same directory as the source symbol.
      for (const depName of chunk.dependencies.slice(0, 8)) {
        if (importMap.has(depName)) continue;

        const depChunks = this.vectorDB.findByName(depName);
        if (depChunks.length === 0) continue;

        // Pick best match: same file > same dir > any (not arbitrary first match)
        const dep = this.pickBestDep(depChunks, chunk);
        if (dep.id === chunk.id) continue; // skip self

        const fullCode = readCodeAtOffset(dep.filePath, dep.byteOffset, dep.byteLength);
        if (!fullCode) continue;

        // Prune trivial deps: 1-line functions, simple getters/setters, empty stubs
        if (this.isTrivialDep(dep, fullCode)) continue;

        // Use signature-only for deps: first line up to opening brace
        const depCode = this.extractSignature(fullCode) || fullCode;
        const depTokens = estimateTokens(depCode) + estimateTokens(dep.summary);
        if (totalTokens + depTokens > tokenBudget) continue;

        importMap.set(depName, {
          id: dep.id,
          name: dep.name,
          type: dep.type,
          filePath: dep.filePath,
          startLine: dep.startLine,
          endLine: dep.endLine,
          code: depCode,
          summary: dep.summary,
        });
        totalTokens += depTokens;
      }
    }

    // Structure the bundle: entry points first, then core logic, then helpers.
    // This gives LLMs a top-down understanding — main function first, details after.
    const structured = this.structureSymbols(symbols);

    return {
      symbols: structured,
      imports: Array.from(importMap.values()),
      estimatedTokens: totalTokens,
    };
  }

  /** Order symbols for LLM understanding: entry points → core logic → helpers.
   *  Like reading code top-down: start with what matters most. */
  private structureSymbols(symbols: RetrievedSymbol[]): RetrievedSymbol[] {
    const ROLE_ORDER: Record<string, number> = {
      controller: 0, service: 0,
      module: 1, component: 1,
      class: 2, export: 2,
      method: 3, function: 3,
    };

    return [...symbols].sort((a, b) => {
      const roleA = ROLE_ORDER[a.type] ?? 4;
      const roleB = ROLE_ORDER[b.type] ?? 4;
      if (roleA !== roleB) return roleA - roleB;

      // Within same role: _part0 before _part1
      const partA = a.name.match(/_part(\d+)/)?.[1];
      const partB = b.name.match(/_part(\d+)/)?.[1];
      if (partA && partB) return Number(partA) - Number(partB);

      return 0; // preserve search-score order
    });
  }

  /** Check if a dependency is trivial and not worth including in the bundle.
   *  Trivial: 1-3 line functions, simple getters, re-exports, stubs. */
  private isTrivialDep(dep: IndexedChunk, code: string): boolean {
    const lineCount = dep.endLine - dep.startLine;

    // Very short functions (1-3 lines) are usually trivial wrappers
    if (lineCount <= 3) return true;

    // Simple getter pattern: return this.X or return X
    if (lineCount <= 5 && /^\s*(return\s+|get\s+)/.test(code.split('\n')[1]?.trim() || '')) return true;

    // Re-export: just exports something from another module
    if (code.trim().startsWith('export {') || code.trim().startsWith('export *')) return true;

    return false;
  }

  /** Pick the best dependency match: prefer same file > same dir > any */
  private pickBestDep(candidates: IndexedChunk[], source: IndexedChunk): IndexedChunk {
    if (candidates.length === 1) return candidates[0];

    const sourceDir = source.filePath.replace(/\\/g, '/').replace(/\/[^/]+$/, '');

    const scored = candidates.map(c => {
      const cPath = c.filePath.replace(/\\/g, '/');
      let proximity = 0;
      if (cPath === source.filePath) proximity = 3;             // same file
      else if (cPath.replace(/\/[^/]+$/, '') === sourceDir) proximity = 2;  // same dir
      else if (cPath.split('/').slice(0, -2).join('/') === sourceDir.split('/').slice(0, -2).join('/')) proximity = 1; // sibling dir
      return { chunk: c, proximity };
    });

    scored.sort((a, b) => b.proximity - a.proximity);
    return scored[0].chunk;
  }

  /** Extract function/class signature (up to opening brace) for compact dep display */
  private extractSignature(code: string): string | null {
    const braceIdx = code.indexOf('{');
    if (braceIdx > 0 && braceIdx < 500) {
      return code.substring(0, braceIdx).trim();
    }
    // For arrow functions: up to =>
    const arrowIdx = code.indexOf('=>');
    if (arrowIdx > 0 && arrowIdx < 300) {
      return code.substring(0, arrowIdx + 2).trim();
    }
    return null;
  }

  /** Detect circular dependencies between files via import edges.
   *  Uses DFS cycle detection on the file-level import graph. */
  findCircularDependencies(): Array<{ cycle: string[]; files: string[] }> {
    const allChunks = this.vectorDB.getAll();

    // Build file-level import graph: file → set of files it imports from
    const fileImports = new Map<string, Set<string>>();
    const allFiles = new Set<string>();

    for (const chunk of allChunks) {
      const file = chunk.filePath;
      allFiles.add(file);
      if (!fileImports.has(file)) fileImports.set(file, new Set());

      for (const imp of chunk.imports) {
        // Resolve import source to an actual indexed file
        const resolved = this.resolveImportToFile(imp.source, file, allChunks);
        if (resolved && resolved !== file) {
          fileImports.get(file)!.add(resolved);
        }
      }
    }

    // DFS cycle detection
    const cycles: Array<{ cycle: string[]; files: string[] }> = [];
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const stack: string[] = [];
    const seen = new Set<string>(); // dedup cycles

    const dfs = (node: string) => {
      if (inStack.has(node)) {
        // Found a cycle — extract it
        const cycleStart = stack.indexOf(node);
        const cyclePath = stack.slice(cycleStart);
        const key = [...cyclePath].sort().join('|');
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push({
            cycle: [...cyclePath, node], // close the cycle
            files: cyclePath,
          });
        }
        return;
      }
      if (visited.has(node)) return;

      visited.add(node);
      inStack.add(node);
      stack.push(node);

      const deps = fileImports.get(node);
      if (deps) {
        for (const dep of deps) {
          dfs(dep);
        }
      }

      stack.pop();
      inStack.delete(node);
    };

    for (const file of allFiles) {
      if (!visited.has(file)) dfs(file);
    }

    return cycles;
  }

  /** Find exported symbols that are never imported by any other file */
  findUnusedExports(): Array<{ chunk: IndexedChunk; exportedName: string }> {
    const allChunks = this.vectorDB.getAll();
    const unused: Array<{ chunk: IndexedChunk; exportedName: string }> = [];

    // Build set of all imported symbol names across the codebase
    const importedNames = new Set<string>();
    for (const chunk of allChunks) {
      for (const imp of chunk.imports) {
        importedNames.add(imp.name.toLowerCase());
      }
      // Also check dependencies (covers non-import usages)
      for (const dep of chunk.dependencies) {
        importedNames.add(dep.toLowerCase());
      }
    }

    // Find exports that nobody imports
    for (const chunk of allChunks) {
      if (chunk.type !== 'export' && chunk.type !== 'constant' && chunk.type !== 'type') continue;

      const nameLC = chunk.name.toLowerCase();
      // Check if any other chunk imports or depends on this name
      const isUsed = importedNames.has(nameLC) &&
        allChunks.some(c => c.id !== chunk.id && (
          c.imports.some(imp => imp.name.toLowerCase() === nameLC) ||
          c.dependencies.some(dep => dep.toLowerCase() === nameLC)
        ));

      if (!isUsed) {
        unused.push({ chunk, exportedName: chunk.name });
      }
    }

    return unused;
  }

  /** Find duplicate/near-duplicate code using embedding cosine similarity.
   *  Compares all chunk pairs and returns those above the similarity threshold. */
  findDuplicates(threshold: number = 0.92): Array<{
    a: IndexedChunk;
    b: IndexedChunk;
    similarity: number;
  }> {
    const allChunks = this.vectorDB.getAll();
    const duplicates: Array<{ a: IndexedChunk; b: IndexedChunk; similarity: number }> = [];
    const seen = new Set<string>();

    // Skip very small chunks (< 4 lines) — they'll match trivially
    const meaningful = allChunks.filter(c => (c.endLine - c.startLine) >= 4);

    // Cap at 2000 chunks to prevent O(n²) from hanging on large codebases
    // 2000² = 4M comparisons ≈ 2-3 seconds
    const capped = meaningful.slice(0, 2000);
    if (meaningful.length > 2000) {
      logger.info(`Duplicate scan: capped to 2000 chunks (${meaningful.length} total). Sort by size for best coverage.`);
    }

    for (let i = 0; i < capped.length; i++) {
      for (let j = i + 1; j < capped.length; j++) {
        const a = capped[i];
        const b = capped[j];

        // Skip same-file pairs with overlapping lines (same symbol split into parts)
        if (a.filePath === b.filePath) continue;

        // Skip if same name (expected: overloads, test doubles)
        if (a.name === b.name) continue;

        const sim = cosineSimilarity(a.embedding, b.embedding);
        if (sim >= threshold) {
          const key = [a.id, b.id].sort().join('|');
          if (!seen.has(key)) {
            seen.add(key);
            duplicates.push({ a, b, similarity: sim });
          }
        }
      }
    }

    duplicates.sort((x, y) => y.similarity - x.similarity);
    return duplicates.slice(0, 50); // Cap at 50 to avoid noise
  }

  /** Deep impact chain: walk transitive references to configurable depth.
   *  Returns all symbols and files affected if the given symbol changes. */
  getFullImpactChain(symbolName: string, maxDepth: number = 5): {
    directRefs: number;
    totalAffected: number;
    files: string[];
    chain: Array<{ depth: number; name: string; type: string; filePath: string }>;
  } {
    const visited = new Set<string>();
    const affectedFiles = new Set<string>();
    const chain: Array<{ depth: number; name: string; type: string; filePath: string }> = [];

    const walk = (name: string, depth: number) => {
      if (depth > maxDepth || visited.has(name)) return;
      visited.add(name);

      const refs = this.findReferences(name);
      for (const ref of refs) {
        if (ref.name === name) continue; // skip self
        affectedFiles.add(ref.filePath);

        if (!visited.has(ref.name)) {
          chain.push({
            depth,
            name: ref.name,
            type: ref.type,
            filePath: ref.filePath,
          });
          walk(ref.name, depth + 1);
        }
      }
    };

    walk(symbolName, 1);

    const directRefs = this.findReferences(symbolName).filter(r => r.name !== symbolName);

    return {
      directRefs: directRefs.length,
      totalAffected: chain.length,
      files: Array.from(affectedFiles),
      chain,
    };
  }

  /** Resolve an import source string to an actual indexed file path */
  private resolveImportToFile(source: string, fromFile: string, allChunks: IndexedChunk[]): string | null {
    // Skip node_modules/external packages
    if (!source.startsWith('.') && !source.startsWith('/')) return null;

    const fromDir = fromFile.replace(/\\/g, '/').replace(/\/[^/]+$/, '');
    // Normalize the source to a potential path fragment
    const cleaned = source.replace(/^\.\//, '').replace(/^\.\.\//, '../');

    // Try to find a matching indexed file
    const filePaths = new Set(allChunks.map(c => c.filePath));
    for (const fp of filePaths) {
      const normalized = fp.replace(/\\/g, '/');
      if (normalized.includes(cleaned.replace(/\.[^.]+$/, '')) ||
          normalized.endsWith(cleaned) ||
          normalized.endsWith(cleaned + '.ts') ||
          normalized.endsWith(cleaned + '.tsx') ||
          normalized.endsWith(cleaned + '.js')) {
        return fp;
      }
    }
    return null;
  }

  /** Find dead code: symbols with zero inbound references from other symbols.
   *  Skips entry-point types (controllers, modules, exports) that are expected to have no callers. */
  findDeadCode(options?: { includeEntryPoints?: boolean }): Array<{ chunk: IndexedChunk; reason: string }> {
    const allChunks = this.vectorDB.getAll();
    const dead: Array<{ chunk: IndexedChunk; reason: string }> = [];

    // Entry-point types are typically wired by frameworks, not called directly
    const entryTypes = new Set<string>(['controller', 'module', 'component', 'service']);

    for (const chunk of allChunks) {
      // Skip entry points unless explicitly requested
      if (!options?.includeEntryPoints && entryTypes.has(chunk.type)) continue;

      // Skip exports/constants — often config or re-exports
      if (chunk.type === 'export' || chunk.type === 'constant' || chunk.type === 'type') continue;

      const refs = this.findReferences(chunk.name);
      // Filter out self-references
      const externalRefs = refs.filter(r => r.id !== chunk.id);

      if (externalRefs.length === 0) {
        const reason = chunk.type === 'function' ? 'Unused function' :
                       chunk.type === 'method' ? 'Unused method' :
                       chunk.type === 'class' ? 'Unused class' :
                       'No references found';
        dead.push({ chunk, reason });
      }
    }

    return dead;
  }

  /** Estimate blast radius: how many symbols are affected if this symbol changes */
  getBlastRadius(symbolName: string): { directRefs: number; transitiveRefs: number; files: string[] } {
    const directRefs = this.findReferences(symbolName);
    const affectedFiles = new Set<string>();
    const transitiveNames = new Set<string>();

    for (const ref of directRefs) {
      affectedFiles.add(ref.filePath);
      transitiveNames.add(ref.name);
    }

    // One level of transitive references
    for (const name of transitiveNames) {
      const transitive = this.findReferences(name);
      for (const ref of transitive) {
        affectedFiles.add(ref.filePath);
      }
    }

    return {
      directRefs: directRefs.length,
      transitiveRefs: affectedFiles.size,
      files: Array.from(affectedFiles),
    };
  }

  /** Walk dependencies recursively */
  private walkDependencies(
    symbolId: string,
    depth: number,
    visited: Set<string>,
    nodes: DepGraphNode[]
  ): void {
    if (depth <= 0 || visited.has(symbolId)) return;
    visited.add(symbolId);

    const chunk = this.vectorDB.get(symbolId);
    if (!chunk) return;

    const dependsOn: string[] = [];
    const dependedBy: string[] = [];

    // Find what this symbol depends on
    for (const dep of chunk.dependencies) {
      const depChunks = this.vectorDB.findByName(dep);
      for (const dc of depChunks) {
        dependsOn.push(dc.id);
      }
    }

    // Find what depends on this symbol
    const refs = this.findReferences(chunk.name);
    for (const ref of refs) {
      if (ref.id !== symbolId) {
        dependedBy.push(ref.id);
      }
    }

    nodes.push({
      id: chunk.id,
      name: chunk.name,
      type: chunk.type,
      filePath: chunk.filePath,
      imports: chunk.imports,
      dependsOn,
      dependedBy,
    });

    // Recurse into dependencies
    for (const depId of dependsOn) {
      this.walkDependencies(depId, depth - 1, visited, nodes);
    }
  }
}
