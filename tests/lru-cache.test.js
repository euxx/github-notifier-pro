import { describe, it, expect, beforeEach } from 'vitest';
import { LRUCache } from '../src/lib/lru-cache.js';

describe('LRUCache', () => {
  let cache;

  beforeEach(() => {
    cache = new LRUCache(3); // Small size for testing
  });

  describe('basic operations', () => {
    it('should store and retrieve values', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('should return undefined for missing keys', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('should check if key exists', () => {
      cache.set('key1', 'value1');
      expect(cache.has('key1')).toBe(true);
      expect(cache.has('key2')).toBe(false);
    });

    it('should track size correctly', () => {
      expect(cache.size).toBe(0);
      cache.set('key1', 'value1');
      expect(cache.size).toBe(1);
      cache.set('key2', 'value2');
      expect(cache.size).toBe(2);
    });

    it('should clear all entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.has('key1')).toBe(false);
    });
  });

  describe('LRU eviction', () => {
    it('should evict oldest item when full', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      // Cache is full (size 3), adding 'd' should evict 'a'
      cache.set('d', 4);

      expect(cache.has('a')).toBe(false); // Evicted
      expect(cache.has('b')).toBe(true);
      expect(cache.has('c')).toBe(true);
      expect(cache.has('d')).toBe(true);
      expect(cache.size).toBe(3);
    });

    it('should move accessed items to end (most recently used)', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      // Access 'a', making it most recently used
      cache.get('a');

      // Now add 'd', should evict 'b' (oldest after 'a' was accessed)
      cache.set('d', 4);

      expect(cache.has('a')).toBe(true); // Not evicted because accessed
      expect(cache.has('b')).toBe(false); // Evicted
      expect(cache.has('c')).toBe(true);
      expect(cache.has('d')).toBe(true);
    });

    it('should not increase size when updating existing key', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      // Update existing key
      cache.set('key1', 'updated');

      expect(cache.size).toBe(3);
      expect(cache.get('key1')).toBe('updated');
    });

    it('should move updated key to end', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      // Update 'a', moving it to end
      cache.set('a', 'updated');

      // Add 'd', should evict 'b' (now oldest)
      cache.set('d', 4);

      expect(cache.has('a')).toBe(true);
      expect(cache.has('b')).toBe(false);
      expect(cache.has('c')).toBe(true);
      expect(cache.has('d')).toBe(true);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      cache.set('a', 1);
      cache.set('b', 2);

      const stats = cache.getStats();

      expect(stats.size).toBe(2);
      expect(stats.maxSize).toBe(3);
      expect(stats.utilization).toBe('66.7%');
      expect(stats.keys).toEqual(['a', 'b']);
    });

    it('should show 0% utilization when empty', () => {
      const stats = cache.getStats();
      expect(stats.utilization).toBe('0.0%');
    });

    it('should show 100% utilization when full', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      const stats = cache.getStats();
      expect(stats.utilization).toBe('100.0%');
    });
  });

  describe('edge cases', () => {
    it('should handle single item cache', () => {
      const singleCache = new LRUCache(1);

      singleCache.set('a', 1);
      expect(singleCache.get('a')).toBe(1);

      singleCache.set('b', 2);
      expect(singleCache.has('a')).toBe(false);
      expect(singleCache.get('b')).toBe(2);
      expect(singleCache.size).toBe(1);
    });

    it('should handle default max size', () => {
      const defaultCache = new LRUCache();
      expect(defaultCache.maxSize).toBe(100);
    });

    it('should handle various value types', () => {
      const largeCache = new LRUCache(10);
      largeCache.set('string', 'hello');
      largeCache.set('number', 42);
      largeCache.set('object', { foo: 'bar' });
      largeCache.set('array', [1, 2, 3]);
      largeCache.set('null', null);

      expect(largeCache.get('string')).toBe('hello');
      expect(largeCache.get('number')).toBe(42);
      expect(largeCache.get('object')).toEqual({ foo: 'bar' });
      expect(largeCache.get('array')).toEqual([1, 2, 3]);
      expect(largeCache.get('null')).toBe(null);
    });

    it('should handle repeated access of same key', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      // Access 'a' multiple times
      cache.get('a');
      cache.get('a');
      cache.get('a');

      // Add 'd', should still evict 'b'
      cache.set('d', 4);

      expect(cache.has('a')).toBe(true);
      expect(cache.has('b')).toBe(false);
    });
  });
});
