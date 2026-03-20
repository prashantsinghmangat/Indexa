import * as vscode from 'vscode';

/** Get the selected text from the active editor */
export function getSelectedText(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { return undefined; }

  const selection = editor.selection;
  if (selection.isEmpty) { return undefined; }

  return editor.document.getText(selection);
}

/** Get the function/symbol name at cursor or from selection */
export function getSymbolAtCursor(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { return undefined; }

  // If there's a selection, use it
  const selected = getSelectedText();
  if (selected) {
    // Extract just the function/symbol name from selection
    const match = selected.match(/(?:function|class|const|let|var|export)\s+(\w+)/);
    return match ? match[1] : selected.trim().split('\n')[0].substring(0, 80);
  }

  // Otherwise get the word at cursor
  const position = editor.selection.active;
  const range = editor.document.getWordRangeAtPosition(position);
  if (range) {
    return editor.document.getText(range);
  }

  return undefined;
}

/** Get current file path */
export function getCurrentFilePath(): string | undefined {
  return vscode.window.activeTextEditor?.document.fileName;
}
