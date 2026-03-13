/**
 * Manual mock for react-native-biometrics.
 *
 * Provides a mockable class constructor so BiometricService tests can
 * inject controlled responses for isSensorAvailable and simplePrompt
 * without requiring a physical device.
 */
const ReactNativeBiometrics = jest.fn().mockImplementation(() => ({
  isSensorAvailable: jest.fn(),
  simplePrompt: jest.fn(),
  createKeys: jest.fn(),
  deleteKeys: jest.fn(),
}));

export default ReactNativeBiometrics;
