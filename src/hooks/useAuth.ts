/**
 * useAuth.ts
 *
 * React hook that exposes auth state and the login / logout actions to any
 * functional component.
 *
 * The hook subscribes to AuthService state changes on mount and cleans up
 * on unmount, so components are always in sync with the latest auth state
 * without any manual subscription management.
 *
 * Usage:
 *   const { isAuthenticated, isLoading, user, login, logout } = useAuth(authService);
 *
 * The authService dependency is intentionally explicit (injected rather than
 * imported from a singleton) so the hook is fully testable in isolation using
 * a mock IAuthService.
 */

import { useState, useEffect, useCallback } from 'react';
import { AuthState, LoginCredentials, LogoutReason } from '../types/auth.types';
import { IAuthService } from '../auth/AuthService';

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface UseAuthReturn extends AuthState {
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: (reason?: LogoutReason) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuth(authService: IAuthService): UseAuthReturn {
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    isLoading: false,
  });

  useEffect(() => {
    // onStateChange returns an unsubscribe function — return it directly as
    // the effect cleanup so React calls it on unmount.
    const unsubscribe = authService.onStateChange(setAuthState);
    return unsubscribe;
  }, [authService]);

  const login = useCallback(
    async (credentials: LoginCredentials): Promise<void> => {
      await authService.login(credentials);
    },
    [authService],
  );

  const logout = useCallback(
    async (reason?: LogoutReason): Promise<void> => {
      await authService.logout(reason);
    },
    [authService],
  );

  return { ...authState, login, logout };
}
