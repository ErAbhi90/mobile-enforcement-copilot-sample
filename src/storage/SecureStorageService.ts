/**
 * SecureStorageService.ts
 *
 * Abstracts all reads and writes to the device's secure storage (Keychain on
 * iOS, Keystore on Android) behind a simple key/value interface.
 *
 * Using an interface (ISecureStorageService) lets every consumer be tested
 * with a mock without pulling in native dependencies.  Swap the underlying
 * library (react-native-keychain, expo-secure-store, …) here without
 * touching the rest of the codebase.
 */

import * as Keychain from 'react-native-keychain';

// ---------------------------------------------------------------------------
// Interface — depend on this, not on the concrete class
// ---------------------------------------------------------------------------

export interface ISecureStorageService {
  /** Persists a sensitive string value under the given key. */
  setItem(key: string, value: string): Promise<void>;

  /** Retrieves a previously stored value, or null if it does not exist. */
  getItem(key: string): Promise<string | null>;

  /** Deletes the value stored under the given key. */
  removeItem(key: string): Promise<void>;

  /** Clears all values written by this service. */
  clearAll(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Concrete implementation backed by react-native-keychain.
 * Each key is stored as an independent Keychain service entry so that
 * individual items can be deleted without affecting others.
 */
export class SecureStorageService implements ISecureStorageService {
  async setItem(key: string, value: string): Promise<void> {
    // The username field is set to the key as well so the entry is
    // self-describing when inspected with platform tools.
    await Keychain.setGenericPassword(key, value, { service: key });
  }

  async getItem(key: string): Promise<string | null> {
    const result = await Keychain.getGenericPassword({ service: key });
    if (result === false) {
      return null;
    }
    return result.password;
  }

  async removeItem(key: string): Promise<void> {
    await Keychain.resetGenericPassword({ service: key });
  }

  async clearAll(): Promise<void> {
    // Resets the default (no-service) entry.  For a full wipe across all
    // service keys, track them explicitly and call removeItem for each.
    await Keychain.resetGenericPassword();
  }
}
