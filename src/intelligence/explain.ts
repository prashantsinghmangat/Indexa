import { ExplainResult, RetrievedSymbol, SymbolConnection, StitchedBundle, SearchResult, ContextBundle } from '../types';
import { GraphAnalysis } from '../retrieval/graph';
import { HybridSearch } from '../retrieval/hybrid';

/**
 * Explanation engine: generates structured explanations from code symbols.
 * No hallucination — only uses retrieved symbol data.
 */
export class ExplainEngine {
  private graph: GraphAnalysis;
  private search: HybridSearch;

  constructor(graph: GraphAnalysis, search: HybridSearch) {
    this.graph = graph;
    this.search = search;
  }

  /** Generate an explanation for a query */
  async explain(query: string, tokenBudget: number = 2000): Promise<ExplainResult> {
    // Get relevant symbols via context bundle
    const results = await this.search.directSearch(query, 10);
    if (results.length === 0) {
      return {
        explanation: `No relevant code found for "${query}".`,
        steps: [],
        symbolsUsed: [],
      };
    }

    const bundle = this.graph.buildQueryBundle(results, tokenBudget);

    // Build explanation from symbol summaries and relationships
    const allSymbols = [...bundle.symbols, ...bundle.imports];
    const symbolsUsed = allSymbols.map(s => ({
      id: s.id,
      name: s.name,
      type: s.type,
      summary: s.summary,
    }));

    const steps = this.buildSteps(bundle.symbols, bundle.imports);
    const explanation = this.buildExplanation(query, bundle.symbols, bundle.imports);

    return { explanation, steps, symbolsUsed };
  }

  /** Build a stitched bundle: context bundle + connections between symbols */
  async stitch(results: SearchResult[], tokenBudget: number = 2000): Promise<StitchedBundle> {
    const bundle = this.graph.buildQueryBundle(results, tokenBudget);
    const connections = this.detectConnections(bundle);
    return { ...bundle, connections };
  }

  /** Detect connections between symbols in a bundle */
  detectConnections(bundle: ContextBundle): SymbolConnection[] {
    const connections: SymbolConnection[] = [];
    const allSymbols = [...bundle.symbols, ...bundle.imports];
    const nameToId = new Map<string, string>();

    for (const sym of allSymbols) {
      nameToId.set(sym.name.toLowerCase(), sym.id);
      // Also map qualified names (e.g., "Class.method" → method)
      const dotParts = sym.name.split('.');
      if (dotParts.length > 1) {
        nameToId.set(dotParts[dotParts.length - 1].toLowerCase(), sym.id);
      }
    }

    for (const sym of bundle.symbols) {
      // Check if this symbol's code calls any other symbol in the bundle
      const codeLower = sym.code.toLowerCase();

      for (const other of allSymbols) {
        if (other.id === sym.id) continue;

        const otherNameLower = other.name.toLowerCase();
        // Check function call pattern: otherName( or otherName.
        if (
          codeLower.includes(`${otherNameLower}(`) ||
          codeLower.includes(`${otherNameLower}.`)
        ) {
          connections.push({ from: sym.name, to: other.name, type: 'calls' });
        }
      }
    }

    // Check import relationships
    for (const imp of bundle.imports) {
      for (const sym of bundle.symbols) {
        const codeLower = sym.code.toLowerCase();
        if (codeLower.includes(imp.name.toLowerCase())) {
          // Avoid duplicate if already a "calls" connection
          const exists = connections.some(c =>
            c.from === sym.name && c.to === imp.name
          );
          if (!exists) {
            connections.push({ from: sym.name, to: imp.name, type: 'depends_on' });
          }
        }
      }
    }

    return connections;
  }

  /** Build human-readable steps from symbols */
  private buildSteps(symbols: RetrievedSymbol[], deps: RetrievedSymbol[]): string[] {
    const steps: string[] = [];

    for (const sym of symbols) {
      const verb = this.inferVerb(sym.name, sym.type);
      const subject = this.inferSubject(sym.name);
      steps.push(`${verb} ${subject} (${sym.type} in ${this.shortPath(sym.filePath)})`);
    }

    if (deps.length > 0) {
      const depNames = deps.map(d => d.name).join(', ');
      steps.push(`Uses dependencies: ${depNames}`);
    }

    return steps;
  }

  /** Build a paragraph explanation from symbols */
  private buildExplanation(
    query: string,
    symbols: RetrievedSymbol[],
    deps: RetrievedSymbol[]
  ): string {
    if (symbols.length === 0) return `No relevant symbols found for "${query}".`;

    const parts: string[] = [];

    // Opening
    parts.push(`This area of the codebase handles ${query.toLowerCase()}.`);

    // Primary symbols
    for (const sym of symbols.slice(0, 5)) {
      const verb = this.inferVerb(sym.name, sym.type);
      const subject = this.inferSubject(sym.name);
      const location = this.shortPath(sym.filePath);

      switch (sym.type) {
        case 'function':
        case 'method':
          parts.push(`\`${sym.name}\` ${verb} ${subject} (${location}).`);
          break;
        case 'class':
          parts.push(`The \`${sym.name}\` class provides ${subject} functionality (${location}).`);
          break;
        case 'component':
          parts.push(`The \`${sym.name}\` component renders the ${subject} UI (${location}).`);
          break;
        case 'service':
          parts.push(`The \`${sym.name}\` service manages ${subject} (${location}).`);
          break;
        case 'controller':
          parts.push(`The \`${sym.name}\` controller handles ${subject} interactions (${location}).`);
          break;
        default:
          parts.push(`\`${sym.name}\` defines ${subject} (${location}).`);
      }
    }

    // Dependencies
    if (deps.length > 0) {
      const depList = deps.slice(0, 3).map(d => `\`${d.name}\``).join(', ');
      parts.push(`Key dependencies include ${depList}.`);
    }

    return parts.join(' ');
  }

  /** Infer a verb from a symbol name */
  private inferVerb(name: string, type: string): string {
    if (/^get[A-Z]|^fetch[A-Z]|^load[A-Z]/.test(name)) return 'retrieves';
    if (/^set[A-Z]|^update[A-Z]/.test(name)) return 'updates';
    if (/^is[A-Z]|^has[A-Z]|^can[A-Z]|^validate[A-Z]|^check[A-Z]/.test(name)) return 'validates';
    if (/^on[A-Z]|^handle[A-Z]/.test(name)) return 'handles';
    if (/^create[A-Z]|^build[A-Z]|^make[A-Z]|^add[A-Z]/.test(name)) return 'creates';
    if (/^delete[A-Z]|^remove[A-Z]/.test(name)) return 'removes';
    if (/^render[A-Z]/.test(name)) return 'renders';
    if (/^save[A-Z]|^store[A-Z]/.test(name)) return 'saves';
    if (/^find[A-Z]|^search[A-Z]|^filter[A-Z]/.test(name)) return 'finds';
    if (/^parse[A-Z]|^transform[A-Z]|^convert[A-Z]/.test(name)) return 'transforms';
    if (/^init|^setup|^configure/.test(name.toLowerCase())) return 'initializes';
    if (type === 'component') return 'renders';
    if (type === 'service') return 'provides';
    if (type === 'controller') return 'manages';
    return 'handles';
  }

  /** Extract a readable subject from a symbol name */
  private inferSubject(name: string): string {
    const stripped = name
      .replace(/^(get|set|is|has|can|should|on|handle|create|update|delete|remove|add|fetch|load|save|parse|validate|check|find|search|filter|sort|format|render|init|setup|configure|register|process|transform|convert|build|make|ensure|resolve|compute|calculate)/i, '')
      .replace(/^[A-Z]/, c => c.toLowerCase());

    // Split camelCase
    const words = stripped
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .toLowerCase()
      .trim();

    return words || name.toLowerCase();
  }

  /** Get just the filename from a full path */
  private shortPath(filePath: string): string {
    const parts = filePath.replace(/\\/g, '/').split('/');
    return parts.slice(-2).join('/');
  }
}
