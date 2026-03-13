# Architecture Guide

> **Purpose of this document**
> This is a practical, narrative explanation of how the authentication and session modules fit together. Read this *before* diving into the source files. It answers three questions:
> 1. Which modules exist and why?
> 2. What is each module responsible for — and, just as importantly, what is it *not* responsible for?
> 3. How do the modules interact across each real scenario?

---

## 1. The Layer Model

The codebase is divided into four horizontal layers. Dependencies only flow **downward** — upper layers call lower layers, never the reverse.

```
┌─────────────────────────────────────────────────────────────────────┐
│                          UI LAYER                                   │
│  React components, screens, navigation                              │
│  (not in this repo — this layer consumes the layer below)           │
├─────────────────────────────────────────────────────────────────────┤
│                      PRESENTATION LAYER                             │
│  useAuth hook          AuthStore                                    │
│  Translates async service calls into React state / plain objects    │
├─────────────────────────────────────────────────────────────────────┤
│                      BUSINESS LOGIC LAYER                           │
│  AuthService           SessionManager         BiometricService      │
│  WebSocketService                                                   │
│  All decisions happen here — zero React imports in this layer       │
├─────────────────────────────────────────────────────────────────────┤
│                      INFRASTRUCTURE LAYER                           │
│  SecureStorageService  (react-native-keychain wrapper)              │
│  IAuthApiClient        (your HTTP client goes here)                 │
│  Native biometric / WebSocket primitives                            │
└─────────────────────────────────────────────────────────────────────┘
```

### Why bother with layers?

- **Testability.** Business logic can be unit-tested in Node.js without a simulator because it only touches interfaces, not native binaries.
- **Replaceability.** Want to swap `react-native-keychain` for `expo-secure-store`? Edit one file (`SecureStorageService.ts`). The rest of the codebase never sees the change.
- **Clarity.** When a bug surfaces, the layer model tells you where to look. Authentication decision bug → `AuthService`. Storage read/write bug → `SecureStorageService`. UI not re-rendering → `useAuth` or `AuthStore`.

---

## 2. Module Reference

### `src/types/auth.types.ts`

**What it is:** A pure TypeScript file of interfaces and enums. No logic, no imports.

**Why it exists:** When types are defined next to the class that uses them, modules start importing from each other just to get a type, which creates circular dependency chains. Putting all shared contracts in one file breaks the cycle and gives every module a single place to look.

**Owns:** `AuthUser`, `LoginCredentials`, `AuthTokens`, `SessionData`, `AuthState`, `LogoutReason`.

**Does NOT own:** Any logic, any instantiation, any I/O.

---

### `src/storage/SecureStorageService.ts`

**What it is:** A thin wrapper around `react-native-keychain` (iOS Keychain / Android Keystore).

**Why it exists:** Native libraries have their own quirky APIs and their own native binaries. If every service called Keychain directly, you would need native binaries in every test that touches auth. By hiding Keychain behind the `ISecureStorageService` interface, tests inject a plain JavaScript mock object instead.

**Owns:**
- `setItem(key, value)` — write an encrypted string to the platform keystore
- `getItem(key)` → `string | null` — read it back
- `removeItem(key)` — delete a single key
- `clearAll()` — wipe all entries

**Does NOT own:** Any decision about *what* to store or *when* to store it. It is a dumb key/value vault.

---

### `src/auth/SessionManager.ts`

**What it is:** The guardian of the 10-hour session rule.

**Why it exists:** A session is a distinct concept from an auth token. A token proves identity; a session says "this identity was verified recently enough to trust without re-authenticating." Keeping session logic separate means you can change the expiry rule (e.g., shorten it for high-risk roles) without touching token handling.

**Owns:**
- `startSession(userId)` — write a `{ userId, createdAt }` JSON blob to secure storage after login
- `isSessionValid()` — read the blob back, compare `Date.now() - createdAt` against the 10-hour limit, return `true`/`false`
- `getSessionData()` — low-level read; returns null for absent or corrupted data
- `clearSession()` — delete the blob on logout

**Does NOT own:** Tokens, the login API call, or any logout side-effects beyond deleting its own storage entry.

---

### `src/auth/AuthService.ts`

**What it is:** The central orchestrator for everything authentication-related.

**Why it exists:** This is the module that makes decisions. It calls the API, decides whether the response is trustworthy, chooses which storage keys to write, coordinates the session lifecycle, and tells the rest of the app what happened. Concentrating these decisions here means a screen component never has to "know" that login involves three async steps — it just calls `authService.login()`.

**Owns:**
- `login(credentials)` — orchestrate API call → token storage → session start → state broadcast
- `logout(reason?)` — orchestrate token deletion → session clear → state broadcast; guarded against duplicate concurrent calls via `isLoggingOut` flag
- `isAuthenticated()` — return `true` only when *both* a token is present *and* the session is still valid
- `getAccessToken()` — read the stored access token (used by HTTP interceptors)
- `onStateChange(listener)` — pub/sub: the listener is called immediately with current state, and again on every change; returns an unsubscribe function

**Does NOT own:** React state, any UI component, navigation, or biometrics. It is deliberately a plain TypeScript class with no framework imports.

**Critical detail — the deduplication guard:**
```
isLoggingOut = false

logout():
  if (isLoggingOut) return   ← second caller exits here
  isLoggingOut = true        ← set SYNCHRONOUSLY before any await
  await clear tokens + session
  isLoggingOut = false
```
JavaScript is single-threaded, so setting `isLoggingOut = true` before the first `await` guarantees no other synchronous code can slip in between and start a second logout.

---

### `src/auth/BiometricService.ts`

**What it is:** A thin, never-throws wrapper around the device biometric prompt.

**Why it exists:** Biometric APIs are noisy. They throw on unavailability, return platform-specific strings, and behave differently on iOS vs Android. Wrapping them here means callers get a clean `{ success, error? }` object every time, without any try/catch boilerplate.

**Owns:**
- `isAvailable()` — ask the OS whether Face ID / Touch ID / Fingerprint is enrolled and usable
- `authenticate(promptMessage?)` — show the system prompt; if the sensor is unavailable, return `{ success: false }` *without* prompting

**Does NOT own:** The login flow, session creation, or any storage. It only answers "can the user prove they are who they say they are via biometrics right now?"

---

### `src/websocket/WebSocketService.ts`

**What it is:** A persistent push-channel listener.

**Why it exists:** The backend needs a way to invalidate sessions server-side (e.g., an admin revokes an officer's access mid-shift). Polling would introduce latency. WebSockets let the server push a `force_logout` event that the app acts on immediately.

**Owns:**
- `connect(url, token)` — open a WebSocket, append the auth token as a query parameter for server-side verification
- `disconnect()` — close the socket cleanly
- `isConnected()` — observable state flag
- Message routing — parse incoming JSON, dispatch known event types

**Does NOT own:** The logout implementation. On `force_logout` it calls `authService.logout(FORCE_LOGOUT)` and lets `AuthService` do the actual work. This keeps the logout path identical regardless of whether it was triggered by the user, session expiry, or the server.

---

### `src/store/AuthStore.ts`

**What it is:** A synchronous, non-React state snapshot.

**Why it exists:** `useAuth` is only usable inside a React component. But some parts of the app need to read auth state outside components — for example, a navigation guard that runs before any screen renders, or a background task that checks the token. `AuthStore.getState()` is a plain method call that always returns the latest state synchronously.

**Owns:**
- A single `AuthState` property, kept current by subscribing to `AuthService.onStateChange` in its constructor
- `getState()` — returns `Readonly<AuthState>`
- `destroy()` — unsubscribes from `AuthService` on app teardown

**Does NOT own:** Any React state, any rendering logic.

---

### `src/hooks/useAuth.ts`

**What it is:** The React-facing adapter.

**Why it exists:** React components need to re-render when auth state changes. `AuthService.onStateChange` is a plain callback pattern, but React expects state to live in `useState`. This hook is the bridge: it subscribes in `useEffect`, sets React state via `setAuthState`, and cleans up in the `useEffect` return.

**Owns:**
- Subscribing to `AuthService` on component mount, unsubscribing on unmount
- Exposing `{ isAuthenticated, isLoading, user, error, logoutReason, login, logout }`

**Does NOT own:** Any logic. `login` and `logout` are thin `useCallback` wrappers that delegate straight to `authService`. The hook contains no `if` statements.

---

### `src/container/ServiceContainer.ts`  *(Composition Root)*

**What it is:** The wiring diagram expressed as code.

**Why it exists:** If each module created its own dependencies with `new`, they would be hard-coded to specific implementations. The composition root creates every instance in one place and passes them in (dependency injection). The rest of the codebase only ever sees interfaces.

**Owns:** Exactly one function — `createAppServices(apiClient)` — which instantiates and wires everything:
```
SecureStorageService
    ↓ injected into
SessionManager
    ↓ injected into (along with SecureStorageService and apiClient)
AuthService
    ↓ injected into
WebSocketService, AuthStore
```

**Does NOT own:** Any business logic. It is a pure wiring file.

---

## 3. Dependency Graph

Arrows mean "imports / depends on":

```
ServiceContainer
  ├─→ SecureStorageService
  ├─→ SessionManager          → SecureStorageService
  ├─→ AuthService             → SecureStorageService
  │                           → SessionManager
  │                           → IAuthApiClient (your impl)
  │                           → auth.types
  ├─→ BiometricService        → react-native-biometrics
  ├─→ WebSocketService        → AuthService (IAuthService)
  │                           → auth.types
  └─→ AuthStore               → AuthService (IAuthService)
                              → auth.types

useAuth (hook)                → AuthService (IAuthService)
                              → auth.types

All of the above             → auth.types   (types only, no logic)
```

`auth.types` sits at the very bottom — nothing imports from it except to use a type, and it imports nothing itself.

---

## 4. Flow Walkthroughs

### Flow 1 — Login

```
User taps "Log In"
        │
        ▼
LoginScreen
  calls useAuth().login(credentials)
        │
        ▼
useAuth (hook)
  delegates to authService.login(credentials)
        │
        ▼
AuthService.login()
  1. emitState({ isLoading: true })          → UI shows spinner
  2. await apiClient.authenticate(credentials)
        │
        ├── API error → emitState({ error }) → UI shows error message
        │               re-throws so caller can catch too
        │
        └── API success → returns { accessToken, refreshToken, user }
               │
               ▼
  3. storageService.setItem('auth_access_token',  accessToken)
  4. storageService.setItem('auth_refresh_token', refreshToken)
  5. sessionManager.startSession(user.id)    → writes { userId, createdAt: now }
  6. emitState({ isAuthenticated: true, user })
        │
        ▼
AuthStore (subscribed since app start)
  updates its internal snapshot silently

useAuth (subscribed via useEffect)
  React re-renders LoginScreen → isAuthenticated is now true → navigate to Home
        │
        ▼
App.tsx / Navigator
  After login completes, call webSocketService.connect(url, token)
  → persistent push channel open for force-logout events
```

---

### Flow 2 — App Restart with a Valid Local Session (Biometric Re-entry)

```
App cold-starts
        │
        ▼
App.tsx / SplashScreen
  1. await authService.isAuthenticated()
        │
        ├── false → show LoginScreen (token missing or session expired)
        │
        └── true → token present AND session < 10 hours old
               │
               ▼
  2. await biometricService.isAvailable()
        │
        ├── false → show LoginScreen (device has no biometrics)
        │
        └── true
               │
               ▼
  3. await biometricService.authenticate('Re-enter to continue')
        │
        ├── { success: false } → show LoginScreen or error prompt
        │
        └── { success: true }
               │
               ▼
  4. No credentials needed — session is already valid.
     Navigate directly to Home screen.
     The existing AuthService state is already authenticated
     (tokens are in storage; session has not expired).
```

**Key insight:** biometric re-entry does NOT call `authService.login()`. That would force a network round-trip and a new session. Instead, it re-uses the existing valid session — biometrics just gates *access* to the app without re-authenticating with the server.

---

### Flow 3 — Session Expires (10-hour boundary)

```
Officer leaves device on desk for > 10 hours

Next screen transition / API call
        │
        ▼
HTTP interceptor (your API client)
  calls await authService.getAccessToken()
        │
        └── token string is returned (tokens are never auto-deleted on expiry)

        ▼
HTTP interceptor (or any guard that checks auth)
  calls await authService.isAuthenticated()
        │
        ▼
AuthService.isAuthenticated()
  1. storageService.getItem('auth_access_token') → non-null (token still there)
  2. sessionManager.isSessionValid()
        │
        ▼
SessionManager.isSessionValid()
  reads stored { createdAt }
  Date.now() - createdAt ≥ SESSION_DURATION_MS (36,000,000 ms)
  returns FALSE
        │
        ▼
AuthService.isAuthenticated() returns FALSE
        │
        ▼
Guard / interceptor calls authService.logout(LogoutReason.SESSION_EXPIRED)
        │
        ▼
AuthService.logout()
  removes both tokens + clears session
  emitState({ isAuthenticated: false, logoutReason: SESSION_EXPIRED })
        │
        ▼
useAuth / AuthStore see the state change → app navigates to LoginScreen
  (optional: show "Your session expired" message based on logoutReason)
```

**Key insight:** Session expiry is *lazy* — the timer is not running in the background. The session is checked on demand, which avoids background timers that can misbehave when the device sleeps or the app is backgrounded.

---

### Flow 4 — Backend Force Logout

```
HQ admin revokes officer's access mid-shift
        │
        ▼
Backend pushes WebSocket frame:
  { "type": "force_logout" }
        │
        ▼
WebSocketService.onmessage fires
  handleMessage() parses the JSON
  matches case 'force_logout'
  calls authService.logout(LogoutReason.FORCE_LOGOUT)
        │
        ▼
AuthService.logout()
  isLoggingOut check:
    If user simultaneously tapped "Log out" button:
      one call sees isLoggingOut = true → returns immediately (no double-wipe)
    Otherwise:
      isLoggingOut = true  (synchronous, before any await)
      removes tokens + session in parallel
      emitState({ isAuthenticated: false, logoutReason: FORCE_LOGOUT })
      isLoggingOut = false
        │
        ▼
useAuth / AuthStore see the state change
  UI navigates to LoginScreen
  (optional: show "You have been logged out by an administrator" based on logoutReason)
```

---

## 5. Key Design Decisions, Plain-Language Justification

| Decision | Why |
|---|---|
| **Interfaces everywhere** | Every service defines an `I`-prefixed interface. Consumers import the interface, not the class. This lets tests pass in-memory mocks without any native binaries. |
| **Single composition root** | `ServiceContainer.ts` is the only file that calls `new` on a concrete class. This is the *only* place that needs to change when you swap an implementation. |
| **Pub/sub over props drilling** | `AuthService.onStateChange` broadcasts state to any number of listeners. Neither the hook nor the store needs to be aware of each other, and neither the screen nor the navigator needs to pass auth state down as props. |
| **Synchronous deduplication guard** | `isLoggingOut = true` is set before the first `await` in `logout()`. JavaScript's event loop guarantees no other code runs between a synchronous assignment and the next `await`, so the guard is race-condition-free. |
| **Lazy session expiry** | Checking `Date.now() - createdAt` on demand rather than running a `setInterval` means the check is accurate even after the device sleeps for hours, and no background timer needs to be managed. |
| **Biometric re-entry ≠ re-login** | Biometrics gate app *access*, not server *authentication*. The existing session is reused. This keeps offline scenarios working and avoids a network round-trip every time the officer unlocks the device. |
| **Tokens in Keychain, not AsyncStorage** | AsyncStorage is unencrypted. Keychain/Keystore is encrypted and access-controlled by the OS. Auth tokens are sensitive; they must not be readable without device unlock. |
| **`LogoutReason` enum** | Carrying the reason through the state broadcast lets the UI show the right message ("session expired" vs "you were logged out by an admin") and lets analytics distinguish voluntary logouts from security events. |

---

## 6. Source of Truth for Auth/Session State

Understanding where canonical state lives is critical for debugging and for avoiding subtle race conditions.

### The hierarchy

```
AuthService.currentState           ← THE canonical source of truth (private field)
        │
        │  broadcast via onStateChange()
        ▼
AuthStore.state                    ← derived copy for imperative / non-React consumers
useAuth → React useState           ← derived copy for React component re-renders
```

There is exactly **one producer**: `AuthService.emitState()`. Everything else is a read-only copy kept current by the pub/sub subscription.

### Why the source is private — and what to use instead

`AuthService.currentState` is a private field. You cannot read the canonical state directly from outside the class. This is intentional: external code should not poll the field — it should either:

1. **Subscribe** — call `authService.onStateChange(listener)` to receive every future state as it happens.
2. **Read the store snapshot** — call `authStore.getState()` for an immediate, synchronous, up-to-date copy (works outside React components).
3. **Use the hook** — call `useAuth(authService)` inside a React component to get reactive state plus the `login` / `logout` actions.

If you find yourself wanting to check `authService.currentState` directly, that is a signal to use `authStore.getState()` instead.

### The session validity split

There are actually **two** separate sub-states that together answer "is the user authenticated?":

| What | Where stored | Expiry semantics |
|---|---|---|
| Access token | Keychain (`auth_access_token`) | Server-side only (token itself may carry an `exp` claim) |
| Session record | Keychain (`auth_session_data`) | Client-side: `Date.now() - createdAt < 10 hours` |

`AuthService.isAuthenticated()` AND-combines both: a valid token **and** a valid session must exist. If either is absent, the result is false. The token alone is not sufficient.

The AuthState snapshot (`{ isAuthenticated, user, ... }`) in `AuthService.currentState` reflects the result of the last login/logout operation, **not** a live re-check of storage. This means the snapshot can be stale: if something external deletes the Keychain token (device wipe, OS update), the in-memory snapshot still says `isAuthenticated: true` until the next `isAuthenticated()` call triggers a logout. For a real app, navigation guards and HTTP interceptors should call `authService.isAuthenticated()` on every sensitive boundary, not read the cached snapshot.

### How the three security flows converge on a single logout path

Session expiry, biometric failure, and force logout all end at the same place:

```
Session expired      →  caller calls  authService.logout(SESSION_EXPIRED)
Biometric failed     →  caller calls  authService.logout(BIOMETRIC_FAILED)
WS force_logout      →  WebSocketService calls  authService.logout(FORCE_LOGOUT)
User taps "Log out"  →  useAuth calls  authService.logout(USER_INITIATED)
                                │
                                ▼
                      AuthService.logout()
                        ─ clears tokens
                        ─ clears session
                        ─ emitState({ isAuthenticated: false, logoutReason })
                                │
                         single broadcast
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
              AuthStore               useAuth hook
              (nav guards)            (screens re-render)
```

The reason this matters: there is **one** path through which logout side-effects (token deletion, session clear, UI notification) happen. You cannot accidentally introduce a second path that deletes tokens without notifying the UI, or notifies the UI without deleting tokens.

---

## 7. Testability — Intentional Decoupling Seams

The codebase has six explicit decoupling seams. Each one was created for a specific testing reason.

### Seam 1: `ISecureStorageService`

**What crosses the seam:** All reads and writes to the device Keychain.

**Why it exists:** `react-native-keychain` ships native binaries (`.aar` for Android, `.framework` for iOS). Running Jest in Node without a device would fail immediately. The interface lets every test that needs "storage" inject a `jest.Mocked<ISecureStorageService>` instead.

**Who uses it in tests:** `SessionManager.test.ts`, `AuthService.test.ts`.

```typescript
const mockStorage: jest.Mocked<ISecureStorageService> = {
  setItem: jest.fn(),
  getItem: jest.fn(),
  removeItem: jest.fn(),
  clearAll: jest.fn(),
};
```

### Seam 2: `ISessionManager`

**What crosses the seam:** All session validity decisions (the 10-hour rule).

**Why it exists:** `AuthService` tests should not need to construct a real `SessionManager` (which would require a real storage mock) just to test the login flow. The seam lets `AuthService` tests say `mockSessionManager.isSessionValid.mockResolvedValue(true)` and focus solely on orchestration logic.

**Who uses it in tests:** `AuthService.test.ts`.

### Seam 3: `IAuthApiClient`

**What crosses the seam:** The HTTP authentication call to the backend.

**Why it exists:** Unit tests must never make real network calls. The interface also means the entire auth foundation was built and tested before any HTTP client existed — `mockApiClient.authenticate.mockResolvedValue(validTokens)` was the only API client needed.

**Who uses it in tests:** `AuthService.test.ts`.

### Seam 4: `IAuthService`

**What crosses the seam:** All auth state and actions from the perspective of consumers.

**Why it exists:** `WebSocketService` and `AuthStore` depend on auth behaviour but should not instantiate a full `AuthService` (with its three dependencies). The interface lets them be tested in complete isolation.

**Who uses it in tests:** `WebSocketService.test.ts` (mocks `logout`), `AuthStore` tests.

### Seam 5: `ReactNativeBiometrics` (constructor injection)

**What crosses the seam:** Device biometric sensor calls.

**Why it exists:** The biometric APIs require a physical device or simulator. `BiometricService` accepts an optional `ReactNativeBiometrics` instance in its constructor, so tests pass a mock without running native code.

**Who uses it in tests:** `BiometricService.test.ts` — the mock is created from the manual mock in `__mocks__/react-native-biometrics.ts`.

### Seam 6: Global `WebSocket`

**What crosses the seam:** The WebSocket connection lifecycle and message events.

**Why it exists:** `WebSocket` is a browser/React Native global, not a Node.js built-in. `WebSocketService.test.ts` replaces `global.WebSocket` with a `MockWebSocket` class that exposes `simulateOpen()`, `simulateMessage()`, `simulateClose()`, and `simulateError()` helpers. This lets tests drive the full connection lifecycle synchronously without a real server.

```typescript
// From WebSocketService.test.ts
global.WebSocket = jest.fn().mockImplementation(() => {
  const instance = new MockWebSocket();
  MockWebSocket.instances.push(instance);
  return instance;
}) as unknown as typeof WebSocket;
```

### Summary table

| Seam | Interface / injection point | Removes dependency on |
|---|---|---|
| `ISecureStorageService` | Constructor parameter | Native Keychain binaries |
| `ISessionManager` | Constructor parameter | Real session storage logic |
| `IAuthApiClient` | Constructor parameter | Real HTTP network calls |
| `IAuthService` | Constructor parameter | Full AuthService wiring |
| `ReactNativeBiometrics` | Optional constructor parameter | Native biometric sensor |
| Global `WebSocket` | `global.WebSocket = jest.fn()` | Real WebSocket server |

The business logic layer (AuthService, SessionManager, WebSocketService) has **no React imports** at all. This means every business-logic test runs in plain Node.js with no jsdom, no React test renderer, and no simulator — the full 43-test suite completes in under 1.5 seconds.

---

## 8. Senior Engineer Critical Review

This section gives an honest assessment of the current implementation: what works well, what is incomplete, what is risky in production, and what will cause maintenance pain as the codebase grows.

---

### ✅ What is genuinely good

**1. Interface-first dependency injection, consistently applied.**
Every service has an `I`-prefixed interface, and every constructor takes the interface — not the class. This single discipline is why the entire test suite runs in Node without a simulator. It also means the business logic layer is framework-agnostic. Swapping `react-native-keychain` for `expo-secure-store` requires changing one file.

**2. Composition root.**
`ServiceContainer.ts` is the only file that uses `new` on a concrete class. All wiring happens there. Every other file sees only interfaces. This is textbook clean architecture.

**3. `AuthService` has zero React imports.**
The most important design decision in the codebase. When business logic is React-free, it can be unit-tested in Node, extracted to a shared package, reused in a web app, or migrated to a different framework without changes.

**4. The `isLoggingOut` guard is correctly implemented.**
Setting `isLoggingOut = true` synchronously before the first `await` is the right way to deduplicate concurrent logout calls in JavaScript. Many implementations get this wrong by setting the flag after the first await.

**5. Lazy session expiry instead of a background timer.**
Checking `Date.now() - createdAt` on demand is correct for mobile. Background timers in React Native apps are unreliable: the OS can kill them when the app is backgrounded. On-demand checking means the expiry check is always accurate, even if the device was in airplane mode for 12 hours.

**6. `LogoutReason` flows all the way through.**
The reason is carried from the trigger point (WebSocket message, button tap, session check) through `AuthService.logout()`, into `AuthState`, out to every subscriber. This enables differentiated UX messaging ("Your session expired" vs. "You were logged out by an administrator") and lets analytics distinguish voluntary from security-triggered logouts.

**7. `onStateChange` broadcasts the current state immediately.**
A listener that subscribes gets the current state synchronously before the first await. This means there is no "unknown initial state" window — any subscriber is immediately in sync.

**8. `AuthStore` for non-React imperative access.**
Navigation guards, HTTP interceptors, and background tasks need to read auth state without being inside a React component. `AuthStore.getState()` satisfies this without a second subscription and without pulling in React.

**9. All 43 tests run in pure Node in under 1.5 seconds.**
Fast, reliable, native-free tests are the bedrock of sustainable development. The test suite covers every service independently and with controlled mock behavior.

---

### ⚠️ What is weak or incomplete

**1. No token refresh logic — the most critical production gap.**
The architecture stores both `accessToken` and `refreshToken`, but there is no token refresh implementation. Access tokens have short TTLs (typically 15 minutes to 1 hour on most identity servers). Once the access token expires, every API call will return 401. The app has no mechanism to silently refresh, no 401 interceptor, and no retry logic. In production, officers will experience silent API failures within the first hour of a shift.

What is needed: an HTTP interceptor that catches 401 responses, calls a `/token/refresh` endpoint with the refresh token, updates both storage keys, and retries the original request. This interceptor would interact with `AuthService` — it must call `getAccessToken()` for the current token, and `logout(SESSION_EXPIRED)` if refresh fails.

**2. `clearAll()` does not actually clear all tokens.**
`SecureStorageService.clearAll()` calls `Keychain.resetGenericPassword()` with no service option, which resets only the default (no-service) keychain entry. But `setItem()` stores every value with `{ service: key }`. So the `auth_access_token` and `auth_refresh_token` entries are stored under named services and are **not deleted** by `clearAll()`. The comment even acknowledges this. If any code path calls `clearAll()` expecting a full wipe, tokens survive.

**3. WebSocket has no reconnection logic.**
When `onclose` fires, `connected` is set to `false` and nothing else happens. On a mobile device, the WebSocket will drop on network changes (WiFi → cellular handoff), OS backgrounding, and tunnel transitions. Without reconnection, the app silently loses its force-logout channel. An officer who walks into a basement for 20 minutes will miss any force-logout events pushed during that time. Reconnection with exponential back-off is a standard requirement for production WebSocket clients.

**4. Access token sent as a URL query parameter to WebSocket.**
```typescript
const fullUrl = `${url}?token=${token}`;
```
The code comment acknowledges this is a security concern. In practice: the token appears in server access logs, load-balancer logs, reverse proxy logs, and network monitoring tools — in cleartext. For a law enforcement application, this is a compliance risk (CJIS Security Policy requires protection of Criminal Justice Information in transit). A short-lived WebSocket handshake token, or sending the auth token in the first WebSocket message after connection, would eliminate log exposure.

**5. Initial state causes a navigation flicker on cold start.**
```typescript
private currentState: AuthState = { isAuthenticated: false, isLoading: false };
```
The initial state is always "not authenticated, not loading." On cold start, any subscriber (including `useAuth`) immediately receives this state. If a navigation guard acts on it, the app briefly shows the login screen — then reads from Keychain, discovers a valid session, and redirects to home. Users see a flicker. The fix is an explicit `isInitializing: boolean` flag in `AuthState`, set to `true` at startup and `false` after the first Keychain read completes.

**6. `logout()` errors are silently swallowed.**
```typescript
try {
  await Promise.all([removeItem(...), removeItem(...), clearSession()]);
  this.emitState({ isAuthenticated: false });
} finally {
  this.isLoggingOut = false;
}
```
If any of the storage operations throw (Keychain unavailable, OS permission error, storage full), the error is caught by the `finally` block, `emitState` is called, and the app tells the user they are logged out. But the tokens may still be in storage. This is a security defect: the perceived security state ("I'm logged out") differs from the actual credential state ("my token is still accessible"). The logout should either succeed completely or surface an error to the caller.

**7. `AuthStore` is not observable for React consumers.**
`getState()` returns a plain object snapshot. A React component that reads `authStore.getState()` directly will render the correct state *at mount time* but will not re-render when state changes. The name `AuthStore` suggests a reactive store (MobX, Zustand), but the semantics are a plain getter. Future developers may use it in a component and wonder why it doesn't update.

---

### 🔗 What feels too tightly coupled

**1. `WebSocketService` directly calls `authService.logout()`.**
The WebSocketService has a direct compile-time dependency on the `IAuthService.logout()` signature. If logout semantics ever change — for example, if logout becomes a two-step process or if the WebSocket layer should emit a domain event rather than acting directly — WebSocketService must be changed. A more decoupled design: `WebSocketService` emits a typed event (e.g., `onForceLogout: () => void`) and the caller (App.tsx, or an AppController) decides to call logout. This inverts the dependency and makes `WebSocketService` reusable in scenarios that don't use `AuthService`.

**2. `AuthService` owns three distinct responsibilities.**
`AuthService` is the orchestrator, state broadcaster, and session coordinator all at once. As the app grows with token refresh, biometric re-authentication guards, and role-based access, this class will accumulate responsibilities. A future refactor might separate: a `TokenService` (token storage and refresh), the session lifecycle (already in `SessionManager`), and a thin `AuthCoordinator` that only orchestrates and broadcasts state.

**3. `SessionManager` and `AuthService` share the same `ISecureStorageService` instance.**
Both classes write to the same Keychain store. They coordinate by using different key names (`auth_access_token` vs `auth_session_data`), but that coordination is implicit. If a future developer adds a new key to either class, they need to know to avoid collisions with the other. Centralising the key registry (e.g., a `StorageKeys` constants file) would make the coordination explicit.

---

### 🔧 What could become difficult to maintain

**1. No token refresh means a large future addition to a critical path.**
When token refresh is added, it will need to: intercept HTTP 401 responses, acquire a lock so only one refresh happens even when multiple requests 401 simultaneously, call the refresh API, update two Keychain entries, notify all `onStateChange` listeners, and retry the original request. All of that logic will land in or near `AuthService`, making it significantly more complex. The current clean architecture is a good foundation, but the gap is substantial.

**2. Hardcoded storage keys as string literals across two files.**
`'auth_access_token'` and `'auth_refresh_token'` are in `AuthService.ts`. `'auth_session_data'` is in `SessionManager.ts`. There is no shared registry. Renaming a key means finding every usage by string search.

**3. Session data structure cannot evolve without breaking stored sessions.**
`SessionData` is `{ userId, createdAt }`. Adding a field (e.g., `lastActivityAt` for sliding-window expiry, or `role` for role-based expiry durations) requires a migration: the `getSessionData()` parser will fail on old-format stored sessions unless it handles both shapes. There is currently no versioning or migration strategy for stored session data.

**4. Logger sends `info`, `warn`, and `error` to console in production builds.**
Only `debug` is suppressed in production. This means user IDs, login attempt usernames, and logout reasons appear in Android logcat and iOS syslog in production. For an enforcement app, this is an information-disclosure risk. Production logging should be routed to a remote sink (Sentry, Datadog) with appropriate filtering, not left on the console.

---

### 🚨 Production risks specific to React Native

**1. Token refresh absence causes silent API failures within the first hour.**
Access tokens expire. Without refresh, API calls will begin returning 401 without any user-visible explanation. In a field enforcement scenario, this could mean an officer cannot submit a report mid-incident because their token expired.

**2. Missed force-logout due to WebSocket drop.**
Mobile devices drop WebSocket connections regularly. Without reconnection, the only safety net for a server-side revocation is session expiry (up to 10 hours later). For an enforcement app where an officer's credentials are compromised or their account is revoked, 10 hours is far too long.

**3. The `clearAll()` bug leaves credentials on device.**
See weakness #2 above. Any code path that calls `secureStorage.clearAll()` — including third-party libraries or a future developer's "factory reset" feature — leaves the actual tokens in place.

**4. Navigation flicker undermines trust.**
On every cold start, the app briefly displays the login screen, then redirects to the home screen. Officers will notice this inconsistency. It also causes functional issues: any component that renders during the flicker and checks auth state will see `isAuthenticated: false` and may execute logic intended only for unauthenticated users.

**5. Android hardware-backed Keystore is not enforced.**
`react-native-keychain` uses the Android Keystore, but hardware-backed key storage requires both the device hardware support and explicit configuration. On devices without a Trusted Execution Environment (TEE) or on rooted devices where the TEE can be bypassed, tokens are only software-encrypted. The app does not detect or reject these conditions.

**6. `simplePrompt` does not produce a cryptographic proof.**
`react-native-biometrics.simplePrompt()` asks the OS to verify the user's biometric and returns `{ success: true/false }`. It does not produce a signed assertion that can be verified server-side. This is appropriate for local app-unlock, but if the requirement ever evolves to "prove to the server that this officer authenticated biometrically," the entire biometric layer would need to be replaced with key-pair-backed attestation (also available in the `react-native-biometrics` library via `createKeys` and `createSignature`).

---

### Summary scorecard

| Dimension | Rating | Key issue |
|---|---|---|
| Architecture & layering | ⭐⭐⭐⭐⭐ | Clean separation, DI throughout |
| Testability | ⭐⭐⭐⭐⭐ | 43 tests, pure Node, fast |
| Token lifecycle | ⭐⭐ | No refresh logic; `clearAll()` bug |
| WebSocket reliability | ⭐⭐ | No reconnect; token in URL |
| State initialization | ⭐⭐⭐ | No `isInitializing` flag causes flicker |
| Error handling | ⭐⭐⭐ | Logout errors silently swallowed |
| Production readiness | ⭐⭐⭐ | Strong foundation; several gaps before shipping |
