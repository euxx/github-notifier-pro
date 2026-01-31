import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },
    },
    rules: {
      // ===== Standard-like Rules =====

      // Possible Problems
      'no-unused-vars': ['warn', {
        vars: 'all',
        args: 'after-used',
        argsIgnorePattern: '^_',
        caughtErrors: 'all',
        caughtErrorsIgnorePattern: '^_',
      }],
      'no-console': 'off', // Common in browser extensions
      'no-debugger': 'warn',
      'no-constant-binary-expression': 'error',

      // Best Practices (Standard style)
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-caller': 'error',
      'no-eval': 'error',
      'no-extend-native': 'error',
      'no-extra-bind': 'error',
      'no-implied-eval': 'error',
      'no-iterator': 'error',
      'no-labels': ['error', { allowLoop: false, allowSwitch: false }],
      'no-lone-blocks': 'error',
      'no-multi-str': 'error',
      'no-new': 'error',
      'no-new-func': 'error',
      'no-new-wrappers': 'error',
      'no-octal-escape': 'error',
      'no-proto': 'error',
      'no-return-assign': ['error', 'except-parens'],
      'no-self-compare': 'error',
      'no-sequences': 'error',
      'no-throw-literal': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-unused-expressions': ['error', {
        allowShortCircuit: true,
        allowTernary: true,
        allowTaggedTemplates: true,
      }],
      'no-useless-call': 'error',
      'no-useless-concat': 'error',
      'no-useless-return': 'error',
      'no-void': 'error',
      'no-with': 'error',
      'yoda': ['error', 'never'],

      // Modern JavaScript
      'prefer-const': ['warn', { destructuring: 'all' }],
      'no-var': 'error',
      'prefer-arrow-callback': 'warn',
      'prefer-template': 'warn',
      'prefer-promise-reject-errors': 'error',
      'prefer-regex-literals': ['error', { disallowRedundantWrapping: true }],
      'object-shorthand': ['warn', 'properties'],

      // Code Style (Standard style: have semicolons, but configurable)
      'quotes': ['warn', 'single', { avoidEscape: true, allowTemplateLiterals: false }],
      'semi': ['warn', 'always'],
      'indent': ['warn', 2, {
        SwitchCase: 1,
        VariableDeclarator: 1,
        outerIIFEBody: 1,
        MemberExpression: 1,
        FunctionDeclaration: { parameters: 1, body: 1 },
        FunctionExpression: { parameters: 1, body: 1 },
        CallExpression: { arguments: 1 },
        ArrayExpression: 1,
        ObjectExpression: 1,
        ImportDeclaration: 1,
        flatTernaryExpressions: false,
        ignoreComments: false,
      }],
      'comma-dangle': ['warn', 'always-multiline'],
      'comma-spacing': ['warn', { before: false, after: true }],
      'comma-style': ['warn', 'last'],
      'dot-location': ['warn', 'property'],
      'key-spacing': ['warn', { beforeColon: false, afterColon: true }],
      'keyword-spacing': ['warn', { before: true, after: true }],
      'no-multiple-empty-lines': ['warn', { max: 1, maxBOF: 0, maxEOF: 0 }],
      'no-trailing-spaces': 'warn',
      'no-whitespace-before-property': 'warn',
      'space-before-blocks': ['warn', 'always'],
      'space-before-function-paren': ['warn', 'never'],
      'space-in-parens': ['warn', 'never'],
      'space-infix-ops': 'warn',
      'space-unary-ops': ['warn', { words: true, nonwords: false }],
      'spaced-comment': ['warn', 'always', {
        line: { markers: ['*package', '!', '/', ',', '='] },
        block: { balanced: true, markers: ['*package', '!', ',', ':', '::', 'flow-include'], exceptions: ['*'] },
      }],
      'eol-last': ['warn', 'always'],

      // ES6+
      'arrow-spacing': ['warn', { before: true, after: true }],
      'generator-star-spacing': ['warn', { before: true, after: true }],
      'no-duplicate-imports': 'error',
      'rest-spread-spacing': ['warn', 'never'],
      'template-curly-spacing': ['warn', 'never'],
      'yield-star-spacing': ['warn', 'both'],

      // WebExtension specific (manual rules)
      'no-undef': 'error', // Catch undefined chrome/browser API usage
    },
  },
  {
    // Test files configuration
    files: ['tests/**/*.js', '**/*.test.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.vitest,
      },
    },
  },
  {
    // Ignore patterns
    ignores: ['dist/', 'node_modules/', '*.min.js'],
  },
];
