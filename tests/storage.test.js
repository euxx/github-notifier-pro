import { describe, it, expect, vi, beforeEach } from 'vitest';

// Create mock Chrome storage API
const mockStorage = {
  local: {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
  },
};

// Mock chrome global before importing storage
vi.stubGlobal('chrome', { storage: mockStorage });

// Import after mock is set up
const storage = await import('../src/lib/storage.js');

describe('Storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('get', () => {
    it('should return stored value', async() => {
      mockStorage.local.get.mockImplementation((key, callback) => {
        callback({ testKey: 'testValue' });
      });

      const result = await storage.get('testKey');
      expect(result).toBe('testValue');
    });

    it('should return default value when key not found', async() => {
      mockStorage.local.get.mockImplementation((key, callback) => {
        callback({});
      });

      const result = await storage.get('missingKey', 'defaultValue');
      expect(result).toBe('defaultValue');
    });

    it('should return null as default when no default provided', async() => {
      mockStorage.local.get.mockImplementation((key, callback) => {
        callback({});
      });

      const result = await storage.get('missingKey');
      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('should set value in storage', async() => {
      mockStorage.local.set.mockImplementation((data, callback) => {
        callback();
      });

      await storage.set('testKey', 'testValue');

      expect(mockStorage.local.set).toHaveBeenCalledWith(
        { testKey: 'testValue' },
        expect.any(Function),
      );
    });
  });

  describe('remove', () => {
    it('should remove key from storage', async() => {
      mockStorage.local.remove.mockImplementation((key, callback) => {
        callback();
      });

      await storage.remove('testKey');

      expect(mockStorage.local.remove).toHaveBeenCalledWith(
        'testKey',
        expect.any(Function),
      );
    });
  });

  describe('getMultiple', () => {
    it('should get multiple values', async() => {
      mockStorage.local.get.mockImplementation((keys, callback) => {
        callback({ key1: 'value1', key2: 'value2' });
      });

      const result = await storage.getMultiple(['key1', 'key2']);

      expect(result).toEqual({ key1: 'value1', key2: 'value2' });
    });
  });

  describe('setMultiple', () => {
    it('should set multiple values', async() => {
      mockStorage.local.set.mockImplementation((data, callback) => {
        callback();
      });

      await storage.setMultiple({ key1: 'value1', key2: 'value2' });

      expect(mockStorage.local.set).toHaveBeenCalledWith(
        { key1: 'value1', key2: 'value2' },
        expect.any(Function),
      );
    });
  });

  describe('clear', () => {
    it('should clear all storage', async() => {
      mockStorage.local.clear.mockImplementation((callback) => {
        callback();
      });

      await storage.clear();

      expect(mockStorage.local.clear).toHaveBeenCalled();
    });
  });

  describe('convenience methods', () => {
    beforeEach(() => {
      mockStorage.local.get.mockImplementation((key, callback) => {
        const data = {
          token: 'ghp_test',
          notifications: [{ id: '1' }],
        };
        callback({ [key]: data[key] });
      });

      mockStorage.local.set.mockImplementation((data, callback) => {
        callback();
      });
    });

    it('getToken should return token', async() => {
      const result = await storage.getToken();
      expect(result).toBe('ghp_test');
    });

    it('setToken should set token', async() => {
      await storage.setToken('new_token');
      expect(mockStorage.local.set).toHaveBeenCalledWith(
        { token: 'new_token' },
        expect.any(Function),
      );
    });

    it('getNotifications should return notifications with default', async() => {
      mockStorage.local.get.mockImplementation((key, callback) => {
        callback({});
      });
      const result = await storage.getNotifications();
      expect(result).toEqual([]);
    });

    it('setNotifications should set notifications', async() => {
      const notifications = [{ id: '1' }, { id: '2' }];
      await storage.setNotifications(notifications);
      expect(mockStorage.local.set).toHaveBeenCalledWith(
        { notifications },
        expect.any(Function),
      );
    });
  });

  describe('STORAGE_KEYS export', () => {
    it('should export all storage keys', () => {
      expect(storage.STORAGE_KEYS).toBeDefined();
      expect(storage.STORAGE_KEYS.TOKEN).toBe('token');
      expect(storage.STORAGE_KEYS.USERNAME).toBe('username');
      expect(storage.STORAGE_KEYS.AUTH_METHOD).toBe('authMethod');
      expect(storage.STORAGE_KEYS.NOTIFICATIONS).toBe('notifications');
      expect(storage.STORAGE_KEYS.THEME).toBe('theme');
      expect(storage.STORAGE_KEYS.POPUP_WIDTH).toBe('popupWidth');
    });
  });
});
