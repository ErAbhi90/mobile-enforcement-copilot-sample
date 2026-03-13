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
});
