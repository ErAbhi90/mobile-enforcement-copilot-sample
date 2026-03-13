/**
 * AppStateWatcher.ts
 *
 * Monitors React Native's AppState lifecycle and checks session validity
 * every time the application returns to the foreground.
 *
 * Why this is needed:
 *  The 10-hour session expiry is only checked when a business-logic call
 *  (e.g. isAuthenticated()) is made.  If the app is backgrounded for longer
 *  than 10 hours, the session silently expires but the UI remains on the
 *  authenticated screen until the next explicit check.  This watcher triggers
 *  an automatic SESSION_EXPIRED logout on each app resume.
 *
 * Edge-case handling:
 *  - Debounce: rapid AppState transitions (common on iOS when the user swipes
 *    between apps) are coalesced — only one check runs per MIN_CHECK_INTERVAL_MS
 *    window.
 *  - Guard: the session check is skipped when the in-memory auth state says
 *    the user is already logged out, avoiding unnecessary storage reads.
 *  - Full cleanup: stop() removes both the AppState subscription and the
 *    internal AuthService state-change subscription acquired in start().
 *  - Idempotent start: calling start() twice is harmless.
 *
 * Injectable design:
 *  The AppState module is injected via IAppStateModule so this class has
 *  zero direct imports from 'react-native'.  In production pass AppState
 *  from react-native directly; in tests pass a mock.
 */

import { IAuthService } from '../auth/AuthService';
import { LogoutReason, AuthState } from '../types/auth.types';
import { createLogger } from '../utils/logger';

const logger = createLogger('AppStateWatcher');

// ---------------------------------------------------------------------------
// AppState types (defined locally to avoid a react-native import here)
// ---------------------------------------------------------------------------

/**
 * Matches the AppStateStatus union from React Native.
 * Defined locally so this module has no direct react-native dependency.
 */
export type AppStateStatus = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

/**
 * Minimal slice of the React Native AppState API that this service needs.
 * Pass `AppState` from 'react-native' in production; pass a mock in tests.
 */
export interface IAppStateModule {
  addEventListener(
    event: 'change',
    handler: (state: AppStateStatus) => void,
  ): { remove: () => void };
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface IAppStateWatcher {
  /**
   * Starts listening for app-state changes.
   * Idempotent — calling start() a second time is a no-op.
   */
  start(): void;

  /**
   * Stops listening and releases all subscriptions.
   * Safe to call even if start() was never called.
   */
  stop(): void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class AppStateWatcher implements IAppStateWatcher {
  /** Minimum milliseconds between consecutive session checks on app resume. */
  static readonly MIN_CHECK_INTERVAL_MS = 5_000;

  private appStateSubscription: { remove: () => void } | null = null;
  private unsubscribeAuthState: (() => void) | null = null;

  /** Last time (ms) a session check was performed. */
  private lastCheckAt = 0;

  /** Mirrors the current AuthService state so we can skip checks when already logged out. */
  private authState: AuthState = { isAuthenticated: false, isLoading: false };

  constructor(
    private readonly authService: IAuthService,
    private readonly appStateModule: IAppStateModule,
  ) {}

  start(): void {
    if (this.appStateSubscription) {
      return; // already running
    }

    // Mirror the current auth state so handleChange can read it synchronously.
    this.unsubscribeAuthState = this.authService.onStateChange(state => {
      this.authState = state;
    });

    this.appStateSubscription = this.appStateModule.addEventListener(
      'change',
      this.handleChange,
    );

    logger.info('AppStateWatcher started');
  }

  stop(): void {
    this.appStateSubscription?.remove();
    this.appStateSubscription = null;

    this.unsubscribeAuthState?.();
    this.unsubscribeAuthState = null;

    logger.info('AppStateWatcher stopped');
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  /**
   * Fired on every AppState transition.
   *
   * On 'active' (app returns to foreground):
   *  1. Skip if the user is already logged out — no session to check.
   *  2. Skip if a check was performed fewer than MIN_CHECK_INTERVAL_MS ago
   *     (debounce rapid resume events).  `lastCheckAt` is updated synchronously
   *     before any await so concurrent invocations see the updated value and
   *     are coalesced into a single check.
   *  3. Call isAuthenticated().  If false, call logout(SESSION_EXPIRED) only
   *     when the in-memory authState still shows the user as authenticated —
   *     guarding against a concurrent logout (e.g. force-logout from WebSocket)
   *     that completed while isAuthenticated() was awaiting.
   */
  private handleChange = async (nextState: AppStateStatus): Promise<void> => {
    if (nextState !== 'active') {
      return;
    }

    if (!this.authState.isAuthenticated) {
      logger.debug('AppStateWatcher: app resumed but user is not authenticated — skipping check');
      return;
    }

    const now = Date.now();
    if (now - this.lastCheckAt < AppStateWatcher.MIN_CHECK_INTERVAL_MS) {
      logger.debug('AppStateWatcher: skipping resume check — within debounce window');
      return;
    }

    // Set lastCheckAt synchronously before any await so that a second rapid
    // 'active' event that arrives while we are awaiting isAuthenticated() sees
    // the updated value and is coalesced by the debounce guard above.
    this.lastCheckAt = now;
    logger.info('AppStateWatcher: checking session validity on app resume');

    const isAuth = await this.authService.isAuthenticated();
    if (!isAuth) {
      // Re-check the in-memory state.  A concurrent logout (e.g. a WebSocket
      // force_logout) may have already completed and updated authState while
      // we were awaiting isAuthenticated(), making another logout call redundant.
      if (this.authState.isAuthenticated) {
        logger.warn('AppStateWatcher: session expired while app was backgrounded — logging out');
        void this.authService.logout(LogoutReason.SESSION_EXPIRED);
      }
    }
  };
}
