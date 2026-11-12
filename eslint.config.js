import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["public/**", ".capsule-lab/**"] },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node,
    },
    rules: {
      "no-unused-vars": "warn",
      "no-console": "off",
      "no-useless-assignment": "warn",
      "preserve-caught-error": "warn",
    },
  },
  {
    files: ["src/capsules/**/*.js", "src/scripts/**/*.js"],
    // Capsule build hooks run in Node as ES modules
    ignores: ["src/capsules/*/build.js"],
    languageOptions: {
      sourceType: "script",
      globals: globals.browser,
    },
  },
];
