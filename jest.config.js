module.exports = {
  testEnvironment: 'node',
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'api/**/*.js',
    'lib/**/*.js',
    'scripts/**/*.js',
    '!**/node_modules/**',
    '!**/tests/**',
  ],
  testMatch: ['**/tests/**/*.test.js'],
  verbose: true,
  testTimeout: 30000, // 30 seconds for integration tests
};
