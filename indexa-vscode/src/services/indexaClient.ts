import * as http from 'http';
import * as https from 'https';
import * as vscode from 'vscode';

export interface IndexaResult {
  text: string;
  tokenEstimate: number;
  sources: string[];
}

interface ApiResponse {
  query?: string;
  results?: Array<{
    score: number;
    chunk: {
      name: string;
      type: string;
      filePath: string;
      startLine: number;
      endLine: number;
      summary: string;
    };
  }>;
  [key: string]: unknown;
}

function getServerUrl(): string {
  return vscode.workspace.getConfiguration('indexa').get('serverUrl', 'http://localhost:3000');
}

function getTokenBudget(): number {
  return vscode.workspace.getConfiguration('indexa').get('defaultTokenBudget', 4000);
}

/** Make an HTTP request to the Indexa REST API */
function request(method: string, path: string, body?: unknown): Promise<string> {
  return new Promise((resolve, reject) => {
    const baseUrl = getServerUrl();
    const url = new URL(path, baseUrl);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Indexa API error ${res.statusCode}: ${data}`));
        } else {
          resolve(data);
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Cannot connect to Indexa at ${baseUrl}. Is the server running? (${err.message})`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Indexa request timed out'));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/** Search the index */
export async function search(query: string, topK: number = 5): Promise<IndexaResult> {
  const raw = await request('POST', '/api/search', { query, topK });
  const data: ApiResponse = JSON.parse(raw);

  const results = data.results || [];
  const sources = results.map(
    (r) => `${r.chunk.name} (${r.chunk.type}) — ${shortPath(r.chunk.filePath)}:${r.chunk.startLine}`
  );

  const text = results
    .map(
      (r, i) =>
        `### ${i + 1}. ${r.chunk.name} (${r.chunk.type}) — ${(r.score * 100).toFixed(0)}%\n` +
        `📁 ${shortPath(r.chunk.filePath)}:${r.chunk.startLine}-${r.chunk.endLine}\n` +
        `${r.chunk.summary}`
    )
    .join('\n\n');

  return {
    text: text || 'No results found.',
    tokenEstimate: Math.ceil(raw.length / 4),
    sources,
  };
}

/** Get a context bundle */
export async function contextBundle(query: string): Promise<IndexaResult> {
  const budget = getTokenBudget();
  const raw = await request('POST', '/api/context-bundle', { query, tokenBudget: budget });
  const data = JSON.parse(raw);

  const sources: string[] = [];
  if (data.symbols) {
    for (const sym of data.symbols) {
      sources.push(`${sym.name} (${sym.type}) — ${shortPath(sym.filePath)}`);
    }
  }

  // Format for display
  let text = '';
  if (data.symbols && data.symbols.length > 0) {
    for (const sym of data.symbols) {
      text += `### ${sym.name} (${sym.type})\n`;
      text += `📁 ${shortPath(sym.filePath)}:${sym.startLine}-${sym.endLine}\n`;
      text += `${sym.summary}\n`;
      if (sym.code) {
        text += `\`\`\`\n${sym.code}\n\`\`\`\n`;
      }
      text += '\n';
    }

    if (data.connections && data.connections.length > 0) {
      text += '### Connections\n';
      for (const conn of data.connections) {
        text += `  ${conn.from} —[${conn.type}]→ ${conn.to}\n`;
      }
    }

    text += `\n---\nTokens: ~${data.estimatedTokens || 'unknown'} / ${budget}`;
  } else {
    text = 'No results found.';
  }

  return {
    text,
    tokenEstimate: data.estimatedTokens || Math.ceil(raw.length / 4),
    sources,
  };
}

/** Explain code area */
export async function explain(query: string): Promise<IndexaResult> {
  const raw = await request('POST', '/api/explain', { query, tokenBudget: getTokenBudget() });
  const data = JSON.parse(raw);

  const sources = (data.symbolsUsed || []).map(
    (s: { name: string; type: string }) => `${s.name} (${s.type})`
  );

  let text = '';
  if (data.explanation) {
    text += `## Explanation\n\n${data.explanation}\n\n`;
  }
  if (data.steps && data.steps.length > 0) {
    text += `## Steps\n\n`;
    data.steps.forEach((step: string, i: number) => {
      text += `${i + 1}. ${step}\n`;
    });
    text += '\n';
  }
  if (data.symbolsUsed && data.symbolsUsed.length > 0) {
    text += `## Symbols (${data.symbolsUsed.length})\n\n`;
    for (const sym of data.symbolsUsed) {
      text += `- **${sym.name}** (${sym.type}) — ${sym.summary}\n`;
    }
  }

  return { text: text || 'No explanation available.', tokenEstimate: Math.ceil(raw.length / 4), sources };
}

/** Trace execution flow */
export async function flow(query: string, depth: number = 3): Promise<IndexaResult> {
  const raw = await request('POST', '/api/flow', { query, depth });
  const data = JSON.parse(raw);

  const sources = (data.flow || []).map(
    (s: { name: string; filePath: string }) => `${s.name} — ${shortPath(s.filePath)}`
  );

  let text = '';
  if (data.entry) {
    text += `## Flow from: ${data.entry}\n\n`;
  }
  if (data.flow && data.flow.length > 0) {
    for (const step of data.flow) {
      const indent = '  '.repeat(step.step - 1);
      const calls = step.calls.length > 0 ? ` → ${step.calls.join(', ')}` : '';
      text += `${indent}${step.step}. **${step.name}** (${step.type})${calls}\n`;
      text += `${indent}   ${step.summary}\n`;
      text += `${indent}   📁 ${shortPath(step.filePath)}\n\n`;
    }
  } else {
    text = 'No flow found.';
  }

  return { text, tokenEstimate: Math.ceil(raw.length / 4), sources };
}

/** Find references */
export async function references(symbolName: string): Promise<IndexaResult> {
  const raw = await request('GET', `/api/references?name=${encodeURIComponent(symbolName)}`);
  const data = JSON.parse(raw);

  const refs = data.references || [];
  const sources = refs.map(
    (r: { name: string; filePath: string }) => `${r.name} — ${shortPath(r.filePath)}`
  );

  let text = `## References to "${symbolName}"\n\n`;
  text += `Found ${refs.length} references`;
  if (data.blastRadius) {
    text += ` (${data.blastRadius} files affected)`;
  }
  text += '\n\n';

  for (const ref of refs.slice(0, 25)) {
    text += `- **${ref.name}** (${ref.type}) — ${shortPath(ref.filePath)}:${ref.startLine}\n`;
  }
  if (refs.length > 25) {
    text += `\n... and ${refs.length - 25} more\n`;
  }

  return { text, tokenEstimate: Math.ceil(raw.length / 4), sources };
}

// ─── Raw API methods (return structured data for sidebar TreeView) ───────────

/** Get raw context bundle data */
export async function contextBundleRaw(query: string): Promise<any> {
  const budget = getTokenBudget();
  const raw = await request('POST', '/api/context-bundle', { query, tokenBudget: budget });
  return JSON.parse(raw);
}

/** Get raw flow data */
export async function flowRaw(query: string, depth: number = 3): Promise<any> {
  const raw = await request('POST', '/api/flow', { query, depth });
  return JSON.parse(raw);
}

/** Get raw references data */
export async function referencesRaw(symbolName: string): Promise<any> {
  const raw = await request('GET', `/api/references?name=${encodeURIComponent(symbolName)}`);
  return JSON.parse(raw);
}

/** Health check */
export async function health(): Promise<string> {
  try {
    const raw = await request('GET', '/api/health');
    const data = JSON.parse(raw);
    return `Indexa: ${data.chunks || 0} chunks, ${data.files || 0} files`;
  } catch {
    return 'Indexa: Not connected';
  }
}

/** Shorten file path for display */
function shortPath(filePath: string): string {
  // Remove common project root prefixes
  return filePath
    .replace(/^.*?\/react-shell\//, 'react-shell/')
    .replace(/^.*?\/public\//, 'public/')
    .replace(/^.*?\/src\//, 'src/');
}
