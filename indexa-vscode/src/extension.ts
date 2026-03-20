import * as vscode from 'vscode';
import {
  askIndexaCommand,
  explainCommand,
  flowCommand,
  referencesCommand,
  reindexCommand,
  healthCommand,
} from './commands/askIndexa';
import { health } from './services/indexaClient';

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext): void {
  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('indexa.ask', askIndexaCommand),
    vscode.commands.registerCommand('indexa.explain', explainCommand),
    vscode.commands.registerCommand('indexa.flow', flowCommand),
    vscode.commands.registerCommand('indexa.references', referencesCommand),
    vscode.commands.registerCommand('indexa.reindex', reindexCommand),
    vscode.commands.registerCommand('indexa.health', healthCommand),
  );

  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'indexa.health';
  statusBarItem.tooltip = 'Click for Indexa health check';
  context.subscriptions.push(statusBarItem);

  // Update status bar on activation and periodically
  updateStatusBar();
  const interval = setInterval(updateStatusBar, 60000); // every minute
  context.subscriptions.push({ dispose: () => clearInterval(interval) });
}

async function updateStatusBar(): Promise<void> {
  try {
    const status = await health();
    statusBarItem.text = `$(search) ${status}`;
    statusBarItem.show();
  } catch {
    statusBarItem.text = '$(search) Indexa: Offline';
    statusBarItem.show();
  }
}

export function deactivate(): void {
  // cleanup
}
