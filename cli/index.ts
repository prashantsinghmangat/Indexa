#!/usr/bin/env node

import { Command } from 'commander';
import { initProject } from './init';
import { indexCommand, updateCommand } from './update';
import { searchCommand, bundleCommand, flowCommand, explainCommand } from './search';
import { startServer } from '../src/server/index';

const program = new Command();

program
  .name('indexa')
  .description('Indexa — AST-based codebase indexing with semantic + structural retrieval')
  .version('3.0.0');

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
  .command('serve')
  .description('Start the Indexa API server')
  .option('-p, --port <number>', 'Server port', '3000')
  .action((opts) => {
    startServer({ port: parseInt(opts.port, 10) });
  });

program.parse(process.argv);
