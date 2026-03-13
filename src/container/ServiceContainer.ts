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
import { SessionManager } from '../auth/SessionManager';
import { AuthService, IAuthApiClient } from '../auth/AuthService';
import { BiometricService } from '../auth/BiometricService';
import { WebSocketService } from '../websocket/WebSocketService';
import { AuthStore } from '../store/AuthStore';

// ---------------------------------------------------------------------------
// Container shape
// ---------------------------------------------------------------------------

export interface AppServices {
  authService: AuthService;
  biometricService: BiometricService;
  webSocketService: WebSocketService;
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
  const secureStorage = new SecureStorageService();
  const sessionManager = new SessionManager(secureStorage);
  const authService = new AuthService(secureStorage, sessionManager, apiClient);
  const biometricService = new BiometricService();
  const webSocketService = new WebSocketService(authService);
  const authStore = new AuthStore(authService);

  return {
    authService,
    biometricService,
    webSocketService,
    authStore,
  };
}
