import { IndexedChunk, DepGraphNode, ContextBundle, RetrievedSymbol, SearchResult } from '../types';
import { VectorDB } from '../storage/vector-db';
import { readCodeAtOffset, estimateTokens, logger, packByTokenBudget } from '../utils';

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

  /** Find symbols that depend on a given symbol name */
  findReferences(symbolName: string): IndexedChunk[] {
    const lower = symbolName.toLowerCase();
    const allChunks = this.vectorDB.getAll();

    return allChunks.filter(chunk => {
      // Check if this chunk's dependencies reference the symbol
      return chunk.dependencies.some(dep => dep.toLowerCase().includes(lower))
        || chunk.imports.some(imp => imp.name.toLowerCase().includes(lower));
    });
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
