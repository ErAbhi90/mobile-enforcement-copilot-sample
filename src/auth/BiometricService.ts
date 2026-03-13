/**
 * BiometricService.ts
 *
 * Encapsulates device biometric authentication (Face ID, Touch ID,
 * Fingerprint) behind a clean interface.
 *
 * Responsibilities:
 *  - Check whether the device supports and has enrolled biometrics.
 *  - Prompt the user for biometric verification.
 *  - Return a typed result so callers never need to handle raw library output.
 *
 * The ReactNativeBiometrics instance is injected via the constructor so tests
 * can pass a mock without any native runtime.
 *
 * Edge-case handling:
 *  - cancel() sets a flag that is checked after the native biometric prompt
 *    returns.  If a force-logout fires while the prompt is on screen, the
 *    composition root calls cancel() so the result is treated as a failure
 *    regardless of what the OS returned.  The flag is reset at the beginning
 *    of each new authenticate() call so cancelling when idle is harmless.
 */

import ReactNativeBiometrics from 'react-native-biometrics';

// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

export interface BiometricResult {
  success: boolean;
  /** Present when success is false — describes why authentication failed. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface IBiometricService {
  /** Returns true when the device has a usable biometric sensor. */
  isAvailable(): Promise<boolean>;

  /**
   * Prompts the user to authenticate with their biometric.
   * Always resolves — never rejects.  Inspect `success` to determine outcome.
   * If cancel() was called while the prompt was on screen, resolves with
   * `{ success: false, error: 'Authentication cancelled' }`.
   */
  authenticate(promptMessage?: string): Promise<BiometricResult>;

  /**
   * Signals that any in-progress authentication should be treated as
   * cancelled on completion.  Call this when a force-logout fires while
   * the biometric prompt is visible.  The flag is reset automatically at
   * the start of the next authenticate() call.
   */
  cancel(): void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class BiometricService implements IBiometricService {
  private readonly rnBiometrics: ReactNativeBiometrics;

  /**
   * Set to true by cancel().  Checked after simplePrompt() returns so that
   * a force-logout that fires during the prompt causes authenticate() to
   * return a failure even if the OS granted the biometric successfully.
   */
  private cancelled = false;

  /**
   * @param rnBiometrics - Optional ReactNativeBiometrics instance.
   *   Omit in production; provide a mock in tests.
   */
  constructor(rnBiometrics?: ReactNativeBiometrics) {
    this.rnBiometrics = rnBiometrics ?? new ReactNativeBiometrics();
  }

  async isAvailable(): Promise<boolean> {
    const { available } = await this.rnBiometrics.isSensorAvailable();
    return available;
  }

  /**
   * Shows the platform biometric prompt.  If the device does not support
   * biometrics the method resolves with `{ success: false }` immediately.
   *
   * The `cancelled` flag is reset at the very start of each call so that
   * calling cancel() when idle has no effect on the next authentication.
   *
   * @param promptMessage - Message shown inside the OS biometric dialog.
   */
  async authenticate(
    promptMessage = 'Confirm your identity to continue',
  ): Promise<BiometricResult> {
    // Reset so a stale cancel() from a previous call does not affect this one.
    this.cancelled = false;

    const available = await this.isAvailable();
    if (!available) {
      return {
        success: false,
        error: 'Biometric authentication is not available on this device',
      };
    }

    const result = await this.rnBiometrics.simplePrompt({ promptMessage });

    // If cancel() was called while the prompt was on screen (e.g. a
    // force-logout arrived mid-authentication), treat the result as a failure
    // regardless of what the OS returned.
    if (this.cancelled) {
      return { success: false, error: 'Authentication cancelled' };
    }

    return {
      success: result.success,
      error: result.error,
    };
  }

  cancel(): void {
    this.cancelled = true;
  }
}
