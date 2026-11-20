import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "apps/api/src/generated/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-require-imports": "off",
      "no-control-regex": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: { globals: globals.node },
  },
  {
    files: [
      "apps/api/**/*.{ts,mts}",
      "apps/worker/**/*.{ts,mts}",
      "packages/**/*.{ts,mts}",
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["apps/admin-web/**/*.{ts,tsx}", "apps/public-web/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
  },
);
