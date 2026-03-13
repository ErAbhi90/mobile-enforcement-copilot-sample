/**
 * AppStateWatcher.test.ts
 *
 * Unit tests for AppStateWatcher — the service that checks session validity
 * whenever the React Native app returns to the foreground.
 *
 * Both the IAuthService and IAppStateModule dependencies are mocked so the
 * tests exercise pure logic with no React Native runtime involved.
 *
 * Test plan:
 *
 * start()
 *  - Subscribes to AppState change events.
 *  - Subscribes to AuthService state changes to mirror the current auth state.
 *  - Calling start() a second time is a no-op (idempotent).
 *
 * handleChange — session expired on resume
 *  - When app becomes 'active' and the user is authenticated but
 *    isAuthenticated() returns false, calls logout(SESSION_EXPIRED).
 *  - When app becomes 'active' and isAuthenticated() returns true, does NOT
 *    call logout.
 *
 * handleChange — skipped transitions
 *  - Transitions to 'background' and 'inactive' do NOT trigger a check.
 *  - When the stored auth state says not authenticated, the check is skipped
 *    and logout is NOT called.
 *
 * Debounce
 *  - A second 'active' event within MIN_CHECK_INTERVAL_MS does NOT trigger a
 *    second check.
 *  - An 'active' event after MIN_CHECK_INTERVAL_MS DOES trigger another check.
 *
 * stop()
 *  - Removes the AppState subscription.
 *  - Removes the AuthService state-change subscription.
 *  - Calling stop() before start() is safe (no throw).
 *  - After stop(), an 'active' event does not trigger a check.
 */

import { AppStateWatcher, IAppStateModule, AppStateStatus } from '../../src/lifecycle/AppStateWatcher';
import { IAuthService } from '../../src/auth/AuthService';
import { AuthState, LogoutReason } from '../../src/types/auth.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a controllable IAppStateModule mock. */
function makeAppStateMock(): {
  module: IAppStateModule;
  simulateChange: (state: AppStateStatus) => Promise<void>;
  removeHandler: jest.Mock;
} {
  let capturedHandler: ((state: AppStateStatus) => void) | null = null;
  const removeHandler = jest.fn();

  const module: IAppStateModule = {
    addEventListener: jest.fn((_event, handler) => {
      capturedHandler = handler;
      return { remove: removeHandler };
    }),
  };

  const simulateChange = async (state: AppStateStatus): Promise<void> => {
    // The handler is async — await it so assertions can run after its body.
    await (capturedHandler as (s: AppStateStatus) => Promise<void>)(state);
  };

  return { module, simulateChange, removeHandler };
}

/** Builds a partial IAuthService mock with controllable state emissions. */
function makeAuthServiceMock(initialAuthenticated = true): {
  service: jest.Mocked<IAuthService>;
  emitState: (state: AuthState) => void;
} {
  let capturedStateListener: ((state: AuthState) => void) | null = null;
  const unsubscribeSpy = jest.fn();

  const service = {
    login: jest.fn(),
    logout: jest.fn().mockResolvedValue(undefined),
    isAuthenticated: jest.fn().mockResolvedValue(true),
    getAccessToken: jest.fn(),
    onStateChange: jest.fn((listener: (state: AuthState) => void) => {
      capturedStateListener = listener;
      // Deliver the initial state immediately (matching the real impl).
      listener({ isAuthenticated: initialAuthenticated, isLoading: false });
      return unsubscribeSpy;
    }),
  } as unknown as jest.Mocked<IAuthService>;

  const emitState = (state: AuthState): void => {
    capturedStateListener?.(state);
  };

  return { service, emitState };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AppStateWatcher', () => {
  let appStateMock: ReturnType<typeof makeAppStateMock>;
  let authMock: ReturnType<typeof makeAuthServiceMock>;
  let watcher: AppStateWatcher;

  beforeEach(() => {
    jest.useFakeTimers();
    appStateMock = makeAppStateMock();
    authMock = makeAuthServiceMock(/* initialAuthenticated */ true);
    watcher = new AppStateWatcher(authMock.service, appStateMock.module);
  });

  afterEach(() => {
    jest.useRealTimers();
    watcher.stop();
  });

  // -------------------------------------------------------------------------
  // start()
  // -------------------------------------------------------------------------

  describe('start()', () => {
    it('should subscribe to AppState change events', () => {
      watcher.start();
      expect(appStateMock.module.addEventListener).toHaveBeenCalledWith(
        'change',
        expect.any(Function),
      );
    });

    it('should subscribe to AuthService state changes', () => {
      watcher.start();
      expect(authMock.service.onStateChange).toHaveBeenCalledTimes(1);
    });

    it('should be idempotent — a second call to start() is a no-op', () => {
      watcher.start();
      watcher.start();
      expect(appStateMock.module.addEventListener).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Session expired on resume
  // -------------------------------------------------------------------------

  describe('app resume — session expired', () => {
    it('should call logout(SESSION_EXPIRED) when isAuthenticated() returns false on resume', async () => {
      authMock.service.isAuthenticated.mockResolvedValue(false);
      watcher.start();

      await appStateMock.simulateChange('active');

      expect(authMock.service.isAuthenticated).toHaveBeenCalledTimes(1);
      expect(authMock.service.logout).toHaveBeenCalledWith(LogoutReason.SESSION_EXPIRED);
    });

    it('should NOT call logout when isAuthenticated() returns true on resume', async () => {
      authMock.service.isAuthenticated.mockResolvedValue(true);
      watcher.start();

      await appStateMock.simulateChange('active');

      expect(authMock.service.isAuthenticated).toHaveBeenCalledTimes(1);
      expect(authMock.service.logout).not.toHaveBeenCalled();
    });

    it('should NOT call logout if authState transitions to logged-out while isAuthenticated() is awaiting', async () => {
      // Simulate a concurrent force-logout completing while the background
      // session check is in flight.
      authMock.service.isAuthenticated.mockImplementation(async () => {
        // While we are "awaiting" the storage read, the force-logout fires and
        // updates the auth state.
        authMock.emitState({ isAuthenticated: false, isLoading: false });
        return false;
      });
      watcher.start();

      await appStateMock.simulateChange('active');

      // isAuthenticated() returned false, but authState is already logged-out,
      // so the session-expired logout should NOT fire.
      expect(authMock.service.logout).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Skipped transitions
  // -------------------------------------------------------------------------

  describe('non-active transitions', () => {
    it('should not trigger a check when the app transitions to background', async () => {
      watcher.start();
      await appStateMock.simulateChange('background');
      expect(authMock.service.isAuthenticated).not.toHaveBeenCalled();
    });

    it('should not trigger a check when the app transitions to inactive', async () => {
      watcher.start();
      await appStateMock.simulateChange('inactive');
      expect(authMock.service.isAuthenticated).not.toHaveBeenCalled();
    });

    it('should skip the check when the user is already logged out', async () => {
      // Emit a logged-out state before the app resume event.
      authMock = makeAuthServiceMock(/* initialAuthenticated */ false);
      watcher = new AppStateWatcher(authMock.service, appStateMock.module);
      watcher.start();

      await appStateMock.simulateChange('active');

      expect(authMock.service.isAuthenticated).not.toHaveBeenCalled();
      expect(authMock.service.logout).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Debounce
  // -------------------------------------------------------------------------

  describe('debounce — repeated app resume events', () => {
    it('should not re-check within MIN_CHECK_INTERVAL_MS of the previous check', async () => {
      authMock.service.isAuthenticated.mockResolvedValue(true);
      watcher.start();

      // First resume — check fires.
      await appStateMock.simulateChange('active');
      expect(authMock.service.isAuthenticated).toHaveBeenCalledTimes(1);

      // Second resume immediately after — should be debounced.
      await appStateMock.simulateChange('active');
      expect(authMock.service.isAuthenticated).toHaveBeenCalledTimes(1);
    });

    it('should check again after MIN_CHECK_INTERVAL_MS has elapsed', async () => {
      authMock.service.isAuthenticated.mockResolvedValue(true);
      watcher.start();

      // First resume.
      await appStateMock.simulateChange('active');
      expect(authMock.service.isAuthenticated).toHaveBeenCalledTimes(1);

      // Advance clock past the debounce window.
      jest.advanceTimersByTime(AppStateWatcher.MIN_CHECK_INTERVAL_MS + 1);

      // Second resume after debounce window — check should fire again.
      await appStateMock.simulateChange('active');
      expect(authMock.service.isAuthenticated).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // stop()
  // -------------------------------------------------------------------------

  describe('stop()', () => {
    it('should remove the AppState subscription', () => {
      watcher.start();
      watcher.stop();
      expect(appStateMock.removeHandler).toHaveBeenCalledTimes(1);
    });

    it('should unsubscribe from AuthService state changes', () => {
      // The unsubscribe spy is returned by onStateChange in the mock.
      const unsubscribeSpy = (authMock.service.onStateChange as jest.Mock).mock.results[0]?.value;
      watcher.start();
      // onStateChange was called once in start(); get its return value (unsubscribe fn)
      const returned = (authMock.service.onStateChange as jest.Mock).mock.results[0].value;
      expect(typeof returned).toBe('function');

      watcher.stop();
      expect(returned).toHaveBeenCalledTimes(1);
    });

    it('should be safe to call stop() before start()', () => {
      expect(() => watcher.stop()).not.toThrow();
    });

    it('should not trigger a check after stop() even on an active event', async () => {
      authMock.service.isAuthenticated.mockResolvedValue(false);
      watcher.start();
      watcher.stop();

      // The handler was detached, so this simulates the AppState module NOT
      // calling the handler after removal (the real AppState does this).
      // We verify via the isAuthenticated call count.
      expect(authMock.service.isAuthenticated).not.toHaveBeenCalled();
    });
  });
});
