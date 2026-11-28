# Synced Notes — Kumiki 学習コスト測定タスク v5

[English](./task-spec.md) · 日本語

サーバーと同期するメモアプリ (250-450 LOC 想定)。v4 より小さいが、難しさの種類が違う。ほぼすべての振る舞いが effect を通り、その effect は失敗し、再試行され、新しい要求に取って代わられ、認証切れで拒否されうる。画面はそのどの場合でも実際の状態を正しく示さなければならない。

## 機能要件

### Types

- `type NoteId = nominal Text` — サーバーが付けるメモの id
- `type Note = {id: NoteId, title: Text, body: Text}`
- `type SyncState = Saved | Saving | Failed(Text)` — メモがサーバーとどういう状態にあるか
- `type LoadState = Loading | Loaded | LoadFailed(Text)`

### Slots

- `notes : Map(NoteId, Note) = {}`
- `sync : Map(NoteId, SyncState) = {}`
- `load : LoadState = Loading`
- `session : Text = "demo-token"` — `Authorization: Bearer <session>` として送る
- `signedOut : Bool = false`
- `draftTitle : Text = ""`
- `banner : Option(Text) = None` — 最後に起きた失敗

### サーバー

すべての要求は `https://api.example.com` へ session ヘッダー付きで送る。これは `app.http` で一度だけ設定し、そこで 401 の応答もすべて 1 つの reducer に送る。

| effect | 要求 | 応答 |
|---|---|---|
| `loadNotes` | `GET /notes` | メモの JSON、`List(Note)` |
| `createNote` | `POST /notes`、本文は `{title, body}` | 作成されたメモ（サーバーの id 付き） |
| `updateNote` | `PUT /notes/:id`、本文はメモ | 保存されたメモ |
| `deleteNote` | `DELETE /notes/:id` | なし |

### 振る舞い

1. **起動時に読み込む。** `loadNotes` は起動時に走る。サーバーエラー (5xx) と接続エラーは指数バックオフで再試行し、試行は全部で最大 3 回（`retry=exponential(3, 200ms, 2.0)`：1 回目の再試行は 200 ms 後、次は 400 ms 後）。4xx は再試行しない。実行中は読み込み中であることを表示し、最終的に失敗したらそう表示して再試行を促す。
2. **楽観的に追加する。** 追加するとメモはすぐ画面に出て、一時的な id の下で保存中と表示される。サーバーが応答したら、メモはサーバーの id に置き換わり保存済みになる。サーバーが拒否したらメモは消え、バナーに追加できなかったと表示する。タイトルが空なら何も追加しない。
3. **メモごとに編集を保存する。** メモ本文を編集すると保存される。同じメモの新しい編集は、まだ処理中の古い要求に取って代わる（メモの id をキーにした `policy=latest-per-key`）。別のメモの編集は互いを待たない。保存に失敗したら編集内容は画面に残し、そのメモを失敗と表示して、その保存の再試行を促す。
4. **楽観的に削除する。** 削除するとメモはすぐ消える。サーバーが拒否したらメモは戻り、バナーに削除できなかったと表示する。
5. **セッション切れ。** 401 が返ったらどれでもサインアウトする。メモの代わりにセッションが切れたことを示すページを出し、再サインインを促す。再サインインするとメモを読み込み直す。

## 受け入れ条件の約束事

プログラムは以下の名前を使って操作し採点するので、そのとおりに使うこと。それ以外（レイアウト、文言、追加機能）は自由に決めてよい。

- effect の名前は上の表のとおり `loadNotes`、`createNote`、`updateNote`、`deleteNote`。
- 表示中のメモの件数を示す見出し `Notes (N)`。
- 読み込み中はテキスト `Loading notes`。最終的に読み込みに失敗したらテキスト `Could not load notes` とボタン `Retry`。
- `id: "new-title"` の `input` とボタン `Add note`。
- 各メモはタイトル、`id: "body-<id>"`（`<id>` はメモの id）の `textarea` に入った本文、ボタン `Delete note`、そして状態を表示する：`Saving`、`Saved`、またはボタン `Retry save` 付きの `Save failed`。
- バナーのテキスト `Could not add note` と `Could not delete note`。
- サインアウト中：テキスト `Session expired` とボタン `Sign in again`。

## 制約

- 出力は 1 つの `.kumiki` ファイル
- TypeScript / JSX / React syntax を使わない
- 副作用は effect 経由
- `app` 宣言の `caps` に必要な capability

## 出力

指定された path に `.kumiki` ファイルとして書き出すこと。**ファイル末尾に余計な XML タグや markdown fence を残さない**。

## 評価

- parse / typecheck / build と `kumiki smoke`（`benchmarks/learning-cost/eval.mjs`）
- 上の約束事を使ってプログラムを操作し、各 effect の応答を台本で与える受け入れシナリオ（`benchmarks/learning-cost/acceptance.mjs`）。合格した条件の数が得点になる
- LOC とトークン数を記録する
