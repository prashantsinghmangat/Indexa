import * as vscode from 'vscode';
import * as indexa from '../services/indexaClient';

// ─── Type → Icon mapping ────────────────────────────────────────────────────

const TYPE_ICONS: Record<string, string> = {
  function: 'symbol-function',
  component: 'symbol-class',
  class: 'symbol-class',
  method: 'symbol-method',
  export: 'symbol-variable',
  service: 'symbol-interface',
  controller: 'symbol-event',
  module: 'symbol-namespace',
  hook: 'symbol-property',
};

function iconForType(type?: string): vscode.ThemeIcon {
  const key = (type || '').toLowerCase();
  return new vscode.ThemeIcon(TYPE_ICONS[key] || 'symbol-misc');
}

function typeLabel(type?: string): string {
  if (!type) return '';
  const t = type.toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// ─── Tree Node ───────────────────────────────────────────────────────────────

type NodeKind = 'symbol' | 'flow-step' | 'connection' | 'section' | 'info' | 'example' | 'action' | 'loading' | 'error';

export class IndexaTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly kind: NodeKind,
    opts?: {
      filePath?: string;
      line?: number;
      children?: IndexaTreeItem[];
      detail?: string;
      symbolType?: string;
      collapsed?: boolean;
    },
  ) {
    const hasKids = opts?.children && opts.children.length > 0;
    super(
      label,
      hasKids
        ? (opts?.collapsed ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded)
        : vscode.TreeItemCollapsibleState.None
    );

    this.description = opts?.detail || '';
    this._children = opts?.children;

    // Icons
    switch (kind) {
      case 'symbol':
        this.iconPath = iconForType(opts?.symbolType);
        break;
      case 'flow-step':
        this.iconPath = new vscode.ThemeIcon('debug-step-into');
        break;
      case 'connection':
        this.iconPath = new vscode.ThemeIcon('git-merge');
        break;
      case 'section':
        this.iconPath = new vscode.ThemeIcon('list-tree');
        break;
      case 'info':
        this.iconPath = new vscode.ThemeIcon('info');
        break;
      case 'loading':
        this.iconPath = new vscode.ThemeIcon('sync~spin');
        break;
      case 'error':
        this.iconPath = new vscode.ThemeIcon('error');
        break;
      case 'example':
        this.iconPath = new vscode.ThemeIcon('play');
        this.command = {
          command: 'indexa.runExample',
          title: 'Run',
          arguments: [label.replace(/^"|"$/g, '')],
        };
        break;
      case 'action':
        this.iconPath = new vscode.ThemeIcon('rocket');
        break;
    }

    // Click-to-navigate for file results
    if (opts?.filePath && opts?.line !== undefined && kind !== 'example') {
      this.command = {
        command: 'indexa.openAtLine',
        title: 'Open',
        arguments: [opts.filePath, opts.line],
      };
      this.tooltip = `Click to open ${shortPath(opts.filePath)}:${opts.line}`;
    } else if (opts?.detail) {
      this.tooltip = opts.detail;
    }
  }

  private _children?: IndexaTreeItem[];
  getChildren(): IndexaTreeItem[] { return this._children || []; }
}

// ─── Sidebar Provider ────────────────────────────────────────────────────────

export class IndexaSidebarProvider implements vscode.TreeDataProvider<IndexaTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<IndexaTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private items: IndexaTreeItem[] = [];

  constructor() {
    this.showWelcome();
  }

  getTreeItem(el: IndexaTreeItem): vscode.TreeItem { return el; }
  getChildren(el?: IndexaTreeItem): IndexaTreeItem[] {
    return el ? el.getChildren() : this.items;
  }

  // ─── Welcome / Onboarding ────────────────────────────────────────────

  showWelcome(): void {
    this.items = [
      new IndexaTreeItem('Welcome to Indexa', 'info', {
        detail: 'Code intelligence for AI',
      }),
      new IndexaTreeItem('Ctrl+Shift+I to search', 'action', {
        detail: 'or click an example below',
      }),
      new IndexaTreeItem('', 'info'),

      // Example queries — grouped by intent
      new IndexaTreeItem('Understand Code', 'section', {
        children: [
          new IndexaTreeItem('"explain the theme system"', 'example'),
          new IndexaTreeItem('"how does the navbar work"', 'example'),
          new IndexaTreeItem('"what components are in this project"', 'example'),
        ],
      }),
      new IndexaTreeItem('Trace Execution', 'section', {
        children: [
          new IndexaTreeItem('"trace HeroSection"', 'example'),
          new IndexaTreeItem('"flow of ContactSection"', 'example'),
        ],
        collapsed: true,
      }),
      new IndexaTreeItem('Find Usages', 'section', {
        children: [
          new IndexaTreeItem('"where is useUIStore used"', 'example'),
          new IndexaTreeItem('"references to SectionReveal"', 'example'),
        ],
        collapsed: true,
      }),
    ];
    this._onDidChangeTreeData.fire(undefined);
  }

  // ─── Context Bundle ──────────────────────────────────────────────────

  async showContextBundle(query: string): Promise<void> {
    this.setLoading(query);

    try {
      const raw = await indexa.contextBundleRaw(query);
      const nodes: IndexaTreeItem[] = [];

      const symbolCount = raw.symbols?.length || 0;
      const tokens = raw.estimatedTokens || 0;

      // Header with stats
      nodes.push(new IndexaTreeItem(
        `"${query}"`,
        'section',
        { detail: `${symbolCount} symbols · ~${tokens} tokens` }
      ));

      // No results
      if (symbolCount === 0) {
        nodes.push(new IndexaTreeItem('No results found', 'info', {
          detail: 'Try a different query',
        }));
        this.items = nodes;
        this._onDidChangeTreeData.fire(undefined);
        return;
      }

      // Symbols — type-aware icons + labels
      for (const sym of raw.symbols) {
        const sf = shortPath(sym.filePath);
        nodes.push(new IndexaTreeItem(
          sym.name,
          'symbol',
          {
            filePath: sym.filePath,
            line: sym.startLine,
            symbolType: sym.type,
            detail: `${typeLabel(sym.type)} · ${sf}:${sym.startLine}`,
            children: sym.summary ? [
              new IndexaTreeItem(sym.summary, 'info'),
            ] : undefined,
          }
        ));
      }

      // Dependencies
      if (raw.dependencies?.length > 0) {
        nodes.push(new IndexaTreeItem(
          `Dependencies (${raw.dependencies.length})`,
          'section',
          {
            collapsed: true,
            children: raw.dependencies.map((dep: any) =>
              new IndexaTreeItem(dep.name, 'symbol', {
                filePath: dep.filePath,
                line: dep.startLine,
                symbolType: dep.type,
                detail: `${typeLabel(dep.type)} · ${shortPath(dep.filePath)}:${dep.startLine}`,
              })
            ),
          }
        ));
      }

      // Connections
      if (raw.connections?.length > 0) {
        const unique = new Set<string>();
        const connItems = raw.connections
          .filter((c: any) => {
            const key = `${c.from}→${c.to}`;
            if (unique.has(key)) return false;
            unique.add(key);
            return true;
          })
          .slice(0, 12)
          .map((c: any) => new IndexaTreeItem(
            `${c.from} → ${c.to}`,
            'connection',
            { detail: c.type }
          ));

        nodes.push(new IndexaTreeItem(
          `Connections (${connItems.length})`,
          'section',
          { collapsed: true, children: connItems }
        ));
      }

      this.items = nodes;
    } catch (err) {
      this.showError(err);
    }

    this._onDidChangeTreeData.fire(undefined);
  }

  // ─── Flow Tracing ────────────────────────────────────────────────────

  async showFlow(query: string): Promise<void> {
    this.setLoading(query);

    try {
      const raw = await indexa.flowRaw(query);
      const nodes: IndexaTreeItem[] = [];

      const stepCount = raw.flow?.length || 0;
      nodes.push(new IndexaTreeItem(
        `Flow: ${raw.entry || query}`,
        'section',
        { detail: `${stepCount} steps` }
      ));

      if (stepCount > 0) {
        for (const step of raw.flow) {
          const children: IndexaTreeItem[] = [];

          if (step.summary) {
            children.push(new IndexaTreeItem(step.summary, 'info'));
          }
          if (step.calls?.length > 0) {
            children.push(new IndexaTreeItem(
              `Calls: ${step.calls.join(', ')}`,
              'connection'
            ));
          }

          nodes.push(new IndexaTreeItem(
            `${step.step}. ${step.name}`,
            'flow-step',
            {
              filePath: step.filePath,
              line: step.startLine,
              symbolType: step.type,
              detail: `${typeLabel(step.type)} · ${shortPath(step.filePath)}`,
              children: children.length > 0 ? children : undefined,
            }
          ));
        }
      } else {
        nodes.push(new IndexaTreeItem('No flow found for this query', 'info', {
          detail: 'Try a specific function or component name',
        }));
      }

      this.items = nodes;
    } catch (err) {
      this.showError(err);
    }

    this._onDidChangeTreeData.fire(undefined);
  }

  // ─── References ──────────────────────────────────────────────────────

  async showReferences(symbolName: string): Promise<void> {
    this.setLoading(symbolName);

    try {
      const raw = await indexa.referencesRaw(symbolName);
      const refs = raw.references || [];
      const nodes: IndexaTreeItem[] = [];

      nodes.push(new IndexaTreeItem(
        `References: "${symbolName}"`,
        'section',
        { detail: `${refs.length} found · ${raw.blastRadius || '?'} files affected` }
      ));

      if (refs.length === 0) {
        nodes.push(new IndexaTreeItem('No references found', 'info'));
      }

      for (const ref of refs.slice(0, 30)) {
        nodes.push(new IndexaTreeItem(
          ref.name,
          'symbol',
          {
            filePath: ref.filePath,
            line: ref.startLine,
            symbolType: ref.type,
            detail: `${typeLabel(ref.type)} · ${shortPath(ref.filePath)}:${ref.startLine}`,
          }
        ));
      }

      if (refs.length > 30) {
        nodes.push(new IndexaTreeItem(`+${refs.length - 30} more`, 'info'));
      }

      this.items = nodes;
    } catch (err) {
      this.showError(err);
    }

    this._onDidChangeTreeData.fire(undefined);
  }

  // ─── States ──────────────────────────────────────────────────────────

  private setLoading(query: string): void {
    this.items = [
      new IndexaTreeItem(`Searching: "${query}"`, 'loading', {
        detail: 'Fetching results...',
      }),
    ];
    this._onDidChangeTreeData.fire(undefined);
  }

  private showError(err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    const isConnection = msg.includes('Cannot connect') || msg.includes('ECONNREFUSED');

    this.items = [
      new IndexaTreeItem(
        isConnection ? 'Server not running' : 'Something went wrong',
        'error',
        { detail: isConnection ? 'Start: npx indexa-mcp serve' : msg }
      ),
    ];

    if (isConnection) {
      this.items.push(new IndexaTreeItem(
        'Run: npx indexa-mcp setup',
        'action',
        { detail: 'Indexes your project and starts the server' }
      ));
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function shortPath(filePath: string): string {
  const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (wsFolder) {
    const normalized = filePath.replace(/\\/g, '/');
    const wsNormalized = wsFolder.replace(/\\/g, '/');
    if (normalized.startsWith(wsNormalized)) {
      return normalized.substring(wsNormalized.length + 1);
    }
  }
  return filePath.replace(/^.*?[/\\]src[/\\]/, 'src/').replace(/\\/g, '/');
}
