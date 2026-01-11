import config from '@rdub/eslint-config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default [
  ...config,
  ...tseslint.configs.recommended,
  {
    ignores: ['test-*.mjs', 'test-*.html', 'tmp/**'],
  },
  // Node.js scripts
  {
    files: ['har-test/**/*.mjs', 'test/**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn', // Warn instead of error for any types
      'no-unused-vars': 'off', // Turn off base rule
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportDeclaration[source.value=/\\.tsx?$/]',
          message: 'Do not include .ts/.tsx extension in imports',
        },
      ],
    }
  }
]
