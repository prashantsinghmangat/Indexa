import * as vscode from 'vscode';

export interface LLMResponse {
  text: string;
  provider: 'copilot' | 'clipboard';
}

/**
 * LLM provider that tries VS Code Language Model API (Copilot) first,
 * falls back to clipboard + Copilot Chat.
 *
 * The magic flow:
 *   1. User triggers action (e.g., "Fix This")
 *   2. Indexa gathers context (dependencies, connections, blast radius)
 *   3. This provider sends context + prompt to LLM
 *   4. Response appears inline in VS Code
 */

/** Check if VS Code Language Model API is available (requires Copilot + VS Code 1.90+) */
function hasLanguageModelAPI(): boolean {
  return typeof (vscode as any).lm !== 'undefined' && typeof (vscode as any).lm.selectChatModels === 'function';
}

/** Send a prompt to the VS Code Language Model API (Copilot) */
async function askCopilot(prompt: string, token: vscode.CancellationToken): Promise<string | null> {
  try {
    const lm = (vscode as any).lm;
    const models = await lm.selectChatModels({ family: 'gpt-4o' });

    if (!models || models.length === 0) {
      // Try any available model
      const allModels = await lm.selectChatModels();
      if (!allModels || allModels.length === 0) return null;
      models.push(allModels[0]);
    }

    const model = models[0];
    const messages = [
      lm.LanguageModelChatMessage
        ? lm.LanguageModelChatMessage.User(prompt)
        : { role: 'user' as const, content: prompt },
    ];

    // Use the vscode.lm chat API
    const response = await model.sendRequest(messages, {}, token);

    // Collect streamed response
    let result = '';
    for await (const chunk of response.text) {
      result += chunk;
    }

    return result;
  } catch (err) {
    // Model not available, permission denied, etc.
    return null;
  }
}

/** Send prompt to Copilot Chat via clipboard + open chat */
async function askViaClipboard(prompt: string): Promise<void> {
  await vscode.env.clipboard.writeText(prompt);

  const tokens = Math.ceil(prompt.length / 4);
  const action = await vscode.window.showInformationMessage(
    `Copied to clipboard (~${tokens} tokens). Paste into your AI.`,
    'Open Copilot Chat',
    'OK'
  );

  if (action === 'Open Copilot Chat') {
    vscode.commands.executeCommand('workbench.action.chat.open');
  }
}

/**
 * Ask an LLM with Indexa context.
 * Tries VS Code Language Model API first (requires Copilot).
 * Falls back to clipboard if not available.
 */
export async function askLLM(
  prompt: string,
  options?: { silent?: boolean }
): Promise<LLMResponse | null> {
  // Try VS Code Language Model API (Copilot)
  if (hasLanguageModelAPI()) {
    const tokenSource = new vscode.CancellationTokenSource();

    // Show progress while waiting for response
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Indexa: Thinking...',
        cancellable: true,
      },
      async (progress, cancelToken) => {
        cancelToken.onCancellationRequested(() => tokenSource.cancel());
        return askCopilot(prompt, tokenSource.token);
      }
    );

    if (result) {
      return { text: result, provider: 'copilot' };
    }
  }

  // Fallback: clipboard
  if (!options?.silent) {
    await askViaClipboard(prompt);
  }

  return { text: '', provider: 'clipboard' };
}
