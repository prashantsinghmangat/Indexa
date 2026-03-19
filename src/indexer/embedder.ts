import * as crypto from 'crypto';
import { EmbeddingProvider } from '../types';
import { logger } from '../utils';
import { LocalEmbeddingProvider } from './local-embedder';

/**
 * Default embedding provider using deterministic hash-based vectors.
 * Produces consistent embeddings without external dependencies.
 * Can be replaced with OpenAI or local model embeddings.
 */
export class HashEmbeddingProvider implements EmbeddingProvider {
  readonly dimension: number;

  constructor(dimension: number = 128) {
    this.dimension = dimension;
  }

  async embed(text: string): Promise<number[]> {
    return this.hashToVector(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map(t => this.hashToVector(t));
  }

  /**
   * Convert text to a deterministic vector using SHA-512 hashing.
   * Tokens are hashed individually and combined for some semantic signal.
   */
  private hashToVector(text: string): number[] {
    const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const tokens = normalized.split(' ').filter(t => t.length > 1);

    const vector = new Array(this.dimension).fill(0);

    // Hash each token and accumulate into vector
    for (const token of tokens) {
      const hash = crypto.createHash('sha512').update(token).digest();
      for (let i = 0; i < this.dimension; i++) {
        // Use hash bytes to generate float values in [-1, 1]
        const byteIndex = i % hash.length;
        vector[i] += (hash[byteIndex] - 128) / 128;
      }
    }

    // Normalize to unit vector
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (magnitude > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= magnitude;
      }
    }

    return vector;
  }
}

/**
 * Create the best available embedding provider.
 * Prefers local ML model (Transformers.js), falls back to hash-based.
 */
export function createProvider(mode?: 'local' | 'hash'): EmbeddingProvider {
  if (mode === 'hash') {
    logger.info('Using hash-based embeddings (fast, no ML)');
    return new HashEmbeddingProvider();
  }

  // Default: try local ML model
  try {
    logger.info('Using local ML embeddings (Transformers.js, 384-dim)');
    return new LocalEmbeddingProvider();
  } catch {
    logger.warn('Local embeddings unavailable, falling back to hash-based');
    return new HashEmbeddingProvider();
  }
}

/**
 * Embedder that wraps any EmbeddingProvider.
 * Manages embedding generation for code chunks.
 */
export class Embedder {
  private provider: EmbeddingProvider;

  constructor(provider?: EmbeddingProvider) {
    this.provider = provider || createProvider();
  }

  /** Get the embedding dimension */
  get dimension(): number {
    return this.provider.dimension;
  }

  /** Embed a single text */
  async embed(text: string): Promise<number[]> {
    return this.provider.embed(text);
  }

  /** Embed multiple texts */
  async embedBatch(texts: string[]): Promise<number[][]> {
    logger.debug(`Embedding batch of ${texts.length} texts`);
    return this.provider.embedBatch(texts);
  }

  /** Create an embedding combining code and metadata for better retrieval */
  async embedChunk(code: string, name: string, type: string): Promise<number[]> {
    // Combine name, type, and code for richer embedding
    const text = `${type} ${name} ${code}`;
    return this.provider.embed(text);
  }
}
