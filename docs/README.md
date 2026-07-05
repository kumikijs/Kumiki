# @kumikijs/docs

The Kumiki documentation site (VitePress). It serves `spec/` and `guide/` and includes an in-browser **Playground** (running the compiler + runtime in the browser) and **WebMCP** tools.

## Development

```sh
pnpm --filter @kumikijs/docs dev
pnpm --filter @kumikijs/docs build     # → docs/.vitepress/dist
pnpm --filter @kumikijs/docs preview
```

The Playground imports `@kumikijs/runtime/bundle?raw`, so the runtime bundle must exist before the site is built. Use `pnpm exec turbo run build --filter=@kumikijs/docs` — Turborepo's `dependsOn: ^build` builds the runtime and compiler first automatically.

## Deploy (Cloudflare Pages)

Deployed by the **Cloudflare Pages Git Integration** on push to `main`. There is no GitHub Actions workflow and no repo-side Cloudflare secret — CF authenticates the deploy via its GitHub App connection.

Pages project settings (dashboard) that must match `wrangler.jsonc`:

| Field | Value |
|---|---|
| Project name | `kumiki` |
| Root directory | `/docs` |
| Build command | `pnpm exec turbo run build --filter=@kumikijs/docs` |
| Build output directory | `.vitepress/dist` |

Manual deploy (requires local `wrangler login`):

```sh
pnpm exec turbo run build --filter=@kumikijs/docs
cd docs && wrangler pages deploy
```
