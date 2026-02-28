import { describe, it, expect, vi, beforeEach } from 'vitest';

// Create mock Chrome storage API (Promise-based, matching Chrome MV3 / Firefox)
const mockStorage = {
  local: {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
  },
  onChanged: { addListener: vi.fn() },
};

const mockListener = { addListener: vi.fn() };

// Mock chrome global before importing storage (includes all APIs needed by chrome-api.js)
vi.stubGlobal('chrome', {
  storage: mockStorage,
  runtime: {
    sendMessage: vi.fn(),
    onMessage: mockListener,
    onStartup: mockListener,
    onInstalled: mockListener,
    getURL: vi.fn(),
  },
  action: {
    setBadgeText: vi.fn(),
    setBadgeBackgroundColor: vi.fn(),
    setTitle: vi.fn(),
  },
  alarms: {
    create: vi.fn(),
    clear: vi.fn(),
    getAll: vi.fn(),
    onAlarm: mockListener,
  },
  tabs: { create: vi.fn() },
  notifications: {
    create: vi.fn(),
    clear: vi.fn(),
    onClicked: mockListener,
  },
});

// Import after mock is set up
const storage = await import('../src/lib/storage.js');

describe('Storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('get', () => {
    it('should return stored value', async () => {
      mockStorage.local.get.mockResolvedValue({ testKey: 'testValue' });

      const result = await storage.get('testKey');
      expect(result).toBe('testValue');
    });

    it('should return default value when key not found', async () => {
      mockStorage.local.get.mockResolvedValue({});

      const result = await storage.get('missingKey', 'defaultValue');
      expect(result).toBe('defaultValue');
    });

    it('should return null as default when no default provided', async () => {
      mockStorage.local.get.mockResolvedValue({});

      const result = await storage.get('missingKey');
      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('should set value in storage', async () => {
      mockStorage.local.set.mockResolvedValue(undefined);

      await storage.set('testKey', 'testValue');

      expect(mockStorage.local.set).toHaveBeenCalledWith({ testKey: 'testValue' });
    });
  });

  describe('remove', () => {
    it('should remove key from storage', async () => {
      mockStorage.local.remove.mockResolvedValue(undefined);

      await storage.remove('testKey');

      expect(mockStorage.local.remove).toHaveBeenCalledWith('testKey');
    });
  });

  describe('getMultiple', () => {
    it('should get multiple values', async () => {
      mockStorage.local.get.mockResolvedValue({ key1: 'value1', key2: 'value2' });

      const result = await storage.getMultiple(['key1', 'key2']);

      expect(result).toEqual({ key1: 'value1', key2: 'value2' });
    });
  });

  describe('setMultiple', () => {
    it('should set multiple values', async () => {
      mockStorage.local.set.mockResolvedValue(undefined);

      await storage.setMultiple({ key1: 'value1', key2: 'value2' });

      expect(mockStorage.local.set).toHaveBeenCalledWith({ key1: 'value1', key2: 'value2' });
    });
  });

  describe('clear', () => {
    it('should clear all storage', async () => {
      mockStorage.local.clear.mockResolvedValue(undefined);

      await storage.clear();

      expect(mockStorage.local.clear).toHaveBeenCalled();
    });
  });

  describe('clearAuthData', () => {
    it('should remove only auth and notification keys', async () => {
      mockStorage.local.remove.mockResolvedValue(undefined);

      await storage.clearAuthData();

      expect(mockStorage.local.remove).toHaveBeenCalledWith([
        'token',
        'username',
        'userInfo',
        'authMethod',
        'notifications',
        'lastCheck',
      ]);
    });

    it('should not call clear()', async () => {
      mockStorage.local.remove.mockResolvedValue(undefined);

      await storage.clearAuthData();

      expect(mockStorage.local.clear).not.toHaveBeenCalled();
    });
  });

  describe('convenience methods', () => {
    beforeEach(() => {
      mockStorage.local.get.mockImplementation((key) => {
        const data = {
          token: 'ghp_test',
          notifications: [{ id: '1' }],
        };
        return Promise.resolve({ [key]: data[key] });
      });

      mockStorage.local.set.mockResolvedValue(undefined);
    });

    it('getToken should return token', async () => {
      const result = await storage.getToken();
      expect(result).toBe('ghp_test');
    });

    it('setToken should set token', async () => {
      await storage.setToken('new_token');
      expect(mockStorage.local.set).toHaveBeenCalledWith({ token: 'new_token' });
    });

    it('getNotifications should return notifications with default', async () => {
      mockStorage.local.get.mockResolvedValue({});
      const result = await storage.getNotifications();
      expect(result).toEqual([]);
    });

    it('setNotifications should set notifications', async () => {
      const notifications = [{ id: '1' }, { id: '2' }];
      await storage.setNotifications(notifications);
      expect(mockStorage.local.set).toHaveBeenCalledWith({ notifications });
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

  describe('getMaxDesktopNotifications', () => {
    it('should return default value of 5', async () => {
      mockStorage.local.get.mockResolvedValue({});

      const result = await storage.getMaxDesktopNotifications();
      expect(result).toBe(5);
    });

    it.each([
      { input: 3, expected: 3, description: 'valid number (3)' },
      { input: -5, expected: 1, description: 'negative numbers to 1' },
      { input: 0, expected: 1, description: 'zero to 1' },
      { input: 100, expected: 5, description: 'numbers above 5' },
      { input: NaN, expected: 1, description: 'NaN and return 1' },
      { input: 'invalid', expected: 1, description: 'non-numeric strings and return 1' },
      { input: '3', expected: 3, description: 'numeric strings to numbers' },
      { input: 3.8, expected: 3, description: 'decimal numbers' },
    ])('should $description', async ({ input, expected }) => {
      mockStorage.local.get.mockResolvedValue({ maxDesktopNotifications: input });

      const result = await storage.getMaxDesktopNotifications();
      expect(result).toBe(expected);
    });
  });
});
