import { EmbeddingProvider } from '../types';
import { logger } from '../utils';

/**
 * Local embedding provider using Transformers.js (Hugging Face).
 * Runs a real ML model locally — no API key, no internet after first download.
 * Model: Xenova/all-MiniLM-L6-v2 (~23MB, 384 dimensions).
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly dimension = 384;

  private extractor: any = null;
  private loading: Promise<void> | null = null;

  private loadFailed = false;

  /** Lazy-load the model on first use */
  private async ensureLoaded(): Promise<void> {
    if (this.extractor) return;
    if (this.loadFailed) return; // Don't retry failed loads
    if (this.loading) {
      await this.loading;
      return;
    }

    this.loading = (async () => {
      try {
        logger.info('Loading embedding model (first time downloads ~23MB)...');
        const { pipeline } = await import('@huggingface/transformers');
        this.extractor = await pipeline(
          'feature-extraction',
          'Xenova/all-MiniLM-L6-v2',
          { dtype: 'fp32' }
        );
        logger.info('Embedding model loaded.');
      } catch (err) {
        this.loadFailed = true;
        logger.error(`Failed to load embedding model: ${err instanceof Error ? err.message : err}`);
        logger.error('Falling back to hash-based embeddings. Re-index later for better quality.');
      }
    })();

    await this.loading;
  }

  async embed(text: string): Promise<number[]> {
    await this.ensureLoaded();

    // Fallback to hash-based embedding if model failed to load
    if (!this.extractor) {
      return this.hashEmbed(text);
    }

    // Truncate to ~512 tokens worth of text (~2000 chars) for model limits
    const truncated = text.length > 2000 ? text.substring(0, 2000) : text;

    try {
      const output = await this.extractor(truncated, {
        pooling: 'mean',
        normalize: true,
      });
      return Array.from(output.data as Float32Array).slice(0, this.dimension);
    } catch {
      return this.hashEmbed(text);
    }
  }

  /** Deterministic hash-based embedding fallback (128-dim) */
  private hashEmbed(text: string): number[] {
    const crypto = require('crypto');
    const hash = crypto.createHash('sha512').update(text).digest();
    const embedding = new Array(this.dimension);
    for (let i = 0; i < this.dimension; i++) {
      embedding[i] = (hash[i % hash.length] / 255) * 2 - 1;
    }
    return embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    await this.ensureLoaded();

    const results: number[][] = [];
    // Process in small batches to avoid memory issues
    const batchSize = 16;

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize).map(t =>
        t.length > 2000 ? t.substring(0, 2000) : t
      );

      for (const text of batch) {
        const output = await this.extractor(text, {
          pooling: 'mean',
          normalize: true,
        });
        results.push(Array.from(output.data as Float32Array).slice(0, this.dimension));
      }

      if (i + batchSize < texts.length) {
        logger.debug(`Embedded ${Math.min(i + batchSize, texts.length)}/${texts.length} chunks`);
      }
    }

    return results;
  }
}
