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
