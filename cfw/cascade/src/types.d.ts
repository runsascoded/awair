// Wrangler's `Text` rule lets us `import txt from './foo.yml'` as a raw
// string. TypeScript needs this ambient declaration to type-check.
declare module '*.yml' {
  const text: string
  export default text
}
