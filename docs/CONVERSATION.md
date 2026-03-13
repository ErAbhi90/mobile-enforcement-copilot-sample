# Copilot Agent Session — Authentication Foundation

> **Sanitization notice**  
> This document is a cleaned, shareable summary of the GitHub Copilot agent
> session used to build this repository.  All credentials, personal
> information, internal hostnames, and proprietary endpoint details have been
> removed or replaced with generic placeholders.

---

## Table of Contents

1. [Session Overview](#1-session-overview)
2. [Requests Made to the Agent](#2-requests-made-to-the-agent)
3. [What Was Built](#3-what-was-built)
4. [Key Design Decisions](#4-key-design-decisions)
5. [Edge Cases Handled](#5-edge-cases-handled)
6. [Test Coverage](#6-test-coverage)
7. [How to Run the Project](#7-how-to-run-the-project)
8. [What Was Intentionally Left Out](#8-what-was-intentionally-left-out)
9. [Suggested Next Steps](#9-suggested-next-steps)

---

## 1. Session Overview

The goal of this session was to build a **production-quality React Native
TypeScript foundation** for authentication and session management in a mobile
enforcement application — one that could be dropped into a real project and
extended without significant rework.

The entire implementation was generated iteratively through a conversation with
the GitHub Copilot coding agent.  Each iteration added a module, its tests,
and the accompanying edge-case hardening until the suite reached 67 passing
tests with zero failures.

---

## 2. Requests Made to the Agent

The following prompts were issued during the session (paraphrased; no sensitive
context has been included):

1. **Initial scaffold request**  
   _"Create a production-style React Native TypeScript foundation for
   authentication and session handling.  It should include secure token
   storage, a 10-hour session expiry, biometric re-entry, server-forced logout
   via WebSocket, and a React hook to expose auth state to components.  All
   business logic must be unit-testable without a simulator."_

2. **Composition root / wiring**  
   _"Add a ServiceContainer (composition root) that wires all services
   together in one place so the rest of the codebase depends only on
   interfaces."_

3. **AppStateWatcher — background expiry detection**  
   _"Add a lifecycle watcher that checks session validity every time the app
   returns to the foreground and triggers a `SESSION_EXPIRED` logout if the
   session has silently expired while the app was backgrounded.  Include a
   debounce so rapid AppState transitions don't fire multiple checks."_

4. **Edge-case hardening (first pass)**  
   _"Harden the following edge cases:
   - AppStateWatcher should not fire a check if the user is already logged out.
   - BiometricService: a `cancel()` call that arrives while the OS prompt is
     showing should cause `authenticate()` to return failure regardless of what
     the OS returned.
   - AuthService.logout(): should emit the logged-out state even when secure
     storage cleanup throws.
   - AppStateWatcher: a stop/start cycle should not skip the first resume check
     after restarting._"

5. **Race-condition fix**  
   _"Fix a race condition in AuthService where a concurrent logout that
   **completes** before the login API returns is not caught by the
   `isLoggingOut` boolean flag alone.  Introduce a generation counter to cover
   both the in-progress and the already-completed logout scenarios.  Remove the
   double-emit on logout.  Reset the AppStateWatcher debounce clock on stop so
   the next start always does its first check."_

6. **Documentation**  
   _"Create a comprehensive Architecture Guide in `docs/ARCHITECTURE.md`."_

7. **This document**  
   _"Create a Markdown (.md) for the whole conversation to share and sanitize
   it by removing/avoiding sensitive content (credentials, personal information,
   or confidential/internal system details)."_

---

## 3. What Was Built

### Source files (`src/`)

| File | Purpose |
|------|---------|
| `types/auth.types.ts` | Single source of truth for all shared TypeScript interfaces and enums: `AuthUser`, `LoginCredentials`, `AuthTokens`, `SessionData`, `AuthState`, `LogoutReason`. |
| `storage/StorageKeys.ts` | Central registry of every secure-storage key name.  Prevents collisions, makes auditing trivial. |
| `storage/SecureStorageService.ts` | Wraps `react-native-keychain` behind `ISecureStorageService`.  Each key is an independent Keychain service entry; `clearAll()` removes every named entry. |
| `auth/SessionManager.ts` | Persists a session record (userId + timestamp) and enforces the 10-hour expiry on every `isSessionValid()` call. |
| `auth/BiometricService.ts` | Wraps `react-native-biometrics`.  Handles unavailability gracefully; a `cancel()` flag lets a force-logout invalidate a prompt that is already on screen. |
| `auth/AuthService.ts` | Central auth hub: `login`, `logout`, `isAuthenticated`, `getAccessToken`, `onStateChange` pub/sub.  Guards concurrent logouts with both an `isLoggingOut` boolean and a `logoutGeneration` counter. |
| `websocket/WebSocketService.ts` | Persistent WebSocket client.  Dispatches `force_logout` server events to a callback injected at construction time; swallows malformed messages. |
| `store/AuthStore.ts` | Synchronous snapshot of the latest `AuthState` for non-hook consumers (navigation guards, background tasks). |
| `hooks/useAuth.ts` | React hook: subscribes to `AuthService.onStateChange` on mount, cleans up on unmount, returns `{ isAuthenticated, isLoading, user, error, login, logout }`. |
| `container/ServiceContainer.ts` | Composition root.  The **only** file that calls `new` on concrete classes and wires them together. |
| `utils/logger.ts` | Contextual logger (`createLogger('ModuleName')`); debug output suppressed in production. |
| `lifecycle/AppStateWatcher.ts` | Monitors `AppState` changes; triggers a `SESSION_EXPIRED` logout on foreground resume if the session has expired.  Debounced, idempotent, fully stoppable. |

### Test files (`__tests__/`)

| File | Tests |
|------|-------|
| `storage/SecureStorageService.test.ts` | setItem / getItem / removeItem / clearAll |
| `auth/SessionManager.test.ts` | Session creation, 10-hour expiry boundary, corrupted JSON, clearSession |
| `auth/BiometricService.test.ts` | Sensor availability, successful prompt, user cancel, unavailability, cancel() flag |
| `auth/AuthService.test.ts` | Login happy path, token storage, loading/error states, logout deduplication, isAuthenticated, pub/sub |
| `websocket/WebSocketService.test.ts` | Connection URL, force_logout dispatch, unknown types, malformed messages, reconnect, disconnect |
| `lifecycle/AppStateWatcher.test.ts` | Subscribe/unsubscribe, debounce, already-logged-out guard, stop/start cycle, idempotent start |

**Total: 67 tests — 67 passing, 0 failing.**

### Mock files (`__mocks__/`)

| File | Mocks |
|------|-------|
| `react-native-keychain.ts` | `setGenericPassword`, `getGenericPassword`, `resetGenericPassword` |
| `react-native-biometrics.ts` | `isSensorAvailable`, `simplePrompt` |
| `react-native.js` | `AppState` (addEventListener / removeEventListener) |

---

## 4. Key Design Decisions

| Requirement | Design choice |
|-------------|---------------|
| Session expires after 10 hours | `SessionManager.isSessionValid()` compares `Date.now()` against `session.createdAt + SESSION_DURATION_MS` on every call — always up-to-date even after long offline periods. |
| Biometric re-entry for valid local session | `BiometricService.authenticate()` + `AuthService.isAuthenticated()` — the UI checks both before showing the biometric prompt. |
| Backend-forced logout via WebSocket | `WebSocketService` listens for `{ type: "force_logout" }` and invokes the `onForceLogout` callback injected at construction time.  The service never imports `AuthService`. |
| No duplicate logout actions | `isLoggingOut` boolean prevents concurrent calls from both starting cleanup.  `logoutGeneration` counter catches the case where a concurrent logout **completed** before the login API responded. |
| Secure credential storage | `SecureStorageService` wraps Keychain/Keystore.  Tokens are never written to `AsyncStorage`, component state, or logs. |
| Decoupled, testable modules | All services depend on interfaces.  React is only imported in `useAuth.ts`.  No test requires a simulator. |
| Single wiring point | `ServiceContainer.createAppServices()` is the only place `new` is called on concrete classes. |

---

## 5. Edge Cases Handled

### Race condition: logout during login

`AuthService.login()` snapshots `logoutGeneration` before the API call.  After
the call it checks again.  If the counter has advanced — even if `isLoggingOut`
is already `false` because cleanup completed before the response arrived — the
login is aborted and the just-returned tokens are never written to storage.

### Force-logout during biometric prompt

When a `force_logout` WebSocket event fires while the biometric OS prompt is
visible, the `onForceLogout` callback calls `biometricService.cancel()` first.
When `simplePrompt()` eventually resolves, `BiometricService.authenticate()`
checks the `cancelled` flag and returns `{ success: false }` regardless of what
the OS returned.

### Logout storage failure

`AuthService.logout()` wraps storage cleanup in a `try/catch`.  If any storage
operation throws, the error is logged and the `finally` block still emits the
logged-out `AuthState` so the UI always transitions away from the authenticated
screen.

### AppStateWatcher debounce

iOS can emit multiple rapid `AppState` transitions when the user swipes between
apps.  `AppStateWatcher` tracks `lastCheckTime` and skips any check that would
fire within `MIN_CHECK_INTERVAL_MS` (5 seconds) of the previous one.

### AppStateWatcher stop/start cycle

Calling `stop()` resets `lastCheckTime` to `0` so the **next** `start()` always
performs its first check immediately, even if a check had fired just before
`stop()` was called.

### Already-logged-out guard

`AppStateWatcher` caches the latest `AuthState` via an internal
`AuthService.onStateChange` subscription.  On every resume event it checks
whether the cached state already shows `isAuthenticated: false` and skips the
expensive `isAuthenticated()` storage read if so.

---

## 6. Test Coverage

All tests run in the Node environment — no simulator, no physical device, no
emulator required.  Native modules (`react-native-keychain`,
`react-native-biometrics`, `react-native`) are replaced by hand-written Jest
mocks in `__mocks__/`.

```
Test Suites: 6 passed, 6 total
Tests:       67 passed, 67 total
```

Coverage is collected from `src/**/*.{ts,tsx}` via `npm run test:coverage`.

---

## 7. How to Run the Project

```bash
# Install dependencies
npm install

# Run all tests
npm test

# Run tests with coverage report
npm run test:coverage

# TypeScript type-check (no emit)
npm run type-check
```

---

## 8. What Was Intentionally Left Out

The following were **explicitly out of scope** for this session and remain as
suggested next steps:

- A concrete `IAuthApiClient` implementation (the real HTTP call to your
  authentication endpoint).  A placeholder interface is defined in
  `AuthService.ts`.
- The React Native application shell (`App.tsx`, navigation, screens).
- Biometric re-entry UI flow (reading `isAuthenticated()` + calling
  `biometricService.authenticate()` in a screen component).
- Integration / E2E tests (Detox, `@testing-library/react-native`).
- Remote crash/log reporting (Sentry, Datadog, etc.).
- Token refresh logic.
- Push-notification–triggered force-logout path.

---

## 9. Suggested Next Steps

1. **Implement `IAuthApiClient`** — create a class that POST-s to your
   authentication endpoint and returns `AuthTokens`.  Pass an instance to
   `createAppServices()`.  No other file needs to change.

2. **Add a navigation guard** — read `authStore.getState().isAuthenticated`
   synchronously in your root navigator to decide which stack to render.

3. **Wire the biometric re-entry screen** — on app resume, if
   `authService.isAuthenticated()` is `true` locally but the user has not
   re-authenticated, show a biometric prompt using
   `biometricService.authenticate()`.

4. **Add integration tests** — use `renderHook` from
   `@testing-library/react-native` to test `useAuth` against a mock
   `IAuthService`.

5. **Add a token-refresh path** — detect 401 responses in your HTTP client and
   call the refresh endpoint using the stored `refresh_token`, then retry the
   original request.

6. **Configure remote logging** — replace the `console.*` calls in `logger.ts`
   with your chosen observability SDK for production crash reporting and
   distributed tracing.
