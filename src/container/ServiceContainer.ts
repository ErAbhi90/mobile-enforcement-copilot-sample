/**
 * ServiceContainer.ts  (Composition Root)
 *
 * The single place in the application where concrete classes are instantiated
 * and wired together.  Every other module depends on interfaces — only this
 * file knows about concrete implementations.
 *
 * Why a composition root?
 *  - Prevents scattered `new Service()` calls throughout the codebase.
 *  - Makes it trivial to swap implementations (e.g. use a different keychain
 *    library) in one place.
 *  - In tests, inject mock implementations directly instead of calling
 *    createAppServices().
 *
 * Usage:
 *   // At the top of your App.tsx (or equivalent entry point):
 *   import { createAppServices } from './container/ServiceContainer';
 *   import { MyAuthApiClient } from './api/MyAuthApiClient';
 *
 *   const services = createAppServices(new MyAuthApiClient());
 *
 *   // Pass services down via React Context or prop drilling.
 */

import { SecureStorageService } from '../storage/SecureStorageService';
import { ALL_STORAGE_KEYS } from '../storage/StorageKeys';
import { SessionManager } from '../auth/SessionManager';
import { AuthService, IAuthApiClient, IAuthService } from '../auth/AuthService';
import { BiometricService, IBiometricService } from '../auth/BiometricService';
import { WebSocketService, IWebSocketService } from '../websocket/WebSocketService';
import { AuthStore } from '../store/AuthStore';
import { LogoutReason } from '../types/auth.types';

// ---------------------------------------------------------------------------
// Container shape
// ---------------------------------------------------------------------------

/**
 * All fields are typed as interfaces so callers depend on contracts, not
 * concrete classes.  Swapping an implementation only requires changing this
 * file, never the files that consume AppServices.
 */
export interface AppServices {
  authService: IAuthService;
  biometricService: IBiometricService;
  webSocketService: IWebSocketService;
  authStore: AuthStore;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates and wires all application services.
 *
 * @param apiClient - Your concrete IAuthApiClient implementation.
 *   Provide a mock during integration tests.
 */
export function createAppServices(apiClient: IAuthApiClient): AppServices {
  // ALL_STORAGE_KEYS makes clearAll() remove every named keychain entry rather
  // than only the default (no-service) entry.
  const secureStorage = new SecureStorageService(ALL_STORAGE_KEYS);
  const sessionManager = new SessionManager(secureStorage);
  const authService = new AuthService(secureStorage, sessionManager, apiClient);
  const biometricService = new BiometricService();

  // onForceLogout is the only coupling point between WebSocketService and the
  // auth system.  WebSocketService receives a plain callback; it never imports
  // or knows about AuthService.
  const webSocketService = new WebSocketService({
    onForceLogout: () => void authService.logout(LogoutReason.FORCE_LOGOUT),
  });

  const authStore = new AuthStore(authService);

  return {
    authService,
    biometricService,
    webSocketService,
    authStore,
  };
}
