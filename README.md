# mobile-enforcement-copilot-sample

Production-style React Native TypeScript foundation for **authentication and session handling** in a mobile enforcement application.

---

> **New here?** Start with the [Architecture Guide](docs/ARCHITECTURE.md) for a practical, narrative walkthrough of every module, its responsibilities, and the four main auth flows before reading any code.

## Table of Contents

1. [Folder Structure](#folder-structure)
2. [Module Responsibilities](#module-responsibilities)
3. [Key Design Decisions](#key-design-decisions)
4. [Getting Started](#getting-started)
5. [Test Plan](#test-plan)
6. [Wiring the App Together](#wiring-the-app-together)

---

## Folder Structure

```
mobile-enforcement-copilot-sample/
├── src/
│   ├── auth/
│   │   ├── AuthService.ts          # Central auth hub: login, logout, token mgmt
│   │   ├── BiometricService.ts     # Biometric re-entry (Face ID / Touch ID)
│   │   └── SessionManager.ts      # 10-hour session lifecycle
│   ├── container/
│   │   └── ServiceContainer.ts    # Composition root — wires all services together
│   ├── hooks/
│   │   └── useAuth.ts             # React hook: exposes auth state to UI components
│   ├── store/
│   │   └── AuthStore.ts           # Synchronous state snapshot for framework bridges
│   ├── storage/
│   │   └── SecureStorageService.ts # Keychain / Keystore abstraction
│   ├── types/
│   │   └── auth.types.ts          # Shared TypeScript interfaces and enums
│   ├── utils/
│   │   └── logger.ts              # Contextual logger (suppress in production)
│   └── websocket/
│       └── WebSocketService.ts    # WebSocket client + server-forced logout
├── __tests__/
│   ├── auth/
│   │   ├── AuthService.test.ts
│   │   ├── BiometricService.test.ts
│   │   └── SessionManager.test.ts
│   ├── storage/
│   │   └── SecureStorageService.test.ts
│   └── websocket/
│       └── WebSocketService.test.ts
├── __mocks__/
│   ├── react-native-biometrics.ts # Jest mock for biometrics native module
│   ├── react-native-keychain.ts   # Jest mock for keychain native module
│   └── react-native.js            # Minimal React Native stub for tests
├── babel.config.js
├── jest.config.js
├── package.json
└── tsconfig.json
```

---

## Module Responsibilities

### `src/types/auth.types.ts`
Single source of truth for all shared TypeScript types: `AuthUser`, `LoginCredentials`, `AuthTokens`, `SessionData`, `AuthState`, and the `LogoutReason` enum.  All modules import from here — no type definitions are scattered across service files.

### `src/storage/SecureStorageService.ts`
Abstracts device secure storage (`react-native-keychain`) behind a `ISecureStorageService` interface.  The rest of the codebase never imports Keychain directly; swapping the underlying library is a one-file change.

### `src/auth/SessionManager.ts`
Persists a session record (userId + creation timestamp) and enforces the **10-hour expiry** rule on every `isSessionValid()` call.  Uses `ISecureStorageService` — no native deps.

### `src/auth/AuthService.ts`
The central authentication hub.
- `login()` — calls the API, persists tokens, starts a session, emits state.
- `logout()` — guarded with an `isLoggingOut` flag so concurrent calls (user tap + WebSocket force-logout) cannot double-wipe storage.
- `isAuthenticated()` — verifies both token presence and session validity.
- `onStateChange()` — pub/sub for `AuthState`; returns an unsubscribe function.

### `src/auth/BiometricService.ts`
Wraps `react-native-biometrics`.  Accepts an optional injected instance for testing.  If biometrics are unavailable, `authenticate()` returns `{ success: false }` without a prompt — it never throws.

### `src/websocket/WebSocketService.ts`
Manages the persistent WebSocket connection to the backend.  On receiving a `force_logout` server event it calls `authService.logout(LogoutReason.FORCE_LOGOUT)`.  Malformed messages are swallowed after a warning log.

### `src/store/AuthStore.ts`
Keeps a synchronous snapshot of the latest `AuthState` for use in non-hook contexts (e.g. navigation guards, background tasks).  Subscribes to `AuthService` on construction; call `destroy()` on app teardown.

### `src/hooks/useAuth.ts`
React hook that subscribes to `AuthService.onStateChange` on mount, cleans up on unmount, and returns `{ isAuthenticated, isLoading, user, error, login, logout }` to functional components.

### `src/container/ServiceContainer.ts`
The **composition root**.  The single place where `new` is called on concrete classes and services are wired together.  Every other module depends on interfaces — only this file knows about implementations.

### `src/utils/logger.ts`
Contextual logger (`createLogger('ModuleName')`) that tags every log line with the originating module.  Debug output is suppressed in production (`NODE_ENV === 'production'`).

---

## Key Design Decisions

| Requirement | Implementation |
|---|---|
| Session expires after 10 hours | `SessionManager.isSessionValid()` compares `Date.now()` against `session.createdAt + SESSION_DURATION_MS` on every check |
| Biometric re-entry for valid local session | `BiometricService.authenticate()` + `AuthService.isAuthenticated()` — the UI checks both before showing the biometric prompt |
| Backend-forced logout via WebSocket | `WebSocketService` listens for `{ type: "force_logout" }` and calls `AuthService.logout(LogoutReason.FORCE_LOGOUT)` |
| No duplicate logout actions | `AuthService.isLoggingOut` flag is set synchronously before the first `await`, so any concurrent call returns immediately |
| Decoupled business logic | All services depend on interfaces, not concrete classes; React is only imported in `useAuth.ts` |
| Secure sensitive values | `SecureStorageService` wraps Keychain/Keystore; tokens are never stored in AsyncStorage or state |
| Easy to test with Jest | All I/O is injected; native modules are replaced by manual mocks; no test requires a simulator |

---

## Getting Started

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Type-check without emitting
npm run type-check
```

---

## Test Plan

All business logic is tested at the unit level with Jest (Node environment — no simulator needed).

| Test file | What it covers |
|---|---|
| `SecureStorageService.test.ts` | setItem / getItem / removeItem / clearAll delegate correctly to Keychain |
| `SessionManager.test.ts` | Session creation, 10-hour expiry boundary, corrupted JSON, clearSession |
| `AuthService.test.ts` | Login happy path, token storage, loading/error states, logout deduplication, isAuthenticated permutations, pub/sub lifecycle |
| `BiometricService.test.ts` | Sensor availability, successful prompt, user cancellation, graceful degradation when unavailable |
| `WebSocketService.test.ts` | Connection URL construction, force_logout dispatch, unknown event types, malformed messages, reconnect, disconnect |

**Integration / E2E (out of scope here, suggested next steps):**
- Use `@testing-library/react-native` + `renderHook` to test `useAuth` against a mock `IAuthService`.
- Write end-to-end flows with Detox on a real device/simulator to verify biometric prompts and WebSocket events.

---

## Wiring the App Together

```typescript
// App.tsx (simplified)
import React, { createContext, useContext } from 'react';
import { createAppServices, AppServices } from './src/container/ServiceContainer';
import { useAuth } from './src/hooks/useAuth';
import { MyAuthApiClient } from './src/api/MyAuthApiClient'; // your implementation

const ServicesContext = createContext<AppServices | null>(null);
const services = createAppServices(new MyAuthApiClient());

export default function App() {
  return (
    <ServicesContext.Provider value={services}>
      <RootNavigator />
    </ServicesContext.Provider>
  );
}

// In any screen:
function LoginScreen() {
  const { authService } = useContext(ServicesContext)!;
  const { isAuthenticated, isLoading, login, logout } = useAuth(authService);
  // ...
}
```

> **Implementing `IAuthApiClient`:** Create a class that calls your real authentication endpoint and returns `AuthTokens`.  Pass an instance to `createAppServices()`.  No other file needs to change.
