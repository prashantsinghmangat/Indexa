import * as vscode from 'vscode';

/**
 * Provides "Fix with Indexa" code actions when errors are detected.
 * Shows a lightbulb on error lines that triggers the full Indexa fix flow.
 */
export class IndexaCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    // Only suggest for errors and warnings
    const diagnostics = context.diagnostics.filter(
      d => d.severity === vscode.DiagnosticSeverity.Error || d.severity === vscode.DiagnosticSeverity.Warning
    );

    if (diagnostics.length === 0) return [];

    const action = new vscode.CodeAction(
      `Fix with Indexa (${diagnostics.length} issue${diagnostics.length > 1 ? 's' : ''})`,
      vscode.CodeActionKind.QuickFix
    );

    action.command = {
      command: 'indexa.fixThis',
      title: 'Fix with Indexa',
    };

    action.diagnostics = diagnostics;
    action.isPreferred = false; // Don't override the user's preferred fix

    return [action];
  }
}

/** Register the code action provider for all supported languages */
export function registerDiagnosticWatcher(context: vscode.ExtensionContext): void {
  const languages = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'];

  for (const lang of languages) {
    context.subscriptions.push(
      vscode.languages.registerCodeActionsProvider(
        { language: lang, scheme: 'file' },
        new IndexaCodeActionProvider(),
        { providedCodeActionKinds: IndexaCodeActionProvider.providedCodeActionKinds }
      )
    );
  }
}
