import * as vscode from 'vscode';
import {
  askIndexaCommand,
  explainCommand,
  flowCommand,
  referencesCommand,
  reindexCommand,
  healthCommand,
} from './commands/askIndexa';
import { health, reindexFile } from './services/indexaClient';
import { ensureServer, stopServer } from './services/serverManager';
import { IndexaSidebarProvider } from './ui/sidebarProvider';
import { copyForAI, openForCopilot } from './services/aiBridge';
import {
  explainSelectionCommand,
  fixThisCommand,
  whatCallsThisCommand,
  refactorThisCommand,
  generateTestsCommand,
} from './commands/inlineAI';
import { registerDiagnosticWatcher } from './services/diagnosticWatcher';

let statusBarItem: vscode.StatusBarItem;
let sidebarProvider: IndexaSidebarProvider;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // ─── Sidebar TreeView ────────────────────────────────────────────────
  sidebarProvider = new IndexaSidebarProvider();
  const treeView = vscode.window.createTreeView('indexaSidebar', {
    treeDataProvider: sidebarProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // ─── Commands ────────────────────────────────────────────────────────

  // Main search → sidebar
  context.subscriptions.push(
    vscode.commands.registerCommand('indexa.ask', async () => {
      const query = await vscode.window.showInputBox({
        prompt: 'Ask Indexa',
        placeHolder: 'e.g., "how does auth work", "trace handleLogin"',
      });
      if (!query) return;
      await sidebarProvider.showContextBundle(query);
      // Ensure sidebar is visible
      vscode.commands.executeCommand('indexaSidebar.focus');
    }),
  );

  // Sidebar-specific: search from sidebar input
  context.subscriptions.push(
    vscode.commands.registerCommand('indexa.sidebarSearch', async () => {
      const query = await vscode.window.showInputBox({
        prompt: 'Ask Indexa',
        placeHolder: 'e.g., "explain the theme system"',
      });
      if (!query) return;
      await sidebarProvider.showContextBundle(query);
    }),
  );

  // Flow → sidebar
  context.subscriptions.push(
    vscode.commands.registerCommand('indexa.sidebarFlow', async () => {
      const { getSymbolAtCursor } = await import('./utils/selection');
      const symbol = getSymbolAtCursor() || await vscode.window.showInputBox({
        prompt: 'Symbol to trace',
        placeHolder: 'e.g., handleLogin, VendorAuthGuard',
      });
      if (!symbol) return;
      await sidebarProvider.showFlow(symbol);
      vscode.commands.executeCommand('indexaSidebar.focus');
    }),
  );

  // References → sidebar
  context.subscriptions.push(
    vscode.commands.registerCommand('indexa.sidebarReferences', async () => {
      const { getSymbolAtCursor } = await import('./utils/selection');
      const symbol = getSymbolAtCursor() || await vscode.window.showInputBox({
        prompt: 'Symbol to find references for',
        placeHolder: 'e.g., UserService, handleLogin',
      });
      if (!symbol) return;
      await sidebarProvider.showReferences(symbol);
      vscode.commands.executeCommand('indexaSidebar.focus');
    }),
  );

  // Run example query from welcome screen
  context.subscriptions.push(
    vscode.commands.registerCommand('indexa.runExample', async (query: string) => {
      await sidebarProvider.showContextBundle(query);
    }),
  );

  // Open file at specific line (used by tree item clicks)
  context.subscriptions.push(
    vscode.commands.registerCommand('indexa.openAtLine', async (filePath: string, line: number) => {
      try {
        const uri = vscode.Uri.file(filePath);
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
        const position = new vscode.Position(Math.max(0, line - 1), 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(
          new vscode.Range(position, position),
          vscode.TextEditorRevealType.InCenter
        );
      } catch {
        vscode.window.showErrorMessage(`Cannot open: ${filePath}:${line}`);
      }
    }),
  );

  // ─── Inline AI Commands (the magic flow) ────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('indexa.explainSelection', explainSelectionCommand),
    vscode.commands.registerCommand('indexa.fixThis', fixThisCommand),
    vscode.commands.registerCommand('indexa.whatCallsThis', whatCallsThisCommand),
    vscode.commands.registerCommand('indexa.refactorThis', refactorThisCommand),
    vscode.commands.registerCommand('indexa.generateTests', generateTestsCommand),
  );

  // ─── AI Bridge Commands (clipboard fallback) ──────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('indexa.copyForAI', () => copyForAI()),
    vscode.commands.registerCommand('indexa.fixBug', () => copyForAI('fix')),
    vscode.commands.registerCommand('indexa.openForCopilot', () => openForCopilot()),
  );

  // Legacy commands (still work via command palette / webview)
  context.subscriptions.push(
    vscode.commands.registerCommand('indexa.explain', explainCommand),
    vscode.commands.registerCommand('indexa.flow', flowCommand),
    vscode.commands.registerCommand('indexa.references', referencesCommand),
    vscode.commands.registerCommand('indexa.reindex', reindexCommand),
    vscode.commands.registerCommand('indexa.health', healthCommand),
  );

  // ─── Status Bar ──────────────────────────────────────────────────────
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'indexa.health';
  statusBarItem.tooltip = 'Indexa — click for health check';
  context.subscriptions.push(statusBarItem);

  // ─── Auto-start Server ───────────────────────────────────────────────
  statusBarItem.text = '$(sync~spin) Indexa: Starting...';
  statusBarItem.show();

  const serverOk = await ensureServer();
  if (serverOk) {
    updateStatusBar();
  } else {
    statusBarItem.text = '$(warning) Indexa: Offline';
    statusBarItem.tooltip = 'Indexa server not running. Click to retry.';
  }

  // ─── Diagnostic Integration (lightbulb "Fix with Indexa") ───────────
  registerDiagnosticWatcher(context);

  // ─── Auto-index on Save ──────────────────────────────────────────────
  const autoIndex = vscode.workspace.getConfiguration('indexa').get('autoIndexOnSave', true);
  if (autoIndex) {
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    const watcher = vscode.workspace.onDidSaveTextDocument((doc) => {
      const ext = doc.fileName.split('.').pop()?.toLowerCase();
      if (!ext || !['ts', 'tsx', 'js', 'jsx'].includes(ext)) return;
      // Skip node_modules and dist
      if (doc.fileName.includes('node_modules') || doc.fileName.includes('/dist/')) return;

      // Debounce: wait 2s after last save before triggering re-index
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        reindexFile(doc.fileName);
      }, 2000);
    });
    context.subscriptions.push(watcher);
  }

  // Periodic status bar update
  const interval = setInterval(updateStatusBar, 60000);
  context.subscriptions.push({ dispose: () => clearInterval(interval) });
}

async function updateStatusBar(): Promise<void> {
  try {
    const status = await health();
    statusBarItem.text = `$(search) ${status}`;
    statusBarItem.show();
  } catch {
    statusBarItem.text = '$(warning) Indexa: Offline';
    statusBarItem.show();
  }
}

export function deactivate(): void {
  stopServer();
}
