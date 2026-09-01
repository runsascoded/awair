import { defineConfig } from 'vitest/config'

// Wrangler bundles `**/*.yml` as raw text (see `wrangler.toml` `rules`).
// Vitest's vite pipeline has no such rule and would try to parse the YAML
// as a module, so replicate the Text loader here for `pyramid.ts`'s
// `import pyramidYamlText from '.../pyramid.yml'`.
function ymlAsText() {
  return {
    name: 'yml-as-text',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (id.split('?')[0]!.endsWith('.yml')) {
        return { code: `export default ${JSON.stringify(code)}`, map: null }
      }
    },
  }
}

export default defineConfig({
  plugins: [ymlAsText()],
  test: {
    include: ['src/**/*.test.ts'],
  },
})
