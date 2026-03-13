/**
 * Minimal manual mock for the 'react-native' package.
 *
 * The source-level services in this project do not import directly from
 * 'react-native', but the useAuth hook and any future UI code will.
 * This stub satisfies module resolution during Jest runs without native
 * binaries.
 *
 * AppState is stubbed here so ServiceContainer (which imports AppState to
 * pass to AppStateWatcher) can be imported in tests.
 */
module.exports = {
  Platform: {
    OS: 'ios',
    select: (options) => options.ios ?? options.default,
  },
  NativeModules: {},
  AppState: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
};
