/** @type {import("jest").Config} */
module.exports = {
  preset: "ts-jest",
  maxWorkers: 1,  // integration tests share a DB -- run serially
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testMatch: ["**/*.test.ts"],
  transform: {
    "^.+\.tsx?$": ["ts-jest", {
      tsconfig: "tsconfig.test.json",
    }],
  },
  testTimeout: 30000,
  verbose: true,
};
