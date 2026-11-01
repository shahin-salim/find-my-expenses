module.exports = {
  preset: '@react-native/jest-preset',
  // Support files live beside the suites they serve, so match on the suffix
  // rather than on the folder.
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
};
