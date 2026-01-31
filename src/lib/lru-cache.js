/**
 * LRU (Least Recently Used) Cache implementation
 * Automatically evicts least recently used items when size limit is reached
 */
export class LRUCache {
  constructor(maxSize = 100) {
    this.maxSize = maxSize;
    this.cache = new Map(); // Map maintains insertion order in JavaScript
  }

  /**
   * Get value from cache
   * Moves item to end (most recently used)
   */
  get(key) {
    if (!this.cache.has(key)) {
      return undefined;
    }

    // Move to end (most recently used)
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);

    return value;
  }

  /**
   * Set value in cache
   * Evicts least recently used item if cache is full
   */
  set(key, value) {
    // If key exists, delete it first (will re-add at end)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // If cache is full, remove oldest item (first in Map)
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    // Add new item at end (most recently used)
    this.cache.set(key, value);
  }

  /**
   * Check if key exists in cache
   */
  has(key) {
    return this.cache.has(key);
  }

  /**
   * Get cache size
   */
  get size() {
    return this.cache.size;
  }

  /**
   * Clear all cache entries
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get cache statistics for debugging
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      utilization: `${(this.cache.size / this.maxSize * 100).toFixed(1)}%`,
      keys: Array.from(this.cache.keys()),
    };
  }
}
