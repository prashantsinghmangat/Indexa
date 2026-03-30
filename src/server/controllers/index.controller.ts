import { Request, Response } from 'express';
import { VectorDB } from '../../storage/vector-db';
import { MetadataDB } from '../../storage/metadata-db';
import { Updater } from '../../indexer/updater';
import { Embedder } from '../../indexer/embedder';
import { GraphAnalysis } from '../../retrieval/graph';
import { IndexaConfig } from '../../types';
import { logger, normalizePath, readCodeAtOffset } from '../../utils';

/**
 * Controller for indexing, file, symbol, and graph API endpoints.
 */
export class IndexController {
  private vectorDB: VectorDB;
  private metadataDB: MetadataDB;
  private updater: Updater;
  private graph: GraphAnalysis;

  constructor(config: IndexaConfig, vectorDB: VectorDB, metadataDB: MetadataDB, embedder: Embedder) {
    this.vectorDB = vectorDB;
    this.metadataDB = metadataDB;
    this.updater = new Updater(config, vectorDB, metadataDB, embedder);
    this.graph = new GraphAnalysis(vectorDB);
  }

  /** POST /update — trigger incremental update */
  update = async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await this.updater.updateFromGit();
      res.json({ status: 'ok', ...result });
    } catch (err) {
      logger.error(`Update failed: ${err}`);
      res.status(500).json({ error: 'Update failed' });
    }
  };

  /** GET /file?path= — get chunks for a specific file */
  getFile = (req: Request, res: Response): void => {
    try {
      const filePath = req.query.path as string;
      if (!filePath) {
        res.status(400).json({ error: 'Missing "path" query parameter' });
        return;
      }

      const chunks = this.vectorDB.getByFile(filePath);

      if (chunks.length === 0) {
        res.status(404).json({ error: `No indexed chunks for ${filePath}` });
        return;
      }

      const cleaned = chunks.map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
        filePath: c.filePath,
        startLine: c.startLine,
        endLine: c.endLine,
        summary: c.summary,
        code: readCodeAtOffset(c.filePath, c.byteOffset, c.byteLength),
        dependencies: c.dependencies,
        imports: c.imports,
      }));

      res.json({ filePath: chunks[0].filePath, chunks: cleaned });
    } catch (err) {
      logger.error(`Get file failed: ${err}`);
      res.status(500).json({ error: 'Failed to get file' });
    }
  };

  /** GET /symbol?name= — search for a symbol by name */
  getSymbol = (req: Request, res: Response): void => {
    try {
      const name = req.query.name as string;
      if (!name) {
        res.status(400).json({ error: 'Missing "name" query parameter' });
        return;
      }

      const matches = this.vectorDB.findByName(name);

      if (matches.length === 0) {
        res.status(404).json({ error: `No symbol matching "${name}"` });
        return;
      }

      const cleaned = matches.map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
        filePath: c.filePath,
        startLine: c.startLine,
        endLine: c.endLine,
        summary: c.summary,
        code: readCodeAtOffset(c.filePath, c.byteOffset, c.byteLength),
        dependencies: c.dependencies,
        imports: c.imports,
      }));

      res.json({ name, results: cleaned });
    } catch (err) {
      logger.error(`Get symbol failed: ${err}`);
      res.status(500).json({ error: 'Failed to get symbol' });
    }
  };

  /** GET /symbol/:id — get a symbol by its stable ID */
  getSymbolById = (req: Request, res: Response): void => {
    try {
      const id = req.params.id;
      const chunk = this.vectorDB.get(id);

      if (!chunk) {
        res.status(404).json({ error: `Symbol not found: ${id}` });
        return;
      }

      res.json({
        id: chunk.id,
        name: chunk.name,
        type: chunk.type,
        filePath: chunk.filePath,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        summary: chunk.summary,
        code: readCodeAtOffset(chunk.filePath, chunk.byteOffset, chunk.byteLength),
        dependencies: chunk.dependencies,
        imports: chunk.imports,
      });
    } catch (err) {
      logger.error(`Get symbol by ID failed: ${err}`);
      res.status(500).json({ error: 'Failed to get symbol' });
    }
  };

  /** GET /outline?path= — file outline (symbols without code) */
  getOutline = (req: Request, res: Response): void => {
    try {
      const filePath = req.query.path as string;
      if (!filePath) {
        res.status(400).json({ error: 'Missing "path" query parameter' });
        return;
      }

      const chunks = this.vectorDB.getByFile(filePath);
      const outline = chunks.map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
        startLine: c.startLine,
        endLine: c.endLine,
        summary: c.summary,
      }));

      res.json({ filePath: chunks[0]?.filePath || filePath, symbols: outline });
    } catch (err) {
      logger.error(`Get outline failed: ${err}`);
      res.status(500).json({ error: 'Failed to get outline' });
    }
  };

  /** GET /references?name= — find references to a symbol */
  getReferences = (req: Request, res: Response): void => {
    try {
      const name = req.query.name as string;
      if (!name) {
        res.status(400).json({ error: 'Missing "name" query parameter' });
        return;
      }

      const refs = this.graph.findReferences(name);
      const cleaned = refs.slice(0, 30).map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
        filePath: c.filePath,
        startLine: c.startLine,
      }));

      res.json({ symbolName: name, references: cleaned, total: refs.length });
    } catch (err) {
      logger.error(`Get references failed: ${err}`);
      res.status(500).json({ error: 'Failed to get references' });
    }
  };

  /** GET /blast-radius?name= — estimate impact of changing a symbol */
  getBlastRadius = (req: Request, res: Response): void => {
    try {
      const name = req.query.name as string;
      if (!name) {
        res.status(400).json({ error: 'Missing "name" query parameter' });
        return;
      }

      const blast = this.graph.getBlastRadius(name);
      res.json({ symbolName: name, ...blast });
    } catch (err) {
      logger.error(`Get blast radius failed: ${err}`);
      res.status(500).json({ error: 'Failed to get blast radius' });
    }
  };

  /** GET /circular-deps — detect circular dependencies */
  getCircularDeps = (_req: Request, res: Response): void => {
    try {
      const cycles = this.graph.findCircularDependencies();
      res.json({ total: cycles.length, cycles });
    } catch (err) {
      logger.error(`Circular deps scan failed: ${err}`);
      res.status(500).json({ error: 'Circular deps scan failed' });
    }
  };

  /** GET /unused-exports — find exports nobody imports */
  getUnusedExports = (_req: Request, res: Response): void => {
    try {
      const unused = this.graph.findUnusedExports();
      const cleaned = unused.map(u => ({
        name: u.exportedName,
        type: u.chunk.type,
        filePath: u.chunk.filePath,
        startLine: u.chunk.startLine,
      }));
      res.json({ total: unused.length, unusedExports: cleaned });
    } catch (err) {
      logger.error(`Unused exports scan failed: ${err}`);
      res.status(500).json({ error: 'Unused exports scan failed' });
    }
  };

  /** GET /duplicates?threshold= — find near-duplicate code */
  getDuplicates = (req: Request, res: Response): void => {
    try {
      const threshold = parseFloat(req.query.threshold as string) || 0.92;
      const dupes = this.graph.findDuplicates(threshold);
      const cleaned = dupes.map(d => ({
        similarity: Math.round(d.similarity * 1000) / 1000,
        a: { name: d.a.name, type: d.a.type, filePath: d.a.filePath, startLine: d.a.startLine, endLine: d.a.endLine },
        b: { name: d.b.name, type: d.b.type, filePath: d.b.filePath, startLine: d.b.startLine, endLine: d.b.endLine },
      }));
      res.json({ total: dupes.length, threshold, duplicates: cleaned });
    } catch (err) {
      logger.error(`Duplicates scan failed: ${err}`);
      res.status(500).json({ error: 'Duplicates scan failed' });
    }
  };

  /** GET /impact-chain?name=&depth= — full transitive impact analysis */
  getImpactChain = (req: Request, res: Response): void => {
    try {
      const name = req.query.name as string;
      if (!name) {
        res.status(400).json({ error: 'Missing "name" query parameter' });
        return;
      }
      const depth = parseInt(req.query.depth as string) || 5;
      const impact = this.graph.getFullImpactChain(name, depth);
      res.json({ symbolName: name, depth, ...impact });
    } catch (err) {
      logger.error(`Impact chain failed: ${err}`);
      res.status(500).json({ error: 'Impact chain failed' });
    }
  };

  /** GET /dead-code — find unreferenced symbols */
  getDeadCode = (req: Request, res: Response): void => {
    try {
      const includeEntryPoints = req.query.includeEntryPoints === 'true';
      const dead = this.graph.findDeadCode({ includeEntryPoints });
      const cleaned = dead.map(d => ({
        name: d.chunk.name,
        type: d.chunk.type,
        filePath: d.chunk.filePath,
        startLine: d.chunk.startLine,
        endLine: d.chunk.endLine,
        reason: d.reason,
      }));
      res.json({ total: dead.length, deadCode: cleaned });
    } catch (err) {
      logger.error(`Dead code scan failed: ${err}`);
      res.status(500).json({ error: 'Dead code scan failed' });
    }
  };

  /** GET /importers?path= — find all symbols that import from a file */
  getImporters = (req: Request, res: Response): void => {
    try {
      const filePath = req.query.path as string;
      if (!filePath) {
        res.status(400).json({ error: 'Missing "path" query parameter' });
        return;
      }
      const importers = this.graph.findImporters(filePath);
      const cleaned = importers.map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
        filePath: c.filePath,
        startLine: c.startLine,
      }));
      res.json({ filePath, importers: cleaned, total: importers.length });
    } catch (err) {
      logger.error(`Get importers failed: ${err}`);
      res.status(500).json({ error: 'Failed to get importers' });
    }
  };

  /** GET /grep?pattern=&filePattern=&maxResults=&context= — regex search across source files */
  codeGrep = (req: Request, res: Response): void => {
    try {
      const pattern = req.query.pattern as string;
      if (!pattern) {
        res.status(400).json({ error: 'Missing "pattern" query parameter' });
        return;
      }

      let regex: RegExp;
      try {
        regex = new RegExp(pattern, 'gi');
      } catch (err) {
        res.status(400).json({ error: `Invalid regex: ${err}` });
        return;
      }

      const filePattern = req.query.filePattern as string | undefined;
      const maxResults = parseInt(req.query.maxResults as string) || 50;
      const contextLines = parseInt(req.query.context as string) || 1;

      const allFiles = this.vectorDB.getFilePaths();
      const filesToSearch = filePattern
        ? allFiles.filter(f => f.replace(/\\/g, '/').toLowerCase().includes(filePattern.toLowerCase()))
        : allFiles;

      const fs = require('fs');
      const results: Array<{ file: string; matches: Array<{ line: number; text: string }> }> = [];
      let totalMatches = 0;

      for (const filePath of filesToSearch) {
        if (totalMatches >= maxResults) break;
        let content: string;
        try {
          if (!fs.existsSync(filePath)) continue;
          content = fs.readFileSync(filePath, 'utf-8');
        } catch { continue; }

        const lines = content.split('\n');
        const fileMatches: Array<{ line: number; text: string }> = [];

        for (let i = 0; i < lines.length; i++) {
          if (totalMatches >= maxResults) break;
          regex.lastIndex = 0;
          if (regex.test(lines[i])) {
            fileMatches.push({ line: i + 1, text: lines[i].trim() });
            totalMatches++;
          }
        }

        if (fileMatches.length > 0) {
          results.push({ file: filePath, matches: fileMatches });
        }
      }

      res.json({
        pattern,
        totalMatches,
        filesSearched: filesToSearch.length,
        filesWithMatches: results.length,
        results,
      });
    } catch (err) {
      logger.error(`Code grep failed: ${err}`);
      res.status(500).json({ error: 'Code grep failed' });
    }
  };

  /** GET /stats — get index statistics */
  getStats = (_req: Request, res: Response): void => {
    res.json({
      totalChunks: this.vectorDB.size,
      totalFiles: this.metadataDB.size,
      files: this.metadataDB.getAllFiles(),
    });
  };
}
