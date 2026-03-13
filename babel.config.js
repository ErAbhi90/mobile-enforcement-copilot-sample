/**
 * Babel configuration.
 *
 * Uses @babel/preset-env (targeting current Node.js for tests),
 * @babel/preset-typescript for TypeScript support, and
 * @babel/preset-react for JSX in React Native files.
 */
module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    '@babel/preset-typescript',
    ['@babel/preset-react', { runtime: 'automatic' }],
  ],
};
