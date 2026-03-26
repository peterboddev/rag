module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/unit_tests'],
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: [
    '/node_modules/',
    'bug-kb-metadata-filter-exploration\\.property\\.test\\.ts', // Live AWS integration test — run manually only
  ],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.test.json',
      diagnostics: false, // Type checking handled by tsc build step, not during test compilation
    }],
  },
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    'infrastructure/**/*.{ts,tsx}',
    '!**/*.d.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  testTimeout: 10000,
  testTimeout: 10000,
  maxWorkers: '50%',
  detectOpenHandles: false,
  // Handle ES modules and dynamic imports from AWS SDK v3
  transformIgnorePatterns: [
    'node_modules/(?!(@aws-sdk|@smithy)/)',
  ],
  moduleDirectories: ['node_modules', 'frontend/node_modules'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^aws-amplify/auth$': '<rootDir>/unit_tests/__mocks__/aws-amplify-auth.ts',
  },
};