/// <reference types="@cloudflare/workers-types" />

/**
 * Per-request OG/Twitter `<meta>` rewriter. Crawlers (Slack, iMessage,
 * Twitter, Discord) fetch the HTML at the share URL and pick up `<meta>`
 * from the head before executing any JS, so static `<meta og:image>` from
 * `index.html` is unfurl-bait that's identical for every URL. This
 * middleware rewrites it per-request to point at `/og?<same query>` so
 * the unfurl card reflects the actual view being shared.
 */

const OG_PATH = '/og'

const setAttr = (attr: string, value: string) => ({
  element(el: Element) { el.setAttribute(attr, value) },
})

export const onRequest: PagesFunction = async (ctx) => {
  const res = await ctx.next()
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('text/html')) return res

  const url = new URL(ctx.request.url)
  // Skip the og endpoint itself — no need to rewrite its (non-existent) html.
  if (url.pathname.startsWith(OG_PATH)) return res

  // If there's no query string, the static defaults are already correct;
  // skip the rewriter to keep crawler responses cacheable at the edge.
  if (!url.search) return res

  const image = `${url.origin}${OG_PATH}${url.search}`
  const ogUrl = `${url.origin}${url.pathname}${url.search}`

  return new HTMLRewriter()
    .on('meta[property="og:image"]', setAttr('content', image))
    .on('meta[name="twitter:image"]', setAttr('content', image))
    .on('meta[property="og:url"]', setAttr('content', ogUrl))
    .transform(res)
}
