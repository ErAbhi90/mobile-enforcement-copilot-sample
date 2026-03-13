/**
 * SessionManager.test.ts
 *
 * Unit tests for the SessionManager.
 *
 * ISecureStorageService is mocked in-line so no native storage is touched.
 * jest.useFakeTimers lets tests fast-forward the clock to verify expiry logic.
 *
 * Test plan:
 *  - startSession writes a JSON-encoded SessionData with the correct userId
 *    and a recent createdAt timestamp.
 *  - isSessionValid returns true for a freshly created session.
 *  - isSessionValid returns false after exactly SESSION_DURATION_MS has elapsed.
 *  - isSessionValid returns false when no session exists.
 *  - getSessionData returns null when the stored value is absent.
 *  - getSessionData returns null when the stored value is corrupted JSON.
 *  - clearSession removes the session key from storage.
 */

import { SessionManager, SESSION_DURATION_MS } from '../../src/auth/SessionManager';
import { ISecureStorageService } from '../../src/storage/SecureStorageService';

const mockStorage: jest.Mocked<ISecureStorageService> = {
  setItem: jest.fn(),
  getItem: jest.fn(),
  removeItem: jest.fn(),
  clearAll: jest.fn(),
};

describe('SessionManager', () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    sessionManager = new SessionManager(mockStorage);
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('startSession', () => {
    it('should persist a session with the correct userId', async () => {
      mockStorage.setItem.mockResolvedValue(undefined);
      jest.setSystemTime(new Date('2024-01-01T08:00:00Z'));

      await sessionManager.startSession('user-123');

      const [key, rawValue] = mockStorage.setItem.mock.calls[0];
      expect(key).toBe('auth_session_data');
      const parsed = JSON.parse(rawValue);
      expect(parsed.userId).toBe('user-123');
      expect(typeof parsed.createdAt).toBe('number');
    });
  });

  describe('isSessionValid', () => {
    it('should return true for a session created just now', async () => {
      const now = Date.now();
      mockStorage.getItem.mockResolvedValue(
        JSON.stringify({ userId: 'user-123', createdAt: now }),
      );
      expect(await sessionManager.isSessionValid()).toBe(true);
    });

    it('should return true for a session created 9 hours and 59 minutes ago', async () => {
      const justUnder10h = Date.now() - SESSION_DURATION_MS + 60_000;
      mockStorage.getItem.mockResolvedValue(
        JSON.stringify({ userId: 'user-123', createdAt: justUnder10h }),
      );
      expect(await sessionManager.isSessionValid()).toBe(true);
    });

    it('should return false for a session created exactly 10 hours ago', async () => {
      const exactly10h = Date.now() - SESSION_DURATION_MS;
      mockStorage.getItem.mockResolvedValue(
        JSON.stringify({ userId: 'user-123', createdAt: exactly10h }),
      );
      expect(await sessionManager.isSessionValid()).toBe(false);
    });

    it('should return false when no session is stored', async () => {
      mockStorage.getItem.mockResolvedValue(null);
      expect(await sessionManager.isSessionValid()).toBe(false);
    });
  });

  describe('getSessionData', () => {
    it('should return null when storage returns null', async () => {
      mockStorage.getItem.mockResolvedValue(null);
      expect(await sessionManager.getSessionData()).toBeNull();
    });

    it('should return null for corrupted JSON', async () => {
      mockStorage.getItem.mockResolvedValue('not-valid-json{{');
      expect(await sessionManager.getSessionData()).toBeNull();
    });

    it('should return the parsed SessionData', async () => {
      const data = { userId: 'user-abc', createdAt: 1700000000000 };
      mockStorage.getItem.mockResolvedValue(JSON.stringify(data));
      const result = await sessionManager.getSessionData();
      expect(result).toEqual(data);
    });
  });

  describe('clearSession', () => {
    it('should remove the session key from storage', async () => {
      mockStorage.removeItem.mockResolvedValue(undefined);
      await sessionManager.clearSession();
      expect(mockStorage.removeItem).toHaveBeenCalledWith('auth_session_data');
    });
  });
});
