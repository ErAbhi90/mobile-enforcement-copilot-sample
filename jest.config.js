/**
 * Jest configuration.
 *
 * - Uses babel-jest to transpile TypeScript and JSX.
 * - Sets testEnvironment to 'node' so business-logic tests run without
 *   a DOM or native runtime.
 * - Uses moduleNameMapper to replace native modules with hand-written mocks
 *   that live in the __mocks__ directory.
 */
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.(ts|tsx|js|jsx)$': 'babel-jest',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.(tsx?|jsx?)$',
  moduleNameMapper: {
    '^react-native-keychain$': '<rootDir>/__mocks__/react-native-keychain.ts',
    '^react-native-biometrics$': '<rootDir>/__mocks__/react-native-biometrics.ts',
    '^react-native$': '<rootDir>/__mocks__/react-native.js',
  },
  coverageDirectory: 'coverage',
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts'],
};
