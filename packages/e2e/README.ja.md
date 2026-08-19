# @kumikijs/e2e

[English](./README.md) · 日本語

実ブラウザ（Chromium / Playwright）で Kumiki アプリを検証する **opt-in tier**。headless DOM（happy-dom）では見えない層 — CSS レイアウト・**実フォーカス**・実レンダリング・実イベント — を捕まえる。

`@kumikijs/runtime` の headless DOM `runScenario` と**同じシナリオ形式**を使い、加えてブラウザ限定アサーションを持つ:

- `focused`: その CSS セレクタが実際にフォーカスされていること（再レンダリング時のフォーカス奪取バグを検出）
- `visible` / `hidden`: 計算済みスタイル上で本当に見えている／いないこと（`display:none` 等、DOM 上の存在では分からない可視性）

状態 oracle は headless DOM 版と同じく `window.__kumikiApp.live`（slot 値）を `page.evaluate` で読む。表示テキストは `innerText`（可視のみ）。

## 使い方

ブラウザのインストールが一度必要:

```sh
pnpm --filter @kumikijs/e2e exec playwright install chromium
```

リポジトリルートで実行:

```sh
pnpm exec tsx packages/e2e/src/cli.ts <app.kumiki> <scenario.browser.json> [--headed]
```

例:

```sh
pnpm exec tsx packages/e2e/src/cli.ts \
  packages/examples/apps/06-expenses/app.kumiki \
  packages/examples/apps/06-expenses/scenario.browser.json
```

## いつ使うか

3 層検証（[docs/spec/testing.md](../../docs/ja/spec/testing.md) §8.10）の中で、これは最も重いが最も忠実な層。日常は `kumiki check` / `kumiki smoke` / `kumiki run`（happy-dom、高速・CI 標準）で回し、フォーカス・レイアウト・実描画に関わるバグや最終確認のときにこの tier を使う。

重い（ブラウザバイナリ）ため、既定の `turbo run test` には含めない。CI で常用する場合はワークフローに `playwright install chromium` を追加する。
