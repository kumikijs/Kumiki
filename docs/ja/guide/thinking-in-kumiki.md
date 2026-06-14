# Kumiki の考え方

## 7 レイヤ＝役割の分離

Kumiki のアプリは 7 種類の定義の集合。ファイル境界やモジュールはなく、各定義は名前で参照し合う。

| layer | 一言で | React で言うと |
|---|---|---|
| `type` | ドメインの形 | TypeScript の型 |
| `slot` | 状態 | `useState` |
| `effect` | 外界との副作用 | `useEffect` + fetch ラッパ |
| `reducer` | イベント → 状態更新 | イベントハンドラ + setState |
| `tile` | UI 部品 | コンポーネント（JSX） |
| `fn` | 純粋関数 | ただの関数（ただし state を読めない） |
| `app` | 根（caps/routes/init/theme） | ルートの設定 + ルーター |

## 暗黙を排す

Kumiki には Hooks の呼び出し順序ルールも、依存配列も、Context の暗黙スコープもない。

- **状態は `slot`** に集約され、`reducer` の `:=` でのみ変わる。どこで何が書き換わるかが文面で追える。
- **副作用は `effect`** に閉じ、必要な **capability** を `app.caps` で明示する。宣言にない能力を使うと [E0301](../spec/errors.md#e0301-missing-capability)。
- **`fn` は純粋**。slot を読めない（[E0305](../spec/errors.md#e0305-fn-impurity)）。テストしやすく、AI も推論しやすい。

## 1 reducer 1 書き込み（パス形状粒度）

1 つの reducer 内で同じ **パス形状**へ複数回書くと [E0601](../spec/errors.md#e06xx---reducer-の書き込み規則)。これは「更新が 1 箇所に集約される」ことを保証し、部分編集を安全にする。

```kumiki
# NG: tasks への二重書き込み
tasks := tasks.remove(id)
tasks := tasks.filter(pred)

# OK: チェーンで 1 回に
tasks := tasks.remove(id).filter(pred)
```

`tasks[id].status` と `tasks[id].updatedAt` は別形状なので共存できる。

## AI が部分編集しやすい設計

各定義が独立し参照が明示的なので、`@kumikijs/cli` / `@kumikijs/mcp` は **定義単位**で list / view / add / replace / remove / rename / fix できる。これが「AI が並列に触れる」狙いの中核。詳しくは [AI 編集](../spec/ai-edit.md)。
