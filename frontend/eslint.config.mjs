import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';

/* Browser globals — ESLint flat config doesn't have env: { browser: true },
   so we declare them explicitly. This list covers all DOM/Web APIs used in the codebase. */
const browserGlobals = Object.fromEntries([
  'window', 'document', 'localStorage', 'sessionStorage', 'fetch', 'console',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'requestAnimationFrame',
  'AbortController', 'URL', 'URLSearchParams', 'TextDecoder', 'EventSource',
  'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLFormElement',
  'HTMLDivElement', 'HTMLCanvasElement', 'HTMLImageElement', 'SVGSVGElement',
  'Event', 'KeyboardEvent', 'MouseEvent', 'ClipboardEvent', 'ErrorEvent',
  'EventListener', 'EventListenerOptions', 'PromiseRejectionEvent',
  'FormData', 'FileReader', 'FileList', 'File', 'Blob', 'Image',
  'ClipboardItem', 'RequestInit',
  'crypto', 'navigator', 'performance', 'alert', 'confirm',
  'PerformanceObserver', 'PerformanceNavigationTiming', 'PerformanceEventTiming',
  'BeforeUnloadEvent',
  'React', 'JSX',
].map(g => [g, 'readonly']));

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: browserGlobals,
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
    },
    rules: {
      // TypeScript-specific
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'off',

      // TypeScript has its own checker for undeclared identifiers that
      // understands types (HTMLElement subclasses, MessageEvent, Window,
      // ResizeObserver, etc.) and ambient DOM globals. Leaving eslint's
      // `no-undef` on here duplicates the check with a weaker
      // implementation that flags every type-only reference as "not
      // defined". `tsc --noEmit` in CI is the authoritative check.
      'no-undef': 'off',

      // React hooks
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // Code quality
      'no-throw-literal': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      // Allow `x != null` / `x == null` as a concise match for both
      // null and undefined — idiomatic and safer to preserve than
      // mechanically converting to `x !== null && x !== undefined`.
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-eval': 'error',
      'no-implied-eval': 'error',

      // Security
      'no-new-func': 'error',

      // Allow patterns common in React/JSX
      'no-control-regex': 'off',
      'no-useless-escape': 'off',
    },
  },
  {
    files: ['src/**/__tests__/**/*.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    ignores: ['dist/', 'node_modules/'],
  },
];
