/**
 * AuthService.ts
 *
 * The central hub for all authentication business logic.
 *
 * Responsibilities:
 *  - Login: call the API, persist tokens, start a session, notify listeners.
 *  - Logout: clean up tokens and session; guarded against duplicate calls.
 *  - isAuthenticated: check token presence + session validity.
 *  - getAccessToken: expose the current token to HTTP clients.
 *  - onStateChange: pub/sub for auth state so any UI layer can react.
 *
 * Design decisions:
 *  - Business logic is fully decoupled from UI (no React imports here).
 *  - All I/O dependencies are injected (storage, session, api) — easy to mock.
 *  - A boolean guard (`isLoggingOut`) prevents concurrent logout races, e.g.
 *    a user tap AND a WebSocket force-logout arriving simultaneously.
 *  - State is broadcast synchronously to all registered listeners so both
 *    hook-based and store-based consumers stay in sync.
 */

import { ISecureStorageService } from '../storage/SecureStorageService';
import { ISessionManager } from './SessionManager';
import {
  AuthState,
  AuthTokens,
  AuthUser,
  LoginCredentials,
  LogoutReason,
} from '../types/auth.types';
import { createLogger } from '../utils/logger';
import { StorageKeys } from '../storage/StorageKeys';

const logger = createLogger('AuthService');

/** Storage keys are defined once in StorageKeys.ts and referenced here. */
const { ACCESS_TOKEN, REFRESH_TOKEN } = StorageKeys;

// ---------------------------------------------------------------------------
// API client contract
// ---------------------------------------------------------------------------

/**
 * The interface your real HTTP layer must implement.
 * Swap in a fetch/axios/Amplify-backed class without touching AuthService.
 */
export interface IAuthApiClient {
  authenticate(credentials: LoginCredentials): Promise<AuthTokens>;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface IAuthService {
  login(credentials: LoginCredentials): Promise<AuthUser>;
  logout(reason?: LogoutReason): Promise<void>;
  isAuthenticated(): Promise<boolean>;
  getAccessToken(): Promise<string | null>;
  /**
   * Subscribes to auth state changes.
   * The listener is called immediately with the current state, and on every
   * subsequent change.
   * @returns An unsubscribe function.
   */
  onStateChange(listener: (state: AuthState) => void): () => void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class AuthService implements IAuthService {
  /** Guards against concurrent / duplicate logout invocations. */
  private isLoggingOut = false;

  private readonly stateListeners = new Set<(state: AuthState) => void>();

  private currentState: AuthState = { isAuthenticated: false, isLoading: false };

  constructor(
    private readonly storageService: ISecureStorageService,
    private readonly sessionManager: ISessionManager,
    private readonly apiClient: IAuthApiClient,
  ) {}

  // -------------------------------------------------------------------------
  // Login
  // -------------------------------------------------------------------------

  async login(credentials: LoginCredentials): Promise<AuthUser> {
    this.emitState({ ...this.currentState, isLoading: true, error: undefined });

    try {
      const { accessToken, refreshToken, user } =
        await this.apiClient.authenticate(credentials);

      // Persist tokens before starting the session so that a crash between
      // the two writes does not leave a session without tokens.
      await this.storageService.setItem(ACCESS_TOKEN, accessToken);
      await this.storageService.setItem(REFRESH_TOKEN, refreshToken);
      await this.sessionManager.startSession(user.id);

      this.emitState({ isAuthenticated: true, isLoading: false, user });
      logger.info(`User ${user.id} logged in successfully`);
      return user;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed';
      this.emitState({ isAuthenticated: false, isLoading: false, error: message });
      logger.error('Login failed', error);
      throw error instanceof Error ? error : new Error(message);
    }
  }

  // -------------------------------------------------------------------------
  // Logout
  // -------------------------------------------------------------------------

  /**
   * Clears all auth material and notifies listeners.
   *
   * The `isLoggingOut` flag is set synchronously before the first `await`
   * so that any concurrent call (e.g. a second WebSocket event) sees it and
   * returns immediately, preventing double-wipes.
   */
  async logout(reason: LogoutReason = LogoutReason.USER_INITIATED): Promise<void> {
    if (this.isLoggingOut) {
      logger.warn('Logout already in progress — ignoring duplicate call');
      return;
    }

    this.isLoggingOut = true;
    logger.info(`Logging out (reason: ${reason})`);

    try {
      await Promise.all([
        this.storageService.removeItem(ACCESS_TOKEN),
        this.storageService.removeItem(REFRESH_TOKEN),
        this.sessionManager.clearSession(),
      ]);
      this.emitState({ isAuthenticated: false, isLoading: false, logoutReason: reason });
    } finally {
      this.isLoggingOut = false;
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Returns true when both a token and a non-expired session are present. */
  async isAuthenticated(): Promise<boolean> {
    const token = await this.storageService.getItem(ACCESS_TOKEN);
    if (!token) {
      return false;
    }
    return this.sessionManager.isSessionValid();
  }

  /** Returns the raw access token string for use in Authorization headers. */
  async getAccessToken(): Promise<string | null> {
    return this.storageService.getItem(ACCESS_TOKEN);
  }

  onStateChange(listener: (state: AuthState) => void): () => void {
    this.stateListeners.add(listener);
    // Deliver current state immediately so the caller is never in an unknown
    // initial state.
    listener(this.currentState);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private emitState(state: AuthState): void {
    this.currentState = state;
    this.stateListeners.forEach(listener => listener(state));
  }
}
