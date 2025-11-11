import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  collectCoverageFrom: ['src/**/*.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  coverageDirectory: '<rootDir>/coverage',
  clearMocks: true,
  setupFiles: ['<rootDir>/tests/setup.ts'],
  transform: {
    '^.+\\.(t|j)sx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json',
      },
    ],
  },
  transformIgnorePatterns: [
    'node_modules/(?!(p-retry|is-network-error)/)',
  ],
};

export default config;

