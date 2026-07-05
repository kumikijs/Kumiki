# @kumikijs/docs

Kumiki ドキュメントサイト（VitePress）。`spec/` と `guide/` を配信し、ブラウザ内 **Playground**（コンパイラ + ランタイムをブラウザで実行）と **WebMCP** ツールを備える。

## 開発

```sh
pnpm --filter @kumikijs/docs dev
pnpm --filter @kumikijs/docs build     # → docs/.vitepress/dist
pnpm --filter @kumikijs/docs preview
```

Playground は `@kumikijs/runtime/bundle?raw` を取り込むため、サイトのビルド前に runtime バンドルが必要。`pnpm exec turbo run build --filter=@kumikijs/docs` を使えば Turborepo の `dependsOn: ^build` によって runtime / compiler が自動で先にビルドされる。

## デプロイ（Cloudflare Pages）

`main` への push で **Cloudflare Pages の Git Integration** が自動デプロイする。GitHub Actions ワークフローも、リポ側の Cloudflare secret も不要（CF が GitHub App 経由で認証を扱う）。

Pages プロジェクトのダッシュボード設定は `wrangler.jsonc` と一致させる:

| フィールド | 値 |
|---|---|
| Project name | `kumiki` |
| Root directory | `/docs` |
| Build command | `pnpm exec turbo run build --filter=@kumikijs/docs` |
| Build output directory | `.vitepress/dist` |

手動デプロイ（ローカルで `wrangler login` 済みの場合）:

```sh
pnpm exec turbo run build --filter=@kumikijs/docs
cd docs && wrangler pages deploy
```
