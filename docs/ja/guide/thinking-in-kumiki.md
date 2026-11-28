# Kumiki の考え方

## 7 レイヤ＝役割の分離

Kumiki のアプリは 7 種類の定義の集合です。ファイル境界やモジュールはなく、各定義は名前で参照し合います。

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

Kumiki には Hooks の呼び出し順序ルールも、依存配列も、Context の暗黙スコープもありません。

- **状態は `slot`** に集約され、`reducer` の `:=` でのみ変わります。どこで何が書き換わるかを文面で追えます。
- **副作用は `effect`** に閉じ、必要な **capability** を `app.caps` で明示します。宣言にない能力を使うと [E0301](../spec/errors.md#e0301-missing-capability) になります。
- **`fn` は純粋**で、slot を読めません（[E0305](../spec/errors.md#e0305-fn-impurity)）。そのぶんテストしやすく、AI も推論しやすくなります。

## 1 reducer 1 書き込み（パス形状粒度）

1 つの reducer 内で同じ **パス形状** へ複数回書くと [E0601](../spec/errors.md#e0601-duplicate-write) になります。これにより更新が 1 か所に集約され、部分編集が安全になります。

```kumiki snippet
# NG: tasks への二重書き込み
tasks := tasks.remove(id)
tasks := tasks.filter(pred)

# OK: チェーンで 1 回に
tasks := tasks.remove(id).filter(pred)
```

`tasks[id].status` と `tasks[id].updatedAt` は別の形状なので共存できます。

## AI が部分編集しやすい設計

各定義が独立し参照が明示的なので、`@kumikijs/cli` と `@kumikijs/mcp` は **定義単位** で list / view / add / replace / remove / rename / fix できます。これが「AI が並列に触れる」という狙いの中核です。詳しくは [AI 編集](../spec/ai-edit.md) を参照してください。
