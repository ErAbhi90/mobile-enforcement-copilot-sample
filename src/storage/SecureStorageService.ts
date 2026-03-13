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
 *
 * The constructor accepts a list of every key this service manages.
 * clearAll() uses that list to remove each named service entry individually,
 * which is the only way to wipe all entries stored with { service: key }.
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
 *
 * @param knownKeys - The complete list of key names this instance manages.
 *   Used exclusively by clearAll() to remove every named service entry.
 *   Pass StorageKeys.ALL_STORAGE_KEYS from the composition root.
 */
export class SecureStorageService implements ISecureStorageService {
  constructor(private readonly knownKeys: readonly string[] = []) {}

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

  /**
   * Removes every key that was declared at construction time.
   *
   * Each key was written with { service: key }, so it must be deleted the
   * same way.  Calling resetGenericPassword() without a service option only
   * resets the default (no-service) entry and leaves all named entries intact.
   */
  async clearAll(): Promise<void> {
    await Promise.all(this.knownKeys.map(key => this.removeItem(key)));
  }
}
