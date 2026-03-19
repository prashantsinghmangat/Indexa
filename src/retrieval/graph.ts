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

    // Pack primary symbols from search results
    for (const result of searchResults) {
      const chunk = result.chunk;
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

      // Resolve 1-level dependencies within remaining budget
      for (const depName of chunk.dependencies.slice(0, 5)) {
        if (importMap.has(depName)) continue;

        const depChunks = this.vectorDB.findByName(depName);
        if (depChunks.length === 0) continue;

        const dep = depChunks[0];
        if (dep.id === chunk.id) continue; // skip self

        const depCode = readCodeAtOffset(dep.filePath, dep.byteOffset, dep.byteLength);
        if (!depCode) continue;

        const depTokens = estimateTokens(depCode);
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

    return {
      symbols,
      imports: Array.from(importMap.values()),
      estimatedTokens: totalTokens,
    };
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
