/**
 * AuthStore.ts
 *
 * A thin state container that bridges AuthService (business logic) and the
 * React component tree (UI).
 *
 * AuthService broadcasts immutable AuthState snapshots through its pub/sub
 * mechanism.  AuthStore subscribes to those broadcasts and keeps the most
 * recent snapshot so that:
 *
 *  1. Components can read the current state synchronously (no async await).
 *  2. A single subscription to AuthService is shared across all consumers.
 *  3. The pattern is framework-agnostic — wrap this in a React Context,
 *     a MobX observable, or a Zustand store without changing the logic here.
 *
 * Lifecycle:
 *  - Instantiate once at app startup (see ServiceContainer).
 *  - Call destroy() when the app unmounts to release the subscription.
 */

import { AuthState } from '../types/auth.types';
import { IAuthService } from '../auth/AuthService';

export class AuthStore {
  private state: AuthState = { isAuthenticated: false, isLoading: false };

  /** Cleanup function returned by AuthService.onStateChange. */
  private readonly unsubscribe: () => void;

  constructor(private readonly authService: IAuthService) {
    this.unsubscribe = this.authService.onStateChange(newState => {
      this.state = newState;
    });
  }

  /**
   * Returns the latest auth state snapshot.
   * The Readonly wrapper prevents accidental mutations by callers.
   */
  getState(): Readonly<AuthState> {
    return this.state;
  }

  /** Releases the AuthService subscription.  Call on app teardown. */
  destroy(): void {
    this.unsubscribe();
  }
}
