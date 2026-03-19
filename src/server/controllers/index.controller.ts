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

  /** GET /stats — get index statistics */
  getStats = (_req: Request, res: Response): void => {
    res.json({
      totalChunks: this.vectorDB.size,
      totalFiles: this.metadataDB.size,
      files: this.metadataDB.getAllFiles(),
    });
  };
}
