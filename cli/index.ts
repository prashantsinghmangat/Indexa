#!/usr/bin/env node

import { Command } from 'commander';
import { initProject } from './init';
import { indexCommand, updateCommand } from './update';
import { searchCommand, bundleCommand, flowCommand, explainCommand } from './search';
import { cleanCommand, statsCommand } from './clean';
import { setupCommand, doctorCommand } from './setup';
import { startServer } from '../src/server/index';

const program = new Command();

program
  .name('indexa')
  .description('Indexa — AST-based codebase indexing with semantic + structural retrieval')
  .version('3.1.0');

// ─── Primary: one-command setup ─────────────────────────────────────────────
program
  .command('setup [directory]')
  .description('Full auto-setup: detect project → index → configure MCP → verify (< 60 seconds)')
  .action(async (directory) => {
    await setupCommand(directory);
  });

program
  .command('doctor')
  .description('Check Indexa health: index, embeddings, MCP config, server')
  .option('--data-dir <path>', 'Custom data directory')
  .action(async (opts) => {
    await doctorCommand({ dataDir: opts.dataDir });
  });

// ─── Init / Index / Update ─────────────────────────────────────────────────
program
  .command('init')
  .description('Initialize Indexa project in the current directory')
  .option('-d, --dir <path>', 'Target directory')
  .action((opts) => {
    initProject(opts.dir);
  });

program
  .command('index [directory]')
  .description('Index a codebase directory')
  .option('--data-dir <path>', 'Custom data directory')
  .action(async (directory, opts) => {
    await indexCommand(directory, { dataDir: opts.dataDir });
  });

program
  .command('update')
  .description('Incremental update using git diff')
  .option('--data-dir <path>', 'Custom data directory')
  .action(async (opts) => {
    await updateCommand({ dataDir: opts.dataDir });
  });

program
  .command('search <query>')
  .description('Search the indexed codebase')
  .option('-k, --top-k <number>', 'Number of results', '5')
  .option('-b, --token-budget <number>', 'Token budget (overrides topK)')
  .option('--data-dir <path>', 'Custom data directory')
  .action(async (query, opts) => {
    await searchCommand(query, {
      topK: parseInt(opts.topK, 10),
      tokenBudget: opts.tokenBudget ? parseInt(opts.tokenBudget, 10) : undefined,
      dataDir: opts.dataDir,
    });
  });

program
  .command('bundle <query>')
  .description('Build a context bundle: search + pack symbols + deps within token budget')
  .option('-b, --token-budget <number>', 'Token budget', '2000')
  .option('--data-dir <path>', 'Custom data directory')
  .action(async (query, opts) => {
    await bundleCommand(query, {
      tokenBudget: parseInt(opts.tokenBudget, 10),
      dataDir: opts.dataDir,
    });
  });

program
  .command('flow <query>')
  .description('Trace execution flow from a symbol or query')
  .option('-d, --depth <number>', 'Traversal depth', '3')
  .option('--data-dir <path>', 'Custom data directory')
  .action(async (query, opts) => {
    await flowCommand(query, {
      depth: parseInt(opts.depth, 10),
      dataDir: opts.dataDir,
    });
  });

program
  .command('explain <query>')
  .description('Generate a human-readable explanation of code')
  .option('-b, --token-budget <number>', 'Token budget for analysis', '2000')
  .option('--data-dir <path>', 'Custom data directory')
  .action(async (query, opts) => {
    await explainCommand(query, {
      tokenBudget: parseInt(opts.tokenBudget, 10),
      dataDir: opts.dataDir,
    });
  });

program
  .command('clean')
  .description('Purge junk chunks (minified, storybook, vendor scripts, tests)')
  .option('--data-dir <path>', 'Custom data directory')
  .option('--dry-run', 'Show what would be removed without removing')
  .option('--pattern <pattern>', 'Additional file path pattern to purge (repeatable)', (val: string, arr: string[]) => { arr.push(val); return arr; }, [] as string[])
  .action(async (opts) => {
    await cleanCommand({
      dataDir: opts.dataDir,
      dryRun: opts.dryRun,
      patterns: opts.pattern,
    });
  });

program
  .command('health')
  .description('Show index health report: chunk counts, types, junk detection')
  .option('--data-dir <path>', 'Custom data directory')
  .action((opts) => {
    statsCommand({ dataDir: opts.dataDir });
  });

program
  .command('reindex <directory>')
  .description('Full clean re-index: wipe old data → index → clean junk → report')
  .option('--data-dir <path>', 'Custom data directory')
  .action(async (directory, opts) => {
    const dataDir = opts.dataDir;

    console.log('=== Step 1/4: Wiping old index ===');
    const path = await import('path');
    const fs = await import('fs');
    // Resolve data dir relative to Indexa install root, not CWD
    const indexaRoot = path.resolve(__dirname, '..');
    const dir = dataDir || path.join(indexaRoot, 'data');
    const embPath = path.join(dir, 'embeddings.json');
    const metaPath = path.join(dir, 'metadata.json');
    if (fs.existsSync(embPath)) fs.unlinkSync(embPath);
    if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
    console.log('Old index cleared.\n');

    console.log('=== Step 2/4: Indexing codebase ===');
    await indexCommand(directory, { dataDir });
    console.log('');

    console.log('=== Step 3/4: Cleaning junk ===');
    await cleanCommand({ dataDir });
    console.log('');

    console.log('=== Step 4/4: Health report ===');
    statsCommand({ dataDir });
  });

program
  .command('serve')
  .description('Start the Indexa API server')
  .option('-p, --port <number>', 'Server port', '3000')
  .action((opts) => {
    startServer({ port: parseInt(opts.port, 10) });
  });

// Default: show help if no command provided
if (process.argv.length <= 2) {
  console.log('');
  console.log('  Quick start:  indexa setup');
  console.log('  Health check: indexa doctor');
  console.log('');
  program.help();
} else {
  program.parse(process.argv);
}
