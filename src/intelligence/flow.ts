import { IndexedChunk, FlowStep, FlowResult } from '../types';
import { VectorDB } from '../storage/vector-db';
import { HybridSearch } from '../retrieval/hybrid';

/**
 * Flow engine: traces execution paths across functions/files.
 * Given a query or symbol, builds a call-chain graph.
 */
export class FlowEngine {
  private vectorDB: VectorDB;
  private search: HybridSearch;

  constructor(vectorDB: VectorDB, search: HybridSearch) {
    this.vectorDB = vectorDB;
    this.search = search;
  }

  /** Trace execution flow from a query or symbol ID */
  async trace(queryOrId: string, depth: number = 3): Promise<FlowResult> {
    // Resolve the entry symbol
    const entry = await this.resolveEntry(queryOrId);
    if (!entry) {
      return { entry: queryOrId, flow: [] };
    }

    // BFS traversal through call graph
    const visited = new Set<string>();
    const flow: FlowStep[] = [];
    const queue: Array<{ chunk: IndexedChunk; depth: number }> = [{ chunk: entry, depth: 0 }];

    while (queue.length > 0 && flow.length < 15) {
      const current = queue.shift()!;
      if (visited.has(current.chunk.id) || current.depth > depth) continue;
      visited.add(current.chunk.id);

      // Find which indexed symbols this one calls
      const callees = this.resolveCallees(current.chunk);
      const callNames = callees.map(c => c.name);

      flow.push({
        step: flow.length + 1,
        symbolId: current.chunk.id,
        name: current.chunk.name,
        type: current.chunk.type,
        filePath: current.chunk.filePath,
        summary: current.chunk.summary,
        calls: callNames,
      });

      // Enqueue callees for next depth level
      if (current.depth < depth) {
        for (const callee of callees) {
          if (!visited.has(callee.id)) {
            queue.push({ chunk: callee, depth: current.depth + 1 });
          }
        }
      }
    }

    return { entry: entry.name, flow };
  }

  /** Resolve a query string or symbol ID to an IndexedChunk */
  private async resolveEntry(queryOrId: string): Promise<IndexedChunk | null> {
    // Try direct ID lookup
    const direct = this.vectorDB.get(queryOrId);
    if (direct) return direct;

    // Try exact name match
    const byName = this.vectorDB.findByName(queryOrId);
    if (byName.length > 0) {
      // Prefer exact match over partial
      const exact = byName.find(c => c.name.toLowerCase() === queryOrId.toLowerCase());
      if (exact) return exact;
      return byName[0];
    }

    // Fall back to search
    const results = await this.search.directSearch(queryOrId, 3);
    return results.length > 0 ? results[0].chunk : null;
  }

  /** Find indexed symbols that a given chunk calls (via its dependencies) */
  private resolveCallees(chunk: IndexedChunk): IndexedChunk[] {
    const callees: IndexedChunk[] = [];
    const seen = new Set<string>();

    for (const dep of chunk.dependencies) {
      // Skip common non-symbol deps
      if (this.isIgnoredDep(dep)) continue;

      const matches = this.vectorDB.findByName(dep);
      for (const match of matches) {
        if (match.id !== chunk.id && !seen.has(match.id)) {
          seen.add(match.id);
          callees.push(match);
        }
      }
    }

    return callees.slice(0, 8); // Limit fan-out
  }

  /** Filter out noise from dependencies */
  private isIgnoredDep(dep: string): boolean {
    const ignore = [
      'console', 'require', 'module', 'exports', 'Promise',
      'Array', 'Object', 'String', 'Number', 'Boolean', 'Math',
      'JSON', 'Date', 'Error', 'RegExp', 'Map', 'Set',
      'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
      'parseInt', 'parseFloat', 'undefined', 'null', 'true', 'false',
    ];
    return ignore.includes(dep) || dep.length <= 1;
  }
}
