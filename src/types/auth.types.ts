/**
 * auth.types.ts
 *
 * Central repository of TypeScript types, interfaces, and enums used across
 * the authentication and session modules.  Keeping them in one place avoids
 * circular imports and makes the data contracts easy to audit.
 */

// ---------------------------------------------------------------------------
// Domain entities
// ---------------------------------------------------------------------------

/** Represents the authenticated officer / user. */
export interface AuthUser {
  /** Unique user identifier (e.g. UUID from the backend). */
  id: string;
  username: string;
  email: string;
  /** Role label used for access-control checks (e.g. 'officer', 'supervisor'). */
  role: string;
}

// ---------------------------------------------------------------------------
// Request / response shapes
// ---------------------------------------------------------------------------

/** Credentials submitted on the login screen. */
export interface LoginCredentials {
  username: string;
  password: string;
}

/** Token bundle returned by the authentication API. */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/**
 * Persisted session snapshot written to secure storage when a user logs in.
 * The `createdAt` timestamp is compared against SESSION_DURATION_MS to decide
 * whether the session is still valid.
 */
export interface SessionData {
  userId: string;
  /** Unix timestamp in milliseconds at the moment the session was created. */
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Auth state (consumed by the UI / AuthStore)
// ---------------------------------------------------------------------------

/** Reasons a logout can be triggered — used for analytics and UX messaging. */
export enum LogoutReason {
  USER_INITIATED = 'USER_INITIATED',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  FORCE_LOGOUT = 'FORCE_LOGOUT',
  BIOMETRIC_FAILED = 'BIOMETRIC_FAILED',
}

/**
 * Snapshot of the current authentication state broadcast by AuthService.
 * UI components observe this object through the useAuth hook or AuthStore.
 */
export interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  /** The authenticated user — present only when isAuthenticated is true. */
  user?: AuthUser;
  /** Human-readable error message from the last failed operation. */
  error?: string;
  /** Set when the state transitions to logged-out. */
  logoutReason?: LogoutReason;
}
