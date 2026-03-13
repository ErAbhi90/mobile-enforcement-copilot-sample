/**
 * Manual mock for react-native-keychain.
 *
 * Provides jest.fn() stubs for every method used by SecureStorageService
 * so tests can run without native binaries.
 */
const Keychain = {
  setGenericPassword: jest.fn(),
  getGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
  getSupportedBiometryType: jest.fn(),
  canImplyAuthentication: jest.fn(),
  ACCESSIBLE: {
    WHEN_UNLOCKED: 'AccessibleWhenUnlocked',
    AFTER_FIRST_UNLOCK: 'AccessibleAfterFirstUnlock',
  },
  BIOMETRY_TYPE: {
    TOUCH_ID: 'TouchID',
    FACE_ID: 'FaceID',
    FINGERPRINT: 'Fingerprint',
  },
};

module.exports = Keychain;
