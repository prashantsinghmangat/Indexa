#!/usr/bin/env node

import { Command } from 'commander';
import { initProject } from './init';
import { indexCommand, updateCommand } from './update';
import { searchCommand, bundleCommand, flowCommand, explainCommand, deadCodeCommand, blastRadiusCommand, exportCommand, circularDepsCommand, unusedExportsCommand, duplicatesCommand, impactChainCommand, watchCommand } from './search';
import { cleanCommand, statsCommand } from './clean';
import { setupCommand, doctorCommand } from './setup';
import { benchmarkCommand } from './benchmark';
import { startServer } from '../src/server/index';

const program = new Command();

program
  .name('indexa')
  .description('Indexa — AST-based codebase indexing with semantic + structural retrieval')
  .version('3.4.0');

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
  .command('benchmark')
  .description('Compare token usage: Indexa context bundles vs reading raw files')
  .option('-q, --query <query>', 'Custom query (repeatable)', (val: string, arr: string[]) => { arr.push(val); return arr; }, [] as string[])
  .option('-b, --token-budget <number>', 'Token budget per query', '3000')
  .option('--data-dir <path>', 'Custom data directory')
  .action(async (opts) => {
    await benchmarkCommand({
      dataDir: opts.dataDir,
      queries: opts.query?.length > 0 ? opts.query : undefined,
      tokenBudget: parseInt(opts.tokenBudget, 10),
    });
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

// ─── Analysis / Intelligence ────────────────────────────────────────────────
program
  .command('dead-code')
  .description('Find unreferenced functions, methods, and classes (dead code)')
  .option('--include-entry-points', 'Include controllers/components/services')
  .option('--data-dir <path>', 'Custom data directory')
  .action(async (opts) => {
    await deadCodeCommand({
      includeEntryPoints: opts.includeEntryPoints,
      dataDir: opts.dataDir,
    });
  });

program
  .command('blast-radius <symbol>')
  .description('Show what breaks if a symbol changes — direct refs + transitive impact')
  .option('--data-dir <path>', 'Custom data directory')
  .action(async (symbol, opts) => {
    await blastRadiusCommand(symbol, { dataDir: opts.dataDir });
  });

program
  .command('export <query>')
  .description('Export LLM-ready context bundle to stdout or file')
  .option('-b, --token-budget <number>', 'Token budget', '3000')
  .option('-f, --format <format>', 'Output format: markdown or json', 'markdown')
  .option('-o, --output <path>', 'Write to file instead of stdout')
  .option('--data-dir <path>', 'Custom data directory')
  .action(async (query, opts) => {
    await exportCommand(query, {
      tokenBudget: parseInt(opts.tokenBudget, 10),
      format: opts.format,
      output: opts.output,
      dataDir: opts.dataDir,
    });
  });

program
  .command('circular-deps')
  .description('Detect circular dependencies between files')
  .option('--data-dir <path>', 'Custom data directory')
  .action((opts) => {
    circularDepsCommand({ dataDir: opts.dataDir });
  });

program
  .command('unused-exports')
  .description('Find exported symbols that no other file imports')
  .option('--data-dir <path>', 'Custom data directory')
  .action((opts) => {
    unusedExportsCommand({ dataDir: opts.dataDir });
  });

program
  .command('duplicates')
  .description('Find near-duplicate code using embedding similarity')
  .option('-t, --threshold <number>', 'Similarity threshold (0.8-0.99)', '0.92')
  .option('--data-dir <path>', 'Custom data directory')
  .action((opts) => {
    duplicatesCommand({
      threshold: parseFloat(opts.threshold),
      dataDir: opts.dataDir,
    });
  });

program
  .command('impact-chain <symbol>')
  .description('Full transitive impact analysis — trace every symbol affected if a symbol changes')
  .option('-d, --depth <number>', 'Max depth to trace', '5')
  .option('--data-dir <path>', 'Custom data directory')
  .action((symbol, opts) => {
    impactChainCommand(symbol, {
      depth: parseInt(opts.depth, 10),
      dataDir: opts.dataDir,
    });
  });

program
  .command('watch [directory]')
  .description('Watch for file changes and re-index incrementally (live mode)')
  .option('--data-dir <path>', 'Custom data directory')
  .action(async (directory, opts) => {
    await watchCommand({
      directory: directory || process.cwd(),
      dataDir: opts.dataDir,
    });
  });

// ─── Server ─────────────────────────────────────────────────────────────────
program
  .command('serve')
  .description('Start the Indexa API server')
  .option('-p, --port <number>', 'Server port', '3000')
  .option('--data-dir <path>', 'Custom data directory')
  .action((opts) => {
    startServer({ port: parseInt(opts.port, 10), dataDir: opts.dataDir });
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
