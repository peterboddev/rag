module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/unit_tests'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.test.json',
      diagnostics: {
        // Ignore TypeScript diagnostics that cascade from missing frontend-only
        // packages (react, aws-amplify) not in root node_modules:
        // 2307: Cannot find module
        // 2339: Property does not exist on type (e.g. this.state, this.props)
        // 7026: JSX element implicitly has type 'any'
        // 7016: Could not find a declaration file
        ignoreDiagnostics: [2307, 2339, 7026, 7016],
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