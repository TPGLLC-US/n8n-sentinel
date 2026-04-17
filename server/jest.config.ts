import type { Config } from 'jest';

const config: Config = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['<rootDir>/src/**/*.spec.ts'],
    modulePathIgnorePatterns: ['<rootDir>/dist/'],
    clearMocks: true,
};

export default config;
