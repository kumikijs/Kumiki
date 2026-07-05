import { createRequire } from "node:module";
import { defineConfig } from "vitepress";

// Load the Kumiki TextMate grammar as raw JSON rather than via the package's
// TypeScript entry (`@kumikijs/syntax`). VitePress evaluates this config with
// Node's ESM loader, which externalizes the workspace package and would try to
// load its `.ts` source directly — failing on CI Node with
// ERR_UNKNOWN_FILE_EXTENSION. The published `grammar.json` sidesteps that.
const nodeRequire = createRequire(import.meta.url);
const kumikiGrammar = nodeRequire("@kumikijs/syntax/grammar.json");

// Docs live directly under this VitePress root and are served as-is (no sync
// step). English pages are `spec/`, `guide/`; their Japanese counterparts sit
// under `ja/` and are served as the `ja` locale. Example sources live in
// `packages/examples` and are loaded by the Playground.
export default defineConfig({
  title: "Kumiki",
  head: [["link", { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }]],
  cleanUrls: true,
  ignoreDeadLinks: false,
  markdown: {
    // Real Shiki grammar for Kumiki, shipped by @kumikijs/syntax.
    languages: [kumikiGrammar],
  },
  themeConfig: {
    logo: { light: "/kumiki-mark.svg", dark: "/kumiki-mark-dark.svg" },
    socialLinks: [{ icon: "github", link: "https://github.com/kumikijs/Kumiki" }],
    search: { provider: "local" },
  },
  locales: {
    root: {
      label: "English",
      lang: "en",
      description:
        "A declarative web framework designed first and foremost for AI to write, edit, and touch in parallel",
      themeConfig: {
        nav: [
          { text: "Guide", link: "/guide/getting-started" },
          { text: "Spec", link: "/spec/" },
          { text: "Playground", link: "/guide/playground" },
        ],
        sidebar: {
          "/guide/": [
            {
              text: "Guide",
              items: [
                { text: "Getting Started", link: "/guide/getting-started" },
                { text: "Your First App", link: "/guide/your-first-app" },
                { text: "Thinking in Kumiki", link: "/guide/thinking-in-kumiki" },
                { text: "Design Philosophy", link: "/guide/design-philosophy" },
                { text: "Recipes", link: "/guide/recipes" },
                { text: "Benchmarks", link: "/guide/benchmarks" },
                { text: "Playground", link: "/guide/playground" },
              ],
            },
          ],
          "/spec/": [
            {
              text: "Spec",
              items: [
                { text: "Overview", link: "/spec/" },
                { text: "Language Core", link: "/spec/language" },
                { text: "Standard Library", link: "/spec/stdlib" },
                { text: "Routing", link: "/spec/routing" },
                { text: "Style", link: "/spec/style" },
                { text: "Forms", link: "/spec/forms" },
                { text: "HTTP / Storage", link: "/spec/http" },
                { text: "Lifecycle", link: "/spec/lifecycle" },
                { text: "Runtime", link: "/spec/runtime" },
                { text: "AI Editing", link: "/spec/ai-edit" },
                { text: "Testing", link: "/spec/testing" },
                { text: "Error Codes", link: "/spec/errors" },
              ],
            },
          ],
        },
      },
    },
    ja: {
      label: "日本語",
      lang: "ja",
      description: "AI が書き・直し・並列に触ることを最優先に設計した宣言的 Web フレームワーク",
      themeConfig: {
        nav: [
          { text: "ガイド", link: "/ja/guide/getting-started" },
          { text: "仕様", link: "/ja/spec/" },
          { text: "Playground", link: "/ja/guide/playground" },
        ],
        sidebar: {
          "/ja/guide/": [
            {
              text: "ガイド",
              items: [
                { text: "はじめに", link: "/ja/guide/getting-started" },
                { text: "最初のアプリ", link: "/ja/guide/your-first-app" },
                { text: "Kumiki の考え方", link: "/ja/guide/thinking-in-kumiki" },
                { text: "設計思想", link: "/ja/guide/design-philosophy" },
                { text: "レシピ", link: "/ja/guide/recipes" },
                { text: "ベンチマーク", link: "/ja/guide/benchmarks" },
                { text: "Playground", link: "/ja/guide/playground" },
              ],
            },
          ],
          "/ja/spec/": [
            {
              text: "仕様",
              items: [
                { text: "概要", link: "/ja/spec/" },
                { text: "言語コア", link: "/ja/spec/language" },
                { text: "標準ライブラリ", link: "/ja/spec/stdlib" },
                { text: "ルーティング", link: "/ja/spec/routing" },
                { text: "スタイル", link: "/ja/spec/style" },
                { text: "フォーム", link: "/ja/spec/forms" },
                { text: "HTTP / Storage", link: "/ja/spec/http" },
                { text: "ライフサイクル", link: "/ja/spec/lifecycle" },
                { text: "ランタイム", link: "/ja/spec/runtime" },
                { text: "AI 編集", link: "/ja/spec/ai-edit" },
                { text: "テスト", link: "/ja/spec/testing" },
                { text: "エラーコード", link: "/ja/spec/errors" },
              ],
            },
          ],
        },
      },
    },
  },
});
