/**
 * BiometricService.test.ts
 *
 * Unit tests for the BiometricService.
 *
 * ReactNativeBiometrics is replaced by the manual mock in
 * __mocks__/react-native-biometrics.ts.  Each test creates a fresh
 * BiometricService instance so the mock counters reset cleanly.
 *
 * Test plan:
 *  - isAvailable() returns true when isSensorAvailable reports available.
 *  - isAvailable() returns false when the sensor is not available.
 *  - authenticate() returns { success: true } on a successful prompt.
 *  - authenticate() returns { success: false, error } when the user cancels.
 *  - authenticate() returns { success: false, error } when no sensor is present,
 *    without calling simplePrompt at all.
 *  - authenticate() passes a custom prompt message to simplePrompt.
 *  - cancel() causes a subsequent completed authenticate() to return
 *    { success: false, error: 'Authentication cancelled' } even if the OS
 *    returned a successful biometric result.
 *  - cancel() flag is reset at the start of each new authenticate() call so
 *    a previous cancel does not affect the next authentication.
 */

import { BiometricService } from '../../src/auth/BiometricService';
import ReactNativeBiometrics from 'react-native-biometrics';

const MockRNBiometrics = ReactNativeBiometrics as jest.MockedClass<typeof ReactNativeBiometrics>;

describe('BiometricService', () => {
  let mockInstance: jest.Mocked<InstanceType<typeof ReactNativeBiometrics>>;
  let service: BiometricService;

  beforeEach(() => {
    MockRNBiometrics.mockClear();
    // Inject the mock instance via the constructor so no real native calls happen.
    mockInstance = new MockRNBiometrics() as jest.Mocked<
      InstanceType<typeof ReactNativeBiometrics>
    >;
    MockRNBiometrics.mockClear(); // Clear the constructor call above
    service = new BiometricService(mockInstance as unknown as ReactNativeBiometrics);
  });

  describe('isAvailable()', () => {
    it('should return true when a biometric sensor is available', async () => {
      mockInstance.isSensorAvailable.mockResolvedValue({
        available: true,
        biometryType: 'FaceID',
      });
      expect(await service.isAvailable()).toBe(true);
    });

    it('should return false when no biometric sensor is present', async () => {
      mockInstance.isSensorAvailable.mockResolvedValue({
        available: false,
        biometryType: undefined,
        error: 'No hardware',
      });
      expect(await service.isAvailable()).toBe(false);
    });
  });

  describe('authenticate()', () => {
    it('should return success: true on a successful biometric prompt', async () => {
      mockInstance.isSensorAvailable.mockResolvedValue({
        available: true,
        biometryType: 'TouchID',
      });
      mockInstance.simplePrompt.mockResolvedValue({ success: true });

      const result = await service.authenticate('Confirm identity');
      expect(result.success).toBe(true);
    });

    it('should return success: false with an error when the user cancels', async () => {
      mockInstance.isSensorAvailable.mockResolvedValue({
        available: true,
        biometryType: 'TouchID',
      });
      mockInstance.simplePrompt.mockResolvedValue({
        success: false,
        error: 'User cancelled',
      });

      const result = await service.authenticate();
      expect(result.success).toBe(false);
      expect(result.error).toBe('User cancelled');
    });

    it('should return success: false without calling simplePrompt when unavailable', async () => {
      mockInstance.isSensorAvailable.mockResolvedValue({
        available: false,
        biometryType: undefined,
        error: 'No hardware',
      });

      const result = await service.authenticate();
      expect(result.success).toBe(false);
      expect(result.error).toContain('not available');
      expect(mockInstance.simplePrompt).not.toHaveBeenCalled();
    });

    it('should forward a custom prompt message to simplePrompt', async () => {
      mockInstance.isSensorAvailable.mockResolvedValue({
        available: true,
        biometryType: 'FaceID',
      });
      mockInstance.simplePrompt.mockResolvedValue({ success: true });

      await service.authenticate('Re-authenticate to proceed');
      expect(mockInstance.simplePrompt).toHaveBeenCalledWith({
        promptMessage: 'Re-authenticate to proceed',
      });
    });
  });

  // -------------------------------------------------------------------------
  // cancel()
  // -------------------------------------------------------------------------

  describe('cancel()', () => {
    it('should cause authenticate() to return { success: false } when called while the OS prompt is pending', async () => {
      mockInstance.isSensorAvailable.mockResolvedValue({
        available: true,
        biometryType: 'FaceID',
      });

      // Use a deferred promise so we can call cancel() while the prompt is
      // still in flight — exactly what happens when a force-logout arrives
      // mid-biometric.
      let resolvePrompt!: (value: { success: boolean }) => void;
      mockInstance.simplePrompt.mockReturnValue(
        new Promise<{ success: boolean }>(resolve => {
          resolvePrompt = resolve;
        }),
      );

      // Start authentication — it will suspend inside simplePrompt.
      const authPromise = service.authenticate();

      // Cancel fires while the prompt is on screen.
      service.cancel();

      // The OS eventually grants success, but cancel() should override it.
      resolvePrompt({ success: true });
      const result = await authPromise;

      expect(result.success).toBe(false);
      expect(result.error).toBe('Authentication cancelled');
    });

    it('should reset the cancelled flag at the start of the next authenticate() call', async () => {
      mockInstance.isSensorAvailable.mockResolvedValue({
        available: true,
        biometryType: 'FaceID',
      });

      // First call: cancel while in-flight → expect failure.
      let resolveFirst!: (value: { success: boolean }) => void;
      mockInstance.simplePrompt.mockReturnValueOnce(
        new Promise<{ success: boolean }>(resolve => {
          resolveFirst = resolve;
        }),
      );
      const firstPromise = service.authenticate();
      service.cancel();
      resolveFirst({ success: true });
      const firstResult = await firstPromise;
      expect(firstResult.success).toBe(false);

      // Second call: no cancel during the prompt — the flag was reset by
      // authenticate() itself at the start of the new call.
      mockInstance.simplePrompt.mockResolvedValueOnce({ success: true });
      const secondResult = await service.authenticate();
      expect(secondResult.success).toBe(true);
    });

    it('should be harmless when called with no authentication in progress', async () => {
      expect(() => service.cancel()).not.toThrow();
    });
  });
});
