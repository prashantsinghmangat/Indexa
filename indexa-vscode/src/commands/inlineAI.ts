import * as vscode from 'vscode';
import * as indexa from '../services/indexaClient';
import { askLLM } from '../services/llmProvider';
import { getSelectedText, getSymbolAtCursor, getCurrentFilePath } from '../utils/selection';
import { showResultPanel } from '../ui/panel';

// ─── Context Builder ─────────────────────────────────────────────────────────

/** Build rich context from Indexa for the selected code / symbol */
async function buildContext(query: string): Promise<{ context: string; symbols: number }> {
  const data = await indexa.contextBundleRaw(query);
  const lines: string[] = [];

  if (data.symbols?.length > 0) {
    for (const sym of data.symbols) {
      const shortFile = sym.filePath
        ?.replace(/^.*?[/\\]src[/\\]/, 'src/')
        ?.replace(/\\/g, '/') || sym.filePath;
      lines.push(`### ${sym.name} (${sym.type})`);
      lines.push(`File: ${shortFile}:${sym.startLine}-${sym.endLine}`);
      if (sym.summary) lines.push(`Summary: ${sym.summary}`);
      if (sym.code) {
        const ext = shortFile.split('.').pop() || 'ts';
        lines.push('```' + ext);
        lines.push(sym.code);
        lines.push('```');
      }
      lines.push('');
    }
  }

  if (data.dependencies?.length > 0) {
    lines.push('### Dependencies');
    for (const dep of data.dependencies.slice(0, 5)) {
      lines.push(`- **${dep.name}** (${dep.type}) — ${dep.filePath}`);
      if (dep.code) {
        lines.push('```');
        lines.push(dep.code.substring(0, 400));
        lines.push('```');
      }
    }
    lines.push('');
  }

  if (data.connections?.length > 0) {
    lines.push('### Connections');
    for (const c of data.connections.slice(0, 8)) {
      lines.push(`- ${c.from} —[${c.type}]→ ${c.to}`);
    }
    lines.push('');
  }

  return {
    context: lines.join('\n'),
    symbols: data.symbols?.length || 0,
  };
}

// ─── Explain Selection ───────────────────────────────────────────────────────

export async function explainSelectionCommand(): Promise<void> {
  const selected = getSelectedText();
  const symbol = getSymbolAtCursor();
  const query = symbol || selected?.split('\n')[0]?.substring(0, 80);

  if (!query) {
    vscode.window.showWarningMessage('Select code or place cursor on a symbol to explain.');
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Indexa: Gathering context...' },
    async () => {
      try {
        const { context, symbols } = await buildContext(query);

        if (symbols === 0) {
          vscode.window.showWarningMessage(`No indexed symbols found for "${query}". Try re-indexing.`);
          return;
        }

        const prompt = `You are a senior engineer explaining code to a teammate.

# What to explain
${selected || query}

# Full Codebase Context (from Indexa — dependencies, connections, related code)
${context}

# Instructions
1. Start with a 1-2 sentence summary of what this code does
2. Walk through the execution flow step by step
3. Highlight key dependencies and how they connect
4. Note any non-obvious design decisions or gotchas
5. Keep it concise — no fluff

Be specific. Reference actual function names and files from the context.`;

        const response = await askLLM(prompt);

        if (response && response.text && response.provider === 'copilot') {
          showResultPanel(
            `Explain: ${query}`,
            response.text,
            Math.ceil(prompt.length / 4),
            [`${symbols} symbols from Indexa`, `Provider: ${response.provider}`]
          );
        }
        // If clipboard fallback, askLLM already handled the UX
      } catch (err) {
        vscode.window.showErrorMessage(`Indexa: ${err instanceof Error ? err.message : err}`);
      }
    }
  );
}

// ─── Fix This ────────────────────────────────────────────────────────────────

export async function fixThisCommand(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('Open a file first.');
    return;
  }

  const selected = getSelectedText();
  const symbol = getSymbolAtCursor();
  const filePath = getCurrentFilePath();

  // Get diagnostics (errors/warnings) at cursor or in selection
  const diagnostics = vscode.languages.getDiagnostics(editor.document.uri);
  const cursorLine = editor.selection.active.line;
  const relevantDiags = diagnostics.filter(d => {
    if (selected) {
      return d.range.start.line >= editor.selection.start.line
        && d.range.end.line <= editor.selection.end.line;
    }
    return Math.abs(d.range.start.line - cursorLine) <= 3;
  });

  const errorText = relevantDiags.length > 0
    ? relevantDiags.map(d => `[${d.severity === 0 ? 'ERROR' : 'WARNING'}] Line ${d.range.start.line + 1}: ${d.message}`).join('\n')
    : '';

  const codeAtCursor = selected || editor.document.getText(
    new vscode.Range(
      Math.max(0, cursorLine - 10), 0,
      Math.min(editor.document.lineCount, cursorLine + 10), 0
    )
  );

  const query = symbol || filePath?.split(/[/\\]/).pop() || 'current code';

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Indexa: Analyzing...' },
    async () => {
      try {
        const { context, symbols } = await buildContext(query);

        const prompt = `You are an expert senior software engineer debugging a production issue.

# Code with issue
File: ${filePath || 'unknown'}
\`\`\`
${codeAtCursor}
\`\`\`

${errorText ? `# Errors/Warnings detected\n${errorText}\n` : ''}
# Full Codebase Context (from Indexa — dependencies, connections, related code)
${context}

# Instructions
1. Analyze the code AND the codebase context
2. Identify the exact bug or most likely root causes
3. Provide a minimal, correct fix as a diff
4. Explain WHY the issue happens
5. Check if the fix could break any of the connected symbols

# Required Output Format

## Root Cause
(1-2 sentences)

## Fix
\`\`\`diff
// Only the necessary changes
\`\`\`

## Why
(Why this fixes it)

## Impact
(Could this fix break anything else? Check the connections above)

## Confidence
(High / Medium / Low)

Be precise. Reference actual symbols from the context.`;

        const response = await askLLM(prompt);

        if (response && response.text && response.provider === 'copilot') {
          showResultPanel(
            `Fix: ${query}`,
            response.text,
            Math.ceil(prompt.length / 4),
            [
              `${symbols} symbols from Indexa`,
              `${relevantDiags.length} diagnostics detected`,
              `Provider: ${response.provider}`,
            ]
          );
        }
      } catch (err) {
        vscode.window.showErrorMessage(`Indexa: ${err instanceof Error ? err.message : err}`);
      }
    }
  );
}

// ─── What Calls This ─────────────────────────────────────────────────────────

export async function whatCallsThisCommand(): Promise<void> {
  const symbol = getSymbolAtCursor();

  if (!symbol) {
    vscode.window.showWarningMessage('Place cursor on a symbol or select text.');
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Indexa: Tracing ${symbol}...` },
    async () => {
      try {
        // Get flow + references from Indexa (no LLM needed — pure Indexa intelligence)
        const [flowData, refsData] = await Promise.all([
          indexa.flowRaw(symbol, 4),
          indexa.referencesRaw(symbol),
        ]);

        const lines: string[] = [];

        // Flow
        if (flowData.flow?.length > 0) {
          lines.push(`## Execution Flow from \`${flowData.entry}\``);
          lines.push('');
          for (const step of flowData.flow) {
            const indent = '  '.repeat(step.step - 1);
            const calls = step.calls?.length > 0 ? ` -> ${step.calls.join(', ')}` : '';
            lines.push(`${indent}${step.step}. **${step.name}** (${step.type})${calls}`);
            lines.push(`${indent}   ${step.summary}`);
          }
          lines.push('');
        }

        // References
        const refs = refsData.references || [];
        if (refs.length > 0) {
          lines.push(`## References to \`${symbol}\` (${refs.length} found)`);
          lines.push('');
          for (const ref of refs.slice(0, 20)) {
            const shortFile = ref.filePath
              ?.replace(/^.*?[/\\]src[/\\]/, 'src/')
              ?.replace(/\\/g, '/') || ref.filePath;
            lines.push(`- **${ref.name}** (${ref.type}) — ${shortFile}:${ref.startLine}`);
          }
          if (refs.length > 20) lines.push(`\n... and ${refs.length - 20} more`);
        }

        if (lines.length === 0) {
          vscode.window.showInformationMessage(`No flow or references found for "${symbol}".`);
          return;
        }

        const markdown = lines.join('\n');
        showResultPanel(
          `What calls ${symbol}?`,
          markdown,
          Math.ceil(markdown.length / 4),
          [`${flowData.flow?.length || 0} flow steps`, `${refs.length} references`]
        );
      } catch (err) {
        vscode.window.showErrorMessage(`Indexa: ${err instanceof Error ? err.message : err}`);
      }
    }
  );
}

// ─── Refactor This ───────────────────────────────────────────────────────────

export async function refactorThisCommand(): Promise<void> {
  const selected = getSelectedText();
  const symbol = getSymbolAtCursor();
  const query = symbol || selected?.split('\n')[0]?.substring(0, 80);

  if (!query) {
    vscode.window.showWarningMessage('Select code to refactor.');
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Indexa: Analyzing for refactor...' },
    async () => {
      try {
        const { context, symbols } = await buildContext(query);

        const prompt = `You are a senior engineer reviewing code for refactoring.

# Code to refactor
${selected || query}

# Full Codebase Context (from Indexa)
${context}

# Instructions
1. Identify specific code smells (not generic advice)
2. For each issue, show before/after code
3. Check the connections — will refactoring break callers?
4. Prioritize by impact

# Output Format

## Issues
1. (Issue — why it matters)

## Suggested Changes
\`\`\`diff
// Before → After
\`\`\`

## Impact Check
(Which connected symbols are affected? Safe to change?)

Keep it practical. No unnecessary rewrites.`;

        const response = await askLLM(prompt);

        if (response && response.text && response.provider === 'copilot') {
          showResultPanel(
            `Refactor: ${query}`,
            response.text,
            Math.ceil(prompt.length / 4),
            [`${symbols} symbols from Indexa`, `Provider: ${response.provider}`]
          );
        }
      } catch (err) {
        vscode.window.showErrorMessage(`Indexa: ${err instanceof Error ? err.message : err}`);
      }
    }
  );
}

// ─── Generate Tests ──────────────────────────────────────────────────────────

export async function generateTestsCommand(): Promise<void> {
  const selected = getSelectedText();
  const symbol = getSymbolAtCursor();
  const query = symbol || selected?.split('\n')[0]?.substring(0, 80);

  if (!query) {
    vscode.window.showWarningMessage('Select code or place cursor on a function to generate tests.');
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Indexa: Generating tests...' },
    async () => {
      try {
        const { context, symbols } = await buildContext(query);

        const prompt = `You are a senior QA engineer generating unit tests.

# Code to test
${selected || query}

# Full Codebase Context (from Indexa — shows dependencies to mock)
${context}

# Instructions
1. Generate tests covering: happy path, edge cases, error handling
2. Mock the dependencies shown in the context above
3. Use descriptive test names
4. Keep tests focused — one assertion per test

# Output Format

## Test File
\`\`\`typescript
// Complete, runnable test file
\`\`\`

## What's Covered
- Happy path: ...
- Edge cases: ...
- Error handling: ...
- Not covered (needs integration test): ...`;

        const response = await askLLM(prompt);

        if (response && response.text && response.provider === 'copilot') {
          showResultPanel(
            `Tests: ${query}`,
            response.text,
            Math.ceil(prompt.length / 4),
            [`${symbols} symbols from Indexa`, `Provider: ${response.provider}`]
          );
        }
      } catch (err) {
        vscode.window.showErrorMessage(`Indexa: ${err instanceof Error ? err.message : err}`);
      }
    }
  );
}
