module.exports = {
  testEnvironment: 'jsdom',
  testMatch: ['<rootDir>/__tests__/**/*.test.{ts,tsx}'],
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      { tsconfig: '<rootDir>/__tests__/tsconfig.json' },
    ],
  },
  moduleNameMapper: {
    // The library only uses AppState from react-native, so tests run against
    // a small mock instead of the full React Native runtime.
    '^react-native$': '<rootDir>/__tests__/mocks/react-native.ts',
  },
  restoreMocks: true,
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/index.ts'],
  coverageThreshold: {
    global: { statements: 90, branches: 80, functions: 90, lines: 90 },
  },
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
};
