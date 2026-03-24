import * as vscode from 'vscode';
import * as indexa from './indexaClient';

// ─── Prompt Templates ────────────────────────────────────────────────────────

type PromptIntent = 'fix' | 'explain' | 'refactor' | 'review' | 'test';

const PROMPT_TEMPLATES: Record<PromptIntent, string> = {
  fix: `You are an expert senior software engineer debugging a production issue.

# Problem
{query}

# Relevant Code Context (from Indexa semantic search)
{context}

# Instructions
1. Analyze ONLY the provided code — do not assume missing context
2. Identify the exact bug or most likely root causes
3. Provide a minimal, correct fix (prefer diff format)
4. Explain WHY the issue happens
5. If multiple possible issues, rank by likelihood

# Required Output Format

## Root Cause
(Concise explanation of what's wrong)

## Fix
\`\`\`diff
// Show only the necessary changes
\`\`\`

## Explanation
(Why this fix works)

## Edge Cases
(Anything else that could break)

## Confidence
(High / Medium / Low with reason)

Think step-by-step internally, but only output the final structured answer.
Do NOT suggest rewriting everything — be precise and practical.`,

  explain: `You are a senior engineer explaining code to a teammate.

# Question
{query}

# Relevant Code (from Indexa semantic search)
{context}

# Instructions
1. Explain the high-level purpose first (1-2 sentences)
2. Walk through the execution flow step by step
3. Highlight key dependencies and relationships
4. Note any non-obvious design decisions
5. Keep it concise — no fluff

# Required Output Format

## Purpose
(What this code does in 1-2 sentences)

## Execution Flow
1. (Step 1)
2. (Step 2)
...

## Key Dependencies
- (dependency → what it provides)

## Design Notes
(Anything non-obvious about the implementation)`,

  refactor: `You are a senior engineer reviewing code for refactoring opportunities.

# What to refactor
{query}

# Current Code (from Indexa semantic search)
{context}

# Instructions
1. Identify specific code smells or issues (not generic advice)
2. Propose concrete improvements with before/after code
3. Explain the benefit of each change
4. Preserve existing behavior — no functional changes unless requested
5. Prioritize by impact

# Required Output Format

## Issues Found
1. (Issue — why it's a problem)

## Suggested Changes
\`\`\`diff
// Before → After for each change
\`\`\`

## Benefits
(What improves: readability, performance, maintainability)

## Risk Assessment
(What could break, what to test after)`,

  review: `You are a senior engineer doing a thorough code review.

# Area to review
{query}

# Code (from Indexa semantic search)
{context}

# Instructions
Review for these categories (skip any that don't apply):
1. **Bugs** — logic errors, race conditions, null handling
2. **Security** — injection, auth bypass, data exposure
3. **Performance** — unnecessary renders, N+1 queries, memory leaks
4. **Best Practices** — naming, structure, error handling
5. Be specific — reference exact lines/functions

# Required Output Format

## Critical Issues
(Must fix before merge)

## Warnings
(Should fix but not blocking)

## Suggestions
(Nice to have improvements)

## Verdict
(Approve / Request Changes / Needs Discussion)`,

  test: `You are a senior QA engineer generating unit tests.

# Code to test
{query}

# Implementation (from Indexa semantic search)
{context}

# Instructions
1. Generate tests using the project's existing test framework
2. Cover: happy path, edge cases, error handling
3. Use descriptive test names that explain the scenario
4. Mock external dependencies (API calls, DB, etc.)
5. Keep tests focused — one assertion per test where possible

# Required Output Format

## Test File
\`\`\`typescript
// Complete, runnable test file
\`\`\`

## Coverage Summary
- Happy path: (what's covered)
- Edge cases: (what's covered)
- Error handling: (what's covered)
- Not covered: (what needs integration tests)`,
};

// ─── Format Context ──────────────────────────────────────────────────────────

function formatContextForAI(data: any): string {
  const lines: string[] = [];

  if (data.symbols?.length > 0) {
    for (const sym of data.symbols) {
      const shortFile = sym.filePath
        ?.replace(/^.*?[/\\]src[/\\]/, 'src/')
        ?.replace(/\\/g, '/') || sym.filePath;
      lines.push(`### ${sym.name} (${sym.type})`);
      lines.push(`File: ${shortFile}:${sym.startLine}-${sym.endLine}`);
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
    for (const dep of data.dependencies) {
      const shortFile = dep.filePath
        ?.replace(/^.*?[/\\]src[/\\]/, 'src/')
        ?.replace(/\\/g, '/') || dep.filePath;
      lines.push(`- **${dep.name}** (${dep.type}) — ${shortFile}:${dep.startLine}`);
      if (dep.code) {
        lines.push('```');
        lines.push(dep.code.substring(0, 500));
        lines.push('```');
      }
    }
    lines.push('');
  }

  if (data.connections?.length > 0) {
    lines.push('### Connections');
    const seen = new Set<string>();
    for (const c of data.connections.slice(0, 10)) {
      const key = `${c.from}→${c.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`- ${c.from} —[${c.type}]→ ${c.to}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Copy for AI ─────────────────────────────────────────────────────────────

export async function copyForAI(intent?: PromptIntent): Promise<void> {
  const query = await vscode.window.showInputBox({
    prompt: intent === 'fix' ? 'Describe the bug' :
           intent === 'refactor' ? 'What to refactor' :
           intent === 'test' ? 'What to test' :
           'What do you need help with?',
    placeHolder: intent === 'fix' ? 'e.g., login returns 500 error' :
                intent === 'refactor' ? 'e.g., auth service is too complex' :
                'e.g., how does the pricing system work',
  });

  if (!query) return;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Indexa: Gathering context for AI...',
    },
    async () => {
      try {
        const data = await indexa.contextBundleRaw(query);
        const context = formatContextForAI(data);

        if (!context.trim()) {
          vscode.window.showWarningMessage('No relevant code found. Try a different query.');
          return;
        }

        const selectedIntent = intent || await pickIntent();
        if (!selectedIntent) return;

        const template = PROMPT_TEMPLATES[selectedIntent];
        const prompt = template
          .replace('{query}', query)
          .replace('{context}', context);

        // Copy to clipboard
        await vscode.env.clipboard.writeText(prompt);

        const tokens = Math.ceil(prompt.length / 4);
        const action = await vscode.window.showInformationMessage(
          `Copied to clipboard (${data.symbols?.length || 0} symbols, ~${tokens} tokens). Paste into Copilot, ChatGPT, or Claude.`,
          'Open Copilot Chat'
        );

        if (action === 'Open Copilot Chat') {
          vscode.commands.executeCommand('workbench.action.chat.open');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Indexa: ${msg}`);
      }
    }
  );
}

// ─── Open Top Results in Editor (Copilot Hack) ──────────────────────────────

export async function openForCopilot(): Promise<void> {
  const query = await vscode.window.showInputBox({
    prompt: 'What code should Copilot see?',
    placeHolder: 'e.g., authentication flow, pricing logic',
  });

  if (!query) return;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Indexa: Opening relevant files for Copilot...',
    },
    async () => {
      try {
        const data = await indexa.contextBundleRaw(query);
        const symbols = data.symbols || [];

        if (symbols.length === 0) {
          vscode.window.showWarningMessage('No relevant code found.');
          return;
        }

        // Get unique file paths (max 5)
        const files = [...new Set(symbols.map((s: any) => s.filePath))].slice(0, 5);

        // Open each file at the relevant line
        for (let i = 0; i < files.length; i++) {
          const filePath = files[i] as string;
          const sym = symbols.find((s: any) => s.filePath === filePath);
          const line = sym?.startLine || 1;

          try {
            const uri = vscode.Uri.file(filePath);
            const doc = await vscode.workspace.openTextDocument(uri);
            const column = i === 0 ? vscode.ViewColumn.One : vscode.ViewColumn.Beside;
            const editor = await vscode.window.showTextDocument(doc, column, true);
            const pos = new vscode.Position(Math.max(0, line - 1), 0);
            editor.revealRange(
              new vscode.Range(pos, pos),
              vscode.TextEditorRevealType.InCenter
            );
          } catch { /* skip files that can't open */ }
        }

        vscode.window.showInformationMessage(
          `Opened ${files.length} files. Copilot now has context for: "${query}"`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Indexa: ${msg}`);
      }
    }
  );
}

// ─── Intent Picker ───────────────────────────────────────────────────────────

async function pickIntent(): Promise<PromptIntent | undefined> {
  const picked = await vscode.window.showQuickPick(
    [
      { label: '$(bug) Fix Bug', description: 'Identify and fix a bug', value: 'fix' as PromptIntent },
      { label: '$(book) Explain', description: 'Understand how code works', value: 'explain' as PromptIntent },
      { label: '$(edit) Refactor', description: 'Improve code quality', value: 'refactor' as PromptIntent },
      { label: '$(eye) Review', description: 'Find issues and improvements', value: 'review' as PromptIntent },
      { label: '$(beaker) Generate Tests', description: 'Create unit tests', value: 'test' as PromptIntent },
    ],
    { placeHolder: 'What should AI do with this code?' }
  );
  return picked?.value;
}
