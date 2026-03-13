/**
 * AuthService.test.ts
 *
 * Unit tests for AuthService — the central authentication hub.
 *
 * All I/O dependencies (storage, sessionManager, apiClient) are mocked so
 * the tests exercise pure business logic with no I/O side-effects.
 *
 * Test plan:
 *
 * login()
 *  - Calls apiClient.authenticate with the supplied credentials.
 *  - Stores the access and refresh tokens under the correct keys.
 *  - Starts a session for the authenticated user.
 *  - Emits an authenticated state with the user object.
 *  - Transitions through a loading state before resolving.
 *  - Sets an error state and re-throws on API failure.
 *  - Aborts (throws, emits error state exactly once) when logout() is called
 *    while the API call is in flight — regardless of whether the logout is
 *    still in progress or has already completed when the API returns.
 *  - Does NOT write tokens to storage when it aborts.
 *
 * logout()
 *  - Removes both tokens and clears the session.
 *  - Emits a logged-out state carrying the logout reason.
 *  - Ignores duplicate concurrent calls (deduplication guard).
 *  - Emits the logged-out state even when storage cleanup throws.
 *
 * isAuthenticated()
 *  - Returns true when a token exists AND the session is valid.
 *  - Returns false when no token is stored.
 *  - Returns false when the session is expired.
 *
 * onStateChange()
 *  - Calls the listener immediately with the current state.
 *  - Calls the listener on every subsequent state change.
 *  - The returned unsubscribe function stops future notifications.
 */

import { AuthService, IAuthApiClient } from '../../src/auth/AuthService';
import { ISecureStorageService } from '../../src/storage/SecureStorageService';
import { ISessionManager } from '../../src/auth/SessionManager';
import { AuthState, AuthTokens, LoginCredentials, LogoutReason } from '../../src/types/auth.types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockStorage: jest.Mocked<ISecureStorageService> = {
  setItem: jest.fn(),
  getItem: jest.fn(),
  removeItem: jest.fn(),
  clearAll: jest.fn(),
};

const mockSessionManager: jest.Mocked<ISessionManager> = {
  startSession: jest.fn(),
  getSessionData: jest.fn(),
  isSessionValid: jest.fn(),
  clearSession: jest.fn(),
};

const mockApiClient: jest.Mocked<IAuthApiClient> = {
  authenticate: jest.fn(),
};

const validTokens: AuthTokens = {
  accessToken: 'access-token-abc',
  refreshToken: 'refresh-token-xyz',
  user: { id: 'user-1', username: 'officer1', email: 'o1@hq.gov', role: 'officer' },
};

const credentials: LoginCredentials = { username: 'officer1', password: 's3cret' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuthService', () => {
  let authService: AuthService;

  beforeEach(() => {
    authService = new AuthService(mockStorage, mockSessionManager, mockApiClient);
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // login
  // -------------------------------------------------------------------------

  describe('login()', () => {
    it('should call the API with the supplied credentials', async () => {
      mockApiClient.authenticate.mockResolvedValue(validTokens);
      mockStorage.setItem.mockResolvedValue(undefined);
      mockSessionManager.startSession.mockResolvedValue(undefined);

      await authService.login(credentials);

      expect(mockApiClient.authenticate).toHaveBeenCalledWith(credentials);
    });

    it('should store both tokens after a successful login', async () => {
      mockApiClient.authenticate.mockResolvedValue(validTokens);
      mockStorage.setItem.mockResolvedValue(undefined);
      mockSessionManager.startSession.mockResolvedValue(undefined);

      await authService.login(credentials);

      expect(mockStorage.setItem).toHaveBeenCalledWith(
        'auth_access_token',
        validTokens.accessToken,
      );
      expect(mockStorage.setItem).toHaveBeenCalledWith(
        'auth_refresh_token',
        validTokens.refreshToken,
      );
    });

    it('should start a session for the authenticated user', async () => {
      mockApiClient.authenticate.mockResolvedValue(validTokens);
      mockStorage.setItem.mockResolvedValue(undefined);
      mockSessionManager.startSession.mockResolvedValue(undefined);

      await authService.login(credentials);

      expect(mockSessionManager.startSession).toHaveBeenCalledWith(validTokens.user.id);
    });

    it('should emit an authenticated state with the user after login', async () => {
      mockApiClient.authenticate.mockResolvedValue(validTokens);
      mockStorage.setItem.mockResolvedValue(undefined);
      mockSessionManager.startSession.mockResolvedValue(undefined);

      const states: AuthState[] = [];
      authService.onStateChange(s => states.push({ ...s }));
      // Clear the initial state emitted by onStateChange subscription
      states.length = 0;

      await authService.login(credentials);

      const finalState = states[states.length - 1];
      expect(finalState.isAuthenticated).toBe(true);
      expect(finalState.user).toEqual(validTokens.user);
      expect(finalState.isLoading).toBe(false);
    });

    it('should pass through a loading state before resolving', async () => {
      mockApiClient.authenticate.mockResolvedValue(validTokens);
      mockStorage.setItem.mockResolvedValue(undefined);
      mockSessionManager.startSession.mockResolvedValue(undefined);

      const loadingValues: boolean[] = [];
      authService.onStateChange(s => loadingValues.push(s.isLoading));
      loadingValues.length = 0; // drop initial state

      await authService.login(credentials);

      expect(loadingValues).toContain(true);
      expect(loadingValues[loadingValues.length - 1]).toBe(false);
    });

    it('should set an error state and re-throw when the API fails', async () => {
      const apiError = new Error('Invalid credentials');
      mockApiClient.authenticate.mockRejectedValue(apiError);

      const errorStates: AuthState[] = [];
      authService.onStateChange(s => {
        if (s.error) errorStates.push({ ...s });
      });

      await expect(authService.login(credentials)).rejects.toThrow('Invalid credentials');

      expect(errorStates.length).toBeGreaterThan(0);
      expect(errorStates[0].isAuthenticated).toBe(false);
      expect(errorStates[0].error).toBe('Invalid credentials');
    });

    it('should abort login and emit error state exactly once when logout fires during the API call', async () => {
      // Sub-case (a): logout is still in progress when the API response arrives.
      // We trigger logout() from inside the authenticate mock so it sets the
      // logoutGeneration counter synchronously while the storage cleanup is still
      // pending. No private-field access required.
      mockStorage.removeItem.mockResolvedValue(undefined);
      mockSessionManager.clearSession.mockResolvedValue(undefined);

      mockApiClient.authenticate.mockImplementation(async () => {
        // Start a concurrent logout — this increments logoutGeneration synchronously.
        void authService.logout(LogoutReason.FORCE_LOGOUT);
        return validTokens;
      });

      const errorStates: AuthState[] = [];
      authService.onStateChange(s => {
        if (s.error) errorStates.push({ ...s });
      });

      await expect(authService.login(credentials)).rejects.toThrow(
        'Login aborted: logged out during authentication',
      );

      // Tokens should NOT have been written.
      expect(mockStorage.setItem).not.toHaveBeenCalled();

      // Error state should have been emitted exactly once (no double-emit).
      expect(errorStates).toHaveLength(1);
      expect(errorStates[0].isAuthenticated).toBe(false);
    });

    it('should abort login even when the concurrent logout fully completes before the API returns', async () => {
      // Sub-case (b): logout starts AND finishes (storage cleared) before the API
      // response arrives. The old isLoggingOut flag would have been reset to false
      // already, but the logoutGeneration counter detects the completed logout.
      mockStorage.removeItem.mockResolvedValue(undefined);
      mockSessionManager.clearSession.mockResolvedValue(undefined);

      let resolveAuthenticate!: (value: typeof validTokens) => void;
      mockApiClient.authenticate.mockReturnValue(
        new Promise<typeof validTokens>(resolve => {
          resolveAuthenticate = resolve;
        }),
      );

      const loginPromise = authService.login(credentials);

      // Fully await the logout so storage cleanup and the isLoggingOut reset
      // both complete before the API response arrives.
      await authService.logout(LogoutReason.FORCE_LOGOUT);

      // Now deliver the API response — login should still abort.
      resolveAuthenticate(validTokens);

      await expect(loginPromise).rejects.toThrow(
        'Login aborted: logged out during authentication',
      );
      expect(mockStorage.setItem).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // logout
  // -------------------------------------------------------------------------

  describe('logout()', () => {
    it('should remove both tokens and clear the session', async () => {
      mockStorage.removeItem.mockResolvedValue(undefined);
      mockSessionManager.clearSession.mockResolvedValue(undefined);

      await authService.logout();

      expect(mockStorage.removeItem).toHaveBeenCalledWith('auth_access_token');
      expect(mockStorage.removeItem).toHaveBeenCalledWith('auth_refresh_token');
      expect(mockSessionManager.clearSession).toHaveBeenCalledTimes(1);
    });

    it('should emit a logged-out state with the correct logout reason', async () => {
      mockStorage.removeItem.mockResolvedValue(undefined);
      mockSessionManager.clearSession.mockResolvedValue(undefined);

      let capturedState: AuthState | undefined;
      authService.onStateChange(s => {
        if (s.logoutReason) capturedState = { ...s };
      });

      await authService.logout(LogoutReason.FORCE_LOGOUT);

      expect(capturedState?.isAuthenticated).toBe(false);
      expect(capturedState?.logoutReason).toBe(LogoutReason.FORCE_LOGOUT);
    });

    it('should not perform duplicate logouts when called concurrently', async () => {
      mockStorage.removeItem.mockResolvedValue(undefined);
      mockSessionManager.clearSession.mockResolvedValue(undefined);

      // Both calls start at the same time; the guard should allow only one.
      await Promise.all([authService.logout(), authService.logout()]);

      expect(mockSessionManager.clearSession).toHaveBeenCalledTimes(1);
    });

    it('should default to USER_INITIATED reason when none is provided', async () => {
      mockStorage.removeItem.mockResolvedValue(undefined);
      mockSessionManager.clearSession.mockResolvedValue(undefined);

      let capturedState: AuthState | undefined;
      authService.onStateChange(s => {
        if (s.logoutReason) capturedState = { ...s };
      });

      await authService.logout();

      expect(capturedState?.logoutReason).toBe(LogoutReason.USER_INITIATED);
    });

    it('should emit the logged-out state even when storage cleanup throws', async () => {
      mockStorage.removeItem.mockRejectedValue(new Error('Storage failure'));
      mockSessionManager.clearSession.mockRejectedValue(new Error('Session clear failure'));

      let capturedState: AuthState | undefined;
      authService.onStateChange(s => {
        if (s.logoutReason) capturedState = { ...s };
      });

      // logout() must not throw even when cleanup fails.
      await expect(authService.logout(LogoutReason.SESSION_EXPIRED)).resolves.toBeUndefined();

      // The UI must still receive the logged-out transition.
      expect(capturedState?.isAuthenticated).toBe(false);
      expect(capturedState?.logoutReason).toBe(LogoutReason.SESSION_EXPIRED);
    });
  });

  // -------------------------------------------------------------------------
  // isAuthenticated
  // -------------------------------------------------------------------------

  describe('isAuthenticated()', () => {
    it('should return true when a token exists and the session is valid', async () => {
      mockStorage.getItem.mockResolvedValue('some-token');
      mockSessionManager.isSessionValid.mockResolvedValue(true);

      expect(await authService.isAuthenticated()).toBe(true);
    });

    it('should return false when no token is stored', async () => {
      mockStorage.getItem.mockResolvedValue(null);

      expect(await authService.isAuthenticated()).toBe(false);
      expect(mockSessionManager.isSessionValid).not.toHaveBeenCalled();
    });

    it('should return false when the session has expired', async () => {
      mockStorage.getItem.mockResolvedValue('some-token');
      mockSessionManager.isSessionValid.mockResolvedValue(false);

      expect(await authService.isAuthenticated()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // onStateChange
  // -------------------------------------------------------------------------

  describe('onStateChange()', () => {
    it('should call the listener immediately with the current state', () => {
      const listener = jest.fn();
      authService.onStateChange(listener);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ isAuthenticated: false, isLoading: false }),
      );
    });

    it('should stop notifying after the returned unsubscribe is called', async () => {
      mockApiClient.authenticate.mockResolvedValue(validTokens);
      mockStorage.setItem.mockResolvedValue(undefined);
      mockSessionManager.startSession.mockResolvedValue(undefined);

      const listener = jest.fn();
      const unsubscribe = authService.onStateChange(listener);
      const callCountBeforeUnsub = listener.mock.calls.length;

      unsubscribe();

      await authService.login(credentials);

      // No new calls after unsubscribe
      expect(listener.mock.calls.length).toBe(callCountBeforeUnsub);
    });
  });
});
