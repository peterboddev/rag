module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/unit_tests'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.test.json',
      diagnostics: {
        // Ignore TS2307 (Cannot find module) for frontend files that import
        // packages only available in frontend/node_modules (e.g. aws-amplify)
        ignoreDiagnostics: [2307],
      },
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
  forceExit: true,
  detectOpenHandles: false,
  // Handle ES modules and dynamic imports from AWS SDK v3
  transformIgnorePatterns: [
    'node_modules/(?!(@aws-sdk|@smithy)/)',
  ],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^aws-amplify/auth$': '<rootDir>/unit_tests/__mocks__/aws-amplify-auth.ts',
  },
};