import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "coverage/**",
      "node_modules/**",
      "artifacts/**",
      "docs/private/**",
      "scripts/e2e-test.ts",
    ],
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "no-console": "error",
      "no-undef": "off",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: false }],
    },
  },
  {
    files: [
      "src/lib/log.ts",
      "src/mcp/**/server.ts",
      "src/stage/e2e.ts",
      "src/stage/repl.ts",
      "src/stage/smoke.ts",
    ],
    rules: {
      "no-console": "off",
    },
  },
  {
    files: ["scripts/**/*.ts", "vitest.config.ts", "vitest.setup.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "no-undef": "off",
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
);
