export const sharedTestOptions: {
  globals: boolean;
  silent: "passed-only";
  include: string[];
  testTimeout: number;
} = {
  globals: true,
  silent: "passed-only",
  include: ["test/**/*.test.ts"],
  // Many tests compile and import a module; on a loaded machine the first import alone can pass vitest's 5s default.
  testTimeout: 30000,
};
