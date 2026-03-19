/**
 * LRU query cache with TTL.
 * Avoids recomputation for repeated queries to context_bundle, flow, explain.
 */
export class QueryCache {
  private cache = new Map<string, { value: unknown; expiresAt: number }>();
  private maxSize: number;
  private ttlMs: number;

  constructor(maxSize: number = 100, ttlMinutes: number = 5) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMinutes * 60 * 1000;
  }

  /** Build a cache key from tool name + params */
  static key(tool: string, params: Record<string, unknown>): string {
    return `${tool}:${JSON.stringify(params)}`;
  }

  /** Get cached value, or undefined if miss/expired */
  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value as T;
  }

  /** Set a cached value */
  set(key: string, value: unknown): void {
    // Evict oldest if full
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  /** Invalidate all entries (e.g., after re-indexing) */
  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}
