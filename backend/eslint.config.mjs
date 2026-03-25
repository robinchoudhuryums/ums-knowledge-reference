import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        URL: 'readonly',
        TextDecoder: 'readonly',
        URLSearchParams: 'readonly',
        performance: 'readonly',
        setImmediate: 'readonly',
        require: 'readonly',
        Express: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      // TypeScript-specific
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'off', // used intentionally after auth checks

      // Code quality
      'no-console': 'off', // we use structured logger that wraps console
      'no-throw-literal': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      'eqeqeq': ['error', 'always'],
      'no-eval': 'error',
      'no-implied-eval': 'error',

      // Allow control character regex (used in sanitizeInput for stripping control chars)
      'no-control-regex': 'off',
      // Regex escapes in character classes are harmless and improve readability
      'no-useless-escape': 'off',

      // Allow re-throwing errors without wrapping (intentional in resilience.ts)
      'preserve-caught-error': 'off',

      // Security
      'no-new-func': 'error',
    },
  },
  {
    files: ['src/__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off', // test mocks often need any
    },
  },
  {
    ignores: ['dist/', 'node_modules/', '*.js', '*.mjs'],
  },
];
