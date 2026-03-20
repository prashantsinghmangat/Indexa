import * as vscode from 'vscode';

let currentPanel: vscode.WebviewPanel | undefined;

/** Show results in a webview panel */
export function showResultPanel(
  title: string,
  markdown: string,
  tokenEstimate: number,
  sources: string[]
): void {
  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.Beside);
  } else {
    currentPanel = vscode.window.createWebviewPanel(
      'indexaResult',
      `Indexa: ${title}`,
      vscode.ViewColumn.Beside,
      { enableScripts: false, retainContextWhenHidden: true }
    );
    currentPanel.onDidDispose(() => {
      currentPanel = undefined;
    });
  }

  currentPanel.title = `Indexa: ${title}`;
  currentPanel.webview.html = buildHtml(title, markdown, tokenEstimate, sources);
}

function buildHtml(
  title: string,
  markdown: string,
  tokenEstimate: number,
  sources: string[]
): string {
  // Convert basic markdown to HTML
  const html = markdownToHtml(markdown);

  const sourcesHtml = sources.length > 0
    ? `<div class="sources">
        <strong>Sources (${sources.length}):</strong>
        <ul>${sources.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
       </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 16px;
      line-height: 1.6;
    }
    h1 { font-size: 1.4em; margin-bottom: 8px; border-bottom: 1px solid var(--vscode-widget-border); padding-bottom: 8px; }
    h2 { font-size: 1.2em; margin-top: 20px; margin-bottom: 8px; }
    h3 { font-size: 1.05em; margin-top: 16px; margin-bottom: 4px; }
    pre {
      background: var(--vscode-textCodeBlock-background, #1e1e1e);
      padding: 12px;
      border-radius: 4px;
      overflow-x: auto;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size, 12px);
      line-height: 1.4;
    }
    code {
      font-family: var(--vscode-editor-font-family, monospace);
      background: var(--vscode-textCodeBlock-background, #1e1e1e);
      padding: 2px 4px;
      border-radius: 3px;
    }
    pre code { background: none; padding: 0; }
    .stats {
      margin-top: 16px;
      padding: 10px;
      background: var(--vscode-textBlockQuote-background, #252525);
      border-radius: 4px;
      font-size: 0.9em;
      border-left: 3px solid var(--vscode-textLink-foreground, #3794ff);
    }
    .sources {
      margin-top: 12px;
      font-size: 0.85em;
      opacity: 0.8;
    }
    .sources ul { margin: 4px 0; padding-left: 20px; }
    .sources li { margin: 2px 0; }
    strong { color: var(--vscode-textLink-foreground, #3794ff); }
    a { color: var(--vscode-textLink-foreground, #3794ff); }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${html}
  <div class="stats">
    Tokens used: ~${tokenEstimate.toLocaleString()}
  </div>
  ${sourcesHtml}
</body>
</html>`;
}

/** Basic markdown → HTML (handles headers, code blocks, bold, lists) */
function markdownToHtml(md: string): string {
  return md
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    // Headers
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Unordered lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    // Ordered lists
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // Paragraphs (blank lines)
    .replace(/\n\n/g, '</p><p>')
    // Line breaks
    .replace(/\n/g, '<br>')
    // Wrap
    .replace(/^/, '<p>')
    .replace(/$/, '</p>');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
