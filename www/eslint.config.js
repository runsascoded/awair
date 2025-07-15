import config from '@rdub/eslint-config'

export default [
  ...config,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': 'warn',
      'no-unused-vars': 'off', // Turn off base rule
    }
  }
]
