/**
 * SecureStorageService.test.ts
 *
 * Unit tests for the SecureStorageService.
 *
 * The react-native-keychain module is replaced by the manual mock in
 * __mocks__/react-native-keychain.ts so no native binary is needed.
 *
 * Test plan:
 *  - setItem delegates to Keychain.setGenericPassword with the correct args.
 *  - getItem returns the password string when a credential record is found.
 *  - getItem returns null when Keychain reports false (no record).
 *  - removeItem delegates to Keychain.resetGenericPassword with the service key.
 *  - clearAll delegates to Keychain.resetGenericPassword without a service key.
 */

import { SecureStorageService } from '../../src/storage/SecureStorageService';
import * as Keychain from 'react-native-keychain';

// Cast to the mocked type so TypeScript knows these are jest.fn() instances.
const mockKeychain = Keychain as jest.Mocked<typeof Keychain>;

describe('SecureStorageService', () => {
  let service: SecureStorageService;

  beforeEach(() => {
    service = new SecureStorageService();
    jest.clearAllMocks();
  });

  it('should store a value under the given key', async () => {
    mockKeychain.setGenericPassword.mockResolvedValue({} as never);
    await service.setItem('my_key', 'my_value');
    expect(mockKeychain.setGenericPassword).toHaveBeenCalledWith('my_key', 'my_value', {
      service: 'my_key',
    });
  });

  it('should return the stored value for an existing key', async () => {
    mockKeychain.getGenericPassword.mockResolvedValue({
      service: 'my_key',
      username: 'my_key',
      password: 'my_value',
      storage: 'keychain',
    });
    const value = await service.getItem('my_key');
    expect(value).toBe('my_value');
  });

  it('should return null when no value is stored for the key', async () => {
    mockKeychain.getGenericPassword.mockResolvedValue(false);
    const value = await service.getItem('nonexistent');
    expect(value).toBeNull();
  });

  it('should delete the value for the given key', async () => {
    mockKeychain.resetGenericPassword.mockResolvedValue(true);
    await service.removeItem('my_key');
    expect(mockKeychain.resetGenericPassword).toHaveBeenCalledWith({ service: 'my_key' });
  });

  it('should clear all stored values', async () => {
    mockKeychain.resetGenericPassword.mockResolvedValue(true);
    await service.clearAll();
    expect(mockKeychain.resetGenericPassword).toHaveBeenCalled();
  });
});
