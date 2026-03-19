import { ParsedElement, CodeChunk } from '../types';
import { summarizeCode, hashContent, logger } from '../utils';

/** Maximum lines per chunk before splitting */
const MAX_CHUNK_LINES = 100;

/**
 * Converts parsed elements into indexable chunks.
 * Splits large elements and generates summaries.
 * Does NOT store code inline — code is read from disk via byte offsets.
 */
export class Chunker {
  /** Convert parsed elements to code chunks */
  chunkElements(elements: ParsedElement[]): CodeChunk[] {
    const chunks: CodeChunk[] = [];

    for (const element of elements) {
      const lineCount = element.code.split('\n').length;

      if (lineCount <= MAX_CHUNK_LINES) {
        chunks.push(this.toChunk(element));
      } else {
        chunks.push(...this.splitElement(element));
      }
    }

    logger.debug(`Chunked ${elements.length} elements into ${chunks.length} chunks`);
    return chunks;
  }

  /** Convert a single element to a chunk */
  private toChunk(element: ParsedElement): CodeChunk {
    return {
      id: element.id,
      name: element.name,
      type: element.type,
      summary: summarizeCode(element.code, element.name, element.type),
      filePath: element.filePath,
      startLine: element.startLine,
      endLine: element.endLine,
      byteOffset: element.byteOffset,
      byteLength: element.byteLength,
      dependencies: element.dependencies,
      imports: element.imports,
      contentHash: hashContent(element.code),
      // code is NOT stored — retrieved on demand via byteOffset
    };
  }

  /** Split a large element into smaller chunks */
  private splitElement(element: ParsedElement): CodeChunk[] {
    const lines = element.code.split('\n');
    const chunks: CodeChunk[] = [];
    let partIndex = 0;
    let currentByteOffset = element.byteOffset;

    for (let i = 0; i < lines.length; i += MAX_CHUNK_LINES) {
      const chunkLines = lines.slice(i, i + MAX_CHUNK_LINES);
      const code = chunkLines.join('\n');
      const name = `${element.name}_part${partIndex}`;
      const chunkByteLength = Buffer.byteLength(code, 'utf-8');

      chunks.push({
        id: `${element.id}~p${partIndex}`,
        name,
        type: element.type,
        summary: summarizeCode(code, name, element.type),
        filePath: element.filePath,
        startLine: element.startLine + i,
        endLine: element.startLine + i + chunkLines.length - 1,
        byteOffset: currentByteOffset,
        byteLength: chunkByteLength,
        dependencies: partIndex === 0 ? element.dependencies : [],
        imports: partIndex === 0 ? element.imports : [],
        contentHash: hashContent(code),
      });

      // +1 for the newline between chunks
      currentByteOffset += chunkByteLength + 1;
      partIndex++;
    }

    return chunks;
  }
}
