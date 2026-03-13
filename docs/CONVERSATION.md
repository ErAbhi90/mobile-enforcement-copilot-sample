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
the GitHub Copilot coding agent.  Nine distinct prompts drove the work, moving
from the initial scaffold through senior engineer review, targeted refactoring,
edge-case hardening, a race-condition fix, and a formal PR review.  The suite
reached 67 passing tests with zero failures.

---

## 2. Requests Made to the Agent

All nine prompts are listed below in the exact chronological order they were
issued during the session (paraphrased; no sensitive context has been
included).

---

### Prompt 1 — Initial scaffold

> _"Create a production-style React Native TypeScript foundation for
> authentication and session handling in a mobile enforcement application.
> Requirements:_
> - _Secure token storage using the device keychain (react-native-keychain)._
> - _A 10-hour session expiry enforced on every authentication check._
> - _Biometric re-entry (Face ID / Touch ID / Fingerprint) for users returning
>   to the app after it has been backgrounded._
> - _Server-forced logout via a WebSocket `force_logout` event._
> - _A React hook (`useAuth`) that exposes auth state and actions to
>   functional components._
> - _A composition root (`ServiceContainer`) that wires all services together
>   so the rest of the codebase depends only on interfaces._
> - _All business logic must be unit-testable in a Node environment — no
>   simulator, no physical device required._
> - _Unit tests for every module using Jest._"

**What was produced (commit `45eb750`):**  
The complete source tree — `auth/AuthService.ts`, `auth/BiometricService.ts`,
`auth/SessionManager.ts`, `storage/SecureStorageService.ts`,
`hooks/useAuth.ts`, `store/AuthStore.ts`, `websocket/WebSocketService.ts`,
`container/ServiceContainer.ts`, `types/auth.types.ts`, `utils/logger.ts` —
together with five test suites, three Jest mocks, `README.md`, `package.json`,
`tsconfig.json`, `babel.config.js`, and `jest.config.js`.

---

### Prompt 2 — Architecture Guide (initial version)

> _"Create a comprehensive Architecture Guide in `docs/ARCHITECTURE.md`.
> It should cover the layer model, a module reference, the dependency graph,
> detailed walkthroughs of the four main authentication flows (login, logout,
> biometric re-entry, force logout), and plain-language justifications for the
> key design decisions."_

**What was produced (commit `6ca5816`):**  
`docs/ARCHITECTURE.md` with five sections covering the layer model, module
reference, dependency graph, flow walkthroughs with ASCII diagrams, and a
plain-language design-decision table.  A link to the guide was also added to
`README.md`.

---

### Prompt 3 — Architecture deep-dive: source of truth, testability seams, and senior engineer critical review

> _"Extend the Architecture Guide with three additional sections:_
> 1. _Where canonical auth state lives — the difference between
>    `AuthService.currentState`, `AuthStore`, and the `useAuth` hook, and
>    when to use each._
> 2. _An explanation of the six testability seams in the codebase and why
>    each one was created._
> 3. _An honest senior engineer critical review: what is genuinely good, what
>    is incomplete or risky in production, and what will cause maintenance pain
>    as the codebase grows."_

**What was produced (commit `9f86649`):**  
Three new sections appended to `docs/ARCHITECTURE.md`:
- **Section 6 — Source of Truth for Auth/Session State:** hierarchy diagram,
  explanation of why `currentState` is private, the token/session split, and
  how all four logout triggers converge on the same path.
- **Section 7 — Testability — Intentional Decoupling Seams:** detailed
  write-up of all six seams (`ISecureStorageService`, `ISessionManager`,
  `IAuthApiClient`, `IAuthService`, injected `ReactNativeBiometrics`, global
  `WebSocket`) with code examples.
- **Section 8 — Senior Engineer Critical Review:** eight strengths, five risks
  / open questions, and four specific recommendations for the next iteration.

---

### Prompt 4 — Refactoring per senior engineer review

> _"Apply the four targeted refactoring recommendations from the senior
> engineer review:_
> 1. _Extract all storage key strings into a dedicated `StorageKeys.ts` so
>    there is a single place to audit what is written to the device keychain._
> 2. _Fix the `SecureStorageService.clearAll()` security bug: entries written
>    with `{ service: key }` must be deleted with the same option; calling
>    `resetGenericPassword()` with no arguments only clears the default entry
>    and leaves all named entries on the device._
> 3. _Decouple `WebSocketService` from `IAuthService`: replace the direct
>    `authService.logout()` call with an `onForceLogout` callback injected
>    in `WebSocketServiceOptions` — the service should not need to know
>    anything about the auth system._
> 4. _Make all `AppServices` fields use interface types so callers depend on
>    contracts, not concrete classes."_

**What was produced (commit `0ecbb25`):**  
- New file `src/storage/StorageKeys.ts` with a typed `StorageKeys` constant
  and an `ALL_STORAGE_KEYS` array.
- `SecureStorageService` updated to accept `knownKeys` at construction;
  `clearAll()` now removes every named entry individually.
- `WebSocketService` constructor changed to accept `WebSocketServiceOptions`;
  no more `IAuthService` import.
- `ServiceContainer` wires the `onForceLogout` callback and passes
  `ALL_STORAGE_KEYS` to the storage service.
- `AppServices` fields converted to interface types.
- Tests updated to reflect the new behaviour.
- A new **Section 9 — Refactoring for Separation of Concerns** added to
  `docs/ARCHITECTURE.md` explaining each change.

---

### Prompt 5 — AppStateWatcher and edge-case hardening

> _"Add a lifecycle module (`AppStateWatcher`) that triggers a
> `SESSION_EXPIRED` logout every time the app returns to the foreground and
> the session has silently expired while backgrounded.  Then harden these
> specific edge cases across the codebase:_
> - _`AppStateWatcher`: skip the session check if the user is already logged
>   out (avoid unnecessary storage reads)._
> - _`AppStateWatcher`: debounce rapid AppState transitions — only one check
>   per 5-second window._
> - _`BiometricService`: if `cancel()` is called while the OS biometric prompt
>   is on screen, `authenticate()` must return `{ success: false }` regardless
>   of what the OS returned._
> - _`AuthService.logout()`: must emit the logged-out state even when secure
>   storage cleanup throws._
> - _`WebSocketService`: detach all event handlers before calling `close()` so
>   in-flight messages cannot fire after disconnect."_

**What was produced (commit `5de8ed6`):**  
- New file `src/lifecycle/AppStateWatcher.ts` with the debounced watcher,
  idempotent `start()` / `stop()`, and the already-logged-out guard.
- `BiometricService` extended with the `cancel()` / `cancelled` flag.
- `AuthService.logout()` refactored so `emitState` is inside the `finally`
  block.
- `WebSocketService.disconnect()` now detaches handlers before calling
  `close()`.
- `ServiceContainer` wires `biometricService.cancel()` inside the
  `onForceLogout` callback.
- 316 new test lines across four test files; `__mocks__/react-native.js`
  extended with full `AppState` mock support.

---

### Prompt 6 — Race-condition fix and AppStateWatcher stop/start reset

> _"Fix a race condition in `AuthService` where a concurrent logout that
> **completes** before the login API response arrives is not caught by the
> `isLoggingOut` boolean flag alone (the flag is reset to `false` when cleanup
> finishes, so a login that was in-flight can silently re-write just-cleared
> credentials back into storage)._
>
> _Specifically:_
> - _Introduce a `logoutGeneration` counter that is incremented synchronously
>   at the start of every `logout()` call.  `login()` must snapshot the
>   counter before the API call and abort if it has changed on return._
> - _Remove the duplicate `emitState` call that was emitting the authenticated
>   state twice on a successful login._
> - _Reset the `AppStateWatcher` debounce clock (`lastCheckTime = 0`) inside
>   `stop()` so the next `start()` always performs its first check immediately
>   even if a check had fired just before `stop()`."_

**What was produced (commit `22a33a5`):**  
- `AuthService` extended with `logoutGeneration: number`; `login()` aborts if
  the counter changes during the API round-trip.
- The duplicate `emitState` in `login()` removed.
- `AppStateWatcher.stop()` now resets `lastCheckTime` to `0`.
- Nine new tests added to `AuthService.test.ts` and
  `AppStateWatcher.test.ts` to cover the new invariants.
- **Section PR Review — Authentication & Session Hardening** added to
  `docs/ARCHITECTURE.md` (see Prompt 7 below).

---

### Prompt 7 — PR review as Senior Developer

> _"Review this pull request as a senior developer.  Cover: strengths of the
> implementation, possible improvements, and clarifying questions that should
> be answered before merging."_

**What was produced (as part of commit `22a33a5`):**  
A formal PR review appended to `docs/ARCHITECTURE.md` under
**"PR Review — Authentication & Session Hardening"**, containing:

**Strengths (5 items):**
1. Dependency-injection discipline — exemplary; 66 tests run in pure Node in
   under 2 seconds.
2. `logoutGeneration` counter closes a real race condition with minimal
   abstraction.
3. `emitState` in `finally` — logout state is unconditionally safe.
4. `AppStateWatcher` is focused, complete, and has symmetric lifecycle.
5. `BiometricService.cancel()` is narrow and correctly resets per-call.

**Possible improvements (3 items):**
1. `void authService.logout()` in `AppStateWatcher` swallows errors silently
   — a one-line comment would document the intent.
2. `authStore: AuthStore` in `AppServices` references the concrete class while
   all other fields use interface types — minor inconsistency.
3. `SessionData` has no `expiresAt` field — expiry policy is spread across two
   files; suggest storing a computed `expiresAt` if server-authoritative TTLs
   are ever needed.

**Questions before merge (3 items):**
1. Who calls `appStateWatcher.start()` and `stop()`, and is the `stop()` call
   guaranteed on app teardown?
2. Is it acceptable that `cancel()` does not dismiss the OS biometric dialog —
   the app is in the correct state, but the dialog may still be visible?
3. Does the navigation layer consume `logoutReason: SESSION_EXPIRED` to show a
   meaningful "session expired" message rather than silently dropping the user
   at the login screen?

---

### Prompt 8 — Session conversation document

> _"Create a Markdown file (`docs/CONVERSATION.md`) for the whole conversation
> to share.  Sanitize it by removing / avoiding sensitive content (credentials,
> personal information, or confidential / internal system details)."_

**What was produced (commit `4a62df3`):**  
`docs/CONVERSATION.md` with nine sections: session overview, prompts (initial
version — 7 entries, since prompts 3, 4, and 7 were missing), what was built,
key design decisions, edge cases handled, test coverage, how to run, what was
intentionally left out, and suggested next steps.

---

### Prompt 9 — Verify and complete the conversation document

> _"Verify `CONVERSATION.md` has all the prompts that I provided.  If not,
> add all the prompts step by step until creating a PR review as Senior Dev
> prompt."_

**What was produced (this commit):**  
The current document.  Section 2 was rewritten from scratch with all nine
prompts in the correct chronological order.  The prompts that were missing from
the initial version were:
- **Prompt 3** — Architecture deep-dive (source of truth, testability seams,
  senior engineer critical review).
- **Prompt 4** — Refactoring per senior engineer review (StorageKeys,
  clearAll security fix, WebSocketService decoupling, AppServices interface
  types).
- **Prompt 7** — PR review as Senior Developer.
- **Prompt 9** — This verification prompt itself.

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
