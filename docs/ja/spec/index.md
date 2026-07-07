# Kumiki 仕様

ここは Kumiki 言語とランタイムの**正規（normative）仕様**である。実装（`packages/`）と本仕様が食い違った場合、原則として本仕様を正とし、どちらを直すかを設計判断として PR に記録する。

チュートリアルや how-to は仕様ではなく [Kumiki ガイド](../guide/) に置く。動作する実例は [Kumiki Examples](https://github.com/kage1020/Kumiki/tree/main/packages/examples) にある。

## 目次

| 文書 | 内容 |
|---|---|
| [言語コア](./language.md) | 7 層（type / slot / effect / reducer / tile / fn / app）と式・文・パターン |
| [標準ライブラリ](./stdlib.md) | List / Map / Set / Option / Result / Time / ドメイン型 |
| [ルーティング](./routing.md) | パターン、パラメータ、`route.enter` / `route.leave`、リダイレクト |
| [スタイル](./style.md) | スタイル・レイアウト・テーマ |
| [フォーム](./forms.md) | フォーム、`bind`、バリデーション |
| [HTTP / Storage](./http.md) | HTTP / Storage effects とポリシー（latest / debounce / once …） |
| [ライフサイクル](./lifecycle.md) | ライフサイクル、ケイパビリティ、エラー境界、サスペンス |
| [ランタイム](./runtime.md) | ランタイム実装ガイド（signal graph・mount・dispatch・dispose） |
| [AI 編集](./ai-edit.md) | AI 編集 API、CRDT op、参照整合性 |
| [テスト](./testing.md) | テスト戦略 |
| [エラーコード](./errors.md) | エラーコードカタログ（E0001..E08xx） |
