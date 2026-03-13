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
   */
  authenticate(promptMessage?: string): Promise<BiometricResult>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class BiometricService implements IBiometricService {
  private readonly rnBiometrics: ReactNativeBiometrics;

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
   * @param promptMessage - Message shown inside the OS biometric dialog.
   */
  async authenticate(
    promptMessage = 'Confirm your identity to continue',
  ): Promise<BiometricResult> {
    const available = await this.isAvailable();
    if (!available) {
      return {
        success: false,
        error: 'Biometric authentication is not available on this device',
      };
    }

    const result = await this.rnBiometrics.simplePrompt({ promptMessage });
    return {
      success: result.success,
      error: result.error,
    };
  }
}
