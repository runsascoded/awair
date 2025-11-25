import config from '@rdub/eslint-config'
import tseslint from 'typescript-eslint'

export default [
  ...config,
  ...tseslint.configs.recommended,
  {
    ignores: ['test-*.mjs', 'test-*.html'],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': 'warn',
      'no-unused-vars': 'off', // Turn off base rule
    }
  }
]
