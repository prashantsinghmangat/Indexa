import * as vscode from 'vscode';
import { ChildProcess, spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';

let serverProcess: ChildProcess | undefined;
let serverReady = false;

/** Find the Indexa CLI entry point */
function findCliPath(): string | undefined {
  // 1. User-configured path
  const configured = vscode.workspace.getConfiguration('indexa').get<string>('cliPath', '');
  if (configured && fs.existsSync(configured)) return configured;

  // 2. Global npm install: indexa-mcp package
  try {
    const resolved = require.resolve('indexa-mcp/dist/cli/index.js');
    if (fs.existsSync(resolved)) return resolved;
  } catch { /* not installed globally */ }

  // 3. Check common locations
  const candidates = [
    // npm global (Windows)
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'indexa-mcp', 'dist', 'cli', 'index.js'),
    // Development location
    path.join('D:', 'Project', 'Indexa', 'dist', 'cli', 'index.js'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return undefined;
}

/** Find the .indexa data directory for the current workspace */
function findDataDir(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return undefined;

  const projectRoot = folders[0].uri.fsPath;
  const localData = path.join(projectRoot, '.indexa');
  if (fs.existsSync(localData)) return localData;

  return undefined;
}

/** Check if server is already running */
function isServerRunning(): Promise<boolean> {
  const url = vscode.workspace.getConfiguration('indexa').get('serverUrl', 'http://localhost:3000');
  return new Promise((resolve) => {
    const req = http.get(`${url}/api/health`, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(res.statusCode === 200));
    });
    req.on('error', () => resolve(false));
    req.setTimeout(3000, () => { req.destroy(); resolve(false); });
  });
}

/** Start the Indexa REST server as a child process */
export async function startServer(): Promise<boolean> {
  // Already running externally?
  if (await isServerRunning()) {
    serverReady = true;
    return true;
  }

  const cliPath = findCliPath();
  if (!cliPath) {
    vscode.window.showWarningMessage(
      'Indexa CLI not found. Install with: npm i -g indexa-mcp',
      'Install Now'
    ).then((choice) => {
      if (choice === 'Install Now') {
        const terminal = vscode.window.createTerminal('Indexa Install');
        terminal.sendText('npm i -g indexa-mcp');
        terminal.show();
      }
    });
    return false;
  }

  const dataDir = findDataDir();
  const port = vscode.workspace.getConfiguration('indexa').get('serverUrl', 'http://localhost:3000')
    .replace(/.*:(\d+).*/, '$1');

  const args = [cliPath, 'serve', '--port', port];
  if (dataDir) {
    args.push('--data-dir', dataDir);
  }

  try {
    serverProcess = spawn('node', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      windowsHide: true,
    });

    // Wait for server to be ready (poll health endpoint)
    serverReady = await waitForServer(10000);

    if (serverReady) {
      serverProcess.on('exit', (code) => {
        serverReady = false;
        if (code !== 0 && code !== null) {
          vscode.window.showWarningMessage(`Indexa server exited (code ${code}). Restart with: Indexa: Health Check`);
        }
      });
      return true;
    } else {
      stopServer();
      return false;
    }
  } catch (err) {
    return false;
  }
}

/** Wait for server health endpoint to respond */
function waitForServer(timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      if (Date.now() - start > timeoutMs) {
        resolve(false);
        return;
      }
      isServerRunning().then((running) => {
        if (running) {
          resolve(true);
        } else {
          setTimeout(check, 500);
        }
      });
    };
    check();
  });
}

/** Stop the server child process */
export function stopServer(): void {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = undefined;
    serverReady = false;
  }
}

/** Check if server is currently ready */
export function isReady(): boolean {
  return serverReady;
}

/** Ensure server is running, start if needed */
export async function ensureServer(): Promise<boolean> {
  if (await isServerRunning()) {
    serverReady = true;
    return true;
  }
  return startServer();
}
