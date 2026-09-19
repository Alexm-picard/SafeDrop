// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~85% (Vite template base; rules added from team design documents)
// AI-Assisted Areas: jsx-a11y (NFR-12), dangerouslySetInnerHTML ban, fetch-only-in-services boundary (SDD §2.3.1)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * ESLint configuration for the frontend.
 *
 * Alongside the React and hooks rules, three project-specific constraints are enforced here as lint
 * errors:
 *
 *  - **jsx-a11y** (NFR-12), so accessibility regressions fail the build rather than waiting for a
 *    manual audit;
 *  - **`dangerouslySetInnerHTML` is banned**, which removes the SPA's most direct route to an XSS;
 *  - **`fetch` only in `src/services/`** (SDD §2.3.1), which is what guarantees that every API call
 *    goes through the client with its cookie handling, error typing and refresh logic.
 *
 * `eslint-plugin-react` is included because the frontend is plain JavaScript: without the TypeScript
 * parser, core ESLint does not see JSX usage, so `jsx-uses-vars` and `jsx-key` are needed to avoid
 * false "unused variable" reports and to catch missing list keys.
 */
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['dist/**', 'coverage/**', 'node_modules/**']),

  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      jsxA11y.flatConfigs.recommended,
    ],
    plugins: { react },
    settings: { react: { version: 'detect' } },
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // Without TypeScript's scope analysis, core ESLint does not see JSX usage; these three rules do.
      'react/jsx-uses-vars': 'error',
      'react/jsx-key': 'error',
      'react/jsx-no-target-blank': 'error',
      'react/jsx-no-duplicate-props': 'error',
      'react/jsx-no-undef': 'error',
      eqeqeq: ['error', 'always'],
      curly: ['error', 'all'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Stored-XSS guard (SR-6): raw HTML injection is banned everywhere in the SPA.
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'dangerouslySetInnerHTML is banned (SR-6). Render text, never raw HTML.',
        },
        {
          selector: "Property[key.name='dangerouslySetInnerHTML']",
          message: 'dangerouslySetInnerHTML is banned (SR-6). Render text, never raw HTML.',
        },
      ],
      // Only src/services may talk HTTP; nobody imports an HTTP client directly.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'axios', message: 'Use src/services/api.js (SDD §2.3.1).' },
            { name: 'ky', message: 'Use src/services/api.js (SDD §2.3.1).' },
            { name: 'superagent', message: 'Use src/services/api.js (SDD §2.3.1).' },
          ],
        },
      ],
    },
  },

  // ---- Frontend boundary (SDD §2.3.1): components, pages, hooks and context never call fetch. ----
  {
    files: [
      'src/components/**/*.{js,jsx}',
      'src/pages/**/*.{js,jsx}',
      'src/hooks/**/*.{js,jsx}',
      'src/context/**/*.{js,jsx}',
    ],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Only src/services may call the API (SDD §2.3.1).' },
        { name: 'XMLHttpRequest', message: 'Only src/services may call the API (SDD §2.3.1).' },
        { name: 'EventSource', message: 'Only src/services may call the API (SDD §2.3.1).' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'window', property: 'fetch', message: 'Only src/services may call the API.' },
        { object: 'globalThis', property: 'fetch', message: 'Only src/services may call the API.' },
      ],
    },
  },

  // Vite/Vitest config files run in Node; test helpers may export anything (no Fast Refresh there).
  {
    files: ['vite.config.js', 'vitest.config.js', 'tests/**/*.{js,jsx}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { 'react-refresh/only-export-components': 'off' },
  },

  prettier,
]);
