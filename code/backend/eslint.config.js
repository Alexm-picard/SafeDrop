// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: shared style rules, layering import-boundary rules (SDD §2.3.2, §8.1)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';

/**
 * Layering rule (SDD §2.3.2): routes → controllers → services → repositories → models.
 * Lower layers never import higher ones. Controllers never import Mongoose. Services never touch express.
 * Implemented with core `no-restricted-imports` so no extra plugin is needed; patterns match the import
 * specifier string, so `../models/User.js` is caught by `**\/models/**`.
 */
const layer = (files, patterns, message) => ({
  files,
  rules: {
    'no-restricted-imports': ['error', { patterns: [{ group: patterns, message }] }],
  },
});

export default defineConfig([
  globalIgnores(['node_modules/**', 'coverage/**', 'dist/**']),

  {
    files: ['**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      eqeqeq: ['error', 'always'],
      curly: ['error', 'all'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-console': 'error', // use utils/logger.js; console is allowed only in the logger and migrations
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-restricted-syntax': [
        'error',
        {
          selector: "Property[key.value='$where'], Property[key.name='$where']",
          message: 'Mongo $where is banned (SR-6).',
        },
      ],
    },
  },

  // ---- Import boundaries ---------------------------------------------------------------------
  layer(
    ['src/routes/**/*.js'],
    ['**/models/**', '**/repositories/**', '**/services/**', 'mongoose', 'mongodb'],
    'Routes only wire middleware and controllers (SDD §2.3.2).',
  ),
  layer(
    ['src/controllers/**/*.js'],
    ['**/models/**', '**/repositories/**', 'mongoose', 'mongodb'],
    'Controllers call services only; they never import Mongoose, models or repositories (SDD §2.3.2).',
  ),
  layer(
    ['src/services/**/*.js'],
    ['express', '**/controllers/**', '**/routes/**', '**/middleware/**'],
    'Services never touch express, req or res (SDD §2.3.2).',
  ),
  layer(
    ['src/repositories/**/*.js'],
    ['express', '**/services/**', '**/controllers/**', '**/routes/**', '**/middleware/**'],
    'Repositories import models only (SDD §2.3.2).',
  ),
  layer(
    ['src/models/**/*.js'],
    [
      'express',
      '**/services/**',
      '**/controllers/**',
      '**/routes/**',
      '**/middleware/**',
      '**/repositories/**',
    ],
    'Models are the lowest layer and import nothing above them (SDD §2.3.2).',
  ),
  layer(
    ['src/middleware/**/*.js'],
    ['**/models/**', '**/repositories/**', '**/controllers/**', 'mongoose'],
    'Middleware may use services/utils but never models or repositories directly.',
  ),

  // ---- Files where console output is the point ------------------------------------------------
  {
    files: [
      'src/utils/logger.js',
      'migrations/**/*.js',
      'migrate-mongo-config.js',
      'src/server.js',
    ],
    rules: { 'no-console': 'off' },
  },

  // Prettier last so it disables any formatting rule above.
  prettier,
]);
