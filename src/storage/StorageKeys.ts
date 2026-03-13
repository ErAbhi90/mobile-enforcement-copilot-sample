/**
 * StorageKeys.ts
 *
 * Central registry of every secure-storage key name used by this application.
 *
 * Having a single authoritative list:
 *  - Prevents accidental key collisions between modules.
 *  - Makes it trivial to audit what is written to the device keychain.
 *  - Lets the composition root pass ALL_STORAGE_KEYS to SecureStorageService
 *    so clearAll() can wipe every named service entry.
 *
 * Import this file; never hard-code key strings in individual services.
 */

export const StorageKeys = {
  ACCESS_TOKEN: 'auth_access_token',
  REFRESH_TOKEN: 'auth_refresh_token',
  SESSION_DATA: 'auth_session_data',
} as const;

export type StorageKey = (typeof StorageKeys)[keyof typeof StorageKeys];

/**
 * Ordered array of every key managed by this application.
 * Passed to SecureStorageService so clearAll() removes all named entries.
 */
export const ALL_STORAGE_KEYS: readonly StorageKey[] = Object.values(StorageKeys);
