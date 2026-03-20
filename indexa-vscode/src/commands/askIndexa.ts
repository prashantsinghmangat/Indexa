import * as vscode from 'vscode';
import * as indexa from '../services/indexaClient';
import { showResultPanel } from '../ui/panel';
import { getSelectedText, getSymbolAtCursor } from '../utils/selection';

/** Ask Indexa — main command (Ctrl+Shift+I) */
export async function askIndexaCommand(): Promise<void> {
  const query = await vscode.window.showInputBox({
    prompt: 'Ask Indexa',
    placeHolder: 'e.g., "vendor pricing logic", "how does auth work"',
  });

  if (!query) { return; }

  await runWithProgress('Searching', async () => {
    const result = await indexa.contextBundle(query);
    showResultPanel(query, result.text, result.tokenEstimate, result.sources);
  });
}

/** Explain selected code */
export async function explainCommand(): Promise<void> {
  const selected = getSelectedText();
  if (!selected) {
    vscode.window.showWarningMessage('Select code first, then run Indexa: Explain This');
    return;
  }

  const query = selected.length > 200
    ? selected.substring(0, 200) + '...'
    : selected;

  await runWithProgress('Explaining', async () => {
    const result = await indexa.explain(query);
    showResultPanel('Explain', result.text, result.tokenEstimate, result.sources);
  });
}

/** Show execution flow */
export async function flowCommand(): Promise<void> {
  const symbol = getSymbolAtCursor();
  if (!symbol) {
    vscode.window.showWarningMessage('Select a function/symbol name first');
    return;
  }

  await runWithProgress('Tracing flow', async () => {
    const result = await indexa.flow(symbol);
    showResultPanel(`Flow: ${symbol}`, result.text, result.tokenEstimate, result.sources);
  });
}

/** Find references */
export async function referencesCommand(): Promise<void> {
  const symbol = getSymbolAtCursor();
  if (!symbol) {
    vscode.window.showWarningMessage('Select a symbol name first');
    return;
  }

  await runWithProgress('Finding references', async () => {
    const result = await indexa.references(symbol);
    showResultPanel(`Refs: ${symbol}`, result.text, result.tokenEstimate, result.sources);
  });
}

/** Reindex project */
export async function reindexCommand(): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder open');
    return;
  }

  const dir = workspaceFolder.uri.fsPath;
  const confirm = await vscode.window.showInformationMessage(
    `Reindex ${dir}? This may take a few minutes.`,
    'Yes', 'Cancel'
  );

  if (confirm !== 'Yes') { return; }

  await runWithProgress('Reindexing', async () => {
    try {
      const raw = await fetch(`${getServerUrl()}/api/update`, { method: 'POST' });
      if (raw.ok) {
        const data = await raw.json();
        vscode.window.showInformationMessage(
          `Reindex complete: ${data.updated || 0} files updated, ${data.chunks || 0} chunks`
        );
      }
    } catch {
      vscode.window.showErrorMessage('Reindex failed. Is Indexa server running?');
    }
  });
}

/** Health check */
export async function healthCommand(): Promise<void> {
  const status = await indexa.health();
  vscode.window.showInformationMessage(status);
}

// --- Helpers ---

function getServerUrl(): string {
  return vscode.workspace.getConfiguration('indexa').get('serverUrl', 'http://localhost:3000');
}

async function runWithProgress(label: string, fn: () => Promise<void>): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Indexa: ${label}...`,
      cancellable: false,
    },
    async () => {
      try {
        await fn();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('Cannot connect')) {
          vscode.window.showErrorMessage(
            'Cannot connect to Indexa. Start the server: node dist/cli/index.js serve'
          );
        } else {
          vscode.window.showErrorMessage(`Indexa error: ${msg}`);
        }
      }
    }
  );
}
